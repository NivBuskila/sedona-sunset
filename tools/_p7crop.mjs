/* full-resolution crops, because downscales find candidates and only full-res
   settles them. usage: _p7crop.mjs out.png tag view x0 y0 w h [zoom] */
import fs from 'fs';
import { decode, encodeRGB } from './png.mjs';
const [,,out,tag,view,X,Y,W,H,Z] = process.argv;
const z = parseInt(Z || '1', 10);
const im = decode(fs.readFileSync(`shots/${tag}_${view}.png`));
const x0 = Math.round(parseFloat(X) * (parseFloat(X) < 1 ? im.w : 1));
const y0 = Math.round(parseFloat(Y) * (parseFloat(Y) < 1 ? im.h : 1));
const w = Math.round(parseFloat(W) * (parseFloat(W) < 1 ? im.w : 1));
const h = Math.round(parseFloat(H) * (parseFloat(H) < 1 ? im.h : 1));
const o = Buffer.alloc(w * z * h * z * 3);
for (let y = 0; y < h * z; y++) for (let x = 0; x < w * z; x++) {
  const p = ((y0 + Math.floor(y / z)) * im.w + (x0 + Math.floor(x / z))) * im.ch;
  for (let c = 0; c < 3; c++) o[(y * w * z + x) * 3 + c] = im.px[p + c];
}
fs.writeFileSync(out, encodeRGB(w * z, h * z, o));
console.log(`  ${view} ${x0},${y0} ${w}x${h} @${z}x -> ${out}`);
