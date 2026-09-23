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
    new_string: { type: 'string', description: 'Replacement for old_string, or the new lines for a ranged replace.' },
    start_line: { type: 'integer', description: '1-based first line to replace. Use this after old_string misses.' },
    end_line: { type: 'integer', description: '1-based last line to replace, inclusive. Defaults to start_line.' },
  },
  required: ['path'],
};

const REWRITE_LINE_CAP = 400;
const misses = new Map();

function spec() {
  return {
    name: BUILTIN_EDIT,
    description: (
      'Write or patch a file in dest\'s editor (WorkspaceEdit). '
      + 'The file stays open. A missed old_string comes back with numbered lines; '
      + 'the next attempt uses start_line and end_line, not the same string. '
      + 'A file over 400 lines is patched, never rewritten. '
      + 'After this, call checkErrors before greening a plan step.'
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

function numbered(text, start, end) {
  const lines = String(text || '').split('\n');
  const a = Math.max(0, start);
  const b = Math.min(lines.length, end);
  return lines.slice(a, b).map((line, i) => `${a + i + 1}|${line}`).join('\n');
}

function nearby(current, needle) {
  const lines = String(current || '').split('\n');
  const wanted = String(needle || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const probe = wanted[0] || '';
  const chunk = probe.slice(0, 40);
  let hit = -1;
  if (chunk.length >= 8) hit = lines.findIndex((line) => line.includes(chunk));
  if (hit < 0 && probe) {
    const words = probe.split(/\s+/).filter((w) => w.length > 4).slice(0, 3);
    if (words.length) hit = lines.findIndex((line) => words.every((w) => line.includes(w)));
  }
  if (hit < 0) return numbered(current, 0, 12);
  return numbered(current, Math.max(0, hit - 3), hit + 8);
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
  const lineCount = current ? current.split('\n').length : (doc.lineCount || 0);
  const startLine = input.start_line != null ? Number(input.start_line) : null;
  let next = null;
  if (startLine != null) {
    if (!Number.isInteger(startLine) || startLine < 1) {
      return { ok: false, error: 'start_line must be a 1-based integer', path };
    }
    const endLine = input.end_line != null ? Number(input.end_line) : startLine;
    if (!Number.isInteger(endLine) || endLine < startLine) {
      return { ok: false, error: 'end_line must be >= start_line', path };
    }
    const lines = current.split('\n');
    if (startLine > lines.length) {
      return {
        ok: false, error: 'start_line past end', path, line_count: lines.length,
        around: numbered(current, Math.max(0, lines.length - 12), lines.length),
      };
    }
    if (input.new_string == null) {
      return { ok: false, error: 'new_string required for a ranged replace', path };
    }
    const end = Math.min(endLine, lines.length);
    lines.splice(startLine - 1, end - startLine + 1, ...newString.split('\n'));
    next = lines.join('\n');
  } else if (contents != null && oldString == null) {
    if (lineCount > REWRITE_LINE_CAP) {
      return {
        ok: false,
        error: `file has ${lineCount} lines; patch with old_string or start_line/end_line`,
        path,
        line_count: lineCount,
      };
    }
    next = contents;
  } else if (oldString != null) {
    if (!current.includes(oldString)) {
      const key = `${path}\0${oldString}`;
      const seen = (misses.get(key) || 0) + 1;
      misses.set(key, seen);
      const around = nearby(current, oldString);
      if (seen >= 2) {
        return {
          ok: false, stopped: true, path, around,
          error: 'same old_string missed twice; use start_line and end_line',
        };
      }
      return {
        ok: false, error: 'old_string not found', path, around,
        next: 'send start_line and end_line from the numbered lines',
      };
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
  for (const key of misses.keys()) {
    if (key.startsWith(`${path}\0`)) misses.delete(key);
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

