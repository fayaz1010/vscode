'use strict';
/**
 * Dashboard tab -- the loop at a glance: what the map is of, whether it is current,
 * what the plan is for, how far the run got, and where the findings sit.
 *
 * It reads the same /api/map envelope the Map tab reads: { overview, plan, run,
 * currency, objective, running, mapping, planning }. Nothing here fetches; the editor
 * host paints both tabs from one poll. Every number on the page comes from a field
 * the mapper, planner or runner already writes, so the dashboard cannot disagree
 * with the Map -- it is the same data, summed.
 *
 * Absent is a state: a folder with no map yet shows the buttons that make one.
 */
const { runIndex, runMark, mapActions, shipLine, progressHtml, liveFile, nextStepHtml } = require('./plan');
const { zoneOfFile } = require('./map_graph');

// "symbol (marker, line N)" -- the planner's deliverable line. The line is what makes
// the row a link into the code; a deliverable that does not carry one links nowhere.
const DELIVERABLE_RX = /^(.*?)\s*\((\w+),\s*line\s+(\d+)\)\s*$/;

function parseDeliverable(text) {
  const m = DELIVERABLE_RX.exec(String(text || ''));
  return m
    ? { symbol: m[1], marker: m[2], line: Number(m[3]) }
    : { symbol: String(text || ''), marker: '', line: 0 };
}

function taskPath(task) {
  const scope = task && task.execution && task.execution.write_scope;
  if (Array.isArray(scope) && scope.length) return String(scope[0]);
  const title = String((task && task.title) || '');
  const i = title.indexOf(':');
  return i > 0 ? title.slice(0, i) : '';
}

// Findings by marker: what kind of problem the map found, and how much of it is
// actionable now. Zones carry `by_marker` (actionable) and `by_marker_all`; the
// overview's `markers` carry the tier. Summed over zones so a subtree map and a
// whole-repo map read the same way.
function markerRows(overview) {
  const meta = (overview && overview.meta) || {};
  const tiers = meta.markers || {};
  const acc = {};
  for (const z of (overview && overview.zones) || []) {
    for (const [m, n] of Object.entries(z.by_marker || {})) acc[m] = acc[m] || { name: m, actionable: 0, total: 0 };
    for (const [m, n] of Object.entries(z.by_marker || {})) acc[m].actionable += Number(n || 0);
    for (const [m, n] of Object.entries(z.by_marker_all || {})) {
      acc[m] = acc[m] || { name: m, actionable: 0, total: 0 };
      acc[m].total += Number(n || 0);
    }
  }
  if (!Object.keys(acc).length) {
    for (const [m, row] of Object.entries(tiers)) {
      if (row && Number(row.count || 0) > 0) acc[m] = { name: m, actionable: Number(row.count), total: Number(row.count) };
    }
  }
  return Object.values(acc)
    .map((r) => ({ ...r, total: Math.max(r.total, r.actionable), tier: (tiers[r.name] && tiers[r.name].tier) || '' }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.actionable - a.actionable || b.total - a.total || a.name.localeCompare(b.name));
}

// WHAT TO DO WITH A TASK NO MODEL COULD FINISH.
//
// It used to end as one red cross and a sentence from the last attempt. The
// three models that tried it, what each one cost, and why each was rejected all
// existed -- in a log nobody opens. So the next move was always to reconstruct
// the task by hand and re-type it into Cursor.
//
// The brief is written whether or not an IDE is reachable, so it is shown here
// in full: read it, copy it, paste it wherever you like. If this machine is set
// up to send it, the row says where it went instead.
function handoffHtml(r, escape) {
  const h = r && r.handoff;
  if (!h) return '';
  const tried = (h.models_tried || []).filter(Boolean);
  const lead = h.sent_to
    ? `Sent to ${h.sent_to.charAt(0).toUpperCase()}${h.sent_to.slice(1)}.`
    : 'A brief is ready.';
  const who = tried.length
    ? ` ${tried.length} model${tried.length === 1 ? '' : 's'} tried it: ${tried.join(', ')}.`
    : '';
  const err = h.send_error ? ` <span class="dwarn">could not reach it: ${escape(h.send_error)}</span>` : '';
  const body = h.text
    ? `<details class="dbrief"><summary>the brief</summary><pre>${escape(h.text)}</pre></details>`
    : '';
  return `<div class="dhandoff"><b>${escape(lead)}</b>${escape(who)}${err}${body}</div>`;
}

function runTotals(run) {
  const results = run && Array.isArray(run.results) ? run.results : [];
  const n = (...o) => results.filter((r) => o.includes(r.outcome)).length;
  return {
    results: results.length,
    closed: n('closed', 'closed_unreviewed', 'already_closed'),
    failed: n('failed', 'failed_handoff'),
    handedOff: n('failed_handoff'),
    skipped: n('skipped_dirty', 'blocked'),
    reported: n('reported'),
    cost: run && run.cost_usd != null ? Number(run.cost_usd) : null,
    costAll: run && run.cost_all_runs_usd != null ? Number(run.cost_all_runs_usd) : null,
    models: run && Array.isArray(run.models) ? run.models : [],
    seconds: run && run.seconds != null ? Number(run.seconds) : null,
    status: (run && run.status) || '',
    dry: Boolean(run && run.dry_run),
  };
}

function money(v) { return v == null ? '—' : `$${Number(v).toFixed(2)}`; }
function shortModel(m) { return String(m || '?').replace(/^[^/]+\//, ''); }
function tokens(n) {
  n = Number(n || 0);
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n);
}

// WHO WAS PAID. One row per model the run called: calls, tokens in and out, cost —
// the "who" and "how much text" beside the run's dollar figure. The rows come from
// run.json's `models` (repo-dash sums every paid call, implementer and reviewer).
function modelsHtml(models, escape) {
  if (!Array.isArray(models) || !models.length) return '';
  const rows = models.map((m) => `<tr><td>${escape(shortModel(m.model))}</td><td class="n">${Number(m.calls || 0)}</td><td class="n">${escape(tokens(m.tokens_in))}</td><td class="n">${escape(tokens(m.tokens_out))}</td><td class="n">${escape(money(m.cost_usd))}</td></tr>`).join('');
  return `<table class="dmodels"><thead><tr><th>model</th><th class="n">calls</th><th class="n">in</th><th class="n">out</th><th class="n">cost</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function clock(s) {
  if (s == null) return '—';
  const n = Math.round(Number(s));
  return n >= 3600 ? `${(n / 3600).toFixed(1)} h` : n >= 60 ? `${Math.round(n / 60)} min` : `${n} s`;
}

function dashboardHtml(map, esc, focusTask) {
  const escape = typeof esc === 'function' ? esc : (v) => String(v ?? '');
  const actions = mapActions(map, escape);
  const cur = (map && map.currency) || {};
  const objective = map && map.objective ? String(map.objective) : '';
  const where = (map && map.project && map.project.root) || (map && map.repo) || '';
  if (map && map.loading) {
    return '<section class="dash"><h3>Dashboard</h3><p class="muted">Asking the AT node for the map of this folder…</p></section>';
  }
  if (!map || !map.ok || !map.overview) {
    const why = (map && map.reason) || 'No map for this folder yet. Map it, then plan from an objective, then run.';
    return `<section class="dash"><h3>Dashboard</h3>${where ? `<p class="muted">${escape(where)}</p>` : ''}<p class="muted">${escape(why)}</p>${actions}</section>`;
  }
  const meta = map.overview.meta || {};
  const allZones = map.overview.zones || [];
  const zones = allZones.filter((z) => z.analysed !== false).sort((a, b) => (b.findings_total || 0) - (a.findings_total || 0));
  const grey = allZones.filter((z) => z.analysed === false);
  const shellOnly = meta.status === 'shell';
  // THE PLAN AS FAR AS IT HAS GOT. While the planner runs, its partial plan (main
  // tasks first, sub-tasks as they are built) stands in for the plan, and says so.
  const partial = map.planning && map.plan_partial && Array.isArray(map.plan_partial.tasks) ? map.plan_partial : null;
  const tasks = partial ? partial.tasks : (map.plan && Array.isArray(map.plan.tasks) ? map.plan.tasks : []);
  const runs = runIndex(map.run);
  const tot = runTotals(map.run);
  const building = !shellOnly && meta.status !== 'complete';

  // STATE CHIPS. Each says one thing about the loop right now.
  const chips = [];
  if (shellOnly && !map.mapping) {
    chips.push('<span class="chip warn">structure only — not analysed</span>');
  } else if (map.mapping || building) {
    chips.push(`<span class="chip busy">${meta.stages_total ? `mapping ${Number(meta.stages_done || 0)}/${Number(meta.stages_total)}` : 'mapping…'}</span>`);
  } else if (cur.state === 'stale') {
    chips.push(`<span class="chip warn">map stale · ${escape(String(cur.map_head || '').slice(0, 8))} → ${escape(String(cur.tree_head || '').slice(0, 8))}</span>`);
  } else if (cur.state === 'current') {
    chips.push(`<span class="chip ok">map current · ${escape(String(cur.tree_head || '').slice(0, 8))}</span>`);
  }
  if (map.planning) chips.push('<span class="chip busy">planning…</span>');
  else if (tasks.length) chips.push(`<span class="chip">plan rev ${Number((map.plan && map.plan.revision) || 1)} · ${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>`);
  else chips.push('<span class="chip warn">no plan</span>');
  if (map.running) chips.push('<span class="chip busy">run in progress</span>');
  else if (tot.results) chips.push(`<span class="chip${tot.failed ? ' warn' : ' ok'}">last run ${escape(tot.status || 'complete')}</span>`);
  // WHETHER THE WORK IS READY, not just whether the tasks are done.
  const verdict = (map.assessment || {}).verdict;
  if (verdict) {
    const cls = verdict === 'ready' ? ' ok' : verdict === 'more_work' ? ' warn' : '';
    chips.push(`<span class="chip${cls}" title="${escape((map.assessment || {}).why || '')}">${escape(String(verdict).replace('_', ' '))}</span>`);
  }
  if (map.shipping) chips.push('<span class="chip busy">shipping…</span>');
  else if (map.ship && map.ship.status) chips.push(`<span class="chip${map.ship.status === 'shipped' ? ' ok' : ' warn'}">${escape(map.ship.status)}${map.ship.deploy && map.ship.deploy.url ? ' · ' + (map.ship.deploy.prod ? 'prod' : 'preview') : ''}</span>`);

  // WHAT THEY ASKED, AS IT WAS UNDERSTOOD. Their own sentence, the goal it was
  // read as, and the decisions it left open with the answer taken for now --
  // so a person can see what was decided for them and say otherwise.
  const detail = map.objective_detail || null;
  const questions = (detail && detail.questions) || [];
  const objectiveLine = detail && detail.goal
    ? `<div class="dobjective"><span class="muted">objective</span> ${escape(detail.goal)}
        ${map.asked && map.asked !== detail.goal ? `<div class="dasked">you asked: ${escape(map.asked)}</div>` : ''}
        ${(detail.done_when || []).length ? `<div class="ddone">done when ${escape((detail.done_when || []).join('; '))}</div>` : ''}
        ${questions.length ? `<details class="dqs"><summary>${questions.length} decision${questions.length === 1 ? '' : 's'} your sentence left open — answered for now</summary>${questions.map((q) => `<div class="dq"><b>${escape(q.ask)}</b> → ${escape(q.recommend || q.assume || '')}${q.because ? `<span class="muted"> — ${escape(q.because)}</span>` : ''}</div>`).join('')}</details>` : ''}
      </div>`
    : objective
    ? `<p class="dobjective"><span class="muted">objective</span> ${escape(objective)}</p>`
    : '<p class="dobjective muted">no objective yet — the plan comes from one: Plan…, or <code>/map plan &lt;objective&gt;</code> in @at</p>';

  // THE NUMBERS. Findings the map holds against the tree, tasks the plan made of
  // them, what the run did with the tasks, and what it cost.
  const tile = (n, label, cls) => `<div class="tile ${cls || ''}"><div class="num">${n}</div><div class="meta">${label}</div></div>`;
  const readTile = meta.files_total_repo != null
    ? tile(`${Number(meta.files_analysed || 0).toLocaleString()}<small>/${Number(meta.files_total_repo).toLocaleString()}</small>`, 'files read')
    : '';
  const tiles = `<div class="tiles">
    ${readTile}
    ${tile(`${Number(meta.findings_actionable || 0)}<small>/${Number(meta.findings_total || 0)}</small>`, 'actionable findings')}
    ${tile(String(tasks.length), 'planned tasks')}
    ${tile(String(tot.closed), 'closed', tot.closed ? 'good' : '')}
    ${tile(String(tot.failed), 'failed', tot.failed ? 'bad' : '')}
    ${tot.reported ? tile(String(tot.reported), 'reported') : ''}
    ${tile(escape(money(tot.cost)), 'this run')}
    ${tot.costAll != null ? tile(escape(money(tot.costAll)), 'all runs') : ''}
    ${tile(escape(clock(tot.seconds)), 'run time')}
  </div>`;
  const modelTable = modelsHtml(tot.models, escape);

  // PROGRESS. Closed / failed / rest of the plan, as one bar.
  const denom = Math.max(tasks.length, tot.results, 1);
  const pct = (n) => `${Math.round((n / denom) * 100)}%`;
  const progress = tasks.length || tot.results
    ? `<div class="bar" title="${tot.closed} closed · ${tot.failed} failed${tot.reported ? ` · ${tot.reported} reported` : ''} · ${Math.max(denom - tot.closed - tot.failed - tot.reported, 0)} open">
        <span class="seg good" style="width:${pct(tot.closed)}"></span><span class="seg bad" style="width:${pct(tot.failed)}"></span></div>`
    : '';

  // The picture of the code, what it found by kind and where -- all on the Map
  // tab now. Two tabs were drawing the same thing and neither was the whole of it.
  const toMap = (map.overview && (map.overview.zones || []).length)
    ? '<p class="muted dtomap">The code itself, and everything the map found, is on the <button data-tab="map" class="dlink">Map</button> tab.</p>'
    : '';

  // TASKS. One row per plan task: the run's mark, what it is to deliver (linked into
  // the code), the budget the planner gave it, and what the run said.
  const taskRows = tasks.map((t) => {
    const r = runs[t.id];
    const st = runMark(r);
    const path = taskPath(t);
    const ds = (t.deliverables || []).map((d) => {
      const p = parseDeliverable(d);
      const code = path && p.line
        ? `<a href="#" data-cmd="open-code" data-id="${escape(path)}#${p.line}" class="mcode">${escape(path.split('/').pop())}:${p.line} ↗</a>`
        : '';
      return `<div class="ddel"><b>${escape(p.symbol)}</b>${p.marker ? ` <span class="muted">${escape(p.marker)}</span>` : ''}${code ? ` ${code}` : ''}</div>`;
    }).join('');
    const b = (t.execution && t.execution.budgets) || {};
    // WHAT WAS SET ASIDE, NOT WHAT HAPPENED. Every task in a plan gets the same
    // estimate when the task class has no history ("no history for this task class"
    // in plan.sh) -- nine tasks all reading "$0.75 · 15 min · 3 tries" in the header,
    // identical and prominent, while the real $0.06 and 2 attempts sat dim underneath.
    // A person reads the bold number first; it must be the one that is true.
    const budget = [b.max_cost_usd != null ? money(b.max_cost_usd) : '', b.max_runtime_seconds != null ? clock(b.max_runtime_seconds) : '', b.max_attempts ? `${b.max_attempts} tries` : ''].filter(Boolean).join(' · ');
    const estimate = budget ? `est. up to ${budget}` : '';
    const who = r && Array.isArray(r.calls) && r.calls.length
      ? [...new Set(r.calls.map((c) => shortModel(c.model)))].join(', ')
      : '';
    // THE HEADLINE NUMBER IS WHAT ACTUALLY HAPPENED, once there is a result to show:
    // real cost, real attempts. The budget -- the same estimate on every task until
    // one has run -- moves to a smaller aside, and only for tasks still waiting on
    // it, where it is the only number there is, and is labelled as an estimate.
    const actual = r && (r.cost_usd != null || r.attempts)
      ? [r.cost_usd != null ? money(r.cost_usd) : '', r.attempts ? `${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
      : '';
    const headline = actual || estimate || 'no budget';
    const said = r
      ? [st.label, who, st.why].filter(Boolean).join(' · ')
      : (map.running ? 'waiting' : 'not run');
    // UNDER THE PEN. The row of the task the runner is on right now pulses and
    // says so, with the file: a person watching the Dashboard sees which file is
    // being written without reading the log.
    const live = Boolean((map.running || map.shipping) && map.progress && map.progress.task === t.id);
    const cls = `dtask${st.mark ? ` m-${(r && r.outcome) || ''}` : ''}${focusTask && focusTask === t.id ? ' on' : ''}${live ? ' live' : ''}`;
    return `<div class="${cls}" data-task="${escape(t.id)}"${live && path ? ` data-live-file="${escape(path)}"` : ''}>
      <div class="dhead"><span class="dmark">${escape(live ? '✎' : (st.mark || '·'))}</span> <b>${escape(String(t.id).replace(/^t\./, ''))}</b><span class="muted"> · ${escape(headline)}</span>${live ? `<span class="dpen"> · writing ${escape(path || '')}${map.progress.phase ? ` · ${escape(map.progress.phase)}` : ''}</span>` : ''}</div>
      ${ds}
      <div class="meta">${escape(said)}${actual && budget ? ` <span class="dbudget">(est. up to ${escape(budget)})</span>` : ''}</div>
      ${handoffHtml(r, escape)}
    </div>`;
  });
  // UNDER THEIR NODES. Tasks grouped by the zone their file belongs to, so the plan
  // reads as the map does: zone, then its tasks, then each task's deliverables.
  const zonesAll = (map.overview && map.overview.zones) || [];
  const byZone = new Map();
  tasks.forEach((t, i) => {
    const z = zoneOfFile(taskPath(t), zonesAll) || '';
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(i);
  });
  const grouped = [...byZone.entries()].map(([slug, idxs]) => {
    const zone = zonesAll.find((z) => z.slug === slug);
    const name = zone ? zone.zone : (slug || 'elsewhere');
    return `<details class="dzone" open><summary><span class="mdot" style="background:${zone && Number(zone.colour || 0) >= 0.5 ? '#c2811f' : '#6b7484'}"></span>${escape(name)} <span class="muted">· ${idxs.length} task${idxs.length === 1 ? '' : 's'}</span></summary>${idxs.map((i) => taskRows[i]).join('')}</details>`;
  }).join('');
  const planningNote = partial
    ? `<p class="dplanning">planning… ${tasks.length}${partial.tasks_expected ? ` of ${partial.tasks_expected}` : ''} task${(partial.tasks_expected || tasks.length) === 1 ? '' : 's'} so far${partial.stage ? ` · ${escape(partial.stage)}` : ''}</p>`
    : '';
  const taskList = tasks.length
    ? `<h3>Tasks</h3>${planningNote}${grouped}`
    : `<p class="muted">${objective ? 'No tasks yet — Plan makes them from the objective.' : 'No plan yet.'}</p>`;

  return `<section class="dash${building ? ' building' : ''}${map.running ? ' running' : ''}"><h3>Dashboard</h3>
    <p class="muted">${escape(String(meta.repo || where || '').split(/[\\/]/).slice(-2).join('/'))}</p>
    <div class="chips">${chips.join('')}</div>
    ${objectiveLine}
    ${nextStepHtml(map, escape)}
    ${shipLine(map, escape)}
    ${progressHtml(map, escape)}
    ${actions}
    ${tiles}
    ${modelTable}
    ${progress}
    ${taskList}
    ${toMap}
  </section>`;
}

const DASH_CSS = `
  .dtomap { margin-top:10px; }
  .dlink { background:none; border:0; color:#3794ff; cursor:pointer; padding:0; font:inherit; text-decoration:underline; }
  .dasked, .ddone { opacity:.7; margin-top:3px; }
  .dqs { margin-top:5px; } .dqs > summary { cursor:pointer; opacity:.8; }
  .dq { padding:3px 0 3px 10px; border-left:2px solid #2b3345; margin-top:4px; }
  .dzone { margin:4px 0 8px; } .dzone > summary { cursor:pointer; font-weight:600; padding:3px 0; }
  .dplanning { color:#c2811f; animation: dpulse2 1.2s ease-in-out infinite; margin:2px 0 6px; }
  @keyframes dpulse2 { 50% { opacity:.4; } }
  .dtask.live { border-color:#3794ff; animation: dpulse 1.4s ease-in-out infinite; }
  .dtask.live .dmark, .dpen { color:#3794ff; }
  @keyframes dpulse { 50% { box-shadow: 0 0 0 3px rgba(55,148,255,.25); } }
  .dash .chips { display:flex; gap:6px; flex-wrap:wrap; margin:4px 0 8px; }
  .dash .chip { font-size:11px; padding:2px 8px; border-radius:9px; background:#55555555; }
  .dash .chip.ok { background:#2d6a5a66; color:#9ff0cf; }
  .dash .chip.warn { background:#6a5a2d66; color:#f0d69f; }
  .dash .chip.busy { background:#2d4a6a66; color:#9fc6f0; }
  .dash .dobjective { margin:4px 0 8px; line-height:1.4; } .dash .dobjective code { font-size:11px; }
  .dash .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(96px, 1fr)); gap:6px; margin:8px 0; }
  .dash .tiles .tile { cursor:default; } .dash .tiles .num { font-size:20px; font-weight:600; font-variant-numeric:tabular-nums; }
  .dash .tiles .num small, .dash .dnum small { font-size:11px; font-weight:400; opacity:.65; }
  .dash .dmodels { border-collapse:collapse; margin:4px 0 8px; font-size:12px; font-variant-numeric:tabular-nums; }
  .dash .dmodels th { text-align:left; font-weight:400; opacity:.65; padding:2px 10px 2px 0; }
  .dash .dmodels td { padding:2px 10px 2px 0; } .dash .dmodels .n { text-align:right; }
  .dash .tile.good .num { color:#9ff0cf; } .dash .tile.bad .num { color:#f0a09f; }
  .dash .bar { display:flex; height:6px; border-radius:3px; background:#55555555; overflow:hidden; margin:0 0 10px; }
  .dash .seg { display:block; height:100%; } .dash .seg.good { background:#4fbf9a; } .dash .seg.bad { background:#e2533f; }
  .dash .drow { display:grid; grid-template-columns:minmax(120px, 1fr) 2fr auto; gap:8px; align-items:center; padding:3px 0;
    font-size:11.5px; border-top:1px solid var(--vscode-widget-border,#333); }
  .dash .dname { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .dash .tier { font-size:10px; opacity:.6; padding:0 4px; border:1px solid currentColor; border-radius:3px; }
  .dash .dbar { position:relative; display:block; height:8px; background:#55555533; border-radius:4px; overflow:hidden; }
  .dash .dbar .seg { position:absolute; left:0; top:0; } .dash .dbar .all { background:#6b748466; } .dash .dbar .act { background:#c2811f; }
  .dash .dnum { font-variant-numeric:tabular-nums; min-width:3em; text-align:right; }
  .dash .mdot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; }
  .dash .dtask { border:1px solid var(--vscode-widget-border,#333); border-radius:6px; padding:6px 9px; margin:0 0 6px; }
  .dash .dtask.on { border-color: var(--vscode-focusBorder, #3794ff); }
  .dash .dtask.m-closed, .dash .dtask.m-closed_unreviewed, .dash .dtask.m-already_closed { border-left:3px solid #4fbf9a; }
  .dash .dtask.m-failed { border-left:3px solid #e2533f; }
  .dash .dtask.m-failed_handoff { border-left:3px solid #c2811f; }
  .dash .dhandoff { margin:4px 0 0 18px; font-size:11px; color:#9aa3b2; }
  .dash .dhandoff .dwarn { color:#e2533f; }
  .dash .dbrief { margin-top:3px; }
  .dash .dbrief summary { cursor:pointer; color:#7aa2f7; }
  .dash .dbrief pre { white-space:pre-wrap; max-height:260px; overflow:auto;
    background:#12151c; border:1px solid #232733; border-radius:4px; padding:6px;
    margin:4px 0 0; font-size:10.5px; }
  .dash .dtask.m-skipped_dirty, .dash .dtask.m-blocked { border-left:3px solid #888; }
  .dash .dbudget { opacity:.55; font-size:11px; }
  .dash .dmark { display:inline-block; min-width:1.2em; } .dash .ddel { margin:2px 0 0 1.4em; font-size:11.5px; }
  .dash .mcode { opacity:.75; text-decoration:none; color:inherit; } .dash .mcode:hover { opacity:1; text-decoration:underline; }
  .dash.building > h3::after { content:" · mapping…"; font-weight:400; opacity:.6; }
`;

module.exports = {
  handoffHtml, dashboardHtml, DASH_CSS, markerRows, runTotals, parseDeliverable, taskPath, modelsHtml, tokens };
