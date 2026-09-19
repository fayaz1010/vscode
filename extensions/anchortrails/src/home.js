'use strict';
/**
 * Dest AT Panel home — surface tiles. Clicking one POSTs /api/agent/surface
 * so the next prepare summons that pack. Never dump the floor.
 */

const VIEW_ID = 'anchortrails.home';

// Shipped in dest so a stale :8765 (no /api/agent/panel) never blanks the bar.
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

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const { sessionId, folderPath } = require('./workspace');
const { stepListHtml, STEP_CSS, gatePlan } = require('./plan');
const { shellHtml } = require('./at_shell');
const { seedFrom } = require('./chat_seed');
const { openChat } = require('./drive');

function planStrip(data) {
  const live = (data && data.plan) || (data && data.task_board && data.task_board.live);
  if (!live || !(live.goal || live.cursor)) return '';
  const doLine = live.do ? `<p class="hint">do: ${esc(live.do)}</p>` : '';
  const dont = live.do_not ? `<p class="hint">do not: ${esc(live.do_not)}</p>` : '';
  return `<section class="plan">
    <h2>Plan ${esc(live.cursor || '')}</h2>
    <p class="goal">${esc(live.goal || '')}</p>
    ${doLine}${dont}
    ${stepListHtml(live.steps, esc)}
  </section>`;
}

function homeHtml(data, err) {
  const fromNode = (data && data.surfaces) || [];
  const surfaces = fromNode.length ? fromNode : FALLBACK_SURFACES;
  const active = (data && data.surface) || 'auto';
  const wide = Boolean(data && data.wide);
  const banner = err
    ? `<p class="warn">AT node ${esc(err.status || '')} ${esc(err.message || err)}. Tiles below are local until /api/agent/panel is up.</p>`
    : '';
  const tiles = surfaces.map((row) => {
    const on = row.id === active || row.active ? ' on' : '';
    const inputs = (row.inputs || []).join(' · ');
    const pack = (row.pack || []).length ? `${row.pack.length} tools` : 'assign()';
    return `<button class="tile${on}" data-id="${esc(row.id)}" title="${esc(row.hint || '')}">
      <div class="label">${esc(row.label)}</div>
      <div class="meta">${esc(pack)} · ${esc(inputs)}</div>
    </button>`;
  }).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground);
    margin: 0; padding: 10px 10px 20px; }
  h1 { font-size: 13px; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 12px; font-weight: 600; margin: 14px 0 6px; }
  .muted { opacity: .7; margin: 0 0 10px; line-height: 1.4; }
  .warn { color: var(--vscode-errorForeground, #f48771); margin: 0 0 10px; line-height: 1.4; }
  .grid { display: grid; grid-template-columns: ${wide ? '1fr 1fr' : '1fr'}; gap: 6px; }
  .tile { text-align: left; background: var(--vscode-editor-background, #1e1e1e);
    color: inherit; border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px;
    padding: 8px 9px; cursor: pointer; }
  .tile.on { border-color: var(--vscode-focusBorder, #3794ff); }
  .label { font-weight: 600; }
  .meta { opacity: .6; margin-top: 3px; }
  .plan { margin: 0 0 14px; padding: 0 0 10px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
  .goal { font-weight: 600; margin: 0 0 4px; }
  .hint { opacity: .7; margin: 4px 0 0; }
  ${STEP_CSS}
</style></head>
<body>
  <h1>AT Panel</h1>
  ${planStrip(data)}
  <p class="muted">Pick a job. Chat stays the work surface. assign() picks the model for text, image, audio, or video. Tools stay a small pack.</p>
  ${banner}
  <div class="grid">${tiles}</div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-id]').forEach((btn) => {
      btn.onclick = () => vscode.postMessage({ cmd: 'surface', id: btn.dataset.id });
    });
    document.querySelectorAll('.seedable').forEach((el) => {
      el.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        vscode.postMessage({
          cmd: 'seed',
          kind: el.dataset.kind,
          label: el.dataset.label,
          mark: el.dataset.mark,
        });
      };
    });
  </script>
</body></html>`;
}

// A finding opens its file at its line. The path is repo-relative; the root is the
// map's own repo (what was analysed) and, failing that, the bound folder. Nothing
// outside that root can be opened: a relative path that escapes it is refused
// rather than resolved, for the same reason the bridge fences its own open-code.
// The map says which repo it describes, but a map is data that travels: built on one
// machine, served by a bridge on another. A `repo` that does not exist here is that
// machine's path, not ours -- fall through to the bound folder, which is where the
// same code sits on this one. An absent map, or a map with no repo, does the same.
function codeRoot(map, vscode, exists) {
  const fs = require('fs');
  const there = exists || ((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const repo = map && typeof map.repo === 'string' ? map.repo : '';
  if (repo && there(repo)) return repo;
  return folderPath(vscode) || '';
}

async function openCode(vscode, root, rel, line) {
  const path = require('path');
  if (!root || !rel) return false;
  const abs = path.resolve(root, rel);
  if (abs === path.resolve(root) || !abs.startsWith(path.resolve(root) + path.sep)) return false;
  if (!vscode.Uri || !vscode.workspace || typeof vscode.workspace.openTextDocument !== 'function') return false;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
  const at = Math.max(0, Number(line || 1) - 1);
  const opts = { preview: false };
  if (vscode.Range) opts.selection = new vscode.Range(at, 0, at, 0);
  if (vscode.window && typeof vscode.window.showTextDocument === 'function') {
    await vscode.window.showTextDocument(doc, opts);
  }
  return true;
}

// The map's signature: when this is unchanged, a poll paints nothing.
// The signature covers the map, the plan AND the run: the runner writes run.json
// after every task, and a task landing beside an unchanged map must still repaint.
function mapSig(map) {
  const m = (map && map.overview && map.overview.meta) || {};
  const plan = map && map.plan;
  const run = map && map.run;
  return [m.generated_at, m.stages_done, m.status, m.findings_total, m.findings_actionable,
    plan && plan.plan_id, plan && plan.revision,
    run && run.status, run && (run.updated_at || run.finished_at), run && Array.isArray(run.results) ? run.results.length : 0,
    map && map.running ? 1 : 0].join('/');
}

const MAP_POLL_MS = 5000;

function startHome(client, vscode, extras = {}) {
  let view = null;
  let editor = null;
  let retries = 0;
  let tab = 'plan';
  let lastCheck = null;
  let modelExtra = {};
  let lastMap = null;
  let pollTimer = null;

  function overlay(data) {
    if (!data || !lastCheck) return data;
    const next = { ...data };
    if (next.plan) next.plan = gatePlan(next.plan, lastCheck);
    if (next.task_board && next.task_board.live) {
      next.task_board = {
        ...next.task_board,
        live: gatePlan(next.task_board.live, lastCheck),
      };
    }
    return next;
  }

  function bindSurface(webview) {
    if (!webview || typeof webview.onDidReceiveMessage !== 'function') return;
    webview.onDidReceiveMessage(async (msg) => {
      if (!msg) return;
      if (msg.cmd === 'tab') {
        tab = msg.tab || 'plan';
        paint();
        return;
      }
      if (msg.cmd === 'open-code') {
        const [rel, line] = String(msg.id || '').split('#');
        const root = codeRoot(lastMap, vscode);
        try { await openCode(vscode, root, rel, Number(line) || 1); } catch { /* file may be gone */ }
        return;
      }
      if (msg.cmd === 'show-task') {
        // The task lives on the Plan tab; switch there and let the next paint carry
        // the id so the shell can mark it. Nothing to fetch.
        tab = 'plan';
        paint({ focusTask: msg.task || '' });
        return;
      }
      if (msg.cmd === 'chat') {
        // A panel button is a sentence: it goes into @at and is sent. The chat does
        // the work (/map, /run) and the panel shows the result on its poll.
        try { await openChat(vscode, { query: String(msg.id || ''), send: true }); } catch { /* chat optional */ }
        return;
      }
      if (msg.cmd === 'refresh') {
        if (client && typeof client.refreshPlan === 'function') {
          try {
            const out = await client.refreshPlan({
              session_id: sessionId(vscode),
              check: lastCheck,
            });
            lastCheck = null;
            if (out && out.plan && typeof extras.onPlan === 'function') {
              extras.onPlan(out.plan);
            }
          } catch { /* offline */ }
        }
        paint();
        return;
      }
      if (msg.cmd === 'search-models' && client && typeof client.searchModels === 'function') {
        try {
          const out = await client.searchModels({ q: msg.q });
          modelExtra = {
            q: msg.q || '',
            hits: (out && out.hits) || [],
            group: (out && out.group) || [],
            tasks: (out && out.tasks) || [],
            searchError: '',
          };
        } catch (err) {
          modelExtra = { q: msg.q || '', hits: [], searchError: String((err && err.message) || err) };
        }
        tab = 'models';
        paint();
        return;
      }
      if (msg.cmd === 'add-model' && client && typeof client.addModel === 'function') {
        const id = msg.id || msg.q;
        try {
          const out = await client.addModel({ id });
          modelExtra = {
            ...modelExtra,
            q: msg.q || modelExtra.q || '',
            group: (out && out.group) || modelExtra.group,
            searchError: '',
          };
        } catch (err) {
          modelExtra = {
            ...modelExtra,
            q: msg.q || modelExtra.q || '',
            searchError: String((err && err.message) || err),
          };
        }
        tab = 'models';
        paint();
        return;
      }
      if (msg.cmd === 'set-task' && client && typeof client.setTaskModel === 'function') {
        try {
          const out = await client.setTaskModel({ task: msg.task, slug: msg.slug, fallback: msg.fallback });
          modelExtra = { ...modelExtra, tasks: (out && out.tasks) || modelExtra.tasks };
        } catch { /* offline */ }
        paint();
        return;
      }
      if (msg.cmd === 'seed') {
        const seed = seedFrom(msg);
        if (seed) {
          if (seed.surface && client && typeof client.pickSurface === 'function') {
            try { await client.pickSurface({ id: seed.surface }); } catch { /* offline */ }
          }
          if (seed.hop && client && typeof client.pinHop === 'function') {
            try { await client.pinHop({ node: seed.hop }); } catch { /* offline */ }
          }
          try { await openChat(vscode, { query: seed.prompt, send: seed.send }); } catch { /* chat optional */ }
        }
        return;
      }
      if (msg.cmd !== 'surface') return;
      if (client && typeof client.pickSurface === 'function') {
        try { await client.pickSurface({ id: msg.id }); } catch { /* offline */ }
      }
      if (typeof extras.onSurface === 'function') {
        try { extras.onSurface(msg.id); } catch { /* viewer is optional */ }
      }
      paint();
    });
  }

  function write(target, html) {
    if (target && target.webview) target.webview.html = html;
  }

  async function paint(extra = {}) {
    if (!view && !editor) return;
    const fallback = overlay({ surface: 'auto', surfaces: FALLBACK_SURFACES, wide: Boolean(editor) });
    write(view, homeHtml(fallback));
    write(editor, shellHtml(fallback, tab));
    try {
      const data = client && typeof client.sessionPanel === 'function'
        ? await client.sessionPanel({ session_id: sessionId(vscode) })
        : {};
      // The map rides on the same paint. Its failure is its own -- a bridge that
      // cannot read the map still has a plan to show, so this never throws into
      // the panel's error path; it renders as "no map yet" instead.
      let map = null;
      if (client && typeof client.map === 'function') {
        try { map = await client.map(); } catch (err) { map = { ok: false, reason: String((err && err.message) || err) }; }
      }
      lastMap = map;
      retries = 0;
      const next = {
        ...data,
        map,
        focusTask: extra.focusTask || '',
        wide: Boolean(editor),
        models: { ...((data && data.models) || {}), ...modelExtra },
      };
      write(view, homeHtml(next));
      write(editor, shellHtml(next, tab));
    } catch (err) {
      write(view, homeHtml(fallback, err));
      write(editor, shellHtml(fallback, tab, err));
      if (retries < 3) {
        retries += 1;
        setTimeout(paint, 2000);
      }
    }
  }

  async function openEditor() {
    const col = vscode.ViewColumn && vscode.ViewColumn.One;
    if (editor && typeof editor.reveal === 'function') {
      editor.reveal(col || 1, true);
      return editor;
    }
    if (!vscode.window || typeof vscode.window.createWebviewPanel !== 'function') return null;
    editor = vscode.window.createWebviewPanel(
      `${VIEW_ID}.editor`,
      'AT Panel',
      { viewColumn: col || 1, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    editor.webview.options = { enableScripts: true };
    bindSurface(editor.webview);
    // LIVE WHILE IT IS LOOKED AT. The editor used to repaint only on a click, so a
    // re-map after a task closed never reached an open panel. A hidden tab pays
    // nothing; a visible one asks the bridge every few seconds and repaints only
    // when the map's signature moved.
    const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
    const startPoll = () => {
      if (pollTimer || !client || typeof client.map !== 'function') return;
      pollTimer = setInterval(async () => {
        if (!editor) return stopPoll();
        try {
          const fresh = await client.map();
          if (mapSig(fresh) !== mapSig(lastMap)) await paint();
        } catch { /* offline: try again next tick */ }
      }, MAP_POLL_MS);
    };
    if (typeof editor.onDidChangeViewState === 'function') {
      editor.onDidChangeViewState((e) => {
        const visible = e && e.webviewPanel ? e.webviewPanel.visible : editor && editor.visible;
        if (visible) startPoll(); else stopPoll();
      });
    }
    if (typeof editor.onDidDispose === 'function') {
      editor.onDidDispose(() => { stopPoll(); editor = null; });
    }
    await paint();
    if (editor && editor.visible !== false) startPoll();
    return editor;
  }

  const provider = {
    resolveWebviewView(webviewView) {
      view = webviewView;
      webviewView.webview.options = { enableScripts: true };
      bindSurface(webviewView.webview);
      paint();
    },
  };

  const sub = vscode.window && typeof vscode.window.registerWebviewViewProvider === 'function'
    ? vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
    : { dispose() { /* nothing was registered: nothing to release */ } };

  const cmds = [];
  if (vscode.commands && typeof vscode.commands.registerCommand === 'function') {
    cmds.push(vscode.commands.registerCommand('anchortrails.surface.pick', () => {
      openEditor();
    }));
    cmds.push(vscode.commands.registerCommand('anchortrails.home.openEditor', () => openEditor()));
    cmds.push(vscode.commands.registerCommand('anchortrails.plan.applyCheck', (check) => {
      lastCheck = check || null;
      paint();
    }));
  }

  return {
    refresh: paint,
    applyCheck(check) {
      lastCheck = check || null;
      return paint();
    },
    openEditor,
    dispose() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (sub && typeof sub.dispose === 'function') sub.dispose();
      if (editor && typeof editor.dispose === 'function') editor.dispose();
      for (const c of cmds) {
        if (c && typeof c.dispose === 'function') c.dispose();
      }
    },
  };
}

module.exports = {
  VIEW_ID,
  codeRoot,
  FALLBACK_SURFACES,
  homeHtml,
  planStrip,
  startHome,
  openCode,
  mapSig,
};
