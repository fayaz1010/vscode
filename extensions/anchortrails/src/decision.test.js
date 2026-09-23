'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { openList, route, grow, taskBrief, cliAgent, cliAssign, fromCli } = require('./decision');

const PLAN = [
  { id: 't.a', steps: [{ id: '1', text: 'read the guard' }, { id: '2', text: 'edit the file' }] },
  { id: 't.b', steps: [{ id: '3', text: 'document the env' }] },
];

describe('a plan is a list of tasks', () => {
  it('scores the tasks, then opens the chosen task', () => {
    const picked = route(openList(PLAN), { 't.a': 0.8, 't.b': 0.1 });
    assert.deepEqual(picked.run, ['t.a']);
    assert.equal(picked.call_model, false);
    assert.deepEqual(picked.open.map((s) => s.id), ['1', '2']);
    const step = route(picked.open, { 1: 0.2, 2: 0.9 });
    assert.deepEqual(step.run, ['2']);
  });

  it('adds a missing task as its own list of steps', () => {
    assert.equal(route(PLAN, { 't.a': 0.1, 't.b': 0.1 }).call_model, true);
    const grown = grow(PLAN, { id: 't.c', steps: [{ id: '4', text: 'open the admin page' }] });
    assert.deepEqual(grown.map((t) => t.id), ['t.a', 't.b', 't.c']);
    assert.equal(grown[2].steps[0].id, '4');
  });

  it('a chosen task is a brief for one CLI', () => {
    const brief = taskBrief(PLAN[0], 'continue the panel');
    assert.match(brief, /ONE TASK/);
    assert.match(brief, /Do not invent a second plan/);
    assert.match(brief, /read the guard/);
    assert.match(brief, /edit the file/);
    assert.equal(cliAgent(PLAN[0]), 'auto');
    assert.equal(cliAgent({ id: 't.b', steps: [{ id: '3', tools: ['claude'] }] }), 'claude');
    const grok = {
      id: 't.g',
      flags: ['--model', 'grok', '--dangerously-skip-permissions'],
      steps: [{ id: '1', text: 'edit the file', tools: ['claude'] }],
    };
    const assigned = cliAssign(grok, 'continue');
    assert.equal(assigned.agent, 'cursor');
    assert.deepEqual(assigned.flags, ['--model', 'grok']);
  });

  it('a reply that is not a CLI result is null', () => {
    assert.equal(fromCli(null, 'edit'), null);
    assert.equal(fromCli('not json', 'edit'), null);
    assert.equal(fromCli({ ok: false, error: 'broke' }, 'edit'), null);
    assert.equal(fromCli({ missing: true, agent: 'claude' }, 'edit'), null);
    assert.equal(fromCli({ ok: true, agent: 'claude', stdout: 'edited' }, 'edit').text, 'edited');
  });

  it('the brief names the files the task may change', () => {
    const brief = taskBrief({
      id: 't.a',
      execution: { write_scope: ['src/a.js'] },
      steps: [{ id: '1', text: 'edit the file' }],
    }, '');
    assert.match(brief, /files you may change: src\/a\.js/);
    assert.match(taskBrief({ id: 't.b', steps: [] }, ''), /files you may change: none/);
  });

  it('adds a missing step under that task only', () => {
    const grown = grow(PLAN, { id: '5', text: 'look again' }, 't.a');
    assert.deepEqual(openList(grown, 't.a').map((s) => s.id), ['1', '2', '5']);
    assert.deepEqual(openList(grown, 't.b').map((s) => s.id), ['3']);
  });
});
