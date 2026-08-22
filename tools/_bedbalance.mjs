/* Sweep the grain bed's band weights offline, and predict what they do to the
 * two metrics that now define the target:
 *
 *   grad/L  the one-pixel luminance gradient, which must stay inside 0.12-0.16
 *   hf9     RMS of a 9-pixel high-pass, which must climb from 0.0748 toward the
 *           0.075-0.094 a real dry-wash photograph holds in its near field
 *
 * The point of the sweep is that those two are carried by *different features*.
 * At `ground`'s roughly 4 mm per pixel, the `fines` term (6-13 mm) and the
 * f=146 grain class (9-16 mm) are one to four pixels across and are what the
 * one-pixel gradient sees; the f=26 class is 40-94 mm, ten to twenty-four
 * pixels, and is what the 9-pixel high-pass sees. A single depth multiplier
 * moves both together, which is why DIRT_RELIEF_K ran out of grad/L budget
 * before hf9 arrived. Separate weights need not.
 *
 * THE PREDICTOR IS VALIDATED BEFORE IT IS USED. It has to reproduce a
 * measurement we already have from a paired capture — K = 1.5 raised `ground`
 * grad/L by 13.9% and near-field hf9 by 19.4% — or its ranking is worthless.
 * That check runs first and prints its error.
 */
import { makeDirt } from '../src/textures.js';
import { SUN_DIR } from '../src/atmos.js';
import { SUN_EL } from '../src/sky.js';
import { finite } from './argcheck.mjs';

const SIZE = finite('map size', process.argv[2], 512);
const TILE_M = 2.6;
const MM_PX = finite('mm per pixel', process.argv[3], 4.0);   // ground's floor footprint
/* Relief per height unit, and the fill fraction. 0.21 is the measured
   shadow-to-sunlit ratio, so a fully shadowed pixel keeps that share. */
const RELIEF_M = 0.025, FILL = 0.21;

const sxz = Math.hypot(SUN_DIR.x, SUN_DIR.z);
const Lx = Math.cos(SUN_EL) * SUN_DIR.x / sxz;
const Ly = Math.cos(SUN_EL) * SUN_DIR.z / sxz;
const Lz = Math.sin(SUN_EL);

/* Box-filter the height map down to the pixel grid, which is what the mip chain
   does before the shader takes a normal from it. */
function toPixels(H, size, texelMM) {
  const k = MM_PX / texelMM;                 // texels per pixel
  const w = Math.floor(size / k);
  const P = new Float32Array(w * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      const x0 = Math.floor(x * k), y0 = Math.floor(y * k);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * k));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += H[yy * size + xx]; n++; }
      P[y * w + x] = s / n;
    }
  }
  return { P, w };
}

/* Shade it. Only the shape of the luminance field matters, because every figure
   this tool reports is a ratio against the same tool run on the baseline. */
function shade(P, w, reliefK) {
  const s = (RELIEF_M * reliefK) / (MM_PX / 1000);   // height units to pixel widths
  const L = new Float32Array(w * w);
  const at = (x, y) => P[((y % w) + w) % w * w + (((x % w) + w) % w)];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * s;
      const gy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * s;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const ndl = Math.max(0, (-gx * Lx - gy * Ly + Lz) * inv);
      /* Encoded, because both metrics are taken on the delivered PNG. */
      L[y * w + x] = Math.pow(FILL + (1 - FILL) * ndl, 1 / 2.2);
    }
  }
  return L;
}

function grad(L, w) {
  let g = 0, n = 0, sum = 0;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    sum += L[y * w + x];
    if (x + 1 < w) { g += Math.abs(L[y * w + x + 1] - L[y * w + x]); n++; }
    if (y + 1 < w) { g += Math.abs(L[(y + 1) * w + x] - L[y * w + x]); n++; }
  }
  return (g / n) / (sum / (w * w));
}

/* Same 9-tap separable box high-pass hf.mjs uses. */
function hf9(L, w) {
  const R = 4, t = new Float32Array(w * w), o = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -R; d <= R; d++) { const xx = x + d; if (xx < 0 || xx >= w) continue; s += L[y * w + xx]; n++; }
    t[y * w + x] = s / n;
  }
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy < 0 || yy >= w) continue; s += t[yy * w + x]; n++; }
    o[y * w + x] = s / n;
  }
  let q = 0;
  for (let i = 0; i < o.length; i++) { const d = L[i] - o[i]; q += d * d; }
  return Math.sqrt(q / o.length);
}

/* Terminator crossing, the binary-field guard, at pixel resolution. */
function pastTerm(P, w, reliefK) {
  const s = (RELIEF_M * reliefK) / (MM_PX / 1000);
  const at = (x, y) => P[((y % w) + w) % w * w + (((x % w) + w) % w)];
  let d = 0, rms = 0;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * s;
    const gy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * s;
    const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
    if ((-gx * Lx - gy * Ly + Lz) * inv <= 0) d++;
    rms += gx * gx + gy * gy;
  }
  return { dark: 100 * d / (w * w), slope: Math.sqrt(rms / (w * w)) };
}

const texelMM = TILE_M / SIZE * 1000;
const cache = new Map();
function run(bed, reliefK) {
  const key = JSON.stringify(bed);
  let px = cache.get(key);
  if (!px) {
    const d = makeDirt(SIZE, bed);
    const arm = d.arm.image.data;
    const H = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) H[i] = arm[i * 4 + 2] / 255;
    px = toPixels(H, SIZE, texelMM);
    cache.set(key, px);
  }
  const L = shade(px.P, px.w, reliefK);
  return { grad: grad(L, px.w), hf9: hf9(L, px.w), ...pastTerm(px.P, px.w, reliefK) };
}

const BASE = { fines: 1, coarse: 1, mid: 1, grit: 1 };
console.log(`map ${SIZE} (${texelMM.toFixed(2)} mm/texel), pixel ${MM_PX} mm, sun ${(SUN_EL * 180 / Math.PI).toFixed(0)} deg\n`);

/* ---- validate against the capture we already paid for ---- */
const b0 = run(BASE, 1.0), b15 = run(BASE, 1.5);
const pg = 100 * (b15.grad / b0.grad - 1), ph = 100 * (b15.hf9 / b0.hf9 - 1);
console.log('VALIDATION against the K=1.5 paired capture:');
console.log(`  grad/L  predicted ${pg.toFixed(1)}%   measured +13.9%   error ${(pg - 13.9).toFixed(1)} pts`);
console.log(`  hf9     predicted ${ph.toFixed(1)}%   measured +19.4%   error ${(ph - 19.4).toFixed(1)} pts`);
/* The two metrics do not earn the same trust and must not be given it.
 * hf9 lands within 4.3 points, so its ranking is usable. grad/L over-responds
 * by a factor of 2.1, and the reason is structural rather than a tuning error:
 * this simulation shades from the height map alone, whereas the real one-pixel
 * gradient also carries albedo mottle, the grit layer, the rake term, the
 * ripple and lineation shadows and the instanced clasts. Those dilute any
 * change to the normal field, so the real surface moves about half as far.
 * Rather than discard the column, it is divided by the measured over-response.
 * That is a one-point calibration and it is only defensible for interpolation
 * near it — which is where every candidate below sits. */
const GRAD_DAMP = pg / 13.9;
console.log(`  hf9 is usable as a ranking. grad/L is divided by the measured ${GRAD_DAMP.toFixed(2)}x`);
console.log(`  over-response; treat it as indicative and confirm by capture.\n`);

/* Measured baselines the percentages are applied to. */
const M_GRAD = 0.151, M_HF9 = 0.0748;
console.log('candidates. grad/L must stay <= 0.160; hf9 wants to climb toward 0.075-0.094:');
console.log('  fines coarse  mid  grit    K  |  grad/L    hf9    | slope  past-term');
function show(bed, K) {
  const r = run({ ...BASE, ...bed }, K);
  const g = M_GRAD * (1 + (r.grad / b0.grad - 1) / GRAD_DAMP);
  const h = M_HF9 * (r.hf9 / b0.hf9);
  const flag = g > 0.160 ? ' OUT' : (h > M_HF9 * 1.02 ? ' ok+' : '');
  console.log(`  ${(bed.fines ?? 1).toFixed(2)}  ${(bed.coarse ?? 1).toFixed(2)}  ${(bed.mid ?? 1).toFixed(2)}  ` +
    `${(bed.grit ?? 1).toFixed(2)}  ${K.toFixed(2)} |  ${g.toFixed(4)}  ${h.toFixed(4)}  |  ` +
    `${r.slope.toFixed(3)}  ${r.dark.toFixed(1)}%${flag}`);
}
show({}, 1.0);
show({}, 1.5);
console.log('  -- take the fine band down, leave the coarse alone --');
show({ fines: 0.5, grit: 0.6 }, 1.0);
show({ fines: 0.3, grit: 0.4 }, 1.0);
console.log('  -- then spend the freed grad/L budget on depth, which is what hf9 answers to --');
show({ fines: 0.5, grit: 0.6 }, 1.5);
show({ fines: 0.4, grit: 0.5 }, 1.5);
show({ fines: 0.3, grit: 0.4 }, 1.6);
show({ fines: 0.35, grit: 0.45, mid: 1.15 }, 1.6);
show({ fines: 0.3, grit: 0.4, mid: 1.2, coarse: 1.15 }, 1.7);
