'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  chatTools, resultText, ToolSession, FALLBACK_SECRET_TOOLS,
} = require('./tools');

describe('destAlways', () => {
  it('adds look/map/go and search/invoke without duplicating a summoned look', () => {
    const { destAlways, DEST_ALWAYS } = require('./tools');
    const extra = destAlways([{ name: 'browser_look' }]);
    assert.ok(DEST_ALWAYS.some((t) => t.name === 'meta_invoke_tool'));
    assert.ok(!extra.some((t) => t.name === 'browser_look'));
    assert.ok(extra.some((t) => t.name === 'desktop_map'));
    assert.ok(extra.some((t) => t.name === 'desktop_uia_find'));
    assert.ok(extra.some((t) => t.name === 'browser_fill_editor'));
    assert.ok(extra.some((t) => t.name === 'android_ui_click'));
    assert.ok(extra.some((t) => t.name === 'meta_search_tools'));
    assert.ok(!JSON.stringify(DEST_ALWAYS).includes('desktop_vault_get'));
  });
});

describe('chatTools', () => {
  it('keeps only this turn\'s summoned schemas and drops secret tools', () => {
    const tools = chatTools([
      { name: 'personal_build_orchestrate', description: 'OzFactory', inputSchema: { type: 'object' } },
      { name: 'desktop_vault_get', description: 'secret', inputSchema: { type: 'object' } },
      { name: 'browser_look', description: 'look' },
    ], { secret_tools: FALLBACK_SECRET_TOOLS });
    assert.deepEqual(tools.map((t) => t.name), [
      'personal_build_orchestrate',
      'browser_look',
    ]);
    assert.ok(tools.length < 20);
  });

  it('W10c: never binds vscode_editFile — local hunks stay the builtin', () => {
    const { BUILTIN_EDIT } = require('./tools');
    assert.equal(BUILTIN_EDIT, 'vscode_editFile');
    const tools = chatTools([
      { name: 'vscode_editFile', description: 'must stay builtin' },
      { name: 'write_text_file', description: 'AT files' },
    ]);
    assert.deepEqual(tools.map((t) => t.name), ['write_text_file']);
  });

  it('honors a live catalog deny list so AT can add secret tools later', () => {
    const tools = chatTools(
      [{ name: 'new_secret_dump', description: 'x' }, { name: 'meta_list_pillars', description: 'ok' }],
      { secret_tools: ['new_secret_dump'] },
    );
    assert.deepEqual(tools.map((t) => t.name), ['meta_list_pillars']);
  });

  it('annotates mesh hops from catalog without baking node names into the extension', () => {
    const tools = chatTools([
      { name: 'personal_mesh_nodes', description: 'List nodes' },
      { name: 'personal_hands_invoke', description: 'Hop a task' },
      { name: 'browser_look', description: 'look' },
    ], {
      mesh: {
        tools: ['personal_mesh_nodes', 'personal_hands_invoke', 'personal_flow'],
        hop: 'personal_hands_invoke + personal_flow; never one click at a time',
        nodes: [{ name: 'HomePC', caps: ['browser'] }, { name: 'Suns-MacBook-Air' }],
      },
    });
    assert.match(tools[0].description, /Last seen: HomePC, Suns-MacBook-Air/);
    assert.match(tools[1].description, /never one click at a time/);
    assert.equal(tools[2].description, 'look');
    assert.ok(!JSON.stringify(tools).includes('10.'));
    assert.ok(!JSON.stringify(tools).includes('127.0.0.1'));
  });

  it('annotates clustry assign from catalog without baking cluster ids into the extension', () => {
    const tools = chatTools([
      { name: 'personal_clustry_members', description: 'Who is in the cluster' },
      { name: 'personal_clustry_create', description: 'Push work into Clustry' },
      { name: 'browser_look', description: 'look' },
    ], {
      clustry: {
        tools: ['personal_clustry_inbox', 'personal_clustry_task', 'personal_clustry_members', 'personal_clustry_create'],
        assign: 'people/agents via members+create; nodes stay mesh hops; models stay assign()',
        configured: true,
      },
    });
    assert.match(tools[0].description, /members\+create/);
    assert.match(tools[1].description, /assign\(\)/);
    assert.equal(tools[2].description, 'look');
    assert.ok(!JSON.stringify(tools).includes('clk_'));
    assert.ok(!JSON.stringify(tools).includes('cluster-'));
  });
});

describe('resultText', () => {
  it('omits key-shaped payloads', () => {
    assert.match(resultText({ data: { api_key: 'sk-or-secret' } }), /omitted/);
    assert.equal(resultText({ data: { ok: true } }), '{"ok":true}');
  });
});

describe('ToolSession', () => {
  it('registers prepare tools, invokes /api/invoke, and disposes the previous set', async () => {
    const registered = [];
    const disposed = [];
    const invoked = [];
    const vscode = {
      lm: {
        registerToolDefinition(def, impl) {
          registered.push(def.name);
          return { dispose() { disposed.push(def.name); } };
        },
      },
    };
    const client = {
      async invoke(name, args) {
        invoked.push({ name, args });
        return { ok: true, data: { ran: name } };
      },
    };
    const session = new ToolSession();
    const first = session.bind(vscode, client, [
      { name: 'personal_build_task', description: 'one task' },
    ]);
    const names = first.map((t) => t.name);
    assert.ok(names.includes('personal_build_task'));
    assert.ok(names.includes('meta_search_tools'));
    assert.ok(names.includes('meta_invoke_tool'));
    assert.ok(names.includes('browser_look'));
    assert.ok(names.includes('desktop_map'));
    assert.ok(names.includes('runInTerminal'));
    assert.ok(names.includes('vscode_editFile'));
    assert.ok(names.includes('checkErrors'));
    assert.ok(!names.includes('desktop_vault_get'));
    assert.ok(names.length < 30);
    assert.ok(registered.includes('personal_build_task'));
    assert.ok(registered.includes('meta_search_tools'));
    assert.ok(registered.includes('browser_look'));
    assert.ok(registered.includes('runInTerminal'));

    session.bind(vscode, client, [
      { name: 'browser_look', description: 'look' },
      { name: 'desktop_vault_get', description: 'nope' },
    ]);
    assert.ok(disposed.includes('personal_build_task'));
    assert.ok(disposed.includes('meta_search_tools'));
    assert.ok(disposed.includes('runInTerminal'));
    assert.ok(registered.includes('browser_look'));
    assert.ok(registered.filter((n) => n === 'browser_look').length >= 1);

    const implClient = {
      async invoke(name, args) { invoked.push({ name, args }); return { data: { i: args.i } }; },
    };
    const impl = require('./tools').createImpl(implClient, {}, 'browser_look');
    const out = await impl.invoke({ input: { i: 3 } });
    assert.equal(out.content[0].value, '{"i":3}');
    assert.equal(invoked.at(-1).name, 'browser_look');
  });

  it('pauses mutating tools for user confirm and does not leak the token', async () => {
    const session = new ToolSession();
    const client = {
      async invoke(name, args, opts = {}) {
        if (!opts.approvalToken) {
          return { approval_required: true, approval_token: 'tok-secret' };
        }
        return { ok: true, data: { wrote: true } };
      },
    };
    const impl = require('./tools').createImpl(client, {}, 'write_text_file', session);
    const first = await impl.invoke({ input: { path: 'x', content: 'hunk' } });
    assert.match(first.content[0].value, /approval_required/);
    assert.ok(!first.content[0].value.includes('tok-secret'));
    const second = await impl.invoke({ input: { path: 'x', content: 'hunk', approve: true } });
    assert.equal(second.content[0].value, '{"wrote":true}');
  });
});
