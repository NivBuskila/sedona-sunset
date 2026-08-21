/* How antialiased is the skyline, and in what units?
 *
 * The whole-scene critique calls the silhouette against bright sky the worst
 * remaining edge in the frame, and System 2 measured the median largest
 * one-pixel jump across it at 27-28 levels, falling to 18-20 in a 3200x1800
 * capture box-downsampled to 1600x900. That was read as the edges not being
 * sampled at all. They are: tools/_p7msaa.mjs asks the driver, and 26 of 48
 * indexed draws land in a four-sample framebuffer.
 *
 * So the question changes. Four coverage samples on an edge cannot produce more
 * than three intermediate levels, and where they land depends on the space the
 * blend happens in. MSAA averages *linear radiance*; a box downsample of a PNG
 * averages *code values*. Across a 100:1 silhouette those are not the same
 * picture at all, because the encode is steep at the dark end, so a coverage
 * blend in linear puts almost all of its gradation within a few code values of
 * the sky and leaves one enormous step on the rock side.
 *
 * This measures the profile rather than arguing about it: per column, the
 * largest one-pixel jump across the transition, and how many intermediate levels
 * the edge actually carries. Given a supersampled capture it also downsamples the
 * same pixels twice, once in code value and once in linear, which separates
 * "more samples" from "averaged in a different space".
 *
 *   node tools/_p7edge.mjs shots/sys7e_bend.png
 *   node tools/_p7edge.mjs shots/sys7e_bend.png --ss shots/p7ss_bend.png
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encodeRGB } from './png.mjs';

const a = process.argv.slice(2);
const si = a.indexOf('--ss');
const SS = si >= 0 ? a[si + 1] : null;
const files = a.filter((x, i) => !x.startsWith('--') && !(si >= 0 && i === si + 1));

const load = (f) => { const { w, h, ch, px } = decode(readFileSync(f)); return { w, h, ch, px }; };
const lum = (im, i) => 0.2126 * im.px[i * im.ch] + 0.7152 * im.px[i * im.ch + 1] + 0.0722 * im.px[i * im.ch + 2];
const toLin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const toEnc = (x) => 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/** Box-downsample by n, averaging in code value or in linear light. */
function down(im, n, space) {
  const w = Math.floor(im.w / n), h = Math.floor(im.h / n);
  const out = { w, h, ch: 3, px: new Uint8Array(w * h * 3) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const v = im.px[((y * n + j) * im.w + (x * n + i)) * im.ch + c];
            s += space === 'linear' ? toLin(v) : v;
          }
        }
        s /= n * n;
        out.px[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(space === 'linear' ? toEnc(s) : s)));
      }
    }
  }
  return out;
}

/* Per column: find the sky-to-rock transition, then report the largest
   one-pixel step in the eight rows spanning it and how many of those rows hold
   a value strictly between the two plateaux. */
function edges(im) {
  const jumps = [], mids = [];
  for (let x = 0; x < im.w; x++) {
    if (lum(im, 2 * im.w + x) < 150) continue;
    let e = -1;
    for (let y = 4; y < im.h - 12; y++) {
      const above = (lum(im, (y - 2) * im.w + x) + lum(im, (y - 1) * im.w + x)) / 2;
      const below = (lum(im, (y + 2) * im.w + x) + lum(im, (y + 3) * im.w + x)) / 2;
      if (above > 120 && above - below > 45) { e = y; break; }
    }
    if (e < 0) continue;
    let mx = 0, n = 0;
    const hi = lum(im, (e - 2) * im.w + x), lo = lum(im, (e + 3) * im.w + x);
    for (let k = -2; k <= 3; k++) {
      const d = Math.abs(lum(im, (e + k + 1) * im.w + x) - lum(im, (e + k) * im.w + x));
      if (d > mx) mx = d;
      const v = lum(im, (e + k) * im.w + x);
      if (v < hi - 6 && v > lo + 6) n++;
    }
    jumps.push(mx); mids.push(n);
  }
  jumps.sort((p, q) => p - q);
  const med = (arr) => arr.length ? arr.slice().sort((p, q) => p - q)[arr.length >> 1] : NaN;
  return {
    cols: jumps.length,
    median: med(jumps),
    p90: jumps.length ? jumps[Math.floor(jumps.length * 0.9)] : NaN,
    midLevels: mids.reduce((s, v) => s + v, 0) / (mids.length || 1),
  };
}

/* Simulate the candidate resolve: a contrast-gated blend *along* the local edge
 * direction, in display space.
 *
 * Along, not across. Blurring across a silhouette would soften the edge and
 * spend exactly the far-field structure System 2 earned; blurring along it
 * attacks the actual artefact, which is that the transition pixel exists in some
 * columns and not the next, and that column-to-column alternation is the
 * staircase. Averaging along the ridge fills in the columns that had no
 * transition pixel and leaves the profile across the edge alone.
 *
 * The gate is what keeps it off everything else. Rock interior gradients run a
 * few code values per pixel, so a threshold in the tens cannot reach them; only
 * a silhouette against sky qualifies.
 */
function resolve(im, { t0 = 70, t1 = 130, amt = 0.75 } = {}) {
  const out = { w: im.w, h: im.h, ch: 3, px: new Uint8Array(im.w * im.h * 3) };
  const L = new Float32Array(im.w * im.h);
  for (let i = 0; i < im.w * im.h; i++) L[i] = lum(im, i);
  const at = (x, y) => L[Math.min(im.h - 1, Math.max(0, y)) * im.w + Math.min(im.w - 1, Math.max(0, x))];
  const px = (x, y, c) => im.px[(Math.min(im.h - 1, Math.max(0, y)) * im.w +
                                 Math.min(im.w - 1, Math.max(0, x))) * im.ch + c];
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      const c0 = at(x, y), n = at(x, y - 1), s = at(x, y + 1), e = at(x + 1, y), w = at(x - 1, y);
      const range = Math.max(c0, n, s, e, w) - Math.min(c0, n, s, e, w);
      const g = Math.min(1, Math.max(0, (range - t0) / (t1 - t0)));
      const wt = g * g * (3 - 2 * g) * amt;
      const o = (y * im.w + x) * 3;
      if (wt <= 0.001) {
        for (let c = 0; c < 3; c++) out.px[o + c] = px(x, y, c);
        continue;
      }
      /* Gradient, then a step along the perpendicular, snapped to the dominant
         axis so the two taps land on texel centres rather than between them. */
      const gx = e - w, gy = s - n;
      const dx = Math.abs(gy) > Math.abs(gx) ? 1 : 0, dy = dx ? 0 : 1;
      for (let c = 0; c < 3; c++) {
        const a2 = px(x + dx, y + dy, c), b2 = px(x - dx, y - dy, c);
        out.px[o + c] = Math.round(px(x, y, c) * (1 - wt) + 0.5 * (a2 + b2) * wt);
      }
    }
  }
  return out;
}

/* Where did the resolve actually fire?
 *
 * The gate is the whole safety argument — it is what makes this a silhouette fix
 * rather than a soft-focus filter — and the argument is only worth as much as the
 * measurement. Given two frames that differ by nothing but the resolve, this
 * reports what fraction of pixels moved and, for those that did, the local
 * luminance range they sit in. If the changed pixels are all in high-range
 * neighbourhoods and the surface interiors are untouched, that is the claim.
 * Optionally restricted to a crop, so a region metric that moved can be
 * attributed rather than guessed at.
 *
 *   node tools/_p7edge.mjs --touch off.png on.png [x y w h fractions]
 */
function touch(A, B, crop) {
  const [fx, fy, fw, fh] = crop || [0, 0, 1, 1];
  const x0 = Math.round(A.w * fx), y0 = Math.round(A.h * fy);
  const x1 = Math.min(A.w - 1, x0 + Math.round(A.w * fw));
  const y1 = Math.min(A.h - 1, y0 + Math.round(A.h * fh));
  const L = (im, x, y) => lum(im, y * im.w + x);
  let n = 0, moved = 0, rSumMoved = 0, rSumStill = 0, dSum = 0, dMax = 0;
  const bins = [0, 0, 0, 0];  // moved pixels by local range: <20, 20-40, 40-90, >=90
  for (let y = Math.max(1, y0); y < y1; y++) {
    for (let x = Math.max(1, x0); x < x1; x++) {
      const c = L(A, x, y);
      const range = Math.max(c, L(A, x - 1, y), L(A, x + 1, y), L(A, x, y - 1), L(A, x, y + 1)) -
                    Math.min(c, L(A, x - 1, y), L(A, x + 1, y), L(A, x, y - 1), L(A, x, y + 1));
      const d = Math.abs(L(B, x, y) - c);
      n++;
      if (d >= 1) {
        moved++; rSumMoved += range; dSum += d; dMax = Math.max(dMax, d);
        bins[range < 20 ? 0 : range < 40 ? 1 : range < 90 ? 2 : 3]++;
      } else rSumStill += range;
    }
  }
  return {
    n, moved, pct: 100 * moved / Math.max(1, n),
    rangeMoved: rSumMoved / Math.max(1, moved),
    rangeStill: rSumStill / Math.max(1, n - moved),
    dMean: dSum / Math.max(1, moved), dMax, bins,
  };
}

const ti = a.indexOf('--touch');
if (ti >= 0) {
  const nums = a.filter((x) => /^[0-9.]+$/.test(x)).map(Number);
  const crop = nums.length === 4 ? nums : null;
  const A = load(files[0]), B = load(files[1]);
  const t = touch(A, B, crop);
  console.log(`\n  ${files[0]} -> ${files[1]}` + (crop ? `   crop ${crop.join(' ')}` : '   whole frame'));
  console.log(`  pixels moved by >=1 code value: ${t.moved} of ${t.n}  (${t.pct.toFixed(2)}%)`);
  console.log(`  mean local luminance range: moved ${t.rangeMoved.toFixed(1)} CV,` +
              ` unmoved ${t.rangeStill.toFixed(1)} CV`);
  console.log(`  moved pixels by local range:  <20: ${t.bins[0]}   20-40: ${t.bins[1]}` +
              `   40-90: ${t.bins[2]}   >=90: ${t.bins[3]}`);
  console.log(`  change on moved pixels: mean ${t.dMean.toFixed(1)} CV, max ${t.dMax.toFixed(0)} CV\n`);
  process.exit(0);
}

const rows = [];
for (const f of files) {
  const im = load(f);
  rows.push([f.replace(/^shots\//, ''), edges(im)]);
  if (a.includes('--sim')) {
    for (const amt of [0.5, 0.75, 1.0]) {
      rows.push([`  resolved along edge, amount ${amt}`, edges(resolve(im, { amt }))]);
    }
  }
  /* The gate sweep, written to disk so grad.mjs can be run on the same frames.
     The point of doing it offline is that the trade is between two metrics that
     live in different tools — the edge figure here and the surface hf/lf there —
     and a render per candidate would make sweeping it a morning's work rather
     than a minute's. resolve() is the shader's arithmetic, so these are
     predictions of a capture and are checked against one afterwards. */
  if (a.includes('--gate')) {
    for (const [t0, t1] of [[30, 80], [40, 90], [55, 110], [70, 130]]) {
      const sim = resolve(im, { t0, t1, amt: 0.75 });
      rows.push([`  gate ${t0}-${t1} at 0.75`, edges(sim)]);
      const out = `shots/_gate${t0}_${f.replace(/^shots\//, '')}`;
      writeFileSync(out, encodeRGB(sim.w, sim.h, Buffer.from(sim.px)));
    }
  }
}
if (SS) {
  const im = load(SS);
  const n = Math.round(im.w / (load(files[0]).w));
  rows.push([`${SS.replace(/^shots\//, '')} /${n} in code value`, edges(down(im, n, 'code'))]);
  rows.push([`${SS.replace(/^shots\//, '')} /${n} in linear light`, edges(down(im, n, 'linear'))]);
  rows.push([`${SS.replace(/^shots\//, '')} native`, edges(im)]);
}

console.log('\n  largest one-pixel jump across the skyline, in code values');
console.log('  ' + 'frame'.padEnd(44) + 'cols   median   p90   intermediate rows');
for (const [name, e] of rows) {
  console.log('  ' + name.padEnd(44) + String(e.cols).padStart(4) +
              '   ' + e.median.toFixed(1).padStart(6) +
              '   ' + e.p90.toFixed(1).padStart(5) +
              '   ' + e.midLevels.toFixed(2).padStart(6));
}
console.log('\n  four coverage samples cannot give more than three intermediate');
console.log('  levels; where they land is decided by the space the blend is in.\n');
