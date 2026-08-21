/* The sky, measured three ways, because the critique names three separate faults.
 *
 *   node tools/skyprofile.mjs sys4n            # every view that has sky in it
 *   node tools/skyprofile.mjs sys4n wash_low   # one view, with the radial profile
 *
 * The three faults are "cold and pale", "no aureole, so the disc reads as a
 * blemish", and "banding, up to 14 identical pixels in a column". They need three
 * different measurements and only the first is a single number:
 *
 *   by elevation   golden hour is a *gradient* - warm and saturated near the
 *                  horizon grading to deep blue overhead. A single mean cannot
 *                  see that, and a mean of 185/197/212 is exactly what a flat
 *                  sky and a graded one both average to. So bin by elevation
 *                  angle and look at the hue and saturation columns as a curve.
 *
 *   by angle from the sun   an aureole is a falloff. The complaint is not that
 *                  the near-sun sky is too dim but that it is a *plateau*: 244
 *                  at two pixels and still 240-245 sixty-four pixels out, with
 *                  the disc at 255 on top. That is a 4% step on a tabletop. The
 *                  radial column says whether there is a curve there at all.
 *
 *   run lengths    banding is quantisation, so measure it as quantisation:
 *                  the longest run of identical 8-bit values down a column of
 *                  sky, and how many distinct levels the whole column holds.
 *
 * Sky pixels are taken as the contiguous run from the top of each column down to
 * the skyline, which is found as the first sustained collapse in luminance. That
 * is reliable here because the sky is the brightest thing in every frame by a
 * wide margin and the skyline is a hard edge - and it is worth doing rather than
 * using a fixed window, because a fixed window either clips the sky near the
 * horizon, which is the part that carries the warmth, or eats rock.
 *
 * Angles come from the camera rather than from a guess: elevation from the view's
 * pitch and the vertical field of view, and angle-from-sun from the brightest
 * pixel in frame, which is the disc. Taking the sun's position from the image
 * instead of projecting it avoids re-deriving the yaw convention, which is the
 * bug that made tools/sundisc.mjs disagree with every capture for a week.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
import { byName, VIEWS } from './views.mjs';

const VFOV = 55;
const tag = process.argv[2] || 'sys4n';
const only = process.argv[3];

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const satOf = (r, g, b) => { const m = Math.max(r, g, b); return m > 0 ? (m - Math.min(r, g, b)) / m : 0; };
const hueOf = (r, g, b) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};

/** The skyline: per column, the last row that is still sky. */
function skyline(w, h, ch, px) {
  const top = [];
  for (let x = 0; x < w; x++) {
    /* Reference level from the top eight rows of this column. */
    let ref = 0;
    for (let y = 0; y < 8; y++) { const i = (y * w + x) * ch; ref += lum(px[i], px[i + 1], px[i + 2]); }
    ref /= 8;
    let end = h - 1;
    for (let y = 8; y < h; y++) {
      const i = (y * w + x) * ch;
      const L = lum(px[i], px[i + 1], px[i + 2]);
      if (L < ref * 0.55) {
        /* Confirm it stays down, so a dark bird or a mote is not a skyline. */
        let below = 0;
        for (let k = 1; k <= 6 && y + k < h; k++) {
          const j = ((y + k) * w + x) * ch;
          if (lum(px[j], px[j + 1], px[j + 2]) < ref * 0.65) below++;
        }
        if (below >= 5) { end = y - 1; break; }
      }
    }
    top.push(end);
  }
  return top;
}

const EL_BINS = [0, 2, 4, 7, 11, 16, 22, 30, 90];
const RAD_BINS = [0, 0.5, 1, 2, 4, 8, 16, 32, 90];

function analyse(file, view) {
  const { w, h, ch, px } = decode(readFileSync(file));
  const line = skyline(w, h, ch, px);
  const tanH = Math.tan(VFOV / 2 * Math.PI / 180);
  const aspect = w / h;

  /* Brightest sky pixel = the disc, when there is one in frame. */
  let bx = -1, by = -1, best = -1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y <= line[x]; y++) {
      const i = (y * w + x) * ch;
      const L = lum(px[i], px[i + 1], px[i + 2]);
      if (L > best) { best = L; bx = x; by = y; }
    }
  }

  const el = new Array(EL_BINS.length - 1).fill(0).map(() => ({ n: 0, r: 0, g: 0, b: 0, s: 0, hx: 0, hy: 0 }));
  const rad = new Array(RAD_BINS.length - 1).fill(0).map(() => ({ n: 0, r: 0, g: 0, b: 0, s: 0, L: 0, mx: 0 }));
  let nSky = 0;

  for (let x = 0; x < w; x++) {
    for (let y = 0; y <= line[x]; y++) {
      const i = (y * w + x) * ch;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      nSky++;
      /* Elevation of this pixel. */
      const ndcY = 1 - 2 * (y + 0.5) / h;
      const elev = view.pitch + Math.atan(ndcY * tanH) * 180 / Math.PI;
      let k = EL_BINS.findIndex((v, j) => j < EL_BINS.length - 1 && elev >= v && elev < EL_BINS[j + 1]);
      if (k >= 0) {
        const q = el[k]; q.n++; q.r += r; q.g += g; q.b += b; q.s += satOf(r, g, b);
        const hh = hueOf(r, g, b) * Math.PI / 180;
        q.hx += Math.cos(hh); q.hy += Math.sin(hh);
      }
      /* Angular distance from the disc, in degrees. */
      if (bx >= 0 && best > 200) {
        const dxn = ((x - bx) / w) * 2 * tanH * aspect, dyn = ((y - by) / h) * 2 * tanH;
        const ang = Math.atan(Math.hypot(dxn, dyn)) * 180 / Math.PI;
        let j = RAD_BINS.findIndex((v, m) => m < RAD_BINS.length - 1 && ang >= v && ang < RAD_BINS[m + 1]);
        if (j >= 0) {
          const q = rad[j]; q.n++; q.r += r; q.g += g; q.b += b;
          q.s += satOf(r, g, b); q.L += lum(r, g, b); q.mx = Math.max(q.mx, lum(r, g, b));
        }
      }
    }
  }

  /* Banding: the longest run of identical values down a sky column, and the
     number of distinct levels it passes through. Measured on green, which carries
     most of the luminance and therefore most of the visible stepping. */
  let worstRun = 0, worstCol = -1, levels = 0;
  for (let x = 8; x < w; x += 8) {
    if (line[x] < 60) continue;
    let run = 1, mx = 1; const seen = new Set();
    for (let y = 1; y <= line[x]; y++) {
      const a = px[((y - 1) * w + x) * ch + 1], c = px[(y * w + x) * ch + 1];
      seen.add(c);
      if (a === c) { run++; mx = Math.max(mx, run); } else run = 1;
    }
    if (mx > worstRun) { worstRun = mx; worstCol = x; levels = seen.size; }
  }

  return { w, h, el, rad, nSky, worstRun, worstCol, levels, disc: { x: bx, y: by, L: best }, line };
}

const names = only ? [only] : VIEWS.map((v) => v.name);
for (const name of names) {
  const view = byName(name);
  let a;
  try { a = analyse(`shots/${tag}_${name}.png`, view); } catch { continue; }
  if (a.nSky < 4000) continue;

  console.log(`\n=== ${tag}_${name}  (pitch ${view.pitch}, ${(100 * a.nSky / (a.w * a.h)).toFixed(0)}% sky) ===\n`);
  console.log('  elevation      n        R    G    B     sat     hue     V');
  for (let k = 0; k < a.el.length; k++) {
    const q = a.el[k]; if (q.n < 200) continue;
    const r = q.r / q.n, g = q.g / q.n, b = q.b / q.n;
    let hue = Math.atan2(q.hy, q.hx) * 180 / Math.PI; if (hue < 0) hue += 360;
    console.log(`  ${String(EL_BINS[k]).padStart(3)}-${String(EL_BINS[k + 1]).padEnd(3)}\u00b0  ${String(q.n).padStart(8)}   ` +
      `${r.toFixed(0).padStart(4)} ${g.toFixed(0).padStart(4)} ${b.toFixed(0).padStart(4)}   ` +
      `${(q.s / q.n).toFixed(3)}   ${hue.toFixed(0).padStart(5)}   ${(Math.max(r, g, b) / 255).toFixed(3)}`);
  }

  if (a.disc.L > 200) {
    console.log(`\n  radial from the brightest pixel (${a.disc.x},${a.disc.y}, L ${a.disc.L.toFixed(0)}):`);
    console.log('  from sun         n        R    G    B     sat    mean L   max L');
    for (let k = 0; k < a.rad.length; k++) {
      const q = a.rad[k]; if (q.n < 8) continue;
      console.log(`  ${String(RAD_BINS[k]).padStart(4)}-${String(RAD_BINS[k + 1]).padEnd(4)}\u00b0 ${String(q.n).padStart(8)}   ` +
        `${(q.r / q.n).toFixed(0).padStart(4)} ${(q.g / q.n).toFixed(0).padStart(4)} ${(q.b / q.n).toFixed(0).padStart(4)}   ` +
        `${(q.s / q.n).toFixed(3)}   ${(q.L / q.n).toFixed(1).padStart(6)}   ${q.mx.toFixed(0).padStart(5)}`);
    }
  }
  console.log(`\n  banding: longest identical run ${a.worstRun} px (column ${a.worstCol}), ` +
    `${a.levels} distinct green levels down it`);
}
console.log('');
