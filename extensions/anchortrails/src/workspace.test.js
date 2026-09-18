'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { folderPath, sessionFromPath, sessionId, startBind } = require('./workspace');

describe('folderPath', () => {
  it('reads a single open folder', () => {
    const vscode = {
      workspace: {
        workspaceFolders: [{ uri: { fsPath: 'D:\\aozhen' } }],
      },
    };
    assert.equal(folderPath(vscode), 'D:\\aozhen');
  });

  it('skips dest repo when launch opens . then the user folder', () => {
    const vscode = {
      workspace: {
        workspaceFolders: [
          { uri: { fsPath: 'D:\\code-oss' } },
          { uri: { fsPath: 'D:\\at-muwt-probe' } },
        ],
      },
    };
    assert.equal(folderPath(vscode), 'D:\\at-muwt-probe');
    assert.equal(sessionId(vscode), 'at-muwt-probe');
  });
});

describe('sessionFromPath', () => {
  it('uses the folder basename as the MUWT session', () => {
    assert.equal(sessionFromPath('D:\\at-muwt-probe'), 'at-muwt-probe');
    assert.equal(sessionFromPath('D:\\at-muwt-probe\\'), 'at-muwt-probe');
    assert.equal(sessionFromPath(undefined), undefined);
  });
});

describe('startBind', () => {
  it('POSTs the user folder and scoped session', async () => {
    const seen = [];
    const listeners = [];
    const client = {
      async bindWorkspace(args) {
        seen.push(args);
        return { ok: true };
      },
    };
    const vscode = {
      workspace: {
        workspaceFolders: [
          { uri: { fsPath: 'D:\\code-oss' } },
          { uri: { fsPath: 'D:\\aozhen' } },
        ],
        onDidChangeWorkspaceFolders(fn) {
          listeners.push(fn);
          return { dispose() { listeners.length = 0; } };
        },
      },
    };
    let refreshed = 0;
    const sub = startBind(client, vscode, () => { refreshed += 1; });
    await Promise.resolve();
    assert.deepEqual(seen, [{ path: 'D:\\aozhen', session_id: 'aozhen' }]);
    assert.equal(refreshed, 1);
    vscode.workspace.workspaceFolders[1].uri.fsPath = 'D:\\clustry';
    listeners[0]();
    await Promise.resolve();
    assert.deepEqual(seen, [
      { path: 'D:\\aozhen', session_id: 'aozhen' },
      { path: 'D:\\clustry', session_id: 'clustry' },
    ]);
    assert.equal(refreshed, 2);
    sub.dispose();
    assert.equal(listeners.length, 0);
  });

  it('no-ops when no folder is open', () => {
    const seen = [];
    startBind({ bindWorkspace: async (args) => seen.push(args) }, {
      workspace: { workspaceFolders: [], onDidChangeWorkspaceFolders() { return { dispose() {} }; } },
    });
    assert.deepEqual(seen, []);
  });
});
