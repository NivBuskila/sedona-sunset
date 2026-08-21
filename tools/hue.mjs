/* Measure hue and the blue/green channel ratio on a region crop.
 *
 *   node tools/hue.mjs shots/sys4b_wall_lit.png
 *   node tools/hue.mjs --region 0.55 0.10 0.16 0.10 shots/sys4b_wall_lit.png
 *   node tools/hue.mjs --lit shots/sys4b_wall_lit.png
 *
 * CONTRACT.md is explicit that hue matters as much as saturation and that it was
 * missed for four rounds, but until now nothing measured it — tools/sat.mjs
 * reports saturation and value and stops there, so every hue figure in the
 * project's history was read off a screenshot by eye. Targets:
 *
 *   Sedona rock in warm light      hue +22 to +31 degrees
 *   the same, B/G                  0.32 to 0.90, blue well below green
 *   a magenta-cast render          B/G 0.87 to 1.21, blue at or above green
 *
 * Three things about the method, each of which changes the answer.
 *
 * Hue is reported as a *median over pixels*, not as the hue of the mean colour.
 * They are different statistics and the second one is the wrong one: averaging
 * rgb across a crop that contains a bright orange bench and a dark red shadow
 * band returns a colour that neither of them is. The mean is printed too, so the
 * two can be compared, but the median is the figure to quote.
 *
 * Hue is wrapped to (-180, 180] before the median is taken. Red sits at zero, so
 * on an unwrapped scale half a red distribution reads as 358 and the other half
 * as 2, and the median lands at 180 — cyan — which is not a colour anywhere in
 * this scene. This is the same class of error as the periodogram detector in
 * CONTRACT.md's list: a statistic that is confidently wrong rather than noisy.
 *
 * Dark pixels are excluded, because hue is meaningless as luminance goes to
 * zero: (max-min) shrinks with the signal while quantisation does not, so a
 * crushed shadow contributes uniform noise on hue and drags any average toward
 * whatever the dither happens to do. The cut is V >= 0.06, and the fraction of
 * the crop that survives it is reported so the reader can see whether the figure
 * describes the region or a corner of it.
 *
 * **--lit restricts to the brightest 40 percent, and every rock colour target in
 * CONTRACT.md is stated on lit rock, so --lit is the mode that compares with
 * them.** A crop of a cliff at this sun angle is half self-shadowed, and under a
 * directional key those two halves are different materials to a hue statistic:
 * the same `wall_lit` window reads +19.4 lit and +13.7 whole. A whole-window
 * figure quoted against a lit-rock target reads as a regression that is not
 * there, which has already cost this project a round. The fraction matches
 * tools/sat.mjs so the two tools always describe one population. Quote the mode
 * with the number, and report both populations when the question is contrast.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

/* Same windows tools/sat.mjs and tools/grad.mjs use, so a hue figure, a colour
   figure and a structure figure always describe the same patch of surface. */
const REGIONS = {
  ground: [['floor near', [0.20, 0.30, 0.35, 0.30]], ['floor mid', [0.36, 0.06, 0.30, 0.18]]],
  wash_low: [['floor near', [0.30, 0.72, 0.35, 0.22]], ['floor mid', [0.30, 0.50, 0.24, 0.14]]],
  wash_mid: [['floor near', [0.32, 0.76, 0.34, 0.20]], ['floor mid', [0.30, 0.54, 0.26, 0.14]]],
  bend: [['sand', [0.28, 0.66, 0.36, 0.26]], ['wall', [0.10, 0.06, 0.22, 0.26]]],
  juniper: [['floor', [0.30, 0.72, 0.34, 0.20]]],
  sun_gap: [['floor mid', [0.40, 0.72, 0.24, 0.18]], ['wall', [0.10, 0.30, 0.16, 0.24]]],
  wall_lit: [['rock lit', [0.30, 0.24, 0.34, 0.34]], ['midwall', [0.16, 0.30, 0.20, 0.20]]],
  wall_shade: [['rock', [0.30, 0.24, 0.34, 0.34]]],
};

const argv = process.argv.slice(2);
let region = null, litOnly = false;
for (let i = 0; i < argv.length;) {
  if (argv[i] === '--lit') { litOnly = true; argv.splice(i, 1); }
  else if (argv[i] === '--region') { region = argv.slice(i + 1, i + 5).map(Number); argv.splice(i, 5); }
  else i++;
}

const V_FLOOR = 0.06;
/* 0.40, matching tools/sat.mjs exactly. It was 0.30 here and 0.40 there, which
   is how the same frame came to be reported at two different hues in one
   session — +13.7 from this tool and +19.4 from that one, both correct for their
   own population and neither comparable with the other or with a target. One
   convention or the population mode is worse than no population mode. */
const LIT_FRACTION = 0.40;

function measure(img, [fx, fy, fw, fh]) {
  const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
  const x1 = Math.min(img.w, x0 + Math.round(img.w * fw));
  const y1 = Math.min(img.h, y0 + Math.round(img.h * fh));
  const px = [];
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i] / 255, g = img.px[i + 1] / 255, b = img.px[i + 2] / 255;
      const mx = Math.max(r, g, b);
      if (mx < V_FLOOR) continue;
      px.push([r, g, b, mx]);
    }
  }
  if (!px.length) return null;

  let use = px;
  if (litOnly) {
    use = px.slice().sort((a, c) => c[3] - a[3]).slice(0, Math.max(8, Math.round(px.length * LIT_FRACTION)));
  }

  const hues = [], bg = [];
  let sr = 0, sg = 0, sb = 0;
  for (const [r, g, b] of use) {
    sr += r; sg += g; sb += b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d > 1e-6) {
      let h;
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      /* Wrap to (-180,180] so a red distribution does not straddle the seam. */
      h = ((h % 360) + 360) % 360;
      if (h > 180) h -= 360;
      hues.push(h);
    }
    if (g > 1e-4) bg.push(b / g);
  }
  hues.sort((a, c) => a - c);
  bg.sort((a, c) => a - c);
  const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : NaN;
  const n = use.length;
  const mr = sr / n, mg = sg / n, mb = sb / n;
  const mmx = Math.max(mr, mg, mb), mmn = Math.min(mr, mg, mb), md = mmx - mmn;
  let mh = 0;
  if (md > 1e-6) {
    if (mmx === mr) mh = ((mg - mb) / md) % 6;
    else if (mmx === mg) mh = (mb - mr) / md + 2;
    else mh = (mr - mg) / md + 4;
    mh *= 60; mh = ((mh % 360) + 360) % 360; if (mh > 180) mh -= 360;
  }
  return {
    kept: px.length / total, n,
    hMedian: q(hues, 0.5), h25: q(hues, 0.25), h75: q(hues, 0.75), hMean: mh,
    bg: q(bg, 0.5), bgMean: mb / Math.max(1e-6, mg), v: mmx,
  };
}

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '  —  ');
console.log('file                     region      ' +
  '  hue med    q25    q75  of mean |  B/G med  mean |  V     kept');
for (const file of argv) {
  const img = decode(readFileSync(file));
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  const key = Object.keys(REGIONS).find((k) => base.endsWith('_' + k));
  const list = region ? [['crop', region]] : (REGIONS[key] || [['whole', [0.1, 0.1, 0.8, 0.8]]]);
  let name = base.padEnd(23);
  for (const [label, r] of list) {
    const m = measure(img, r);
    if (!m) continue;
    console.log(`${name}  ${(label + (litOnly ? ' lit' : '')).padEnd(10)}  ` +
      `${f(m.hMedian).padStart(7)} ${f(m.h25).padStart(6)} ${f(m.h75).padStart(6)} ` +
      `${f(m.hMean).padStart(7)} | ` +
      `${f(m.bg, 3).padStart(8)} ${f(m.bgMean, 3).padStart(5)} | ` +
      `${f(m.v, 3)} ${f(m.kept * 100, 0).padStart(4)}%`);
    name = ''.padEnd(23);
  }
}
