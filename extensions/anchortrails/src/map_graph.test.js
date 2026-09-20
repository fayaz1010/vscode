'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { layoutZones, graphSvg, ramp, radius } = require('./map_graph');

const esc = (v) => String(v ?? '');
const OV = {
  meta: { status: 'complete' },
  zones: [
    { zone: 'src/a', slug: 'src-a', colour: 0.8, size: 4, findings_total: 6, files: 10, analysed: true },
    { zone: 'src/b', slug: 'src-b', colour: 0.4, size: 1, findings_total: 2, files: 30, analysed: true },
    { zone: 'src/c', slug: 'src-c', colour: 0, size: 0, findings_total: 0, files: 5, analysed: true },
    { zone: 'lib/x', slug: 'lib-x', colour: 0, size: 0, findings_total: 0, files: 900, analysed: false, queued: true },
    { zone: 'lib/y', slug: 'lib-y', colour: 0, size: 0, findings_total: 0, files: 3, analysed: false },
  ],
  zone_edges: [{ a: 'src/a', b: 'src/b', w: 12 }, { a: 'src/b', b: 'src/c', w: 2 }, { a: 'src/a', b: 'src/a', w: 5 }, { a: 'src/b', b: 'src/a', w: 1 }],
};

describe('the graphical map', () => {
  it('colours by the honesty rule and sizes by what is flagged', () => {
    assert.equal(ramp({ analysed: false, colour: 0.9, findings_total: 3 }), '#4a5160', 'unread is grey whatever the numbers say');
    assert.equal(ramp({ analysed: true, findings_total: 0 }), '#2f6b3a', 'read and clean is green');
    assert.equal(ramp({ analysed: true, findings_total: 1, colour: 0.75 }), '#e2533f');
    assert.equal(ramp({ findings_total: 1, colour: 0.55 }), '#c2811f', 'no flag: a map from before the flag, every zone analysed');
    assert.ok(radius({ size: 9, files: 10 }) > radius({ size: 1, files: 10 }));
  });

  it('lays out the connected core with forces and parks isolates on a ring, the same every time', () => {
    const a = layoutZones(OV); const b = layoutZones(OV);
    assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]), 'deterministic');
    assert.equal(a.edges.length, 2, 'a self-edge and a duplicate are not drawn');
    assert.deepEqual(a.nodes.map((n) => n.degree), [1, 2, 1, 0, 0]);
    const core = a.nodes.slice(0, 3); const iso = a.nodes.slice(3);
    const rCore = Math.max(...core.map((n) => Math.hypot(n.x, n.y)));
    for (const n of iso) assert.ok(Math.hypot(n.x, n.y) > rCore, 'isolates sit outside the core');
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    assert.ok(d(a.nodes[0], a.nodes[1]) < d(a.nodes[0], a.nodes[2]), 'the heavier edge pulls closer');
  });

  it('draws nodes, edges, labels and tooltips into one static SVG', () => {
    const svg = graphSvg(OV, esc);
    assert.match(svg, /<svg viewBox="0 0 560 300"/);
    assert.equal((svg.match(/<line /g) || []).length, 2);
    assert.equal((svg.match(/<circle /g) || []).length, 5);
    assert.match(svg, /data-zone="src-a"><title>src\/a · 10 files · 6 findings · 4 flagged · worst 0\.80<\/title>/);
    assert.match(svg, /data-zone="lib-x"><title>lib\/x · 900 files · not analysed \(queued\)<\/title>/);
    assert.match(svg, /fill="#e2533f"/); assert.match(svg, /fill="#2f6b3a"/); assert.match(svg, /fill="#4a5160"/);
    assert.match(svg, /<text [^>]*>src\/a<\/text>/, 'analysed zones are labelled');
    assert.match(svg, /class="mlegend"/);
    assert.equal(graphSvg({ zones: [] }, esc), '', 'no zones: nothing to draw');
    assert.doesNotMatch(graphSvg(OV, esc, { legend: false, height: 220 }), /mlegend/);
    assert.match(graphSvg(OV, esc, { height: 220 }), /viewBox="0 0 560 220"/);
  });

  it('every coordinate stays inside the viewBox', () => {
    const svg = graphSvg(OV, esc);
    for (const m of svg.matchAll(/cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
      const [cx, cy, r] = [Number(m[1]), Number(m[2]), Number(m[3])];
      assert.ok(cx - r >= 0 && cx + r <= 560 && cy - r >= 0 && cy + r <= 300, `${cx},${cy},${r} inside`);
    }
  });
});
