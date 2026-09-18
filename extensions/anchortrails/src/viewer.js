'use strict';
/**
 * Dest peek viewer — opt-in file peek + computer-use desktop stream.
 * File clicks stay in dest's real editor so vscode_editFile can apply hunks.
 */

const VIEW_TYPE = 'anchortrails.viewer';
const FILE_CAP = 200000;
const POLL_MS = 700;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPeekUri(uri) {
  return Boolean(uri && uri.scheme === 'file');
}

function isBinaryText(text) {
  const sample = String(text || '').slice(0, 1024);
  return sample.includes('\u0000');
}

function peekFileState(doc) {
  if (!doc || !isPeekUri(doc.uri)) return null;
  const text = typeof doc.getText === 'function' ? doc.getText() : '';
  const path = (doc.uri && doc.uri.fsPath) || '';
  const name = path.split(/[\\/]/).pop() || 'file';
  if (isBinaryText(text)) {
    return { kind: 'file', name, path, binary: true, text: '', capped: false };
  }
  const capped = text.length > FILE_CAP;
  return {
    kind: 'file',
    name,
    path,
    binary: false,
    text: capped ? text.slice(0, FILE_CAP) : text,
    capped,
  };
}

function viewerHtml(state) {
  const kind = (state && state.kind) || 'file';
  const title = kind === 'desktop' ? 'Desktop' : (state && state.name) || 'File';
  const meta = kind === 'desktop'
    ? 'Computer use · live'
    : (state && state.path) || '';
  let body = '';
  if (kind === 'desktop') {
    const src = state && state.src
      ? `data:${esc(state.mime || 'image/jpeg')};base64,${state.src}`
      : '';
    body = `<img class="desk" id="desk" alt="desktop" src="${src}">
      <p class="muted" id="desk-status">${esc(state && state.error ? state.error : src ? '' : 'Waiting for a frame…')}</p>`;
  } else if (state && state.binary) {
    body = '<p class="muted">Binary file. Open in the editor to view.</p>';
  } else {
    body = `<pre>${esc(state && state.text)}</pre>`;
    if (state && state.capped) body += '<p class="muted">Truncated for the peek.</p>';
  }
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); font-size: 12px;
    color: var(--vscode-foreground); overflow: hidden; }
  .sheet { height: 100%; display: flex; flex-direction: column;
    transform: translateX(24px); opacity: 0;
    animation: in 280ms ease forwards; }
  .sheet.out { animation: out 180ms ease forwards; }
  @keyframes in { to { transform: translateX(0); opacity: 1; } }
  @keyframes out { to { transform: translateX(24px); opacity: 0; } }
  header { display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
  h1 { font-size: 12px; margin: 0; font-weight: 600; flex: 1; }
  .meta { opacity: .6; font-size: 11px; }
  button { background: none; color: inherit; border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 4px; padding: 3px 8px; cursor: pointer; }
  .body { flex: 1; overflow: auto; padding: 10px; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .desk { width: 100%; height: auto; display: block; border-radius: 4px; }
  .muted { opacity: .7; }
</style></head>
<body>
  <div class="sheet" id="sheet">
    <header>
      <h1>${esc(title)}</h1>
      <span class="meta">${esc(meta)}</span>
      ${kind === 'file' ? '<button data-cmd="edit">Edit</button>' : ''}
      <button data-cmd="close">Close</button>
    </header>
    <div class="body">${body}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.cmd === 'close') {
          document.getElementById('sheet').classList.add('out');
          setTimeout(() => vscode.postMessage({ cmd: 'close' }), 180);
          return;
        }
        vscode.postMessage({ cmd: btn.dataset.cmd });
      };
    });
    window.addEventListener('message', (ev) => {
      const msg = ev.data || {};
      const img = document.getElementById('desk');
      const status = document.getElementById('desk-status');
      if (msg.cmd === 'frame' && img && msg.src) {
        img.src = 'data:' + (msg.mime || 'image/jpeg') + ';base64,' + msg.src;
        if (status) status.textContent = '';
      }
      if (msg.cmd === 'frame-error' && status) status.textContent = msg.error || 'frame failed';
    });
  </script>
</body></html>`;
}

function startViewer(client, vscode) {
  let panel = null;
  let state = null;
  let poll = null;
  let allowNative = false;

  function stopPoll() {
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  }

  function disposePanel() {
    stopPoll();
    if (panel) {
      const dead = panel;
      panel = null;
      if (typeof dead.dispose === 'function') dead.dispose();
    }
    state = null;
  }

  function paint(full) {
    if (!panel || !panel.webview) return;
    if (full || !state || state.kind !== 'desktop' || !state.src) {
      panel.webview.html = viewerHtml(state);
      return;
    }
    panel.webview.postMessage({ cmd: 'frame', mime: state.mime, src: state.src });
  }

  function ensurePanel() {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside, true);
      return panel;
    }
    if (!vscode.window || typeof vscode.window.createWebviewPanel !== 'function') {
      return null;
    }
    panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'AT Viewer',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => {
      panel = null;
      stopPoll();
      state = null;
    });
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg) return;
      if (msg.cmd === 'close') {
        disposePanel();
        return;
      }
      if (msg.cmd === 'edit' && state && state.path && vscode.window) {
        allowNative = true;
        try {
          const uri = vscode.Uri.file(state.path);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        } finally {
          allowNative = false;
        }
      }
    });
    return panel;
  }

  async function show(next) {
    state = next;
    const view = ensurePanel();
    if (!view) return;
    paint(true);
  }

  async function peekFile(doc) {
    const next = peekFileState(doc);
    if (!next) return false;
    stopPoll();
    await show(next);
    return true;
  }

  async function tickDesktop() {
    if (!client || typeof client.desktopFrame !== 'function') return;
    try {
      const frame = await client.desktopFrame();
      if (!frame || !frame.ok) {
        state = { kind: 'desktop', error: (frame && frame.error) || 'no frame' };
        if (panel && panel.webview) {
          panel.webview.postMessage({ cmd: 'frame-error', error: state.error });
        } else {
          paint(true);
        }
        return;
      }
      const first = !state || state.kind !== 'desktop' || !state.src;
      state = {
        kind: 'desktop',
        mime: frame.mime,
        src: frame.data,
        width: frame.width,
        height: frame.height,
      };
      paint(first);
    } catch (err) {
      state = { kind: 'desktop', error: (err && err.message) || 'frame failed' };
      if (panel && panel.webview) {
        panel.webview.postMessage({ cmd: 'frame-error', error: state.error });
      } else {
        paint(true);
      }
    }
  }

  function startDesktop() {
    stopPoll();
    show({ kind: 'desktop' });
    tickDesktop();
    poll = setInterval(tickDesktop, POLL_MS);
  }

  function stopDesktop() {
    if (state && state.kind === 'desktop') disposePanel();
    else stopPoll();
  }

  const subs = [];
  // File clicks stay in dest's real editor so vscode_editFile can apply hunks.
  // Peek is opt-in via the viewer Edit/peek command — do not steal the tab.

  const cmds = [];
  if (vscode.commands && typeof vscode.commands.registerCommand === 'function') {
    cmds.push(vscode.commands.registerCommand('anchortrails.viewer.close', () => disposePanel()));
    cmds.push(vscode.commands.registerCommand('anchortrails.desktop.stream', () => startDesktop()));
  }

  return {
    peekFile,
    startDesktop,
    stopDesktop,
    show,
    dispose() {
      disposePanel();
      for (const s of subs) {
        if (s && typeof s.dispose === 'function') s.dispose();
      }
      for (const c of cmds) {
        if (c && typeof c.dispose === 'function') c.dispose();
      }
    },
  };
}

module.exports = {
  VIEW_TYPE,
  FILE_CAP,
  POLL_MS,
  esc,
  isPeekUri,
  isBinaryText,
  peekFileState,
  viewerHtml,
  startViewer,
};
