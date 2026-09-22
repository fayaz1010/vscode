'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { streamJob, diffEvents } = require('./job_stream');

function stream() {
  const parts = [];
  return { parts, markdown: (s) => parts.push(s), progress: (s) => parts.push(`[${s}]`) };
}

describe('the chat keeps talking while a job runs', () => {
  it('a run streams task phases, closes with cost, the ship, and the end -- then stops', async () => {
    // Live: "/run" said "Run started" and then nothing for 40 minutes.
    const answers = [
      { running: true, progress: { task: 't.lib-admin-payments.ts', attempt: 1, phase: 'asking the model', model: 'x-ai/grok-4.6' }, run: { status: 'running', results: [] } },
      { running: true, progress: { task: 't.lib-admin-payments.ts', attempt: 1, phase: 'acceptance: typecheck and re-map' }, run: { status: 'running', results: [] } },
      { running: true, progress: { task: 't.lib-admin-logistics.ts', attempt: 1, phase: 'asking the model' }, run: { status: 'running', results: [{ task: 't.lib-admin-payments.ts', outcome: 'closed', attempts: 1, cost_usd: 0.0782 }] } },
      { running: false, shipping: true, run: { status: 'complete', closed: 2, failed: 0, cost_usd: 0.13, results: [{ task: 't.lib-admin-payments.ts', outcome: 'closed', attempts: 1, cost_usd: 0.0782 }, { task: 't.lib-admin-logistics.ts', outcome: 'closed', attempts: 1, cost_usd: 0.055 }] }, ship: { status: 'running', summary: 'build' } },
      { running: false, shipping: false, run: { status: 'complete', closed: 2, failed: 0, cost_usd: 0.13, results: [{ task: 't.lib-admin-payments.ts', outcome: 'closed', attempts: 1, cost_usd: 0.0782 }, { task: 't.lib-admin-logistics.ts', outcome: 'closed', attempts: 1, cost_usd: 0.055 }] }, ship: { status: 'deploy failed', summary: 'the host declined the deployment', branch: '' } },
    ];
    let i = 0;
    const client = { async map() { return answers[Math.min(i++, answers.length - 1)]; } };
    const response = stream();
    const waits = [];
    const out = await streamJob({ client, repo: 'D:\\aozhen', kind: 'run', response, pollMs: 7, sleep: async (ms) => waits.push(ms) });
    assert.equal(out.ended, 'done');
    const text = response.parts.join('\n');
    assert.match(text, /lib-admin-payments\.ts · attempt 1 · asking the model · x-ai\/grok-4\.6/);
    assert.match(text, /acceptance: typecheck and re-map/);
    assert.match(text, /✓ lib-admin-payments\.ts — closed after 1 attempt · \$0\.0782/);
    assert.match(text, /✓ lib-admin-logistics\.ts — closed/);
    assert.match(text, /run complete: 2 closed · \$0\.13/);
    assert.match(text, /ship: running — build/);
    assert.match(text, /ship: deploy failed — the host declined the deployment/);
    assert.match(text, /\[lib-admin-payments\.ts · asking the model\]/, 'the progress line names the task under the pen');
    assert.equal(client.map.length, 0);
    assert.equal(waits.length, 4, 'one wait between reads; none after the end');
    assert.equal(waits[0], 7);
  });

  it('a map streams its stages and files read, and ends when complete', async () => {
    const answers = [
      { mapping: true, overview: { meta: { stage: 'shell', stages_done: 1, stages_total: 6, files_analysed: 0, files_total_repo: 100 } } },
      { mapping: true, overview: { meta: { stage: 'markers', stages_done: 4, stages_total: 6, files_analysed: 97, files_total_repo: 100 } } },
      { mapping: false, overview: { meta: { stage: '', status: 'complete', stages_done: 6, stages_total: 6, files_analysed: 97, files_total_repo: 100, findings_total: 27, findings_actionable: 12 } } },
    ];
    let i = 0;
    const client = { async map() { return answers[Math.min(i++, answers.length - 1)]; } };
    const response = stream();
    const out = await streamJob({ client, repo: 'x', kind: 'map', response, sleep: async () => {} });
    assert.equal(out.ended, 'done');
    const text = response.parts.join('\n');
    assert.match(text, /stage: shell \(1\/6\)/);
    assert.match(text, /stage: markers \(4\/6\)/);
    assert.match(text, /97 of 100 files read/);
    assert.match(text, /map complete: 12 actionable of 27 findings/);
  });

  it('a plan says how many tasks landed; a job that never starts ends after two quiet reads; cancel stops it', async () => {
    let i = 0;
    const plan = { planning: false, plan: { tasks: [{ id: 't.a' }, { id: 't.b' }, { id: 't.c' }, { id: 't.d' }] } };
    const client = { async map() { i += 1; return plan; } };
    const response = stream();
    const out = await streamJob({ client, repo: 'x', kind: 'plan', response, sleep: async () => {} });
    assert.equal(out.ended, 'done');
    assert.match(response.parts.join('\n'), /plan: 4 tasks · a · b · c · …/);
    assert.ok(i <= 3);
    const token = { isCancellationRequested: true };
    const c = await streamJob({ client: { async map() { return { running: true }; } }, repo: 'x', kind: 'run', response: stream(), token, sleep: async () => {} });
    assert.equal(c.ended, 'cancelled');
    let t = 0;
    const slow = await streamJob({ client: { async map() { return { running: true }; } }, repo: 'x', kind: 'run', response: stream(), maxMs: 10, now: () => (t += 6), sleep: async () => {} });
    assert.equal(slow.ended, 'timeout');
  });

  it('diffEvents is quiet when nothing moved', () => {
    const m = { running: true, progress: { task: 't.x', attempt: 1, phase: 'p' }, run: { results: [] } };
    assert.deepEqual(diffEvents(m, m, 'run'), []);
  });
});
