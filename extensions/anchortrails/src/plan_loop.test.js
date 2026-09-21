'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDone,
  isOpen,
  driveKind,
  advanceLocal,
  nextAhead,
  wantsObjective,
  isQuietPrompt,
  isRefreshPrompt,
} = require('./plan_loop');

const OPEN = {
  goal: 'Ship dest drive loop',
  cursor: '1/3',
  playbook: 'develop',
  steps: '1.DESIGN lock [>] | 2.BUILD loop [ ] | 3.TEST verify [ ]',
};

describe('plan drive loop', () => {
  it('does not treat greet or /plan-class quiet lines as drive', () => {
    assert.equal(isQuietPrompt('hi'), true);
    assert.equal(isQuietPrompt('thanks!'), true);
    assert.equal(isQuietPrompt('stop'), true);
    assert.equal(isQuietPrompt('implement the launch plan'), false);
    assert.equal(driveKind('hi', { plan: OPEN, task_class: 'plan' }), null);
    assert.equal(isRefreshPrompt('refresh'), true);
    assert.equal(driveKind('refresh', { plan: OPEN, task_class: 'implement' }), null);
    assert.equal(driveKind('refresh the plan', { plan: OPEN, task_class: 'develop' }), null);
    assert.equal(isRefreshPrompt('refresh the models list'), false);
  });

  it('drives the session card when the user asks to finish the objective', () => {
    assert.equal(wantsObjective('implement the launch plan'), true);
    assert.equal(driveKind('continue the plan until done', { plan: OPEN }), 'session');
    assert.equal(driveKind('finish the inherited objective', {
      plan: OPEN,
      task_class: 'implement',
    }), 'session');
  });

  it('does not steal leftover develop work for a research ask', () => {
    assert.equal(driveKind('summarise this clip', {
      plan: OPEN,
      task_class: 'plan',
    }), null);
  });

  it('drives computer-use on the turn card, not leftover BUILD', () => {
    const turn = {
      goal: 'open chrome and go to gmail',
      cursor: '1/6',
      playbook: 'computer',
      steps: 'Replay skill/autoflow if this UI path is known [>] | browser_look [ ]',
    };
    assert.equal(driveKind('open chrome and go to gmail', {
      plan: OPEN,
      task_class: 'computer',
      turn,
    }), 'computer');
    assert.equal(driveKind('click the login button', {
      plan: OPEN,
      task_class: 'computer',
      turn,
    }), 'computer');
    const line = nextAhead(turn);
    assert.match(line, /on screen/);
    assert.match(line, /leftover BUILD/);
    assert.ok(!line.includes('checkErrors'));
  });

  it('greens the current step only after a clean check, then opens the next', () => {
    const mid = advanceLocal(OPEN, { ok: true, errors: 0 });
    assert.match(mid.steps, /DESIGN lock \[x\]/);
    assert.match(mid.steps, /BUILD loop \[>\]/);
    assert.equal(mid.cursor, '2/3');
    assert.equal(isDone(mid), false);
    assert.equal(isOpen(mid), true);

    const last = advanceLocal(advanceLocal(mid, { ok: true, errors: 0 }), { ok: true, errors: 0 });
    assert.equal(isDone(last), true);
    assert.equal(last.cursor, '3/3');
  });

  it('keeps the step red when checkErrors fails', () => {
    const out = advanceLocal(OPEN, { ok: false, errors: 2 });
    assert.match(out.steps, /DESIGN lock \[!\]/);
    assert.equal(isDone(out), false);
  });

  it('continue-ahead names the goal and the current [>] step', () => {
    const line = nextAhead(OPEN);
    assert.match(line, /Ship dest drive loop/);
    assert.match(line, /DESIGN lock/);
    assert.match(line, /Do not wait for another prompt/);
  });
});

describe('finishPlan', () => {
  it('marks every step done and moves the cursor to the end', () => {
    const { finishPlan } = require('./plan_loop');
    const out = finishPlan({ goal: 'g', cursor: '1/3', steps: '1.LOOK [>] | 2.ACT [ ] | 3.VERIFY [ ]' });
    assert.equal(out.steps, '1.LOOK [x] | 2.ACT [x] | 3.VERIFY [x]');
    assert.equal(out.cursor, '3/3');
    assert.equal(out.goal, 'g');
    assert.deepEqual(finishPlan({ goal: 'g' }), { goal: 'g' });
    assert.deepEqual(finishPlan(null), {});
  });
});
