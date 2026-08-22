/* What the restricted ground band actually put on the picture, and whether it has an edge.
 *
 *   node tools/_banddelta.mjs <tag> <base-tag> [--view ground] [--map out.png]
 *   node tools/_banddelta.mjs s4rb s4rn --view ground --map shots/delta_ground.png
 *
 * Two same-build arms differing only in the term (#noband is the base), so the
 * per-pixel difference **is** the term, with nothing else in it. That is the whole
 * reason to measure the difference rather than the frame: in the frame the term is a
 * few code values on top of a scene, and a step in it is invisible against the
 * scene's own structure; in the difference the scene is gone and a step is the only
 * thing left.
 *
 * The step check is the point. s4FloorLit averages four binary taps, so the
 * restriction takes five values and nothing stops two adjacent pixels landing two
 * levels apart — which is a hard edge drawn across a floor, the exact artefact post's
 * local lift shipped this afternoon with every aggregate figure passing. So this
 * reports the distribution of |delta| between horizontally and vertically adjacent
 * pixels *inside the term's own support*, and the worst runs of it. A smooth term has
 * a long tail of ones and twos; a terraced one has a spike at the level height.
 *
 * Caveat worth stating because it bounds the whole reading: the two arms are separate
 * captures, so a few code values of the difference are capture noise rather than the
 * term. The noise floor is measured here rather than assumed — `--noise` reports the
 * adjacent-pixel step distribution of the *base* frame's own dark population, which
 * is the same statistic with no term in it at all.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { decode, encodeRGB } from './png.mjs';

const argv = process.argv.slice(2);
const tags = argv.filter((a) => !a.startsWith('--'));
const gv = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
if (tags.length < 2) {
  console.error('usage: node tools/_banddelta.mjs <tag> <base-tag> [--view ground] [--map f.png]');
  process.exit(2);
}
const VIEW = gv('view', 'ground');
const MAP = gv('map', null);
const [TAG, BASE] = tags;

const fa = `shots/${TAG}_${VIEW}.png`, fb = `shots/${BASE}_${VIEW}.png`;
for (const f of [fa, fb]) {
  if (!existsSync(f)) { console.error(`_banddelta: missing ${f}`); process.exit(2); }
}
const A = decode(readFileSync(fa)), B = decode(readFileSync(fb));
if (A.w !== B.w || A.h !== B.h) { console.error('_banddelta: size mismatch'); process.exit(2); }
const { w, h } = A;

/* Red, because the finding is stated in red and red is where this rock has headroom. */
const dR = new Int16Array(w * h);
const bR = new Uint8Array(w * h);
for (let i = 0, n = w * h; i < n; i++) {
  const a = A.px[i * A.ch], b = B.px[i * B.ch];
  dR[i] = a - b; bR[i] = b;
}

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.round(p * (arr.length - 1)))];
const lift = [...dR].filter((v) => v > 0).sort((x, y) => x - y);
const drop = [...dR].filter((v) => v < 0).sort((x, y) => x - y);
console.log(`\n${TAG} - ${BASE}   ${VIEW}   ${w}x${h}, full resolution`);
console.log(`  lifted ${(lift.length / (w * h) * 100).toFixed(1)}% of pixels, ` +
  `dropped ${(drop.length / (w * h) * 100).toFixed(1)}%`);
if (lift.length) {
  console.log(`  lift in red   median ${pct(lift, 0.5)}  p90 ${pct(lift, 0.9)}  ` +
    `p99 ${pct(lift, 0.99)}  max ${lift[lift.length - 1]}`);
}
if (drop.length) {
  console.log(`  drop in red   median ${pct(drop, 0.5)}  p10 ${pct(drop, 0.1)}  ` +
    `min ${drop[0]}   (a drop is either capture noise or a bug; there is no term here that subtracts)`);
}

/* Where it landed, by how dark the base pixel was. The term is meant for the dark
   facets and to be structurally absent from sunlit floor, so this is the guardrail
   for lit rock read spatially rather than as one saturation figure. */
console.log('\n  base red      pixels     mean lift   p99 lift');
const BINS = [[0, 30], [30, 60], [60, 95], [95, 140], [140, 200], [200, 256]];
for (const [lo, hi] of BINS) {
  let n = 0, s = 0; const v = [];
  for (let i = 0; i < w * h; i++) {
    if (bR[i] >= lo && bR[i] < hi) { n++; s += dR[i]; v.push(dR[i]); }
  }
  if (!n) continue;
  v.sort((x, y) => x - y);
  console.log(`  ${String(lo).padStart(3)}-${String(hi - 1).padEnd(4)}  ` +
    `${String(n).padStart(9)}   ${(s / n).toFixed(2).padStart(9)}   ${String(pct(v, 0.99)).padStart(8)}`);
}

/* ---- the edge check ----
   Adjacent-pixel steps in the delta, over the term's own support. Compared against
   the same statistic on the base frame's dark pixels, which carries the capture noise
   and none of the term, so the comparison is the answer rather than the raw number. */
function steps(field, mask) {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask(i)) continue;
      if (x + 1 < w && mask(i + 1)) out.push(Math.abs(field[i + 1] - field[i]));
      if (y + 1 < h && mask(i + w)) out.push(Math.abs(field[i + w] - field[i]));
    }
  }
  out.sort((a, b) => a - b);
  return out;
}
const support = (i) => dR[i] > 0;
const dark = (i) => bR[i] < 95;
const sD = steps(dR, support);
const sN = steps(bR, dark);
const show = (label, a) => {
  if (!a.length) { console.log(`  ${label}  no population`); return; }
  const over = (k) => (a.filter((v) => v >= k).length / a.length * 100).toFixed(2);
  console.log(`  ${label}  n ${String(a.length).padStart(8)}  median ${pct(a, 0.5)}  ` +
    `p99 ${pct(a, 0.99)}  p99.9 ${pct(a, 0.999)}  max ${a[a.length - 1]}   ` +
    `>=4 ${over(4)}%  >=8 ${over(8)}%`);
};
console.log('\n  adjacent-pixel step, code values');
show('delta over its support ', sD);
show('base frame, dark pixels', sN);
console.log('  The second row is this pair\'s noise floor for the first. A terrace in the');
console.log('  term shows as the first row\'s tail standing clear of the second\'s.');

if (MAP) {
  /* Delta only, amplified, so the eye is looking at the term and not at the scene.
     Green is lift, magenta is drop, and the scale is printed so nothing here is a
     judgement about magnitude - it is a map of *where*, at full resolution. */
  const K = 12;
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = dR[i] * K;
    const p = Math.max(0, Math.min(255, v)), m = Math.max(0, Math.min(255, -v));
    out[i * 3] = m; out[i * 3 + 1] = p; out[i * 3 + 2] = m;
  }
  writeFileSync(MAP, encodeRGB(w, h, out));
  console.log(`\n  wrote ${MAP}  (green = lift, magenta = drop, x${K}, full resolution)`);
}
