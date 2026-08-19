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
import { pfbm, pridged, pworley, hash2, clamp, smoothstep, mix } from './noise.js';

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

const DIRT_DAMP = C(102, 62, 54);   // shadowed / still-damp, purple-brown
const DIRT_BASE = C(154, 92, 68);   // rust oxide, the dominant colour
const DIRT_DUST = C(186, 130, 102); // sun-bleached dust film
const DIRT_PALE = C(200, 156, 130); // fine silt on the high spots

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

      /* three bands of relief: broad hummocks, a grit layer, and the
         individual grains that only matter within about a metre */
      const broad = pfbm(u * 5, v * 5, 5, 4, 11);
      const grit = pfbm(u * 46, v * 46, 46, 3, 71);
      const grain = pfbm(u * 190, v * 190, 190, 2, 233);

      /* Embedded clasts — small stones set into the compacted surface. Very
         faint on purpose. Loose stone is instanced geometry now, and a Worley
         field of identical hemispherical bumps painted here as well is exactly
         the popcorn-ceiling read: same size, same value, same spacing, and a
         displacement of the surface rather than an object resting on it. */
      const wp = pworley(u * 34, v * 34, 34, 401, 0.95);
      const rad = 0.13 + wp.id * 0.17;
      const inside = clamp((rad - wp.f1) / rad, 0, 1);
      const clast = Math.sqrt(inside) * (wp.id > 0.78 ? 1 : 0);

      /* hairline fissures. Ridged noise rather than cell edges: real shrinkage
         at this scale wanders, and a Worley net reads as a tiled honeycomb. */
      const crack = Math.pow(clamp(pridged(u * 22, v * 22, 22, 3, 907) - 0.62, 0, 1) * 2.7, 1.6);

      h[i] = broad * 0.55 + grit * 0.18 + grain * 0.050 + clast * 0.09 - crack * 0.10;

      /* colour: dust film on the highs, damp oxide in the lows, clasts
         pulled toward a cooler grey-red so they separate from the matrix */
      /* Value variation belongs at the scale of patches of ground, not at the
         scale of grains, so `broad` carries almost all of it. */
      const dry = clamp(broad * 1.05 + grit * 0.12 - 0.14, 0, 1);
      let col = mixC(DIRT_DAMP, DIRT_BASE, smoothstep(0.0, 0.45, dry));
      col = mixC(col, DIRT_DUST, smoothstep(0.42, 0.86, dry));
      col = mixC(col, DIRT_PALE, smoothstep(0.74, 1.0, dry) * 0.6);
      if (clast > 0.01) {
        const stone = mixC(C(122, 84, 66), C(158, 122, 100), wp.id);
        col = mixC(col, stone, clamp(clast * 1.35, 0, 1) * 0.20);
      }
      col = mixC(col, DIRT_DAMP, crack * 0.18);
      /* per-texel speckle keeps mip level 0 from looking airbrushed */
      const sp = (hash2(x, y, 5501) - 0.5) * 13;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp * 0.92, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.85, 0, 255);
      alb[i * 4 + 3] = 255;

      /* polished clast tops are the only thing here that is not matte */
      rough[i] = 0.94 - clast * 0.30 - grain * 0.05 + crack * 0.04;
    }
  }

  const ao = aoFromHeight(h, size, 2, 9, 2.6);
  return {
    albedo: dataTex(alb, size, true),
    /* 2.6 m tile, ~30 mm of relief → about 12 */
    normal: dataTex(normalFromHeight(h, size, size * 0.0118), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── wind-drifted sand: the finer, pinker material ─────────────────────── */

const SAND_LOW = C(150, 105, 88);
const SAND_MID = C(190, 145, 121);
const SAND_TOP = C(216, 178, 152);

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
      const drift = pfbm(u * 4, v * 4, 4, 4, 313);
      const grain = pfbm(u * 220, v * 220, 220, 2, 887);

      h[i] = drift * 0.5 + ripple * 0.075 + grain * 0.035;

      const bright = clamp(ripple * 0.6 + drift * 0.55 - 0.1, 0, 1);
      let col = mixC(SAND_LOW, SAND_MID, smoothstep(0.0, 0.55, bright));
      col = mixC(col, SAND_TOP, smoothstep(0.5, 1.0, bright));
      const sp = (hash2(x, y, 991) - 0.5) * 15;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.9, 0, 255);
      alb[i * 4 + 3] = 255;

      rough[i] = 0.97 - grain * 0.06;
    }
  }

  const ao = aoFromHeight(h, size, 2, 7, 1.9);
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
const ROCK_BANDS = [
  C(164, 106, 76), C(170, 114, 84), C(158, 100, 72),
  C(172, 118, 88), C(166, 110, 80), C(160, 102, 74),
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
      col = mixC(col, mixC(col, C(200, 168, 138), 0.5), cross * 0.18);

      /* desert varnish: dark mineral streaks running down the face */
      const varn = Math.pow(clamp(pfbm(u * 16, v * 2.5, 16, 4, 733) * 1.5 - 0.42, 0, 1), 1.4);
      col = mixC(col, C(84, 52, 41), varn * 0.26);

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
      rough[i] = 0.80 - grit * 0.10 + mot * 0.08;
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
