// Measure the darkest population in a crop, and fork post vs nopost.
// A "pure black" claim is testable: is it literally 0, or is it 14,5,3?
// And if nopost is not black but post is, the defect is the grade, not the shading.
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

function load(p) { return decode(readFileSync(p)); }

function analyse(img, x0, y0, x1, y1) {
  const bins = { z: 0, b4: 0, b8: 0, b16: 0, b32: 0, b64: 0 };
  let n = 0, minL = 1e9, minPx = null;
  const lums = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = (y * img.w + x) * img.ch;
      const r = img.px[k], g = img.px[k + 1], b = img.px[k + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lums.push(L);
      n++;
      if (r === 0 && g === 0 && b === 0) bins.z++;
      if (L < 4) bins.b4++;
      if (L < 8) bins.b8++;
      if (L < 16) bins.b16++;
      if (L < 32) bins.b32++;
      if (L < 64) bins.b64++;
      if (L < minL) { minL = L; minPx = [r, g, b]; }
    }
  }
  lums.sort((a, b) => a - b);
  const q = (f) => lums[Math.min(lums.length - 1, Math.floor(f * lums.length))];
  return { n, bins, minL, minPx, p01: q(0.001), p1: q(0.01), p5: q(0.05), p50: q(0.5), p95: q(0.95) };
}

const args = process.argv.slice(2);
const file = args[0];
const rect = args[1].split(',').map(Number);
const img = load(file);
const [x0, y0, x1, y1] = rect;
const a = analyse(img, x0, y0, Math.min(x1, img.w), Math.min(y1, img.h));

console.log(`${file}  [${x0},${y0} - ${x1},${y1}]  ${a.n} px  (image ${img.w}x${img.h})`);
console.log(`  literal 0,0,0 : ${a.bins.z}  (${(100 * a.bins.z / a.n).toFixed(2)}%)`);
console.log(`  L<4  : ${(100 * a.bins.b4 / a.n).toFixed(2)}%   L<8 : ${(100 * a.bins.b8 / a.n).toFixed(2)}%   L<16: ${(100 * a.bins.b16 / a.n).toFixed(2)}%`);
console.log(`  L<32 : ${(100 * a.bins.b32 / a.n).toFixed(2)}%   L<64: ${(100 * a.bins.b64 / a.n).toFixed(2)}%`);
console.log(`  min L=${a.minL.toFixed(1)} at rgb(${a.minPx.join(',')})`);
console.log(`  pct L: p0.1=${a.p01.toFixed(1)} p1=${a.p1.toFixed(1)} p5=${a.p5.toFixed(1)} p50=${a.p50.toFixed(1)} p95=${a.p95.toFixed(1)}`);
