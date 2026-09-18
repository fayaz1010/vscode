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
