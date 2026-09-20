'use strict';
/**
 * Dest chat tags — /plan asks about the card; /plan refresh rescores
 * done vs planned against the final objective. Not a full MUWT replay.
 */

const REFRESH_LINE = /^(refresh|\/refresh|refresh the plan|update the plan|rescore(?: the plan)?)$/i;

function commandName(request) {
  // The API hands the slash command over as a string (`request.command === 'map'`);
  // older test doubles used { name }. Read both -- the string form is what runs, and
  // it was read as nothing, which sent every registered command down the model path.
  const c = request && request.command;
  return String(typeof c === 'string' ? c : (c && c.name) || '').toLowerCase();
}

function planTag(request) {
  const cmd = commandName(request);
  // A prompt that still carries the participant mention -- "@at /map" typed into a
  // box that already had @at, or relayed from another IDE -- is the same sentence.
  const raw = String((request && request.prompt) || '').replace(/^(\s*@at\b\s*)+/i, '');
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
    if (o.ok && o.current) return `The map is current (${String(o.head || '').slice(0, 8)}). \`/map force\` rebuilds it anyway.`;
    return o.ok
      ? `Re-map started (${o.focus || 'whole repository'}). The Map in the AT Panel shows each stage as it lands and goes \`complete\` when done.`
      : `Re-map not started: ${o.reason || 'no bridge'}`;
  }
  if (kind === 'plan') {
    if (o.needs_objective) return `${o.reason || 'No objective yet.'}\n\nTell me what the plan is for: \`/map plan <objective>\` — one sentence, the way you would brief a person.`;
    if (o.needs_map) return `${o.reason || 'No map yet.'}`;
    return o.ok
      ? `Planning for: **${o.objective || ''}**. The plan appears beside the Map in the AT Panel when it lands; \`/run\` then runs it.`
      : `Plan not started: ${o.reason || 'no bridge'}`;
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
  if (o.needs_plan) return `${o.reason || 'No plan yet.'}`;
  return o.ok
    ? 'Run started. If the map is behind the tree it re-maps and re-plans first, from the stored objective. Each task shows on its finding in the AT Panel as it closes or fails; `/run status` for the totals.'
    : `Run not started: ${o.reason || 'no bridge'}`;
}

// What /map's words mean: nothing -> map (or say it is current); `force` -> rebuild;
// `plan ...` -> plan for that objective (or the stored one); anything else -> map that
// subtree, and remember it as the focus for this project.
function mapArgs(rest) {
  const r = String(rest || '').trim();
  if (!r) return { action: 'refresh' };
  if (/^force$/i.test(r)) return { action: 'refresh', force: true };
  const m = /^plan\b\s*(.*)$/is.exec(r);
  if (m) return { action: 'plan', objective: m[1].trim() };
  return { action: 'refresh', subtree: r };
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
  mapActionMarkdown, mapArgs, planTag, planMarkdown, REFRESH_LINE };
