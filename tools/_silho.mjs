/* The metric that matches the complaint: silhouette straightness.
 *
 * _pixowner attributes the flat quadrilateral plates in the near field to
 * `cobble` - flat 0.42, the most tabular class in the table, 3600 instances.
 * "Flat top, straight side, hard 90 degree edges" and "dead-straight mitred
 * edges" are statements about the OUTLINE, and neither the whole-hull area
 * statistic nor the visible-facet statistic measures an outline.
 *
 * So this measures the projected silhouette of a seated clast directly:
 *   - how many distinct straight edges it has
 *   - what share of the perimeter the single longest straight edge carries
 * A quadrilateral scores 4 edges and about 30% on the longest. A rock should
 * have many short edges and no single one dominating.
 *
 * Then it sweeps a bias that concentrates bevel points into the band that is
 * actually above the bed, selected by the point's resulting height rather than
 * by its direction, because the mapping from direction to height on a squashed
 * box is not monotone and biasing the direction misses.
 *
 *   node tools/_silho.mjs [--depression 20]
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const src = readFileSync(new URL('../src/scatter.js', import.meta.url), 'utf8');
for (const e of ['0.52 + rand() * 0.58', '0.99 + rand() * 0.24']) {
  if (!src.includes(e)) { console.error('_silho: scatter.js drifted from this tool. Refusing.'); process.exit(2); }
}

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* bandFrac: fraction of bevel points forced to land above yMin (in units of ay).
   0 reproduces the shipped hull. */
function clast(seed, flat, bevel, bandFrac, yMin) {
  const rand = rng(seed);
  const pts = [];
  const ax = 1.0, ay = flat, az = 0.78 + rand() * 0.42;
  for (let i = 0; i < 8; i++) {
    pts.push(new THREE.Vector3(
      ((i & 1) ? 1 : -1) * ax * (0.52 + rand() * 0.58),
      ((i & 2) ? 1 : -1) * ay * (0.52 + rand() * 0.58),
      ((i & 4) ? 1 : -1) * az * (0.52 + rand() * 0.58)));
  }
  for (let i = 0; i < bevel; i++) {
    const wantBand = bandFrac > 0 && rand() < bandFrac;   // guarded: see _topbias
    let p = null;
    for (let tryN = 0; tryN < 24; tryN++) {
      let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
      const L = Math.hypot(dx, dy, dz) || 1;
      dx /= L; dy /= L; dz /= L;
      const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
      const j = t * (0.99 + rand() * 0.24);
      const q = new THREE.Vector3(dx * j, dy * j, dz * j);
      if (!wantBand || q.y >= yMin * ay) { p = q; break; }
    }
    if (p) pts.push(p);
  }
  return new ConvexGeometry(pts);
}

function silhouette(g, sink, tiltAxis, tilt, viewDir) {
  /* project every vertex above the bed into the view plane, hull it, and
     measure the outline. For a convex body the silhouette is the convex hull
     of the projection, and the ground cut adds its own straight edge. */
  const m = new THREE.Matrix4().makeRotationAxis(tiltAxis, tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));
  const p = g.attributes.position;
  const right = new THREE.Vector3(1, 0, 0);
  const upv = new THREE.Vector3().crossVectors(viewDir, right).normalize();
  const pts2 = [];
  const seenV = new Set();
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m);
    const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
    if (seenV.has(key)) continue; seenV.add(key);
    const y = Math.max(v.y, 0);                    // clip to the bed
    const w = new THREE.Vector3(v.x, y, v.z);
    pts2.push([w.dot(right), w.dot(upv)]);
  }
  // 2D convex hull (monotone chain)
  pts2.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of pts2) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = pts2.length - 1; i >= 0; i--) { const q = pts2[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return null;
  let perim = 0; const edges = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    perim += L; edges.push(L);
  }
  edges.sort((x, y2) => y2 - x);
  return { n: hull.length, longest: edges[0] / perim, top2: (edges[0] + edges[1]) / perim };
}

const viewDir = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const CL = { name: 'cobble', flat: 0.42, bevel: 24, variants: 4, sink: [0.54, 0.98] };

console.log(`silhouette of a seated ${CL.name}   (camera depression ${DEPRESSION} deg)`);
console.log('a quadrilateral is 4 edges with the longest near 30% of perimeter');
console.log('');
console.log('  band  yMin   silhouette   longest    top-2      hull');
console.log('  frac         edges        edge       edges      tris');
for (const [bandFrac, yMin] of [[0.00, 0], [0.35, 0.2], [0.50, 0.2], [0.50, 0.4], [0.65, 0.2], [0.65, 0.4], [0.80, 0.3]]) {
  const rows = []; let tris = 0;
  for (let v = 0; v < CL.variants; v++) {
    const g = clast(7717 + v * 17, CL.flat, CL.bevel, bandFrac, yMin);
    tris += g.attributes.position.count / 3;
    const rand = rng(991 + v);
    for (let k = 0; k < 40; k++) {
      const hTrue = CL.flat;
      let sink = hTrue * (CL.sink[0] + rand() * (CL.sink[1] - CL.sink[0]));
      sink = Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95);
      const tiltCap = Math.atan2(hTrue * 1.7, 1.0);
      const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, tiltCap);
      const ta = rand() * Math.PI * 2;
      const r = silhouette(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, viewDir);
      if (r) rows.push(r);
    }
  }
  const av = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const mark = bandFrac === 0 ? '  (shipped)' : '';
  console.log(`  ${bandFrac.toFixed(2)}  ${yMin.toFixed(1)}    ${av('n').toFixed(1).padStart(5)}       ${(100 * av('longest')).toFixed(1).padStart(5)}%    ${(100 * av('top2')).toFixed(1).padStart(5)}%     ${(tris / CL.variants).toFixed(0).padStart(4)}${mark}`);
}
