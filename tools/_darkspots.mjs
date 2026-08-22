/* Find the largest connected dark blobs in a crop and report their centroids
 * in normalised view coordinates, so they can be handed straight to
 * _pixowner.mjs. Attribution before diagnosis: a critic describing a black
 * "side face" is describing an appearance, and which object drew it is a
 * separate question that only ablation answers.
 *
 *   node tools/_darkspots.mjs <png> x0,y0,x1,y1 [L=24] [n=5]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const img = decode(readFileSync(a[0]));
const [x0, y0, x1, y1] = a[1].split(',').map(Number);
const thr = a[2] ? Number(a[2]) : 24;
const topN = a[3] ? Number(a[3]) : 5;

const W = x1 - x0, H = y1 - y0;
const dark = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const k = ((y + y0) * img.w + (x + x0)) * img.ch;
    const L = 0.2126 * img.px[k] + 0.7152 * img.px[k + 1] + 0.0722 * img.px[k + 2];
    dark[y * W + x] = L < thr ? 1 : 0;
  }
}

const seen = new Uint8Array(W * H);
const blobs = [];
for (let i = 0; i < W * H; i++) {
  if (!dark[i] || seen[i]) continue;
  const stack = [i]; seen[i] = 1;
  let n = 0, sx = 0, sy = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  while (stack.length) {
    const j = stack.pop();
    const jx = j % W, jy = (j / W) | 0;
    n++; sx += jx; sy += jy;
    if (jx < minx) minx = jx; if (jx > maxx) maxx = jx;
    if (jy < miny) miny = jy; if (jy > maxy) maxy = jy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = jx + dx, ny = jy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (dark[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  blobs.push({ n, cx: sx / n + x0, cy: sy / n + y0, w: maxx - minx + 1, h: maxy - miny + 1 });
}
blobs.sort((p, q) => q.n - p.n);

console.log(`${a[0]}  dark L<${thr} in [${x0},${y0}-${x1},${y1}]  ${blobs.length} blobs`);
console.log('   px    size      centroid px       normalised (for --at)');
for (const b of blobs.slice(0, topN)) {
  console.log(`  ${String(b.n).padStart(5)}  ${String(b.w).padStart(3)}x${String(b.h).padStart(3)}   ${b.cx.toFixed(0).padStart(5)},${b.cy.toFixed(0).padStart(5)}      ${(b.cx / img.w).toFixed(4)},${(b.cy / img.h).toFixed(4)}`);
}
