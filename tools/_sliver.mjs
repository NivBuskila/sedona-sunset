/* Counts the "floating stone" signature across a whole frame.
 *
 * The complaint has a shape, and the shape is what makes it findable without
 * being told where to look: going down a column you meet a pale clast, then a
 * run of LIT BED, then the shadow. If the stone is seated the shadow begins at
 * the rim and the middle run does not exist. So the defect is a three-region
 * ordering, and counting how often that ordering occurs turns one critic's
 * coordinate into a population figure that can be compared between builds.
 *
 * Classification is by hue as well as luminance, because a lit bed pixel and a
 * lit clast pixel can share a luminance and never share a colour: the bed runs
 * R/G about 1.7 and the pale clasts 1.1 to 1.35. Without that test a bright
 * side facet of the stone counts as ground and every stone looks like it
 * floats.
 *
 *   node tools/_sliver.mjs shots/a.png [shots/b.png ...]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const MIN_SLIVER = 2;      // px; below this it is an antialiased rim, not a gap
const MAX_SLIVER = 40;     // px; above this the "shadow" below is another object

for (const file of process.argv.slice(2)) {
  const im = decode(readFileSync(file));
  const { w, h, ch, px } = im;
  const L = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const RG = (i) => px[i] / Math.max(px[i + 1], 1);

  const isClast = (i) => L(i) > 115 && RG(i) < 1.45;
  const isLitBed = (i) => L(i) > 92 && RG(i) > 1.56;
  const isShadow = (i) => L(i) < 62;

  let hits = 0, tot = 0;
  const widths = [];
  /* only the near half: the defect is a near-field one and a two-pixel stone at
     eighty metres cannot show a gap between itself and its shadow */
  for (let x = 0; x < w; x++) {
    for (let y = Math.floor(h * 0.45); y < h - MAX_SLIVER - 2; y++) {
      const i = (y * w + x) * ch;
      if (!isClast(i)) continue;
      /* must be the LAST clast row of this run, i.e. the bottom rim */
      if (isClast(((y + 1) * w + x) * ch)) continue;
      tot++;
      let k = 1;
      while (k <= MAX_SLIVER && isLitBed(((y + k) * w + x) * ch)) k++;
      const run = k - 1;
      if (run < MIN_SLIVER) continue;
      if (!isShadow(((y + k) * w + x) * ch)) continue;
      hits++; widths.push(run);
    }
  }
  widths.sort((a, b) => a - b);
  const med = widths.length ? widths[widths.length >> 1] : 0;
  const p90 = widths.length ? widths[Math.floor(0.9 * (widths.length - 1))] : 0;
  console.log(`${file.replace(/^shots\//, '').padEnd(30)} rims ${String(tot).padStart(6)}` +
    `  floating ${String(hits).padStart(5)}  ${(100 * hits / Math.max(tot, 1)).toFixed(2).padStart(5)}%` +
    `   gap median ${med} px, p90 ${p90} px`);
}
