/* Standard capture set for visual critique.
 *
 * usage: node tools/shoot.mjs [tag] [--only name,name] [--w 1600] [--h 900]
 *
 * Renders a fixed set of viewpoints so that two runs of two different builds are
 * directly comparable, and so a critic looking only at the PNGs is always looking
 * at the same framings. Runs headless on SwiftShader at idle priority across four
 * cores — safe to run while the machine is being played on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, capture } from './harness.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'run';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = Number(getf('w', 1600)), H = Number(getf('h', 900));
const only = getf('only', '');

/* Chosen to cover what each system is judged on: the long view up the wash toward
   the sun, the ground underfoot, a lit butte face, a shadowed crevice, and the
   framing where the juniper reads against the sky. */
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

/* The harness gives `window.__game` two minutes to appear, which was ample when
   the page was a height field and a sky gradient. Measured with tools/boot.mjs
   it is now 370 seconds on four cores — every texture in the scene is written
   texel by texel before the first frame — so every capture was failing with a
   bare `waitForFunction: Timeout`, which is indistinguishable from a page that
   threw. Readiness is waited for here instead, with a budget sized to the boot
   we actually have. Nothing in harness.mjs changes and neither does VIEWS. */
await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  console.log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.evaluate(() => window.__game.begin());

  // one settle pass so procedural textures and any deferred geometry are resident
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
      return { fps: +(g.fps || 0).toFixed(1), info: g.info(), probe: g.probe() };
    });
    results.push({ view: v.name, file: path.basename(file), ...st });
    const i = st.info, p = st.probe;
    console.log(`  ${v.name.padEnd(11)} calls=${String(i.calls).padStart(4)} ` +
                `tris=${(i.triangles / 1000).toFixed(0)}k tex=${i.textures} ` +
                `| lum med=${p.median} p99=${p.p99} sky=${p.skyAvg} gnd=${p.groundAvg}`);
  }

  fs.writeFileSync(path.join(shotsDir, `${tag}.json`),
    JSON.stringify({ results, logs: [...new Set(errs)] }, null, 2));
  console.log(`\n${results.length} shots → shots/${tag}_*.png`);
});
