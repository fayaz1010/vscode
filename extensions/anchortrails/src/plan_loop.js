'use strict';
/**
 * One prompt drives dest through the development plan until the
 * initial or inherited objective is met and verified. Greening
 * still requires checkErrors=0. /plan, greet, and stop stay one-shot.
 */

const { markOf, stampMark } = require('./plan');
const { canGreen, collectDiagnostics, planMark } = require('./check');

const MAX_ROUNDS = 12;
const STUCK_LIMIT = 2;

const STOP = /^(stop|cancel|nevermind|never mind|leave it)$/i;
const WANT = /\b(implement|continue|finish|complete the plan|do the plan|build |ship |launch plan|inherited|objective|until done|see it through)\b/i;
const REFRESH = /^(refresh|\/refresh|refresh the plan|update the plan|rescore(?: the plan)?|\/plan\s+refresh)$/i;

function parseSteps(steps) {
  return String(steps || '').split(' | ').map((s) => s.trim()).filter(Boolean);
}

function isDone(plan) {
  const parts = parseSteps(plan && plan.steps);
  return parts.length > 0 && parts.every((s) => markOf(s) === 'done');
}

function isOpen(plan) {
  return parseSteps(plan && plan.steps).some((s) => markOf(s) !== 'done');
}

function currentStep(plan) {
  const parts = parseSteps(plan && plan.steps);
  return parts.find((s) => markOf(s) === 'now')
    || parts.find((s) => markOf(s) === 'error')
    || '';
}

function cursorOf(parts) {
  const now = parts.findIndex((s) => markOf(s) !== 'done');
  return `${now < 0 ? parts.length : now + 1}/${parts.length}`;
}

function advanceLocal(plan, check) {
  const parts = parseSteps(plan && plan.steps);
  if (!parts.length) return plan || {};
  let i = parts.findIndex((s) => markOf(s) === 'now');
  if (i < 0) i = parts.findIndex((s) => markOf(s) === 'error');
  if (i < 0) return { ...plan };
  if (canGreen(check)) {
    parts[i] = stampMark(parts[i], '[x]');
    const next = parts.findIndex((s) => {
      const mark = markOf(s);
      return mark === 'todo' || mark === 'error';
    });
    if (next >= 0) parts[next] = stampMark(parts[next], '[>]');
  } else if (check) {
    parts[i] = stampMark(parts[i], '[!]');
  }
  return { ...plan, steps: parts.join(' | '), cursor: cursorOf(parts) };
}

// A computer-use task now completes inside ONE model round (the tool loop
// looks, acts, verifies, answers). Marching the outer per-step rounds after
// that re-prompted "Continue..." to a model that had already reported the
// app open, and it started over -- live: a second pass ran `runInTerminal
// claude` (the CLI, not the app) and three malformed finds.
function finishPlan(plan) {
  const parts = parseSteps(plan && plan.steps).map((s) => stampMark(s, '[x]'));
  if (!parts.length) return { ...(plan || {}) };
  return { ...plan, steps: parts.join(' | '), cursor: `${parts.length}/${parts.length}` };
}

function wantsObjective(prompt) {
  return WANT.test(String(prompt || ''));
}

function isQuietPrompt(prompt) {
  const t = String(prompt || '').trim().replace(/[!.?]+$/g, '');
  if (!t) return true;
  if (STOP.test(t)) return true;
  return /^(hi|hello|hey|yo|sup|howdy|hola|ok|thanks)$/i.test(t);
}

function isRefreshPrompt(prompt) {
  return REFRESH.test(String(prompt || '').trim());
}

function isComputer(prepared) {
  const cls = String((prepared && prepared.task_class) || '');
  const turnPlay = String((prepared && prepared.turn && prepared.turn.playbook) || '');
  return cls === 'computer' || turnPlay === 'computer' || turnPlay === 'forms';
}

function driveKind(prompt, prepared) {
  if (isQuietPrompt(prompt) || isRefreshPrompt(prompt)) return null;
  const turn = prepared && prepared.turn;
  if (turn && (turn.playbook === 'status' || turn.playbook === 'stop')) return null;
  if (isComputer(prepared) && isOpen(turn)) {
    return 'computer';
  }
  const implement = prepared && (
    prepared.task_class === 'implement' || prepared.task_class === 'develop'
  );
  if (isOpen(prepared && prepared.plan) && (wantsObjective(prompt) || implement)) {
    return 'session';
  }
  if (
    turn
    && turn.playbook === 'turn'
    && isOpen(turn)
    && (implement || (prepared && prepared.tools_required))
  ) {
    return 'turn';
  }
  return null;
}

function nextAhead(plan) {
  const goal = (plan && plan.goal) || 'the inherited objective';
  const step = currentStep(plan) || (plan && plan.cursor) || 'the next step';
  const computer = (plan && (plan.playbook === 'computer' || plan.playbook === 'forms'));
  if (computer) {
    return (
      'Continue this computer-use task until it is done on screen. '
      + `Goal: ${goal}. Do only: ${step}. `
      + 'Replay a skill if known, else look then act then look again. '
      + 'Do not start leftover BUILD. Submit stays gated. Do not wait.'
    );
  }
  return (
    'Continue the plan until the objective is met and verified. '
    + `Goal: ${goal}. Do only: ${step}. Verify with checkErrors. `
    + 'Do not wait for another prompt.'
  );
}

function destCheck(vscode) {
  const check = collectDiagnostics(vscode, null);
  check.mark = planMark(check);
  check.can_green = canGreen(check);
  return check;
}

function doneMarkdown(plan) {
  const cursor = (plan && plan.cursor) || '';
  const goal = (plan && plan.goal) || 'the objective';
  return `\n\n**Objective met** (${cursor}). ${goal}`;
}

function stuckMarkdown(plan) {
  const step = currentStep(plan) || (plan && plan.cursor) || 'this step';
  return `\n\nStopped on ${step} — verify still failing. Fix it or say continue.`;
}

module.exports = {
  MAX_ROUNDS,
  STUCK_LIMIT,
  parseSteps,
  isDone,
  isOpen,
  currentStep,
  advanceLocal,
  finishPlan,
  wantsObjective,
  isQuietPrompt,
  isRefreshPrompt,
  isComputer,
  driveKind,
  nextAhead,
  destCheck,
  doneMarkdown,
  stuckMarkdown,
};
