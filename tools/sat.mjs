/* Measure HSV saturation of a render, so "reads as Mars" can be argued with a
 * number instead of an opinion.
 *
 *   node tools/sat.mjs shots/sys1d_*.png
 *
 * Sky is excluded: at sunset the sky is the one thing in frame that is allowed to
 * be pale and blue, and leaving it in drags every figure toward the middle. The
 * test is crude but reliable for this scene — sky pixels are the ones where blue
 * is not the smallest channel, since every rock and dirt pixel here is red-
 * dominant with blue darkest.
 *
 * Reference figures the critic measured from photographs:
 *   Sedona red rock, including warm low sun   mean 0.31-0.36   p95 0.55-0.66
 *   Arizona wash floor                        mean 0.09
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

function stats(vals) {
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  let sum = 0;
  for (const v of vals) sum += v;
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  return { n: vals.length, mean: sum / vals.length, p50: q(0.5), p95: q(0.95) };
}

const f = (x) => x == null ? '  —  ' : x.toFixed(3);
console.log('file                          region      n      mean   p50    p95');

for (const file of process.argv.slice(2)) {
  const img = decode(readFileSync(file));
  const all = [], floor = [];
  /* The lower third of the frame is floor in every viewpoint in the set except
     the two wall shots, where it is the near ground at the foot of the wall —
     which is also wash floor. */
  const floorY = Math.floor(img.h * 0.68);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 12) continue;              // crushed black carries no hue
      if (b >= g) continue;               // sky, and haze near the sun
      const s = (mx - mn) / mx;
      all.push(s);
      if (y >= floorY) floor.push(s);
    }
  }
  const a = stats(all), fl = stats(floor);
  const nm = file.replace(/^.*[\\/]/, '').padEnd(28);
  console.log(`${nm}  ground  ${String(a ? a.n : 0).padStart(8)}  ${f(a && a.mean)} ${f(a && a.p50)} ${f(a && a.p95)}`);
  console.log(`${''.padEnd(28)}  floor   ${String(fl ? fl.n : 0).padStart(8)}  ${f(fl && fl.mean)} ${f(fl && fl.p50)} ${f(fl && fl.p95)}`);
}
