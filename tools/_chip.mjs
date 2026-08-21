/* Scratch: locate and characterise the blue chips on the wash floor.
 *
 *   node tools/_chip.mjs shots/sys4d_wash_mid.png [--mark out.png]
 *
 * Selects pixels with B > R + 8 in the lower half, labels 4-connected blobs, and
 * reports the size distribution, the mean colour per size class and the bounding
 * boxes of the largest few — which is what tells a billboard apart from a lit
 * facet, and a 1 px hash apart from a chip.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encodeRGB } from './png.mjs';

const file = process.argv[2];
const mark = process.argv.includes('--mark');
const img = decode(readFileSync(file));
const { w, h, ch, px } = img;
const y0 = Math.floor(h / 2);

const sel = new Uint8Array(w * h);
let n = 0, sr = 0, sg = 0, sb = 0;
for (let y = y0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch;
    if (px[i + 2] > px[i] + 8) {
      sel[y * w + x] = 1; n++;
      sr += px[i]; sg += px[i + 1]; sb += px[i + 2];
    }
  }
}
const tot = w * (h - y0);
console.log(`${file}  ${w}x${h}`);
console.log(`  B>R+8 in lower half: ${(100 * n / tot).toFixed(2)}%  mean rgb(${(sr/n).toFixed(0)},${(sg/n).toFixed(0)},${(sb/n).toFixed(0)})  B/G ${(sb/sg).toFixed(2)}`);

/* connected components */
const lab = new Int32Array(w * h).fill(-1);
const blobs = [];
const stack = [];
for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
  const k = y * w + x;
  if (!sel[k] || lab[k] >= 0) continue;
  const id = blobs.length;
  const b = { n: 0, x0: x, x1: x, y0: y, y1: y, r: 0, g: 0, bl: 0 };
  stack.push(k); lab[k] = id;
  while (stack.length) {
    const c = stack.pop();
    const cx = c % w, cy = (c / w) | 0;
    b.n++;
    if (cx < b.x0) b.x0 = cx; if (cx > b.x1) b.x1 = cx;
    if (cy < b.y0) b.y0 = cy; if (cy > b.y1) b.y1 = cy;
    const i = c * ch;
    b.r += px[i]; b.g += px[i + 1]; b.bl += px[i + 2];
    for (const d of [-1, 1, -w, w]) {
      const nk = c + d;
      if (nk < y0 * w || nk >= w * h) continue;
      if (Math.abs((nk % w) - cx) > 1) continue;
      if (sel[nk] && lab[nk] < 0) { lab[nk] = id; stack.push(nk); }
    }
  }
  blobs.push(b);
}
blobs.sort((a, b) => b.n - a.n);
const bins = [[1, 1], [2, 3], [4, 8], [9, 24], [25, 80], [81, 1e9]];
console.log(`  ${blobs.length} blobs`);
for (const [lo, hi] of bins) {
  const s = blobs.filter(b => b.n >= lo && b.n <= hi);
  if (!s.length) continue;
  const p = s.reduce((a, b) => a + b.n, 0);
  const r = s.reduce((a, b) => a + b.r, 0) / p, g = s.reduce((a, b) => a + b.g, 0) / p;
  const bl = s.reduce((a, b) => a + b.bl, 0) / p;
  console.log(`   ${String(lo).padStart(3)}-${String(hi === 1e9 ? '' : hi).padEnd(4)} ` +
    `${String(s.length).padStart(5)} blobs  ${String(p).padStart(6)} px  ` +
    `${(100 * p / n).toFixed(1)}% of sel  rgb(${r.toFixed(0)},${g.toFixed(0)},${bl.toFixed(0)}) B/G ${(bl/g).toFixed(2)}`);
}
console.log('  largest:');
for (const b of blobs.slice(0, 10)) {
  console.log(`   ${String(b.n).padStart(5)} px  ${b.x1 - b.x0 + 1}x${b.y1 - b.y0 + 1}` +
    ` at ${b.x0},${b.y0}  fill ${(b.n / ((b.x1-b.x0+1)*(b.y1-b.y0+1))).toFixed(2)}` +
    `  rgb(${(b.r/b.n).toFixed(0)},${(b.g/b.n).toFixed(0)},${(b.bl/b.n).toFixed(0)})` +
    `  frac ${(b.x0/w).toFixed(3)},${(b.y0/h).toFixed(3)}`);
}

/* rows: where in the frame are they */
console.log('  by frame band (fraction of band area):');
for (let k = 0; k < 5; k++) {
  const a = y0 + Math.floor((h - y0) * k / 5), z = y0 + Math.floor((h - y0) * (k + 1) / 5);
  let c = 0;
  for (let y = a; y < z; y++) for (let x = 0; x < w; x++) if (sel[y * w + x]) c++;
  console.log(`   y ${(a/h).toFixed(2)}-${(z/h).toFixed(2)}  ${(100 * c / (w * (z - a))).toFixed(2)}%`);
}

if (mark) {
  const out = Buffer.alloc(w * h * 3);
  for (let k = 0; k < w * h; k++) {
    const i = k * ch;
    out[k*3] = sel[k] ? 255 : px[i];
    out[k*3+1] = sel[k] ? 0 : px[i+1];
    out[k*3+2] = sel[k] ? 255 : px[i+2];
  }
  const dst = file.replace(/\.png$/, '_chips.png');
  writeFileSync(dst, encodeRGB(w, h, out));
  console.log(`  wrote ${dst}`);
}
