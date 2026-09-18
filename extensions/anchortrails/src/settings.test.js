'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VIEW_ID, SCAN_PROMPT, confirmComputerScan, creditLine, tokenLine, settingsHtml } = require('./settings');

describe('AT Settings page', () => {
  it('uses the dest settings view id', () => {
    assert.equal(VIEW_ID, 'anchortrails.settings');
  });

  it('asks before scanning the computer and treats cancel as no', async () => {
    assert.match(SCAN_PROMPT, /Gitignored/);
    assert.match(SCAN_PROMPT, /encrypted/);
    let seen;
    const cancelled = await confirmComputerScan({
      window: {
        async showWarningMessage(msg, opts, ...btns) {
          seen = { msg, opts, btns };
          return undefined;
        },
      },
    });
    assert.equal(cancelled, false);
    assert.equal(seen.opts.modal, true);
    assert.deepEqual(seen.btns, ['Scan']);
    const ok = await confirmComputerScan({
      window: { async showWarningMessage() { return 'Scan'; } },
    });
    assert.equal(ok, true);
  });

  it('formats credits and tokens without inventing a key', () => {
    assert.equal(creditLine({ unlimited: true }), 'Unlimited');
    assert.equal(creditLine({ used: 12, remaining: 88, included: 100 }), '12 used · 88 left · 100 included');
    assert.equal(tokenLine({ today: 40, pending: 3 }), '40 today · 3 pending');
  });

  it('renders connections and model via, never a secret value', () => {
    const html = settingsHtml({
      credits: { signed_in: true, email: 'm@example.com', tier: 'pro', used: 12, remaining: 88, included: 100 },
      tokens: { today: 40, pending: 3, by_tool: [{ name: 'browser_look', tokens: 2 }] },
      models: {
        slugs: ['grok-4.6'],
        connected: true,
        via: ['vault'],
        tasks: [{
          task: 'implement',
          label: 'Implement / build',
          slug: 'grok-4.6',
          fallback: 'grok-4.6',
          allowed: ['grok-4.6'],
        }],
      },
      connections: [
        { id: 'openrouter_api_key', label: 'OpenRouter API key', group: 'AI', connected: true, via: ['vault'], ok: true },
      ],
    });
    assert.match(html, /AT Settings/);
    assert.match(html, /12 used/);
    assert.match(html, /40 today/);
    assert.match(html, /grok-4.6/);
    assert.match(html, /Models for tasks/);
    assert.match(html, /data-task="implement"/);
    assert.match(html, /OpenRouter API key/);
    assert.match(html, /Scan this computer/);
    assert.match(html, /dot ok/);
    assert.ok(!html.includes('sk-'));
    assert.ok(!html.includes('desktop_vault_get'));
    assert.ok(!html.includes('openrouter_api_key') || html.includes('OpenRouter'));
  });
});
