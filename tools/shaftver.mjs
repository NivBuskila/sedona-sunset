/* Are they shafts, or just a brightness lift?
 *
 *   node tools/shaftver.mjs [view] [--reuse]
 *
 * A volumetric pass is easy to fool yourself about: anything that adds light
 * toward the sun will look vaguely like god rays in a thumbnail. The claim being
 * made is narrower and it is falsifiable. In-scatter with a visibility term
 * should add light *structurally* — bright where the sun reaches the air, dark
 * where a rim or a wall stands between, so the added radiance has edges and a
 * high spatial variance. A veil adds the same light everywhere and has neither.
 *
 * So this captures the frame with the marched pass on and off from one page
 * session and reports, on the difference:
 *
 *   level       mean added radiance, per region. Says whether the pass is doing
 *               anything at all.
 *   CoV         standard deviation over mean of the added light. A uniform lift
 *               scores near 0. Structure scores high. This is the number that
 *               separates a shaft from a glow.
 *   edge share  fraction of the total variation of the added light carried by
 *               its steepest 10% of gradients. Beams have boundaries; a glow
 *               does not.
 *   angular     mean added radiance in bands of angle from the sun, which is the
 *               phase function made visible. Should fall steeply and smoothly.
 *
 * As in shimver.mjs, a known-zero control comes first: two captures at the same
 * setting, so the floor of every statistic here is measured rather than assumed.
 */
import { run, capture } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const VIEWS = {
  sun_gap: [120, 0, 6],
  wash_low: [8, 0, -4],
  juniper: [62, 34, 3],
  bend: [92, -22, 2],
  wall_shade: [46, -104, 10],
};
const argv = process.argv.slice(2);
const name = (argv[0] && !argv[0].startsWith('--')) ? argv[0] : 'sun_gap';
const [d, yaw, pitch] = VIEWS[name];
const W = 1200, H = 675;

if (!argv.includes('--reuse')) await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 240_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);
  const info = await page.evaluate(([dd, y, p]) => {
    const g = window.__game;
    g.walkTo(dd); g.lookAt(y, p);
    const a = g._atmo;
    return { has: !!(a && a.setShaftQuality), info: a && a.shaftInfo ? a.shaftInfo() : null };
  }, [d, yaw, pitch]);
  if (!info.has) { console.log('no shaft pass exposed'); return; }
  console.log(`${name} ${W}x${H}  ` + JSON.stringify(info.info));

  const q = (n) => page.evaluate((v) => window.__game._atmo.setShaftQuality(v), n);
  await q(2);
  await capture(page, 'shots/_shaft_on.png');
  await capture(page, 'shots/_shaft_on2.png');
  await q(0);
  await capture(page, 'shots/_shaft_off.png');
  await q(2);
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 3).join('\n'));
});

const on = decode(readFileSync('shots/_shaft_on.png'));
const on2 = decode(readFileSync('shots/_shaft_on2.png'));
const off = decode(readFileSync('shots/_shaft_off.png'));

const lum = (im, x, y) => {
  const i = (y * im.w + x) * im.ch;
  return (0.2126 * im.px[i] + 0.7152 * im.px[i + 1] + 0.0722 * im.px[i + 2]) / 255;
};

/* Regions as fractions of the frame, so this is resolution independent. */
const REGIONS = [
  ['upper left ', 0.05, 0.28, 0.10, 0.34],
  ['gap centre ', 0.42, 0.58, 0.28, 0.52],
  ['upper right', 0.72, 0.95, 0.10, 0.34],
  ['floor      ', 0.30, 0.70, 0.72, 0.94],
];

function delta(a, b, r) {
  const [, xa, xb, ya, yb] = r;
  const x0 = Math.round(a.w * xa), x1 = Math.round(a.w * xb);
  const y0 = Math.round(a.h * ya), y1 = Math.round(a.h * yb);
  const v = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(lum(a, x, y) - lum(b, x, y));
  const n = v.length;
  const mean = v.reduce((s, t) => s + t, 0) / n;
  const sd = Math.sqrt(v.reduce((s, t) => s + (t - mean) ** 2, 0) / n);
  /* Edge share of the added light: how much of its variation sits in its
     steepest gradients. Computed on the delta field, not on the frame, so
     scene texture cannot contribute. */
  const g = [];
  const wR = x1 - x0;
  for (let y = 1; y < y1 - y0 - 1; y++) {
    for (let x = 1; x < wR - 1; x++) {
      const c = v[y * wR + x];
      g.push(Math.abs(v[y * wR + x + 1] - c) + Math.abs(v[(y + 1) * wR + x] - c));
    }
  }
  g.sort((p, q2) => q2 - p);
  const tot = g.reduce((s, t) => s + t, 0);
  const top = g.slice(0, Math.max(1, Math.round(g.length * 0.1)))
               .reduce((s, t) => s + t, 0);
  return { mean, sd, cov: mean !== 0 ? Math.abs(sd / mean) : 0,
           edge: tot > 0 ? top / tot : 0, n };
}

console.log(`\ncontrol: on vs on2`);
for (const r of REGIONS) {
  const c = delta(on, on2, r);
  console.log(`  ${r[0]}  mean ${c.mean.toExponential(2)}  sd ${c.sd.toExponential(2)}` +
              `  <- floor`);
}

console.log(`\nadded by the marched pass: on vs off`);
console.log('  region        mean      sd        CoV     edge share');
for (const r of REGIONS) {
  const c = delta(on, off, r);
  console.log(`  ${r[0]}  ${c.mean.toFixed(5)}  ${c.sd.toFixed(5)}  ` +
              `${c.cov.toFixed(2).padStart(6)}   ${(100 * c.edge).toFixed(0)}%`);
}

/* Angular profile. The sun sits at frame centre in sun_gap, which is the view
   this matters in; for others this is only indicative and is labelled so. */
const cx = 0.5, cy = 0.42;
console.log(`\nangular profile about (${cx}, ${cy}) of frame` +
            (name === 'sun_gap' ? ' (the sun)' : ' (nominal; sun off-frame)'));
console.log('  radius %frame   mean added   n');
for (const [ra, rb] of [[0, 0.05], [0.05, 0.10], [0.10, 0.18], [0.18, 0.28], [0.28, 0.45]]) {
  let s = 0, n = 0;
  for (let y = 0; y < on.h; y++) {
    for (let x = 0; x < on.w; x++) {
      const dx = (x / on.w - cx), dy = (y / on.h - cy) * (on.h / on.w);
      const rr = Math.hypot(dx, dy);
      if (rr >= ra && rr < rb) { s += lum(on, x, y) - lum(off, x, y); n++; }
    }
  }
  console.log(`  ${ra.toFixed(2)}-${rb.toFixed(2)}       ` +
              `${(s / Math.max(1, n)).toFixed(5)}    ${n}`);
}
