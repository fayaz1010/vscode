'use strict';
/**
 * Dest chat tags — /plan asks about the card; /plan refresh rescores
 * done vs planned against the final objective. Not a full MUWT replay.
 */

const REFRESH_LINE = /^(refresh|\/refresh|refresh the plan|update the plan|rescore(?: the plan)?)$/i;

function planTag(request) {
  const cmd = String((request && request.command && request.command.name) || '')
    .toLowerCase();
  const raw = String((request && request.prompt) || '');
  if (
    cmd === 'refresh'
    || /^\/plan\s+refresh\b/i.test(raw)
    || REFRESH_LINE.test(raw.trim())
    || (cmd === 'plan' && /^\s*refresh\b/i.test(raw))
  ) {
    const rest = raw
      .replace(/^\/plan\s+refresh\b/i, '')
      .replace(/^\s*(refresh|update|rescore)(\s+the\s+plan)?\b/i, '')
      .trim();
    return { kind: 'refresh', rest };
  }
  if (cmd === 'plan' || /^\/plan\b/i.test(raw)) {
    return { kind: 'ask', rest: raw.replace(/^\/plan\b/i, '').trim() };
  }
  return null;
}

function planMarkdown(plan) {
  const { stackLines } = require('./plan');
  const stack = stackLines((plan && plan.stack) || {});
  if (!plan || !(plan.goal || plan.cursor || plan.steps)) {
    return `No plan yet. A real task in @at starts one.\n\n**Stack**\n${stack}`;
  }
  const steps = String(plan.steps || '')
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n');
  const head = `**Plan ${plan.cursor || ''}** — ${plan.playbook || 'task'}`;
  const doLine = plan.do ? `\n\n_${plan.do}_` : '';
  return `${head}\n\n${plan.goal || ''}\n\n${steps}${doLine}\n\n**Stack**\n${stack}`.trim();
}

module.exports = { planTag, planMarkdown, REFRESH_LINE };
