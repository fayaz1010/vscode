'use strict';
/**
 * Dest error gate — checkErrors reads vscode diagnostics (and optional
 * tests). A plan step must not turn green until this returns ok.
 */

const BUILTIN_CHECK = 'checkErrors';

const SCHEMA = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'File to check. Omit to scan the whole workspace.',
    },
  },
};

function spec() {
  return {
    name: BUILTIN_CHECK,
    description: (
      'Read dest editor diagnostics. errors > 0 means the current plan step '
      + 'stays blue or goes red — never [x] green. Call after vscode_editFile.'
    ),
    inputSchema: SCHEMA,
  };
}

function canGreen(check) {
  return Boolean(check && check.ok === true && Number(check.errors || 0) === 0);
}

function planMark(check) {
  if (!check) return 'now';
  if (canGreen(check)) return 'done';
  if (Number(check.errors || 0) > 0) return 'error';
  return 'now';
}

function collectDiagnostics(vscode, path) {
  const get = vscode && vscode.languages && vscode.languages.getDiagnostics;
  if (typeof get !== 'function') {
    return { ok: true, errors: 0, warnings: 0, items: [], note: 'no diagnostics API' };
  }
  const ErrorSev = (vscode.DiagnosticSeverity && vscode.DiagnosticSeverity.Error) || 0;
  let list = [];
  if (path && vscode.Uri) {
    try { list = get(vscode.Uri.file(path)) || []; } catch { list = []; }
  } else {
    const all = get();
    if (all && typeof all.forEach === 'function' && !Array.isArray(all)) {
      all.forEach((rows) => { list = list.concat(rows || []); });
    } else if (Array.isArray(all)) {
      list = all;
    }
  }
  const items = (list || []).slice(0, 40).map((d) => ({
    severity: d.severity === ErrorSev ? 'error' : 'warning',
    message: String((d && d.message) || ''),
    line: d && d.range && d.range.start ? d.range.start.line : undefined,
  }));
  const errors = items.filter((i) => i.severity === 'error').length;
  const warnings = items.filter((i) => i.severity === 'warning').length;
  return {
    ok: errors === 0,
    errors,
    warnings,
    items,
    path: path || null,
    green: errors === 0,
  };
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

function createImpl(vscode) {
  return {
    async invoke(options) {
      const input = (options && options.input) || {};
      const path = String(input.path || '').trim() || null;
      const check = collectDiagnostics(vscode, path);
      check.mark = planMark(check);
      check.can_green = canGreen(check);
      if (vscode && vscode.commands && typeof vscode.commands.executeCommand === 'function') {
        try { await vscode.commands.executeCommand('anchortrails.plan.applyCheck', check); } catch { /* Plan paint is optional */ }
      }
      return textResult(vscode, check);
    },
  };
}

function register(vscode) {
  const lm = vscode && vscode.lm;
  const impl = createImpl(vscode);
  if (lm && typeof lm.registerToolDefinition === 'function') {
    return lm.registerToolDefinition({
      name: BUILTIN_CHECK,
      displayName: 'Check Errors',
      description: spec().description,
      inputSchema: SCHEMA,
      tags: ['anchortrails'],
    }, impl);
  }
  if (lm && typeof lm.registerTool === 'function') {
    return lm.registerTool(BUILTIN_CHECK, impl);
  }
  return { dispose() {} };
}

module.exports = {
  BUILTIN_CHECK,
  SCHEMA,
  spec,
  canGreen,
  planMark,
  collectDiagnostics,
  createImpl,
  register,
};
