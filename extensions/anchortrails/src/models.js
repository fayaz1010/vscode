'use strict';
/**
 * Dest Models tab + Settings task picks.
 * Search OpenRouter (costs only), add to the group, pick a slug per task.
 */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function costLine(row) {
  const p = row && row.prompt_per_m;
  const c = row && row.completion_per_m;
  if (p == null && c == null) return '—';
  const fmt = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
  return `${fmt(p)} / ${fmt(c)} per 1M`;
}

function slugOptions(slugs, selected) {
  return (slugs || []).map((slug) => (
    `<option value="${esc(slug)}"${slug === selected ? ' selected' : ''}>${esc(slug)}</option>`
  )).join('');
}

function modelsHtml(data) {
  const models = (data && data.models) || {};
  const q = models.q || '';
  const hits = models.hits || [];
  const group = models.group || [];
  const err = models.searchError || '';
  const hitRows = hits.map((row) => (
    `<div class="row model seedable" data-kind="model" data-label="${esc(row.id)}" data-description="${esc(costLine(row))}">
      <div class="label">${esc(row.name || row.id)}</div>
      <div class="meta">${esc(row.id)} · ${esc(costLine(row))}</div>
      <button data-cmd="add-model" data-id="${esc(row.id)}">Add to group</button>
    </div>`
  )).join('');
  const groupRows = group.map((row) => (
    `<div class="row ${row.builtin ? 'builtin' : ''} seedable" data-kind="model" data-label="${esc(row.slug)}" data-description="${esc(costLine(row))}">
      <div class="label">${esc(row.slug)}</div>
      <div class="meta">${esc(row.name || row.model || '')} · ${esc(costLine(row))}</div>
    </div>`
  )).join('');
  return `<p class="muted">Search OpenRouter with the admin key. Costs are $ / 1M tokens. Add a hit — or paste provider/model and Add — to the dest group. assign() still picks the turn unless Settings pins a task.</p>
    <p class="search">
      <input data-field="q" value="${esc(q)}" placeholder="Search OpenRouter or paste provider/model…" />
      <button data-cmd="search-models">Search</button>
      <button data-cmd="add-model">Add</button>
    </p>
    ${err ? `<p class="warn">${esc(err)}</p>` : ''}
    ${hitRows || (q ? '<p class="muted">No OpenRouter hits. Paste a provider/model id and Add.</p>' : '')}
    <h3>Group</h3>
    ${groupRows || '<p class="muted">Builtin assign slugs load here.</p>'}`;
}

function taskPicksHtml(data) {
  const models = (data && data.models) || {};
  const tasks = models.tasks || [];
  const slugs = models.slugs || (models.group || []).map((r) => r.slug);
  if (!tasks.length) {
    return '<p class="muted">No task picks yet. Search and add a model to the group first.</p>';
  }
  const rows = tasks.map((row) => (
    `<tr data-task="${esc(row.task)}">
      <td>${esc(row.label || row.task)}</td>
      <td><select data-cmd="set-task" data-task="${esc(row.task)}" data-field="slug">${slugOptions(row.allowed || slugs, row.slug)}</select></td>
      <td><select data-cmd="set-task" data-task="${esc(row.task)}" data-field="fallback">${slugOptions(row.allowed || slugs, row.fallback)}</select></td>
    </tr>`
  )).join('');
  return `<h2>Models for tasks</h2>
    <p class="muted">assign() uses these slugs. Search + add lives on the Models tab.</p>
    <table><thead><tr><th>Task</th><th>Model</th><th>Fallback</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

module.exports = {
  esc,
  costLine,
  modelsHtml,
  taskPicksHtml,
};
