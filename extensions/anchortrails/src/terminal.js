'use strict';
/**
 * Dest-owned terminal — in-chat tool + dest Terminal panel.
 * Copilot is off, so dest registers its own runInTerminal.
 * One process: capture stdout for the model, show the same transcript
 * in dest's integrated terminal. Never dump `dir`/`cat` for the user.
 */

const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { folderPath } = require('./workspace');

const BUILTIN_TERMINAL = 'runInTerminal';
const TERM_NAME = 'AT';
const TIMEOUT_MS = 60_000;
const MAX_OUT = 80_000;

const SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: 'Shell command. Dest runs it and returns stdout/stderr.',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Defaults to the open folder.',
    },
  },
  required: ['command'],
};

const DENY = /\bformat\s+[a-z]:|\brm\s+-rf\s+[\\/]|\bdel\s+\/s|\bshutdown(?:\.exe)?\b|\breg\s+delete\b/i;

function spec() {
  return {
    name: BUILTIN_TERMINAL,
    description: (
      'Run a command in dest\'s Terminal panel and return stdout/stderr. '
      + 'Never ask the user to paste dir/cat/ls output. Use this instead. '
      + 'Non-interactive only: a program that waits for input (claude, vim, '
      + 'a REPL) hangs until the 60s timeout and fails. To open a desktop '
      + 'app use desktop_run_command with Start-Process.'
    ),
    inputSchema: SCHEMA,
  };
}

function blocked(command) {
  return DENY.test(String(command || ''));
}

function runCommand(command, cwd) {
  return new Promise((resolve) => {
    exec(command, {
      cwd: cwd || undefined,
      timeout: TIMEOUT_MS,
      maxBuffer: 2_000_000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const code = err && err.code != null ? err.code : 0;
      resolve({
        ok: !err,
        exit: typeof code === 'number' ? code : 1,
        stdout: String(stdout || '').slice(0, MAX_OUT),
        stderr: String(stderr || '').slice(0, 20_000),
        error: err && !stdout && !stderr ? String(err.message || err) : undefined,
      });
    });
  });
}

function reuseOrCreate(vscode, cwd) {
  const win = vscode && vscode.window;
  if (!win || typeof win.createTerminal !== 'function') return null;
  const existing = (win.terminals || []).find((t) => t && t.name === TERM_NAME);
  const term = existing || win.createTerminal({ name: TERM_NAME, cwd: cwd || undefined });
  if (typeof term.show === 'function') term.show(true);
  return term;
}

function showTranscript(vscode, command, result, cwd) {
  const term = reuseOrCreate(vscode, cwd);
  if (!term || typeof term.sendText !== 'function') return;
  const lines = [
    `$ ${command}`,
    result.stdout || '',
    result.stderr || '',
    `exit ${result.exit}`,
  ].join('\n').replace(/\r/g, '');
  try {
    const tmp = path.join(os.tmpdir(), 'at-term-last.txt');
    fs.writeFileSync(tmp, lines, 'utf8');
    const q = tmp.replace(/'/g, "''");
    term.sendText(`Get-Content -LiteralPath '${q}'`, true);
  } catch {
    term.sendText(`Write-Host 'AT> ${String(command).replace(/'/g, "''")}'`, true);
  }
}

function textResult(vscode, payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
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
      const command = String(input.command || '').trim();
      if (!command) return textResult(vscode, { ok: false, error: 'empty command' });
      if (blocked(command)) return textResult(vscode, { ok: false, error: 'blocked' });
      const cwd = String(input.cwd || folderPath(vscode) || process.cwd());
      const result = await runCommand(command, cwd);
      showTranscript(vscode, command, result, cwd);
      return textResult(vscode, { ...result, cwd });
    },
  };
}

function register(vscode) {
  const lm = vscode && vscode.lm;
  const impl = createImpl(vscode);
  if (lm && typeof lm.registerToolDefinition === 'function') {
    return lm.registerToolDefinition({
      name: BUILTIN_TERMINAL,
      displayName: 'Run in Terminal',
      description: spec().description,
      inputSchema: SCHEMA,
      tags: ['anchortrails'],
    }, impl);
  }
  if (lm && typeof lm.registerTool === 'function') {
    return lm.registerTool(BUILTIN_TERMINAL, impl);
  }
  return { dispose() { /* nothing was registered: nothing to release */ } };
}

function startTerminal(vscode) {
  return register(vscode);
}

module.exports = {
  BUILTIN_TERMINAL,
  SCHEMA,
  spec,
  blocked,
  runCommand,
  folderPath,
  createImpl,
  register,
  startTerminal,
  showTranscript,
};

