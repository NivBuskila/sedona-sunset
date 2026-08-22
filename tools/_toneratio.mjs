/* Does the ACES toe account for the black side faces?
 *
 * The chain of measurement that leads here:
 *   - _pixowner attributes the black faces to boulder0 and cobble1. My objects.
 *   - The ground immediately behind boulder0 renders rgb(155,106,75); the
 *     boulder's shaded face renders rgb(6,3,3).
 *   - The shader's own occlusion chain predicts that face should receive
 *     2.97-3.95% of a sunlit top's irradiance (tools/_faceratio.mjs), and the
 *     atmosphere unoccluded says 8.73%.
 *   - But the rendered pair is 0.62% in linear-sRGB, five to six times darker
 *     than the shading predicts.
 *
 * Either the shading is wrong by 5x, or the transfer between scene-linear and
 * display is compressing that ratio. three.js is on ACESFilmicToneMapping,
 * which has a pronounced toe, so this checks the second before anyone goes
 * looking for the first.
 *
 * Method: forward-evaluate three.js's ACES fit, find the scene-linear value
 * that lands the sunlit ground where it is actually observed, then ask what
 * 3%, 4% and 8.7% of that scene value come out as. If 3% comes out at the
 * observed 0.62%, the shading is exonerated and the blackness is the curve.
 *
 *   node tools/_toneratio.mjs
 */

/* three.js ACESFilmicToneMapping, ported exactly (WebGLRenderer tonemapping
   shader chunk). Input is scene-linear, output display-linear. */
const IN = [
  [0.59719, 0.35458, 0.04823],
  [0.07600, 0.90834, 0.01566],
  [0.02840, 0.13383, 0.83777],
];
const OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const mul = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const rrt = (v) => v.map((x) => {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return a / b;
});
const sat = (v) => v.map((x) => Math.min(1, Math.max(0, x)));

function aces(rgb, exposure) {
  let c = rgb.map((x) => x * exposure / 0.6);
  c = mul(IN, c);
  c = rrt(c);
  c = mul(OUT, c);
  return sat(c);
}

const srgbToLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/* Read from source rather than quoted from a note. scatter.js's blue-chip entry
   mentions 1.15, which was that capture's exposure and is NOT the shipped one;
   using it here would have put every figure below on the wrong part of the
   curve. */
import { EXPOSURE } from '../src/sky.js';

/* Solve for the scene-linear value that ACES maps to an observed display value,
   searching along that colour's own chromaticity ray. */
function sceneFor(obsLin) {
  const dir = obsLin.map((v) => v / lum(obsLin));
  let lo = 1e-6, hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (lum(aces(dir.map((d) => d * mid), EXPOSURE)) < lum(obsLin)) lo = mid; else hi = mid;
  }
  return { s: Math.sqrt(lo * hi), dir };
}

/* Each case: a shaded clast facet and the sunlit ground revealed behind it when
   that clast is hidden. Both from _pixowner on shots/sys7ship_juniper.png, so
   the pairing is by ablation rather than by eye. */
const CASES = [
  { name: 'boulder0', face: [6, 3, 3], ground: [155, 106, 75] },
  { name: 'cobble1', face: [18, 7, 9], ground: [156, 126, 98] },
];

for (const c of CASES) {
  const gLin = c.ground.map((v) => srgbToLin(v / 255));
  const fLin = c.face.map((v) => srgbToLin(v / 255));
  const obsRatio = lum(fLin) / lum(gLin);
  const { s: sceneGround, dir } = sceneFor(gLin);
  const { s: sceneFace } = sceneFor(fLin);

  console.log(`=== ${c.name} ===`);
  console.log(`  observed  face sRGB ${c.face.join(',')}   ground behind sRGB ${c.ground.join(',')}`);
  console.log(`  observed display ratio face/ground : ${(100 * obsRatio).toFixed(3)}%`);
  console.log(`  inverting ACES on each:`);
  console.log(`    scene-linear ground ${sceneGround.toFixed(5)}   scene-linear face ${sceneFace.toFixed(6)}`);
  console.log(`  => RECOVERED SCENE RATIO           : ${(100 * sceneFace / sceneGround).toFixed(2)}%`);
  console.log(`     shader chain predicts 2.97-3.95%, atmosphere unoccluded 8.73%`);
  console.log('');
  console.log('  forward check - fractions of the scene ground through the same curve:');
  console.log('     scene %    ACES out lum    as % of ground out    sRGB code');
  for (const f of [0.0873, 0.0600, 0.0395, 0.0297, 0.0200]) {
    const out = aces(dir.map((d) => d * sceneGround * f), EXPOSURE);
    const ol = lum(out);
    const code = 255 * (ol <= 0.0031308 ? 12.92 * ol : 1.055 * Math.pow(ol, 1 / 2.4) - 0.055);
    console.log(`     ${(100 * f).toFixed(2).padStart(5)}%      ${ol.toFixed(5)}        ${(100 * ol / lum(gLin)).toFixed(3).padStart(7)}%          ${code.toFixed(1).padStart(5)}`);
  }
  console.log('');
}

console.log('The last column is the decisive one. Even at 8.73% - the atmosphere');
console.log('with the ENTIRE clast occlusion chain deleted, which would be');
console.log('physically wrong and would undo the shaded-bank fix - the facet still');
console.log('renders in the low teens of an 8-bit code. There is no shading change');
console.log('available in scatter.js that takes these faces out of black.');
