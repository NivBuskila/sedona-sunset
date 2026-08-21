/* A/B the far ridge band inside a single page load.
 *
 *   node tools/_farpair.mjs ftest --only sun_gap,juniper,wash_low --hash dust=0.27
 *
 * Why this exists rather than two runs of shoot.mjs with and without `#nofar`.
 * Six agents are editing `src/` continuously and the render lock serialises
 * captures, so the gap between two consecutive shoot.mjs runs is not the ninety
 * seconds the renders take — it is however long the second one waits for the
 * lock, which has been over an hour. Two pairs were lost that way: `jt1`/`jt0`
 * differed in 84-92% of their pixels, and `jf1`/`jf0` in 2.4-3.6% reaching the
 * bottom of the frame, both because someone landed a revision of atmosphere.js
 * in between. A `nofar` switch can only change pixels the band covers, so any
 * diff wider than that is measuring somebody else's work.
 *
 * Toggling `farridge.visible` between two screenshots of one page load makes the
 * pair matched by construction: same modules, same textures, same sun, same
 * frame, one bit different. It is also the same mechanism bench.mjs's ablations
 * already use, so it measures the thing the tier ladder actually switches.
 *
 * Writes <tag>_with_<view>.png and <tag>_without_<view>.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, capture } from './harness.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'farpair';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = Number(getf('w', 800)), H = Number(getf('h', 450));
const only = getf('only', '');
const hash = getf('hash', '');

/* shoot.mjs's list, copied rather than imported so this tool cannot be the
   reason that file ever needs editing. Keep in step by hand if it moves. */
const VIEWS = [
  { name: 'wash_low',   d: 8,   yaw: 0,    pitch: -4 },
  { name: 'wash_mid',   d: 46,  yaw: 0,    pitch: 0 },
  { name: 'ground',     d: 30,  yaw: 10,   pitch: -38 },
  { name: 'wall_lit',   d: 46,  yaw: 72,   pitch: 12 },
  { name: 'wall_shade', d: 46,  yaw: -104, pitch: 10 },
  { name: 'bend',       d: 92,  yaw: -22,  pitch: 2 },
  { name: 'juniper',    d: 62,  yaw: 34,   pitch: 3 },
  { name: 'sun_gap',    d: 120, yaw: 0,    pitch: 6 },
];
const views = only ? VIEWS.filter(v => only.split(',').includes(v.name)) : VIEWS;

const shotsDir = path.join(DIR, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  const t0 = Date.now();
  if (hash) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.reload({ waitUntil: 'commit' });
    console.log(`  #${hash}`);
  }
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  console.log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const present = await page.evaluate(() => !!window.__game._scene.getObjectByName('farridge'));
  if (!present) throw new Error('no farridge group in the scene — nothing to A/B');

  const results = [];
  for (const v of views) {
    await page.evaluate(([d, yaw, pitch]) => {
      window.__game.walkTo(d);
      window.__game.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(400);

    /* The harness's frames come from renderOnce called directly, so visibility
       has to be followed by an explicit re-render or the screenshot is of the
       previous frame. Twice, because the post chain carries one frame of
       state and a single pass would blend the two halves together. */
    const shoot = async (want, suffix) => {
      await page.evaluate((show) => {
        const g = window.__game;
        g._scene.getObjectByName('farridge').visible = show;
        g.renderOnce(); g.renderOnce();
      }, want);
      const file = path.join(shotsDir, `${tag}_${suffix}_${v.name}.png`);
      await capture(page, file);
      return page.evaluate(() => ({ info: window.__game.info(), probe: window.__game.probe() }));
    };

    const on = await shoot(true, 'with');
    const off = await shoot(false, 'without');
    await page.evaluate(() => {
      const g = window.__game;
      g._scene.getObjectByName('farridge').visible = true;
      g.renderOnce();
    });

    results.push({ view: v.name, with: on, without: off });
    console.log(`  ${v.name.padEnd(11)} ` +
      `with calls=${String(on.info.calls).padStart(3)} tris=${(on.info.triangles / 1000).toFixed(0)}k  ` +
      `without calls=${String(off.info.calls).padStart(3)} tris=${(off.info.triangles / 1000).toFixed(0)}k  ` +
      `Δ ${on.info.calls - off.info.calls} calls ${on.info.triangles - off.info.triangles} tris`);
  }

  fs.writeFileSync(path.join(shotsDir, `${tag}.json`),
    JSON.stringify({ results, logs: [...new Set(errs)] }, null, 2));
  console.log(`\n${results.length * 2} shots → shots/${tag}_{with,without}_*.png`);
});
