/* Print raw pixel values over a small window of a shot, so an artefact a few
 * pixels across can be identified by its colour rather than by eye.
 *   node tools/_px.mjs shots/dbg4_wall_shade.png 1180 130 20 14
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const [file, X, Y, W, H] = process.argv.slice(2);
const s = decode(readFileSync(file));
const x0 = +X, y0 = +Y, w = +W || 16, h = +H || 12;
const at = (x, y) => {
  const k = (y * s.w + x) * s.ch;
  return [s.px[k], s.px[k + 1], s.px[k + 2]];
};
console.log(`${file} ${s.w}x${s.h}  window ${x0},${y0} ${w}x${h}`);
let hdr = '     ';
for (let x = 0; x < w; x++) hdr += String(x0 + x).slice(-3).padStart(4);
console.log(hdr);
for (let y = 0; y < h; y++) {
  let a = String(y0 + y).padStart(4) + ' ';
  let b = '     ';
  for (let x = 0; x < w; x++) {
    const [r, g, bl] = at(x0 + x, y0 + y);
    a += String(Math.round(0.299 * r + 0.587 * g + 0.114 * bl)).padStart(4);
    b += `${r},${g},${bl} `.padStart(4);
  }
  console.log(a);
}
console.log('\nrows as r/g/b:');
for (let y = 0; y < h; y++) {
  const row = [];
  for (let x = 0; x < w; x++) row.push(at(x0 + x, y0 + y).join('/'));
  console.log(String(y0 + y).padStart(4) + '  ' + row.join('  '));
}
