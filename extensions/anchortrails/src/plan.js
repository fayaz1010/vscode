'use strict';
/**
 * Dest Plan panel — Layer M card, not a second editor.
 * GET /api/agent/plan; refresh after each prepare.
 */

const { sessionId } = require('./workspace');

const VIEW_ID = 'anchortrails.plan';

function markOf(step) {
  const text = String(step || '');
  if (/\[!\]|\[e\]|\[err\]|\[fail\]/i.test(text)) return 'error';
  if (text.includes('[>]')) return 'now';
  if (text.includes('[x]')) return 'done';
  return 'todo';
}

function stampMark(step, token) {
  const text = String(step || '');
  if (/\[(?:x|>| |!|e|err|fail)\]/i.test(text)) {
    return text.replace(/\[(?:x|>| |!|e|err|fail)\]/i, token);
  }
  return `${text} ${token}`.trim();
}

function currentStepIndex(steps, cursor) {
  const parts = String(steps || '').split(' | ').map((s) => s.trim()).filter(Boolean);
  const now = parts.findIndex((s) => markOf(s) === 'now');
  if (now >= 0) return now;
  const n = parseInt(String(cursor || '').split('/')[0], 10);
  if (n > 0 && n <= parts.length) return n - 1;
  return -1;
}

/** Failed checkErrors cannot stay green. Clean checks do not auto-green. */
function gateSteps(steps, check, cursor) {
  if (!check || (check.ok === true && Number(check.errors || 0) === 0)) {
    return steps;
  }
  const parts = String(steps || '').split(' | ').map((s) => s.trim()).filter(Boolean);
  const i = currentStepIndex(steps, cursor);
  if (i < 0 || !parts[i]) return steps;
  const mark = markOf(parts[i]);
  if (mark !== 'now' && mark !== 'done') return steps;
  parts[i] = stampMark(parts[i], '[!]');
  return parts.join(' | ');
}

function gatePlan(plan, check) {
  if (!plan) return plan;
  const steps = gateSteps(plan.steps, check, plan.cursor);
  if (steps === plan.steps) return plan;
  return { ...plan, steps };
}

function labelOf(step) {
  return String(step || '')
    .replace(/\s*\[(?:x|>| |!|e|err|fail)\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stepBox(mark) {
  if (mark === 'done') return '✓';
  if (mark === 'now') return '●';
  if (mark === 'error') return '!';
  return '';
}

function stepListHtml(steps, esc) {
  const escape = typeof esc === 'function'
    ? esc
    : (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const rows = String(steps || '').split(' | ').map((s) => s.trim()).filter(Boolean).map((s) => {
    const mark = markOf(s);
    return `<li class="step ${mark} seedable" data-kind="step" data-mark="${mark}" data-label="${escape(labelOf(s))}">
      <span class="box" aria-hidden="true">${stepBox(mark)}</span>
      <span class="txt">${escape(labelOf(s))}</span>
    </li>`;
  });
  return rows.length ? `<ul class="steps">${rows.join('')}</ul>` : '';
}

const STEP_CSS = `
  .steps { list-style: none; margin: 8px 0 0; padding: 0; }
  .step { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px;
    border-radius: 6px; margin: 0 0 4px; line-height: 1.35; }
  .step .box { flex: 0 0 16px; width: 16px; height: 16px; margin-top: 1px;
    border-radius: 3px; border: 1.5px solid; display: flex; align-items: center;
    justify-content: center; font-size: 10px; font-weight: 700; }
  .step.todo { color: #e2c08d; }
  .step.todo .box { border-color: #dcb862; background: transparent; }
  .step.now { color: #6cb6ff; font-weight: 600; }
  .step.now .box { border-color: #3794ff; background: #163a66; color: #6cb6ff; }
  .step.done { color: #89d185; }
  .step.done .txt { text-decoration: line-through; }
  .step.done .box { border-color: #3fa266; background: #1d5c2e; color: #89d185; }
  .step.error { color: #f48771; }
  .step.error .box { border-color: #f48771; background: #5a1d1d; color: #f48771; }
  .stack { margin: 10px 0 8px; padding: 8px 0 0;
    border-top: 1px solid var(--vscode-widget-border, #333); }
  .stack h3 { font-size: 11px; margin: 0 0 6px; opacity: .8; }
  .stack .kvs { display: grid; grid-template-columns: 88px 1fr; gap: 3px 8px; }
  .stack .k { opacity: .6; }
  .stack .v { word-break: break-word; }
`;

const STACK_KEYS = [
  ['languages', 'Languages'],
  ['db', 'DBs'],
  ['db_env', 'DB env'],
  ['hosting', 'Hosting'],
  ['domain', 'Domain'],
  ['git', 'Git'],
  ['local', 'Local'],
  ['last_push', 'Last push'],
  ['size', 'Size'],
  ['lines', 'Lines'],
  ['files', 'Files'],
  ['workers', 'Workers'],
  ['ai', 'AI'],
  ['blobs', 'Blobs'],
];

function stackHtml(stack, esc) {
  const escape = typeof esc === 'function'
    ? esc
    : (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const row = stack || {};
  const items = STACK_KEYS.map(([key, label]) => {
    const raw = row[key];
    const shown = raw == null || String(raw).trim() === '' ? '—' : String(raw);
    return `<div class="k">${escape(label)}</div><div class="v">${escape(shown)}</div>`;
  }).join('');
  return `<section class="stack"><h3>Stack</h3><div class="kvs">${items}</div></section>`;
}

function stackLines(stack) {
  const row = stack || {};
  return STACK_KEYS.map(([key, label]) => {
    const raw = row[key];
    const shown = raw == null || String(raw).trim() === '' ? '—' : String(raw);
    return `${label}: ${shown}`;
  }).join('\n');
}

function rowsFromPlan(plan) {
  if (!plan || !(plan.cursor || plan.goal || plan.steps)) {
    return [{
      kind: 'empty',
      label: 'No plan yet',
      description: 'Chat starts one on the first real task',
    }];
  }
  const rows = [{
    kind: 'head',
    label: `${plan.playbook || 'task'} ${plan.cursor || ''}`.trim(),
    description: plan.goal || '',
    tooltip: plan.card || plan.goal || '',
  }];
  for (const part of String(plan.steps || '').split(' | ').map((s) => s.trim()).filter(Boolean)) {
    const mark = markOf(part);
    rows.push({
      kind: 'step',
      mark,
      label: labelOf(part),
      description: mark === 'now' ? 'now' : mark === 'error' ? 'error' : '',
    });
  }
  return rows;
}

function iconFor(row, vscode) {
  const ThemeIcon = vscode && vscode.ThemeIcon;
  if (!ThemeIcon) return undefined;
  if (row.kind === 'head') return new ThemeIcon('checklist');
  if (row.mark === 'now') return new ThemeIcon('arrow-small-right');
  if (row.mark === 'done') return new ThemeIcon('check');
  if (row.mark === 'error') return new ThemeIcon('error');
  if (row.kind === 'empty') return new ThemeIcon('circle-slash');
  return new ThemeIcon('circle-outline');
}

function treeItems(rows, vscode) {
  const TreeItem = vscode && vscode.TreeItem;
  if (!TreeItem) return rows;
  return rows.map((row) => {
    const item = new TreeItem(row.label);
    item.description = row.description || '';
    item.tooltip = row.tooltip || row.description || row.label;
    item.iconPath = iconFor(row, vscode);
    item.contextValue = row.kind;
    return item;
  });
}

function startPlan(client, vscode) {
  let cached = null;
  const emitter = vscode.window
    ? new vscode.EventEmitter()
    : { event: () => {}, fire() {}, dispose() {} };

  const provider = {
    onDidChangeTreeData: emitter.event,
    getTreeItem(el) { return el; },
    async getChildren() {
      if (!cached && client && typeof client.sessionPlan === 'function') {
        try {
          const data = await client.sessionPlan({ session_id: sessionId(vscode) });
          cached = (data && data.plan) || null;
        } catch (err) {
          const item = new vscode.TreeItem('Plan unavailable');
          item.description = (err && err.message) || 'bridge error';
          return [item];
        }
      }
      return treeItems(rowsFromPlan(cached), vscode);
    },
    refresh(plan) {
      cached = plan === undefined ? null : plan;
      if (typeof emitter.fire === 'function') emitter.fire();
    },
  };

  const tree = vscode.window && typeof vscode.window.createTreeView === 'function'
    ? vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider })
    : { dispose() {} };

  const cmds = [];
  if (vscode.commands && typeof vscode.commands.registerCommand === 'function') {
    cmds.push(vscode.commands.registerCommand('anchortrails.plan.refresh', () => {
      provider.refresh();
    }));
    cmds.push(vscode.commands.registerCommand('anchortrails.plan.show', () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }));
  }

  return {
    provider,
    refresh: (plan) => provider.refresh(plan),
    dispose() {
      if (tree && typeof tree.dispose === 'function') tree.dispose();
      for (const c of cmds) {
        if (c && typeof c.dispose === 'function') c.dispose();
      }
      if (typeof emitter.dispose === 'function') emitter.dispose();
    },
  };
}

module.exports = {
  VIEW_ID,
  markOf,
  labelOf,
  stepBox,
  stampMark,
  currentStepIndex,
  gateSteps,
  gatePlan,
  stepListHtml,
  STEP_CSS,
  STACK_KEYS,
  stackHtml,
  stackLines,
  rowsFromPlan,
  startPlan,
};
