/* Does the dark population carry any detail, or is it crushed flat?
 *
 * The hue measurement showed bounce arrives on these facets and carries colour,
 * so "a term reached zero" is wrong as stated. The remaining way a facet reads
 * as a void rather than as a dark surface is that its detail is gone: shading
 * detail scales with the light level, so at L=11 a +/-10% albedo mottle spans
 * about one 8-bit code and quantises away. The surface is then a flat fill.
 *
 * Measures, separately for the dark and lit populations of a crop:
 *   - absolute local contrast (mean |neighbour difference|), in codes
 *   - RELATIVE local contrast (that divided by the local mean)
 *   - how many distinct 8-bit codes the population actually uses
 *
 * Relative contrast is the discriminator. If dark and lit have similar relative
 * contrast, the dark faces are dark but intact and the defect is elsewhere. If
 * dark relative contrast collapses, detail is being quantised out and the fix
 * is to raise the floor rather than to add detail.
 *
 *   node tools/_darkdetail.mjs <png> x0,y0,x1,y1 [darkL=24] [litL=100]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const img = decode(readFileSync(a[0]));
const [x0, y0, x1, y1] = a[1].split(',').map(Number);
const darkL = a[2] ? Number(a[2]) : 24;
const litL = a[3] ? Number(a[3]) : 100;

const L = (x, y) => {
  const k = (y * img.w + x) * img.ch;
  return 0.2126 * img.px[k] + 0.7152 * img.px[k + 1] + 0.0722 * img.px[k + 2];
};

const acc = {
  dark: { n: 0, sum: 0, grad: 0, codes: new Set() },
  lit: { n: 0, sum: 0, grad: 0, codes: new Set() },
};

for (let y = y0 + 1; y < Math.min(y1, img.h) - 1; y++) {
  for (let x = x0 + 1; x < Math.min(x1, img.w) - 1; x++) {
    const c = L(x, y);
    const bucket = c < darkL ? acc.dark : (c > litL ? acc.lit : null);
    if (!bucket) continue;
    // only count a neighbour difference if the neighbour is in the same
    // population, so the top/side boundary itself does not count as detail
    let g = 0, ng = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nv = L(x + dx, y + dy);
      const sameDark = c < darkL && nv < darkL;
      const sameLit = c > litL && nv > litL;
      if (sameDark || sameLit) { g += Math.abs(nv - c); ng++; }
    }
    if (!ng) continue;
    bucket.n++;
    bucket.sum += c;
    bucket.grad += g / ng;
    const k = (y * img.w + x) * img.ch;
    bucket.codes.add(`${img.px[k]},${img.px[k + 1]},${img.px[k + 2]}`);
  }
}

console.log(`${a[0]} [${x0},${y0}-${x1},${y1}]`);
const out = {};
for (const [name, b] of Object.entries(acc)) {
  if (!b.n) { console.log(`  ${name}: none`); continue; }
  const mean = b.sum / b.n, grad = b.grad / b.n;
  out[name] = { mean, grad, rel: grad / Math.max(mean, 1e-6) };
  console.log(`  ${name.padEnd(4)}: n=${b.n}  meanL=${mean.toFixed(1)}  |grad|=${grad.toFixed(2)} codes  rel=${(grad / mean).toFixed(4)}  distinct rgb=${b.codes.size}`);
}
if (out.dark && out.lit) {
  console.log(`  -> relative contrast dark/lit = ${(out.dark.rel / out.lit.rel).toFixed(3)}`);
  console.log(`  -> at meanL=${out.dark.mean.toFixed(1)}, the lit surface's relative contrast`);
  console.log(`     would deliver only ${(out.lit.rel * out.dark.mean).toFixed(2)} codes of detail`);
  console.log(`     (below ~1.0 code, detail cannot survive 8-bit quantisation)`);
}
