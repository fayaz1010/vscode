'use strict';
/**
 * AnchorTrails account — same device-code flow as mesh-app.
 * Identity lives on the node. This file never logs tokens.
 */

const PROVIDER_ID = 'anchortrails';
const COPILOT_IDS = [
  'GitHub.copilot-chat',
  'GitHub.copilot',
];

function sessionFromStatus(status) {
  if (!status || !status.signed_in) return null;
  const label = status.email || status.name || 'AnchorTrails';
  return {
    id: `at:${status.email || status.mesh_id || 'account'}`,
    accessToken: 'node',
    account: { id: status.email || 'anchortrails', label },
    scopes: [],
  };
}

function interpretPoll(result) {
  const status = result && result.status;
  if (status === 'signed_in') return { done: true, kind: 'signed_in', transferred: !!result.transferred };
  if (status === 'provisioned') {
    return { done: true, kind: 'provisioned', note: result.note || '' };
  }
  if (status === 'error') {
    return { done: true, kind: 'error', message: result.message || result.error || 'sign-in failed' };
  }
  return { done: false, kind: 'pending' };
}

function signInPlan(status, inFlight) {
  if (inFlight) return { action: 'join' };
  if (sessionFromStatus(status)) return { action: 'reuse' };
  return { action: 'start' };
}

function statusBarText(status) {
  if (!status || !status.signed_in) return '$(account) Sign in to AnchorTrails';
  const plan = status.unlimited
    ? 'Unlimited'
    : (typeof status.remaining === 'number' ? `${status.remaining} left` : (status.tier || ''));
  const email = status.email || 'signed in';
  return `$(account) ${email}${plan ? ` · ${plan}` : ''}`;
}

async function disableCopilot(vscode) {
  for (const id of COPILOT_IDS) {
    try {
      if (vscode.extensions.getExtension(id)) {
        await vscode.commands.executeCommand('workbench.extensions.disableExtension', id);
      }
    } catch {
      // launch --disable-extension still applies
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDeviceCode(client, vscode, token) {
  const start = await client.signinStart();
  if (start.error) {
    throw new Error(start.message || start.error);
  }
  const url = start.verification_url;
  const code = start.user_code;
  if (url && vscode.env && vscode.env.openExternal) {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
  const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;
  const interval = Math.max(2, Number(start.interval) || 3) * 1000;

  while (!token.isCancellationRequested) {
    if (Date.now() > deadline) {
      throw new Error('Code expired — start sign-in again.');
    }
    try {
      if (sessionFromStatus(await client.account())) {
        return { done: true, kind: 'signed_in' };
      }
    } catch { /* keep polling this code */ }
    const poll = interpretPoll(await client.signinPoll(start.device_token));
    if (poll.kind === 'signed_in') return poll;
    if (poll.kind === 'provisioned') {
      throw new Error(
        'A new empty mesh was created for this account. Switching would '
        + 'disconnect devices on the current mesh. Sign in from a machine '
        + 'that already belongs to the mesh you want.',
      );
    }
    if (poll.kind === 'error') throw new Error(poll.message);
    await sleep(interval);
  }
  throw new Error('Sign-in cancelled.');
}

function startAccount(client, vscode) {
  const emitter = new vscode.EventEmitter();
  let cached = null;
  let inFlight = null;

  async function currentSession() {
    try {
      cached = sessionFromStatus(await client.account());
    } catch {
      cached = null;
    }
    return cached;
  }

  async function finishSession(next) {
    const added = [next];
    const removed = cached && cached.id !== next.id ? [cached] : [];
    cached = next;
    emitter.fire({ added, removed, changed: [] });
    await vscode.commands.executeCommand('setContext', 'anchortrails.signedIn', true);
    return next;
  }

  const provider = {
    onDidChangeSessions: emitter.event,
    async getSessions(_scopes) {
      const session = await currentSession();
      return session ? [session] : [];
    },
    async createSession(_scopes) {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const already = await currentSession();
        if (already) return already;
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'AnchorTrails sign-in',
          cancellable: true,
        }, async (progress, token) => {
          progress.report({ message: 'Approve the code in your browser…' });
          await runDeviceCode(client, vscode, token);
        });
        const next = sessionFromStatus(await client.account());
        if (!next) throw new Error('Signed in on the node, but status is not ready yet.');
        return finishSession(next);
      })().finally(() => { inFlight = null; });
      return inFlight;
    },
    async removeSession() {
      const removed = cached ? [cached] : [];
      cached = null;
      emitter.fire({ added: [], removed, changed: [] });
      await vscode.commands.executeCommand('setContext', 'anchortrails.signedIn', false);
    },
  };

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  bar.command = 'anchortrails.signIn';
  bar.name = 'AnchorTrails account';

  async function refreshBar() {
    try {
      const status = await client.account();
      cached = sessionFromStatus(status);
      bar.text = statusBarText(status);
      const signedIn = !!(status && status.signed_in);
      bar.command = signedIn ? 'anchortrails.accountStatus' : 'anchortrails.signIn';
      bar.tooltip = signedIn
        ? `${status.tier || ''} · mesh stays adopted, not replaced`
        : (status && (status.reason || status.error)) || 'Sign in — existing mesh is adopted';
      await vscode.commands.executeCommand('setContext', 'anchortrails.signedIn', signedIn);
    } catch (err) {
      bar.text = '$(account) AnchorTrails (node offline)';
      bar.tooltip = String(err && err.message ? err.message : err);
      await vscode.commands.executeCommand('setContext', 'anchortrails.signedIn', false);
    }
    bar.show();
  }

  const signInCmd = vscode.commands.registerCommand('anchortrails.signIn', async () => {
    try {
      await provider.createSession([]);
      await refreshBar();
    } catch (err) {
      vscode.window.showErrorMessage(`AnchorTrails sign-in: ${err.message || err}`);
    }
  });

  const statusCmd = vscode.commands.registerCommand('anchortrails.accountStatus', async () => {
    try {
      const status = await client.account();
      if (!status.signed_in) {
        const go = await vscode.window.showInformationMessage(
          status.reason || status.error || 'Not signed in.',
          'Sign in',
        );
        if (go === 'Sign in') await vscode.commands.executeCommand('anchortrails.signIn');
        return;
      }
      const plan = status.unlimited ? 'Unlimited' : `${status.remaining} / ${status.included} left`;
      vscode.window.showInformationMessage(
        `${status.email || 'signed in'} · ${status.tier || ''} · ${plan}`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`AnchorTrails account: ${err.message || err}`);
    }
  });

  const auth = vscode.authentication.registerAuthenticationProvider(
    PROVIDER_ID,
    'AnchorTrails',
    provider,
    { supportsMultipleAccounts: false },
  );

  refreshBar();
  disableCopilot(vscode);

  return {
    provider,
    dispose() {
      emitter.dispose();
      bar.dispose();
      signInCmd.dispose();
      statusCmd.dispose();
      auth.dispose();
    },
  };
}

module.exports = {
  PROVIDER_ID,
  COPILOT_IDS,
  sessionFromStatus,
  interpretPoll,
  signInPlan,
  statusBarText,
  disableCopilot,
  startAccount,
};
