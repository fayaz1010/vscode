'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BUILTIN_EDIT, spec, resolvePath, applyHunk } = require('./edit');

describe('dest vscode_editFile', () => {
  it('is dest-owned, not an AT invoke name collision from summon', () => {
    assert.equal(BUILTIN_EDIT, 'vscode_editFile');
    assert.match(spec().description, /checkErrors/);
  });

  it('resolves workspace-relative paths', () => {
    const vscode = {
      workspace: { workspaceFolders: [{ uri: { fsPath: 'D:\\aozhen' } }] },
    };
    assert.equal(resolvePath(vscode, 'app.py'), 'D:\\aozhen\\app.py');
    assert.equal(resolvePath(vscode, 'D:\\aozhen\\app.py'), 'D:\\aozhen\\app.py');
  });

  it('writes into the user folder, not dest code-oss', () => {
    const vscode = {
      workspace: {
        workspaceFolders: [
          { uri: { fsPath: 'D:\\code-oss' } },
          { uri: { fsPath: 'D:\\at-muwt-probe' } },
        ],
      },
    };
    assert.equal(resolvePath(vscode, 'index.html'), 'D:\\at-muwt-probe\\index.html');
  });

  it('patches old_string in the open document via WorkspaceEdit', async () => {
    const replaced = [];
    const vscode = {
      Uri: { file(p) { return { fsPath: p, scheme: 'file' }; } },
      Range: class { constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; } },
      WorkspaceEdit: class {
        replace(uri, range, next) { replaced.push({ path: uri.fsPath, next }); }
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: 'D:\\aozhen' } }],
        async openTextDocument() {
          return {
            getText: () => 'hello world',
            lineCount: 1,
            lineAt: () => ({ text: 'hello world' }),
          };
        },
        async applyEdit() { return true; },
      },
      window: { async showTextDocument() {} },
    };
    const out = await applyHunk(vscode, {
      path: 'app.py',
      old_string: 'world',
      new_string: 'dest',
    });
    assert.equal(out.ok, true);
    assert.equal(replaced[0].next, 'hello dest');
  });
});
