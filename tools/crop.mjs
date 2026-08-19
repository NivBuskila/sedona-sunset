/* Crop-and-magnify a shot, so a suspect artefact can be identified without
 * spending another render on the software rasteriser.
 *
 *   node tools/crop.mjs shots/sys1c_ground.png 0.02 0.44 0.34 0.30 4
 *                       file                    x    y    w    h   zoom
 * where x,y,w,h are fractions of the source image. Writes <file>_crop.png, or a
 * named output if a seventh argument is given.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encodeRGB } from './png.mjs';

const [file, fx, fy, fw, fh, fz, name] = process.argv.slice(2);
const src = decode(readFileSync(file));
const x0 = Math.round(+fx * src.w), y0 = Math.round(+fy * src.h);
const cw = Math.round(+fw * src.w), chh = Math.round(+fh * src.h);
const z = Math.max(1, Math.round(+(fz || 3)));
const ow = cw * z, oh = chh * z;
const out = Buffer.alloc(ow * oh * 3);
for (let y = 0; y < oh; y++) {
  const sy = Math.min(src.h - 1, y0 + Math.floor(y / z));
  for (let x = 0; x < ow; x++) {
    const sx = Math.min(src.w - 1, x0 + Math.floor(x / z));
    const s = (sy * src.w + sx) * src.ch, d = (y * ow + x) * 3;
    out[d] = src.px[s]; out[d + 1] = src.px[s + 1]; out[d + 2] = src.px[s + 2];
  }
}
const dst = name || file.replace(/\.png$/, '_crop.png');
writeFileSync(dst, encodeRGB(ow, oh, out));
console.log(`${dst}  ${ow}x${oh}  from ${cw}x${chh} at ${x0},${y0}`);
