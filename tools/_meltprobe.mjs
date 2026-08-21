/* Geometry or texture? The midground "melting" question, answered offline.
 *
 * A user walking the scene described the 30-60 m wash floor as "melting" —
 * smooth brown mounds with nothing in them, between a crisp near field and sharp
 * far walls. "Melting" is a word about *form*, not about surface, so the
 * hypothesis under test is that the shading normal at that range has no
 * high-frequency content left in it whatever the albedo is doing.
 *
 * Three questions, in the order they decide the answer:
 *
 *   1. What footprint does a midground pixel actually have, on each axis? The
 *      whole argument turns on the anisotropy, so it is computed from the real
 *      camera rather than quoted.
 *   2. What survives of the dirt *normal* map at that footprint? _dirtprobe.mjs
 *      established that the albedo's shape survives; a surviving albedo over a
 *      flattened normal is precisely "correctly coloured, melted shape", so the
 *      normal has to be measured separately and in its own units — RMS tangent
 *      slope, because that is what shading responds to.
 *   3. Does the height field contain detail the mesh is throwing away? If it
 *      does, the geometry can be made to carry the band. If the field is itself
 *      smooth below the grid spacing, then nothing is being lost by the mesh and
 *      the missing form was never authored at all — a different problem with a
 *      different fix.
 *
 *   node tools/_meltprobe.mjs
 */
import { makeDirt } from '../src/textures.js';
import { Terrain } from '../src/terrain.js';
import { WashPath } from '../src/path.js';

/* ── 1. the footprint of a midground pixel ─────────────────────────────────
   Camera is 58 deg vertical over 900 rows at 1600x900, eye 1.65 m, pitch 0.
   Across the view a pixel subtends its angle at the slant range. Along the view
   that same angle is projected onto ground that is nearly edge-on, so it is
   divided by the sine of the depression angle — which is what makes the two
   axes differ by more than an order of magnitude and is the whole story. */
const EYE = 1.65, FOV_V = 58 * Math.PI / 180, ROWS = 900, COLS = 1600;
const ASPECT = 16 / 9;
const angV = FOV_V / ROWS;
const angH = 2 * Math.atan(Math.tan(FOV_V / 2) * ASPECT) / COLS;
const foot = (d) => {
  const slant = Math.hypot(d, EYE);
  const dep = Math.asin(EYE / slant);
  return { across: angH * slant, along: angV * slant / Math.sin(dep) };
};

const TILE = 2.6, TEX = 1024, TEXEL = TILE / TEX;
console.log('1. pixel footprint on the wash floor, and what it is in dirt texels');
console.log('   (dirt map tiles at 2.6 m over 1024, so one texel is 2.54 mm)\n');
console.log('   range    across      along    aniso   across    along');
console.log('                                          texels   texels');
const RANGES = [8, 15, 30, 45, 60, 90];
const FP = {};
for (const d of RANGES) {
  const f = foot(d);
  FP[d] = f;
  console.log(`   ${String(d).padStart(4)} m  ${(f.across * 1000).toFixed(0).padStart(6)} mm  ` +
    `${(f.along * 1000).toFixed(0).padStart(7)} mm  ${(f.along / f.across).toFixed(0).padStart(5)}:1  ` +
    `${(f.across / TEXEL).toFixed(0).padStart(7)}  ${(f.along / TEXEL).toFixed(0).padStart(7)}`);
}

/* ── 2. what survives of the normal map ────────────────────────────────────
   A mip level is a box average of the *encoded* normal, and the shader
   renormalises whatever comes back, so the honest simulation is: average the
   encoded vectors over the footprint box, renormalise, and measure the tangent
   slope that is left. Slope rather than angle because slope is what a shading
   term is linear in near the reference direction, and RMS rather than mean
   because the sign is meaningless. */
function slopeStats(N, size, bx, by) {
  const w = Math.max(1, Math.floor(size / bx)), h = Math.max(1, Math.floor(size / by));
  let s2 = 0, n = 0, mx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < by; j++) {
        const sy = (y * by + j) % size;
        for (let i = 0; i < bx; i++) {
          const k = (sy * size + ((x * bx + i) % size)) * 4;
          ax += N[k] / 255 * 2 - 1; ay += N[k + 1] / 255 * 2 - 1; az += N[k + 2] / 255 * 2 - 1;
        }
      }
      const L = Math.hypot(ax, ay, az) || 1e-9;
      const sl = Math.hypot(ax / L, ay / L) / Math.max(1e-6, az / L);
      s2 += sl * sl; n++; if (sl > mx) mx = sl;
    }
  }
  return { rms: Math.sqrt(s2 / n), max: mx, w, h };
}

const dirt = makeDirt(TEX);
const N = dirt.normal.image.data;
console.log('\n2. dirt normal map: RMS tangent slope surviving the footprint box');
console.log('   "delivered" applies the shader\'s own 0.16 + 0.84*grainF fade, which');
console.log('   at any footprint past 40 mm is a flat multiply by 0.16.\n');
console.log('   case                                box        RMS slope   delivered');
const mip0 = slopeStats(N, TEX, 1, 1);
console.log(`   mip 0                            ${'1x1'.padEnd(11)} ${mip0.rms.toFixed(4)}      ${mip0.rms.toFixed(4)}`);
for (const d of RANGES) {
  const bx = Math.max(1, Math.round(FP[d].across / TEXEL));
  const by = Math.max(1, Math.round(FP[d].along / TEXEL));
  const grainF = 1 - smoothstep(0.007, 0.040, Math.max(FP[d].across, FP[d].along));
  const fade = 0.16 + 0.84 * grainF;
  /* Perfect anisotropy: only the across axis is resolved sharply, the along axis
     is averaged over its full extent. This is the best any sampler can do. */
  const an = slopeStats(N, TEX, Math.min(bx, TEX), Math.min(by, TEX));
  /* As rendered: the normal gets no anisotropic bias at all, so both axes are
     filtered at the long one. */
  const iso = slopeStats(N, TEX, Math.min(by, TEX), Math.min(by, TEX));
  console.log(`   ${String(d).padStart(3)} m perfect aniso              ` +
    `${`${bx}x${by}`.padEnd(11)} ${an.rms.toFixed(4)}      ${(an.rms * fade).toFixed(4)}`);
  console.log(`   ${String(d).padStart(3)} m as rendered (isotropic)    ` +
    `${`${by}x${by}`.padEnd(11)} ${iso.rms.toFixed(4)}      ${(iso.rms * fade).toFixed(4)}`);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ── 3. is the mesh throwing height-field detail away? ─────────────────────
   The mesh is 0.20 m across the wash in the core and 0.42 m along it. If the
   height function has real content below that spacing then refining the mesh
   recovers form directly, with no filtering to fight. If it does not, the mesh
   is faithful and the missing form was never authored.

   Measured as RMS slope over a baseline, sampled across the wash where the
   banks are — the slope a surface presents over 5 cm against the slope it
   presents over 20 cm tells you whether there is anything between them. */
const path = new WashPath();
const terrain = new Terrain(path);
console.log('\n3. height field: RMS across-wash slope at decreasing baselines');
console.log('   sampled over 30-60 m up-wash, the band that reads as melted.');
console.log('   If the short baselines carry no more slope than 0.20 m does, the');
console.log('   grid is faithful and there is nothing there for a finer mesh.\n');
console.log('   baseline     RMS slope   ratio to 0.20 m');
const q = {};
const BASES = [0.05, 0.10, 0.20, 0.40, 0.80, 1.60];
const ref = {};
for (const b of BASES) {
  let s2 = 0, n = 0;
  for (let zi = 0; zi < 60; zi++) {
    const z = -30 - zi * 0.5;
    for (let xi = 0; xi < 120; xi++) {
      const x = -14 + xi * 0.24;
      const h0 = terrain.heightAt(x - b / 2, z);
      const h1 = terrain.heightAt(x + b / 2, z);
      const sl = (h1 - h0) / b;
      s2 += sl * sl; n++;
    }
  }
  ref[b] = Math.sqrt(s2 / n);
}
for (const b of BASES) {
  console.log(`   ${b.toFixed(2)} m       ${ref[b].toFixed(4)}      ${(ref[b] / ref[0.20]).toFixed(3)}`);
}

/* Mesh spacing against the pixel, which is the number that decides whether the
   grid is the limit or the screen is. */
console.log('\n   mesh spacing against the pixel, across the view:');
for (const d of [30, 45, 60]) {
  const px = FP[d].across;
  console.log(`   ${String(d).padStart(3)} m: grid 0.20 m = ${(0.20 / px).toFixed(1)} px per edge; ` +
    `one pixel is ${(px * 1000).toFixed(0)} mm of ground`);
}
