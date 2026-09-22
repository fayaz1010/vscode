'use strict';
/**
 * W6: default ChatParticipant. prepare → assign slug → sendRequest.
 *
 * Layer M is the system. The assigned slug wins over the UI picker.
 * W7 binds prepare.tools for this turn only (registerToolDefinition →
 * /api/invoke). Dest also always binds look/map/go + search/describe/invoke
 * so chat can browse, navigate, and load more without a 612-tool dump.
 * Next AT tool or slug lands via the node catalog / assign, not a fork
 * patch. OzFactory DESIGN→PLAN rides prepare.summon when assign packs it.
 * Keys stay on the node. Never dump the 612-tool floor.
 */

const { folderPath, sessionId: workspaceSession } = require('./workspace');
const { VENDOR } = require('./slugs');
const { BridgeAuthError, BridgeEntitlementError } = require('./bridge');
const { ToolSession, chatTools } = require('./tools');
const { planTag, planMarkdown } = require('./slash');
const { canGreen } = require('./check');
const {
  MAX_ROUNDS,
  STUCK_LIMIT,
  driveKind,
  destCheck,
  advanceLocal,
  finishPlan,
  isDone,
  nextAhead,
  doneMarkdown,
  stuckMarkdown,
} = require('./plan_loop');

const PARTICIPANT_ID = 'anchortrails.chat';
const PARTICIPANT_NAME = 'at';

function pickSlug(prepared) {
  return String((prepared && prepared.model) || '').trim();
}

function extractPart(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (typeof part.value === 'string') return part.value;
  if (part.value && typeof part.value.value === 'string') return part.value.value;
  if (typeof part.text === 'string') return part.text;
  return '';
}

function mapHistoryTurn(turn) {
  if (!turn) return null;
  if (typeof turn.prompt === 'string' && !Array.isArray(turn.response)) {
    return turn.prompt ? { role: 'user', content: turn.prompt } : null;
  }
  if (Array.isArray(turn.response)) {
    const text = turn.response.map(extractPart).join('');
    return text ? { role: 'assistant', content: text } : null;
  }
  if (turn.role && turn.content) {
    const role = String(turn.role).toLowerCase() === 'assistant' ? 'assistant' : 'user';
    return { role, content: String(turn.content) };
  }
  return null;
}

function buildTurn(prepared, prompt, history) {
  const messages = [];
  for (const turn of history || []) {
    const mapped = mapHistoryTurn(turn);
    if (mapped) messages.push(mapped);
  }
  if (prompt) messages.push({ role: 'user', content: String(prompt) });
  const plan = (prepared && prepared.plan) || null;
  return {
    system: (prepared && prepared.system) || '',
    model: pickSlug(prepared),
    fallback: prepared && prepared.fallback,
    effort: prepared && prepared.effort,
    cascade: Boolean(prepared && prepared.cascade),
    session_id: prepared && prepared.session_id,
    summon: (prepared && prepared.summon) || [],
    tools: (prepared && prepared.tools) || [],
    tools_required: Boolean(prepared && prepared.tools_required),
    task_class: prepared && prepared.task_class,
    plan,
    keys: (prepared && prepared.keys) || null,
    approvals: (prepared && prepared.approvals) || null,
    messages: capHistory(messages, plan),
  };
}

// Plan card is Layer M. Full chat history would re-pay Layer W.
const PLAN_HISTORY = 2;

function capHistory(messages, plan) {
  if (!plan || !(plan.cursor || plan.card)) return messages;
  if (!messages || messages.length <= PLAN_HISTORY + 1) return messages;
  const current = messages[messages.length - 1];
  return [...messages.slice(0, -1).slice(-PLAN_HISTORY), current];
}

function toVscodeMessages(vscode, messages) {
  const LM = vscode && vscode.LanguageModelChatMessage;
  if (!LM) return messages;
  return (messages || []).map((m) => {
    if (m.role === 'assistant') return LM.Assistant(m.content);
    return LM.User(m.content);
  });
}

function requestOptions(turn, boundTools) {
  const tools = boundTools || chatTools(turn.tools);
  const opts = {
    justification: 'AnchorTrails MUWT composer',
    modelOptions: {
      system: turn.system,
      effort: turn.effort,
      cascade: turn.cascade,
      fallback: turn.fallback,
      session_id: turn.session_id,
    },
  };
  if (tools.length) opts.tools = tools;
  return opts;
}

function collectAttachments(request) {
  const names = [];
  const refs = (request && request.references) || [];
  for (const ref of refs) {
    const v = ref && ref.value;
    if (v && typeof v.fsPath === 'string') names.push(v.fsPath);
    else if (v && typeof v.path === 'string') names.push(v.path);
    else if (v && v.uri && typeof v.uri.fsPath === 'string') names.push(v.uri.fsPath);
    else if (typeof v === 'string') names.push(v);
    else if (v && v.mimeType) names.push(`.${String(v.mimeType).split('/').pop()}`);
    else if (ref && ref.name) names.push(String(ref.name));
  }
  return names;
}

function payloadTokensFor(attachments) {
  if (attachments && attachments.length) return 12000;
  return 10000;
}

function workspacePath(vscode, explicit) {
  if (explicit) return explicit;
  return folderPath(vscode);
}

function resultMeta(turn, extra) {
  return {
    metadata: {
      model: turn.model,
      fallback: turn.fallback,
      session_id: turn.session_id,
      summon: turn.summon,
      tools_required: turn.tools_required,
      task_class: turn.task_class,
      plan: turn.plan,
      ...extra,
    },
  };
}

function visibleComplete(out, slug) {
  if (!out) return 'complete returned nothing.';
  if (out.text) return String(out.text);
  if (out.skipped && out.error === 'empty user/messages') {
    return 'complete got an empty prompt.';
  }
  if (out.skipped) {
    return '(no AI key on this node — util-ai `openrouter`, vault `openrouter_api_key`, or OPENROUTER_API_KEY. Keys stay on the node.)';
  }
  if (out.error) {
    return `complete failed (${out.error}) on \`${slug}\`${out.model ? ` → ${out.model}` : ''}.`;
  }
  return 'complete returned no text.';
}

function partText(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') return chunk;
  if (typeof chunk.value === 'string') return chunk.value;
  if (typeof chunk.text === 'string') return chunk.text;
  return '';
}

async function streamText(response, modelResponse) {
  if (!modelResponse) return false;
  let wrote = false;
  const write = (chunk) => {
    const s = partText(chunk);
    if (!s) return;
    response.markdown(s);
    wrote = true;
  };
  if (modelResponse.text && typeof modelResponse.text[Symbol.asyncIterator] === 'function') {
    for await (const chunk of modelResponse.text) write(chunk);
    if (wrote) return true;
  }
  if (modelResponse.stream && typeof modelResponse.stream[Symbol.asyncIterator] === 'function') {
    for await (const part of modelResponse.stream) write(part);
    if (wrote) return true;
  }
  if (typeof modelResponse.text === 'string') write(modelResponse.text);
  return wrote;
}

async function completeVisible(client, turn, prompt) {
  if (!client || typeof client.complete !== 'function') {
    return visibleComplete(null, turn.model);
  }
  const out = await client.complete({
    model: turn.model,
    system: turn.system,
    user: prompt,
    messages: turn.messages,
    effort: turn.effort,
    cascade: turn.cascade,
    fallback: turn.fallback,
    session_id: turn.session_id,
  });
  return visibleComplete(out, turn.model);
}

// A person's own words back, in a bounded, curated frame -- NEVER the raw
// `do`/`do_not`/`card` fields from turn_plan.py. Those are instructions FOR
// the model ("execute this user line now. Call tools. Do not announce
// intent.") and were going straight into response.progress(), which is a
// user-facing status line -- someone typed "launch claude desktop" and
// watched the chat print its own internal orders back at them. Only
// `turn.goal`, a clip of what the user actually typed, is safe to echo.
const PROGRESS_LABEL = {
  computer: 'Looking at the screen',
  forms: 'Filling in the form',
  session: 'Working through the plan',
  status: 'Checking the plan',
  stop: 'Stopping',
  turn: 'Working on it',
};

function friendlyProgress(turn) {
  const label = PROGRESS_LABEL[turn && turn.playbook] || 'Working on it';
  const goal = typeof (turn && turn.goal) === 'string' ? turn.goal.trim() : '';
  if (!goal) return `${label}…`;
  const clipped = goal.length > 60 ? `${goal.slice(0, 60)}…` : goal;
  return `${label}: ${clipped}`;
}

// The tool loop. For months the schemas were registered and passed to
// sendRequest, and not one call ever ran: nothing read tool-call parts off
// the stream, nothing invoked, nothing fed a result back. The model only ever
// saw tool NAMES in the system prompt and wrote prose shaped like a step
// ledger -- "[>] desktop_uia_find {query: 'claude'} failed" for a query that,
// run for real, found seven matches. Same shape as Copilot's Agent harness
// (extChatEndpoint.ts): stream → ToolCallPart → lm.invokeTool → Assistant
// [call parts] + User [result parts] → send again, until a round has no calls.
// 24, not a handful: "go to the form, fill it, submit, then check email for
// the confirmation" is look + one call per field + submit + look + find an
// email tool + read it. Each round is one model request; the model ends the
// loop itself by answering without a call.
const MAX_TOOL_ROUNDS = 24;
// Short on purpose: a person reads this, not a log parser. The first live
// run printed 160-char JSON dumps per call and read as "a lot of streams".
const ARGS_CLIP = 60;
const RESULT_CLIP = 90;

function clip(s, n) {
  const str = String(s == null ? '' : s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function isToolCallPart(part) {
  return Boolean(part) && typeof part === 'object' && typeof part.callId === 'string'
    && typeof part.name === 'string' && 'input' in part;
}

async function readResponse(response, modelResponse) {
  const out = { text: '', calls: [], wrote: false };
  if (!modelResponse) return out;
  const write = (s) => {
    if (!s) return;
    response.markdown(s);
    out.text += s;
    out.wrote = true;
  };
  if (modelResponse.stream && typeof modelResponse.stream[Symbol.asyncIterator] === 'function') {
    for await (const part of modelResponse.stream) {
      if (isToolCallPart(part)) {
        out.calls.push({ callId: part.callId, name: part.name, input: part.input || {} });
      } else {
        write(partText(part));
      }
    }
    return out;
  }
  if (modelResponse.text && typeof modelResponse.text[Symbol.asyncIterator] === 'function') {
    for await (const chunk of modelResponse.text) write(partText(chunk));
    return out;
  }
  if (typeof modelResponse.text === 'string') write(modelResponse.text);
  return out;
}

function toolResultText(result) {
  const content = result && Array.isArray(result.content) ? result.content : [];
  const s = content.map(partText).join('');
  if (s) return s;
  try {
    return JSON.stringify(result && result.content !== undefined ? result.content : result);
  } catch {
    return String(result);
  }
}

// No toolInvocationToken on purpose: with one, the chat renders its own
// collapsible "Finished with N steps" widget per call on top of the ledger
// line below -- two entries per call, which read as "a lot of streams".
// The ledger line carries the result; the widget did not.
async function invokeOnce(vscode, name, input, token) {
  const lm = vscode && vscode.lm;
  if (!lm || typeof lm.invokeTool !== 'function') {
    return JSON.stringify({ error: `tool ${name} is not invokable in this host` });
  }
  try {
    const result = await lm.invokeTool(name, { input }, token);
    return toolResultText(result);
  } catch (err) {
    return JSON.stringify({ error: String((err && err.message) || err) });
  }
}

function approvalRequired(text) {
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed && parsed.approval_required);
  } catch {
    return false;
  }
}

const APPROVE_ONE = 'Approve';
const APPROVE_TURN = 'Approve all this turn';

// The bridge pauses every mutating tool (a click, a keystroke, a shell
// command) and hands back approval_required. Before this, the only thing
// that could answer was the model itself, by setting approve=true -- so
// either it self-approved, or it stopped and told the user to "confirm",
// with nothing to click. Live: a launch that found the taskbar button on
// the first try then stalled on three approval_required results in a row.
// The person is the one who confirms: a modal with the tool name and its
// input, one click per action or one for the whole turn.
// Plain words in the modal, the raw command underneath. The first version
// put the whole input JSON in the title -- "full of syntax" to the person
// who has to click it.
const SHELL_WRAP = /^\s*(?:powershell(?:\.exe)?|pwsh)\s+(?:-\w+\s+)*-c(?:ommand)?\s+"?([\s\S]*?)"?\s*$/i;

function plainCommand(input) {
  const raw = String((input && input.command) || '').trim();
  const m = raw.match(SHELL_WRAP);
  // Inside a `powershell -Command "..."` wrapper the inner quotes arrive
  // escaped as \" -- a person reads `"claude.exe"`, not `\"claude.exe\"`,
  // and the verb finder must not see a lone backslash as the last token.
  return (m ? m[1] : raw).replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
}

// One short phrase per command segment, in words a person reads at a
// glance: "stop the program claude", "delete x", "download from ...".
// The raw command never goes in the modal any more -- "approve dialog is
// same still, huge 4 line syntax style" was the reaction to `Command: ...`
// underneath the plain title.
const VERB_PHRASES = [
  [/^(stop-process|taskkill|kill|pkill)$/, 'stop the program'],
  [/^(remove-item|rm|rmdir|del|erase)$/, 'delete'],
  [/^(new-item|mkdir|md)$/, 'create'],
  [/^(set-content|add-content|out-file|tee)$/, 'write the file'],
  [/^(copy-item|cp|copy|xcopy|robocopy)$/, 'copy'],
  [/^(move-item|rename-item|mv|move|ren)$/, 'move or rename'],
  [/^(invoke-webrequest|invoke-restmethod|iwr|irm|curl|wget)$/, 'download from'],
  [/^(start-process|start|open|xdg-open|invoke-item)$/, 'start'],
  [/^(git)$/, 'run git'],
  [/^(npm|npx|pip|pip3|winget|choco|msiexec|apt|brew)$/, 'install or run a package with'],
  [/^(set-\w+)$/, 'change a setting with'],
  [/^(get-\w+|dir|ls|type|cat|where(?:\.exe)?|findstr|grep|tasklist|select-string)$/, 'read'],
];

// Pipe stages that only shape output: "Get-Process | Where-Object ... |
// Format-Table" is one action, "look up process", not three.
const FILTER_VERBS = /^(where-object|where|\?|select-object|select|sort-object|sort|format-\w+|out-string|out-null|foreach-object|foreach|%|measure-object|group-object|convertto-json|convertfrom-json|select-string|findstr|grep|head|tail|more|tee-object)$/;

function firstArgument(segment, verb) {
  const rest = segment.replace(/^[({]+\s*/, '').replace(/^\$[\w:]+\s*=\s*/, '').replace(/^&\s*/, '');
  const tokens = rest.split(/\s+/).slice(1).filter((t) => t && !/^-/.test(t));
  let arg = (tokens[0] || '').replace(/^["']|["']$/g, '');
  if (!/:\/\//.test(arg)) arg = arg.replace(/^.*[\\/]/, '');
  if (!arg || arg === verb || /^[$@({]/.test(arg)) return '';
  return clip(arg, 40);
}

function describeStage(stage) {
  const verb = verbOf(stage);
  if (!verb || CONTROL_VERBS.has(verb) || FILTER_VERBS.test(verb) || /^[-$@'"(]/.test(verb)) return '';
  const arg = firstArgument(stage, verb);
  if (LAUNCH_INSIDE.test(stage) && !/^(start-process|start|open|invoke-item)$/.test(verb)) {
    return `start ${arg || 'an app'}`;
  }
  for (const [re, phrase] of VERB_PHRASES) {
    if (!re.test(verb)) continue;
    if (phrase === 'start') return `start ${arg || 'an app'}`;
    if (phrase === 'read') return `look up ${arg || verb.replace(/^get-/, '').replace(/\.exe$/, '')}`;
    return arg ? `${phrase} ${arg}` : phrase;
  }
  return arg ? `run ${verb} ${arg}` : `run ${verb}`;
}

// A statement is one action; its pipe stages after the first only filter.
function describeStatement(statement) {
  const stages = String(statement || '').split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
  for (const stage of stages) {
    const p = describeStage(stage);
    if (p) return p;
  }
  return '';
}

function describeCommand(command) {
  const plain = plainCommand({ command });
  const phrases = [];
  for (const st of String(plain || '').split(/\s*(?:;|&&|\|\||\r?\n)\s*/)) {
    const p = describeStatement(st);
    if (p && !phrases.includes(p)) phrases.push(p);
  }
  if (!phrases.length) return 'run a command';
  const shown = phrases.slice(0, 3);
  const more = phrases.length - shown.length;
  return shown.join(', then ') + (more > 0 ? `, and ${more} more` : '');
}

function approvalText(rawCall) {
  const call = innerCall(rawCall);
  const input = call.input || {};
  const name = String(call.name || '');
  if (/llm_prompt|ide_relay|ide_send_prompt/.test(name)) {
    return { message: `AnchorTrails wants to send a message to ${input.ide_id || 'another app'}`, detail: `Message: ${clip(String(input.prompt || input.message || ''), 160)}` };
  }
  const target = input.text || input.label || input.name
    || (input.selector && input.selector.name) || (input.i != null ? `item ${input.i}` : '');
  if (name === 'desktop_run_command' || name === 'runInTerminal') {
    const why = shellAskReason(input.command, call.goal);
    return {
      message: `AnchorTrails wants to ${describeCommand(input.command)}`,
      detail: why ? `Asking because ${why}.` : '',
    };
  }
  if (/click|go$|invoke|press|tap/.test(name)) {
    return { message: `AnchorTrails wants to click${target ? ` "${clip(target, 60)}"` : ''}`, detail: `Tool: ${name}` };
  }
  if (/type|fill|set_value|paste|keys/.test(name)) {
    return { message: 'AnchorTrails wants to type into a field', detail: `Tool: ${name}${target ? ` — ${clip(target, 60)}` : ''}` };
  }
  if (/^browser_/.test(name)) {
    return { message: 'AnchorTrails wants to act in the browser', detail: `Tool: ${name}${input.url ? ` — ${clip(input.url, 120)}` : ''}` };
  }
  // No JSON here either: the tool's name and, when it has one, its target.
  return { message: `AnchorTrails wants to run ${name}`, detail: target ? `Target: ${clip(target, 60)}` : `Tool: ${name}` };
}

// Skip the modal for what cannot hurt and is plainly part of the ask:
// reading state (Get-Process, where.exe, dir) and launching an app the
// user named. Everything that changes something -- a click on a control,
// typing, a browser action, any command that writes, deletes, installs,
// kills or reaches the network -- still asks. The user's words: "skip
// approval for app launches and no intrusive things, if related to their
// objective".
const READ_ONLY_VERBS = new Set([
  'get-process', 'get-startapps', 'get-command', 'get-childitem', 'get-item',
  'get-content', 'get-date', 'get-location', 'get-ciminstance', 'get-service',
  'get-nettcpconnection', 'get-volume', 'get-psdrive', 'get-itemproperty',
  'get-appxpackage', 'get-package', 'get-host', 'get-variable', 'test-path',
  'resolve-path', 'join-path', 'split-path', 'convertto-json', 'convertfrom-json',
  'select-object', 'where-object', 'sort-object', 'format-list', 'format-table',
  'measure-object', 'out-string', 'out-null', 'write-output', 'write-host',
  'select-string', 'foreach-object', 'start-sleep', 'sleep', 'where.exe', 'where',
  'dir', 'ls', 'type', 'cat', 'echo', 'hostname', 'whoami', 'tasklist', 'findstr',
  'grep', 'head', 'tail', 'pwd', 'ver', 'systeminfo', 'ps', 'which', 'find', 'wc',
  'uname', 'true', 'exit', 'return',
]);
// Flow-control keywords wrap the real verbs: "if (-not $p) { Start-Process ... }".
const CONTROL_VERBS = new Set(['if', 'else', 'elseif', 'try', 'catch', 'finally', 'foreach', 'for', 'while', 'do', 'switch', 'function', 'param', 'begin', 'process', 'end', '{', '}', '(', ')']);
const LAUNCH_VERBS = new Set(['start-process', 'start', 'open', 'xdg-open', 'explorer', 'explorer.exe', 'invoke-item']);
const LAUNCH_INSIDE = /\b(start-process|invoke-item|explorer(?:\.exe)?\s+shell:|shell:appsfolder)\b/i;
// Bare `format` and `sc` used to be in here and matched Format-Table and
// Select-Object's neighbours -- the verify command of the first hands-off
// run ("Get-Process | ... | Format-Table") got a modal for it. Word-boundary
// on a PowerShell verb hits the hyphen; name the dangerous forms instead.
const DENY_TOKENS = /(?:\b(?:remove-item|rm|rmdir|del|erase|stop-process|taskkill|kill|pkill|set-\w+|new-item|out-file|add-content|set-content|move-item|rename-item|copy-item|mv|cp|reg(?:\.exe)?|netsh|shutdown|restart-computer|invoke-webrequest|invoke-restmethod|iwr|irm|curl|wget|invoke-expression|iex|diskpart|schtasks|wmic|powercfg|msiexec|choco|winget|npm|pip|pip3|git|runas|install|uninstall|sudo|chmod|chown)\b|\bformat(?:\.com)?\s+[a-z]:|\bsc(?:\.exe)?\s+(?:stop|start|delete|config|create)\b|-verb\s+runas)/i;
const STOP_WORDS = new Set(['launch', 'open', 'start', 'run', 'the', 'app', 'desktop', 'application', 'please', 'and', 'then', 'with', 'for', 'this', 'that', 'from', 'into', 'bring', 'switch']);

function goalWords(goal) {
  return String(goal || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function relatedToGoal(text, goal) {
  const hay = String(text || '').toLowerCase();
  return goalWords(goal).some((w) => hay.includes(w));
}

function commandSegments(cmd) {
  return String(cmd || '').split(/\s*(?:;|&&|\|\||\||\r?\n)\s*/).map((s) => s.trim()).filter(Boolean);
}

function verbOf(segment) {
  const stripped = segment
    .replace(/^[({]+\s*/, '')
    .replace(/^\$[\w:]+\s*=\s*/, '')
    .replace(/^&\s*/, '')
    .replace(/^\.\s+/, '');
  const first = (stripped.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/) || []);
  return String(first[1] || first[2] || first[3] || '').toLowerCase().replace(/^.*[\\/]/, '');
}

// '' when the command may run without asking, else the reason it must ask
// -- shown in the modal, so a person can see what tripped it. The deny
// list is the safety line; a verb nobody recognises is the other one,
// unless that verb is the very thing the user asked to open (claude.exe).
function shellAskReason(command, goal) {
  const plain = plainCommand({ command });
  if (!plain) return 'empty command';
  if (/>|2>|\bout-file\b/i.test(plain)) return 'it writes to a file';
  const deny = plain.match(DENY_TOKENS);
  if (deny) return `it uses "${deny[0].trim()}"`;
  const segments = commandSegments(plain);
  if (!segments.length) return 'empty command';
  let launches = LAUNCH_INSIDE.test(plain);
  for (const seg of segments) {
    const verb = verbOf(seg);
    if (!verb || READ_ONLY_VERBS.has(verb) || CONTROL_VERBS.has(verb)) continue;
    if (/^[-$@'"(]/.test(verb)) continue; // an expression, an argument, a variable
    if (LAUNCH_VERBS.has(verb)) { launches = true; continue; }
    if (relatedToGoal(verb, goal)) { launches = true; continue; } // "& claude.exe"
    return `"${verb}" is not a read or a launch I recognise`;
  }
  if (launches && !relatedToGoal(plain, goal)) return 'it launches something you did not name';
  return '';
}

function shellAutoApprove(command, goal) {
  return shellAskReason(command, goal) === '';
}

const OPEN_INTENT = /\b(launch|open|start|switch to|bring up|focus|show)\b/i;

// The model reaches the wider floor through meta_invoke_tool; judge the
// tool it actually asked for, not the door.
function innerCall(call) {
  const name = String((call && call.name) || '');
  const input = (call && call.input) || {};
  if (name === 'meta_invoke_tool' && input && typeof input.name === 'string') {
    return { ...call, name: input.name, input: (input.arguments && typeof input.arguments === 'object') ? input.arguments : {} };
  }
  return { ...call, name, input };
}

const CHAT_INTENT = /\b(chat|ask|tell|send|prompt|message|talk|say)\b/i;
const IDE_WORDS = { claude_desktop: 'claude', claude: 'claude', cursor: 'cursor', codex: 'codex', windsurf: 'windsurf', vscode: 'vscode', antigravity: 'antigravity' };

function autoApprove(rawCall, goal) {
  const call = innerCall(rawCall);
  const name = String(call.name || '');
  const input = call.input || {};
  // Sending a chat message to the app the user asked to chat with is the
  // objective, not an intrusion. Form filling on a web page stays gated.
  if (/llm_prompt|ide_relay|ide_send_prompt/.test(name)) {
    const ide = String(input.ide_id || '').toLowerCase();
    const word = IDE_WORDS[ide] || ide.split('_')[0];
    return Boolean(word) && CHAT_INTENT.test(String(goal || '')) && String(goal || '').toLowerCase().includes(word);
  }
  if (name === 'desktop_run_command' || name === 'runInTerminal') {
    return shellAutoApprove(input.command, goal);
  }
  if (name === 'desktop_go' || name === 'desktop_look_click' || name === 'desktop_uia_invoke') {
    // A click by map index carries no label; the model's stated `task`
    // ("open Claude Desktop") is what ties it to the ask. Live: "chat with
    // Claude Desktop" stalled on a dialog for desktop_go {i: 6}.
    const target = [input.text, input.label, input.selector && input.selector.name, input.task]
      .filter(Boolean).join(' ');
    return Boolean(target) && OPEN_INTENT.test(String(goal || '')) && relatedToGoal(target, goal);
  }
  return false;
}

async function confirmWithUser(vscode, state, call) {
  if (state.approveAll) return true;
  if (autoApprove(call, state.goal)) return true;
  const win = vscode && vscode.window;
  if (!win || typeof win.showWarningMessage !== 'function') return false;
  const { message, detail } = approvalText({ ...call, goal: state.goal });
  const picked = await win.showWarningMessage(
    message,
    { modal: true, detail },
    APPROVE_ONE,
    APPROVE_TURN,
  );
  if (picked === APPROVE_TURN) state.approveAll = true;
  return picked === APPROVE_ONE || picked === APPROVE_TURN;
}

async function invokeTool(vscode, _request, call, token, state = {}) {
  const first = await invokeOnce(vscode, call.name, call.input, token);
  if (!approvalRequired(first)) return first;
  const ok = await confirmWithUser(vscode, state, call);
  if (!ok) {
    return JSON.stringify({
      denied: true,
      tool: call.name,
      hint: 'the user did not approve this action; do not retry it, say what was not done',
    });
  }
  return invokeOnce(vscode, call.name, { ...(call.input || {}), approve: true }, token);
}

// Real part classes when the host has them: the extension host converts
// message content with instanceof, so a plain object would be dropped.
function mkText(vscode, s) {
  return vscode && vscode.LanguageModelTextPart ? new vscode.LanguageModelTextPart(s) : { value: s };
}

function mkCall(vscode, c) {
  return vscode && vscode.LanguageModelToolCallPart
    ? new vscode.LanguageModelToolCallPart(c.callId, c.name, c.input)
    : { callId: c.callId, name: c.name, input: c.input };
}

function mkResult(vscode, callId, text) {
  return vscode && vscode.LanguageModelToolResultPart
    ? new vscode.LanguageModelToolResultPart(callId, [mkText(vscode, text)])
    : { callId, content: [{ value: text }] };
}

// One honest line per REAL call: name, clipped input, clipped result. This
// is the only ledger the chat prints now; the model cannot author it.
// One line, always: the summary sits inside *…* and markdown emphasis
// cannot span a newline, so a multi-line stdout printed literal asterisks.
function oneLine(s, n) {
  return clip(String(s == null ? '' : s).replace(/\s+/g, ' ').trim(), n);
}

function ledgerSummary(text) {
  try {
    const p = JSON.parse(text);
    if (p && typeof p === 'object') {
      if (p.denied) return 'not approved';
      if (p.approval_required) return 'waiting for approval';
      if (p.error) return `error: ${oneLine(String(p.error).split('\n')[0], RESULT_CLIP)}`;
      if (typeof p.count === 'number') return `${p.count} match${p.count === 1 ? '' : 'es'}`;
      if (typeof p.match_count === 'number') return `${p.match_count} match${p.match_count === 1 ? '' : 'es'}`;
      if (p.timed_out === true) return 'timed out';
      if (typeof p.exit_code === 'number') return `exit ${p.exit_code}${p.stdout ? `: ${oneLine(p.stdout, RESULT_CLIP)}` : ''}`;
      // runInTerminal: {ok, exit, stdout, stderr}. "failed" alone hid why
      // `claude` failed (it is the CLI, it waited for input, it timed out).
      if (typeof p.exit === 'number') {
        const tail = p.stdout || p.stderr;
        return `exit ${p.exit}${tail ? `: ${oneLine(tail, RESULT_CLIP)}` : ''}`;
      }
      if (p.ok === true) return 'ok';
      if (p.ok === false) return `failed${p.reason ? `: ${oneLine(p.reason, RESULT_CLIP)}` : ''}`;
    }
  } catch { /* not JSON */ }
  return oneLine(text, RESULT_CLIP);
}

function ledgerLine(call, text) {
  let args = '';
  try { args = JSON.stringify(call.input || {}); } catch { args = ''; }
  const shown = args === '{}' ? '' : ` ${clip(args, ARGS_CLIP)}`;
  return `\n\n*${call.name}${shown} → ${ledgerSummary(text)}*`;
}

async function runModelRound({
  client, vscode, turn, prompt, token, response, toolSession, catalog, request, approvals = {},
}) {
  const bound = toolSession
    ? toolSession.bind(vscode, client, turn.tools, catalog)
    : chatTools(turn.tools, catalog);
  if (token && token.isCancellationRequested) {
    return { cancelled: true };
  }
  if (!turn.model) {
    response.markdown('prepare returned no assign slug.');
    return { error: 'no-model' };
  }
  const selector = { vendor: VENDOR, id: turn.model };
  const models = (vscode.lm && typeof vscode.lm.selectChatModels === 'function')
    ? await vscode.lm.selectChatModels(selector)
    : [];
  const model = models && models[0];
  if (!model) {
    response.markdown(
      `No AnchorTrails model \`${turn.model}\`. Is the language-model provider registered?`,
    );
    return { error: 'no-provider' };
  }
  const messages = [...(turn.messages || [])];
  let wroteAny = false;
  let toolRounds = 0;
  const ledger = [];
  // One progress line for the whole round. A progress() per call made the
  // chat collapse each ledger line into its own "Finished with 1 step" group.
  if (response && typeof response.progress === 'function') {
    response.progress('complete…');
  }
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    if (token && token.isCancellationRequested) return { cancelled: true };
    const sent = await model.sendRequest(
      toVscodeMessages(vscode, messages),
      requestOptions(turn, bound),
      token,
    );
    const read = await readResponse(response, sent);
    wroteAny = wroteAny || read.wrote;
    if (!read.calls.length) break;
    if (round === MAX_TOOL_ROUNDS) {
      response.markdown(`\n\nStopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`);
      break;
    }
    toolRounds += 1;
    const assistantParts = [];
    if (read.text) assistantParts.push(mkText(vscode, read.text));
    for (const c of read.calls) assistantParts.push(mkCall(vscode, c));
    const resultParts = [];
    for (const call of read.calls) {
      if (token && token.isCancellationRequested) return { cancelled: true };
      const text = await invokeTool(vscode, request, call, token, approvals);
      response.markdown(ledgerLine(call, text));
      wroteAny = true;
      ledger.push({ tool: call.name, args: call.input || {}, ok: !callFailed(text) });
      resultParts.push(mkResult(vscode, call.callId, text));
    }
    messages.push({ role: 'assistant', content: assistantParts });
    messages.push({ role: 'user', content: resultParts });
  }
  if (!wroteAny) {
    response.markdown(await completeVisible(client, turn, prompt));
  }
  return { ok: true, toolRounds, ledger };
}

// A result the model would read as failure: the bridge's error shape, a
// denied approval, a non-zero shell exit, or a bare error string.
function callFailed(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object') {
      if (obj.denied || obj.error || obj.ok === false || obj.refused) return true;
      if (obj.exit_code != null && Number(obj.exit_code) !== 0) return true;
      if (obj.timed_out) return true;
      return false;
    }
  } catch { /* not JSON */ }
  return /^(error|denied|failed)\b/i.test(s);
}

// Bookkeeping calls are not steps of the procedure.
const NOT_A_STEP = /^(personal_autoflow_|personal_skill_|meta_(search|describe|list|capabilities))/;
const MAX_SAVED_STEPS = 8;

// "Can we train Dest itself?" -- the durable half: a computer task that
// ended with every real call succeeding is saved as an autoflow, so
// personal_autoflow_match (step 1 of the COMPUTER playbook) hands the
// model the exact tool sequence next time instead of a fresh discovery.
// Nothing is saved from a turn with a failed or denied call, a turn with
// no real steps, or one long enough to be a wander rather than a recipe.
function flowSteps(ledger) {
  const calls = (ledger || []).filter((e) => !NOT_A_STEP.test(String(e.tool || '')));
  if (!calls.length || calls.length > MAX_SAVED_STEPS) return null;
  if (!calls.every((e) => e.ok)) return null;
  return calls.map((e) => ({ tool: e.tool, args: e.args || {} }));
}

async function autoSaveFlow({ client, goal, ledger, response }) {
  if (!client || typeof client.invoke !== 'function') return null;
  const steps = flowSteps(ledger);
  if (!steps) return null;
  try {
    const out = await client.invoke('personal_autoflow_record', {
      goal: String(goal || '').replace(/^(?:@at\s+)+/i, '').trim().slice(0, 300),
      steps,
      eval: { source: 'dest-chat', calls: steps.length },
    }, { autoApprove: true });
    // The bridge envelope is {ok, data:{saved:{id,...}}}. A 500 with an
    // empty body comes back from client.invoke as {} -- not a save.
    if (!out || out.ok === false || out.error) return null;
    const data = (out && out.data) || {};
    const saved = data.saved && typeof data.saved === 'object' ? data.saved : null;
    if (!saved) return null;
    const id = saved.id ? ` ${saved.id}` : '';
    if (response && typeof response.markdown === 'function') {
      response.markdown(`\n\n*learned: ${steps.length} step${steps.length === 1 ? '' : 's'} saved for "${clip(String(goal || '').replace(/^(?:@at\s+)+/i, '').trim(), 60)}"${id}*`);
    }
    return steps;
  } catch {
    return null; // learning is a bonus; the task already succeeded
  }
}

async function closeRound({ client, vscode, sessionId, kind, drivePlan, onPlan }) {
  if (kind === 'computer') {
    const next = advanceLocal(drivePlan, { ok: true, errors: 0 });
    if (typeof onPlan === 'function' && next) {
      try { onPlan({ ...next, turn: next }); } catch { /* Plan panel is optional */ }
    }
    return { check: { ok: true, errors: 0, can_green: true }, plan: next };
  }
  const check = destCheck(vscode);
  let next = drivePlan;
  if (kind === 'session' && client && typeof client.refreshPlan === 'function') {
    try {
      const out = await client.refreshPlan({
        session_id: sessionId,
        check,
        advance: canGreen(check),
      });
      if (out && out.plan) next = out.plan;
    } catch {
      next = advanceLocal(drivePlan, check);
    }
  } else {
    next = advanceLocal(drivePlan, check);
  }
  if (typeof onPlan === 'function' && next) {
    try { onPlan(kind === 'turn' ? { ...next, turn: next } : next); } catch { /* Plan panel is optional */ }
  }
  return { check, plan: next };
}

async function handleTurn({
  client, vscode, request, context, response, token, workspace, sessionId, toolSession, onPlan,
}) {
  sessionId = sessionId || workspaceSession(vscode);
  const tag = planTag(request);
  const attachments = collectAttachments(request);
  if (response && typeof response.progress === 'function') {
    response.progress(tag && tag.kind === 'refresh' ? 'plan refresh…'
      : tag && tag.kind === 'map' ? 're-map…'
        : tag && tag.kind === 'run' ? 'run…' : tag && tag.kind === 'ship' ? 'ship…' : 'assign…');
  }
  try {
    if (tag && (tag.kind === 'map' || tag.kind === 'run' || tag.kind === 'ship')) {
      // The map and the run: the bridge does the work, the chat reports it, the panel
      // shows it. No model turn -- the person asked for an action, not an answer.
      const { mapActionMarkdown, mapArgs } = require('./slash');
      const repo = folderPath(vscode) || '';
      let out;
      let kind = tag.kind;
      if (tag.kind === 'map') {
        const args = mapArgs(tag.rest);
        if (args.action === 'plan') {
          kind = 'plan';
          out = client && typeof client.mapPlan === 'function'
            ? await client.mapPlan({ repo, objective: args.objective })
            : { ok: false, reason: 'no bridge' };
        } else {
          out = client && typeof client.mapRefresh === 'function'
            ? await client.mapRefresh({ repo, subtree: args.subtree, force: args.force })
            : { ok: false, reason: 'no bridge' };
        }
      } else if (tag.kind === 'ship') {
        out = client && typeof client.mapShip === 'function'
          ? await client.mapShip({ repo, prod: /^prod(uction)?\b/i.test(tag.rest) })
          : { ok: false, reason: 'no bridge' };
      } else if (/^status\b/i.test(tag.rest)) {
        kind = 'status';
        out = { map: client && typeof client.map === 'function' ? await client.map({ repo }) : null };
      } else {
        out = client && typeof client.mapApply === 'function' ? await client.mapApply({ repo }) : { ok: false, reason: 'no bridge' };
      }
      response.markdown(mapActionMarkdown(kind, out));
      return { metadata: { slash: kind, session_id: sessionId } };
    }
    if (tag && !tag.rest) {
      let planOut = { plan: {} };
      try {
        if (tag.kind === 'refresh' && client && typeof client.refreshPlan === 'function') {
          planOut = await client.refreshPlan({ session_id: sessionId });
        } else if (client && typeof client.sessionPlan === 'function') {
          planOut = await client.sessionPlan({ session_id: sessionId });
        }
      } catch { /* still return the card, never leftover BUILD */ }
      if (planOut && planOut.plan && typeof onPlan === 'function') {
        try { onPlan(planOut.plan); } catch { /* Plan panel is optional */ }
      }
      response.markdown(planMarkdown((planOut && planOut.plan) || {}));
      return {
        metadata: {
          slash: tag.kind,
          plan: (planOut && planOut.plan) || {},
          session_id: sessionId || (planOut && planOut.session_id),
        },
      };
    }
    const userLine = tag && tag.rest
      ? `where are we on the plan: ${tag.rest}`
      : ((request && request.prompt) || '');
    let ahead = userLine;
    let catalog = null;
    if (client && typeof client.catalog === 'function') {
      try { catalog = await client.catalog(); } catch { catalog = null; }
    }
    let lastTurn = null;
    let kind = null;
    let drivePlan = null;
    let lastCursor = null;
    let stuck = 0;
    let rounds = 0;
    let done = false;
    // "Approve all this turn" means the whole @at turn, outer rounds included.
    // The goal is what "related to their objective" is judged against.
    const approvals = { goal: userLine };
    for (let i = 0; i < MAX_ROUNDS; i += 1) {
      if (token && token.isCancellationRequested) {
        return resultMeta(lastTurn || { session_id: sessionId }, { error: 'cancelled' });
      }
      const prepared = await client.prepare({
        ahead,
        session_id: sessionId || workspaceSession(vscode),
        workspace: workspacePath(vscode, workspace),
        attachments,
        payload_tokens: payloadTokensFor(attachments),
      });
      if (i === 0) {
        kind = driveKind(userLine, prepared);
      }
      if (typeof onPlan === 'function' && prepared && prepared.plan) {
        try { onPlan({ ...prepared.plan, turn: prepared.turn }); } catch { /* Plan panel is optional */ }
      }
      if (prepared && prepared.turn && response && typeof response.progress === 'function') {
        response.progress(friendlyProgress(prepared.turn));
      }
      const turn = buildTurn(prepared, ahead, context && context.history);
      lastTurn = turn;
      const ran = await runModelRound({
        client, vscode, turn, prompt: ahead, token, response, toolSession, catalog, request, approvals,
      });
      if (ran.cancelled) return resultMeta(turn, { error: 'cancelled' });
      if (ran.error) return resultMeta(turn, { error: ran.error });
      rounds += 1;
      if (!kind) break;
      if (kind === 'computer' && ran.toolRounds > 0) {
        drivePlan = finishPlan((prepared && prepared.turn) || drivePlan);
        if (typeof onPlan === 'function') {
          try { onPlan({ ...drivePlan, turn: drivePlan }); } catch { /* Plan panel is optional */ }
        }
        done = true;
        await autoSaveFlow({ client, goal: userLine, ledger: ran.ledger, response });
        break;
      }
      drivePlan = kind === 'session'
        ? ((prepared && prepared.plan) || drivePlan)
        : ((prepared && prepared.turn) || drivePlan);
      const closed = await closeRound({
        client, vscode, sessionId: turn.session_id || sessionId, kind, drivePlan, onPlan,
      });
      drivePlan = closed.plan;
      done = isDone(drivePlan);
      if (done) {
        response.markdown(doneMarkdown(drivePlan));
        break;
      }
      const cursor = (drivePlan && drivePlan.cursor) || '';
      if (!canGreen(closed.check) || (cursor && cursor === lastCursor)) {
        stuck += 1;
        if (stuck >= STUCK_LIMIT) {
          response.markdown(stuckMarkdown(drivePlan));
          break;
        }
      } else {
        stuck = 0;
      }
      lastCursor = cursor;
      ahead = nextAhead(drivePlan);
    }
    return resultMeta(lastTurn, { drive: { kind, rounds, done, cursor: drivePlan && drivePlan.cursor } });
  } catch (err) {
    if (token && token.isCancellationRequested) {
      return { metadata: { error: 'cancelled' } };
    }
    if (err instanceof BridgeAuthError) {
      response.markdown(
        'AnchorTrails bridge rejected the token (401). Set `anchortrails.bridgeToken` or `~/.anchortrails/bridge_token`.',
      );
      return { metadata: { error: 'auth' } };
    }
    if (err instanceof BridgeEntitlementError) {
      response.markdown('Credits or entitlement refused (402). That is the only product gate.');
      return { metadata: { error: 'entitlement' } };
    }
    // An error that is not an Error still has a shape; "[object Object]" tells nobody
    // anything. Say what came back.
    const shape = err && typeof err === 'object' && !err.message
      ? (() => { try { return JSON.stringify(err).slice(0, 600); } catch { return String(err); } })()
      : String((err && (err.message || err.stack)) || err);
    response.markdown(`AnchorTrails could not finish that turn: ${shape}`);
    return { metadata: { error: 'bridge' } };
  }
}

function createHandler(client, vscode, extras = {}) {
  const state = {
    sessionId: extras.sessionId,
    tools: extras.toolSession || new ToolSession(),
  };
  // Register the always-on tools now, not on the first @at turn: Copilot's
  // Agent-mode harness in this fork drives the same provider and picks
  // tools from lm.tools, so AT's look/map/go/find and the terminal should
  // be there before anyone types @at.
  if (extras.bindAtStart !== false) {
    try { state.tools.bind(vscode, client, [], null); } catch { /* host without lm */ }
  }
  const handler = async (request, context, response, token) => {
    const result = await handleTurn({
      client,
      vscode,
      request,
      context,
      response,
      token,
      workspace: extras.workspace,
      sessionId: state.sessionId,
      toolSession: state.tools,
      onPlan: extras.onPlan,
    });
    const sid = result && result.metadata && result.metadata.session_id;
    if (sid) state.sessionId = sid;
    return result;
  };
  handler.dispose = () => state.tools.dispose();
  return handler;
}

module.exports = {
  PARTICIPANT_ID,
  PARTICIPANT_NAME,
  VENDOR,
  planTag,
  planMarkdown,
  pickSlug,
  mapHistoryTurn,
  buildTurn,
  toVscodeMessages,
  requestOptions,
  handleTurn,
  createHandler,
  capHistory,
  visibleComplete,
  streamText,
  collectAttachments,
  payloadTokensFor,
  PLAN_HISTORY,
  friendlyProgress,
  MAX_TOOL_ROUNDS,
  readResponse,
  isToolCallPart,
  ledgerLine,
  invokeTool,
  approvalText,
  plainCommand,
  describeCommand,
  callFailed,
  flowSteps,
  autoApprove,
  shellAutoApprove,
  shellAskReason,
  innerCall,
  APPROVE_ONE,
  APPROVE_TURN,
};
