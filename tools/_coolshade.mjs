/* Why is the shade brown when the illuminant is blue?
 *
 *   node tools/_coolshade.mjs
 *
 * Two reviewers arrived at the same complaint from opposite ends: the shaded
 * banks are the same red-brown hue as the lit rock, only darker, and there is no
 * cool rung anywhere in the scene. The brief asks for violet shadows and it is
 * one of the handful of things that make a Sedona sunset photograph read as one.
 *
 * The obvious hypothesis - that the skylight fill is grey - is already known to
 * be false. atmos.js reports the fill on a face turned away from the sun at hue
 * 224 with B/R 1.29, which is a blue illuminant by any reading. So if the
 * illuminant is blue and the result is brown, the loss is between them, and
 * there are only two candidates: the escarpment bounce diluting the dome before
 * it arrives, or the rock's own albedo undoing it after.
 *
 * That second one is worth stating as arithmetic before measuring anything,
 * because it decides what "cool shade" can even mean here. Shade goes plum when
 * the reflected blue channel overtakes the reflected green - that is the
 * difference between a brown and a violet-grey. Reflected B/G is the
 * illuminant's B/G times the albedo's, and the escarpment albedo has G/B = 1.34.
 * So no illuminant with B/G below 1.34 can make this rock read as anything but
 * warm, however blue it looks in isolation. A dome at B/R 1.29 is nowhere near
 * that.
 *
 * So this reports, for each of the two probes and for several normals: the
 * illuminant's own chroma, the chroma it produces on rock, and - the number that
 * matters - the same figures for the sky term alone, with the escarpment lifted
 * out. That last column is the ceiling. If sky-only rock is still brown then the
 * fill is not the lever and no amount of aperture will help; if sky-only rock is
 * plum, the escarpment's weight is the lever and it is measurable.
 */
import { computeAtmosphere, GROUND_ALBEDO, SUN_DIR } from '../src/atmos.js';

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: mx > 0 ? d / mx : 0, v: mx };
};

/* Irradiance from an SH9 probe for a normal, three's own convolution. */
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

const A = computeAtmosphere();
const ROCK = [0.2890, 0.1617, 0.1211];

/* The lateral bearings that matter: away from the sun is what a shaded face in
   this corridor is turned toward, and it is the direction the critique is
   looking at. */
const sunH = [SUN_DIR.x, 0, SUN_DIR.z];
{ const l = Math.hypot(sunH[0], sunH[2]); sunH[0] /= l; sunH[2] /= l; }
const NORMALS = [
  ['up', [0, 1, 0]],
  ['away from sun', [-sunH[0], 0, -sunH[2]]],
  ['toward sun', [sunH[0], 0, sunH[2]]],
  ['bank, 45 up-away', [-sunH[0] * 0.707, 0.707, -sunH[2] * 0.707]],
];

const line = (lab, e) => {
  const refl = [e[0] * ROCK[0], e[1] * ROCK[1], e[2] * ROCK[2]];
  const a = hsv(...e), b = hsv(...refl);
  return `  ${lab.padEnd(22)} illum hue ${a.h.toFixed(0).padStart(4)}  B/G ${(e[2] / e[1]).toFixed(3)}` +
    `  B/R ${(e[2] / e[0]).toFixed(3)}   |   on rock hue ${b.h.toFixed(0).padStart(4)}` +
    `  sat ${b.s.toFixed(3)}  B/G ${(refl[2] / refl[1]).toFixed(3)}` +
    `  ${refl[2] > refl[1] ? 'PLUM' : 'brown'}`;
};

console.log('\n  the canyon probe (A.sh) - what a surface on the wash floor gets');
for (const [lab, n] of NORMALS) console.log(line(lab, irr(A.sh, n)));
console.log('\n  the open probe (A.shOpen) - escarpment lifted, same ground half');
for (const [lab, n] of NORMALS) console.log(line(lab, irr(A.shOpen, n)));

/* The ceiling: escarpment gone AND the warm ground bounce gone, so the only
   illuminant left is the dome. This is what "lit by skylight alone" means, and
   nothing in this scene can be cooler than it. */
const clean = computeAtmosphere({
  wallAlbedo: [0, 0, 0], floorSunlit: 0, wallLit: 0,
});
console.log('\n  sky alone, no escarpment and no ground bounce - the ceiling');
for (const [lab, n] of NORMALS) console.log(line(lab, irr(clean.shOpen, n)));

console.log('\n  rock albedo G/B is ' + (ROCK[1] / ROCK[2]).toFixed(3) +
  ', so the illuminant needs B/G above that for shade to read plum at all');
console.log('  ground albedo (the wash floor itself) G/B is ' +
  (GROUND_ALBEDO[1] / GROUND_ALBEDO[2]).toFixed(3) + ', needing B/G above that');
