/* What does the CAMERA see of a buried clast, as opposed to what the hull has?
 *
 * tools/_hullface.mjs measured facet area over the whole hull and found it
 * healthy - largest plane 6.5-9.3%, 23-53 distinct planes - and I concluded the
 * bevel work had succeeded. That measurement is correct and it answers the
 * wrong question, for a reason the burial code makes plain:
 *
 *   sink runs hTrue * 0.34 to hTrue * 0.95, against a vertical half-extent of
 *   hTrue. So the part standing above the bed is 5% to 66% of a HALF-height,
 *   which is 2.5% to 33% of the clast's total height.
 *
 * A thin cap sliced off the top of a convex hull is not a small version of that
 * hull. Its outline is the cross-section polygon where the ground plane cuts it,
 * which is a convex polygon with one straight edge per hull face it crosses -
 * and near the apex only a handful of faces are in play. "Quasi-rectangular or
 * hexagonal", "dead-straight mitred edges" and "hard 90 degree corners" are a
 * literal description of a convex polygon cross-section, so this measures the
 * cross-section rather than the hull.
 *
 * Reports per class, over its real variants and a sample of the real sink and
 * tilt distributions:
 *   - visible height as a fraction of total height
 *   - VERTICES of the ground-plane cross-section: the silhouette's side count
 *   - planes carrying visible projected area, and the largest one's share,
 *     seen from a near-field camera depression rather than from everywhere
 *
 *   node tools/_visface.mjs [--depression 20]
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const src = readFileSync(new URL('../src/scatter.js', import.meta.url), 'utf8');
for (const e of ['0.52 + rand() * 0.58', '0.99 + rand() * 0.24', 'Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95)']) {
  if (!src.includes(e)) {
    console.error(`_visface: scatter.js no longer contains "${e}"; this tool mirrors it and has drifted. Refusing to report.`);
    process.exit(2);
  }
}

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function angularClast(seed, flat, bevel) {
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
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (0.99 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  return new ConvexGeometry(pts);
}

const CLASSES = [
  { name: 'gravel3', flat: 0.54, bevel: 7, variants: 4, sink: [0.52, 0.96] },
  { name: 'granule', flat: 0.50, bevel: 20, variants: 4, sink: [0.52, 0.96] },
  { name: 'cobble', flat: 0.42, bevel: 24, variants: 4, sink: [0.54, 0.98] },
  { name: 'pebble', flat: 0.50, bevel: 26, variants: 4, sink: [0.54, 0.98] },
  { name: 'pavement', flat: 0.62, bevel: 26, variants: 3, sink: [0.52, 0.94] },
  { name: 'slab', flat: 0.62, bevel: 34, variants: 3, sink: [0.52, 0.94] },
  { name: 'boulder', flat: 0.86, bevel: 38, variants: 3, sink: [0.56, 0.94] },
];

/* triangles of a geometry, transformed */
function tris(g, m) {
  const p = g.attributes.position;
  const out = [];
  for (let t = 0; t < p.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, t * 3).applyMatrix4(m);
    const b = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 1).applyMatrix4(m);
    const c = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 2).applyMatrix4(m);
    out.push([a, b, c]);
  }
  return out;
}

/* clip a triangle to y >= 0, returning 0, 1 or 2 triangles */
function clipY(t) {
  const inside = t.filter((v) => v.y >= 0);
  if (inside.length === 3) return [t];
  if (inside.length === 0) return [];
  const lerp = (p, q) => { const s = (0 - p.y) / (q.y - p.y); return new THREE.Vector3().lerpVectors(p, q, s); };
  const [a, b, c] = t;
  const sgn = t.map((v) => v.y >= 0);
  if (inside.length === 1) {
    const i = sgn.indexOf(true);
    const p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3];
    return [[p, lerp(p, q), lerp(p, r)]];
  }
  const i = sgn.indexOf(false);
  const p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3];
  const pq = lerp(p, q), pr = lerp(p, r);
  return [[pq, q, r], [pq, r, pr]];
}

function analyse(g, scale, sink, tiltAxis, tilt, viewDir) {
  const m = new THREE.Matrix4()
    .makeRotationAxis(tiltAxis, tilt)
    .premultiply(new THREE.Matrix4().makeTranslation(0, 0, 0));
  const s = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z);
  const full = new THREE.Matrix4().multiplyMatrices(m, s);
  full.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));

  const T = tris(g, full);
  let minY = 1e9, maxY = -1e9;
  for (const t of T) for (const v of t) { minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }

  // visible (above ground) triangles, grouped into planes, projected area to camera
  const planes = [];
  let projTotal = 0;
  const cutPts = [];
  for (const t of T) {
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(t[1], t[0]),
      new THREE.Vector3().subVectors(t[2], t[0]));
    if (n.lengthSq() < 1e-20) continue;
    n.normalize();
    if (n.dot(viewDir) >= 0) continue;              // back-facing
    for (const ct of clipY(t)) {
      const e1 = new THREE.Vector3().subVectors(ct[1], ct[0]);
      const e2 = new THREE.Vector3().subVectors(ct[2], ct[0]);
      const area = new THREE.Vector3().crossVectors(e1, e2).length() * 0.5;
      if (area < 1e-12) continue;
      const proj = area * Math.abs(n.dot(viewDir));
      projTotal += proj;
      const d = n.dot(ct[0]);
      let hit = planes.find((pl) => pl.n.dot(n) > 0.9995 && Math.abs(pl.d - d) < 1e-5);
      if (hit) hit.proj += proj; else planes.push({ n: n.clone(), d, proj });
      for (const v of ct) if (Math.abs(v.y) < 1e-9) cutPts.push(v);
    }
  }
  planes.sort((a, b) => b.proj - a.proj);

  /* vertices of the ground-plane cross-section: distinct directions among the
     cut points, which is the side count of the silhouette's base polygon */
  const dirs = [];
  for (const p of cutPts) {
    const a = Math.atan2(p.z, p.x);
    if (!dirs.some((q) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q))) < 0.06)) dirs.push(a);
  }

  const totalH = maxY - Math.min(minY, 0);
  return {
    visFrac: maxY / Math.max(totalH, 1e-9),
    cutSides: dirs.length,
    planes: planes.length,
    topShare: planes.length ? planes[0].proj / projTotal : 0,
    top3: planes.slice(0, 3).reduce((a, p) => a + p.proj, 0) / Math.max(projTotal, 1e-12),
  };
}

const viewDir = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();

console.log(`what the camera sees of a seated clast   (camera depression ${DEPRESSION} deg)`);
console.log('');
console.log('  class      visible%   cut-polygon    planes    largest    top-3');
console.log('             of height    sides        visible    plane     planes');
for (const cl of CLASSES) {
  const rows = [];
  for (let v = 0; v < cl.variants; v++) {
    const g = angularClast(7717 + v * 17, cl.flat, cl.bevel);
    const rand = rng(991 + v);
    for (let k = 0; k < 24; k++) {
      const hTrue = cl.flat;                       // unit radius, so hTrue = flat
      let sink = hTrue * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
      sink = Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95);
      const tiltCap = Math.atan2(hTrue * 1.7, 1.0);
      const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, tiltCap);
      const ta = rand() * Math.PI * 2;
      rows.push(analyse(g, { x: 1, y: 1, z: 1 }, sink,
        new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, viewDir));
    }
  }
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  console.log(`  ${cl.name.padEnd(9)}  ${(100 * avg('visFrac')).toFixed(1).padStart(5)}%      ${avg('cutSides').toFixed(1).padStart(5)}        ${avg('planes').toFixed(1).padStart(5)}     ${(100 * avg('topShare')).toFixed(1).padStart(5)}%    ${(100 * avg('top3')).toFixed(1).padStart(5)}%`);
}
console.log('');
console.log('Compare against tools/_hullface.mjs, which measured the WHOLE hull:');
console.log('  largest plane 6.5-9.3% of surface area, 23-53 distinct planes.');
console.log('If "largest plane" here is several times that, the hull is fine and');
console.log('the burial is what presents a few big facets and a straight cut edge.');
