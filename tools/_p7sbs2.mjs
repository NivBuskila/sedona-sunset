/* side by side of two explicit tags: out, tagA, tagB, view, x, y, w, h */
import fs from 'fs';
import { decode, encodeRGB } from './png.mjs';
const [,,out,ta,tb,view,X,Y,W,H] = process.argv;
const A = decode(fs.readFileSync(`shots/${ta}_${view}.png`));
const B = decode(fs.readFileSync(`shots/${tb}_${view}.png`));
const x0 = Math.round(parseFloat(X)*A.w), y0 = Math.round(parseFloat(Y)*A.h);
const w = Math.round(parseFloat(W)*A.w), h = Math.round(parseFloat(H)*A.h);
const GAP = 12, ow = w*2+GAP, o = Buffer.alloc(ow*h*3);
for (let y=0;y<h;y++) for (let x=0;x<w;x++) for (const [im,dx] of [[A,0],[B,w+GAP]]) {
  const p = ((y0+y)*im.w+(x0+x))*im.ch;
  for (let c=0;c<3;c++) o[(y*ow+x+dx)*3+c] = im.px[p+c];
}
fs.writeFileSync(out, encodeRGB(ow,h,o));
console.log(`  ${view}: ${ta} | ${tb}  -> ${out}`);
