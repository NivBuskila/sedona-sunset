/* Sizing a mid-scale detail normal on the clast top: gain against trap.
 *
 * The clast already carries a grit normal, but it is footprint-locked to about
 * one texel per pixel - grain scale, a millimetre or two. That adds texture and
 * cannot change a *perceived facet orientation*, because the eye groups by
 * normal direction over a patch and pixel-scale noise averages out inside the
 * patch. Between grain and the hull's gross facets there is nothing, and
 * centimetre-scale relief is precisely what fractured sandstone has: spall
 * scars, conchoidal steps, bedding relief.
 *
 * _perceface.mjs measured the target: the eye merges inside about ten degrees,
 * and a majority of large stones present one face over half their visible cap.
 * So the detail normal has to carry angular variation ABOVE ten degrees at
 * centimetre scale. Roughness is not enough; amplitude at the right scale is
 * the whole requirement.
 *
 * The opposing constraint is the binary-field trap on record: at a 15 degree
 * sun a tangent slope of 0.8 RMS swings a texel from lit to shadowed, hf/lf
 * improves, and the surface reads as salt and pepper. _gritn.mjs guards the
 * grain layer that way and the predictor that agreed with the eye when two
 * others did not was the terminator-crossing fraction.
 *
 * So this measures both against one parameter, per-sample rather than
 * per-triangle because a smooth field varies WITHIN a facet:
 *   - rasterise the visible cap, take a shading normal per sample
 *   - largest share of samples inside a 10 degree cone   (the gain)
 *   - share of samples driven past the terminator at 15 deg sun  (the trap)
 *
 *   node tools/_detnorm.mjs [--depression 20] [--sun 15]
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const DEPRESSION = arg('depression', 20);
const SUN_EL = arg('sun', 15);
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

/* value noise, gradient by central difference - stands in for whatever the
   shipped field ends up being; what is being sized here is amplitude and
   scale, not the particular basis */
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const wt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    r += wt * hash3(xi + dx, yi + dy, zi + dz);
  }
  return r * 2 - 1;
}
function fbm(x, y, z) { return vnoise(x, y, z) * 0.62 + vnoise(x * 2.03, y * 2.03, z * 2.03) * 0.38; }

/* The raw finite-difference gradient of fbm scales with `scale`, so a bare
   multiplier is not a slope and cannot be ranked against a trap stated in
   slopes. Normalise per scale so the parameter IS the delivered RMS tangent
   slope, which is what _gritn.mjs guards and what the eye agreed with. */
const GNORM = new Map();
function gradNorm(scale) {
  if (GNORM.has(scale)) return GNORM.get(scale);
  let s2 = 0; const N = 6000; const e = 0.35 / scale;
  for (let i = 0; i < N; i++) {
    const x = Math.random() * 10, y = Math.random() * 10, z = Math.random() * 10;
    const f0 = fbm(x * scale, y * scale, z * scale);
    const gx = (fbm((x + e) * scale, y * scale, z * scale) - f0) / e;
    const gz = (fbm(x * scale, y * scale, (z + e) * scale) - f0) / e;
    s2 += gx * gx + gz * gz;
  }
  const k = 1 / Math.sqrt(s2 / N);
  GNORM.set(scale, k); return k;
}

/* sample the visible cap and return per-sample shading normals */
function samples(g, sink, axis, tilt, vd, amp, scale) {
  const m = new THREE.Matrix4().makeRotationAxis(axis, tilt);
  m.premultiply(new THREE.Matrix4().makeTranslation(0, -sink, 0));
  const p = g.attributes.position;
  const out = [];
  for (let t = 0; t < p.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(p, t * 3).applyMatrix4(m);
    const b = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 1).applyMatrix4(m);
    const c = new THREE.Vector3().fromBufferAttribute(p, t * 3 + 2).applyMatrix4(m);
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-20) continue;
    const area2 = n.length(); n.normalize();
    if (n.dot(vd) >= 0) continue;
    const nSamp = Math.max(2, Math.round(area2 * 220));
    for (let s = 0; s < nSamp; s++) {
      let u = Math.random(), v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const px = a.x + u * (b.x - a.x) + v * (c.x - a.x);
      const py = a.y + u * (b.y - a.y) + v * (c.y - a.y);
      const pz = a.z + u * (b.z - a.z) + v * (c.z - a.z);
      if (py < 0) continue;
      let sn = n;
      if (amp > 0) {
        const e = 0.35 / scale, kN = gradNorm(scale);
        const f0 = fbm(px * scale, py * scale, pz * scale);
        const gx = kN * (fbm((px + e) * scale, py * scale, pz * scale) - f0) / e;
        const gz = kN * (fbm(px * scale, py * scale, (pz + e) * scale) - f0) / e;
        const tAxv = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const tT = new THREE.Vector3().crossVectors(tAxv, n).normalize();
        const tB = new THREE.Vector3().crossVectors(n, tT);
        sn = n.clone().addScaledVector(tT, amp * gx).addScaledVector(tB, amp * gz).normalize();
      }
      out.push({ n: sn, w: 1 });
    }
  }
  return out;
}

const vd = new THREE.Vector3(0, -Math.sin(DEPRESSION * Math.PI / 180), -Math.cos(DEPRESSION * Math.PI / 180)).normalize();
/* sun: 15 deg elevation, coming across the view */
const sun = new THREE.Vector3(Math.cos(SUN_EL * Math.PI / 180), Math.sin(SUN_EL * Math.PI / 180), 0).normalize();
const cos10 = Math.cos(10 * Math.PI / 180);

const CL = { flat: 0.42, bevel: 24, variants: 5, sink: [0.54, 0.98] };
/* a cobble is 0.14-0.38 m across and the hull is ~1.5 units wide, so one unit
   is about 0.16 m; a scale of S cycles/unit puts features at 0.16/S metres */
console.log(`mid-scale detail normal on cobble: gain against trap`);
console.log(`camera ${DEPRESSION} deg, sun ${SUN_EL} deg. Trap on record: RMS tangent slope 0.8.`);
console.log('');
console.log('  amp   scale  feature   largest 10deg   RMS     past        within');
console.log('              size      face (big qtr)  slope   terminator  3 deg');
for (const [amp, scale] of [[0, 0], [0.06, 5], [0.10, 5], [0.16, 5], [0.24, 5], [0.10, 9], [0.16, 9], [0.24, 9], [0.34, 9], [0.16, 16], [0.24, 16], [0.34, 16]]) {
  const rows = []; let s2 = 0, nS = 0, dark = 0, graz = 0;
  for (let v = 0; v < CL.variants; v++) {
    const g = clast(7717 + v * 17, CL.flat, CL.bevel);
    const rand = rng(991 + v);
    for (let k = 0; k < 60; k++) {
      const hT = CL.flat;
      let sink = hT * (CL.sink[0] + rand() * (CL.sink[1] - CL.sink[0]));
      sink = Math.min(Math.max(sink, hT * 0.34), hT * 0.95);
      const tilt = Math.min(Math.pow(rand(), 1.6) * 0.60, Math.atan2(hT * 1.7, 1.0));
      const ta = rand() * Math.PI * 2;
      const sm = samples(g, sink, new THREE.Vector3(Math.cos(ta), 0, Math.sin(ta)), tilt, vd, amp, scale);
      if (sm.length < 12) continue;
      let best = 0;
      const step = Math.max(1, Math.floor(sm.length / 48));
      for (let i = 0; i < sm.length; i += step) {
        let c = 0;
        for (const q of sm) if (q.n.dot(sm[i].n) >= cos10) c++;
        if (c > best) best = c;
      }
      rows.push({ share: best / sm.length, area: sm.length });
      for (const q of sm) {
        const ndl = q.n.dot(sun);
        if (ndl <= 0) dark++; else if (ndl < 0.05) graz++;
        nS++;
      }
    }
  }
  // RMS tangent slope of the field itself, independent of geometry
  if (amp > 0) {
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 10, y = Math.random() * 10, z = Math.random() * 10;
      const e = 0.35 / scale, kN = gradNorm(scale);
      const f0 = fbm(x * scale, y * scale, z * scale);
      const gx = amp * kN * (fbm((x + e) * scale, y * scale, z * scale) - f0) / e;
      const gz = amp * kN * (fbm(x * scale, y * scale, (z + e) * scale) - f0) / e;
      s2 += gx * gx + gz * gz;
    }
    s2 = Math.sqrt(s2 / 4000);
  }
  const areas = rows.map((r) => r.area).sort((a, b) => a - b);
  const cut = areas[Math.floor(0.75 * (areas.length - 1))];
  const big = rows.filter((r) => r.area >= cut);
  const mean = 100 * big.reduce((s, r) => s + r.share, 0) / big.length;
  const feat = scale ? `${(0.16 / scale * 100).toFixed(1)}cm` : '   -';
  const flag = s2 >= 0.8 ? '  <-- TRAP' : '';
  console.log(`  ${amp.toFixed(2)}  ${String(scale).padStart(5)}  ${feat.padStart(7)}      ${mean.toFixed(0).padStart(3)}%        ${s2.toFixed(2)}    ${(100 * dark / nS).toFixed(1).padStart(5)}%      ${(100 * graz / nS).toFixed(1).padStart(5)}%${flag}${amp === 0 ? '   (shipped)' : ''}`);
}
