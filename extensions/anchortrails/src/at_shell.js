'use strict';
/**
 * Middle AT Panel — every dest tab in one editor: Dashboard (the loop at a
 * glance), Map (the repo-dash map of the open folder), Plan, Models, Tools,
 * Nodes, Teams, Vault, Workspace, Settings.
 */

const { STEP_CSS, stackHtml, mapHtml, MAP_CSS } = require('./plan');
const { dashboardHtml, DASH_CSS } = require('./dashboard');
const { GRAPH_CSS } = require('./map_graph');
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
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'map', label: 'Map' },
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
  return `<p class="muted">${esc((workspace && (workspace.id || workspace.path)) || 'No folder open')}</p>
    <button data-cmd="refresh" class="refresh">Refresh plan</button>
    <p class="hint">Rescores done vs planned against the goal. /plan in chat asks; /plan refresh does the same. Double-click a card, step, node, or tile to put it in @at.</p>
    ${stack}
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
  // `data.map` is the bridge's /api/map envelope for the open folder, fetched by the
  // editor host on the same paint. The Map tab shows it finding by finding; the
  // Dashboard sums it. Absent renders as one muted line on each.
  if (id === 'dashboard') return dashboardHtml(data && data.map, esc, data && data.focusTask);
  if (id === 'map') return mapHtml(data && data.map, esc);
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
  const on = TABS.some((t) => t.id === tab) ? tab : 'dashboard';
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
  .flash { outline: 1px solid var(--vscode-focusBorder, #3794ff); border-radius: 4px; }
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
  ${DASH_CSS}
  ${GRAPH_CSS}
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
    // THE GRAPH IS A VIEWPORT. Wheel zooms about the cursor, drag pans, a click zooms
    // to that node and names it in the caption, whose link opens the zone's findings
    // below (Map tab) or switches to the Map tab (Dashboard). Full screen fixes the
    // graph over the panel; Esc or the button brings it back. All on the viewBox.
    const showZone = (slug) => {
      const el = document.getElementById('z-' + slug);
      if (!el) { vscode.postMessage({ cmd: 'tab', tab: 'map' }); return; }
      if (el.tagName === 'DETAILS') el.open = true;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    };
    document.querySelectorAll('.mgraph').forEach((box) => {
      const svg = box.querySelector('svg');
      if (!svg) return;
      const W = Number(box.dataset.w) || 560; const H = Number(box.dataset.h) || 300;
      const caption = box.querySelector('.mcaption');
      let vb = { x: 0, y: 0, w: W, h: H };
      const apply = () => svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map((n) => n.toFixed(2)).join(' '));
      const reset = () => { vb = { x: 0, y: 0, w: W, h: H }; apply(); if (caption) caption.textContent = ''; };
      const toSvg = (cx, cy) => {
        const r = svg.getBoundingClientRect();
        // xMidYMid meet: the drawing is letterboxed inside the element
        const s = Math.min(r.width / vb.w, r.height / vb.h) || 1;
        const ox = (r.width - vb.w * s) / 2; const oy = (r.height - vb.h * s) / 2;
        return { x: vb.x + (cx - r.left - ox) / s, y: vb.y + (cy - r.top - oy) / s };
      };
      const zoomAt = (px, py, factor) => {
        const w = Math.max(W / 40, Math.min(W * 4, vb.w * factor)); const h = w * (H / W);
        vb = { x: px - (px - vb.x) * (w / vb.w), y: py - (py - vb.y) * (h / vb.h), w, h };
        apply();
      };
      svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = toSvg(e.clientX, e.clientY);
        zoomAt(p.x, p.y, e.deltaY > 0 ? 1.18 : 1 / 1.18);
      }, { passive: false });
      let drag = null;
      svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false }; svg.classList.add('panning'); svg.setPointerCapture(e.pointerId); });
      svg.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const r = svg.getBoundingClientRect();
        const s = Math.min(r.width / vb.w, r.height / vb.h) || 1;
        const dx = (e.clientX - drag.x) / s; const dy = (e.clientY - drag.y) / s;
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
        vb.x = drag.vx - dx; vb.y = drag.vy - dy; apply();
      });
      const endDrag = () => { if (drag) { svg.classList.remove('panning'); } };
      svg.addEventListener('pointerup', (e) => {
        const wasDrag = drag && drag.moved; endDrag();
        drag = null;
        if (wasDrag) return;
        const g = e.target.closest && e.target.closest('[data-zone]');
        if (!g) return;
        const c = g.querySelector('circle');
        const cx = Number(c.getAttribute('cx')); const cy = Number(c.getAttribute('cy'));
        // zoom to the node: a quarter of the map wide, centred on it
        const w = W / 4; const h = H / 4;
        vb = { x: cx - w / 2, y: cy - h / 2, w, h }; apply();
        const t = g.querySelector('title');
        if (caption) {
          caption.textContent = t ? t.textContent : g.dataset.zone;
          if (!g.classList.contains('grey')) {
            const a = document.createElement('a'); a.href = '#'; a.textContent = 'findings ↓';
            a.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); box.classList.remove('full'); showZone(g.dataset.zone); };
            caption.appendChild(a);
          }
        }
      });
      svg.addEventListener('pointercancel', () => { endDrag(); drag = null; });
      svg.addEventListener('dblclick', (e) => { e.preventDefault(); const g = e.target.closest && e.target.closest('[data-zone]'); if (g) { box.classList.remove('full'); showZone(g.dataset.zone); } });
      box.querySelectorAll('[data-graph]').forEach((btn) => {
        btn.onclick = (e) => {
          e.preventDefault();
          if (btn.dataset.graph === 'reset') reset();
          if (btn.dataset.graph === 'full') { box.classList.toggle('full'); btn.textContent = box.classList.contains('full') ? '⤡ Exit full screen' : '⤢ Full screen'; }
        };
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && box.classList.contains('full')) { box.classList.remove('full'); const b = box.querySelector('[data-graph="full"]'); if (b) b.textContent = '⤢ Full screen'; }
      });
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
