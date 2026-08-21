/* Textures for System 3: bark, foliage sprays, dry grass.
 *
 * Same rule as everything else here — nothing is loaded, every texel is
 * written at boot. Two families, and they have opposite problems.
 *
 * Bark is opaque and tiles, so it is authored the same way textures.js authors
 * dirt: a height field first, with the albedo and the normal both derived from
 * it. One map serves both the living and the dead wood; the difference between
 * them is made in the shader (see juniper.js) out of the alpha channel, which
 * carries a long, low-contrast wood grain that survives on bleached deadwood
 * after the fibrous bark has gone.
 *
 * Foliage is alpha-tested, does not tile, and is drawn with canvas strokes
 * because a juniper spray is a branching structure and branching structures are
 * far easier to draw than to evaluate per texel. Alpha testing is where foliage
 * normally falls apart: the default mip chain averages alpha, coverage collapses
 * as the tree recedes, and the crown boils as the camera moves. So the mip chain
 * is built by hand here and every level's alpha is rescaled to hold the same
 * fraction of texels above the alpha threshold as level zero.
 */
import * as THREE from 'three';
import { pnoise, rng, clamp, smoothstep, mix } from './noise.js';

let maxAniso = 8;
export function setPlantAnisotropy(n) { maxAniso = n; }

/* The hero tree and the scrub scatter draw from the same maps, and they are
   built by two independent modules. Memoised so the second caller does not pay
   for a second identical canvas — and, more importantly, so the renderer sees
   one texture rather than two copies of it. */
const _cache = new Map();
const memo = (k, f) => { if (!_cache.has(k)) _cache.set(k, f()); return _cache.get(k); };
export const barkTex = () => memo('bark', () => makeBark(512));
export const foliageTex = () => memo('fol', () => makeFoliage(512));
export const grassTex = () => memo('grass', () => makeGrass(512));
export const scrubTex = () => memo('scrub', () => makeScrub(256));
export const succTex = () => memo('succ', () => makeSucculent(256));

/* ── anisotropic tiling noise ──────────────────────────────────────────────
   noise.js's pfbm shares one period between both axes, and bark is the most
   anisotropic surface in the scene: a fibre is a hundred times longer than it
   is wide. So these take the two periods separately. */

function afbm(x, y, px, py, oct, s, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * pnoise(x * f, y * f, Math.max(1, px * f), Math.max(1, py * f), s + i * 613);
    norm += a; a *= gain; f *= 2;
  }
  return sum / norm;
}

function aridged(x, y, px, py, oct, s) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = pnoise(x * f, y * f, Math.max(1, px * f), Math.max(1, py * f), s + i * 271);
    sum += a * (1 - Math.abs(n * 2 - 1));
    norm += a; a *= 0.5; f *= 2;
  }
  return sum / norm;
}

function blurWrap(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = 2 * r + 1;
  const wx = (a) => ((a % w) + w) % w, wy = (a) => ((a % h) + h) % h;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[y * w + wx(k)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / n;
      sum += src[y * w + wx(x + r + 1)] - src[y * w + wx(x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[wy(k) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum += tmp[wy(y + r + 1) * w + x] - tmp[wy(y - r) * w + x];
    }
  }
  return out;
}

function dataTex(buf, w, h, srgb) {
  const t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ── bark ──────────────────────────────────────────────────────────────────
 *
 * A juniper's living bark is not plated or furrowed like a pine's; it is
 * *fibrous* — long stringy strips that separate from each other and lift away
 * at the edges, so the trunk looks like it has been wrapped in shredded rope.
 * The strips run vertically and shear slowly around the trunk.
 *
 * The height field is therefore three terms: a ridged fibre field with a
 * wavelength of a few millimetres across and the better part of a metre along;
 * a coarser strip field that groups the fibres into strings a couple of
 * centimetres wide; and a peel mask that lifts one edge of a minority of those
 * strings clear of the trunk and puts a hard shadow line under it.
 *
 * `v` runs up the trunk. The tile is 0.5 m square in world units.
 */
export function makeBark(size = 512) {
  const N = size * size;
  const h = new Float32Array(N);
  const fibre = new Float32Array(N);
  const strip = new Float32Array(N);
  const peel = new Float32Array(N);
  const grain = new Float32Array(N);

  const PU = 32, PV = 4;   // lattice periods across / along the tile

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      /* Fibres shear as they climb rather than running dead straight, which is
         what stops the trunk reading as corrugated plastic. */
      const shear = 0.10 * (afbm(u * 3, v * 2, 3, 2, 3, 91) - 0.5) * 2;
      const uu = u + shear * v + 0.03 * (afbm(u * 8, v * 16, 8, 16, 2, 97) - 0.5);

      const f = aridged(uu * PU * 2.2, v * PV * 1.4, PU * 2.2, PV * 1.4, 3, 11);
      const st = aridged(uu * PU * 0.62, v * PV * 0.5, PU * 0.62, PV * 0.5, 2, 17);
      /* Strings terminate: a strip that runs the full height of the tile is a
         stripe, and a stripe is the thing that says "cylinder with a texture on
         it". Broken by a low-frequency gate along v. */
      const brk = smoothstep(0.30, 0.62, afbm(uu * PU * 0.62, v * PV * 3.0, PU * 0.62, PV * 3.0, 3, 23));
      const p = smoothstep(0.68, 0.93, st * 0.55 + 0.45 * afbm(uu * 5, v * 3, 5, 3, 3, 29)) * brk;

      fibre[i] = f;
      strip[i] = st * brk;
      peel[i] = p;
      grain[i] = afbm(uu * PU * 0.9, v * PV * 0.35, PU * 0.9, PV * 0.35, 4, 37);

      h[i] = 0.42 * Math.pow(st, 1.4) * brk + 0.30 * f * (0.45 + 0.55 * st) + 0.28 * p;
    }
  }

  /* Cavity darkening between the strings. The grooves are deep and narrow and
     they hold shadow all day, which is most of what gives fibrous bark its
     contrast at a distance where the relief itself is sub-pixel. */
  const hb = blurWrap(h, size, size, 3);
  const hb2 = blurWrap(h, size, size, 9);

  const alb = new Uint8Array(N * 4);
  const rough = new Float32Array(N);

  /* Warm grey-brown, and grey-*er* than the soil. Juniper bark photographs a
     good deal less saturated than people remember — it is a dusty taupe with a
     red undertone, not chestnut. */
  /* Range widened from 0.115–0.360 to 0.070–0.475. Fibrous bark is *high
     contrast at close range*: near-black grooves between strings whose lifted
     edges catch the sun. Compressed into a narrow band it averages to a
     low-frequency vertical smear — the trunk read as brushed suede. */
  const DARK = [0.070, 0.048, 0.036];
  const MID = [0.230, 0.176, 0.138];
  const PALE = [0.475, 0.405, 0.345];

  for (let i = 0; i < N; i++) {
    const ao = clamp(1 - (hb[i] - h[i]) * 3.4, 0, 1) * 0.65
             + clamp(1 - (hb2[i] - h[i]) * 1.8, 0, 1) * 0.35;
    /* Lit crest → pale sun-bleached fibre; groove → almost black. */
    let t = clamp(h[i] * 1.5 + 0.10, 0, 1);
    t = t * (0.35 + 0.65 * ao);
    const tint = 0.5 + 0.5 * (grain[i] - 0.5) * 1.4;
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const lo = mix(DARK[k], MID[k], clamp(t * 2, 0, 1));
      c[k] = mix(lo, PALE[k], clamp(t * 2 - 1, 0, 1));
      /* Lichen and mineral staining, extremely muted, breaks up the tiling. */
      c[k] *= 0.80 + 0.40 * tint;
    }
    /* A little greenish-grey lichen on a small fraction of the crests — a real
       trunk in a wash has some, and it is one of the few non-brown things on it. */
    const li = smoothstep(0.62, 0.86, grain[i]) * smoothstep(0.35, 0.65, h[i]) * 0.5;
    c[0] = mix(c[0], 0.215, li); c[1] = mix(c[1], 0.225, li); c[2] = mix(c[2], 0.180, li);

    alb[i * 4] = clamp(Math.pow(c[0], 1 / 2.2), 0, 1) * 255;
    alb[i * 4 + 1] = clamp(Math.pow(c[1], 1 / 2.2), 0, 1) * 255;
    alb[i * 4 + 2] = clamp(Math.pow(c[2], 1 / 2.2), 0, 1) * 255;
    /* Alpha carries the deadwood grain: long, smooth, low contrast. Sun-bleached
       juniper keeps its grain and loses everything else. */
    alb[i * 4 + 3] = clamp(0.30 + 0.70 * (0.55 * grain[i] + 0.45 * fibre[i] * 0.6), 0, 1) * 255;

    rough[i] = clamp(0.98 - 0.16 * peel[i] - 0.10 * (1 - ao), 0, 1);
  }

  /* Normal from the height field. 0.5 m across 512 texels is ~1 mm per texel and
     the relief is around 6 mm peak to trough, so the gradient scale is ~6. */
  const nrm = new Uint8Array(N * 4);
  const w = (a) => ((a % size) + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + w(x - 1)], r = h[y * size + w(x + 1)];
      const d = h[w(y - 1) * size + x], u = h[w(y + 1) * size + x];
      let nx = (l - r) * 6.0, ny = (d - u) * 6.0;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * size + x) * 4;
      nrm[i] = (nx * inv * 0.5 + 0.5) * 255;
      nrm[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nrm[i + 2] = (inv * 0.5 + 0.5) * 255;
      nrm[i + 3] = clamp(rough[y * size + x], 0, 1) * 255;
    }
  }

  return { albedo: dataTex(alb, size, size, true), normal: dataTex(nrm, size, size, false) };
}

/* ── alpha-tested atlas plumbing ───────────────────────────────────────────
 *
 * Two things have to happen to a hand-drawn cutout before it can be alpha
 * tested at distance without boiling.
 *
 * The RGB of fully transparent texels has to be filled with something close to
 * the neighbouring opaque colour, or bilinear filtering along the cutout edge
 * blends toward whatever the canvas cleared to — a black rim around every leaf.
 *
 * And the mip chain has to preserve *coverage*, not alpha. Box-averaging alpha
 * halves the average alpha of a sparse spray at every level, so by mip 3 almost
 * nothing survives the alpha test and the crown evaporates; worse, which texels
 * survive changes with sub-pixel motion, which is the boiling. Rescaling each
 * level's alpha so the same fraction of texels clears the threshold keeps the
 * silhouette's area constant all the way down the chain.
 */

function dilateRGB(px, w, h, passes) {
  for (let p = 0; p < passes; p++) {
    const src = px.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3] > 4) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = x + dx, sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            const j = (sy * w + sx) * 4;
            if (src[j + 3] <= 4) continue;
            r += src[j]; g += src[j + 1]; b += src[j + 2]; n++;
          }
        }
        if (n) { px[i] = r / n; px[i + 1] = g / n; px[i + 2] = b / n; }
      }
    }
  }
}

function coverage(px, at) {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] >= at) n++;
  return n / (px.length / 4);
}

/**
 * Build a mip chain whose alpha coverage is constant.
 *
 * The rule below was suspected of causing four of the reported artefacts —
 * shrubs reading as "flat opaque quads with no alpha cut", pale ghost rows at
 * the atlas cell boundaries, and chartreuse shards on a distant bench — on the
 * theory that a large gain would *flood* a sparse level, pushing every faintly
 * covered texel over the threshold at once and leaving a solid rectangle bounded
 * by the clip inset. It does not. Measured with `tools/mipprobe.mjs` on a
 * synthetic spray at level-zero coverage 0.104, this chain holds 0.10 at every
 * level from 64px down, the gain never exceeds 1.13, and the fully-opaque
 * fraction peaks at 2.6% — there is no flood to fix. Three alternatives were
 * tried and all three were worse: taking the max of each alpha quad instead of
 * the mean drives coverage to 1.0 by the bottom of the chain, and letting the
 * gain fall below one to correct an overshoot undershoots level one by 43%.
 *
 * Recorded because the theory was persuasive and the code was innocent. The one
 * real weakness is at the last two levels, where coverage does collapse to zero:
 * four texels of mean alpha below the threshold cannot be rescued by any gain
 * the search will consider, so a spray does wink out at around two pixels. It is
 * a two-pixel pop and it is the correct thing to leave alone.
 */
function coverageMips(base, w, h, alphaTest) {
  const at = alphaTest * 255;
  const target = coverage(base, at);
  const mips = [{ data: base, width: w, height: h }];
  let cur = base, cw = w, ch = h;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const nd = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let r = 0, g = 0, b = 0, a = 0, wsum = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(cw - 1, x * 2 + dx), sy = Math.min(ch - 1, y * 2 + dy);
            const j = (sy * cw + sx) * 4;
            const wa = cur[j + 3] / 255 + 0.02;   // alpha-weighted, so edges keep their hue
            r += cur[j] * wa; g += cur[j + 1] * wa; b += cur[j + 2] * wa;
            a += cur[j + 3]; wsum += wa;
          }
        }
        const k = (y * nw + x) * 4;
        nd[k] = r / wsum; nd[k + 1] = g / wsum; nd[k + 2] = b / wsum;
        nd[k + 3] = a / 4;
      }
    }
    /* Binary search the alpha gain that restores level zero's coverage. */
    let lo = 0.25, hi = 12;
    for (let it = 0; it < 22; it++) {
      const s = (lo + hi) * 0.5;
      let n = 0;
      for (let i = 3; i < nd.length; i += 4) if (nd[i] * s >= at) n++;
      if (n / (nd.length / 4) > target) hi = s; else lo = s;
    }
    const s = (lo + hi) * 0.5;
    if (s > 1.001) for (let i = 3; i < nd.length; i += 4) nd[i] = Math.min(255, nd[i] * s);
    mips.push({ data: nd, width: nw, height: nh });
    cur = nd; cw = nw; ch = nh;
  }
  return mips;
}

function cutoutTex(px, w, h, alphaTest) {
  dilateRGB(px, w, h, 4);
  const mips = coverageMips(px, w, h, alphaTest);
  const t = new THREE.DataTexture(mips[0].data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = mips;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = maxAniso;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  return { c, ctx };
}

const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

/* ── juniper foliage ───────────────────────────────────────────────────────
 *
 * Juniper leaves are *scales*, not needles: each shoot is a squarish green cord
 * a millimetre or two across, made of tiny overlapping triangular scales, and
 * the shoots branch two or three times into a flat spray. Drawn as a chain of
 * short overlapping tapered strokes with a slight zigzag so the edge is beaded
 * rather than smooth, which is what reads as scales at any distance where an
 * actual scale is sub-pixel.
 *
 * The colour is the thing most likely to be got wrong. A healthy Utah juniper is
 * a *dusty* blue-green, HSV saturation around 0.2, and half the crown at any
 * time is bronzed or outright dead. Anything approaching a saturated green reads
 * as a garden conifer dropped into a desert.
 */
/*
 * Measured, not remembered — and the first version of this palette was wrong in
 * a way worth recording, because the reasoning was plausible all the way to the
 * conclusion.
 *
 * The premise was that "dusty blue-green" means low chroma, so the base was
 * authored at HSV saturation 0.19 and hue 93°, and a render of the crown then
 * measured 0.26 / 87° — self-consistent, and taken as confirmation. Photographs
 * of wild Utah juniper measure **0.63 saturation at hue 64–68°**: sunlit 0.631 /
 * 66.8°, shaded 0.635 / 64.1°, macro 0.505–0.604 / 67.8°. Even hazed distant
 * pinyon-juniper woodland holds 0.374 — higher than this crown was in the near
 * field.
 *
 * So chroma is not what distinguishes a desert juniper from a garden conifer.
 * *Hue and value* are: it is a dark olive yellow-green, not a mid-value pure
 * green. The dustiness is the waxy bloom on the scale leaves, which shifts hue
 * toward yellow and drops value — it does not desaturate. Crushing chroma to
 * imitate it removed the plant's colour and cost 20° of hue as well.
 *
 * Note that the render measured only 0.07 above the albedo, so the light rig was
 * not hiding anything: an additive ambient pedestal does crush saturation, but
 * there was barely any chroma there to crush. Numbers below are sRGB bytes;
 * hue/sat/val of each are checked in the report.
 */
const FOL = {
  base: [112, 120, 48],     // 66.7° / 0.600 / 0.471
  pale: [156, 161, 84],     // 63.9° / 0.478 / 0.631  — sun-bleached crest
  dark: [70, 77, 29],       // 68.7° / 0.623 / 0.302  — shaded interior
  bronze: [125, 93, 47],    // 35.4° / 0.624 — last year's bronzed growth
  dead: [140, 120, 63],     // 44.4° / 0.550 — dead scale still attached
  berry: [105, 124, 145],
};

function shootChain(ctx, x, y, ang, len, wid, rand, cols) {
  const steps = Math.max(3, Math.round(len / 3.0));
  const dl = len / steps;
  let a = ang;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const w = wid * (1 - 0.55 * t);
    a += (rand() - 0.5) * 0.22;
    const nx = x + Math.cos(a) * dl, ny = y + Math.sin(a) * dl;
    /* Each segment is one scale: a short thick round-capped dash, and the
       overlap between consecutive dashes is what beads the outline. */
    ctx.strokeStyle = cols[(i * 7 + ((rand() * cols.length) | 0)) % cols.length];
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    x = nx; y = ny;
  }
  return { x, y, a };
}

function sprig(ctx, x, y, ang, len, wid, depth, rand, cols) {
  const segs = Math.max(2, Math.round(len / 16));
  const dl = len / segs;
  let a = ang;
  let px = x, py = y;
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    const w = wid * (1 - 0.5 * t);
    const e = shootChain(ctx, px, py, a, dl, w, rand, cols);
    px = e.x; py = e.y; a = e.a + (rand() - 0.5) * 0.10;
    if (depth > 0 && i > 0) {
      const side = (i % 2 === 0) ? 1 : -1;
      const n = 1 + (rand() < 0.35 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const br = 0.55 + rand() * 0.55;
        sprig(ctx, px, py, a + side * br * (k ? -1 : 1), len * (0.34 + rand() * 0.26),
              w * 0.78, depth - 1, rand, cols);
      }
    }
  }
  return { x: px, y: py };
}

/**
 * One 2x2 atlas of juniper sprays. Cells are addressed by (col, row) with a
 * small inset so mip filtering never drags one cell into its neighbour.
 */
export function makeFoliage(size = 512) {
  const { c, ctx } = canvas2d(size, size);
  const cell = size / 2;
  const rand = rng(20250821);

  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const ox = cx * cell, oy = cy * cell;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox + 2, oy + 2, cell - 4, cell - 4);
      ctx.clip();

      /* Dead and bronzed material sits *behind* the green, which is how a real
         spray looks: the interior of the clump is last year's dead scale still
         attached, with the live growth only on the outside. */
      const deadCols = [rgb(FOL.dead), rgb(FOL.bronze), rgb([102, 84, 44])];
      const liveCols = [
        rgb(FOL.base), rgb(FOL.pale), rgb(FOL.dark),
        rgb([96, 106, 42]), rgb([128, 134, 58]), rgb(FOL.bronze),
      ];

      const bx = ox + cell * 0.5, by = oy + cell * 0.94;
      const nStems = 3 + (rand() * 2 | 0);
      for (let pass = 0; pass < 2; pass++) {
        const cols = pass === 0 ? deadCols : liveCols;
        const scale = pass === 0 ? 0.86 : 1.0;
        for (let sIdx = 0; sIdx < nStems; sIdx++) {
          const spread = (sIdx / Math.max(1, nStems - 1) - 0.5) * 1.5;
          const a = -Math.PI / 2 + spread + (rand() - 0.5) * 0.25;
          sprig(ctx, bx + (rand() - 0.5) * cell * 0.10, by,
                a, cell * (0.60 + rand() * 0.20) * scale,
                cell * 0.030 * scale, 2, rand, cols);
        }
      }

      /* A few berries. Utah juniper berries are a hard powdery blue-grey and
         there are never many of them; two or three per spray is right and it is
         one of the only cues that says *juniper* rather than generic conifer. */
      const nB = rand() < 0.55 ? 1 + (rand() * 3 | 0) : 0;
      for (let i = 0; i < nB; i++) {
        const r = cell * (0.017 + rand() * 0.008);
        const px = ox + cell * (0.22 + rand() * 0.56);
        const py = oy + cell * (0.30 + rand() * 0.50);
        const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.35, r * 0.1, px, py, r);
        g.addColorStop(0, 'rgb(150,160,168)');
        g.addColorStop(1, 'rgb(86,98,110)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
  }

  const img = ctx.getImageData(0, 0, size, size);
  const px = new Uint8Array(img.data.buffer.slice(0));
  return cutoutTex(px, size, size, 0.42);
}

/* ── dead grass and litter ─────────────────────────────────────────────────
 *
 * Bunch grass in a Sedona wash in late summer is *dead* — the brief asked for
 * dead grasses and the previous atlas held two cells, which meant every tuft in
 * the frame was one of two silhouettes at one colour. A reviewer read the field
 * as a single repeated sprite, and as living grass.
 *
 * So: four cells, and the four differ in habit rather than just in seed. An
 * upright tussock, a wide collapsed fan, a sparse bleached remnant, and a dense
 * dark weathered clump. Between them and the per-instance rotation and colour
 * jitter at the scatter end, a repeat is hard to spot.
 *
 * The atlas is four cells across, so callers address it with `cols = 4`.
 */
export function makeGrass(size = 512) {
  const w = size, h = size / 2;                 // 512 x 256: four 128-wide cells
  const { ctx } = canvas2d(w, h);
  const cell = w / 4;
  const rand = rng(771133);
  /* Straw through bleached bone to weathered grey-brown. No green anywhere. */
  const STRAW = ['rgb(172,148,102)', 'rgb(148,126,86)', 'rgb(194,174,132)',
                 'rgb(120,100,68)', 'rgb(162,142,98)', 'rgb(134,120,88)'];
  const BLEACH = ['rgb(206,192,158)', 'rgb(186,172,140)', 'rgb(216,206,178)',
                  'rgb(160,146,116)'];
  const WEATHER = ['rgb(112,96,70)', 'rgb(132,114,84)', 'rgb(94,80,58)',
                   'rgb(146,128,96)'];
  /* blades, lean spread, length, base width, palette */
  const kinds = [
    { n: 30, lean: 0.9, len: [0.52, 0.44], wid: 1.0, cols: STRAW },
    { n: 26, lean: 2.3, len: [0.30, 0.40], wid: 1.1, cols: STRAW },
    { n: 13, lean: 1.4, len: [0.44, 0.50], wid: 0.8, cols: BLEACH },
    { n: 38, lean: 1.1, len: [0.34, 0.34], wid: 1.2, cols: WEATHER },
  ];
  for (let cx = 0; cx < 4; cx++) {
    const ox = cx * cell, k = kinds[cx];
    ctx.save();
    ctx.beginPath(); ctx.rect(ox + 1, 1, cell - 2, h - 2); ctx.clip();
    const n = k.n + (rand() * 8 | 0);
    for (let i = 0; i < n; i++) {
      const bx = ox + cell * (0.5 + (rand() - 0.5) * 0.20);
      const by = h * 0.985;
      const lean = (rand() - 0.5) * 2 * k.lean;
      const len = h * (k.len[0] + rand() * k.len[1]);
      ctx.strokeStyle = k.cols[(rand() * k.cols.length) | 0];
      ctx.lineWidth = h * (0.008 + rand() * 0.010) * k.wid;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, by);
      /* Blades arc over under their own weight; a straight blade reads as a
         wire. The control point sits well off the chord. Dead blades arc
         further and some of them fold right over. */
      const fold = rand() < 0.22 ? 1.35 : 1.0;
      const tipx = bx + lean * len * 0.85 * fold;
      const tipy = by - len * (0.72 + rand() * 0.2) / fold;
      ctx.quadraticCurveTo(bx + lean * len * 0.15, by - len * 0.72, tipx, tipy);
      ctx.stroke();
    }
    ctx.restore();
  }
  const img = ctx.getImageData(0, 0, w, h);
  const px = new Uint8Array(img.data.buffer.slice(0));
  return cutoutTex(px, w, h, 0.40);
}

/* ── succulent skin ────────────────────────────────────────────────────────
 *
 * Prickly pear and agave were the only geometry in System 3 with no map at all,
 * on the reasoning that a pad is a smooth waxy surface and a flat colour would
 * do. It does not: a reviewer picked them out as "flat opaque quads, plainly
 * untextured", which is exactly what an untextured flat opaque quad looks like.
 * A pad in life carries a mottled bloom, a visible grid of areoles with spine
 * clusters on them, and darker creased shadow around the rim.
 *
 * Tiles, opaque, no cutout — the silhouette is the geometry's job here.
 */
export function makeSucculent(size = 256) {
  const N = size * size;
  const alb = new Uint8Array(N * 4);
  const hgt = new Float32Array(N);
  /* Glaucous blue-green, and lighter than juniper — that difference is most of
     what separates a cactus from a shrub at any distance. */
  const BASE = [0.196, 0.238, 0.163];
  const PALEC = [0.283, 0.322, 0.236];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      /* Waxy bloom: broad soft mottling, plus the faint longitudinal creasing a
         pad gets as it swells and shrinks with the water it is holding. */
      const bloom = afbm(u * 5, v * 5, 5, 5, 4, 401);
      const crease = aridged(u * 3.0, v * 11.0, 3, 11, 2, 409);
      let t = clamp(0.34 + 0.72 * bloom - 0.30 * crease, 0, 1);
      const c = [0, 0, 0];
      for (let k = 0; k < 3; k++) c[k] = mix(BASE[k], PALEC[k], t);
      hgt[i] = 0.35 * bloom + 0.30 * crease;

      /* Areoles on a staggered lattice — the tell that this is a cactus. */
      const AR = 7;
      const gy = v * AR, row = Math.floor(gy);
      const gx = u * AR + (row & 1 ? 0.5 : 0);
      const fx = gx - Math.floor(gx) - 0.5, fy = gy - row - 0.5;
      const d = Math.hypot(fx, fy * 0.92);
      const areole = 1 - smoothstep(0.055, 0.11, d);
      if (areole > 0) {
        /* A pale woolly pad with a dark ring, and a couple of straw spines. */
        for (let k = 0; k < 3; k++) c[k] = mix(c[k], k === 2 ? 0.30 : 0.40, areole * 0.75);
        const ring = smoothstep(0.10, 0.075, d) * smoothstep(0.055, 0.075, d);
        for (let k = 0; k < 3; k++) c[k] *= 1 - 0.45 * ring;
        hgt[i] += areole * 0.5;
      }
      const spine = (1 - smoothstep(0.012, 0.05, Math.abs(fx * 0.30 + fy)))
                  * (1 - smoothstep(0.10, 0.30, d)) * smoothstep(0.10, 0.16, d);
      if (spine > 0) {
        for (let k = 0; k < 3; k++) c[k] = mix(c[k], [0.52, 0.46, 0.33][k], spine * 0.85);
      }

      alb[i * 4] = clamp(Math.pow(c[0], 1 / 2.2), 0, 1) * 255;
      alb[i * 4 + 1] = clamp(Math.pow(c[1], 1 / 2.2), 0, 1) * 255;
      alb[i * 4 + 2] = clamp(Math.pow(c[2], 1 / 2.2), 0, 1) * 255;
      alb[i * 4 + 3] = 255;
    }
  }
  const nrm = new Uint8Array(N * 4);
  const w = (a) => ((a % size) + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = hgt[y * size + w(x - 1)], r = hgt[y * size + w(x + 1)];
      const d = hgt[w(y - 1) * size + x], up = hgt[w(y + 1) * size + x];
      const nx = (l - r) * 3.0, ny = (d - up) * 3.0;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * size + x) * 4;
      nrm[i] = (nx * inv * 0.5 + 0.5) * 255;
      nrm[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      nrm[i + 2] = (inv * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  }
  return { albedo: dataTex(alb, size, size, true), normal: dataTex(nrm, size, size, false) };
}

/* ── generic desert scrub foliage ──────────────────────────────────────────
 * Small-leaved grey-green shrub mass (rabbitbrush / snakeweed sort of thing):
 * a cloud of tiny strokes rather than a branching spray, since at the sizes
 * these are drawn the internal structure is never resolved. */
export function makeScrub(size = 256) {
  const { ctx } = canvas2d(size, size);
  const cell = size / 2;
  const rand = rng(90210);
  for (let cx = 0; cx < 2; cx++) {
    const ox = cx * cell;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox + 1, 1, cell - 2, size - 2); ctx.clip();
    const stems = 7 + (rand() * 4 | 0);
    for (let s = 0; s < stems; s++) {
      const bx = ox + cell * 0.5, by = size * 0.98;
      const a = -Math.PI / 2 + (rand() - 0.5) * 1.5;
      const len = size * (0.4 + rand() * 0.42);
      ctx.strokeStyle = 'rgb(96,84,64)';
      ctx.lineWidth = size * 0.008;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      const tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len;
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const n = 22 + (rand() * 16 | 0);
      for (let i = 0; i < n; i++) {
        const t = 0.25 + rand() * 0.8;
        const px = bx + (tx - bx) * t + (rand() - 0.5) * size * 0.10;
        const py = by + (ty - by) * t + (rand() - 0.5) * size * 0.10;
        const la = a + (rand() - 0.5) * 1.4;
        const ll = size * (0.020 + rand() * 0.028);
        const g = 0.5 + rand() * 0.5;
        ctx.strokeStyle = `rgb(${(78 + g * 46) | 0},${(88 + g * 44) | 0},${(66 + g * 34) | 0})`;
        ctx.lineWidth = size * (0.007 + rand() * 0.005);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(la) * ll, py + Math.sin(la) * ll);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  const img = ctx.getImageData(0, 0, size, size);
  const px = new Uint8Array(img.data.buffer.slice(0));
  return cutoutTex(px, size, size, 0.40);
}
