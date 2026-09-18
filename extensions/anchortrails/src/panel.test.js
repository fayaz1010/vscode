'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  VIEWS,
  rowsFromPlanView,
  rowsFromNodes,
  rowsFromTeams,
  rowsFromVault,
  rowsFromModels,
  rowsFromWorkspace,
} = require('./panel');

describe('AT panel views', () => {
  it('registers plan, nodes, teams, vault, models, workspace', () => {
    const { PLAN_VIEW } = require('./panel');
    assert.deepEqual(Object.keys(VIEWS).sort(), [
      'models', 'nodes', 'teams', 'vault', 'workspace',
    ]);
    assert.equal(PLAN_VIEW, 'anchortrails.plan');
    assert.equal(VIEWS.teams, 'anchortrails.teams');
    assert.equal(VIEWS.vault, 'anchortrails.vault');
  });

  it('shows MUWT steps plus Clustry tasks on Plan', () => {
    const rows = rowsFromPlanView(
      { playbook: 'develop', cursor: '3/6', goal: 'Aozhen', steps: '1.DESIGN [x] | 2.BUILD [>]' },
      [{ title: 'Fashion formula', status: 'open', assignee: 'at' }],
    );
    assert.equal(rows[0].label, 'develop 3/6');
    assert.ok(rows.some((r) => r.kind === 'task' && r.label === 'Fashion formula'));
  });

  it('lists mesh nodes without host or ip fields', () => {
    const rows = rowsFromNodes([{ name: 'HomePC', caps: ['browser', 'vault'] }]);
    assert.equal(rows[0].label, 'HomePC');
    assert.match(rows[0].description, /browser/);
    assert.ok(!JSON.stringify(rows).includes('host'));
    assert.ok(!JSON.stringify(rows).includes('127.0.0.1'));
  });

  it('lists Clustry members as the team roster', () => {
    const rows = rowsFromTeams({
      configured: true,
      cluster: 'oz',
      members: [{ name: 'Moh', role: 'owner', is_agent: false }],
    });
    assert.equal(rows[1].label, 'Moh');
    assert.equal(rows[1].description, 'owner');
  });

  it('vault lists key connections without values', () => {
    const rows = rowsFromVault({
      initialised: true,
      keys: { util_ai: true, vault: true, env: false },
      connections: [
        { id: 'openrouter_api_key', label: 'OpenRouter API key', connected: true, via: ['vault'] },
      ],
      recipients: [],
    });
    assert.ok(rows.some((r) => r.label === 'OpenRouter API key' && r.description === 'vault'));
    assert.ok(!JSON.stringify(rows).includes('sk-'));
  });

  it('vault settings never include a secret value', () => {
    const rows = rowsFromVault({
      initialised: true,
      this_device: 'HomePC',
      access: 'desktop_vault_status',
      rule: 'never desktop_vault_get; keys stay on the node',
      keys: { util_ai: true, vault: true, env: false },
      entries: 4,
      cold_entries: 1,
      device_enrolled: true,
      recipients: [{ id: 'device:HomePC', kind: 'device', label: 'HomePC', tiers: ['hot'] }],
    });
    const dumped = JSON.stringify(rows);
    assert.match(dumped, /util-ai/);
    assert.match(dumped, /desktop_vault_status/);
    assert.ok(!dumped.includes('sk-'));
    assert.ok(!dumped.includes('desktop_vault_get') || dumped.includes('never desktop_vault_get'));
    assert.ok(!dumped.includes('openrouter_api_key'));
  });

  it('models lists assign slugs connected via keys', () => {
    const rows = rowsFromModels({
      default: 'assign()',
      slugs: ['grok-4.6', 'claude-sonnet-5'],
      connected: true,
      via: ['vault'],
    });
    assert.equal(rows[0].label, 'assign()');
    assert.equal(rows[0].description, 'vault');
    assert.equal(rows[1].label, 'grok-4.6');
    assert.equal(rows[1].description, 'vault');
  });

  it('workspace shows the bound folder, not the repo dump', () => {
    const rows = rowsFromWorkspace(
      { id: 'aozhen', path: 'D:\\aozhen' },
      { tools: ['a', 'b'], rule: 'replay' },
      { tools: ['c'], rule: 'match' },
    );
    assert.equal(rows[0].label, 'aozhen');
    assert.equal(rows[0].description, 'D:\\aozhen');
    assert.match(rows[1].description, /2/);
  });
});
