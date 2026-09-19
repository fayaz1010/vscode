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

/**
 * The code map, beside the stack: what the map found, each finding linked to the
 * task that closes it and the file it lives in.
 *
 * `map` is the bridge's /api/map envelope: { overview, plan, repo }. The task join
 * reads the acceptance sentence -- "reports no `<marker>` for `<symbol>` in `<path>`"
 * -- the same sentence acceptance.py reads back, so the plan needs no extra field.
 * Links are `data-cmd` elements: the shell's generic handler already forwards
 * `id` and `task`, so the webview script does not change at all.
 *
 * Absent is a state, not an error. A folder with no map yet says so in one line.
 */
const CHECK_RX = /reports no `([^`]+)` for `([^`]+)`(?: in `([^`]+)`)?/;

function taskIndex(atPlan) {
  const index = {};
  for (const t of (atPlan && atPlan.tasks) || []) {
    for (const a of t.acceptance || []) {
      const m = CHECK_RX.exec(a.check || '');
      if (!m) continue;
      index[m[3] ? `${m[1]}|${m[3]}|${m[2]}` : `${m[1]}|${m[2]}|`] = t.id;
    }
  }
  return index;
}

function mapHtml(map, esc) {
  const escape = typeof esc === 'function' ? esc : (v) => String(v ?? '');
  if (!map || !map.ok || !map.overview) {
    const why = (map && map.reason) || 'No map for this folder yet. Run repo-dash, or point ~/.anchortrails/map.json at its out/.';
    return `<section class="map"><h3>Map</h3><p class="muted">${escape(why)}</p></section>`;
  }
  const meta = map.overview.meta || {};
  const zones = [...(map.overview.zones || [])]
    .filter((z) => (z.findings_total || 0) > 0)
    .sort((a, b) => (b.colour || 0) - (a.colour || 0));
  const index = taskIndex(map.plan);
  const taskFor = (f) => index[`${f.marker}|${f.path}|${f.symbol}`] || index[`${f.marker}|${f.path}|`] || '';
  const colour = (s) => (s >= 0.7 ? '#e2533f' : s >= 0.5 ? '#c2811f' : s >= 0.3 ? '#8a7b28' : '#6b7484');
  const finding = (f) => {
    const t = taskFor(f);
    return `<div class="mrow">
      <span class="msev" style="color:${colour(f.severity)}">${Number(f.severity || 0).toFixed(2)}</span>
      <span class="mmark">${escape(f.marker)}</span>
      <span class="msym">${escape(f.symbol)}</span>
      <a href="#" data-cmd="open-code" data-id="${escape(f.path)}#${Number(f.line_start || 1)}" class="mcode">${escape(f.path)}:${Number(f.line_start || 1)} ↗</a>
      ${t ? `<a href="#" data-cmd="show-task" data-task="${escape(t)}" class="mtask">→ ${escape(String(t).replace(/^t\./, ''))}</a>` : ''}
    </div>`;
  };
  const zoneBlock = (z) => {
    const top = (z.top || []).filter((f) => (f.severity || 0) >= 0.3).slice(0, 12);
    return `<details class="mzone"${(z.colour || 0) >= 0.6 ? ' open' : ''}>
      <summary><span class="mdot" style="background:${colour(z.colour || 0)}"></span><b>${escape(z.zone)}</b>
        <span class="muted"> · ${Number(z.findings_total || 0)} finding${z.findings_total === 1 ? '' : 's'} · ${Number(z.files || 0)} files</span></summary>
      ${top.map(finding).join('') || '<p class="muted">nothing at or above 0.30</p>'}
    </details>`;
  };
  const planned = map.plan && Array.isArray(map.plan.tasks) ? map.plan.tasks.length : 0;
  // One line, joined with the separator: a multi-line template put newlines between
  // the pieces, which is invisible in a browser and wrong everywhere else.
  const head = `<p class="muted">${[
    escape(String(meta.repo || '').split(/[\\/]/).slice(-2).join('/')),
    `${Number(meta.findings_actionable || 0)} actionable of ${Number(meta.findings_total || 0)}`,
    planned ? `${planned} planned task${planned === 1 ? '' : 's'}` : 'no plan yet',
    escape(meta.status === 'complete' ? 'complete' : (meta.status || 'building')),
  ].join(' · ')}</p>`;
  const body = zones.length
    ? zones.map(zoneBlock).join('')
    : '<p class="muted">Nothing flagged. A green map means "nothing we can see", never "healthy".</p>';
  return `<section class="map"><h3>Map</h3>${head}${body}</section>`;
}

const MAP_CSS = `
  .map .mrow { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; padding:4px 0;
    border-top:1px solid var(--vscode-widget-border,#333); font-size:11.5px; }
  .map .msev { font-weight:600; min-width:2.6em; }
  .map .mmark { opacity:.65; }
  .map .msym { font-weight:600; }
  .map .mcode { opacity:.75; text-decoration:none; color:inherit; }
  .map .mcode:hover { opacity:1; text-decoration:underline; }
  .map .mtask { padding:1px 7px; border-radius:9px; background:#2d6a5a33; color:#7fd3b9; text-decoration:none; }
  .map .mzone { margin:6px 0; } .map summary { cursor:pointer; }
  .map .mdot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; }
`;

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
  mapHtml,
  taskIndex,
  MAP_CSS,
  stackLines,
  rowsFromPlan,
  startPlan,
};
