/* What ratio SHOULD a shaded side face bear to a sunlit top face?
 *
 * The critic reports the side faces of flat clasts as "pure black". They are
 * not black - juniper measures rgb(20,9,8) - and their chroma already matches
 * the analytic anti-sun facet to within a couple of degrees of hue. So the
 * open question is purely magnitude, and this answers it from the real
 * atmosphere rather than from the frame.
 *
 * Reports the irradiance the atmosphere delivers to:
 *   - a horizontal up facet in sun   (direct beam + probe)
 *   - a vertical facet facing away from the sun (probe only, no beam)
 * and the ratio between them, which is what "how dark should the side be"
 * means. Then applies the shader's own occlusion chain to the side face, so
 * the comparison is against what the material will actually deliver rather
 * than against the raw atmosphere.
 *
 *   node tools/_faceratio.mjs
 */
import { computeAtmosphere, GROUND_ALBEDO, SUN_EL_DEG } from '../src/atmos.js';

const A = computeAtmosphere({ decompose: true });
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const eH = A.irradiance.horizontal;
const eVanti = A.irradiance.vertAnti;
const eVsun = A.irradiance.vertSun;
const dH = A.directHorizontal;

console.log(`sun elevation ${SUN_EL_DEG} deg, ground albedo ${GROUND_ALBEDO.map(v => v.toFixed(3)).join(' ')}`);
console.log('');
console.log('irradiance delivered by the atmosphere (linear, same scale):');
console.log(`  direct beam on horizontal      ${dH.map(v => v.toFixed(4)).join(' ')}   lum ${lum(dH).toFixed(4)}`);
console.log(`  sky+bounce fill on horizontal  ${eH.map(v => v.toFixed(4)).join(' ')}   lum ${lum(eH).toFixed(4)}`);
console.log(`  fill on vertical facing sun    ${eVsun.map(v => v.toFixed(4)).join(' ')}   lum ${lum(eVsun).toFixed(4)}`);
console.log(`  fill on vertical facing away   ${eVanti.map(v => v.toFixed(4)).join(' ')}   lum ${lum(eVanti).toFixed(4)}`);
console.log('');

const topTotal = lum(dH) + lum(eH);
const sideRaw = lum(eVanti);
console.log(`sunlit horizontal top total   : ${topTotal.toFixed(4)}`);
console.log(`shaded anti-sun vertical      : ${sideRaw.toFixed(4)}`);
console.log(`RATIO side/top, atmosphere    : ${(100 * sideRaw / topTotal).toFixed(2)}%`);
console.log('');

/* Now the shader chain. On the side face:
 *   contact = mix(0.46, 1.0, smoothstep(-0.40, 0.06, vUp)), vUp = 0 on a vertical
 *   occ     = max(mesoAO * contact, 0.34)
 * mesoAO = vAO * mix(1.0, 0.86, vMeso); vAO for a coarse clast runs low.
 */
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
console.log('shader occlusion chain applied to the side face:');
for (const vUp of [0.0, -0.2, -0.4]) {
  const contact = 0.46 + (1.0 - 0.46) * smoothstep(-0.40, 0.06, vUp);
  for (const vAO of [0.90, 0.60, 0.40]) {
    const meso = vAO * 0.86;
    const occ = Math.max(meso * contact, 0.34);
    const delivered = sideRaw * occ;
    console.log(`  vUp=${vUp.toFixed(2)} vAO=${vAO.toFixed(2)}  contact=${contact.toFixed(3)} meso=${meso.toFixed(3)} -> occ=${occ.toFixed(3)}  side/top=${(100 * delivered / topTotal).toFixed(2)}%`);
  }
}
console.log('');
console.log('DO NOT compare these linear figures against a ratio read off a PNG.');
console.log('The frame is ACES-tonemapped and sRGB-encoded, and the toe compresses a');
console.log('ratio in this band by about 6x. tools/_toneratio.mjs inverts the curve so');
console.log('the two can be compared; doing it by eye gives an error of that size and');
console.log('points at a shading defect that is not there.');
