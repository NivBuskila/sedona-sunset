/* Pixel values along a line, for complaints phrased as "no gradient across X".
 *
 *   node tools/_profile.mjs shots/x.png 470,300 545,300
 *   node tools/_profile.mjs a.png b.png --at 470,300 --to 545,300
 *
 * A critic's "flat, no internal shading, hard edge" is a statement about the
 * derivative along a short run of pixels, and neither a cluster mean nor a
 * histogram can answer it: a blade whose interior ramps smoothly and one that is
 * a plateau with a cliff at each side can have identical means, identical maxima
 * and identical histograms. Only the ordering along the line separates them.
 *
 * Reports V per pixel plus the run's span and its largest single-pixel step, so
 * "ramp" and "plateau with a cliff" are distinguishable numerically as well as by
 * reading the column.
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const pts = argv.filter(a => /^\d+,\d+$/.test(a));
const from = (flag('at') || pts[0] || '').split(',').map(Number);
const to = (flag('to') || pts[1] || '').split(',').map(Number);
const files = argv.filter(a => a.endsWith('.png'));
if (files.length === 0 || from.length !== 2 || to.length !== 2) {
  console.error('usage: node tools/_profile.mjs a.png [b.png] x0,y0 x1,y1');
  process.exit(2);
}

const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) + 1;
const rows = [];
for (const f of files) {
  const { w: W, h: H, ch, px } = decode(fs.readFileSync(f));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const x = Math.round(from[0] + (to[0] - from[0]) * t);
    const y = Math.round(from[1] + (to[1] - from[1]) * t);
    if (x < 0 || y < 0 || x >= W || y >= H) { out.push(null); continue; }
    const s = (y * W + x) * ch;
    out.push({ r: px[s], g: px[s + 1], b: px[s + 2],
               v: Math.max(px[s], px[s + 1], px[s + 2]) / 255 });
  }
  rows.push({ f, out });
}

console.log(`\n(${from}) -> (${to}), ${n} px\n`);
const head = rows.map(r => r.f.replace(/^.*[\\/]/, '').padEnd(22)).join(' ');
console.log('  i   ' + head);
for (let i = 0; i < n; i++) {
  const cells = rows.map(r => {
    const p = r.out[i];
    if (!p) return 'out of frame'.padEnd(22);
    const bar = '#'.repeat(Math.round(p.v * 18));
    return (`${String(p.r).padStart(3)},${String(p.g).padStart(3)},${String(p.b).padStart(3)} `
      + `${p.v.toFixed(3)} ${bar}`).padEnd(22);
  }).join(' ');
  console.log(String(i).padStart(4) + '  ' + cells);
}
for (const r of rows) {
  const vs = r.out.filter(Boolean).map(p => p.v);
  let step = 0;
  for (let i = 1; i < vs.length; i++) step = Math.max(step, Math.abs(vs[i] - vs[i - 1]));
  const lo = Math.min(...vs), hi = Math.max(...vs);
  console.log(`\n  ${r.f.replace(/^.*[\\/]/, '')}: V ${lo.toFixed(3)}..${hi.toFixed(3)}`
    + `  span ${(hi - lo).toFixed(3)}  largest single-pixel step ${step.toFixed(3)}`);
}
