/* Deterministic noise primitives.
 *
 * Everything in this project is generated at load time, so every random source
 * has to be seeded and reproducible: the same build must produce the same
 * terrain, the same pebble field and the same texels on every run, otherwise
 * two captures of the same viewpoint are not comparable.
 *
 * Two families live here:
 *   · gradient noise (`gnoise`, `fbm`, `ridged`) for terrain shape — gradient
 *     noise has the directional structure landforms need,
 *   · periodic value noise (`pnoise`, `pfbm`) for textures — the period lets a
 *     texture tile seamlessly, which value noise makes trivial and gradient
 *     noise does not.
 */

/* ── integer hashing ───────────────────────────────────────────────────── */

export function hash2(x, y, s) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

export function hash1(x, s) { return hash2(x, 0x9e37, s); }

/** xorshift PRNG — a stream, for scatter placement where order is stable. */
export function rng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) / 4294967296);
  };
}

const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/* ── gradient noise (unbounded domain, terrain) ────────────────────────── */

function grad(ix, iy, s, dx, dy) {
  const a = hash2(ix, iy, s) * 6.2831853;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

/** 2D gradient noise, roughly [-1, 1]. */
export function gnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const n00 = grad(ix, iy, s, fx, fy);
  const n10 = grad(ix + 1, iy, s, fx - 1, fy);
  const n01 = grad(ix, iy + 1, s, fx, fy - 1);
  const n11 = grad(ix + 1, iy + 1, s, fx - 1, fy - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4;
}

/** Fractal sum of gradient noise, roughly [-1, 1]. */
export function fbm(x, y, oct = 4, s = 0, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * gnoise(x * f, y * f, s + i * 131);
    norm += a;
    a *= gain; f *= lac;
  }
  return sum / norm;
}

/** Ridged multifractal — sharp crests, for channel incision and rock spines. */
export function ridged(x, y, oct = 4, s = 0, lac = 2.07, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(gnoise(x * f, y * f, s + i * 977));
    sum += a * n * n;
    norm += a;
    a *= gain; f *= lac;
  }
  return sum / norm;
}

/* ── periodic value noise (tiling textures) ────────────────────────────── */

const wrap = (a, p) => ((a % p) + p) % p;

/** Value noise on a lattice that repeats every (px, py) cells. */
export function pnoise(x, y, px, py, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const u = fade(x - ix), v = fade(y - iy);
  const x0 = wrap(ix, px), x1 = wrap(ix + 1, px);
  const y0 = wrap(iy, py), y1 = wrap(iy + 1, py);
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s);
  const c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Tiling fractal value noise in [0, 1]. `p` is the period in cells at octave 0. */
export function pfbm(x, y, p, oct = 5, s = 0, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * pnoise(x * f, y * f, p * f, p * f, s + i * 613);
    norm += a;
    a *= gain; f *= 2;
  }
  return sum / norm;
}

/** Tiling ridged value noise in [0, 1] — cracks, veins, ripple crests. */
export function pridged(x, y, p, oct = 4, s = 0) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(pnoise(x * f, y * f, p * f, p * f, s + i * 271) * 2 - 1);
    sum += a * n;
    norm += a;
    a *= 0.5; f *= 2;
  }
  return sum / norm;
}

/**
 * Tiling Worley (cellular) noise.
 * Returns { f1, f2, id } — f1/f2 in cell units, id a stable per-cell random.
 * The f2 - f1 difference is the edge distance, which is what makes dried-mud
 * polygons and pebble packing read correctly.
 */
export function pworley(x, y, p, s = 0, jitter = 1.0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = wrap(cx, p), wy = wrap(cy, p);
      const px = cx + 0.5 + (hash2(wx, wy, s) - 0.5) * jitter;
      const py = cy + 0.5 + (hash2(wx, wy, s + 7717) - 0.5) * jitter;
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, s + 31337); }
      else if (d < f2) { f2 = d; }
    }
  }
  return { f1, f2, id };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;
