/* The three things a critic could name, measured the way it measured them.
 *
 * A whole-scene critique named exactly three of System 7's terms as effects
 * rather than as the scene: sky banding, the vignette, and black clipping from
 * the shadow toe. All three had been measured before and passed, and all three
 * passed because the measurement was taken somewhere the defect is not. So this
 * takes them where it found them.
 *
 *   --band    Run lengths of identical code values down a sky column, and how
 *             many distinct levels the gradient uses. Banding is not an amplitude
 *             so an rms figure cannot see it: a smooth ramp crossing an 8-bit
 *             step produces a staircase whose *tread length* is the artefact, and
 *             a 12-pixel tread is a visible contour however small the riser is.
 *             This is why 0.44 code values rms of grain read as "below the
 *             quantisation step, therefore fine" when the contouring was plain.
 *
 *   --corner  Corner falloff against an ungraded control, restricted to *bright*
 *             pixels. A multiplicative light loss is a constant ratio, so a
 *             mid-grey probe and a bright-sky probe should agree — and when they
 *             do not, something other than the vignette is pulling the corner and
 *             the mid-grey figure is the one that is wrong. -3.8 code values at
 *             mid grey and a 26% pull on sky is exactly that disagreement.
 *
 *   --black   Fraction of the whole frame at literal zero, graded against
 *             control. Whole frame rather than a crop, because a wall crop that
 *             reads 0.4% says nothing about clasts and shaded ground elsewhere,
 *             and the crop is where this was last checked.
 *
 *   node tools/_p7name.mjs --band shots/sys7h_sun_gap.png
 *   node tools/_p7name.mjs --corner shots/sys7h_wash_mid.png shots/sys7h_nopost_wash_mid.png
 *   node tools/_p7name.mjs --black shots/sys7h_bend.png shots/sys7h_nopost_bend.png
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const a = process.argv.slice(2);
const files = a.filter((x) => /\.png$/i.test(x));
const load = (f) => { const { w, h, ch, px } = decode(readFileSync(f)); return { w, h, ch, px }; };
const at = (im, x, y, c) => im.px[(y * im.w + x) * im.ch + c];
const lum = (im, x, y) =>
  0.2126 * at(im, x, y, 0) + 0.7152 * at(im, x, y, 1) + 0.0722 * at(im, x, y, 2);
const short = (f) => f.replace(/^shots[\\/]/, '');

/* ── banding ─────────────────────────────────────────────────────────────── */

/* Sky only, and found rather than assumed: blue-dominant and bright, scanned
   from the top so a bright rock face cannot be mistaken for it. Stops at the
   first non-sky pixel in each column, which is the skyline. */
function bandCol(im, x) {
  const g = [];
  for (let y = 0; y < im.h; y++) {
    const r = at(im, x, y, 0), gg = at(im, x, y, 1), b = at(im, x, y, 2);
    if (b <= gg || b < 60) break;
    g.push(0.2126 * r + 0.7152 * gg + 0.0722 * b);
  }
  if (g.length < 32) return null;
  /* Run length of the identical *rounded* value, which is what a display shows.
     The rounding matters: the file is already 8-bit, so this is not quantising
     anything, only grouping. */
  let runs = [], cur = 1, levels = new Set([Math.round(g[0])]);
  for (let i = 1; i < g.length; i++) {
    levels.add(Math.round(g[i]));
    if (Math.round(g[i]) === Math.round(g[i - 1])) cur++;
    else { runs.push(cur); cur = 1; }
  }
  runs.push(cur);
  runs.sort((p, q) => p - q);
  return {
    n: g.length,
    levels: levels.size,
    span: Math.abs(g[g.length - 1] - g[0]),
    maxRun: runs[runs.length - 1],
    p90Run: runs[Math.floor(runs.length * 0.9)],
    medRun: runs[runs.length >> 1],
  };
}

function band(im) {
  /* Every 16th column, so one lucky column cannot carry the figure. */
  const rows = [];
  for (let x = 8; x < im.w; x += 16) { const r = bandCol(im, x); if (r) rows.push(r); }
  if (!rows.length) return null;
  const pick = (k) => rows.map((r) => r[k]).sort((p, q) => p - q);
  const mx = pick('maxRun'), lv = pick('levels'), sp = pick('span');
  return {
    cols: rows.length,
    worstRun: mx[mx.length - 1],
    medMaxRun: mx[mx.length >> 1],
    medLevels: lv[lv.length >> 1],
    medSpan: sp[sp.length >> 1],
    /* Levels actually used against levels available. A perfect dither uses every
       code value in the span; a staircase uses a fraction of them. */
    fill: lv[lv.length >> 1] / Math.max(1, Math.round(sp[sp.length >> 1]) + 1),
  };
}

/* ── corner falloff ──────────────────────────────────────────────────────── */

function corners(A, B) {
  const fw = 0.10;
  const boxes = [
    ['top-left', 0, 0], ['top-right', 1 - fw, 0],
    ['bottom-left', 0, 1 - fw], ['bottom-right', 1 - fw, 1 - fw],
    ['centre', 0.5 - fw / 2, 0.5 - fw / 2],
  ];
  const out = [];
  for (const [name, fx, fy] of boxes) {
    const x0 = Math.round(A.w * fx), y0 = Math.round(A.h * fy);
    const x1 = Math.min(A.w, x0 + Math.round(A.w * fw));
    const y1 = Math.min(A.h, y0 + Math.round(A.h * fw));
    let sa = 0, sb = 0, n = 0, sab = 0, sbb = 0, nb = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const la = lum(A, x, y), lb = lum(B, x, y);
        sa += la; sb += lb; n++;
        /* The bright subset, which is where the critique found it. 150 code
           values is sky and lit caprock and nothing else in this scene. */
        if (lb >= 150) { sab += la; sbb += lb; nb++; }
      }
    }
    out.push({
      name,
      all: n ? sa / sb : null,
      bright: nb > n * 0.02 ? sab / sbb : null,
      brightPct: 100 * nb / Math.max(1, n),
      levelA: sa / Math.max(1, n), levelB: sb / Math.max(1, n),
    });
  }
  return out;
}

/* ── level against radius ───────────────────────────────────────────────── */

/* Which of the two candidate mechanisms is pulling a corner down.
 *
 * A vignette is a function of radius and nothing else, so at a fixed level its
 * ratio must fall from centre to corner. A tone curve is a function of level and
 * nothing else, so at a fixed level its ratio must be flat in radius. Reporting
 * the ratio as a table of one against the other separates them in one pass, which
 * arguing from a corner patch cannot: the corners of this scene are dark and its
 * centre is bright, so level and radius are confounded in exactly the way that
 * makes a tone curve look like a graduated filter. */
function attrib(A, B) {
  const LEV = [0, 8, 16, 24, 32, 48, 72, 110, 160, 256];
  const RAD = [0, 0.35, 0.7, 1.05, 1.5];
  const cx = A.w / 2, cy = A.h / 2, rmax = Math.hypot(cx, cy);
  const sum = [], cnt = [];
  for (let i = 0; i < LEV.length - 1; i++) { sum.push(new Float64Array(RAD.length - 1)); cnt.push(new Float64Array(RAD.length - 1)); }
  const lvSum = new Float64Array(LEV.length - 1), lvCnt = new Float64Array(LEV.length - 1);
  for (let y = 0; y < A.h; y += 2) {
    for (let x = 0; x < A.w; x += 2) {
      const lb = lum(B, x, y);
      if (lb < 1) continue;
      const ratio = lum(A, x, y) / lb;
      const rn = Math.hypot(x - cx, y - cy) / rmax * 1.5;
      let li = 0; while (li < LEV.length - 2 && lb >= LEV[li + 1]) li++;
      let ri = 0; while (ri < RAD.length - 2 && rn >= RAD[ri + 1]) ri++;
      sum[li][ri] += ratio; cnt[li][ri]++;
      lvSum[li] += ratio; lvCnt[li]++;
    }
  }
  return { LEV, RAD, sum, cnt, lvSum, lvCnt };
}

/* ── black clipping ─────────────────────────────────────────────────────── */

function black(im) {
  let z = 0, near = 0, n = im.w * im.h;
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      const r = at(im, x, y, 0), g = at(im, x, y, 1), b = at(im, x, y, 2);
      if (r === 0 && g === 0 && b === 0) z++;
      else if (r <= 2 && g <= 2 && b <= 2) near++;
    }
  }
  return { pct0: 100 * z / n, pctNear: 100 * (z + near) / n };
}

/* ── report ─────────────────────────────────────────────────────────────── */

if (a.includes('--band')) {
  console.log('\n  sky banding: run length of one code value down a column');
  console.log('  ' + 'frame'.padEnd(30) +
              'cols  worst run  median worst  levels  span  fill');
  for (const f of files) {
    const b = band(load(f));
    if (!b) { console.log('  ' + short(f).padEnd(30) + '  no sky found'); continue; }
    console.log('  ' + short(f).padEnd(30) +
      String(b.cols).padStart(4) +
      String(b.worstRun).padStart(11) +
      String(b.medMaxRun).padStart(14) +
      String(b.medLevels).padStart(8) +
      b.medSpan.toFixed(0).padStart(6) +
      (b.fill * 100).toFixed(0).padStart(5) + '%');
  }
  console.log('\n  fill is levels used against levels available across the span.');
  console.log('  a dithered ramp approaches 100%; a staircase is the reciprocal');
  console.log('  of its tread length.\n');
}

if (a.includes('--corner')) {
  const A = load(files[0]), B = load(files[1]);
  console.log(`\n  corner falloff: ${short(files[0])} over ${short(files[1])}`);
  console.log('  ' + 'patch'.padEnd(14) + 'all px   bright px   bright%   level');
  for (const c of corners(A, B)) {
    console.log('  ' + c.name.padEnd(14) +
      (c.all === null ? '   n/a' : c.all.toFixed(3).padStart(6)) +
      (c.bright === null ? '        n/a' : c.bright.toFixed(3).padStart(11)) +
      c.brightPct.toFixed(0).padStart(9) + '%' +
      c.levelB.toFixed(0).padStart(8));
  }
  console.log('\n  a multiplicative light loss is one ratio at every level, so the');
  console.log('  two ratio columns disagreeing means something else is in it.\n');
}

if (a.includes('--attrib')) {
  const A = load(files[0]), B = load(files[1]);
  const t = attrib(A, B);
  console.log(`\n  graded over ungraded, by control level and by radius`);
  console.log(`  ${short(files[0])} over ${short(files[1])}`);
  let hdr = '  ' + 'level cv'.padEnd(12);
  for (let r = 0; r < t.RAD.length - 1; r++) hdr += `r ${t.RAD[r].toFixed(2)}-${t.RAD[r + 1].toFixed(2)}`.padStart(13);
  console.log(hdr + '        all');
  for (let l = 0; l < t.LEV.length - 1; l++) {
    if (!t.lvCnt[l]) continue;
    let row = '  ' + `${t.LEV[l]}-${t.LEV[l + 1]}`.padEnd(12);
    for (let r = 0; r < t.RAD.length - 1; r++) {
      row += (t.cnt[l][r] > 200 ? (t.sum[l][r] / t.cnt[l][r]).toFixed(3) : '-').padStart(13);
    }
    console.log(row + (t.lvSum[l] / t.lvCnt[l]).toFixed(3).padStart(11));
  }
  console.log('\n  down a column is the tone curve; across a row is the vignette.\n');
}

if (a.includes('--black')) {
  console.log('\n  black clipping, whole frame');
  console.log('  ' + 'frame'.padEnd(34) + 'at 0,0,0   within 2');
  for (const f of files) {
    const b = black(load(f));
    console.log('  ' + short(f).padEnd(34) +
      (b.pct0.toFixed(2) + '%').padStart(8) +
      (b.pctNear.toFixed(2) + '%').padStart(11));
  }
  console.log('');
}
