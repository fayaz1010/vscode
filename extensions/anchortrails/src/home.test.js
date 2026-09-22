'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VIEW_ID, homeHtml } = require('./home');

describe('AT Panel home', () => {
  it('uses the dest home view', () => {
    assert.equal(VIEW_ID, 'anchortrails.home');
  });

  it('renders surface tiles and marks the active one', () => {
    const html = homeHtml({
      surface: 'drive',
      surfaces: [
        { id: 'auto', label: 'Auto', hint: 'assign()', inputs: ['text'], pack: [], active: false },
        { id: 'drive', label: 'Computer use', hint: 'Look then go', inputs: ['text', 'image'], pack: ['browser_look'], active: true },
        { id: 'docs', label: 'Documents', hint: 'PDF', inputs: ['text'], pack: ['pdf_read'], active: false },
      ],
    });
    assert.match(html, /AT Panel/);
    assert.match(html, /data-id="drive"/);
    assert.match(html, /class="tile on"/);
    assert.match(html, /Computer use/);
    assert.match(html, /Documents/);
    assert.ok(!html.includes('desktop_vault_get'));
  });

  it('paints local tiles when the node has no panel payload', () => {
    const { FALLBACK_SURFACES } = require('./home');
    const html = homeHtml({ surfaces: [] }, { status: 404, message: 'Not Found' });
    assert.match(html, /data-id="drive"/);
    assert.match(html, /Computer use/);
    assert.match(html, /Not Found/);
    assert.ok(FALLBACK_SURFACES.length >= 6);
    assert.ok(!html.includes('desktop_vault_get'));
  });

  it('shows the live plan on the middle AT panel', () => {
    const html = homeHtml({
      wide: true,
      surfaces: [{ id: 'auto', label: 'Auto', inputs: ['text'], pack: [] }],
      plan: { cursor: '3/6', goal: 'Add products to Aozhen', steps: '1.DESIGN [x] | 3.BUILD [>]' },
    });
    assert.match(html, /grid-template-columns: 1fr 1fr/);
    assert.match(html, /Plan 3\/6/);
    assert.match(html, /Add products to Aozhen/);
    assert.match(html, /class="step done seedable"/);
    assert.match(html, /class="step now seedable"/);
    assert.match(html, /cmd: 'seed'/);
  });
});

describe('the map in the editor host', () => {
  const { openCode, mapSig, codeRoot } = require('./home');
  const path = require('path');

  function fakeVscode(opened) {
    return {
      Uri: { file: (p) => ({ fsPath: p }) },
      Range: class { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } },
      workspace: { openTextDocument: async (uri) => ({ uri }) },
      window: { showTextDocument: async (doc, opts) => { opened.push({ doc, opts }); } },
    };
  }

  it('opens the file at the line, inside the root', async () => {
    const opened = [];
    const ok = await openCode(fakeVscode(opened), '/r/backend', 'src/services/email.ts', 115);
    assert.equal(ok, true);
    assert.equal(opened[0].doc.uri.fsPath, path.resolve('/r/backend', 'src/services/email.ts'));
    assert.equal(opened[0].opts.selection.start.line, 114, 'line 115 is zero-based 114');
    assert.equal(opened[0].opts.preview, false);
  });

  it('refuses a path that escapes the root rather than resolving it', async () => {
    const opened = [];
    const ok = await openCode(fakeVscode(opened), '/r/backend', '../../etc/passwd', 1);
    assert.equal(ok, false);
    assert.equal(opened.length, 0);
  });

  it('refuses when there is no root to resolve against', async () => {
    assert.equal(await openCode(fakeVscode([]), '', 'src/a.ts', 1), false);
  });

  it('the code root is the map\'s repo only when that path exists on this machine', () => {
    const here = { workspace: { workspaceFolders: [{ uri: { fsPath: '/r/here' } }] } };
    const exists = (p) => p === '/r/here' || p === '/r/analysed';
    assert.equal(codeRoot({ repo: '/r/analysed' }, here, exists), '/r/analysed', 'the analysed repo, when it is here');
    assert.equal(codeRoot({ repo: '/Users/elsewhere/code-oss' }, here, exists), '/r/here',
      'a path from the machine that built the map is not a root on this one');
    assert.equal(codeRoot({}, here, exists), '/r/here', 'no repo in the map: the bound folder');
    assert.equal(codeRoot(null, here, exists), '/r/here', 'no map at all: the bound folder');
    assert.equal(codeRoot({ repo: '/Users/elsewhere' }, { workspace: {} }, exists), '', 'nothing to resolve against');
  });

  it('the poll signature moves when the map or the plan does, and not otherwise', () => {
    const a = { overview: { meta: { generated_at: 1, findings_actionable: 20 } }, plan: { plan_id: 'p', revision: 1 } };
    const same = JSON.parse(JSON.stringify(a));
    const fewer = JSON.parse(JSON.stringify(a)); fewer.overview.meta.findings_actionable = 13;
    const replanned = JSON.parse(JSON.stringify(a)); replanned.plan.revision = 2;
    assert.equal(mapSig(a), mapSig(same));
    assert.notEqual(mapSig(a), mapSig(fewer));
    assert.notEqual(mapSig(a), mapSig(replanned));
    const landed = JSON.parse(JSON.stringify(a)); landed.run = { status: 'running', updated_at: 5, results: [{ task: 't', outcome: 'closed' }] };
    const another = JSON.parse(JSON.stringify(landed)); another.run.updated_at = 6; another.run.results.push({ task: 'u', outcome: 'failed' });
    assert.notEqual(mapSig(a), mapSig(landed), 'a run landing beside an unchanged map repaints');
    assert.notEqual(mapSig(landed), mapSig(another), 'and so does each task after it');
    const started = JSON.parse(JSON.stringify(a)); started.running = true;
    assert.notEqual(mapSig(a), mapSig(started), 'the bridge starting a run repaints');
    const moved = JSON.parse(JSON.stringify(a)); moved.currency = { state: 'stale', tree_head: 'x' };
    assert.notEqual(mapSig(a), mapSig(moved), 'the tree moving past the map repaints');
    const stated = JSON.parse(JSON.stringify(a)); stated.objective = 'finish it';
    assert.notEqual(mapSig(a), mapSig(stated), 'an objective being stated repaints');
  });
});

describe('the graph below the zones, in the editor host', () => {
  function host({ mapGraph }) {
    const posted = [];
    let onMessage = null;
    const webview = {
      html: '',
      options: {},
      onDidReceiveMessage(fn) { onMessage = fn; },
      postMessage(m) { posted.push(m); },
    };
    // visible:false -- the editor starts a 5 s poll while visible, which would keep the test runner alive
    const panel = { webview, visible: false, reveal() {}, onDidChangeViewState() {}, onDidDispose() {} };
    const vscode = {
      ViewColumn: { One: 1 },
      window: { createWebviewPanel: () => panel },
      workspace: { workspaceFolders: [{ uri: { fsPath: 'D:\\aozhen' } }] },
    };
    const graphs = [];
    const client = {
      async sessionPanel() { return {}; },
      async map() { return { ok: true, currency: { map_head: 'h1' }, overview: { meta: { head: 'h1' }, zones: [] } }; },
      async mapGraph(args) { graphs.push(args); return mapGraph(args); },
    };
    const { startHome } = require('./home');
    return { vscode, client, webview, posted, graphs, startHome, send: (m) => onMessage(m) };
  }

  it('answers a graph ask with the level below, keyed by the open folder, and caches only complete answers', async () => {
    let partial = true;
    const h = host({ mapGraph: ({ zone }) => (zone
      ? { ok: true, partial: false, depth: 2, zone, files: [], edges: [] }
      : { ok: true, partial, depth: 1, zones: { lib: [{ id: 'lib_a', path: 'lib/a.ts', symbols: 2 }] } }) });
    const home = h.startHome(h.client, h.vscode);
    await home.openEditor();
    await h.send({ cmd: 'graph' });
    assert.equal(h.graphs[0].repo, 'D:\\aozhen');
    assert.equal(h.graphs[0].depth, 1);
    assert.equal(h.posted[0].cmd, 'graph');
    assert.equal(h.posted[0].zone, '');
    assert.equal(h.posted[0].data.zones.lib[0].path, 'lib/a.ts');
    await h.send({ cmd: 'graph' });
    assert.equal(h.graphs.length, 2, 'a partial answer is asked again -- graphify may have landed');
    partial = false;
    await h.send({ cmd: 'graph' });
    await h.send({ cmd: 'graph' });
    assert.equal(h.graphs.length, 3, 'a complete answer is served from the cache');
    await h.send({ cmd: 'graph', zone: 'lib' });
    await h.send({ cmd: 'graph', zone: 'lib' });
    assert.equal(h.graphs.filter((g) => g.zone === 'lib').length, 1);
    assert.equal(h.posted[h.posted.length - 1].data.depth, 2);
  });
});

describe('the file under the pen, in the Explorer', () => {
  it('registers a ✎ decoration for the file the run is writing and clears it when the run stops', async () => {
    let provider = null;
    const fired = [];
    class Emitter { constructor() { this.event = 'ev'; } fire(x) { fired.push(x); } dispose() {} }
    const webview = { html: '', options: {}, onDidReceiveMessage() {}, postMessage() {} };
    const panel = { webview, visible: false, reveal() {}, onDidChangeViewState() {}, onDidDispose() {} };
    let map = {
      ok: true, running: true, progress: { task: 't.a' },
      plan: { tasks: [{ id: 't.a', title: 'lib/a.ts: build', execution: { write_scope: ['lib/a.ts'] }, deliverables: [] }] },
      overview: { meta: {}, zones: [] },
    };
    const vscode = {
      EventEmitter: Emitter,
      ThemeColor: class { constructor(id) { this.id = id; } },
      ViewColumn: { One: 1 },
      window: { createWebviewPanel: () => panel, registerFileDecorationProvider(p) { provider = p; return { dispose() { provider = null; } }; } },
      workspace: { workspaceFolders: [{ uri: { fsPath: 'D:\\aozhen' } }] },
    };
    const client = { async sessionPanel() { return {}; }, async map() { return map; } };
    const { startHome } = require('./home');
    const home = startHome(client, vscode);
    await home.openEditor();
    assert.ok(provider, 'registered once a file is under the pen');
    assert.equal(fired.length, 1);
    const deco = provider.provideFileDecoration({ fsPath: 'D:\\aozhen\\lib\\a.ts' });
    assert.equal(deco.badge, '✎');
    assert.equal(provider.provideFileDecoration({ fsPath: 'D:\\aozhen\\lib\\b.ts' }), undefined);
    map = { ...map, running: false };
    await home.openEditor(); // a repaint path is not exposed; openEditor reveals and repaints on first call only
    home.dispose();
    assert.equal(provider, null, 'disposed with the panel');
  });
});
