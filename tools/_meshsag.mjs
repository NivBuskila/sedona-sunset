/* Does the drawn ground sit where the height field says it does?
 *
 * terrain.js opens by stating the contract: "heightAt(x, z) is the single
 * source of truth for ground elevation. The mesh is that function sampled on a
 * grid, and the player's feet call the same function, so the two cannot
 * disagree." The first two sentences are true and the third does not follow
 * from them. A mesh is that function sampled AT THE GRID POINTS and linearly
 * interpolated everywhere else, and linear interpolation of a curved function
 * does not equal the function between its samples. On a convex surface the
 * chord lies below the arc, so the drawn ground sags under the sampled ground.
 *
 * That matters because everything that sits on the terrain is seated by calling
 * heightAt at its own centre - clasts, wedges, collars - while what the camera
 * sees is the interpolated mesh. Wherever the mesh sags, a stone seated
 * perfectly in the data hovers in the frame by exactly the sag, and its cast
 * shadow starts that far away from its rim. That is a lit sliver between a
 * stone and its shadow, produced with no shadow bias at all.
 *
 * Reported against the two lengths that decide whether it matters: the shadow
 * bias, which is the rival explanation for the same sliver, and the pixel at
 * near-field range, because a defect smaller than a pixel is not a defect.
 *
 *   node tools/_meshsag.mjs [--z -6] [--halfx 12] [--n 40000]
 */
import { WashPath } from '../src/path.js';
import { Terrain, meshStepX, meshStepZ } from '../src/terrain.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const ZC = arg('z', -6);
const HALFX = arg('halfx', 12);
const N = arg('n', 40000);

const path = new WashPath();
const terrain = new Terrain(path);
const h = (x, z) => terrain.heightAt(x, z);
/* applyScour displaces the mesh's vertices after the build and heightAt knows
   nothing about it, so the drawn surface is the interpolated sum while every
   seat is the bare analytic term. Measured with and without, because if scour
   dominates then interpolation is a side issue and the fix is a different one. */
const sc = (x, z) => (terrain.scourAt ? terrain.scourAt(x, z) : 0);
const hs = (x, z) => h(x, z) + sc(x, z);

/* Recover the grid lines by walking outward from the origin with the axis's own
   local spacing, which is exported precisely so a tool need not duplicate the
   segment table and go stale against it. */
function axisLines(step, from, to) {
  const out = [0];
  for (let v = 0; v > from;) { v -= step(v); out.unshift(v); }
  for (let v = 0; v < to;) { v += step(v); out.push(v); }
  return out;
}
const xs = axisLines(meshStepX, -HALFX - 2, HALFX + 2);
const zs = axisLines(meshStepZ, ZC - 14, ZC + 14);

function cell(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; }
  return lo;
}

let sum = 0, n = 0, mx = 0, mxAt = null;
let sumI = 0, mxI = 0; const valsI = [];
let below = 0;
const vals = [];
for (let i = 0; i < N; i++) {
  const x = -HALFX + Math.random() * 2 * HALFX;
  const z = ZC - 10 + Math.random() * 20;
  const ix = cell(xs, x), iz = cell(zs, z);
  const x0 = xs[ix], x1 = xs[ix + 1], z0 = zs[iz], z1 = zs[iz + 1];
  if (x1 === undefined || z1 === undefined) continue;
  const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
  const tri = (f) => {
    const f00 = f(x0, z0), f10 = f(x1, z0), f01 = f(x0, z1), f11 = f(x1, z1);
    return (u + v <= 1)
      ? f00 + u * (f10 - f00) + v * (f01 - f00)
      : f11 + (1 - u) * (f01 - f11) + (1 - v) * (f10 - f11);
  };
  const d = h(x, z) - tri(hs);     // positive = drawn ground below the seat
  const dInterpOnly = h(x, z) - tri(h);
  vals.push(d); sum += d; n++;
  sumI += dInterpOnly; if (Math.abs(dInterpOnly) > Math.abs(mxI)) mxI = dInterpOnly;
  valsI.push(dInterpOnly);
  if (d > 0) below++;
  if (Math.abs(d) > Math.abs(mx)) { mx = d; mxAt = [x, z]; }
}
vals.sort((a, b) => a - b);
valsI.sort((a, b) => a - b);
const pc = (q) => vals[Math.floor(q * (vals.length - 1))];
const pcI = (q) => valsI[Math.floor(q * (valsI.length - 1))];

console.log('mesh (linear interpolation) against heightAt (the stated truth)');
console.log(`near-field band x +-${HALFX} m, z ${ZC - 10} to ${ZC + 10}, ${n} samples`);
console.log(`grid here: ${meshStepX(0).toFixed(3)} x ${meshStepZ(ZC).toFixed(3)} m\n`);
console.log(`  mean sag        ${(sum / n * 1000).toFixed(1).padStart(7)} mm   (positive = drawn ground BELOW seated height)`);
console.log(`  median          ${(pc(0.5) * 1000).toFixed(1).padStart(7)} mm`);
console.log(`  p90             ${(pc(0.90) * 1000).toFixed(1).padStart(7)} mm`);
console.log(`  p99             ${(pc(0.99) * 1000).toFixed(1).padStart(7)} mm`);
console.log(`  worst           ${(mx * 1000).toFixed(1).padStart(7)} mm  at x ${mxAt[0].toFixed(2)}, z ${mxAt[1].toFixed(2)}`);
console.log(`  fraction where the mesh is below the seat: ${(100 * below / n).toFixed(1)}%`);
console.log('');
console.log('  splitting the two causes — interpolation alone, scour excluded:');
console.log(`    mean ${(sumI / n * 1000).toFixed(1)} mm   p90 ${(pcI(0.90) * 1000).toFixed(1)} mm   p99 ${(pcI(0.99) * 1000).toFixed(1)} mm   worst ${(mxI * 1000).toFixed(1)} mm`);
console.log('');
console.log('  for scale:');
console.log('    near-cascade shadow bias   20.0 mm depth + 5.0 mm normal');
console.log('    far-cascade shadow bias    60.0 mm depth + 10.0 mm normal');
console.log('    one pixel at 6 m range in the ground view is about 3 mm');
