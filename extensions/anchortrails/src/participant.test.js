'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BridgeAuthError, BridgeEntitlementError } = require('./bridge');
const { VENDOR } = require('./slugs');
const {
  PARTICIPANT_ID,
  pickSlug,
  buildTurn,
  requestOptions,
  handleTurn,
} = require('./participant');

function prepared(over = {}) {
  return {
    system: 'Layer M + switch',
    model: 'grok-4.6',
    fallback: 'claude-sonnet-5',
    effort: null,
    cascade: false,
    session_id: 'default',
    summon: [],
    tools: [],
    tools_required: false,
    task_class: 'plan',
    plan: { cursor: '6/12', playbook: 'develop' },
    ...over,
  };
}

function stream(chunks) {
  return {
    markdown(t) { this.parts.push(t); },
    progress(t) { this.progresses.push(t); },
    parts: [],
    progresses: [],
  };
}

describe('participant contrib', () => {
  it('uses the extension id the package.json contribution will declare', () => {
    assert.equal(PARTICIPANT_ID, 'anchortrails.chat');
    assert.equal(VENDOR, 'anchortrails');
  });
});

describe('buildTurn', () => {
  it('keeps Layer M as system and appends the user prompt after history', () => {
    const turn = buildTurn(prepared(), 'do W6', [
      { prompt: 'earlier' },
      { response: [{ value: 'ok' }] },
    ]);
    assert.equal(turn.system, 'Layer M + switch');
    assert.deepEqual(turn.messages, [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'do W6' },
    ]);
    assert.equal(turn.model, 'grok-4.6');
    assert.equal(pickSlug(prepared({ model: 'claude-sonnet-5' })), 'claude-sonnet-5');
  });

  it('passes OzFactory summoned schemas on sendRequest — never the floor', () => {
    const turn = buildTurn(prepared({
      task_class: 'implement',
      tools_required: true,
      summon: ['personal_build_orchestrate', 'personal_build_task'],
      tools: [{ name: 'personal_build_orchestrate', description: 'OzFactory', inputSchema: { type: 'object' } }],
      plan: { cursor: '1/12', playbook: 'develop' },
    }), 'build the app', []);
    assert.deepEqual(turn.summon, ['personal_build_orchestrate', 'personal_build_task']);
    const opts = requestOptions(turn);
    assert.deepEqual(opts.tools.map((t) => t.name), ['personal_build_orchestrate']);
    assert.ok(opts.tools.length < 20);
    assert.equal(opts.modelOptions.system, 'Layer M + switch');
  });

  it('caps chat history to last 1–2 deltas when a plan card is present', () => {
    const { capHistory } = require('./participant');
    const long = [
      { role: 'user', content: 'old 1' },
      { role: 'assistant', content: 'old 2' },
      { role: 'user', content: 'old 3' },
      { role: 'assistant', content: 'old 4' },
      { role: 'user', content: 'now' },
    ];
    assert.deepEqual(capHistory(long, { cursor: '11/12' }), [
      { role: 'user', content: 'old 3' },
      { role: 'assistant', content: 'old 4' },
      { role: 'user', content: 'now' },
    ]);
    assert.equal(capHistory(long, null).length, 5);
  });
});

describe('handleTurn', () => {
  it('prepare → selectChatModels(vendor+assign slug) → sendRequest with Layer M', async () => {
    let prepareBody;
    let selector;
    let sent;
    const client = {
      async prepare(body) { prepareBody = body; return prepared(); },
    };
    const model = {
      async sendRequest(messages, options) {
        sent = { messages, options };
        return { text: (async function* () { yield 'done'; })() };
      },
    };
    const vscode = {
      lm: {
        async selectChatModels(sel) { selector = sel; return [model]; },
      },
      LanguageModelChatMessage: {
        User(content) { return { role: 'user', content }; },
        Assistant(content) { return { role: 'assistant', content }; },
      },
    };
    const response = stream();
    const result = await handleTurn({
      client,
      vscode,
      request: { prompt: 'continue W6' },
      context: { history: [] },
      response,
      workspace: 'D:\\AnchorTrails',
    });
    assert.equal(prepareBody.ahead, 'continue W6');
    assert.equal(prepareBody.workspace, 'D:\\AnchorTrails');
    assert.deepEqual(selector, { vendor: 'anchortrails', id: 'grok-4.6' });
    assert.equal(sent.options.modelOptions.system, 'Layer M + switch');
    assert.equal(sent.options.tools, undefined); // status turn — no summon
    assert.deepEqual(sent.messages, [{ role: 'user', content: 'continue W6' }]);
    assert.deepEqual(response.parts, ['done']);
    assert.equal(result.metadata.model, 'grok-4.6');
    assert.equal(result.metadata.task_class, 'plan');
    assert.ok(!JSON.stringify(sent).includes('sk-'));
  });

  it('forwards image and video attachments so assign can pick the model', async () => {
    const { collectAttachments, payloadTokensFor } = require('./participant');
    const names = collectAttachments({
      prompt: 'summarise',
      references: [
        { name: 'shot.png', value: { fsPath: 'D:\\shots\\shot.png' } },
        { name: 'clip.mp4', value: { path: 'D:\\clips\\clip.mp4' } },
      ],
    });
    assert.deepEqual(names, ['D:\\shots\\shot.png', 'D:\\clips\\clip.mp4']);
    assert.equal(payloadTokensFor(names), 12000);
    let prepareBody;
    const client = {
      async prepare(body) { prepareBody = body; return prepared(); },
    };
    const model = {
      async sendRequest() { return { text: (async function* () { yield 'ok'; })() }; },
    };
    await handleTurn({
      client,
      vscode: {
        lm: { async selectChatModels() { return [model]; } },
        LanguageModelChatMessage: {
          User(content) { return { role: 'user', content }; },
          Assistant(content) { return { role: 'assistant', content }; },
        },
      },
      request: {
        prompt: 'summarise this clip',
        references: [{ name: 'clip.mp4', value: { fsPath: 'D:\\clip.mp4' } }],
      },
      context: { history: [] },
      response: stream(),
    });
    assert.deepEqual(prepareBody.attachments, ['D:\\clip.mp4']);
    assert.equal(prepareBody.payload_tokens, 12000);
  });

  it('pushes the prepare plan onto the dest panel', async () => {
    const seen = [];
    const client = {
      async prepare() { return prepared(); },
    };
    const model = {
      async sendRequest() {
        return { text: (async function* () { yield 'ok'; })() };
      },
    };
    const vscode = {
      lm: { async selectChatModels() { return [model]; } },
      LanguageModelChatMessage: {
        User(content) { return { role: 'user', content }; },
        Assistant(content) { return { role: 'assistant', content }; },
      },
    };
    await handleTurn({
      client,
      vscode,
      request: { prompt: 'continue' },
      context: { history: [] },
      response: stream(),
      onPlan: (plan) => seen.push(plan),
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].cursor, '6/12');
  });

  it('/plan shows the card; /plan refresh rescores without a model call', async () => {
    const seen = [];
    const client = {
      async sessionPlan() {
        return { plan: { cursor: '3/4', goal: 'Ship dest', steps: '1.DESIGN [x] | 3.BUILD [>]' } };
      },
      async refreshPlan() {
        return {
          refreshed: true,
          plan: {
            cursor: '3/4',
            goal: 'Ship dest',
            steps: '1.DESIGN [x] | 3.BUILD [!]',
            do: 'advance the goal',
          },
        };
      },
    };
    const ask = stream();
    const asked = await handleTurn({
      client,
      vscode: { lm: { async selectChatModels() { return []; } } },
      request: { prompt: '/plan' },
      context: { history: [] },
      response: ask,
      onPlan: (plan) => seen.push(plan),
    });
    assert.equal(asked.metadata.slash, 'ask');
    assert.match(ask.parts[0], /Ship dest/);
    assert.equal(seen[0].cursor, '3/4');

    const refresh = stream();
    const refreshed = await handleTurn({
      client,
      vscode: { lm: { async selectChatModels() { return []; } } },
      request: { prompt: '/plan refresh' },
      context: { history: [] },
      response: refresh,
      onPlan: (plan) => seen.push(plan),
    });
    assert.equal(refreshed.metadata.slash, 'refresh');
    assert.match(refresh.parts[0], /BUILD \[!\]/);
    assert.match(refresh.parts[0], /advance the goal/);

    const bare = stream();
    const bareOut = await handleTurn({
      client,
      vscode: { lm: { async selectChatModels() { return []; } } },
      request: { prompt: 'refresh' },
      context: { history: [] },
      response: bare,
    });
    assert.equal(bareOut.metadata.slash, 'refresh');
    assert.match(bare.parts[0], /BUILD \[!\]/);
  });

  it('markdowns complete() when sendRequest streams nothing', async () => {
    const client = {
      async prepare() { return prepared(); },
      async complete(body) {
        assert.equal(body.model, 'grok-4.6');
        assert.equal(body.user, 'Hi');
        return { text: '', error: 'http_404', model: 'x-ai/grok-4', skipped: false };
      },
    };
    const model = {
      async sendRequest() { return { text: (async function* () { })() }; },
    };
    const vscode = {
      lm: { async selectChatModels() { return [model]; } },
      LanguageModelChatMessage: {
        User(content) { return { role: 'user', content }; },
        Assistant(content) { return { role: 'assistant', content }; },
      },
    };
    const response = stream();
    await handleTurn({
      client,
      vscode,
      request: { prompt: 'Hi' },
      context: { history: [] },
      response,
    });
    assert.match(response.parts[0], /http_404/);
    assert.match(response.parts[0], /x-ai\/grok-4/);
  });

  it('does not use the UI-selected model when assign picked another slug', async () => {
    let selector;
    const client = { async prepare() { return prepared({ model: 'gemini-3.1-pro' }); } };
    const vscode = {
      lm: { async selectChatModels(sel) { selector = sel; return []; } },
    };
    const response = stream();
    await handleTurn({
      client,
      vscode,
      request: { prompt: 'hi', model: { id: 'composer-2.5' } },
      context: { history: [] },
      response,
    });
    assert.deepEqual(selector, { vendor: 'anchortrails', id: 'gemini-3.1-pro' });
    assert.match(response.parts[0], /gemini-3\.1-pro/);
  });

  it('maps 401 / 402 to user-facing markdown without dumping tools', async () => {
    const vscode = { lm: { async selectChatModels() { return []; } } };
    const auth = stream();
    await handleTurn({
      client: { async prepare() { throw new BridgeAuthError('nope', { status: 401 }); } },
      vscode,
      request: { prompt: 'x' },
      context: {},
      response: auth,
    });
    assert.match(auth.parts[0], /401/);

    const pay = stream();
    await handleTurn({
      client: { async prepare() { throw new BridgeEntitlementError('credits', { status: 402 }); } },
      vscode,
      request: { prompt: 'x' },
      context: {},
      response: pay,
    });
    assert.match(pay.parts[0], /402/);
  });

  it('binds this turn\'s prepare tools via registerToolDefinition', async () => {
    const names = [];
    const client = {
      async prepare() {
        return prepared({
          tools_required: true,
          summon: ['personal_build_orchestrate'],
          tools: [{ name: 'personal_build_orchestrate', description: 'OzFactory' }],
        });
      },
      async catalog() { return { slugs: ['grok-4.6'], secret_tools: ['desktop_vault_get'] }; },
    };
    const model = {
      async sendRequest(_m, options) {
        return { text: (async function* () { yield String(options.tools.length); })() };
      },
    };
    const vscode = {
      lm: {
        async selectChatModels() { return [model]; },
        registerToolDefinition(def) {
          names.push(def.name);
          return { dispose() {} };
        },
      },
      LanguageModelChatMessage: {
        User(c) { return { role: 'user', content: c }; },
        Assistant(c) { return { role: 'assistant', content: c }; },
      },
    };
    const response = stream();
    await handleTurn({
      client,
      vscode,
      request: { prompt: 'build it' },
      context: { history: [] },
      response,
      toolSession: new (require('./tools').ToolSession)(),
    });
    assert.ok(names.includes('personal_build_orchestrate'));
    assert.ok(names.includes('meta_search_tools'));
    assert.ok(names.includes('browser_look'));
    assert.ok(names.includes('runInTerminal'));
    assert.ok(names.includes('checkErrors'));
    assert.ok(names.includes('vscode_editFile'));
    assert.ok(names.length < 30);
    assert.match(response.parts[0], /^\d+$/);
    assert.ok(Number(response.parts[0]) >= 4);
  });

  it('one prompt iterates session steps until the objective is verified', async () => {
    const cards = [
      { goal: 'Ship dest drive', cursor: '1/3', playbook: 'develop', steps: '1.DESIGN [>] | 2.BUILD [ ] | 3.TEST [ ]' },
      { goal: 'Ship dest drive', cursor: '2/3', playbook: 'develop', steps: '1.DESIGN [x] | 2.BUILD [>] | 3.TEST [ ]' },
      { goal: 'Ship dest drive', cursor: '3/3', playbook: 'develop', steps: '1.DESIGN [x] | 2.BUILD [x] | 3.TEST [>]' },
    ];
    const doneCard = {
      goal: 'Ship dest drive',
      cursor: '3/3',
      playbook: 'develop',
      steps: '1.DESIGN [x] | 2.BUILD [x] | 3.TEST [x]',
    };
    let n = 0;
    const prepares = [];
    const advances = [];
    const client = {
      async prepare(body) {
        prepares.push(body.ahead);
        const plan = cards[Math.min(n, cards.length - 1)];
        return prepared({ plan, task_class: 'implement' });
      },
      async refreshPlan(body) {
        advances.push(Boolean(body && body.advance));
        n += 1;
        const plan = n >= 3 ? doneCard : cards[n];
        return { refreshed: true, done: n >= 3, plan };
      },
    };
    let sends = 0;
    const model = {
      async sendRequest() {
        sends += 1;
        return { text: (async function* () { yield `round ${sends}`; })() };
      },
    };
    const vscode = {
      lm: { async selectChatModels() { return [model]; } },
      LanguageModelChatMessage: {
        User(c) { return { role: 'user', content: c }; },
        Assistant(c) { return { role: 'assistant', content: c }; },
      },
    };
    const response = stream();
    const result = await handleTurn({
      client,
      vscode,
      request: { prompt: 'implement the launch plan' },
      context: { history: [] },
      response,
    });
    assert.equal(sends, 3);
    assert.equal(prepares.length, 3);
    assert.equal(prepares[0], 'implement the launch plan');
    assert.match(prepares[1], /Continue the plan/);
    assert.deepEqual(advances, [true, true, true]);
    assert.equal(result.metadata.drive.done, true);
    assert.equal(result.metadata.drive.rounds, 3);
    assert.match(response.parts.join(''), /Objective met/);
    assert.match(response.parts.join(''), /Ship dest drive/);
  });

  it('stops after a stuck red verify instead of looping forever', async () => {
    const blocked = {
      goal: 'Ship dest drive',
      cursor: '1/2',
      playbook: 'develop',
      steps: '1.BUILD [!] | 2.TEST [ ]',
    };
    let sends = 0;
    const client = {
      async prepare() {
        return prepared({ plan: blocked, task_class: 'implement' });
      },
      async refreshPlan(body) {
        assert.equal(body.advance, false);
        return { refreshed: true, done: false, plan: blocked };
      },
    };
    const model = {
      async sendRequest() {
        sends += 1;
        return { text: (async function* () { yield 'fail'; })() };
      },
    };
    const vscode = {
      languages: {
        getDiagnostics() {
          return [{ severity: 0, message: 'boom', range: { start: { line: 1 } } }];
        },
      },
      DiagnosticSeverity: { Error: 0 },
      lm: { async selectChatModels() { return [model]; } },
      LanguageModelChatMessage: {
        User(c) { return { role: 'user', content: c }; },
        Assistant(c) { return { role: 'assistant', content: c }; },
      },
    };
    const response = stream();
    const result = await handleTurn({
      client,
      vscode,
      request: { prompt: 'continue the plan until done' },
      context: { history: [] },
      response,
    });
    assert.equal(sends, 2);
    assert.equal(result.metadata.drive.done, false);
    assert.match(response.parts.join(''), /Stopped/);
  });

  it('W10a/b: assign slug wins the picker; dest edit+check ride the wire, AT vscode_editFile stays denied', async () => {
    let selector;
    let sent;
    const client = {
      async prepare() {
        return prepared({
          model: 'grok-4.6',
          switch: 'Use grok-4.6.',
          tools_required: true,
          summon: ['personal_build_orchestrate', 'personal_build_task'],
          tools: [
            { name: 'personal_build_orchestrate', description: 'OzFactory' },
            { name: 'personal_build_task', description: 'one task' },
            { name: 'vscode_editFile', description: 'must not bind' },
          ],
        });
      },
      async catalog() { return { slugs: ['grok-4.6'] }; },
    };
    const model = {
      async sendRequest(_m, options) {
        sent = options;
        return { text: (async function* () { yield 'ok'; })() };
      },
    };
    const vscode = {
      lm: {
        async selectChatModels(sel) { selector = sel; return [model]; },
        registerToolDefinition(def) { return { dispose() {} }; },
      },
      LanguageModelChatMessage: {
        User(c) { return { role: 'user', content: c }; },
        Assistant(c) { return { role: 'assistant', content: c }; },
      },
    };
    await handleTurn({
      client,
      vscode,
      request: { prompt: 'build it', model: { id: 'composer-2.5' } },
      context: { history: [] },
      response: stream(),
      toolSession: new (require('./tools').ToolSession)(),
    });
    assert.deepEqual(selector, { vendor: 'anchortrails', id: 'grok-4.6' });
    const wire = sent.tools.map((t) => t.name);
    assert.ok(wire.includes('personal_build_orchestrate'));
    assert.ok(wire.includes('personal_build_task'));
    assert.ok(wire.includes('meta_search_tools'));
    assert.ok(wire.includes('meta_invoke_tool'));
    assert.ok(wire.includes('browser_look'));
    assert.ok(wire.includes('desktop_go'));
    assert.ok(wire.includes('runInTerminal'));
    assert.ok(wire.includes('vscode_editFile'));
    assert.ok(wire.includes('checkErrors'));
    assert.ok(!wire.includes('desktop_vault_get'));
    assert.ok(sent.tools.length < 30);
  });
});
