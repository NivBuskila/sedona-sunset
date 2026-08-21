/* Does the haze *layer*, or is it one veil?
 *
 *   node tools/layers.mjs shots/sys5a_sun_gap.png
 *   node tools/layers.mjs --strip 0.44 0.10 shots/sys5a_sun_gap.png
 *   node tools/layers.mjs --boxes 0.10,0.34,0.06,0.10 0.40,0.50,0.05,0.05 f.png
 *
 * The standing complaint against System 1's aerial perspective was that it was
 * "one uniform veil", and that real canyon depth comes from discrete receding
 * ridgelines each a step lighter than the last. That is a measurable claim and
 * this measures it.
 *
 * Default mode walks a vertical strip through the frame and reports, per row
 * band, the mean HSV saturation and value of the rock in that band. In a view
 * up a canyon, height in frame near the horizon is a proxy for distance —
 * successive ridgelines stack upward — so the profile down that strip is the
 * haze's transfer function sampled at whatever distances the composition
 * actually contains.
 *
 * What a layered result looks like: value rising and saturation falling
 * monotonically, in a *staircase* — flat across the body of each ridge and
 * stepping at each silhouette edge. What a veil looks like: the same endpoints
 * joined by a straight line. So two numbers are reported beside the profile:
 *
 *   steps   the number of row-to-row transitions carrying more than a fifth of
 *           the total change, i.e. how much of the depth cue is delivered at
 *           edges rather than smeared across the gradient.
 *   edge%   the share of the total variation carried by those transitions.
 *           A pure ramp scores near zero; a clean four-terrace staircase
 *           scores 60-80%.
 *
 * Sky is excluded by a brightness-and-blueness test rather than by a hand-drawn
 * mask, because the horizon line moves between builds and a fixed mask would
 * quietly start measuring sky the first time a butte got taller. The count of
 * rock pixels per band is printed so an empty band is visible as an empty band
 * instead of as a number.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const argv = process.argv.slice(2);
let strip = null;               // centre x, width, as fractions
let boxes = null;
let bands = 26;
let sweep = 9;                  // how many lateral strips when none is named

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--strip') { strip = [Number(argv[i + 1]), Number(argv[i + 2])]; argv.splice(i, 3); i--; }
  else if (argv[i] === '--bands') { bands = Number(argv[i + 1]); argv.splice(i, 2); i--; }
  else if (argv[i] === '--sweep') { sweep = Number(argv[i + 1]); argv.splice(i, 2); i--; }
  else if (argv[i] === '--boxes') {
    boxes = [];
    let j = i + 1;
    while (j < argv.length && argv[j].includes(',')) boxes.push(argv[j++].split(',').map(Number));
    argv.splice(i, j - i); i--;
  }
}

/* Where the sky stops, per column.
 *
 * This used to be an absolute test — brighter than 200 and less saturated than
 * 0.22 — and that was a latent bug that took a build with a different exposure
 * to expose. When the scene's overall level rose, bands of sky that had been
 * under the threshold crossed it and were suddenly excluded, so the same frame
 * content scored differently and, worse, the *old* numbers had been counting
 * the horizon as a ridgeline: on juniper's best strip, the top five bands held
 * four thousand pixels at saturation 0.16 and B/G 1.08, which is sky, and the
 * sky-to-rock transition below them was being credited as a step. A metric that
 * is being used to decide whether the aerial perspective is working cannot move
 * when the exposure moves.
 *
 * So the skyline is found geometrically instead, which is exposure-invariant
 * and is also what a person means by it. Take the top few rows of the column as
 * the sky reference, walk down, and cut at the first row that is either
 * markedly darker than that reference or markedly more saturated. Hazed rock a
 * kilometre away is close to the sky in both, which is the entire point of the
 * effect — but it is never as bright as the sky it is seen through, because
 * nothing in this scene is lit above its own airlight. */
function skyline(img, x) {
  let sr = 0, sg = 0, sb = 0;
  const REF = 4;
  for (let y = 0; y < REF; y++) {
    const i = (y * img.w + x) * img.ch;
    sr += img.px[i]; sg += img.px[i + 1]; sb += img.px[i + 2];
  }
  sr /= REF; sg /= REF; sb /= REF;
  const smx = Math.max(sr, sg, sb), smn = Math.min(sr, sg, sb);
  const ssat = smx ? (smx - smn) / smx : 0;
  /* If the top of the frame is not sky at all, there is nothing to mask. */
  if (smx < 90 || ssat > 0.30) return 0;
  for (let y = REF; y < img.h; y++) {
    const i = (y * img.w + x) * img.ch;
    const mx = Math.max(img.px[i], img.px[i + 1], img.px[i + 2]);
    const mn = Math.min(img.px[i], img.px[i + 1], img.px[i + 2]);
    const s = mx ? (mx - mn) / mx : 0;
    if (mx < 0.86 * smx || s > ssat + 0.13) return y;
  }
  return img.h;
}

const skyCache = new Map();
function skylineOf(img, x) {
  let m = skyCache.get(img);
  if (!m) { m = new Int32Array(img.w).fill(-1); skyCache.set(img, m); }
  if (m[x] < 0) m[x] = skyline(img, x);
  return m[x];
}

function bandStats(img, x0, x1, y0, y1) {
  let n = 0, ss = 0, sv = 0, sg = 0, sb = 0;
  for (let x = x0; x < x1; x++) {
    const top = skylineOf(img, x);
    for (let y = Math.max(y0, top); y < y1; y++) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 10) continue;
      n++; ss += (mx - mn) / mx; sv += mx / 255;
      sg += g; sb += b;
    }
  }
  if (!n) return null;
  return { n, s: ss / n, v: sv / n, bg: sb / Math.max(1, sg) };
}

/** Fraction of the total variation delivered in jumps, and how many. */
function staircase(vals) {
  const v = vals.filter((x) => x != null);
  if (v.length < 4) return { steps: 0, edge: 0, mono: 0 };
  let total = 0;
  const d = [];
  for (let i = 1; i < v.length; i++) { d.push(v[i] - v[i - 1]); total += Math.abs(v[i] - v[i - 1]); }
  if (total < 1e-9) return { steps: 0, edge: 0, mono: 0 };
  /* A jump is a transition carrying more than 1/5 of what a *uniform* ramp
     would put in one step, times four — i.e. four times the mean step. */
  const thr = 4 * (total / d.length);
  let steps = 0, edge = 0;
  for (const x of d) if (Math.abs(x) > thr) { steps++; edge += Math.abs(x); }
  /* Monotonicity: net change over total variation. 1.0 is perfectly one-way. */
  const net = Math.abs(v[v.length - 1] - v[0]);
  return { steps, edge: edge / total, mono: net / total };
}

const f = (x, d = 3) => (x == null ? '   —  ' : x.toFixed(d));

for (const file of argv) {
  const img = decode(readFileSync(file));
  const base = file.replace(/^.*[\\/]/, '').replace(/\.png$/, '');
  console.log(`\n${base}   ${img.w}x${img.h}`);

  if (boxes) {
    console.log('  box                          n      sat     V      B/G');
    for (const [fx, fy, fw, fh] of boxes) {
      const x0 = Math.round(img.w * fx), y0 = Math.round(img.h * fy);
      const st = bandStats(img, x0, Math.round(img.w * (fx + fw)), y0, Math.round(img.h * (fy + fh)));
      console.log(`  ${[fx, fy, fw, fh].join(',').padEnd(26)} ${String(st ? st.n : 0).padStart(6)}` +
        `  ${f(st && st.s)}  ${f(st && st.v)}  ${f(st && st.bg)}`);
    }
    continue;
  }

  /* Only the upper 62% of the frame: below that the strip is looking at the
     floor a few metres away, which is not a ridgeline and not at a distance
     the haze has anything to say about. */
  const yTop = 0, yBot = Math.round(img.h * 0.62);

  /** Profile one vertical strip. */
  function scan(cx, width) {
    const hw = width / 2;
    const x0 = Math.max(0, Math.round(img.w * (cx - hw)));
    const x1 = Math.min(img.w, Math.round(img.w * (cx + hw)));
    const rows = [], S = [], V = [];
    for (let k = 0; k < bands; k++) {
      const a = yTop + Math.round((yBot - yTop) * k / bands);
      const b = yTop + Math.round((yBot - yTop) * (k + 1) / bands);
      const st = bandStats(img, x0, x1, a, b);
      rows.push({ a, st });
      S.push(st && st.n > 40 ? st.s : null);
      V.push(st && st.n > 40 ? st.v : null);
    }
    const n = rows.reduce((t, r) => t + (r.st ? r.st.n : 0), 0);
    return { cx, x0, x1, rows, n, s: staircase(S), v: staircase(V) };
  }

  if (strip) {
    const r = scan(strip[0], strip[1]);
    console.log(`  strip x ${r.x0}..${r.x1} (cx ${strip[0]})   rows ${yTop}..${yBot}   ${bands} bands`);
    console.log('  band   y      n      sat     V      B/G');
    for (let k = 0; k < r.rows.length; k++) {
      const { a, st } = r.rows[k];
      console.log(`  ${String(k).padStart(4)}  ${String(a).padStart(4)} ${String(st ? st.n : 0).padStart(7)}` +
        `  ${f(st && st.s)}  ${f(st && st.v)}  ${f(st && st.bg)}`);
    }
    console.log(`  saturation  steps=${r.s.steps}  edge=${(r.s.edge * 100).toFixed(0)}%  mono=${r.s.mono.toFixed(2)}`);
    console.log(`  value       steps=${r.v.steps}  edge=${(r.v.edge * 100).toFixed(0)}%  mono=${r.v.mono.toFixed(2)}`);
    continue;
  }

  /* No strip named, so sweep laterally. A single fixed centre column is a
     property of the composition, not of the haze: it scored `wash_low` at zero
     steps purely because the ridges in that frame are off to the sides, which
     is the same number a flat veil would earn and is the opposite conclusion.
     Reporting every strip and naming the one quoted keeps the metric honest. */
  const strips = [];
  for (let i = 0; i < sweep; i++) {
    strips.push(scan(0.10 + (0.80 * i) / (sweep - 1), 0.12));
  }
  console.log(`  lateral sweep, ${sweep} strips of 12% width, rows ${yTop}..${yBot}, ${bands} bands`);
  console.log('    cx     rock px |  sat: steps edge% mono  |  V: steps edge% mono');
  for (const r of strips) {
    console.log(`  ${r.cx.toFixed(2)}  ${String(r.n).padStart(9)} |` +
      `     ${String(r.s.steps).padStart(2)}   ${String((r.s.edge * 100).toFixed(0)).padStart(3)}   ${r.s.mono.toFixed(2)}  |` +
      `   ${String(r.v.steps).padStart(2)}   ${String((r.v.edge * 100).toFixed(0)).padStart(3)}   ${r.v.mono.toFixed(2)}`);
  }
  /* ---- what to quote, and what not to -------------------------------------
   *
   * The best-strip figure has been this project's headline number for several
   * rounds, including in figures I quoted myself, and it is the least stable
   * statistic here. It is a maximum over nine lateral positions, so it reports
   * the luckiest strip rather than the frame, and the luck is considerable: on
   * one sun_gap frame the nine strips scored 0, 0, 0, 53, 0, 59, 0, 17, 0 on
   * value edge share. Worse, the winning strip held 16,945 rock pixels against
   * 107,131 in the widest, because a narrow strip that clips a single clean
   * silhouette scores brilliantly on a tiny sample. The `n > 400` gate below let
   * strips through with about fifteen pixels per band.
   *
   * The consequence is that differences of ten or twenty points between two
   * builds — the size of difference that has been used to accept and reject work
   * — are inside this statistic's own spread. So the spread is now printed, a
   * pixel-weighted mean is printed beside it, and the gate is relative to the
   * best-populated strip rather than absolute.
   *
   * Quote `weighted`. It uses every rock pixel in the frame, cannot be won by a
   * lucky sliver, and moves for reasons that are about the picture. `best` is
   * kept because earlier rounds are recorded in its units and removing it would
   * silently orphan them, but it should not be used to make a decision. */
  const maxN = strips.reduce((m, r) => Math.max(m, r.n), 0);
  const usable = strips.filter((r) => r.n > 400 && r.n >= 0.25 * maxN);
  const loose = strips.filter((r) => r.n > 400);
  const best = usable.slice().sort((a, b) => b.s.edge - a.s.edge)[0];
  const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v[v.length >> 1] ?? 0; };
  const wmean = (f) => {
    const tot = usable.reduce((s, r) => s + r.n, 0);
    return tot ? usable.reduce((s, r) => s + r.n * f(r), 0) / tot : 0;
  };
  const pc = (x) => `${(x * 100).toFixed(0)}%`;
  if (best) {
    console.log(`  best strip cx=${best.cx.toFixed(2)}   sat steps=${best.s.steps} edge=${(best.s.edge * 100).toFixed(0)}% mono=${best.s.mono.toFixed(2)}` +
      `   V steps=${best.v.steps} edge=${(best.v.edge * 100).toFixed(0)}% mono=${best.v.mono.toFixed(2)}`);
    console.log(`  median of ${loose.length} usable strips   sat edge=${(med(loose.map((r) => r.s.edge)) * 100).toFixed(0)}%  mono=${med(loose.map((r) => r.s.mono)).toFixed(2)}` +
      `   V edge=${(med(loose.map((r) => r.v.edge)) * 100).toFixed(0)}%  mono=${med(loose.map((r) => r.v.mono)).toFixed(2)}`);
    /* The spread, so a reader can see whether a difference clears it. */
    const sp = (f) => {
      const v = usable.map(f);
      return `${pc(Math.min(...v))}..${pc(Math.max(...v))}`;
    };
    console.log(`  weighted over ${usable.length} strips >=25% of peak rock  ` +
      `sat edge=${pc(wmean((r) => r.s.edge))} mono=${wmean((r) => r.s.mono).toFixed(2)}` +
      `   V edge=${pc(wmean((r) => r.v.edge))} mono=${wmean((r) => r.v.mono).toFixed(2)}`);
    console.log(`  within-frame spread across those strips  ` +
      `sat edge ${sp((r) => r.s.edge)}   V edge ${sp((r) => r.v.edge)}` +
      `   <- a build-to-build difference smaller than this is not a result`);
  } else {
    console.log('  no strip carried enough rock to measure');
  }
}
