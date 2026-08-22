/* _octphase.mjs — is the two-octave crossfade in registration with itself?
 *
 *   node tools/_octphase.mjs [kPhase] [gScC] [frac]
 *
 * The clast, wall and ground shaders all read the grit map as
 *
 *     mix(texture(uGrit, uv * s), texture(uGrit, uv * s * 0.5), frac)
 *
 * Both taps are the same map at the same uv, one at exactly twice the other's
 * scale, so the coarse tap is the fine tap magnified by two in fixed phase.
 * Wherever `uv * s` is congruent to zero modulo two the two taps sample the
 * identical texel and the mix is a no-op; halfway between they are uncorrelated
 * and the mix averages them toward the mean. That is a regular lattice of
 * high-contrast nodes separated by washed-out ones, which is a quilt.
 *
 * This measures it rather than asserting it. It builds the mixed field over a
 * world patch at a realistic footprint, then reports
 *
 *   - the correlation between the two taps, which is the registration itself;
 *   - the axial autocorrelation of the mixed field at non-zero lag, where a
 *     periodic structure shows as a peak and a natural mottle does not;
 *   - the modulation of local contrast, which is the visible symptom.
 *
 * and does it with and without the level-accumulating phase offset, so the fix
 * is judged on the same numbers as the defect.
 *
 * No renderer and no GPU: the sampler is bilinear with wrap, which is what the
 * texture is created with.
 */
import { makeGrit } from '../src/textures.js';

const KP = Number(process.argv[2] ?? 0.6180340);
const SC = Number(process.argv[3] ?? 4);        // gScC; 4 is a near-field clast
const FR = Number(process.argv[4] ?? 0.62);     // gLodC - gFlC

const S = 256;
const tex = makeGrit(S);
const D = tex.image.data;

/* R is the tone channel, which carries the strongest of the three terms the
   clast shader derives from this map: cTone = 1 + (grC.r - 0.427) * 1.30. */
function samp(u, v) {
  let x = (u * S) % S, y = (v * S) % S;
  if (x < 0) x += S; if (y < 0) y += S;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % S, y1 = (y0 + 1) % S;
  const g = (xx, yy) => D[(yy * S + xx) * 4] / 255;
  return g(x0, y0) * (1 - fx) * (1 - fy) + g(x1, y0) * fx * (1 - fy)
       + g(x0, y1) * (1 - fx) * fy + g(x1, y1) * fx * fy;
}

/* gFlC = -log2(SC); the fine tap is level gFlC and the coarse tap level gFlC+1,
   which is what makes the offset accumulate rather than translate. */
const FL = -Math.log2(SC);

/* A patch a metre across at roughly the reported pixel scale. World units. */
const N = 512, EXTENT = 1.0;
function build(kPhase) {
  const A = new Float64Array(N * N), B = new Float64Array(N * N), M = new Float64Array(N * N);
  for (let j = 0; j < N; j++) {
    const wy = (j / N) * EXTENT;
    for (let i = 0; i < N; i++) {
      const wx = (i / N) * EXTENT;
      const a = samp(wx * SC + kPhase * FL, wy * SC + kPhase * FL);
      const b = samp(wx * SC * 0.5 + kPhase * (FL + 1), wy * SC * 0.5 + kPhase * (FL + 1));
      const k = j * N + i;
      A[k] = a; B[k] = b; M[k] = (1 - FR) * a + FR * b;
    }
  }
  return { A, B, M };
}

const corr = (P, Q) => {
  let mp = 0, mq = 0;
  for (let i = 0; i < P.length; i++) { mp += P[i]; mq += Q[i]; }
  mp /= P.length; mq /= Q.length;
  let sp = 0, sq = 0, sc = 0;
  for (let i = 0; i < P.length; i++) {
    const dp = P[i] - mp, dq = Q[i] - mq;
    sp += dp * dp; sq += dq * dq; sc += dp * dq;
  }
  return sc / Math.sqrt(sp * sq);
};

/* Autocorrelation along x, at lags out to a third of the patch. A quilt is a
   periodic structure and shows as a peak at non-zero lag; a mottle decays. */
function axialAC(F, maxLag) {
  let m = 0; for (let i = 0; i < F.length; i++) m += F[i]; m /= F.length;
  const out = [];
  for (let L = 1; L <= maxLag; L++) {
    let s = 0, n = 0, v = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i + L < N; i++) {
        const a = F[j * N + i] - m, b = F[j * N + i + L] - m;
        s += a * b; v += a * a; n++;
      }
    }
    out.push(s / v);
  }
  return out;
}

/* Local contrast on a coarse grid: the visible symptom is that contrast is
   modulated on a lattice, bright-and-crisp at the coincidence nodes and washed
   between them. A quilt is a *variation in contrast*, not in mean. */
function contrastModulation(F) {
  const T = 16, G = N / T, cs = [];
  for (let bj = 0; bj < G; bj++) for (let bi = 0; bi < G; bi++) {
    let m = 0, n = 0;
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) { m += F[(bj * T + j) * N + bi * T + i]; n++; }
    m /= n;
    let v = 0;
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) { const d = F[(bj * T + j) * N + bi * T + i] - m; v += d * d; }
    cs.push(Math.sqrt(v / n));
  }
  let mm = 0; for (const c of cs) mm += c; mm /= cs.length;
  let vv = 0; for (const c of cs) vv += (c - mm) * (c - mm);
  return Math.sqrt(vv / cs.length) / mm;      // coefficient of variation of contrast
}

console.log(`grit tone channel, gScC=${SC} (tile ${(1 / SC).toFixed(3)} m), frac=${FR}`);
console.log(`coincidence lattice predicted at world period 2/gScC = ${(2 / SC).toFixed(3)} m\n`);
console.log('                        tapA:tapB corr   contrast CoV   max |AC| at lag>=8');
for (const [label, kp] of [['as shipped (kPhase 0)', 0], [`with kPhase ${KP}`, KP]]) {
  const { A, B, M } = build(kp);
  const ac = axialAC(M, Math.floor(N / 3));
  let mx = 0, at = 0;
  for (let i = 7; i < ac.length; i++) if (Math.abs(ac[i]) > mx) { mx = Math.abs(ac[i]); at = i + 1; }
  console.log(`${label.padEnd(26)} ${corr(A, B).toFixed(4).padStart(7)}         ` +
    `${contrastModulation(M).toFixed(4)}        ${mx.toFixed(4)} @ ${at} px ` +
    `(${(1000 * at / N * EXTENT).toFixed(1)} mm)`);
}
