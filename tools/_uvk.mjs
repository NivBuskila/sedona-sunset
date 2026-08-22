/* _uvk.mjs — what screen period does the clast base-map tiling predict?
 *
 *   node tools/_uvk.mjs [view]
 *
 * scatter.js:626 tiles every clast's albedo, normal and roughness map across
 * the hull a fixed number of times:
 *
 *     float uvK = clamp(iRad * 34.0, 1.0, 18.0);   vMapUv *= uvK;
 *
 * That is a count *per object*, not per world metre and not per pixel. So a
 * clast carries the same number of map repeats across itself at every range,
 * its screen period is its screen size divided by that count, and nothing in
 * the grit layer - octave, LOD or scale - can move it. Which is the signature
 * the ablations kept failing to shift.
 *
 * This prints the count and the period it implies, so the hypothesis can be
 * checked against `_lattice.mjs` before spending a render on it. Pure CPU:
 * buildScatter and the projection arithmetic from the vertex shader, verbatim.
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildScatter } = await import('../src/scatter.js');
const { VIEWS } = await import('./views.mjs');

const VIEW = process.argv[2] ?? 'ground';
const v = VIEWS.find((q) => q.name === VIEW);
if (!v) { console.error(`no view ${VIEW}`); process.exit(2); }

const VPH = 900, VPW = 1600, FOV = 58;

const path = new WashPath(), terrain = new Terrain(path);
const oneTexel = { image: { data: new Uint8Array([128, 96, 72, 255]) } };
const tex = {
  rock: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  dirt: { albedo: oneTexel }, clast: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  macro: oneTexel, variance: oneTexel, grit: oneTexel,
};
const meshes = buildScatter(terrain, tex);

/* The capture camera, as views.mjs specifies it. */
const eye = path.posAt(v.d).clone();
eye.y = terrain.heightAt(eye.x, eye.z) + 1.6;
const yaw = v.yaw * Math.PI / 180, pitch = v.pitch * Math.PI / 180;
const fwd = new THREE.Vector3(
  Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const proj11 = 1 / Math.tan(FOV * Math.PI / 360);

/* Full screen projection, so the answer is about the instance under the band
   that was actually measured rather than about whatever is largest somewhere. */
const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
const aspect = VPW / VPH;

const BAND = { x0: 30, y0: 500, x1: 200, y1: 625 };

const m4 = new THREE.Matrix4(), pos = new THREE.Vector3();
const rows = [];
for (const im of meshes) {
  if (!im.isInstancedMesh) continue;
  for (let i = 0; i < im.count; i++) {
    im.getMatrixAt(i, m4);
    pos.setFromMatrixPosition(m4);
    const rel = pos.clone().sub(eye);
    const z = rel.dot(fwd);
    if (z < 0.3 || z > 20) continue;
    const ndcX = (rel.dot(right) / z) * proj11 / aspect;
    const ndcY = (rel.dot(up) / z) * proj11;
    const sx = (ndcX * 0.5 + 0.5) * VPW, sy = (0.5 - ndcY * 0.5) * VPH;
    /* iRad is the length of the instance matrix's first column, verbatim. */
    const iRad = new THREE.Vector3().setFromMatrixColumn(m4, 0).length();
    const px = 0.5 * VPH * proj11 * iRad / Math.max(z, 0.05);
    if (sx + px < 0 || sx - px > VPW || sy + px < 0 || sy - px > VPH) continue;
    const uvK = Math.min(18, Math.max(1, iRad * 34));
    /* Does the instance's screen disc cover the measured band? */
    const cx = (BAND.x0 + BAND.x1) / 2, cy = (BAND.y0 + BAND.y1) / 2;
    const covers = Math.hypot(sx - cx, sy - cy) < px;
    rows.push({ name: im.name, z, iRad, px, uvK, sx, sy, covers, period: 2 * px / uvK });
  }
}

console.log(`view ${VIEW}, ${VPW}x${VPH}, fov ${FOV}`);
console.log(`measured band ${BAND.x0},${BAND.y0}-${BAND.x1},${BAND.y1}\n`);
console.log('instances whose screen disc covers that band, largest first');
console.log('period = screen diameter / uvK, i.e. one repeat of the base maps\n');
console.log('mesh          range    iRad     centre      screen dia   uvK   tile period');
const hits = rows.filter((r) => r.covers).sort((a, b) => b.px - a.px);
for (const r of hits.slice(0, 10)) {
  console.log(`${r.name.padEnd(12)} ${r.z.toFixed(2).padStart(5)} m ${r.iRad.toFixed(3)} m ` +
    `${r.sx.toFixed(0).padStart(5)},${r.sy.toFixed(0).padStart(4)} ${(2 * r.px).toFixed(0).padStart(8)} px ` +
    `${r.uvK.toFixed(1).padStart(5)}  ${r.period.toFixed(1).padStart(6)} px`);
}
if (!hits.length) console.log('  (none — the band is not covered by any clast disc)');
console.log('\n_lattice.mjs measured 19.0, 28.3, 30.1 and 34.5 px on that band.');
