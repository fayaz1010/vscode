'use strict';
/**
 * Dest Plan / Tasks — two tabs.
 * Folder (default): cards linked to the open workspace.
 * History: other plans (other repos / prior goals), never this card.
 */

const { sessionId } = require('./workspace');
const { stepListHtml, STEP_CSS, stackHtml } = require('./plan');
const { seedFrom } = require('./chat_seed');
const { openChat } = require('./drive');

const VIEW_ID = 'anchortrails.plan';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function folderItems(board, workspace) {
  const fromBoard = (board && board.folder) || [];
  if (fromBoard.length) return fromBoard;
  const live = board && board.live;
  if (live && (live.goal || live.cursor)) {
    const ws = workspace || (board && board.workspace) || {};
    return [{
      workspace_id: ws.id || '',
      goal: live.goal,
      cursor: live.cursor,
      playbook: live.playbook,
      steps: live.steps,
    }];
  }
  return [];
}

function normGoal(goal) {
  let text = String(goal || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const cut = text.split('. do not')[0].split(' — ')[0];
  text = cut;
  const colon = text.indexOf(': ');
  if (colon >= 24) text = text.slice(0, colon);
  return text.slice(0, 80);
}

function isLiveCard(item, workspace, live) {
  const ws = String((workspace && workspace.id) || (live && live.workspace_id) || '').toLowerCase();
  const goal = normGoal(live && live.goal);
  const sameWs = String((item && item.workspace_id) || '').toLowerCase() === ws;
  const sameGoal = normGoal(item && item.goal) === goal;
  return Boolean((ws && sameWs && (!goal || sameGoal)) || (goal && sameGoal));
}

function historyItems(board, workspace, live) {
  const rows = (board && board.history) || [];
  return rows.filter((item) => !isLiveCard(item, workspace || (board && board.workspace), live || (board && board.live)));
}

function cardHtml(item, live, kind) {
  const cursor = (live && live.cursor) || item.cursor || '';
  const goal = (live && live.goal) || item.goal || '';
  const playbook = (live && live.playbook) || item.playbook || 'task';
  const steps = String((live && live.steps) || item.steps || '');
  const doLine = (live && live.do) || item.do || '';
  const dont = (live && live.do_not) || item.do_not || '';
  const seedKind = kind || (live ? 'plan' : 'history');
  const stepsBody = seedKind === 'history' ? '' : stepListHtml(steps, esc);
  return `<article class="card seedable" data-kind="${esc(seedKind)}" data-goal="${esc(goal)}" data-cursor="${esc(cursor)}" data-playbook="${esc(playbook)}" data-steps="${esc(steps)}" data-workspace="${esc(item.workspace_id || '')}" data-label="${esc(goal)}">
    <div class="meta">${esc(playbook)} ${esc(cursor)}${item.workspace_id ? ` · ${esc(item.workspace_id)}` : ''}</div>
    <div class="goal">${esc(goal)}</div>
    ${seedKind === 'history' ? '' : (doLine ? `<p class="hint">do: ${esc(doLine)}</p>` : '')}
    ${seedKind === 'history' ? '' : (dont ? `<p class="hint">do not: ${esc(dont)}</p>` : '')}
    ${stepsBody}
  </article>`;
}

function planBoardHtml(data, tab) {
  const board = (data && data.task_board) || {};
  const workspace = (data && data.workspace) || board.workspace || {};
  const live = board.live || null;
  const folder = folderItems(board, workspace);
  const history = historyItems(board, workspace, live);
  const tasks = (data && data.tasks) || [];
  const on = tab === 'history' ? 'history' : 'plan';
  const folderBody = folder.length
    ? folder.map((item, i) => cardHtml(item, i === 0 ? live : null, 'plan')).join('')
    : '<p class="muted">No plan for this folder yet. A real task in @at chat starts one.</p>';
  const taskBody = tasks.length
    ? `<h3>Open tasks</h3>${tasks.map((t) => `<div class="card seedable" data-kind="task" data-label="${esc(t.title || t.id || 'task')}" data-description="${esc([t.status, t.assignee].filter(Boolean).join(' · '))}"><div>${esc(t.title)}</div><div class="meta">${esc([t.status, t.assignee].filter(Boolean).join(' · '))}</div></div>`).join('')}`
    : '';
  const historyBody = history.length
    ? history.map((item) => cardHtml(item, null, 'history')).join('')
    : '<p class="muted">No other plans yet.</p>';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground);
    margin: 0; padding: 8px 10px 20px; }
  .tabs { display: flex; gap: 0; margin: 0 0 10px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
  .tabs button { background: none; border: 0; color: inherit; padding: 6px 10px; cursor: pointer;
    opacity: .65; border-bottom: 2px solid transparent; }
  .tabs button.on { opacity: 1; border-bottom-color: var(--vscode-focusBorder, #3794ff); }
  .card { border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px;
    padding: 8px 10px; margin: 0 0 8px; }
  .meta { opacity: .65; margin-bottom: 4px; }
  .goal { font-weight: 600; margin-bottom: 4px; }
  .hint { opacity: .7; margin: 4px 0 0; }
  .muted { opacity: .7; }
  .seedable { cursor: pointer; }
  .seedable:hover { border-color: var(--vscode-focusBorder, #3794ff); }
  ${STEP_CSS}
  .pane { display: none; }
  .pane.on { display: block; }
</style></head>
<body>
  <div class="tabs">
    <button data-tab="plan" class="${on === 'plan' ? 'on' : ''}">Plan</button>
    <button data-tab="history" class="${on === 'history' ? 'on' : ''}">History</button>
  </div>
  <div id="plan" class="pane ${on === 'plan' ? 'on' : ''}">
    <p class="muted">${esc(workspace.id || workspace.path || 'No folder open')}</p>
    ${stackHtml((live && live.stack) || (data && data.stack), esc)}
    ${folderBody}
    ${on === 'plan' ? taskBody : ''}
  </div>
  <div id="history" class="pane ${on === 'history' ? 'on' : ''}">
    <p class="muted">Done on other plans — not this card. Double-click a card or step to put it in @at.</p>
    ${historyBody}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = () => vscode.postMessage({ cmd: 'tab', tab: btn.dataset.tab });
    });
    document.querySelectorAll('.seedable').forEach((el) => {
      el.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const plan = el.closest('[data-kind="plan"],[data-kind="history"]');
        vscode.postMessage({
          cmd: 'seed',
          kind: el.dataset.kind,
          label: el.dataset.label,
          description: el.dataset.description,
          goal: el.dataset.goal || (plan && plan.dataset.goal),
          cursor: el.dataset.cursor || (plan && plan.dataset.cursor),
          playbook: el.dataset.playbook || (plan && plan.dataset.playbook),
          steps: el.dataset.steps || (plan && plan.dataset.steps),
          workspace: el.dataset.workspace || (plan && plan.dataset.workspace),
          mark: el.dataset.mark,
        });
      };
    });
  </script>
</body></html>`;
}

function startPlanBoard(client, vscode) {
  let view = null;
  let tab = 'plan';

  async function paint() {
    if (!view) return;
    try {
      const data = client && typeof client.sessionPanel === 'function'
        ? await client.sessionPanel({ session_id: sessionId(vscode) })
        : {};
      view.webview.html = planBoardHtml(data, tab);
    } catch (err) {
      const msg = (err && err.message) || 'bridge error';
      view.webview.html = planBoardHtml({
        task_board: { folder: [], history: [] },
        workspace: { id: msg },
      }, tab);
    }
  }

  const provider = {
    resolveWebviewView(webviewView) {
      view = webviewView;
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.onDidReceiveMessage(async (msg) => {
        if (msg && msg.cmd === 'tab') {
          tab = msg.tab === 'history' ? 'history' : 'plan';
          paint();
          return;
        }
        if (msg && msg.cmd === 'seed') {
          const seed = seedFrom(msg);
          if (!seed) return;
          if (seed.hop && client && typeof client.pinHop === 'function') {
            try { await client.pinHop({ node: seed.hop }); } catch { /* offline */ }
          }
          try { await openChat(vscode, { query: seed.prompt, send: seed.send }); } catch { /* chat optional */ }
        }
      });
      paint();
    },
  };

  const sub = vscode.window && typeof vscode.window.registerWebviewViewProvider === 'function'
    ? vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
    : { dispose() { /* nothing was registered: nothing to release */ } };

  return {
    refresh: paint,
    dispose() {
      if (sub && typeof sub.dispose === 'function') sub.dispose();
      view = null;
      tab = 'plan';
    },
  };
}

module.exports = {
  VIEW_ID,
  folderItems,
  historyItems,
  cardHtml,
  planBoardHtml,
  startPlanBoard,
};
