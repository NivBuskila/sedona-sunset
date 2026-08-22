/* What is the period of that regular pattern, in pixels, and does it hold with range?
 *
 * ── READ THIS BEFORE QUOTING A PERIOD FROM THIS TOOL ────────────────────────
 * This high-passes by subtracting a box blur of radius 14, and a box-subtract
 * high-pass is a band-pass: it has a scale of its own and will report structure
 * near that scale out of anything, including noise with no periodicity in it.
 * The periods this tool reports on natural surfaces - 23 to 27 px - are about
 * 0.8 times its own kernel, and a delivery critic running the same statistic at
 * a 9 px kernel reported 6 to 8 px on the same frames, also about 0.8 times
 * theirs. Both were reading their filters. `_quiltfilt.mjs --critic` shows the
 * statistic returning 75x on pink noise at a 9 px kernel.
 *
 * So an ABSOLUTE period from this tool is not evidence of a pattern. What the
 * tool is still good for is the job named below, which is DIFFERENTIAL: the
 * same kernel on two bands of one receding surface, where a world-locked
 * feature and a screen-locked one separate by how their period changes with
 * range. Paired before/after comparisons at a fixed kernel are sound for the
 * same reason. For "is there a repeating frequency here at all", use
 * `_quiltfilt.mjs`, which measures excess over the local continuum and so
 * divides out every smooth filter including this one.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Terrain's discriminator, run on a frame already on disk: a footprint-keyed
 * texture layer has a world-space period that steps by powers of two with
 * distance, because the LOD scale is `exp2(-floor(gLod))`, so its *screen* period
 * is roughly constant. A world-fixed lattice - a joint azimuth grid, a bedding
 * spacing, a texture tile - obeys perspective instead, so its screen period
 * shrinks as 1/range. One receding surface measured in two bands separates them,
 * and no capture is needed for it.
 *
 * Autocorrelation rather than a spectral peak because the question is "what
 * offset does this pattern repeat at", which autocorrelation answers directly and
 * in the units the arithmetic then needs. High-passed first by subtracting a box
 * blur, so the surface's own shading gradient does not dominate the correlation,
 * and normalised per offset so a peak near the origin is not just the blur radius
 * showing through.
 *
 * Reported with the world period each candidate range implies, because that is
 * the number that decides ownership: this project's rock lattices have periods of
 * 2.35 to 19 m and its texture tiles 6.45 m, while a footprint-locked grain layer
 * is authored in single-figure pixels.
 *
 *   node tools/_lattice.mjs shots/s2rim3_ground.png 120,820,380,880 60,980,320,1040
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a0 = process.argv.slice(2);
/* Opt-in search range. The default is unchanged, so every existing invocation
   and every number already in the record still means what it meant. It is here
   because the window silently bounds the answer: a period longer than MAXD
   cannot be found, so a family that moves *out* of range is reported as a
   family that went away. A test whose prediction is "the period doubles" has to
   be able to see the doubled period, and at the shipped 34 it cannot. */
const mi = a0.indexOf('--maxd');
const MAXD_ARG = mi >= 0 ? Number(a0[mi + 1]) : null;
const a = mi >= 0 ? a0.filter((_, i) => i !== mi && i !== mi + 1) : a0;
const file = a[0];
const bands = a.slice(1).map((s) => s.split(',').map(Number));
if (!file || !bands.length) {
  console.error('_lattice: give a png and one or more x0,y0,x1,y1 bands');
  process.exit(2);
}
const img = decode(readFileSync(file));
const { w, h, px, ch } = img;

const L = new Float32Array(w * h);
for (let i = 0, p = 0; i < w * h; i++, p += ch) {
  L[i] = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
}

/* Separable box blur, used only as the low-pass to subtract. */
function blur(src, R) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) {
        const xx = x + k; if (xx < 0 || xx >= w) continue;
        s += src[y * w + xx]; n++;
      }
      t[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) {
        const yy = y + k; if (yy < 0 || yy >= h) continue;
        s += t[yy * w + x]; n++;
      }
      o[y * w + x] = s / n;
    }
  }
  return o;
}

const LO = blur(L, 14);
const HI = new Float32Array(w * h);
for (let i = 0; i < HI.length; i++) HI[i] = L[i] - LO[i];

const MAXD = MAXD_ARG ?? 34;
console.log(`${file}   ${w}x${h}`);
for (const [x0, y0, x1, y1] of bands) {
  /* Normalised autocorrelation over a window of offsets. */
  let e0 = 0, n0 = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { e0 += HI[y * w + x] ** 2; n0++; }
  const rms = Math.sqrt(e0 / n0);

  const peaks = [];
  for (let dy = -MAXD; dy <= MAXD; dy++) {
    for (let dx = 0; dx <= MAXD; dx++) {
      if (dx === 0 && dy <= 0) continue;
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let x = x0; x < x1; x++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          s += HI[y * w + x] * HI[yy * w + xx]; n++;
        }
      }
      if (n > 0) peaks.push({ dx, dy, r: (s / n) / (rms * rms) });
    }
  }
  /* A local maximum in the offset plane, past the blur's own shoulder, is a real
     repeat rather than the autocorrelation's central lobe. */
  const at = (dx, dy) => (peaks.find((q) => q.dx === dx && q.dy === dy) || { r: -9 }).r;
  const local = peaks.filter((q) => Math.hypot(q.dx, q.dy) >= 3
    && q.r > at(q.dx + 1, q.dy) && q.r > at(q.dx - 1, q.dy)
    && q.r > at(q.dx, q.dy + 1) && q.r > at(q.dx, q.dy - 1) && q.r > 0.06);
  local.sort((p, q) => q.r - p.r);

  console.log(`\n  band ${x0},${y0}-${x1},${y1}   ${(x1 - x0)}x${(y1 - y0)} px   `
    + `hf rms ${(rms * 255).toFixed(2)} cv`);
  if (!local.length) { console.log('    no repeat peak above 0.06 - pattern is not periodic here'); continue; }
  for (const p of local.slice(0, 4)) {
    const per = Math.hypot(p.dx, p.dy);
    const ang = (Math.atan2(p.dy, p.dx) * 180) / Math.PI;
    console.log(`    repeat at (${String(p.dx).padStart(3)},${String(p.dy).padStart(3)})  `
      + `period ${per.toFixed(1).padStart(5)} px   angle ${ang.toFixed(0).padStart(4)} deg   r ${p.r.toFixed(3)}`);
  }
}
