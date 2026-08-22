/* The skyline a station actually sees, off the built mesh, in two seconds.
 *
 * Why this exists. The shade_far "mesa" with the ruler-straight rim is wallL seen
 * end-on, and the obvious fix - make the crest step between bed tops more often
 * along the wall - was landed and measured on the crest itself: eight steps of 3
 * to 11 m over two hundred metres. It did almost nothing to the frame, and the
 * reason is geometry rather than amplitude.
 *
 * Square-on, one screen column is one station and the crest profile *is* the
 * skyline. End-on, one screen column spans tens of metres of wall, and the
 * skyline is the *upper envelope* of the crest over every station in that column.
 * An envelope of a notched profile is set by the un-notched stations, so a
 * subtractive notch of any depth is invisible unless it is wider than the bin. A
 * ripple cannot break an end-on skyline; only something as long as the view is
 * wide can.
 *
 * So measure the envelope, not the profile. Every vertex of the mesh, binned by
 * bearing from the eye, maximum elevation angle per bin. That is exactly what the
 * silhouette will be, it needs no render, and it makes this iterable in seconds
 * against the nine-minute captures that stopped the last two attempts at the
 * wash head.
 *
 *   node tools/_skyenv.mjs shade_far wallL
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildWalls } = await import('../src/rock.js');
const { VIEWS } = await import('./views.mjs');

const viewName = process.argv[2] || 'shade_far';
const which = process.argv[3] || 'wallL';
const v = VIEWS.find((q) => q.name === viewName);
if (!v) { console.log(`no view ${viewName}`); process.exit(1); }

const path = new WashPath(), terrain = new Terrain(path);
const eye = path.posAt(v.d).clone();
eye.y = terrain.heightAt(eye.x, eye.z) + 1.65;

/* The station's own bearing, so the bins can be reported as degrees off the view
   axis rather than as compass angles nobody can place. */
const yaw = (v.yaw * Math.PI) / 180;
const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
const axis = Math.atan2(fwd.x, -fwd.z);

const mesh = buildWalls(path, terrain, {}).find((m) => m.name === which);
const pos = mesh.geometry.getAttribute('position');

/* Half a degree per bin, which at 2560 px across a 50 degree frame is about
   twenty-five pixels — fine enough to see a step and coarse enough that a single
   stray vertex cannot make one. */
const BIN = 0.5;
const bins = new Map();
for (let i = 0; i < pos.count; i++) {
  const dx = pos.getX(i) - eye.x, dz = pos.getZ(i) - eye.z, dy = pos.getY(i) - eye.y;
  const r = Math.hypot(dx, dz);
  if (r < 3) continue;
  let b = ((Math.atan2(dx, -dz) - axis) * 180) / Math.PI;
  while (b > 180) b -= 360;
  while (b < -180) b += 360;
  const k = Math.round(b / BIN) * BIN;
  const el = (Math.atan2(dy, r) * 180) / Math.PI;
  const cur = bins.get(k);
  if (!cur || el > cur.el) bins.set(k, { el, r, y: pos.getY(i) });
}

const keys = [...bins.keys()].filter((k) => Math.abs(k) <= 30).sort((a, b) => a - b);
let prev = null, steps = 0, run = 0, longest = 0;
console.log(`${viewName} (d ${v.d}, yaw ${v.yaw}) -> ${which}   eye y ${eye.y.toFixed(2)}`);
console.log('  bearing   skyline el   range   crest y');
for (const k of keys) {
  const b = bins.get(k);
  const d = prev === null ? 0 : b.el - prev;
  if (Math.abs(d) < 0.20) { run++; longest = Math.max(longest, run); } else { steps++; run = 0; }
  console.log(`  ${k.toFixed(1).padStart(6)}    ${b.el.toFixed(2).padStart(7)}   `
    + `${b.r.toFixed(0).padStart(5)} m  ${b.y.toFixed(1).padStart(6)}`
    + (Math.abs(d) >= 0.5 ? '   <- step' : ''));
  prev = b.el;
}
console.log(`\n  ${steps} envelope steps over ${keys.length} bins, `
  + `longest flat run ${(longest * BIN).toFixed(1)} deg`);
