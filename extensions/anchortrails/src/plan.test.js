'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VIEW_ID, markOf, labelOf, stepListHtml, rowsFromPlan, gateSteps, gatePlan, stackHtml, STACK_KEYS } = require('./plan');

const SAMPLE = {
  playbook: 'develop',
  cursor: '3/6',
  goal: 'Add products to Aozhen from AU fashion scans',
  card: 'TASK develop 3/6\ngoal: Add products',
  steps: '1.DESIGN lock [x] | 2.PLAN split [x] | 3.BUILD one task [>] | 4.TEST browser [ ]',
};

describe('plan panel', () => {
  it('uses the dest view id', () => {
    assert.equal(VIEW_ID, 'anchortrails.plan');
  });

  it('marks current / done / todo / error from the card steps', () => {
    assert.equal(markOf('3.BUILD one task [>]'), 'now');
    assert.equal(markOf('1.DESIGN lock [x]'), 'done');
    assert.equal(markOf('4.TEST browser [ ]'), 'todo');
    assert.equal(markOf('4.TEST browser [!]'), 'error');
    assert.equal(labelOf('3.BUILD one task [>]'), '3.BUILD one task');
    assert.equal(labelOf('4.TEST browser [!]'), '4.TEST browser');
  });

  it('renders playbook cursor + one row per step', () => {
    const rows = rowsFromPlan(SAMPLE);
    assert.equal(rows[0].kind, 'head');
    assert.equal(rows[0].label, 'develop 3/6');
    assert.match(rows[0].description, /Aozhen/);
    assert.equal(rows.length, 5);
    assert.equal(rows[3].mark, 'now');
    assert.equal(rows[3].description, 'now');
    assert.equal(rows[1].mark, 'done');
    assert.equal(rows[4].mark, 'todo');
  });

  it('paints checkbox rows with strike-done and error marks', () => {
    const html = stepListHtml('1.DESIGN [x] | 3.BUILD [>] | 4.TEST [ ] | 5.SHIP [!]');
    assert.match(html, /class="step done seedable"/);
    assert.match(html, /class="step now seedable"/);
    assert.match(html, /class="step todo seedable"/);
    assert.match(html, /class="step error seedable"/);
    assert.match(html, /text-decoration: line-through|step done/);
  });

  it('refuses green on a failing checkErrors and does not auto-green a clean check', () => {
    const steps = SAMPLE.steps;
    assert.equal(
      gateSteps(steps, { ok: false, errors: 2 }, '3/6'),
      '1.DESIGN lock [x] | 2.PLAN split [x] | 3.BUILD one task [!] | 4.TEST browser [ ]',
    );
    assert.equal(gateSteps(steps, { ok: true, errors: 0 }, '3/6'), steps);
    const greened = '1.DESIGN lock [x] | 2.PLAN split [x] | 3.BUILD one task [x] | 4.TEST browser [ ]';
    const gated = gatePlan({ ...SAMPLE, steps: greened }, { ok: false, errors: 1 });
    assert.match(gated.steps, /BUILD one task \[!\]/);
    assert.ok(!gated.steps.includes('BUILD one task [x]'));
  });

  it('always paints a Stack section even when fields are empty', () => {
    const html = stackHtml(null);
    assert.match(html, /<h3>Stack<\/h3>/);
    assert.equal((html.match(/class="k"/g) || []).length, STACK_KEYS.length);
    assert.match(html, /Languages/);
    assert.match(html, /DB env/);
    assert.match(html, /Last push/);
    assert.match(html, /Workers/);
    assert.match(html, /Blobs/);
    const filled = stackHtml({ languages: 'Python', db_env: 'DATABASE_URL', git: 'https://github.com/oz/shop' });
    assert.match(filled, /Python/);
    assert.match(filled, /DATABASE_URL/);
    assert.ok(!filled.includes('sk-'));
  });

  it('shows an empty row when Layer M has no card', () => {
    const rows = rowsFromPlan({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'empty');
    assert.match(rows[0].label, /No plan/);
  });
});

describe('the map beside the stack', () => {
  const { mapHtml, taskIndex } = require('./plan');
  const esc = (v) => String(v ?? '');
  const MAP = {
    ok: true, repo: '/r/backend',
    overview: {
      meta: { repo: '/r/backend', status: 'complete', findings_total: 24, findings_actionable: 20 },
      zones: [{
        zone: 'src/services', colour: 0.8, findings_total: 2, files: 5,
        top: [
          { marker: 'never_referenced', symbol: 'sendPaymentReminder', path: 'src/services/email.ts', line_start: 115, severity: 0.6 },
          { marker: 'config_orphan', symbol: 'GEMINI_KEY', path: 'src/config/gemini.ts', line_start: 3, severity: 0.51 },
          // compile.py's zone `top` rows name the line `line`, not `line_start`; a real map on
          // HomePC linked every finding to :1 because only the second spelling was read.
          { marker: 'stub_body', symbol: 'dispose', path: 'src/services/socket.ts', line: 142, severity: 0.7 },
        ],
      }],
    },
    plan: { plan_id: 'p', revision: 1, tasks: [{
      id: 't.src-services-email.ts',
      acceptance: [{ check: 'repo-dash reports no `never_referenced` for `sendPaymentReminder` in `src/services/email.ts`' }],
    }] },
  };

  it('a folder with no map says so in one muted line, not an error', () => {
    const html = mapHtml({ ok: false, reason: 'no map at /x' }, esc);
    assert.match(html, /class="muted">no map at \/x/);
    assert.doesNotMatch(html, /class="warn"/);
  });

  it('every finding links to its file at its line through the generic data-cmd handler', () => {
    const html = mapHtml(MAP, esc);
    assert.match(html, /data-cmd="open-code" data-id="src\/services\/email\.ts#115"/);
    assert.match(html, /data-cmd="open-code" data-id="src\/config\/gemini\.ts#3"/);
    assert.match(html, /data-cmd="open-code" data-id="src\/services\/socket\.ts#142"/, 'a `line` row links to its line, not :1');
  });

  it('a finding the plan owns links to its task; one it does not has no task link', () => {
    const html = mapHtml(MAP, esc);
    assert.match(html, /data-cmd="show-task" data-task="t\.src-services-email\.ts"/);
    // gemini.ts has no task in this plan
    const gemini = html.slice(html.indexOf('gemini.ts'));
    assert.doesNotMatch(gemini.slice(0, 300), /show-task/);
  });

  it('the join reads the acceptance sentence itself, so the plan needs no extra field', () => {
    const idx = taskIndex(MAP.plan);
    assert.equal(idx['never_referenced|src/services/email.ts|sendPaymentReminder'], 't.src-services-email.ts');
  });

  it('the head says how much is actionable and whether a plan exists', () => {
    assert.match(mapHtml(MAP, esc), /20 actionable of 24 · 1 planned task · complete/);
  });

  it('a task the run closed is marked on its finding; a failed one says why', () => {
    const { runIndex, runMark, runSummary } = require('./plan');
    const run = { dry_run: false, cost_usd: 0.0234, results: [
      { task: 't.src-services-email.ts', outcome: 'closed', cost_usd: 0.003 },
      { task: 't.other', outcome: 'failed', why: 'review rejected: gamed the marker' },
    ] };
    assert.equal(runIndex(run)['t.other'].outcome, 'failed');
    assert.equal(runMark(runIndex(run)['t.other']).mark, '✗');
    assert.equal(runMark(undefined).mark, '', 'no run row: no mark, the plain link');
    assert.equal(runSummary(run), 'run: 1 closed · 1 failed · $0.02');
    assert.equal(runSummary({ dry_run: true, results: [] }), '', 'a dry run is not a run');
    const html = mapHtml({ ...MAP, run }, esc);
    assert.match(html, /class="mtask m-closed" title="closed">✓ src-services-email\.ts</);
    assert.match(html, /run: 1 closed · 1 failed · \$0\.02/);
  });

  it('a map that is being rebuilt says which stage it is on, and offers Re-map only when the bridge can', () => {
    const building = JSON.parse(JSON.stringify(MAP));
    building.overview.meta = { ...building.overview.meta, status: 'streaming', stages_done: 3, stages_total: 6, stage: 'Tier A: absence' };
    const html = mapHtml({ ...building, can_refresh: true }, esc);
    assert.match(html, /mapping 3\/6 · Tier A: absence/);
    assert.match(html, /<section class="map building">/);
    assert.match(html, /data-cmd="chat" data-id="\/map"/, 'Re-map puts /map into the chat');
    assert.doesNotMatch(mapHtml(MAP, esc), /data-id="\/map"/, 'no mapper declared: no button');
    assert.match(mapHtml({ ok: false, reason: 'no map', can_refresh: true }, esc), /data-id="\/map"/, 'no map yet, but one can be made: the button is the way to make it');
    const runnable = mapHtml({ ...MAP, can_apply: true }, esc);
    assert.match(runnable, /data-cmd="chat" data-id="\/run" class="refresh runplan">Run plan</, 'Run plan puts /run into the chat');
    const live = mapHtml({ ...MAP, can_apply: true, running: true }, esc);
    assert.match(live, /data-id="\/run status"[^>]*>Running… \(status\)</, 'while a run goes, the button reads the run back');
    assert.match(live, /run in progress/);
    assert.doesNotMatch(mapHtml(MAP, esc), /runplan/, 'no plan or no mapper: no Run');
  });

  it('says whether the map is current, what the plan is for, and asks for the objective as a draft', () => {
    const stale = { ...MAP, can_refresh: true, can_plan: true, project: { root: '/r/backend' },
      currency: { state: 'stale', map_head: 'aaaaaaaa1111', tree_head: 'bbbbbbbb2222' } };
    let html = mapHtml(stale, esc);
    assert.match(html, /map from aaaaaaaa · tree at bbbbbbbb — stale/);
    assert.match(html, /data-id="\/map" class="refresh remap">Re-map \(stale\)</);
    assert.match(html, /data-id="\/map plan " data-draft="1"[^>]*>Plan… \(needs an objective\)</, 'no objective: the button leaves the sentence to the person');
    assert.match(html, /no objective yet/);
    const current = { ...stale, currency: { state: 'current', tree_head: 'bbbbbbbb2222' }, objective: 'finish the panel' };
    html = mapHtml(current, esc);
    assert.match(html, /map current at bbbbbbbb/);
    assert.match(html, /data-id="\/map force" class="refresh remap">Re-map</, 'a current map is only rebuilt when forced');
    assert.match(html, /objective: finish the panel/);
    assert.match(html, /data-id="\/map plan" class="refresh planbtn">Re-plan</, 'an objective and a plan: re-plan');
    const none = { ok: false, reason: 'no map for /r/backend yet — /map in @at builds one', can_refresh: true, currency: { state: 'none' } };
    html = mapHtml(none, esc);
    assert.match(html, /Map this folder/);
    const busy = { ...current, mapping: true, planning: true };
    html = mapHtml(busy, esc);
    assert.match(html, /Mapping…/);
    assert.match(html, /Planning…/);
  });
});

describe('the map is of the repository: grey where unread, green where clean', () => {
  const { mapHtml, greyZonesHtml } = require('./plan');
  const esc = (v) => String(v ?? '');
  const MAP = {
    ok: true, repo: '/r/code-oss',
    overview: {
      meta: { repo: '/r/code-oss', status: 'complete', findings_total: 2, findings_actionable: 1,
        files_total_repo: 14197, files_analysed: 46, zones_total: 4, zones_analysed: 2 },
      zones: [
        { zone: 'extensions/anchortrails/src', colour: 0.75, findings_total: 2, files: 40, analysed: true,
          top: [{ marker: 'bus_factor', symbol: 'plan.js', path: 'extensions/anchortrails/src/plan.js', line: 1, severity: 0.75 }] },
        { zone: 'extensions/anchortrails/test', colour: 0, findings_total: 0, files: 6, analysed: true, top: [] },
        { zone: 'src/vs/workbench', colour: 0, findings_total: 0, files: 9000, analysed: false, queued: false, top: [] },
        { zone: 'extensions/git', colour: 0, findings_total: 0, files: 151, analysed: false, queued: true, top: [] },
      ],
    },
  };

  it('says how much of the repository has been read, and shows every kind of zone', () => {
    const html = mapHtml(MAP, esc);
    assert.match(html, /46 of 14,197 files read/);
    assert.match(html, /<b>extensions\/anchortrails\/src<\/b>/, 'a flagged zone, coloured');
    assert.match(html, /class="mclean"[^>]*><span class="mdot" style="background:#3fb950"><\/span><b>extensions\/anchortrails\/test<\/b><span class="muted"> · 6 files · nothing found/, 'analysed and clean: green, said once');
    assert.match(html, /<div class="mgraph"><svg /, 'the graphical map sits above the zone list');
    assert.match(html, /not analysed yet · 2 zones · 9,151 files · 1 queued/, 'the unread part, in one line');
    assert.match(html, /<b>src<\/b><span class="muted"> · 1 zone · 9,000 files/, 'grouped under its top-level directory');
    assert.match(html, /class="mgrey queued"><span class="mdot"><\/span>extensions\/git<span class="muted"> · 151 · in focus, not read/);
    assert.doesNotMatch(html, /Nothing flagged/);
  });

  it('a shell is structure only: not mapping, not complete, waiting to be aimed', () => {
    const shell = { ...MAP, overview: { ...MAP.overview, meta: { ...MAP.overview.meta, status: 'shell', files_analysed: 0, findings_total: 0, findings_actionable: 0 },
      zones: MAP.overview.zones.map((z) => ({ ...z, analysed: false, findings_total: 0, top: [] })) } };
    const html = mapHtml(shell, esc);
    assert.match(html, /<section class="map shell">/);
    assert.match(html, /structure only — nothing analysed yet/);
    assert.doesNotMatch(html, /mapping \d/);
    assert.match(html, /not analysed yet · 4 zones/);
    const mapping = mapHtml({ ...shell, mapping: true }, esc);
    assert.match(mapping, /· 151 · queued/, 'while mapping, a queued zone says so');
  });

  it('a map from before the flag existed treats every zone as analysed', () => {
    const legacy = { ...MAP, overview: { meta: { status: 'complete', findings_total: 0, findings_actionable: 0 },
      zones: [{ zone: 'src', colour: 0, findings_total: 0, files: 3, top: [] }] } };
    const html = mapHtml(legacy, esc);
    assert.match(html, /class="mclean"/);
    assert.doesNotMatch(html, /not analysed yet/);
    assert.equal(greyZonesHtml([], esc), '');
  });
});
