/* The critic's population, measured: near-black verticals sitting in open ground.
 *
 *   node tools/_facetlift.mjs <tag> [<baseline-tag>] [--view ground]
 *   node tools/_facetlift.mjs s4gb s4nb
 *
 * The finding this answers is not about a frame average, it is about a specific kind of
 * pixel: a **dark facet surrounded by bright sunlit floor**. A slab in open wash with its
 * top at RGB (168,123,84) and its side at (37,16,13). So a whole-frame or whole-window
 * statistic is the wrong instrument - the frame is mostly floor, and averaging the floor
 * in buries the population being complained about. This selects it directly, using the
 * same spatial-scale discriminator post used to fix it: dark pixels whose surroundings
 * are bright. A dark pixel in a large shadow is not selected; a dark facet a few pixels
 * across in open sun is.
 *
 * Reported on the red channel, because that is the channel the finding is stated in
 * ("90 to 110 in red") and the channel with the most headroom in red rock. The
 * neighbourhood mean is computed with a summed-area table so the radius is free.
 *
 * Two cautions. This is a **full-resolution** measurement and must stay one: post's
 * lesson today is that downscales find candidates and only full-resolution crops settle
 * them, and a bilinear downscale blends a two-pixel facet into the floor around it,
 * which is precisely the signal here. And the two tags must be a same-build pair - use
 * the #noband ablation, not an older capture, or this measures three agents' edits.
 */
import { readFileSync, existsSync } from 'node:fs';
import { decode } from './png.mjs';

const argv = process.argv.slice(2);
const tags = argv.filter((a) => !a.startsWith('--'));
const gv = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const VIEW = gv('view', 'ground');
const DARK = Number(gv('dark', 60));      // a facet this dark in red is the complaint
const BRIGHT = Number(gv('bright', 95));  // surroundings this bright means "in open sun"
const RAD = Number(gv('rad', 12));        // neighbourhood radius, pixels
if (!tags.length) { console.log('usage: node tools/_facetlift.mjs <tag> [<base>] [--view ground]'); process.exit(2); }

function measure(file) {
  if (!existsSync(file)) return null;
  const img = decode(readFileSync(file));
  const { w, h, ch, px } = img;
  const R = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) R[i] = px[i * ch];

  /* Summed-area table of the red channel, so the surround mean at any radius is four
     lookups rather than a window scan. */
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      S[(y + 1) * (w + 1) + x + 1] = R[y * w + x] + S[y * (w + 1) + x + 1] +
        S[(y + 1) * (w + 1) + x] - S[y * (w + 1) + x];
    }
  }
  const area = (x0, y0, x1, y1) => S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] -
    S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];

  const sel = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = R[y * w + x];
      if (v > DARK) continue;
      const x0 = Math.max(0, x - RAD), y0 = Math.max(0, y - RAD);
      const x1 = Math.min(w, x + RAD + 1), y1 = Math.min(h, y + RAD + 1);
      const n = (x1 - x0) * (y1 - y0);
      if (area(x0, y0, x1, y1) / n >= BRIGHT) sel.push(v);
    }
  }
  sel.sort((a, b) => a - b);
  const pc = (p) => sel.length ? sel[Math.min(sel.length - 1, Math.floor(p / 100 * sel.length))] : NaN;
  return {
    n: sel.length, pct: 100 * sel.length / (w * h), w, h,
    mean: sel.reduce((a, b) => a + b, 0) / Math.max(1, sel.length),
    p1: pc(1), p10: pc(10), p50: pc(50), p90: pc(90),
    under20: 100 * sel.filter((v) => v < 20).length / Math.max(1, sel.length),
    under40: 100 * sel.filter((v) => v < 40).length / Math.max(1, sel.length),
  };
}

const [tag, base] = tags;
const now = measure(`shots/${tag}_${VIEW}.png`);
const was = base ? measure(`shots/${base}_${VIEW}.png`) : null;
if (!now) { console.error(`_facetlift: no capture shots/${tag}_${VIEW}.png`); process.exit(2); }

const d = (a, b, p = 1) => (b == null || Number.isNaN(b)) ? '' :
  `  (${a - b >= 0 ? '+' : ''}${(a - b).toFixed(p)})`;

console.log(`\n  dark facets in open sun - ${VIEW} at ${now.w}x${now.h}, full resolution`);
console.log(`  selected: red <= ${DARK} with a ${RAD}px surround averaging >= ${BRIGHT} red\n`);
console.log(`  tag                      ${tag}` + (base ? `   against ${base}` : ''));
console.log(`  population            ${String(now.n).padStart(8)} px  (${now.pct.toFixed(3)}% of frame)` +
  (was ? `   was ${was.n}` : ''));
console.log(`  mean red              ${now.mean.toFixed(1).padStart(8)}${d(now.mean, was && was.mean)}`);
console.log(`  p1  / p10 red         ${String(now.p1).padStart(8)}${d(now.p1, was && was.p1, 0)}` +
  `   ${String(now.p10).padStart(6)}${d(now.p10, was && was.p10, 0)}`);
console.log(`  median / p90 red      ${String(now.p50).padStart(8)}${d(now.p50, was && was.p50, 0)}` +
  `   ${String(now.p90).padStart(6)}${d(now.p90, was && was.p90, 0)}`);
console.log(`  share under 20 red    ${now.under20.toFixed(1).padStart(8)}%${d(now.under20, was && was.under20)}`);
console.log(`  share under 40 red    ${now.under40.toFixed(1).padStart(8)}%${d(now.under40, was && was.under40)}`);
console.log(`\n  the critic reads 37 in red on this population and asks for 90 to 110.`);
console.log('  A shrinking population with a rising mean is the term arriving; a shrinking');
console.log('  population with a flat mean is only the selection threshold moving.\n');
