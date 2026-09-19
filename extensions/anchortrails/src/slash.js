'use strict';
/**
 * Dest chat tags — /plan asks about the card; /plan refresh rescores
 * done vs planned against the final objective. Not a full MUWT replay.
 */

const REFRESH_LINE = /^(refresh|\/refresh|refresh the plan|update the plan|rescore(?: the plan)?)$/i;

function planTag(request) {
  const cmd = String((request && request.command && request.command.name) || '')
    .toLowerCase();
  const raw = String((request && request.prompt) || '');
  // THE MAP AND THE RUN ARE CHAT COMMANDS. /map re-runs the mapper; /run runs the
  // plan beside the map; /run status reads the run back. The panel's buttons put
  // exactly these into the chat -- every action is something the person said.
  if (cmd === 'map' || /^\/map\b/i.test(raw)) {
    return { kind: 'map', rest: raw.replace(/^\/map\b/i, '').trim() };
  }
  if (cmd === 'run' || /^\/run\b/i.test(raw)) {
    return { kind: 'run', rest: raw.replace(/^\/run\b/i, '').trim() };
  }
  if (
    cmd === 'refresh'
    || /^\/plan\s+refresh\b/i.test(raw)
    || REFRESH_LINE.test(raw.trim())
    || (cmd === 'plan' && /^\s*refresh\b/i.test(raw))
  ) {
    const rest = raw
      .replace(/^\/plan\s+refresh\b/i, '')
      .replace(/^\s*(refresh|update|rescore)(\s+the\s+plan)?\b/i, '')
      .trim();
    return { kind: 'refresh', rest };
  }
  if (cmd === 'plan' || /^\/plan\b/i.test(raw)) {
    return { kind: 'ask', rest: raw.replace(/^\/plan\b/i, '').trim() };
  }
  return null;
}

// What the chat says back for /map and /run. Refusals are the bridge's own words
// ("a plan run is already running (pid 7)"), not a generic failure.
function mapActionMarkdown(kind, out) {
  const o = out || {};
  if (kind === 'map') {
    return o.ok
      ? 'Re-map started. The Map in the AT Panel shows each stage as it lands and goes `complete` when done.'
      : `Re-map not started: ${o.reason || 'no bridge'}`;
  }
  if (kind === 'status') {
    const { runSummary, runMark } = require('./plan');
    const run = o.map && o.map.run;
    if (!run || !Array.isArray(run.results)) return 'No run yet. `/run` starts one on the plan beside the map.';
    const lines = run.results.map((r) => {
      const m = runMark(r);
      return `- ${m.mark || '·'} ${String(r.task || '').replace(/^t\./, '')} — ${m.label || r.outcome}${m.why ? `: ${m.why}` : ''}`;
    });
    const head = `**${run.status === 'running' ? 'Running' : 'Run'}** · ${runSummary(run) || `${run.results.length} task(s)`}`;
    return [head, ...lines].join('\n');
  }
  return o.ok
    ? 'Run started. Each task shows on its finding in the AT Panel as it closes or fails; `/run status` for the totals.'
    : `Run not started: ${o.reason || 'no bridge'}`;
}

function planMarkdown(plan) {
  const { stackLines } = require('./plan');
  const stack = stackLines((plan && plan.stack) || {});
  if (!plan || !(plan.goal || plan.cursor || plan.steps)) {
    return `No plan yet. A real task in @at starts one.\n\n**Stack**\n${stack}`;
  }
  const steps = String(plan.steps || '')
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n');
  const head = `**Plan ${plan.cursor || ''}** — ${plan.playbook || 'task'}`;
  const doLine = plan.do ? `\n\n_${plan.do}_` : '';
  return `${head}\n\n${plan.goal || ''}\n\n${steps}${doLine}\n\n**Stack**\n${stack}`.trim();
}

module.exports = {
  mapActionMarkdown, planTag, planMarkdown, REFRESH_LINE };
