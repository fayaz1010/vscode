'use strict';
/**
 * Language-model provider core. No vscode import — tests run under node.
 * extension.js wraps this with vscode.lm.registerLanguageModelChatProvider.
 *
 * Tool calling: sendRequest's `options.tools` go to the node as schemas, and
 * the node's `tool_calls` come back as LanguageModelToolCallPart. Messages
 * carrying earlier tool-call / tool-result parts are sent role-preserved,
 * not flattened, so the model can continue its own loop. Both the @at
 * participant and Copilot's Agent-mode harness drive this the same way.
 */

const { listModelInfo, VENDOR } = require('./slugs');

function extractText(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (typeof part.value === 'string') return part.value;
  if (typeof part.text === 'string') return part.text;
  if (Array.isArray(part.content)) return part.content.map(extractText).join('');
  if (typeof part.content === 'string') return part.content;
  return '';
}

function normalizeRole(role) {
  if (role === 1 || role === 'user' || role === 'User') return 'user';
  if (role === 2 || role === 'assistant' || role === 'Assistant') return 'assistant';
  if (role === 0 || role === 'system' || role === 'System') return 'system';
  return 'user';
}

function flattenMessages(messages) {
  let system = '';
  const out = [];
  for (const m of messages || []) {
    const role = normalizeRole(m.role);
    const text = extractText(m);
    if (!text) continue;
    if (role === 'system' && !system) system = text;
    else out.push({ role, content: text });
  }
  return { system, messages: out };
}

// Duck-typed on purpose: real vscode.LanguageModelToolCallPart /
// LanguageModelToolResultPart instances arrive here in the extension host,
// plain objects in tests. A tool call carries `input`; a tool result carries
// a `content` array. Text parts carry neither.
function isToolCallPart(p) {
  return Boolean(p) && typeof p === 'object' && typeof p.callId === 'string'
    && typeof p.name === 'string' && 'input' in p;
}

function isToolResultPart(p) {
  return Boolean(p) && typeof p === 'object' && typeof p.callId === 'string'
    && Array.isArray(p.content) && !('input' in p);
}

function partsOf(m) {
  if (!m) return [];
  if (typeof m.content === 'string') return [{ value: m.content }];
  if (Array.isArray(m.content)) return m.content;
  return [];
}

function resultText(part) {
  const s = (part.content || []).map(extractText).join('');
  if (s) return s;
  try { return JSON.stringify(part.content); } catch { return ''; }
}

function hasToolParts(messages) {
  return (messages || []).some((m) => partsOf(m).some((p) => isToolCallPart(p) || isToolResultPart(p)));
}

function structuredMessages(messages) {
  let system = '';
  const out = [];
  for (const m of messages || []) {
    const role = normalizeRole(m.role);
    const parts = partsOf(m);
    const text = parts.filter((p) => !isToolCallPart(p) && !isToolResultPart(p)).map(extractText).join('');
    if (role === 'system') {
      if (text && !system) system = text;
      continue;
    }
    const results = parts.filter(isToolResultPart);
    for (const r of results) {
      out.push({ role: 'tool', tool_call_id: r.callId, content: resultText(r) });
    }
    const calls = role === 'assistant'
      ? parts.filter(isToolCallPart).map((c) => ({ id: c.callId, name: c.name, arguments: c.input || {} }))
      : [];
    if (text || calls.length) {
      const row = { role, content: text };
      if (calls.length) row.tool_calls = calls;
      out.push(row);
    }
  }
  return { system, messages: out };
}

function toolsFor(options) {
  return ((options && options.tools) || []).map((t) => ({
    name: t.name,
    description: t.description || t.name,
    inputSchema: t.inputSchema || { type: 'object' },
  })).filter((t) => t.name);
}

function slugOf(model) {
  if (typeof model === 'string') return model;
  return (model && (model.id || model.name)) || '';
}

async function completeViaBridge(client, model, messages, options = {}) {
  const slug = slugOf(model);
  const tools = toolsFor(options);
  const structured = tools.length > 0 || hasToolParts(messages);
  const shaped = structured ? structuredMessages(messages) : flattenMessages(messages);
  const system = options.system || shaped.system;
  // Role-preserved history is the whole prompt on the structured path; a
  // `user` string there would be appended again by the node.
  const user = structured ? '' : (
    options.user
    || shaped.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    || shaped.messages.map((m) => m.content).join('\n')
  );
  const body = {
    model: slug,
    system,
    user,
    messages: shaped.messages,
    effort: options.effort,
    cascade: Boolean(options.cascade),
    fallback: options.fallback,
    session_id: options.session_id,
  };
  if (tools.length) body.tools = tools;
  return client.complete(body);
}

function estimateTokens(text) {
  const s = typeof text === 'string' ? text : extractText(text);
  return Math.max(1, Math.ceil(String(s).length / 4));
}

function textPart(vscode, text) {
  if (vscode && vscode.LanguageModelTextPart) return new vscode.LanguageModelTextPart(text);
  return { type: 'text', value: text };
}

function toolCallPart(vscode, call, i) {
  const id = String(call.id || `call_${i}_${call.name}`);
  const input = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
  if (vscode && vscode.LanguageModelToolCallPart) {
    return new vscode.LanguageModelToolCallPart(id, String(call.name), input);
  }
  return { type: 'tool_call', callId: id, name: String(call.name), input };
}

function createProvider(client, vscode) {
  return {
    async provideLanguageModelChatInformation() {
      if (client && typeof client.catalog === 'function') {
        try {
          const cat = await client.catalog();
          if (cat && Array.isArray(cat.slugs) && cat.slugs.length) {
            return listModelInfo(cat.slugs);
          }
        } catch { /* offline / auth — use fallback slugs */ }
      }
      return listModelInfo();
    },
    async provideLanguageModelChatResponse(model, messages, options, progress) {
      const opts = options || {};
      const mo = opts.modelOptions || {};
      const out = await completeViaBridge(client, model, messages, {
        ...opts,
        system: opts.system || mo.system,
        user: opts.user || mo.user,
        effort: opts.effort ?? mo.effort,
        cascade: opts.cascade ?? mo.cascade,
        fallback: opts.fallback || mo.fallback,
        session_id: opts.session_id || mo.session_id,
      });
      const calls = Array.isArray(out.tool_calls) ? out.tool_calls.filter((c) => c && c.name) : [];
      let text = out.text || '';
      if (!calls.length) {
        if (out.skipped && !text) {
          text = '(no AI key on this node — util-ai `openrouter`, vault `openrouter_api_key`, or OPENROUTER_API_KEY. Keys stay on the node.)';
        } else if (!text && out.error) {
          text = `complete failed (${out.error}) on \`${slugOf(model)}\`. The node remaps assign slugs from OpenRouter.`;
        }
      }
      if (progress && typeof progress.report === 'function') {
        if (text) progress.report(textPart(vscode, text));
        calls.forEach((c, i) => progress.report(toolCallPart(vscode, c, i)));
      }
      return out;
    },
    async provideTokenCount(_model, text) {
      return estimateTokens(text);
    },
  };
}

module.exports = {
  VENDOR,
  extractText,
  normalizeRole,
  flattenMessages,
  structuredMessages,
  isToolCallPart,
  isToolResultPart,
  toolsFor,
  slugOf,
  completeViaBridge,
  estimateTokens,
  createProvider,
  listModelInfo,
};
