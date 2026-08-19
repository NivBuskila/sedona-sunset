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
  C(152, 128, 108),   // buff sandstone
  C(190, 180, 166),   // off-white Coconino
  C(120, 115, 110),   // grey siltstone
  C(76, 68, 63),      // desert-varnished dark
  C(196, 188, 178),   // quartz
  C(172, 158, 137),   // cream limestone
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

export function makeDirt(size = 1024) {
  const N = size * size;
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
      let hh = broad * 0.13 + fines * 0.055;
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
        const top = G.hMax * Math.pow(1 - q * q, 0.36);
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
       relief, which puts the strength near 10. */
    normal: dataTex(normalFromHeight(h, size, size * 0.0102), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── wind-drifted sand: the finer, pinker material ─────────────────────── */

/* Drifted sand is the palest and least saturated material in the scene: it is
   sorted quartz with the oxide fines blown out of it. */
const SAND_LOW = C(130, 87, 62);
const SAND_MID = C(162, 118, 88);
const SAND_TOP = C(186, 145, 114);

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
      const rip = 0.5 + 0.5 * Math.sin((v * 9 + warp * 2.2 + warp2 * 0.7 + u * 1.0) * Math.PI * 2);
      const cover = smoothstep(0.34, 0.62, pfbm(u * 5, v * 5, 5, 3, 23));
      const ripple = Math.pow(rip, 1.5) * 0.62 * cover;
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

/* Nearly uniform. Bedding is now carried by elevation in the terrain shader,
   where the colour band and the geometric ledge are the same feature; a second
   independent set of stripes inside the tile cuts across those at a different
   angle and the wall reads as cross-hatching. What is left here is only the
   shade-to-shade variation within a single bed. */
/* Salmon-terracotta with a grey-brown cast from varnish and dust, at about a
   third saturation. Measured against photographs, real Sedona rock sits near
   0.33 mean even under a warm low sun; the 0.54 these carried before renders,
   once multiplied by a warm key, at roughly double reality. */
const ROCK_BANDS = [
  C(150, 114, 101), C(157, 121, 107), C(143, 108, 95),
  C(161, 126, 112), C(152, 116, 102), C(146, 110, 97),
];

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

      /* bedding: near-horizontal strata, warped so they are not ruler lines,
         plus the cross-bedded sweeps that make Coconino/Schnebly sandstone
         recognisable rather than generic striped rock */
      const warp = (pfbm(u * 2, v * 2, 2, 4, 41) - 0.5) * 0.9
                 + (pfbm(u * 7, v * 7, 7, 3, 43) - 0.5) * 0.22;
      const bandF = (v + warp * 0.26) * 6.0;
      const bi = Math.floor(bandF);
      const bt = bandF - bi;
      const c0 = ROCK_BANDS[((bi % 6) + 6) % 6];
      const c1 = ROCK_BANDS[(((bi + 1) % 6) + 6) % 6];
      /* Beds meet at contacts rather than gradients, but not at knife edges —
         a hard step repeats too legibly once the tile is seen twice. */
      let col = mixC(c0, c1, smoothstep(0.68, 1.0, bt));

      const cross = pfbm(u * 9 + v * 2, v * 26, 9, 3, 613);
      col = mixC(col, mixC(col, C(204, 190, 174), 0.5), cross * 0.18);

      /* Desert varnish: dark mineral streaks running down the face. Varnish is a
         manganese-iron clay film and it is grey-brown, not red — it is one of the
         main reasons a real butte is less saturated than its own fresh rock. */
      const varn = Math.pow(clamp(pfbm(u * 16, v * 2.5, 16, 4, 733) * 1.5 - 0.42, 0, 1), 1.4);
      col = mixC(col, C(90, 76, 70), varn * 0.34);

      /* Jointing, at 13 cells across a 14 m tile — about one metre. Seven cells
         put two-metre polygons on the map, and a two-metre polygon network
         magnified across a nearby bank face reads unmistakably as cracked
         paint. Kept shallow too: a deep joint catches the grazing sun along its
         lip and the wall reads as scratched rather than as fractured. */
      const jw = pworley(u * 13, v * 13, 13, 1201, 1.0);
      const joint = 1 - smoothstep(0.0, 0.016, jw.f2 - jw.f1);
      const pit = pfbm(u * 70, v * 70, 70, 3, 1451);

      /* Deliberately no joint relief. A Worley net at any single cell size, once
         it is magnified across a face a few metres away, is a legible net —
         cracked-paint wallpaper — and the lips of the grooves catch a low sun
         and outline every cell in bright thread. Jointing at that scale is
         System 2's problem, and it needs to be geometry, not a tiling map. */
      h[i] = (1 - bt) * 0.06 + warp * 0.30 + cross * 0.12 + pit * 0.10
           - smoothstep(0.9, 1.0, bt) * 0.10;

      col = mixC(col, C(124, 78, 58), joint * 0.055);
      const sp = (hash2(x, y, 2207) - 0.5) * 12;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp * 0.95, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.9, 0, 255);
      alb[i * 4 + 3] = 255;

      rough[i] = 0.88 - cross * 0.10 + joint * 0.06 - varn * 0.14;
    }
  }

  const ao = aoFromHeight(h, size, 2, 11, 2.2);
  return {
    albedo: dataTex(alb, size, true),
    /* 14 m tile, ~0.4 m of relief → about 30 */
    normal: dataTex(normalFromHeight(h, size, size * 0.030), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── clast surface, for the instanced gravel, cobbles and blocks ───────── */

/**
 * Deliberately *neutral*. A wash carries grey Fort Apache limestone, off-white
 * Coconino, dark basalt off the Rim and buff chert alongside the local red
 * sandstone, and a single-lithology gravel field is one of the loudest tells
 * there is. So this map carries only luminance structure — mottling, grit,
 * quartz veining — and every scrap of hue comes from the per-instance tint in
 * scatter.js. Mean value is set near 0.42 linear so the tints there can be read
 * as plain multipliers on a target albedo.
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
      h[i] = mot * 0.5 + grit * 0.22 + vein * 0.12;

      let g = 152 + mot * 52 + grit * 16;
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
      rough[i] = 0.88 - grit * 0.05 + mot * 0.06;
    }
  }
  const ao = aoFromHeight(h, size, 2, 8, 2.0);
  return {
    albedo: dataTex(alb, size, true),
    /* One tile spans a whole clast. Pushed harder than the physical relief of a
       water-worn pebble would justify, because it also has to stand in for the
       sub-facet steps on a fractured block — a perfectly flat hull face reads as
       card. */
    normal: dataTex(normalFromHeight(h, size, size * 0.042), size, false),
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
