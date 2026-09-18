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
  it('ships every dest tab, Plan first', () => {
    assert.deepEqual(TABS.map((t) => t.id), [
      'plan', 'models', 'tools', 'nodes', 'teams', 'vault', 'workspace', 'settings',
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
