'use strict';
/**
 * Dest workbench: Explorer left, AT Panel in the middle editor,
 * default Chat panel on the right. Never open a second editor chat.
 */

const EXPLORER = 'workbench.view.explorer';
const AT_EDITOR = 'anchortrails.home.openEditor';
const CHAT_EDITOR = 'workbench.action.chat.openInEditor';
const CHAT_OPEN = 'workbench.action.chat.open';
const CLOSE_PANEL = 'workbench.action.closePanel';
const SPLIT_RIGHT = 'workbench.action.splitEditorRight';
const LAYOUT_DELAYS_MS = [400, 1600, 3200];
const CHAT_SCHEMES = new Set([
  'vscode-chat',
  'vscode-chat-editor',
  'vscode-chat-session',
]);

function layoutCommands() {
  return [EXPLORER, AT_EDITOR, CHAT_OPEN];
}

function tabUri(tab) {
  const input = tab && tab.input;
  if (!input) return null;
  if (input.uri) return input.uri;
  if (input.modified && input.modified.uri) return input.modified.uri;
  return null;
}

function isChatTab(tab) {
  const uri = tabUri(tab);
  if (uri && CHAT_SCHEMES.has(uri.scheme)) return true;
  const label = String((tab && tab.label) || '');
  return /^Chat(\b|$)/i.test(label);
}

function isEditorChatTab(tab) {
  const uri = tabUri(tab);
  return Boolean(uri && uri.scheme === 'vscode-chat-editor');
}

function isAtTab(tab) {
  const label = String((tab && tab.label) || '');
  if (/^AT Panel(\b|$)/i.test(label)) return true;
  const viewType = tab && tab.input && tab.input.viewType;
  return viewType === 'anchortrails.home.editor';
}

function editorGroups(vscode) {
  return (vscode && vscode.window && vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
}

function chatTabs(vscode) {
  const found = [];
  for (const group of editorGroups(vscode)) {
    for (const tab of group.tabs || []) {
      if (isChatTab(tab)) found.push({ group, tab });
    }
  }
  return found;
}

function atTabs(vscode) {
  const found = [];
  for (const group of editorGroups(vscode)) {
    for (const tab of group.tabs || []) {
      if (isAtTab(tab)) found.push({ group, tab });
    }
  }
  return found;
}

async function closeEditorChats(vscode) {
  const closer = vscode && vscode.window && vscode.window.tabGroups
    && typeof vscode.window.tabGroups.close === 'function'
    ? vscode.window.tabGroups.close.bind(vscode.window.tabGroups)
    : null;
  if (!closer) return 0;
  let closed = 0;
  for (const group of editorGroups(vscode)) {
    for (const tab of group.tabs || []) {
      if (isAtTab(tab) || !isEditorChatTab(tab)) continue;
      try {
        await closer(tab, false);
        closed += 1;
      } catch { /* tab already gone */ }
    }
  }
  return closed;
}

async function keepOneChat(vscode) {
  return closeEditorChats(vscode);
}

async function applyLayout(vscode) {
  const exec = vscode && vscode.commands && vscode.commands.executeCommand;
  if (typeof exec !== 'function') return [];
  const ran = [];
  for (const id of [EXPLORER, AT_EDITOR]) {
    try {
      await exec(id);
      ran.push(id);
    } catch { /* view not ready */ }
  }
  await closeEditorChats(vscode);
  try {
    await exec(CHAT_OPEN);
    ran.push(CHAT_OPEN);
  } catch { /* chat contrib missing */ }
  return ran;
}

function startLayout(vscode) {
  const timers = [];
  let sub = null;
  let debounce = null;
  const run = () => applyLayout(vscode);
  const onTabs = () => {
    if (!editorGroups(vscode).some((g) => (g.tabs || []).some(isEditorChatTab))) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      closeEditorChats(vscode);
    }, 200);
  };
  for (const ms of LAYOUT_DELAYS_MS) {
    timers.push(setTimeout(run, ms));
  }
  const groups = vscode && vscode.window && vscode.window.tabGroups;
  if (groups && typeof groups.onDidChangeTabs === 'function') {
    sub = groups.onDidChangeTabs(onTabs);
  }
  return {
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      if (debounce) clearTimeout(debounce);
      if (sub && typeof sub.dispose === 'function') sub.dispose();
    },
  };
}

module.exports = {
  EXPLORER,
  AT_EDITOR,
  CHAT_EDITOR,
  CHAT_OPEN,
  SPLIT_RIGHT,
  CHAT_SCHEMES,
  LAYOUT_DELAYS_MS,
  layoutCommands,
  isChatTab,
  isEditorChatTab,
  isAtTab,
  chatTabs,
  atTabs,
  closeEditorChats,
  keepOneChat,
  applyLayout,
  startLayout,
};
