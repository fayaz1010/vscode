'use strict';
/**
 * Same rule as repo-dash pipeline/decide.py.
 * A plan is a list of tasks. A task is a list of steps. An AT action is a
 * list of steps. Score the list that is open. Nothing on it calls a model,
 * and what the model writes is appended to that list.
 */

const THRESHOLD = 0.5;

function sub(item) {
  if (!item || typeof item !== 'object') return null;
  if (Array.isArray(item.steps)) return item.steps;
  if (Array.isArray(item.sequences)) return item.sequences;
  return null;
}

function openList(body, chosen) {
  let items = [];
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === 'object') {
    if (Array.isArray(body.tasks)) items = body.tasks;
    else {
      const inner = sub(body);
      if (inner) items = inner;
    }
  }
  if (!chosen) return items.slice();
  for (const item of items) {
    if (item && item.id === chosen) {
      const inner = sub(item);
      return inner ? inner.slice() : [];
    }
  }
  return [];
}

function route(options, scores, threshold = THRESHOLD) {
  const valid = (options || []).filter((o) => o && o.id).map((o) => o.id);
  const ranked = valid
    .filter((id) => Number(scores && scores[id] || 0) >= threshold)
    .sort((a, b) => Number(scores[b] || 0) - Number(scores[a] || 0));
  return {
    run: ranked,
    call_model: ranked.length === 0,
    open: ranked.length ? openList(options, ranked[0]) : [],
  };
}

function stored(action) {
  const item = { id: action.id };
  const inner = sub(action);
  if (inner) {
    item.steps = inner.filter((step) => step && typeof step === 'object').map((step) => ({ ...step }));
    return item;
  }
  item.text = action.text || action.do || '';
  return item;
}

function taskBrief(task, asked) {
  const steps = (sub(task) || []).map((step, i) => {
    const line = (step && (step.text || step.do || step.id)) || '';
    const id = (step && step.id) || String(i + 1);
    return `${i + 1}. ${id} — ${line}`;
  });
  const scope = scopeOf(task);
  return [
    'ONE TASK. This is your part of it. Do not invent a second plan.',
    task && task.id,
    ...steps,
    `files you may change: ${scope.length ? scope.join(', ') : 'none'}`,
    asked ? `asked: ${asked}` : '',
  ].filter(Boolean).join('\n');
}

function scopeOf(task) {
  const named = task && task.execution && task.execution.write_scope;
  if (Array.isArray(named)) return named.filter((p) => typeof p === 'string' && p);
  if (Array.isArray(task && task.write_scope)) {
    return task.write_scope.filter((p) => typeof p === 'string' && p);
  }
  return [];
}

const REFUSED_FLAGS = new Set([
  '--dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--yolo',
]);

function cleanFlags(flags) {
  const out = [];
  for (const raw of flags || []) {
    const token = String(raw == null ? '' : raw).trim();
    if (!token || REFUSED_FLAGS.has(token.split('=')[0])) continue;
    if (/[\n;&|`]/.test(token)) continue;
    out.push(token);
  }
  return out;
}

function flagsOf(task) {
  const raw = [...((task && task.flags) || [])];
  for (const step of sub(task) || []) raw.push(...((step && step.flags) || []));
  return cleanFlags(raw);
}

function cliForModel(model) {
  const name = String(model || '').toLowerCase();
  if (!name) return '';
  if (name.includes('grok')) return 'cursor';
  if (name.includes('claude') || name.includes('sonnet') || name.includes('opus') || name.includes('haiku')) {
    return 'claude';
  }
  if (name.includes('gpt') || name.includes('codex')) return 'codex';
  return '';
}

function modelOf(flags) {
  const list = flags || [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '--model' && list[i + 1]) return list[i + 1];
    if (String(list[i]).startsWith('--model=')) return String(list[i]).slice('--model='.length);
  }
  return '';
}

function cliAgent(task) {
  const byModel = cliForModel(modelOf(flagsOf(task)));
  if (byModel) return byModel;
  const named = [];
  for (const step of sub(task) || []) {
    const tools = step && Array.isArray(step.tools) ? step.tools : [];
    for (const tool of tools) {
      if ((tool === 'claude' || tool === 'cursor' || tool === 'codex') && !named.includes(tool)) {
        named.push(tool);
      }
    }
  }
  return named.length === 1 ? named[0] : 'auto';
}

function cliAssign(task, asked) {
  return {
    agent: cliAgent(task),
    flags: flagsOf(task),
    scope: scopeOf(task),
    task: taskBrief(task, asked),
  };
}

function fromCli(out, taskText) {
  if (!out || typeof out !== 'object') return null;
  if (out.missing || Array.isArray(out.tried)) return null;
  if (!out.agent) return null;
  const wrote = String(out.stdout || '').trim();
  const task = String(taskText || '').trim();
  return {
    id: `${out.agent}:${(wrote || task).slice(0, 40)}`,
    text: wrote || task,
    tools: [out.agent],
  };
}

function taskFromCli(out, taskText) {
  const step = fromCli(out, taskText);
  if (!step) return null;
  return { id: `t.${step.id}`, steps: [step] };
}

const patches = new Map();

function resetPatches() {
  patches.clear();
}

function note(sessionId, action, under) {
  const key = sessionId || '';
  const list = patches.get(key) || [];
  list.push({ action, under: under || null });
  patches.set(key, list);
  return list;
}

function applyPatches(sessionId, tasks) {
  let out = tasks || [];
  for (const patch of patches.get(sessionId || '') || []) {
    out = patch.under ? grow(out, patch.action, patch.under) : grow(out, patch.action);
  }
  return out;
}

function grow(options, action, under) {
  const items = (options || []).map((o) => (o && typeof o === 'object' ? { ...o } : o));
  if (!action || !action.id) return items;
  if (under) {
    return items.map((item) => {
      if (!item || item.id !== under) return item;
      const current = sub(item) || [];
      return { ...item, steps: grow(current, action) };
    });
  }
  if (items.some((o) => o && o.id === action.id)) return items;
  return [...items, stored(action)];
}

module.exports = {
  THRESHOLD, openList, route, grow, fromCli, taskFromCli, taskBrief, cliAgent, cliAssign, flagsOf, scopeOf,
  note, applyPatches, resetPatches,
};
