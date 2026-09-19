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
  });
});
