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
