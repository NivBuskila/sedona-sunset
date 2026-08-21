/* What the rock actually puts in front of the sky, and in front of the sun.
 *
 *   node tools/_farhoriz.mjs            # every capture viewpoint
 *   node tools/_farhoriz.mjs --no-far   # with the far band left out
 *   node tools/_farhoriz.mjs --profile sun_gap
 *
 * tools/horizon.mjs marches the height field and is the right instrument for
 * the question it was written for — whether the wash floor is in the walls'
 * shadow. It cannot see the wall curtains, the distant buttes or the far
 * ridgelines, because none of those are in the height field, so on the question
 * "is the sun disc occluded" it is silent rather than reassuring. That mattered
 * once already: it reads 3.4 to 9.3 degrees along the sun's bearing while the
 * geometry along the same bearing stands at 15 to 18.
 *
 * This walks the real vertices of every rock mesh, bins them by azimuth from
 * each viewpoint's eye, and reports the elevation of the skyline in each bin.
 * The line that matters is the last one: the highest thing within three degrees
 * of the sun's own bearing, against the sun's elevation. Run it with and
 * without --no-far to see exactly what the far band contributes there.
 */
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';
import * as R from '../src/rock.js';
import { buildFarRidges } from '../src/farridge.js';
import { SUN_DIR } from '../src/sky.js';

const argv = process.argv.slice(2);
const noFar = argv.includes('--no-far');
const pi = argv.indexOf('--profile');
const profileOnly = pi >= 0 ? argv[pi + 1] : null;

const D = 180 / Math.PI;
const path = new WashPath();
const terrain = new Terrain(path);

const sunAz = Math.atan2(SUN_DIR.x, -SUN_DIR.z) * D;
const sunEl = Math.asin(SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z)) * D;

const groups = [
  ['wall', R.buildWalls(path, terrain, {})],
  ['butte', R.buildDistantButtes(terrain, {})],
];
if (!noFar) groups.push(['far', buildFarRidges(terrain, path).children]);

/* tools/shoot.mjs's list, copied rather than imported so this tool cannot be
   the reason that file ever needs editing. */
const VIEWS = [
  { name: 'wash_low', d: 8, yaw: 0 },
  { name: 'wash_mid', d: 46, yaw: 0 },
  { name: 'ground', d: 30, yaw: 10 },
  { name: 'wall_lit', d: 46, yaw: 72 },
  { name: 'wall_shade', d: 46, yaw: -104 },
  { name: 'bend', d: 92, yaw: -22 },
  { name: 'juniper', d: 62, yaw: 34 },
  { name: 'sun_gap', d: 120, yaw: 0 },
];

const BIN = 1, N = 360;
const bin = (az) => Math.round(az / BIN) + N / 2;

function profileFrom(eye) {
  const out = groups.map(() => new Float32Array(N).fill(-90));
  for (let gi = 0; gi < groups.length; gi++) {
    const arr = out[gi];
    for (const m of groups[gi][1]) {
      const p = m.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const dx = p[i] - eye.x, dy = p[i + 1] - eye.y, dz = p[i + 2] - eye.z;
        const g = Math.hypot(dx, dz);
        if (g < 2) continue;
        let az = Math.atan2(dx, -dz) * D;
        const b = bin(az);
        if (b < 0 || b >= N) continue;
        const el = Math.atan2(dy, g) * D;
        if (el > arr[b]) arr[b] = el;
      }
    }
  }
  return out;
}

console.log(`sun: world azimuth ${sunAz.toFixed(2)} deg, elevation ${sunEl.toFixed(2)} deg` +
            `${noFar ? '   [far band excluded]' : ''}`);

let worst = -90, worstView = '';
for (const v of VIEWS) {
  if (profileOnly && v.name !== profileOnly) continue;
  const c = path.posAt(v.d);
  const eye = { x: c.x, y: terrain.heightAt(c.x, c.z) + 1.65, z: c.z };
  const prof = profileFrom(eye);
  const idx = Object.fromEntries(groups.map((g, i) => [g[0], prof[i]]));

  /* The whole point of the tool. Everything within three degrees of the sun's
     bearing, which is the band the disc has to come through. */
  let mx = { wall: -90, butte: -90, far: -90 };
  for (let a = Math.round(sunAz) - 3; a <= Math.round(sunAz) + 3; a++) {
    for (const k of Object.keys(idx)) {
      const b = bin(a);
      if (b >= 0 && b < N && idx[k][b] > mx[k]) mx[k] = idx[k][b];
    }
  }
  const all = Math.max(mx.wall, mx.butte, noFar ? -90 : mx.far);
  if (all > worst) { worst = all; worstView = v.name; }
  console.log(`  ${v.name.padEnd(11)} sun bearing +-3 deg:  wall ${mx.wall.toFixed(2).padStart(6)}` +
    `   butte ${mx.butte.toFixed(2).padStart(6)}` +
    `${noFar ? '' : `   far ${mx.far.toFixed(2).padStart(6)}`}` +
    `   |  skyline ${all.toFixed(2).padStart(6)}  sun ${sunEl.toFixed(2)}` +
    `  ${all < sunEl ? 'DISC CLEAR' : 'occluded by ' + (all - sunEl).toFixed(2)}`);

  if (profileOnly) {
    const fwd = path.headingAt(v.d) * D + v.yaw;
    console.log(`\n  forward ${fwd.toFixed(1)} deg   screen az = world az - forward`);
    console.log('   world  screen |   wall   butte' + (noFar ? '' : '     far') + '   skyline');
    for (let a = -60; a <= 60; a += 2) {
      const b = bin(a);
      const w = idx.wall[b], t = idx.butte[b], fr = noFar ? -90 : idx.far[b];
      const sky = Math.max(w, t, fr);
      const vis = !noFar && fr > Math.max(w, t) + 0.15 ? '  << far band' : '';
      console.log(`  ${String(a).padStart(5)}  ${(a - fwd).toFixed(0).padStart(6)}  |` +
        ` ${w.toFixed(1).padStart(6)}  ${t.toFixed(1).padStart(6)}` +
        (noFar ? '' : `  ${fr.toFixed(1).padStart(6)}`) +
        `   ${sky.toFixed(1).padStart(6)}${vis}` +
        (Math.abs(a - sunAz) < 1.5 ? '   <<< SUN' : ''));
    }
  }
}
console.log(`\nworst view for the disc: ${worstView} at ${worst.toFixed(2)} deg`);

/* Winding. The far band is a ring the camera stands inside, so its visible face
   is the one pointing at the axis, and if the triangles are wound the other way
   round back-face culling deletes the entire band. That happened, and it cost a
   render to find, because a band that is not drawn and a band that is correctly
   capped produce the same skyline table above. Asserted here so it cannot
   happen twice: take a triangle near the middle of each curtain, form its
   geometric normal, and check it points back toward the anchor. */
if (!noFar) {
  const far = groups.find((g) => g[0] === 'far');
  const anchor = (await import('../src/farridge.js')).FARRIDGE_DIAG.anchor;
  let bad = 0;
  for (const m of far[1]) {
    const p = m.geometry.attributes.position.array;
    const ix = m.geometry.index.array;
    const t = 3 * ((ix.length / 3 / 2) | 0);
    const v = [0, 1, 2].map((k) => {
      const o = ix[t + k] * 3;
      return [p[o], p[o + 1], p[o + 2]];
    });
    const e1 = v[1].map((x, k) => x - v[0][k]);
    const e2 = v[2].map((x, k) => x - v[0][k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const toAxis = [anchor.x - v[0][0], 0, anchor.z - v[0][2]];
    if (n[0] * toAxis[0] + n[2] * toAxis[2] <= 0) bad++;
  }
  console.log(bad ? `WINDING: ${bad} curtain(s) face outward and will be culled`
                  : 'winding: all curtains face the axis');
}
