/* Measures the wash's lateral half-width along the walk, so the corridor limit
 * in src/corridor.js can be keyed to real geometry instead of a guessed number.
 *
 *   ws     the terrain cross-section's talus toe, terrain.frame().ws
 *   rise4  distance out to where the height field first stands 4.5 m above the
 *          floor, which is the foot of a wall rather than the crest of a bank
 *   R      the limit the corridor would actually use, per side
 *
 * usage: node tools/_corridor.mjs
 */
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';
import { fbm, smoothstep } from '../src/noise.js';
import { buildCorridor, corridorAt } from '../src/corridor.js';

const path = new WashPath();
const terrain = new Terrain(path);
const q = {}, f = {};

const t0 = Date.now();
const cor = buildCorridor(path, terrain);
const buildMs = Date.now() - t0;

function rise(px, pz, nx, nz, want) {
  for (let a = 1; a < 40; a += 0.25) {
    if (terrain.heightAt(px + nx * a, pz + nz * a) >= want) return a;
  }
  return 40;
}

/* src/rock.js's own plan position for the foot of the cliff, reproduced here so
   the corridor limit can be checked against the rock rather than against an
   argument about the rock. `wallGrid` smooths the toe search over +-7 columns
   of 0.62 m before adding the embayment, which is what this repeats. */
const datumAt = (s) => 0.0125 * Math.max(0, s) + 2.4 * fbm(s * 0.0052, 11.5, 2, 331);
function rockToe(s, side) {
  let acc = 0, w = 0;
  for (let k = -7; k <= 7; k++) {
    const ss = s + k * 0.62, wt = 1 - Math.abs(k) / 8;
    const p = path.posAt(ss);
    const th = path.headingAt(ss);
    const nx = Math.cos(th) * side, nz = Math.sin(th) * side;
    acc += rise(p.x, p.z, nx, nz, datumAt(ss) + 3.0) * wt;
    w += wt;
  }
  const bay = 9.0 * Math.pow(0.5 + 0.5 * fbm(s * 0.0115, side > 0 ? 61 : 83, 3, 341), 2.0);
  const canyon = smoothstep(0.72, 0.94,
    0.5 + 0.5 * fbm(s * 0.0068, side > 0 ? 17 : 29, 2, 347));
  return acc / w + bay + canyon * 22.0;
}

console.log(`path.length ${path.length.toFixed(1)}   corridor built in ${buildMs} ms`);
console.log('    s      ws   rockL  rockR      RL     RR   gapL   gapR');
let worst = 1e9, worstS = 0, gapMin = 1e9, gapMinS = 0;
for (let s = -12; s <= path.length + 2; s += 5) {
  const p = path.posAt(s);
  path.atZ(p.z, q);
  terrain.frame(p.x, p.z, q, f);
  const kL = rockToe(s, -1), kR = rockToe(s, 1);
  const RR = corridorAt(cor, s, 1), RL = corridorAt(cor, s, -1);
  /* The player walks the centreline, so |u| is ~0 and the headroom before a
     nudge is the limit itself. */
  const head = Math.min(RL, RR);
  if (head < worst) { worst = head; worstS = s; }
  const gap = Math.min(kL - RL, kR - RR);
  if (gap < gapMin) { gapMin = gap; gapMinS = s; }
  console.log(
    `${s.toFixed(0).padStart(5)} ${f.ws.toFixed(2).padStart(7)} ` +
    `${kL.toFixed(1).padStart(6)} ${kR.toFixed(1).padStart(6)} ` +
    `${RL.toFixed(2).padStart(7)} ${RR.toFixed(2).padStart(6)} ` +
    `${(kL - RL).toFixed(1).padStart(6)} ${(kR - RR).toFixed(1).padStart(6)}`);
}
console.log(`\nnarrowest headroom on the centreline: ${worst.toFixed(2)} m at s=${worstS}`);
console.log(`smallest clearance to the cliff foot:  ${gapMin.toFixed(2)} m at s=${gapMinS}`);
console.log(`walk limits: s in [${cor.sMin}, ${cor.sMax.toFixed(1)}]`);
