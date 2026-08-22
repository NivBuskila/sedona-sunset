/* Can the facet budget be moved to where the camera is, at no triangle cost?
 *
 * _visface.mjs establishes the defect: a seated clast shows only 20-24% of its
 * height, and over that cap the largest single plane is 28-34% of projected
 * area with the top three at 58-73%. Three big flat facets is a brick.
 *
 * The hull is not short of facets - it has 23-53 planes. They are in the wrong
 * place. angularClast draws bevel directions uniformly over the sphere, so
 * roughly half the budget lands on the underside, which is buried, and much of
 * the rest on flanks that are below the bed line. The seating aligns the
 * clast's local +y with the ground normal before a modest tilt, so local +y is
 * world up for essentially the whole population, and the budget can be moved
 * without changing its size.
 *
 * This sweeps that bias and reports both statistics, because they must move in
 * OPPOSITE directions if the mechanism is what I claim:
 *   - visible largest-plane share must FALL (the fix)
 *   - whole-hull largest-plane share must RISE slightly (the cost, on faces
 *     nobody sees) - and no other change produces that signature
 *
 *   node tools/_topbias.mjs [--depression 20]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* bias: fraction of bevel points whose direction is drawn from the upper cap
   instead of the full sphere. 0 reproduces the shipped hull exactly. */
function angularClast(seed, flat, bevel, bias, capMin) {
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
    if (rand() < bias) dy = capMin + Math.abs(dy) * (1 - capMin);
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (0.99 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  return new ConvexGeometry(pts);
}

const CLASSES = [
  { name: 'cobble', flat: 0.42, bevel: 24, variants: 4, sink: [0.54, 0.98] },
  { name: 'pavement', flat: 0.62, bevel: 26, variants: 3, sink: [0.52, 0.94] },
  { name: 'slab', flat: 0.62, bevel: 34, variants: 3, sink: [0.52, 0.94] },
  { name: 'boulder', flat: 0.86, bevel: 38, variants: 3, sink: [0.56, 0.94] },
];

function tris(g, m) {
  const p = g.attributes.position;
  const out = [];
  for (let t = 0; t < p.count / 3; t++) {
    out.push([
      new THREE.Vector3().fromBufferAttribute(p, t * 3).applyMatrix4(m),
      new THREE.Vector3().fromBufferAttribute(p, t * 3 + 1).applyMatrix4(m),
      new THREE.Vector3().fromBufferAttribute(p, t * 3 + 2).applyMatrix4(m)]);
  }
  return out;
}
function clipY(t) {
  const sgn = t.map((v) => v.y >= 0);
  const nIn = sgn.filter(Boolean).length;
  if (nIn === 3) return [t];
  if (nIn === 0) return [];
  const lerp = (p, q) => { const s = (0 - p.y) / (q.y - p.y); return new THREE.Vector3().lerpVectors(p, q, s); };
  if (nIn === 1) {
    const i = sgn.indexOf(true);
    const p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3];
    return [[p, lerp(p, q), lerp(p, r)]];
  }
  const i = sgn.indexOf(false);
  const p = t[i], q = t[(i + 1) % 3], r = t[(i + 2) % 3];
  return [[lerp(p, q), q, r], [lerp(p, q), r, lerp(p, r)]];
}

function visible(g, sink, tiltAxis, tilt, viewDir) {
  const full = new THREE.Matrix4().makeRotationAxis(tiltAxis, tilt);
  full.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));
  const planes = []; let projTotal = 0;
  for (const t of tris(g, full)) {
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(t[1], t[0]), new THREE.Vector3().subVectors(t[2], t[0]));
    if (n.lengthSq() < 1e-20) continue;
    n.normalize();
    if (n.dot(viewDir) >= 0) continue;
    for (const ct of clipY(t)) {
      const area = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(ct[1], ct[0]), new THREE.Vector3().subVectors(ct[2], ct[0])).length() * 0.5;
      if (area < 1e-12) continue;
      const proj = area * Math.abs(n.dot(viewDir));
      projTotal += proj;
      const d = n.dot(ct[0]);
      const hit = planes.find((pl) => pl.n.dot(n) > 0.9995 && Math.abs(pl.d - d) < 1e-5);
      if (hit) hit.proj += proj; else planes.push({ n: n.clone(), d, proj });
    }
  }
  planes.sort((a, b) => b.proj - a.proj);
  return {
    planes: planes.length,
    topShare: planes.length ? planes[0].proj / projTotal : 0,
    top3: planes.slice(0, 3).reduce((a, p) => a + p.proj, 0) / Math.max(projTotal, 1e-12),
  };
}

function wholeHull(g) {
  const p = g.attributes.position;
  const planes = []; let total = 0;
  for (let t = 0; t < p.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, t * 3);
    const b = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 2);
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    const area = n.length() * 0.5;
    if (area < 1e-12) continue;
    n.normalize(); total += area;
    const d = n.dot(a);
    const hit = planes.find((pl) => pl.n.dot(n) > 0.9995 && Math.abs(pl.d - d) < 1e-4);
    if (hit) hit.area += area; else planes.push({ n: n.clone(), d, area });
  }
  planes.sort((a, b) => b.area - a.area);
  return { tris: p.count / 3, planes: planes.length, maxShare: planes[0].area / total };
}

const viewDir = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();

console.log(`top-bias sweep   (camera depression ${DEPRESSION} deg)   capMin = 0.25`);
console.log('');
console.log('                 ---------- what the camera sees ----------   --- whole hull ---');
console.log('  class   bias   planes   largest   top-3      tris          planes  largest');
for (const cl of CLASSES) {
  for (const bias of [0.0, 0.25, 0.40, 0.55, 0.70]) {
    const vis = [], hull = [];
    for (let v = 0; v < cl.variants; v++) {
      const g = angularClast(7717 + v * 17, cl.flat, cl.bevel, bias, 0.25);
      hull.push(wholeHull(g));
      const rand = rng(991 + v);
      for (let k = 0; k < 24; k++) {
        const hTrue = cl.flat;
        let sink = hTrue * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
        sink = Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95);
        const tiltCap = Math.atan2(hTrue * 1.7, 1.0);
        const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, tiltCap);
        const ta = rand() * Math.PI * 2;
        vis.push(visible(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, viewDir));
      }
    }
    const av = (arr, k) => arr.reduce((s, r) => s + r[k], 0) / arr.length;
    const mark = bias === 0 ? ' (shipped)' : '';
    console.log(`  ${cl.name.padEnd(8)} ${bias.toFixed(2)}   ${av(vis, 'planes').toFixed(1).padStart(5)}   ${(100 * av(vis, 'topShare')).toFixed(1).padStart(5)}%   ${(100 * av(vis, 'top3')).toFixed(1).padStart(5)}%   ${av(hull, 'tris').toFixed(0).padStart(4)}          ${av(hull, 'planes').toFixed(0).padStart(4)}   ${(100 * av(hull, 'maxShare')).toFixed(1).padStart(5)}%${mark}`);
  }
  console.log('');
}
