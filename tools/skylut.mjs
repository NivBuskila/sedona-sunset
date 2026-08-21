/* Is the sky model warm underneath the tone curve, or warm nowhere?
 *
 *   node tools/skylut.mjs
 *
 * tools/skyprofile.mjs measures the rendered low sky at 231/231/231, saturation
 * 0.032 - pure white - and a near-sun plateau flat at 242 cv from half a degree
 * out to eight. Those are shoulder numbers: ACES at this level has a slope near
 * zero up there, so any gradient and any hue the model carries is being crushed
 * flat before it reaches the frame.
 *
 * That leaves two very different diagnoses and they need opposite fixes. Either
 * the LUT is warm and graded and the level is burying it, in which case the fix is
 * radiance and nothing else; or the LUT is itself neutral, in which case dimming
 * reveals a grey sky instead of a gold one and the scattering model is what has to
 * change. So read the model in scene-linear, before the curve, and read it in cv
 * beside it, so the two can be compared directly.
 *
 * Columns are the sky as src/sky.js assembles it: the LUT's rgb, which is Rayleigh
 * plus multiple scattering, plus alpha times the Henyey-Greenstein phase times
 * uMieTint, which is the forward-scattered aerosol lobe carrying the sun's own
 * transmitted colour. The split matters because the two have different colours and
 * only one of them is steerable without touching the dome's contribution to
 * irradiance.
 */
import { computeAtmosphere, SUN_EL, SUN_AZ_DEG, MIE_G } from '../src/atmos.js';
import { EXPOSURE } from '../src/sky.js';
import { forward } from './tone.mjs';

const SCALE = 19;
const A = computeAtmosphere();
const { lut, SKY_W, SKY_H, mieTintRGB } = A;

const phaseHG = (c, g) => {
  const g2 = g * g;
  return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
};
const sat = ([r, g, b]) => { const m = Math.max(r, g, b); return m > 0 ? (m - Math.min(r, g, b)) / m : 0; };
const hue = ([r, g, b]) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
const cv = (c) => forward(c, EXPOSURE).map((v) => Math.round(255 * v));

/** Sample the LUT the way the shader does: u is angle from the sun's bearing. */
function sample(elDeg, azFromSunDeg) {
  const el = elDeg * Math.PI / 180;
  const y = Math.sin(el);
  const v = 0.5 + 0.5 * Math.sign(y) * Math.sqrt(Math.abs(y));
  const iy = Math.min(SKY_H - 1, Math.max(0, Math.round(v * (SKY_H - 1))));
  const ix = Math.min(SKY_W - 1, Math.max(0, Math.round(Math.abs(azFromSunDeg) / 180 * (SKY_W - 1))));
  const i = (iy * SKY_W + ix) * 4;
  const ray = [lut[i] * SCALE, lut[i + 1] * SCALE, lut[i + 2] * SCALE];
  /* Angle between the view direction and the sun, for the phase function. */
  const ch = Math.cos(el), sa = Math.cos(azFromSunDeg * Math.PI / 180);
  const ca = ch * sa * Math.cos(SUN_EL) + y * Math.sin(SUN_EL);
  const ph = phaseHG(ca, MIE_G);
  const mie = [0, 1, 2].map((k) => lut[i + 3] * ph * mieTintRGB[k] * SCALE);
  return { ray, mie, tot: [0, 1, 2].map((k) => ray[k] + mie[k]), ph, alpha: lut[i + 3] };
}

console.log(`\n  sun elevation ${(SUN_EL * 180 / Math.PI).toFixed(0)}\u00b0, azimuth ${SUN_AZ_DEG}\u00b0, ` +
  `MIE_G ${MIE_G}, exposure ${EXPOSURE}`);
console.log(`  mieTint ${mieTintRGB.map((v) => v.toFixed(4)).join(' ')}  ` +
  `(sat ${sat(mieTintRGB).toFixed(3)}, hue ${hue(mieTintRGB).toFixed(0)}\u00b0)\n`);

console.log('--- along the sun\'s own bearing, by elevation ---\n');
console.log('  elev    Rayleigh+MS linear      Mie linear             total linear      sat    hue    cv          Mie share');
for (const e of [2, 5, 8, 12, 15, 18, 25, 35, 50, 70]) {
  const s = sample(e, 0);
  const ms = s.mie[1] / s.tot[1];
  console.log(`  ${String(e).padStart(3)}\u00b0  ${s.ray.map((v) => v.toFixed(2).padStart(6)).join(' ')}  ` +
    `${s.mie.map((v) => v.toFixed(2).padStart(6)).join(' ')}  ` +
    `${s.tot.map((v) => v.toFixed(2).padStart(6)).join(' ')}  ` +
    `${sat(s.tot).toFixed(3)}  ${hue(s.tot).toFixed(0).padStart(4)}  ` +
    `${cv(s.tot).map((v) => String(v).padStart(3)).join(' ')}   ${(100 * ms).toFixed(0).padStart(3)}%`);
}

console.log('\n--- away from the sun at 12\u00b0 elevation, which is where the warmth should live ---\n');
console.log('  az from sun    total linear         sat    hue    cv          Mie share');
for (const a of [0, 2, 5, 10, 20, 40, 70, 110, 180]) {
  const s = sample(12, a);
  console.log(`  ${String(a).padStart(5)}\u00b0     ${s.tot.map((v) => v.toFixed(2).padStart(6)).join(' ')}  ` +
    `${sat(s.tot).toFixed(3)}  ${hue(s.tot).toFixed(0).padStart(4)}  ` +
    `${cv(s.tot).map((v) => String(v).padStart(3)).join(' ')}   ${(100 * s.mie[1] / s.tot[1]).toFixed(0).padStart(3)}%`);
}

console.log('\n--- the aureole as a falloff: is there a curve, and where does it land on the tone scale ---\n');
console.log('  from sun    total linear         cv          d(cv)/decade   sat');
let prev = null;
for (const a of [0.3, 0.5, 1, 2, 4, 8, 16, 32]) {
  const s = sample(15, a);
  const c = cv(s.tot);
  console.log(`  ${a.toFixed(1).padStart(5)}\u00b0     ${s.tot.map((v) => v.toFixed(2).padStart(6)).join(' ')}  ` +
    `${c.map((v) => String(v).padStart(3)).join(' ')}   ${prev === null ? '   -' : String(c[1] - prev).padStart(4)}` +
    `           ${sat(s.tot).toFixed(3)}`);
  prev = c[1];
}
/* Where the curve still has slope: the whole argument for dimming rests on this. */
console.log('\n--- what the tone curve does with a decade of radiance ---\n');
console.log('  linear   cv     local slope d(cv)/d(ln L)');
for (const L of [0.3, 0.5, 0.8, 1.2, 2, 3.4, 5, 8]) {
  const c = forward([L, L, L], EXPOSURE)[1] * 255;
  const c2 = forward([L * 1.1, L * 1.1, L * 1.1], EXPOSURE)[1] * 255;
  console.log(`  ${L.toFixed(2).padStart(6)}  ${c.toFixed(0).padStart(4)}   ${((c2 - c) / 0.0953).toFixed(1).padStart(6)}`);
}
console.log('');
