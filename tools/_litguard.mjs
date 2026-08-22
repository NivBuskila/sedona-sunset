/* Did the second doorway cost the lit rock anything?
 *
 *   node tools/_litguard.mjs
 *
 * The guardrail on the cool-shade work is that lit rock must stay at saturation
 * 0.615-0.626 and hue 20-22, a band four systems spent days earning. It came out
 * of the render at 0.616 and hue 21.0, which holds - but 0.616 is a thousandth
 * off the bottom of the band, and that capture pair straddles six commits from
 * other systems, so the render cannot say how much of the drift was the doorway
 * and how much was everything else that landed. A number that close to an edge
 * should be attributed rather than hoped about.
 *
 * The CPU can settle it exactly and for free, because the doorway is reachable
 * through computeAtmosphere's override argument: setting the astern window's
 * elevation to the flank skyline makes it vanish, which reproduces the old
 * single-doorway model precisely rather than approximately. So build both
 * atmospheres, put direct sun and fill on a sunlit face in each, and read off
 * what the fill's chroma change does to it.
 *
 * A lit face is mostly direct light, which is why this is expected to be small:
 * the shadow gate says the fill is about a fifth of what a sunlit surface
 * collects, so a few percent of chroma on the fill is a few tenths of a percent
 * on the result. The point is to show that, not to assume it.
 */
import { computeAtmosphere, SUN_DIR } from '../src/atmos.js';

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: mx > 0 ? d / mx : 0 };
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function irr(sh, n) {
  const c = sh.coefficients, out = [0, 0, 0];
  const b = [
    0.886227, 1.023328 * n[1], 1.023328 * n[2], 1.023328 * n[0],
    0.858086 * n[0] * n[1], 0.858086 * n[1] * n[2],
    0.247708 * (3 * n[2] * n[2] - 1), 0.858086 * n[0] * n[2],
    0.429043 * (n[0] * n[0] - n[1] * n[1]),
  ];
  for (let k = 0; k < 9; k++) {
    out[0] += b[k] * c[k].x; out[1] += b[k] * c[k].y; out[2] += b[k] * c[k].z;
  }
  return out;
}

const ROCK = [0.2890, 0.1617, 0.1211];
/* The lit wall in wall_lit, as the contract measures it: a face square enough to
   the sun to be the sunlit population, at the wash floor's aperture. */
const nSun = [SUN_DIR.x, 0.25, SUN_DIR.z];
{ const l = Math.hypot(...nSun); for (let k = 0; k < 3; k++) nSun[k] /= l; }
const cosI = Math.max(0, nSun[0] * SUN_DIR.x + nSun[1] * SUN_DIR.y + nSun[2] * SUN_DIR.z);

const cases = [
  ['one doorway (before)', { gapAwayDeg: 45 }],
  ['two doorways (shipped)', {}],
];

console.log(`\n  a sunlit rock face, cos incidence ${cosI.toFixed(3)}\n`);
for (const [lab, over] of cases) {
  const A = computeAtmosphere(over);
  const fill = irr(A.sh, nSun);
  const direct = A.sunRGB.map((c) => c * cosI);
  const litR = [0, 1, 2].map((k) => ROCK[k] * (direct[k] + fill[k]) / Math.PI);
  const shadeR = [0, 1, 2].map((k) => ROCK[k] * fill[k] / Math.PI);
  const q = hsv(...litR), s = hsv(...shadeR);
  console.log(`  ${lab.padEnd(24)} lit  hue ${q.h.toFixed(1).padStart(5)}  sat ${q.s.toFixed(4)}` +
    `   |  fill is ${(100 * lum(fill) / lum(direct.map((c, k) => c + fill[k]))).toFixed(1)}% of the light` +
    `   |  same face shaded  hue ${s.h.toFixed(1).padStart(5)}  sat ${s.s.toFixed(4)}`);
}
console.log('\n  band: lit saturation 0.615-0.626, lit hue 20-22.');
console.log('  Read the difference between the rows, not the absolute value: this is an');
console.log('  analytic face under one albedo, while the contract figure is the brightest');
console.log('  40% of a textured region, so the levels are not the same quantity.');
