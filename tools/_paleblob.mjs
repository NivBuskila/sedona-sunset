/* Find the large pale desaturated blobs - the flat plates the critic calls
 * bricks - and report their centroids in normalised coordinates for _pixowner.
 *
 * They are conspicuous against the bed precisely because they are desaturated
 * and bright where everything around them is saturated orange, so that is the
 * predicate. Finding them by search rather than by reading coordinates off a
 * magnified crop also avoids the scaling mistake that sent three probes onto
 * bare ground.
 *
 *   node tools/_paleblob.mjs <png> [satMax=0.42] [vMin=0.55] [minPx=400] [n=6]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const img = decode(readFileSync(a[0]));
const satMax = a[1] ? Number(a[1]) : 0.42;
const vMin = a[2] ? Number(a[2]) : 0.55;
const minPx = a[3] ? Number(a[3]) : 400;
const topN = a[4] ? Number(a[4]) : 6;

const W = img.w, H = img.h;
const mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const k = i * img.ch;
  const r = img.px[k] / 255, g = img.px[k + 1] / 255, b = img.px[k + 2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = mx < 1e-6 ? 0 : (mx - mn) / mx;
  if (s < satMax && mx > vMin) mask[i] = 1;
}

const seen = new Uint8Array(W * H);
const blobs = [];
for (let i = 0; i < W * H; i++) {
  if (!mask[i] || seen[i]) continue;
  const stack = [i]; seen[i] = 1;
  let n = 0, sx = 0, sy = 0;
  while (stack.length) {
    const j = stack.pop();
    const jx = j % W, jy = (j / W) | 0;
    n++; sx += jx; sy += jy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = jx + dx, ny = jy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  if (n >= minPx) blobs.push({ n, cx: sx / n, cy: sy / n });
}
blobs.sort((p, q) => q.n - p.n);

console.log(`${a[0]} ${W}x${H}   sat<${satMax} val>${vMin}   ${blobs.length} blobs >= ${minPx}px`);
for (const b of blobs.slice(0, topN)) {
  const k = (Math.round(b.cy) * W + Math.round(b.cx)) * img.ch;
  console.log(`  ${String(b.n).padStart(6)} px   centroid ${b.cx.toFixed(0)},${b.cy.toFixed(0)}   rgb(${img.px[k]},${img.px[k + 1]},${img.px[k + 2]})   --at ${(b.cx / W).toFixed(4)},${(b.cy / H).toFixed(4)}`);
}
