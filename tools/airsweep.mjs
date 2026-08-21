/* How thin can the air get before the depth ladder goes with it?
 *
 *   node tools/airsweep.mjs [--w 1600] [--h 900] [--dials 1,1.4,1.8,2.4]
 *
 * The extinction in this scene buys the strongest element in it — a depth ladder
 * that steps by ridgeline rather than smearing — and costs the thing two
 * independent readers complained about, air that reads like the day after a
 * haboob rather than a clear Coconino evening. That is a trade, and it should be
 * measured rather than argued.
 *
 * What is swept is the *dust* gain alone. The other half of the extinction
 * change was cutting Rayleigh from 0.30 to 0.05, which corrected an outright
 * error — unstratified, 28x its physical coefficient, carrying 91% of a zenith
 * column that should have been clear — and is not a matter of taste. Sweeping
 * both together would mean paying for the correction with the composition.
 *
 * Each setting is a page reload, because aerial.js reads its switches once as
 * the module initialises. All settings come out of one render-lock acquisition,
 * and the baked coefficient is asserted before any frame is kept: the first
 * version of this tool produced four byte-identical frames, because a navigation
 * differing only in the fragment does not re-run anything, and twelve frames of
 * perfect agreement looked like a robust ladder rather than a broken harness.
 */
import { run, capture } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const W = Number(arg('--w', 1600)), H = Number(arg('--h', 900));
const DIALS = String(arg('--dials', '1,1.4,1.8,2.4')).split(',').map(Number);

/* Pre-flight: parse every source before taking the render lock. Three agents are
   editing this tree concurrently, so somebody's module may be half-written at
   any moment. One sweep run died after ten minutes on a syntax error in a file
   this system does not own, holding the lock the whole time with three agents
   queued behind it. Parsing src/ costs under a second. */
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
  console.error("If none of those are yours this is somebody's in-flight edit — retry shortly.");
  process.exit(1);
}

/* Green extinction above the near-ground band, per metre, at dial 1. */
const BETA1 = 0.0019 * (0.570 * 0.05 + 0.962 * 0.40);

/* Framings copied from tools/shoot.mjs, which owns them, so these numbers are
   comparable with the handoff set. */
const VIEWS = [
  ['sun_gap', 120, 0, 6],
  ['juniper', 62, 34, 3],
  ['wash_low', 8, 0, -4],
];

const tags = [];
await run({ width: W, height: H, waitReady: false }, async ({ page, url, errs }) => {
  for (const dial of DIALS) {
    await page.evaluate((h) => { location.hash = h; }, `dust=${dial}`);
    await page.reload({ waitUntil: 'commit', timeout: 120_000 });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 240_000 });
    await page.evaluate(() => window.__game.begin());
    await page.waitForTimeout(2500);

    const baked = await page.evaluate(() => {
      const d = window.__AERIAL_DIAG;
      return d && d.installed ? { dust: d.dust, bM: d.betaM[1] } : null;
    });
    if (!baked) throw new Error('aerial not installed — cannot attribute the frame');
    if (Math.abs(baked.dust - dial) > 1e-3) {
      throw new Error(`dial did not take: asked dust=${dial}, baked ${baked.dust}`);
    }
    const km = 3.912 / (BETA1 * dial) / 1000;
    const tag = `_d${String(dial).replace('.', 'p')}`;
    tags.push({ dial, km, tag });
    console.log(`dust=${dial}  visual range ${km.toFixed(2)} km  ` +
                `betaM.g ${baked.bM.toExponential(3)}`);

    for (const [n, d, yaw, pitch] of VIEWS) {
      await page.evaluate(([dd, y, p]) => {
        window.__game.walkTo(dd); window.__game.lookAt(y, p);
      }, [d, yaw, pitch]);
      await page.waitForTimeout(320);
      await capture(page, `shots/${tag}_${n}.png`);
    }
  }
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 4).join('\n'));
});

/* Measure. layers.mjs is the reference for whether the aerial perspective steps
   rather than smears, so it is run rather than reimplemented. */
console.log('\n                     sat            value');
console.log('dial   range    view       steps edge%  steps edge%');
for (const { dial, km, tag } of tags) {
  for (const [n] of VIEWS) {
    let line = '';
    try {
      const out = execFileSync(process.execPath,
        ['tools/layers.mjs', `shots/${tag}_${n}.png`], { encoding: 'utf8' });
      const m = /best strip.*?sat steps=(\d+) edge=(\d+)%.*?V steps=(\d+) edge=(\d+)%/s.exec(out);
      line = m ? `${m[1].padStart(5)} ${(m[2] + '%').padStart(5)}  ${m[3].padStart(5)} ${(m[4] + '%').padStart(5)}` : '  (no reading)';
    } catch (e) { line = '  (failed)'; }
    console.log(`${String(dial).padEnd(5)} ${km.toFixed(2).padStart(5)}km  ` +
                `${n.padEnd(10)} ${line}`);
  }
}
console.log('\nframes in shots/_d<dial>_<view>.png');
