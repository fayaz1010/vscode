'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPLORER, AT_EDITOR, CHAT_EDITOR, CHAT_OPEN, SPLIT_RIGHT,
  layoutCommands, applyLayout, isChatTab, isEditorChatTab, isAtTab, chatTabs,
  closeEditorChats, keepOneChat,
} = require('./layout');

function chatTab(label) {
  return { label, input: { uri: { scheme: 'vscode-chat-editor' } } };
}

describe('dest layout', () => {
  it('opens Explorer, AT Panel, and the default Chat panel', () => {
    assert.deepEqual(layoutCommands(), [EXPLORER, AT_EDITOR, CHAT_OPEN]);
    assert.equal(EXPLORER, 'workbench.view.explorer');
    assert.equal(AT_EDITOR, 'anchortrails.home.openEditor');
    assert.equal(CHAT_OPEN, 'workbench.action.chat.open');
    assert.equal(CHAT_EDITOR, 'workbench.action.chat.openInEditor');
  });

  it('applies explorer + AT editor + default chat and never opens a second editor chat', async () => {
    const ran = [];
    const vscode = {
      commands: {
        async executeCommand(id) { ran.push(id); },
      },
    };
    const out = await applyLayout(vscode);
    assert.ok(out.includes(EXPLORER));
    assert.ok(out.includes(AT_EDITOR));
    assert.ok(out.includes(CHAT_OPEN));
    assert.ok(!out.includes(SPLIT_RIGHT));
    assert.ok(!out.includes(CHAT_EDITOR));
    assert.ok(!ran.includes(CHAT_EDITOR));
    assert.ok(ran.includes('workbench.action.chat.open'));
    assert.ok(!ran.includes('workbench.action.closePanel'));
    assert.ok(!ran.includes('workbench.action.joinAllGroups'));
    assert.ok(!ran.includes('workbench.action.closeEditorsInOtherGroups'));
  });

  it('does not open an editor chat when the default panel chat is already there', async () => {
    const ran = [];
    const closed = [];
    const tab = chatTab('Chat');
    const vscode = {
      commands: {
        async executeCommand(id) { ran.push(id); },
      },
      window: {
        tabGroups: {
          all: [{ tabs: [tab] }],
          async close(tabToClose) { closed.push(tabToClose); },
        },
      },
    };
    const out = await applyLayout(vscode);
    assert.ok(!out.includes(CHAT_EDITOR));
    assert.ok(out.includes(CHAT_OPEN));
    assert.ok(!ran.includes(CHAT_EDITOR));
    assert.ok(!ran.includes(SPLIT_RIGHT));
    assert.deepEqual(closed, [tab]);
  });

  it('closes every editor chat tab and keeps the AT panel group', async () => {
    const a = chatTab('Chat');
    const b = chatTab('Chat');
    const closed = [];
    const vscode = {
      commands: {
        async executeCommand() {},
      },
      window: {
        tabGroups: {
          all: [{ tabs: [{ label: 'AT Panel' }] }, { tabs: [a, b] }],
          async close(tab) { closed.push(tab); },
        },
      },
    };
    assert.equal(chatTabs(vscode).length, 2);
    assert.equal(isEditorChatTab(a), true);
    await keepOneChat(vscode);
    assert.deepEqual(closed, [a, b]);
    const again = [];
    vscode.window.tabGroups.close = async (tab) => { again.push(tab); };
    await closeEditorChats(vscode);
    assert.deepEqual(again, [a, b]);
  });

  it('recognizes dest chat and AT panel tabs', () => {
    assert.equal(isChatTab(chatTab('Chat')), true);
    assert.equal(isAtTab({ label: 'AT Panel', input: { viewType: 'anchortrails.home.editor' } }), true);
    assert.equal(isAtTab({ label: 'README.md', input: { uri: { scheme: 'file' } } }), false);
    assert.equal(isChatTab({ label: 'README.md', input: { uri: { scheme: 'file' } } }), false);
  });
});
