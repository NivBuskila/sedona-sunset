/* Where is the sun on screen, and is anything in front of it?
 *
 *   node tools/sunpos.mjs                 (all viewpoints)
 *   node tools/sunpos.mjs sun_gap wash_low
 *
 * Written because three renders were spent failing to find a sun disc that
 * should have been unmissable, and each of them cost between eight minutes and
 * an hour. The question — does the beam direction land inside the frustum, and
 * what does the scene put at that pixel — needs no picture at all. It needs the
 * camera matrices and a raycast, both of which the page already has, so this
 * boots the page, asks, and exits in under two minutes.
 *
 * The general lesson is the one CONTRACT.md keeps making about instruments: if
 * a measurement is expensive, the temptation is to guess between measurements,
 * and guessing is what the whole project is trying not to do. Build the cheap
 * instrument instead.
 */
import { run } from './harness.mjs';
import { SUN_DIR, SUN_EL_DEG, SUN_AZ_DEG } from '../src/atmos.js';

const VIEWS = [
  { name: 'wash_low', d: 8, yaw: 0, pitch: -4 },
  { name: 'wash_mid', d: 46, yaw: 0, pitch: 0 },
  { name: 'ground', d: 30, yaw: 10, pitch: -38 },
  { name: 'wall_lit', d: 46, yaw: 72, pitch: 12 },
  { name: 'wall_shade', d: 46, yaw: -104, pitch: 10 },
  { name: 'bend', d: 92, yaw: -22, pitch: 2 },
  { name: 'juniper', d: 62, yaw: 34, pitch: 3 },
  { name: 'sun_gap', d: 120, yaw: 0, pitch: 6 },
];
const only = process.argv.slice(2);
const views = only.length ? VIEWS.filter(v => only.includes(v.name)) : VIEWS;

console.log(`sun: azimuth ${SUN_AZ_DEG} deg, elevation ${SUN_EL_DEG} deg, ` +
  `dir ${[SUN_DIR.x, SUN_DIR.y, SUN_DIR.z].map(v => v.toFixed(4)).join(' ')}`);

await run({ width: 800, height: 450 }, async ({ page }) => {
  await page.waitForTimeout(3000);
  const rows = [];
  for (const v of views) {
    rows.push(await page.evaluate(([d, yaw, pitch, sx, sy, sz]) => {
      const g = window.__game;
      g.setPaused(true);
      g.walkTo(d); g.lookAt(yaw, pitch);
      const cam = g._camera;
      cam.updateMatrixWorld();

      /* Project a point a long way along the beam. Doing it by hand rather than
         with Vector3.project keeps this independent of what the page imports. */
      const P = [cam.position.x + sx * 4000, cam.position.y + sy * 4000,
      cam.position.z + sz * 4000, 1];
      const mv = cam.matrixWorldInverse.elements, pr = cam.projectionMatrix.elements;
      const ap = (m, p) => [0, 1, 2, 3].map(r =>
        m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]);
      const c = ap(pr, ap(mv, P));
      const ndc = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];

      /* What does the scene put in the way? Everything but the sky dome. */
      const rc = new (Object.getPrototypeOf(g._scene).constructor.name === 'Scene'
        ? window.__RC || Object : Object)();
      let blockedBy = null, blockDist = null;
      if (window.__raycaster) {
        const hits = window.__raycaster(cam.position, [sx, sy, sz]);
        if (hits) { blockedBy = hits.name; blockDist = hits.distance; }
      }
      void rc;

      /* Angle between the camera's forward axis and the beam, which is the
         number that decides whether the disc can be on screen at all. */
      const f = [-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[9],
      -cam.matrixWorld.elements[10]];
      const cosF = f[0] * sx + f[1] * sy + f[2] * sz;

      return {
        ndc, cosF, fwdAngle: Math.acos(Math.max(-1, Math.min(1, cosF))) * 180 / Math.PI,
        camY: +cam.position.y.toFixed(2),
      };
    }, [v.d, v.yaw, v.pitch, SUN_DIR.x, SUN_DIR.y, SUN_DIR.z]));
  }

  console.log('\nview         angle to fwd   NDC x     NDC y     on screen   fx      fy');
  views.forEach((v, i) => {
    const r = rows[i];
    const on = Math.abs(r.ndc[0]) <= 1 && Math.abs(r.ndc[1]) <= 1 && r.cosF > 0;
    console.log(`${v.name.padEnd(12)} ${r.fwdAngle.toFixed(1).padStart(6)} deg   ` +
      `${r.ndc[0].toFixed(3).padStart(7)}  ${r.ndc[1].toFixed(3).padStart(7)}   ` +
      `${(on ? 'yes' : 'NO').padStart(9)}   ` +
      `${((r.ndc[0] + 1) / 2).toFixed(3)}  ${((1 - r.ndc[1]) / 2).toFixed(3)}`);
  });
});
