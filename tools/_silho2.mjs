/* Where does the dominant silhouette edge come from?
 *
 * _silho.mjs shows the seated cobble's outline carries one edge at 32.4% of
 * perimeter and two at 58.3%, and that redistributing bevel points anywhere in
 * the visible band does not move either figure. So the dominant edge is not
 * made of bevel points. Two candidates remain and they need different fixes:
 *
 *   A. the GROUND CUT - a plane through a convex body is a straight line, and
 *      it is straight by construction at any burial depth. Unfixable in the
 *      hull; would need the bed to be non-planar at clast scale.
 *   B. the EIGHT JITTERED CORNERS - eight points in a box arrangement hull into
 *      a box-ish outline however much each is jittered, because the gross shape
 *      follows the extreme points and bevel only chamfers the corners between
 *      them. Fixable, by breaking the long runs between corners.
 *
 * This separates them by measuring the silhouette with the ground cut excluded
 * from the perimeter, and then tests B directly by spending part of the bevel
 * budget on jittered box-EDGE midpoints, which is where a long silhouette run
 * between two corners can be broken. Triangle count is held flat by taking
 * those points out of the bevel allocation.
 *
 *   node tools/_silho2.mjs [--depression 20]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const EDGES = [];
for (let ax0 = 0; ax0 < 3; ax0++) {
  for (let s1 = -1; s1 <= 1; s1 += 2) for (let s2 = -1; s2 <= 1; s2 += 2) {
    const e = [0, 0, 0]; const o = [(ax0 + 1) % 3, (ax0 + 2) % 3];
    e[o[0]] = s1; e[o[1]] = s2; e[ax0] = 0;
    EDGES.push({ e, ax0 });
  }
}

function clast(seed, flat, bevel, nEdgePts) {
  const rand = rng(seed);
  const pts = [];
  const ax = 1.0, ay = flat, az = 0.78 + rand() * 0.42;
  const A = [ax, ay, az];
  for (let i = 0; i < 8; i++) {
    pts.push(new THREE.Vector3(
      ((i & 1) ? 1 : -1) * ax * (0.52 + rand() * 0.58),
      ((i & 2) ? 1 : -1) * ay * (0.52 + rand() * 0.58),
      ((i & 4) ? 1 : -1) * az * (0.52 + rand() * 0.58)));
  }
  /* points along the box's twelve edges, jittered off them. A long silhouette
     run is the projection of a box edge; a point pushed outside it splits the
     run into two shorter ones. */
  for (let i = 0; i < nEdgePts; i++) {
    const ed = EDGES[(rand() * EDGES.length) | 0];
    const v = [0, 0, 0];
    for (let k = 0; k < 3; k++) v[k] = ed.e[k] * A[k] * (0.62 + rand() * 0.48);
    v[ed.ax0] = A[ed.ax0] * (rand() * 2 - 1) * 0.86;
    pts.push(new THREE.Vector3(v[0], v[1], v[2]));
  }
  for (let i = 0; i < bevel - nEdgePts; i++) {
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (0.99 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  return new ConvexGeometry(pts);
}

function silhouette(g, sink, tiltAxis, tilt, viewDir) {
  const m = new THREE.Matrix4().makeRotationAxis(tiltAxis, tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));
  const p = g.attributes.position;
  const right = new THREE.Vector3(1, 0, 0);
  const upv = new THREE.Vector3().crossVectors(viewDir, right).normalize();
  const pts2 = []; const cutFlag = [];
  const seenV = new Set();
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m);
    const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
    if (seenV.has(key)) continue; seenV.add(key);
    const wasCut = v.y < 0;
    const w = new THREE.Vector3(v.x, Math.max(v.y, 0), v.z);
    pts2.push([w.dot(right), w.dot(upv), wasCut]);
  }
  pts2.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of pts2) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = pts2.length - 1; i >= 0; i--) { const q = pts2[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return null;
  let perim = 0, cutLen = 0; const free = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    perim += L;
    if (a[2] && b[2]) cutLen += L; else free.push(L);   // both ends were below the bed => ground cut
  }
  free.sort((x, y2) => y2 - x);
  return {
    n: hull.length,
    longest: free.length ? free[0] / perim : 0,
    cutShare: cutLen / perim,
    top2: free.length > 1 ? (free[0] + free[1]) / perim : (free[0] || 0) / perim,
  };
}

const viewDir = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const CL = { flat: 0.42, bevel: 24, variants: 4, sink: [0.54, 0.98] };

console.log(`cobble silhouette, ground cut separated   (depression ${DEPRESSION} deg)`);
console.log('');
console.log('  edge   silhouette   longest free   ground-cut   top-2 free    hull');
console.log('  pts    edges        edge           share        edges         tris');
for (const nE of [0, 4, 6, 8, 10, 12]) {
  const rows = []; let tris = 0;
  for (let v = 0; v < CL.variants; v++) {
    const g = clast(7717 + v * 17, CL.flat, CL.bevel, nE);
    tris += g.attributes.position.count / 3;
    const rand = rng(991 + v);
    for (let k = 0; k < 40; k++) {
      const hTrue = CL.flat;
      let sink = hTrue * (CL.sink[0] + rand() * (CL.sink[1] - CL.sink[0]));
      sink = Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95);
      const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, Math.atan2(hTrue * 1.7, 1.0));
      const ta = rand() * Math.PI * 2;
      const r = silhouette(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, viewDir);
      if (r) rows.push(r);
    }
  }
  const av = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const mark = nE === 0 ? '  (shipped)' : '';
  console.log(`  ${String(nE).padStart(4)}     ${av('n').toFixed(1).padStart(5)}        ${(100 * av('longest')).toFixed(1).padStart(5)}%         ${(100 * av('cutShare')).toFixed(1).padStart(5)}%       ${(100 * av('top2')).toFixed(1).padStart(5)}%      ${(tris / CL.variants).toFixed(0).padStart(4)}${mark}`);
}
