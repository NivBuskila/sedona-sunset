/* The sun is a requirement. What does buying it cost, and can it be bought at all?
 *
 *   node tools/_sunexp.mjs
 *
 * The disc is unoccluded (tools/sundisc.mjs, once its stale camera table was
 * fixed) and still invisible, because the sky immediately beside it sits at 249 cv
 * and ACES has no shoulder left to separate 255 from 249. The disc's own radiance
 * is not the lever: a half-degree disc carrying the solar irradiance is ~15000x
 * that irradiance and pins at 255 whatever happens. Neither is the aureole -
 * tools/aureole.mjs prices amplitude 0.20 at only a few cv off the near-sun sky
 * while taking a visible bite out of the dome's contribution to irradiance.
 *
 * That leaves the level. Two things make this worth doing rather than merely
 * possible: the lit wall is at V 0.808 against a 0.59-0.73 target and the wash
 * floor is at 0.610 against 0.55, so both are *over* and a reduction moves them
 * toward band rather than spending them. The constraint that actually binds is the
 * shadow gate at 0.222 in a 0.15-0.25 band, and tools/expose.mjs measures its
 * elasticity to global exposure at about 0.3 - so a third off the level costs it
 * about a tenth of itself, which it can afford.
 *
 * Everything here is CPU. The ungraded captures are inverted through the exact
 * ACES curve to scene-linear, re-levelled, and re-encoded; the sky and disc
 * columns come from the same LUT src/sky.js samples, so no variant needs a render.
 * The graded columns are carried across by the ratio measured on the ungraded
 * ones, which is valid in exactly these windows because System 7 established them
 * to be luminance-neutral under everything in the grade except the curve.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
import { forward, inverse } from './tone.mjs';
import { computeAtmosphere, SUN_EL, MIE_G } from '../src/atmos.js';

const E0 = 1.15;
const SCALE = 19;
const CANDIDATES = [1.15, 1.05, 0.95, 0.85, 0.78, 0.70, 0.62];

/* ---- the frame half: re-level an ungraded capture and re-measure ---- */

const relevel = (px, i, e) => {
  const lin = inverse([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], E0);
  return forward([lin[0] * e / E0, lin[1] * e / E0, lin[2] * e / E0], E0);
};
const V = (c) => Math.max(c[0], c[1], c[2]);
const S = (c) => { const m = V(c); return m > 0 ? (m - Math.min(c[0], c[1], c[2])) / m : 0; };

/** Mean V, mean saturation and grad/L over a fractional window. */
function region(file, e, win) {
  const { w, h, ch, px } = decode(readFileSync(file));
  const x0 = Math.round(win[0] * w), x1 = Math.round(win[1] * w);
  const y0 = Math.round(win[2] * h), y1 = Math.round(win[3] * h);
  let sv = 0, ss = 0, n = 0, g = 0, ng = 0, sl = 0;
  const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = relevel(px, (y * w + x) * ch, e);
      sv += V(c); ss += S(c); sl += lumOf(c); n++;
      if (x + 1 < x1 && y + 1 < y1) {
        const cx = relevel(px, (y * w + x + 1) * ch, e);
        const cy = relevel(px, ((y + 1) * w + x) * ch, e);
        g += Math.hypot(lumOf(cx) - lumOf(c), lumOf(cy) - lumOf(c)); ng++;
      }
    }
  }
  const L = sl / n;
  return { V: sv / n, sat: ss / n, L, gradOverL: (g / ng) / L };
}

/* ---- the sky half: the near-sun sky and the disc step, from the LUT ---- */

const A = computeAtmosphere();
const { lut, SKY_W, SKY_H, mieTintRGB } = A;
const phaseHG = (c, g) => {
  const g2 = g * g;
  return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
};
const skyAt = (deg) => {
  const y = Math.sin(SUN_EL);
  const v = 0.5 + 0.5 * Math.sign(y) * Math.sqrt(Math.abs(y));
  const iy = Math.min(SKY_H - 1, Math.max(0, Math.round(v * (SKY_H - 1))));
  const ix = Math.min(SKY_W - 1, Math.max(0, Math.round(deg / 180 * (SKY_W - 1))));
  const i = (iy * SKY_W + ix) * 4;
  const ph = phaseHG(Math.cos(deg * Math.PI / 180), MIE_G);
  return [0, 1, 2].map((k) => SCALE * lut[i + k] + lut[i + 3] * ph * mieTintRGB[k] * SCALE);
};
const SKY1 = skyAt(1), SKY90 = skyAt(90);
const cvOf = (linear3, e) => Math.round(255 * forward(linear3, e)[1]);

/* ---- the ledger ---- */

const WALL = [0.30, 0.80, 0.20, 0.70];   // lit rock face, wall_lit
const FLOOR = [0.20, 0.80, 0.55, 0.95];  // wash floor, ground
const base = {
  lit: region('shots/sys4m_np_wall_lit.png', E0, WALL),
  flr: region('shots/sys4m_np_ground.png', E0, FLOOR),
  shd: region('shots/sys4m_np_wall_shade.png', E0, WALL),
};
/* Measured on the shipped build with the real tools, carried by ratio. */
const GRADED = { litV: 0.808, flrV: 0.610, flrSat: 0.572, litSat: 0.690, gate: 0.222, flrGrad: 0.149 };

console.log(`\n  shipped exposure ${E0}; sun elevation ${(SUN_EL * 180 / Math.PI).toFixed(0)}\u00b0\n`);
console.log('              |------------ the disc ------------|  |--------- what it costs ---------|');
console.log('  exposure     sky cv @1\u00b0   step    sky sat @90\u00b0   lit wall V   floor V   floor grad/L   gate');
for (const e of CANDIDATES) {
  const cv1 = cvOf(SKY1, e);
  const l = region('shots/sys4m_np_wall_lit.png', e, WALL);
  const f = region('shots/sys4m_np_ground.png', e, FLOOR);
  const s = region('shots/sys4m_np_wall_shade.png', e, WALL);
  /* Gate is a ratio of means, so it transfers by its own ungraded ratio. */
  const gate = GRADED.gate * ((s.L / l.L) / (base.shd.L / base.lit.L));
  const litV = GRADED.litV * (l.V / base.lit.V);
  const flrV = GRADED.flrV * (f.V / base.flr.V);
  const flrG = GRADED.flrGrad * (f.gradOverL / base.flr.gradOverL);
  const skySat = S(forward(SKY90, e));
  const mark = (v, lo, hi) => (v >= lo && v <= hi ? ' ' : '!');
  console.log(`  ${e.toFixed(2)}          ${String(cv1).padStart(4)}      ` +
    `${String(255 - cv1).padStart(3)}       ${skySat.toFixed(3)}        ` +
    `${litV.toFixed(3)}${mark(litV, 0.59, 0.73)}    ${flrV.toFixed(3)}    ` +
    `${flrG.toFixed(3)}${mark(flrG, 0.10, 0.20)}        ${gate.toFixed(3)}${mark(gate, 0.15, 0.25)}` +
    `${e === E0 ? '   <- shipped' : ''}`);
}
console.log('\n  ! marks a figure outside its contracted band.');
console.log('  a 10 cv step across a hard half-degree edge is the visibility floor;');
console.log('  the disc pins at 255, so the step column *is* the disc contrast.\n');
