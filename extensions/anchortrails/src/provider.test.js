'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ASSIGN_SLUGS, listModelInfo } = require('./slugs');
const {
  flattenMessages, completeViaBridge, createProvider, estimateTokens, slugOf,
} = require('./provider');

describe('slugs', () => {
  it('lists assign slugs including grok-4.6 and never an OpenRouter id', () => {
    assert.ok(ASSIGN_SLUGS.includes('grok-4.6'));
    assert.ok(ASSIGN_SLUGS.includes('claude-fable-5.1'));
    assert.ok(!ASSIGN_SLUGS.includes('x-ai/grok-4'));
    assert.ok(!ASSIGN_SLUGS.includes('anthropic/claude-sonnet-4.6'));
    assert.equal(listModelInfo(['grok-4.6'])[0].capabilities.imageInput, true);
  });
});

describe('flattenMessages', () => {
  it('maps vscode role enums and part.value', () => {
    const flat = flattenMessages([
      { role: 0, content: [{ value: 'Layer M' }] },
      { role: 1, content: [{ value: 'do the step' }] },
      { role: 2, content: [{ text: 'working' }] },
    ]);
    assert.equal(flat.system, 'Layer M');
    assert.deepEqual(flat.messages, [
      { role: 'user', content: 'do the step' },
      { role: 'assistant', content: 'working' },
    ]);
  });
});

describe('completeViaBridge', () => {
  it('sends the assign slug not an OpenRouter id', async () => {
    let seen;
    const client = {
      async complete(body) { seen = body; return { skipped: true, slug: body.model, text: '' }; },
    };
    await completeViaBridge(client, { id: 'grok-4.6' }, [
      { role: 'user', content: 'continue' },
    ], { fallback: 'claude-sonnet-5' });
    assert.equal(seen.model, 'grok-4.6');
    assert.equal(seen.user, 'continue');
    assert.equal(seen.fallback, 'claude-sonnet-5');
    assert.equal(slugOf({ id: 'composer-2.5' }), 'composer-2.5');
  });
});

describe('createProvider', () => {
  it('advertises only assign slugs and reports text from complete', async () => {
    const client = {
      async complete() { return { skipped: false, slug: 'grok-4.6', text: 'hello' }; },
    };
    const provider = createProvider(client);
    const models = await provider.provideLanguageModelChatInformation();
    assert.equal(models.length, ASSIGN_SLUGS.length);
    assert.ok(models.every((m) => ASSIGN_SLUGS.includes(m.id)));
    assert.equal(models[0].isDefault, true);
    assert.ok(models.slice(1).every((m) => m.isDefault === false));
    assert.ok(models.every((m) => m.isUserSelectable === true));
    const parts = [];
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' },
      [{ role: 'user', content: 'hi' }],
      {},
      { report: (p) => parts.push(p) },
    );
    assert.equal(parts[0].value, 'hello');
    assert.equal(await provider.provideTokenCount({}, 'abcd'), 1);
    assert.ok(estimateTokens('xxxx') >= 1);
  });

  it('prefers live catalog slugs so AT model updates skip a fork patch', async () => {
    const provider = createProvider({
      async catalog() { return { slugs: ['grok-4.6', 'new-at-slug'] }; },
      async complete() { return { text: '' }; },
    });
    const models = await provider.provideLanguageModelChatInformation();
    assert.deepEqual(models.map((m) => m.id), ['grok-4.6', 'new-at-slug']);
  });

  it('unwraps sendRequest modelOptions.system so Layer M reaches complete', async () => {
    let seen;
    const provider = createProvider({
      async complete(body) { seen = body; return { text: 'ok' }; },
    });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' },
      [{ role: 'user', content: 'hi' }],
      { modelOptions: { system: 'Layer M', fallback: 'claude-sonnet-5' } },
      { report() {} },
    );
    assert.equal(seen.system, 'Layer M');
    assert.equal(seen.fallback, 'claude-sonnet-5');
  });

  it('skipped complete names vault/util-ai and never echoes a key', async () => {
    const parts = [];
    const provider = createProvider({
      async complete() { return { skipped: true, slug: 'grok-4.6', text: '' }; },
    });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' },
      [{ role: 'user', content: 'hi' }],
      {},
      { report: (p) => parts.push(p) },
    );
    assert.match(parts[0].value, /util-ai/);
    assert.match(parts[0].value, /vault/);
    assert.ok(!parts[0].value.includes('sk-'));
  });

  it('surfaces a complete error instead of an empty chat bubble', async () => {
    const parts = [];
    const provider = createProvider({
      async complete() { return { skipped: false, slug: 'grok-4.6', text: '', error: 'http_404' }; },
    });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' },
      [{ role: 'user', content: 'hi' }],
      {},
      { report: (p) => parts.push(p) },
    );
    assert.match(parts[0].value, /http_404/);
    assert.match(parts[0].value, /grok-4\.6/);
  });
});

describe('tool calling through the provider', () => {
  // For months sendRequest carried `options.tools` and this provider dropped
  // them on the floor, then reported whatever text came back. No model ever
  // saw a schema; none could ever ask for a tool.
  it('forwards sendRequest tools to the node and reports tool_calls as tool-call parts', async () => {
    let seen;
    const parts = [];
    const provider = createProvider({
      async complete(body) {
        seen = body;
        return {
          text: '',
          tool_calls: [{ id: 'call_1', name: 'desktop_uia_find', arguments: { query: 'claude' } }],
        };
      },
    });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' },
      [{ role: 1, content: [{ value: 'launch claude desktop' }] }],
      {
        modelOptions: { system: 'Layer M' },
        tools: [{ name: 'desktop_uia_find', description: 'find', inputSchema: { type: 'object' } }],
      },
      { report: (p) => parts.push(p) },
    );
    assert.deepEqual(seen.tools, [{ name: 'desktop_uia_find', description: 'find', inputSchema: { type: 'object' } }]);
    assert.equal(seen.user, '');
    assert.deepEqual(seen.messages, [{ role: 'user', content: 'launch claude desktop' }]);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].callId, 'call_1');
    assert.equal(parts[0].name, 'desktop_uia_find');
    assert.deepEqual(parts[0].input, { query: 'claude' });
  });

  it('uses the host part classes so the extension host recognises the tool call', async () => {
    class ToolCallPart { constructor(callId, name, input) { Object.assign(this, { callId, name, input }); } }
    class TextPart { constructor(value) { this.value = value; } }
    const parts = [];
    const provider = createProvider({
      async complete() { return { text: 'Looking.', tool_calls: [{ id: 'c', name: 'desktop_map', arguments: {} }] }; },
    }, { LanguageModelToolCallPart: ToolCallPart, LanguageModelTextPart: TextPart });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' }, [{ role: 1, content: 'go' }], { tools: [{ name: 'desktop_map' }] },
      { report: (p) => parts.push(p) },
    );
    assert.ok(parts[0] instanceof TextPart);
    assert.ok(parts[1] instanceof ToolCallPart);
  });

  it('sends earlier tool-call and tool-result parts role-preserved, never flattened', async () => {
    let seen;
    const provider = createProvider({
      async complete(body) { seen = body; return { text: 'Found it.', tool_calls: [] }; },
    });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' },
      [
        { role: 1, content: [{ value: 'launch claude desktop' }] },
        { role: 2, content: [{ value: 'Looking.' }, { callId: 'c1', name: 'desktop_uia_find', input: { query: 'claude' } }] },
        { role: 1, content: [{ callId: 'c1', content: [{ value: '{"count":7}' }] }] },
      ],
      { tools: [{ name: 'desktop_uia_find' }] },
      { report() {} },
    );
    assert.deepEqual(seen.messages, [
      { role: 'user', content: 'launch claude desktop' },
      { role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'c1', name: 'desktop_uia_find', arguments: { query: 'claude' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"count":7}' },
    ]);
  });

  it('a plain answer without tools keeps the legacy flat body', async () => {
    let seen;
    const provider = createProvider({
      async complete(body) { seen = body; return { text: 'hi' }; },
    });
    await provider.provideLanguageModelChatResponse(
      { id: 'grok-4.6' }, [{ role: 1, content: 'hello' }], {}, { report() {} },
    );
    assert.equal(seen.user, 'hello');
    assert.equal(seen.tools, undefined);
  });
});
