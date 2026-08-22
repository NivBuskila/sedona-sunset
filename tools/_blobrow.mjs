/* Are the dark patches on a wall arranged in rows at a regular pitch?
 *
 * The ship critic's finding is not "there is periodic content on the wall" -
 * there is, and some of it belongs there, because bedding is periodic on a real
 * cliff too. The finding is that a particular *feature* - soft-edged dark
 * patches, roughly equal width - is laid out in horizontal rows at a roughly
 * equal spacing, which is what makes it read as rows of windows in a building.
 *
 * Autocorrelation is the wrong instrument for that. It answers over a strip of
 * pixels, so a strip thin enough to sit inside one row is dominated by the
 * bedding grain, and a strip tall enough to contain several rows smears them.
 * Measured that way, the frames before and after this fix score the same to two
 * decimals while looking obviously different, which is a sign the number is
 * describing something else.
 *
 * So measure the layout of the patches themselves. Find the dark blobs, take
 * their centroids, and ask the two questions the complaint actually makes:
 *
 *   row concentration - the fraction of blob pairs sharing a row, against the
 *     fraction expected if the same blobs were spread uniformly over the crop.
 *     Rows put this well above 1; a scatter puts it near 1.
 *   pitch regularity - the coefficient of variation of the horizontal gaps
 *     between blobs that do share a row. A regular pitch is near 0.2; the eye
 *     stops calling a spacing a rhythm above about 0.35.
 *
 * It did not work, and it is kept so that nobody spends the afternoon rebuilding
 * it. On the three framings the critic named it finds only eight to eleven
 * patches per crop, which leaves three to six same-row gaps, and a CV over three
 * samples carries no information; worse, it scores the *before* frames at 0.91 to
 * 1.26 times chance for row concentration, i.e. no rows, on the very crops where
 * the rows are plainly visible. The size filter and the local-contrast threshold
 * are picking up cast shadows and vegetation alongside the varnish and missing
 * the softest tongues, so the population it measures is not the population being
 * complained about.
 *
 * The lesson is about which instrument answers which question. What did settle
 * this was an ablation - one uniform to zero, everything else held - because that
 * isolates a *term* rather than trying to recognise a *feature*. Recognising the
 * feature was the hard problem and it was not the problem that needed solving.
 *
 *   node tools/_blobrow.mjs shots/a.png x0,y0,x1,y1 [more crops]
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const file = process.argv[2];
const crops = process.argv.slice(3).filter((a) => a.includes(','));
const img = decode(readFileSync(file));
const ch = img.ch ?? (img.px.length / (img.w * img.h));

console.log(`${file}  ${img.w}x${img.h}`);
for (const c of crops) {
  const [x0, y0, x1, y1] = c.split(',').map(Number);
  const W = x1 - x0, H = y1 - y0;
  const lum = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((y0 + y) * img.w + (x0 + x)) * ch;
      lum[y * W + x] = 0.2126 * img.px[o] + 0.7152 * img.px[o + 1] + 0.0722 * img.px[o + 2];
    }
  }
  /* A patch is dark relative to its own neighbourhood, not to the frame: the
     wall is shaded at the top and lit at the bottom in most of these framings,
     so a global threshold finds the shading gradient instead of the patches.
     Subtract a wide box blur and threshold the residual. */
  const R = Math.round(Math.min(W, H) * 0.22);
  const hi = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -R; dy <= R; dy += 3) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx += 3) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          s += lum[yy * W + xx]; n++;
        }
      }
      hi[y * W + x] = lum[y * W + x] - s / n;
    }
  }
  const srt = [...hi].sort((a, b) => a - b);
  const thr = srt[Math.floor(srt.length * 0.10)];   // darkest tenth of the residual

  /* Connected components, four-way, on the thresholded residual. */
  const lab = new Int32Array(W * H).fill(-1);
  const blobs = [];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (hi[i] > thr || lab[i] >= 0) continue;
    const id = blobs.length;
    let n = 0, sx = 0, sy = 0, xa = 1e9, xb = -1e9, ya = 1e9, yb = -1e9;
    stack.push(i); lab[i] = id;
    while (stack.length) {
      const p = stack.pop(), px = p % W, py = (p - px) / W;
      n++; sx += px; sy += py;
      if (px < xa) xa = px; if (px > xb) xb = px;
      if (py < ya) ya = py; if (py > yb) yb = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = px + dx, qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const q = qy * W + qx;
        if (lab[q] < 0 && hi[q] <= thr) { lab[q] = id; stack.push(q); }
      }
    }
    blobs.push({ n, x: sx / n, y: sy / n, w: xb - xa + 1, h: yb - ya + 1 });
  }
  /* Only patches, not grain: at least a fiftieth of the crop's shorter side
     across in both directions, which for these crops is a few metres of wall. */
  const minSide = Math.max(4, Math.round(Math.min(W, H) * 0.06));
  const keep = blobs.filter((b) => b.w >= minSide && b.h >= minSide && b.n >= minSide * minSide * 0.4);

  const ROW = Math.max(6, Math.round(H * 0.09));
  let same = 0, tot = 0;
  const gaps = [];
  for (let i = 0; i < keep.length; i++) {
    for (let j = i + 1; j < keep.length; j++) {
      tot++;
      if (Math.abs(keep[i].y - keep[j].y) < ROW) same++;
    }
  }
  /* Nearest neighbour to the right within the same row, for the pitch. */
  for (const b of keep) {
    let best = 1e9;
    for (const o of keep) {
      if (o === b || Math.abs(o.y - b.y) >= ROW) continue;
      const d = o.x - b.x;
      if (d > minSide && d < best) best = d;
    }
    if (best < 1e9) gaps.push(best);
  }
  /* Expected same-row fraction if the same blobs were spread uniformly over the
     crop height: P(|dy| < ROW) for two uniform draws on [0,H]. */
  const r = ROW / H;
  const exp = 2 * r - r * r;
  const obs = tot ? same / tot : 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / (gaps.length || 1));

  const wid = keep.map((b) => b.w).sort((a, b) => a - b);
  console.log(`  crop ${c}   ${keep.length} patches (of ${blobs.length} components)`);
  console.log(`    row concentration ${(obs / exp).toFixed(2)}x chance   `
    + `(${(100 * obs).toFixed(0)}% of pairs share a row, ${(100 * exp).toFixed(0)}% expected)`);
  if (gaps.length >= 3) {
    console.log(`    in-row pitch  mean ${mean.toFixed(0)} px  CV ${(sd / mean).toFixed(2)}  `
      + `(n=${gaps.length})`);
  } else {
    console.log(`    in-row pitch  too few same-row neighbours to measure (n=${gaps.length})`);
  }
  if (wid.length) {
    console.log(`    patch width  p50 ${wid[wid.length >> 1]} px  `
      + `p10 ${wid[Math.floor(wid.length * 0.1)]}  p90 ${wid[Math.floor(wid.length * 0.9)]}`);
  }
}
