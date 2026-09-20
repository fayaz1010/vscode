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

async function runModelRound({
  client, vscode, turn, prompt, token, response, toolSession, catalog,
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
  if (response && typeof response.progress === 'function') {
    response.progress('complete…');
  }
  const sent = await model.sendRequest(
    toVscodeMessages(vscode, turn.messages),
    requestOptions(turn, bound),
    token,
  );
  const wrote = await streamText(response, sent);
  if (!wrote) {
    response.markdown(await completeVisible(client, turn, prompt));
  }
  return { ok: true };
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
        : tag && tag.kind === 'run' ? 'run…' : 'assign…');
  }
  try {
    if (tag && (tag.kind === 'map' || tag.kind === 'run')) {
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
        response.progress(prepared.turn.do || 'turn…');
      }
      const turn = buildTurn(prepared, ahead, context && context.history);
      lastTurn = turn;
      const ran = await runModelRound({
        client, vscode, turn, prompt: ahead, token, response, toolSession, catalog,
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
    response.markdown(String((err && err.message) || err));
    return { metadata: { error: 'bridge' } };
  }
}

function createHandler(client, vscode, extras = {}) {
  const state = {
    sessionId: extras.sessionId,
    tools: extras.toolSession || new ToolSession(),
  };
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
};
