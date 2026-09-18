'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { chatQuery, openDrivenTurn } = require('./drive');

describe('chatQuery', () => {
  it('prefixes @at so any sender lands on the AT participant', () => {
    assert.equal(chatQuery('implement checkout'), '@at implement checkout');
  });

  it('does not double-prefix', () => {
    assert.equal(chatQuery('@at hop to the mac'), '@at hop to the mac');
  });
});

describe('openDrivenTurn', () => {
  it('opens chat with the claimed ahead and does not paste', async () => {
    const seen = [];
    const vscode = {
      commands: {
        async executeCommand(name, arg) { seen.push({ name, arg }); },
      },
    };
    const out = await openDrivenTurn(vscode, { id: 'd1', ahead: 'list the mesh nodes' });
    assert.equal(out.opened, true);
    assert.equal(seen[0].name, 'workbench.action.chat.open');
    assert.equal(seen[0].arg.query, '@at list the mesh nodes');
    assert.equal(seen[0].arg.isPartialQuery, false);
  });
});
