/* Does the heat shimmer reach the pixels?
 *
 *   node tools/shimver.mjs [view] [xa] [xb]
 *
 * The honest test of a screen-space distortion is not how large its amplitude
 * uniform is, nor what fraction of pixels it touched — a critic traced the far
 * skyline of `sun_gap` column by column, found 443, 444, 445 ... 455, 454, 453,
 * a clean monotone ramp with essentially nil detrended residual, and concluded
 * the effect was not arriving. They were right, and the reason the internal
 * figure disagreed is that it measured the multiplier rather than the geometry.
 *
 * So this measures the geometry. It captures the same frame twice from one page
 * session, once with the distortion amplitude forced to zero, locates the
 * sky/rock silhouette to sub-pixel precision in every column of a region, and
 * reports the displacement between the two in pixels. A working shimmer shows a
 * per-column difference of order a pixel with no net bias — it wobbles the
 * edge, it does not move it.
 */
import { run, capture } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const VIEWS = {
  sun_gap: [120, 0, 6],
  wash_mid: [46, 0, 0],
  bend: [200, -28, 3],
  wash_low: [8, 0, -4],
};
const name = process.argv[2] || 'sun_gap';
const xa = Number(process.argv[3] ?? 0.36);
const xb = Number(process.argv[4] ?? 0.50);
const [d, yaw, pitch] = VIEWS[name];
const W = 1600, H = 900;

const reuse = process.argv.includes('--reuse');
if (!reuse) await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  const info = await page.evaluate(([dd, y, p]) => {
    const g = window.__game;
    g.walkTo(dd); g.lookAt(y, p);
    const m = g._atmo._shimmerMaterial;
    return { amp: m ? m.uniforms.uAmp.value : null, has: !!m };
  }, [d, yaw, pitch]);
  if (!info.has) { console.log('no shimmer material exposed'); return; }
  console.log(`${name}  ${W}x${H}  uAmp ${info.amp}`);

  await capture(page, 'shots/_shim_on.png');
  await page.evaluate(() => { window.__game._atmo._shimmerMaterial.uniforms.uAmp.value = 0; });
  await capture(page, 'shots/_shim_off.png');
  await page.evaluate((a) => { window.__game._atmo._shimmerMaterial.uniforms.uAmp.value = a; }, info.amp);
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 3).join('\n'));
});

const lum = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};

/** Sub-pixel y of the strongest vertical luminance edge in this column. */
function edgeY(img, x, y0, y1) {
  let best = -1, bv = 0;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    const g = Math.abs(lum(img, x, y + 1) - lum(img, x, y - 1));
    if (g > bv) { bv = g; best = y; }
  }
  if (best < 0 || bv < 6) return null;
  /* Parabolic refinement on the gradient magnitude. */
  const gm = (y) => Math.abs(lum(img, x, y + 1) - lum(img, x, y - 1));
  const a = gm(best - 1), b = gm(best), c = gm(best + 1);
  const den = a - 2 * b + c;
  const off = Math.abs(den) > 1e-6 ? 0.5 * (a - c) / den : 0;
  return best + Math.max(-1, Math.min(1, off));
}

const on = decode(readFileSync('shots/_shim_on.png'));
const off = decode(readFileSync('shots/_shim_off.png'));
const x0 = Math.round(on.w * xa), x1 = Math.round(on.w * xb);
/* The silhouette lives in the upper half; searching the whole column would find
   the strongest edge in the frame instead of the one on the skyline. */
const y0 = 0, y1 = Math.round(on.h * 0.55);

const diffs = [];
const cols = [];
for (let x = x0; x < x1; x++) {
  const a = edgeY(off, x, y0, y1), b = edgeY(on, x, y0, y1);
  if (a == null || b == null) continue;
  /* The model cannot exceed a few pixels, so anything larger is the estimator
     locking onto a different edge in one of the two frames, not a measurement. */
  if (Math.abs(b - a) > 4) continue;
  diffs.push(b - a);
  cols.push([x, a, b]);
}

if (!diffs.length) { console.log('no edge found in region'); process.exit(0); }
const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
const rms = Math.sqrt(diffs.reduce((s, v) => s + v * v, 0) / diffs.length);
const dev = Math.sqrt(diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length);
const mx = diffs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const moved = diffs.filter((v) => Math.abs(v) > 0.25).length;

console.log(`\nedge columns measured  ${diffs.length} of ${x1 - x0}   x ${x0}..${x1}`);
console.log(`displacement, pixels   rms ${rms.toFixed(3)}   sd ${dev.toFixed(3)}   ` +
  `mean ${mean.toFixed(3)}   max ${mx.toFixed(2)}`);
console.log(`columns moved > 0.25px ${moved} (${(100 * moved / diffs.length).toFixed(0)}%)`);
console.log('\n  x    off      on     delta');
for (const [x, a, b] of cols.filter((_, i) => i % Math.ceil(cols.length / 18) === 0)) {
  console.log(`  ${String(x).padStart(4)}  ${a.toFixed(2).padStart(7)} ${b.toFixed(2).padStart(7)}` +
    `  ${(b - a).toFixed(2).padStart(6)}`);
}
