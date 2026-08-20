/* High-frequency energy per horizontal band, matching the metric the critic
   used: RMS of a 9px high-pass on luminance. Real dry-wash photographs hold
   0.075-0.094 near-field and rise to 0.115-0.137 at mid distance, because more
   objects fall into each pixel as the surface tilts away. A render that falls
   off with depth is losing the midground.

   Usage: node tools/hf.mjs shots/sys1h_sun_gap.png [bands...]
   Bands are y0,y1 pairs in fractions of frame height. */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const R = 4;                        // 9px kernel

function lum(img) {
  const { w, h, px, ch } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; i < L.length; i++, p += ch) {
    /* sRGB-space luma. The critic worked from the delivered PNG, so the
       high-pass has to be taken in the same space, not in linear light. */
    L[i] = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
  }
  return L;
}

/* Separable box blur of radius R, clamped at the edges. Subtracting a box from
   the original is a crude high-pass but it is the one being measured against,
   and it is scale-selective enough to separate grain from form. */
function blur(L, w, h) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let d = -R; d <= R; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        s += L[y * w + xx]; n++;
      }
      t[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0, n = 0;
      for (let d = -R; d <= R; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        s += t[yy * w + x]; n++;
      }
      o[y * w + x] = s / n;
    }
  }
  return o;
}

/* Default bands are the floor only. Sky and wall carry their own energy and
   averaging them in would hide exactly the fall-off being looked for. */
const BANDS = {
  sun_gap:  [['near', 0.80, 0.98, 0.20, 0.80], ['mid', 0.60, 0.70, 0.30, 0.70]],
  wash_low: [['near', 0.78, 0.96, 0.15, 0.85], ['mid', 0.58, 0.68, 0.30, 0.70]],
  wash_mid: [['near', 0.80, 0.97, 0.15, 0.85], ['mid', 0.60, 0.70, 0.30, 0.70]],
  bend:     [['near', 0.78, 0.96, 0.15, 0.85], ['mid', 0.58, 0.68, 0.25, 0.75]],
};

for (const f of process.argv.slice(2)) {
  const img = decode(readFileSync(f));
  const L = lum(img), B = blur(L, img.w, img.h);
  const key = Object.keys(BANDS).find(k => f.includes(k));
  const bands = BANDS[key] || [['near', 0.80, 0.98, 0.15, 0.85], ['mid', 0.60, 0.70, 0.30, 0.70]];
  const out = [];
  for (const [name, y0, y1, x0, x1] of bands) {
    const ya = Math.round(img.h * y0), yb = Math.round(img.h * y1);
    const xa = Math.round(img.w * x0), xb = Math.round(img.w * x1);
    let s = 0, n = 0;
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const d = L[y * img.w + x] - B[y * img.w + x];
        s += d * d; n++;
      }
    }
    out.push(`${name} ${Math.sqrt(s / n).toFixed(4)}`);
  }
  console.log(f.replace(/.*[\\/]/, '').padEnd(26), out.join('   '));
}
