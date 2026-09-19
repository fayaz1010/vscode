'use strict';
/**
 * Dest AT Settings page — vault connections, models via keys,
 * credits used, model/action tokens. Never render a secret value.
 */

const { sessionId } = require('./workspace');

const VIEW_ID = 'anchortrails.settings';
const SCAN_PROMPT = (
  'Scan this computer for .env files? Gitignored files are included — '
  + 'git skip would miss most keys. Values stay on this node, encrypted, and are never printed.'
);

async function confirmComputerScan(vscode) {
  const show = vscode && vscode.window && vscode.window.showWarningMessage;
  if (typeof show !== 'function') return false;
  const pick = await show(SCAN_PROMPT, { modal: true }, 'Scan');
  return pick === 'Scan';
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function creditLine(credits) {
  const c = credits || {};
  if (c.unlimited) return 'Unlimited';
  const bits = [];
  if (c.used != null) bits.push(`${c.used} used`);
  if (c.remaining != null) bits.push(`${c.remaining} left`);
  if (c.included != null) bits.push(`${c.included} included`);
  return bits.join(' · ') || (c.signed_in ? 'no meter yet' : 'not signed in');
}

function tokenLine(tokens) {
  const t = tokens || {};
  return `${t.today || 0} today · ${t.pending || 0} pending`;
}

function lightClass(ok) {
  if (ok === true) return 'ok';
  if (ok === false) return 'bad';
  return 'idle';
}

const { taskPicksHtml } = require('./models');

function settingsHtml(data) {
  const credits = (data && data.credits) || {};
  const tokens = (data && data.tokens) || {};
  const models = (data && data.models) || {};
  const vault = (data && data.vault) || {};
  const scan = (data && data.scan) || {};
  const connections = (data && data.connections) || vault.connections || [];
  const groups = [];
  for (const row of connections) {
    const g = row.group || 'Other';
    if (!groups.includes(g)) groups.push(g);
  }
  const modelVia = (models.via || []).join(' · ') || 'no key';
  const modelRows = (models.slugs || []).map((slug) => (
    `<tr><td>${esc(slug)}</td><td>${models.connected ? esc(modelVia) : 'not connected'}</td></tr>`
  )).join('');
  const connRows = groups.map((g) => {
    const rows = connections.filter((c) => (c.group || 'Other') === g).map((c) => (
      `<tr data-id="${esc(c.id)}">
        <td><span class="dot ${lightClass(c.ok)}"></span> ${esc(c.label)}</td>
        <td>${c.connected ? esc((c.via || []).join(' · ')) : '—'}</td>
        <td class="acts">
          <button data-cmd="test" data-id="${esc(c.id)}">Test</button>
          <button data-cmd="edit" data-id="${esc(c.id)}">Edit</button>
          <button data-cmd="remove" data-id="${esc(c.id)}">Remove</button>
        </td>
      </tr>`
    )).join('');
    return `<h3>${esc(g)}</h3><table><thead><tr><th>Connection</th><th>Via</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  const toolRows = (tokens.by_tool || []).map((row) => (
    `<tr><td>${esc(row.name)}</td><td>${esc(row.tokens)}</td></tr>`
  )).join('');
  const scanNote = scan.imported
    ? `Loaded ${scan.imported.length} · skipped ${ (scan.skipped || []).length} · ${scan.files || 0} files`
    : (scan.error || '');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground);
    padding: 10px 12px 24px; margin: 0; }
  h1 { font-size: 13px; margin: 0 0 10px; }
  h2 { font-size: 12px; margin: 16px 0 6px; }
  h3 { font-size: 11px; margin: 12px 0 4px; opacity: .8; }
  .card { border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px;
    padding: 8px 10px; margin: 0 0 8px; }
  .muted { opacity: .7; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 4px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
  th { opacity: .65; font-weight: 500; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; padding: 3px 8px; border-radius: 4px; cursor: pointer; margin-right: 4px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px;
    background: #666; vertical-align: middle; }
  .dot.ok { background: #3cbe82; }
  .dot.bad { background: #e65a5a; }
  .acts { white-space: nowrap; }
</style></head>
<body>
  <h1>AT Settings</h1>
  <div class="card">
    <strong>Credits</strong>
    <div>${esc(credits.email || (credits.signed_in ? 'signed in' : 'not signed in'))}${credits.tier ? ` · ${esc(credits.tier)}` : ''}</div>
    <div class="muted">${esc(creditLine(credits))}</div>
  </div>
  <div class="card">
    <strong>Model / action tokens</strong>
    <div>${esc(tokenLine(tokens))}${tokens.metered ? '' : ' · local meter'}</div>
  </div>
  <h2>Models connected via keys</h2>
  <p class="muted">${models.connected ? `Inference key: ${esc(modelVia)}` : 'No inference key on this node (util-ai / vault / env).'}</p>
  <table><thead><tr><th>Assign slug</th><th>Via</th></tr></thead>
  <tbody>${modelRows || '<tr><td colspan="2">No slugs</td></tr>'}</tbody></table>
  ${taskPicksHtml(data)}
  <h2>Vault connections</h2>
  <p class="muted">Values never print. Green = last test passed.</p>
  <p>
    <button id="scan">Scan this computer…</button>
    <button id="testall">Test all</button>
    <button id="refresh">Refresh</button>
  </p>
  <p class="muted" id="scan-note">${esc(scanNote)}</p>
  ${connRows || '<p class="muted">No catalog rows.</p>'}
  ${toolRows ? `<h2>Tokens by tool</h2><table><thead><tr><th>Tool</th><th>Tokens</th></tr></thead><tbody>${toolRows}</tbody></table>` : ''}
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').onclick = () => vscode.postMessage({ cmd: 'refresh' });
    document.getElementById('scan').onclick = () => vscode.postMessage({ cmd: 'scan' });
    document.getElementById('testall').onclick = () => vscode.postMessage({ cmd: 'test' });
    document.querySelectorAll('[data-cmd]').forEach((el) => {
      const send = () => {
        const row = el.closest('[data-task]');
        const slugEl = row && row.querySelector('[data-field="slug"]');
        const fbEl = row && row.querySelector('[data-field="fallback"]');
        vscode.postMessage({
          cmd: el.dataset.cmd,
          id: el.dataset.id,
          task: el.dataset.task,
          slug: slugEl ? slugEl.value : undefined,
          fallback: fbEl ? fbEl.value : undefined,
        });
      };
      if (el.tagName === 'SELECT') el.onchange = send;
      else el.onclick = send;
    });
  </script>
</body></html>`;
}

function startSettings(client, vscode) {
  let view = null;
  let extra = {};

  async function paint() {
    if (!view) return;
    try {
      const data = client && typeof client.sessionPanel === 'function'
        ? await client.sessionPanel({ session_id: sessionId(vscode) })
        : {};
      view.webview.html = settingsHtml({ ...data, ...extra });
    } catch (err) {
      view.webview.html = settingsHtml({
        credits: { signed_in: false },
        models: { slugs: [], connected: false, via: [] },
        connections: [],
        tokens: { today: 0, pending: 0, by_tool: [] },
        scan: { error: err && err.message },
      });
    }
  }

  async function onMessage(msg) {
    if (!msg || !msg.cmd) return;
    if (msg.cmd === 'refresh') {
      extra = {};
      return paint();
    }
    if (msg.cmd === 'scan' && client && typeof client.vaultScan === 'function') {
      if (!(await confirmComputerScan(vscode))) return;
      extra = { scan: await client.vaultScan({ apply: true, scope: 'computer', confirmed: true }) };
      return paint();
    }
    if (msg.cmd === 'test' && client && typeof client.vaultTest === 'function') {
      extra = { scan: { imported: [] }, test: await client.vaultTest(msg.id ? { id: msg.id } : {}) };
      return paint();
    }
    if (msg.cmd === 'remove' && client && typeof client.vaultRemove === 'function') {
      await client.vaultRemove({ id: msg.id });
      extra = {};
      return paint();
    }
    if (msg.cmd === 'set-task' && client && typeof client.setTaskModel === 'function') {
      await client.setTaskModel({ task: msg.task, slug: msg.slug, fallback: msg.fallback });
      extra = {};
      return paint();
    }
    if (msg.cmd === 'edit' && vscode.window && typeof vscode.window.showInputBox === 'function') {
      const value = await vscode.window.showInputBox({
        title: `Replace ${msg.id}`,
        password: true,
        prompt: 'New value stays on the node. It is not printed.',
        ignoreFocusOut: true,
      });
      if (!value) return;
      await client.vaultSet({ id: msg.id, value });
      extra = {};
      return paint();
    }
  }

  const provider = {
    resolveWebviewView(webviewView) {
      view = webviewView;
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.onDidReceiveMessage(onMessage);
      paint();
    },
  };

  const sub = vscode.window && typeof vscode.window.registerWebviewViewProvider === 'function'
    ? vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
    : { dispose() { /* nothing was registered: nothing to release */ } };

  const cmds = [];
  if (vscode.commands && typeof vscode.commands.registerCommand === 'function') {
    cmds.push(vscode.commands.registerCommand('anchortrails.settings.show', () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      paint();
    }));
    cmds.push(vscode.commands.registerCommand('anchortrails.settings.scan', async () => {
      if (!(await confirmComputerScan(vscode))) return;
      if (client && typeof client.vaultScan === 'function') {
        extra = { scan: await client.vaultScan({ apply: true, scope: 'computer', confirmed: true }) };
      }
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
      paint();
    }));
  }

  return {
    refresh: paint,
    dispose() {
      if (sub && typeof sub.dispose === 'function') sub.dispose();
      for (const c of cmds) {
        if (c && typeof c.dispose === 'function') c.dispose();
      }
    },
  };
}

module.exports = {
  VIEW_ID,
  SCAN_PROMPT,
  confirmComputerScan,
  esc,
  creditLine,
  tokenLine,
  lightClass,
  settingsHtml,
  startSettings,
};
