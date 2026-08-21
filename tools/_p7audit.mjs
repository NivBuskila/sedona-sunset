/* The filter audit: can a viewer name any of it?
 *
 * The instruction on this project is that anything identifiable as an *effect*
 * rather than as the scene is wrong, however physically defensible, and to err
 * off where borderline. That is a question about visible magnitudes, so this
 * puts a number on each polish term in the units a viewer actually sees — code
 * values for the tonal ones, pixels for the spatial ones — at the resolution a
 * critic will look at rather than at the 900 lines the parameters are quoted in.
 *
 * Two halves. The numeric half runs this chain's own tail arithmetic forward,
 * inverts it by bisection to recover the linear radiance behind a measured code
 * value, and reports what each term does to that pixel. The empirical half
 * measures the one term arithmetic cannot bound — bloom, whose visible signature
 * is a halo whose width depends on the blur kernel and whose height depends on
 * what is on the other side of the edge — off a frozen graded/ungraded pair.
 *
 *   node tools/_p7audit.mjs [--h 1440] [--pair sys7b]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i < 0 ? d : a[i + 1]; };
const H = +arg('--h', 1440);
const PAIR = arg('--pair', 'sys7b');

/* ── the chain's tail, verbatim ─────────────────────────────────────────────*/

const P = {
  vignette: 0.20, aberration: 0.9, grain: 0.013,
  contrast: 1.03, contrastPivot: 0.18, toeTop: 0.111, toeSlope: 0.20,
  focal: 0.024, fStop: 11.0, focus: 20.0, cocMax: 4.0, skipPx: 0.75,
  bloomThresh: 0.55, bloomKnee: 0.35, bloomGain: 0.055,
};

const M = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const N = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function aces(v) {
  const c = mul(M, v).map(x => x / 0.6);
  const o = c.map(x => {
    const a2 = x * (x + 0.0245786) - 0.000090537;
    const b2 = x * (0.983729 * x + 0.4329510) + 0.238081;
    return a2 / b2;
  });
  return mul(N, o).map(x => Math.min(1, Math.max(0, x)));
}
const srgb = x => x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
const luma = v => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

/* Contrast and the shadow toe, which are after the encode. */
function tone(e) {
  const k = P.contrast, p = P.contrastPivot, A = P.toeTop;
  const lin = x => (x - p) * k + p;
  if (e >= A || A <= 0) return Math.min(1, Math.max(0, lin(e)));
  const u = e / A, u2 = u * u, u3 = u2 * u;
  return Math.max(0, A * P.toeSlope * (u3 - 2 * u2 + u)
                   + lin(A) * (-2 * u3 + 3 * u2) + A * k * (u3 - u2));
}

/** Linear radiance -> code value, grey. */
function fwd(L) {
  const e = aces([L, L, L]).map(srgb);
  return 255 * tone(luma(e));
}
/** Code value -> linear radiance. The chain is monotone, so bisect. */
function inv(cv) {
  let lo = 0, hi = 64;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; (fwd(m) < cv ? lo = m : hi = m); }
  return (lo + hi) / 2;
}

/* ── 1. vignette ───────────────────────────────────────────────────────────*/

/* The corner is rN = 1 by construction, and smoothstep(0.30, 1.06, 1) = 0.982,
   so the parameter is very nearly the light lost there. */
const CORNER = (() => { const t = (1 - 0.30) / (1.06 - 0.30); return t * t * (3 - 2 * t); })();

console.log(`\n── vignette ──  corner weight ${CORNER.toFixed(3)} of the parameter`);
console.log('   cv     linear    ' + [0.20, 0.12, 0.08, 0.05, 0.03].map(v => `v=${v}`.padStart(8)).join(''));
for (const cv of [40, 90, 140, 190, 230]) {
  const L = inv(cv);
  const row = [0.20, 0.12, 0.08, 0.05, 0.03].map(v => {
    const d = fwd(L * (1 - v * CORNER)) - cv;
    return `${d.toFixed(1)}`.padStart(8);
  });
  console.log(`  ${String(cv).padStart(3)}  ${L.toFixed(4).padStart(8)}    ${row.join('')}`);
}
console.log('   (delta code values at the extreme corner; a smooth ramp is nameable');
console.log('    at a few percent of level, which is 4-8 cv on a bright sky corner)');

/* ── 2. grain ──────────────────────────────────────────────────────────────*/

/* The plate is uniform value noise under one binomial pass, renormalised to
   fill [0,1]. Its standard deviation is what a viewer sees; the peak is 4-odd
   sigma and happens on a handful of pixels. Computed rather than assumed,
   because the renormalisation depends on the extremes of 65k samples. */
function plateSigma(n = 256) {
  let s = 0x7ea11 >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const raw = new Float32Array(n * n);
  for (let i = 0; i < raw.length; i++) raw[i] = rnd();
  const K = [1, 2, 1], at = (x, y) => raw[((y + n) % n) * n + ((x + n) % n)];
  const tmp = new Float32Array(n * n);
  let mn = 1e9, mx = -1e9;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) v += K[i + 1] * K[j + 1] * at(x + i, y + j);
    v /= 16; tmp[y * n + x] = v;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  /* Quantised to 8 bits in the texture, as the shader sees it. */
  const q = Array.from(tmp, v => Math.round((v - mn) * 255 / (mx - mn)) / 255 - 0.5);
  const mean = q.reduce((s2, v) => s2 + v, 0) / q.length;
  return {
    sigma: Math.sqrt(q.reduce((s2, v) => s2 + (v - mean) ** 2, 0) / q.length),
    peak: Math.max(...q.map(Math.abs)),
  };
}
const pl = plateSigma();
console.log(`\n── grain ──  plate sigma ${pl.sigma.toFixed(4)}, peak ${pl.peak.toFixed(3)}`);
for (const g of [0.013, 0.008, 0.005]) {
  const at = ly => 255 * g * (0.45 + 0.55 * (1 - ly));
  console.log(`  grain ${g.toFixed(3)}   shadow ${(at(0.10) * pl.sigma).toFixed(2)} cv rms ` +
              `(peak ${(at(0.10) * pl.peak).toFixed(2)})   highlight ` +
              `${(at(0.80) * pl.sigma).toFixed(2)} cv rms (peak ${(at(0.80) * pl.peak).toFixed(2)})`);
}
console.log('   (1 cv rms is the quantisation step itself; visible-as-grain needs');
console.log('    several, and dithering a 1-LSB contour needs about half of one)');

/* ── 3. chromatic aberration ───────────────────────────────────────────────*/

console.log(`\n── chromatic aberration ──  gate smoothstep(0.55, 1.00, rN)`);
for (const ab of [0.9, 0.5, 0.3]) {
  const px = h => ab * (h / 900);
  console.log(`  aberration ${ab.toFixed(1)}   900 lines ${px(900).toFixed(2)} px   ` +
              `${H} lines ${px(H).toFixed(2)} px   (radial split, extreme corner)`);
}
console.log('   (a split under half a pixel cannot resolve as a fringe; above one');
console.log('    pixel it is the single most nameable thing in this list)');

/* ── 4. defocus ────────────────────────────────────────────────────────────*/

const A = P.focal / P.fStop;
const cocScale = A * P.focal * H / (0.024 * (P.focus - P.focal));
const skip = P.skipPx * (H / 900), cocMax = P.cocMax * (H / 900);
console.log(`\n── defocus ──  f/${P.fStop} focused at ${P.focus} m, ${H} lines`);
console.log(`  scale ${cocScale.toFixed(3)} px   skip ${skip.toFixed(2)} px   ceiling ${cocMax.toFixed(1)} px`);
let engage = null;
for (const z of [0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 5.0, 20, 100, 1000]) {
  const c = Math.min(cocMax, cocScale * Math.abs(z - P.focus) / z);
  if (engage === null && c <= skip) engage = z;
  console.log(`  z ${String(z).padStart(6)} m   coc ${c.toFixed(2)} px   ${c > skip ? 'gathered' : '—'}`);
}
console.log(`   (gather engages nearer than about ${engage} m and nowhere else;`);
console.log('    hyperfocal for a 24 mm at f/11 puts the near sharp limit at ~1.6 m,');
console.log('    so this is inside the lens it claims to be)');

/* ── 5. bloom, measured ────────────────────────────────────────────────────*/

/* Arithmetic cannot bound this one: the visible signature is a halo across a
   silhouette, and its height depends on the ratio of the two sides and its
   width on the blur kernel. So find sky/rock boundaries in a frozen pair and
   profile graded-minus-ungraded against distance from the edge. A grade shows
   as a flat offset; a bloom shows as a ramp that decays with distance. */
function load(f) {
  const { width, height, data } = decode(readFileSync(f));
  return { w: width, h: height, d: data };
}
const lum = (im, i) => 0.2126 * im.d[i * 4] + 0.7152 * im.d[i * 4 + 1] + 0.0722 * im.d[i * 4 + 2];

/** Mean luminance k pixels below every strong bright-to-dark vertical step. */
function silhouette(g, n) {
  const prof = new Map();
  let cols = 0;
  for (let x = 0; x < g.w; x++) {
    /* The edge is the first place a column falls hard, found on the *ungraded*
       frame so the grade cannot move where the profile is measured from. Two
       pixels of run either side, so a lone dark texel is not an edge. */
    let edge = -1;
    for (let y = 4; y < g.h - 40; y++) {
      const a2 = (lum(n, (y - 2) * g.w + x) + lum(n, (y - 1) * g.w + x)) / 2;
      const b2 = (lum(n, (y + 1) * g.w + x) + lum(n, (y + 2) * g.w + x)) / 2;
      if (a2 > 120 && a2 - b2 > 45) { edge = y; break; }
    }
    if (edge < 0) continue;
    cols++;
    for (let k = 1; k <= 32; k++) {
      const i = (edge + k) * g.w + x;
      const e = prof.get(k) || { s: 0, sn: 0, c: 0 };
      e.s += lum(g, i); e.sn += lum(n, i); e.c++;
      prof.set(k, e);
    }
  }
  return { cols, prof };
}

/* Whichever view in the set has the most silhouette, since which viewpoints
   carry a skyline depends on where the buttes are and is not this tool's
   business to know. */
let best = null;
for (const v of ['sun_gap', 'bend', 'juniper', 'wash_mid', 'wash_low', 'ground', 'wall_lit', 'wall_shade']) {
  try {
    const g = load(`shots/${PAIR}_${v}.png`);
    const n = load(`shots/${PAIR}_nopost_${v}.png`);
    if (g.w !== n.w || g.h !== n.h) continue;
    const r = silhouette(g, n);
    if (r.cols > 40 && (!best || r.cols > best.cols)) best = { v, ...r };
  } catch { /* view not in this set */ }
}
if (!best) {
  console.log('\n── bloom, measured ──  skipped: no graded/ungraded pair with a skyline');
} else {
  console.log(`\n── bloom, measured ──  ${best.cols} silhouette columns in ${PAIR}_${best.v}`);
  console.log('  px below edge   ungraded   graded   delta');
  for (const k of [1, 2, 4, 8, 16, 24, 32]) {
    const e = best.prof.get(k);
    if (!e) continue;
    console.log(`  ${String(k).padStart(11)}   ${(e.sn / e.c).toFixed(2).padStart(8)}   ` +
                `${(e.s / e.c).toFixed(2).padStart(6)}   ${((e.s - e.sn) / e.c).toFixed(2).padStart(6)}`);
  }
  console.log('   (a flat delta down the column is the grade; a delta that decays');
  console.log('    with distance from the edge is a halo, and is nameable)');
}
console.log();
