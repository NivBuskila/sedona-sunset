/* Where can `butte0` go.
 *
 * Enabling castShadow on the distant buttes fixed a lit-parallelogram defect and
 * exposed a placement one: `butte0` is 148 m of rock at 323 m, its crest reaches
 * 28 degrees, it straddles the sun's bearing, and at 15 degrees of elevation it
 * lays 600 m of shadow straight down the hero canyon. It also hides the disc in
 * two of the four views the sun is judged from.
 *
 * Four constraints, and the reason this is solved here rather than by rendering
 * candidates is that three of the four are geometry and can be answered exactly:
 *
 *   1. The disc. The sun sits at elevation 15, so any butte whose crest subtends
 *      less than that from every camera cannot occlude it at any azimuth. That is
 *      a much easier condition than moving it off the bearing, and it is the one
 *      worth aiming at.
 *   2. The shadow. A directional light at elevation 15 throws 3.73 m of shadow
 *      per metre of height, along the sun's bearing. The tip has to land up-wash
 *      of the corridor, not in it.
 *   3. The skyline within +-6 degrees of the sun's bearing must not *rise*. This
 *      is System 4's constraint and it has been met exactly twice already; it is
 *      checked here per half-degree against the silhouette of every butte, not
 *      argued from the centre position.
 *   4. It has to stay a formation, and not stand inside another one.
 *
 * Translation is exact on the real mesh — every vertex moves by the same vector —
 * so candidates are measured against the geometry that actually ships rather than
 * against a cone standing in for it.
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildDistantButtes, buildWalls } = await import('../src/rock.js');

const SUN_AZ = -9, SUN_EL = 15;
const BAND = 6;                    // the protected half-width, in degrees
const TAN_EL = Math.tan(SUN_EL * Math.PI / 180);
/* The corridor the shadow must miss: the wall curtains run s -34..356, which is
   very nearly world z +34..-356, and the cameras sit at z 0..-111. */
const CORRIDOR_FAR_Z = -356;

const path = new WashPath(), terrain = new Terrain(path);
const buttes = buildDistantButtes(terrain, {});

const { VIEWS } = await import('./views.mjs');
const p = new THREE.Vector3();
const CAMS = ['wash_low', 'wash_mid', 'sun_gap', 'bend'].map((n) => {
  const v = VIEWS.find((q) => q.name === n);
  path.posAt(v.d, p);
  return { name: n, x: p.x, y: p.y + 1.62, z: p.z };
});

/* Vertex arrays once, in world space. */
const VERT = buttes.map((m) => m.geometry.getAttribute('position').array);

/* The near walls, as occluders. Moving a butte into the distance is only a move
   if it is still on the skyline afterwards: the corridor walls hide everything
   out to roughly 25 degrees of azimuth and their crests fall away with range, so
   a butte pushed far enough back stops being a formation and starts being
   nothing at all — which is the outcome the brief rules out. This measures how
   much of butte0's silhouette still stands above the wall crest instead of
   assuming. */
const WALLV = buildWalls(path, terrain, {})
  .filter((m) => m.name.startsWith('wall'))
  .map((m) => m.geometry.getAttribute('position').array);

function wallSkyline(cam) {
  const out = new Float32Array(NB).fill(-99);
  for (const a of WALLV) {
    for (let i = 0; i < a.length; i += 3) {
      const px = a[i] - cam.x, py = a[i + 1] - cam.y, pz = a[i + 2] - cam.z;
      const az = Math.atan2(px, -pz) * 180 / Math.PI;
      const k = Math.round((az - AZ0) / AZS);
      if (k < 0 || k >= NB) continue;
      const el = Math.atan2(py, Math.hypot(px, pz)) * 180 / Math.PI;
      if (el > out[k]) out[k] = el;
    }
  }
  return out;
}

/* Max elevation per half-degree of azimuth, over a chosen set of buttes, with
   butte0 optionally displaced. Exact: every vertex is projected. */
const NB = 241, AZ0 = -60, AZS = 0.5;
function profile(cam, dx, dz) {
  const out = new Float32Array(NB).fill(-99);
  for (let b = 0; b < VERT.length; b++) {
    const a = VERT[b];
    const ox = b === 0 ? dx : 0, oz = b === 0 ? dz : 0;
    for (let i = 0; i < a.length; i += 3) {
      const px = a[i] + ox - cam.x, py = a[i + 1] - cam.y, pz = a[i + 2] + oz - cam.z;
      const az = Math.atan2(px, -pz) * 180 / Math.PI;
      const k = Math.round((az - AZ0) / AZS);
      if (k < 0 || k >= NB) continue;
      const el = Math.atan2(py, Math.hypot(px, pz)) * 180 / Math.PI;
      if (el > out[k]) out[k] = el;
    }
  }
  return out;
}

/* butte0 alone, for the crest test. */
function crest(cam, dx, dz) {
  const a = VERT[0];
  let el = -99, near = 1e9, lo = 999, hi = -999;
  for (let i = 0; i < a.length; i += 3) {
    const px = a[i] + dx - cam.x, py = a[i + 1] - cam.y, pz = a[i + 2] + dz - cam.z;
    const r = Math.hypot(px, pz);
    el = Math.max(el, Math.atan2(py, r) * 180 / Math.PI);
    near = Math.min(near, r);
    const az = Math.atan2(px, -pz) * 180 / Math.PI;
    lo = Math.min(lo, az); hi = Math.max(hi, az);
  }
  return { el, near, lo, hi };
}

/* Shadow tip: the highest vertex, run down the sun's bearing to the wash floor. */
function shadowTipZ(dx, dz) {
  const a = VERT[0];
  let top = -1e9, tx = 0, tz = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i + 1] > top) { top = a[i + 1]; tx = a[i] + dx; tz = a[i + 2] + dz; }
  }
  const ground = 12;                       // wash floor near the corridor
  const run = (top - ground) / TAN_EL;
  const ux = Math.sin(SUN_AZ * Math.PI / 180), uz = -Math.cos(SUN_AZ * Math.PI / 180);
  return { z: tz - uz * run, x: tx - ux * run, top, run };
}

const base = CAMS.map((c) => profile(c, 0, 0));
const wallSky = CAMS.map(wallSkyline);

/* How much of butte0 clears the wall crest, from the two views that frame the
   gap up the wash. Reported as the widest azimuth run that stands clear and how
   far above the crest its highest point reaches. */
function visibility(dx, dz) {
  let bestSpan = 0, bestOver = 0;
  for (let i = 0; i < CAMS.length; i++) {
    if (CAMS[i].name !== 'sun_gap' && CAMS[i].name !== 'wash_mid') continue;
    const a = VERT[0];
    const col = new Float32Array(NB).fill(-99);
    for (let k = 0; k < a.length; k += 3) {
      const px = a[k] + dx - CAMS[i].x, py = a[k + 1] - CAMS[i].y, pz = a[k + 2] + dz - CAMS[i].z;
      const az = Math.atan2(px, -pz) * 180 / Math.PI;
      const j = Math.round((az - AZ0) / AZS);
      if (j < 0 || j >= NB) continue;
      const el = Math.atan2(py, Math.hypot(px, pz)) * 180 / Math.PI;
      if (el > col[j]) col[j] = el;
    }
    let span = 0, over = 0;
    for (let j = 0; j < NB; j++) {
      if (col[j] > wallSky[i][j] + 0.15) { span += AZS; over = Math.max(over, col[j] - wallSky[i][j]); }
    }
    if (span > bestSpan) { bestSpan = span; bestOver = over; }
  }
  return { span: bestSpan, over: bestOver };
}

function score(dx, dz, label) {
  let worstEl = -99, worstNear = 1e9, rise = 0, riseAz = 0;
  for (let i = 0; i < CAMS.length; i++) {
    const c = crest(CAMS[i], dx, dz);
    worstEl = Math.max(worstEl, c.el); worstNear = Math.min(worstNear, c.near);
    const pr = profile(CAMS[i], dx, dz);
    for (let k = 0; k < NB; k++) {
      const az = AZ0 + k * AZS;
      if (az < SUN_AZ - BAND || az > SUN_AZ + BAND) continue;
      const d = pr[k] - base[i][k];
      if (d > rise) { rise = d; riseAz = az; }
    }
  }
  const st = shadowTipZ(dx, dz);
  /* Nearest other butte centre, so a move does not put two formations inside
     each other. */
  let sep = 1e9;
  const c0 = [(-127 + dx), (-540 + dz)];
  const others = [[145, -618], [-221, -787], [271, -905], [45, -856], [199, -1007],
    [-521, -651], [566, -747], [873, -983], [-906, -1099]];
  for (const [ox, oz] of others) sep = Math.min(sep, Math.hypot(ox - c0[0], oz - c0[1]));

  const vis = visibility(dx, dz);
  const discOK = worstEl < SUN_EL - 2.5;
  const shadOK = st.z < CORRIDOR_FAR_Z;
  const bandOK = rise < 0.05;
  console.log('  ' + label.padEnd(20) +
    ' crest ' + worstEl.toFixed(1).padStart(5) + (discOK ? ' ok ' : ' HI ') +
    ' shadow z ' + st.z.toFixed(0).padStart(5) + (shadOK ? ' ok ' : ' IN ') +
    ' band ' + rise.toFixed(2) + (bandOK ? ' ok' : '@' + riseAz) +
    ' sep ' + sep.toFixed(0).padStart(4) + 'm' +
    '  on skyline ' + vis.span.toFixed(1).padStart(4) + ' deg wide, ' +
    vis.over.toFixed(1) + ' deg above the wall');
  return discOK && shadOK && bandOK && sep > 260;
}

/* The wedge itself. Everything above turns on where the walls stop hiding things,
   and that had been quoted from a comment rather than measured. */
console.log('\n  the visible wedge, from sun_gap — wall crest / all buttes, per degree');
{
  const i = CAMS.findIndex((c) => c.name === 'sun_gap');
  let r1 = '   az  ', r2 = '   wall', r3 = '   butt';
  for (let az = -34; az <= 6; az += 2) {
    const k = Math.round((az - AZ0) / AZS);
    r1 += String(az).padStart(6);
    r2 += (wallSky[i][k] < -50 ? '     -' : wallSky[i][k].toFixed(1).padStart(6));
    r3 += (base[i][k] < -50 ? '     -' : base[i][k].toFixed(1).padStart(6));
  }
  console.log(r1); console.log(r2); console.log(r3);
}

console.log('\n  sun azimuth ' + SUN_AZ + ', elevation ' + SUN_EL +
  '   protected band ' + (SUN_AZ - BAND) + '..' + (SUN_AZ + BAND) +
  '   corridor far end z ' + CORRIDOR_FAR_Z + '\n');
score(0, 0, 'shipped');
console.log();
for (const [dx, dz, l] of [
  [0, -300, 'back 300'],
  [0, -450, 'back 450'],
  [0, -560, 'back 560'],
  [-160, -450, 'back 450 left 160'],
  [-230, -560, 'back 560 left 230'],
  [-300, -560, 'back 560 left 300'],
  [-160, -620, 'back 620 left 160'],
  [-260, -680, 'back 680 left 260'],
  [-380, -300, 'back 300 left 380'],
  [-520, -120, 'back 120 left 520'],
  [-40, -560, 'back 560 left 40'],
  [-70, -560, 'back 560 left 70'],
  [-100, -560, 'back 560 left 100'],
  [-40, -680, 'back 680 left 40'],
  [-70, -680, 'back 680 left 70'],
  [-100, -700, 'back 700 left 100'],
  [-60, -820, 'back 820 left 60'],
  [-100, -900, 'back 900 left 100'],
]) score(dx, dz, l);
