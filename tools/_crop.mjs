/* Cut a pixel-coordinate rectangle out of a capture and optionally magnify it,
 * so a defect a critic located at (93,447)-(230,523) can be looked at instead of
 * reasoned about. Nearest-neighbour on purpose: a defect described as "stippled"
 * or "dithered" is a per-pixel pattern, and any smoothing filter destroys the
 * evidence being examined.
 *
 *   node tools/_crop.mjs shots/x.png 93 447 230 523 [--zoom 4] [--out shots/y.png]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encodeRGB } from './png.mjs';

const a = process.argv.slice(2);
const file = a[0];
const [x0, y0, x1, y1] = a.slice(1, 5).map(Number);
const gi = a.indexOf('--zoom'), oi = a.indexOf('--out');
const zoom = gi < 0 ? 1 : Number(a[gi + 1]);
const out = oi < 0 ? file.replace(/\.png$/, `_crop.png`) : a[oi + 1];

const img = decode(readFileSync(file));
const w = x1 - x0, h = y1 - y0;
const rgb = Buffer.alloc(w * zoom * h * zoom * 3);
for (let y = 0; y < h * zoom; y++) {
  for (let x = 0; x < w * zoom; x++) {
    const sx = x0 + Math.floor(x / zoom), sy = y0 + Math.floor(y / zoom);
    const s = (sy * img.w + sx) * 4, d = (y * w * zoom + x) * 3;
    rgb[d] = img.px[s]; rgb[d + 1] = img.px[s + 1]; rgb[d + 2] = img.px[s + 2];
  }
}
writeFileSync(out, encodeRGB(w * zoom, h * zoom, rgb));
console.log(`  ${file} ${img.w}x${img.h}  ->  ${out}  ${w}x${h} at ${zoom}x`);
