/* How thin can the air get before the depth ladder goes with it?
 *
 *   node tools/airsweep.mjs [--w 1200] [--h 675]
 *
 * The extinction in this scene buys the strongest element in it — a depth
 * ladder that steps by ridgeline instead of smearing — and costs the thing two
 * separate readers complained about independently, air that reads like the day
 * after a haboob rather than a clear Coconino evening. That is a trade, and a
 * trade should be measured rather than argued.
 *
 * So this sweeps the long-range extinction over four settings, reloading the
 * page for each so the constants are re-baked, and reports for every one:
 * layers.mjs step count and edge share, saturation and value on the receding
 * masses, and hf/lf on the far wall. All four settings come out of a single
 * render-lock acquisition.
 *
 * The shallow suspension layer is deliberately *not* swept with them. It is
 * what produces the near-ground band and what makes the height law legible, and
 * it acts over tens of metres where the complaint is about kilometres.
 */
import { run, capture } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/* Pre-flight: parse every source before taking the render lock.
 *
 * Three agents are editing this tree concurrently, so at any moment somebody's
 * module may be half-written. One sweep run died after ten minutes on
 * `Unexpected identifier 'bumpFrom'` in a file this system does not own, having
 * held the render lock the whole time while three other agents queued behind
 * it. A parse of the whole src/ directory costs under a second and turns that
 * into an instant, correctly-attributed refusal. */
const broken = readdirSync('src').filter((f) => f.endsWith('.js')).filter((f) => {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'],
                 { input: readFileSync(`src/${f}`), stdio: ['pipe', 'ignore', 'ignore'] });
    return false;
  } catch (e) { return true; }
});
if (broken.length) {
  console.error(`refusing to take the render lock: src/${broken.join(', src/')} ` +
                `${broken.length > 1 ? 'do' : 'does'} not parse.`);
  console.error('If none of those are yours, this is somebody\'s in-flight edit — retry shortly.');
  process.exit(1);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : Number(process.argv[i + 1]); };
const W = arg('--w', 1200), H = arg('--h', 675);

/* Meteorological visual range is 3.912/beta. Above the shallow layer, green
   extinction is fogDensity * (0.570*R_GAIN + 0.962*M_GAIN) * air, which at
   air = 1 is 1.568e-3 per metre — a visual range of 2.50 km. The dial values
   below are that number solved for 2.5, 4, 10 and 25 km. */
const BETA1 = 0.0019 * (0.570 * 0.30 + 0.962 * 0.68);
const SETTINGS = [2.5, 4, 10, 25].map((km) => ({
  km,
  air: +((3.912 / (km * 1000)) / BETA1).toFixed(4),
}));

/* Copied from tools/shoot.mjs, which owns them, so the sweep frames are the
   same framings as the handoff set and the numbers are comparable. */
const VIEWS = [
  ['sun_gap', 120, 0, 6],
  ['juniper', 62, 34, 3],
  ['wash_low', 8, 0, -4],
];

await run({ width: W, height: H, waitReady: false }, async ({ page, url, errs }) => {
  for (const s of SETTINGS) {
    /* Set the fragment, then *reload*. `goto` to a URL that differs only in its
       fragment is a same-document navigation: nothing re-executes, aerial.js
       never re-reads its switches, and the sweep quietly measures the same
       build four times. This is what happened on the first attempt. */
    await page.evaluate((h) => { location.hash = h; }, `air=${s.air}`);
    await page.reload({ waitUntil: 'commit', timeout: 120_000 });
    /* Boot is long — every texture is written texel by texel — but not ten
       minutes long on a GPU host, and a generous timeout is how a broken tree
       turns into a silent ten-minute lock hold. */
    await page.waitForFunction(() => !!window.__game, null, { timeout: 240_000 });
    await page.evaluate(() => window.__game.begin());
    await page.waitForTimeout(2500);

    /* Refuse to capture a setting that did not take. */
    const baked = await page.evaluate(() => {
      const d = window.__AERIAL_DIAG;
      return d && d.installed ? { air: d.air, bM: d.betaM[1], bS: d.betaS[1] } : null;
    });
    if (!baked) throw new Error('aerial not installed — cannot attribute the frame');
    if (Math.abs(baked.air - s.air) > 1e-3) {
      throw new Error(`dial did not take: asked air=${s.air}, shader baked air=${baked.air}`);
    }
    console.log(`  baked air=${baked.air}  betaM.g=${baked.bM.toExponential(3)}` +
                `  betaS.g=${baked.bS.toExponential(3)}`);
    for (const [n, d, yaw, pitch] of VIEWS) {
      await page.evaluate(([dd, y, p]) => {
        window.__game.walkTo(dd); window.__game.lookAt(y, p);
      }, [d, yaw, pitch]);
      await page.waitForTimeout(320);
      await capture(page, `shots/_air${s.km}_${n}.png`);
    }
    console.log(`air=${s.air}  target ${s.km} km  captured`);
  }
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 4).join('\n'));
});

console.log('\nsettings: ' + SETTINGS.map((s) => `${s.km}km(air=${s.air})`).join('  '));
console.log('frames in shots/_air<km>_<view>.png');
