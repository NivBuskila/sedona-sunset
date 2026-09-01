/* Textures for the donkey. Same rule as every other map in this project:
 * nothing is loaded, every texel is written at boot.
 *
 * Four maps, and each is authored the way textures.js authors dirt — a tileable
 * height field first, then albedo and a normal map both derived from it. On an
 * animal the height field is *hair*, and hair has a direction: a coat lies along
 * the body, so the noise that makes it is stretched along one axis rather than
 * isotropic. That anisotropy is the whole difference between a coat and a
 * stucco wall, and it is why these do not just use pfbm straight.
 *
 * The barrel gets its own map rather than sharing the generic hide, because a
 * donkey's markings are not decoration — they are the species. The dark dorsal
 * stripe down the spine and the transverse stripe over the withers form the
 * "donkey cross", and the pale belly, pale muzzle and pale eye rings are the
 * other half of the dun pattern. An unmarked grey quadruped reads as a small
 * horse; these markings are what make it read as a donkey at fifty pixels.
 * They are placed in UV rather than in geometry because they genuinely *are*
 * colour, which is the one case in this project where painting is the honest
 * answer. character.js's sweep puts u = 0.25 on the spine and u = 0.75 on the
 * belly, and v along the body from chest to tail, so both stripes are simple
 * bands in that frame.
 */
import * as THREE from 'three';
import { pnoise, clamp, smoothstep, mix } from './noise.js';

let maxAniso = 8;
export function setDonkeyAnisotropy(n) { maxAniso = n; }

const _cache = new Map();
const memo = (k, f) => { if (!_cache.has(k)) _cache.set(k, f()); return _cache.get(k); };

/* ── shared plumbing ───────────────────────────────────────────────────── */

function dataTex(buf, w, h, srgb, repeat) {
  const t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

/** Tileable normal map from a height field, central differences. */
function normalFromHeight(h, w, k) {
  const out = new Uint8Array(w * w * 4);
  const at = (x, y) => h[((y + w) % w) * w + ((x + w) % w)];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

function albedo(w, cb) {
  const out = new Uint8Array(w * w * 4);
  const c = [0, 0, 0];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      cb(x, y, c);
      const i = (y * w + x) * 4;
      out[i] = Math.round(clamp(c[0], 0, 1) * 255);
      out[i + 1] = Math.round(clamp(c[1], 0, 1) * 255);
      out[i + 2] = Math.round(clamp(c[2], 0, 1) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Anisotropic fbm — separate periods per axis, so hair can be a hundred times
    longer than it is wide. Same trick plantex.js uses for bark fibre. */
function afbm(x, y, px, py, oct, s, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * pnoise(x * f, y * f, Math.max(1, px * f), Math.max(1, py * f), s + i * 613);
    norm += a; a *= gain; f *= 2;
  }
  return sum / norm;
}

/* ── the coat ─────────────────────────────────────────────────────────────
 *
 * `lay` is the direction the hair lies, in texels: 14:1 here, which is a short
 * summer coat. The height field is that stretched noise plus a much broader,
 * rounder term for the way a coat clumps — a donkey out in a wash is dusty and
 * its coat is never smooth. The albedo takes the same two terms plus a third,
 * decorrelated one for the mottling that dun colouring always has.
 */
function coatHeight(size, seed) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hair = afbm(x * 0.85, y * 0.06, size * 0.85, size * 0.06, 3, seed) * 0.5 + 0.5;
      const clump = afbm(x * 0.09, y * 0.07, size * 0.09, size * 0.07, 3, seed + 71) * 0.5 + 0.5;
      h[y * size + x] = hair * 0.62 + clump * 0.38;
    }
  }
  return h;
}

/* The dun palette. Chosen against the scene, as chartex's shirt was and for the
   same reason: the wash is red rock and warm dust under a low sun with EXPOSURE
   at 0.95, so a warm-brown animal sinks into it. A grey dun donkey — genuinely
   the commonest colour — is the one cool, desaturated mass in the frame, which
   is exactly what makes it legible against sandstone. */
/* Reflectances. These have now been wrong in both directions, so the reasoning is
   worth keeping rather than the number alone.
   0.37 was the first pass and tone mapped to nearly white under this scene's
   direct sun — a plaster donkey. 0.255 was the correction, taken from the low end
   of a grey dun's real 0.20-0.32 range, and it overshot: with the sun at 15° in
   FRONT of the animal the follow camera sees mostly its shaded side, and at 0.255
   that side fell to a luminance of 20-37 against 147 for sunlit ground, which
   reads as a silhouette rather than an animal.
   0.315 is the light end of the same real range, which is the honest place to sit
   for an animal that is backlit for most of the traverse. */
const DUN = [0.420, 0.130, 0.095];    // body red, kept near the same overall reflectance
const DARK = [0.108, 0.096, 0.092];   // stripes, mane, tail tuft, lower legs
const PALE = [0.620, 0.590, 0.545];   // muzzle, belly, eye rings

function coatAlbedo(size, h, base, seed, marks) {
  return albedo(size, (x, y, c) => {
    const hv = h[y * size + x];
    const mottle = afbm(x * 0.020, y * 0.016, size * 0.020, size * 0.016, 4, seed + 5) * 0.5 + 0.5;
    const dusty = clamp(afbm(x * 0.045, y * 0.04, size * 0.045, size * 0.04, 3, seed + 909) * 0.5 + 0.5, 0, 1);
    let col = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      col[i] = base[i] * mix(0.86, 1.14, hv) * mix(0.93, 1.07, mottle);
      /* wash dust settles on the coat and lifts it toward the ground colour */
      col[i] = mix(col[i], [0.62, 0.53, 0.43][i], 0.13 * smoothstep(0.5, 1.0, dusty));
    }
    if (marks) marks(x / size, y / size, col, hv);
    c[0] = col[0]; c[1] = col[1]; c[2] = col[2];
  });
}

/* ── the barrel, with the donkey cross ────────────────────────────────────
 *
 * u wraps around the girth (0.25 spine, 0.75 belly), v runs chest → tail.
 * Both stripes get soft edges rather than hard ones, because on a real animal
 * the boundary is a gradient of hair colour a couple of centimetres wide, and a
 * hard edge is the tell that a marking was drawn on rather than grown.
 */
function barrelMarks(u, v, col, hv) {
  /* wrap-aware distance from the spine line at u = 0.25 */
  const du = Math.abs(((u - 0.25 + 1.5) % 1) - 0.5);
  const dorsal = 1 - smoothstep(0.020, 0.062, du);
  /* the transverse bar of the cross, over the withers */
  const cross = (1 - smoothstep(0.030, 0.075, Math.abs(v - 0.235))) *
                (1 - smoothstep(0.16, 0.34, du));      // fades down the flank
  const stripe = clamp(Math.max(dorsal, cross), 0, 1);

  /* pale belly, centred on u = 0.75 and reaching a third of the way up */
  const dbelly = Math.abs(((u - 0.75 + 1.5) % 1) - 0.5);
  const belly = smoothstep(0.30, 0.10, dbelly) *
                smoothstep(0.06, 0.24, v) * smoothstep(0.96, 0.72, v);

  for (let i = 0; i < 3; i++) {
    col[i] = mix(col[i], PALE[i] * mix(0.90, 1.05, hv), belly * 0.85);
    col[i] = mix(col[i], DARK[i] * mix(0.85, 1.15, hv), stripe * 0.92);
  }
}

/* ── hooves ───────────────────────────────────────────────────────────────
 *
 * Horn, not hair, so the height field drops the stretched-hair term for
 * concentric growth rings and vertical splits — the two things that read on a
 * hoof — and the albedo is nearly flat because horn is dark and glossy-dull.
 */
function makeHoof(size) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rings = Math.sin(y * 0.55) * 0.5 + 0.5;             // growth rings
      const split = Math.abs(pnoise(x * 0.30, y * 0.02, size * 0.30, 33));
      const grain = afbm(x * 0.06, y * 0.5, size * 0.06, size * 0.5, 3, 12) * 0.5 + 0.5;
      h[y * size + x] = 0.55 + rings * 0.16 + grain * 0.25 - (1 - smoothstep(0, 0.12, split)) * 0.35;
    }
  }
  const base = [0.176, 0.156, 0.142];
  const amap = albedo(size, (x, y, c) => {
    const hv = h[y * size + x];
    const dustv = clamp(afbm(x * 0.03, y * 0.03, size * 0.03, size * 0.03, 3, 4) * 0.5 + 0.5, 0, 1);
    for (let i = 0; i < 3; i++) {
      c[i] = mix(base[i] * mix(0.70, 1.20, hv), [0.60, 0.52, 0.42][i],
                 0.30 * smoothstep(0.45, 1.0, dustv));
    }
  });
  return { map: dataTex(amap, size, size, true), normalMap: dataTex(normalFromHeight(h, size, 3.0), size, size, false) };
}

/* ── mane and tail tuft ───────────────────────────────────────────────────
 *
 * Coarse hair, so the anisotropy goes the other way and much harder: strands
 * are near-parallel and the height contrast is high, which is what separates a
 * mane from a dark patch of coat.
 */
function makeMane(size) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const strand = afbm(x * 2.2, y * 0.05, size * 2.2, size * 0.05, 3, 88) * 0.5 + 0.5;
      const lock = afbm(x * 0.22, y * 0.05, size * 0.22, size * 0.05, 2, 21) * 0.5 + 0.5;
      h[y * size + x] = strand * 0.55 + lock * 0.45;
    }
  }
  const amap = albedo(size, (x, y, c) => {
    const hv = h[y * size + x];
    /* sun-bleached tips: the proud strands have gone browner than the roots */
    for (let i = 0; i < 3; i++) {
      c[i] = mix(DARK[i] * 0.85, [0.300, 0.244, 0.196][i], smoothstep(0.55, 1.0, hv));
    }
  });
  return { map: dataTex(amap, size, size, true), normalMap: dataTex(normalFromHeight(h, size, 4.0), size, size, false) };
}

/* ── the exported maps ────────────────────────────────────────────────── */

/** Generic dun coat, for the legs, neck and head. */
export const hideTex = () => memo('hide', () => {
  const size = 256, h = coatHeight(size, 3);
  return {
    map: dataTex(coatAlbedo(size, h, DUN, 3, null), size, size, true, [1, 2]),
    normalMap: dataTex(normalFromHeight(h, size, 2.2), size, size, false, [1, 2]),
  };
});

/** The barrel, carrying the dorsal stripe, the shoulder cross and the pale belly. */
export const barrelTex = () => memo('barrel', () => {
  const size = 256, h = coatHeight(size, 17);
  return {
    map: dataTex(coatAlbedo(size, h, DUN, 17, barrelMarks), size, size, true),
    normalMap: dataTex(normalFromHeight(h, size, 2.2), size, size, false),
  };
});

/** Pale dun, for the muzzle and the eye rings. */
export const paleTex = () => memo('pale', () => {
  const size = 128, h = coatHeight(size, 41);
  return {
    map: dataTex(coatAlbedo(size, h, PALE, 41, null), size, size, true),
    normalMap: dataTex(normalFromHeight(h, size, 1.8), size, size, false),
  };
});

/** Dark points, for the lower legs and the ear tips. */
export const darkTex = () => memo('dark', () => {
  const size = 128, h = coatHeight(size, 59);
  return {
    map: dataTex(coatAlbedo(size, h, DARK, 59, null), size, size, true),
    normalMap: dataTex(normalFromHeight(h, size, 2.0), size, size, false),
  };
});

export const hoofTex = () => memo('hoof', () => makeHoof(128));
export const maneTex = () => memo('mane', () => makeMane(128));
