'use strict';
/**
 * Opening a folder is the bind. POST /api/agent/workspace so MUWT
 * registers the repo and distills workspace.id/path — no separate add.
 *
 * Dest launch is `AnchorTrails.exe . … <user-folder>`. Skip the dest
 * repo so Plan / edits / session bind the folder the user opened.
 */

const path = require('path');

const DEST_REPO_NAMES = new Set(['code-oss']);

function folderFsPath(folder) {
  return folder && folder.uri && folder.uri.fsPath;
}

function folderPaths(vscode) {
  const folders = (vscode && vscode.workspace && vscode.workspace.workspaceFolders) || [];
  return folders.map(folderFsPath).filter(Boolean);
}

function isDestRepo(folder) {
  return DEST_REPO_NAMES.has(path.basename(String(folder || '')).toLowerCase());
}

function folderPath(vscode) {
  const paths = folderPaths(vscode);
  if (!paths.length) return undefined;
  const user = paths.filter((p) => !isDestRepo(p));
  return (user.length ? user[user.length - 1] : paths[paths.length - 1]);
}

function sessionFromPath(folder) {
  if (!folder) return undefined;
  const base = path.basename(String(folder).replace(/[\\/]+$/, ''));
  return base || undefined;
}

function sessionId(vscode) {
  return sessionFromPath(folderPath(vscode));
}

function startBind(client, vscode, onBound) {
  const bind = () => {
    const folder = folderPath(vscode);
    if (!folder || !client || typeof client.bindWorkspace !== 'function') {
      return;
    }
    client.bindWorkspace({ path: folder, session_id: sessionFromPath(folder) }).then(() => {
      if (typeof onBound === 'function') onBound();
    }).catch((err) => {
      console.warn('[anchortrails] workspace bind failed', err && err.message);
    });
  };
  bind();
  const ws = vscode && vscode.workspace;
  if (!ws || typeof ws.onDidChangeWorkspaceFolders !== 'function') {
    return { dispose() {} };
  }
  const sub = ws.onDidChangeWorkspaceFolders(bind);
  return {
    dispose() {
      if (sub && typeof sub.dispose === 'function') sub.dispose();
    },
  };
}

module.exports = {
  DEST_REPO_NAMES,
  folderPath,
  folderPaths,
  sessionFromPath,
  sessionId,
  startBind,
};
