'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  BUILTIN_DELEGATE, SCHEMA, AGENTS, AUTO_ORDER, spec, changedSince, parsePorcelainZ, resolveWindowsShim, runOne, delegate, createImpl, register,
} = require('./delegate');

// TESTS NEVER TOUCH A REAL INSTALLED CLI. `claude` and `codex` are on PATH on
// the machine these tests were first run on -- an earlier version of this
// suite called `runOne('claude', ...)` directly and it silently ran the real
// CLI, spending real API credits, for over ten seconds per test. Every test
// below passes its OWN agents map pointing at a tiny node stand-in script,
// so nothing here can reach `claude`, `cursor-agent` or `codex` for real,
// no matter what happens to be installed on the machine running the suite.

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-delegate-'));
  return new Promise((resolve, reject) => {
    execFile('git', ['init', '-q'], { cwd: dir }, (err) => {
      if (err) return reject(err);
      execFile('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'x'], { cwd: dir }, (err2) => {
        if (err2) return reject(err2);
        resolve(dir);
      });
    });
  });
}

/** A stand-in "agent": a node script under `dir`, wired the same shape as a
 * real AGENTS entry (`bin`, `args`, `note`) but pointed at `process.execPath`
 * running our own script -- never at a real external CLI name. */
function stubAgent(dir, body) {
  const file = path.join(dir, `stub-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(file, body);
  return { bin: process.execPath, args: (task) => [file, task], note: 'test stand-in' };
}

function missingAgents() {
  // A binary name guaranteed not to exist, for every slot -- proves the
  // "not installed" path without depending on what is or isn't on THIS
  // machine's PATH.
  const missing = { bin: 'at-delegate-test-nonexistent-binary', args: (t) => [t], note: 'missing' };
  return { claude: missing, cursor: missing, codex: missing };
}

describe('dest delegateToAgent', () => {
  it('is a dest builtin with a real name and a required task', () => {
    assert.equal(BUILTIN_DELEGATE, 'delegateToAgent');
    assert.equal(spec().name, 'delegateToAgent');
    assert.deepEqual(SCHEMA.required, ['agent', 'task']);
    assert.deepEqual(SCHEMA.properties.agent.enum, ['claude', 'cursor', 'codex', 'auto']);
  });

  it('names claude, cursor and codex, in that fallback order for auto', () => {
    assert.deepEqual(AUTO_ORDER, ['claude', 'cursor', 'codex']);
    assert.ok(AGENTS.claude && AGENTS.cursor && AGENTS.codex);
    for (const name of AUTO_ORDER) {
      assert.equal(typeof AGENTS[name].bin, 'string');
      assert.equal(typeof AGENTS[name].args, 'function');
    }
  });

  it('does not shell-quote the task -- args are an array reaching the process directly', () => {
    const args = AGENTS.claude.args('anything; rm -rf / && echo "gotcha"');
    assert.deepEqual(args, ['-p', 'anything; rm -rf / && echo "gotcha"', '--output-format', 'json']);
  });

  it('refuses a task that reads as a destructive shell action, before ever spawning a CLI', async () => {
    const out = await delegate({ agent: 'claude', task: 'run rm -rf / to clean up' }, process.cwd(), missingAgents());
    assert.equal(out.ok, false);
    assert.match(out.error, /blocked/);
  });

  it('reports a missing binary as "not installed", not a generic failure', async () => {
    const out = await runOne('claude', 'say hello', process.cwd(), missingAgents());
    assert.equal(out.missing, true);
    assert.match(out.error, /not installed/);
  });

  it('auto tries every agent in order and reports all three as missing together', async () => {
    const out = await delegate({ agent: 'auto', task: 'say hello' }, process.cwd(), missingAgents());
    assert.equal(out.ok, false);
    assert.deepEqual(out.tried, ['claude', 'cursor', 'codex']);
    assert.match(out.error, /claude, cursor, codex/);
  });

  it('auto stops at the first agent that is actually installed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-delegate-'));
    const agents = {
      claude: { bin: 'at-delegate-test-nonexistent-binary', args: (t) => [t], note: '' },
      cursor: stubAgent(dir, "process.exit(0);"),
      codex: { bin: 'at-delegate-test-nonexistent-binary-2', args: (t) => [t], note: '' },
    };
    const out = await delegate({ agent: 'auto', task: 'x' }, dir, agents);
    assert.equal(out.agent, 'cursor');
    assert.equal(out.ok, true);
  });

  it('changedSince finds only what is new, and returns null when there is nothing to compare', () => {
    assert.equal(changedSince(null, ['??  a.txt']), null);
    assert.equal(changedSince(['??  a.txt'], null), null);
    const before = [' M src/a.ts', '?? old.txt'];
    const after = [' M src/a.ts', '?? old.txt', '?? new.ts', ' M src/b.ts'];
    assert.deepEqual(changedSince(before, after), ['new.ts', 'src/b.ts']);
    assert.deepEqual(changedSince([], []), []);
  });

  it('parses a rename as two paths and keeps a space in the name', () => {
    const raw = 'R  kept.txt\0renamed.txt\0?? sub/my file.txt\0';
    assert.deepEqual(parsePorcelainZ(raw), ['kept.txt', 'renamed.txt', 'sub/my file.txt']);
  });

  it('puts back a file the CLI wrote outside the task scope', async () => {
    const repo = await tmpRepo();
    const agents = {
      claude: stubAgent(repo, "require('fs').writeFileSync('kept.txt', 'in'); require('fs').writeFileSync('other.txt', 'out');"),
      cursor: AGENTS.cursor,
      codex: AGENTS.codex,
    };
    const out = await runOne('claude', 'x', repo, agents, [], ['kept.txt']);
    assert.deepEqual(out.changed_files, ['kept.txt']);
    assert.deepEqual(out.reverted, ['other.txt']);
    assert.equal(fs.existsSync(path.join(repo, 'other.txt')), false);
    assert.equal(fs.readFileSync(path.join(repo, 'kept.txt'), 'utf8'), 'in');
  });

  it('puts back pre-call bytes of a dirty file, a rename, and a path with a space', async () => {
    const repo = await tmpRepo();
    const git = (args) => new Promise((resolve, reject) => {
      execFile('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo }, (err) => (err ? reject(err) : resolve()));
    });
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'base\n');
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'v1\n');
    await git(['add', 'dirty.txt', 'tracked.txt']);
    await git(['commit', '-qm', 'base']);
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'base\nmine\n');
    const body = [
      "require('fs').writeFileSync('kept.txt', 'in');",
      "require('fs').writeFileSync('dirty.txt', 'base\\nmine\\nCLI\\n');",
      "require('fs').mkdirSync('sub', {recursive:true});",
      "require('fs').writeFileSync('sub/my file.txt', 'x');",
      "require('child_process').execFileSync('git', ['mv', 'tracked.txt', 'renamed.txt']);",
    ].join('\n');
    const agents = { claude: stubAgent(repo, body), cursor: AGENTS.cursor, codex: AGENTS.codex };
    const out = await runOne('claude', 'x', repo, agents, [], ['kept.txt']);
    assert.deepEqual(out.changed_files, ['kept.txt']);
    assert.deepEqual([...out.reverted].sort(), ['dirty.txt', 'renamed.txt', 'sub/my file.txt', 'tracked.txt']);
    assert.equal(fs.readFileSync(path.join(repo, 'dirty.txt'), 'utf8'), 'base\nmine\n');
    assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'v1\n');
    assert.equal(fs.existsSync(path.join(repo, 'renamed.txt')), false);
    assert.equal(fs.existsSync(path.join(repo, 'sub/my file.txt')), false);
    assert.equal(fs.readFileSync(path.join(repo, 'kept.txt'), 'utf8'), 'in');
  });

  it("reads real git status before and after a run, not the agent's own say-so", async () => {
    const repo = await tmpRepo();
    const agents = { claude: stubAgent(repo, "require('fs').writeFileSync('made.txt', 'hi');"), cursor: AGENTS.cursor, codex: AGENTS.codex };
    const out = await runOne('claude', 'x', repo, agents);
    assert.equal(out.ok, true);
    assert.deepEqual(out.changed_files, ['made.txt']);
  });

  it('reports exit code and stderr honestly when the agent fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-delegate-'));
    const agents = { claude: stubAgent(dir, "process.stderr.write('boom'); process.exit(3);"), cursor: AGENTS.cursor, codex: AGENTS.codex };
    const out = await runOne('claude', 'x', dir, agents);
    assert.equal(out.ok, false);
    assert.equal(out.exit, 3);
    assert.match(out.stderr, /boom/);
  });

  it('carries the note about best-effort flags on cursor and codex', async () => {
    const out = await runOne('cursor', 'x', process.cwd(), missingAgents());
    assert.match(out.error, /not installed/);
    // the real registry (not the missing-stub one) is what ships the note
    assert.match(AGENTS.cursor.note, /best-effort|Best-effort/);
    assert.match(AGENTS.codex.note, /best-effort|Best-effort/);
  });

  it('shows the run in the same AT terminal transcript, so the user watches it happen', async () => {
    const sent = [];
    const vscode = {
      window: {
        terminals: [],
        createTerminal({ name }) { return { name, show() { sent.push('show'); }, sendText(t) { sent.push(t); } }; },
      },
      workspace: { workspaceFolders: [{ uri: { fsPath: process.cwd() } }] },
    };
    const impl = createImpl(vscode);
    const out = await impl.invoke({ input: { agent: 'claude', task: 'rm -rf / everything' } });
    const body = JSON.parse(out.content[0].value);
    assert.equal(body.ok, false);
    assert.ok(sent.includes('show'), 'the transcript still paints even for a refused call');
  });

  it('registers on dest lm', () => {
    const names = [];
    const vscode = { lm: { registerToolDefinition(def) { names.push(def.name); return { dispose() {} }; } } };
    register(vscode);
    assert.deepEqual(names, ['delegateToAgent']);
  });
});

describe('resolveWindowsShim', () => {
  it('is a no-op off Windows -- execFile resolves a real PATH entry there just fine', () => {
    assert.equal(resolveWindowsShim('claude', 'darwin'), null);
    assert.equal(resolveWindowsShim('claude', 'linux'), null);
  });

  it("reads npm's real generated .cmd shim and finds the bundled .exe it wraps", () => {
    // The exact claude.cmd content found on the machine that surfaced this bug:
    // execFile('claude', ...) reported "not installed" in 50ms although this
    // file was sitting on PATH the whole time.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-shim-'));
    const bundleDir = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(bundleDir, { recursive: true });
    const exePath = path.join(bundleDir, 'claude.exe');
    fs.writeFileSync(exePath, '');
    fs.writeFileSync(path.join(dir, 'claude.cmd'), [
      '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL',
      'CALL :find_dp0',
      '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*', '',
    ].join('\r\n'));
    const out = resolveWindowsShim('claude', 'win32', dir);
    assert.ok(out, 'the shim should have been found and parsed');
    assert.equal(fs.realpathSync(out.bin), fs.realpathSync(exePath));
    assert.deepEqual(out.prefixArgs, []);
  });

  it('resolves a .js-backed shim to node.exe plus the script, not the script alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-shim-'));
    const scriptPath = path.join(dir, 'node_modules', 'some-cli', 'bin', 'cli.js');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, '');
    fs.writeFileSync(path.join(dir, 'somecli.cmd'), '"%dp0%\\node_modules\\some-cli\\bin\\cli.js" %*\r\n');
    const out = resolveWindowsShim('somecli', 'win32', dir);
    assert.equal(out.bin, process.execPath);
    assert.deepEqual(out.prefixArgs, [scriptPath]);
  });

  it('returns null when there is no shim on PATH, so the caller falls back to the bare name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-shim-'));
    assert.equal(resolveWindowsShim('nothing-here', 'win32', dir), null);
  });

  it('returns null when the shim points at a target that does not actually exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'at-shim-'));
    fs.writeFileSync(path.join(dir, 'ghost.cmd'), '"%dp0%\\node_modules\\ghost\\bin\\ghost.exe" %*\r\n');
    assert.equal(resolveWindowsShim('ghost', 'win32', dir), null);
  });
});
