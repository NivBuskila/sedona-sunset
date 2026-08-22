/* Mean absolute one-pixel luminance gradient over a region crop — the "is there
 * any material on this surface" metric.
 *
 *   node tools/grad.mjs shots/sys2e_wall_lit.png 0.16 0.30 0.20 0.20
 *   node tools/grad.mjs shots/sys2f_wall_lit.png            (uses the presets)
 *
 * Why this number and not variance. A surface can have plenty of variance and
 * still be smooth — a broad Lambertian ramp across a cliff has a large standard
 * deviation and no material in it at all. What distinguishes rock from wax is
 * energy at the *pixel* scale, so the statistic is the mean of |dL/dx| and
 * |dL/dy| at one-pixel separation, in linear-ish display units (luminance / 255).
 *
 * Measured references, from photographs of the same formations:
 *
 *   Courthouse Butte cliff face            0.074
 *   Courthouse Butte cliff face (2)        0.085
 *   Coconino surface, fine grained         0.027
 *   Cathedral Rock face                    0.026
 *
 * So the floor for "this is stone" is about 0.026 and a coarse weathered
 * Schnebly face is three times that. Anything at 0.005 is polished plastic.
 *
 * Also reported:
 *   hf/lf   the share of the gradient carried at one pixel versus at four. A
 *           high figure with a low hf/lf ratio is a blotchy quilt of large soft
 *           cells rather than grain, which is the other way to fail this test.
 *   sd      standard deviation of luminance over the region, for context: it is
 *           what tells you whether a low gradient is a smooth surface or a flat
 *           one.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

/* Same windows tools/sat.mjs uses, so a colour figure and a structure figure are
   always talking about the same patch of surface. */
const REGIONS = {
  wall_lit:   [['midwall', [0.16, 0.30, 0.20, 0.20]], ['upper', [0.62, 0.04, 0.20, 0.18]]],
  wall_shade: [['face', [0.30, 0.24, 0.24, 0.24]]],
  wash_mid:   [['wall', [0.28, 0.28, 0.18, 0.16]], ['floor', [0.34, 0.78, 0.28, 0.16]]],
  /* Both of these windows were landing on sky, which averages a bright smooth
     gradient into the figure and makes a wall look four times worse than it is.
     Moved onto rock. Always check where a window actually falls before believing
     a number off it — the standard deviation column is the tell: a crop with sky
     in it reports an sd near 0.34 against 0.10 to 0.26 for a rock face. */
  bend:       [['wall', [0.10, 0.06, 0.22, 0.26]], ['sand', [0.30, 0.68, 0.30, 0.22]]],
  sun_gap:    [['wall', [0.10, 0.30, 0.16, 0.24]]],
  ground:     [['floor', [0.24, 0.32, 0.30, 0.26]]],
  juniper:    [['wall', [0.06, 0.44, 0.18, 0.20]]],
  wash_low:   [['wall', [0.06, 0.26, 0.18, 0.22]]],
  /* Structure in fill against structure in sun, on the same dirt. Worth having as
     a pair here rather than only in the colour tools: shade is where micro-relief
     stops being lit from one direction, so if a fill term is going to flatten
     something into wax this is the window that shows it, and the sunlit half is
     the control that says whether the surface or the lighting did it. */
  shade_far:  [['floor shade', [0.58, 0.66, 0.34, 0.28]], ['floor lit', [0.04, 0.74, 0.22, 0.20]]],
};

function measure(img, [fx, fy, fw, fh]) {
  const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
  const x1 = Math.min(img.w, x0 + Math.round(img.w * fw));
  const y1 = Math.min(img.h, y0 + Math.round(img.h * fh));
  const w = x1 - x0, hh = y1 - y0;
  if (w < 8 || hh < 8) return null;
  const L = new Float64Array(w * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.w + (x0 + x)) * img.ch;
      L[y * w + x] =
        (img.px[i] * 0.2126 + img.px[i + 1] * 0.7152 + img.px[i + 2] * 0.0722) / 255;
    }
  }
  let g1 = 0, n1 = 0, g4 = 0, n4 = 0, sum = 0, sum2 = 0;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const c = L[y * w + x];
      sum += c; sum2 += c * c;
      if (x + 1 < w) { g1 += Math.abs(L[y * w + x + 1] - c); n1++; }
      if (y + 1 < hh) { g1 += Math.abs(L[(y + 1) * w + x] - c); n1++; }
      if (x + 4 < w) { g4 += Math.abs(L[y * w + x + 4] - c); n4++; }
      if (y + 4 < hh) { g4 += Math.abs(L[(y + 4) * w + x] - c); n4++; }
    }
  }
  const n = w * hh, mean = sum / n;
  return {
    n, w, hh,
    grad: g1 / n1,
    grad4: g4 / n4,
    ratio: (g1 / n1) / Math.max(1e-9, g4 / n4),
    mean,
    sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
  };
}

const argv = process.argv.slice(2);
const files = [];
let region = null;
for (let i = 0; i < argv.length; i++) {
  if (/\.png$/i.test(argv[i])) files.push(argv[i]);
  else { region = argv.slice(i, i + 4).map(Number); break; }
}
/* An unrecognised flag used to become a four-number crop of NaN, which silently
   selected no pixels and printed a header with no rows under it. That reads as "the
   measurement came back empty" rather than "you passed a flag that does not exist",
   and this tool has no flags at all — hf/lf is always printed. Same failure mode as
   the shadow ablation that reported 0.05 ms for three quarters of the frame: an
   instrument that answers when it should refuse. */
if (region && region.some((v) => !Number.isFinite(v))) {
  console.error('grad.mjs takes png paths and an optional numeric crop "x y w h" in\n' +
    'frame fractions. It has no flags; hf/lf is printed by default. Got: ' +
    argv.filter((x) => !/\.png$/i.test(x)).join(' '));
  process.exit(2);
}
if (!files.length) { console.error('grad.mjs: no png paths given.'); process.exit(2); }

/* grad/L is reported beside grad because the two are not independent and reading
   grad alone gets the diagnosis wrong in exactly the way sat.mjs warns about for
   saturation. A gradient is a difference of luminances, so it scales with the
   luminance it sits on: the same material at half the exposure measures half the
   gradient. While the lighting is provisional and the lit wall sits at L 0.15
   against 0.59-0.73 in the reference photographs, the raw figure understates the
   material by a factor of four. grad/L is what to compare across exposures; the
   reference faces run 0.11-0.16 by that measure. */
const f = (x, d = 4) => x.toFixed(d);
console.log('file                        region      grad     grad@4   hf/lf   L mean  L sd    grad/L');
for (const file of files) {
  const img = decode(readFileSync(file));
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  const key = Object.keys(REGIONS).find((k) => base.endsWith('_' + k));
  const list = region ? [['crop', region]] : (REGIONS[key] || [['whole', [0.1, 0.1, 0.8, 0.8]]]);
  let name = base.padEnd(26);
  for (const [label, r] of list) {
    const m = measure(img, r);
    if (!m) continue;
    console.log(`${name}  ${label.padEnd(9)}  ${f(m.grad)}   ${f(m.grad4)}  ` +
      ` ${f(m.ratio, 2).padStart(5)}   ${f(m.mean, 3)}   ${f(m.sd, 3)}   ` +
      `${f(m.grad / Math.max(1e-6, m.mean), 3)}`);
    name = ''.padEnd(26);
  }
}
