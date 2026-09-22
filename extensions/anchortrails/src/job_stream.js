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

// ONE LIVE LINE, NOT A LINE PER POLL.
//
// `response.progress(text)` APPENDS in the chat, so saying the same thing every
// four seconds printed it four times over. The chat has a better shape for this:
// `progress(text, task)` pushes a `progressTask`, which the UI renders with a
// spinner for as long as the task's thenable is pending and marks complete when
// it settles. So each state gets exactly one line that visibly spins while Dest
// is on it, and finishes when Dest moves on.
//
// A host that only knows the one-argument form ignores the second and gets the
// old behaviour -- one deduped line per state, which is still not a repeat.
function speaker(response) {
  let pending = null;
  const settle = (text) => {
    if (!pending) return;
    const done = pending.done;
    pending = null;
    try { done(text); } catch { /* the turn may already be finished */ }
  };
  return {
    say(text) {
      if (pending && pending.text === text) return;   // already spinning on this
      settle();
      if (!text || typeof response.progress !== 'function') return;
      let done;
      const until = new Promise((resolve) => { done = resolve; });
      pending = { text, done };
      try { response.progress(text, () => until); } catch { /* host without tasks */ }
    },
    end(text) { settle(text); },
    get spinning() { return pending ? pending.text : ''; },
  };
}

function jobAlive(map, kind) {
  const m = map || {};
  if (kind === 'run') return Boolean(m.running || m.shipping);
  return Boolean(m[JOB_FLAG[kind]]);
}

// `attach` follows a job this turn did not start -- a run survives a cancelled
// turn or a relaunched window, and the person who comes back should still see
// it. The difference is only patience: a job we just started is given a couple
// of reads to raise its flag, one we are merely attaching to must already be up.
async function streamJob({ client, repo, kind, response, token, attach = false, pollMs = Number(process.env.AT_JOB_POLL_MS) || DEFAULT_POLL_MS, maxMs = DEFAULT_MAX_MS, sleep, now }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = now || (() => Date.now());
  if (!client || typeof client.map !== 'function' || !response) return { lines: 0, ended: 'no-client' };
  const t0 = clock();
  let prev = null;
  let lines = 0;
  let started = false;
  let idle = 0;
  let baselined = false;
  const say = speaker(response);
  for (;;) {
    if (token && token.isCancellationRequested) { say.end(); return { lines, ended: 'cancelled' }; }
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
        // Attaching to someone else's job: the plan it is working from was
        // already there too, so it is history like the results. A job we
        // started ourselves may still be building its plan -- that is news.
        prev = attach ? { run: map.run, ship: map.ship, plan: map.plan } : { run: map.run, ship: map.ship };
      }
      const events = diffEvents(prev, map, kind);
      for (const line of events) { response.markdown(`\n${line}`); lines += 1; }
      const alive = jobAlive(map, kind);
      if (alive) { started = true; idle = 0; } else if (started || idle >= (attach ? 0 : 2)) {
        // The job's flag is down and we saw it up (or never came up after two
        // reads): it is over. One last diff already ran above.
        say.end();
        return { lines, ended: 'done' };
      } else {
        idle += 1;
      }
      // Only while there is something to watch: a finished job's last read must
      // not open a fresh spinner nobody will ever settle.
      const pr = map.progress;
      say.say(kind === 'run' && pr && pr.task
        ? `${shortTask(pr.task)} · ${pr.phase || 'working'}${pr.model ? ` · ${pr.model}` : ''}`
        : `${kind}…`);
      prev = map;
    }
    if (clock() - t0 > maxMs) { say.end(); response.markdown('\n- still running; `/run status` for the totals'); return { lines, ended: 'timeout' }; }
    await wait(pollMs);
  }
}

module.exports = { streamJob, diffEvents, jobAlive, shortTask, speaker, DEFAULT_POLL_MS };
