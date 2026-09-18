'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { seedFrom } = require('./chat_seed');

describe('AT panel chat seeds', () => {
  it('sends implement for a live plan and a step', () => {
    const plan = seedFrom({
      kind: 'plan',
      goal: 'Ship dest seeds',
      cursor: '3/6',
      playbook: 'develop',
      steps: '1.DESIGN [x] | 3.BUILD loop [>] | 4.TEST [ ]',
    });
    assert.equal(plan.send, true);
    assert.match(plan.prompt, /implement this plan/);
    assert.match(plan.prompt, /Ship dest seeds/);
    assert.match(plan.prompt, /BUILD loop/);

    const step = seedFrom({
      kind: 'step',
      label: 'BUILD loop',
      goal: 'Ship dest seeds',
      mark: 'now',
    });
    assert.equal(step.send, true);
    assert.match(step.prompt, /BUILD loop/);
    assert.match(step.prompt, /Verify/);
  });

  it('pins a node hop and drafts instead of sending', () => {
    const seed = seedFrom({
      kind: 'node',
      label: 'Suns-MacBook-Air',
      description: 'browser · desktop',
    });
    assert.equal(seed.send, false);
    assert.equal(seed.hop, 'Suns-MacBook-Air');
    assert.match(seed.prompt, /personal_flow/);
    assert.match(seed.prompt, /AT Dest/);
    assert.ok(!seed.prompt.includes('sk-'));
  });

  it('drafts tools, members, models, vault, workspace with the right verbs', () => {
    assert.equal(seedFrom({ kind: 'tool', id: 'drive', label: 'Computer use', hint: 'Look then go.' }).surface, 'drive');
    assert.match(seedFrom({ kind: 'member', label: 'Moh', description: 'owner' }).prompt, /Clustry/);
    assert.match(seedFrom({ kind: 'model', label: 'grok-4.6' }).prompt, /assign slug grok-4.6/);
    assert.match(seedFrom({ kind: 'vault', label: 'OpenRouter API key' }).prompt, /desktop_vault_status/);
    assert.match(seedFrom({ kind: 'setting', label: 'Access', description: 'desktop_vault_status' }).prompt, /desktop_vault_status/);
    assert.match(seedFrom({ kind: 'setting', label: 'Skills', description: '3 · replay first' }).prompt, /browser_skill_replay/);
    assert.ok(seedFrom({ kind: 'vault', label: 'OpenRouter API key' }).prompt.includes('Never call desktop_vault_get'));
    assert.match(seedFrom({ kind: 'workspace', label: 'aozhen', description: 'D:\\aozhen' }).prompt, /aozhen/);
    assert.equal(seedFrom({ kind: 'history', goal: 'Old dest work', workspace: 'anchortrails' }).send, false);
    assert.equal(seedFrom({ kind: 'empty', label: 'No mesh nodes yet' }), null);
  });
});
