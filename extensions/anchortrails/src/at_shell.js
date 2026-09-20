'use strict';
/**
 * Middle AT Panel — every dest tab in one editor: Plan (key), Tools,
 * Nodes, Teams, Vault, Models, Workspace, Settings.
 */

const { STEP_CSS, stackHtml, mapHtml, MAP_CSS } = require('./plan');
const { folderItems, historyItems, cardHtml } = require('./plan_board');
const {
  rowsFromNodes,
  rowsFromTeams,
  rowsFromVault,
  rowsFromModels,
  rowsFromWorkspace,
} = require('./panel');
const { modelsHtml, taskPicksHtml } = require('./models');
const FALLBACK_SURFACES = [
  { id: 'auto', label: 'Auto', hint: 'assign() picks tools from the turn.', inputs: ['text', 'image', 'audio', 'video'], pack: [] },
  { id: 'drive', label: 'Computer use', hint: 'Look then go — browser, desktop, phone.', inputs: ['text', 'image'], pack: [] },
  { id: 'develop', label: 'Development', hint: 'OzFactory DESIGN→PLAN, then one BUILD task.', inputs: ['text', 'image'], pack: [] },
  { id: 'files', label: 'File tools', hint: 'Find and read on the bound folder.', inputs: ['text'], pack: [] },
  { id: 'docs', label: 'Documents', hint: 'PDF, Word, Excel, PowerPoint.', inputs: ['text', 'image'], pack: [] },
  { id: 'mesh', label: 'Mesh nodes', hint: 'Other machines. List, wake, hop a broader task.', inputs: ['text'], pack: [] },
  { id: 'ides', label: 'IDEs / orchestration', hint: 'Cross-chat drive. vscode_editFile stays dest.', inputs: ['text'], pack: [] },
  { id: 'remote', label: 'Remote work', hint: 'hands_invoke a goal. That node looks and reports.', inputs: ['text'], pack: [] },
];

const TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'models', label: 'Models' },
  { id: 'tools', label: 'Tools' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'teams', label: 'Teams' },
  { id: 'vault', label: 'Vault' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'settings', label: 'Settings' },
];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function listHtml(rows) {
  return (rows || []).map((row) => {
    const kind = row.kind || '';
    const seedable = kind && kind !== 'empty' && kind !== 'head';
    const attrs = seedable
      ? ` data-kind="${esc(kind)}" data-label="${esc(row.label)}" data-description="${esc(row.description || '')}"`
      : '';
    return `<div class="row ${esc(kind)}${seedable ? ' seedable' : ''}"${attrs}>
      <div class="label">${esc(row.label)}</div>
      ${row.description ? `<div class="meta">${esc(row.description)}</div>` : ''}
    </div>`;
  }).join('');
}

function toolsHtml(data) {
  const fromNode = (data && data.surfaces) || [];
  const surfaces = fromNode.length ? fromNode : FALLBACK_SURFACES;
  const active = (data && data.surface) || 'auto';
  const tiles = surfaces.map((row) => {
    const on = row.id === active || row.active ? ' on' : '';
    const inputs = (row.inputs || []).join(' · ');
    const pack = (row.pack || []).length ? `${row.pack.length} tools` : 'assign()';
    return `<button class="tile${on} seedable" data-kind="tool" data-id="${esc(row.id)}" data-label="${esc(row.label)}" data-hint="${esc(row.hint || '')}" title="${esc(row.hint || '')}">
      <div class="label">${esc(row.label)}</div>
      <div class="meta">${esc(pack)} · ${esc(inputs)}</div>
    </button>`;
  }).join('');
  return `<p class="muted">Pick a job. Chat stays the work surface. Tools stay a small pack.</p>
    <div class="grid">${tiles}</div>`;
}

function planHtml(data) {
  const board = (data && data.task_board) || {};
  const workspace = (data && data.workspace) || board.workspace || {};
  const live = (data && data.plan) || board.live || null;
  const folder = folderItems(board, workspace);
  const history = historyItems(board, workspace, live);
  const tasks = (data && data.tasks) || [];
  const liveCard = live && (live.goal || live.cursor)
    ? cardHtml({
      workspace_id: (workspace && workspace.id) || '',
      goal: live.goal,
      cursor: live.cursor,
      playbook: live.playbook,
      steps: live.steps,
      do: live.do,
      do_not: live.do_not,
    }, live, 'plan')
    : '';
  const folderBody = folder.length
    ? folder.map((item, i) => cardHtml(item, i === 0 && !liveCard ? live : null, 'plan')).join('')
    : '';
  const taskBody = tasks.length
    ? `<h3>Open tasks</h3>${tasks.map((t) => `<div class="card seedable" data-kind="task" data-label="${esc(t.title || t.id || 'task')}" data-description="${esc([t.status, t.assignee].filter(Boolean).join(' · '))}"><div>${esc(t.title)}</div><div class="meta">${esc([t.status, t.assignee].filter(Boolean).join(' · '))}</div></div>`).join('')}`
    : '';
  const historyBody = history.length
    ? history.map((item) => cardHtml(item, null, 'history')).join('')
    : '<p class="muted">No other plans yet.</p>';
  const main = liveCard || folderBody || '<p class="muted">No plan for this folder yet. A real task in @at chat starts one.</p>';
  const stack = stackHtml((live && live.stack) || (data && data.stack), esc);
  // The map beside the stack. `data.map` is the bridge's /api/map envelope, fetched by
  // the editor host on the same paint; absent renders as one muted line.
  const map = mapHtml(data && data.map, esc);
  return `<p class="muted">${esc((workspace && (workspace.id || workspace.path)) || 'No folder open')}</p>
    <button data-cmd="refresh" class="refresh">Refresh plan</button>
    <p class="hint">Rescores done vs planned against the goal. /plan in chat asks; /plan refresh does the same. Double-click a card, step, node, or tile to put it in @at.</p>
    ${stack}
    ${map}
    ${main}
    ${taskBody}
    <h3>Other plans</h3>
    ${historyBody}`;
}

function settingsHtml(data) {
  const credits = (data && data.credits) || {};
  const tokens = (data && data.tokens) || {};
  const who = credits.email || (credits.signed_in ? 'signed in' : 'not signed in');
  const meter = credits.unlimited ? 'Unlimited' : [
    credits.used != null ? `${credits.used} used` : '',
    credits.remaining != null ? `${credits.remaining} left` : '',
  ].filter(Boolean).join(' · ') || 'no meter yet';
  return `<div class="card">
      <div class="label">Credits</div>
      <div class="meta">${esc(who)}${credits.tier ? ` · ${esc(credits.tier)}` : ''}</div>
      <div class="meta">${esc(meter)}</div>
    </div>
    <div class="card">
      <div class="label">Model / action tokens</div>
      <div class="meta">${esc(`${tokens.today || 0} today · ${tokens.pending || 0} pending`)}</div>
    </div>
    <h3>Vault</h3>
    ${listHtml(rowsFromVault(data && data.vault))}
    <h3>Models</h3>
    ${taskPicksHtml(data)}
    ${listHtml(rowsFromModels(data && data.models))}`;
}

function paneHtml(id, data) {
  if (id === 'plan') return planHtml(data);
  if (id === 'tools') return toolsHtml(data);
  if (id === 'nodes') return listHtml(rowsFromNodes(data && data.nodes));
  if (id === 'teams') return listHtml(rowsFromTeams(data && data.teams));
  if (id === 'vault') return listHtml(rowsFromVault(data && data.vault));
  if (id === 'models') return modelsHtml(data);
  if (id === 'workspace') {
    return listHtml(rowsFromWorkspace(data && data.workspace, data && data.skills, data && data.actions));
  }
  if (id === 'settings') return settingsHtml(data);
  return '';
}

function shellHtml(data, tab, err) {
  const on = TABS.some((t) => t.id === tab) ? tab : 'plan';
  const banner = err
    ? `<p class="warn">AT node ${esc(err.status || '')} ${esc(err.message || err)}.</p>`
    : '';
  const tabs = TABS.map((t) => (
    `<button data-tab="${t.id}" class="${t.id === on ? 'on' : ''}">${t.label}</button>`
  )).join('');
  const panes = TABS.map((t) => (
    `<div id="${t.id}" class="pane ${t.id === on ? 'on' : ''}">${paneHtml(t.id, data || {})}</div>`
  )).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground);
    margin: 0; padding: 8px 10px 20px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 0; margin: 0 0 10px;
    border-bottom: 1px solid var(--vscode-widget-border, #333); }
  .tabs button { background: none; border: 0; color: inherit; padding: 6px 10px; cursor: pointer;
    opacity: .65; border-bottom: 2px solid transparent; }
  .tabs button.on { opacity: 1; border-bottom-color: var(--vscode-focusBorder, #3794ff); }
  .pane { display: none; }
  .pane.on { display: block; }
  .muted { opacity: .7; line-height: 1.4; }
  .warn { color: var(--vscode-errorForeground, #f48771); }
  .card, .row { border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px;
    padding: 8px 10px; margin: 0 0 6px; }
  .label { font-weight: 600; }
  .meta { opacity: .65; margin-top: 3px; }
  .goal { font-weight: 600; margin-bottom: 4px; }
  .hint { opacity: .7; margin: 4px 0 0; }
  h3 { font-size: 11px; margin: 12px 0 6px; opacity: .8; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .tile { text-align: left; background: var(--vscode-editor-background, #1e1e1e);
    color: inherit; border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px;
    padding: 8px 9px; cursor: pointer; }
  .tile.on { border-color: var(--vscode-focusBorder, #3794ff); }
  .seedable { cursor: pointer; }
  .seedable:hover { border-color: var(--vscode-focusBorder, #3794ff); }
  .refresh, .search button, .row button { margin: 0 0 8px; padding: 5px 10px; cursor: pointer;
    background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff);
    border: 0; border-radius: 4px; }
  .search { display: flex; gap: 6px; }
  .search input { flex: 1; padding: 4px 6px; }
  select { max-width: 160px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 4px; }
  ${STEP_CSS}
  ${MAP_CSS}
</style></head>
<body>
  ${banner}
  <div class="tabs">${tabs}</div>
  ${panes}
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = () => vscode.postMessage({ cmd: 'tab', tab: btn.dataset.tab });
    });
    document.querySelectorAll('[data-id]').forEach((btn) => {
      btn.onclick = () => vscode.postMessage({ cmd: 'surface', id: btn.dataset.id });
    });
    document.querySelectorAll('.seedable').forEach((el) => {
      el.ondblclick = (e) => {
        if (e.target.closest('[data-cmd],[data-tab],[data-field]')) return;
        e.preventDefault();
        e.stopPropagation();
        const plan = el.closest('[data-kind="plan"],[data-kind="history"]');
        vscode.postMessage({
          cmd: 'seed',
          kind: el.dataset.kind,
          id: el.dataset.id,
          label: el.dataset.label,
          description: el.dataset.description,
          hint: el.dataset.hint,
          goal: el.dataset.goal || (plan && plan.dataset.goal),
          cursor: el.dataset.cursor || (plan && plan.dataset.cursor),
          playbook: el.dataset.playbook || (plan && plan.dataset.playbook),
          steps: el.dataset.steps || (plan && plan.dataset.steps),
          workspace: el.dataset.workspace || (plan && plan.dataset.workspace),
          mark: el.dataset.mark,
        });
      };
    });
    document.querySelectorAll('[data-cmd]').forEach((el) => {
      const send = () => {
        const q = (document.querySelector('[data-field="q"]') || {}).value || '';
        const row = el.closest('[data-task]');
        const slugEl = row && row.querySelector('[data-field="slug"]');
        const fbEl = row && row.querySelector('[data-field="fallback"]');
        vscode.postMessage({
          cmd: el.dataset.cmd,
          id: el.dataset.id,
          task: el.dataset.task,
          draft: el.dataset.draft === '1',
          q,
          slug: slugEl ? slugEl.value : undefined,
          fallback: fbEl ? fbEl.value : undefined,
        });
      };
      if (el.tagName === 'SELECT') el.onchange = send;
      else el.onclick = send;
    });
    const box = document.querySelector('[data-field="q"]');
    if (box) box.onkeydown = (e) => {
      if (e.key === 'Enter') {
        vscode.postMessage({ cmd: 'search-models', q: box.value || '' });
      }
    };
  </script>
</body></html>`;
}

module.exports = {
  TABS,
  shellHtml,
  planHtml,
  toolsHtml,
};
