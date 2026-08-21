/* Capture the standard viewpoints with a URL hash, so one term of System 7's
 * post chain can be switched off and measured against itself.
 *
 *   node tools/_p7cap.mjs off  --hash nopost --only wall_lit,wash_mid
 *   node tools/_p7cap.mjs ng   --hash grain=0
 *
 * tools/shoot.mjs is the capture set of record and is not to be modified, and
 * it passes no hash. This exists because the only honest way to report what a
 * grade did to a measured colour is to capture the same frame with the grade at
 * zero — and the only honest way to report `hf/lf` after adding film grain is
 * to also report it with the grain off, since uncorrelated noise is pure
 * high-frequency energy and would otherwise buy the number outright.
 *
 * Same viewpoints, same order, same names as shoot.mjs. Deliberately a copy of
 * the list rather than an import, because shoot.mjs does not export it and this
 * file must not be a reason to edit that one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, capture } from './harness.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'p7';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = Number(getf('w', 1600)), H = Number(getf('h', 900));
const only = getf('only', '');
const hash = getf('hash', '');

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

await run({ width: W, height: H, waitReady: false, hash }, async ({ page, errs }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  console.log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const results = [];
  for (const v of views) {
    await page.evaluate(([d, yaw, pitch]) => {
      const g = window.__game;
      g.walkTo(d);
      g.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(400);
    const file = path.join(shotsDir, `${tag}_${v.name}.png`);
    await capture(page, file);
    const st = await page.evaluate(() => {
      const g = window.__game;
      const p = g._post && g._post._diag;
      return {
        fps: +(g.fps || 0).toFixed(1), info: g.info(),
        sun: p ? p.sun : null, grain: p ? p.grain : null,
        targets: p ? p.targets : null,
      };
    });
    results.push({ view: v.name, ...st });
    const s = st.sun;
    console.log(`  ${v.name.padEnd(11)} calls=${String(st.info.calls).padStart(4)} ` +
                `tris=${(st.info.triangles / 1000).toFixed(0)}k` +
                (s ? `  sun uv ${s.x.toFixed(2)},${s.y.toFixed(2)} on ${s.on.toFixed(2)}` +
                     `  grain ${st.grain.phase}` : ''));
  }
  fs.writeFileSync(path.join(shotsDir, `${tag}.json`),
    JSON.stringify({ hash, results, logs: [...new Set(errs)] }, null, 2));
  console.log(`\n${results.length} shots → shots/${tag}_*.png`);
});
