/* Does the heat shimmer reach the pixels? Measured against a known-zero control.
 *
 *   node tools/shimver.mjs [view] [xa] [xb] [--ya 0] [--yb 0.55] [--reuse]
 *
 * ## Why this file was rewritten
 *
 * Its previous version reported 0.324 px rms displacement on the `sun_gap` far
 * skyline and that figure was wrong. A critic re-measured the same edge with a
 * different estimator and got 0.139 px — *smoother* than the near-wall control
 * in the same frame, and below the antialiasing floor. The instrument was the
 * fifth broken one on this project, and CONTRACT.md's rule is explicit: round-
 * trip an instrument on real data before using it, and have it report its own
 * noise floor.
 *
 * The defect was structural, not arithmetical. The old tool captured one frame
 * with the distortion on and one with it off and called the difference shimmer.
 * That difference is only shimmer if *nothing else* changed between the two
 * captures — but the scene also contains animated dust motes and saltation, and
 * a mote drifting across a silhouette relocates the strongest edge in that
 * column. So the estimator was reading "everything that changed between two
 * captures" and attributing all of it to the one thing it had toggled. A
 * `> 4 px` outlier filter then discarded the large disagreements, which is
 * precisely the evidence that would have exposed the problem, and biased the
 * surviving population toward small values.
 *
 * ## What it does now
 *
 * Three captures, one session: amplitude zero, amplitude zero *again*, then the
 * real amplitude. The first pair is a control that shares every property with
 * the measurement except the effect being measured, so whatever the estimator
 * reports on it is by construction its noise floor. The signal is only a signal
 * if it clears that floor. Nothing is filtered; rejected columns are counted and
 * printed, because a high rejection rate is itself the finding.
 *
 * Two independent estimators are reported, because they fail differently:
 *
 *   paired    per-column sub-pixel silhouette position, on minus off. Sensitive
 *             to any frame-to-frame change, which is why it needs the control.
 *   jitter    second difference of the silhouette along x, within a single
 *             frame. Immune to smooth ridge geometry — a straight or gently
 *             curving skyline has zero second difference — so it measures
 *             roughness without needing a second capture. This is the critic's
 *             estimator, reproduced here so the two can be compared directly.
 */
import { run, capture } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const VIEWS = {
  sun_gap: [120, 0, 6],
  wash_mid: [46, 0, 0],
  bend: [92, -22, 2],
  wash_low: [8, 0, -4],
  juniper: [62, 34, 3],
};
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : Number(argv[i + 1]); };
const name = (argv[0] && !argv[0].startsWith('--')) ? argv[0] : 'sun_gap';
const xa = (argv[1] && !argv[1].startsWith('--')) ? Number(argv[1]) : 0.36;
const xb = (argv[2] && !argv[2].startsWith('--')) ? Number(argv[2]) : 0.50;
/* The band to hunt the edge in. Defaults to the upper half, where a skyline
   lives; the floor-to-wall junction needs it aimed much lower. */
const ya = flag('--ya', 0);
const yb = flag('--yb', 0.55);
const [d, yaw, pitch] = VIEWS[name];
const W = 1600, H = 900;

/* `--selftest` is pure arithmetic on synthetic images and must not queue for the
   render lock: three other agents are waiting on it. */
const reuse = argv.includes('--reuse') || argv.includes('--selftest');
if (!reuse) await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 240_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  const info = await page.evaluate(([dd, y, p]) => {
    const g = window.__game;
    g.walkTo(dd); g.lookAt(y, p);
    const m = g._atmo && g._atmo._shimmerMaterial;
    return { amp: m ? m.uniforms.uAmp.value : null, has: !!m };
  }, [d, yaw, pitch]);
  if (!info.has) { console.log('no shimmer material exposed'); return; }
  console.log(`${name}  ${W}x${H}  uAmp ${info.amp}`);

  const setAmp = (a) => page.evaluate((v) => {
    window.__game._atmo._shimmerMaterial.uniforms.uAmp.value = v;
  }, a);

  /* Control first, so the pair that defines the floor is the pair least
     favoured by any warm-up drift. */
  await setAmp(0);
  await capture(page, 'shots/_shim_off.png');
  await capture(page, 'shots/_shim_off2.png');
  await setAmp(info.amp);
  await capture(page, 'shots/_shim_on.png');
  await setAmp(info.amp);
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 3).join('\n'));
});

const lum = (img, x, y) => {
  const i = (y * img.w + x) * img.ch;
  return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];
};

/** Sub-pixel y of the strongest vertical luminance edge in this column. */
function edgeY(img, x, y0, y1) {
  let best = -1, bv = 0;
  for (let y = y0 + 1; y < y1 - 1; y++) {
    const g = Math.abs(lum(img, x, y + 1) - lum(img, x, y - 1));
    if (g > bv) { bv = g; best = y; }
  }
  if (best < 0 || bv < 6) return null;
  const gm = (y) => Math.abs(lum(img, x, y + 1) - lum(img, x, y - 1));
  const a = gm(best - 1), b = gm(best), c = gm(best + 1);
  const den = a - 2 * b + c;
  const off = Math.abs(den) > 1e-6 ? 0.5 * (a - c) / den : 0;
  return best + Math.max(-1, Math.min(1, off));
}

function stats(v) {
  if (!v.length) return null;
  const n = v.length;
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const rms = Math.sqrt(v.reduce((s, x) => s + x * x, 0) / n);
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const srt = [...v].map(Math.abs).sort((a, b) => a - b);
  /* Robust scale: 1.4826 * MAD matches sigma for a normal population but is not
     dragged by the handful of columns where the estimator changes its mind. */
  const med = srt[srt.length >> 1];
  const mad = 1.4826 * med;
  return { n, mean, rms, sd, mad, max: srt[srt.length - 1] };
}

/** Silhouette trace for a region, plus how many columns refused to yield one. */
function trace(img, x0, x1, y0, y1) {
  const ys = [], miss = [];
  for (let x = x0; x < x1; x++) {
    const e = edgeY(img, x, y0, y1);
    if (e == null) miss.push(x); else ys.push([x, e]);
  }
  return { ys, miss: miss.length };
}

/* ---- tracked interior contour ----------------------------------------------
 *
 * `trace` re-finds the strongest edge in the band independently in every column,
 * which is right for a skyline — there is only one sky, so the answer cannot
 * wander. It is wrong for an interior edge like the floor-to-wall junction: that
 * band also contains cobbles, shadow edges and bedding, so "strongest in this
 * column" jumps between features and the trace reads 57 px rms on a still frame.
 * That is not shimmer and it is not noise either, it is the estimator changing
 * its mind about which edge it is measuring.
 *
 * Tracking fixes it the way any contour follower does: seed on the strongest
 * gradient anywhere in the region, then walk outward in both directions allowing
 * the edge to move only a few pixels per column. The result is one continuous
 * feature measured along its length, which is the only thing a displacement
 * figure can be about. It also removes the need to know the junction's row in
 * advance — give it a generous band and it locks onto the dominant contour. */
function traceTracked(img, x0, x1, y0, y1, win = 7, maxGap = 6) {
  const grad = (x, y) => Math.abs(lum(img, x, y + 1) - lum(img, x, y - 1));
  const sub = (x, y) => {
    const a = grad(x, y - 1), b = grad(x, y), c = grad(x, y + 1);
    const den = a - 2 * b + c;
    const off = Math.abs(den) > 1e-6 ? 0.5 * (a - c) / den : 0;
    return y + Math.max(-1, Math.min(1, off));
  };

  let sx = -1, sy = -1, sv = 0;
  for (let x = x0; x < x1; x++) {
    for (let y = y0 + 1; y < y1 - 1; y++) {
      const g = grad(x, y);
      if (g > sv) { sv = g; sx = x; sy = y; }
    }
  }
  if (sx < 0 || sv < 6) return { ys: [], miss: x1 - x0, seed: null };

  /* Follow the contour, with three properties the first version lacked and
   * needed once the warp got stronger:
   *
   * A wider window. At +-3 px a displacement of a pixel or two, on a contour that
   * is also sloping, walks out of the search band and the walk stops. That is how
   * measuring the *fixed* effect cut the usable sample from 236 columns to 50 —
   * the tool got worse exactly as the thing it measures got better, which is the
   * most misleading way for an instrument to fail.
   *
   * Gap tolerance. A single column where the gradient dips under threshold is a
   * cobble edge crossing the contour, not the end of it. Breaking on the first
   * miss threw away everything past the first blemish; now a run of misses has to
   * accumulate before the walk gives up, and skipped columns are simply absent
   * from the trace rather than terminating it.
   *
   * A slope predictor. The junction recedes across the frame, so the contour has
   * a real gradient; centring the next search on the last position biases every
   * step against that slope. Centring it on a short-run extrapolation removes the
   * bias, and it lets the window stay tight enough to keep feature identity. */
  const out = new Map();
  const walk = (dir) => {
    let prev = sy, slope = 0, gap = 0;
    for (let x = sx + dir; x >= x0 && x < x1; x += dir) {
      const pred = prev + slope;
      const lo = Math.max(y0 + 1, Math.round(pred) - win);
      const hi = Math.min(y1 - 2, Math.round(pred) + win);
      let by = -1, bv = 0;
      for (let y = lo; y <= hi; y++) {
        const g = grad(x, y);
        if (g > bv) { bv = g; by = y; }
      }
      if (by < 0 || bv < 6) {
        if (++gap > maxGap) break;
        continue;
      }
      gap = 0;
      out.set(x, sub(x, by));
      /* dy per step taken, in whichever direction this walk is going. Smoothed,
         so one noisy step cannot steer the walk off the feature. */
      slope = 0.7 * slope + 0.3 * (by - prev);
      prev = by;
    }
  };
  out.set(sx, sub(sx, sy));
  walk(1); walk(-1);
  const ys = [...out.entries()].sort((a, b) => a[0] - b[0]);
  return { ys, miss: (x1 - x0) - ys.length, seed: { x: sx, y: sy } };
}

/** Second difference along x: roughness with smooth geometry removed. */
function jitter(tr) {
  const m = new Map(tr.ys);
  const out = [];
  for (const [x, y] of tr.ys) {
    const a = m.get(x - 1), b = m.get(x + 1);
    if (a === undefined || b === undefined) continue;
    /* /sqrt(6) converts the second difference of independent noise back to the
       per-column sigma, so this is directly comparable to `paired`. */
    out.push((y - 0.5 * (a + b)) / Math.sqrt(1.5));
  }
  return out;
}

/* ---- self-test on synthetic data -------------------------------------------
 *
 *   node tools/shimver.mjs --selftest
 *
 * Both estimators are run against an edge displaced by a *known* amount, which
 * is the only way to find out what each one actually reports. The answer decides
 * which number to believe on the real frames, and it turns out they disagree
 * systematically rather than randomly: a heat shimmer is a spatially smooth
 * warp, and the second-difference estimator is blind to smooth warps by
 * construction — that is the property that makes it immune to ridge geometry.
 * It attenuates a displacement of wavelength L by roughly 2*pi^2/L^2, so at
 * L = 40 px it recovers about a fiftieth of the true amplitude. Reading its
 * output as a displacement therefore understates a real effect by more than an
 * order of magnitude. */
if (argv.includes('--selftest')) {
  const w = 400, h = 200, ch = 3;
  /* A synthetic frame: bright above a soft edge, dark below, edge at y0(x). */
  const synth = (disp) => {
    const px = new Uint8Array(w * h * ch);
    for (let x = 0; x < w; x++) {
      const e = 100 + disp(x);
      for (let y = 0; y < h; y++) {
        /* A one-pixel-wide linear ramp across the edge, which is what an
           antialiased silhouette looks like and what gives the sub-pixel
           estimator something to interpolate. */
        const t = Math.max(0, Math.min(1, 0.5 + (e - y)));
        const v = Math.round(30 + 200 * t);
        const i = (y * w + x) * ch;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    }
    return { w, h, ch, px };
  };
  console.log('\nsynthetic edge, displacement A*sin(2*pi*x/L), recovered by each estimator');
  console.log('   A      L    paired MAD   jitter MAD   paired/A   jitter/A');
  for (const [A, L] of [[0.5, 40], [1.0, 40], [2.0, 40], [1.0, 12], [1.0, 120], [0, 40]]) {
    const base = synth(() => 0);
    const warp = synth((x) => A * Math.sin((2 * Math.PI * x) / L));
    const tb = trace(base, 2, w - 2, 0, h), tw = trace(warp, 2, w - 2, 0, h);
    const p = stats(paired(tb, tw).v), j = stats(jitter(tw));
    console.log(`  ${A.toFixed(1)}  ${String(L).padStart(5)}   ` +
      `${p.mad.toFixed(3).padStart(8)}   ${j.mad.toFixed(3).padStart(9)}   ` +
      `${A ? (p.mad / A).toFixed(3).padStart(7) : '    —  '}   ` +
      `${A ? (j.mad / A).toFixed(3).padStart(7) : '    —  '}`);
  }
  console.log('\nA paired figure near A means the estimator is faithful at that scale.');
  console.log('A jitter figure far below A is the second difference rejecting the');
  console.log('smooth part of the warp — by design, and fatal if read as displacement.');

  /* ---- and the tracker, on the case that caught it out ---------------------
   *
   * The tracked contour is a separate mechanism from the estimators and needs its
   * own control, because its failure mode is not a wrong number — it is a smaller
   * sample, silently. When the junction warp got stronger the tracker lost 79% of
   * its columns and still reported a confident figure on what was left, which is
   * the instrument getting worse exactly as the effect got better.
   *
   * So: a *sloping* edge, which the junction is, with a competing weaker edge
   * nearby for it to be tempted by, under a known displacement. What matters here
   * is columns kept, and that the recovered amplitude does not drift when the
   * walk has to work for it. */
  console.log('\ntracked contour on a sloping edge with a decoy 14 px away');
  console.log('   A   slope   columns kept   paired MAD   paired/A');
  const synth2 = (disp, slope) => {
    const px = new Uint8Array(w * h * ch);
    for (let x = 0; x < w; x++) {
      const e = 70 + slope * x + disp(x);
      const dec = e + 14;
      for (let y = 0; y < h; y++) {
        const t = Math.max(0, Math.min(1, 0.5 + (e - y)));
        /* Half-contrast decoy: a real cobble edge in the band. */
        const t2 = Math.max(0, Math.min(1, 0.5 + (dec - y)));
        const v = Math.round(30 + 150 * t + 45 * t2);
        const i = (y * w + x) * ch;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    }
    return { w, h, ch, px };
  };
  for (const [A, slope] of [[1.0, 0], [1.0, 0.05], [2.0, 0.05], [2.0, 0.12], [0, 0.05]]) {
    const base = synth2(() => 0, slope);
    const warp = synth2((x) => A * Math.sin((2 * Math.PI * x) / 40), slope);
    const tb = traceTracked(base, 2, w - 2, 0, h);
    const tw = traceTracked(warp, 2, w - 2, 0, h);
    const p = stats(paired(tb, tw).v) || { mad: 0 };
    const kept = Math.min(tb.ys.length, tw.ys.length);
    console.log(`  ${A.toFixed(1)}   ${slope.toFixed(2)}   ` +
      `${String(kept).padStart(6)}/${w - 4}   ${p.mad.toFixed(3).padStart(8)}   ` +
      `${A ? (p.mad / A).toFixed(3).padStart(7) : '    —  '}`);
  }
  console.log('Columns kept well below full means the walk is losing the contour,');
  console.log('and any figure it reports is drawn from whatever survived.');
  process.exit(0);
}

const on = decode(readFileSync('shots/_shim_on.png'));
const off = decode(readFileSync('shots/_shim_off.png'));
const off2 = decode(readFileSync('shots/_shim_off2.png'));
const x0 = Math.round(on.w * xa), x1 = Math.round(on.w * xb);
const y0 = Math.round(on.h * ya), y1 = Math.round(on.h * yb);

/* Is the renderer even frozen between captures? If the control pair is not
   pixel-identical, the paired estimator has a floor for reasons that have
   nothing to do with shimmer, and that is worth naming before any edge maths. */
let ndiff = 0;
for (let i = 0; i < off.px.length; i += off.ch) {
  if (off.px[i] !== off2.px[i] || off.px[i + 1] !== off2.px[i + 1] ||
      off.px[i + 2] !== off2.px[i + 2]) ndiff++;
}
const npx = off.w * off.h;

/* --track follows one continuous interior contour; the default re-finds the
   strongest edge per column, which is correct only for a skyline. */
const tracked = argv.includes('--track');
const tr = tracked
  ? (im) => traceTracked(im, x0, x1, y0, y1)
  : (im) => trace(im, x0, x1, y0, y1);
const tOff = tr(off);
const tOff2 = tr(off2);
const tOn = tr(on);
if (tracked) {
  const sd = tOff.seed;
  console.log(`tracked contour: seed x=${sd ? sd.x : '-'} y=${sd ? sd.y : '-'}, ` +
    `${tOff.ys.length} of ${x1 - x0} columns followed`);
}

function paired(a, b) {
  const m = new Map(b.ys), out = [], rej = [];
  for (const [x, y] of a.ys) {
    const o = m.get(x);
    if (o === undefined) continue;
    /* Nothing is discarded. A column where the two frames disagree by more than
       a few pixels is the estimator changing which edge it locked onto, and the
       rate at which that happens is a property of the instrument that a reader
       needs to see — the previous version dropped these silently and reported
       the remainder as signal. */
    if (Math.abs(o - y) > 4) rej.push(x);
    out.push(o - y);
  }
  return { v: out, rej: rej.length };
}

const ctl = paired(tOff, tOff2);
const sig = paired(tOff, tOn);
const sc = stats(ctl.v), ss = stats(sig.v);
const jOff = stats(jitter(tOff)), jOn = stats(jitter(tOn));

const f = (x, n = 3) => (x === undefined || x === null ? '  —  ' : x.toFixed(n));
console.log(`\nregion  x ${x0}..${x1}  y ${y0}..${y1}   view ${name}`);
console.log(`control pair identical?  ${ndiff === 0 ? 'yes' : 'NO'}` +
            `  (${ndiff} of ${npx} px differ, ${(100 * ndiff / npx).toFixed(2)}%)`);
console.log(`columns with an edge     off ${tOff.ys.length}, on ${tOn.ys.length},` +
            ` of ${x1 - x0}  (missing ${tOff.miss}/${tOn.miss})`);

console.log('\n                        rms      sd      MAD     max    n   rejected');
if (sc) console.log(`paired  off vs off2  ${f(sc.rms)}  ${f(sc.sd)}  ${f(sc.mad)}  ` +
                    `${f(sc.max, 2)}  ${String(sc.n).padStart(4)}   ${ctl.rej}   <- noise floor`);
if (ss) console.log(`paired  off vs on    ${f(ss.rms)}  ${f(ss.sd)}  ${f(ss.mad)}  ` +
                    `${f(ss.max, 2)}  ${String(ss.n).padStart(4)}   ${sig.rej}`);
if (jOff) console.log(`jitter  off          ${f(jOff.rms)}  ${f(jOff.sd)}  ${f(jOff.mad)}  ` +
                      `${f(jOff.max, 2)}  ${String(jOff.n).padStart(4)}`);
if (jOn) console.log(`jitter  on           ${f(jOn.rms)}  ${f(jOn.sd)}  ${f(jOn.mad)}  ` +
                     `${f(jOn.max, 2)}  ${String(jOn.n).padStart(4)}`);

if (sc && ss) {
  const excess = Math.sqrt(Math.max(0, ss.mad ** 2 - sc.mad ** 2));
  console.log(`\nsignal above floor (MAD, quadrature)  ${excess.toFixed(3)} px`);
  console.log(ss.mad <= sc.mad * 1.5
    ? 'VERDICT  not clear of its own noise floor — this is not a measurement of shimmer.'
    : `VERDICT  clears the floor by ${(ss.mad / sc.mad).toFixed(1)}x.`);
}
