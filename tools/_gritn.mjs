/* _gritn.mjs — the binary-field guard for the grit layer's normal channels.
 *
 *   node tools/_gritn.mjs [strength ...]
 *
 * terrain.js has begun reading makeGrit's G,B channels as a tangent-space normal
 * on far ground, at GRIT_N strength. This is the offline check that runs before
 * the render, because the failure it guards against is one the structure metric
 * rewards: steep grain normals under a low sun swing a texel from fully lit to
 * fully shadowed, the field goes binary, hf/lf improves, and the surface reads as
 * salt and pepper. The predictor on record is RMS tangent slope with the trap at
 * 0.8, plus the terminator-crossing fraction from _rakeprobe.
 *
 * The grit layer is the one map in the shader that is *not* saved by the mip
 * chain: gLod/gSc hold it at slightly under a texel per pixel at every distance,
 * which is the property that makes it the only candidate for detail at 125 m and
 * equally the reason it can spring the trap at 125 m. So this reads mip 0 and
 * that is not a worst case, it is the shipped case.
 */
import { makeGrit } from '../src/textures.js';

const SIZE = 256;
const SUN_EL = 15 * Math.PI / 180;
const STRENGTHS = process.argv.slice(2).map(Number).filter(n => n > 0);
const KS = STRENGTHS.length ? STRENGTHS : [0.6, 0.8, 1.0, 1.3, 1.9];

const tex = makeGrit(SIZE);
const D = tex.image.data;

/* The shader's reconstruction, verbatim: vec3((gr.gb - 0.5) * GRIT_N, 1.0),
   normalized. rock.js has always used 1.9 here on a close face. */
function stats(k) {
  let s2 = 0, mx = 0, n = 0;
  let dark = 0, grazing = 0;
  /* Worst realistic base: a slope facing the sun at a 15 degree grazing angle,
     so the unperturbed surface sits at N.L = sin(15 deg) and a perturbation of
     the same order is what carries it across the terminator. */
  const Lz = Math.sin(SUN_EL), Lx = Math.cos(SUN_EL), Ly = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = (D[i * 4 + 1] / 255 - 0.5) * k;
    const y = (D[i * 4 + 2] / 255 - 0.5) * k;
    const inv = 1 / Math.sqrt(x * x + y * y + 1);
    const sl = Math.hypot(x, y);
    s2 += sl * sl; if (sl > mx) mx = sl; n++;
    const ndl = (-x * Lx - y * Ly + Lz) * inv;
    if (ndl <= 0) dark++;
    if (ndl > 0 && ndl < 0.05) grazing++;
  }
  return {
    rms: Math.sqrt(s2 / n), max: mx,
    dark: 100 * dark / n, graz: 100 * grazing / n,
  };
}

console.log('grit normal (G,B) as terrain now reads it, at mip 0 — the shipped case');
console.log('trap on record: RMS tangent slope 0.8. A jump in "past terminator" is');
console.log('the binary field; those texels take a floor value and stay there.\n');
console.log('  GRIT_N   RMS slope   max slope   past terminator   within 3 deg');
for (const k of KS) {
  const s = stats(k);
  const flag = s.rms >= 0.8 ? '  <-- TRAP' : '';
  console.log(`  ${k.toFixed(2).padStart(5)}    ${s.rms.toFixed(4)}      ${s.max.toFixed(3).padStart(6)}` +
    `      ${s.dark.toFixed(1).padStart(5)}%           ${s.graz.toFixed(1).padStart(5)}%${flag}`);
}
console.log('\nfor scale: rock.js reads the same channels at 1.9 on a close face,');
console.log('where the sun is not grazing and the trap geometry does not apply.');
