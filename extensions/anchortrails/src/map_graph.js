'use strict';
/**
 * The graphical map: zones as nodes, cross-zone call/import edges between them.
 * The same picture repo-dash's own page draws, redrawn here as static SVG so the
 * webview needs no library and no network: the layout is computed on paint.
 *
 * Deterministic on purpose. A seeded ring, then a short relax, so a repository is
 * the same place every time it is opened; zones with no cross-zone edges sit on an
 * outer ring rather than being shoved about by forces they take no part in.
 *
 * Colour is the honesty rule: grey for a zone nothing has read, green for one read
 * with nothing found, then the severity ramp of the worst finding. Size is how much
 * is flagged there, with a little for how many files it holds.
 */

const GREY = '#4a5160';
const GREEN = '#2f6b3a';

function ramp(z) {
  if (z.analysed === false) return GREY;
  if (!(z.findings_total || 0)) return GREEN;
  const s = Number(z.colour || 0);
  return s >= 0.7 ? '#e2533f' : s >= 0.5 ? '#c2811f' : s >= 0.3 ? '#8a7b28' : '#6b7484';
}

function radius(z) {
  const flagged = Number(z.size || 0);
  return 3.2 + Math.sqrt(flagged) * 3.4 + Math.log10(1 + Number(z.files || 0)) * 1.1;
}

// Positions in an abstract unit space; scaled into the viewBox by graphSvg.
function layoutZones(overview, iters = 420) {
  const zones = (overview && overview.zones) || [];
  const edgesIn = (overview && overview.zone_edges) || [];
  const idx = {};
  zones.forEach((z, i) => { idx[z.zone] = i; });
  const edges = [];
  const seen = new Set();
  for (const e of edgesIn) {
    const a = idx[e.a]; const b = idx[e.b];
    if (a == null || b == null || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b, Number(e.w || 1)]);
  }
  const degree = new Array(zones.length).fill(0);
  for (const [a, b] of edges) { degree[a] += 1; degree[b] += 1; }
  const core = zones.map((_, i) => i).filter((i) => degree[i] > 0);
  const iso = zones.map((_, i) => i).filter((i) => degree[i] === 0);
  const pos = new Array(zones.length);
  core.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, core.length);
    const r = 1 + 0.3 * ((i * 7) % 5);
    pos[n] = { x: Math.cos(a) * r, y: Math.sin(a) * r, dx: 0, dy: 0 };
  });
  const maxW = Math.max(1, ...edges.map((e) => e[2]));
  for (let it = 0; it < iters; it += 1) {
    const k = 1 - it / iters;
    for (const a of core) {
      for (const b of core) {
        if (a === b) continue;
        const dx = pos[a].x - pos[b].x; const dy = pos[a].y - pos[b].y;
        const d2 = dx * dx + dy * dy + 0.02; const f = 0.11 / d2;
        pos[a].dx += dx * f; pos[a].dy += dy * f;
      }
    }
    for (const [a, b, w] of edges) {
      const s2 = 0.018 * (0.3 + w / maxW);
      const dx = pos[a].x - pos[b].x; const dy = pos[a].y - pos[b].y;
      pos[a].dx -= dx * s2; pos[a].dy -= dy * s2;
      pos[b].dx += dx * s2; pos[b].dy += dy * s2;
    }
    for (const n of core) {
      const p = pos[n];
      p.x += Math.max(-0.35, Math.min(0.35, p.dx)) * k;
      p.y += Math.max(-0.35, Math.min(0.35, p.dy)) * k;
      p.dx = 0; p.dy = 0;
    }
  }
  let R = 0;
  for (const n of core) R = Math.max(R, Math.hypot(pos[n].x, pos[n].y));
  R = Math.max(R, 1) * 1.45;
  iso.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, iso.length);
    pos[n] = { x: Math.cos(a) * R, y: Math.sin(a) * R };
  });
  return {
    nodes: zones.map((z, i) => ({ zone: z, x: pos[i].x, y: pos[i].y, r: radius(z), fill: ramp(z), degree: degree[i] })),
    edges: edges.map(([a, b, w]) => ({ a, b, w, width: Math.min(2.4, 0.35 + Math.log10(1 + w) * 0.75) })),
  };
}

// The zone a file belongs to: the longest zone directory that prefixes its own.
function zoneOfFile(file, zones) {
  const f = String(file || '').replace(/\\/g, '/');
  if (!f) return '';
  const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
  let best = ''; let bestLen = -1;
  for (const z of zones || []) {
    const zd = (!z.zone || z.zone === '<root>') ? '' : String(z.zone);
    if ((zd === '' && dir === '') || dir === zd || dir.startsWith(`${zd}/`)) {
      if (zd.length > bestLen) { best = z.slug || ''; bestLen = zd.length; }
    }
  }
  return best;
}

function graphSvg(overview, esc, opts = {}) {
  const escape = typeof esc === 'function' ? esc : (v) => String(v ?? '');
  const zones = (overview && overview.zones) || [];
  if (!zones.length) return '';
  const W = Number(opts.width || 560); const H = Number(opts.height || 300);
  const { nodes, edges } = layoutZones(overview);
  const maxR = Math.max(...nodes.map((n) => n.r), 1);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const n of nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); }
  const pad = maxR + 14;
  const sx = (W - 2 * pad) / Math.max(maxX - minX, 1e-6);
  const sy = (H - 2 * pad) / Math.max(maxY - minY, 1e-6);
  const s = Math.min(sx, sy);
  const ox = (W - (maxX - minX) * s) / 2; const oy = (H - (maxY - minY) * s) / 2;
  const X = (x) => (ox + (x - minX) * s).toFixed(1);
  const Y = (y) => (oy + (y - minY) * s).toFixed(1);
  // labels: every analysed zone, and the largest unread ones, so the picture reads
  const labelled = new Set(nodes.filter((n) => n.zone.analysed !== false).map((n) => n.zone.zone));
  nodes.filter((n) => n.zone.analysed === false).sort((a, b) => (b.zone.files || 0) - (a.zone.files || 0)).slice(0, opts.greyLabels == null ? 8 : opts.greyLabels)
    .forEach((n) => labelled.add(n.zone.zone));
  const edgeHtml = edges.map((e) => `<line x1="${X(nodes[e.a].x)}" y1="${Y(nodes[e.a].y)}" x2="${X(nodes[e.b].x)}" y2="${Y(nodes[e.b].y)}" stroke="#3a4150" stroke-width="${e.width.toFixed(2)}" vector-effect="non-scaling-stroke"/>`).join('');
  const live = String(opts.live || '');
  const liveZone = live ? zoneOfFile(live, zones) : '';
  // THE PLAN ON THE MAP: how many tasks each zone holds, as a small count on the node.
  const tasksByZone = opts.tasksByZone || {};
  const badge = (slug, n) => {
    const k = Number(tasksByZone[slug] || 0);
    if (!k) return '';
    const bx = Number(X(n.x)) + n.r * 0.75; const by = Number(Y(n.y)) - n.r * 0.75;
    return `<g class="mbadge"><title>${k} task${k === 1 ? '' : 's'} planned here</title><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="4.2" fill="#3794ff" stroke="#0f1218" stroke-width="0.6"/><text x="${bx.toFixed(1)}" y="${(by + 2.1).toFixed(1)}" text-anchor="middle" font-size="5.5" data-fs="5.5" fill="#fff">${k}</text></g>`;
  };
  const nodeHtml = nodes.map((n) => {
    const z = n.zone;
    const what = z.analysed === false
      ? `${z.zone} · ${Number(z.files || 0)} files · not analysed${z.queued ? ' (queued)' : ''}`
      : `${z.zone} · ${Number(z.files || 0)} files · ${Number(z.findings_total || 0)} findings · ${Number(z.size || 0)} flagged · worst ${Number(z.colour || 0).toFixed(2)}`;
    const label = labelled.has(z.zone)
      ? `<text x="${X(n.x)}" y="${(Number(Y(n.y)) + n.r + 10).toFixed(1)}" text-anchor="middle" font-size="9" data-fs="9" fill="${z.analysed === false ? '#6b7484' : '#9aa3b2'}">${escape(String(z.zone).split('/').slice(-2).join('/'))}</text>`
      : '';
    return `<g class="mnode${z.analysed === false ? ' grey' : ''}${liveZone && z.slug === liveZone ? ' live' : ''}" data-zone="${escape(z.slug || '')}"><title>${escape(what)}${liveZone && z.slug === liveZone ? ` · writing ${escape(live)}` : ''}</title>`
      + `<circle cx="${X(n.x)}" cy="${Y(n.y)}" r="${n.r.toFixed(1)}" fill="${n.fill}" stroke="#0f1218" stroke-width="0.8" vector-effect="non-scaling-stroke"/>${label}${badge(z.slug, n)}</g>`;
  }).join('');
  const legend = '<div class="mlegend"><i style="background:#4a5160"></i>not analysed <i style="background:#2f6b3a"></i>nothing found <i style="background:#8a7b28"></i>moderate <i style="background:#c2811f"></i>high <i style="background:#e2533f"></i>worst · size = flagged symbols · lines = calls and imports between zones</div>';
  // The controls are wired by the shell's script: full screen (Esc closes), reset the
  // view, and the caption that names the node the view is zoomed on. Wheel zooms,
  // drag pans, a click zooms to the node -- all on the viewBox, no library.
  const tools = '<div class="mtools"><button type="button" data-graph="full" title="Full screen (Esc closes)">⤢ Full screen</button><button type="button" data-graph="reset" title="Fit the whole map">⟲ Fit</button><span class="mcaption"></span><span class="mload"></span></div>';
  // What the pointer is over, and a way to hand it to the chat as context.
  const hover = '<div class="mhover"></div>';
  return `<div class="mgraph" data-w="${W}" data-h="${H}"${live ? ` data-live="${escape(live)}"` : ''}>${tools}${hover}<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="zone map">${edgeHtml}${nodeHtml}</svg>${opts.legend === false ? '' : legend}</div>`;
}

const GRAPH_CSS = `
  .mgraph { margin:6px 0 8px; background:#0f1218; border:1px solid var(--vscode-widget-border,#333); border-radius:6px; padding:4px; position:relative; }
  .mgraph svg { display:block; max-height:340px; cursor:grab; touch-action:none; }
  .mgraph svg.panning { cursor:grabbing; }
  .mgraph .mtools { display:flex; gap:6px; align-items:center; font-size:10.5px; padding:0 2px 4px; }
  .mgraph .mtools button { background:#1b2130; color:#cfd6e4; border:1px solid #2b3345; border-radius:4px; padding:2px 7px; cursor:pointer; font-size:10.5px; }
  .mgraph .mtools button:hover { border-color:#3794ff; }
  .mgraph .mcaption { opacity:.8; margin-left:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .mgraph .mcaption a { color:#7fd3b9; margin-left:6px; }
  .mgraph .mload { margin-left:auto; font-size:10px; opacity:.6; white-space:nowrap; }
  .mgraph.partial .mload { color:#c2811f; opacity:.9; }
  .mgraph .mfile text { pointer-events:none; }
  .mgraph [data-sym] { cursor:pointer; } .mgraph [data-sym]:hover { stroke:#fff; stroke-width:0.4; }
  .mgraph.full { position:fixed; inset:0; z-index:50; margin:0; border:0; border-radius:0; padding:8px; display:flex; flex-direction:column; }
  .mgraph.full svg { flex:1; max-height:none; height:auto; min-height:0; }
  .mgraph.full .mtools { font-size:12px; } .mgraph.full .mtools button { font-size:12px; padding:4px 10px; }
  .mgraph.full .mlegend { font-size:11.5px; }
  .mgraph .mnode { cursor:pointer; } .mgraph .mnode:hover circle { stroke:#fff; stroke-width:1.4; }
  /* the zone you are inside: its circle steps back so its contents read */
  .mgraph .mnode.open > circle { fill-opacity:.18; stroke:#3794ff; stroke-width:1.4; }
  .mgraph .mfile.on > circle { filter:drop-shadow(0 0 2px #3794ff); }
  .mgraph .mhover { display:none; position:absolute; left:6px; right:6px; bottom:6px; z-index:2;
    background:#161b26; border:1px solid #2b3345; border-radius:5px; padding:4px 7px; font-size:10.5px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:auto; }
  .mgraph .mhover.on { display:block; }
  .mgraph .mhover a { color:#7fd3b9; margin-left:8px; }
  .mgraph.full .mhover { font-size:12px; }
  .mgraph .mnode.open > text { fill:#3794ff; }
  .mgraph .mfile circle { cursor:pointer; }
  .mgraph .mnode.live > circle { stroke:#3794ff; stroke-width:1.8; animation: mpulse 1.4s ease-in-out infinite; }
  .mgraph .mfiles circle.live { fill:#3794ff; fill-opacity:1; animation: mpulse 1s ease-in-out infinite; }
  @keyframes mpulse { 50% { stroke-opacity:.15; fill-opacity:.35; } }
  .mgraph .mlegend { font-size:10.5px; opacity:.7; padding:4px 4px 2px; }
  .mgraph .mlegend i { display:inline-block; width:9px; height:9px; border-radius:50%; margin:0 3px 0 8px; vertical-align:middle; }
  .mgraph .mlegend i:first-child { margin-left:0; }
`;

module.exports = { layoutZones, graphSvg, zoneOfFile, ramp, radius, GRAPH_CSS };
