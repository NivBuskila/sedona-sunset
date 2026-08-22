/* Does the rake march actually produce the shadows a 15 degree sun casts?
 *
 * The critic: "at this sun angle every pebble on a wash floor throws a shadow
 * one to three times its own length, and there is not one such shadow in this
 * frame." The march exists and, since the LOD fix, reads the map at the same
 * sharpness the visible bumps are drawn at. So the remaining question is
 * whether its *reach* and its *sampling along the ray* are right for this sun.
 *
 * This runs the shader's march literally, on the real dirt map, in node. No GL
 * and no render. It compares the shipped march against a reference march that
 * is deliberately over-sampled and over-long, so any shortfall is attributable
 * to the shipped parameters rather than to the map having no relief in it.
 *
 * Geometry, from textures.js and terrain.js: the tile is 2.6 m at 1024, so
 * 2.54 mm per texel, and one unit of the height channel is 25 mm of relief.
 */
import { makeDirt } from '../src/textures.js';
import { SUN_DIR, SUN_EL_DEG } from '../src/atmos.js';
import { finite } from './argcheck.mjs';

const SIZE = finite('map size', process.argv[2], 1024);
const TILE_M = 2.6;                       // metres of world per UV unit
const RELIEF_M = 0.025;                   // metres per unit of the height channel
const texelM = TILE_M / SIZE;

const dirt = makeDirt(SIZE);
const arm = dirt.arm.image.data;          // packARM: r=ao g=rough b=height
const H = new Float32Array(SIZE * SIZE);
for (let i = 0; i < SIZE * SIZE; i++) H[i] = arm[i * 4 + 2] / 255;

/* Bilinear, wrapping, exactly as the sampler does. */
function sample(u, v) {
  let x = u * SIZE - 0.5, y = v * SIZE - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = (xx, yy) => H[(((yy % SIZE) + SIZE) % SIZE) * SIZE + (((xx % SIZE) + SIZE) % SIZE)];
  return (i(x0, y0) * (1 - fx) + i(x0 + 1, y0) * fx) * (1 - fy)
       + (i(x0, y0 + 1) * (1 - fx) + i(x0 + 1, y0 + 1) * fx) * fy;
}

const sunEl = SUN_EL_DEG * Math.PI / 180;
const sunRise = Math.tan(sunEl) / RELIEF_M;             // height units per metre
const sxz = Math.hypot(SUN_DIR.x, SUN_DIR.z);
const step = { u: SUN_DIR.x / sxz / TILE_M, v: SUN_DIR.z / sxz / TILE_M };  // UV per metre

/* One march. Returns raw `rake`, the shader's pre-gain occlusion scalar.
   `ts` is the list of distances in metres, so linear and log spacings and
   different relief scalings can all be compared on the same footing. */
function march(u, v, ts, reliefK = 1) {
  const h0 = sample(u, v);
  const rise = sunRise / reliefK;         // deeper relief, slower rise per metre
  let rake = 0;
  for (const t of ts) {
    const hs = sample(u + step.u * t, v + step.v * t);
    rake = Math.max(rake, hs - (h0 + t * rise));
  }
  return rake;
}

const linear = (n, dt) => Array.from({ length: n }, (_, k) => (k + 1) * dt);
/* Geometric spacing over the same reach: dense where the shadow of a grain
   actually starts, sparse out where only the tallest thing still occludes. */
const geom = (n, near, far) =>
  Array.from({ length: n }, (_, k) => near * Math.pow(far / near, k / (n - 1)));

/* Statistics over a fixed grid of probe points, same points for every variant
   so the comparison is paired. */
const NP = 200;
const pts = [];
for (let a = 0; a < NP; a++) for (let b = 0; b < NP; b++) pts.push([a / NP, b / NP]);

function stats(label, ts, reliefK = 1) {
  let sum = 0, max = 0, lit = 0, strong = 0;
  for (const [u, v] of pts) {
    const r = march(u, v, ts, reliefK);
    const res = Math.min(1, Math.max(0, r * 3.4));       // shader's rakeRes
    sum += res; if (res > max) max = res;
    if (res > 0.02) lit++;
    if (res > 0.25) strong++;
  }
  const n = pts.length;
  console.log(`  ${label.padEnd(32)} n ${String(ts.length).padStart(3)}  ` +
    `first ${(ts[0] * 1000).toFixed(1).padStart(5)} mm  reach ${(ts[ts.length - 1] * 1000).toFixed(0).padStart(4)} mm  ` +
    `mean ${(sum / n).toFixed(4)}  any ${(100 * lit / n).toFixed(1).padStart(5)}%  ` +
    `strong ${(100 * strong / n).toFixed(1).padStart(5)}%`);
  return sum / n;
}

let hs = 0, hmin = 1, hmax = 0;
for (const [u, v] of pts) { const h = sample(u, v); hs += h; if (h < hmin) hmin = h; if (h > hmax) hmax = h; }
let hv = 0;
for (const [u, v] of pts) { const d = sample(u, v) - hs / pts.length; hv += d * d; }
const hsd = Math.sqrt(hv / pts.length);

console.log(`dirt height channel: mean ${(hs / pts.length).toFixed(3)} sd ${hsd.toFixed(3)} ` +
  `range ${hmin.toFixed(3)}-${hmax.toFixed(3)}`);
console.log(`  = relief sd ${(hsd * RELIEF_M * 1000).toFixed(1)} mm, peak-to-peak ` +
  `${((hmax - hmin) * RELIEF_M * 1000).toFixed(0)} mm, at ${(texelM * 1000).toFixed(2)} mm per texel`);
console.log(`sun ${SUN_EL_DEG} deg: a bump of height h casts ${(1 / Math.tan(sunEl)).toFixed(2)} h.`);
console.log(`  so one sd of relief casts ${(hsd * RELIEF_M / Math.tan(sunEl) * 1000).toFixed(0)} mm, ` +
  `and the full range casts ${((hmax - hmin) * RELIEF_M / Math.tan(sunEl) * 1000).toFixed(0)} mm.\n`);

console.log('march variants, paired on the same 40000 points. eight fetches is the budget:');
const shipped = stats('shipped: 8 linear of 11 mm', linear(8, 0.011));
const dense = stats('same reach, every texel (35)', linear(35, 0.0025));
stats('reference: 300 mm, every texel', linear(120, 0.0025));
console.log('');
const g8 = stats('EIGHT, geometric 2.5-88 mm', geom(8, 0.0025, 0.088));
stats('eight, geometric 2.5-130 mm', geom(8, 0.0025, 0.130));
console.log('');
console.log('and if the bed were not so shallow (geometric 8, reach scaled with it):');
for (const k of [1.5, 2, 3]) stats(`relief x${k}`, geom(8, 0.0025, 0.088 * k), k);

console.log(`\n  Reach is not the problem: 300 mm finds exactly what 88 mm finds, because the`);
console.log(`  map's whole range only casts 90 mm at this sun. Sampling is a little of it —`);
console.log(`  eight linear steps find ${(100 * shipped / dense).toFixed(0)}% of what thirty-five over the same reach find,`);
console.log(`  and eight *geometric* steps find ${(100 * g8 / dense).toFixed(0)}% for the same eight fetches, because the`);
console.log(`  first linear sample lands 11 mm out and steps clean over the base of every`);
console.log(`  grain shadow in the field.`);
