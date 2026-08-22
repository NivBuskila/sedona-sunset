/* Find the palest large patch in a shot and report it, so the "pale clast" work
 * can be measured on the object the eye actually stops on rather than on a
 * region mean that averages it with the bed around it.
 *
 * A pale clast is not merely bright — the sunlit bed is bright too. What makes it
 * read as a plate is that it is bright *and* flat, so the search is for the 8x8
 * block with the highest value that also has a low internal spread, and the
 * report is that block's V against the frame's own sunlit bed for scale.
 *
 *   node tools/_paleprobe.mjs shots/q3_ground.png [x0 y0 x1 y1]   (fractions)
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
import { die, finite, nonEmpty } from './argcheck.mjs';

const [file, ...r] = process.argv.slice(2);
if (!file) die('needs a PNG: node tools/_paleprobe.mjs shots/tag_view.png [x0 y0 x1 y1]');
/* Four fractions or none. A partial crop used to leave the rest undefined, which
   became NaN, which selected no cells — and the tool then reported on an empty
   set as though it had looked. */
if (r.length && r.length !== 4) die(`the crop is four fractions x0 y0 x1 y1, got ${r.length}`);
const s = decode(readFileSync(file));
const fx0 = r.length ? finite('x0', r[0]) : 0, fy0 = r.length ? finite('y0', r[1]) : 0.35;
const fx1 = r.length ? finite('x1', r[2]) : 1, fy1 = r.length ? finite('y1', r[3]) : 1;
if (fx1 <= fx0 || fy1 <= fy0) die(`the crop is empty: x ${fx0}..${fx1}, y ${fy0}..${fy1}`);
const X0 = Math.round(fx0 * s.w), X1 = Math.round(fx1 * s.w);
const Y0 = Math.round(fy0 * s.h), Y1 = Math.round(fy1 * s.h);

const at = (x, y) => {
  const k = (y * s.w + x) * s.ch;
  return [s.px[k], s.px[k + 1], s.px[k + 2]];
};
const B = 8;
const cells = [];
for (let y = Y0; y + B <= Y1; y += B) {
  for (let x = X0; x + B <= X1; x += B) {
    let n = 0, sv = 0, sv2 = 0, sr = 0, sg = 0, sb = 0;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const [rr, gg, bb] = at(x + i, y + j);
      const v = Math.max(rr, gg, bb) / 255;
      n++; sv += v; sv2 += v * v; sr += rr; sg += gg; sb += bb;
    }
    const m = sv / n;
    cells.push({ x, y, v: m, sd: Math.sqrt(Math.max(0, sv2 / n - m * m)),
      r: sr / n, g: sg / n, b: sb / n });
  }
}
/* Flat and bright. The sd gate is what separates a plate from sunlit gravel,
   which reaches the same peak value but never holds it over 8x8 px. */
nonEmpty('the crop', cells.length, `It is ${X0}..${X1} x ${Y0}..${Y1} px in a ${s.w}x${s.h} image, and the cell is 8 px.`);
const flat = cells.filter(c => c.sd < 0.055).sort((a, b) => b.v - a.v);
const all = cells.slice().sort((a, b) => b.v - a.v);
const med = all[Math.floor(all.length / 2)];
const p90 = all[Math.floor(all.length * 0.10)];
const fmt = (c) => `V ${c.v.toFixed(3)} sd ${c.sd.toFixed(3)} rgb ${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)} at ${c.x},${c.y}`;
console.log(file);
console.log(`  palest flat block   ${flat.length ? fmt(flat[0]) : 'none'}`);
if (flat[1]) console.log(`  2nd                 ${fmt(flat[1])}`);
if (flat[2]) console.log(`  3rd                 ${fmt(flat[2])}`);
console.log(`  flat blocks V>0.60  ${flat.filter(c => c.v > 0.60).length} of ${cells.length}`);
console.log(`  frame p90 / median  V ${p90.v.toFixed(3)} / ${med.v.toFixed(3)}`);
