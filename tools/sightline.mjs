/* Is the hero juniper's root collar actually visible from the capture viewpoint?
 *
 *   node tools/sightline.mjs
 *
 * A reviewer could not find the collar at 14x magnification and read every member
 * of the tree as one gauge. Half of that was a real bug — the mound had grown
 * until it buried 0.19 m of a 0.30 m collar — but fixing the geometry only helps
 * if the collar is in the frame, and this scene's terrain is owned by other
 * systems and has been reshaped twice underneath a hard-coded tree position.
 *
 * So: march the ray from the camera to the base of the tree and report the first
 * place the terrain rises above it. Cheap, node-only, no render, and it answers a
 * question that a six-minute capture answers ambiguously — a collar that is dark
 * and a collar that is behind a bank look the same in a shot.
 */
import { Terrain } from '../src/terrain.js';
import { WashPath } from '../src/path.js';
import { JUNIPER_XZ, moundAt } from '../src/juniper.js';

const path = new WashPath();
const terrain = new Terrain(path);

/* The `juniper` view from tools/shoot.mjs, and the eye height main.js walks at. */
const D = 62, YAW = 34, PITCH = 3, EYE = 1.62;
const c = path.posAt(D);
const q = path.atZ(c.z, {});
/* walkTo puts the camera on the path centre line; lookAt is relative to the
   path's own heading, which is what makes a yaw of 34 degrees mean anything. */
const eye = {
  x: c.x, y: terrain.heightAt(c.x, c.z) + EYE, z: c.z,
};

const base = {
  x: JUNIPER_XZ.x,
  y: terrain.heightAt(JUNIPER_XZ.x, JUNIPER_XZ.z) + moundAt(0),
  z: JUNIPER_XZ.z,
};

const dx = base.x - eye.x, dz = base.z - eye.z;
const dist = Math.hypot(dx, dz);
console.log(`camera   (${eye.x.toFixed(2)}, ${eye.y.toFixed(2)}, ${eye.z.toFixed(2)})`);
console.log(`collar   (${base.x.toFixed(2)}, ${base.y.toFixed(2)}, ${base.z.toFixed(2)})`);
console.log(`range    ${dist.toFixed(1)} m   path heading ${(q.th * 180 / Math.PI).toFixed(1)} deg,` +
            ` view yaw ${YAW} pitch ${PITCH}`);

/* March, and report the worst blocker as a height above the sight line. */
let worst = -1e9, worstAt = 0;
const STEP = 0.25;
for (let s = STEP; s < dist - 0.2; s += STEP) {
  const t = s / dist;
  const x = eye.x + dx * t, z = eye.z + dz * t;
  const ray = eye.y + (base.y - eye.y) * t;
  const g = terrain.heightAt(x, z);
  if (g - ray > worst) { worst = g - ray; worstAt = s; }
}
console.log(`\nworst intrusion  ${worst >= 0 ? '+' : ''}${worst.toFixed(3)} m` +
            ` at ${worstAt.toFixed(1)} m from the camera`);

/* And how much of the tree, measured up from the collar, clears that blocker. */
if (worst > 0) {
  const t = worstAt / dist;
  const gAt = terrain.heightAt(eye.x + dx * t, eye.z + dz * t);
  /* Extend the eye-to-blocker line to the tree and see where it lands on it. */
  const hidden = eye.y + (gAt - eye.y) / t - base.y;
  console.log(`the terrain hides the bottom ${hidden.toFixed(2)} m of the tree`);
  console.log(worst > 0.02
    ? 'BLOCKED — the collar is not in the frame however thick it is'
    : 'grazing — the collar is on the horizon line, marginal');
} else {
  console.log(`clear by ${(-worst).toFixed(3)} m — the collar is in the frame`);
}
