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
    args: (task) => ['-p', task, '--output-format', 'json'],
    note: 'Claude Code, print mode. No --dangerously-skip-permissions: an '
      + 'action needing approval fails closed instead of running unattended.',
  },
  cursor: {
    bin: 'cursor-agent',
    args: (task) => ['-p', task],
    note: 'Cursor CLI, print mode. Best-effort flags -- confirm against the '
      + 'installed `cursor-agent --help` if this errors on an unknown flag.',
  },
  codex: {
    bin: 'codex',
    args: (task) => ['exec', task],
    note: 'OpenAI Codex CLI, non-interactive exec. Best-effort flags -- '
      + 'confirm against the installed `codex --help` if this errors.',
  },
};

const AUTO_ORDER = ['claude', 'cursor', 'codex'];

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

function gitStatusLines(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain'], {
      cwd: cwd || undefined,
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
    }, (err, stdout) => {
      // Not a git repo, git missing, or the call itself timed out: diffing
      // is a nicety, not a requirement, so a failure here is silent -- the
      // caller still gets the agent's own stdout/stderr either way.
      if (err) return resolve(null);
      const lines = String(stdout || '')
        .split('\n')
        .map((l) => l.replace(/\r$/, ''))
        .filter(Boolean);
      resolve(lines);
    });
  });
}

/** Lines present after the call that were not present before: new dirt this
 * call caused, or a file's status changing further while already dirty
 * shows up too since the whole line (status codes + path) is compared. A
 * file dirty in exactly the same way before and after will not show --
 * that is the one case this cannot see, and it is an acceptable gap for a
 * "what did this just do" summary rather than a full diff. */
function changedSince(before, after) {
  if (!before || !after) return null;
  const had = new Set(before);
  return after.filter((line) => !had.has(line)).map((line) => line.slice(3).trim());
}

function runAgentBin(bin, args, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(bin, args, {
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

async function runOne(name, task, cwd, agents = AGENTS) {
  const agent = agents[name];
  if (!agent) return { ok: false, error: `unknown agent "${name}"` };
  const before = await gitStatusLines(cwd);
  const run = await runAgentBin(agent.bin, agent.args(task), cwd);
  if (run.missing) {
    return { ok: false, agent: name, missing: true, error: `\`${agent.bin}\` is not installed, or not on PATH` };
  }
  const after = await gitStatusLines(cwd);
  return {
    ok: run.ok,
    agent: name,
    note: agent.note,
    exit: run.exit,
    timed_out: run.timedOut,
    duration_ms: run.duration_ms,
    changed_files: changedSince(before, after),
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
  if (agent !== 'auto') {
    return runOne(agent, task, cwd, agents);
  }
  const tried = [];
  for (const name of AUTO_ORDER) {
    const out = await runOne(name, task, cwd, agents);
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
  runOne,
  delegate,
  createImpl,
  register,
};
