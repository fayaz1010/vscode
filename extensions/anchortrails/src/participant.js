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

async function invokeOnce(vscode, request, name, input, token) {
  const lm = vscode && vscode.lm;
  if (!lm || typeof lm.invokeTool !== 'function') {
    return JSON.stringify({ error: `tool ${name} is not invokable in this host` });
  }
  try {
    const result = await lm.invokeTool(name, {
      input,
      toolInvocationToken: request && request.toolInvocationToken,
    }, token);
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
async function confirmWithUser(vscode, state, call) {
  if (state.approveAll) return true;
  const win = vscode && vscode.window;
  if (!win || typeof win.showWarningMessage !== 'function') return false;
  let args = '';
  try { args = JSON.stringify(call.input || {}); } catch { args = ''; }
  const picked = await win.showWarningMessage(
    `AnchorTrails wants to run ${call.name}`,
    { modal: true, detail: clip(args, 400) },
    APPROVE_ONE,
    APPROVE_TURN,
  );
  if (picked === APPROVE_TURN) state.approveAll = true;
  return picked === APPROVE_ONE || picked === APPROVE_TURN;
}

async function invokeTool(vscode, request, call, token, state = {}) {
  const first = await invokeOnce(vscode, request, call.name, call.input, token);
  if (!approvalRequired(first)) return first;
  const ok = await confirmWithUser(vscode, state, call);
  if (!ok) {
    return JSON.stringify({
      denied: true,
      tool: call.name,
      hint: 'the user did not approve this action; do not retry it, say what was not done',
    });
  }
  return invokeOnce(vscode, request, call.name, { ...(call.input || {}), approve: true }, token);
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
  client, vscode, turn, prompt, token, response, toolSession, catalog, request,
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
  const approvals = {};
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
      resultParts.push(mkResult(vscode, call.callId, text));
    }
    messages.push({ role: 'assistant', content: assistantParts });
    messages.push({ role: 'user', content: resultParts });
  }
  if (!wroteAny) {
    response.markdown(await completeVisible(client, turn, prompt));
  }
  return { ok: true, toolRounds };
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
        client, vscode, turn, prompt: ahead, token, response, toolSession, catalog, request,
      });
      if (ran.cancelled) return resultMeta(turn, { error: 'cancelled' });
      if (ran.error) return resultMeta(turn, { error: ran.error });
      rounds += 1;
      if (!kind) break;
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
  APPROVE_ONE,
  APPROVE_TURN,
};
