'use strict';
/**
 * W7: bind this turn's prepare.tools → /api/invoke/{name}.
 *
 * Schemas come from the node. The extension never embeds the 612-tool
 * floor. Next AT tool lands via assign() + prepare, not a package.json
 * languageModelTools dump. Prefer registerToolDefinition (no contrib
 * point). Fall back to registerTool. Always pass chat-tools on sendRequest.
 *
 * desktop_vault_get and other secret tools stay off the binder even if
 * a stale summon lists them — catalog.secret_tools is the live deny list.
 */

const FALLBACK_SECRET_TOOLS = [
  'desktop_vault_get',
  'desktop_vault_set',
  'desktop_vault_import',
  'desktop_vault_generate_totp',
  'desktop_vault_revoke',
];

/** Always on dest so chat can browse, navigate, and load more AT tools. */
const DEST_ALWAYS = [
  {
    name: 'meta_search_tools',
    description: 'Find an AT tool by intent. Then describe and invoke it.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, pillar: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
  },
  {
    name: 'meta_describe_tool',
    description: 'Return the schema for one AT tool by exact name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'meta_invoke_tool',
    description: 'Run any AT tool by name. Mutating tools may pause for approve=true.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' }, approval_token: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'browser_look',
    description: 'First page step. Indexed targets + state. Then look_click / navigate.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, focus: { type: 'string' } } },
  },
  {
    name: 'browser_look_click',
    description: 'Click a look index, id, or visible text. Not a raw selector.',
    inputSchema: { type: 'object', properties: { i: { type: 'integer' }, id: { type: 'string' }, text: { type: 'string' }, button: { type: 'string' }, click_count: { type: 'integer' } } },
  },
  {
    name: 'browser_navigate',
    description: 'Open a URL in the stuck tab.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'browser_skill_replay',
    description: 'Replay a saved page flow before remapping.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, query: { type: 'string' } } },
  },
  {
    name: 'browser_fill_editor',
    description: 'Type into the focused page editor. Not the design title.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'desktop_map',
    description: 'First desktop step. Taskbar + windows + play[]. Then desktop_go.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, query: { type: 'string' } } },
  },
  {
    name: 'desktop_go',
    description: 'Click a map index or visible label on this machine.',
    inputSchema: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' }, task: { type: 'string' } } },
  },
  {
    name: 'desktop_look',
    description: 'Zoom one desktop window. Then desktop_look_click or desktop_go.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' }, ocr: { type: 'boolean' } } },
  },
  {
    name: 'desktop_look_click',
    description: 'Click a desktop_look index or visible text.',
    inputSchema: { type: 'object', properties: { i: { type: 'integer' }, text: { type: 'string' } } },
  },
  {
    name: 'desktop_uia_find',
    description: 'Find a native control. Prefer this over a raw pixel click.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' } } },
  },
  {
    name: 'personal_autoflow_match',
    description: 'Match a learned action flow before rediscovering the UI.',
    inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'] },
  },
  {
    name: 'android_ui_find',
    description: 'Find a control on the phone. Prefer this over a raw tap.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
  {
    name: 'android_ui_click',
    description: 'Tap a found Android control. Not a raw coordinate.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, i: { type: 'integer' } } },
  },
];

function destAlways(entries) {
  const have = new Set((entries || []).map((e) => e && e.name).filter(Boolean));
  return DEST_ALWAYS.filter((row) => !have.has(row.name));
}

// Local apply is Code-OSS vscode_editFile. Never bind it as an AT tool.
const BUILTIN_EDIT = 'vscode_editFile';
const { BUILTIN_TERMINAL, spec: terminalSpec, register: registerTerminal } = require('./terminal');
const { spec: editSpec, register: registerEdit } = require('./edit');
const { spec: checkSpec, register: registerCheck, collectDiagnostics } = require('./check');
const { BUILTIN_DELEGATE, spec: delegateSpec, register: registerDelegate } = require('./delegate');

function secretSet(catalog) {
  const extra = (catalog && catalog.secret_tools) || [];
  return new Set([...FALLBACK_SECRET_TOOLS, ...extra, BUILTIN_EDIT].map(String));
}

function clustryAnnotate(tools, catalog) {
  const clu = catalog && catalog.clustry;
  if (!clu || !tools.length) return tools;
  const allowed = new Set((clu.tools || []).map(String));
  const assign = String(clu.assign || '').trim();
  return tools.map((t) => {
    if (!allowed.has(t.name)) return t;
    let description = t.description || t.name;
    if (assign && !description.includes(assign)) {
      description = `${description} Assign: ${assign}.`;
    }
    return { ...t, description };
  });
}

function meshAnnotate(tools, catalog) {
  const mesh = catalog && catalog.mesh;
  if (!mesh || !tools.length) return tools;
  const allowed = new Set((mesh.tools || []).map(String));
  const hop = String(mesh.hop || '').trim();
  const names = (mesh.nodes || [])
    .map((n) => (n && (n.name || n.device)) || (typeof n === 'string' ? n : ''))
    .filter(Boolean)
    .join(', ');
  return tools.map((t) => {
    if (!allowed.has(t.name)) return t;
    let description = t.description || t.name;
    if (hop && !description.includes(hop)) {
      description = `${description} Hop: ${hop}.`;
    }
    if (names && t.name === 'personal_mesh_nodes' && !description.includes(names)) {
      description = `${description} Last seen: ${names}.`;
    }
    return { ...t, description };
  });
}

function chatTools(entries, catalog) {
  const deny = secretSet(catalog);
  const out = [];
  for (const e of entries || []) {
    const name = e && e.name;
    if (!name || deny.has(name)) continue;
    out.push({
      name,
      description: e.description || name,
      inputSchema: e.inputSchema || { type: 'object' },
    });
  }
  return clustryAnnotate(meshAnnotate(out, catalog), catalog);
}

function resultText(out) {
  if (out == null) return '';
  const data = out.data !== undefined ? out.data : out;
  let s;
  try {
    s = typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    s = String(data);
  }
  if (/sk-|api[_-]?key|BEGIN [A-Z]+ PRIVATE|password\s*[:=]/i.test(s)) {
    return '{"ok":true,"omitted":"secret value stayed on the node"}';
  }
  return s;
}

function createImpl(client, vscode, name, session) {
  return {
    async invoke(options) {
      const input = { ...((options && options.input) || {}) };
      const approve = Boolean(input.approve);
      delete input.approve;
      const approvalToken = approve && session ? session.takeApproval(name) : undefined;
      const out = await client.invoke(name, input, { approvalToken, autoApprove: false });
      let text;
      if (out && out.approval_required) {
        if (session && out.approval_token) session.holdApproval(name, out.approval_token);
        text = JSON.stringify({
          approval_required: true,
          tool: name,
          hint: 'ask the user to confirm, then call again with approve=true',
        });
      } else {
        text = resultText(out);
      }
      if (vscode && vscode.LanguageModelToolResult && vscode.LanguageModelTextPart) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(text),
        ]);
      }
      return { content: [{ type: 'text', value: text }] };
    },
  };
}

class ToolSession {
  constructor() {
    this._disposables = [];
    this._pending = new Map();
  }

  holdApproval(name, token) {
    if (name && token) this._pending.set(String(name), String(token));
  }

  takeApproval(name) {
    const key = String(name || '');
    const token = this._pending.get(key);
    this._pending.delete(key);
    return token;
  }

  dispose() {
    for (const d of this._disposables) {
      try { if (d && typeof d.dispose === 'function') d.dispose(); } catch { /* ignore */ }
    }
    this._disposables = [];
  }

  bind(vscode, client, entries, catalog) {
    this.dispose();
    const tools = chatTools([...(entries || []), ...destAlways(entries)], catalog);
    const lm = vscode && vscode.lm;
    for (const spec of tools) {
      const impl = createImpl(client, vscode, spec.name, this);
      if (lm && typeof lm.registerToolDefinition === 'function') {
        this._disposables.push(lm.registerToolDefinition({
          name: spec.name,
          displayName: spec.name,
          description: spec.description,
          inputSchema: spec.inputSchema,
          tags: ['anchortrails'],
        }, impl));
      } else if (lm && typeof lm.registerTool === 'function') {
        this._disposables.push(lm.registerTool(spec.name, impl));
      }
    }
    const afterWrite = (path) => {
      const check = collectDiagnostics(vscode, path);
      if (vscode && vscode.commands && typeof vscode.commands.executeCommand === 'function') {
        try { vscode.commands.executeCommand('anchortrails.plan.applyCheck', check); } catch { /* Plan paint is optional */ }
      }
      return check;
    };
    this._disposables.push(registerTerminal(vscode));
    this._disposables.push(registerCheck(vscode));
    this._disposables.push(registerEdit(vscode, afterWrite));
    this._disposables.push(registerDelegate(vscode));
    if (!tools.some((t) => t.name === BUILTIN_TERMINAL)) {
      tools.push(terminalSpec());
    }
    if (!tools.some((t) => t.name === BUILTIN_EDIT)) {
      tools.push(editSpec());
    }
    if (!tools.some((t) => t.name === checkSpec().name)) {
      tools.push(checkSpec());
    }
    if (!tools.some((t) => t.name === BUILTIN_DELEGATE)) {
      tools.push(delegateSpec());
    }
    return tools;
  }
}

module.exports = {
  FALLBACK_SECRET_TOOLS,
  DEST_ALWAYS,
  destAlways,
  BUILTIN_EDIT,
  BUILTIN_TERMINAL,
  BUILTIN_DELEGATE,
  secretSet,
  meshAnnotate,
  clustryAnnotate,
  chatTools,
  resultText,
  createImpl,
  ToolSession,
};
