/* The candidate applied to every angular class, with the spike guard.
 *
 * angularClast serves granule, gravel, cobble, pavement, block, slab, boulder
 * and talus, so a change to its bevel jitter is a change to all of them and
 * cobble alone is not evidence. Two past defects came from this exact area -
 * "dozens of thin flat triangular plates standing straight up out of the bench,
 * like glass shards stuck in dirt" and "a paper-thin knife-edged wing floating
 * over the sand" - and both were spikes on thin hulls. Pushing bevel points
 * further out is exactly the move that could bring them back, so the sweep
 * carries a spike metric: the furthest vertex as a multiple of the mean vertex
 * radius. Higher is spikier.
 *
 *   node tools/_bevall.mjs [--depression 20]
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
  for (const s0 of fac) { let s = 0; for (const f of fac) if (f.n.dot(s0.n) >= cosTol) s += f.proj; if (s > best) best = s; }
  return { share: best / tot, area: tot };
}
function dims(g) {
  const p = g.attributes.position;
  let yMax = -1e9, yMin = 1e9, rMax = 0, rSum = 0, n = 0;
  const seen = new Set();
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
    yMax = Math.max(yMax, v.y); yMin = Math.min(yMin, v.y);
    const r = v.length(); rMax = Math.max(rMax, r);
    if (!seen.has(k)) { seen.add(k); rSum += r; n++; }
  }
  let horiz = 0;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    horiz = Math.max(horiz, Math.hypot(v.x, v.z));
  }
  return { half: (yMax - yMin) / 2, rMax: horiz, spike: rMax / (rSum / n), tris: p.count / 3 };
}

const vd = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const CLASSES = [
  { name: 'granule', flat: 0.50, bevel: 20, sink: [0.52, 0.96] },
  { name: 'gravel', flat: 0.54, bevel: 7, sink: [0.52, 0.96] },
  { name: 'cobble', flat: 0.42, bevel: 24, sink: [0.54, 0.98] },
  { name: 'pavement', flat: 0.50, bevel: 26, sink: [0.35, 0.62] },
  { name: 'block', flat: 0.62, bevel: 26, sink: [0.52, 0.94] },
  { name: 'slab', flat: 0.62, bevel: 34, sink: [0.52, 0.94] },
  { name: 'boulder', flat: 0.86, bevel: 38, sink: [0.56, 0.94] },
];
const VARIANTS = 8;

function measure(cl, bLo, bSp, comp) {
  const rows = []; let H = 0, R = 0, S = 0, T = 0;
  for (let v = 0; v < VARIANTS; v++) {
    const g = clast(7717 + v * 17, cl.flat, cl.bevel, bLo, bSp, comp);
    const d = dims(g); H += d.half; R += d.rMax; S += d.spike; T += d.tris;
    const rand = rng(991 + v);
    for (let k = 0; k < 120; k++) {
      const hT = cl.flat;
      let sink = hT * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
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
  return {
    mean: 100 * big.reduce((s, r) => s + r.share, 0) / big.length,
    over: 100 * big.filter((r) => r.share > 0.55).length / big.length,
    half: H / VARIANTS, rMax: R / VARIANTS, spike: S / VARIANTS, tris: T / VARIANTS,
  };
}

console.log(`candidate 0.86 + r*0.50, rescaled per class   (depression ${DEPRESSION} deg)`);
console.log('');
console.log('  class      >55% perceived face   half-h   rMax    spike     tris');
console.log('             shipped -> candidate  delta    delta   ship->cand ship->cand');
let tShip = 0, tCand = 0;
for (const cl of CLASSES) {
  const b = measure(cl, 0.99, 0.24, 1);
  let comp = 1;
  for (let it = 0; it < 6; it++) { const m = measure(cl, 0.86, 0.50, comp); comp *= b.half / m.half; }
  const m = measure(cl, 0.86, 0.50, comp);
  const d = (x, y) => { const p = 100 * (x / y - 1); return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`; };
  tShip += b.tris; tCand += m.tris;
  console.log(`  ${cl.name.padEnd(10)}   ${b.over.toFixed(0).padStart(3)}% -> ${m.over.toFixed(0).padStart(3)}%        ${d(m.half, b.half).padStart(6)}  ${d(m.rMax, b.rMax).padStart(6)}  ${b.spike.toFixed(2)}->${m.spike.toFixed(2)}  ${b.tris.toFixed(0)}->${m.tris.toFixed(0)}   comp ${comp.toFixed(3)}`);
}
console.log('');
console.log(`total tris per variant set: ${tShip.toFixed(0)} -> ${tCand.toFixed(0)}  (${(100 * (tCand / tShip - 1)).toFixed(1)}%)`);
console.log('spike = furthest vertex / mean vertex radius. The shard and knife-edge');
console.log('defects were spikes on thin hulls, so this must not climb.');
