/* A face is flat if it LOOKS flat, not if its normals are bit-identical.
 *
 * Every facet statistic I have run today merged triangles into a plane only
 * when their normals agreed to within a dot product of 0.9995 - about 1.8
 * degrees - and their plane offsets to 1e-5. That is a geometric test. The
 * complaint is perceptual: a "bright flat top face" is any patch whose shading
 * does not visibly change across it, and under a single dominant sun a patch
 * spanning several degrees of normal shades almost uniformly.
 *
 * So a top made of six facets each 1.5 degrees apart scores as six planes at
 * ten percent each - clean by my statistic - and reads as one flat lid. That is
 * exactly the gap between "the shape measures fine" and the crop showing
 * paving slabs, and it is the third instance today of a statistic taken in the
 * wrong space: whole hull instead of visible cap, whole population instead of
 * the stones that cover pixels, and now exact normals instead of perceived
 * ones.
 *
 * This sweeps the merge tolerance from geometric to perceptual and reports the
 * largest PERCEIVED face, restricted to the stones that actually cover screen
 * area - the largest quartile by projected area.
 *
 *   node tools/_perceface.mjs [--depression 20]
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const src = readFileSync(new URL('../src/scatter.js', import.meta.url), 'utf8');
if (!src.includes('0.99 + rand() * 0.24')) { console.error('_perceface: scatter.js drifted. Refusing.'); process.exit(2); }

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* mirrors angularClast exactly - no bias parameter, so no stray draw */
function clast(seed, flat, bevel) {
  const rand = rng(seed);
  const pts = []; const ax = 1.0, ay = flat, az = 0.78 + rand() * 0.42;
  for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(
    ((i & 1) ? 1 : -1) * ax * (0.52 + rand() * 0.58),
    ((i & 2) ? 1 : -1) * ay * (0.52 + rand() * 0.58),
    ((i & 4) ? 1 : -1) * az * (0.52 + rand() * 0.58)));
  for (let i = 0; i < bevel; i++) {
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (0.99 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  return new ConvexGeometry(pts);
}
function clipY(t) {
  const sg = t.map((v) => v.y >= 0), n = sg.filter(Boolean).length;
  if (n === 3) return [t]; if (n === 0) return [];
  const lp = (p, q) => { const s = (0 - p.y) / (q.y - p.y); return new THREE.Vector3().lerpVectors(p, q, s); };
  if (n === 1) { const i = sg.indexOf(true), p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3]; return [[p, lp(p, q), lp(p, r)]]; }
  const i = sg.indexOf(false), p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3];
  return [[lp(p, q), q, r], [lp(p, q), r, lp(p, r)]];
}

/* largest perceived face: greedily merge visible facets whose normals lie
   within tolDeg of a seed normal, weighted by projected area */
function perceived(g, sink, axis, tilt, vd, tolDeg) {
  const m = new THREE.Matrix4().makeRotationAxis(axis, tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));
  const p = g.attributes.position; const fac = []; let tot = 0;
  for (let t = 0; t < p.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, t * 3).applyMatrix4(m);
    const b = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 1).applyMatrix4(m);
    const c = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 2).applyMatrix4(m);
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-20) continue; n.normalize(); if (n.dot(vd) >= 0) continue;
    for (const ct of clipY([a, b, c])) {
      const ar = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(ct[1], ct[0]), new THREE.Vector3().subVectors(ct[2], ct[0])).length() * 0.5;
      if (ar < 1e-12) continue;
      const pr = ar * Math.abs(n.dot(vd)); tot += pr; fac.push({ n: n.clone(), proj: pr });
    }
  }
  if (!fac.length || tot <= 0) return null;
  const cosTol = Math.cos(tolDeg * Math.PI / 180);
  let best = 0;
  for (const seed of fac) {
    let s = 0;
    for (const f of fac) if (f.n.dot(seed.n) >= cosTol) s += f.proj;
    if (s > best) best = s;
  }
  return { share: best / tot, area: tot };
}

const vd = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const CLASSES = [
  { name: 'cobble', flat: 0.42, bevel: 24, variants: 4, sink: [0.54, 0.98] },
  { name: 'pavement', flat: 0.50, bevel: 26, variants: 3, sink: [0.35, 0.62] },
  { name: 'boulder', flat: 0.86, bevel: 38, variants: 3, sink: [0.56, 0.94] },
];

console.log(`largest PERCEIVED face, largest screen-area quartile only  (depression ${DEPRESSION} deg)`);
console.log('');
console.log('  merge tolerance ->    1.8 deg     5 deg     10 deg     15 deg');
console.log('                       (geometric)          (perceptual)');
for (const cl of CLASSES) {
  const out = [];
  for (const tol of [1.8, 5, 10, 15]) {
    const rows = [];
    for (let v = 0; v < cl.variants; v++) {
      const g = clast(7717 + v * 17, cl.flat, cl.bevel);
      const rand = rng(991 + v);
      for (let k = 0; k < 150; k++) {
        const hT = cl.flat;
        let sink = hT * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
        sink = Math.min(Math.max(sink, hT * 0.34), hT * 0.95);
        const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, Math.atan2(hT * 1.7, 1.0));
        const ta = rand() * Math.PI * 2;
        const r = perceived(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, vd, tol);
        if (r) rows.push(r);
      }
    }
    const areas = rows.map((r) => r.area).sort((a, b) => a - b);
    const cut = areas[Math.floor(0.75 * (areas.length - 1))];
    const big = rows.filter((r) => r.area >= cut);
    const mean = big.reduce((s, r) => s + r.share, 0) / big.length;
    const over = 100 * big.filter((r) => r.share > 0.55).length / big.length;
    out.push(`${(100 * mean).toFixed(0)}% (${over.toFixed(0)}% >55)`);
  }
  console.log(`  ${cl.name.padEnd(10)}      ${out.map((s) => s.padStart(13)).join('  ')}`);
}
console.log('');
console.log('A sunlit patch spanning under about 10 degrees of normal shades within a');
console.log('few code values under one dominant sun, so the 10-15 degree columns are');
console.log('what the eye groups into "one bright flat top face".');
