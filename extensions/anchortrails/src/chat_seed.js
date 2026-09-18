'use strict';
/**
 * Double-click on the AT panel → a chat seed with the right context.
 * Plan / step / Clustry task: send implement now.
 * Node: pin hop; next work goes to that node's AT Dest.
 * Tools / teams / models / vault / workspace: draft so the user can send.
 */

function currentStepLabel(steps) {
  const parts = String(steps || '').split(' | ').map((s) => s.trim()).filter(Boolean);
  return parts.find((s) => s.includes('[>]'))
    || parts.find((s) => !s.includes('[x]'))
    || '';
}

function seedFrom(input) {
  const kind = String((input && input.kind) || '');
  const label = String((input && input.label) || '').trim();
  const goal = String((input && input.goal) || '').trim();
  const cursor = String((input && input.cursor) || '').trim();
  const steps = String((input && input.steps) || '');
  const playbook = String((input && input.playbook) || 'task');
  const workspace = String((input && (input.workspace || input.workspace_id)) || '').trim();
  const extra = String((input && (input.description || input.caps || input.role)) || '').trim();
  const hint = String((input && input.hint) || '').trim();
  const id = String((input && input.id) || '').trim();
  const mark = String((input && input.mark) || '').trim();

  if (kind === 'empty' || kind === 'head' || (!label && !goal && kind !== 'plan')) {
    return null;
  }
  if (kind === 'plan' || kind === 'live') {
    const step = currentStepLabel(steps);
    return {
      kind: 'plan',
      send: true,
      hop: null,
      surface: null,
      prompt: (
        `implement this plan until the objective is met and verified. `
        + `Goal: ${goal || label}. `
        + (cursor ? `Cursor ${cursor}. ` : '')
        + `Playbook ${playbook}. `
        + `Do only the current step: ${step || 'the [>] step'}.`
      ),
    };
  }
  if (kind === 'step') {
    return {
      kind: 'step',
      send: true,
      hop: null,
      surface: null,
      prompt: (
        `implement this plan step: ${label}. `
        + (goal ? `Goal: ${goal}. ` : '')
        + (mark ? `Mark was ${mark}. ` : '')
        + 'Verify before greening.'
      ),
    };
  }
  if (kind === 'history') {
    return {
      kind: 'history',
      send: false,
      hop: null,
      surface: null,
      prompt: (
        `continue this other plan — not the live card. `
        + `Goal: ${goal || label}. `
        + (workspace ? `Workspace ${workspace}. ` : '')
        + (cursor ? `Cursor ${cursor}.` : '')
      ).trim(),
    };
  }
  if (kind === 'task') {
    return {
      kind: 'task',
      send: true,
      hop: null,
      surface: null,
      prompt: `implement this Clustry task: ${label}${extra ? ` (${extra})` : ''}.`,
    };
  }
  if (kind === 'node') {
    return {
      kind: 'node',
      send: false,
      hop: label,
      surface: null,
      prompt: (
        `Hop to ${label}'s AT Dest. Next work runs there via personal_flow / `
        + `personal_hands_invoke — that node looks and reports. `
        + `Caps: ${extra || 'unknown'}. Do not hop one click at a time.`
      ),
    };
  }
  if (kind === 'member') {
    return {
      kind: 'member',
      send: false,
      hop: null,
      surface: null,
      prompt: (
        `Work with Clustry member ${label}${extra ? ` (${extra})` : ''}. `
        + 'Assign or inbox via personal_clustry_assign. '
        + 'People stay Clustry; nodes stay mesh hops; models stay assign().'
      ),
    };
  }
  if (kind === 'tool' || kind === 'surface') {
    return {
      kind: 'tool',
      send: false,
      hop: null,
      surface: id || label,
      prompt: (
        `Use the ${label} tool pack${id ? ` (${id})` : ''}. `
        + (hint ? `${hint} ` : '')
        + 'assign() still picks the model. Chat stays the work surface.'
      ),
    };
  }
  if (kind === 'model') {
    return {
      kind: 'model',
      send: false,
      hop: null,
      surface: null,
      prompt: (
        `Use dest assign slug ${label} for this next turn`
        + (extra ? ` · ${extra}` : '')
        + '. Keys stay on the node. Do not print a key.'
      ),
    };
  }
  if (kind === 'vault' || kind === 'setting' || kind === 'recipient') {
    if (/skill|action/i.test(label)) {
      return {
        kind: 'setting',
        send: false,
        hop: null,
        surface: null,
        prompt: (
          `Replay saved ${label.toLowerCase()} first (browser_skill_replay / personal_autoflow_match)`
          + (extra ? ` — ${extra}` : '')
          + '. Do not remap a known flow.'
        ),
      };
    }
    return {
      kind: 'vault',
      send: false,
      hop: null,
      surface: null,
      prompt: (
        `Check vault ${label} with desktop_vault_status. `
        + (extra ? `${extra}. ` : '')
        + 'Never print the value. Never call desktop_vault_get.'
      ),
    };
  }
  if (kind === 'workspace') {
    return {
      kind: 'workspace',
      send: false,
      hop: null,
      surface: null,
      prompt: (
        `Work in workspace ${label}`
        + (extra ? ` at ${extra}` : '')
        + '. Bind this folder if dest is on another path.'
      ),
    };
  }
  return {
    kind: kind || 'item',
    send: false,
    hop: null,
    surface: null,
    prompt: `Do this AT item: ${label}${extra ? ` · ${extra}` : ''}.`,
  };
}

module.exports = { currentStepLabel, seedFrom };
