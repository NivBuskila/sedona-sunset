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

/* Sky in this scene is a bright, low-saturation, blue-or-white field and rock
   is neither. The test is deliberately loose on hue — a hazed butte at 1,450 m
   is nearly the colour of the sky behind it, which is the entire point of the
   effect and also the reason a hue-only test cannot work. What separates them
   reliably at that distance is that the sky is *brighter still*: nothing in
   this scene is lit above the airlight it is seen through. */
function isSky(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = mx ? (mx - mn) / mx : 0;
  return mx > 200 && s < 0.22;
}

function bandStats(img, x0, x1, y0, y1) {
  let n = 0, ss = 0, sv = 0, sr = 0, sg = 0, sb = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
      if (isSky(r, g, b)) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 10) continue;
      n++; ss += (mx - mn) / mx; sv += mx / 255;
      sr += r; sg += g; sb += b;
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
  /* The frame's score is the best strip on saturation edge share, and which
     strip that was is part of the answer. */
  const usable = strips.filter((r) => r.n > 400);
  const best = usable.slice().sort((a, b) => b.s.edge - a.s.edge)[0];
  const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v[v.length >> 1] ?? 0; };
  if (best) {
    console.log(`  best strip cx=${best.cx.toFixed(2)}   sat steps=${best.s.steps} edge=${(best.s.edge * 100).toFixed(0)}% mono=${best.s.mono.toFixed(2)}` +
      `   V steps=${best.v.steps} edge=${(best.v.edge * 100).toFixed(0)}% mono=${best.v.mono.toFixed(2)}`);
    console.log(`  median of ${usable.length} usable strips   sat edge=${(med(usable.map((r) => r.s.edge)) * 100).toFixed(0)}%  mono=${med(usable.map((r) => r.s.mono)).toFixed(2)}` +
      `   V edge=${(med(usable.map((r) => r.v.edge)) * 100).toFixed(0)}%  mono=${med(usable.map((r) => r.v.mono)).toFixed(2)}`);
  } else {
    console.log('  no strip carried enough rock to measure');
  }
}
