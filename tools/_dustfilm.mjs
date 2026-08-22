/* _dustfilm.mjs — the delivered dust film per clast class, offline.
 *
 *   node tools/_dustfilm.mjs [s1] [halfwidth]
 *
 * `_slabwho.mjs` answered "which class is the pale plate" and prints the raw
 * `dust` weight. This prints the quantity the complaint is actually about: the
 * fraction of the way the shader carries a sky-facing facet toward a constant
 * dust colour, which is
 *
 *     cDust = (0.34 + 0.66 * smoothstep(-0.12, 0.52, n.y)) * min(0.80, 0.42 * dustK)
 *
 * and `dustK` is `aDust` verbatim — the vertex stage packs it as
 * `vSeat = normalize(seat) * (1 + aDust)` and the fragment stage recovers it as
 * `length(vSeat) - 1`. So on the up-facing facet, where the orientation term is
 * 1.0 and where the defect is reported, the delivered film is exactly
 * `min(0.80, 0.42 * aDust)` and is fully determined on the CPU.
 *
 * Reported over the pale tail as well as the whole class, because a mean over a
 * population that is mostly dark lithology hides the instances being complained
 * about - the same reason `_slabwho` reports a tail at all.
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildScatter } = await import('../src/scatter.js');

const S1 = Number(process.argv[2] ?? 100);
const R = Number(process.argv[3] ?? 14);

const path = new WashPath(), terrain = new Terrain(path);
const line = [];
for (let t = 0; t <= S1; t += 2) line.push(path.posAt(t).clone());
const nearWalk = (x, z) => {
  let best = 1e9;
  for (const q of line) { const dd = Math.hypot(x - q.x, z - q.z); if (dd < best) best = dd; }
  return best;
};
/* Same one-texel stand-ins as _slabwho: the build only needs the maps to exist,
   and nothing measured here reads a texel. */
const oneTexel = { image: { data: new Uint8Array([128, 96, 72, 255]) } };
const tex = {
  rock: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  dirt: { albedo: oneTexel }, clast: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  macro: oneTexel, variance: oneTexel, grit: oneTexel,
};
const meshes = buildScatter(terrain, tex);

const film = (d) => Math.min(0.80, 0.42 * d);
const m4 = new THREE.Matrix4(), pos = new THREE.Vector3();
const col = new THREE.Color();

const rows = [];
for (const im of meshes) {
  if (!im.isInstancedMesh) continue;
  const aDust = im.geometry.getAttribute('aDust');
  if (!aDust) continue;
  const all = [], pale = [];
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m4);
    pos.setFromMatrixPosition(m4);
    const s = path.sAt ? path.sAt(pos.x, pos.z) : null;
    if (s !== null && (s.s < 0 || s.s > S1 || Math.abs(s.d) > R)) continue;
    const d = aDust.getX(i);
    all.push(d);
    if (im.instanceColor) {
      col.fromArray(im.instanceColor.array, i * 3);
      const hsl = {}; col.getHSL(hsl);
      if (hsl.s < 0.52) pale.push(d);
    }
  }
  if (!all.length) continue;
  const stat = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return { n: s.length, p50: s[s.length >> 1], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
  };
  rows.push({ name: im.name, a: stat(all), p: stat(pale) });
}

rows.sort((x, y) => (y.p ? film(y.p.max) : 0) - (x.p ? film(x.p.max) : 0));
console.log(`delivered dust film on a sky-facing facet, s 0..${S1} m, |d| < ${R} m`);
console.log('min(0.80, 0.42 * aDust); 0.80 means four fifths of the way to a constant colour\n');
console.log('mesh              n    all p50  all max |  pale n  pale p50  pale p95  pale MAX');
for (const r of rows) {
  const p = r.p;
  console.log(`${r.name.padEnd(14)} ${String(r.a.n).padStart(5)}    ${film(r.a.p50).toFixed(3)}    ${film(r.a.max).toFixed(3)} | ` +
    (p ? `${String(p.n).padStart(6)}     ${film(p.p50).toFixed(3)}     ${film(p.p95).toFixed(3)}     ${film(p.max).toFixed(3)}`
       : '     -         -         -         -'));
}
