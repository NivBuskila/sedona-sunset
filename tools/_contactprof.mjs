/* Column luminance profiles across a clast's lower rim, to test the specific
 * claim "there is a bright sliver of lit floor between the bottom rim and the
 * start of the cast shadow".
 *
 * That claim has a shape, not just a location: going down a column you should
 * see clast (whatever it is), then a RUN OF FLOOR-BRIGHT pixels, then the
 * shadow. If the shadow starts at the rim there is no bright run between them,
 * and the complaint is something else - a missing contact darkening, or the eye
 * reading a lit side face as ground.
 *
 * Printed as a profile rather than a statistic because the thing being looked
 * for is an ordering of three regions, and no scalar carries an ordering.
 *
 *   node tools/_contactprof.mjs shots/x.png 960,1180 660,740 [--step 40]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const [file, xs, ys] = process.argv.slice(2);
const si = process.argv.indexOf('--step');
const STEP = si >= 0 ? Number(process.argv[si + 1]) : 40;
if (!file || !xs || !ys) { console.log('usage: _contactprof.mjs file x0,x1 y0,y1 [--step N]'); process.exit(1); }
const [x0, x1] = xs.split(',').map(Number);
const [y0, y1] = ys.split(',').map(Number);

const im = decode(readFileSync(file));
const p = { width: im.w, height: im.h, data: im.px, ch: im.ch };
const L = (x, y) => {
  const i = (y * p.width + x) * p.ch;
  return (0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]);
};
const RGB = (x, y) => { const i = (y * p.width + x) * p.ch; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };

console.log(`${file}  ${p.width}x${p.height}`);
console.log(`columns x ${x0}..${x1} step ${STEP}, rows y ${y0}..${y1}`);
console.log('');
process.stdout.write('   y  ');
for (let x = x0; x <= x1; x += STEP) process.stdout.write(String(x).padStart(6));
console.log('');
for (let y = y0; y <= y1; y++) {
  process.stdout.write(String(y).padStart(5) + ' ');
  for (let x = x0; x <= x1; x += STEP) process.stdout.write(L(x, y).toFixed(0).padStart(6));
  console.log('');
}
/* the hue of a run decides whether a bright band is lit floor or lit rock:
   the bed is strongly red, the pale clasts are near-neutral */
console.log('\n  R/G ratio on the same grid (bed is red ~1.7, pale clast ~1.1-1.3)');
process.stdout.write('   y  ');
for (let x = x0; x <= x1; x += STEP) process.stdout.write(String(x).padStart(6));
console.log('');
for (let y = y0; y <= y1; y++) {
  process.stdout.write(String(y).padStart(5) + ' ');
  for (let x = x0; x <= x1; x += STEP) {
    const [r, g] = RGB(x, y);
    process.stdout.write((r / Math.max(g, 1)).toFixed(2).padStart(6));
  }
  console.log('');
}
