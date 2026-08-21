/* Fit and check the height ramp that lerps the floor probe toward the open-sky
 * probe, against the raycast sky-visibility measurements it has to reproduce.
 *
 * The numbers below are tools/skyview.mjs output at d = 46, the standard
 * midground viewpoint: cosine-weighted fraction of the sky hemisphere BLOCKED by
 * geometry, per normal, at six heights above the wash floor. They are the ground
 * truth for this fit and are not to be adjusted to make it look better.
 *
 * The model in src/sky.js is one scalar per fragment, so it cannot follow four
 * normals independently. It blends a lateral ramp and an up ramp on normal.y,
 * which is the cheapest form that respects the thing that actually differs: an
 * up-facing surface is already half-open at the floor and saturates early, a
 * wall face starts nearly shut and opens late.
 *
 *   node tools/probefit.mjs
 */

/* height, then blocked fraction for up / away-from-sun / across / toward-sun */
const M = [
  [0, 0.431, 0.800, 0.785, 0.575],
  [6, 0.376, 0.750, 0.738, 0.548],
  [14, 0.310, 0.675, 0.679, 0.501],
  [26, 0.193, 0.512, 0.544, 0.420],
  [44, 0.048, 0.145, 0.256, 0.255],
  [70, 0.005, 0.000, 0.046, 0.130],
];
/* What the escarpment model in src/atmos.js gives at floor level, measured the
   same way in the same units — this is the aperture the closed probe carries. */
const CLOSED = { up: 0.407, away: 0.818, across: 0.768, toward: 0.524 };
const NY = { up: 1.0, away: 0.0, across: 0.0, toward: 0.0 };
const KEYS = ['up', 'away', 'across', 'toward'];

const vis = (row, k) => 1 - row[1 + KEYS.indexOf(k)];
/* t implied by a measurement, under the linear mixing the lerp performs */
const tOf = (row, k) => {
  const vc = 1 - CLOSED[k];
  return (vis(row, k) - vc) / (1 - vc);
};

/* Least squares over (H, P) for t = clamp(y/H, 0, 1)^P. Coarse grid then
   refine; the surface is smooth and two parameters do not need better. */
function fit(keys) {
  let best = null;
  for (let H = 40; H <= 130; H += 0.5) {
    for (let P = 0.6; P <= 3.0; P += 0.02) {
      let e = 0, n = 0;
      for (const row of M) {
        for (const k of keys) {
          const t = Math.pow(Math.min(1, Math.max(0, row[0] / H)), P);
          const d = t - tOf(row, k);
          e += d * d; n++;
        }
      }
      const rms = Math.sqrt(e / n);
      if (!best || rms < best.rms) best = { H, P, rms };
    }
  }
  return best;
}

/* Fit again with the exponent pinned to something a GPU can do without a pow.
   x^1.5 is x * sqrt(x); x^1.125 is x * sqrt(sqrt(sqrt(x))). If the penalty is
   inside the fit's own residual then the free exponent is not buying anything
   and two transcendentals per lit fragment can go. */
function fitH(keys, P) {
  let best = null;
  for (let H = 40; H <= 130; H += 0.25) {
    let e = 0, n = 0;
    for (const row of M) {
      for (const k of keys) {
        const d = Math.pow(Math.min(1, Math.max(0, row[0] / H)), P) - tOf(row, k);
        e += d * d; n++;
      }
    }
    const rms = Math.sqrt(e / n);
    if (!best || rms < best.rms) best = { H, P, rms };
  }
  return best;
}

const latFree = fit(['away', 'across']);
const upFree = fit(['up']);
const latCheap = fitH(['away', 'across'], 1.5);
const upCheap = fitH(['up'], 1.125);
console.log(`lateral  free P ${latFree.P.toFixed(2)} rms ${latFree.rms.toFixed(3)}` +
  `   |  pinned 1.5   H ${latCheap.H.toFixed(1)} rms ${latCheap.rms.toFixed(3)}`);
console.log(`up       free P ${upFree.P.toFixed(2)} rms ${upFree.rms.toFixed(3)}` +
  `   |  pinned 1.125 H ${upCheap.H.toFixed(1)} rms ${upCheap.rms.toFixed(3)}`);
const CHEAP = process.argv.includes('--free') ? false : true;
const lat = CHEAP ? latCheap : latFree;
const up = CHEAP ? upCheap : upFree;
console.log(`using the ${CHEAP ? 'pow-free' : 'free-exponent'} form\n`);
console.log(`lateral ramp   H ${lat.H.toFixed(1)} m   P ${lat.P.toFixed(2)}   rms(t) ${lat.rms.toFixed(3)}`);
console.log(`up ramp        H ${up.H.toFixed(1)} m   P ${up.P.toFixed(2)}   rms(t) ${up.rms.toFixed(3)}`);

const ramp = (y, f) => Math.pow(Math.min(1, Math.max(0, y / f.H)), f.P);
const tAt = (y, k) => {
  const w = Math.max(0, Math.min(1, NY[k]));
  return ramp(y, lat) * (1 - w) + ramp(y, up) * w;
};

console.log('\nvisibility the lerp delivers against the rays, per normal and height');
console.log('   y   ' + KEYS.map((k) => k.padStart(16)).join(''));
let worst = 0, sum = 0, n = 0;
for (const row of M) {
  const cells = KEYS.map((k) => {
    const vc = 1 - CLOSED[k];
    const got = vc + tAt(row[0], k) * (1 - vc);
    const want = vis(row, k);
    const d = got - want;
    worst = Math.max(worst, Math.abs(d)); sum += d * d; n++;
    return `${got.toFixed(3)}/${want.toFixed(3)}${d >= 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`.padStart(16);
  });
  console.log(`  ${String(row[0]).padStart(3)}  ` + cells.join(''));
}
console.log(`\nrms ${Math.sqrt(sum / n).toFixed(3)}   worst ${worst.toFixed(3)}` +
  `   (the four-normal calibration of the skyline itself was 0.02-0.05)`);
console.log('\nGLSL constants to bake:');
console.log(`  lateral  1.0 / H = ${(1 / lat.H).toFixed(6)}   P = ${lat.P.toFixed(3)}`);
console.log(`  up       1.0 / H = ${(1 / up.H).toFixed(6)}   P = ${up.P.toFixed(3)}`);

/* And the part that a fit cannot catch: whether the folded constants in
   src/sky.js actually reproduce three's own SH evaluation. The lerp is only
   correct if closed + delta lands exactly on the open probe at t = 1, so check
   that identity against three rather than trusting the nine constants. A wrong
   K[k] would show up here and nowhere else until a frame looked subtly flat. */
{
  const THREE = await import('three');
  const { computeAtmosphere } = await import('../src/atmos.js');
  const A = computeAtmosphere();
  const K = [0.886227, 2 * 0.511664, 2 * 0.511664, 2 * 0.511664,
    2 * 0.429043, 2 * 0.429043, 1, 2 * 0.429043, 0.429043];
  const delta = [];
  for (let k = 0; k < 9; k++) {
    const o = A.shOpen.coefficients[k], s = A.sh.coefficients[k];
    delta.push([(o.x - s.x) * K[k], (o.y - s.y) * K[k], (o.z - s.z) * K[k]]);
  }
  /* The same expression the shader evaluates, term for term. */
  const shaderDelta = (n) => {
    const [x, y, z] = n, b = [1, y, z, x, x * y, y * z,
      0.743125 * z * z - 0.247708, x * z, x * x - y * y];
    const out = [0, 0, 0];
    for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) out[c] += delta[k][c] * b[k];
    return out;
  };
  const irr = (sh, n) => {
    const v = sh.getIrradianceAt(new THREE.Vector3(n[0], n[1], n[2]), new THREE.Vector3());
    return [v.x, v.y, v.z];
  };
  const s = { x: -0.154, z: -0.970 };
  const l = Math.hypot(s.x, s.z); s.x /= l; s.z /= l;
  const NORMS = {
    up: [0, 1, 0], away: [-s.x, 0, -s.z], across: [-s.z, 0, s.x],
    toward: [s.x, 0, s.z], down: [0, -1, 0],
  };
  console.log('\nfolded constants against three: closed + delta must equal open');
  let worstRel = 0;
  for (const [k, n] of Object.entries(NORMS)) {
    const c = irr(A.sh, n), o = irr(A.shOpen, n), d = shaderDelta(n);
    const got = c.map((v, i) => v + d[i]);
    const rel = Math.max(...got.map((v, i) => Math.abs(v - o[i]) / Math.max(1e-9, Math.abs(o[i]))));
    worstRel = Math.max(worstRel, rel);
    console.log(`  ${k.padEnd(7)} closed ${c.map((v) => v.toFixed(4)).join(' ')}` +
      `  open ${o.map((v) => v.toFixed(4)).join(' ')}` +
      `  rebuilt ${got.map((v) => v.toFixed(4)).join(' ')}  rel ${rel.toExponential(1)}`);
  }
  console.log(`  worst relative error ${worstRel.toExponential(2)} ` +
    `${worstRel < 1e-9 ? '- exact, the folding is right' : '- FOLDING IS WRONG'}`);
}
