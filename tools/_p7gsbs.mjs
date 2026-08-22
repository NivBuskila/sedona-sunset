/* Side by side, control on the left and ghosts on the right, at full resolution
 * with a divider. Judging a 1-5% additive term needs the two states adjacent; a
 * single frame cannot tell you whether a disc reads as glass or as a graphic. */
import fs from 'fs';
import { decode, encodeRGB } from './png.mjs';
const [,,out,tag,view,X,Y,W,H] = process.argv;
const A = decode(fs.readFileSync(`shots/${tag}_ghost0_${view}.png`));
const B = decode(fs.readFileSync(`shots/${tag}_${view}.png`));
const x0 = Math.round(parseFloat(X) * A.w), y0 = Math.round(parseFloat(Y) * A.h);
const w = Math.round(parseFloat(W) * A.w), h = Math.round(parseFloat(H) * A.h);
const GAP = 12, ow = w * 2 + GAP;
const o = Buffer.alloc(ow * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  for (const [im, dx] of [[A, 0], [B, w + GAP]]) {
    const p = ((y0 + y) * im.w + (x0 + x)) * im.ch;
    for (let c = 0; c < 3; c++) o[(y * ow + x + dx) * 3 + c] = im.px[p + c];
  }
}
fs.writeFileSync(out, encodeRGB(ow, h, o));
console.log(`  ${view}: control | ghosts   ${x0},${y0} ${w}x${h} each -> ${out}`);
