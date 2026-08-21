/* Where is the grey.
 *
 * The critique reports a "grey concrete monolith — the wrong material family
 * entirely, grey-green, not red rock" in the near field of wash_mid. Every red
 * rock surface in this scene has a large positive R-B difference; concrete does
 * not. So find the connected regions of low R-B in the lower frame and print
 * their centres as normalised screen positions, which tools/_pick.mjs can then
 * attribute to an object.
 *
 *   node tools/_grey.mjs shots/warp_wash_mid.png
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

const file = process.argv[2] || 'shots/warp_wash_mid.png';
const im = decode(fs.readFileSync(file));
const { w: W, h: H, ch: CH, px } = im;

/* Sky is grey too, so only the lower two thirds is considered. */
const y0 = Math.floor(H * 0.34);
const lab = new Int32Array(W * H).fill(-1);
const regions = [];

const isGrey = (x, y) => {
  const i = (y * W + x) * CH;
  const r = px[i], g = px[i + 1], b = px[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  /* Rock in this scene runs R-B of 40 to 120. Under 16 is not this palette.
     Dark pixels are excluded because a shadow is grey at any hue. */
  return lum > 26 && (r - b) < 16;
};

for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
  if (lab[y * W + x] >= 0 || !isGrey(x, y)) continue;
  const id = regions.length;
  let sx = 0, sy = 0, n = 0, lo = 1e9, hi = -1e9;
  const st = [y * W + x];
  lab[y * W + x] = id;
  while (st.length) {
    const p = st.pop(), py = (p / W) | 0, pxx = p % W;
    sx += pxx; sy += py; n++;
    if (py < lo) lo = py; if (py > hi) hi = py;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const qx = pxx + dx, qy = py + dy;
      if (qx < 0 || qx >= W || qy < y0 || qy >= H) continue;
      const q = qy * W + qx;
      if (lab[q] >= 0 || !isGrey(qx, qy)) continue;
      lab[q] = id; st.push(q);
    }
  }
  regions.push({ n, cx: sx / n, cy: sy / n, lo, hi });
}

regions.sort((a, b) => b.n - a.n);
const big = regions.filter((r) => r.n > W * H * 0.0004);
console.log('\n  ' + file + '   ' + W + 'x' + H);
console.log('  ' + big.length + ' grey regions over 0.04% of frame, largest first:');
for (const r of big.slice(0, 8)) {
  console.log('    ' + (r.n / (W * H) * 100).toFixed(2).padStart(5) + '% of frame   at ' +
    (r.cx / W).toFixed(3) + ',' + (r.cy / H).toFixed(3) +
    '   rows ' + (r.lo / H).toFixed(2) + '-' + (r.hi / H).toFixed(2) +
    (r.hi >= H - 2 ? '   touches the bottom edge' : ''));
}
if (!big.length) console.log('    none — nothing in the lower frame is outside the red-rock palette');
console.log();
