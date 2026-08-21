/* Write the grit map's channels, and a shaded rendering of it, to a PNG so the
 * layer can be looked at rather than only measured.
 *   node tools/gritview.mjs
 *
 * The metric says nothing about whether a surface reads as sandstone or as
 * television static, and the two sit next to each other in spectrum space: both
 * have energy at the pixel. What separates them is that rock's fine roughness is
 * *modulated* by its coarse structure — grains have flanks, sockets have floors —
 * and that is visible in half a second here and not visible in a number at all.
 */
import { writeFileSync } from 'node:fs';
import { encodeRGB } from './png.mjs';
import { makeGrit } from '../src/textures.js';

const S = 256;
const d = makeGrit(S).image.data;
const PAD = 8, W = S * 2 + PAD * 3, H = S * 2 + PAD * 3;
const out = Buffer.alloc(W * H * 3, 24);

const put = (px, py, fn) => {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = fn(x, y);
      const k = ((py + y) * W + px + x) * 3;
      out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2];
    }
  }
};
const at = (x, y) => ((y + S) % S) * S + ((x + S) % S);

/* tone, cavity, normal as it is stored, and a Lambertian shading at eight
   degrees of elevation, which is this scene's sun */
put(PAD, PAD, (x, y) => { const v = d[at(x, y) * 4]; return [v, v, v]; });
put(PAD * 2 + S, PAD, (x, y) => { const v = d[at(x, y) * 4 + 3]; return [v, v, v]; });
put(PAD, PAD * 2 + S, (x, y) => {
  const i = at(x, y) * 4; return [d[i + 1], d[i + 2], 200];
});

const el = 8 * Math.PI / 180;
const sl = [Math.cos(el) * 0.64, Math.sin(el), Math.cos(el) * 0.76];
put(PAD * 2 + S, PAD * 2 + S, (x, y) => {
  const i = at(x, y) * 4;
  const nx = (d[i + 1] / 255 - 0.5) * 1.9, ny = (d[i + 2] / 255 - 0.5) * 1.9;
  const nz = Math.sqrt(Math.max(1e-4, 1 - nx * nx - ny * ny));
  const ndl = Math.max(0, nx * sl[0] + ny * sl[1] + nz * sl[2]);
  const alb = 0.5 + (d[i] / 255 - 0.5) * 1.55;
  const ao = 0.25 + 0.75 * (d[i + 3] / 255);
  const L = Math.min(1, alb * (ndl + 0.20 * ao) * 0.95);
  const s = Math.pow(L, 1 / 2.2) * 255;
  return [s, s * 0.82, s * 0.66];
});

writeFileSync('shots/gritview.png', encodeRGB(W, H, out));
/* Slope distribution, because "is this shot blast or is it sandstone" is a
   question about how many texels are steeper than about forty degrees. */
let n = 0, over = 0, sum = 0;
for (let i = 0; i < S * S; i++) {
  const nx = (d[i * 4 + 1] / 255 - 0.5) * 1.9, ny = (d[i * 4 + 2] / 255 - 0.5) * 1.9;
  const t = Math.atan2(Math.hypot(nx, ny), Math.sqrt(Math.max(1e-4, 1 - nx * nx - ny * ny)));
  sum += t; n++; if (t > 0.70) over++;
}
/* And the contrast of the shaded panel, against the 11-16% CONTRACT.md records
   for the per-pixel luminance contrast of a weathered sandstone face. Above that
   band this layer is coffee grounds; below it, it is not carrying material. */
let s1 = 0, s2 = 0, m = 0;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const k = ((PAD * 2 + S + y) * W + PAD * 2 + S + x) * 3;
    const v = (out[k] * 0.299 + out[k + 1] * 0.587 + out[k + 2] * 0.114) / 255;
    s1 += v; s2 += v * v; m++;
  }
}
const mu = s1 / m, sd = Math.sqrt(Math.max(0, s2 / m - mu * mu));
console.log(`shots/gritview.png  tone/cavity/normal/shaded`);
console.log(`slope: mean ${(sum / n * 57.3).toFixed(1)} deg, ` +
            `${(over / n * 100).toFixed(1)}% past 40 deg`);
console.log(`shaded: L mean ${mu.toFixed(3)}  contrast ${(sd / mu * 100).toFixed(1)}%` +
            `  (target 11-16)`);
