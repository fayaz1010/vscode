'use strict';
/**
 * Language-model provider core. No vscode import — tests run under node.
 * extension.js wraps this with vscode.lm.registerLanguageModelChatProvider.
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

function slugOf(model) {
  if (typeof model === 'string') return model;
  return (model && (model.id || model.name)) || '';
}

async function completeViaBridge(client, model, messages, options = {}) {
  const slug = slugOf(model);
  const flat = flattenMessages(messages);
  const system = options.system || flat.system;
  const user = options.user
    || flat.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    || flat.messages.map((m) => m.content).join('\n');
  return client.complete({
    model: slug,
    system,
    user,
    messages: flat.messages,
    effort: options.effort,
    cascade: Boolean(options.cascade),
    fallback: options.fallback,
    session_id: options.session_id,
  });
}

function estimateTokens(text) {
  const s = typeof text === 'string' ? text : extractText(text);
  return Math.max(1, Math.ceil(String(s).length / 4));
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
      let text = out.text || '';
      if (out.skipped && !text) {
        text = '(no AI key on this node — util-ai `openrouter`, vault `openrouter_api_key`, or OPENROUTER_API_KEY. Keys stay on the node.)';
      } else if (!text && out.error) {
        text = `complete failed (${out.error}) on \`${slugOf(model)}\`. The node remaps assign slugs from OpenRouter.`;
      }
      if (progress && typeof progress.report === 'function') {
        if (vscode && vscode.LanguageModelTextPart) {
          progress.report(new vscode.LanguageModelTextPart(text));
        } else {
          progress.report({ type: 'text', value: text });
        }
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
  slugOf,
  completeViaBridge,
  estimateTokens,
  createProvider,
  listModelInfo,
};
