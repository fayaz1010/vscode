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

  it('sums the envelope: chips, numbers, progress, tasks', () => {
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
    // tasks: mark, deliverable linked into the code, what the run said -- and the
    // HEADLINE is the real cost/attempts once a task has run, not the identical
    // per-class budget estimate every task starts with.
    assert.match(html, /class="dtask m-closed" data-task="t\.ext-src-bridge\.js"/);
    assert.match(html, /<span class="dmark">✓<\/span> <b>ext-src-bridge\.js<\/b><span class="muted"> · \$0\.01 · 1 attempt<\/span>/);
    assert.match(html, /<b>mapZone<\/b> <span class="muted">never_referenced<\/span> <a href="#" data-cmd="open-code" data-id="ext\/src\/bridge\.js#164" class="mcode">bridge\.js:164 ↗<\/a>/);
    assert.match(html, /closed · achieves p=0\.8/);
    assert.match(html, /class="dbudget">\(est\. up to \$0\.75 · 30 min · 3 tries\)<\/span>/);
    assert.match(html, /class="dtask m-failed" data-task="t\.ext-src-bridge\.test\.js"/);
    assert.match(html, /<b>ext-src-bridge\.test\.js<\/b><span class="muted"> · \$0\.01 · 3 attempts<\/span>/);
    assert.match(html, /failed · the reply was 38 lines/);
    assert.match(html, /<span class="dmark">·<\/span> <b>ext-src-home\.js<\/b><span class="muted"> · no budget/);
    assert.match(html, /<b>a thing with no line<\/b><\/div>/, 'no line: no link');
    assert.match(html, /<div class="meta">waiting<\/div>/, 'a run in progress: the task not yet reached is waiting');
    // Findings by kind and the zone chart are the Map's now -- see the split test below.
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

  it('the files-read tile leads, and a structure-only map says so', () => {
    const map = { ...MAP, overview: { ...MAP.overview,
      meta: { ...MAP.overview.meta, files_total_repo: 14197, files_analysed: 48 },
      zones: [...MAP.overview.zones, { zone: 'src/vs', findings_total: 0, files: 9313, analysed: false },
        { zone: 'ext/clean', findings_total: 0, files: 2, analysed: true, colour: 0 }] } };
    const html = dashboardHtml(map, esc);
    assert.match(html, /<div class="num">48<small>\/14,197<\/small><\/div><div class="meta">files read/);
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

  it('names the models on the task row, and the real cost leads not the estimate', () => {
    const html = dashboardHtml(withModels, esc);
    assert.match(html, /<b>ext-src-bridge\.js<\/b><span class="muted"> · \$0\.15 · 1 attempt<\/span>/);
    assert.match(html, /closed · grok-4\.6, jev-1\.13/);
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

describe('the file under the pen', () => {
  const { liveFile } = require('./plan');
  const { zoneOfFile, graphSvg } = require('./map_graph');
  const { dashboardHtml } = require('./dashboard');
  const map = {
    ok: true, running: true,
    progress: { task: 't.lib-admin-payments.ts', attempt: 1, phase: 'asking the model' },
    plan: { tasks: [
      { id: 't.lib-admin-payments.ts', title: 'lib/admin/payments.ts: build', execution: { write_scope: ['lib/admin/payments.ts'] }, deliverables: [] },
      { id: 't.other', title: 'lib/x.ts: wire', execution: { write_scope: ['lib/x.ts'] }, deliverables: [] },
    ] },
    overview: { meta: {}, zones: [{ zone: '<root>', slug: 'root', files: 2 }, { zone: 'lib', slug: 'lib', files: 3 }, { zone: 'lib/admin', slug: 'lib-admin', files: 2 }], zone_edges: [] },
    run: { status: 'running', results: [] },
  };

  it('liveFile is the running task\'s write scope, and nothing when nothing runs', () => {
    assert.equal(liveFile(map), 'lib/admin/payments.ts');
    assert.equal(liveFile({ ...map, running: false, shipping: false }), '');
    assert.equal(liveFile({ ...map, progress: { task: 't.nope' } }), '');
  });

  it('the running task\'s row pulses and names the file; the others do not', () => {
    const html = dashboardHtml(map, (v) => String(v ?? ''));
    assert.match(html, /class="dtask live" data-task="t\.lib-admin-payments\.ts" data-live-file="lib\/admin\/payments\.ts"/);
    assert.match(html, /✎/);
    assert.match(html, /writing lib\/admin\/payments\.ts · asking the model/);
    assert.ok(!/data-task="t\.other"[^>]*live/.test(html));
  });

  it('the graph marks the zone that owns the file, and carries the file for the dots', () => {
    assert.equal(zoneOfFile('lib/admin/payments.ts', map.overview.zones), 'lib-admin', 'the deepest zone, not lib');
    assert.equal(zoneOfFile('lib/x.ts', map.overview.zones), 'lib');
    assert.equal(zoneOfFile('middleware.ts', map.overview.zones), 'root');
    const svg = graphSvg(map.overview, (v) => String(v ?? ''), { live: 'lib/admin/payments.ts' });
    assert.match(svg, /data-live="lib\/admin\/payments\.ts"/);
    assert.match(svg, /class="mnode live" data-zone="lib-admin"/);
    assert.ok(!/class="mnode live" data-zone="lib"/.test(svg));
    assert.match(svg, /· writing lib\/admin\/payments\.ts<\/title>/);
  });
});

describe('the plan lands like a stream, under its nodes', () => {
  const { dashboardHtml } = require('./dashboard');
  const { graphSvg } = require('./map_graph');
  const esc = (v) => String(v ?? '');
  const overview = { meta: {}, zones: [{ zone: '<root>', slug: 'root', files: 1 }, { zone: 'lib', slug: 'lib', files: 3 }, { zone: 'lib/admin', slug: 'lib-admin', files: 2, colour: 0.6 }], zone_edges: [] };

  it('while planning, the partial plan stands in and says how far it got', () => {
    const map = { ok: true, planning: true, overview, plan: null,
      plan_partial: { status: 'planning', stage: 'selected', tasks_expected: 3, tasks: [
        { id: 't.lib-admin-payments.ts', title: 'lib/admin/payments.ts: build', state: 'planning', deliverables: ['AlipayWeChatCheckoutService (objective_gap, line 1)'], execution: { write_scope: ['lib/admin/payments.ts'] } },
      ] } };
    const html = dashboardHtml(map, esc);
    assert.match(html, /planning… 1 of 3 tasks so far · selected/);
    assert.match(html, /<details class="dzone" open><summary>[^<]*<span class="mdot"[^>]*><\/span>lib\/admin <span class="muted">· 1 task<\/span><\/summary>/);
    assert.match(html, /AlipayWeChatCheckoutService/);
  });

  it('a finished plan is grouped under zones and the graph badges each zone with its count', () => {
    const map = { ok: true, overview, plan: { revision: 1, tasks: [
      { id: 't.lib-admin-payments.ts', title: 'lib/admin/payments.ts: build', deliverables: [], execution: { write_scope: ['lib/admin/payments.ts'] } },
      { id: 't.lib-admin-logistics.ts', title: 'lib/admin/logistics.ts: build', deliverables: [], execution: { write_scope: ['lib/admin/logistics.ts'] } },
      { id: 't.lib-x.ts', title: 'lib/x.ts: wire', deliverables: [], execution: { write_scope: ['lib/x.ts'] } },
    ] } };
    const html = dashboardHtml(map, esc);
    assert.ok(!/planning…/.test(html));
    assert.match(html, /lib\/admin <span class="muted">· 2 tasks<\/span>/);
    assert.match(html, />lib <span class="muted">· 1 task<\/span>/);
    const svg = graphSvg(overview, esc, { tasksByZone: { 'lib-admin': 2, lib: 1 } });
    assert.match(svg, /<title>2 tasks planned here<\/title>/);
    assert.match(svg, /<title>1 task planned here<\/title>/);
    assert.ok(!/planned here.*planned here.*planned here/s.test(svg), 'root has no badge');
  });
});

describe('the dashboard says whether the work is ready', () => {
  const { dashboardHtml } = require('./dashboard');
  const esc = (v) => String(v ?? '');
  const base = { ok: true, overview: { meta: {}, zones: [], zone_edges: [] }, plan: { tasks: [] } };

  it('shows the verdict as its own chip, with the reason on hover', () => {
    const more = dashboardHtml({ ...base, assessment: { verdict: 'more_work', why: 'still unfinished (p=0.81)' } }, esc);
    assert.match(more, /<span class="chip warn" title="still unfinished \(p=0\.81\)">more work<\/span>/);
    const ready = dashboardHtml({ ...base, assessment: { verdict: 'ready', why: 'ready (p=0.88)' } }, esc);
    assert.match(ready, /<span class="chip ok" title="ready \(p=0\.88\)">ready<\/span>/);
    assert.ok(!/chip[^>]*>(ready|more work)</.test(dashboardHtml(base, esc)), 'no verdict, no chip');
  });
});

describe('the objective, as it was understood', () => {
  const { dashboardHtml } = require('./dashboard');
  const esc = (v) => String(v ?? '');
  const base = { ok: true, overview: { meta: {}, zones: [], zone_edges: [] }, plan: { tasks: [] } };

  it('shows their words, the goal it was read as, and the decisions taken for them', () => {
    const html = dashboardHtml({
      ...base,
      asked: 'let people pay with wechat',
      objective: 'Let a shopper pay with WeChat Pay at checkout. It is done when: …',
      objective_detail: {
        goal: 'Let a shopper pay with WeChat Pay at checkout',
        done_when: ['a shopper can complete an order end to end'],
        questions: [{ ask: 'Sandbox or live first?', recommend: 'sandbox first', because: 'no WeChat keys in .env.example' }],
      },
    }, esc);
    assert.match(html, /<span class="muted">objective<\/span> Let a shopper pay with WeChat Pay at checkout/);
    assert.match(html, /you asked: let people pay with wechat/);
    assert.match(html, /done when a shopper can complete an order end to end/);
    assert.match(html, /1 decision your sentence left open — answered for now/);
    assert.match(html, /<b>Sandbox or live first\?<\/b> → sandbox first/);
    assert.match(html, /no WeChat keys in \.env\.example/);
  });

  it('a plain objective with no structure still shows as it always did', () => {
    const html = dashboardHtml({ ...base, objective: 'fix the endpoint mismatches' }, esc);
    assert.match(html, /<p class="dobjective"><span class="muted">objective<\/span> fix the endpoint mismatches<\/p>/);
  });
});

describe('the tabs stop repeating each other', () => {
  const { dashboardHtml } = require('./dashboard');
  const { mapHtml } = require('./plan');
  const esc = (v) => String(v ?? '');
  const map = {
    ok: true, objective: 'make the admin screens reachable',
    objective_detail: { goal: 'Make the admin screens reachable', questions: [] },
    currency: { state: 'current', tree_head: 'd5221b41' },
    overview: { meta: { markers: { never_referenced: { count: 3, tier: 'A' } } },
                zones: [{ zone: 'lib/admin', slug: 'lib-admin', files: 2, findings_total: 3, by_marker: { never_referenced: 3 }, top: [] }],
                zone_edges: [] },
    plan: { tasks: [{ id: 't.a', title: 'lib/admin/x.ts: build', deliverables: [], execution: { write_scope: ['lib/admin/x.ts'] } }] },
  };

  it('the Dashboard is the work: no code picture, no findings-by-kind, no zone chart', () => {
    const html = dashboardHtml(map, esc);
    assert.ok(!html.includes('<svg'), 'the graph lives on the Map');
    assert.ok(!html.includes('Findings by marker') && !html.includes('Findings by kind'));
    assert.ok(!html.includes('<h3>Zones</h3>'));
    assert.match(html, /<h3>Tasks<\/h3>/, 'what it still owns');
    assert.match(html, /is on the <button data-tab="map" class="dlink">Map<\/button> tab/, 'and says where the rest went');
  });

  it('the Map is the code: the picture, what was found and where -- and none of the work', () => {
    const html = mapHtml(map, esc);
    assert.match(html, /<svg/);
    assert.match(html, /<h3>Findings by kind<\/h3>/);
    assert.match(html, /lib\/admin/);
    assert.ok(!html.includes('mnext'), 'the next step belongs to the Dashboard');
    assert.ok(!html.includes('objective:'), 'so does the objective');
    assert.ok(!html.includes('mnow'), 'and the run progress');
    assert.match(html, /1 task planned here/, 'the task badge moved with the graph');
  });

  it('the third tab says which plan it is', () => {
    const { TABS } = require('./at_shell');
    assert.equal(TABS.find((t) => t.id === 'plan').label, 'Chat plan');
  });
});
