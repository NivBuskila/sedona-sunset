/* Feasibility of a *local* shadow lift, keyed on spatial scale rather than on
 * luminance.
 *
 * The luminance-band lift fails because the black facet at 0.0092 scene-linear and
 * the shaded floor at 0.0221 are 1.27 stops apart, and the shadow gate is a mean
 * over a shaded window — so anything that reaches the facet moves the window.
 *
 * But the two populations differ in something other than level. A clast side face
 * is a *small* dark region surrounded by blazing ground; the shaded wall is a
 * large, uniformly dark region. A mask built from (blurred luminance - luminance)
 * separates them on that basis: it is large on a facet, and near zero in the
 * middle of a big shadow no matter how dark that shadow is.
 *
 * This measures the mask on the shipped frames before any shader is written.
 */
import fs from 'fs';
import { decode } from './png.mjs';

const GATE = [0.30, 0.24, 0.34, 0.34];

function lumaPlane(file) {
  const im = decode(fs.readFileSync(file));
  const L = new Float32Array(im.w * im.h);
  for (let i = 0, p = 0; i < L.length; i++, p += im.ch)
    L[i] = (0.2126 * im.px[p] + 0.7152 * im.px[p + 1] + 0.0722 * im.px[p + 2]) / 255;
  return { L, w: im.w, h: im.h };
}
/* separable box blur, repeated, which is a cheap gaussian and is what the bloom
   chain already has lying around at quarter resolution */
function blur(L, w, h, r, passes = 3) {
  let a = Float32Array.from(L), b = new Float32Array(L.length);
  for (let k = 0; k < passes; k++) {
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

const file = f => `shots/sys7lift_lift1_${f}.png`;
const radius = parseInt(process.argv[process.argv.indexOf('--r') + 1] || '24', 10);

console.log(`\n  local-contrast mask, blur radius ${radius}px at 2560x1440`);
console.log('  mask = max(0, blurredLuma - luma), i.e. how much darker than the neighbourhood\n');
console.log('  frame / region                    px       mean luma   mean mask   mask>0.05');

for (const [nm, f, box] of [
  ['ground, dark facets (<14cv)',   'ground',     null],
  ['wall_shade, THE GATE WINDOW',   'wall_shade', GATE],
  ['wall_lit, the gate denominator','wall_lit',   GATE],
  ['shade_far, dark facets (<14cv)','shade_far',  null],
]) {
  const { L, w, h } = lumaPlane(file(f));
  const B = blur(L, w, h, radius);
  let n = 0, sl = 0, sm = 0, big = 0;
  const x0 = box ? Math.round(box[0] * w) : 0, y0 = box ? Math.round(box[1] * h) : 0;
  const x1 = box ? x0 + Math.round(box[2] * w) : w, y1 = box ? y0 + Math.round(box[3] * h) : h;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * w + x;
    if (!box && L[i] * 255 > 14) continue;          // the facet population
    const m = Math.max(0, B[i] - L[i]);
    n++; sl += L[i]; sm += m; if (m > 0.05) big++;
  }
  console.log(`  ${nm.padEnd(32)}${String(n).padStart(8)}   ${(255 * sl / n).toFixed(1).padStart(9)}cv` +
              `   ${(sm / n).toFixed(4).padStart(9)}   ${(100 * big / n).toFixed(1).padStart(7)}%`);
}
console.log('\n  the separation this needs: mask large on the facets, near zero in the gate window.');
