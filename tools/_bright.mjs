/* Where is the brightest thing in this frame, and how bright against its
 * surroundings?
 *
 *   node tools/_bright.mjs shots/sys7look/v_wall_shade.png
 *   node tools/_bright.mjs shots/x.png --region 0.9,0.3,1.0,0.6 --top 5
 *
 * Written because "the brightest thing in a dark corner" is how several of this
 * project's findings have been phrased, and locating it by eye off a downscaled
 * view then converting to frame fractions put my first ablation probe on four
 * terrain pixels and cost a forty-five second render. The frame knows where its
 * own bright pixels are.
 *
 * Reports connected-ish clusters rather than single maxima: a single hot pixel is
 * usually aliasing, and what a critic reacts to is an area. Clustering is a cheap
 * grid merge at `--cell` pixels, which is enough to separate two plants but not
 * two blades of one plant, and that is the scale the question is asked at.
 *
 * V is the max channel on normalised code values, matching how the shade findings
 * on this project have been quoted.
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

const argv = process.argv.slice(2);
const val = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const files = argv.filter((a, i) => !a.startsWith('--')
  && !(i > 0 && argv[i - 1].startsWith('--')));
const [rx0, ry0, rx1, ry1] = val('region', '0,0,1,1').split(',').map(Number);
const TOP = +val('top', 6);
const CELL = +val('cell', 24);

for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`_bright: no such file ${f}`); process.exit(2); }
  const { w: W, h: H, ch, px } = decode(fs.readFileSync(f));
  const x0 = Math.max(0, Math.floor(rx0 * W)), x1 = Math.min(W, Math.ceil(rx1 * W));
  const y0 = Math.max(0, Math.floor(ry0 * H)), y1 = Math.min(H, Math.ceil(ry1 * H));

  /* Background level for the region, so the contrast can be quoted. */
  const vs = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = (y * W + x) * ch;
      vs.push(Math.max(px[s], px[s + 1], px[s + 2]) / 255);
    }
  }
  vs.sort((a, b) => a - b);
  const med = vs[vs.length >> 1];

  const cells = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = (y * W + x) * ch;
      const v = Math.max(px[s], px[s + 1], px[s + 2]) / 255;
      /* Well clear of the local background, or every gravel highlight lands in
         the table and the plant does not stand out of its own report. */
      if (v < Math.max(0.25, med * 3)) continue;
      const k = ((y / CELL) | 0) + ':' + ((x / CELL) | 0);
      let c = cells.get(k);
      if (!c) cells.set(k, c = { n: 0, sx: 0, sy: 0, vmax: 0, sv: 0 });
      c.n++; c.sx += x; c.sy += y; c.sv += v;
      if (v > c.vmax) c.vmax = v;
    }
  }
  const list = [...cells.values()].sort((a, b) => b.n * b.vmax - a.n * a.vmax);

  console.log(`\n${f}   ${W}x${H}` +
    `   region x ${x0}-${x1}, y ${y0}-${y1}   background V p50 ${med.toFixed(3)}`);
  if (!list.length) { console.log('  nothing above the threshold'); continue; }
  console.log('     px      py       u        v      n    V max   V mean   x over bg');
  for (const c of list.slice(0, TOP)) {
    const cx = c.sx / c.n, cy = c.sy / c.n;
    console.log(`  ${cx.toFixed(0).padStart(5)}  ${cy.toFixed(0).padStart(6)}` +
      `   ${(cx / W).toFixed(4)}  ${(cy / H).toFixed(4)}  ${String(c.n).padStart(5)}` +
      `   ${c.vmax.toFixed(3)}   ${(c.sv / c.n).toFixed(3)}` +
      `   ${(c.vmax / Math.max(med, 1e-4)).toFixed(1)}x`);
  }
}
