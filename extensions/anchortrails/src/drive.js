'use strict';
/**
 * Claim inbound /api/agent/drive items and open them as @at turns.
 * Other AIs POST; this fork receives. No paste.
 */

const PARTICIPANT = '@at';

function chatQuery(ahead) {
  const text = String(ahead || '').trim();
  if (!text) return '';
  if (/^@at\b/i.test(text)) return text;
  return `${PARTICIPANT} ${text}`;
}

async function openChat(vscode, { query, send = false } = {}) {
  const text = chatQuery(query);
  if (!text || !vscode || !vscode.commands) return { opened: false };
  await vscode.commands.executeCommand('workbench.action.chat.open', {
    query: text,
    isPartialQuery: !send,
  });
  return { opened: true, query: text, send: Boolean(send) };
}

async function openDrivenTurn(vscode, item) {
  const out = await openChat(vscode, { query: item && item.ahead, send: true });
  return { ...out, id: item && item.id };
}

function startDriveLoop(client, vscode, { waitMs = 25000, sleepMs = 800 } = {}) {
  let stopped = false;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const loop = (async () => {
    while (!stopped) {
      try {
        const item = await client.driveNext(waitMs);
        if (stopped) return;
        if (item && item.empty === false && item.ahead) {
          await openDrivenTurn(vscode, item);
        }
      } catch {
        if (stopped) return;
        await sleep(sleepMs);
      }
    }
  })();

  return {
    dispose() {
      stopped = true;
    },
    done: loop,
  };
}

module.exports = {
  PARTICIPANT,
  chatQuery,
  openChat,
  openDrivenTurn,
  startDriveLoop,
};
