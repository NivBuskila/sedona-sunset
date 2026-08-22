/* Widen the bevel radial jitter, and give back the size it steals.
 *
 * _yjit.mjs finds the lever: bevel points sit at t*(0.99 to 1.23) of the box
 * surface, so near +y they occupy a height band twelve percent wide spread over
 * the whole lid, and a set of points at nearly constant height over an area is
 * a plane. Widening that band breaks the lid - the share of big stones showing
 * one perceived face over 55% goes 52% -> 27%.
 *
 * It also inflates the clast by 9-19%, and for an unavoidable reason: the hull
 * takes the maximum, and widening a distribution about a fixed mean raises its
 * expected maximum. Size is not free to move - it feeds the burial depth, the
 * dust proud-fraction, the shadow gate and the delivered census.
 *
 * So the jitter is widened and the whole hull is then scaled back to the
 * shipped mean half-height. Relative bumpiness is preserved, absolute size is
 * returned. This sweeps the pair and reports the perceptual metric next to
 * every statistic that must not move.
 *
 *   node tools/_bevjit.mjs [--depression 20]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function clast(seed, flat, bevel, bLo, bSp, comp) {
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
    const j = t * (bLo + rand() * bSp);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  const g = new ConvexGeometry(pts);
  if (comp !== 1) g.scale(comp, comp, comp);
  return g;
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
  for (const seed of fac) { let s = 0; for (const f of fac) if (f.n.dot(seed.n) >= cosTol) s += f.proj; if (s > best) best = s; }
  return { share: best / tot, area: tot };
}
function dims(g) {
  const p = g.attributes.position;
  let yMax = -1e9, yMin = 1e9, rMax = 0, vol = 0;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    yMax = Math.max(yMax, v.y); yMin = Math.min(yMin, v.y); rMax = Math.max(rMax, Math.hypot(v.x, v.z));
  }
  for (let t = 0; t < p.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, t * 3);
    const b = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 2);
    vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  return { half: (yMax - yMin) / 2, rMax, aspect: (yMax - yMin) / 2 / rMax, vol: Math.abs(vol), tris: p.count / 3 };
}

const vd = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const CL = { flat: 0.42, bevel: 24, variants: 8, sink: [0.54, 0.98] };

function measure(bLo, bSp, comp) {
  const rows = []; let H = 0, R = 0, A = 0, V = 0, T = 0;
  for (let v = 0; v < CL.variants; v++) {
    const g = clast(7717 + v * 17, CL.flat, CL.bevel, bLo, bSp, comp);
    const d = dims(g); H += d.half; R += d.rMax; A += d.aspect; V += d.vol; T += d.tris;
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
  const n = CL.variants;
  return {
    mean: 100 * big.reduce((s, r) => s + r.share, 0) / big.length,
    over: 100 * big.filter((r) => r.share > 0.55).length / big.length,
    half: H / n, rMax: R / n, aspect: A / n, vol: V / n, tris: T / n,
  };
}

const base = measure(0.99, 0.24, 1);
console.log(`cobble: bevel jitter widened, then rescaled to shipped size  (depression ${DEPRESSION} deg)`);
console.log('');
console.log('  bevel j           comp   10deg face  >55%  | half    rMax   aspect  vol    tris');
console.log(`  0.99 + r*0.24     1.000     ${base.mean.toFixed(0).padStart(3)}%     ${base.over.toFixed(0).padStart(3)}%  | ${base.half.toFixed(3)}  ${base.rMax.toFixed(3)}  ${base.aspect.toFixed(3)}  ${base.vol.toFixed(3)}  ${base.tris.toFixed(0)}   (shipped)`);
for (const [lo, sp] of [[0.86, 0.50], [0.78, 0.66], [0.70, 0.82]]) {
  // solve comp so mean half-height matches shipped
  let comp = 1;
  for (let it = 0; it < 6; it++) { const m = measure(lo, sp, comp); comp *= base.half / m.half; }
  const m = measure(lo, sp, comp);
  const d = (x, b) => { const p = 100 * (x / b - 1); return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`; };
  console.log(`  ${lo.toFixed(2)} + r*${sp.toFixed(2)}     ${comp.toFixed(3)}     ${m.mean.toFixed(0).padStart(3)}%     ${m.over.toFixed(0).padStart(3)}%  | ${m.half.toFixed(3)}  ${m.rMax.toFixed(3)}  ${m.aspect.toFixed(3)}  ${m.vol.toFixed(3)}  ${m.tris.toFixed(0)}`);
  console.log(`                                                 | ${d(m.half, base.half).padStart(6)}  ${d(m.rMax, base.rMax).padStart(6)}  ${d(m.aspect, base.aspect).padStart(6)}  ${d(m.vol, base.vol).padStart(6)}`);
}
