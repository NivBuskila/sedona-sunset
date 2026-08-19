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

const DIRT_DAMP = C(92, 52, 41);    // shadowed / still-damp, purple-brown
const DIRT_BASE = C(139, 78, 56);   // rust oxide, the dominant colour
const DIRT_DUST = C(172, 115, 89);  // sun-bleached dust film
const DIRT_PALE = C(186, 140, 114); // fine silt on the high spots

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

      /* embedded clasts — small stones half buried in the compacted surface.
         Sparse on purpose: loose stone is instanced geometry, and painting a
         lot of it here as well reads as popcorn at close range. */
      const wp = pworley(u * 34, v * 34, 34, 401, 0.95);
      const rad = 0.13 + wp.id * 0.17;
      const inside = clamp((rad - wp.f1) / rad, 0, 1);
      const clast = Math.sqrt(inside) * (wp.id > 0.66 ? 1 : 0);

      /* hairline fissures. Ridged noise rather than cell edges: real shrinkage
         at this scale wanders, and a Worley net reads as a tiled honeycomb. */
      const crack = Math.pow(clamp(pridged(u * 22, v * 22, 22, 3, 907) - 0.62, 0, 1) * 2.7, 1.6);

      h[i] = broad * 0.55 + grit * 0.18 + grain * 0.050 + clast * 0.26 - crack * 0.10;

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
        col = mixC(col, stone, clamp(clast * 1.35, 0, 1) * 0.34);
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
      const warp = pfbm(u * 3, v * 3, 3, 3, 17) - 0.5;
      const rip = 0.5 + 0.5 * Math.sin((v * 9 + warp * 1.4 + u * 1.0) * Math.PI * 2);
      const ripple = Math.pow(rip, 1.5) * 0.62;
      const drift = pfbm(u * 4, v * 4, 4, 4, 313);
      const grain = pfbm(u * 220, v * 220, 220, 2, 887);

      h[i] = drift * 0.5 + ripple * 0.13 + grain * 0.035;

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

/* Kept deliberately close together: real sandstone beds differ by a shade,
   and a wide palette reads as painted stripes rather than as bedding. */
const ROCK_BANDS = [
  C(160, 100, 70), C(170, 112, 82), C(150, 92, 66),
  C(176, 122, 90), C(182, 138, 106), C(156, 96, 68),
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

      /* Jointing. Kept shallow: at 45 units of normal strength a deep joint
         catches the grazing sun along its lip and the wall reads as scratched
         rather than as fractured. */
      const jw = pworley(u * 7, v * 7, 7, 1201, 1.0);
      const joint = 1 - smoothstep(0.0, 0.022, jw.f2 - jw.f1);
      const pit = pfbm(u * 70, v * 70, 70, 3, 1451);

      h[i] = (1 - bt) * 0.06 + warp * 0.30 + cross * 0.12 + pit * 0.10 - joint * 0.11
           - smoothstep(0.9, 1.0, bt) * 0.10;

      col = mixC(col, C(112, 68, 50), joint * 0.26);
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
    /* 14 m tile, ~0.6 m of relief → about 45 */
    normal: dataTex(normalFromHeight(h, size, size * 0.044), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
}

/* ── clast surface, for the instanced pebbles and cobbles ──────────────── */

export function makePebbleSurface(size = 512) {
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

      /* Kept close to the dirt in value. Clasts in a wash are the same rock as
         the wash floor; brighter stones read as scattered litter. */
      let col = mixC(C(88, 50, 39), C(150, 102, 80), clamp(mot * 1.25, 0, 1));
      col = mixC(col, C(178, 152, 128), Math.pow(clamp(vein - 0.62, 0, 1) * 2.6, 1.5) * 0.55);
      const sp = (hash2(x, y, 4409) - 0.5) * 16;
      alb[i * 4] = clamp(col[0] + sp, 0, 255);
      alb[i * 4 + 1] = clamp(col[1] + sp * 0.95, 0, 255);
      alb[i * 4 + 2] = clamp(col[2] + sp * 0.9, 0, 255);
      alb[i * 4 + 3] = 255;
      rough[i] = 0.80 - grit * 0.10 + mot * 0.08;
    }
  }
  const ao = aoFromHeight(h, size, 2, 8, 2.0);
  return {
    albedo: dataTex(alb, size, true),
    /* one tile spans a whole clast, ~3 mm of relief → about 10 */
    normal: dataTex(normalFromHeight(h, size, size * 0.020), size, false),
    arm: dataTex(packARM(ao, rough, h, size), size, false),
  };
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
 * Cracked mud for the flat pans, kept in its own map so its scale is
 * independent of the dirt detail and it can be masked to flat ground only.
 *   R  crack depth (1 in the crack)
 *   G  per-plate brightness
 *   B  plate curl — mud plates lift at their edges as they dry
 */
export function makeCracks(size = 512) {
  const N = size * size;
  const buf = new Uint8Array(N * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x;
      /* two generations: a coarse polygon net and a finer one inside it */
      const wob = (pfbm(u * 8, v * 8, 8, 3, 8101) - 0.5) * 0.14;
      const a = pworley(u * 9 + wob, v * 9 + wob, 9, 8111, 1.0);
      const b = pworley(u * 21 + wob, v * 21 + wob, 21, 8117, 1.0);
      const ea = a.f2 - a.f1, eb = b.f2 - b.f1;
      const ca = 1 - smoothstep(0.008, 0.075, ea);
      const cb = (1 - smoothstep(0.006, 0.050, eb)) * 0.55;
      const crack = clamp(Math.max(ca, cb), 0, 1);
      const curl = clamp(smoothstep(0.30, 0.06, ea), 0, 1);
      buf[i * 4] = crack * 255;
      buf[i * 4 + 1] = clamp(0.35 + a.id * 0.5 + b.id * 0.15, 0, 1) * 255;
      buf[i * 4 + 2] = curl * 255;
      buf[i * 4 + 3] = 255;
    }
  }
  return dataTex(buf, size, false);
}
