/* Why is shaded rock more saturated and redder than sunlit rock?
 *
 *   node tools/shadechroma.mjs
 *
 * The whole-scene critique measures lit wall at saturation 0.59 hue 5, and shaded
 * wall at 0.74 hue 0 — shade more saturated and *warmer* than light, which is the
 * opposite of the physics. Real shade on red rock is skylit, and the sky is the
 * bluest thing in the frame, so shade must desaturate and cool.
 *
 * Saturation of shaded rock is the saturation of albedo times fill, so the sign of
 * the error is a statement about the fill's chroma, not about the rock's. Red rock
 * under a violet fill loses saturation, because the fill's blue partly fills in
 * the channel the albedo is starving. Red rock under a *warm* fill gains it. So
 * shade coming out more saturated than light means the fill arriving on a wall
 * face is warm, and the question this answers is which term makes it warm.
 *
 * The probe is one integral over sky, wash floor and opposite wall (src/sky.js),
 * and only the first of those three is blue. This evaluates it exactly as the
 * shader does — including the height lerp in installProbeHeightLerp — and then
 * knocks out the two bounce terms in turn to attribute the cast.
 */
import * as THREE from 'three';
import { computeAtmosphere, SUN_DIR } from '../src/atmos.js';

const SCALE = 19;
const ALB = [0.2890, 0.1617, 0.1211];   // area-weighted wall mean, tools/wallalbedo.mjs

const sat = ([r, g, b]) => { const m = Math.max(r, g, b); return m > 0 ? (m - Math.min(r, g, b)) / m : 0; };
const hue = ([r, g, b]) => {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d <= 0) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
};
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** three's shGetIrradianceAt: SH9 dotted with the cosine-lobe basis. */
function irr(sh, n) {
  const c = sh.coefficients, [x, y, z] = n;
  const b = [0.886227, 1.023328 * y, 1.023328 * z, 1.023328 * x,
    0.858086 * x * y, 0.858086 * y * z, 0.743125 * z * z - 0.247708,
    0.858086 * x * z, 0.429043 * (x * x - y * y)];
  const o = [0, 0, 0];
  for (let k = 0; k < 9; k++) { o[0] += c[k].x * b[k]; o[1] += c[k].y * b[k]; o[2] += c[k].z * b[k]; }
  return o;
}

/** s4ProbeOpen, transcribed from the installed GLSL so the two cannot drift. */
function open(wy, ny) {
  const a = Math.min(1, Math.max(0, wy * 0.018692));
  const b = Math.min(1, Math.max(0, wy * 0.020619));
  const tl = a * Math.sqrt(a);
  const tu = b * Math.sqrt(Math.sqrt(Math.sqrt(b)));
  const t = Math.min(1, Math.max(0, ny));
  return tl * (1 - t) + tu * t;
}

/** The fill the shader actually applies at world height wy on normal n. */
function fill(A, n, wy) {
  const c = irr(A.sh, n), o = irr(A.shOpen, n), f = open(wy, n[1]);
  return [0, 1, 2].map((k) => SCALE * (c[k] + (o[k] - c[k]) * f));
}

const lateral = (() => {
  /* Away from the sun and horizontal: the shaded wall face the critique measures. */
  const h = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize().negate();
  return [h.x, 0, h.z];
})();

const A = computeAtmosphere();

console.log('\n--- the fill arriving on a shaded wall face, by height ---\n');
console.log('   height   fill R,G,B                       B/R    fill hue   rock sat   rock hue');
for (const wy of [2, 5, 10, 20, 40, 70]) {
  const f = fill(A, lateral, wy);
  const rock = [0, 1, 2].map((k) => ALB[k] * f[k] / Math.PI);
  console.log(`   ${String(wy).padStart(4)} m   ` +
    `${f.map((v) => v.toFixed(4)).join(' ')}   ${(f[2] / f[0]).toFixed(3)}   ` +
    `${hue(f).toFixed(0).padStart(6)}     ${sat(rock).toFixed(3)}      ${hue(rock).toFixed(1).padStart(5)}`);
}

/* And the sunlit reference, so lit-versus-shade is computed the same way. The
   critique's lit figure is a whole-region mean over faces at many incidences, so
   sweep it rather than pick one. */
console.log('\n--- sunlit rock at the same 20 m, for comparison ---\n');
console.log('   cos(inc)   rock sat   rock hue    V(approx)');
{
  const f = fill(A, lateral, 20);
  for (const ci of [0.05, 0.15, 0.35, 0.6, 0.9]) {
    const e = [0, 1, 2].map((k) => A.sunRGB[k] * SCALE * ci + f[k]);
    const rock = [0, 1, 2].map((k) => ALB[k] * e[k] / Math.PI);
    console.log(`   ${ci.toFixed(2).padStart(7)}    ${sat(rock).toFixed(3)}      ` +
      `${hue(rock).toFixed(1).padStart(5)}      ${lum(rock).toFixed(3)}`);
  }
}

console.log('\n--- attribution: knock out each bounce term, read the wall fill at 20 m ---\n');
console.log('   variant                       fill R,G,B                    B/R    hue    rock sat');
const variants = [
  ['as shipped', {}],
  ['opposite wall black', { wallAlbedo: [0, 0, 0] }],
  ['wash floor unlit', { floorSunlit: 0 }],
  ['both bounces off', { wallAlbedo: [0, 0, 0], floorSunlit: 0 }],
  ['wall sky-vis 0.20 -> 0.50', { wallSkyVis: 0.5 }],
  /* And inside the opposite wall's own radiance, which of its three sources is
     doing the reddening: the sun on its crest, the sky it can see, or the wash
     floor it stands over at pi * 0.5. */
  ['  its direct sun off', { wallLit: 0 }],
  ['  its floor bounce off', { floorView: 0 }],
  ['  its sky term off', { wallSkyVis: 0 }],
];
for (const [name, over] of variants) {
  const V = computeAtmosphere(over);
  const f = fill(V, lateral, 20);
  const rock = [0, 1, 2].map((k) => ALB[k] * f[k] / Math.PI);
  console.log(`   ${name.padEnd(28)}  ${f.map((v) => v.toFixed(4)).join(' ')}   ` +
    `${(f[2] / f[0]).toFixed(3)}  ${hue(f).toFixed(0).padStart(5)}    ${sat(rock).toFixed(3)}`);
}

/* The exchange rate for the one lever I own. The height lerp mixes the measured
   skyline against the same sky with the escarpment removed, so the open fraction
   is the sky's share of a wall face's hemisphere. Sweeping it directly, rather
   than sweeping height, separates "how much sky would fix this" from "how much
   sky the geometry allows" — the second is a raycast question and the first is
   not. Rendered shaded rock came in at sat 0.654 hue 10.9 against this model's
   0.666 and 8.0 at the shipped fraction, so the column below is predictive. */
console.log('\n--- sky aperture on a wall face: what it buys, and where it stops ---\n');
console.log('   open frac   fill R,G,B                    B/R    rock sat   rock hue   fill lum');
for (const f of [0.229, 0.35, 0.5, 0.65, 0.8, 1.0]) {
  const c = irr(A.sh, lateral), o = irr(A.shOpen, lateral);
  const fl = [0, 1, 2].map((k) => SCALE * (c[k] + (o[k] - c[k]) * f));
  const rock = [0, 1, 2].map((k) => ALB[k] * fl[k] / Math.PI);
  console.log(`   ${f.toFixed(3).padStart(7)}     ${fl.map((v) => v.toFixed(4)).join(' ')}   ` +
    `${(fl[2] / fl[0]).toFixed(3)}     ${sat(rock).toFixed(3)}     ${hue(rock).toFixed(1).padStart(5)}    ` +
    `${lum(fl).toFixed(3)}${f === 0.229 ? '   <- as shipped, 20 m' : ''}`);
}
/* And the ceiling on hue, which is the part the fill cannot reach. Rock hue goes
   cool only once the light's B/G clears the albedo's own G/B of 1.335, and the
   fully open sky arrives at 1.285. So the sign of the hue error is not mine to
   fix by opening the aperture; it needs a term that is not multiplied by rock
   albedo, which means airlight in front of the rock rather than fill on it. */
{
  const o = irr(A.shOpen, lateral).map((v) => v * SCALE);
  console.log(`\n   fully open sky has B/G ${(o[2] / o[1]).toFixed(3)}; ` +
    `rock albedo needs B/G above ${(ALB[1] / ALB[2]).toFixed(3)} before rock hue turns cool.`);
}

console.log('\n--- the same fill on an upward normal, which is what the wash floor gets ---\n');
console.log('   height   fill R,G,B                       B/R    hue');
for (const wy of [0, 2, 20]) {
  const f = fill(A, [0, 1, 0], wy);
  console.log(`   ${String(wy).padStart(4)} m   ${f.map((v) => v.toFixed(4)).join(' ')}   ` +
    `${(f[2] / f[0]).toFixed(3)}   ${hue(f).toFixed(0).padStart(5)}`);
}
console.log('');
