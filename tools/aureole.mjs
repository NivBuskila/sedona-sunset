/* What the Mie aureole costs, and what dimming it buys the sun disc.
 *
 *   node tools/aureole.mjs
 *
 * The disc is unoccluded and at its true screen position reads only 2.6% against
 * the sky immediately around it, because that sky is at 249 cv and the ACES
 * shoulder has nothing left to separate them with. The disc's own radiance is not
 * the problem: a half-degree disc carrying the solar irradiance sits at
 * E / (pi * RSUN^2), about 15000 times its irradiance, which pins at 255 whatever
 * else happens. So the entire question is how far the sky *beside* it can come
 * down, and what that costs.
 *
 * Ownership, since two aureoles exist and only one is System 4's:
 *
 *   src/atmos.js MIE_G + the Mie integral in the sky LUT's alpha, multiplied back
 *   in analytically by src/sky.js with uMieG and uMieTint. This is the sky dome's
 *   forward lobe - the bright patch around the sun. SYSTEM 4's.
 *
 *   src/aerial.js W_BROAD/G_BROAD/W_NARROW/G_NARROW, the two-term in-scatter phase
 *   applied to airlight over scene geometry. That is what the depth ladder is made
 *   of and it never touches the sky dome. SYSTEM 5's.
 *
 * The near-sun sky is dome, so the lever is System 4's and needs no routing.
 *
 * This prices it without a solve per variant: the LUT already carries the Rayleigh
 * and multiple-scattering terms in rgb and the Mie integral with its phase divided
 * out in alpha, so any (g, amplitude) pair is a re-evaluation rather than a
 * rebuild. The cost column is the sky's own contribution to irradiance, because
 * the aureole is not free - it is part of what lights the scene.
 */
import { computeAtmosphere, SUN_EL, MIE_G } from '../src/atmos.js';
import { forward } from './tone.mjs';

const SCALE = 19, EXPOSURE = 1.15;
const A = computeAtmosphere();
const { lut, SKY_W, SKY_H, mieTintRGB } = A;

const phaseHG = (c, g) => {
  const g2 = g * g;
  return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
};

/* The texel the sun sits in: u is angle from the sun's azimuth over pi, so 0, and
   v is the same sqrt warp the shader uses. */
const texel = (elRad) => {
  const y = Math.sin(elRad);
  const v = 0.5 + 0.5 * Math.sign(y) * Math.sqrt(Math.abs(y));
  const iy = Math.min(SKY_H - 1, Math.max(0, Math.round(v * (SKY_H - 1))));
  const i = (iy * SKY_W + 0) * 4;
  return { rgb: [lut[i], lut[i + 1], lut[i + 2]], mie: lut[i + 3] };
};
const TSUN = texel(SUN_EL);
/* Same row, walking the azimuth axis: u is angle from the sun's bearing over pi. */
const texelAt = (deg) => {
  const y = Math.sin(SUN_EL);
  const v = 0.5 + 0.5 * Math.sign(y) * Math.sqrt(Math.abs(y));
  const iy = Math.min(SKY_H - 1, Math.max(0, Math.round(v * (SKY_H - 1))));
  const ix = Math.min(SKY_W - 1, Math.max(0, Math.round(deg / 180 * (SKY_W - 1))));
  const i = (iy * SKY_W + ix) * 4;
  return { rgb: [lut[i], lut[i + 1], lut[i + 2]], mie: lut[i + 3] };
};

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const cv = (linear3) => Math.round(255 * forward(linear3, EXPOSURE)[1]);

/** Sky radiance this many degrees from the sun, for a given lobe. */
const skyAt = (deg, g, amp, sameTexel = false) => {
  const ca = Math.cos(deg * Math.PI / 180);
  const ph = phaseHG(ca, g) * amp;
  /* Near the sun the texel barely changes and holding it fixed keeps the aureole
     comparison clean, but the falloff table walks 90 degrees across the dome and
     has to follow the u axis or it reports the sun's own texel as the zenith. */
  const T = sameTexel ? TSUN : texelAt(deg);
  /* uMieTint carries SCALE and the LUT's alpha does not, exactly as skyTexture
     and the uniform block have it. Dropping that 19 is the same mistake the
     comment at src/sky.js:198 records someone making in the other direction, and
     it makes the aureole look like 4% of the near-sun sky instead of 79%. */
  return [0, 1, 2].map((k) => SCALE * T.rgb[k] + T.mie * ph * mieTintRGB[k] * SCALE);
};

/* The sky's share of a horizontal surface's irradiance, integrated over the dome
   from the same LUT, so the cost of dimming the lobe is measured rather than
   asserted. Mie and Rayleigh are separated because only the first one moves. */
const skyIrradiance = (g, amp) => {
  let ray = 0, mie = 0;
  const N = 64;
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      const el = (a + 0.5) / N * (Math.PI / 2);
      const az = (b + 0.5) / N * Math.PI;            // half by symmetry
      const y = Math.sin(el), ch = Math.cos(el);
      const v = 0.5 + 0.5 * Math.sqrt(y);
      const iy = Math.min(SKY_H - 1, Math.round(v * (SKY_H - 1)));
      const ix = Math.min(SKY_W - 1, Math.round(az / Math.PI * (SKY_W - 1)));
      const i = (iy * SKY_W + ix) * 4;
      /* cos(theta) to the sun for this direction, sun in the az = 0 plane */
      const ca = ch * Math.cos(az) * Math.cos(SUN_EL) + y * Math.sin(SUN_EL);
      const dw = ch * y * (Math.PI / 2 / N) * (Math.PI / N) * 2;
      ray += SCALE * lum([lut[i], lut[i + 1], lut[i + 2]]) * dw;
      mie += lut[i + 3] * phaseHG(ca, g) * amp * lum(mieTintRGB) * SCALE * dw;
    }
  }
  return { ray, mie, total: ray + mie };
};

const base = skyIrradiance(MIE_G, 1);
const discCv = 255;   // E / (pi * RSUN^2) is ~15000x the irradiance; it pins.

console.log(`\nsun elevation ${(SUN_EL * 180 / Math.PI).toFixed(0)}, shipped MIE_G ${MIE_G}\n`);
console.log('  variant                    sky cv at 0.5   1     3    10    30   |  disc contrast  |  sky irradiance');
const variants = [
  ['as shipped', MIE_G, 1.0],
  ['amplitude 0.50', MIE_G, 0.50],
  ['amplitude 0.30', MIE_G, 0.30],
  ['amplitude 0.20', MIE_G, 0.20],
  ['tighter g 0.85', 0.85, 1.0],
  ['tighter g 0.85, amp 0.30', 0.85, 0.30],
  ['tighter g 0.90, amp 0.20', 0.90, 0.20],
  ['no Mie at all', MIE_G, 0.0],
];
for (const [name, g, amp] of variants) {
  const at = [0.5, 1, 3, 10, 30].map((d) => cv(skyAt(d, g, amp, true)));
  const near = at[1];
  const irr = skyIrradiance(g, amp);
  console.log(`  ${name.padEnd(26)} ${at.map((v) => String(v).padStart(4)).join('  ')}   |  ` +
    `${((discCv - near) / near * 100).toFixed(1).padStart(6)}%       |  ` +
    `${irr.total.toFixed(4)}  (${((irr.total / base.total - 1) * 100).toFixed(1)}%)`);
}
/* The reference the user described is "a small hard white disc with a tight warm
   halo, sitting in a sky that is still blue overhead - not a blown-out white
   field". That is a statement about the falloff, not about the disc, and it is
   checkable: how far from the sun does this sky get its blue back? */
console.log('\n  falloff from the sun - is the sky still blue away from it?\n');
console.log('   deg from sun     cv    saturation   hue');
const sat = ([r, g, b]) => { const m = Math.max(r, g, b); return m > 0 ? (m - Math.min(r, g, b)) / m : 0; };
const hueOf = ([r, g, b]) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
for (const d of [1, 5, 15, 30, 60, 90]) {
  const s = skyAt(d, MIE_G, 1);
  const e = forward(s, EXPOSURE);
  console.log(`   ${String(d).padStart(4)}          ${String(cv(s)).padStart(4)}      ` +
    `${sat(e).toFixed(3)}      ${hueOf(e).toFixed(0)}`);
}
console.log(`\n  a 10 cv step over a hard half-degree edge is the visibility threshold;`);
console.log(`  the disc pins at 255, so "sky cv at 1" below 245 is a disc you can see.\n`);
