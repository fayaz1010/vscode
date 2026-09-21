'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { dashboardHtml, markerRows, runTotals, parseDeliverable, taskPath } = require('./dashboard');

const esc = (v) => String(v ?? '');
const MAP = {
  ok: true, repo: '/r/backend', can_refresh: true, can_plan: true, can_apply: true,
  currency: { state: 'current', tree_head: 'abcdef1234', map_head: 'abcdef1234' },
  objective: 'finish the panel',
  overview: {
    meta: {
      repo: '/r/backend', status: 'complete', findings_total: 21, findings_actionable: 4,
      markers: { bus_factor: { tier: 'C', count: 3 }, config_orphan: { tier: 'B', count: 1 }, stub_body: { tier: 'A', count: 16 } },
    },
    zones: [
      { zone: 'ext/src', colour: 0.75, findings_total: 20, files: 46, by_marker: { bus_factor: 3, config_orphan: 1 }, by_marker_all: { bus_factor: 3, config_orphan: 1, stub_body: 16 } },
      { zone: 'ext/test', colour: 0.2, findings_total: 1, files: 2, by_marker: {}, by_marker_all: { todo_debt: 1 } },
    ],
  },
  plan: { plan_id: 'repo-dash.fix', revision: 2, tasks: [
    { id: 't.ext-src-bridge.js', title: 'ext/src/bridge.js: implement', deliverables: ['mapZone (never_referenced, line 164)'],
      execution: { write_scope: ['ext/src/bridge.js'], budgets: { max_cost_usd: 0.75, max_runtime_seconds: 1800, max_attempts: 3 } } },
    { id: 't.ext-src-bridge.test.js', title: 'ext/src/bridge.test.js: document', deliverables: ['1 undocumented env var(s) (config_orphan, line 24)'],
      execution: { write_scope: ['ext/src/bridge.test.js'], budgets: { max_cost_usd: 0.75, max_runtime_seconds: 1800, max_attempts: 3 } } },
    { id: 't.ext-src-home.js', title: 'ext/src/home.js: wire', deliverables: ['a thing with no line'] },
  ] },
  run: { status: 'running', cost_usd: 0.0165, seconds: 640, results: [
    { task: 't.ext-src-bridge.js', outcome: 'closed', attempts: 1, cost_usd: 0.0069, review: { why: 'achieves p=0.8' } },
    { task: 't.ext-src-bridge.test.js', outcome: 'failed', attempts: 3, cost_usd: 0.0096, why: 'the reply was 38 lines where the file has 433' },
  ] },
  running: true,
};

describe('Dashboard tab', () => {
  it('a folder with no map shows why and the buttons that make one', () => {
    const html = dashboardHtml({ ok: false, reason: 'no map at /x', can_refresh: true }, esc);
    assert.match(html, /<section class="dash">/);
    assert.match(html, /no map at \/x/);
    assert.match(html, /data-id="\/map"/);
    assert.doesNotMatch(html, /class="tiles"/);
    assert.match(dashboardHtml(null, esc), /No map for this folder yet/);
    assert.match(dashboardHtml({ loading: true }, esc), /Asking the AT node/, 'the first paint is a question, not "no map"');
  });

  it('sums the envelope: chips, numbers, progress, tasks, markers, zones', () => {
    const html = dashboardHtml(MAP, esc);
    assert.match(html, /chip ok">map current · abcdef12/);
    assert.match(html, /chip">plan rev 2 · 3 tasks/);
    assert.match(html, /chip busy">run in progress/);
    assert.match(html, /objective<\/span> finish the panel/);
    assert.match(html, /<div class="num">4<small>\/21<\/small><\/div><div class="meta">actionable findings/);
    assert.match(html, /<div class="num">3<\/div><div class="meta">planned tasks/);
    assert.match(html, /tile good"><div class="num">1<\/div><div class="meta">closed/);
    assert.match(html, /tile bad"><div class="num">1<\/div><div class="meta">failed/);
    assert.match(html, /\$0\.02<\/div><div class="meta">this run/);
    assert.match(html, /11 min<\/div><div class="meta">run time/);
    assert.match(html, /class="bar" title="1 closed · 1 failed · 1 open"/);
    assert.match(html, /seg good" style="width:33%"/);
    // tasks: mark, deliverable linked into the code, budget, what the run said
    assert.match(html, /class="dtask m-closed" data-task="t\.ext-src-bridge\.js"/);
    assert.match(html, /<span class="dmark">✓<\/span> <b>ext-src-bridge\.js<\/b><span class="muted"> · \$0\.75 · 30 min · 3 tries/);
    assert.match(html, /<b>mapZone<\/b> <span class="muted">never_referenced<\/span> <a href="#" data-cmd="open-code" data-id="ext\/src\/bridge\.js#164" class="mcode">bridge\.js:164 ↗<\/a>/);
    assert.match(html, /closed · 1 attempt · \$0\.01 · achieves p=0\.8/);
    assert.match(html, /class="dtask m-failed" data-task="t\.ext-src-bridge\.test\.js"/);
    assert.match(html, /failed · 3 attempts · \$0\.01 · the reply was 38 lines/);
    assert.match(html, /<span class="dmark">·<\/span> <b>ext-src-home\.js<\/b><span class="muted"> · no budget/);
    assert.match(html, /<b>a thing with no line<\/b><\/div>/, 'no line: no link');
    assert.match(html, /<div class="meta">waiting<\/div>/, 'a run in progress: the task not yet reached is waiting');
    // markers: actionable over total, tier from the overview, sorted by actionable
    const markers = html.slice(html.indexOf('Findings by marker'));
    assert.ok(markers.indexOf('bus_factor') < markers.indexOf('config_orphan'));
    assert.ok(markers.indexOf('config_orphan') < markers.indexOf('stub_body'));
    assert.match(markers, /bus_factor <span class="tier">C<\/span>/);
    assert.match(markers, /<span class="dnum">0<small>\/16<\/small>/);
    assert.match(markers, /todo_debt/);
    // zones by size, with the zone's colour
    const zones = html.slice(html.indexOf('<h3>Zones</h3>'));
    assert.ok(zones.indexOf('ext/src') < zones.indexOf('ext/test'));
    assert.match(zones, /background:#e2533f"><\/span>ext\/src/);
    assert.match(zones, /20<small> · 46 files/);
    // the three moves, from the same helper the Map uses
    assert.match(html, /data-id="\/run status"/);
    assert.match(html, /data-id="\/map plan"/);
    assert.match(html, /data-id="\/map force"/);
  });

  it('says stale, no plan, and no objective when that is the state', () => {
    const html = dashboardHtml({ ...MAP, plan: null, run: null, running: false, objective: '', currency: { state: 'stale', map_head: '1111111111', tree_head: '2222222222' } }, esc);
    assert.match(html, /chip warn">map stale · 11111111 → 22222222/);
    assert.match(html, /chip warn">no plan/);
    assert.match(html, /no objective yet/);
    assert.match(html, /No plan yet\./);
    assert.doesNotMatch(html, /class="bar"/);
    const objOnly = dashboardHtml({ ...MAP, plan: null, run: null, running: false }, esc);
    assert.match(objOnly, /No tasks yet — Plan makes them from the objective/);
  });

  it('marks the task show-task pointed at, and says mapping while the map is building', () => {
    const html = dashboardHtml(MAP, esc, 't.ext-src-bridge.test.js');
    assert.match(html, /class="dtask m-failed on" data-task="t\.ext-src-bridge\.test\.js"/);
    assert.doesNotMatch(html, /class="dtask m-closed on"/);
    const building = dashboardHtml({ ...MAP, overview: { ...MAP.overview, meta: { ...MAP.overview.meta, status: 'building', stages_done: 2, stages_total: 6 } } }, esc);
    assert.match(building, /<section class="dash building running">/);
    assert.match(building, /chip busy">mapping 2\/6/);
  });

  it('grey zones are one row, clean zones are green, and the files-read tile leads', () => {
    const map = { ...MAP, overview: { ...MAP.overview,
      meta: { ...MAP.overview.meta, files_total_repo: 14197, files_analysed: 48 },
      zones: [...MAP.overview.zones, { zone: 'src/vs', findings_total: 0, files: 9313, analysed: false },
        { zone: 'ext/clean', findings_total: 0, files: 2, analysed: true, colour: 0 }] } };
    const html = dashboardHtml(map, esc);
    assert.match(html, /<div class="num">48<small>\/14,197<\/small><\/div><div class="meta">files read/);
    assert.match(html, /background:#3fb950"><\/span>ext\/clean/, 'analysed, nothing found: green');
    assert.match(html, /not analysed yet<\/span>/);
    assert.match(html, /<span class="dnum">1<small> zones · 9,313 files/);
    assert.doesNotMatch(html, /<\/span>src\/vs</, 'a grey zone is counted, not listed');
    const shell = dashboardHtml({ ...map, overview: { ...map.overview, meta: { ...map.overview.meta, status: 'shell' } } }, esc);
    assert.match(shell, /chip warn">structure only — not analysed/);
    assert.doesNotMatch(shell, /class="dash building/);
  });

  it('helpers read the planner and runner formats', () => {
    assert.deepEqual(parseDeliverable('dispose (stub_body, line 207)'), { symbol: 'dispose', marker: 'stub_body', line: 207 });
    assert.deepEqual(parseDeliverable('1 undocumented env var(s) (config_orphan, line 24)'), { symbol: '1 undocumented env var(s)', marker: 'config_orphan', line: 24 });
    assert.deepEqual(parseDeliverable('free text'), { symbol: 'free text', marker: '', line: 0 });
    assert.equal(taskPath({ execution: { write_scope: ['a/b.js'] } }), 'a/b.js');
    assert.equal(taskPath({ title: 'a/c.js: implement the declared behaviour' }), 'a/c.js');
    assert.equal(taskPath({}), '');
    assert.deepEqual(runTotals(MAP.run), { results: 2, closed: 1, failed: 1, skipped: 0, cost: 0.0165, costAll: null, models: [], seconds: 640, status: 'running', dry: false });
    assert.deepEqual(runTotals(null), { results: 0, closed: 0, failed: 0, skipped: 0, cost: null, costAll: null, models: [], seconds: null, status: '', dry: false });
    const rows = markerRows(MAP.overview);
    assert.deepEqual(rows.map((r) => [r.name, r.actionable, r.total, r.tier]), [
      ['bus_factor', 3, 3, 'C'], ['config_orphan', 1, 1, 'B'], ['stub_body', 0, 16, 'A'], ['todo_debt', 0, 1, ''],
    ]);
    // no zone counts: fall back to the overview's marker counts
    assert.deepEqual(markerRows({ meta: { markers: { stub_body: { tier: 'A', count: 2 }, hotspot: { tier: 'C', count: 0 } } }, zones: [] }).map((r) => r.name), ['stub_body']);
  });
});

describe('Who was paid', () => {
  const { modelsHtml, tokens } = require('./dashboard');
  const withModels = {
    ...MAP,
    run: {
      ...MAP.run, cost_usd: 0.1913, cost_all_runs_usd: 1.62,
      models: [
        { model: 'x-ai/grok-4.6', calls: 3, tokens_in: 41200, tokens_out: 9800, cost_usd: 0.1522 },
        { model: 'typesafe/jev-1.13', calls: 4, tokens_in: 2100, tokens_out: 0, cost_usd: 0.0021 },
      ],
      results: [
        { task: 't.ext-src-bridge.js', outcome: 'closed', attempts: 1, cost_usd: 0.15,
          calls: [{ kind: 'implement', model: 'x-ai/grok-4.6' }, { kind: 'review', model: 'typesafe/jev-1.13' }] },
      ],
    },
  };

  it('shows this run beside all runs, so $0.19 is not mistaken for the project total', () => {
    const html = dashboardHtml(withModels, esc);
    assert.match(html, /\$0\.19<\/div><div class="meta">this run/);
    assert.match(html, /\$1\.62<\/div><div class="meta">all runs/);
  });

  it('lists each model with calls, tokens in and out, and cost', () => {
    const html = dashboardHtml(withModels, esc);
    assert.match(html, /<td>grok-4\.6<\/td><td class="n">3<\/td><td class="n">41\.2k<\/td><td class="n">9\.8k<\/td><td class="n">\$0\.15<\/td>/);
    assert.match(html, /<td>jev-1\.13<\/td><td class="n">4<\/td>/);
  });

  it('names the models on the task row', () => {
    const html = dashboardHtml(withModels, esc);
    assert.match(html, /closed · 1 attempt · \$0\.15 · grok-4\.6, jev-1\.13/);
  });

  it('draws nothing for a run that recorded no calls, and formats tokens for reading', () => {
    assert.equal(modelsHtml([], esc), '');
    assert.equal(modelsHtml(undefined, esc), '');
    assert.equal(tokens(950), '950');
    assert.equal(tokens(41200), '41.2k');
    assert.equal(tokens(412000), '412k');
    assert.equal(tokens(2400000), '2.4M');
    assert.doesNotMatch(dashboardHtml(MAP, esc), /all runs/);
  });
});
