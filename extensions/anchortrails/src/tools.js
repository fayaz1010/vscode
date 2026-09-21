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
    // No approval_token here: the person approves, in a dialog; the model
    // never sees or handles a token. Live, one leaked into the chat text.
    description: 'Run any AT tool by name after meta_describe_tool. Mutating tools pause for the person to approve.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] },
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
    // First live tool-loop run called this with {query: ...} and got a real
    // validation error back: the backend (tools/browser/flight_recorder.py
    // SkillReplayInput) takes `task`, not `query`/`name`.
    description: 'Replay a saved page flow before remapping.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What you want done; matched against saved skills.' },
        params: { type: 'object', description: 'Values for the skill\'s {{placeholders}}.' },
        app: { type: 'string', description: 'Optional host to scope the match, e.g. "ads.google.com".' },
      },
      required: ['task'],
    },
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
    // "launch claude desktop" called this with {query: "Claude"} three times
    // and found nothing -- the DECLARED schema here was {name, text}, flat,
    // and the REAL backend (tools/desktop/uia.py) takes a NESTED selector:
    // {selector: {name, app, window_title, automation_id, ...}}. Neither
    // shape the model tried could ever have worked; a correctly-shaped call
    // (selector.name = "Claude") searches the whole desktop, taskbar
    // included, by default.
    description: (
      'Find an accessible control by its display name -- an app in the '
      + 'taskbar/Start Menu, a button, a menu item. Searches the whole '
      + 'desktop unless selector.window_title or selector.app scopes it to '
      + 'one window. Prefer this over a raw pixel click.'
    ),
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display label, e.g. "Claude", "Save", "File menu".' },
            app: { type: 'string', description: 'Scope to one running application by name.' },
            window_title: { type: 'string', description: 'Scope to the window whose title contains this.' },
            automation_id: { type: 'string' },
            control_type: { type: 'string', description: 'Button, Edit, ComboBox, MenuItem, ListItem...' },
            class_name: { type: 'string' },
          },
        },
        limit: { type: 'integer', description: 'Max matches to return (default 20).' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'desktop_run_command',
    // Every UI-automation search this session (desktop_uia_find, desktop_go)
    // had room to guess a wrong call shape, or even narrate a fictional
    // result with no real tool call behind it -- a shell command either
    // finds something or it doesn't, with no UI tree to walk and no fuzzy
    // name to match. Give the model a deterministic way to check first,
    // rather than reaching straight for fuzzy on-screen search.
    // Live: the model's first call was bare PowerShell and died with exit
    // 255 -- on Windows the backend runs the string through cmd.exe. The
    // wrapped calls that followed worked. Say so, with the one-line launch
    // that Claude Code / Cursor / Codex would use.
    description: (
      'Run one shell command and read its real stdout/stderr/exit code -- '
      + 'no UI tree, no guessing. FIRST choice to launch, close or find an '
      + 'app, a file or a process: one command does it, no look, no click. '
      + 'Windows runs cmd.exe -- wrap PowerShell as '
      + 'powershell -NoProfile -Command "Start-Process shell:AppsFolder\\<AppID>" '
      + 'or "Start-Process <exe>"; find the AppID with Get-StartApps. '
      + 'Never start an interactive program (claude, vim, a REPL): it hangs '
      + 'until the timeout. Refuses commands that synthesize keyboard or '
      + 'mouse input.'
    ),
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command, e.g. powershell -NoProfile -Command "Get-Process claude" or "where.exe claude".' },
        cwd: { type: 'string', description: 'Working directory. Optional.' },
        timeout_seconds: { type: 'integer', description: 'Kill the command after this long. Default 30.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'desktop_llm_prompt',
    // "chat with Claude Desktop and ask it to fix X" spent 24 rounds looking
    // for a way in: window hidden, no debug port on that instance, this tool
    // only reachable through meta_search_tools. It is the one tool for the
    // job; declare it, and say the one precondition it has.
    description: (
      'Send a message to another AI app\'s chat (claude_desktop, cursor, codex, '
      + 'windsurf) and wait for its reply. Omit port: the tool then drives the '
      + 'app\'s own window through accessibility, the only path for '
      + 'claude_desktop (it blocks debug ports). For cursor/codex/windsurf a '
      + 'port from desktop_ide_launch_with_debug is faster. Pass workspace_path '
      + 'for the folder the app should work in. The app must be running with a '
      + 'visible window -- launch it first if it is not.'
    ),
    inputSchema: {
      type: 'object',
      properties: {
        ide_id: { type: 'string', description: 'claude_desktop | cursor | codex | windsurf' },
        prompt: { type: 'string', description: 'What to say to it.' },
        workspace_path: { type: 'string', description: 'Folder the app should work in, e.g. D:\\code-oss.' },
        port: { type: 'integer', description: 'Only a port desktop_ide_launch_with_debug returned. Never for claude_desktop.' },
        timeout_seconds: { type: 'number', description: 'How long to wait for the reply (default 300).' },
      },
      required: ['ide_id', 'prompt'],
    },
  },
  {
    name: 'desktop_ide_launch_with_debug',
    description: (
      'Start a fresh instance of cursor / codex / windsurf with '
      + '--remote-debugging-port so desktop_llm_prompt can talk to it fast. '
      + 'Returns the port and pid. Not for claude_desktop (it blocks debug '
      + 'ports; talk to it without a port). Use force_restart when the app is '
      + 'already open without a port.'
    ),
    inputSchema: {
      type: 'object',
      properties: {
        ide_id: { type: 'string', description: 'claude_desktop | cursor | codex | windsurf' },
        port: { type: 'integer', description: 'Optional; defaults to the app\'s usual port.' },
        extra_args: { type: 'array', items: { type: 'string' }, description: 'e.g. a workspace path.' },
        force_restart: { type: 'boolean', description: 'Quit the running instance first.' },
      },
      required: ['ide_id'],
    },
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
  // An approval token is for the dialog, never for the model.
  return s.replace(/"approval_token"\s*:\s*"[^"]*"/g, '"approval_token":"(held)"');
}

function nestedApproval(out) {
  if (!out || typeof out !== 'object') return null;
  if (out.approval_required) return out;
  const inner = out.data;
  if (inner && typeof inner === 'object' && inner.approval_required) return inner;
  return null;
}

const META_INVOKE = 'meta_invoke_tool';

// meta_invoke_tool is the model's door to the 600-tool floor. The client
// walks through it itself: the inner tool is invoked by name, so there is
// ONE approval gate (the inner tool's), not two (meta_invoke_tool is
// mutating on the bridge, and the inner tool gates again inside it). Live,
// the double gate produced a nested approval_required whose token reached
// the model, and no dialog. The catalog deny list applies to the inner name.
function unwrapInvoke(name, input, deny) {
  if (name !== META_INVOKE) return { name, input, error: null };
  const inner = String(input.name || '').trim();
  const args = input.arguments && typeof input.arguments === 'object' ? { ...input.arguments } : {};
  if (!inner) return { name, input, error: 'meta_invoke_tool needs a tool name' };
  if (deny && deny.has(inner)) return { name, input, error: `${inner} is not available from chat` };
  delete args.approval_token;
  return { name: inner, input: args, error: null };
}

function createImpl(client, vscode, name, session, deny) {
  return {
    async invoke(options) {
      const raw = { ...((options && options.input) || {}) };
      const approve = Boolean(raw.approve);
      delete raw.approve;
      delete raw.approval_token;
      const target = unwrapInvoke(name, raw, deny);
      let text;
      if (target.error) {
        text = JSON.stringify({ error: target.error });
      } else {
        const approvalToken = approve && session ? session.takeApproval(target.name) : undefined;
        const out = await client.invoke(target.name, target.input, { approvalToken, autoApprove: false });
        const pending = nestedApproval(out);
        if (pending) {
          if (session && pending.approval_token) session.holdApproval(target.name, pending.approval_token);
          text = JSON.stringify({
            approval_required: true,
            tool: target.name,
            hint: 'ask the user to confirm, then call again with approve=true',
          });
        } else {
          text = resultText(out);
        }
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
    const deny = secretSet(catalog);
    for (const spec of tools) {
      const impl = createImpl(client, vscode, spec.name, this, deny);
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
  unwrapInvoke,
  nestedApproval,
  META_INVOKE,
  ToolSession,
};
