/* Print every quantity src/atmos.js derives, outside the renderer.
 *
 *   node tools/atmos.mjs
 *
 * The point is auditability. This project's own contract records three separate
 * occasions where a broken instrument sent work confidently in the wrong
 * direction, and a lighting rig derived from a physical model is exactly the
 * kind of thing that can be confidently wrong: an atmosphere with a sign error
 * still produces a plausible orange sky. So the model reports its own numbers —
 * air mass, transmittance per band, colour temperature of the beam, the
 * irradiance on each orientation, the sky-to-sun ratio and the implied
 * shadow-to-sunlit ratio — and they can be checked against published figures
 * before a single pixel is rendered.
 *
 * Checks worth making against the printed output:
 *   air mass at 8 deg          6.8 - 7.0   (Kasten-Young)
 *   beam CCT at 8 deg          3400 - 3900 K
 *   direct normal / horizontal 7.2 : 1     (1/sin 8)
 *   diffuse fraction on horiz. 0.45 - 0.65 at this elevation
 */
import * as atmos from '../src/atmos.js';

const A = atmos.computeAtmosphere();
const f = (x, n = 4) => (x < 0 ? '' : ' ') + x.toFixed(n);
const rgb = (c, n = 4) => `[${f(c[0], n)} ${f(c[1], n)} ${f(c[2], n)} ]`;

/* McCamy's cubic, for reporting only. */
function cct(r, g, b) {
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const s = X + Y + Z, x = X / s, y = Y / s;
  const n = (x - 0.3320) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}
const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: ((h * 60) % 360 + 360) % 360, s: mx > 0 ? d / mx : 0, v: mx };
};
/* Linear -> sRGB, because hue targets in CONTRACT.md are measured on encoded
   pixels and comparing an encoded target with a linear number is meaningless. */
const enc = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const sinEl = Math.sin(atmos.SUN_EL);
const airMass = 1 / (sinEl + 0.50572 * Math.pow(atmos.SUN_EL_DEG + 6.07995, -1.6364));

console.log(`solve time                 ${A.ms.toFixed(0)} ms`);
console.log(`sun elevation              ${atmos.SUN_EL_DEG} deg   azimuth ${atmos.SUN_AZ_DEG} deg`);
console.log(`air mass (Kasten-Young)    ${airMass.toFixed(3)}`);
console.log('');

const s = A.sunRGB, sMax = Math.max(...s);
console.log(`direct beam, normal        ${rgb(s)}  lum ${f(A.sunLum)}`);
console.log(`  normalised               ${rgb(s.map(v => v / sMax))}`);
console.log(`  transmittance R:G:B      ${f(s[0] / s[0], 3)} ${f(s[1] / s[0], 3)} ${f(s[2] / s[0], 3)}`);
console.log(`  CCT                      ${cct(s[0], s[1], s[2]).toFixed(0)} K`);
{
  const e = [enc(s[0] / sMax), enc(s[1] / sMax), enc(s[2] / sMax)];
  const q = hsv(...e);
  console.log(`  as sRGB                  rgb(${e.map(v => Math.round(v * 255)).join(',')})` +
    `   hue ${q.h.toFixed(1)} deg  sat ${q.s.toFixed(3)}`);
}
console.log('');

const THREE = await import('three');
const iH = A.irradiance.horizontal, iS = A.irradiance.vertSun, iA = A.irradiance.vertAnti;
const dH = A.directHorizontal, skyH = A.irradiance.skyHorizontal;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
console.log('irradiance (lum, and rgb).  "env" is sky + escarpment + wash floor');
console.log(`  direct, normal to sun    ${f(lum(s))}  ${rgb(s)}`);
console.log(`  direct, horizontal       ${f(lum(dH))}  ${rgb(dH)}`);
console.log(`  direct, vert facing sun  ${f(lum(s) * Math.cos(atmos.SUN_EL))}`);
console.log(`  sky only, horizontal     ${f(lum(skyH))}  ${rgb(skyH)}`);
console.log(`  env, horizontal          ${f(lum(iH))}  ${rgb(iH)}`);
console.log(`  env, vert toward sun     ${f(lum(iS))}  ${rgb(iS)}`);
console.log(`  env, vert away from sun  ${f(lum(iA))}  ${rgb(iA)}`);
console.log(`  diffuse fraction, horiz. ${f(lum(skyH) / (lum(skyH) + lum(dH)), 3)}`);
console.log('');

/* The headline ratio the brief asks for: a shadowed vertical rock face against
   a sunlit one, both read off the probe that will actually light them, so this
   number is what the renderer is going to do and not a parallel calculation
   that can drift away from it. */
const probeAt = (x, y, z) => {
  const l = Math.hypot(x, y, z);
  const v = A.sh.getIrradianceAt(new THREE.Vector3(x / l, y / l, z / l), new THREE.Vector3());
  return [v.x, v.y, v.z];
};
const sh0 = probeAt(-atmos.SUN_DIR.x, 0, -atmos.SUN_DIR.z);
const li0 = probeAt(atmos.SUN_DIR.x, 0, atmos.SUN_DIR.z)
  .map((v, k) => v + s[k] * Math.cos(atmos.SUN_EL));
console.log(`wash-floor bounce radiance ${rgb(A.groundRGB)}`);
console.log(`shaded vertical  E         ${f(lum(sh0))}  ${rgb(sh0)}`);
console.log(`sunlit vertical  E         ${f(lum(li0))}  ${rgb(li0)}`);
console.log(`shadow : sunlit, linear    ${f(lum(sh0) / lum(li0), 3)}`);
{
  /* CONTRACT's 15-25% is measured as HSV value off photographs, so it is an
     *encoded* ratio. Reported both ways, because confusing the two is a two-stop
     error and the whole point of this file is that such an error be visible. */
  const enc2 = (x) => Math.pow(x, 1 / 2.2);
  console.log(`shadow : sunlit, ~encoded  ${f(enc2(lum(sh0) / lum(li0)), 3)}` +
    `   (target 0.15 - 0.25 as HSV V)`);
  const q = hsv(...sh0.map(v => v / Math.max(...sh0)));
  console.log(`  shadow illuminant hue    ${q.h.toFixed(1)} deg  sat ${q.s.toFixed(3)}`);
  const q2 = hsv(...li0.map(v => v / Math.max(...li0)));
  console.log(`  sunlit illuminant hue    ${q2.h.toFixed(1)} deg  sat ${q2.s.toFixed(3)}`);
}
console.log('');

/* Sky colour at a few directions, encoded, so the dome can be eyeballed as
   numbers: horizon glow, mid, zenith and the Belt of Venus. */
const W = A.SKY_W, H = A.SKY_H;
const at = (phiDeg, elDeg) => {
  const y = Math.sin(elDeg * Math.PI / 180);
  const t = Math.sign(y) * Math.sqrt(Math.abs(y));
  const j = Math.max(0, Math.min(H - 1, Math.round((t * 0.5 + 0.5) * H - 0.5)));
  const i = Math.max(0, Math.min(W - 1, Math.round((phiDeg / 180) * W - 0.5)));
  const o = (j * W + i) * 4;
  return [A.lut[o], A.lut[o + 1], A.lut[o + 2], A.lut[o + 3]];
};
console.log('sky radiance (Rayleigh+MS part; Mie lobe listed separately)');
for (const [name, phi, el] of [
  ['near sun, 4 deg up', 6, 4], ['sun side, 20 deg', 10, 20], ['sun side, 45 deg', 12, 45],
  ['zenith', 90, 88], ['across, 20 deg', 90, 20],
  ['anti-sun horizon', 178, 2], ['anti-sun, 12 deg', 178, 12], ['anti-sun, 30 deg', 178, 30],
]) {
  const c = at(phi, el);
  const mx = Math.max(c[0], c[1], c[2]) || 1;
  const e = [enc(c[0] / mx), enc(c[1] / mx), enc(c[2] / mx)];
  const q = hsv(...e);
  console.log(`  ${name.padEnd(20)} ${rgb(c.slice(0, 3), 5)} mie ${f(c[3], 5)}` +
    `  hue ${q.h.toFixed(0).padStart(4)}  sat ${q.s.toFixed(2)}`);
}
console.log('');

const sh = A.sh.coefficients;
console.log('SH9 (world space, RGB)');
for (let k = 0; k < 9; k++) {
  console.log(`  L${k}  ${f(sh[k].x, 5)} ${f(sh[k].y, 5)} ${f(sh[k].z, 5)}`);
}
/* Irradiance the probe will actually deliver on the six axes, so an unphysical
   negative lobe shows up here rather than as a black patch in the render. */
/* ── what the renderer will actually show ─────────────────────────────────
 *
 * The model above is in physical units and every target in CONTRACT.md is in
 * HSV read off an 8-bit PNG. Converting by eye between the two is a two-stop
 * error waiting to happen — the first pass at this system used a gamma-2.2
 * approximation and mis-stated the shadow ratio by a factor of two, because
 * ACES has a toe and a shoulder and is nothing like a gamma curve at either
 * end. So the tone chain is reproduced here exactly as three implements it,
 * and the surfaces below are put through it with the same albedos their
 * shaders use. A render is then only needed to check geometry and shadowing,
 * not to find out what a number will be.
 */
const { EXPOSURE, DIAG } = await import('../src/sky.js');
const SCALE = DIAG.scale;

function rrt(v) {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m, c) => m.map(r => r[0] * c[0] + r[1] * c[1] + r[2] * c[2]);
/** Scene linear radiance → sRGB 0..1, exactly as three's ACESFilmic path does. */
function tone(c) {
  let v = c.map(x => Math.max(0, x) * EXPOSURE / 0.6);
  v = mul(ACES_IN, v).map(rrt);
  v = mul(ACES_OUT, v).map(x => Math.min(1, Math.max(0, x)));
  return v.map(enc);
}
const show = (label, L) => {
  const p = tone(L);
  const q = hsv(...p);
  console.log(`  ${label.padEnd(26)} rgb(${p.map(x => String(Math.round(x * 255)).padStart(3)).join(',')})` +
    `  V ${q.v.toFixed(3)}  sat ${q.s.toFixed(3)}  hue ${q.h.toFixed(0).padStart(4)}`);
  return q;
};

/* Albedos as the shaders use them: rock.js's hematite-cemented sandstone and
   the wash floor's mixed sand and oxide dirt. */
const ROCK = [0.335, 0.152, 0.082];
const SAND = [0.335, 0.212, 0.140];
const cosAz = Math.abs(Math.sin(atmos.SUN_AZ)) * Math.cos(atmos.SUN_EL);
const refl = (alb, E) => alb.map((a, k) => a * E[k] * SCALE / Math.PI);
const beam = (k, c) => s[k] * c;

console.log('predicted pixels (ACES at exposure ' + EXPOSURE + ', scale ' + SCALE + ')');
const wallLit = show('wall, cos ' + cosAz.toFixed(2) + ' on beam',
  refl(ROCK, probeAt(atmos.SUN_DIR.x, 0, atmos.SUN_DIR.z).map((v, k) => v + beam(k, cosAz))));
const wallShade = show('wall, no beam',
  refl(ROCK, probeAt(-atmos.SUN_DIR.x, 0, -atmos.SUN_DIR.z)));
show('wall, square to beam',
  refl(ROCK, probeAt(atmos.SUN_DIR.x, 0, atmos.SUN_DIR.z).map((v, k) => v + beam(k, Math.cos(atmos.SUN_EL)))));
const floorLit = show('floor, sunlit',
  refl(SAND, probeAt(0, 1, 0).map((v, k) => v + beam(k, Math.sin(atmos.SUN_EL)))));
/* The airlight terrain.js and rock.js add to shadow, in absolute scene units,
   at the mid-distance where their distance ramps are about half open. Kept in
   step with those two files by hand; if they diverge the shadow hue printed
   here is a fiction, which is the only thing about this tool that can rot. */
const AIRLIGHT = [0, 0, 0];   // removed from terrain.js and rock.js
show('floor, shadowed', refl(SAND, probeAt(0, 1, 0)).map((v, k) => v + AIRLIGHT[k]));
show('  same, no airlight', refl(SAND, probeAt(0, 1, 0)));
show('rock, shadowed + air', refl(ROCK, probeAt(-atmos.SUN_DIR.x, 0, -atmos.SUN_DIR.z))
  .map((v, k) => v + AIRLIGHT[k]));
show('overhang underside', refl(SAND, probeAt(0, -1, 0)));
console.log(`  shadow : sunlit on rock    ${(wallShade.v / wallLit.v).toFixed(3)}` +
  `   (target 0.15 - 0.25)`);
console.log(`  wall lit V ${wallLit.v.toFixed(3)} (target 0.59-0.73)   ` +
  `floor lit V ${floorLit.v.toFixed(3)} sat ${floorLit.s.toFixed(3)} (sat target 0.47-0.56)`);
console.log('');
console.log('predicted sky');
for (const [name, phi, el] of [
  ['3 deg from sun', 3, 8], ['gap, 15 deg up', 8, 15], ['gap, 30 deg up', 14, 30],
  ['zenith', 90, 85], ['anti-sun horizon', 178, 2], ['anti-sun, 25 deg', 178, 25],
]) {
  const c = at(phi, el);
  const g = Math.cos((phi * Math.PI) / 180) * Math.cos(atmos.SUN_EL) * Math.cos(el * Math.PI / 180)
    + Math.sin(atmos.SUN_EL) * Math.sin(el * Math.PI / 180);
  const gg = 0.76 * 0.76;
  const ph = (1 - gg) / (4 * Math.PI * Math.pow(Math.max(1e-4, 1 + gg - 2 * 0.76 * g), 1.5));
  show(name, [0, 1, 2].map(k => (c[k] + c[3] * ph * A.mieTintRGB[k]) * SCALE));
}
console.log('');

const N = [['+Y up', 0, 1, 0], ['-Y down', 0, -1, 0],
['toward sun', atmos.SUN_DIR.x, 0, atmos.SUN_DIR.z],
['away from sun', -atmos.SUN_DIR.x, 0, -atmos.SUN_DIR.z],
['across', 1, 0, 0],
['45 up, away', -atmos.SUN_DIR.x, 1, -atmos.SUN_DIR.z],
['45 down, away', -atmos.SUN_DIR.x, -1, -atmos.SUN_DIR.z]];
console.log('probe irradiance by normal');
for (const [name, x, y, z] of N) {
  const v = probeAt(x, y, z);
  const q = hsv(...v.map(c => c / Math.max(...v)));
  console.log(`  ${name.padEnd(16)} ${rgb(v)}  lum ${f(lum(v))}  hue ${q.h.toFixed(0).padStart(4)}`);
}
