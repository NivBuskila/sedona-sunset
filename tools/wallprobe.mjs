/* Offline hf/lf probe: shade a flat wall out of the actual procedural maps and
 * measure the same statistics tools/grad.mjs measures on a capture.
 *
 *   node tools/wallprobe.mjs                 # the two distances that matter
 *   node tools/wallprobe.mjs --mpp 0.08      # one distance
 *   node tools/wallprobe.mjs --w 512 --sun 8
 *
 * Why this exists. A capture of three views on the software rasteriser costs
 * eight minutes and a full set costs an hour, and the pass condition — hf/lf at
 * or above 0.55 — is a property of the *spectrum of the maps* far more than of
 * anything the scene does. Guessing at a spectrum through an eight-minute
 * feedback loop is how a round gets spent moving a number in the wrong band,
 * which is precisely the criticism this is answering. This runs in seconds.
 *
 * What it models, and what it deliberately does not. It samples the rock and
 * grit maps exactly as rock.js does — same world scales, same footprint-locked
 * octave for the grit, same normal composition and the same terminator fade —
 * through a real mip pyramid, because the mip collapse is the whole reason a
 * fixed-scale texture stops carrying structure at distance and any harness that
 * skipped it would flatter the maps. It shades one flat vertical facet with a
 * single low sun and an ambient term. It has no shadows, no bedding geometry, no
 * joints and no aerial perspective, so its absolute numbers are not the render's.
 * What transfers is the *ratio* and its direction of travel: if hf/lf here does
 * not move, it will not move in the capture either.
 *
 * `mpp` is metres per pixel. 0.02 is the close face in wall_shade, 0.09 is the
 * mid wall in wall_lit, 0.35 is the far plane.
 */
import { makeRock, makeGrit } from '../src/textures.js';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i < 0 ? d : Number(process.argv[i + 1]);
};
const W = arg('w', 384), H = arg('h', 384);
const SUNEL = arg('sun', 8) * Math.PI / 180;
const oi = process.argv.indexOf('--only');
const ONLY = oi < 0 ? 'all' : process.argv[oi + 1];

/* ── mip pyramids ──────────────────────────────────────────────────────── */

/** Box-reduce an RGBA byte image to a pyramid of Float32 planes, one per
 *  channel per level. Float rather than byte because eight levels of repeated
 *  byte rounding is its own low-frequency artefact. */
function pyramid(data, size, ch = 4) {
  const lv = [];
  let cur = new Float32Array(size * size * ch);
  for (let i = 0; i < cur.length; i++) cur[i] = data[i] / 255;
  let s = size;
  lv.push({ s, d: cur });
  while (s > 1) {
    const n = s >> 1, out = new Float32Array(n * n * ch);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        for (let c = 0; c < ch; c++) {
          out[(y * n + x) * ch + c] = 0.25 * (
            cur[((y * 2) * s + x * 2) * ch + c] +
            cur[((y * 2) * s + x * 2 + 1) * ch + c] +
            cur[((y * 2 + 1) * s + x * 2) * ch + c] +
            cur[((y * 2 + 1) * s + x * 2 + 1) * ch + c]);
        }
      }
    }
    cur = out; s = n;
    lv.push({ s, d: cur });
  }
  return lv;
}

function bilinear(lv, u, v, ch, out) {
  const s = lv.s, d = lv.d;
  let fx = u * s - 0.5, fy = v * s - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const wrap = (i) => ((i % s) + s) % s;
  const xa = wrap(x0), xb = wrap(x0 + 1), ya = wrap(y0), yb = wrap(y0 + 1);
  for (let c = 0; c < ch; c++) {
    const a = d[(ya * s + xa) * ch + c], b = d[(ya * s + xb) * ch + c];
    const e = d[(yb * s + xa) * ch + c], f = d[(yb * s + xb) * ch + c];
    out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (e * (1 - tx) + f * tx) * ty;
  }
}

/** Trilinear: pick the two levels bracketing the requested footprint, in texels
 *  of level zero, and blend. This is what the driver does and it is the part a
 *  naive harness gets wrong. */
const tmpA = new Float32Array(4), tmpB = new Float32Array(4);
function sampleMip(pyr, u, v, texels, ch, out) {
  const l = Math.max(0, Math.log2(Math.max(texels, 1e-6)));
  const l0 = Math.min(pyr.length - 1, Math.floor(l));
  const l1 = Math.min(pyr.length - 1, l0 + 1);
  const t = l - l0;
  bilinear(pyr[l0], u, v, ch, tmpA);
  bilinear(pyr[l1], u, v, ch, tmpB);
  for (let c = 0; c < ch; c++) out[c] = tmpA[c] * (1 - t) + tmpB[c] * t;
}

/* ── statistics, identical in definition to tools/grad.mjs ─────────────── */

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
  const grad = g1 / n1, grad4 = g4 / n4;
  return { grad, grad4, ratio: grad / Math.max(1e-9, grad4), mean,
           sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

/* ── the probe ─────────────────────────────────────────────────────────── */

const srgb = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LUT[i] = lin(i / 255);

console.log('generating maps…');
let t0 = Date.now();
const rock = makeRock(1024);
const grit = makeGrit(256);
console.log(`  ${Date.now() - t0} ms`);

/* Albedo is stored sRGB-encoded, so it is linearised before the pyramid rather
   than after — averaging encoded values is the classic way to make a texture
   drift bright as it mips, and it would show up here as a spurious result. */
const rockAlin = new Uint8Array(1024 * 1024 * 4);
{
  const d = rock.albedo.image.data;
  for (let i = 0; i < rockAlin.length; i++) rockAlin[i] = LUT[d[i]] * 255;
}
const pA = pyramid(rockAlin, 1024);
const pN = pyramid(rock.normal.image.data, 1024);
const pM = pyramid(rock.arm.image.data, 1024);
const pG = pyramid(grit.image.data, 256);

const SC = 0.155, SF = 0.62;      // rock.js world sampling scales, cycles/m
const GLOCK = arg('glock', 0.9);  // rock.js grit footprint lock factor

/* Sun eight degrees up and forty off the wall normal, which is the geometry the
   wall_lit and wash_mid views actually present: a grazing key. The wall faces
   +z; the sun comes from +x and +z. */
const sl = [Math.cos(SUNEL) * Math.sin(0.70), Math.sin(SUNEL), Math.cos(SUNEL) * Math.cos(0.70)];

function probe(mpp) {
  const out = new Float64Array(W * H);
  const a4 = new Float32Array(4), n4 = new Float32Array(4);
  const m4 = new Float32Array(4), g4 = new Float32Array(4);

  const gLod = Math.log2(mpp * 256 * GLOCK);
  const gSc = Math.pow(2, -Math.floor(gLod));
  const gT = gLod - Math.floor(gLod);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const wx = px * mpp, wy = -py * mpp;

      sampleMip(pA, wx * SC, wy * SC, mpp * SC * 1024, 4, a4);
      sampleMip(pN, wx * SC, wy * SC, mpp * SC * 1024, 4, n4);
      sampleMip(pM, wx * SC, wy * SC, mpp * SC * 1024, 4, m4);
      const lumC = a4[0] * 0.299 + a4[1] * 0.587 + a4[2] * 0.114;
      sampleMip(pA, wx * SF + 3.1, wy * SF + 7.7, mpp * SF * 1024, 4, a4);
      const lumF = a4[0] * 0.299 + a4[1] * 0.587 + a4[2] * 0.114;

      /* Grit: footprint-locked octave pair, crossfaded, exactly as the shader. */
      const gu = wx * gSc, gv = wy * gSc;
      sampleMip(pG, gu, gv, mpp * gSc * 256, 4, g4);
      const ga = [g4[0], g4[1], g4[2], g4[3]];
      sampleMip(pG, gu * 0.5, gv * 0.5, mpp * gSc * 0.5 * 256, 4, g4);
      const gr = ga.map((v, i) => v * (1 - gT) + g4[i] * gT);

      /* Normal composition, matching rock.js: coarse reading, plus the fine
         reading's deviation, then the grit blended over the top, with the same
         terminator fade on both. The wall is planar so the geometric normal is
         constant and the tangent frame is the identity. */
      const MEAN = 0.42;
      let nx = (n4[0] - 0.5) * 2, ny = (n4[1] - 0.5) * 2;
      let gx = (gr[1] - 0.5) * 1.9, gy = (gr[2] - 0.5) * 1.9;
      const sTerm = Math.max(0, Math.min(1, sl[2]));   // planar wall, one value
      const relW = 1.0 * (0.32 + 0.68 * sTerm);
      const wgt = 0.72 * (0.06 + 0.94 * sTerm);
      let Nx = nx * relW, Ny = ny * relW;
      Nx = Nx * (1 - wgt) + gx * wgt; Ny = Ny * (1 - wgt) + gy * wgt;
      let Nz = Math.sqrt(Math.max(1e-4, 1 - Nx * Nx - Ny * Ny));

      /* --only isolates one contributor, which is the difference between knowing
         which term is dragging the ratio and guessing at it. */
      const kC = ONLY === 'all' || ONLY === 'coarse' ? 1 : 0;
      const kF = ONLY === 'all' || ONLY === 'fine' ? 1 : 0;
      const kG = ONLY === 'all' || ONLY === 'grit' ? 1 : 0;
      if (!kG) { Nx = nx * relW; Ny = ny * relW; }
      if (!kC) { Nx *= kG ? 1 : 0; Ny *= kG ? 1 : 0; }
      const lum = Math.max(0.40, Math.min(1.80,
        (1 + (lumC / MEAN - 1) * 0.88 * kC) * (1 + (lumF / MEAN - 1) * 0.62 * kF)
        * (1 + (gr[0] - 0.5) * 1.55 * kG)));
      const ao = (kC ? Math.max(0.18, m4[0]) : 1) * (kG ? (0.25 + 0.75 * gr[3]) : 1);
      Nz = Math.sqrt(Math.max(1e-4, 1 - Nx * Nx - Ny * Ny));

      const ndl = Math.max(0, Nx * sl[0] + Ny * sl[1] + Nz * sl[2]);
      /* One grazing key plus a flat ambient at a fifth of it, which is roughly
         the ratio a low sun against an open sky dome gives on a canyon wall. */
      const L = 0.30 * lum * (ndl * 1.0 + 0.20 * ao);
      out[py * W + px] = Math.max(0, Math.min(1, srgb(L)));
    }
  }
  return stats(out, W, H);
}

console.log('\n  mpp     grad     grad@4   hf/lf   L mean  L sd    note');
for (const [mpp, note] of [[0.02, 'close face  (wall_shade)'],
                           [0.09, 'mid wall    (wall_lit)'],
                           [0.35, 'far plane   (sun_gap)']]) {
  if (process.argv.includes('--mpp') && arg('mpp', 0) !== mpp) continue;
  const s = probe(mpp);
  console.log(` ${mpp.toFixed(3)}  ${s.grad.toFixed(4)}   ${s.grad4.toFixed(4)}  ` +
    ` ${s.ratio.toFixed(2).padStart(5)}   ${s.mean.toFixed(3)}   ${s.sd.toFixed(3)}   ${note}`);
}
