'use strict';
/**
 * A map / plan / run / ship started from the chat keeps talking while it works.
 *
 * Before this the chat said "Run started ..." and went quiet for forty minutes
 * while the runner wrote eight files; the person had to open the AT Panel to know
 * anything happened. Now the turn polls the bridge's map view and writes one line
 * per event -- a stage landing, a task written, closed or failed with its cost, a
 * ship step -- until the job's own flag goes down. Nothing is invented: every line
 * is a difference between two answers of the same read-only endpoint.
 */

const DEFAULT_POLL_MS = 4000;
const DEFAULT_MAX_MS = 90 * 60 * 1000;

const JOB_FLAG = { map: 'mapping', plan: 'planning', run: 'running', ship: 'shipping' };

function shortTask(id) {
  return String(id || '').replace(/^t\./, '');
}

function money(n) {
  const v = Number(n || 0);
  return v ? `$${v.toFixed(v < 0.1 ? 4 : 2)}` : '';
}

// The events between two map answers, as markdown lines. Pure: no clock, no I/O.
function diffEvents(prev, next, kind) {
  const p = prev || {}; const n = next || {};
  const out = [];
  const pm = (p.overview && p.overview.meta) || {}; const nm = (n.overview && n.overview.meta) || {};
  if (kind === 'map') {
    if (nm.stage && nm.stage !== pm.stage) out.push(`- stage: ${nm.stage}${nm.stages_total ? ` (${nm.stages_done || 0}/${nm.stages_total})` : ''}`);
    if (nm.files_analysed != null && nm.files_analysed !== pm.files_analysed) out.push(`- ${Number(nm.files_analysed).toLocaleString()}${nm.files_total_repo ? ` of ${Number(nm.files_total_repo).toLocaleString()}` : ''} files read`);
    if (nm.status === 'complete' && pm.status !== 'complete') out.push(`- map complete: ${Number(nm.findings_actionable || 0)} actionable of ${Number(nm.findings_total || 0)} findings`);
  }
  if (kind === 'plan' || kind === 'run') {
    const pt = ((p.plan || {}).tasks || []).length; const nt = ((n.plan || {}).tasks || []).length;
    if (n.plan && (!p.plan || nt !== pt)) out.push(`- plan: ${nt} task${nt === 1 ? '' : 's'}${(n.plan.tasks || []).slice(0, 3).map((t) => ` · ${shortTask(t.id)}`).join('')}${nt > 3 ? ' · …' : ''}`);
  }
  if (kind === 'run' || kind === 'ship') {
    const pp = p.progress || {}; const np = n.progress || {};
    if (np.task && (np.task !== pp.task || np.attempt !== pp.attempt || np.phase !== pp.phase)) {
      out.push(`- ${shortTask(np.task)} · attempt ${np.attempt || 1} · ${np.phase || 'working'}${np.model ? ` · ${np.model}` : ''}`);
    }
    const seen = new Set(((p.run || {}).results || []).map((r) => `${r.task}|${r.outcome}|${r.attempts}`));
    for (const r of (n.run || {}).results || []) {
      const key = `${r.task}|${r.outcome}|${r.attempts}`;
      if (seen.has(key)) continue;
      const mark = /closed/.test(String(r.outcome || '')) ? '✓' : /fail|reject/.test(String(r.outcome || '')) ? '✗' : /skip/.test(String(r.outcome || '')) ? '⊘' : '·';
      const cost = money(r.cost_usd != null ? r.cost_usd : r.cost);
      out.push(`- ${mark} ${shortTask(r.task)} — ${r.outcome || 'done'}${r.attempts ? ` after ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : ''}${cost ? ` · ${cost}` : ''}${r.why ? `: ${String(r.why).slice(0, 120)}` : ''}`);
    }
    const ps = p.ship || {}; const ns = n.ship || {};
    if (ns.status && (ns.status !== ps.status || ns.summary !== ps.summary)) {
      out.push(`- ship: ${ns.status}${ns.summary ? ` — ${ns.summary}` : ''}${ns.deploy_url ? ` — ${ns.deploy_url}` : ''}${ns.branch ? ` (branch ${ns.branch})` : ''}`);
    }
    const nr = n.run || {}; const pr = p.run || {};
    if (nr.status && nr.status !== 'running' && (pr.status === 'running' || !pr.status) && nr.results) {
      out.push(`- run ${nr.status}: ${nr.closed != null ? `${nr.closed} closed` : ''}${nr.failed ? ` · ${nr.failed} failed` : ''}${nr.skipped ? ` · ${nr.skipped} skipped` : ''}${money(nr.cost_usd) ? ` · ${money(nr.cost_usd)}` : ''}`);
    }
  }
  return out;
}

function jobAlive(map, kind) {
  const m = map || {};
  if (kind === 'run') return Boolean(m.running || m.shipping);
  return Boolean(m[JOB_FLAG[kind]]);
}

async function streamJob({ client, repo, kind, response, token, pollMs = Number(process.env.AT_JOB_POLL_MS) || DEFAULT_POLL_MS, maxMs = DEFAULT_MAX_MS, sleep, now }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = now || (() => Date.now());
  if (!client || typeof client.map !== 'function' || !response) return { lines: 0, ended: 'no-client' };
  const t0 = clock();
  let prev = null;
  let lines = 0;
  let started = false;
  let idle = 0;
  let said = '';
  let baselined = false;
  for (;;) {
    if (token && token.isCancellationRequested) return { lines, ended: 'cancelled' };
    let map;
    try { map = await client.map({ repo }); } catch { map = null; }
    if (map) {
      // THE FIRST READ IS A BASELINE, NOT NEWS. run.json and ship.json still hold
      // the PREVIOUS run when a new one starts, so diffing them against nothing
      // replayed all of it: a fresh /run printed the last run's eight closes and
      // its "run complete · $0.60" before this run had done anything. What was
      // already on disk when we arrived is history; only what moves after is an
      // event. The map's own stage still reports from the first read, because
      // that is this job's work and nobody else's.
      if (!baselined) {
        baselined = true;
        prev = { run: map.run, ship: map.ship };
      }
      const events = diffEvents(prev, map, kind);
      for (const line of events) { response.markdown(`\n${line}`); lines += 1; }
      // ONE LINE PER STATE, NOT PER POLL. progress() appends in the chat, so a
      // four-second poll wrote "run…" (or the same task and phase) over and over
      // -- the "series of run…" the user saw. Only a changed state speaks.
      if (typeof response.progress === 'function') {
        const pr = map.progress;
        const now = kind === 'run' && pr && pr.task ? `${shortTask(pr.task)} · ${pr.phase || 'working'}` : `${kind}…`;
        if (now !== said) { response.progress(now); said = now; }
      }
      const alive = jobAlive(map, kind);
      if (alive) { started = true; idle = 0; } else if (started || idle >= 2) {
        // The job's flag is down and we saw it up (or never came up after two
        // reads): it is over. One last diff already ran above.
        return { lines, ended: 'done' };
      } else {
        idle += 1;
      }
      prev = map;
    }
    if (clock() - t0 > maxMs) { response.markdown('\n- still running; `/run status` for the totals'); return { lines, ended: 'timeout' }; }
    await wait(pollMs);
  }
}

module.exports = { streamJob, diffEvents, jobAlive, shortTask, DEFAULT_POLL_MS };
