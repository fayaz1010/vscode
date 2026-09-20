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

// THE RUN, BY TASK. run.json is what the runner leaves beside the map after a real
// run: one row per task. Folded to id -> outcome so a finding row and a task card can
// each say what happened to the task without a second fetch.
const RUN_MARK = {
  closed: ['✓', 'closed'],
  closed_unreviewed: ['✓', 'closed, not reviewed'],
  already_closed: ['✓', 'already closed'],
  failed: ['✗', 'failed'],
  skipped_dirty: ['⊘', 'skipped: uncommitted changes'],
  blocked: ['⊘', 'blocked'],
  would_run: ['·', 'would run'],
};

function runIndex(run) {
  const index = {};
  for (const r of (run && Array.isArray(run.results) ? run.results : [])) {
    if (r && r.task) index[r.task] = r;
  }
  return index;
}

function runMark(row) {
  const [mark, label] = RUN_MARK[(row && row.outcome) || ''] || ['', ''];
  return { mark, label, why: (row && (row.why || (row.review && row.review.why))) || '' };
}

function runSummary(run) {
  if (!run || !Array.isArray(run.results) || run.dry_run) return '';
  const n = (o) => run.results.filter((r) => r.outcome === o).length;
  const closed = n('closed') + n('closed_unreviewed') + n('already_closed');
  const failed = n('failed');
  const parts = [`run: ${closed} closed`];
  if (failed) parts.push(`${failed} failed`);
  if (run.cost_usd != null) parts.push(`$${Number(run.cost_usd).toFixed(2)}`);
  return parts.join(' · ');
}

// THE BUTTONS. Each puts a sentence into @at and sends it; the chat does the work.
// Shared by the Map and Dashboard tabs so both offer the same three moves.
function mapActions(map, esc) {
  const escape = typeof esc === 'function' ? esc : (v) => String(v ?? '');
  const running = Boolean(map && map.running);
  const mapping = Boolean(map && map.mapping);
  const planning = Boolean(map && map.planning);
  const cur = (map && map.currency) || {};
  const objective = map && map.objective ? String(map.objective) : '';
  const remap = map && map.can_refresh
    ? `<button data-cmd="chat" data-id="${cur.state === 'current' ? '/map force' : '/map'}" class="refresh remap${mapping ? ' running' : ''}"${mapping ? ' disabled' : ''}>${mapping ? 'Mapping…' : (cur.state === 'stale' ? 'Re-map (stale)' : cur.state === 'none' ? 'Map this folder' : 'Re-map')}</button>`
    : '';
  // Plan asks for the objective when there is none: the button leaves "/map plan " in
  // the chat box as a draft, and the sentence that follows is the person's.
  const planBtn = map && map.can_plan
    ? (objective
      ? `<button data-cmd="chat" data-id="/map plan" class="refresh planbtn${planning ? ' running' : ''}"${planning ? ' disabled' : ''}>${planning ? 'Planning…' : (map.plan ? 'Re-plan' : 'Plan')}</button>`
      : '<button data-cmd="chat" data-id="/map plan " data-draft="1" class="refresh planbtn">Plan… (needs an objective)</button>')
    : '';
  const runBtn = map && map.can_apply
    ? `<button data-cmd="chat" data-id="${running ? '/run status' : '/run'}" class="refresh runplan${running ? ' running' : ''}">${running ? 'Running… (status)' : 'Run plan'}</button>`
    : '';
  const actions = remap || planBtn || runBtn ? `<div class="mactions">${remap}${planBtn}${runBtn}</div>` : '';
  return actions;
}

// THE UNREAD PART OF THE REPOSITORY. Grey zones grouped under their top-level
// directory, collapsed: one line says how much is unread, the tree opens on demand.
// A queued zone is one the current focus will colour in -- said so, so the grey is
// legible as "not yet" rather than "never".
function greyZonesHtml(grey, escape, opts = {}) {
  if (!grey || !grey.length) return '';
  const files = grey.reduce((n, z) => n + Number(z.files || 0), 0);
  const queued = grey.filter((z) => z.queued);
  const groups = {};
  for (const z of grey) {
    const top = String(z.zone || '').split('/')[0] || '<root>';
    (groups[top] = groups[top] || []).push(z);
  }
  const groupHtml = Object.entries(groups)
    .sort((a, b) => b[1].reduce((n, z) => n + (z.files || 0), 0) - a[1].reduce((n, z) => n + (z.files || 0), 0))
    .map(([top, zs]) => {
      const n = zs.reduce((m, z) => m + Number(z.files || 0), 0);
      const rows = zs.slice(0, 40).map((z) => `<div class="mgrey${z.queued ? ' queued' : ''}"><span class="mdot"></span>${escape(z.zone)}<span class="muted"> · ${Number(z.files || 0)}${z.queued ? (opts.mapping ? ' · queued' : ' · in focus, not read') : ''}</span></div>`).join('')
        + (zs.length > 40 ? `<div class="mgrey muted">… ${zs.length - 40} more</div>` : '');
      return `<details class="mgroup"><summary><span class="mdot"></span><b>${escape(top)}</b><span class="muted"> · ${zs.length} zone${zs.length === 1 ? '' : 's'} · ${n.toLocaleString()} files</span></summary>${rows}</details>`;
    }).join('');
  const label = `not analysed yet · ${grey.length} zone${grey.length === 1 ? '' : 's'} · ${files.toLocaleString()} files`
    + (queued.length ? ` · ${queued.length} queued` : '');
  return `<details class="munread"><summary><span class="mdot"></span>${escape(label)}</summary>${groupHtml}</details>`;
}

function mapHtml(map, esc) {
  const escape = typeof esc === 'function' ? esc : (v) => String(v ?? '');
  const running = Boolean(map && map.running);
  const mapping = Boolean(map && map.mapping);
  const planning = Boolean(map && map.planning);
  const cur = (map && map.currency) || {};
  const objective = map && map.objective ? String(map.objective) : '';
  const actions = mapActions(map, escape);
  // The folder, the map's currency, and the objective: what the map is of, whether it
  // still describes the tree, and what the plan is for. Said in one line each.
  const where = (map && map.project && map.project.root) || (map && map.repo) || '';
  const currencyLine = cur.state === 'stale'
    ? `<p class="muted mstale">map from ${escape(String(cur.map_head || '').slice(0, 8))} · tree at ${escape(String(cur.tree_head || '').slice(0, 8))} — stale; Re-map, or /run re-maps first</p>`
    : cur.state === 'current'
      ? `<p class="muted">map current at ${escape(String(cur.tree_head || '').slice(0, 8))}</p>`
      : '';
  const objectiveLine = map && map.can_plan
    ? (objective
      ? `<p class="muted mobjective">objective: ${escape(objective)}</p>`
      : '<p class="muted mobjective">no objective yet — the plan comes from one: Plan…, or <code>/map plan &lt;objective&gt;</code> in @at</p>')
    : '';
  if (map && map.loading) {
    return '<section class="map"><h3>Map</h3><p class="muted">Asking the AT node for the map of this folder…</p></section>';
  }
  if (!map || !map.ok || !map.overview) {
    const why = (map && map.reason) || 'No map for this folder yet. Run repo-dash, or point ~/.anchortrails/map.json at its out/.';
    return `<section class="map"><h3>Map</h3><p class="muted">${escape(why)}</p>${actions}</section>`;
  }
  const meta = map.overview.meta || {};
  // THREE KINDS OF ZONE. Analysed with findings: coloured by the worst one. Analysed
  // and clean: green -- "nothing we can see", said once per zone. Not analysed:
  // grey, the shell's structure, grouped so 300 of them read as a tree, not a wall.
  // A map from before the flag existed has no `analysed` field: everything on it was.
  const all = map.overview.zones || [];
  const analysed = all.filter((z) => z.analysed !== false);
  const grey = all.filter((z) => z.analysed === false);
  const zones = analysed
    .filter((z) => (z.findings_total || 0) > 0)
    .sort((a, b) => (b.colour || 0) - (a.colour || 0));
  const clean = analysed.filter((z) => !(z.findings_total || 0));
  const index = taskIndex(map.plan);
  const taskFor = (f) => index[`${f.marker}|${f.path}|${f.symbol}`] || index[`${f.marker}|${f.path}|`] || '';
  const runs = runIndex(map.run);
  const colour = (s) => (s >= 0.7 ? '#e2533f' : s >= 0.5 ? '#c2811f' : s >= 0.3 ? '#8a7b28' : '#6b7484');
  // A zone's `top` rows say `line`; a zone file's findings say `line_start`. Both are
  // the same number under two names, and a link to line 1 is a link to nowhere.
  const lineOf = (f) => Number(f.line_start || f.line || 1);
  // The task link carries the run's verdict on it: ✓ closed, ✗ failed, ⊘ skipped.
  // A finding whose task closed is on its way out of the map; until the re-map lands
  // the mark is how the row says so.
  const taskLink = (t) => {
    const st = runMark(runs[t]);
    const cls = st.mark ? ` m-${(runs[t] && runs[t].outcome) || ''}` : '';
    const title = st.label ? ` title="${escape(st.label + (st.why ? ': ' + st.why : ''))}"` : '';
    return `<a href="#" data-cmd="show-task" data-task="${escape(t)}" class="mtask${cls}"${title}>${st.mark ? escape(st.mark) + ' ' : '→ '}${escape(String(t).replace(/^t\./, ''))}</a>`;
  };
  const finding = (f) => {
    const t = taskFor(f);
    return `<div class="mrow">
      <span class="msev" style="color:${colour(f.severity)}">${Number(f.severity || 0).toFixed(2)}</span>
      <span class="mmark">${escape(f.marker)}</span>
      <span class="msym">${escape(f.symbol)}</span>
      <a href="#" data-cmd="open-code" data-id="${escape(f.path)}#${lineOf(f)}" class="mcode">${escape(f.path)}:${lineOf(f)} ↗</a>
      ${t ? taskLink(t) : ''}
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
  // While run.sh is re-mapping it emits a partial after every stage; say which. A
  // shell is structure only: not building, not complete -- waiting to be aimed.
  const shellOnly = meta.status === 'shell';
  const building = !shellOnly && meta.status !== 'complete';
  const stage = shellOnly
    ? 'structure only — nothing analysed yet'
    : building && meta.stages_total
      ? `mapping ${Number(meta.stages_done || 0)}/${Number(meta.stages_total)}${meta.stage ? ' · ' + meta.stage : ''}`
      : (meta.status === 'complete' ? 'complete' : (meta.status || 'building'));
  const read = meta.files_total_repo != null
    ? `${Number(meta.files_analysed || 0).toLocaleString()} of ${Number(meta.files_total_repo).toLocaleString()} files read`
    : '';
  const summary = runSummary(map.run) + (running ? (runSummary(map.run) ? ' · ' : '') + 'run in progress' : '')
    + (planning ? (runSummary(map.run) || running ? ' · ' : '') + 'planning…' : '');
  // One line, joined with the separator: a multi-line template put newlines between
  // the pieces, which is invisible in a browser and wrong everywhere else.
  const head = `<p class="muted">${[
    escape(String(meta.repo || '').split(/[\\/]/).slice(-2).join('/')),
    `${Number(meta.findings_actionable || 0)} actionable of ${Number(meta.findings_total || 0)}`,
    planned ? `${planned} planned task${planned === 1 ? '' : 's'}` : 'no plan yet',
    escape(stage),
  ].concat(read ? [escape(read)] : []).concat(summary ? [escape(summary)] : []).join(' · ')}</p>`;
  const cleanRows = clean.map((z) => `<div class="mclean"><span class="mdot" style="background:#3fb950"></span><b>${escape(z.zone)}</b><span class="muted"> · ${Number(z.files || 0)} files · nothing found</span></div>`).join('');
  const greyBlock = greyZonesHtml(grey, escape, { mapping: mapping || building });
  const body = zones.length || cleanRows || greyBlock
    ? zones.map(zoneBlock).join('') + cleanRows + greyBlock
    : '<p class="muted">Nothing flagged. A green map means "nothing we can see", never "healthy".</p>';
  return `<section class="map${building ? ' building' : ''}${running ? ' running' : ''}${shellOnly ? ' shell' : ''}"><h3>Map</h3>${head}${currencyLine}${objectiveLine}${actions}${body}</section>`;
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
  .map .mtask.m-closed, .map .mtask.m-closed_unreviewed, .map .mtask.m-already_closed { background:#2d6a5a66; color:#9ff0cf; }
  .map .mtask.m-failed { background:#6a2d2d66; color:#f0a09f; }
  .map .mtask.m-skipped_dirty, .map .mtask.m-blocked { background:#55555566; color:#cfcfcf; }
  .map.building > h3::after { content:" · mapping…"; font-weight:400; opacity:.6; }
  .map .mactions { display:flex; gap:6px; flex-wrap:wrap; } .map .remap, .map .runplan, .map .planbtn { margin:0 0 6px; }
  .map .runplan.running, .map .remap.running, .map .planbtn.running { opacity:.7; }
  .map .mstale { color:#e0b04f; } .map .mobjective code { font-size:11px; }
  .map .mzone { margin:6px 0; } .map summary { cursor:pointer; }
  .map .mdot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; background:#4a5160; }
  .map .mclean { padding:4px 0; border-top:1px solid var(--vscode-widget-border,#333); font-size:11.5px; }
  .map .munread { margin:6px 0; opacity:.85; } .map .munread > summary { font-size:11.5px; }
  .map .mgroup { margin:2px 0 2px 14px; font-size:11.5px; }
  .map .mgrey { padding:2px 0 2px 24px; font-size:11px; opacity:.75; }
  .map .mgrey.queued { opacity:1; } .map .mgrey.queued .mdot { background:#c2811f; }
  .map.shell > h3::after { content:" · structure only"; font-weight:400; opacity:.6; }
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
  
  // Properly implement EventEmitter functionality instead of stubbing
  class SimpleEventEmitter {
    constructor() {
      this.listeners = [];
    }
    
    event(listener) {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index !== -1) {
            this.listeners.splice(index, 1);
          }
        }
      };
    }
    
    fire(data) {
      // Call all registered listeners
      this.listeners.forEach(listener => {
        if (typeof listener === 'function') {
          try {
            listener(data);
          } catch (err) {
            console.error('Error in event listener:', err);
          }
        }
      });
    }
    
    dispose() {
      // Clear all listeners
      this.listeners = [];
    }
  }

  const emitter = vscode.window && vscode.EventEmitter
    ? new vscode.EventEmitter()
    : new SimpleEventEmitter();

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
    : { 
        dispose() { 
          /* No tree view to dispose in non-VSCode environment */ 
        } 
      };

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
  runIndex,
  runMark,
  runSummary,
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
  mapActions,
  greyZonesHtml,
  taskIndex,
  MAP_CSS,
  stackLines,
  rowsFromPlan,
  startPlan,
};
