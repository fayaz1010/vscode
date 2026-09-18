'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  VIEW_TYPE,
  isPeekUri,
  isBinaryText,
  peekFileState,
  viewerHtml,
} = require('./viewer');

describe('AT viewer peek', () => {
  it('only peeks file-scheme uris', () => {
    assert.equal(VIEW_TYPE, 'anchortrails.viewer');
    assert.equal(isPeekUri({ scheme: 'file' }), true);
    assert.equal(isPeekUri({ scheme: 'vscode-chat' }), false);
    assert.equal(isPeekUri({ scheme: 'untitled' }), false);
  });

  it('builds a sliding file peek from the open document', () => {
    const state = peekFileState({
      uri: { scheme: 'file', fsPath: 'D:\\aozhen\\app.py' },
      getText: () => 'print("hi")',
    });
    assert.equal(state.kind, 'file');
    assert.equal(state.name, 'app.py');
    const html = viewerHtml(state);
    assert.match(html, /animation: in 280ms/);
    assert.match(html, /app\.py/);
    assert.match(html, /print\(&quot;hi&quot;\)/);
    assert.match(html, /data-cmd="close"/);
    assert.match(html, /data-cmd="edit"/);
  });

  it('marks binary files instead of dumping bytes', () => {
    assert.equal(isBinaryText('abc\u0000def'), true);
    const state = peekFileState({
      uri: { scheme: 'file', fsPath: 'D:\\aozhen\\a.bin' },
      getText: () => 'x\u0000y',
    });
    assert.equal(state.binary, true);
    assert.match(viewerHtml(state), /Binary file/);
  });

  it('renders a desktop stream pane without dumping the frame in the title', () => {
    const html = viewerHtml({
      kind: 'desktop',
      mime: 'image/jpeg',
      src: 'abc',
    });
    assert.match(html, /Computer use/);
    assert.match(html, /id="desk"/);
    assert.match(html, /data:image\/jpeg;base64,abc/);
    assert.ok(!html.includes('data-cmd="edit"'));
  });
});
