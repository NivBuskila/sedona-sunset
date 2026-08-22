/* box downscale for looking at whole frames. usage: _p7down.mjs out.png tag view n */
import fs from 'fs';
import { decode, encodeRGB } from './png.mjs';
const [,,out,tag,view,N] = process.argv;
const n = parseInt(N || '3', 10);
const im = decode(fs.readFileSync(`shots/${tag}_${view}.png`));
const w = Math.floor(im.w / n), h = Math.floor(im.h / n);
const o = Buffer.alloc(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
  let s = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    s += im.px[((y * n + j) * im.w + (x * n + i)) * im.ch + c];
  o[(y * w + x) * 3 + c] = Math.round(s / (n * n));
}
fs.writeFileSync(out, encodeRGB(w, h, o));
console.log(`  ${view} -> ${out} (${w}x${h})`);
