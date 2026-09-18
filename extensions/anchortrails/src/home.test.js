'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { VIEW_ID, homeHtml } = require('./home');

describe('AT Panel home', () => {
  it('uses the dest home view', () => {
    assert.equal(VIEW_ID, 'anchortrails.home');
  });

  it('renders surface tiles and marks the active one', () => {
    const html = homeHtml({
      surface: 'drive',
      surfaces: [
        { id: 'auto', label: 'Auto', hint: 'assign()', inputs: ['text'], pack: [], active: false },
        { id: 'drive', label: 'Computer use', hint: 'Look then go', inputs: ['text', 'image'], pack: ['browser_look'], active: true },
        { id: 'docs', label: 'Documents', hint: 'PDF', inputs: ['text'], pack: ['pdf_read'], active: false },
      ],
    });
    assert.match(html, /AT Panel/);
    assert.match(html, /data-id="drive"/);
    assert.match(html, /class="tile on"/);
    assert.match(html, /Computer use/);
    assert.match(html, /Documents/);
    assert.ok(!html.includes('desktop_vault_get'));
  });

  it('paints local tiles when the node has no panel payload', () => {
    const { FALLBACK_SURFACES } = require('./home');
    const html = homeHtml({ surfaces: [] }, { status: 404, message: 'Not Found' });
    assert.match(html, /data-id="drive"/);
    assert.match(html, /Computer use/);
    assert.match(html, /Not Found/);
    assert.ok(FALLBACK_SURFACES.length >= 6);
    assert.ok(!html.includes('desktop_vault_get'));
  });

  it('shows the live plan on the middle AT panel', () => {
    const html = homeHtml({
      wide: true,
      surfaces: [{ id: 'auto', label: 'Auto', inputs: ['text'], pack: [] }],
      plan: { cursor: '3/6', goal: 'Add products to Aozhen', steps: '1.DESIGN [x] | 3.BUILD [>]' },
    });
    assert.match(html, /grid-template-columns: 1fr 1fr/);
    assert.match(html, /Plan 3\/6/);
    assert.match(html, /Add products to Aozhen/);
    assert.match(html, /class="step done seedable"/);
    assert.match(html, /class="step now seedable"/);
    assert.match(html, /cmd: 'seed'/);
  });
});
