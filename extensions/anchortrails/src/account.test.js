'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sessionFromStatus, interpretPoll, signInPlan, statusBarText, PROVIDER_ID, COPILOT_IDS } = require('./account');

describe('sessionFromStatus', () => {
  it('is empty until the node is signed in', () => {
    assert.equal(sessionFromStatus(null), null);
    assert.equal(sessionFromStatus({ signed_in: false, reason: 'not attached' }), null);
  });

  it('uses the email as the account label and never stores a key', () => {
    const s = sessionFromStatus({
      signed_in: true,
      email: 'owner@anchortrails.com',
      tier: 'OWNER',
      auth_key: 'must-not-appear',
    });
    assert.equal(s.account.label, 'owner@anchortrails.com');
    assert.equal(s.accessToken, 'node');
    assert.ok(!JSON.stringify(s).includes('must-not-appear'));
  });
});

describe('interpretPoll', () => {
  it('adopts on signed_in and refuses a silent mesh switch', () => {
    assert.equal(interpretPoll({ status: 'signed_in', transferred: true }).kind, 'signed_in');
    assert.equal(interpretPoll({ status: 'provisioned' }).kind, 'provisioned');
    assert.equal(interpretPoll({ status: 'pending' }).done, false);
    assert.equal(interpretPoll({ status: 'error', message: 'nope' }).message, 'nope');
  });
});

describe('signInPlan', () => {
  it('reuses a live session and joins an in-flight device-code instead of starting another', () => {
    assert.equal(signInPlan({ signed_in: true, email: 'a@b.c' }, null).action, 'reuse');
    assert.equal(signInPlan({ signed_in: false }, Promise.resolve()).action, 'join');
    assert.equal(signInPlan({ signed_in: false }, null).action, 'start');
  });
});

describe('statusBarText', () => {
  it('asks to sign in, then names the account', () => {
    assert.match(statusBarText({ signed_in: false }), /Sign in to AnchorTrails/);
    assert.match(statusBarText({ signed_in: true, email: 'a@b.c', remaining: 12, unlimited: false }), /a@b\.c · 12 left/);
  });
});

describe('provider', () => {
  it('is the product.json default provider, not Copilot', () => {
    assert.equal(PROVIDER_ID, 'anchortrails');
    assert.ok(COPILOT_IDS.includes('GitHub.copilot-chat'));
  });
});
