/* What colour is the capture at a normalised coordinate?
 *
 * Exists because I fed _pixowner three coordinates read off a *displayed*
 * crop rather than off the crop's own pixel grid, and the viewer had scaled it,
 * so all three landed on bare ground and attributed to terrain. Confirming the
 * coordinate against the capture costs nothing and the render costs a lock.
 *
 *   node tools/_at.mjs <png> u,v [u,v ...]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const img = decode(readFileSync(a[0]));
console.log(`${a[0]}  ${img.w}x${img.h}`);
for (const s of a.slice(1)) {
  const [u, v] = s.split(',').map(Number);
  const x = Math.round(u * img.w), y = Math.round(v * img.h);
  const k = (y * img.w + x) * img.ch;
  console.log(`  ${s}  ->  px ${x},${y}   rgb(${img.px[k]},${img.px[k + 1]},${img.px[k + 2]})`);
}
