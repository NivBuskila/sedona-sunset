/* Standard capture set for visual critique.
 *
 * usage: node tools/shoot.mjs [tag] [--only name,name] [--w 1600] [--h 900]
 *                             [--far] [--hash nopost]
 *                             [--minframes 90] [--settlemax 15000]
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
import { VIEWS as SHARED_VIEWS } from './views.mjs';
import { settle, warmup, settleTag } from './settle.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'run';

/* Every flag this tool accepts, and whether it takes a value. A mistyped flag
   used to be ignored in silence, which is how `grad.mjs` came to print a header
   with no rows and `_p7name.mjs` came to measure nothing: an instrument that
   answers a question it did not understand is worse than one that refuses. The
   rule, four instances in now — a tool that measures nothing must not print a
   number, and must exit non-zero. */
const FLAGS = { only: 1, w: 1, h: 1, hash: 1, minframes: 1, settlemax: 1, far: 0 };
const die = (msg) => { console.error(`shoot: ${msg}`); process.exit(2); };
for (let i = (args[0] && !args[0].startsWith('--')) ? 1 : 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) die(`unexpected argument "${a}" — the tag must come first`);
  const k = a.slice(2);
  if (!(k in FLAGS)) {
    die(`unknown flag "${a}". Known flags: ${Object.keys(FLAGS).map(f => '--' + f).join(' ')}`);
  }
  if (FLAGS[k]) {
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) die(`"${a}" needs a value`);
    i++;
  }
}

const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const num = (k, d) => {
  const v = getf(k, null);
  if (v === null) return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) die(`--${k} wants a positive number, got "${v}"`);
  return n;
};
const W = num('w', 1600), H = num('h', 900);
const only = getf('only', '');
/* Settle knobs. The defaults are in tools/settle.mjs; these exist so a framing
   that reports `ceiling` can be given more room without editing the tool. */
const MINF = num('minframes', 90), SMAX = num('settlemax', 15000);
/* Passed through to the page's location hash, which is how the render stages
   read their own switches — `--hash nopost` gets you the scene without System
   7's chain. Added because a defect in one stage now contaminates every other
   stage's handoff frames, and the only way to attribute it is to render with
   that stage out. Costs nothing when unused. */
const hash = getf('hash', '');

/* Chosen to cover what each system is judged on: the long view up the wash toward
   the sun, the ground underfoot, a lit butte face, a shadowed crevice, and the
   framing where the juniper reads against the sky. Now in tools/views.mjs, because
   a second copy of it in tools/sundisc.mjs had drifted out of step with this one. */
const VIEWS = SHARED_VIEWS;

/* The wash runs 340 m and eight of the nine framings above sit inside its first
   third, so roughly two thirds of the walk had never appeared in a capture and had
   never been critiqued. These four cover the rest of it. They are kept out of VIEWS
   deliberately: it is the comparison set that every measured figure in this project
   is quoted against, and silently widening it would orphan all of them.

   `shade_far` is the one deliberate widening, and it orphans nothing because every
   figure here is quoted per view, so adding a station changes no existing number —
   it only costs a frame per capture and makes the cool half of the walk visible to
   critics. Worth noting why these four did not already do that job: **all of them
   look down-canyon at yaw 0, which is into the sun.** Distance was never the whole
   problem. Looking toward the sun the walls show their shadowed faces against a
   bright aureole and the floor is grazing-lit, so the cool shade the outer wash
   actually produces is invisible from the one bearing we extended the walk with.
   `shade_far` looks back astern for that reason. Shoot these with `--far`. */
const FAR_VIEWS = [
  { name: 'far_170', d: 170, yaw: 0,   pitch: 2 },
  { name: 'far_220', d: 220, yaw: 0,   pitch: 2 },
  { name: 'far_270', d: 270, yaw: 14,  pitch: 2 },
  { name: 'far_320', d: 320, yaw: 0,   pitch: 4 },
];

const pool = args.includes('--far') ? [...VIEWS, ...FAR_VIEWS] : VIEWS;
const views = only ? pool.filter(v => only.split(',').includes(v.name)) : pool;

/* Same rule as the flags. Rendering nothing and writing a manifest with an empty
   results array is a capture run that looks like it happened. The commonest
   version of this is asking for a far framing without --far. */
if (!views.length) {
  const want = only.split(',').filter(Boolean);
  const far = want.filter(n => FAR_VIEWS.some(v => v.name === n));
  die(`--only "${only}" matched no viewpoint.` +
      (far.length ? ` ${far.join(', ')} ${far.length > 1 ? 'are' : 'is'} a far framing — add --far.` : '') +
      `\n  available: ${pool.map(v => v.name).join(', ')}` +
      (args.includes('--far') ? '' : `\n  with --far, also: ${FAR_VIEWS.map(v => v.name).join(', ')}`));
}

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
  if (hash) {
    /* Reload rather than just assigning the hash: the stages read their
       switches once, as their module initialises, so a same-document hash
       change would be read by nobody. */
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.reload({ waitUntil: 'commit' });
    console.log(`  #${hash}`);
  }
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  console.log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.evaluate(() => window.__game.begin());

  /* One warmup pass so procedural textures and any deferred geometry are
     resident. Deliberately not the convergence settle — see warmup's comment. */
  const boot = await warmup(page, { frames: MINF * 2 });
  console.log(`  ${settleTag(boot)}`);

  const results = [];
  let unstable = 0;
  for (const v of views) {
    await page.evaluate(([d, yaw, pitch]) => {
      const g = window.__game;
      g.walkTo(d);
      g.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    const s = await settle(page, { minFrames: MINF, maxMs: SMAX });
    if (s.exit !== 'converged') unstable++;

    const file = path.join(shotsDir, `${tag}_${v.name}.png`);
    await capture(page, file);

    const st = await page.evaluate(() => {
      const g = window.__game;
      return { fps: +(g.fps || 0).toFixed(1), info: g.info(), probe: g.probe() };
    });
    results.push({ view: v.name, file: path.basename(file), settle: s, ...st });
    const i = st.info, p = st.probe;
    console.log(`  ${v.name.padEnd(11)} calls=${String(i.calls).padStart(4)} ` +
                `tris=${(i.triangles / 1000).toFixed(0)}k tex=${i.textures} ` +
                `| lum med=${p.median} p99=${p.p99} sky=${p.skyAvg} gnd=${p.groundAvg} ` +
                `| ${settleTag(s)}`);
  }

  fs.writeFileSync(path.join(shotsDir, `${tag}.json`),
    JSON.stringify({ settle: { minFrames: MINF, maxMs: SMAX, boot }, results, logs: [...new Set(errs)] }, null, 2));
  console.log(`\n${results.length} shots → shots/${tag}_*.png`);
  /* Loud, because the whole point of the convergence settle is that an
     under-settled capture stops being invisible. A byte diff against a framing
     that hit its ceiling is not evidence of anything. */
  if (unstable) {
    console.log(`\n  WARNING: ${unstable} framing${unstable > 1 ? 's' : ''} hit the settle ` +
                `ceiling and ${unstable > 1 ? 'are' : 'is'} not established as byte-stable. ` +
                `Raise --settlemax before comparing them.`);
  }
});
