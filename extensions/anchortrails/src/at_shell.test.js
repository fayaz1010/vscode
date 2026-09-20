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
