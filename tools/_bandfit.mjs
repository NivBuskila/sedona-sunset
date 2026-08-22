/* The horizon band's cosine-weighted irradiance, as a function of the normal, fitted.
 *
 *   node tools/_bandfit.mjs
 *
 * An order-2 SH probe cannot hold a thin band. Measured in tools/_clastbounce.mjs: the
 * exact integral says a near-vertical facet's ground term should rise x5.6 when the
 * sunlit zone beyond the shadow line is admitted, and routing that through the probe
 * delivers x2.06 - the projection loses 63% of it, and loses it in the worst possible
 * way, by smearing energy that belongs on near-horizontal normals across every downward
 * normal including undersides that should not receive any.
 *
 * So deliver the band outside the SH path. The band is an annulus about the vertical
 * axis - depression 0 to the sun's elevation, softened a few degrees - so its irradiance
 * on a unit normal depends **only on the normal's y component**, by symmetry. That makes
 * it a one-dimensional function, which can be integrated exactly here and baked into the
 * shader as a fit. No probe, no ringing, and the normal dependence is the real one.
 *
 * What the shape has to satisfy, as a check on the fit rather than a hope:
 *   F(+1) = 0   an up normal sees nothing below the horizon
 *   F(-1) small a normal looking straight down sees the band edge-on
 *   peak just below the horizon, where a vertical facet's cosine weight and the band's
 *               own solid angle both sit
 */
const DEG = Math.PI / 180;
const SUN_EL = 15 * DEG, SOFT = 4 * DEG;

/* Fraction of the floor that is sunlit as a function of depression: the open wash beyond
   the shadow line, the self-shadowed near floor inside it. Returned as the *excess* over
   the near floor, since that is what the analytic term adds on top of the uniform probe. */
const excess = (dep) => {
  const t = Math.max(0, Math.min(1, (dep - (SUN_EL - SOFT)) / (2 * SOFT)));
  return 1 - t * t * (3 - 2 * t);
};

/* F(ny) = integral over the lower hemisphere of excess(dep) * max(0, n.d) dOmega.
   Exact in the azimuth, which is analytic: for a normal (sx, ny, 0) and a direction at
   polar angle th, the azimuthal integral of max(0, n.d) is a closed form, but the
   numerical version is clearer and this runs once. */
function F(ny) {
  const sx = Math.sqrt(Math.max(0, 1 - ny * ny));
  const NT = 4000, NP = 1440;
  let E = 0;
  for (let i = 0; i < NT; i++) {
    const th = (i + 0.5) / NT * Math.PI;
    const st = Math.sin(th), ct = Math.cos(th);
    if (ct >= 0) continue;
    const w = excess(Math.asin(Math.min(1, -ct)));
    if (w <= 0) continue;
    let a = 0;
    for (let j = 0; j < NP; j++) {
      const ph = (j + 0.5) / NP * 2 * Math.PI;
      const c = sx * st * Math.cos(ph) + ny * ct;
      if (c > 0) a += c;
    }
    E += w * a * (2 * Math.PI / NP) * st * (Math.PI / NT);
  }
  return E;
}

const xs = [], ys = [];
for (let i = 0; i <= 40; i++) { const ny = -1 + 2 * i / 40; xs.push(ny); ys.push(F(ny)); }

console.log('\n  F(ny) - the band\'s cosine-weighted irradiance per unit excess radiance');
console.log('     ny      F        ny      F        ny      F');
for (let i = 0; i < xs.length; i += 3) {
  let line = '  ';
  for (let k = 0; k < 3 && i + k < xs.length; k++) {
    line += `${xs[i + k].toFixed(2).padStart(7)}  ${ys[i + k].toFixed(5)}   `;
  }
  console.log(line);
}
const peak = ys.indexOf(Math.max(...ys));
console.log(`\n  F(+1) = ${F(1).toExponential(2)}   F(-1) = ${F(-1).toFixed(5)}` +
  `   peak ${ys[peak].toFixed(5)} at ny = ${xs[peak].toFixed(2)}`);

/* Least-squares polynomial in ny, constrained hard to zero at ny = +1 by fitting
   (1 - ny) * poly(ny) instead of poly alone. An up-facing normal receiving band light
   would be a spurious lift on every lit floor pixel in the scene, which is the one thing
   this term must not do - so make it structurally impossible rather than approximately
   true. */
const DEGP = 6;
const basis = (ny) => {
  const b = [];
  for (let k = 0; k <= DEGP; k++) b.push((1 - ny) * Math.pow(ny, k));
  return b;
};
const M = DEGP + 1;
const AtA = Array.from({ length: M }, () => new Float64Array(M));
const Atb = new Float64Array(M);
for (let i = 0; i < xs.length; i++) {
  const b = basis(xs[i]);
  for (let r = 0; r < M; r++) {
    Atb[r] += b[r] * ys[i];
    for (let c = 0; c < M; c++) AtA[r][c] += b[r] * b[c];
  }
}
/* Gauss-Jordan; M is 5. */
for (let c = 0; c < M; c++) {
  let p = c;
  for (let r = c + 1; r < M; r++) if (Math.abs(AtA[r][c]) > Math.abs(AtA[p][c])) p = r;
  [AtA[c], AtA[p]] = [AtA[p], AtA[c]];
  [Atb[c], Atb[p]] = [Atb[p], Atb[c]];
  const d = AtA[c][c];
  for (let k = 0; k < M; k++) AtA[c][k] /= d;
  Atb[c] /= d;
  for (let r = 0; r < M; r++) {
    if (r === c) continue;
    const f = AtA[r][c];
    for (let k = 0; k < M; k++) AtA[r][k] -= f * AtA[c][k];
    Atb[r] -= f * Atb[c];
  }
}
const co = Array.from(Atb);
const fit = (ny) => { const b = basis(ny); return b.reduce((s, v, k) => s + v * co[k], 0); };

let worst = 0, worstAt = 0;
for (let i = 0; i < xs.length; i++) {
  const e = Math.abs(fit(xs[i]) - ys[i]);
  if (e > worst) { worst = e; worstAt = xs[i]; }
}
console.log(`\n  degree-${DEGP} fit of (1 - ny) * poly(ny), worst residual ` +
  `${worst.toExponential(2)} (${(100 * worst / Math.max(...ys)).toFixed(2)}% of peak) at ny = ${worstAt.toFixed(2)}`);
console.log(`  fit(+1) = ${fit(1).toExponential(2)}  (structurally zero)`);
console.log('\n  GLSL, ready to paste:');
{
  let horner = co[co.length - 1].toFixed(6);
  for (let k = co.length - 2; k >= 0; k--) horner = `${co[k].toFixed(6)} + ny * ( ${horner} )`;
  console.log(`    float s4BandF( float ny ) {`);
  console.log(`      return ( 1.0 - ny ) * ( ${horner} );`);
  console.log(`    }`);
}
console.log(`\n  clamp the result at zero in the shader: a degree-4 fit can dip slightly`);
console.log('  negative outside the sampled range and irradiance cannot.\n');
