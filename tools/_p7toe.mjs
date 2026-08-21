/* Predict what a candidate shadow toe does, from an ungraded capture.
 *
 *   node tools/_p7toe.mjs shots/sys2jc_np_wall_shade.png shots/sys2jc_np_wall_lit.png
 *
 * Same reason tools/_p7grade.mjs exists: a capture costs minutes and a curve has
 * four parameters, so the sweep has to happen on a PNG. It is valid on these two
 * windows in particular because every other term in the chain is either
 * luminance-neutral there by construction (the split tone is normalised to unit
 * Rec.709 luminance, and the vibrance is a mix toward luma, which preserves it
 * exactly) or measurably zero there (the vignette's smoothstep starts at rN 0.30
 * and both windows sit at rN 0.10; the defocus does not run past 2.4 m; the
 * aberration gate starts at rN 0.55). So the only thing standing between the
 * ungraded encoded frame and the graded one, on these windows, is the
 * post-encode luminance curve — which is exactly what is being swept.
 *
 * Reports the gate the way CONTRACT.md pins it: mean relative luminance of the
 * flat shaded face over the flat sunlit face, same window in both views, read
 * off the encoded PNG.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const GATE = [0.30, 0.24, 0.34, 0.34];   // fillprobe's flat-face window, both views
const STRUCT = [0.30, 0.24, 0.24, 0.24]; // grad.mjs's wall_shade face window

function crop(file, r) {
  const im = decode(readFileSync(file));
  const px = im.px || im.data, ch = im.ch || 4, w = im.w || im.width, h = im.h || im.height;
  const x0 = Math.round(r[0] * w), y0 = Math.round(r[1] * h);
  const cw = Math.round(r[2] * w), chh = Math.round(r[3] * h);
  const L = new Float64Array(cw * chh);
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const i = ((y0 + y) * w + (x0 + x)) * ch;
      L[y * cw + x] = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    }
  }
  return { L, w: cw, h: chh };
}

/* The curve as the shader will run it. Above `A` it is the existing pivoted
   luminance contrast, untouched, because that is what every colour figure in
   CONTRACT.md was measured through. Below `A` it is a cubic Hermite matching
   that curve's value and slope at A and pinned at the origin with slope `s0`,
   so there is no subtractive black point anywhere.

   That is not the same as nothing clipping, and the difference is what this tool
   previously got wrong. The curve is injective on (0, 1], so in floating point no
   positive value maps to zero — but the deliverable is 8-bit, and a value rounds
   to zero when it falls below half a code value. Near the origin the curve is
   te ~ s0 * e, so **every input below 0.5/s0 code values rounds to black**: at the
   s0 of 0.20 that shipped, that is everything under 2.5 code values, against 0.5
   in the control. A whole-frame count found 0.03% of wall_shade at literal zero
   ungraded and 1.38% graded, and it is this, not the curve. The `crush` column
   below is that threshold, and it is the figure to tune against.
   Because the mean slope over [0, A] is forced to vA/A < 1 while the slope at A
   is k, a low s0 buys slope above 1 in the middle of the band — the level comes
   down and the local gradient goes up, which is the pair the gate and the
   structure metric respectively want. */
function curve(e, { A, s0, k, p }) {
  const lin = (x) => (x - p) * k + p;
  if (A <= 0) return Math.max(0, Math.min(1, lin(e)));
  const vA = lin(A);
  if (e >= A) return Math.max(0, Math.min(1, lin(e)));
  const u = e / A, u2 = u * u, u3 = u2 * u;
  const h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return Math.max(0, A * s0 * h10 + vA * h01 + A * k * h11);
}

/* The chain as it ships today: a pivoted luminance gain, which is algebraically
   a gain plus a *negative* offset, so it is a subtractive black point at
   (k-1)*p/k encoded — 3.7 code values at k 1.03, p 0.5. Everything below that
   goes to zero. */
function current(e, { k, p }) {
  return Math.max(0, Math.min(1, (e - p) * k + p));
}

/* A non-monotone transfer curve does not read as a bad grade, it reads as
   posterised bands with an inverted one at the bottom, and it is reachable from
   a plausible-looking toeTop. Checked here so a swept parameter is rejected in
   the sweep rather than in a capture. */
function monotone(f) {
  let prev = -1;
  for (let i = 0; i <= 4096; i++) {
    const v = f(i / 4096);
    if (v < prev - 1e-9) return false;
    prev = v;
  }
  return true;
}

function stats({ L, w, h }, f) {
  const O = Float64Array.from(L, f);
  let sum = 0;
  for (const v of O) sum += v;
  const mean = sum / O.length;
  let g = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) { g += Math.abs(O[y * w + x + 1] - O[y * w + x]); n++; }
      if (y + 1 < h) { g += Math.abs(O[(y + 1) * w + x] - O[y * w + x]); n++; }
    }
  }
  /* Quantised, because the deliverable is an 8-bit PNG and a gradient that
     survives in floating point but not through Math.round has not survived. */
  const Q = Float64Array.from(O, v => Math.round(v * 255));
  let gq = 0, nq = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) { gq += Math.abs(Q[y * w + x + 1] - Q[y * w + x]); nq++; }
      if (y + 1 < h) { gq += Math.abs(Q[(y + 1) * w + x] - Q[y * w + x]); nq++; }
    }
  }
  const s = Float64Array.from(Q).sort();
  return {
    meanCV: mean * 255, gradCV: g / n * 255, gradQ: gq / nq,
    at0: 100 * s.filter(v => v <= 0).length / s.length,
    p1: s[Math.floor(0.01 * s.length)],
    levels: new Set(Array.from(s)).size,
  };
}

const [shadeFile, litFile] = process.argv.slice(2).filter(s => s.endsWith('.png'));
const gateShade = crop(shadeFile, GATE);
const gateLit = crop(litFile, GATE);
const struct = crop(shadeFile, STRUCT);
/* The lit side has its own structure target — grad/L 0.12-0.16 on midwall — and
   a toe deep enough to fix the shadow can reach up into it, so it is checked in
   the same sweep rather than discovered in a later capture. */
const litStruct = crop(litFile, [0.16, 0.30, 0.20, 0.20]);

const P = { p: 0.5, k: 1.03 };
/* Sweeping s0 at the shipped anchor, because s0 alone sets the crush threshold
   and the anchor is where the curve rejoins the contrast line. s0 = 1 is the one
   value that adds no clipping at all — unit slope at the origin means the first
   code value maps to itself — and it still darkens, because the curve has to
   reach vA = 0.0994 at A = 0.111 and so must sag below the 45 degree line to get
   there. The question the sweep answers is what that costs the gate. */
const S0 = [0.20, 0.40, 0.60, 0.80, 1.00];
const CANDIDATES = [
  ['ungraded', e => e, null],
  ['no toe (clips at 3.7)', e => current(e, P), null],
  ...S0.map(s0 => [`A .111 s0 ${s0.toFixed(2)}`, e => curve(e, { ...P, A: 0.111, s0 }), s0]),
  ['A .150 s0 1.00', e => curve(e, { ...P, A: 0.150, s0: 1.00 }), 1.00],
  ['A .080 s0 1.00', e => curve(e, { ...P, A: 0.080, s0: 1.00 }), 1.00],
];

console.log(`shaded ${shadeFile}   sunlit ${litFile}`);
console.log('curve              gate   | shaded face: cv  grad  grad/L  =0%  p1  lvl ' +
            '| lit midwall: cv  grad/L | crush');
for (const [name, f, s0] of CANDIDATES) {
  const sh = stats(gateShade, f).meanCV / 255;
  const su = stats(gateLit, f).meanCV / 255;
  const st = stats(struct, f);
  const lt = stats(litStruct, f);
  const flag = !monotone(f) ? 'X' : ((sh / su) >= 0.15 && (sh / su) <= 0.25 ? '*' : ' ');
  console.log(`${name.padEnd(18)} ${(sh / su).toFixed(3)}${flag} | ` +
              `${st.meanCV.toFixed(2).padStart(14)} ${st.gradCV.toFixed(2).padStart(5)} ` +
              `${(st.gradCV / st.meanCV).toFixed(3).padStart(6)} ${st.at0.toFixed(1).padStart(4)} ` +
              `${String(st.p1).padStart(3)} ${String(st.levels).padStart(4)} | ` +
              `${lt.meanCV.toFixed(1).padStart(13)} ${(lt.gradCV / lt.meanCV).toFixed(3).padStart(7)} | ` +
              (s0 ? (0.5 / s0).toFixed(2).padStart(5) : '  0.5'));
}
console.log('\ncrush: input code values below this round to literal black. The control');
console.log('is 0.5, so anything above that is clipping this chain is adding.\n');
