/* What does the camera at far_320 actually see where the wash head should be?
 *
 * The critic reads the arrival as "a low rounded gravel mound, not a canyon
 * head — no pour-over, no amphitheatre, no cliff". There is a measured 24 m
 * amphitheatre authored there, so before anyone rebuilds a landform the
 * question to answer is which of three things is true: the camera is not
 * looking at it, the sun-bearing col lowered it into a mound, or something is
 * still in front of it. This answers that offline, in seconds, with no render.
 *
 * It marches the ground along the view ray and reports the elevation angle of
 * each sample above the eye's horizontal. The head is *visible as a headwall*
 * only if that angle rises to something the eye reads as a wall; if the profile
 * is monotone and shallow, the landform is a ramp from here whatever its
 * cross-section says.
 */
import { Terrain } from '../src/terrain.js';
import { WashPath } from '../src/path.js';
import { die, finite } from './argcheck.mjs';

const D = finite('station', process.argv[2], 320);
const YAW_OFF = finite('yaw offset degrees', process.argv[3], 0) * Math.PI / 180;
const EYE = 1.62;

const path = new WashPath();
const terrain = new Terrain(path);
const h = (x, z) => terrain.heightAt(x, z);

const p = path.posAt(D);
const eyeY = h(p.x, p.z) + EYE;
const yaw = path.headingAt(D) + YAW_OFF;
/* Same convention as syncCamera: yaw 0 looks along the path heading. */
const dx = Math.sin(yaw), dz = -Math.cos(yaw);

console.log(`far_${D}: eye at x ${p.x.toFixed(1)} z ${p.z.toFixed(1)} y ${eyeY.toFixed(2)}, ` +
  `heading ${(yaw * 180 / Math.PI).toFixed(1)} deg`);
console.log(`  range   x       z       ground    above eye   elev deg   skyline`);

let maxElev = -90, maxAt = 0, sky = -90;
const rows = [];
for (let t = 5; t <= 180; t += 5) {
  const x = p.x + dx * t, z = p.z + dz * t;
  const g = h(x, z);
  const rise = g - eyeY;
  const elev = Math.atan2(rise, t) * 180 / Math.PI;
  /* A sample is on the skyline only if nothing nearer stands higher. */
  const onSky = elev > sky + 1e-9;
  if (onSky) sky = elev;
  if (elev > maxElev) { maxElev = elev; maxAt = t; }
  rows.push({ t, x, z, g, rise, elev, onSky });
}
for (const r of rows) {
  console.log(`  ${String(r.t).padStart(5)}  ${r.x.toFixed(1).padStart(6)}  ${r.z.toFixed(1).padStart(7)}  ` +
    `${r.g.toFixed(2).padStart(7)}  ${r.rise.toFixed(2).padStart(9)}  ${r.elev.toFixed(2).padStart(8)}   ${r.onSky ? 'yes' : ''}`);
}

console.log(`\n  highest point on the ray: ${maxElev.toFixed(2)} deg at ${maxAt} m`);
/* far_320 is shot at pitch 4 with a 50 degree vertical field, so the frame
   spans roughly -21 to +29 degrees about the horizontal. */
console.log(`  frame spans about -21 to +29 deg (pitch 4, 50 deg vertical fov)`);
console.log(maxElev < 2
  ? `  => nothing on this bearing rises 2 deg. The head reads as floor from here,\n` +
    `     whatever its cross-section is. This is a sight-line problem, not a shape one.`
  : `  => the head subtends ${maxElev.toFixed(1)} deg, which is ${(maxElev / 50 * 100).toFixed(0)}% of frame height.\n` +
    `     It is in shot, so a flat read is shading, not geometry.`);
