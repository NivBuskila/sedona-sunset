/* Both metrics on the *same* region, which neither existing tool does.
 *
 * grad.mjs and hf.mjs each carry their own per-view presets, and for `ground`
 * they do not overlap: grad.mjs measures the floor at y 0.32-0.58, mid-frame,
 * while hf.mjs's near band is y 0.80-0.98, at the camera's feet. Those are
 * different distances and therefore different footprints, so "hold grad/L while
 * hf9 climbs" was never a statement about one surface. This reports grad, grad/L
 * and hf9 over one rectangle so a target stated in both can actually be tested.
 *
 * Usage: node tools/_band2.mjs <png...>            uses near and mid bands
 *        node tools/_band2.mjs <png...> y0 y1 x0 x1
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
import { finite } from './argcheck.mjs';

const args = process.argv.slice(2);
const files = args.filter(a => a.endsWith('.png'));
const nums = args.filter(a => !a.endsWith('.png'));
if (!files.length) { console.error('_band2.mjs: no png paths given.'); process.exit(2); }
if (nums.length && nums.length !== 4) {
  console.error('_band2.mjs: give four numbers y0 y1 x0 x1 as frame fractions, or none.');
  process.exit(2);
}
const custom = nums.length
  ? [['custom', finite('y0', nums[0]), finite('y1', nums[1]), finite('x0', nums[2]), finite('x1', nums[3])]]
  : null;
/* The same rectangles hf.mjs uses by default, so the hf9 column is comparable
   with every figure already recorded against that tool. */
const BANDS = custom || [['near', 0.80, 0.98, 0.15, 0.85], ['mid', 0.60, 0.70, 0.30, 0.70]];

const R = 4;
function boxHP(L, w, h) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -R; d <= R; d++) { const xx = x + d; if (xx < 0 || xx >= w) continue; s += L[y * w + xx]; n++; }
    t[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy < 0 || yy >= h) continue; s += t[yy * w + x]; n++; }
    o[y * w + x] = s / n;
  }
  let q = 0;
  for (let i = 0; i < o.length; i++) { const d = L[i] - o[i]; q += d * d; }
  return Math.sqrt(q / o.length);
}

console.log('file                     band     grad     grad/L    hf9     hf9/L    L mean');
for (const f of files) {
  const img = decode(readFileSync(f));
  for (const [name, y0, y1, x0, x1] of BANDS) {
    const px0 = Math.round(img.w * x0), px1 = Math.round(img.w * x1);
    const py0 = Math.round(img.h * y0), py1 = Math.round(img.h * y1);
    const w = px1 - px0, h = py1 - py0;
    if (w < 16 || h < 16) { console.error(`_band2.mjs: band ${name} is ${w}x${h}, too small.`); process.exit(2); }
    const L = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((py0 + y) * img.w + (px0 + x)) * img.ch;
      L[y * w + x] = (0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2]) / 255;
    }
    let g = 0, n = 0, sum = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      sum += L[y * w + x];
      if (x + 1 < w) { g += Math.abs(L[y * w + x + 1] - L[y * w + x]); n++; }
      if (y + 1 < h) { g += Math.abs(L[(y + 1) * w + x] - L[y * w + x]); n++; }
    }
    const mean = sum / (w * h), grad = g / n, hf = boxHP(L, w, h);
    /* hf9 is an unnormalised RMS, so a brighter region reads higher for the same
       surface. hf9/L is printed beside it for the same reason grad/L is printed
       beside grad, and it is the one to compare across regions of unequal
       exposure. */
    console.log(`${f.split(/[\\/]/).pop().padEnd(24)} ${name.padEnd(7)} ` +
      `${grad.toFixed(4)}   ${(grad / mean).toFixed(4)}   ${hf.toFixed(4)}  ${(hf / mean).toFixed(4)}   ${mean.toFixed(3)}`);
  }
}
