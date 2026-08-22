/* Break the top face by tilting its facets past the perceptual merge angle.
 *
 * _perceface.mjs gives the real specification. Facet COUNT was never the
 * problem - the top already carries plenty of facets, they just differ by
 * 1-3 degrees and shade as one lid. What is needed is angular SPREAD: adjacent
 * top facets differing by more than about ten degrees, which is where a single
 * dominant sun stops shading them alike.
 *
 * The eight gross corners are drawn as ax/ay/az * (0.52 + rand()*0.58) on each
 * axis. The y spread of the four top corners is what tilts the top facets: over
 * a horizontal span of about 1.5 radii, a corner height range of 0.52-1.10 of
 * ay = 0.42 is a slope of roughly nine degrees, which is just under the
 * threshold. Widening only the y draw, while holding its MEAN, tilts those
 * facets further without moving mean thickness, aspect, or burial.
 *
 *   0.52 + rand()*0.58   mean 0.81   spread 0.58   (shipped)
 *   0.34 + rand()*0.94   mean 0.81   spread 0.94
 *   0.22 + rand()*1.18   mean 0.81   spread 1.18
 *
 * Reports the 10-degree perceived face for the stones that cover screen area,
 * and alongside it the statistics that must NOT move: mean half-height, and
 * the vertical aspect the burial code depends on.
 *
 *   node tools/_yjit.mjs [--depression 20]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function clast(seed, flat, bevel, yLo, ySpread, bLo = 0.99, bSp = 0.24) {
  const rand = rng(seed);
  const pts = []; const ax = 1.0, ay = flat, az = 0.78 + rand() * 0.42;
  for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(
    ((i & 1) ? 1 : -1) * ax * (0.52 + rand() * 0.58),
    ((i & 2) ? 1 : -1) * ay * (yLo + rand() * ySpread),
    ((i & 4) ? 1 : -1) * az * (0.52 + rand() * 0.58)));
  for (let i = 0; i < bevel; i++) {
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (bLo + rand() * bSp);
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
function dims(g) {
  const p = g.attributes.position;
  let yMax = -1e9, yMin = 1e9, rMax = 0;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    yMax = Math.max(yMax, v.y); yMin = Math.min(yMin, v.y);
    rMax = Math.max(rMax, Math.hypot(v.x, v.z));
  }
  return { half: (yMax - yMin) / 2, aspect: (yMax - yMin) / 2 / rMax, tris: p.count / 3 };
}

const vd = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const CL = { flat: 0.42, bevel: 24, variants: 6, sink: [0.54, 0.98] };

console.log(`cobble: widening the corner y-jitter at constant mean   (depression ${DEPRESSION} deg)`);
console.log('');
console.log('  y draw               10deg face   >55%    | mean half   aspect   tris');
console.log('                       (big qtr)            | (must hold) (must hold)');
for (const [lo, sp] of [[0.52, 0.58], [0.44, 0.74], [0.34, 0.94], [0.26, 1.10], [0.18, 1.26]]) {
  const rows = []; let H = 0, A = 0, T = 0;
  for (let v = 0; v < CL.variants; v++) {
    const g = clast(7717 + v * 17, CL.flat, CL.bevel, lo, sp);
    const d = dims(g); H += d.half; A += d.aspect; T += d.tris;
    const rand = rng(991 + v);
    for (let k = 0; k < 150; k++) {
      const hT = CL.flat;
      let sink = hT * (CL.sink[0] + rand() * (CL.sink[1] - CL.sink[0]));
      sink = Math.min(Math.max(sink, hT * 0.34), hT * 0.95);
      const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, Math.atan2(hT * 1.7, 1.0));
      const ta = rand() * Math.PI * 2;
      const r = perceived(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, vd, 10);
      if (r) rows.push(r);
    }
  }
  const areas = rows.map((r) => r.area).sort((a, b) => a - b);
  const cut = areas[Math.floor(0.75 * (areas.length - 1))];
  const big = rows.filter((r) => r.area >= cut);
  const mean = 100 * big.reduce((s, r) => s + r.share, 0) / big.length;
  const over = 100 * big.filter((r) => r.share > 0.55).length / big.length;
  const mk = (lo === 0.52) ? '  (shipped)' : '';
  console.log(`  ${lo.toFixed(2)} + r*${sp.toFixed(2)}         ${mean.toFixed(0).padStart(3)}%      ${over.toFixed(0).padStart(3)}%    |  ${(H / CL.variants).toFixed(3)}     ${(A / CL.variants).toFixed(3)}   ${(T / CL.variants).toFixed(0).padStart(3)}${mk}`);
}

/* ---- and the lever the corner sweep points at ----------------------------
 * Widening the corner y-jitter does almost nothing, because the four top
 * corners are not what forms the top. Bevel points are placed at t*(0.99 to
 * 1.23) of the box surface, and for any direction near +y that is a height of
 * ay*(0.99 to 1.23) - a band only twelve percent wide, spread across the whole
 * horizontal area of the lid. A set of points at nearly constant height over an
 * area IS a flat plane, so the bevel points are themselves the lid, and no
 * amount of moving the corners under them changes that.
 *
 * So widen the radial jitter instead, holding its mean at 1.11 so the clast
 * neither grows nor shrinks. */
console.log('');
console.log('cobble: widening the bevel radial jitter at constant mean 1.11');
console.log('');
console.log('  bevel j              10deg face   >55%    | mean half   aspect   tris');
for (const [lo, sp] of [[0.99, 0.24], [0.93, 0.36], [0.86, 0.50], [0.78, 0.66], [0.70, 0.82]]) {
  const rows = []; let H = 0, A = 0, T = 0;
  for (let v = 0; v < CL.variants; v++) {
    const g = clast(7717 + v * 17, CL.flat, CL.bevel, 0.52, 0.58, lo, sp);
    const d = dims(g); H += d.half; A += d.aspect; T += d.tris;
    const rand = rng(991 + v);
    for (let k = 0; k < 150; k++) {
      const hT = CL.flat;
      let sink = hT * (CL.sink[0] + rand() * (CL.sink[1] - CL.sink[0]));
      sink = Math.min(Math.max(sink, hT * 0.34), hT * 0.95);
      const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, Math.atan2(hT * 1.7, 1.0));
      const ta = rand() * Math.PI * 2;
      const r = perceived(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, vd, 10);
      if (r) rows.push(r);
    }
  }
  const areas = rows.map((r) => r.area).sort((a, b) => a - b);
  const cut = areas[Math.floor(0.75 * (areas.length - 1))];
  const big = rows.filter((r) => r.area >= cut);
  const mean = 100 * big.reduce((s, r) => s + r.share, 0) / big.length;
  const over = 100 * big.filter((r) => r.share > 0.55).length / big.length;
  const mk = (lo === 0.99) ? '  (shipped)' : '';
  console.log(`  ${lo.toFixed(2)} + r*${sp.toFixed(2)}         ${mean.toFixed(0).padStart(3)}%      ${over.toFixed(0).padStart(3)}%    |  ${(H / CL.variants).toFixed(3)}     ${(A / CL.variants).toFixed(3)}   ${(T / CL.variants).toFixed(0).padStart(3)}${mk}`);
}
