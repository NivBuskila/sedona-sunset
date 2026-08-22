/* WHICH stones populate the >55% tail? Big ones, or slivers?
 *
 * _flattail.mjs reports 3.4% of seatings presenting one plane at over 55% of
 * their visible area, and I recommended against a fix on the strength of that
 * number not moving. Before spending a population-level change on it, the
 * number needs one more cut, because it may be measuring the wrong stones.
 *
 * sink runs to 0.95 of the vertical half-extent. A cobble at that depth shows
 * about 5% of a half-height - a sliver whose visible cap is ONE facet by
 * construction, scoring near 100% while covering almost no pixels. If the tail
 * is made of those, it is an artefact: no perturbation of the top face can
 * break a cap that is a single facet because there is no room for a second one,
 * and nobody can see it anyway.
 *
 * This is the same error I diagnosed this afternoon, one level up. I weighted by
 * projected area WITHIN a stone and then treated every stone equally ACROSS the
 * population. The general form: a shape statistic must be taken over the visible
 * population weighted by projected area, and "visible population" means both
 * which part of each object shows AND how much of the frame each object gets.
 *
 * Reports the tail split by how much screen area the stone actually covers.
 *
 *   node tools/_tailwho.mjs [--depression 20]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(s0) { let s = s0 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

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
function seat(g, sink, axis, tilt, vd) {
  const m = new THREE.Matrix4().makeRotationAxis(axis, tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));
  const p = g.attributes.position; const planes = []; let tot = 0;
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
      const pr = ar * Math.abs(n.dot(vd)); tot += pr;
      const d = n.dot(ct[0]);
      const h = planes.find((q) => q.n.dot(n) > 0.9995 && Math.abs(q.d - d) < 1e-5);
      if (h) h.proj += pr; else planes.push({ n: n.clone(), d, proj: pr });
    }
  }
  if (!planes.length || tot <= 0) return null;
  planes.sort((a, b) => b.proj - a.proj);
  return { share: planes[0].proj / tot, area: tot };
}

const vd = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
const rows = [];
for (let v = 0; v < 4; v++) {
  const g = clast(7717 + v * 17, 0.42, 24);
  const rand = rng(991 + v);
  for (let k = 0; k < 400; k++) {
    const hT = 0.42;
    let sink = hT * (0.54 + rand() * 0.44);
    sink = Math.min(Math.max(sink, hT * 0.34), hT * 0.95);
    const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, Math.atan2(hT * 1.7, 1.0));
    const ta = rand() * Math.PI * 2;
    const r = seat(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, vd);
    if (r) rows.push({ ...r, sinkFrac: sink / hT });
  }
}
const areas = rows.map((r) => r.area).sort((a, b) => a - b);
const q = (f) => areas[Math.floor(f * (areas.length - 1))];

console.log('who is in the >55% tail?   (cobble, 1600 seatings)');
console.log('');
console.log('  screen area of the stone      n     >55%    mean sink   share of');
console.log('  (quartile of projected)                    (of hTrue)   all tail');
const tailAll = rows.filter((r) => r.share > 0.55).length;
const cuts = [[0, 0.25, 'smallest quarter'], [0.25, 0.5, 'second quarter'], [0.5, 0.75, 'third quarter'], [0.75, 1.01, 'LARGEST quarter']];
for (const [lo, hi, name] of cuts) {
  const a0 = q(lo), a1 = hi > 1 ? Infinity : q(hi);
  const sub = rows.filter((r) => r.area >= a0 && r.area < a1);
  const t = sub.filter((r) => r.share > 0.55);
  const ms = sub.reduce((s, r) => s + r.sinkFrac, 0) / Math.max(sub.length, 1);
  console.log(`  ${name.padEnd(28)} ${String(sub.length).padStart(4)}   ${(100 * t.length / Math.max(sub.length, 1)).toFixed(1).padStart(5)}%     ${ms.toFixed(2)}       ${(100 * t.length / Math.max(tailAll, 1)).toFixed(0).padStart(3)}%`);
}
console.log('');
const big = rows.filter((r) => r.area >= q(0.75));
const bigTail = big.filter((r) => r.share > 0.55);
console.log(`overall >55% tail: ${(100 * tailAll / rows.length).toFixed(1)}%   of the largest quarter: ${(100 * bigTail.length / big.length).toFixed(1)}%`);
console.log('');
console.log('If the tail is concentrated in the smallest quarter it is deeply buried');
console.log('slivers - one facet because there is no room for two - and no top-face');
console.log('perturbation can touch it. If it is in the largest quarter it is the');
console.log('stones the critic is actually looking at, and it is worth breaking.');
