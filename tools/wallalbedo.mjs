/* What colour is the wall on the other side of the wash, on average?
 *
 *   node tools/wallalbedo.mjs
 *
 * The fill is built by replacing the lower sky with escarpment, and the
 * escarpment was given a single albedo — 0.335 0.152 0.082, chosen to look like
 * hematite-cemented sandstone. That is the colour of the *reddest lens inside the
 * reddest bed*, not the colour of a cliff. System 2's stratigraphic column is
 * right here in the same repo, with a linear diffuse albedo per bed and a bed
 * thickness, and a real Sedona section is a stack of unequal beds including one
 * grey limestone ledge and twelve metres of cream Coconino at the top. The
 * average of that stack is what a surface across the wash actually receives.
 *
 * Two weightings, because they disagree and the disagreement is the point:
 *
 *   thickness   what the beds are, per metre of section
 *   solid angle what a point on the wash floor actually sees, which falls off as
 *               D/(D^2+y^2) with height because the top of a near wall is
 *               foreshortened into a narrow band
 *
 * The second is the honest one for a fill term and it is the less convenient one,
 * since it weights down the pale cap that does most of the desaturating.
 */
import { LAYERS } from '../src/rock.js';

const LUM = [0.2126, 0.7152, 0.0722];
const lum = (c) => c[0] * LUM[0] + c[1] * LUM[1] + c[2] * LUM[2];
const sat = (c) => 1 - Math.min(...c) / Math.max(...c);

/* Height range the fill's escarpment actually spans. The floor is y ~ 0 and the
   skyline was measured at 45 degrees from it at roughly 30 m of standoff, so the
   crest is near 30-40 m up and the beds above that are what the far skyline and
   the butte tops contribute. Below zero is buried in talus and cannot be seen. */
const Y_FLOOR = 0;
const D = 30;

const spans = [];
for (let i = 0; i < LAYERS.length; i++) {
  const y0 = LAYERS[i].y0;
  const y1 = i + 1 < LAYERS.length ? LAYERS[i + 1].y0 : y0 + LAYERS[i].bedT;
  if (y1 <= Y_FLOOR) continue;
  spans.push({ y0: Math.max(y0, Y_FLOOR), y1, col: LAYERS[i].col, kind: LAYERS[i].kind, pale: LAYERS[i].pale });
}

const mix = (weight) => {
  const acc = [0, 0, 0];
  let wsum = 0;
  for (const s of spans) {
    const w = weight(s);
    wsum += w;
    for (let k = 0; k < 3; k++) acc[k] += s.col[k] * w;
  }
  return acc.map((v) => v / wsum);
};

/* Integral of D/(D^2+y^2) dy is atan(y/D), so a bed's angular share is exact. */
const angular = (s) => Math.atan(s.y1 / D) - Math.atan(s.y0 / D);
const thickness = (s) => s.y1 - s.y0;

const CURRENT = [0.335, 0.152, 0.082];

console.log('beds above the talus, with their angular share from 30 m out\n');
console.log('  y0     y1    thick   ang%   albedo                  sat    pale');
const angTot = spans.reduce((a, s) => a + angular(s), 0);
for (const s of spans) {
  console.log(`  ${s.y0.toFixed(1).padStart(5)} ${s.y1.toFixed(1).padStart(6)} ` +
    `${(s.y1 - s.y0).toFixed(1).padStart(6)} ${(100 * angular(s) / angTot).toFixed(1).padStart(6)}  ` +
    `[${s.col.map((v) => v.toFixed(3)).join(' ')}]  ${sat(s.col).toFixed(3)}  ${s.pale.toFixed(2)}`);
}

const byT = mix(thickness);
const byA = mix(angular);

console.log('\n                        albedo                  sat     B/R     lum');
const row = (label, c) => console.log(`  ${label.padEnd(20)} [${c.map((v) => v.toFixed(3)).join(' ')}]  ` +
  `${sat(c).toFixed(3)}  ${(c[2] / c[0]).toFixed(3)}  ${lum(c).toFixed(4)}`);
row('shipping', CURRENT);
row('by thickness', byT);
row('by solid angle', byA);

/* Chroma at constant luminance: the fill's *level* is calibrated — WALL_LIT and
   WALL_SKYVIS came off raycasts and the gate depends on them — and its chroma
   never was. So take the measured chroma and keep the calibrated luminance. */
const held = byA.map((v) => v * lum(CURRENT) / lum(byA));
row('by angle, held', held);

console.log(`\n  the shipping figure is more saturated than every bed in the column: ` +
  `${sat(CURRENT).toFixed(3)} against a reddest bed of ${Math.max(...spans.map((s) => sat(s.col))).toFixed(3)}`);
console.log(`  held at constant luminance the chroma moves sat ${sat(CURRENT).toFixed(3)} -> ${sat(held).toFixed(3)}, ` +
  `B/R ${(CURRENT[2] / CURRENT[0]).toFixed(3)} -> ${(held[2] / held[0]).toFixed(3)}`);
console.log(`  luminance ${lum(CURRENT).toFixed(4)} -> ${lum(held).toFixed(4)}, ` +
  `so the gate sees nothing\n`);
console.log('  GLSL-free, atmos.js wants:  [' + held.map((v) => v.toFixed(4)).join(', ') + ']');
