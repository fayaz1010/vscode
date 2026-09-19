'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { planTag, planMarkdown } = require('./slash');

describe('dest /plan tag', () => {
  it('asks about the plan and treats refresh as a rescore', () => {
    assert.deepEqual(planTag({ prompt: '/plan' }), { kind: 'ask', rest: '' });
    assert.deepEqual(planTag({ prompt: '/plan why is BUILD blue' }), {
      kind: 'ask', rest: 'why is BUILD blue',
    });
    assert.deepEqual(planTag({ prompt: '/plan refresh' }), { kind: 'refresh', rest: '' });
    assert.deepEqual(planTag({ prompt: 'refresh' }), { kind: 'refresh', rest: '' });
    assert.deepEqual(planTag({ prompt: 'refresh the plan' }), { kind: 'refresh', rest: '' });
    assert.deepEqual(planTag({ prompt: 'update the plan' }), { kind: 'refresh', rest: '' });
    assert.equal(planTag({ prompt: 'refresh the models list' }), null);
    assert.deepEqual(planTag({ command: { name: 'refresh' }, prompt: '' }), {
      kind: 'refresh', rest: '',
    });
    assert.deepEqual(planTag({ command: { name: 'plan' }, prompt: 'refresh after edits' }), {
      kind: 'refresh', rest: 'after edits',
    });
    assert.equal(planTag({ prompt: 'implement checkout' }), null);
    assert.deepEqual(planTag({ prompt: '/map' }), { kind: 'map', rest: '' });
    assert.deepEqual(planTag({ command: { name: 'run' }, prompt: 'status' }), { kind: 'run', rest: 'status' });
    assert.deepEqual(planTag({ prompt: '/run' }), { kind: 'run', rest: '' });
    assert.equal(planTag({ prompt: 'run the tests' }), null, 'a sentence with run in it is not /run');
  });

  it('prints the goal and steps without leftover MUWT lock language by default', () => {
    const md = planMarkdown({
      cursor: '3/4',
      playbook: 'develop',
      goal: 'Ship dest editor + plan gate',
      steps: '1.DESIGN [x] | 3.BUILD [>] | 4.TEST [ ]',
      do: 'advance the goal; dest editor and terminal stay available',
    });
    assert.match(md, /Plan 3\/4/);
    assert.match(md, /Ship dest editor/);
    assert.match(md, /BUILD \[>\]/);
    assert.match(md, /advance the goal/);
    assert.match(md, /\*\*Stack\*\*/);
    assert.match(md, /Languages:/);
    assert.ok(!md.includes('desktop_vault_get'));
  });
});

describe('what the chat says for /map and /run', () => {
  const { mapActionMarkdown } = require('./slash');
  it('reports a start, and a refusal in the bridge\'s own words', () => {
    assert.match(mapActionMarkdown('map', { ok: true, started: true }), /Re-map started/);
    assert.match(mapActionMarkdown('map', { ok: false, reason: 'a re-map is already running (pid 7)' }), /already running \(pid 7\)/);
    assert.match(mapActionMarkdown('run', { ok: true, started: true }), /Run started/);
    assert.match(mapActionMarkdown('run', { ok: false, reason: 'no plan beside the map; plan first' }), /plan first/);
  });
  it('/run status lists every task with the run\'s verdict', () => {
    const md = mapActionMarkdown('status', { map: { run: { status: 'running', cost_usd: 0.02, results: [
      { task: 't.a', outcome: 'closed' }, { task: 't.b', outcome: 'failed', why: 'review rejected: gamed it' },
    ] } } });
    assert.match(md, /\*\*Running\*\* · run: 1 closed · 1 failed · \$0\.02/);
    assert.match(md, /✓ a — closed/);
    assert.match(md, /✗ b — failed: review rejected: gamed it/);
    assert.match(mapActionMarkdown('status', { map: { run: null } }), /No run yet/);
  });
});
