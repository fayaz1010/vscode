'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BUILTIN_CHECK, canGreen, planMark, collectDiagnostics } = require('./check');

describe('dest checkErrors', () => {
  it('refuses green when diagnostics have errors', () => {
    assert.equal(BUILTIN_CHECK, 'checkErrors');
    assert.equal(canGreen({ ok: true, errors: 0 }), true);
    assert.equal(canGreen({ ok: false, errors: 2 }), false);
    assert.equal(canGreen(null), false);
    assert.equal(planMark({ ok: true, errors: 0 }), 'done');
    assert.equal(planMark({ ok: false, errors: 1 }), 'error');
    assert.equal(planMark(null), 'now');
  });

  it('counts editor diagnostics without printing file bodies', () => {
    const vscode = {
      DiagnosticSeverity: { Error: 0, Warning: 1 },
      Uri: { file(p) { return { fsPath: p }; } },
      languages: {
        getDiagnostics() {
          return [
            { severity: 0, message: 'undefined name', range: { start: { line: 3 } } },
            { severity: 1, message: 'unused', range: { start: { line: 8 } } },
          ];
        },
      },
    };
    const out = collectDiagnostics(vscode, 'D:\\aozhen\\app.py');
    assert.equal(out.ok, false);
    assert.equal(out.errors, 1);
    assert.equal(out.warnings, 1);
    assert.equal(out.green, false);
    assert.ok(!JSON.stringify(out).includes('sk-'));
  });
});
