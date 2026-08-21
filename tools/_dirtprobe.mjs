/* Offline test of the standing hypothesis for the midground: does the dirt
 * albedo have any energy left at gravel scale once a midground pixel's footprint
 * has averaged over it?
 *
 * CONTRACT.md says to test this before touching the sampling again, so this does
 * it without a render. The dirt map is generated exactly as main.js generates it,
 * then averaged over the *anisotropic* box a real midground pixel covers, and the
 * survivor is measured with the same statistics grad.mjs reports.
 *
 * Geometry of the wash_mid 'mid' band, worked from the capture: eye 1.65 m,
 * 58 deg vertical fov over 900 rows, pitch 0. The band at y 0.60-0.70 looks
 * 6.3-12.5 degrees below the horizon, so it is ground at 7.4-15 m. One pixel
 * there spans about 12 mm across the view and 76 mm along it. The dirt tile is
 * 2.6 m over 1024 texels, so a texel is 2.54 mm: the pixel is 4.8 texels wide
 * and 30 texels long.
 *
 *   node tools/_dirtprobe.mjs
 */
import { makeDirt, makeSand, makeGrit } from '../src/textures.js';

/* Luminance of an RGBA8 sRGB buffer, in display units, which is the space
   grad.mjs and hf.mjs both measure in. */
function lumOf(buf, size) {
  const L = new Float64Array(size * size);
  for (let i = 0; i < L.length; i++) {
    L[i] = (buf[i * 4] * 0.2126 + buf[i * 4 + 1] * 0.7152 + buf[i * 4 + 2] * 0.0722) / 255;
  }
  return L;
}

/** Box-average by (bx, by) texels with wraparound, then decimate. */
function box(L, size, bx, by) {
  const w = Math.max(1, Math.floor(size / bx)), h = Math.max(1, Math.floor(size / by));
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < by; j++) {
        const sy = (y * by + j) % size;
        for (let i = 0; i < bx; i++) s += L[sy * size + ((x * bx + i) % size)];
      }
      out[y * w + x] = s / (bx * by);
    }
  }
  return { L: out, w, h };
}

function stats(L, w, h) {
  let g1 = 0, n1 = 0, g4 = 0, n4 = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = L[y * w + x];
      sum += c; sum2 += c * c;
      if (x + 1 < w) { g1 += Math.abs(L[y * w + x + 1] - c); n1++; }
      if (y + 1 < h) { g1 += Math.abs(L[(y + 1) * w + x] - c); n1++; }
      if (x + 4 < w) { g4 += Math.abs(L[y * w + x + 4] - c); n4++; }
      if (y + 4 < h) { g4 += Math.abs(L[(y + 4) * w + x] - c); n4++; }
    }
  }
  const n = w * h, mean = sum / n;
  return {
    grad: g1 / n1, ratio: (g1 / n1) / Math.max(1e-9, g4 / n4), mean,
    sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), w, h,
  };
}

/* RMS of a 9-tap box high-pass, which is exactly the statistic hf.mjs reports —
   so a number here is directly comparable with the 0.052 the midground measures
   and the 0.115-0.137 real arroyo photographs hold. */
function hf9(L, w, h) {
  const R = 4;
  const t = new Float64Array(w * h), o = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -R; d <= R; d++) { const xx = x + d; if (xx < 0 || xx >= w) continue; s += L[y*w+xx]; n++; }
    t[y * w + x] = s / n;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy < 0 || yy >= h) continue; s += t[yy*w+x]; n++; }
    o[y * w + x] = s / n;
  }
  let s = 0;
  for (let i = 0; i < w * h; i++) { const d = L[i] - o[i]; s += d * d; }
  return Math.sqrt(s / (w * h));
}

const CASES = [
  ['mip 0 (2.5 mm/texel)', 1, 1],
  ['near field, 4 mm px', 2, 2],
  ['mid band, perfect aniso (5x5)', 5, 5],
  ['mid band, as rendered (5 x 30)', 5, 30],
  ['mid band, plain mip (30x30)', 30, 30],
  ['far, plain mip (64x64)', 64, 64],
];

/* The grit layer's own channels, at mip 0 only — it is read footprint-locked, so
   mip 0 is the only level it is ever read at and the question is simply how much
   contrast one texel of it carries. R is tone about 0.5, A is crevice occlusion. */
{
  const g = makeGrit(256).image.data;
  for (const [ch, label] of [[0, 'grit R (tone)'], [3, 'grit A (occlusion)']]) {
    const v = new Float64Array(256 * 256);
    for (let i = 0; i < v.length; i++) v[i] = g[i * 4 + ch] / 255;
    const s = stats(v, 256, 256);
    console.log(`${label.padEnd(22)} mean ${s.mean.toFixed(3)}  sd ${s.sd.toFixed(4)}  ` +
      `grad ${s.grad.toFixed(4)}  hf/lf ${s.ratio.toFixed(2)}  hf9 ${hf9(v, 256, 256).toFixed(4)}`);
  }
}

for (const [name, make] of [['dirt', makeDirt], ['sand', makeSand]]) {
  const size = name === 'dirt' ? 1024 : 512;
  const t = make(size);
  const L = lumOf(t.albedo.image.data, size);
  console.log(`\n${name} albedo  ${size}x${size}`);
  console.log('  case                              w x h        grad     hf/lf   L mean   L sd     hf9');
  for (const [label, bx, by] of CASES) {
    const b = box(L, size, bx, by);
    if (b.w < 12 || b.h < 12) continue;
    const s = stats(b.L, b.w, b.h);
    console.log(`  ${label.padEnd(32)} ${String(b.w).padStart(4)}x${String(b.h).padEnd(5)} ` +
      `${s.grad.toFixed(4)}   ${s.ratio.toFixed(2).padStart(5)}   ${s.mean.toFixed(3)}   ` +
      `${s.sd.toFixed(4)}   ${hf9(b.L, b.w, b.h).toFixed(4)}`);
  }
}
