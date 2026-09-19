'use strict';
/**
 * W4: bridge. W5: LM provider. W6: default ChatParticipant.
 * W7: turn-scoped registerToolDefinition → /api/invoke.
 */

const vscode = require('vscode');
const { BridgeClient } = require('./bridge');
const { VENDOR, createProvider } = require('./provider');
const { PARTICIPANT_ID, createHandler } = require('./participant');
const { startDriveLoop } = require('./drive');
const { startAccount } = require('./account');
const { startBind } = require('./workspace');
const { startPanel } = require('./panel');
const { startPlanBoard } = require('./plan_board');
const { startSettings } = require('./settings');
const { startHome } = require('./home');
const { startLayout } = require('./layout');
const { startViewer } = require('./viewer');

function activate(context) {
  console.log('[anchortrails] activate');
  const cfg = vscode.workspace.getConfiguration('anchortrails');
  const client = new BridgeClient({
    baseUrl: cfg.get('bridgeUrl') || undefined,
    token: cfg.get('bridgeToken') || undefined,
  });
  const planBoard = startPlanBoard(client, vscode);
  const settings = startSettings(client, vscode);
  const viewer = startViewer(client, vscode);
  let home;
  const panel = startPanel(client, vscode, {
    onPlanRefresh() {
      planBoard.refresh();
      if (home) home.refresh();
    },
  });
  home = startHome(client, vscode, {
    onSurface(id) {
      if (id === 'drive') viewer.startDesktop();
      else viewer.stopDesktop();
    },
    onPlan(next) {
      panel.refresh({ plan: next });
      planBoard.refresh();
    },
  });
  try {
    context.subscriptions.push(startAccount(client, vscode));
    context.subscriptions.push(panel);
    context.subscriptions.push(planBoard);
    context.subscriptions.push(settings);
    context.subscriptions.push(home);
    context.subscriptions.push(viewer);
    context.subscriptions.push(startLayout(vscode));
    console.log('[anchortrails] auth provider registered');
  } catch (err) {
    console.error('[anchortrails] auth provider failed', err);
    vscode.window.showErrorMessage(`AnchorTrails auth failed to start: ${err.message || err}`);
  }
  try {
    if (vscode.lm && typeof vscode.lm.registerLanguageModelChatProvider === 'function') {
      context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(VENDOR, createProvider(client, vscode)),
      );
    }
    if (vscode.chat && typeof vscode.chat.createChatParticipant === 'function') {
      const handler = createHandler(client, vscode, {
        onPlan: (next) => {
          panel.refresh({ plan: next });
          planBoard.refresh();
          home.refresh();
        },
      });
      context.subscriptions.push(
        vscode.chat.createChatParticipant(PARTICIPANT_ID, handler),
        { dispose() { handler.dispose(); } },
      );
    }
    context.subscriptions.push(startDriveLoop(client, vscode));
    context.subscriptions.push(startBind(client, vscode, () => {
      planBoard.refresh();
      panel.refresh();
      home.refresh();
    }));
  } catch (err) {
    console.error('[anchortrails] activate after auth failed', err);
  }
  return { client };
}

function deactivate() {
  /* Extension shutdown is handled by VS Code disposing of subscriptions. */
}

module.exports = { activate, deactivate };

