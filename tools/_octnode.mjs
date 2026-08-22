/* _octnode.mjs — what a phase offset does to the octave coincidence, and what
 * an operation that does not commute with the scaling would do instead.
 *
 *   node tools/_octnode.mjs [gScC]
 *
 * Put A(p) = f(s*p + c1) and B(p) = f(s*p/2 + c2), and substitute q = s*p + c1:
 *
 *     A = f(q),   B = f(q/2 + (c2 - c1/2))
 *
 * so *any* pair of constants leaves B a half-scale copy of A displaced by one
 * constant. A level-accumulating offset changes that constant from 0 to
 * kPhase*(gFlC/2 + 1). It therefore **translates the coincidence, it does not
 * remove it** - the two taps still read the same texel, somewhere else.
 *
 * A rotation applied per level does not commute with the scaling and so breaks
 * the relationship rather than its phase, while keeping the continuity identity
 * for the same reason the offset does: the coarse tap at level n is transformed
 * by R^(n+1), which is exactly what the fine tap at level n+1 is transformed by.
 *
 * This measures the local correlation of the two taps in a window swept across
 * one lattice cell, which is where a global coefficient (0.008) sees nothing.
 */
import { makeGrit } from '../src/textures.js';

const SC = Number(process.argv[2] ?? 4);
const S = 256;
const D = makeGrit(S).image.data;
function samp(u, v) {
  let x = (u * S) % S, y = (v * S) % S;
  if (x < 0) x += S; if (y < 0) y += S;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % S, y1 = (y0 + 1) % S;
  const g = (xx, yy) => D[(yy * S + xx) * 4] / 255;
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x1, y0) * fx * (1 - fy)
       + g(x0, y1) * (1 - fx) * fy + g(x1, y1) * fx * fy;
}

const FL = -Math.log2(SC);
const PERIOD = 2 / SC;

/* variant: 0 shipped, 1 level-accumulating translation, 2 level-accumulating
   90-degree rotation. All three are seamless across a level boundary. */
function taps(px, py, variant, kPhase) {
  const rot = (u, v, n) => {
    const t = ((n % 2) + 2) % 2;              // 90 deg per level, 2-cycle
    return t === 0 ? [u, v] : [-v, u];
  };
  if (variant === 0) {
    return [samp(px * SC, py * SC), samp(px * SC * 0.5, py * SC * 0.5)];
  }
  if (variant === 1) {
    const c1 = kPhase * FL, c2 = kPhase * (FL + 1);
    return [samp(px * SC + c1, py * SC + c1), samp(px * SC * 0.5 + c2, py * SC * 0.5 + c2)];
  }
  const a = rot(px * SC, py * SC, FL);
  const b = rot(px * SC * 0.5, py * SC * 0.5, FL + 1);
  return [samp(a[0], a[1]), samp(b[0], b[1])];
}

/* Local correlation in a window one texel of the *fine* tap across, swept over
   one lattice cell. At a true coincidence the window sees A == B and returns 1. */
const TEXEL_WORLD = 1 / (S * SC);
function sweep(variant, kPhase) {
  const STEPS = 400, W = 9;
  let best = -2, bestAt = 0;
  for (let sIdx = 0; sIdx < STEPS; sIdx++) {
    const cx = (sIdx / STEPS) * PERIOD, cy = cx;      // along the cell diagonal
    const A = [], B = [];
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const px = cx + (i - (W - 1) / 2) * TEXEL_WORLD * 0.5;
      const py = cy + (j - (W - 1) / 2) * TEXEL_WORLD * 0.5;
      const [a, b] = taps(px, py, variant, kPhase);
      A.push(a); B.push(b);
    }
    let ma = 0, mb = 0;
    for (let i = 0; i < A.length; i++) { ma += A[i]; mb += B[i]; }
    ma /= A.length; mb /= B.length;
    let sa = 0, sb = 0, sc = 0;
    for (let i = 0; i < A.length; i++) {
      const da = A[i] - ma, db = B[i] - mb;
      sa += da * da; sb += db * db; sc += da * db;
    }
    const r = sc / Math.max(1e-12, Math.sqrt(sa * sb));
    if (r > best) { best = r; bestAt = cx; }
  }
  return { best, bestAt };
}

console.log(`gScC=${SC}; lattice period 2/gScC = ${PERIOD.toFixed(3)} m, ` +
  `fine-tap texel = ${(1000 * TEXEL_WORLD).toFixed(2)} mm`);
console.log('peak local correlation of the two taps, swept along one cell diagonal\n');
console.log('  variant                              peak r    at (m)');
const v0 = sweep(0, 0);
console.log(`  as shipped                           ${v0.best.toFixed(3).padStart(6)}    ${v0.bestAt.toFixed(4)}`);
const v1 = sweep(1, 0.6180340);
console.log(`  translation, kPhase 0.618034         ${v1.best.toFixed(3).padStart(6)}    ${v1.bestAt.toFixed(4)}`);
const v2 = sweep(2, 0);
console.log(`  rotation, 90 deg per level           ${v2.best.toFixed(3).padStart(6)}    ${v2.bestAt.toFixed(4)}`);
console.log('\na peak near 1.0 is the two octaves reading the same texels.');
console.log('translation should move it; rotation should remove it.');
