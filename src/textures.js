/* Every texture in the scene, written texel by texel at load time.
 *
 * Zero external assets is a hard rule, so there is no image decode step and no
 * fetch: each map below is a Float32/Uint8 buffer filled by the noise
 * primitives in noise.js and handed to a DataTexture.
 *
 * Each surface produces three maps in the same layout:
 *   albedo  RGBA8, sRGB
 *   normal  RGBA8, linear, tangent space, derived from the height field
 *   arm     RGBA8, linear — R ambient occlusion, G roughness, B height
 *
 * The height field is authored first and the normal and AO both fall out of
 * it, which is what keeps the grain, the shading and the cavity darkening
 * agreeing with each other. Authoring a normal map independently is the usual
 * reason procedural dirt reads as a flat photograph of noise.
 */
import * as THREE from 'three';
import { pnoise, pfbm, pridged, pworley, hash2, clamp, smoothstep, mix } from './noise.js';

/* ── plumbing ──────────────────────────────────────────────────────────── */

let maxAniso = 8;
export function setAnisotropy(n) { maxAniso = n; }

function dataTex(buf, size, srgb) {
  const t = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Separable box blur with wraparound, so blurs of a tiling map still tile. */
function blurWrap(src, size, r) {
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const n = 2 * r + 1;
  const w = (a) => ((a % size) + size) % size;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + w(k)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = sum / n;
      sum += src[row + w(x + r + 1)] - src[row + w(x - r)];
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[w(k) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum / n;
      sum += tmp[w(y + r + 1) * size + x] - tmp[w(y - r) * size + x];
    }
  }
  return out;
}

/**
 * Tangent-space normal from a height field, by central difference.
 *
 * `strength` is not a taste knob. The height field is unitless in [0, 1], so
 * the correct value is (physical relief of that field in metres) / (metres per
 * texel). Picking it by eye is how procedural dirt ends up as a field of lit
 * facets — every grain gets a 70-degree slope and the surface reads as
 * confetti rather than as compacted earth.
 */
function normalFromHeight(h, size, strength) {
  const buf = new Uint8Array(size * size * 4);
  const w = (a) => ((a % size) + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + w(x - 1)], r = h[y * size + w(x + 1)];
      const d = h[w(y - 1) * size + x], u = h[w(y + 1) * size + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      buf[i] = (nx * 0.5 + 0.5) * 255;
      buf[i + 1] = (ny * 0.5 + 0.5) * 255;
      buf[i + 2] = (nz * 0.5 + 0.5) * 255;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/**
 * Cavity occlusion: a texel sitting below its own neighbourhood is in a pit.
 * Two radii, because a pebble's contact shadow and the broad hollow of a
 * scour pan are different scales and only using one loses whichever it is not.
 */
function aoFromHeight(h, size, near, far, k) {
  const bn = blurWrap(h, size, near);
  const bf = blurWrap(h, size, far);
  const ao = new Float32Array(size * size);
  for (let i = 0; i < ao.length; i++) {
    const a = 1 - clamp((bn[i] - h[i]) * k, 0, 1);
    const b = 1 - clamp((bf[i] - h[i]) * k * 0.55, 0, 1);
    ao[i] = clamp(a * 0.6 + b * 0.4, 0, 1);
  }
  return ao;
}

function packARM(ao, rough, h, size) {
  const buf = new Uint8Array(size * size * 4);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  const inv = 1 / (hi - lo || 1);
  for (let i = 0; i < ao.length; i++) {
    buf[i * 4] = clamp(ao[i], 0, 1) * 255;
    buf[i * 4 + 1] = clamp(rough[i], 0, 1) * 255;
    buf[i * 4 + 2] = clamp((h[i] - lo) * inv, 0, 1) * 255;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

/* sRGB byte triples, so the numbers below can be read against a photograph. */
const C = (r, g, b) => [r, g, b];
const mixC = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* ── compacted red dirt: the wash floor ────────────────────────────────── */

/* The matrix — the fine stuff between the stones. Oxide-stained but not vivid:
   the iron is a coating on quartz sand that is pale grey-buff underneath, and
   every exposed surface carries dust, so the mineral itself has a large
   achromatic component. Measured against photographs, Sedona is a dusty
   salmon-terracotta with a grey-brown cast; the saturated orange-red these were
   before is Wadi Rum, the Pilbara or Mars. */
/* Darker as well as less saturated. Saturation was measured and fixed, but the
   first pass at it left the values where they were, and a low-saturation *bright*
   surface is gypsum or caliche, not oxide dirt: the wash came out reading as pale
   sand. Real red dirt reflects about a fifth of the light that falls on it. */
/* Chroma raised again, values held. The measurement these were tuned to was
   wrong: the figure chased for the wash floor — 0.09 saturation — is wet grey
   concrete, and a real sunlit wash floor measures 0.47 to 0.56. Value is what
   stays; a low-saturation *bright* surface is gypsum, not oxide dirt. */
const DIRT_DAMP = C(84, 47, 39);    // shadowed hollows, still damp, purple-brown
const DIRT_BASE = C(134, 82, 55);   // oxide-stained silt, the dominant colour
const DIRT_DUST = C(160, 118, 87); // dust film on the high spots
const DIRT_PALE = C(179, 151, 127); // wind-sorted fines, nearly grey
const MUD_STRINGER = C(152, 54, 18); // iron-rich clay smear, the saturated end

/* Lithologies present in the *matrix itself*, not only in the instanced stones.
   A Sedona wash carries buff-white Coconino, grey Schnebly siltstone, cream
   caprock limestone, black basalt off the rim and quartz alongside the local red
   sandstone. Grain scale is where that polychrome scatter does the most work,
   because it is what the eye actually resolves standing on the floor. */
/* Wide in chroma, narrow in value, for the same reason the instanced clasts are:
   the saturated tail a real wash floor has — a 99th percentile near 0.88 against
   a mean near 0.50 — comes from individual iron-stained and mud-coated grains
   sitting beside pale quartz, and it cannot be had by raising the matrix, which
   just returns the orange membrane. Value extremes are a different matter: they
   are what turns a receding gravel bed into a black-and-white hash, so the basalt
   is a dark grey-brown rather than the near-black it was. */
const GRAIN_COL = [
  C(168, 56, 22),     // iron-stained red — carries the saturated tail
  C(133, 88, 68),     // red Schnebly sandstone
  C(176, 100, 34),    // orange mud coating
  /* The pale end is dusted, for the same reason the instanced lithologies are.
     Quartz at (196, 188, 178) is 0.09 saturation and off-white Coconino 0.13, and
     those two are 16 percent of the mix — so a sixth of the floor's grain
     population was very nearly neutral and very nearly white. Averaged over a
     footprint that is a pale grey haze laid over the oxide, and it put the floor's
     value up against the clipping point where saturation cannot exist. A grain of
     quartz sand in a Sedona wash is not clean quartz: it has been rolling in iron
     oxide and dust for ten thousand years. */
  C(150, 122, 96),    // buff sandstone
  C(186, 166, 138),   // off-white Coconino, dust-filmed
  C(122, 110, 98),    // grey siltstone
  C(76, 68, 63),      // desert-varnished dark
  C(190, 174, 150),   // quartz, dust-filmed
  C(170, 148, 118),   // cream limestone
];
const GRAIN_MIX = [0.10, 0.24, 0.08, 0.15, 0.10, 0.13, 0.07, 0.06, 0.07];
const GRAIN_CDF = (() => { let a = 0; return GRAIN_MIX.map(v => (a += v)); })();
const pickGrain = (r) => {
  for (let i = 0; i < GRAIN_CDF.length; i++) if (r <= GRAIN_CDF[i]) return i;
  return 0;
};

/**
 * Three overlapping grain populations, at roughly 4 cm, 1.7 cm and 7 mm.
 *
 * The construction matters more than the numbers. The previous version summed
 * fBm octaves, and a sum of smooth noise is one continuous membrane however many
 * octaves go into it — which is exactly what it looked like. Granular material is
 * not a sum, it is a *packing*: each grain occupies space, the largest stand
 * proudest, and the smaller ones fill the gaps between them rather than riding on
 * their backs. So the height below is the maximum over the populations, not their
 * sum, and each texel takes the colour and roughness of whichever grain won.
 * That yields interstices for the fines to fill, real crevices between touching
 * neighbours for the cavity pass to darken, and a different mineral in each stone.
 *
 * Radii are in cell units, so 0.28–0.46 is a grain between about six and nine
 * tenths of a cell across: touching or nearly touching, which is what a packed
 * bed looks like. `pres` is the fraction of cells hosting a grain of that class,
 * so with three classes an order of magnitude apart the size distribution comes
 * out roughly power-law — many small, few large.
 */
const GRAINS = [
  { f: 26, rMin: 0.20, rMax: 0.47, pres: 0.26, hgt: 1.00, seed: 401, flat: 0.60 },
  { f: 61, rMin: 0.22, rMax: 0.45, pres: 0.48, hgt: 0.44, seed: 409, flat: 0.70 },
  { f: 146, rMin: 0.26, rMax: 0.46, pres: 0.70, hgt: 0.19, seed: 419, flat: 0.78 },
];
for (const G of GRAINS) G.hMax = G.hgt * G.flat;

/* ---- how deep the grain bed is, stated once ────────────────────────────────
 * A field unit of the dirt height channel is 25 mm of relief, and that number
 * is asserted in two places that must agree or the surface lies: the normal map
 * strength below, and `uSunRise` in terrain.js, which converts metres travelled
 * along the sun azimuth into height units climbed. Divergence between them is a
 * bed whose shadows and whose shading describe different surfaces, and nothing
 * would report it. So it is a value, imported, not a number written twice.
 *
 * K scales it. The bed as authored is too shallow for its own feature size:
 * grains reading 30-60 mm across in `ground` sit on a height field with 4.0 mm
 * of sd, so a typical grain stands 4-8 mm proud and casts 15-30 mm at a 15
 * degree sun — a shadow shorter than the grain is wide, which is exactly the
 * "matte ellipsoids with no cast shadows" the critique names. Measured with
 * tools/_rakeprobe.mjs over 40000 paired points on the real map; the tables are
 * in CONTRACT.md.
 *
 * Note this cannot be done by scaling the height array: packARM renormalises
 * the channel to its own min and max, so a deeper `h` produces a bit-identical
 * texture. The depth lives entirely in how the channel is *interpreted*, which
 * is what this constant is.
 *
 * The ceiling is the binary-field trap, and it was measured before the change
 * rather than discovered after: steep grain normals under a low sun swing a
 * texel from fully lit to fully shadowed, and a binary field scores well on
 * every gradient metric while reading as salt and pepper. The fraction of the
 * map past the terminator at mip 0 runs 7.8% at K=1, 13.1% at 1.5, 18.0% at 2
 * and 25.2% at 3, with RMS tangent slope 0.452 / 0.678 / 0.904 / 1.356. The
 * trap is on record at "a tangent slope near 0.8", so 1.5 sits under it and 2
 * is over. Do not raise this without re-running that probe and looking at the
 * patch — the number will not tell you.
 *
 * ---- and why it is 1.0, having been measured at 1.5 ----
 * 1.5 was built, captured paired against 1.0 at the same commit, and reverted.
 * It did not fail the way it was expected to. It is *not* the binary-field trap:
 * hf/lf was unchanged to two decimals in all three framings (0.47, 0.58, 0.57),
 * which is a flat contrast scaling rather than the spectral shift that trap
 * produces, and the patch looks better rather than noisier — more pebble
 * definition, no salt and pepper. Mean luminance barely moved.
 *
 * It failed on `ground` floor grad/L, 0.151 to 0.172, against a 0.12-0.16
 * reference band. That is a real failure and not a bureaucratic one: it means
 * the floor is now carrying more one-pixel gradient than a photograph of the
 * real thing. The transfer is linear at about 0.042 of grad/L per unit of K, so
 * the band admits **K = 1.21 at most**, worth about 18% shadowed area against
 * the 31-42% a real wash floor has at this sun. Which is the actual result:
 * there is not enough room in the band to buy real pebble shadows by scaling.
 *
 * The reason is a misallocation, and it is the useful thing here. Our floor sits
 * at the *top* of the grad/L band while its 9-pixel high-frequency energy is
 * 0.056 against a real arroyo photograph's 0.115-0.137 — half. So the frame
 * already spends a photograph's entire gradient budget, and spends it at the
 * finest scale, on grit, where a photograph spends it at pebble scale, on cast
 * shadow. Scaling relief raises both bands together and runs out of budget long
 * before the pebble band arrives. The move that works is a *rebalance* — take
 * contrast out of the sub-pixel grit and put it into pebble-scale relief — not
 * a multiplier on the whole map. That is a tuning pass with its own captures,
 * and it is the right next piece of work on this surface. */
export const DIRT_RELIEF_K = 1.0;

/* The bed's two bands, as weights, so they can be swept offline.
 * `fines` and the finest grain class land at one to four pixels in `ground` and
 * are what the one-pixel gradient measures; the coarse grain class is 40-94 mm,
 * which is nine pixels and up, and is what the 9-pixel high-pass measures. They
 * are separate knobs because the measurement says the frame has too much of the
 * first and too little of the second, and a single depth multiplier moves both
 * together — which is exactly why DIRT_RELIEF_K could not be raised.
 * Defaults are all 1.0 and are exact no-ops. */
export const BED = { fines: 1.0, coarse: 1.0, mid: 1.0, grit: 1.0 };

export function makeDirt(size = 1024, bed = BED) {
  const N = size * size;
  /* GRAINS is coarse, mid, grit in that order: f 26 / 61 / 146, which is
     40-94 mm, 19-38 mm and 9-16 mm across. */
  const bedK = [bed.coarse, bed.mid, bed.grit];
  const h = new Float32Array(N);
  const rough = new Float32Array(N);
  const alb = new Uint8Array(N * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      /* Broad relief, kept small. This is the term that used to carry 0.55, and
         it is the term that read as popcorn: half-metre swells of smooth noise
         are not a property of dirt at grain-map scale. */
      const broad = pfbm(u * 5, v * 5, 5, 4, 11);
      const fines = pfbm(u * 205, v * 205, 205, 2, 233);

      /* the matrix of fines, which is the bed the grains are set into */
      let hh = broad * 0.13 + fines * 0.055 * bed.fines;
      let gi = -1, gid = 0, gtop = 0, gcell = 0;

      for (let L = 0; L < GRAINS.length; L++) {
        const G = GRAINS[L];
        const w = pworley(u * G.f, v * G.f, G.f, G.seed, 1.0);
        /* The cell id decides both whether the cell holds a grain and how big it
           is, so size varies grain to grain rather than only class to class. */
        if (w.id > G.pres) continue;
        const t = w.id / G.pres;
        /* Skewed, so within a class most grains are near the small end. Combined
           across three classes an order of magnitude apart this is what gives a
           roughly power-law distribution rather than three visible size bands. */
        const rad = G.rMin + Math.pow(t, 1.7) * (G.rMax - G.rMin);
        if (w.f1 >= rad) continue;
        /* Flattened dome. Water-worn grains are oblate and settle on their broad
           face; a true hemisphere reads as a bead. */
        /* Chip the outline. A perfectly circular plan makes every grain an egg,
           and a bed of eggs is the read the last version got. Nibbling the radius
           with noise finer than the grain itself gives irregular, chipped
           outlines, which is what fracture and abrasion actually produce. */
        const q = (w.f1 / rad) * (0.84 + 0.30 * fines);
        if (q >= 1) continue;
        const top = G.hMax * bedK[L] * Math.pow(1 - q * q, 0.36);
        if (top > gtop) { gtop = top; gi = L; gid = t; gcell = w.id; }
      }
      /* max, not sum: the grain occupies the space and the fines fill around it */
      const grainH = gtop * 0.60;
      if (grainH > hh) hh = grainH; else gi = -1;
      h[i] = hh;

      /* ---- colour ---- */
      const dry = clamp(broad * 1.05 - 0.10, 0, 1);
      let col = mixC(DIRT_DAMP, DIRT_BASE, smoothstep(0.0, 0.42, dry));
      col = mixC(col, DIRT_DUST, smoothstep(0.40, 0.84, dry));
      col = mixC(col, DIRT_PALE, smoothstep(0.72, 1.0, dry) * 0.55);
      let rg = 0.95 - fines * 0.05;

      if (gi >= 0) {
        const G = GRAINS[gi];
        /* Keyed off the winning cell's own hash rather than off the grid square.
           With full jitter the nearest feature point is often in a neighbouring
           cell, so hashing the grid square paints colour patches that do not line
           up with the grains they are supposed to be — which is why the bed came
           out one uniform tint however wide the palette was. */
        const lith = pickGrain((gcell * 91.7 + gi * 0.37) % 1);
        /* Wide, and centred below one. Most of the palette is lighter than the
           matrix, so without pulling the spread down the bed comes out as pale
           stones on dark fines with nothing going the other way — and half the
           stones in a real wash are darker than the dirt around them. */
        const val = 0.62 + ((gcell * 313.7) % 1) * 0.66;
        const stone = [
          clamp(GRAIN_COL[lith][0] * val, 0, 255),
          clamp(GRAIN_COL[lith][1] * val, 0, 255),
          clamp(GRAIN_COL[lith][2] * val, 0, 255),
        ];
        /* A grain barely clear of the fines is half covered in them, so how much
           of its own colour shows depends on how proud it stands *for its class* —
           normalised, or the fine population never gets past a tenth of its own
           colour and the whole bed reads as one size of stone. */
        const cover = smoothstep(0.10, 0.62, gtop / G.hMax);
        col = mixC(col, stone, cover * 0.95);
        rg = mix(rg, 0.86 - gid * 0.05, cover);
      }

      /* ---- oxide stringers ----
         Where the last flood left a smear of fine iron-rich clay, it dries to a
         thin skin far more saturated than anything around it. These are the only
         feature at a scale the eye resolves from standing height that carries the
         top of the saturation distribution, and without them the floor has no
         saturated tail at all: a narrow band at the right mean still reads as
         procedural. Elongated along the flow, because that is how a smear of clay
         is laid down. */
      const str = 0.55 * pnoise(u * 7, v * 34, 7, 34, 877)
                + 0.30 * pnoise(u * 14, v * 68, 14, 68, 1490)
                + 0.15 * pnoise(u * 28, v * 136, 28, 136, 2203);
      const strW = smoothstep(0.60, 0.86, str) * (1 - smoothstep(0.86, 0.97, str) * 0.5);
      col = mixC(col, MUD_STRINGER, strW * 0.86);
      rg = mix(rg, 0.80, strW * 0.6);

      /* per-texel speckle keeps mip level 0 from looking airbrushed */
      const sp = (hash2(x, y, 5501) - 0.5) * 15;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp * 0.96, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.92, 0, 255);
      alb[i * 4 + 3] = 255;
      rough[i] = rg;
    }
  }

  /* Tighter and stronger than before. The whole point of a packing is that
     touching grains meet in a crevice, and the crevice has to go dark or the bed
     reads as one lumpy surface again. */
  const ao = aoFromHeight(h, size, 2, 8, 3.6);
  return {
    albedo: dataTex(alb, size, true),
    /* 2.6 m tile at 1024 is 2.5 mm per texel, and a field unit is about 25 mm of
       relief, which puts the strength near 10 — then scaled by DIRT_RELIEF_K,
       which is the one place the bed's depth is stated. */
    normal: dataTex(normalFromHeight(h, size, size * 0.0102 * DIRT_RELIEF_K), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── wind-drifted sand: the finer, pinker material ─────────────────────── */

/* Drifted sand is the palest material in the scene, but not the least saturated,
   and conflating those two was the reason five of the eight frames measured under
   half the saturation of a real dusk wash floor.
   Measured: the sand-dominated regions came out at 0.35 to 0.41 saturation
   against 0.47 for a photograph of a sandy wash at low dusk sun, and every one of
   them sat at value 0.76 or above — one at 0.87. The tone curve's shoulder pulls
   the channels together up there, so those two facts are the same fact.
   The fix is not exposure. Inverting the tone curve on the measured pixels shows
   that dropping exposure from 0.82 to 0.46 — far more than the frame can survive,
   it puts the lit rock face at value 0.25 — buys the sand six hundredths of
   saturation, because a pale pixel stays pale when you dim it. What was wrong is
   the pigment: this was quartz-white with a wash of oxide over it, and real wash
   sand is oxide-stained sand. So each tone here is a quarter darker and about a
   quarter more saturated, which lands the rendered sheet near value 0.63 where
   the curve still has room for chroma. It stays lighter than the compacted dirt
   beside it, which is the one relationship that has to hold. */
const SAND_LOW = C(120, 80, 50);
const SAND_MID = C(150, 104, 69);
const SAND_TOP = C(171, 123, 86);

export function makeSand(size = 512) {
  const N = size * size;
  const h = new Float32Array(N);
  const rough = new Float32Array(N);
  const alb = new Uint8Array(N * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      /* ripples: a periodic train bent by low-frequency noise, so the crests
         wander the way wind ripples actually do instead of running straight */
      /* Warped hard, and broken by a coverage mask: ripples that run coherently
         across a whole tile read as corrugated iron from thirty metres, which is
         not how a patch of drifted sand in a wash looks. */
      const warp = pfbm(u * 3, v * 3, 3, 3, 17) - 0.5;
      const warp2 = pfbm(u * 11, v * 11, 11, 2, 19) - 0.5;
      /* ---- two wavelengths, and why one is not enough ----
         Ripple wavelength scales with the depth and speed of the flow that built
         the train, so it varies across a wash floor by a factor of two or more
         within a few metres. A single frequency, however hard its phase is
         warped, keeps a constant *spacing*, and constant spacing at constant
         amplitude across a whole floor is the combed-hair read: the previous pass
         overcorrected a floor with no bedform into a floor that was one bedform.
         Frequency cannot be varied continuously in a tiling map — the phase would
         not close — so two integer trains are crossfaded by a low-frequency
         field instead, which gives the same read for the same cost. */
      const wlSel = smoothstep(0.36, 0.68, pfbm(u * 2, v * 2, 2, 3, 21));
      const rip9  = 0.5 + 0.5 * Math.sin((v * 9  + warp * 2.2 + warp2 * 0.7 + u * 1.0) * Math.PI * 2);
      const rip15 = 0.5 + 0.5 * Math.sin((v * 15 + warp * 3.4 + warp2 * 1.1 + u * 2.0) * Math.PI * 2);
      const rip = mix(rip9, rip15, wlSel);
      /* Coverage narrowed, plus a genuine plane-bed mask. Where a flood ran fast
         enough it planes the bed off flat and leaves no ripples at all, and those
         bare patches between ripple fields are as much of the signature as the
         ripples: a bed rippled edge to edge is a bed that only ever saw one flow
         regime. */
      const cover = smoothstep(0.40, 0.70, pfbm(u * 5, v * 5, 5, 3, 23));
      const plane = 1 - smoothstep(0.52, 0.74, pfbm(u * 3, v * 3, 3, 3, 25));
      /* Amplitude varies independently of coverage, so the train fades in and out
         along its own length rather than being present or absent. */
      const amp = 0.42 + 0.72 * pfbm(u * 4, v * 4, 4, 3, 27);
      const ripple = Math.pow(rip, 1.5) * 0.62 * cover * plane * amp;
      /* A second, finer train crossing the first. A dry wash bed carries relict
         current ripples from the last flood with wind ripples worked across them
         at an angle over the weeks since, and the interference between two
         wavelengths is most of what stops a sand sheet reading as corrugation.
         Seven-centimetre wavelength, so a third of the current ripples. */
      const wwarp = pfbm(u * 6, v * 6, 6, 3, 29) - 0.5;
      const wind = Math.pow(0.5 + 0.5 * Math.sin((u * 26 + v * 9 + wwarp * 3.4) * Math.PI * 2), 1.7)
                 * smoothstep(0.30, 0.66, pfbm(u * 7, v * 7, 7, 3, 31));
      /* Parting lineation: fine streaks drawn out along the flow direction where
         the last of the water sheeted off. Almost no relief, but it is directional,
         and one directional cue at this scale is the difference between a surface
         that water ran over and a surface that was noise-displaced. */
      const lin = pfbm(u * 9, v * 135, 9, 2, 37);   // 135 = 15 periods, so it tiles
      const drift = pfbm(u * 4, v * 4, 4, 4, 313);
      const grain = pfbm(u * 220, v * 220, 220, 2, 887);

      /* A lag of coarse granules left on the ripple crests when the wind sorted
         the fines out from under them. Sand grains themselves are well below one
         texel here, so the only granularity that can survive on a sand sheet at
         this scale is the coarse tail of the distribution — and without it the
         sheet is a smooth membrane in exactly the way the floor was. */
      const lg = pworley(u * 88, v * 88, 88, 971, 1.0);
      let lag = 0;
      if (lg.id < 0.30) {
        const rad = 0.26 + (lg.id / 0.30) * 0.16;
        if (lg.f1 < rad) {
          const q = lg.f1 / rad;
          lag = Math.pow(1 - q * q, 0.45) * (0.45 + 0.55 * smoothstep(0.30, 0.75, ripple));
        }
      }

      /* Reweighted hard. The ripple train carried 0.075 of a field unit against the
         smooth drift's 0.5 — about a millimetre and a half of relief against eleven
         — so what the sheet actually presented was a broad hillshaded swell with no
         bedform on it at all, which is exactly the criticism. A real current ripple
         in a wash is one to two centimetres from trough to crest. */
      h[i] = drift * 0.20 + ripple * 0.44 + wind * 0.17 + lin * 0.045
           + grain * 0.030 + lag * 0.045;

      const bright = clamp(ripple * 0.52 + wind * 0.22 + drift * 0.38 - 0.08, 0, 1);
      let col = mixC(SAND_LOW, SAND_MID, smoothstep(0.0, 0.55, bright));
      col = mixC(col, SAND_TOP, smoothstep(0.5, 1.0, bright));
      if (lag > 0.01) {
        const gl = pickGrain(hash2(Math.floor(u * 88), Math.floor(v * 88), 6203));
        col = mixC(col, GRAIN_COL[gl], smoothstep(0.05, 0.60, lag) * 0.80);
      }
      const sp = (hash2(x, y, 991) - 0.5) * 15;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.9, 0, 255);
      alb[i * 4 + 3] = 255;

      rough[i] = 0.97 - grain * 0.06 - lag * 0.12;
    }
  }

  const ao = aoFromHeight(h, size, 2, 7, 2.4);
  return {
    albedo: dataTex(alb, size, true),
    /* 2.2 m tile, ~20 mm of relief → about 5 */
    normal: dataTex(normalFromHeight(h, size, size * 0.0098), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── canyon-wall sandstone ─────────────────────────────────────────────── */

/* ---- why this map was rebuilt from scratch ----
 *
 * The previous version was a *sum* of smooth fBm — a bedding warp at two
 * periods, a cross-bed sweep at nine, a pit field at seventy — and a sum of
 * smooth noise is one continuous membrane however many octaves go into it.
 * Rendered at the scale a close cliff face demands, it read as carved wax:
 * the forms were right and the substance was missing. This is the identical
 * failure System 1 had when its wash floor was "a bumpy membrane with rocks
 * resting on it", and it has the identical fix.
 *
 * Sandstone is not noise. It is a *packing* of cemented sand grains, laid down
 * in laminae that differ in grain size, cemented unevenly, and then eaten back
 * by cavernous weathering into pits and honeycomb. Every one of those is a
 * discrete element that occupies space and occludes its neighbours, so the
 * height field below is a maximum over populations rather than a sum, the
 * hollows are subtracted with a rim, and each texel takes the tone of whichever
 * element won.
 *
 * Scale. rock.js samples this map at 0.155 cycles per metre, so the tile is
 * 6.45 m across and one texel is 6.3 mm; it samples it a second time at 0.62,
 * where the tile is 1.61 m and a texel is 1.6 mm. Everything here is therefore
 * authored against the 6.45 m reading — pits of 5 to 25 cm, laminae of 8 to 20,
 * granular clumps of 1 to 5 — and the second reading brings the same features
 * back a quarter of the size, which is exactly the sand-grain band. One map,
 * two octaves of material, no extra texture.
 *
 * Colour is nearly all *luminance*, because that is nearly all the shader takes:
 * the strata are geometry, and letting this map's pigment through would lay a
 * second contradictory set of bands over them. What chroma is here is the small
 * deviation between a quartz-rich lamina and an iron-cemented one, which the
 * shader reads at low weight so that a grain has a mineral and not just a value.
 */
const ROCK_MATRIX = C(150, 110,  92);   // cemented matrix, dusty salmon
const ROCK_HARD   = C(168, 124, 101);   // well-cemented lamina, stands proud
const ROCK_SOFT   = C(133,  96,  82);   // friable lamina, recessive and dusty
const ROCK_QUARTZ = C(178, 158, 137);   // quartz-rich lamina, pale and smooth
const ROCK_IRON   = C(157,  84,  55);   // iron-cemented lamina, the saturated end
const ROCK_PITIN  = C( 86,  60,  50);   // inside a weathering pit: shade and dust
const ROCK_DUST   = C(172, 146, 122);   // efflorescent dust on a pit rim

/* Grain populations, in cells across the 6.45 m tile. 22 cells is a 29 cm cell
   holding a 7-14 cm clump; 300 cells is a 2 cm cell holding a 5-10 mm one. Read
   again at the 1.61 m scale those become 3 cm and 2 mm, which is the coarse and
   the fine end of a sand. `pres` is the fraction of cells that host a grain, so
   with four classes an order of magnitude apart the size distribution comes out
   roughly power-law: many small, few large. */
const RGRAINS = [
  { f: 23,  rMin: 0.20, rMax: 0.46, pres: 0.24, hgt: 1.00, flat: 0.52, seed: 5101 },
  { f: 57,  rMin: 0.22, rMax: 0.45, pres: 0.44, hgt: 0.40, flat: 0.62, seed: 5107 },
  { f: 137, rMin: 0.25, rMax: 0.46, pres: 0.64, hgt: 0.155, flat: 0.72, seed: 5113 },
  { f: 311, rMin: 0.27, rMax: 0.47, pres: 0.78, hgt: 0.062, flat: 0.80, seed: 5119 },
];
for (const G of RGRAINS) G.hMax = G.hgt * G.flat;

export function makeRock(size = 1024) {
  const N = size * size;
  const h = new Float32Array(N);
  const rough = new Float32Array(N);
  const alb = new Uint8Array(N * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      /* ---- bedding laminae ----
         The shader samples this map triplanar, and on a vertical face the
         dominant plane is zy or xy — in both of which the map's v axis is world
         y. So laminae authored along v come out horizontal on the walls without
         the shader having to know anything about them.
         Warped by rather more than one lamina thickness, because a train of
         parallel lines at a constant spacing is corrugated card: real laminae
         undulate over several times their own spacing and pinch out. */
      const lamW = (pfbm(u * 2, v * 2, 2, 4, 5201) - 0.5) * 3.4
                 + (pfbm(u * 7, v * 7, 7, 3, 5203) - 0.5) * 1.15;
      const lamC = v * 46 + lamW;
      const lamI = ((Math.floor(lamC) % 46) + 46) % 46;
      const lamT = lamC - Math.floor(lamC);
      /* Two low-frequency sines rather than a hash, so neighbouring laminae are
         weakly correlated the way a real depositional sequence is — a coarsening
         run, then a fining one — instead of alternating at random.
         Then varied *along* the lamina as well as across it, which is the fix for
         the long unbroken horizontal streaks the wall was showing. Keyed to the
         lamina index alone, every property was constant for the whole length of
         the band: one hardness, one quartz content, one iron content from end to
         end, which on a fifty-metre wall is a brush stroke. A real lamina
         coarsens, cements harder, stains and pinches out along its length — a bed
         traced across a canyon is a different rock at each end.
         The variation comes from a low-frequency field with a *per-lamina seed*
         rather than from offsetting the coordinates, because pfbm wraps at its
         period and a non-integer coordinate offset would put a seam down the
         tile. A seeded field stays periodic, and the discontinuity it does have —
         at the lamina boundary, where the seed changes — is exactly where a
         discontinuity belongs. */
      const lamHard = clamp(0.5 + 0.30 * Math.sin(lamI * 2.399 + 1.7)
                                + 0.18 * Math.sin(lamI * 0.611)
                                + (pfbm(u * 3, v * 3, 3, 3, 5221 + lamI * 7) - 0.5) * 0.60,
                            0, 1);
      const lamQtz = clamp(hash2(lamI, 3, 5211)
                         + (pfbm(u * 2, v * 2, 2, 2, 5231 + lamI * 11) - 0.5) * 0.60, 0, 1);
      const lamFe = clamp(hash2(lamI, 9, 5217)
                        + (pfbm(u * 2, v * 2, 2, 2, 5241 + lamI * 13) - 0.5) * 0.65, 0, 1);
      /* The contact itself: a fine recessive groove where the two laminae meet,
         narrow and shallow. This is a real feature and it is also the only line
         work in the map, so it is kept to a couple of texels at the coarse
         reading and left to disappear into the mips beyond that. */
      const contact = Math.pow(1 - Math.min(1, Math.abs(lamT - 0.5) * 2), 14.0);

      /* ---- cavernous weathering ----
         Tafoni and honeycomb: the salt-weathering hollows that make a Sedona
         face look eaten rather than carved, and by far the strongest single cue
         at the two-metre viewing distance the close-up shots use. Two
         generations, an octave and a half apart, gated by a patch field so that
         a run of face is pitted and the next is not — cavernous weathering is
         patchy, and a face pitted edge to edge is pumice. A pit is subtracted
         with a *rim*, because the rim is a case-hardened crust and it is what
         throws the shadow. */
      /* Pulled back hard from the first attempt, which put a pit in half the
         cells of both generations over most of the face and read as a regular
         field of drilled holes — a golf ball, not a cliff. Cavernous weathering
         is *patchy at every scale*: an alcove ceiling is honeycombed edge to edge
         and the buttress beside it has three hollows on it. So the patch gate is
         narrower, a third of the cells carry a pit instead of a half, and the
         outline is nibbled by noise finer than the pit the way the grains are,
         because a field of circles is as recognisable as a field of eggs. */
      const ptw = (pfbm(u * 3, v * 3, 3, 3, 5301) - 0.5) * 0.55;
      /* Clustered by two envelopes, not one. A single 1.6 m patch field at a
         third coverage still tiles a whole cliff at near-constant density, which
         is what the last round shipped and what read as Swiss cheese. Real
         cavernous weathering picks its ground: friable beds, alcove ceilings, the
         lee of a seepage line. So a 6 m envelope decides whether this *stretch of
         face* is susceptible at all — most of it is not — and the 1.6 m field
         then places the honeycomb within it. */
      const pitZone = smoothstep(0.42, 0.70, pfbm(u * 1, v * 1, 1, 2, 5351));
      const pitField = smoothstep(0.50, 0.82, pfbm(u * 4, v * 4, 4, 4, 5307))
                     * pitZone * (1 - lamHard * 0.62);
      const dish = (w, presT, rMin, rSpan, chip) => {
        if (w.id > presT) return 0;
        const rad = rMin + (w.id / presT) * rSpan;
        if (w.f1 >= rad) return 0;
        const q = (w.f1 / rad) * chip;
        if (q >= 1) return 0;
        return Math.pow(1 - q * q, 0.65);
      };
      const chipA = 0.80 + 0.40 * pfbm(u * 62, v * 62, 62, 2, 5341);
      const chipB = 0.80 + 0.40 * pfbm(u * 150, v * 150, 150, 2, 5343);
      const pwA = pworley(u * 27 + ptw, v * 27 - ptw, 27, 5311, 1.0);
      const pwB = pworley(u * 74 - ptw, v * 74 + ptw, 74, 5317, 1.0);
      const pitA = dish(pwA, 0.34, 0.20, 0.24, chipA) * pitField;
      const pitB = dish(pwB, 0.42, 0.22, 0.22, chipB) * pitField * (0.45 + 0.55 * pitField);
      const pit = clamp(pitA * 0.66 + pitB * 0.38, 0, 1);
      /* The case-hardened lip: just outside the hollow, standing proud of it. */
      const rimA = smoothstep(0.02, 0.0, pwA.f1 * chipA - (0.20 + (pwA.id / 0.34) * 0.24))
                 * (pwA.id <= 0.34 ? 1 : 0) * pitField;

      /* ---- spall flakes ----
         A slab of case-hardened surface lets go and leaves a shallow dish a few
         decimetres across with a sharp upper edge and a feathered lower one.
         Very shallow — this is a skin coming off, not a block. */
      const flk = pworley(u * 7 + ptw * 0.5, v * 7, 7, 5323, 1.0);
      const flake = dish(flk, 0.30, 0.26, 0.22, 0.84 + 0.32 * pfbm(u * 26, v * 26, 26, 2, 5347))
                  * smoothstep(0.42, 0.66, pfbm(u * 3, v * 3, 3, 3, 5329));

      /* ---- the granular packing ----
         max, not sum: the grain occupies the space and the finer populations
         fill in around it rather than riding on its back. */
      let gtop = 0, gi = -1, gcell = 0, gnorm = 0;
      for (let L = 0; L < RGRAINS.length; L++) {
        const G = RGRAINS[L];
        const w = pworley(u * G.f, v * G.f, G.f, G.seed, 1.0);
        if (w.id > G.pres) continue;
        const t = w.id / G.pres;
        const rad = G.rMin + Math.pow(t, 1.7) * (G.rMax - G.rMin);
        if (w.f1 >= rad) continue;
        /* Chipped outline. A circular plan makes every grain an egg and a bed of
           eggs is caviar; nibbling the radius with noise finer than the grain
           gives the irregular, angular outlines that fracture actually makes. */
        const q = (w.f1 / rad) * (0.82 + 0.34 * pfbm(u * 190, v * 190, 190, 2, 5331));
        if (q >= 1) continue;
        const top = G.hMax * Math.pow(1 - q * q, 0.38);
        if (top > gtop) { gtop = top; gi = L; gcell = w.id; gnorm = top / G.hMax; }
      }
      /* Grain size follows the lamina: a coarse lamina presents its coarse
         population and a fine one is nearly smooth at this scale, which is what
         differential grain size *is* and what makes the laminae legible without
         drawing a single line. */
      const coarse = 0.30 + 0.70 * lamHard;
      const grainH = gtop * (0.42 + 0.58 * coarse);

      /* ---- assemble the height field ----
         The matrix the grains are set into carries only what is genuinely
         smooth about a rock face: a broad swell and the lamina step. */
      const broad = pfbm(u * 5, v * 5, 5, 3, 5337);
      let hh = broad * 0.20 + (lamHard - 0.5) * 0.085 + 0.055;
      if (grainH > hh) hh = grainH; else gi = -1;
      hh -= contact * 0.055 * (0.4 + 0.6 * (1 - lamHard));
      /* Deeper hollow, and a rim that stands twice as proud. Now that the pit is
         carried by geometry rather than pigment it has to *be* geometry: a hollow
         shallower than its own rim cannot occlude its interior, and it is the
         occluded interior and the lit lower lip that make a hole read as a hole. */
      hh += rimA * 0.105 - pit * 0.42 - flake * 0.085;
      h[i] = hh;

      /* ---- colour ----
         Lamina first, then whichever grain won, then the hollows. */
      let col = mixC(ROCK_SOFT, ROCK_HARD, smoothstep(0.20, 0.80, lamHard));
      col = mixC(col, ROCK_QUARTZ, smoothstep(0.66, 0.94, lamQtz) * 0.62);
      col = mixC(col, ROCK_IRON, smoothstep(0.62, 0.93, lamFe) * 0.55);
      col = mixC(col, ROCK_MATRIX, 0.28);

      if (gi >= 0) {
        /* Keyed off the winning cell's own hash rather than the grid square:
           with full jitter the nearest feature point is usually in a neighbouring
           cell, so hashing the square paints tone patches that do not line up
           with the grains they belong to — which is how a wide palette still
           comes out as one flat tint. */
        const gv = (gcell * 137.31) % 1;
        /* Narrow. Clasts weathering out of a matrix are the *same lithology* as
           the matrix — the grains in a sandstone are the sandstone — so the
           contrast between a grain and the cement around it is a few percent,
           not a few stops. Wide value spread here is what turns a weathered
           face into confetti, and it is the same error the talus is making. */
        const val = 0.90 + gv * 0.22;
        const stone = [col[0] * val, col[1] * val, col[2] * val];
        /* A grain barely clear of the matrix is half buried in it. */
        const cover = smoothstep(0.12, 0.66, gnorm);
        col = mixC(col, stone, cover);
        /* A few grains per hundred are a different mineral — a chert pebble, a
           varnished lithic, a quartz granule. Sparse enough to read as an
           inclusion rather than as a palette. */
        if (gv > 0.955) col = mixC(col, ROCK_QUARTZ, cover * 0.55);
        else if (gv < 0.035) col = mixC(col, C(96, 78, 70), cover * 0.55);
      }

      /* ---- the pit is a cavity, not a stain ----
         This was the single most damaging thing in the last round, and the error
         was one line: mixing 62% of a dark pigment into the pit interior. That
         makes a pit *albedo*, and albedo survives the mip chain and the
         terminator fade when a normal does not, so what reached the frame was a
         dense field of flat dark blobs three to six pixels across with no rim, no
         asymmetry and no response to the sun at all — fly-dirt on a scanned
         negative. It also put a great deal of amplitude in the four-pixel band,
         which is how the mean gradient rose eightfold while the ratio of one-pixel
         to four-pixel energy did not move: the number was bought, not earned.
         A tafoni pit is not a dark patch. It is a hole in a case-hardened rind.
         What makes it dark is *occlusion*, which the height field already carries
         into the cavity term and which flips its inner lighting as the sun moves
         because it is geometry. The interior rock is the same rock: friable,
         dust-lined, a shade duller, and that is all the pigment it gets. What
         does get pigment is the rim — an indurated crust with efflorescent salt
         on it, genuinely paler than the face and genuinely standing proud. */
      col = mixC(col, ROCK_DUST, rimA * 0.46);
      col = mixC(col, ROCK_PITIN, pit * 0.14);
      col = mixC(col, ROCK_HARD, flake * 0.34);
      col = mixC(col, mixC(col, ROCK_SOFT, 0.7), contact * 0.5);

      /* Per-texel speckle. At mip 0 this is the last half-millimetre of grain and
         it is what keeps a face two metres from the camera from looking
         airbrushed; every mip above collapses it, which is correct. */
      const sp = (hash2(x, y, 2207) - 0.5) * 16;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp * 0.95, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.9, 0, 255);
      alb[i * 4 + 3] = 255;

      /* A pit interior is friable and dust-lined; a quartz lamina and a
         case-hardened rim are the two smoothest things on the face. */
      rough[i] = clamp(0.93 - lamQtz * 0.06 - rimA * 0.05 + pit * 0.05
                            - (gi >= 0 ? 0.04 : 0), 0.6, 1.0);
    }
  }

  /* Tight and strong: the whole point of a packing is that touching grains meet
     in a crevice, and the crevice has to go dark or the face reads as one lumpy
     membrane again. The far radius carries the pits. */
  const ao = aoFromHeight(h, size, 2, 12, 3.2);
  return {
    albedo: dataTex(alb, size, true),
    /* 6.45 m tile at 1024 is 6.3 mm per texel, and the field spans about 14 cm
       of relief between a pit floor and a rim. normalFromHeight differences over
       two texels, so the strength is relief / (2 * texel) = 0.14 / 0.0126 ≈ 11.
       Read again at the 1.61 m scale the same map is 3.5 cm of relief over a
       quarter of the distance, which is the same slope — a normal map is scale
       free in slope, which is why one strength serves both readings. */
    normal: dataTex(normalFromHeight(h, size, 11.0), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── grit: the footprint-locked detail layer ───────────────────────────── */

/**
 * A packing of grains and micro-pits with **no low-frequency content at all** —
 * nothing below a fourteenth of the tile — so that it can be read at an
 * arbitrary world scale without implying any particular physical size.
 *
 * That is the whole point of it. Rock is fractal, and that is not a figure of
 * speech: it is why a photograph of a cliff has structure at the pixel scale
 * whether the cliff is two metres away or two hundred. At two hundred metres a
 * pixel covers a metre, and a metre of sandstone is as structured as a
 * centimetre of it. A texture pinned to a world scale cannot express that —
 * past the distance where its texels fall under a pixel the mip chain collapses
 * it to its mean and the surface goes to wax. Measured, that was the entire
 * defect: the wall's mean one-pixel luminance gradient was 0.0045 against 0.026
 * to 0.085 on photographs of the same formations. So rock.js locks this layer's
 * sampling scale to the pixel footprint instead.
 *
 * Everything is packed into one RGBA map so that costs one texture fetch:
 *   R  tone deviation about 0.5
 *   G  tangent-space normal x
 *   B  tangent-space normal y
 *   A  crevice occlusion
 *
 * The normal's z is recovered in the shader, which is exact for a tangent-space
 * normal and free.
 */
/* ---- and the spectrum, which is the whole design ----
 *
 * The first version of this map had populations at 14, 33 and 79 cells with
 * relative heights 1.00, 0.40 and 0.155, combined by maximum. That is a very red
 * spectrum: amplitude falling as roughly the wavelength, so the coarsest
 * population dominates everything. It raised the mean per-pixel gradient by a
 * factor of two and left the *ratio* of one-pixel to four-pixel gradient at 0.42
 * against 0.54–0.75 measured on photographs of this rock — energy added in the
 * wrong band. Isolated in tools/wallprobe.mjs this layer alone measured 0.41 at
 * every distance while the rock map behind it measured 0.69–0.82, so the term
 * added to fix the surface was the term holding it back.
 *
 * A weathered rock face is not one population of grains. It is roughness at
 * every scale from the spall relief down through grain clusters and individual
 * grains to the pitting left where cement has gone, and the amplitude falls only
 * slowly with wavelength — near enough as its cube root over this range, which
 * is what the measured ratio band implies. So the octaves are *summed* with
 * amplitudes near that law rather than one of them winning by maximum: within an
 * octave a packing is still the right model, because grains occupy space and do
 * not ride on each other's backs, but across octaves a fractal surface is a sum.
 *
 * The finest terms are hashes rather than packings, because at two texels a
 * Voronoi distance field is only an expensive way to make noise. They matter
 * more than their amplitude suggests: shading responds to *slope*, and slope for
 * a given amplitude goes as the reciprocal of the wavelength, so the last octave
 * before the texel does most of the visible work.
 */
const GRIT = [
  { f: 15, a: 1.00, rMin: 0.20, rMax: 0.48, pres: 0.34, flat: 0.55, seed: 9101 },
  { f: 36, a: 0.78, rMin: 0.23, rMax: 0.47, pres: 0.48, flat: 0.64, seed: 9107 },
  { f: 86, a: 0.61, rMin: 0.26, rMax: 0.47, pres: 0.66, flat: 0.74, seed: 9113 },
];
for (const G of GRIT) G.hMax = G.a * G.flat;

export function makeGrit(size = 256) {
  const N = size * size;
  const h = new Float32Array(N);
  const tone = new Float32Array(N);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;

      /* Each octave is a packing — grains occupy space and do not ride on each
         other's backs — and the octaves are *summed*, because across scales a
         weathered surface is a fractal and a fractal is a sum. Mean-removed per
         octave so the total does not drift with the presence fraction. */
      let hh = 0, tFine = 0;
      for (let L = 0; L < GRIT.length; L++) {
        const G = GRIT[L];
        const w = pworley(u * G.f, v * G.f, G.f, G.seed, 1.0);
        let top = 0, gnorm = 0;
        if (w.id <= G.pres) {
          const t = w.id / G.pres;
          const rad = G.rMin + Math.pow(t, 1.6) * (G.rMax - G.rMin);
          if (w.f1 < rad) {
            /* Chipped, by noise finer than the grain itself. A circular plan
               makes every grain an egg and a bed of eggs is caviar. */
            const q = (w.f1 / rad) * (0.80 + 0.38 * pfbm(u * G.f * 4, v * G.f * 4,
                                                         G.f * 4, 2, 9121 + L * 7));
            if (q < 1) { top = G.hMax * Math.pow(1 - q * q, 0.40); gnorm = top / G.hMax; }
          }
        }
        /* Sockets: the holes left where a grain has fallen out, one population
           per octave. A weathered face is as much holes as grains, and the holes
           are the darker half of the stipple — a layer that is only ever brighter
           than the surface under it reads as dust, not as granularity. */
        /* The frequency has to be an integer and the same integer the period
           argument gets, or the field does not close across the tile and the
           whole map picks up a diagonal shear at the seam. */
        const fs = Math.round(G.f * 1.37);
        const ws = pworley(u * fs + 11.0, v * fs, fs, G.seed + 401, 1.0);
        let sock = 0;
        if (ws.id < 0.30) {
          const rs = 0.19 + (ws.id / 0.30) * 0.21;
          if (ws.f1 < rs) sock = Math.pow(1 - (ws.f1 / rs) * (ws.f1 / rs), 0.7);
        }
        hh += (top - G.hMax * 0.30 - sock * G.hMax * 0.62) * 0.62;
        /* Tone is carried mostly by the finer octaves on purpose: albedo
           modulation has whatever spectrum it is given, unlike slope, which the
           reciprocal of the wavelength already tilts upward. Weight rises with
           octave index. */
        const wt = 0.17 + 0.20 * L;
        tFine += ((gnorm - 0.35) * 0.24 - sock * 0.26) * wt;
      }

      /* The last octave before the texel, as hashes rather than packings, since
         at two texels a Voronoi distance field is only an expensive way to make
         noise. Two terms: one smoothed over a couple of texels, one per texel.
         Their amplitude is small and their contribution is not, because slope for
         a given amplitude goes as the reciprocal of the wavelength. */
      const fine2 = pfbm(u * 128, v * 128, 128, 1, 9151) - 0.5;
      const fine1 = hash2(x, y, 9143) - 0.5;
      hh += fine2 * 0.115 + fine1 * 0.072;
      h[i] = hh;
      tone[i] = clamp(0.5 + tFine + fine2 * 0.070 + fine1 * 0.058, 0, 1);
    }
  }

  /* One and two texels only. The cavity term has to sit at the top of the
     spectrum for the same reason everything else here does; a wide-radius
     occlusion is a low-frequency wash and would spend amplitude in the band that
     is already too loud. */
  /* Strength 2.0, not 5.0. At 5.0 this channel came back very nearly binary —
     hard black dots on white — and a hard black dot is precisely the failure
     being fixed one scale up: a flat dark spot with no gradation, which is what
     the eye reads as dirt on the lens rather than as a crevice. An occlusion term
     is a gradation by definition; if it saturates it has stopped describing
     geometry. */
  const ao = aoFromHeight(h, size, 1, 3, 2.0);
  /* Slope, not relief: this map is read at every scale, so what has to be right
     is the angle. With the spectrum flattened, the finest octaves dominate the
     central difference, so the strength comes down — at 3.0 the summed field
     produced normals lying past fifty degrees over most of the map, which is
     shot blast rather than sandstone. */
  const nrm = normalFromHeight(h, size, 1.05);
  const buf = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    buf[i * 4] = clamp(tone[i], 0, 1) * 255;
    buf[i * 4 + 1] = nrm[i * 4];
    buf[i * 4 + 2] = nrm[i * 4 + 1];
    buf[i * 4 + 3] = clamp(ao[i], 0, 1) * 255;
  }
  return dataTex(buf, size, false);
}

/* ── clast surface, for the instanced gravel, cobbles and blocks ───────── */

/**
 * Deliberately *neutral*. A wash carries grey Fort Apache limestone, off-white
 * Coconino, dark basalt off the Rim and buff chert alongside the local red
 * sandstone, and a single-lithology gravel field is one of the loudest tells
 * there is. So this map carries only luminance structure — mottling, grit,
 * quartz veining, bedding lamination — and every scrap of hue comes from the
 * per-instance tint in scatter.js. Mean value is set near 0.42 linear so the
 * tints there can be read as plain multipliers on a target albedo.
 *
 * The tile is scaled per instance to hold texel density constant in world space,
 * so everything here is authored against a fixed physical size — roughly six
 * centimetres across the tile. That is what lets one map serve a two-centimetre
 * granule and a half-metre bedding slab: at these frequencies the slab gets
 * millimetre lamination and fingernail-scale grit, which is what a metre of
 * sandstone actually presents, rather than one stretched copy of a map that
 * describes centimetres.
 */
export function makeClastSurface(size = 512) {
  const N = size * size;
  const h = new Float32Array(N);
  const rough = new Float32Array(N);
  const alb = new Uint8Array(N * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const mot = pfbm(u * 6, v * 6, 6, 4, 3301);
      const grit = pfbm(u * 44, v * 44, 44, 3, 3307);
      const vein = pridged(u * 5, v * 5, 5, 3, 3313);

      /* ---- bedding lamination ----
         The single largest reason the big talus slabs read as grey card. A block
         that spalled off a stratified wall is a *section* through that
         stratigraphy: the laminae it was deposited in run across the broken face
         and continue over its arrises onto the next facet, and that continuity is
         most of what says "this is a piece of rock" rather than "this is a
         quadrilateral". Twenty-two periods across a six-centimetre tile is a
         three-millimetre lamina, which is the real scale in Schnebly Hill
         sandstone. Warped so they are not ruler-straight, and sheared slightly by
         u so they cross each facet at an angle instead of lining up with its
         edges. */
      /* Warped far harder than the first attempt, and with the shear removed.
         Twenty-two straight laminae sheared by a constant multiple of u are a
         diagonal grating, and a diagonal grating crossed by the per-lamina
         hardness hash came out as woven fabric — a regular cross-hatch, legible
         as a *pattern* rather than as rock, which on a large flat facet is no
         better than the featureless grey it replaced. Real laminae undulate over
         several times their own spacing, so the warp has to be worth more than one
         wavelength for the train to stop being a train. */
      const lamW = (pfbm(u * 3, v * 3, 3, 3, 3319) - 0.5) * 5.2
                 + (pfbm(u * 8, v * 8, 8, 2, 3323) - 0.5) * 1.6;
      const lam = 0.5 + 0.5 * Math.sin((v * 22 + lamW) * Math.PI * 2);
      /* Alternate laminae differ in grain size, so they weather at different
         rates and one stands slightly proud of its neighbour. A few tenths of a
         millimetre — enough to catch a raking sun as a fine ribbed texture, not
         enough to read as corrugation, and that margin is narrow. */
      const lamHard = 0.5 + 0.5 * Math.sin(Math.floor(v * 22 + lamW) * 2.399);

      /* ---- and why the lamination came down again ----
         Twenty-two periods across a six-centimetre tile is a three-millimetre
         lamina, which is the real scale and was the right call — but the tile is
         scaled per instance to hold texel density constant, so on a half-metre
         boulder eighteen tiles land across the object and three millimetres of
         lamina lands on one or two pixels at close range. A one-pixel periodic
         ridge crossed by the per-lamina hardness hash is a moiré, and magnified
         it read as woven cloth over every large flat facet — which is most of
         what the residual "1 to 2 px hash" on the clasts actually is. It is not
         aliasing in the sampler: the feature is genuinely at the Nyquist limit of
         the screen, so the only honest fix is less relief on it. Roughly halved
         in the height field and cut by a third in the albedo; the lamination is
         still there as a fine ribbing where it can be resolved. */
      h[i] = mot * 0.5 + grit * 0.22 + vein * 0.12 + lam * lamHard * 0.010;

      let g = 152 + mot * 52 + grit * 16;
      g += (lam - 0.5) * 3.0 * (0.35 + 0.65 * lamHard);
      g = mix(g, 214, Math.pow(clamp(vein - 0.62, 0, 1) * 2.6, 1.5) * 0.6);  // quartz vein
      const sp = (hash2(x, y, 4409) - 0.5) * 18;
      const val = clamp(g + sp, 0, 255);
      alb[i * 4] = val;
      alb[i * 4 + 1] = val;
      alb[i * 4 + 2] = val;
      alb[i * 4 + 3] = 255;
      /* Never glossy. A dry stone in a wash has a matte, dust-filmed surface, and
         a roughness dipping into the 0.7s under a hard low key puts a specular
         sparkle on every clast facing the sun. */
      rough[i] = 0.88 - grit * 0.05 + mot * 0.06 - lam * lamHard * 0.02;
    }
  }
  const ao = aoFromHeight(h, size, 2, 8, 2.0);
  return {
    albedo: dataTex(alb, size, true),
    /* A six-centimetre tile at 512 is 0.12 mm per texel, and the field carries
       something like 4 mm of relief across the mottle and the lamination, which
       puts the strength around 33. Well under what the old whole-clast tiling
       needed, because the features are now physically small rather than being one
       pebble's worth of shape stretched over a slab. */
    normal: dataTex(normalFromHeight(h, size, size * 0.065), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── mid-scale variance ────────────────────────────────────────────────── */

/**
 * Tiled at about seven metres, between the macro map's tens of metres and the
 * detail tiles' couple of metres. It exists for two reasons. It fills the band
 * where a two-scale scheme leaves a hole and the ground collapses into flat
 * colour past fifteen metres or so; and it carries *hue* variance rather than
 * just value, which is what a landscape whose whole palette spans twenty-five
 * degrees of hue is missing.
 *
 *   R  grey-violet patches — leached iron, mineral varnish
 *   G  mid-scale value variation
 *   B  pale buff dust settling
 *   A  spare
 */
export function makeVariance(size = 512) {
  const N = size * size;
  const buf = new Uint8Array(N * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const a = pfbm(u * 4, v * 4, 4, 4, 7101);
      const b = pfbm(u * 9, v * 9, 9, 4, 7213);
      const c = pridged(u * 3, v * 3, 3, 3, 7307);
      buf[i * 4] = clamp(a * 0.72 + c * 0.42, 0, 1) * 255;
      buf[i * 4 + 1] = clamp(0.30 + b * 0.62 + a * 0.28, 0, 1) * 255;
      buf[i * 4 + 2] = clamp(smoothstep(0.40, 0.80, b * 0.65 + c * 0.45), 0, 1) * 255;
      buf[i * 4 + 3] = 255;
    }
  }
  return dataTex(buf, size, false);
}

/* ── macro variation ───────────────────────────────────────────────────── */

/**
 * One RGBA map tiled at tens of metres, sampled twice at different scales and
 * rotations. It is what stops the 2.5 m detail tile from reading as a grid:
 * every detail property is modulated by it, so the eye finds no repeat.
 *
 *   R  sand-drift coverage
 *   G  broad albedo brightness
 *   B  dried-pan coverage (where mud polygons are allowed)
 *   A  large-scale cavity occlusion
 */
export function makeMacro(size = 512) {
  const N = size * size;
  const buf = new Uint8Array(N * 4);
  const hh = new Float32Array(N);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      const a = pfbm(u * 3, v * 3, 3, 5, 6101);
      const b = pfbm(u * 6, v * 6, 6, 4, 6199);
      const c = pfbm(u * 2, v * 2, 2, 4, 6271);
      hh[i] = a * 0.7 + b * 0.3;
      buf[i * 4] = clamp(smoothstep(0.42, 0.78, a * 0.75 + b * 0.35), 0, 1) * 255;
      buf[i * 4 + 1] = clamp(0.34 + b * 0.55 + c * 0.30, 0, 1) * 255;
      buf[i * 4 + 2] = clamp(smoothstep(0.46, 0.80, c * 0.8 + a * 0.3), 0, 1) * 255;
      buf[i * 4 + 3] = 255;
    }
  }
  const ao = aoFromHeight(hh, size, 3, 14, 2.4);
  for (let i = 0; i < N; i++) buf[i * 4 + 3] = clamp(ao[i] * 0.55 + 0.45, 0, 1) * 255;
  return dataTex(buf, size, false);
}

/* ── dried mud polygons ────────────────────────────────────────────────── */

/**
 * Cracked mud for the ponded pans, in its own map so its scale is independent
 * of the dirt detail and it can be masked to ponded silt only.
 *
 * The important thing about Arizona mud cracks under a low sun is that they are
 * *relief*, not a drawn line: each plate curls upward at its rim as it dries and
 * throws a hard shadow across its neighbour, the crack between them is a real
 * gap, and plate tops go a lighter dusty buff than the crack interiors. So the
 * curl lives in its own channel as a ring just inside each edge, and the crack
 * channel is kept narrow and deep rather than wide and soft. Plate size is
 * modulated within the tile, because real polygon size scales with how thick the
 * mud was and a single Worley frequency reads as wallpaper.
 *
 *   R  crack interior — narrow, deep
 *   G  per-plate brightness
 *   B  plate curl — a raised ring inside each plate edge
 */
export function makeCracks(size = 512) {
  const N = size * size;
  const buf = new Uint8Array(N * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      /* Warped hard in two bands. A Worley net at a single cell size, however
         jittered, still reads as woven fabric; the warp is what makes the
         polygons wander the way shrinkage cracks do. */
      const wob = (pfbm(u * 8, v * 8, 8, 3, 8101) - 0.5) * 0.38
                + (pfbm(u * 3, v * 3, 3, 2, 8103) - 0.5) * 0.55;
      /* three generations, with a low-frequency field choosing between them, so
         polygon scale varies across the pan the way mud thickness does */
      const thick = smoothstep(0.35, 0.70, pfbm(u * 2, v * 2, 2, 3, 8131));
      /* Plate sizes of roughly 30, 16 and 9 cm across a 2.6 m tile. Mud cracks
         scale with the thickness of the layer that dried, and a wash pan is a
         film a centimetre or two thick, not a metre of lakebed clay — the
         half-metre plates this had before are pond-bottom scale. */
      const a = pworley(u * 9 + wob, v * 9 - wob, 9, 8111, 1.0);
      const b = pworley(u * 16 + wob, v * 16 - wob, 16, 8117, 1.0);
      const c = pworley(u * 28 + wob, v * 28 - wob, 28, 8123, 1.0);
      const ea = a.f2 - a.f1, eb = b.f2 - b.f1, ec = c.f2 - c.f1;

      const wa = thick, wb = 1 - Math.abs(thick - 0.5) * 2, wc = 1 - thick;
      const crack = clamp(
        (1 - smoothstep(0.004, 0.024, ea)) * wa +
        (1 - smoothstep(0.004, 0.021, eb)) * wb +
        (1 - smoothstep(0.003, 0.016, ec)) * wc, 0, 1);
      /* a ring just inside the edge, not on it: that offset is the curl */
      const ring = (e, lo, hi) => smoothstep(lo * 0.55, lo, e) * (1 - smoothstep(hi, hi * 2.2, e));
      const curl = clamp(ring(ea, 0.026, 0.066) * wa + ring(eb, 0.022, 0.054) * wb
                       + ring(ec, 0.017, 0.040) * wc, 0, 1);

      buf[i * 4] = crack * 255;
      /* Plate-top tone. Deliberately dominated by the *finest* generation and
         kept narrow: a flat value per coarse cell, at any strength worth
         noticing, tiles the pan into a mosaic of half-metre squares — the
         Voronoi lattice becomes legible as a lattice, which is worse than no
         variation at all. Real plate tops differ, but by a few percent. */
      const dust = pfbm(u * 14, v * 14, 14, 3, 8137);
      buf[i * 4 + 1] = clamp(0.34 + (c.id - 0.5) * 0.30 + (b.id - 0.5) * 0.16
                           + (a.id - 0.5) * 0.05 + (dust - 0.5) * 0.40, 0, 1) * 255;
      buf[i * 4 + 2] = curl * 255;
      buf[i * 4 + 3] = 255;
    }
  }
  return dataTex(buf, size, false);
}
