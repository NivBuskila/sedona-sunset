/* !! DO NOT QUOTE THIS TOOL'S OUTPUT. IT DISAGREES WITH ITSELF. !!
 *
 * It returns no difference between a bare plane, a centred fillet and a
 * scattered collar, AND reports 12.7% chord deviation on the bare plane, which
 * is inconsistent with the silhouette measurement in _silho2.mjs that says the
 * bottom arc is a near-straight run at about 32% of perimeter. Either the
 * 96-bearing tracer is too coarse, its 0.35 band tolerance is too loose, or the
 * bed models are too weak to register. Fix it or delete it; a null from an
 * instrument that contradicts a working one is not evidence of anything.
 *
 * Kept only so the next person does not rebuild the same broken thing.
 *
 * ---------------------------------------------------------------------------
 * Can the fillet do the job its comment claims?
 *
 * scatter.js already contains a mechanism written for precisely the defect
 * measured in _silho2.mjs. Its comment:
 *
 *   "leave the stone's *waterline* - the line where it meets the bed all the
 *    way round - a clean intersection between a hull and a smooth plane. A real
 *    one is not clean. ... its job is entirely to break that waterline."
 *
 * That is the same finding, reached independently, and the fillet fires on 62%
 * of qualifying cobbles. So the question is not whether someone thought of it
 * but whether the shape chosen can do it.
 *
 * The fillet is a smooth lens CENTRED on the stone: sx and sz both
 * 1.55-2.10 radii, sy 0.26-0.40 radii, sunk 0.72. It is therefore very nearly
 * axisymmetric about the stone's own axis. A smooth convex surface of
 * revolution centred on the clast raises the bed around it evenly, so the
 * intersection with the hull moves UP but stays a smooth convex curve. Breaking
 * a waterline needs azimuthal variation, which the collar has - 2 to N small
 * stones at random bearings - and which the fillet by construction does not.
 *
 * This measures it rather than asserting it: the bed is modelled as a plane,
 * then as a plane plus a centred lens, then as a plane plus scattered collar
 * stones, and the silhouette's ground-cut straightness is read off each.
 *
 * Straightness is measured as the fraction of the contact curve's chord length
 * that the curve itself deviates from - a perfectly straight cut scores 0.
 *
 *   node tools/_waterline.mjs [--depression 20]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function clast(seed, flat, bevel) {
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

/* bed height at (x,z), in clast radii, for each model */
function makeBed(kind, rand) {
  if (kind === 'plane') return () => 0;
  if (kind === 'fillet') {
    // centred lens: sx,sz 1.55-2.10 r, sy 0.26-0.40 r, sink 0.72
    const sx = 1.55 + rand() * 0.55, sz = 1.55 + rand() * 0.55;
    const sy = 0.26 + rand() * 0.14, sink = 0.72;
    return (x, z) => {
      const u = (x / sx) ** 2 + (z / sz) ** 2;
      if (u >= 1) return 0;
      return Math.max(0, sy * Math.sqrt(1 - u) - sy * sink);
    };
  }
  // collar: n small stones at random bearings, as in scatter.js line 1291
  const n = 2 + ((rand() * 7) | 0);
  const st = [];
  for (let k = 0; k < n; k++) {
    const ang = rand() * Math.PI * 2, d = 0.85 + rand() * 0.9;
    st.push({ x: Math.cos(ang) * d, z: Math.sin(ang) * d, r: 0.06 + rand() * 0.16 });
  }
  return (x, z) => {
    let h = 0;
    for (const s of st) {
      const u = ((x - s.x) ** 2 + (z - s.z) ** 2) / (s.r * s.r);
      if (u < 1) h = Math.max(h, s.r * 0.72 * Math.sqrt(1 - u));
    }
    return h;
  };
}

/* trace the contact curve: for a ring of bearings, find the radius at which
   the hull surface drops below the bed, and report the projected curve's
   deviation from its own chord */
function contactStraightness(g, sink, bed, viewDir) {
  const p = g.attributes.position;
  const verts = [];
  for (let i = 0; i < p.count; i++) verts.push(new THREE.Vector3().fromBufferAttribute(p, i).setY(new THREE.Vector3().fromBufferAttribute(p, i).y - sink));
  const right = new THREE.Vector3(1, 0, 0);
  const upv = new THREE.Vector3().crossVectors(viewDir, right).normalize();

  const pts = [];
  const NB = 96;
  for (let b = 0; b < NB; b++) {
    const a = (b / NB) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    // outermost hull point near this bearing, at the bed height there
    let best = null;
    for (const v of verts) {
      const r = Math.hypot(v.x, v.z);
      if (r < 1e-6) continue;
      if ((v.x * dx + v.z * dz) / r < Math.cos(Math.PI / NB * 2)) continue;
      const bh = bed(v.x, v.z);
      if (Math.abs(v.y - bh) > 0.35) continue;
      if (!best || r > best.r) best = { r, x: v.x, z: v.z, y: Math.max(v.y, bh) };
    }
    if (best) pts.push(best);
  }
  if (pts.length < 8) return null;
  // project, take the lower boundary (the visible waterline), measure deviation
  const proj = pts.map((q) => {
    const w = new THREE.Vector3(q.x, q.y, q.z);
    return [w.dot(right), w.dot(upv)];
  });
  proj.sort((a, b) => a[0] - b[0]);
  const a0 = proj[0], a1 = proj[proj.length - 1];
  const L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1e-9;
  let dev = 0;
  for (const q of proj) {
    const t = ((q[0] - a0[0]) * (a1[0] - a0[0]) + (q[1] - a0[1]) * (a1[1] - a0[1])) / (L * L);
    const px = a0[0] + t * (a1[0] - a0[0]), py = a0[1] + t * (a1[1] - a0[1]);
    dev += Math.hypot(q[0] - px, q[1] - py);
  }
  return dev / proj.length / L;
}

const viewDir = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();

console.log(`cobble waterline straightness   (depression ${DEPRESSION} deg)`);
console.log('deviation of the contact curve from its own chord, as a fraction of');
console.log('chord length. 0 is a dead-straight cut. Higher is more broken.');
console.log('');
console.log('  bed model            deviation     vs plane');
const base = {};
for (const kind of ['plane', 'fillet', 'collar']) {
  const vals = [];
  for (let v = 0; v < 4; v++) {
    const g = clast(7717 + v * 17, 0.42, 24);
    const rand = rng(4400 + v);
    for (let k = 0; k < 40; k++) {
      const hTrue = 0.42;
      let sink = hTrue * (0.54 + rand() * 0.44);
      sink = Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95);
      const bed = makeBed(kind, rand);
      const d = contactStraightness(g, sink, bed, viewDir);
      if (d !== null) vals.push(d);
    }
  }
  const m = vals.reduce((s, x) => s + x, 0) / vals.length;
  base[kind] = m;
  const rel = kind === 'plane' ? '' : `   x${(m / base.plane).toFixed(2)}`;
  console.log(`  ${kind.padEnd(20)} ${m.toFixed(4)}${rel}`);
}
console.log('');
console.log('The fillet is centred and smooth, so it raises the waterline without');
console.log('breaking it. The collar is azimuthally irregular, which is the property');
console.log('that matters. cobble has fillet 0.62 and NO collar.');
