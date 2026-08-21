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
/* Which dial. `dust` and `air` are aerial.js's extinction; `shaft` is the gain
   on the marched visibility correction in atmosphere.js. They are swept by the
   same harness because the question is the same shape in both cases: what does
   this setting cost the depth ladder. */
const DIAL = String(arg('--dial', 'dust'));
const VIEWSEL = String(arg('--views', 'sun_gap,juniper,wash_low')).split(',');

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
const ALL_VIEWS = [
  ['sun_gap', 120, 0, 6],
  ['juniper', 62, 34, 3],
  ['wash_low', 8, 0, -4],
  ['bend', 92, -22, 2],
  ['wash_mid', 46, 0, 0],
];
const VIEWS = ALL_VIEWS.filter(([n]) => VIEWSEL.includes(n));

const tags = [];
await run({ width: W, height: H, waitReady: false }, async ({ page, url, errs }) => {
  for (const dial of DIALS) {
    await page.evaluate((h) => { location.hash = h; }, `${DIAL}=${dial}`);
    await page.reload({ waitUntil: 'commit', timeout: 120_000 });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 240_000 });
    await page.evaluate(() => window.__game.begin());
    await page.waitForTimeout(2500);

    /* Assert the setting reached the shader. The first version of this tool
       produced four byte-identical frames and read as a robust ladder. */
    const baked = await page.evaluate((which) => {
      if (which === 'shaft') {
        const a = window.__game._atmo;
        const i = a && a.shaftInfo ? a.shaftInfo() : null;
        return i ? { got: i.gain, note: `steps ${i.steps}, shadow ${i.hasShadow}` } : null;
      }
      const d = window.__AERIAL_DIAG;
      return d && d.installed
        ? { got: d[which], note: `betaM.g ${d.betaM[1].toExponential(3)}` } : null;
    }, DIAL);
    if (!baked) throw new Error(`cannot read the ${DIAL} dial back — no diag exposed`);
    if (Math.abs(baked.got - dial) > 1e-3) {
      throw new Error(`dial did not take: asked ${DIAL}=${dial}, baked ${baked.got}`);
    }
    const km = DIAL === 'dust' ? 3.912 / (BETA1 * dial) / 1000 : null;
    const tag = `_${DIAL}${String(dial).replace('.', 'p')}`;
    tags.push({ dial, km, tag });
    console.log(`${DIAL}=${dial}${km ? `  visual range ${km.toFixed(2)} km` : ''}  ${baked.note}`);

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
/* Measure. layers.mjs is the reference for whether the aerial perspective steps
 * rather than smears, so it is run rather than reimplemented.
 *
 * Both the best strip and the median of all strips are reported, and so is which
 * strip won. The best-strip figure is the one that has been quoted in this
 * project and it is the least stable statistic in it: it is a maximum over nine
 * lateral positions, so it can move several points between two builds purely by
 * changing which strip wins. A conclusion that rests on the best strip alone,
 * without the median beside it and without the strip position, is not safe. */
console.log('\n                      sat: best        median   |  value: best        median');
console.log(`${DIAL.padEnd(6)} view        cx    steps edge%  edge%  |  cx    steps edge%  edge%`);
const rows = [];
for (const { dial, km, tag } of tags) {
  for (const [n] of VIEWS) {
    let cells = '  (failed)';
    const rec = { dial, km, view: n };
    try {
      const out = execFileSync(process.execPath,
        ['tools/layers.mjs', `shots/${tag}_${n}.png`], { encoding: 'utf8' });
      const b = /best strip cx=([\d.]+)\s+sat steps=(\d+) edge=(\d+)% mono=([-\d.]+)\s+V steps=(\d+) edge=(\d+)% mono=([-\d.]+)/.exec(out);
      const md = /median of \d+ usable strips\s+sat edge=(\d+)%\s+mono=([-\d.]+)\s+V edge=(\d+)%\s+mono=([-\d.]+)/.exec(out);
      if (b) {
        Object.assign(rec, {
          cx: b[1], satSteps: +b[2], satEdge: +b[3], satMono: +b[4],
          vSteps: +b[5], vEdge: +b[6], vMono: +b[7],
          satMed: md ? +md[1] : null, vMed: md ? +md[3] : null,
        });
        cells = `${b[1].padStart(5)} ${b[2].padStart(5)} ${(b[3] + '%').padStart(5)} ` +
                `${((md ? md[1] : '?') + '%').padStart(6)}  | ` +
                `${b[1].padStart(5)} ${b[5].padStart(5)} ${(b[6] + '%').padStart(5)} ` +
                `${((md ? md[3] : '?') + '%').padStart(6)}`;
      } else cells = '  (no reading)';
    } catch (e) { /* keep the failure marker */ }
    rows.push(rec);
    console.log(`${String(dial).padEnd(6)} ${n.padEnd(11)} ${cells}`);
  }
}

/* The exchange rate, stated explicitly, because the question this sweep exists
   to answer is not "which setting is best" but "what does one buy with the
   other". Quoted per unit of the dial so it can be read off directly. */
const byView = {};
for (const r of rows) (byView[r.view] ||= []).push(r);
console.log('\nexchange rate against the lowest setting swept');
for (const [v, rs] of Object.entries(byView)) {
  const a = rs[0], z = rs[rs.length - 1];
  if (a.satEdge === undefined || z.satEdge === undefined) continue;
  const dd = z.dial - a.dial;
  if (!dd) continue;
  console.log(`  ${v.padEnd(10)} ${DIAL} ${a.dial} -> ${z.dial}:  ` +
    `sat edge ${a.satEdge}% -> ${z.satEdge}%  (${((z.satEdge - a.satEdge) / dd).toFixed(0)} pts per unit)   ` +
    `V edge ${a.vEdge}% -> ${z.vEdge}%  (${((z.vEdge - a.vEdge) / dd).toFixed(0)} pts per unit)   ` +
    `V mono ${a.vMono} -> ${z.vMono}`);
}
console.log(`\nframes in shots/_${DIAL}<dial>_<view>.png`);
