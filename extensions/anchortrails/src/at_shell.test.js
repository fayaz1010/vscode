'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TABS, shellHtml } = require('./at_shell');

const DATA = {
  plan: {
    cursor: '3/6',
    playbook: 'develop',
    goal: 'Add products to Aozhen',
    steps: '1.DESIGN [x] | 3.BUILD [>] | 4.TEST [ ]',
  },
  surfaces: [{ id: 'drive', label: 'Computer use', inputs: ['text'], pack: ['browser_look'], active: true }],
  nodes: [{ name: 'HomePC', caps: ['browser', 'vault'] }],
  teams: { configured: true, cluster: 'oz', members: [{ name: 'Moh', role: 'owner' }] },
  vault: { initialised: true, access: 'desktop_vault_status', keys: { util_ai: true }, entries: 2 },
  models: { default: 'grok-4.6', connected: true, via: ['util-ai'], slugs: ['grok-4.6'] },
  workspace: { id: 'aozhen', path: 'D:\\aozhen' },
  credits: { signed_in: true, unlimited: true, email: 'dev@local' },
};

describe('AT middle shell', () => {
  it('ships every dest tab, Dashboard then Map then Plan', () => {
    assert.deepEqual(TABS.map((t) => t.id), [
      'dashboard', 'map', 'plan', 'models', 'tools', 'nodes', 'teams', 'vault', 'workspace', 'settings',
    ]);
    const html = shellHtml(DATA, 'plan');
    for (const tab of TABS) {
      assert.match(html, new RegExp(`data-tab="${tab.id}"`));
    }
    assert.match(html, /id="plan" class="pane on"/);
    assert.match(html, /class="step now seedable"/);
    assert.match(html, /data-cmd="refresh"/);
    assert.match(html, /Refresh plan/);
    assert.match(html, /\/plan refresh/);
    assert.match(html, /<h3>Stack<\/h3>/);
    assert.match(html, /Languages/);
    assert.match(html, /DB env/);
    assert.match(html, /data-kind="plan"/);
    assert.match(html, /data-kind="step"/);
    assert.match(html, /data-kind="tool"/);
    assert.match(html, /data-kind="node"/);
    assert.match(html, /data-kind="member"/);
    assert.match(html, /Other plans/);
    assert.match(html, /No other plans yet/);
    assert.ok(!html.includes('desktop_vault_get'));
  });

  it('Map and Dashboard are their own tabs, painted from the same envelope', () => {
    const MAP = {
      ok: true, repo: '/r/backend', can_refresh: true, can_plan: true, can_apply: true,
      currency: { state: 'current', tree_head: 'abcdef1234' }, objective: 'ship it',
      overview: {
        meta: { repo: '/r/backend', status: 'complete', findings_total: 3, findings_actionable: 2, markers: { stub_body: { tier: 'A', count: 2 } } },
        zones: [{ zone: 'src', colour: 0.5, findings_total: 2, files: 4, by_marker: { stub_body: 2 }, by_marker_all: { stub_body: 3 },
          top: [{ marker: 'stub_body', symbol: 'dispose', path: 'src/a.ts', line: 7, severity: 0.5 }] }],
      },
      plan: { plan_id: 'p', revision: 1, tasks: [{ id: 't.src-a.ts', deliverables: ['dispose (stub_body, line 7)'],
        execution: { write_scope: ['src/a.ts'], budgets: { max_cost_usd: 0.1, max_runtime_seconds: 120, max_attempts: 3 } },
        acceptance: [{ check: 'repo-dash reports no `stub_body` for `dispose` in `src/a.ts`' }] }] },
      run: { status: 'complete', cost_usd: 0.02, seconds: 90, results: [{ task: 't.src-a.ts', outcome: 'closed', attempts: 1, cost_usd: 0.02 }] },
    };
    const dash = shellHtml({ ...DATA, map: MAP, focusTask: 't.src-a.ts' }, 'dashboard');
    assert.match(dash, /id="dashboard" class="pane on"/);
    assert.match(dash, /class="dash/);
    assert.match(dash, /objective<\/span> ship it/);
    assert.match(dash, /data-task="t\.src-a\.ts"/);
    assert.match(dash, /class="dtask m-closed on"/, 'show-task marks its row');
    assert.match(dash, /data-cmd="chat" data-id="\/run"/);
    const map = shellHtml({ ...DATA, map: MAP }, 'map');
    assert.match(map, /id="map" class="pane on"/);
    assert.match(map, /<div class="mgraph"/, 'the graphical map is on the Map tab');
    assert.match(map, /svg\.addEventListener\('wheel'/, 'wheel zoom');
    assert.match(map, /classList\.toggle\('full'\)/, 'full screen toggle');
    assert.match(map, /e\.key === 'Escape'/, 'Esc leaves full screen');
    assert.match(map, /\.mgraph\.full \{ position:fixed; inset:0;/);
    assert.match(map, /<section class="map"/);
    assert.match(map, /data-cmd="open-code" data-id="src\/a\.ts#7"/);
    const all = shellHtml({ ...DATA, map: MAP }, 'plan');
    const planPane = all.slice(all.indexOf('<div id="plan"'), all.indexOf('<div id="models"'));
    assert.doesNotMatch(planPane, /<section class="map"/, 'the map left the Plan tab');
    assert.match(planPane, /<h3>Stack<\/h3>/);
    assert.match(shellHtml(DATA, 'nowhere'), /id="dashboard" class="pane on"/, 'an unknown tab lands on the Dashboard');
  });

  it('paints Tools, Nodes, Teams, Vault, Models, Workspace', () => {
    const tools = shellHtml(DATA, 'tools');
    assert.match(tools, /id="tools" class="pane on"/);
    assert.match(tools, /Computer use/);
    assert.match(tools, /data-kind="tool"/);
    const nodes = shellHtml(DATA, 'nodes');
    assert.match(nodes, /HomePC/);
    assert.match(nodes, /data-kind="node"/);
    const teams = shellHtml(DATA, 'teams');
    assert.match(teams, /Moh/);
    assert.match(teams, /data-kind="member"/);
    assert.match(tools, /cmd: 'seed'/);
    const vault = shellHtml(DATA, 'vault');
    assert.match(vault, /Vault ready/);
    assert.ok(!vault.includes('sk-'));
    const models = shellHtml({
      ...DATA,
      models: {
        ...DATA.models,
        q: 'grok',
        hits: [{ id: 'x-ai/grok-4.20', name: 'Grok 4.20', prompt_per_m: 2, completion_per_m: 10 }],
        group: [{ slug: 'grok-4.6', name: 'Grok', prompt_per_m: 2 }],
        tasks: [{ task: 'plan', label: 'Plan', slug: 'grok-4.6', fallback: 'grok-4.6', allowed: ['grok-4.6'] }],
      },
    }, 'models');
    assert.match(models, /Search OpenRouter/);
    assert.match(models, /Add to group/);
    assert.match(models, /grok-4\.6/);
    const ws = shellHtml(DATA, 'workspace');
    assert.match(ws, /aozhen/);
    const settings = shellHtml(DATA, 'settings');
    assert.match(settings, /Credits/);
    assert.match(settings, /Unlimited/);
  });
});

describe('the graph loads like a stream', () => {
  it('the shell script asks for the level below on load, draws files into zones, opens a zone on click, and keeps the open zone across repaints', () => {
    const { shellHtml } = require('./at_shell');
    const html = shellHtml({ map: { ok: true, overview: { zones: [{ zone: 'lib', slug: 'lib', files: 2 }], zone_edges: [] } } }, 'map');
    assert.match(html, /cmd: 'graph', zone: zone \|\| ''/, 'asks the extension, never the bridge');
    assert.match(html, /ask\(''\);/, 'depth 1 for every zone as soon as the zones are drawn');
    assert.match(html, /drawFiles\(m\.data\)/);
    assert.match(html, /clickZone\(hit\);/, 'a click frames whatever was hit, and framing it opens it');
    assert.match(html, /if \(zone === openZone && file === openFile\) return;/, 'the view decides what is open at both levels, so a click and a wheel agree');
    assert.match(html, /vscode\.setState\(\{ \.\.\.saved, openZone, openFile \}\)/, 'both levels survive the five-second repaint');
    assert.match(html, /class="mload"/, 'a place to say how much has been read');
    assert.match(html, /symbols still being read/, 'partial answers are named as such');
  });
});

describe('the map is navigated by zoom', () => {
  const { shellHtml } = require('./at_shell');
  const html = () => shellHtml({ map: { ok: true, overview: { meta: {}, zones: [{ zone: 'lib', slug: 'lib', files: 3 }, { zone: 'lib/admin', slug: 'lib-admin', files: 2 }], zone_edges: [] } } }, 'map');

  it('zooming into a node steps inside it, and zooming out leaves it', () => {
    const h = html();
    assert.match(h, /share\(onZone\) > ENTER_ZONE/, 'far enough in on a node and the view enters it');
    assert.match(h, /share\(zoneAt\[zone\]\) < LEAVE_ZONE/, 'and leaves when it no longer fills the view');
    assert.match(h, /onView = \(\) => \{ rescale\(\); step\(\); \}/, 'every view change is judged, wheel or click');
  });

  it('a click frames the node -- it does not zoom twice and land somewhere else', () => {
    const h = html();
    assert.match(h, /clickZone = \(g\) => \{/);
    assert.match(h, /vb = \{ x: target\.cx - w \/ 2, y: target\.cy - h \/ 2, w, h \};\n        apply\(\);/);
    assert.ok(!/const w = W \/ 4; const h = H \/ 4;/.test(h), 'the old competing zoom-to-quarter is gone');
  });

  it('labels hold their size on screen at every zoom', () => {
    const h = html();
    assert.match(h, /text\[data-fs\]/, 'every label carries its base size');
    assert.match(h, /Number\(t\.dataset\.fs \|\| 9\) \* k/, 'and is scaled by the view factor');
    const { graphSvg } = require('./map_graph');
    const svg = graphSvg({ meta: {}, zones: [{ zone: 'lib', slug: 'lib', files: 3, findings_total: 1, colour: 0.4 }], zone_edges: [] }, (v) => String(v ?? ''), { tasksByZone: { lib: 2 } });
    assert.match(svg, /font-size="9" data-fs="9"/, 'zone labels');
    assert.match(svg, /font-size="5\.5" data-fs="5\.5"/, 'and the task badge');
    assert.match(svg, /vector-effect="non-scaling-stroke"/, 'outlines keep their weight too');
  });

  it('the interior is drawn inside the node, not over the map', () => {
    const h = html();
    assert.match(h, /const R = z\.r;/, "the zone's own radius bounds its contents");
    assert.match(h, /layer\.setAttribute\('opacity', '0\.12'\)/, 'the scattered dots step back');
    assert.ok(!/fill: '#0f1218', 'fill-opacity': '0\.92'/.test(h), 'no opaque overlay circle any more');
  });
});

describe('the drill goes all the way down, and the map can point', () => {
  const { shellHtml } = require('./at_shell');
  const html = () => shellHtml({ map: { ok: true, overview: { meta: {}, zones: [{ zone: 'lib', slug: 'lib', files: 3 }, { zone: 'lib/admin', slug: 'lib-admin', files: 2 }], zone_edges: [] } } }, 'map');

  it('keeps going past the zone: a file opens when it fills the view', () => {
    const h = html();
    assert.match(h, /const ENTER_FILE = 0\.22; const LEAVE_FILE = 0\.12;/, 'files have their own threshold');
    assert.match(h, /const onFile = focus\(Object\.values\(fileAt\)\);/, 'and are candidates once a zone is open');
    assert.match(h, /if \(onFile && share\(onFile\) > ENTER_FILE\) file = onFile\.key;/);
    assert.match(h, /openFile === f\.path/, 'the open file is drawn differently');
    assert.match(h, /if \(isOpen\) g\.appendChild\(label\(sx, syy - rad - R \* 0\.012, sy\.label, 2\.6/, 'its symbols get names');
  });

  it('what the view is inside of, not what is nearest the centre', () => {
    // The wheel zooms about the CURSOR, so the node being zoomed into sits
    // off-centre; a centre test never fired and the drill stopped at level one.
    const h = html();
    assert.match(h, /if \(d > it\.r \+ vb\.w \* 0\.28\) return;/, 'a margin around the view, not a point');
    assert.match(h, /const score = d - it\.r;/, 'prefer the thing we are most inside of');
    assert.ok(!/const centred = /.test(h), 'the old centre test is gone');
  });

  it('hover says what a thing is, and offers it to the chat as context', () => {
    const h = html();
    assert.match(h, /svg\.addEventListener\('mousemove', \(e\) => describe\(e\.target\)\);/);
    assert.match(h, /const rel = related\(s\.sym\.id\);/, 'a symbol carries what it calls');
    assert.match(h, /use as context →/);
    assert.match(h, /cmd: 'chat', id: 'In ' \+ hoverCtx \+ ', ', draft: true/, 'a draft, so the person says what to do with it');
    const { graphSvg } = require('./map_graph');
    assert.match(graphSvg({ meta: {}, zones: [{ zone: 'lib', slug: 'lib', files: 2 }], zone_edges: [] }, (v) => String(v ?? '')), /class="mhover"/);
  });

  it('a double click opens the code; a single click goes in a level', () => {
    const h = html();
    assert.match(h, /if \(e\.detail > 1 && \(sym \|\| file\)\)/);
    assert.match(h, /cmd: 'open-code', id: path \+ '#'/);
    assert.match(h, /clickZone\(hit\);/);
  });
});
