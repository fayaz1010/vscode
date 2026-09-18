'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { costLine, modelsHtml, taskPicksHtml } = require('./models');

describe('dest models tab', () => {
  it('shows OpenRouter hits with costs and an add button', () => {
    const html = modelsHtml({
      models: {
        q: 'grok',
        hits: [{
          id: 'x-ai/grok-4.20',
          name: 'Grok 4.20',
          prompt_per_m: 2,
          completion_per_m: 10,
        }],
        group: [{ slug: 'grok-4.6', name: 'Grok 4.6', prompt_per_m: 2, builtin: true }],
      },
    });
    assert.match(html, /Search OpenRouter/);
    assert.match(html, /Grok 4\.20/);
    assert.match(html, /\$2\.00 \/ \$10\.00 per 1M/);
    assert.match(html, /data-cmd="add-model"/);
    assert.match(html, /data-id="x-ai\/grok-4.20"/);
    assert.match(html, /paste provider\/model/);
    assert.match(html, /grok-4\.6/);
    assert.ok(!html.includes('sk-'));
  });

  it('renders per-task selects from the group', () => {
    const html = taskPicksHtml({
      models: {
        slugs: ['grok-4.6', 'claude-sonnet-5'],
        tasks: [{
          task: 'plan',
          label: 'Plan',
          slug: 'claude-sonnet-5',
          fallback: 'grok-4.6',
          allowed: ['grok-4.6', 'claude-sonnet-5'],
        }],
      },
    });
    assert.match(html, /Models for tasks/);
    assert.match(html, /data-task="plan"/);
    assert.match(html, /claude-sonnet-5/);
    assert.match(html, /data-field="fallback"/);
  });

  it('formats missing costs as a dash', () => {
    assert.equal(costLine({}), '—');
  });

  it('shows a search error without a key', () => {
    const html = modelsHtml({ models: { q: 'llama', hits: [], searchError: 'OpenRouter listing failed' } });
    assert.match(html, /OpenRouter listing failed/);
    assert.ok(!html.includes('sk-'));
  });
});
