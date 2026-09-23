'use strict';
/**
 * Dest-owned delegate — hand a task to another coding CLI already installed
 * on this machine (Claude Code, Cursor, Codex) instead of doing it with AT's
 * own one-shot completion. For a real multi-file refactor, a debugging
 * session, anything that wants its own agentic loop over several files
 * rather than a single prompt-in/file-out turn. AT decides to reach for
 * this; it is not the default path -- vscode_editFile handles an ordinary
 * edit. Most of these CLIs run on a subscription the person already pays
 * for, not a metered API key, so delegating is sometimes the CHEAPER path
 * too, not only the more capable one.
 *
 * Runs with execFile + an argument array, never a shell string: the task
 * text is arbitrary and goes straight to the process, with no quoting to
 * get wrong and nothing for a stray `"` or `&&` in the prompt to break out
 * of. What actually changed is read back from `git status`, before and
 * after -- the agent's own "done" is not taken on trust.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const { folderPath } = require('./workspace');
const { blocked: shellBlocked, showTranscript } = require('./terminal');

const BUILTIN_DELEGATE = 'delegateToAgent';
const TIMEOUT_MS = 600_000; // a real agentic CLI run, minutes not seconds
const MAX_OUT = 40_000;
const GIT_TIMEOUT_MS = 15_000;

// One entry per supported CLI. `claude` is verified against the real
// Claude Code flags. `cursor` and `codex` are best-effort starting points --
// non-interactive flags move between CLI releases, so a failure with
// "unrecognized option" or similar means the installed version wants
// something else; this is a starting point to correct, not a promise.
const AGENTS = {
  claude: {
    bin: 'claude',
    args: (task, flags) => withFlags(['-p'], task, flags, ['--output-format', 'json']),
    note: 'Claude Code, print mode. No --dangerously-skip-permissions: an '
      + 'action needing approval fails closed instead of running unattended.',
  },
  cursor: {
    bin: 'cursor-agent',
    args: (task, flags) => withFlags(['-p'], task, flags),
    note: 'Cursor CLI, print mode. Best-effort flags -- confirm against the '
      + 'installed `cursor-agent --help` if this errors on an unknown flag.',
  },
  codex: {
    bin: 'codex',
    args: (task, flags) => withFlags(['exec'], task, flags),
    note: 'OpenAI Codex CLI, non-interactive exec. Best-effort flags -- '
      + 'confirm against the installed `codex --help` if this errors.',
  },
};

const AUTO_ORDER = ['claude', 'cursor', 'codex'];

// A task may name extra flags. They are separate argv entries, never a
// shell string. Approval-skipping flags are dropped: a CLI that needs a
// person to approve stops instead of running unattended.
const REFUSED_FLAGS = new Set([
  '--dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--yolo',
]);

function cleanFlags(flags) {
  const out = [];
  for (const raw of flags || []) {
    const token = String(raw == null ? '' : raw).trim();
    if (!token || REFUSED_FLAGS.has(token.split('=')[0])) continue;
    if (/[\n;&|`]/.test(token)) continue;
    out.push(token);
  }
  return out;
}

function withFlags(head, task, flags, tail) {
  return [...head, ...cleanFlags(flags), task, ...(tail || [])];
}

const SCHEMA = {
  type: 'object',
  properties: {
    agent: {
      type: 'string',
      enum: ['claude', 'cursor', 'codex', 'auto'],
      description: '"auto" tries claude, then cursor, then codex, and uses the first one installed.',
    },
    task: {
      type: 'string',
      description: 'What the agent should do, in full. It gets no other context than this and the working directory.',
    },
    cwd: {
      type: 'string',
      description: 'Working directory the agent runs in. Defaults to the open folder.',
    },
    flags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Extra flags for this CLI, each its own argument. A model flag can decide which CLI the task is assigned to.',
    },
  },
  required: ['agent', 'task'],
};

function spec() {
  return {
    name: BUILTIN_DELEGATE,
    description: (
      'Hand a task to another coding CLI already installed on this machine '
      + '(Claude Code, Cursor, or Codex) instead of doing it yourself -- for '
      + 'a real multi-file refactor, a debugging session, or anything that '
      + 'wants its own agentic loop over several files rather than one '
      + 'prompt-in/file-out turn. Reserve this for genuinely complex work: '
      + 'an ordinary edit is vscode_editFile, not this. Runs non-interactively '
      + 'and reports which files actually changed (git status before and '
      + 'after), so the result is checked, not just trusted. Takes minutes.'
    ),
    inputSchema: SCHEMA,
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

/** `git status --porcelain -z`: NUL-separated, unquoted. A rename is two
 * records (`R  old\\0new\\0`), so both paths come back as paths. A name
 * with a space is the name, not a quoted string. */
function parsePorcelainZ(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  const chunks = text.split('\0');
  if (chunks.length && chunks[chunks.length - 1] === '') chunks.pop();
  const paths = [];
  let i = 0;
  while (i < chunks.length) {
    const head = chunks[i++];
    if (!head || head.length < 4) continue;
    const xy = head.slice(0, 2);
    const path = head.slice(3);
    const renamed = xy.includes('R') || xy.includes('C');
    if (renamed) {
      const dest = chunks[i++] || '';
      if (path) paths.push(path);
      if (dest) paths.push(dest);
    } else if (path) {
      paths.push(path);
    }
  }
  return paths;
}

function gitStatusPaths(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
      cwd: cwd || undefined,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'buffer',
    }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(parsePorcelainZ(stdout));
    });
  });
}

function inScope(file, scope) {
  const norm = String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const allowed = new Set((scope || []).map((s) => String(s).trim().replace(/\\/g, '/').replace(/^\.\//, '')));
  return Boolean(norm) && allowed.has(norm);
}

function safeRel(file) {
  const norm = String(file || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm || norm.split('/').includes('..')) return '';
  return norm;
}

function readBytes(cwd, rel) {
  const full = joinPath(cwd, rel);
  try {
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

function writeBytes(cwd, rel, body) {
  const full = joinPath(cwd, rel);
  if (body == null) {
    try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch { /* already gone */ }
    return;
  }
  const dir = full.replace(/\/[^/]*$/, '');
  if (dir && dir !== full) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, body);
}

function bytesEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Buffer.compare(a, b) === 0;
}

/** Bytes of every path already dirty, taken before the CLI runs. A path
 * that is missing is stored as null so a file the CLI creates there can
 * be removed again. A path this map does not contain was clean. */
function snapshotOf(cwd, paths) {
  const snap = new Map();
  for (const file of paths || []) {
    const rel = safeRel(file);
    if (!rel || snap.has(rel)) continue;
    snap.set(rel, readBytes(cwd, rel));
  }
  return snap;
}

function indexEntries(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '-s', '-z'], {
      cwd: cwd || undefined,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'buffer',
    }, (err, stdout) => {
      if (err) return resolve(null);
      const map = new Map();
      const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      for (const row of text.split('\0')) {
        if (!row) continue;
        const tab = row.indexOf('\t');
        if (tab < 0) continue;
        map.set(row.slice(tab + 1), row.slice(0, tab));
      }
      resolve(map);
    });
  });
}

function resetIndex(cwd, rel) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'reset', '-q', '--', rel], {
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
    }, () => resolve());
  });
}

function headBytes(cwd, rel) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'show', `HEAD:${rel}`], {
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'buffer',
    }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout);
    });
  });
}

/** Paths whose bytes differ from the pre-call snapshot, including a file
 * that was already dirty and was edited further (its porcelain line does
 * not change) and a path that was clean. */
function changedPaths(cwd, snap, before, after) {
  if (!after) return null;
  const names = new Set();
  for (const p of before || []) { const r = safeRel(p); if (r) names.add(r); }
  for (const p of after || []) { const r = safeRel(p); if (r) names.add(r); }
  const out = [];
  for (const rel of names) {
    const now = readBytes(cwd, rel);
    if (snap.has(rel)) {
      if (!bytesEqual(snap.get(rel), now)) out.push(rel);
    } else if (now != null || (after || []).some((p) => safeRel(p) === rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Put an out-of-scope path back to the bytes captured before the call.
 * A path the snapshot holds is written back as those bytes, including
 * work that was already uncommitted. A path the snapshot does not hold
 * was clean, so HEAD is the same bytes; a path in neither is a new file
 * and is removed. The index is reset only when this call changed that
 * path's index record (a rename). A file the person had already staged
 * is left staged. Nothing here runs `git checkout`. */
async function revertOutside(cwd, changed, scope, snap, indexBefore, indexAfter) {
  const reverted = [];
  for (const file of changed || []) {
    if (inScope(file, scope)) continue;
    const rel = safeRel(file);
    if (!rel) continue;
    const body = snap && snap.has(rel) ? snap.get(rel) : await headBytes(cwd, rel);
    const beforeRec = indexBefore ? indexBefore.get(rel) : undefined;
    const afterRec = indexAfter ? indexAfter.get(rel) : undefined;
    if (indexBefore && indexAfter && beforeRec !== afterRec) await resetIndex(cwd, rel);
    writeBytes(cwd, rel, body);
    reverted.push(rel);
  }
  return reverted;
}

/** Lines present after the call that were not present before. A file dirty
 * in exactly the same way before and after will not show. The write fence
 * does not use this list: it compares bytes captured before the call. */
function changedSince(before, after) {
  if (!before || !after) return null;
  const had = new Set(before);
  return after.filter((line) => !had.has(line)).map((line) => line.slice(3).trim());
}

/** Windows only. npm's global installer writes THREE files for one CLI --
 * `claude`, `claude.cmd`, `claude.ps1` -- and `execFile('claude', ...)`
 * reports ENOENT for all of them: Node's spawn does not resolve `.cmd`/
 * `.bat` shims the way a real shell does, confirmed live -- `execFile`
 * returned "not installed" in 50ms although the shim was sitting right
 * there. The fix is not `shell: true`: that runs the command through
 * `cmd.exe /c`, which re-parses the whole line with cmd.exe's OWN
 * quoting rules -- the exact shell-injection surface `execFile` with an
 * argument array exists to avoid, and the task text is arbitrary. So
 * this reads the shim instead: npm's generated `.cmd` always quotes its
 * real target after substituting `%dp0%` for its own directory --
 * `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*` for
 * Claude Code on this machine. Read that path out and spawn it directly;
 * nothing about the task text ever reaches a shell. */
// Manual, separator-agnostic path handling throughout -- never `path.join`/
// `path.dirname`, which follow the HOST's own path flavour (POSIX on a Mac
// or Linux build machine) rather than the Windows target this function is
// specifically about. `fs` accepts forward slashes interchangeably with
// backslashes on Windows, so normalising everything to `/` is correct on
// the real target platform and is also what lets this be unit-tested from
// any host.
function joinPath(dir, rel) {
  return `${String(dir).replace(/[\\/]+$/, '')}/${String(rel).replace(/^[\\/]+/, '').replace(/\\/g, '/')}`;
}

function resolveWindowsShim(bin, platform = os.platform(), pathEnv = process.env.PATH) {
  if (platform !== 'win32') return null;
  const delimiter = pathEnv && pathEnv.includes(';') ? ';' : ':';
  const dirs = (pathEnv || '').split(delimiter).filter(Boolean);
  let shim = null;
  let shimDir = null;
  for (const dir of dirs) {
    for (const ext of ['.cmd', '.bat']) {
      const candidate = joinPath(dir, bin + ext);
      if (fs.existsSync(candidate)) { shim = candidate; shimDir = dir; break; }
    }
    if (shim) break;
  }
  if (!shim) return null;
  let text = '';
  try {
    text = fs.readFileSync(shim, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/"%dp0%\\?([^"]+)"/i) || text.match(/"%~dp0([^"]+)"/i);
  if (!m) return null;
  const target = joinPath(shimDir, m[1]);
  if (!fs.existsSync(target)) return null;
  if (/\.exe$/i.test(target)) return { bin: target, prefixArgs: [] };
  if (/\.js$/i.test(target)) return { bin: process.execPath, prefixArgs: [target] };
  return null;
}

function runAgentBin(bin, args, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const shim = resolveWindowsShim(bin);
    const realBin = shim ? shim.bin : bin;
    const realArgs = shim ? [...shim.prefixArgs, ...args] : args;
    execFile(realBin, realArgs, {
      cwd: cwd || undefined,
      timeout: TIMEOUT_MS,
      maxBuffer: 4_000_000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      const duration_ms = Date.now() - started;
      if (err && err.code === 'ENOENT') {
        resolve({ ok: false, missing: true, duration_ms });
        return;
      }
      const timedOut = Boolean(err && err.killed && err.signal);
      const code = err && err.code != null && typeof err.code === 'number' ? err.code : (err ? 1 : 0);
      resolve({
        ok: !err,
        missing: false,
        exit: code,
        timedOut,
        stdout: String(stdout || '').slice(0, MAX_OUT),
        stderr: String(stderr || '').slice(0, 20_000),
        duration_ms,
        error: err && !stdout && !stderr && !timedOut ? String(err.message || err) : undefined,
      });
    });
  });
}

async function runOne(name, task, cwd, agents = AGENTS, flags, scope) {
  const agent = agents[name];
  if (!agent) return { ok: false, error: `unknown agent "${name}"` };
  const before = await gitStatusPaths(cwd);
  const snap = before ? snapshotOf(cwd, before) : null;
  const indexBefore = Array.isArray(scope) && before ? await indexEntries(cwd) : null;
  const run = await runAgentBin(agent.bin, agent.args(task, flags), cwd);
  if (run.missing) {
    return { ok: false, agent: name, missing: true, error: `\`${agent.bin}\` is not installed, or not on PATH` };
  }
  let after = await gitStatusPaths(cwd);
  let changed = snap ? changedPaths(cwd, snap, before, after) : null;
  let reverted = [];
  if (Array.isArray(scope) && changed && snap) {
    const indexAfter = await indexEntries(cwd);
    reverted = await revertOutside(cwd, changed, scope, snap, indexBefore, indexAfter);
    after = await gitStatusPaths(cwd);
    changed = changedPaths(cwd, snap, before, after);
  }
  return {
    ok: run.ok,
    agent: name,
    note: agent.note,
    exit: run.exit,
    timed_out: run.timedOut,
    duration_ms: run.duration_ms,
    changed_files: changed,
    reverted,
    stdout: run.stdout,
    stderr: run.stderr,
    error: run.error,
  };
}

async function delegate(input, defaultCwd, agents = AGENTS) {
  const task = String((input && input.task) || '').trim();
  if (!task) return { ok: false, error: 'task required' };
  if (shellBlocked(task)) return { ok: false, error: 'blocked: this reads as a destructive shell action' };
  const cwd = String((input && input.cwd) || defaultCwd || process.cwd());
  const agent = String((input && input.agent) || 'auto').trim();
  const flags = cleanFlags(input && input.flags);
  const scope = Array.isArray(input && input.scope) ? input.scope : undefined;
  if (agent !== 'auto') {
    return runOne(agent, task, cwd, agents, flags, scope);
  }
  const tried = [];
  for (const name of AUTO_ORDER) {
    const out = await runOne(name, task, cwd, agents, flags, scope);
    if (!out.missing) return out;
    tried.push(name);
  }
  return {
    ok: false,
    error: `none of ${tried.join(', ')} are installed on this machine`,
    tried,
  };
}

function createImpl(vscode) {
  return {
    async invoke(options) {
      const input = (options && options.input) || {};
      const cwd = String(input.cwd || folderPath(vscode) || process.cwd());
      const out = await delegate(input, cwd);
      const task = String((input && input.task) || '');
      const label = `delegate:${String((input && input.agent) || 'auto')} ${task.slice(0, 80)}`;
      showTranscript(vscode, label, {
        stdout: out.stdout || '',
        stderr: out.stderr || out.error || '',
        exit: out.exit != null ? out.exit : (out.ok ? 0 : 1),
      }, cwd);
      return textResult(vscode, out);
    },
  };
}

function register(vscode) {
  const lm = vscode && vscode.lm;
  const impl = createImpl(vscode);
  let registration = null;
  if (lm && typeof lm.registerToolDefinition === 'function') {
    registration = lm.registerToolDefinition({
      name: BUILTIN_DELEGATE,
      displayName: 'Delegate to Agent',
      description: spec().description,
      inputSchema: SCHEMA,
      tags: ['anchortrails'],
    }, impl);
  } else if (lm && typeof lm.registerTool === 'function') {
    registration = lm.registerTool(BUILTIN_DELEGATE, impl);
  }
  return {
    dispose() {
      if (registration && typeof registration.dispose === 'function') {
        registration.dispose();
      }
    },
  };
}

module.exports = {
  BUILTIN_DELEGATE,
  SCHEMA,
  AGENTS,
  AUTO_ORDER,
  spec,
  changedSince,
  parsePorcelainZ,
  inScope,
  revertOutside,
  resolveWindowsShim,
  cleanFlags,
  withFlags,
  runOne,
  delegate,
  createImpl,
  register,
};
