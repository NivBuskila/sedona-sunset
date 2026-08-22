/* Colour on lit rock, with the three guards that would have caught the two ways
 * this measurement has now been wrong.
 *
 * ── guard 1: refuse to report from a frame that logged an error ─────────────
 *
 * A capture reported sunlit sandstone at saturation 0.33 and hue -147 degrees,
 * and it was routed as a material regression on the strength of a clean
 * attribution: the figure appeared identically in the ungraded control, and it
 * moved in one viewpoint while four others held to three decimals. Both of those
 * were true and the conclusion was wrong. The rock fragment program had failed to
 * link on an undeclared uniform, so every rock mesh in every view drew nothing,
 * and the fixed window was measuring the sky standing behind the missing wall.
 * The other windows held still because they are floor, sand and juniper crops
 * with no rock in them — which is how a total blackout presents as one view's
 * material fault.
 *
 * The capture had already written the GLSL error into its own manifest. So this
 * reads that manifest first and refuses to print a colour figure at all if the
 * log is non-empty. A frame that did not compile is not evidence about pigment.
 *
 * ── guard 2: quote the spread, and distrust a collapsed one ────────────────
 *
 * The tell was inside the number. That crop's hue had a q25-q75 spread of one
 * degree, where sunlit rock a capture earlier spans 17.9 to 23.9. A real shading
 * change moves a distribution; it does not concentrate it. **When a spread
 * collapses at the same time as its mean moves, the population has been replaced
 * rather than shaded differently** — so the spread is reported beside every mean
 * and flagged when it falls under a few degrees.
 *
 * ── guard 3: report the clipped fraction beside the saturation ─────────────
 *
 * Saturation is (max-min)/max, so anything that moves the top of the range moves
 * it without any pigment changing. A reading of 0.687 on lit rock was traced to a
 * clipped top rather than colour: pixels at 254+ went from 0.00% to 0.33% while
 * the window's mean max channel *fell*. A saturation figure quoted without the
 * clipped fraction beside it cannot be checked for that later.
 *
 *   node tools/_p7col.mjs shots/sys7k_wall_lit.png shots/sys7k_nopost_wall_lit.png
 */
import { readFileSync, existsSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const files = a.filter((x) => /\.png$/i.test(x));
const POP = a.includes('--all') ? 1 : 0.40;   // brightest 40%, as every rock target is stated
const di = a.indexOf('--down');
const DOWN = di >= 0 ? Math.max(1, +a[di + 1] || 2) : 1;
const NOGUARD = a.includes('--noguard');      // for frames whose manifest predates this tool

/* Box-downsample before measuring, which is how "does this statistic depend on
   resolution" gets answered on identical content rather than on two renders that
   also differ by sampling. It matters because the population this metric selects
   is the brightest 40% *of the pixels present*, and a mip chain averaging a metre
   of wall into one pixel does not produce the same distribution as one resolving
   it. Averaged in linear light, because averaging code values is a different
   operation and the wrong one. */
function down(im, n) {
  if (n <= 1) return im;
  const w = Math.floor(im.w / n), h = Math.floor(im.h / n);
  const out = new Uint8Array(w * h * 3);
  const toLin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const toEnc = (l) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const p = ((y * n + j) * im.w + (x * n + i)) * im.ch;
          for (let c = 0; c < 3; c++) acc[c] += toLin(im.px[p + c]);
        }
      }
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(toEnc(acc[c] / (n * n)))));
    }
  }
  return { w, h, ch: 3, px: out };
}

/* The same windows sat.mjs uses, so the figures are comparable with every number
   already quoted in CONTRACT.md. Widening or moving one of these silently would
   orphan all of them. */
const REGIONS = {
  wall_lit:   [['rock lit', [0.30, 0.24, 0.34, 0.34]]],
  wall_shade: [['rock', [0.30, 0.24, 0.24, 0.24]]],
  bend:       [['wall', [0.06, 0.30, 0.22, 0.26]]],
  far_270:    [['far rock', [0.30, 0.30, 0.40, 0.30]]],
  far_320:    [['far rock', [0.30, 0.30, 0.40, 0.30]]],
  /* The paired floor windows, and the only pair in the tables: the same dirt in sun
     and in fill, so every difference between the rows is transport and none of it is
     pigment. Both rows are measured on the WHOLE window rather than the brightest
     40%, and that is not a lapse from the rule this file exists to enforce — it is
     the rule applied. A brightest-40% population is the right one for a lit rock
     window because that window contains rock at a range of orientations and the
     target describes the sunlit part of it. These two windows are each uniform in
     illumination by construction, which is the point of the viewpoint, so there is
     no sub-population to select and taking the brightest 40% of the shaded row
     would quietly report its brightest pixels as its fill. That is the darkest-40%
     error inverted, and it is the fourth of five populations mis-taken tonight.
     sat.mjs, hue.mjs and grad.mjs read these windows whole, and this file agrees
     with them deliberately so the paired rows cannot disagree across tools.
     No wall window here on purpose: at 160 m astern every wall crop straddles the
     terminator. Do not add one. */
  shade_far:  [['floor shade', [0.58, 0.66, 0.34, 0.28], 1],
               ['floor lit',   [0.04, 0.74, 0.22, 0.20], 1]],
};

const q = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : NaN;

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  if (c === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / c) % 6;
  else if (mx === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  return h > 180 ? h - 360 : h;
}

function measure(img, [fx, fy, fw, fh], whole) {
  const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
  const x1 = Math.min(img.w, x0 + Math.round(img.w * fw));
  const y1 = Math.min(img.h, y0 + Math.round(img.h * fh));
  const px = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 12) continue;
      px.push({ s: (mx - mn) / mx, v: mx / 255, h: hueOf(r, g, b), mx, bg: g > 0 ? b / g : 0 });
    }
  }
  if (!px.length) return null;
  px.sort((p, r) => p.v - r.v);
  const pop = whole ? 1 : POP;
  const sel = pop === 1 ? px : px.slice(-Math.max(1, Math.round(px.length * pop)));
  const S = sel.map((p) => p.s).sort((p, r) => p - r);
  const H = sel.map((p) => p.h).sort((p, r) => p - r);
  const mean = (v) => v.reduce((p, r) => p + r, 0) / v.length;
  let clip254 = 0, clip250 = 0;
  for (const p of sel) { if (p.mx >= 254) clip254++; if (p.mx >= 250) clip250++; }
  return {
    n: sel.length,
    sat: mean(S), satQ: [q(S, 0.25), q(S, 0.75)],
    hue: q(H, 0.5), hueQ: [q(H, 0.25), q(H, 0.75)],
    bg: mean(sel.map((p) => p.bg)),
    v: mean(sel.map((p) => p.v)),
    maxCV: mean(sel.map((p) => p.mx)),
    clip254: 100 * clip254 / sel.length,
    clip250: 100 * clip250 / sel.length,
  };
}

/* The manifest a capture writes next to its PNGs, found from the file name. */
function logsFor(file) {
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/i, '');
  const tag = base.replace(/_(?:nopost|same|vig0)?_?[a-z]+_?[a-z0-9]*$/i, '');
  for (const cand of [tag, base.split('_')[0]]) {
    const p = `shots/${cand}.json`;
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        return { path: p, logs: Array.isArray(j.logs) ? j.logs : [] };
      } catch { /* fall through */ }
    }
  }
  return { path: null, logs: null };
}

console.log(POP === 1
  ? '\n  *** WHOLE WINDOW — this is NOT the population the contract band describes. ***\n' +
    '  The bands are stated on the brightest 40%. On wall_lit the same crop reads 0.615\n' +
    '  at 20.9 degrees restricted and 0.685 at 14.3 whole, because the unrestricted\n' +
    '  window includes the oblique and shaded parts of the wall, which are redder and\n' +
    '  more saturated. Quoting this against the band reads as a regression twice over.'
  : '\n  rock and floor colour. Population is per window and printed on every row:\n' +
    '  the brightest 40% where a window holds surfaces at a range of orientations and\n' +
    '  the target describes the sunlit part, the whole window where the window is\n' +
    '  uniform in illumination by construction and there is no sub-population to pick.');
console.log('  ' + 'frame'.padEnd(29) + 'resolution '.padEnd(11) + 'sat   q25-q75      hue   q25-q75     B/G      V   maxcv  >=254  >=250');

let refused = 0;
for (const f of files) {
  const base = f.replace(/^.*[\\/]/, '').replace(/\.png$/i, '');
  const key = Object.keys(REGIONS).find((k) => base.endsWith('_' + k));
  if (!key) { console.log('  ' + base.padEnd(30) + '  no rock window defined for this view'); continue; }

  const { path, logs } = logsFor(f);
  if (logs === null && !NOGUARD) {
    console.log('  ' + (base + (DOWN > 1 ? ' /' + DOWN : '')).padEnd(30) + '  REFUSED: no manifest found, cannot confirm the frame compiled');
    refused++; continue;
  }
  if (logs && logs.length) {
    console.log('  ' + base.padEnd(30) + `  REFUSED: ${path} logs ${logs.length} entr${logs.length > 1 ? 'ies' : 'y'}`);
    const first = String(logs[0]).split('\n').find((l) => /ERROR|error/.test(l)) || String(logs[0]).split('\n')[0];
    console.log('  ' + ''.padEnd(30) + `  ${first.slice(0, 90)}`);
    refused++; continue;
  }

  for (const [label, r, whole] of REGIONS[key]) {
    const im = down(decode(readFileSync(f)), DOWN);
    const m = measure(im, r, whole);
    if (!m) { console.log('  ' + base.padEnd(30) + '  window empty'); continue; }
    const spread = m.hueQ[1] - m.hueQ[0];
    const flag = (spread < 3 ? '  <-- SPREAD COLLAPSED, sample is probably not rock' : '') +
      (whole ? '  [whole window: uniform illumination by construction]' : '');
    console.log('  ' + base.padEnd(29) + `${im.w}x${im.h}`.padEnd(11) +
      m.sat.toFixed(3) + ' ' + `${m.satQ[0].toFixed(2)}-${m.satQ[1].toFixed(2)}`.padStart(11) +
      m.hue.toFixed(1).padStart(9) + ' ' + `${m.hueQ[0].toFixed(1)}-${m.hueQ[1].toFixed(1)}`.padStart(11) +
      m.bg.toFixed(3).padStart(8) + m.v.toFixed(3).padStart(7) +
      m.maxCV.toFixed(1).padStart(8) +
      (m.clip254.toFixed(2) + '%').padStart(7) + (m.clip250.toFixed(2) + '%').padStart(7) +
      (label === 'rock lit' ? '' : `   [${label}]`) + flag);
  }
}

/* Two layers, and they are not interchangeable — printing them as one line cost a
 * morning. The outer layer is what Sedona photographs actually contain and is the
 * only thing that can put a figure "out of band". The inner layer is tighter than
 * the photographs and exists as a drift guard on numbers this project has earned;
 * a reading outside it means look, not fail.
 *
 * V has no inner guard, and the 0.589-0.600 this footer used to print as one was
 * not a band at all. Those are two readings out of CONTRACT.md's own history -
 * 0.589 from the azimuth-elevation sweep and 0.600 from `sys4c`, and the document
 * introduces 0.600 as "the first frame in the project inside the 0.59-0.73
 * reference band", so it is that band's floor and not its ceiling. Both predate
 * `EXPOSURE` coming down to 0.95, a fit whose stated success criterion was putting
 * lit-face V at 0.693 inside 0.59-0.73. So the footer was asking the renderer to
 * undo its own exposure fit, and 0.687 was reported out of band while sitting
 * nearer the middle of the real band than either number quoted against it.
 */
console.log('\n  acceptance bands, from Sedona reference photographs — a figure outside');
console.log('  one of these is out of band: saturation 0.42-0.65, hue +15.6-31 degrees,');
console.log('  V 0.59-0.73.');
console.log('  drift guards, tighter than the photographs, earned rather than referenced —');
console.log('  outside one of these means look, not fail: saturation 0.615-0.626, hue');
console.log('  18.9-21.1 degrees. There is no drift guard on V; read it against 0.59-0.73.');
console.log('  A saturation figure without the clipped fraction beside it cannot be');
console.log('  checked for a moved ceiling later, and a hue spread under 3 degrees on a');
console.log('  rock crop means the window is not looking at rock.\n');
if (refused) { console.log(`  ${refused} frame(s) refused.\n`); process.exit(2); }
