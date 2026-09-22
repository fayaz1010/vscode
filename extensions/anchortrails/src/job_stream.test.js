'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { streamJob, diffEvents } = require('./job_stream');

function stream() {
  const parts = [];
  return { parts, markdown: (s) => parts.push(s), progress: (s) => parts.push(`[${s}]`) };
}

// A chat that understands progressTask: each line stays "spinning" until its
// thenable settles, which is what the UI draws a spinner for.
function taskStream() {
  const lines = [];
  return {
    lines,
    markdown() {},
    progress(text, task) {
      const row = { text, spinning: true };
      lines.push(row);
      if (typeof task === 'function') {
        Promise.resolve(task({ report() {} })).then((final) => {
          row.spinning = false;
          if (typeof final === 'string') row.text = final;
        });
      } else {
        row.spinning = false;
      }
    },
    get live() { return lines.filter((l) => l.spinning).map((l) => l.text); },
    get texts() { return lines.map((l) => l.text); },
  };
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
    assert.equal(response.parts.filter((p) => p.startsWith('[')).length, new Set(response.parts.filter((p) => p.startsWith('['))).size, 'no progress line is written twice');
    assert.match(text, /lib-admin-payments\.ts · attempt 1 · asking the model · x-ai\/grok-4\.6/);
    assert.match(text, /acceptance: typecheck and re-map/);
    assert.match(text, /✓ lib-admin-payments\.ts — closed after 1 attempt · \$0\.0782/);
    assert.match(text, /✓ lib-admin-logistics\.ts — closed/);
    assert.match(text, /run complete: 2 closed · \$0\.13/);
    assert.match(text, /ship: running — build/);
    assert.match(text, /ship: deploy failed — the host declined the deployment/);
    assert.match(text, /\[lib-admin-payments\.ts · asking the model · x-ai\/grok-4\.6\]/, 'the progress line names the task under the pen and who is writing it');
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

describe('the stream reports this job, not the last one', () => {
  it('results and a ship already on disk when the job starts are history, never replayed', async () => {
    // Live: a fresh /run printed run 1's eight closes and "run complete · $0.60"
    // before run 2 had done anything -- run.json still held the previous run.
    const old = { task: 't.old', outcome: 'closed', attempts: 1, cost_usd: 0.5 };
    const answers = [
      { running: true, run: { status: 'complete', closed: 8, cost_usd: 0.6, results: [old] }, ship: { status: 'deploy failed' } },
      { running: true, progress: { task: 't.new', attempt: 1, phase: 'asking the model' }, run: { status: 'running', results: [old] }, ship: { status: 'deploy failed' } },
      { running: false, run: { status: 'complete', closed: 1, cost_usd: 0.07, results: [old, { task: 't.new', outcome: 'closed', attempts: 1, cost_usd: 0.07 }] }, ship: { status: 'shipped', deploy_url: 'https://x' } },
    ];
    let i = 0;
    const client = { async map() { return answers[Math.min(i++, answers.length - 1)]; } };
    const response = stream();
    await streamJob({ client, repo: 'x', kind: 'run', response, sleep: async () => {} });
    const text = response.parts.join('\n');
    assert.ok(!text.includes('t.old') && !text.includes('old —'), 'the previous run is not replayed');
    assert.ok(!/\$0\.6\b/.test(text), 'nor its totals');
    assert.match(text, /✓ new — closed after 1 attempt · \$0\.07/);
    assert.match(text, /run complete: 1 closed · \$0\.07/);
    assert.match(text, /ship: shipped/, 'a ship that moves after we arrive is news');
  });

  it('a map still reports its own stage from the first read', async () => {
    const answers = [
      { mapping: true, overview: { meta: { stage: 'shell', stages_done: 1, stages_total: 6 } } },
      { mapping: false, overview: { meta: { status: 'complete', findings_total: 4, findings_actionable: 2 } } },
    ];
    let i = 0;
    const client = { async map() { return answers[Math.min(i++, answers.length - 1)]; } };
    const response = stream();
    await streamJob({ client, repo: 'x', kind: 'map', response, sleep: async () => {} });
    assert.match(response.parts.join('\n'), /stage: shell \(1\/6\)/, 'the first stage is this job, not history');
  });
});

describe('one live line per state, with a spinner', () => {
  const { speaker } = require('./job_stream');

  it('the same state does not print again -- its line is still spinning', async () => {
    const r = taskStream();
    const say = speaker(r);
    say.say('payments.ts · asking the model');
    say.say('payments.ts · asking the model');
    say.say('payments.ts · asking the model');
    assert.equal(r.lines.length, 1, 'one line, however many polls');
    assert.deepEqual(r.live, ['payments.ts · asking the model'], 'and it is still spinning');
    say.say('payments.ts · acceptance: typecheck and re-map');
    await Promise.resolve(); await Promise.resolve();
    assert.equal(r.lines.length, 2);
    assert.deepEqual(r.live, ['payments.ts · acceptance: typecheck and re-map'], 'the previous line settled');
    say.end();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(r.live, [], 'nothing spins after the job ends');
  });

  it('a run prints one spinning line per task and phase, never one per poll', async () => {
    const answers = [
      { running: true, progress: { task: 't.a', attempt: 1, phase: 'asking the model', model: 'grok' }, run: { status: 'running', results: [] } },
      { running: true, progress: { task: 't.a', attempt: 1, phase: 'asking the model', model: 'grok' }, run: { status: 'running', results: [] } },
      { running: true, progress: { task: 't.a', attempt: 1, phase: 'asking the model', model: 'grok' }, run: { status: 'running', results: [] } },
      { running: true, progress: { task: 't.a', attempt: 1, phase: 'acceptance: typecheck' }, run: { status: 'running', results: [] } },
      { running: false, run: { status: 'complete', closed: 1, results: [{ task: 't.a', outcome: 'closed', attempts: 1 }] } },
    ];
    let i = 0;
    const client = { async map() { return answers[Math.min(i++, answers.length - 1)]; } };
    const r = taskStream();
    await streamJob({ client, repo: 'x', kind: 'run', response: r, sleep: async () => {} });
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(r.texts, ['a · asking the model · grok', 'a · acceptance: typecheck'],
      'three identical polls made one line; the phase change made the second');
    assert.deepEqual(r.live, [], 'the job ended, so nothing is left spinning');
  });

  it('a host that only knows progress(text) still gets one line per state', async () => {
    const r = stream();
    const say = speaker(r);
    say.say('map…'); say.say('map…'); say.say('plan…'); say.end();
    assert.deepEqual(r.parts, ['[map…]', '[plan…]']);
  });
});
