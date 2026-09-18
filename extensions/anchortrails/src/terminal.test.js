'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BUILTIN_TERMINAL, spec, blocked, createImpl, register,
} = require('./terminal');

describe('dest runInTerminal', () => {
  it('is a dest builtin, not an AT invoke name collision with edit', () => {
    assert.equal(BUILTIN_TERMINAL, 'runInTerminal');
    assert.equal(spec().name, 'runInTerminal');
    assert.match(spec().description, /Never ask the user/);
  });

  it('blocks destructive shell', () => {
    assert.equal(blocked('dir D:\\aozhen'), false);
    assert.equal(blocked('rm -rf /'), true);
    assert.equal(blocked('format c:'), true);
  });

  it('runs a command and returns stdout without asking the user', async () => {
    const sent = [];
    const vscode = {
      window: {
        terminals: [],
        createTerminal({ name }) {
          return {
            name,
            show() { sent.push('show'); },
            sendText(text) { sent.push(text); },
          };
        },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: process.cwd() } }] },
    };
    const impl = createImpl(vscode);
    const out = await impl.invoke({ input: { command: 'echo AT-TERM' } });
    const body = JSON.parse(out.content[0].value);
    assert.equal(body.ok, true);
    assert.match(String(body.stdout || ''), /AT-TERM/i);
    assert.ok(sent.includes('show'));
  });

  it('registers on dest lm', () => {
    const names = [];
    const vscode = {
      lm: {
        registerToolDefinition(def) {
          names.push(def.name);
          return { dispose() {} };
        },
      },
    };
    register(vscode);
    assert.deepEqual(names, ['runInTerminal']);
  });
});
