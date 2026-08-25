/* Textures for the walker. Same rule as every other map in this project:
 * nothing is loaded, every texel is written at boot.
 *
 * All five maps are authored the way textures.js authors dirt — a tileable
 * height field first, then albedo and a normal map both derived from it. That
 * ordering is what stops cloth from reading as a coloured plane: the weave has
 * to move the shading, not just the colour, or it vanishes the moment the
 * figure turns out of the sun.
 *
 * The figure is small in frame — it is nine metres from a camera that can see a
 * 7.3 km ridgeline — so these are 128–256 px rather than the 1024 the ground
 * gets. What matters at that size is not weave detail you can resolve but the
 * *break-up*: a garment lit by a low sun needs per-yarn albedo scatter and a
 * normal with real slope in it, otherwise the silhouette is the only thing
 * carrying the figure and it reads as a mannequin.
 */
import * as THREE from 'three';
import { pnoise, pfbm, rng, clamp, smoothstep, mix } from './noise.js';

let maxAniso = 8;
export function setCharAnisotropy(n) { maxAniso = n; }

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

/** Tileable normal map from a height field, central differences. `k` is relief
    strength in height units per texel — the only dial that matters here. */
function normalFromHeight(h, w, size, k) {
  const out = new Uint8Array(w * w * 4);
  const at = (x, y) => h[((y + w) % w) * w + ((x + w) % w)];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k;
      const dy = (at(x, y + 1) - at(x, y - 1)) * k;
      /* normalise (-dx, -dy, 1) */
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

/** Pack an albedo callback into RGBA. cb(x, y) returns [r, g, b] in 0..1. */
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

/* ── woven cloth ───────────────────────────────────────────────────────────
 *
 * A twill, not a plain weave, because that is what a work shirt and a pair of
 * walking trousers actually are and because the diagonal rib is the one weave
 * feature that survives being three pixels wide. `float` is how many texels a
 * yarn spans; the rib runs at 1:1 so it lands on the diagonal.
 *
 * Two scales of colour variation on top of the weave, and both are needed. Per
 * *yarn* variation (quantised to the yarn grid) is what makes cloth look spun
 * rather than printed. Per-*region* fbm at a much longer wavelength is wear and
 * dust — a garment in a desert wash is not uniformly clean, and the fade sits
 * where the sun and the pack straps put it.
 */
function makeCloth(size, base, opts = {}) {
  const yarn = opts.yarn || 4;          // texels per yarn
  const float = opts.float || 2;        // twill float length
  const dust = opts.dust || 0.10;
  const dustCol = opts.dustCol || [0.72, 0.62, 0.48];
  const rnd = rng(opts.seed || 91);

  /* height: the weave. A warp yarn sits proud where it floats over the weft. */
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = Math.floor(x / yarn), wy = Math.floor(y / yarn);
      /* twill: the float pattern shifts by one yarn per weft row */
      const over = ((wx + wy) % (float * 2)) < float;
      /* round the yarn across its own width so it reads as a cylinder, not a
         brick — this is most of what makes the normal map look like cloth */
      const across = ((over ? x : y) % yarn) / yarn;      // 0..1
      const round = Math.sin(across * Math.PI);
      const fuzz = pfbm(x * 0.42, y * 0.42, size * 0.42, 3, 17) * 0.16;
      h[y * size + x] = (over ? 0.62 : 0.30) * round + 0.18 + fuzz;
    }
  }

  const amap = albedo(size, (x, y, c) => {
    const wx = Math.floor(x / yarn), wy = Math.floor(y / yarn);
    const hv = h[y * size + x];
    /* per-yarn tint: one draw per yarn, held across the yarn's whole width */
    const j = (rnd.at ? 0 : 0);
    const yv = (pnoise(wx * 7.31, wy * 7.31, size, 401) * 0.5 + 0.5);
    const tint = mix(0.88, 1.12, yv);
    /* weave shading baked lightly into albedo: the crossings genuinely hold
       more shadow than a normal map alone reproduces at three pixels wide */
    const occ = mix(0.80, 1.06, smoothstep(0.15, 0.85, hv));
    /* wear and dust, long wavelength */
    const w = clamp(pfbm(x * 0.014, y * 0.014, size * 0.014, 4, 77) * 0.5 + 0.5, 0, 1);
    const d = dust * smoothstep(0.35, 0.95, w);
    for (let i = 0; i < 3; i++) {
      c[i] = mix(base[i] * tint * occ, dustCol[i], d);
    }
  });

  return {
    map: dataTex(amap, size, size, true, opts.repeat),
    normalMap: dataTex(normalFromHeight(h, size, size, opts.relief || 2.6), size, size, false, opts.repeat),
  };
}

/* ── skin ─────────────────────────────────────────────────────────────────
 *
 * Weathered forearm-and-face skin, which is the only skin this figure shows.
 * The height field is pore-scale worley-ish speckle at one wavelength and
 * nothing else; the work is in the albedo, where the tell is *mottling* —
 * uneven subsurface redness at a centimetre scale. Flat skin colour is the
 * single most plastic-looking thing you can put on a figure.
 */
function makeSkin(size, base) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] = pfbm(x * 0.9, y * 0.9, size * 0.9, 3, 311) * 0.5 + 0.5;
    }
  }
  const amap = albedo(size, (x, y, c) => {
    /* two mottle bands: broad tan variation, and a redder capillary term that
       is deliberately decorrelated from it */
    const tan = pfbm(x * 0.022, y * 0.022, size * 0.022, 4, 5) * 0.5 + 0.5;
    const red = pfbm(x * 0.055, y * 0.055, size * 0.055, 3, 613) * 0.5 + 0.5;
    const pore = h[y * size + x];
    const lum = mix(0.90, 1.10, tan) * mix(0.96, 1.02, pore);
    c[0] = base[0] * lum + 0.055 * (red - 0.5);
    c[1] = base[1] * lum + 0.012 * (red - 0.5);
    c[2] = base[2] * lum - 0.014 * (red - 0.5);
  });
  return {
    map: dataTex(amap, size, size, true),
    normalMap: dataTex(normalFromHeight(h, size, size, 0.9), size, size, false),
  };
}

/* ── leather ──────────────────────────────────────────────────────────────
 *
 * Boot leather: worley cells for the grain, plus deep creases. The creases are
 * the only part that reads at distance, and they are anisotropic — a boot
 * flexes across the ball of the foot, so the crease field is stretched along x.
 */
function makeLeather(size, base) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = pfbm(x * 0.30, y * 0.30, size * 0.30, 4, 23) * 0.5 + 0.5;
      /* creases: sharp ridged valleys, stretched 3:1 across the flex axis */
      const c1 = Math.abs(pnoise(x * 0.035, y * 0.105, size * 0.105, 71));
      const crease = 1 - smoothstep(0.0, 0.14, c1);
      h[y * size + x] = grain * 0.55 + 0.45 - crease * 0.5;
    }
  }
  const amap = albedo(size, (x, y, c) => {
    const hv = h[y * size + x];
    /* scuffing: where the height is proud, the dye has worn pale */
    const wear = smoothstep(0.62, 0.98, hv);
    const dustv = clamp(pfbm(x * 0.02, y * 0.02, size * 0.02, 3, 909) * 0.5 + 0.5, 0, 1);
    for (let i = 0; i < 3; i++) {
      const pale = [0.52, 0.45, 0.37][i];
      c[i] = mix(base[i] * mix(0.72, 1.0, hv), pale, wear * 0.45);
      c[i] = mix(c[i], 0.66, 0.10 * smoothstep(0.5, 1.0, dustv));  // wash dust
    }
  });
  return {
    map: dataTex(amap, size, size, true),
    normalMap: dataTex(normalFromHeight(h, size, size, 3.4), size, size, false),
  };
}

/* ── felt ─────────────────────────────────────────────────────────────────
 *
 * Hat felt is matted fibre, so it has no weave and no grain direction: the
 * height is isotropic high-frequency fuzz with a faint long-wavelength lump
 * for the way a worn brim loses its shape. Kept very low contrast; felt that
 * shows structure reads as carpet.
 */
function makeFelt(size, base) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fibre = pfbm(x * 1.15, y * 1.15, size * 1.15, 3, 47) * 0.5 + 0.5;
      const lump = pfbm(x * 0.03, y * 0.03, size * 0.03, 2, 811) * 0.5 + 0.5;
      h[y * size + x] = fibre * 0.7 + lump * 0.3;
    }
  }
  const amap = albedo(size, (x, y, c) => {
    const hv = h[y * size + x];
    const sweat = clamp(pfbm(x * 0.018, y * 0.018, size * 0.018, 3, 131) * 0.5 + 0.5, 0, 1);
    for (let i = 0; i < 3; i++) {
      c[i] = base[i] * mix(0.90, 1.08, hv) * mix(1.0, 0.86, smoothstep(0.55, 1.0, sweat));
    }
  });
  return {
    map: dataTex(amap, size, size, true),
    normalMap: dataTex(normalFromHeight(h, size, size, 1.1), size, size, false),
  };
}

/* ── the palette ──────────────────────────────────────────────────────────
 *
 * Chosen against the scene rather than in isolation. The wash is red rock and
 * warm dust under a low sun, and EXPOSURE sits at 0.95 with the ACES toe eating
 * the bottom of the range, so a figure in warm mid-tones disappears into it.
 * The shirt is therefore the one cool, desaturated note in the frame — a faded
 * blue-grey chambray, which is also simply what people wear out here — and it
 * is the thing that makes the figure legible against sandstone. The trousers
 * and hat go warm and dusty so only *one* element competes for attention.
 */
export const shirtTex = () => memo('shirt', () => makeCloth(256, [0.310, 0.372, 0.436], {
  yarn: 4, float: 2, dust: 0.13, seed: 11, relief: 2.4, repeat: [2, 3],
}));
export const trouserTex = () => memo('trouser', () => makeCloth(256, [0.318, 0.278, 0.222], {
  yarn: 5, float: 3, dust: 0.20, seed: 29, relief: 3.0, repeat: [2, 4],
}));
export const skinTex = () => memo('skin', () => makeSkin(128, [0.560, 0.392, 0.296]));
export const leatherTex = () => memo('leather', () => makeLeather(128, [0.208, 0.156, 0.112]));
export const feltTex = () => memo('felt', () => makeFelt(128, [0.436, 0.360, 0.268]));
