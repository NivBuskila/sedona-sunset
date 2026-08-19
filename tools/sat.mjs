/* Measure HSV saturation of a render, so colour can be argued with a number
 * instead of an opinion.
 *
 *   node tools/sat.mjs shots/sys1e_*.png
 *   node tools/sat.mjs --region 0.30 0.50 0.24 0.18 shots/sys1e_wash_low.png
 *
 * Measure *region crops*, not whole frames. A whole-frame figure averages in the
 * sky, the walls and the floor together and is meaningless — three surfaces with
 * genuinely different correct answers collapsed into one number. Pass --region to
 * fence off one surface; the default regions below are a rough floor/rock split
 * kept only for a quick look.
 *
 * The distribution matters more than the mean, so p99 is reported. A real wash
 * floor gets a long saturated tail from mixed lithology — iron-stained red clasts
 * and varnished near-black pebbles beside pale quartz sand — and a narrow band at
 * the right mean still reads as procedural.
 *
 * Targets, from CONTRACT.md, measured on real photographs:
 *   Sedona rock, warm low sun   mean 0.42-0.65   p95 0.59-1.00
 *   Sunlit dry wash floor       mean 0.47-0.56   p95 0.67-0.74   p99 0.88
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

function stats(vals) {
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  let sum = 0;
  for (const v of vals) sum += v;
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  return {
    n: vals.length, mean: sum / vals.length,
    p50: q(0.5), p95: q(0.95), p99: q(0.99),
  };
}

const argv = process.argv.slice(2);
let region = null;
if (argv[0] === '--region') {
  region = argv.slice(1, 5).map(Number);
  argv.splice(0, 5);
}

function measure(img, [fx, fy, fw, fh]) {
  const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
  const x1 = Math.min(img.w, x0 + Math.round(img.w * fw));
  const y1 = Math.min(img.h, y0 + Math.round(img.h * fh));
  const vals = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 12) continue;              // crushed black carries no hue
      vals.push((mx - mn) / mx);
    }
  }
  return stats(vals);
}

/* Fixed crops, one surface each, chosen so no window contains sky or straddles a
   wall/floor boundary. Named per viewpoint; a frame gets whichever apply. */
const REGIONS = {
  ground:    [['floor near', [0.20, 0.30, 0.35, 0.30]], ['floor mid', [0.36, 0.06, 0.30, 0.18]]],
  wash_low:  [['floor near', [0.30, 0.72, 0.35, 0.22]], ['floor mid', [0.30, 0.50, 0.24, 0.14]]],
  wash_mid:  [['floor near', [0.32, 0.76, 0.34, 0.20]], ['floor mid', [0.30, 0.54, 0.26, 0.14]]],
  wash_high: [['floor near', [0.34, 0.78, 0.32, 0.18]]],
  bend:      [['sand', [0.28, 0.66, 0.36, 0.26]]],
  sun_gap:   [['floor mid', [0.40, 0.72, 0.24, 0.18]]],
  wall_lit:  [['rock lit', [0.30, 0.24, 0.34, 0.34]]],
  wall_shade:[['rock', [0.30, 0.24, 0.34, 0.34]]],
};

const f = (x) => x == null ? '  —  ' : x.toFixed(3);
console.log('file                     region        n      mean   p50    p95    p99');

for (const file of argv) {
  const img = decode(readFileSync(file));
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  const key = Object.keys(REGIONS).find((k) => base.endsWith('_' + k));
  const list = region ? [['crop', region]] : (REGIONS[key] || [['whole', [0, 0, 1, 1]]]);
  let name = base.padEnd(23);
  for (const [label, r] of list) {
    const s = measure(img, r);
    console.log(`${name}  ${label.padEnd(10)} ${String(s ? s.n : 0).padStart(8)}  ${f(s && s.mean)} ${f(s && s.p50)} ${f(s && s.p95)} ${f(s && s.p99)}`);
    name = ''.padEnd(23);
  }
}
