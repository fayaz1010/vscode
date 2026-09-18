'use strict';
/**
 * Offline fallback only. Live slugs come from GET /api/agent/catalog
 * (model_route.assign_slugs). AT adding a model must not require a
 * fork patch — refresh the node, then the provider re-reads catalog.
 */

const FALLBACK_SLUGS = [
  'gpt-5.6-luna',
  'composer-2.5',
  'gemini-3.8-flash',
  'claude-haiku-4.5',
  'grok-4.6',
  'claude-sonnet-5',
  'gemini-3.1-pro',
  'claude-opus-5',
  'claude-fable-5.1',
  'gpt-6-astra',
];

const VENDOR = 'anchortrails';

function normalizeSlugs(slugs) {
  const src = Array.isArray(slugs) && slugs.length ? slugs : FALLBACK_SLUGS;
  return src.map(String).filter(Boolean);
}

function listModelInfo(slugs) {
  return normalizeSlugs(slugs).map((id, i) => ({
    id,
    name: id,
    family: VENDOR,
    version: '1',
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    isDefault: i === 0,
    isUserSelectable: true,
    capabilities: { toolCalling: true, imageInput: true },
  }));
}

module.exports = {
  ASSIGN_SLUGS: FALLBACK_SLUGS,
  FALLBACK_SLUGS,
  VENDOR,
  normalizeSlugs,
  listModelInfo,
};
