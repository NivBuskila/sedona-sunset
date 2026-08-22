/* What fraction of a facet's fill is actually sky, as a function of its normal?
 *
 * WHY THIS MATTERS. scatter.js computes a per-instance occlusion `aoI` that is
 * explicitly and correctly a SKY-VISIBILITY model - its own comment says "how
 * much sky this stone can actually see" and "an embedded granule on a bank sees
 * perhaps a third of the sky". It is then applied to the whole of
 * reflectedLight.indirectDiffuse, which is the summed probe: sky PLUS
 * escarpment bounce PLUS ground bounce.
 *
 * On an up-facing facet that is nearly harmless, because the fill there is
 * mostly sky. On a lateral or downward facet it is not, because the sky share
 * collapses and the fill becomes escarpment and ground bounce - light that
 * arrives from beside and below and is not what a sky-visibility number
 * describes. The error is therefore concentrated on exactly the facets the
 * critic reports as rendering black.
 *
 * This measures the share exactly, from the decomposed probes, so any
 * correction is derived rather than guessed.
 *
 *   node tools/_skyshare.mjs
 */
import * as THREE from 'three';
import { computeAtmosphere } from '../src/atmos.js';

const A = computeAtmosphere({ decompose: true });
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function irr(sh, n) {
  const out = new THREE.Vector3();
  sh.getIrradianceAt(n, out);
  return [out.x, out.y, out.z];
}

// sun azimuth in world XZ, to build an "away from sun" lateral normal
const sunAz = A.sunAz !== undefined ? A.sunAz : null;

const normals = [];
for (const el of [90, 70, 50, 30, 15, 0, -15, -30, -50, -90]) {
  const r = el * Math.PI / 180;
  // facing away from the sun in azimuth (worst case, and the reported one)
  normals.push({ el, n: new THREE.Vector3(-Math.cos(r) * 0.0, Math.sin(r), -Math.cos(r)).normalize() });
}

console.log('fill composition by facet elevation (normal tilted away from sun)');
console.log('');
console.log('  elev     total    sky%   wall%   grnd%    non-sky%');
const rows = [];
for (const { el, n } of normals) {
  const t = lum(irr(A.sh, n));
  const s = lum(irr(A.shSky, n));
  const w = lum(irr(A.shWall, n));
  const g = lum(irr(A.shGround, n));
  const sum = s + w + g;
  const sh = s / sum, wh = w / sum, gh = g / sum;
  rows.push({ el, t, sh, wh, gh });
  console.log(`  ${String(el).padStart(4)}   ${t.toFixed(5)}   ${(100 * sh).toFixed(1).padStart(5)}  ${(100 * wh).toFixed(1).padStart(6)}  ${(100 * gh).toFixed(1).padStart(6)}    ${(100 * (1 - sh)).toFixed(1).padStart(5)}`);
}

console.log('');
console.log('The sky-visibility occlusion is entitled to scale the sky column.');
console.log('It is currently applied to all three.');
console.log('');

/* Fit a cheap function of n.y to the sky share, so the shader can carry it
   without three probes. n.y = sin(elevation). */
console.log('sky share against n.y, and a smoothstep fit the shader can afford:');
console.log('   n.y     measured   fit    err');
let worst = 0;
for (const r of rows) {
  const ny = Math.sin(r.el * Math.PI / 180);
  // fit: sky share rises with up-ness
  const t = Math.min(1, Math.max(0, (ny + 0.55) / 1.55));
  const fit = 0.16 + (0.78 - 0.16) * (t * t * (3 - 2 * t));
  const err = fit - r.sh;
  worst = Math.max(worst, Math.abs(err));
  console.log(`  ${ny.toFixed(3).padStart(6)}    ${r.sh.toFixed(3)}    ${fit.toFixed(3)}  ${err >= 0 ? '+' : ''}${err.toFixed(3)}`);
}
console.log(`  worst absolute error ${worst.toFixed(3)}`);
