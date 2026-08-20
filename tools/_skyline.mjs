/* Diagnostic only. Where is there sky?
 *
 * The distant buttes are the one part of System 2 whose placement cannot be
 * judged from the source: whether a butte is visible at all depends on the near
 * walls' silhouette, which is generated. Guessing cost a whole render — the first
 * table put all ten behind the walls and the long view came back as empty sky.
 * This walks the wall meshes, bins every vertex by azimuth as seen from a given
 * viewpoint, and reports the highest elevation the rock reaches in each bin,
 * which is the skyline. Anything a butte has to clear is in that table.
 */
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';
import * as R from '../src/rock.js';

const path = new WashPath();
const terrain = new Terrain(path);
const walls = R.buildWalls(path, terrain, {});
const buttes = R.buildDistantButtes(terrain, {});

const D = 180 / Math.PI;
const views = [[46, 0], [92, -22], [120, 0]];

for (const [s, yaw] of views) {
  const c = path.posAt(s);
  const eye = { x: c.x, y: terrain.heightAt(c.x, c.z) + 1.65, z: c.z };
  const fwd = (path.headingAt(s) + yaw / D) * D;

  /* Two degrees per bin, which is about thirty pixels of a 1600-wide frame at
     this field of view — fine enough to see a notch, coarse enough to read. */
  const BIN = 2, N = 90;
  const sky = new Float32Array(N).fill(-90);
  const put = (m) => {
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - eye.x, dy = p[i + 1] - eye.y, dz = p[i + 2] - eye.z;
      const g = Math.hypot(dx, dz);
      if (g < 2) continue;
      let az = Math.atan2(dx, -dz) * D - fwd;
      while (az > 180) az -= 360;
      while (az < -180) az += 360;
      const b = Math.round(az / BIN) + N / 2;
      if (b < 0 || b >= N) continue;
      const el = Math.atan2(dy, g) * D;
      if (el > sky[b]) sky[b] = el;
    }
  };
  for (const m of walls) put(m);

  const bt = new Float32Array(N).fill(-90);
  const putB = (m) => {
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - eye.x, dy = p[i + 1] - eye.y, dz = p[i + 2] - eye.z;
      const g = Math.hypot(dx, dz);
      let az = Math.atan2(dx, -dz) * D - fwd;
      while (az > 180) az -= 360;
      while (az < -180) az += 360;
      const b = Math.round(az / BIN) + N / 2;
      if (b < 0 || b >= N) continue;
      const el = Math.atan2(dy, g) * D;
      if (el > bt[b]) bt[b] = el;
    }
  };
  for (const m of buttes) putB(m);

  /* The sun, in the same frame, so nothing is allowed to reach it. */
  const sunAz = 3.15 - fwd, sunEl = 7.74;
  console.log(`\n=== view s=${s} yaw=${yaw}  forward=${fwd.toFixed(1)}deg   ` +
              `sun at az ${sunAz.toFixed(1)} el ${sunEl.toFixed(1)}`);
  console.log('  az    wallTop   butteTop   visible?');
  for (let b = 0; b < N; b++) {
    const az = (b - N / 2) * BIN;
    if (Math.abs(az) > 34) continue;
    const w = sky[b], t = bt[b];
    const vis = t > w + 0.3 ? `BUTTE +${(t - w).toFixed(1)}` : (t > -80 ? 'hidden' : '-');
    console.log(`${String(az).padStart(5)}  ${w.toFixed(1).padStart(7)}  ` +
                `${(t > -80 ? t.toFixed(1) : '   -').padStart(8)}   ${vis}` +
                (Math.abs(az - sunAz) < 3 ? '   <<< SUN' : ''));
  }
}
