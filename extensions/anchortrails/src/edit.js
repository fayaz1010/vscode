'use strict';
/**
 * Dest-owned editor — vscode_editFile applies hunks in the real
 * Code-OSS text editor. Fast WorkspaceEdit, then the file stays open.
 * Never an AT /api/invoke tool.
 */

const { folderPath } = require('./workspace');

const BUILTIN_EDIT = 'vscode_editFile';

const SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
    contents: { type: 'string', description: 'Full file contents. Creates the file if missing.' },
    old_string: { type: 'string', description: 'Exact text to replace when not rewriting the whole file.' },
    new_string: { type: 'string', description: 'Replacement for old_string.' },
  },
  required: ['path'],
};

function spec() {
  return {
    name: BUILTIN_EDIT,
    description: (
      'Write or patch a file in dest\'s editor (WorkspaceEdit). '
      + 'The file stays open. After this, call checkErrors before greening a plan step.'
    ),
    inputSchema: SCHEMA,
  };
}

function resolvePath(vscode, raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')) return value;
  const root = folderPath(vscode);
  if (!root) return value;
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]$/, '')}${sep}${value.replace(/^[\\/]/, '')}`;
}

function textResult(vscode, data) {
  const text = JSON.stringify(data);
  if (vscode && vscode.LanguageModelToolResult && vscode.LanguageModelTextPart) {
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(text),
    ]);
  }
  return { content: [{ type: 'text', value: text }] };
}

async function applyHunk(vscode, input) {
  const path = resolvePath(vscode, input.path);
  if (!path) return { ok: false, error: 'path required' };
  if (!vscode || !vscode.workspace || !vscode.Uri) {
    return { ok: false, error: 'editor unavailable' };
  }
  const uri = vscode.Uri.file(path);
  const contents = input.contents != null ? String(input.contents) : null;
  const oldString = input.old_string != null ? String(input.old_string) : null;
  const newString = input.new_string != null ? String(input.new_string) : '';
  let doc = null;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    doc = null;
  }
  if (!doc) {
    if (contents == null && oldString == null) {
      return { ok: false, error: 'file missing; pass contents to create it', path };
    }
    const body = contents != null ? contents : newString;
    if (vscode.workspace.fs && typeof vscode.workspace.fs.writeFile === 'function') {
      const bytes = Buffer.from(body, 'utf8');
      await vscode.workspace.fs.writeFile(uri, bytes);
    }
    doc = await vscode.workspace.openTextDocument(uri);
    if (vscode.window && typeof vscode.window.showTextDocument === 'function') {
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    return { ok: true, path, created: true, bytes: Buffer.byteLength(body, 'utf8') };
  }
  const current = typeof doc.getText === 'function' ? doc.getText() : '';
  let next = contents;
  if (next == null && oldString != null) {
    if (!current.includes(oldString)) {
      return { ok: false, error: 'old_string not found', path };
    }
    next = current.replace(oldString, newString);
  }
  if (next == null) return { ok: false, error: 'contents or old_string required', path };
  const WorkspaceEdit = vscode.WorkspaceEdit;
  const Range = vscode.Range;
  if (typeof WorkspaceEdit !== 'function' || typeof Range !== 'function') {
    if (vscode.workspace.fs && typeof vscode.workspace.fs.writeFile === 'function') {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(next, 'utf8'));
    }
  } else {
    const edit = new WorkspaceEdit();
    const lastLine = Math.max((doc.lineCount || 1) - 1, 0);
    const lastText = doc.lineAt ? doc.lineAt(lastLine).text : '';
    edit.replace(uri, new Range(0, 0, lastLine, lastText.length), next);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) return { ok: false, error: 'applyEdit refused', path };
  }
  if (vscode.window && typeof vscode.window.showTextDocument === 'function') {
    await vscode.window.showTextDocument(doc, { preview: false });
  }
  return { ok: true, path, bytes: Buffer.byteLength(next, 'utf8') };
}

function createImpl(vscode, afterWrite) {
  return {
    async invoke(options) {
      const input = (options && options.input) || {};
      const out = await applyHunk(vscode, input);
      if (out.ok && typeof afterWrite === 'function') {
        try { out.check = await afterWrite(out.path); } catch { /* check is optional */ }
      }
      return textResult(vscode, out);
    },
  };
}

function register(vscode, afterWrite) {
  const lm = vscode && vscode.lm;
  const impl = createImpl(vscode, afterWrite);
  let registration = null;

  if (lm && typeof lm.registerToolDefinition === 'function') {
    registration = lm.registerToolDefinition({
      name: BUILTIN_EDIT,
      displayName: 'Edit File',
      description: spec().description,
      inputSchema: SCHEMA,
      tags: ['anchortrails'],
    }, impl);
  } else if (lm && typeof lm.registerTool === 'function') {
    registration = lm.registerTool(BUILTIN_EDIT, impl);
  }

  return {
    dispose() {
      if (registration && typeof registration.dispose === 'function') {
        registration.dispose();
      }
    }
  };
}

module.exports = {
  BUILTIN_EDIT,
  SCHEMA,
  spec,
  resolvePath,
  applyHunk,
  createImpl,
  register,
};

