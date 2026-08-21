/* Did the two-term phase move the fill, or did something else move the rock?
 *
 *   node tools/_fillchk.mjs
 *
 * Lit rock came back at saturation 0.688 and hue 14.3 against the critique's
 * 0.625 and 20.8, and the two-term Mie phase is a suspect because it is not
 * confined to the dome: src/atmos.js phaseM feeds the multiple-scattering solve
 * and the fill integration, and src/sky.js phaseHG feeds the FOG mean that
 * src/aerial.js turns into airlight over rock.
 *
 * The prior is that it did not. Both lobes carry the same mieTint, so
 * redistributing weight between them changes the *magnitude* of the Mie term in
 * any given direction but never its colour; the fill's chroma can only move as
 * far as the Mie-to-Rayleigh ratio moves, and that integral came out 0.08%
 * different in tools/_skydesign.mjs. But a sun-facing wall weights the sun's own
 * direction most heavily, which is exactly where the narrow lobe puts its light,
 * so the prior needs checking rather than asserting. Run it, git stash, run it
 * again, and compare - no capture required.
 */
import { computeAtmosphere } from '../src/atmos.js';
import { FOG } from '../src/sky.js';

const A = computeAtmosphere();
const irr = (sh, n) => {
  const c = sh.coefficients, [x, y, z] = n;
  const b = [0.886227, 1.023328 * y, 1.023328 * z, 1.023328 * x,
    0.858086 * x * y, 0.858086 * y * z, 0.743125 * z * z - 0.247708,
    0.858086 * x * z, 0.429043 * (x * x - y * y)];
  const o = [0, 0, 0];
  for (let k = 0; k < 9; k++) { o[0] += c[k].x * b[k]; o[1] += c[k].y * b[k]; o[2] += c[k].z * b[k]; }
  return o;
};
const sat = ([r, g, b]) => { const m = Math.max(r, g, b); return m > 0 ? (m - Math.min(r, g, b)) / m : 0; };
const hue = ([r, g, b]) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
const f4 = (a) => a.map((v) => v.toFixed(4)).join(' ');

for (const [nm, n] of [['up', [0, 1, 0]], ['sun-facing', [0.966, 0, 0.259]], ['away', [-0.966, 0, -0.259]]]) {
  const c = irr(A.sh, n), o = irr(A.shOpen, n);
  console.log(`  ${nm.padEnd(11)} closed ${f4(c)} sat ${sat(c).toFixed(4)} hue ${hue(c).toFixed(1).padStart(5)}` +
    `   open ${f4(o)} sat ${sat(o).toFixed(4)} hue ${hue(o).toFixed(1).padStart(5)}`);
}
const fg = [FOG.r, FOG.g, FOG.b];
console.log(`  FOG         ${f4(fg)} sat ${sat(fg).toFixed(4)} hue ${hue(fg).toFixed(1)}`);
console.log(`  sunRGB      ${f4(A.sunRGB)} sat ${sat(A.sunRGB).toFixed(4)} hue ${hue(A.sunRGB).toFixed(1)}`);
