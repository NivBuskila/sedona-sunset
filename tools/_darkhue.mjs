/* What colour is the dark population?
 *
 * The question this answers: a facet that is dark because it receives only
 * bounce from blazing orange ground should be dark ORANGE - same hue as the
 * ground, low value, saturation preserved or higher. A facet that is dark
 * because a term reached zero goes NEUTRAL, because whatever is left is
 * numerical residue rather than light with a colour.
 *
 * So hue and saturation of the darkest decile, compared against the lit
 * surface in the same crop, discriminates "no bounce arrives" from "bounce
 * arrives and is small".
 *
 *   node tools/_darkhue.mjs <png> x0,y0,x1,y1 [darkL=24] [litL=100]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx < 1e-9 ? 0 : d / mx, v: mx };
}

const a = process.argv.slice(2);
const img = decode(readFileSync(a[0]));
const [x0, y0, x1, y1] = a[1].split(',').map(Number);
const darkL = a[2] ? Number(a[2]) : 24;
const litL = a[3] ? Number(a[3]) : 100;

const groups = { dark: [], lit: [] };
for (let y = y0; y < Math.min(y1, img.h); y++) {
  for (let x = x0; x < Math.min(x1, img.w); x++) {
    const k = (y * img.w + x) * img.ch;
    const r = img.px[k], g = img.px[k + 1], b = img.px[k + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (L < darkL) groups.dark.push([r, g, b, L]);
    else if (L > litL) groups.lit.push([r, g, b, L]);
  }
}

function report(name, arr) {
  if (!arr.length) { console.log(`  ${name}: none`); return null; }
  let sr = 0, sg = 0, sb = 0, ss = 0, sv = 0;
  // circular mean for hue
  let hx = 0, hy = 0;
  for (const [r, g, b] of arr) {
    sr += r; sg += g; sb += b;
    const c = hsv(r, g, b);
    ss += c.s; sv += c.v;
    hx += Math.cos(c.h * Math.PI / 180); hy += Math.sin(c.h * Math.PI / 180);
  }
  const n = arr.length;
  let hm = Math.atan2(hy / n, hx / n) * 180 / Math.PI; if (hm < 0) hm += 360;
  const mean = [sr / n, sg / n, sb / n];
  console.log(`  ${name}: n=${n} (${(100 * n / ((x1 - x0) * (y1 - y0))).toFixed(1)}%)  rgb(${mean.map(v => v.toFixed(1)).join(',')})  hue=${hm.toFixed(1)}deg  sat=${(ss / n).toFixed(3)}  val=${(sv / n).toFixed(3)}`);
  console.log(`      channel ratios  G/R=${(mean[1] / Math.max(mean[0], 1e-6)).toFixed(3)}  B/R=${(mean[2] / Math.max(mean[0], 1e-6)).toFixed(3)}`);
  return { mean, hue: hm, sat: ss / n };
}

console.log(`${a[0]} [${x0},${y0}-${x1},${y1}]  dark L<${darkL}, lit L>${litL}`);
const d = report('dark', groups.dark);
const l = report('lit ', groups.lit);
if (d && l) {
  console.log(`  -> hue shift dark vs lit: ${(d.hue - l.hue).toFixed(1)} deg`);
  console.log(`  -> sat ratio dark/lit   : ${(d.sat / l.sat).toFixed(3)}`);
  console.log(`     (bounce-lit dark should hold hue and saturation; a term`);
  console.log(`      reaching zero desaturates toward neutral)`);
}
