/* System 6 measurement.
 *
 * usage: node tools/audioprobe.mjs [tag] [--seconds 120] [--seed 1234] [--sr 24000]
 *                                  [--voices] [--fast]
 *
 * A visual critic cannot hear the soundscape and neither can the author, so the
 * only honest way to review it is to measure it. This loads the page through
 * the ordinary harness, asks it to render its *own* audio graph — the same
 * nodes, the same scheduler, the same seed — into an OfflineAudioContext, and
 * pulls the PCM back out. Offline rendering is both far faster than real time
 * and exactly deterministic, so a two-minute soundscape is measured in a few
 * seconds and two runs of the same build give identical numbers.
 *
 * What comes out, in the order the design cares about:
 *
 *   · the quiet — level distribution over time, both across the whole take and
 *     restricted to the stretches where the player is standing still, which is
 *     the regime the design is actually about;
 *   · the *bed* spectrum, measured on quiet frames only with transients
 *     rejected. A full-take band RMS is dominated by the fifteen per cent of
 *     the time that is not quiet and says nothing about the silence;
 *   · the inter-band envelope correlation matrix. If a wind bed is one noise
 *     source under one gain node, every band moves together and the matrix is
 *     flat; a physical process has to decorrelate with band separation. This is
 *     the single most diagnostic number in the file;
 *   · discrete events with timings, spacing and spectral centroid;
 *   · gait: stride interval spread, left/right asymmetry, and how many strides
 *     the self-similarity comb survives;
 *   · hygiene — clipping, DC, denormal-inducing silence, and the true peak per
 *     channel rather than a mono sum masquerading as one.
 *
 * `--voices` adds a second, shorter render in which every rare event is forced
 * to fire at a known time, so the coyote's harmonic structure, the fauna and
 * the reverb's discrete arrivals can be measured directly instead of waiting
 * several minutes for one to happen by chance. `--fast` skips the contract
 * assertions, which render the scene twice on a software rasteriser and cost
 * minutes; use it while iterating, not when reporting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './harness.mjs';
import { encodeRGB } from './png.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'audio';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const has = (k) => args.includes('--' + k);
const SECONDS = Number(getf('seconds', 120));
const SR = Number(getf('sr', 24000));
const SEED = getf('seed', '') === '' ? undefined : Number(getf('seed'));
const VOICES = has('voices');
/* Which soundscape to measure. `plain` is the default because it is what ships;
   `full` measures the earlier sparse one, which is kept behind the same switch
   the audio uses. Every section below has to work for both, because a report
   that only understands one of them cannot tell you the switch still works. */
const MODE = getf('mode', 'plain') === 'full' ? 'full' : 'plain';

const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');

/* ── FFT ───────────────────────────────────────────────────────────────── */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Short-time power spectra, normalised so a full-scale sinusoid reads 0 dB. */
function stft(x, N, hop) {
  const win = new Float64Array(N);
  let wsum = 0;
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); wsum += win[i]; }
  const frames = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const bins = N >> 1;
  const out = new Float32Array(frames * bins);
  const re = new Float64Array(N), im = new Float64Array(N);
  const norm = 2 / wsum;
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) { re[i] = x[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const a = re[k] * norm, b = im[k] * norm;
      out[f * bins + k] = a * a + b * b;
    }
  }
  return { power: out, frames, bins, hop, N };
}

/** Mean power over a fractional-octave band around fc, per frame, in dB. */
function bandSeries(S, sr, fc, frac = 1 / 6) {
  const b0 = Math.max(1, Math.round(fc * Math.pow(2, -frac) * S.N / sr));
  const b1 = Math.min(S.bins - 1, Math.max(b0, Math.round(fc * Math.pow(2, frac) * S.N / sr)));
  const out = new Float64Array(S.frames);
  for (let f = 0; f < S.frames; f++) {
    let p = 0;
    for (let k = b0; k <= b1; k++) p += S.power[f * S.bins + k];
    out[f] = db(Math.sqrt(p / (b1 - b0 + 1) / 2));
  }
  return out;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, dbv = b[i] - mb;
    sa += da * da; sb += dbv * dbv; sab += da * dbv;
  }
  return sab / (Math.sqrt(sa * sb) || 1);
}

function median(arr) {
  const s = Array.from(arr).sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : NaN;
}

/* ── analysis ──────────────────────────────────────────────────────────── */

/** One RBJ bandpass, forward only — this is an envelope, phase is irrelevant. */
function bandpass(x, sr, fc, Q) {
  const w0 = 2 * Math.PI * fc / sr, a = Math.sin(w0) / (2 * Q), cw = Math.cos(w0);
  const b0 = a, b1 = 0, b2 = -a, a0 = 1 + a, a1 = -2 * cw, a2 = 1 - a;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** One RBJ highpass, forward only. Same reasoning as the bandpass above. */
function highpass(x, sr, fc, Q = 0.7) {
  const w0 = 2 * Math.PI * fc / sr, a = Math.sin(w0) / (2 * Q), cw = Math.cos(w0);
  const b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = (1 + cw) / 2;
  const a0 = 1 + a, a1 = -2 * cw, a2 = 1 - a;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * What a footstep leaves behind it.
 *
 * The question is whether a transient tells you how far away the rock is. It is
 * answered by averaging the post-onset decay of every footstep that has nothing
 * else near it, in ten-millisecond bins, aligned on each step's own peak and
 * normalised to it — so a reflection arriving at a fixed delay survives the
 * average while the bed and the wind do not.
 *
 * Reported against the local background rather than in absolute terms, because
 * "audible" here means "above what was already there".
 */
function stepDecay(x, sr, stepTimes, calls, out = 0.34) {
  const W = Math.round(0.010 * sr);
  const nb = Math.round(out / 0.010);
  /* High-passed. The step's low body is thirty decibels up on everything else
     and decays slowly, so unfiltered it buries any reflection under its own
     tail — and the low body is the part that does not come back off the rock
     anyway. */
  const hp = highpass(x, sr, 300, 0.7);
  const rms = (i0) => {
    let s = 0, n = 0;
    for (let i = i0; i < i0 + W && i < hp.length; i++) { s += hp[i] * hp[i]; n++; }
    return n ? Math.sqrt(s / n) : 0;
  };
  /* Clear of the neighbouring steps and of any animal, but no stricter than
     that. Requiring a full second of silence either side only admitted the
     three or four steps that happen to border a pause, and three steps is not
     an average. Reaching to a third of a second and asking only for four
     hundred milliseconds of clearance admits most of the walk. */
  const isolated = stepTimes.filter((t, i) =>
    (i === 0 || t - stepTimes[i - 1] > 0.42) &&
    (i === stepTimes.length - 1 || stepTimes[i + 1] - t > out + 0.08) &&
    !calls.some(c => t > c.t - 2 && t < c.t + (c.dur || 6) + 3) &&
    (t - 0.34) * sr > 0 && (t + out + 0.02) * sr < hp.length);
  if (isolated.length < 3) return null;
  const acc = new Float64Array(nb), bg = [];
  let used = 0;
  for (const t of isolated) {
    // Find the onset peak inside a short search window, then align to it.
    let best = -1, bi = 0;
    for (let i = Math.round((t - 0.04) * sr); i < Math.round((t + 0.10) * sr); i += W) {
      const v = rms(i); if (v > best) { best = v; bi = i; }
    }
    if (best <= 0) continue;
    for (let b = 0; b < nb; b++) acc[b] += rms(bi + b * W) / best;
    /* Background from just *before* the onset. Taken after the step it would
       have to sit beyond the reflections it is the reference for, which is what
       forced the long isolation window; taken before, it is the bed by
       construction, and it is measured per step so the per-step normalisation
       still holds. */
    for (let i = Math.round((t - 0.32) * sr); i < Math.round((t - 0.12) * sr); i += W) {
      bg.push(rms(i) / best);
    }
    used++;
  }
  if (!used) return null;
  const curve = Array.from(acc, v => db(v / used));
  const back = db(median(bg));
  const at = (ms) => curve[Math.min(nb - 1, Math.round(ms / 10))];
  /* Where the trace last stands clear of the background. This is the number
     that says whether the walls are audible: if it is inside the direct
     sound's own decay there is no reflection in the output at all. */
  let lastAbove = 0;
  for (let b = 1; b < nb; b++) if (curve[b] > back + 3) lastAbove = b * 10;
  return { curve, background: back, steps: used, lastAboveMs: lastAbove, at };
}

/**
 * Sharp-attack detection: an 8 ms envelope against its own 200 ms trailing
 * mean, run on the 800 Hz – 4 kHz band.
 *
 * Band-limiting first is what makes this work. Run on the full signal the
 * detector fires constantly, because filtered noise at a few hundred hertz has
 * only a handful of independent samples per window and so wanders by several
 * decibels for free. In the crunch band the still air has almost no energy at
 * all, so a footstep is a genuine order-of-magnitude excursion.
 */
function transients(x, sr, riseDb = 6, minGap = 0.22) {
  x = bandpass(x, sr, 1800, 0.9);
  const W = Math.max(1, Math.round(0.008 * sr));
  const n = Math.floor(x.length / W);
  const e = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let s = 0;
    for (let i = w * W; i < (w + 1) * W; i++) s += x[i] * x[i];
    e[w] = Math.sqrt(s / W);
  }
  const K = Math.max(2, Math.round(0.2 / (W / sr)));
  const cand = [];
  let acc = 0;
  for (let w = 0; w < n; w++) {
    if (w >= K) {
      const mean = acc / K;
      const rise = db(e[w]) - db(mean);
      const t = w * W / sr;
      if (rise > riseDb && e[w] > e[w - 1] && (w + 1 >= n || e[w] >= e[w + 1])) {
        cand.push({ t, peak: db(e[w]), rise });
      }
      acc -= e[w - K];
    }
    acc += e[w];
  }
  /* Strongest-first selection, not first-past-the-post.
     Taking the earliest qualifying window and then blanking a fixed interval
     was fine in a dry signal and is not fine in a reverberant one: once each
     footstep has reflections behind it, the trailing mean is raised, the true
     onset sometimes fails to clear the threshold, and the detector locks on to
     a reflection instead — which showed up as the step interval's coefficient
     of variation tripling while the scheduler's own figure did not move at all.
     Choosing the loudest onset in each neighbourhood and suppressing the rest
     puts the mark back on the boot. */
  cand.sort((p, q) => q.peak - p.peak);
  const kept = [];
  for (const c of cand) {
    if (kept.some(k => Math.abs(k.t - c.t) < minGap)) continue;
    kept.push(c);
  }
  return kept.sort((p, q) => p.t - q.t);
}

/**
 * Gait statistics.
 *
 * Human step-duration variability is about 4% on a flat treadmill and 8% on
 * uneven ground, so a wash of sand, gravel and cobble belongs at the top of
 * that range. The comb measurement is the one that matters: autocorrelate the
 * step train and count how many strides the periodic peak survives. Real gait
 * decorrelates within three or four; a scheduler with a fixed stride length
 * stays correlated indefinitely, and that is audible as a machine walking.
 */
/**
 * How continuous the soundscape is, which is the question the rest of this file
 * was not built to ask.
 *
 * Every other measurement here treats sound as the exception and quiet as the
 * ground state, because that is what the original brief wanted. The numbers
 * below invert that. They exist because a listener found the result unsettling,
 * and the reason it was unsettling is not in any of the other numbers: it is
 * that the world was empty, so anything that happened arrived out of nothing.
 *
 * Four things, and the last two matter most:
 *
 *  · `abovePct`   how much of the timeline is audible at all, against a fixed
 *                 absolute floor rather than against the piece's own bed. A
 *                 relative threshold would call any bed continuous, including
 *                 an inaudible one. Reported at -45 dBFS, which is the level
 *                 the piece is being judged against, and at -55 as well: a bed
 *                 that clears the lower one and not the higher is technically
 *                 present and still reads as an empty room.
 *  · `activePct`  how much of the timeline lies inside a discrete event. This is
 *                 "something is happening", as distinct from "something is on".
 *  · `longestGap` the longest stretch with nothing but bed. One long gap does
 *                 more damage than many short ones, so the maximum is the
 *                 statistic and not the mean.
 *  · `startle`    how far the loudest windows stand over the typical one. This
 *                 is the actual mechanism of unease and the only one of the four
 *                 that a louder mix does not improve: raise everything and it
 *                 does not move. A field recording of a warm place runs ten to
 *                 fifteen decibels here; the first version of this piece ran
 *                 twenty-seven, and was described as creepy.
 */
function continuity(wl, W, sr, evs, seconds, pc, voiceSpans) {
  /* Two thresholds, because the brief names one and the ear cares about the
     other. -45 dBFS is the number the piece is being judged against, so it is
     reported whatever it says. -55 catches the case where the bed sits in the
     band between them: present, but only just, and still reading as a room with
     nothing in it. */
  let above45 = 0, above55 = 0;
  for (let i = 0; i < wl.length; i++) {
    if (wl[i] > -45) above45++;
    if (wl[i] > -55) above55++;
  }
  /* Union of the event spans, not the sum: overlapping events are one stretch
     of "something is happening", and a soundscape busy enough to overlap would
     otherwise be scored above a hundred per cent. */
  /* Voices come from the per-band audibility pass, not from the broadband
     detector, because that is what decides whether a bird was heard. Unioned
     with the detected events rather than replacing them: a gust is a broadband
     thing and the detector is right about those. */
  const spans = evs.map(e => [e.t, e.t + Math.max(e.dur, 0.05)])
    .concat((voiceSpans || []).map(v => [v.t, v.t + Math.max(v.dur, 0.05)]))
    .sort((a, b) => a[0] - b[0]);
  let active = 0, gapMax = 0, cursor = 0;
  const gaps = [];
  for (const [s, e] of spans) {
    if (s > cursor) {
      const gap = s - cursor;
      gaps.push(gap);
      if (gap > gapMax) gapMax = gap;
      cursor = s;
    }
    if (e > cursor) { active += e - cursor; cursor = e; }
  }
  if (seconds > cursor) {
    const gap = seconds - cursor;
    gaps.push(gap);
    if (gap > gapMax) gapMax = gap;
  }
  gaps.sort((a, b) => a - b);
  const calls = evs.filter(e => e.kind !== 'wind' && e.kind !== 'step');
  const nv = (voiceSpans || []).length;
  return {
    abovePct: 100 * above45 / wl.length,
    above55Pct: 100 * above55 / wl.length,
    activePct: 100 * active / seconds,
    longestGap: gapMax,
    medianGap: gaps.length ? gaps[gaps.length >> 1] : NaN,
    startle: pc(0.99) - pc(0.5),
    /* Everything a listener would count as a thing that happened: broadband
       events plus the voices the per-band pass found. The old figure counted only
       what the level meter flagged, which in a take of seventeen audible birds
       and no strong gust came out as zero — a number that says more about the
       instrument than the soundscape. */
    perMin: 60 * (evs.length + nv) / seconds,
    callsPerMin: 60 * (calls.length + nv) / seconds,
    /* Kept separately for the comparison against the scheduled count, which is
       specifically about what the broadband detector can and cannot see. */
    bbCallsPerMin: 60 * calls.length / seconds,
  };
}

function gait(steps) {
  const iv = [];
  for (let i = 1; i < steps.length; i++) {
    const g = steps[i].t - steps[i - 1].t;
    if (g < 2) iv.push({ g, i });
  }
  if (iv.length < 6) return null;
  const gs = iv.map(v => v.g);
  const mean = gs.reduce((a, b) => a + b, 0) / gs.length;
  const sd = Math.sqrt(gs.reduce((a, b) => a + (b - mean) ** 2, 0) / gs.length);
  /* A spread that a handful of misdetections cannot dominate.
     On a detected step train a missed step doubles one interval and a spurious
     one halves another, and either is worth a quarter of a second against a
     stride of half. Eight of those in a hundred and ten intervals is enough on
     its own to put the standard deviation at 150 ms, which then reads as a gait
     four times looser than the one that was scheduled. The interquartile range
     over 1.349 is the same quantity for a normal distribution and ignores the
     tails, so quoting both says whether a large spread is the walk or the
     instrument. */
  const srt = Array.from(gs).sort((p, q) => p - q);
  const iqr = srt[Math.floor(srt.length * 0.75)] - srt[Math.floor(srt.length * 0.25)];
  const sdRobust = iqr / 1.349;
  const odd = iv.filter(v => v.i % 2).map(v => v.g);
  const even = iv.filter(v => !(v.i % 2)).map(v => v.g);
  const mo = odd.length ? odd.reduce((a, b) => a + b, 0) / odd.length : NaN;
  const me = even.length ? even.reduce((a, b) => a + b, 0) / even.length : NaN;

  /* Comb: an impulse train at 10 ms resolution, autocorrelated, sampled at
     integer multiples of the median stride. */
  const RES = 0.01;
  const t0 = steps[0].t, t1 = steps[steps.length - 1].t;
  const n = Math.ceil((t1 - t0) / RES) + 1;
  const tr = new Float64Array(n);
  for (const s of steps) tr[Math.round((s.t - t0) / RES)] = 1;
  const mu = tr.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) tr[i] -= mu;
  const r0 = tr.reduce((a, b) => a + b * b, 0);
  const comb = [];
  const stride = median(gs);
  for (let k = 1; k <= 12; k++) {
    const lag = Math.round(k * stride / RES);
    if (lag >= n) break;
    // Take the best value within ±2 bins, so jitter does not fake a decay.
    let best = -1;
    for (let d = -2; d <= 2; d++) {
      let s = 0;
      for (let i = 0; i + lag + d < n && i + lag + d >= 0; i++) s += tr[i] * tr[i + lag + d];
      best = Math.max(best, s / (r0 || 1));
    }
    comb.push(+best.toFixed(3));
  }
  let survives = 0;
  for (let i = 0; i < comb.length; i++) { if (comb[i] > 0.2) survives = i + 1; else break; }
  return {
    n: steps.length, mean, sd, cv: 100 * sd / mean,
    sdRobust, cvRobust: 100 * sdRobust / mean,
    asymmetryMs: Math.abs(mo - me) * 1000, comb, combSurvives: survives, stride,
  };
}

/* Third-octave centres used for the bed spectrum and the correlation matrix. */
const CENTRES = [31.5, 63, 125, 250, 500, 1000, 2000, 2800, 4000, 5700, 8000];
const CORR_BANDS = [30, 60, 120, 250, 500, 1000, 2000, 4000];

function analyse(x, sr, meta) {
  const n = x.length;
  const seconds = n / sr;

  const THRESH = [-30, -40, -45, -50, -60, -70];
  const belowSample = THRESH.map(() => 0);
  let peak = 0, sumsq = 0, dc = 0, silentRun = 0, longestSilent = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i], a = Math.abs(v);
    if (a > peak) peak = a;
    sumsq += v * v;
    dc += v;
    const d = db(a);
    for (let t = 0; t < THRESH.length; t++) if (d < THRESH[t]) belowSample[t]++;
    if (a < 1e-6) { silentRun++; if (silentRun > longestSilent) longestSilent = silentRun; }
    else silentRun = 0;
  }
  const rms = Math.sqrt(sumsq / n);

  /* Windowed level, 50 ms, roughly the ear's integration time. */
  const W = Math.round(0.05 * sr);
  const wins = Math.floor(n / W);
  const wl = new Float64Array(wins);
  for (let w = 0; w < wins; w++) {
    let s = 0;
    for (let i = w * W; i < (w + 1) * W; i++) s += x[i] * x[i];
    wl[w] = db(Math.sqrt(s / W));
  }
  const pct = (arr) => {
    const s = Float64Array.from(arr).sort();
    return (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const pc = pct(wl);
  const belowWin = THRESH.map(t => wl.reduce((c, v) => c + (v < t ? 1 : 0), 0));

  /* The same distribution restricted to the stretches where the player is
     standing still. Footsteps are the player's own boots and belong above the
     wind; letting them into the headline "quiet" figure would either launder
     the number or punish the mix for being correct. Both are reported. */
  const segs = (meta && meta.segments) || [];
  const walkingAt = (t) => segs.some(([a, d]) => t >= a - 0.2 && t < a + d + 0.6);
  const stillIdx = [];
  for (let w = 0; w < wins; w++) if (!walkingAt((w + 0.5) * W / sr)) stillIdx.push(w);
  const stillWl = Float64Array.from(stillIdx.map(w => wl[w]));
  const stillPc = pct(stillWl);
  const stillBelow = THRESH.map(t => stillWl.reduce((c, v) => c + (v < t ? 1 : 0), 0));

  const S = stft(x, 1024, 256);

  /* Full-take band RMS. Kept because it is comparable with earlier runs, and
     labelled as what it is: a figure dominated by the loud fifteen per cent. */
  const bandEdges = [20, 120, 500, 2000, 6000, 12000].filter(f => f < sr / 2).concat(sr / 2);
  const bandPow = new Float64Array(bandEdges.length - 1);
  const avg = new Float64Array(S.bins);
  for (let f = 0; f < S.frames; f++) {
    for (let k = 0; k < S.bins; k++) avg[k] += S.power[f * S.bins + k];
  }
  for (let k = 0; k < S.bins; k++) avg[k] /= S.frames;
  let cenNum = 0, cenDen = 0;
  for (let k = 1; k < S.bins; k++) {
    const hz = k * sr / S.N;
    cenNum += hz * avg[k]; cenDen += avg[k];
    for (let b = 0; b < bandPow.length; b++) {
      if (hz >= bandEdges[b] && hz < bandEdges[b + 1]) { bandPow[b] += avg[k]; break; }
    }
  }
  const centroid = cenDen ? cenNum / cenDen : 0;
  const bandRms = Array.from(bandPow, p => db(Math.sqrt(p / 2)));

  /* Discrete events, on a median-filtered 20 ms envelope so that the bed's own
     variance does not report itself as a dozen events. */
  const EW = Math.round(0.02 * sr);
  const ewins = Math.floor(n / EW);
  const el = new Float64Array(ewins);
  for (let w = 0; w < ewins; w++) {
    let s = 0;
    for (let i = w * EW; i < (w + 1) * EW; i++) s += x[i] * x[i];
    el[w] = db(Math.sqrt(s / EW));
  }
  const em = new Float64Array(ewins);
  for (let w = 0; w < ewins; w++) {
    const a = el[Math.max(0, w - 1)], b = el[w], c = el[Math.min(ewins - 1, w + 1)];
    em[w] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  const bed = Float64Array.from(em).sort()[Math.floor(0.20 * ewins)];
  const thr = bed + 11;
  const events = [];
  let cur = null;
  for (let w = 0; w < ewins; w++) {
    if (em[w] > thr) {
      if (!cur) cur = { a: w, b: w, peak: em[w] };
      else { cur.b = w; if (em[w] > cur.peak) cur.peak = em[w]; }
    } else if (cur && (w - cur.b) * EW / sr > 0.35) {
      events.push(cur); cur = null;
    }
  }
  if (cur) events.push(cur);
  const evs = events
    .map(e => ({
      t: e.a * EW / sr,
      dur: (e.b - e.a + 1) * EW / sr,
      peak: e.peak,
      centroid: eventCentroid(S, sr, e.a * EW / sr, (e.b - e.a + 1) * EW / sr),
    }))
    .filter(e => e.dur >= 0.08);
  /* Footsteps, re-levelled against the full signal after band-limited
     detection, plus the gait statistics. */
  const steps = transients(x, sr).map(s => {
    const i0 = Math.max(0, Math.round((s.t - 0.006) * sr));
    const i1 = Math.min(n, i0 + Math.round(0.03 * sr));
    let ss = 0;
    for (let i = i0; i < i1; i++) ss += x[i] * x[i];
    return { t: s.t, peak: db(Math.sqrt(ss / (i1 - i0))) };
  });
  const stepsIn = steps.filter(s => walkingAt(s.t));
  const stepsOut = steps.filter(s => !walkingAt(s.t));

  /* Now that the player's own boots sit above the wind — which is the correct
     ordering for a first-person walk — they dominate the event list, so an
     event that coincides with a footfall is labelled as one. Otherwise the
     interesting question, how far apart the *weather* events are, is buried
     under a hundred and twenty footsteps. */
  /* Three populations, and conflating them makes the report useless. The
     scheduler's own event list says exactly when an animal called, so an event
     overlapping one is a call; a short event lining up with a transient is a
     footfall; what is left is weather. Duration matters as well as
     coincidence — a gust lasts several seconds and will overlap a footfall
     whenever the player walks through one. */
  const calls = (meta && meta.calls) || [];
  for (const e of evs) {
    /* The transient has to be at the *start* of the event, and the event has to
       be short. A scuff is a third of a second of rasp plus the near-field
       tail, so it runs to about six-tenths and would otherwise be filed as
       weather; a gust runs for seconds and will overlap a footfall whenever the
       player walks through one. */
    const hit = steps.some(s => s.t >= e.t - 0.06 && s.t <= e.t + 0.12);
    /* Overlap against the whole bout, not just its first call. A coyote bout
       runs for the best part of a minute and a wren cascade for several
       seconds; matching only the start files every repeat call as weather. */
    const call = calls.find(c =>
      c.t - 1 <= e.t + e.dur && c.t + (c.dur || 0) + 2.5 >= e.t);
    e.kind = call ? call.kind : (hit && e.dur < 1.2) ? 'step' : 'wind';
    /* The event's peak with the walking excised. A gust lasts several seconds
       and the player usually walks through part of it, so the raw event peak is
       whatever the loudest footfall inside it was — and comparing the step
       median against that is comparing the footsteps with themselves. This is
       the figure the perspective question actually needs. */
    let clean = -200;
    const w0 = Math.max(0, Math.floor(e.t / (EW / sr)));
    const w1 = Math.min(ewins - 1, Math.floor((e.t + e.dur) / (EW / sr)));
    for (let w = w0; w <= w1; w++) {
      if (walkingAt((w + 0.5) * EW / sr)) continue;
      if (em[w] > clean) clean = em[w];
    }
    e.peakClean = clean > -200 ? clean : null;
  }
  const windEvs = evs.filter(e => e.kind === 'wind');
  const callEvs = evs.filter(e => e.kind !== 'wind' && e.kind !== 'step');
  /* The loudest gust, taken over the scheduler's own gust windows with the
     walking and the fauna excised, rather than over detected events. Event
     detection cannot answer this: a gust the player walks straight through
     produces no event the classifier is willing to call weather, so on a take
     where that happens to every gust the comparison has nothing left to
     measure and reports a triumphant eighty-seven decibels of headroom. */
  let gustClean = -200;
  for (const gu of (meta && meta.gusts) || []) {
    const a0 = gu.t0 != null ? gu.t0 : gu.t;
    if (a0 == null) continue;
    const w0 = Math.max(0, Math.floor(a0 / (EW / sr)));
    const w1 = Math.min(ewins - 1, Math.floor((a0 + (gu.dur || 0)) / (EW / sr)));
    for (let w = w0; w <= w1; w++) {
      const t = (w + 0.5) * EW / sr;
      if (walkingAt(t)) continue;
      if (calls.some(c => t >= c.t - 1 && t <= c.t + (c.dur || 6) + 2.5)) continue;
      if (em[w] > gustClean) gustClean = em[w];
    }
  }

  /* Where the transients found while standing still come from. The question is
     whether the footstep machinery leaks when the player is not walking, and a
     bare count cannot answer it: sand bursts inside a gust are sharp enough to
     trip a transient detector and are supposed to be there. Anything left over
     after accounting for gusts and calls is the actual leak. */
  const inGust = (t) => ((meta && meta.gusts) || []).some(gu => {
    const a0 = gu.t0 != null ? gu.t0 : gu.t;
    return a0 != null && t >= a0 - 0.5 && t <= a0 + (gu.dur || 0) + 1.5;
  });
  const stillSrc = { gust: 0, call: 0, unexplained: 0, at: [] };
  for (const s of stepsOut) {
    if (inGust(s.t)) stillSrc.gust++;
    else if (calls.some(c => s.t >= c.t - 1 && s.t <= c.t + (c.dur || 6) + 2.5)) stillSrc.call++;
    else { stillSrc.unexplained++; stillSrc.at.push(+s.t.toFixed(2)); }
  }

  const gaps = [];
  for (let i = 1; i < windEvs.length; i++) {
    gaps.push(windEvs[i].t - (windEvs[i - 1].t + windEvs[i - 1].dur));
  }
  gaps.sort((a, b) => a - b);
  const stepLv = stepsIn.map(s => s.peak).sort((a, b) => a - b);
  /* Clipped to the take. The walk schedule is fixed, so a short render would
     otherwise report more seconds of walking than the render contains and a
     negative time spent standing still. */
  const walkSeconds = segs.reduce(
    (s, [t0, d]) => s + Math.max(0, Math.min(t0 + d, seconds) - Math.min(t0, seconds)), 0);

  /* ── the bed spectrum ──
     Frames that are both quiet and clear of transients, then the median bin
     level at each third-octave centre. This is the spectrum of the silence,
     which is what the design is about, and it is a completely different animal
     from the full-take band RMS above. */
  const quiet = [];
  const stepTimes = steps.map(s => s.t);
  let si = 0;
  for (let f = 0; f < S.frames; f++) {
    const t = (f * S.hop + S.N / 2) / sr;
    const ew = Math.min(ewins - 1, Math.floor(t / (EW / sr)));
    if (em[ew] > bed + 4) continue;
    while (si < stepTimes.length && stepTimes[si] < t - 0.35) si++;
    if (si < stepTimes.length && Math.abs(stepTimes[si] - t) < 0.35) continue;
    quiet.push(f);
  }
  const audibility = callAudibility(S, sr, quiet, calls);
  const bedSpec = CENTRES.map(fc => {
    const b0 = Math.max(1, Math.round(fc * 0.98 * S.N / sr));
    const b1 = Math.min(S.bins - 1, Math.max(b0, Math.round(fc * 1.02 * S.N / sr)));
    const vals = quiet.map(f => {
      let p = 0;
      for (let k = b0; k <= b1; k++) p += S.power[f * S.bins + k];
      return db(Math.sqrt(p / (b1 - b0 + 1) / 2));
    });
    return { f: fc, db: median(vals) };
  });
  /* How much of the top octave of the bed is too quiet to read, against three
     stated thresholds rather than one.
     The single figure was ambiguous and the ambiguity mattered: it was quoted
     against the PNG's nominal floor, but the bottom of the magma ramp has so
     little contrast that the darkest few decibels are indistinguishable by eye,
     so anyone reading the image measures a floor several decibels higher and
     gets a much worse number for the same audio. -102 dB is where that
     readable floor actually sits. Reporting all three makes the comparison
     unambiguous, and these are computed from the float render, so the numbers
     themselves are not floored at all. */
  const floorBins = (() => {
    const b0 = Math.max(1, Math.round(6000 * S.N / sr));
    const b1 = Math.min(S.bins - 1, Math.round(Math.min(12000, sr / 2 - 1) * S.N / sr));
    if (b1 <= b0 || !quiet.length) return null;
    const levels = [DB_LO, -108, -102];
    const at = levels.map(() => 0);
    let tot = 0;
    for (const f of quiet) {
      for (let k = b0; k <= b1; k++) {
        tot++;
        const d = db(Math.sqrt(S.power[f * S.bins + k] / 2));
        for (let i = 0; i < levels.length; i++) if (d <= levels[i]) at[i]++;
      }
    }
    return { levels, pct: at.map(v => 100 * v / tot) };
  })();

  /* ── inter-band envelope correlation ──
     The headline diagnostic. One noise source under one gain node gives a flat
     matrix; a physical process must decorrelate as the bands separate.
     Measured twice. The full take is what an outside instrument sees and is
     comparable across builds, but a footstep is broadband by nature and
     genuinely does correlate every band at once, so with the boots correctly
     placed above the wind the full-take matrix is partly a footstep matrix. The
     standing-still version is the one that answers the actual question, which
     was about the wind. */
  const envs = CORR_BANDS.map(fc => bandSeries(S, sr, fc));
  const corr = envs.map(a => envs.map(b => +pearson(a, b).toFixed(2)));
  const stillFrames = [];
  for (let f = 0; f < S.frames; f++) {
    if (!walkingAt((f * S.hop + S.N / 2) / sr)) stillFrames.push(f);
  }
  const stillEnvs = envs.map(e => Float64Array.from(stillFrames.map(f => e[f])));
  const corrStill = stillEnvs.map(a => stillEnvs.map(b => +pearson(a, b).toFixed(2)));
  /* And the walking frames on their own.
     This exists to settle one specific question. In the full-take matrix the
     correlation falls as the bands separate and then climbs again at the widest
     separation, which is the signature of a shared gain sitting under
     everything — and that is a fair thing to suspect, because it was true once.
     Splitting the two populations decides it: if the rise is a shared gain it
     appears in both halves, and if it is the boots it appears only here. */
  const walkFrames = [];
  for (let f = 0; f < S.frames; f++) {
    if (walkingAt((f * S.hop + S.N / 2) / sr)) walkFrames.push(f);
  }
  const walkEnvs = envs.map(e => Float64Array.from(walkFrames.map(f => e[f])));
  const corrWalk = walkFrames.length > 200
    ? walkEnvs.map(a => walkEnvs.map(b => +pearson(a, b).toFixed(2))) : null;

  /* ── recurring narrow peaks ──
     The rock-edge resonances are only real if they can be found: bins standing
     more than 1.5 dB above a third-octave smoothing of their own spectrum, in
     the same place, in a decent fraction of the loud frames. */
  const loud = [];
  for (let f = 0; f < S.frames; f++) {
    const t = (f * S.hop + S.N / 2) / sr;
    /* Loud, not walking, and no animal calling. A footstep is broadband and
       its own filter resonances are not what this is looking for; an animal is
       worse than broadband, because a voice is exactly the stationary narrow
       comb this search is built to detect. Leaving the fauna in makes the test
       report the coyote's harmonics as rock — two interleaved combs at 574 and
       586 Hz, which is a coyote and its answering neighbour, dressed up as a
       resonance at 1148 and 1172 Hz. */
    if (walkingAt(t)) continue;
    if (calls.some(c => t >= c.t - 1 && t <= c.t + (c.dur || 6) + 2.5)) continue;
    const ew = Math.min(ewins - 1, Math.floor(t / (EW / sr)));
    if (em[ew] > bed + 8) loud.push(f);
  }
  /* Average across frames *before* testing prominence. This is the whole
     trick, and getting it wrong invents resonances that are not there: a raw
     periodogram bin of filtered noise is exponentially distributed, so over a
     two-minute take some bin somewhere clears its own neighbours by fifteen or
     twenty decibels purely by chance, and a per-frame test duly reports the
     variance as a tone. A resonance is stationary in frequency and noise is
     not, so the median across loud frames keeps the former and collapses the
     latter as 1/sqrt(frames). */
  const medPow = new Float64Array(S.bins);
  if (loud.length) {
    const col = new Array(loud.length);
    for (let k = 0; k < S.bins; k++) {
      for (let i = 0; i < loud.length; i++) col[i] = S.power[loud[i] * S.bins + k];
      medPow[k] = median(col);
    }
  }
  /* Prominence over a third-octave neighbourhood, by mean or by median.
     Reporting both is the point. The mean is what a smoothing-based peak
     finder computes, and it is fooled in a specific way: if the neighbourhood
     contains deep narrow notches — which is what summing two correlated paths
     with a short delay produces — the mean is dragged far below the typical
     level and every ordinary bin in the region reads as a huge peak. The
     median of the same neighbourhood ignores the notches. A genuine resonance
     is prominent by both measures; comb-filter notches are prominent only by
     the mean. */
  const promOf = (pw, k, useMedian) => {
    const w = Math.max(3, Math.round(k * 0.12));
    /* The peak's own bins are excluded from the neighbourhood it is compared
       against. Including them lets a genuine ten-decibel resonance measure as
       five, because a third-octave window at these frequencies is only a few
       times wider than the resonance itself. */
    const skip = Math.max(1, Math.round(w / 3));
    const near = [];
    let sm = 0;
    for (let j = Math.max(1, k - w); j <= Math.min(S.bins - 1, k + w); j++) {
      if (Math.abs(j - k) <= skip) continue;
      near.push(pw[j]); sm += pw[j];
    }
    const ref = useMedian ? median(near) : sm / near.length;
    return 10 * Math.log10(Math.max(pw[k], 1e-24) / Math.max(ref, 1e-24));
  };

  const cand = [];
  for (let k = 4; k < S.bins - 4; k++) {
    const hz = k * sr / S.N;
    if (hz < 300 || hz > 8000) continue;
    cand.push({
      k, hz: Math.round(hz),
      prom: promOf(medPow, k, true), promMean: promOf(medPow, k, false),
    });
  }
  /* What this statistic does on this material when nothing is there. Reported
     alongside the peaks so the reader can see whether a peak means anything,
     rather than having to trust the threshold. */
  const promNoise = cand.length
    ? median(cand.map(c => Math.abs(c.prom))) : NaN;
  const promBar = Math.max(1.5, 4 * promNoise);
  const narrow = cand.filter(c => c.prom > promBar).sort((a, b) => b.prom - a.prom);

  /* The same test on the bed frames. A rock-edge tone is caused by fast air
     over a lip, so it must appear in gusts and vanish in the silence. Anything
     that measures the same in both is not weather at all: it is a continuously
     running oscillator bleeding through a gate that never quite closes, which
     is the standard failure of a design that reuses long-lived voices instead
     of allocating per event. Distinguishing the two costs one extra median. */
  const bedPow = new Float64Array(S.bins);
  if (quiet.length) {
    const col = new Array(quiet.length);
    for (let k = 0; k < S.bins; k++) {
      for (let i = 0; i < quiet.length; i++) col[i] = S.power[quiet[i] * S.bins + k];
      bedPow[k] = median(col);
    }
  }
  for (const nn of narrow.slice(0, 8)) nn.bedProm = promOf(bedPow, nn.k, true);
  /* Persistence, for the survivors only: the share of loud frames in which the
     bin also stands clear in that frame alone. A steady resonance is present in
     most frames; a chance alignment is not. */
  for (const nn of narrow.slice(0, 8)) {
    let hits = 0;
    const pw = new Float64Array(S.bins);
    for (const f of loud) {
      for (let j = 0; j < S.bins; j++) pw[j] = S.power[f * S.bins + j];
      if (promOf(pw, nn.k, true) > 1.5) hits++;
    }
    nn.frac = loud.length ? hits / loud.length : 0;
  }

  return {
    seconds, sampleRate: sr,
    rmsMono: db(rms), peakMono: db(peak), crest: db(peak) - db(rms),
    dc: dc / n, longestSilentMs: longestSilent / sr * 1000,
    thresholds: THRESH,
    belowSamplePct: belowSample.map(c => 100 * c / n),
    belowWinPct: belowWin.map(c => 100 * c / wins),
    stillBelowWinPct: stillWl.length ? stillBelow.map(c => 100 * c / stillWl.length) : null,
    stillWindows: stillWl.length, totalWindows: wins,
    winPercentiles: { p5: pc(0.05), p25: pc(0.25), p50: pc(0.5), p90: pc(0.9), p99: pc(0.99), max: pc(1) },
    stillPercentiles: stillWl.length
      ? { p5: stillPc(0.05), p50: stillPc(0.5), p90: stillPc(0.9), p99: stillPc(0.99), max: stillPc(1) }
      : null,
    bandEdges, bandRms, centroid,
    bed, thr, events: evs, windEvents: windEvs, callEvents: callEvs,
    gapStats: gaps.length
      ? { min: gaps[0], median: gaps[gaps.length >> 1], max: gaps[gaps.length - 1] } : null,
    continuity: continuity(wl, W, sr, evs, seconds, pc,
      audibility && audibility.spans),
    footsteps: {
      inWalk: stepsIn.length, outsideWalk: stepsOut.length, walkSeconds,
      level: stepLv.length
        ? { min: stepLv[0], median: stepLv[stepLv.length >> 1], max: stepLv[stepLv.length - 1],
            spread: stepLv[stepLv.length - 1] - stepLv[0] } : null,
      gait: gait(stepsIn),
      times: stepsIn.map(s => +s.t.toFixed(3)),
      gustClean: gustClean > -200 ? gustClean : null,
      stillSrc,
      decay: stepDecay(x, sr, stepTimes, calls),
    },
    bedSpec, bedFloorPct: floorBins, quietFrames: quiet.length, audibility,
    corrBands: CORR_BANDS, corr, corrStill, corrWalk,
    narrow: narrow.slice(0, 8), promNoise, promBar, loudFrames: loud.length,
    winLevel: wl, spec: S, meta,
  };
}

/**
 * How far each scheduled voice stands above the bed *in its own band*.
 *
 * The broadband event detector is the wrong instrument for a bird and it was
 * actively misleading: a hundred-millisecond chirp in a two-hundred-hertz band
 * hardly moves the broadband RMS of a fifty-millisecond window, so raising the
 * insect bed made the detector lose calls that had in fact got louder. Judged
 * that way, seventeen scheduled calls a minute looked like one, and the obvious
 * conclusion — that the birds were inaudible — was the opposite of the truth.
 *
 * What a listener notices is a narrowband excursion over the local bed, so that
 * is what this measures: for each call, the loudest bin anywhere in the vocal
 * range against that same bin's median level in the bed. Masking is roughly
 * within-band, which is why the comparison is per bin and not against a
 * broadband figure.
 */
function callAudibility(S, sr, quiet, calls) {
  if (!calls || !calls.length || !quiet.length) return null;
  const b0 = Math.max(1, Math.round(350 * S.N / sr));
  const b1 = Math.min(S.bins - 1, Math.round(9000 * S.N / sr));
  /* Per-bin bed median, subsampled: a few hundred frames settle a median to
     well inside the tenth of a decibel this is quoted to, and the full set is
     several hundred sorts of a few thousand values for no gain. */
  const stride = Math.max(1, Math.floor(quiet.length / 400));
  const bedBin = new Float64Array(S.bins);
  const scratch = [];
  for (let k = b0; k <= b1; k++) {
    scratch.length = 0;
    for (let i = 0; i < quiet.length; i += stride) scratch.push(S.power[quiet[i] * S.bins + k]);
    scratch.sort((p, q) => p - q);
    bedBin[k] = scratch[scratch.length >> 1] || 1e-30;
  }
  const out = [];
  for (const c of calls) {
    /* A call is a phrase, not an instant, and the peak can fall anywhere in it.
       Two seconds covers the longest cascade here; frames outside the take are
       simply absent, which is the right behaviour for a call cued near the end. */
    const f0 = Math.max(0, Math.floor(c.t * sr / S.hop));
    const f1 = Math.min(S.frames - 1, Math.ceil((c.t + 2.0) * sr / S.hop));
    let best = -Infinity, bestHz = 0, audFrames = 0;
    for (let f = f0; f <= f1; f++) {
      let frameBest = -Infinity;
      for (let k = b0; k <= b1; k++) {
        const e = 10 * Math.log10((S.power[f * S.bins + k] + 1e-30) / bedBin[k]);
        if (e > frameBest) { frameBest = e; }
        if (e > best) { best = e; bestHz = k * sr / S.N; }
      }
      /* Counted per frame rather than as end-minus-start, so the gaps inside a
         phrase are not credited as audible. A cascade of nine notes with silence
         between them is nine short audible stretches, and pretending otherwise
         would inflate the very figure this exists to make honest. */
      if (frameBest >= 8) audFrames++;
    }
    if (Number.isFinite(best)) {
      out.push({ kind: c.kind, t: c.t, over: best, hz: bestHz,
        dur: audFrames * S.hop / sr });
    }
  }
  if (!out.length) return null;
  const overs = out.map(o => o.over).sort((p, q) => p - q);
  /* Eight decibels is the bar. Below about six a narrowband event is present in
     a measurement and arguable by ear; by ten it is unmistakably a bird. */
  return {
    n: out.length,
    median: overs[overs.length >> 1],
    p10: overs[Math.floor(overs.length * 0.1)],
    min: overs[0],
    max: overs[overs.length - 1],
    clearPct: 100 * out.filter(o => o.over >= 8).length / out.length,
    quietest: out.slice().sort((p, q) => p.over - q.over).slice(0, 3),
    /* Spans for the continuity union, so "something sounding" counts the voices
       a listener can hear rather than the ones a level meter happens to flag. */
    spans: out.filter(o => o.over >= 8 && o.dur > 0).map(o => ({ t: o.t, dur: o.dur })),
  };
}

function eventCentroid(S, sr, t0, dur) {
  const f0 = Math.max(0, Math.floor(t0 * sr / S.hop));
  const f1 = Math.min(S.frames - 1, Math.ceil((t0 + dur) * sr / S.hop));
  let num = 0, den = 0;
  for (let f = f0; f <= f1; f++) {
    for (let k = 1; k < S.bins; k++) {
      const p = S.power[f * S.bins + k];
      num += (k * sr / S.N) * p; den += p;
    }
  }
  return den ? num / den : 0;
}

/* ── voice-level analysis, used on the forced-event render ─────────────── */

/**
 * Harmonic structure of a sustained voiced sound: find the fundamental by
 * scanning candidates and scoring the summed energy of their first six
 * harmonics, then report each harmonic relative to the strongest.
 *
 * Motivation: a two-partial oscillator and an animal are trivially
 * distinguishable this way, and the difference does not show up in any level
 * or centroid measurement.
 */
function harmonics(x, sr, t0, t1, f0lo = 300, f0hi = 900) {
  const N = 8192;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const len = Math.min(N, Math.round((t1 - t0) * sr));
  if (len < 1024) return null;
  const re = new Float64Array(N), im = new Float64Array(N);
  let wsum = 0;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len);
    re[i] = x[i0 + i] * w; wsum += w;
  }
  fft(re, im);
  const bins = N >> 1;
  const mag = new Float64Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k]) * 2 / wsum;
  const at = (hz) => {
    const k = Math.round(hz * N / sr);
    let m = 0;
    for (let j = Math.max(0, k - 2); j <= Math.min(bins - 1, k + 2); j++) m = Math.max(m, mag[j]);
    return m;
  };
  let best = 0, bestF = 0;
  for (let f = f0lo; f <= f0hi; f += 0.5) {
    let s = 0;
    for (let h = 1; h <= 6; h++) s += at(f * h) ** 2;
    if (s > best) { best = s; bestF = f; }
  }
  const hs = [];
  for (let h = 1; h <= 8; h++) hs.push({ h, hz: Math.round(bestF * h), db: db(at(bestF * h)) });
  const top = Math.max(...hs.map(v => v.db));
  return {
    f0: bestF, strongest: hs.find(v => v.db === top).h,
    rel: hs.map(v => ({ h: v.h, hz: v.hz, rel: +(v.db - top).toFixed(1) })),
    within20: hs.filter(v => v.db > top - 20).length,
  };
}

/**
 * Prominence of a named narrow peak: its own bin against a third-octave
 * smoothing of the same spectrum, averaged over a window.
 *
 * Aimed at frequencies the synthesis says should be there rather than hunting
 * blind. Filtered noise crosses a couple of decibels of apparent prominence at
 * any bin by chance, so a blind search over a long take cannot distinguish a
 * real resonance from its own variance — but a known frequency measured over a
 * known window can.
 */
function peakProminence(x, sr, t0, span, freqs) {
  const S = stft(x.subarray(Math.round(t0 * sr), Math.round((t0 + span) * sr)), 2048, 512);
  return freqs.map(f => {
    const k = Math.round(f * S.N / sr);
    const w = Math.max(3, Math.round(k * 0.12));
    const skip = Math.max(2, Math.round(w / 3));
    /* Per-frame values, kept rather than accumulated. The mean over the window
       is the wrong summary and it hid a real tone for several rounds: an edge
       tone only exists while the gust is driving it, so a window that spans the
       onset and the decay contains frames with no tone at all, and averaging
       those in drags a genuine twenty-decibel peak down to three. The high
       percentile is what answers "is the tone there when the gust is up". */
    const vals = [];
    let peakDb = -200;
    for (let fr = 0; fr < S.frames; fr++) {
      let peakP = 0;
      for (let j = Math.max(1, k - 2); j <= Math.min(S.bins - 1, k + 2); j++) {
        peakP = Math.max(peakP, S.power[fr * S.bins + j]);
      }
      let sm = 0, c = 0;
      for (let j = Math.max(1, k - w); j <= Math.min(S.bins - 1, k + w); j++) {
        if (Math.abs(j - k) <= skip) continue;
        sm += S.power[fr * S.bins + j]; c++;
      }
      vals.push(10 * Math.log10(Math.max(peakP, 1e-24) / Math.max(sm / c, 1e-24)));
      peakDb = Math.max(peakDb, 10 * Math.log10(Math.max(peakP, 1e-24)));
    }
    vals.sort((p, q) => p - q);
    return {
      f,
      prom: vals[Math.floor(vals.length * 0.9)],
      promMedian: vals[vals.length >> 1],
      promMean: vals.reduce((s, v) => s + v, 0) / vals.length,
      peakDb,
    };
  });
}

/**
 * What comes back after a source stops.
 *
 * Run on a band-limited copy of the signal and against an explicit noise
 * floor, because both matter. A broadband Schroeder integration over a window
 * this long is dominated by the wind bed after the first second, and it will
 * report a six-second RT60 for an impulse response that is two seconds long and
 * mostly silence — the number describes the bed, not the reverb. So: find the
 * discrete arrivals, and measure the decay only over the part that is actually
 * above the floor.
 */
/**
 * Pitch trajectory of a sustained voiced sound.
 *
 * The specific thing being tested is whether the howl is a held note. A
 * per-frame parabolic-interpolated peak in a narrow search band gives the
 * fundamental to well under a per cent, which is enough to separate a two per
 * cent sag from a twenty per cent glissando — and enough to pull the vibrato
 * out of the residual once the slow trend is removed.
 */
function pitchTrack(x, sr, t0, span, flo, fhi, harm = 1) {
  const N = 2048, hop = 256;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const seg = x.subarray(i0, Math.min(x.length, i0 + Math.round(span * sr)));
  if (seg.length < N * 3) return null;
  const S = stft(seg, N, hop);
  const k0 = Math.max(1, Math.floor(flo * N / sr)), k1 = Math.min(S.bins - 2, Math.ceil(fhi * N / sr));
  const f = [], t = [], en = [], prom = [];
  for (let fr = 0; fr < S.frames; fr++) {
    let bk = k0, bv = -1, tot = 0;
    const all = [];
    for (let k = k0; k <= k1; k++) {
      const v = S.power[fr * S.bins + k];
      tot += v; all.push(v);
      if (v > bv) { bv = v; bk = k; }
    }
    en.push(tot);
    /* How far the winning bin stands above the rest of the search band. This is
       the voicing test: a tone towers over its neighbours and noise does not,
       and unlike an energy threshold it says nothing about what the pitch is. */
    prom.push(db(Math.sqrt(bv)) - db(Math.sqrt(median(all))));
    // Parabolic interpolation on the log magnitudes, for sub-bin resolution.
    const l = Math.log(S.power[fr * S.bins + bk - 1] + 1e-30);
    const c = Math.log(bv + 1e-30);
    const rr = Math.log(S.power[fr * S.bins + bk + 1] + 1e-30);
    const d = 0.5 * (l - rr) / (l - 2 * c + rr || 1e-9);
    f.push((bk + Math.max(-1, Math.min(1, d))) * sr / N);
    t.push(fr * hop / sr);
  }
  /* Voiced frames selected by energy, not by how close they are to the median
     frequency. Gating on frequency is circular when the quantity being measured
     is how far the frequency moves: at a twenty per cent glissando plus eight
     per cent of vibrato the trajectory spans nearly a factor of two, so a
     window tight enough to reject unvoiced noise also rejects the bottom of the
     glide — which silently truncated the fall being measured and reported a
     healthy trajectory as a five per cent sag. Energy separates voiced from
     unvoiced cleanly and says nothing about pitch; the ratio test that remains
     is wide, and is only there to throw out octave errors. */
  const loudest = Math.max(...en);
  const voiced = f.map((v, i) => ({ v, i }))
    .filter(o => prom[o.i] > 8 && en[o.i] > loudest * 1e-2);
  if (voiced.length < 12) return null;
  const med = median(voiced.map(o => o.v));
  const keep = voiced.filter(o => o.v / med > 0.5 && o.v / med < 2.1);
  if (keep.length < 12) return null;
  const fv = keep.map(o => o.v), tv = keep.map(o => t[o.i]);
  /* Two trends, because the two questions want different smoothing. The
     glissando is a third-of-a-second-and-up gesture and needs a window wider
     than two vibrato periods or the vibrato leaks into it and the peak lands on
     whichever waver happened to be highest; the vibrato needs a narrower one or
     the glissando leaks into the residual and inflates the depth. */
    const smooth = (secs) => {
    const w = Math.max(3, Math.round(secs * sr / hop) | 1);
    return fv.map((_, i) => {
      const a = Math.max(0, i - (w >> 1)), b = Math.min(fv.length, i + (w >> 1) + 1);
      return median(fv.slice(a, b));
    });
  };
  /* Three timescales, not two. The extra one is `fast`, a four-frame median that
     is far shorter than a vibrato period and so preserves the waver entirely,
     but removes the single-frame jitter of the peak estimate itself — at one bin
     per one and a half per cent that jitter is comparable with the vibrato being
     measured, and left in it inflated both the depth and, worse, the rate, by
     adding zero crossings that were instrument noise. */
  /* The vibrato trend is deliberately wide — three vibrato periods, not the
     three quarters of one it used to be. A running median of width comparable
     with the period tracks the waver instead of ignoring it, so subtracting it
     cancelled most of the signal and left mainly the difference between a sine
     and its own median, whose energy sits at multiples of the vibrato rate. That
     is why deepening the vibrato made the measured depth go down and the
     measured rate jump to eight hertz while the oscillator sat at 5.4. A median
     passes a linear ramp through unchanged whatever its width, so a wide window
     still removes the glissando; and the narrowband fit below rejects the
     leftover curvature on its own. */
  const slow = smooth(0.34), trend = smooth(0.60), fast = smooth(0.043);
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  /* Peak taken from the rise, end from the last fifth — and both selected by
     elapsed time rather than by position in the surviving frames. That
     distinction is the whole measurement: unvoiced frames are not spread evenly,
     they cluster at the release, so "the last fifth of the frames that
     survived" is somewhere in mid-sustain and the fall gets measured over the
     part of the glissando that has not happened yet. Fixed windows rather than
     argmax-then-after, too, for the same reason in reverse: the rise occupies
     the first sixth of the howl by construction, and searching the whole span
     for the top of the arch let a late waver win it. */
  const tSpan = tv[tv.length - 1] - tv[0] || 1;
  const inHead = tv.map(v => (v - tv[0]) / tSpan < 0.45);
  const inTail = tv.map(v => (v - tv[0]) / tSpan > 0.78);
  const peak = Math.max(...slow.filter((_, i) => inHead[i]));
  const tailVals = slow.filter((_, i) => inTail[i]);
  const tail = tailVals.length ? mean(tailVals) : slow[slow.length - 1];
  /* Vibrato: RMS of the residual against the local trend, and zero crossings of
     it for the rate — but over the sustain only. The rise into the note and the
     terminal gesture are both deliberate, fast frequency movements, and a 140 ms
     median trend cannot follow either of them, so including them charges their
     slope to the vibrato. That is not a small effect: deepening the glissando
     and adding an ending doubled the measured depth while the vibrato itself was
     being reduced. The window below is the same part of the note the fall is
     measured across. */
  const inSus = tv.map(v => {
    const u = (v - tv[0]) / tSpan;
    return u > 0.22 && u < 0.88;
  });
  const res = [];
  const resT = [];
  for (let i = 0; i < fast.length; i++) {
    if (!inSus[i]) continue;
    res.push(fast[i] / trend[i] - 1);
    resT.push(tv[i]);
  }
  let rms = 0;
  for (let i = 0; i < res.length; i++) rms += res[i] * res[i];
  rms = Math.sqrt(rms / res.length);
  /* The depth and the rate both come from fitting a sinusoid to the residual
     across the plausible vibrato band, rather than from the residual's own
     statistics.
     Statistics of the whole residual do not answer the question asked. Zero
     crossings count the tracker's jitter as well as the waver, and RMS or a
     percentile charges every non-vibrato wiggle — leftover glissando curvature
     below the band, bin quantisation above it — to the depth. Measured three
     ways, the same residual gave 2.4%, 5.8% and 17.7%, which is a sign that the
     residual is not one thing. A fit at a single frequency is narrowband by
     construction: it takes only what actually wavers at four to eight hertz and
     is deaf to the rest. Least squares against the real frame times rather than
     an FFT, because voiced frames are a filtered subset and so are not uniformly
     spaced. */
  let vibHz = NaN, vibAmp = 0;
  if (res.length >= 8) {
    for (let hz = 3; hz <= 9.0001; hz += 0.05) {
      let a = 0, b = 0;
      for (let i = 0; i < res.length; i++) {
        const w = 2 * Math.PI * hz * resT[i];
        a += res[i] * Math.cos(w);
        b += res[i] * Math.sin(w);
      }
      a *= 2 / res.length; b *= 2 / res.length;
      const amp = Math.hypot(a, b);
      if (amp > vibAmp) { vibAmp = amp; vibHz = hz; }
    }
  }
  const absRes = res.map(Math.abs).sort((p, q) => p - q);
  /* Divided down to the fundamental at the end. Which partial gets tracked is
     the caller's decision and it matters: the strongest partial of this voice is
     the second, thirteen decibels up on the first, so a search band placed
     around the fundamental gets hijacked by h2 the moment the glide takes the
     fundamental low enough to bring h2 inside the band — which reads as the
     pitch jumping up exactly when it is in fact falling, and turns a real
     glissando into a two per cent sag. Tracking the loud partial on purpose and
     dividing avoids the ambiguity entirely; the ratios below are unaffected by
     the division. */
  const dn = (v) => v / harm;
  return {
    frames: fv.length, harmonic: harm,
    start: dn(mean(fv.slice(0, Math.max(2, Math.round(fv.length * 0.06))))),
    peak: dn(peak), end: dn(tail),
    /* Peak to sustain-end, as a percentage of the peak. This is the number the
       critique is about: a real howl falls fifteen to forty per cent. */
    fallPct: 100 * (peak - tail) / peak,
    // Peak deviation of the fitted waver, as a percentage of the pitch.
    vibDepthPct: 100 * vibAmp,
    /* What fraction of the residual's energy the fitted waver accounts for. Near
       one means the residual is vibrato and the depth is the depth; well under
       one means most of the wobble is somewhere other than the vibrato band and
       the depth is the honest part of a messier signal. */
    vibFit: rms > 0 ? (vibAmp / Math.SQRT2) / rms : 0,
    vibRmsPct: 100 * rms,
    vibHz,
    lo: dn(Math.min(...fv)), hi: dn(Math.max(...fv)),
  };
}

/**
 * How far a narrow peak moves.
 *
 * Follows the strongest bin inside a wide window around a nominal frequency,
 * across the loudest tenth of frames only. Restricting to loud frames is the
 * whole trick: between gusts there is no tone, the strongest bin is whichever
 * noise won, and averaging that in would report the width of the search band
 * rather than the sweep of the tone.
 */
function peakGlide(x, sr, t0, span, f) {
  const N = 2048, hop = 512;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const seg = x.subarray(i0, Math.min(x.length, i0 + Math.round(span * sr)));
  if (seg.length < N * 4) return null;
  const S = stft(seg, N, hop);
  const k0 = Math.max(1, Math.floor(f * 0.5 * N / sr));
  const k1 = Math.min(S.bins - 2, Math.ceil(f * 1.8 * N / sr));
  /* The most prominent bin, not the loudest one. A tone six or seven decibels
     over its own skirt is nowhere near the loudest thing in a window an octave
     and a half wide — the broadband wind is — so tracking the raw maximum
     followed the wind's spectral tilt and reported a sweep that had nothing to
     do with the tone. Prominence against a local median finds the peak. */
  const wsm = Math.max(3, Math.round(0.16 * (k1 - k0)));
  const rows = [];
  for (let fr = 0; fr < S.frames; fr++) {
    let bk = k0, bv = -1e9, tot = 0;
    for (let k = k0; k <= k1; k++) tot += S.power[fr * S.bins + k];
    for (let k = k0; k <= k1; k++) {
      const near = [];
      for (let j = Math.max(1, k - wsm); j <= Math.min(S.bins - 1, k + wsm); j++) {
        if (Math.abs(j - k) <= 2) continue;
        near.push(S.power[fr * S.bins + j]);
      }
      const v = db(Math.sqrt(S.power[fr * S.bins + k])) - db(Math.sqrt(median(near)));
      if (v > bv) { bv = v; bk = k; }
    }
    rows.push({ f: bk * sr / N, e: tot });
  }
  rows.sort((p, q) => q.e - p.e);
  const loud = rows.slice(0, Math.max(4, Math.round(rows.length * 0.10))).map(o => o.f).sort((p, q) => p - q);
  const lo = loud[Math.floor(loud.length * 0.1)], hi = loud[Math.floor(loud.length * 0.9)];
  return { lo, hi, semitones: 12 * Math.log2(hi / lo) };
}

function arrivals(x, sr, t0, t1, floorDb) {
  const W = Math.round(0.02 * sr);
  const a = Math.round(t0 * sr / W), b = Math.round(t1 * sr / W);
  const e = [];
  for (let w = a; w < b; w++) {
    let s = 0;
    for (let i = w * W; i < (w + 1) * W && i < x.length; i++) s += x[i] * x[i];
    e.push(db(Math.sqrt(s / W)));
  }
  /* Seven decibels clear of the band floor, not four. At four the bed's own
     variance produces "arrivals" a couple of seconds after an impulse response
     that is only two seconds long, and those phantom arrivals then drag the
     decay estimate out to several seconds. */
  const gate = floorDb + 7;
  const out = [];
  for (let i = 2; i < e.length - 2; i++) {
    const local = Math.min(e[i] - e[i - 2], e[i] - e[i + 2]);
    if (local > 1.8 && e[i] > gate && e[i] > e[i - 1] && e[i] >= e[i + 1]) {
      out.push({ t: +(t0 + i * W / sr).toFixed(3), db: +e[i].toFixed(1), prom: +local.toFixed(1) });
    }
  }
  let lastAbove = -1;
  for (let i = 0; i < e.length; i++) if (e[i] > gate) lastAbove = i;
  const audible = lastAbove < 0 ? 0 : (lastAbove + 1) * W / sr;

  const en = [];
  for (let i = 0; i <= lastAbove; i++) en.push(10 ** (e[i] / 10));
  let tot = 0;
  for (const v of en) tot += v;
  let acc = 0;
  const curve = en.map(v => { acc += v; return 10 * Math.log10(Math.max(tot - acc, 1e-20) / tot); });
  const find = (d) => {
    for (let i = 0; i < curve.length; i++) if (curve[i] <= d) return i * W / sr;
    return NaN;
  };
  const t5 = find(-5), t25 = find(-25);
  return {
    peaks: out, audibleTail: audible, floorDb,
    rt60: Number.isFinite(t25) && Number.isFinite(t5) ? (t25 - t5) * 3 : NaN,
  };
}

/* ── drawing ───────────────────────────────────────────────────────────── */

const GLYPH = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7],
  '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2],
  '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7], '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2],
  'k': [4, 5, 6, 5, 5], 's': [3, 4, 2, 1, 6], 'd': [1, 1, 7, 5, 7], 'B': [6, 5, 6, 5, 6],
  'H': [5, 5, 7, 5, 5], 'z': [7, 1, 2, 4, 7], 'F': [7, 4, 6, 4, 4], 'S': [3, 4, 2, 1, 6],
  ' ': [0, 0, 0, 0, 0],
};

class Canvas {
  constructor(w, h, bg = [12, 12, 14]) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0]; this.px[i * 3 + 1] = bg[1]; this.px[i * 3 + 2] = bg[2];
    }
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  text(x, y, s, c) {
    let cx = x;
    for (const ch of s) {
      const g = GLYPH[ch] || GLYPH[' '];
      for (let r = 0; r < 5; r++) {
        for (let b = 0; b < 3; b++) if (g[r] & (4 >> b)) this.set(cx + b, y + r, c);
      }
      cx += 4;
    }
  }
}

/* A dark-to-hot ramp. Deliberately not a rainbow: the point is to read level,
   and a monotonic lightness ramp is the only kind you can read level off. */
const RAMP = [
  [0, [8, 8, 16]], [0.18, [24, 20, 60]], [0.36, [70, 26, 92]], [0.54, [131, 40, 88]],
  [0.70, [186, 66, 62]], [0.84, [227, 118, 45]], [0.94, [246, 186, 76]], [1, [252, 240, 190]],
];
function ramp(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i];
      const f = (t - a) / (b - a || 1);
      return [0, 1, 2].map(k => Math.round(ca[k] + (cb[k] - ca[k]) * f));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/* The displayed range. The floor was -108, which put the bed's top octave hard
   against the bottom of the colour ramp: anyone reading the spectrogram found
   the high frequencies censored and could not tell an improvement up there from
   no improvement at all. -126 leaves the quiet bed a good twenty decibels of
   visible range to move in. */
const DB_LO = -126, DB_HI = -26;

function spectrogram(a, file, marks) {
  const S = a.spec, sr = a.sampleRate;
  const PW = 1400, PH = 360, LM = 46, RM = 56, TOP = 20, LVH = 96, BM = 16;
  const W = LM + PW + RM, H = TOP + PH + 6 + LVH + BM;
  const c = new Canvas(W, H);

  const F_LO = 30, F_HI = Math.min(12000, sr / 2);
  const logf = (f) => Math.log(f / F_LO) / Math.log(F_HI / F_LO);

  const rowBin = new Int32Array(PH + 1);
  for (let r = 0; r <= PH; r++) {
    const f = F_LO * Math.pow(F_HI / F_LO, r / PH);
    rowBin[r] = Math.min(S.bins - 1, Math.max(1, Math.round(f * S.N / sr)));
  }

  for (let col = 0; col < PW; col++) {
    const f0 = Math.floor(col * S.frames / PW);
    const f1 = Math.max(f0 + 1, Math.floor((col + 1) * S.frames / PW));
    for (let r = 0; r < PH; r++) {
      const b0 = rowBin[r], b1 = Math.max(b0 + 1, rowBin[r + 1]);
      let p = 0, cnt = 0;
      for (let f = f0; f < f1; f++) {
        for (let k = b0; k < b1; k++) { p += S.power[f * S.bins + k]; cnt++; }
      }
      const d = db(Math.sqrt(p / (cnt || 1) / 2));
      c.set(LM + col, TOP + PH - 1 - r, ramp((d - DB_LO) / (DB_HI - DB_LO)));
    }
  }

  const GREY = [120, 120, 130], DIM = [46, 46, 54], WHITE = [225, 225, 235];

  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f > F_HI) continue;
    const y = TOP + PH - 1 - Math.round(logf(f) * PH);
    for (let x = LM - 3; x < LM; x++) c.set(x, y, GREY);
    for (let x = LM; x < LM + PW; x += 6) c.set(x, y, DIM);
    const lbl = f >= 1000 ? `${f / 1000}k` : `${f}`;
    c.text(LM - 6 - lbl.length * 4, y - 2, lbl, GREY);
  }
  c.text(2, TOP + 2, 'Hz', GREY);

  const step = a.seconds > 90 ? 20 : a.seconds > 30 ? 10 : 5;
  for (let t = 0; t <= a.seconds; t += step) {
    const x = LM + Math.round(t / a.seconds * PW);
    for (let y = TOP; y < TOP + PH; y += 8) c.set(x, y, DIM);
    for (let y = H - BM; y < H - BM + 3; y++) c.set(x, y, GREY);
    c.text(Math.min(W - 14, x - 4), H - BM + 5, `${t}s`, GREY);
  }
  for (const e of a.events) {
    const x0 = LM + Math.round(e.t / a.seconds * PW);
    const x1 = LM + Math.max(x0 + 1, Math.round((e.t + e.dur) / a.seconds * PW));
    c.rect(x0, 4, Math.max(1, x1 - x0), 6, [250, 220, 120]);
  }
  for (const m of marks || []) {
    const x = LM + Math.round(m.t / a.seconds * PW);
    c.rect(x - 1, 2, 3, 12, m.c);
  }

  const LY = TOP + PH + 6;
  c.rect(LM, LY, PW, LVH, [18, 18, 22]);
  const L_LO = -96, L_HI = -12;
  const ly = (d) => LY + LVH - 1 -
    Math.round((Math.max(L_LO, Math.min(L_HI, d)) - L_LO) / (L_HI - L_LO) * (LVH - 1));
  for (const d of [-20, -40, -45, -60, -80]) {
    const y = ly(d);
    const col = d === -45 ? [90, 140, 90] : [46, 46, 54];
    for (let x = LM; x < LM + PW; x += d === -45 ? 1 : 4) c.set(x, y, col);
    c.text(LM - 22, y - 2, `${d}`, GREY);
  }
  c.text(2, LY + 2, 'dB', GREY);
  const wl = a.winLevel;
  for (let x = 0; x < PW; x++) {
    const i0 = Math.floor(x * wl.length / PW), i1 = Math.max(i0 + 1, Math.floor((x + 1) * wl.length / PW));
    let lo = 1e9, hi = -1e9;
    for (let i = i0; i < i1; i++) { if (wl[i] < lo) lo = wl[i]; if (wl[i] > hi) hi = wl[i]; }
    for (let y = ly(hi); y <= ly(lo); y++) c.set(LM + x, y, WHITE);
  }

  const CX = LM + PW + 12;
  for (let y = 0; y < PH; y++) {
    const t = 1 - y / (PH - 1);
    for (let x = 0; x < 12; x++) c.set(CX + x, TOP + y, ramp(t));
  }
  for (const d of [-120, -110, -100, -80, -60, -40, -30]) {
    const y = TOP + Math.round((1 - (d - DB_LO) / (DB_HI - DB_LO)) * (PH - 1));
    for (let x = CX + 12; x < CX + 15; x++) c.set(x, y, GREY);
    c.text(CX + 16, y - 2, `${d}`, GREY);
  }
  c.text(CX, TOP - 8, 'dB', GREY);

  fs.writeFileSync(file, encodeRGB(W, H, c.px));
  return { W, H };
}

/* ── run ───────────────────────────────────────────────────────────────── */

function decode(res) {
  const raw = Buffer.from(res.pcm, 'base64');
  const i16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const x = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) x[i] = i16[i] / res.scale;
  return x;
}

const shotsDir = path.join(DIR, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

/* No render lock. The lock serialises *rendering*, because concurrent captures
   contend for the same four cores, and this probe draws nothing: it drives an
   OfflineAudioContext and reads numbers back. Queueing behind an eight-view
   capture for the harness's full forty-five-minute timeout, four times over,
   was the failure mode that made this necessary.
   Not a general escape hatch. Booting the page is still hundreds of seconds of
   procedural texture generation on those same four cores, so this runs slowly
   alongside a capture — it simply runs, instead of timing out. */
await run({ width: 640, height: 360, lock: false }, async ({ page, errs }) => {
  /* Generous, but finite. This was 0 — no timeout at all — and under CPU
     contention from other agents rendering, the contract check sat for half an
     hour and had to be killed. A measurement tool that can hang is a tool
     nobody can verify with, so every step below is bounded and every bound
     degrades to a printed warning rather than a stall. */
  page.setDefaultTimeout(120000);
  await page.waitForTimeout(1500);

  const warnings = [];
  const withTimeout = async (label, ms, fn, fallback) => {
    let timer;
    try {
      return await Promise.race([
        fn(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); }),
      ]);
    } catch (e) {
      warnings.push(`${label} ${String(e).includes('timeout') ? `timed out after ${ms / 1000}s` : `failed: ${e}`}`);
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };

  const ok = await page.evaluate(() =>
    !!(window.__game && window.__game.audio && window.__game.audio.available));
  if (!ok) throw new Error('window.__game.audio is not available');

  console.log(`  rendering ${SECONDS}s offline at ${SR} Hz …`);
  const t0 = Date.now();
  const res = await withTimeout('offline render', Math.max(180000, SECONDS * 4000), () => page.evaluate(
    ([seconds, sampleRate, seed, mode]) =>
      window.__game.audio.renderOffline({ seconds, sampleRate, seed, mode }),
    [SECONDS, SR, SEED, MODE]), null);
  if (!res) {
    console.log(`  ${warnings.join('; ')}`);
    console.log('  nothing to analyse — rerun when the machine is less busy');
    return;
  }
  console.log(`  offline render + transfer: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const perFrameMs = await withTimeout('bench', 60000,
    () => page.evaluate(() => window.__game.audio._bench(4000)), NaN);
  const ctxState = await withTimeout('state read', 15000,
    () => page.evaluate(() => window.__game.audio.state), 'unknown');
  /* Both non-finite counters, read after everything else has run. `badWrites` is
     this system refusing to put a NaN into a parameter; `badInput` is another
     system handing it a NaN position in the first place. They are separate
     because the fix for each lives somewhere different, and a run that silently
     recovers from the second is exactly how it would stop being investigated. */
  const nonFinite = await withTimeout('non-finite counters', 15000,
    () => page.evaluate(() => {
      const a = window.__game.audio;
      return { writes: a.badWrites, input: a.badInput };
    }), null);

  /* The contract check calls __game.probe(), which renders the scene twice on
     a software rasteriser and costs minutes. Worth it on a real measurement
     run, not worth it while iterating on a filter cutoff. */
  const contract = has('fast') ? null : await withTimeout('contract check', 420000, () => page.evaluate(() => {
    const g = window.__game, a = g.audio;
    const missing = ['renderer', 'fps', 'begin', 'setPaused', 'renderOnce', 'walkTo',
      'lookAt', 'info', 'probe'].filter(k => g[k] === undefined);
    let wrote = false;
    try { a.wind.gust = 999; wrote = a.wind.gust === 999; } catch (e) { wrote = false; }
    let threw = null;
    try {
      a.gust(0.9); a.gust(0.6, 0.95); a.coyote(); a.wren(); a.raven();
      a.setEnabled(false); a.setEnabled(true);
    } catch (e) { threw = String(e); }
    g.walkTo(46); g.lookAt(0, 0);
    const before = JSON.stringify(g.probe());
    g.walkTo(0); g.lookAt(90, -20);
    g.walkTo(46); g.lookAt(0, 0);
    return {
      missing, windWritable: wrote, threw,
      gustsAhead: a.gusts(a.time, a.time + 120).length,
      probeStable: before === JSON.stringify(g.probe()),
    };
  }), null);

  const a = analyse(decode(res), res.sampleRate, res);

  /* Named per duration so a long exploratory run cannot clobber the 120 s
     reference the critic works from; the unsuffixed name is still written for
     the canonical length.
     And per mode, because the two soundscapes are the comparison: with a shared
     name a full-mode run silently overwrote the plain-mode picture, so whichever
     ran second was the only one on disk and the pair could not be looked at
     side by side. */
  const specFile = path.join(shotsDir,
    `${tag}_spectrogram_${MODE}_${SECONDS}s.png`);
  const marks = (res.calls || []).map(c => ({
    t: c.t, c: c.kind === 'coyote' ? [120, 230, 255]
      : c.kind === 'wren' ? [150, 255, 170] : [255, 160, 200],
  }));
  const dims = spectrogram(a, specFile, marks.length ? marks
    : (res.coyotes || []).map(t => ({ t, c: [120, 230, 255] })));
  if (SECONDS === 120) {
    fs.copyFileSync(specFile, path.join(shotsDir, `${tag}_spectrogram.png`));
  }

  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };
  const T = a.thresholds;
  const hz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : `${f}`);
  const bandName = a.bandEdges.slice(0, -1).map((f, i) => `${hz(f)}-${hz(a.bandEdges[i + 1])}`);
  const truePeak = Math.max(res.peakL, res.peakR);

  say('');
  say(`── level ───────────────────────────────────────────────`);
  say(`  soundscape      ${res.mode || 'unknown'}` +
      (res.mode === 'plain'
        ? '   (warm and continuous: wind, insects, songbirds, boots)'
        : res.mode === 'full'
          ? '   (the earlier sparse one: coyote, edge tones, long silences)' : ''));
  say(`  duration        ${f2(a.seconds)} s @ ${a.sampleRate} Hz   (context: ${ctxState})`);
  say(`  true peak       ${f2(db(truePeak))} dBFS   (L ${f2(db(res.peakL))}, R ${f2(db(res.peakR))})`);
  say(`  mono-sum peak   ${f2(a.peakMono)} dBFS   RMS ${f2(a.rmsMono)} dBFS   crest ${f2(a.crest)} dB`);
  say(`  L/R imbalance   ${f2(db(res.peakL) - db(res.peakR))} dB on peak, ` +
      `${f2(db(res.rmsL) - db(res.rmsR))} dB on RMS`);
  say(`  spectral centroid ${Math.round(a.centroid)} Hz`);
  say('');
  say(`── full-take band RMS (dominated by the loud 15%) ──────`);
  a.bandRms.forEach((v, i) => say(`  ${bandName[i].padEnd(9)} ${f2(v).padStart(8)}`));
  say('');
  say(`── bed spectrum (median bin level, quiet frames only) ──`);
  say(`  ${a.quietFrames} of ${a.spec.frames} frames qualified as bed`);
  a.bedSpec.forEach(b => say(`  ${(hz(b.f) + ' Hz').padEnd(9)} ${f2(b.db).padStart(8)} dB`));
  if (a.bedFloorPct) {
    say(`  6-12 kHz bed bins at or below: ` + a.bedFloorPct.levels
      .map((l, i) => `${l} dB ${f1(a.bedFloorPct.pct[i])}%`).join(',  '));
    say(`  (-102 dB is the readable floor of the plotted colour ramp; the numbers ` +
        `above it are not floored)`);
  }
  say('');
  const corrSummary = (m, label) => {
    say(`  ${label}`);
    say(`        ${a.corrBands.map(f => hz(f).padStart(6)).join('')}`);
    m.forEach((row, i) => say(
      `  ${hz(a.corrBands[i]).padStart(5)} ${row.map(v => v.toFixed(2).padStart(6)).join('')}`));
    const n = a.corrBands.length;
    const adj = [], far = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      (j - i === 1 ? adj : j - i >= 5 ? far : []).push(m[i][j]);
    }
    const mean = (v) => v.reduce((p, q) => p + q, 0) / (v.length || 1);
    say(`  adjacent bands r=${f2(mean(adj))}   >=5 bands apart r=${f2(mean(far))}   ` +
        `30Hz-2kHz r=${f2(m[0][6])}`);
  };
  say(`── inter-band envelope correlation ─────────────────────`);
  corrSummary(a.corr, 'whole take (weather, footsteps and animals together)');
  say('');
  corrSummary(a.corrStill, 'standing still only — this is the wind bed on its own');
  if (a.corrWalk) {
    corrSummary(a.corrWalk, 'walking only — the boots, which are broadband by nature');
    say(`  the full-take figure falling and then rising again at the widest band ` +
        `separation is the boots, not a shared gain: the rise is in the walking ` +
        `half and absent from the standing-still half`);
  }
  say('');
  say(`── the quiet ───────────────────────────────────────────`);
  say(`  threshold   % samples   % 50ms windows   % windows, standing still`);
  T.forEach((t, i) => say(
    `  below ${String(t).padStart(3)} dBFS ${a.belowSamplePct[i].toFixed(1).padStart(8)}%` +
    `${a.belowWinPct[i].toFixed(1).padStart(12)}%` +
    `${a.stillBelowWinPct ? a.stillBelowWinPct[i].toFixed(1).padStart(20) + '%' : ''}`));
  const p = a.winPercentiles, q = a.stillPercentiles;
  say(`  all windows      p5 ${f2(p.p5)}  p50 ${f2(p.p50)}  p90 ${f2(p.p90)}  p99 ${f2(p.p99)}  max ${f2(p.max)}`);
  if (q) say(`  standing still   p5 ${f2(q.p5)}  p50 ${f2(q.p50)}  p90 ${f2(q.p90)}  p99 ${f2(q.p99)}  max ${f2(q.max)}` +
             `   (${a.stillWindows}/${a.totalWindows} windows)`);
  say(`  bed level (p20 of 20 ms) ${f2(a.bed)} dBFS; event threshold ${f2(a.thr)} dBFS`);
  say('');
  /* ── continuity ──
     The headline for the warm soundscape, and the one section written from the
     opposite premise to everything above it.
     "The quiet" measures how much of the timeline is near-silent, and it was
     built when that was the goal. It is now the failure mode: emptiness is what
     made this read as unsettling, because a rare event arriving out of nothing
     is how dread is constructed whatever the event is. So the numbers that
     matter are how much of the time something is sounding, how often, and how
     far above the bed events sit — the last one being the startle measure. A
     soundscape where events tower over the bed startles; one where they lean out
     of it does not. */
  const cont = a.continuity;
  say(`── continuity ──────────────────────────────────────────`);
  say(`  audible at all      ${f1(cont.abovePct)}% of 50 ms windows clear -45 dBFS, ` +
      `${f1(cont.above55Pct)}% clear -55 dBFS`);
  say(`  something sounding  ${f1(cont.activePct)}% of the timeline is within a ` +
      `discrete event, not only bed`);
  say(`  longest bed-only    ${f2(cont.longestGap)}s   (median gap between events ` +
      `${f2(cont.medianGap)}s)`);
  say(`  startle margin      p99 stands ${f2(cont.startle)} dB over the median ` +
      `window; under about 15 dB nothing arrives out of nowhere`);
  say(`  event density       ${f1(cont.perMin)} discrete events per minute, of which ` +
      `${f1(cont.callsPerMin)} are voices`);
  /* Both counts, and then the one that actually decides it. The broadband
     detector answers "would this register as an event in a level meter", which
     is the right question for a gust and the wrong one for a bird: it lost calls
     that had just been made louder, because raising the insect bed raised its
     threshold faster than a narrowband chirp moves a broadband window. The
     per-band figure below is the one to read. */
  if (res.calls) {
    const sched = 60 * res.calls.length / a.seconds;
    say(`  voices scheduled    ${f1(sched)} per minute, of which ${f1(cont.bbCallsPerMin)} ` +
        `also clear the broadband event threshold`);
  }
  if (a.audibility) {
    const ad = a.audibility;
    say(`  voices over the bed ${f1(ad.median)} dB median in the call's own band ` +
        `(p10 ${f1(ad.p10)}, range ${f1(ad.min)} to ${f1(ad.max)})`);
    say(`                      ${f1(ad.clearPct)}% of ${ad.n} calls clear the bed by 8 dB ` +
        `where it matters — this and not the broadband count is whether a bird is audible`);
    if (ad.clearPct < 90) {
      say(`                      quietest: ` + ad.quietest
        .map(q => `${q.kind}@${f2(q.t)}s ${f1(q.over)} dB at ${Math.round(q.hz)} Hz`).join(', '));
    }
  }
  say('');
  say(`── events ──────────────────────────────────────────────`);
  say(`  ${a.events.length} discrete events above the bed: ` +
      `${a.windEvents.length} weather, ${a.callEvents.length} animal, ` +
      `${a.events.length - a.windEvents.length - a.callEvents.length} footfall`);
  if (a.gapStats) {
    say(`  weather event spacing  min ${f2(a.gapStats.min)}s  median ${f2(a.gapStats.median)}s  ` +
        `max ${f2(a.gapStats.max)}s`);
  }
  say(`  scheduler: ${res.gusts.length} gusts ` +
      res.gusts.map(g => `${g.t}s/${f2(g.dur)}s peak ${f2(g.peak)} char ${f2(g.char)}`).join('; '));
  say(`             ${res.calls ? res.calls.map(c => `${c.kind}@${c.t}s`).join(' ') || 'no fauna'
    : `${(res.coyotes || []).length} coyote`}`);
  for (const e of a.windEvents.concat(a.callEvents).sort((p, q) => p.t - q.t).slice(0, 24)) {
    say(`    ${e.kind.padEnd(7)} t=${e.t.toFixed(2).padStart(7)}s  dur ${e.dur.toFixed(2).padStart(5)}s  ` +
        `peak ${f2(e.peak).padStart(7)} dBFS  centroid ${String(Math.round(e.centroid)).padStart(5)} Hz`);
  }
  say('');
  say(`── recurring narrow peaks (rock-edge resonance check) ──`);
  say(`  ${a.loudFrames} loud frames searched; detector noise ${f2(a.promNoise)} dB, ` +
      `so the bar is ${f2(a.promBar)} dB over third-octave smoothing`);
  say(`  a real edge tone is loud in gusts and gone in the bed; equal in both is a leak`);
  if (!a.loudFrames) {
    say(`  nothing to search: no gust in this take was loud enough to clear the bed ` +
        `by 8 dB while the player was still and nothing was calling. The ` +
        `forced-voice render below cues a strong gust on purpose and measures ` +
        `the tones there.`);
  } else if (!a.narrow.length) say(`  none: no bin cleared the bar`);
  for (const nn of a.narrow) {
    say(`  ${String(nn.hz).padStart(5)} Hz  ${f2(nn.prom)} dB in gusts, ` +
        `${f2(nn.bedProm)} dB in the bed  (median-referenced; ` +
        `${f2(nn.promMean)} dB over the mean, in ${(nn.frac * 100).toFixed(0)}% of loud frames)`);
  }
  say('');
  const fsx = a.footsteps;
  say(`── footsteps and gait ──────────────────────────────────`);
  say(`  ${fsx.inWalk} transients during ${fsx.walkSeconds}s of walking, ` +
      `${fsx.outsideWalk} during the ${(a.seconds - fsx.walkSeconds).toFixed(0)}s standing still`);
  if (fsx.outsideWalk) {
    const s = fsx.stillSrc;
    /* Attributed rather than judged. Naming the times makes an unattributed
       transient checkable, which matters because the accounting pads each gust
       and call by a second or two and anything landing just outside a pad is a
       boundary artefact rather than a leak. A leak worth chasing shows up as a
       run of them, not as one. */
    say(`  of those ${fsx.outsideWalk}: ${s.gust} inside a gust (sand), ` +
        `${s.call} inside a call, ${s.unexplained} unattributed` +
        (s.at && s.at.length ? ` (at ${s.at.join('s, ')}s)` : ''));
  }
  if (fsx.level) {
    say(`  step level    min ${f2(fsx.level.min)}  median ${f2(fsx.level.median)}  ` +
        `max ${f2(fsx.level.max)} dBFS  (spread ${f2(fsx.level.spread)} dB)`);
    say(`  vs bed        ${f2(fsx.level.median - a.bed)} dB above the bed`);
    if (fsx.gustClean != null && fsx.gustClean > a.bed + 6) {
      say(`  vs wind       ${f2(fsx.level.median - fsx.gustClean)} dB relative to the ` +
          `loudest gust (${f2(fsx.gustClean)} dBFS, over the scheduled gust ` +
          `windows, clear of the walking and the fauna)`);
    } else {
      /* Say so rather than printing a number. Every gust in this take overlaps
         either the walking or a call, so once both are excised what is left of
         the gust windows is the bed, and the difference against it would look
         like an enormous margin earned by the footsteps. See the forced-voice
         render below, where the two fire in isolation. */
      say(`  vs wind       not measurable in this take: every scheduled gust ` +
          `overlaps the walking or a call`);
    }
  }
  if (fsx.gait) {
    const g = fsx.gait;
    say(`  detected      mean ${f2(g.mean)}s  sd ${(g.sd * 1000).toFixed(1)}ms  CV ${f1(g.cv)}%` +
        `  (robust, IQR-based: ${(g.sdRobust * 1000).toFixed(1)}ms, CV ${f1(g.cvRobust)}%)` +
        `  L/R asymmetry ${f1(g.asymmetryMs)}ms`);
  }
  /* The scheduler's own step times, when the build reports them. A detector
     working on an 8 ms envelope places a scuff's onset tens of milliseconds
     late, so the detected spread is an upper bound on the gait's spread and
     cannot be used to tune it. */
  const sg = res.steps && res.steps.length > 8 ? gait(res.steps) : null;
  if (sg) {
    say(`  scheduled     mean ${f2(sg.mean)}s  sd ${(sg.sd * 1000).toFixed(1)}ms  ` +
        `CV ${f1(sg.cv)}%  L/R asymmetry ${f1(sg.asymmetryMs)}ms  ` +
        `(${res.steps.filter(s => s.scuff).length} of ${res.steps.length} scuffs)`);
    /* Where the two disagree, and why. The detected spread is much the larger
       number and it is tempting to read it as the real one, but the detector
       works on an 8 ms envelope of a band-limited signal and the scheduler knows
       the answer, so any gap between them is instrument error. Matching them one
       to one says which it is: a run of small offsets is placement error, and a
       pile of unmatched detections is the detector inventing steps. */
    const sched = res.steps.map(s => s.t).sort((p, q) => p - q);
    const det = (a.footsteps.times || []).slice();
    const offs = [], spurious = [];
    const taken = new Set();
    for (const d of det) {
      let bi = -1, bd = 1e9;
      for (let i = 0; i < sched.length; i++) {
        const dd = Math.abs(sched[i] - d);
        if (dd < bd && !taken.has(i)) { bd = dd; bi = i; }
      }
      if (bi >= 0 && bd < 0.20) { taken.add(bi); offs.push((d - sched[bi]) * 1000); }
      else spurious.push(+d.toFixed(2));
    }
    if (offs.length) {
      const abs = offs.map(Math.abs).sort((p, q) => p - q);
      say(`  agreement     ${offs.length} of ${det.length} detections matched a ` +
          `scheduled step; median placement error ${f1(abs[abs.length >> 1])} ms, ` +
          `p90 ${f1(abs[Math.floor(abs.length * 0.9)])} ms`);
      say(`                ${sched.length - taken.size} scheduled steps missed, ` +
          `${spurious.length} detections with no step behind them` +
          (spurious.length && spurious.length <= 8 ? ` (at ${spurious.join('s, ')}s)` : ''));
    }
  }
  if (fsx.gait) {
    say(`  comb          ${(sg || fsx.gait).comb.join(' ')}`);
    say(`  survives      ${(sg || fsx.gait).combSurvives} strides above r=0.2` +
        `   (detected train: ${fsx.gait.combSurvives})`);
  }
  if (fsx.decay) {
    const d = fsx.decay;
    say('');
    say(`  what the step leaves behind — mean of ${d.steps} isolated steps, ` +
        `above 300 Hz, each normalised to its own peak:`);
    say(`    ` + [30, 60, 90, 110, 130, 150, 180, 200, 230, 260, 300, 330]
      .map(ms => `${ms}ms ${f1(d.at(ms))}`).join('  '));
    say(`    local background ${f1(d.background)} dB below the step; the trace ` +
        `stands clear of it out to ${d.lastAboveMs} ms`);
    say(`    returns expected at 76, 91, 111, 128, 152, 181, 204 and 262 ms — ` +
        `banks, terrace, boulders and a butte face at 13 to 45 m`);
  }
  say('');
  say(`── hygiene ─────────────────────────────────────────────`);
  say(`  clipped samples      ${res.clipped}`);
  say(`  DC offset            L ${res.dcL.toExponential(2)}  R ${res.dcR.toExponential(2)}`);
  say(`  longest true silence ${f1(a.longestSilentMs)} ms`);
  say(`  main-thread cost     ${Number.isFinite(perFrameMs) ? perFrameMs.toFixed(4) : 'n/a'} ms per update() call`);
  if (nonFinite) {
    say(`  non-finite writes    ${nonFinite.writes} refused` +
        (nonFinite.writes ? '   ← was throwing from _scheduleWind every frame' : '   (was every frame)'));
    say(`  non-finite positions ${nonFinite.input} handed in by the player` +
        (nonFinite.input ? '   ← the origin is upstream of audio.js' : ''));
  }
  if (contract) {
    say('');
    say(`── contract ────────────────────────────────────────────`);
    say(`  __game keys missing  ${contract.missing.length ? contract.missing.join(', ') : 'none'}`);
    say(`  wind writable        ${contract.windWritable}   (must be false)`);
    say(`  gust()/coyote()      ${contract.threw || 'ok'}`);
    say(`  gusts() next 120 s   ${contract.gustsAhead}`);
    say(`  walkTo/lookAt stable ${contract.probeStable}`);
  }
  say('');
  say(`  spectrogram → shots/${path.basename(specFile)}  (${dims.W}x${dims.H})`);

  const out = {
    seconds: a.seconds, sampleRate: a.sampleRate, mode: res.mode,
    seed: SEED === undefined ? 'default' : SEED,
    truePeak: db(truePeak), peakL: db(res.peakL), peakR: db(res.peakR),
    monoPeak: a.peakMono, monoRms: a.rmsMono, crest: a.crest, centroid: a.centroid,
    fullTakeBands: Object.fromEntries(bandName.map((n, i) => [n, a.bandRms[i]])),
    bedSpectrum: Object.fromEntries(a.bedSpec.map(b => [b.f, b.db])),
    bedFloorPct: a.bedFloorPct,
    corrBands: a.corrBands, corr: a.corr, corrStill: a.corrStill,
    belowSamplePct: Object.fromEntries(T.map((t, i) => [t, a.belowSamplePct[i]])),
    belowWinPct: Object.fromEntries(T.map((t, i) => [t, a.belowWinPct[i]])),
    stillBelowWinPct: a.stillBelowWinPct
      ? Object.fromEntries(T.map((t, i) => [t, a.stillBelowWinPct[i]])) : null,
    winPercentiles: a.winPercentiles, stillPercentiles: a.stillPercentiles,
    bed: a.bed, events: a.events, gapStats: a.gapStats, continuity: a.continuity,
    audibility: a.audibility,
    narrow: a.narrow, loudFrames: a.loudFrames,
    footsteps: a.footsteps, scheduledGait: sg,
    gusts: res.gusts, calls: res.calls || res.coyotes,
    clipped: res.clipped, dcL: res.dcL, dcR: res.dcR,
    longestSilentMs: a.longestSilentMs, perFrameMs, contract,
    pageErrors: [...new Set(errs)],
  };

  /* ── forced-event render ──
     The rare voices are rare on purpose, so waiting for one is not a
     measurement strategy. This renders a short take in which each is cued at a
     known time and measures the things only a close look can see: harmonic
     structure, pitch trajectory, and whether the reverb has discrete arrivals
     or a smooth cathedral tail. */
  if (VOICES) {
    const supported = await page.evaluate(() => typeof window.__game.audio.renderVoices === 'function');
    if (!supported) {
      say('  --voices: this build has no renderVoices(); skipped');
    } else await (async () => {
      console.log('  rendering forced-voice take …');
      const vr = await withTimeout('forced-voice render', 300000, () => page.evaluate(
        ([sampleRate, seed, mode]) =>
          window.__game.audio.renderVoices({ sampleRate, seed, mode }),
        [SR, SEED, MODE]), null);
      if (!vr) { say('  --voices: render timed out; skipped'); return; }
      const vx = decode(vr);
      const va = analyse(vx, vr.sampleRate, vr);
      const vfile = path.join(shotsDir, `${tag}_voices.png`);
      spectrogram(va, vfile, vr.cues.map(c => ({
        t: c.t, c: c.kind === 'coyote' ? [120, 230, 255]
          : c.kind === 'wren' ? [150, 255, 170]
            : c.kind === 'raven' ? [255, 160, 200] : [200, 200, 210],
      })));
      /* Peak 30 ms level in the window after each cue, so the balance between
         the rare voices can be read off directly rather than inferred from
         whichever of them happened to trip the event detector. */
      const cueLevel = (t0, span) => {
        const W = Math.round(0.03 * vr.sampleRate);
        let best = -200;
        for (let w = Math.round(t0 * vr.sampleRate / W);
          (w + 1) * W < vx.length && w * W < (t0 + span) * vr.sampleRate; w++) {
          let s = 0;
          for (let i = w * W; i < (w + 1) * W; i++) s += vx[i] * vx[i];
          best = Math.max(best, db(Math.sqrt(s / W)));
        }
        return best;
      };
      say('');
      say(`── forced voices ───────────────────────────────────────`);
      const cueDb = {};
      for (const c of vr.cues) {
        const lv = cueLevel(c.t, c.kind.startsWith('gust') ? 12 : 6);
        if (cueDb[c.kind] == null || lv > cueDb[c.kind]) cueDb[c.kind] = lv;
        say(`  ${c.kind.padEnd(12)} cued ${f2(c.t).padStart(6)}s  ` +
            `peak30ms ${f2(lv).padStart(7)} dBFS  ${c.note || ''}`);
      }
      /* The perspective question, answered where it can be answered cleanly.
         On a two-minute take every scheduled gust tends to overlap either the
         walking or an animal, so the main render often has nothing left to
         compare; here each cue fires alone by construction. */
      const gustCue = Math.max(cueDb['gust-rumble'] ?? -200, cueDb['gust-hiss'] ?? -200);
      if (cueDb.walk != null && gustCue > -200) {
        const d = cueDb.walk - gustCue;
        say(`  perspective: boots lead the strongest forced gust by ${f2(d)} dB ` +
            `(${d > 0 ? 'correct for a first-person walk' : 'inverted'})`);
        out.perspectiveDb = +d.toFixed(2);
      }
      out.voices = { cues: vr.cues, measures: {} };
      for (const c of vr.cues) {
        if (c.measure === 'harmonics') {
          const h = harmonics(vx, vr.sampleRate, c.t + (c.offset || 0), c.t + (c.offset || 0) + 0.34,
            c.f0lo || 300, c.f0hi || 900);
          if (h) {
            say(`  ${c.kind} harmonics: f0 ${f1(h.f0)} Hz, strongest h${h.strongest}, ` +
                `${h.within20} partials within 20 dB`);
            say(`    ${h.rel.map(v => `h${v.h} ${v.rel}`).join('  ')}`);
            out.voices.measures[c.kind + '_harmonics'] = h;
          }
        }
        if (c.measure === 'pitch') {
          const pt = pitchTrack(vx, vr.sampleRate, c.t + (c.offset || 0), c.span || 2.5,
            c.f0lo || 250, c.f0hi || 900, c.harmonic || 1);
          if (pt) {
            say(`  ${c.kind} (tracked on h${pt.harmonic}, quoted as the fundamental): ` +
                `${f1(pt.start)} Hz in, peak ${f1(pt.peak)}, ` +
                `out at ${f1(pt.end)} — glissando ${f1(pt.fallPct)}% down across the sustain ` +
                `(real coyote 15-40%)`);
            say(`    vibrato ${f1(pt.vibHz)} Hz at ${f2(pt.vibDepthPct)}% peak depth ` +
                `(${f2(pt.vibRmsPct)}% RMS; real coyote 4-8 Hz, 3-8%), range ` +
                `${f1(pt.lo)}-${f1(pt.hi)} Hz over ${pt.frames} voiced frames`);
            say(`    the fitted waver accounts for ${f2(pt.vibFit)} of the residual ` +
                `amplitude; the rest is glissando curvature and tracker jitter`);
            out.voices.measures[c.kind] = pt;
          } else {
            say(`  ${c.kind}: not enough voiced frames to track`);
          }
        }
        if (c.measure === 'peaks' && c.peaks) {
          const pp = peakProminence(vx, vr.sampleRate, c.t + (c.offset || 0), c.span || 4, c.peaks);
          say(`  rock-edge tones during ${c.kind} (p90 of per-frame prominence, ` +
              `median in brackets):`);
          /* And where the tone went. An aeolian tone's frequency is the flow
             velocity over the size of the lip, so across a gust that swings
             twenty decibels it has to sweep — a tone that sits still is a fixed
             filter, not an edge. Tracked over the loudest tenth of the frames
             only, because between gusts there is no tone to track and the
             tracker would just report the width of its own search band. */
          for (const v of pp) {
            const gl = peakGlide(vx, vr.sampleRate, c.t + (c.offset || 0), c.span || 4, v.f);
            say(`    ${String(v.f).padStart(5)} Hz  +${f1(v.prom)} dB  ` +
                `[${f1(v.promMedian)}]  peak bin ${f1(v.peakDb)} dBFS` +
                (gl ? `  swept ${f1(gl.lo)}-${f1(gl.hi)} Hz, ${f1(gl.semitones)} semitones` : ''));
            if (gl) v.glide = gl;
          }
          out.voices.measures[c.kind + '_peaks'] = pp;
        }
        if (c.measure === 'tail') {
          /* Band-limited to where the animal is, and measured against the bed
             in that same band, so the wind cannot masquerade as a reverb tail. */
          const vb = bandpass(vx, vr.sampleRate, c.band || 700, 0.8);
          const at = c.t + (c.offset || 0);
          const W = Math.round(0.02 * vr.sampleRate);
          const quietWins = [];
          /* Measured *before* the cue, not after. The window after it ran into
             the next cue — the wren, four seconds of it — and put the band floor
             thirty decibels high, at which point the gate sat above every
             reflection and the tail measured as zero arrivals. The lead-in to a
             cue is quiet by construction. */
          for (let w = Math.round((c.t - 5) * vr.sampleRate / W);
            w < Math.round((c.t - 1.5) * vr.sampleRate / W) && (w + 1) * W < vb.length; w++) {
            let s = 0;
            for (let i = w * W; i < (w + 1) * W; i++) s += vb[i] * vb[i];
            quietWins.push(db(Math.sqrt(s / W)));
          }
          const floor = quietWins.length ? median(quietWins) : -90;
          const ar = arrivals(vb, vr.sampleRate, at, at + 3.4, floor);
          /* Direct against first reflection. At half a kilometre across open
             desert there is a direct path and it arrives first and loudest;
             a fully-wet routing gets this backwards.
             The direct level is the loudest window inside the howl, found by
             looking. Running the arrival detector over it instead was a category
             error: that detector wants local maxima standing clear of their
             neighbours, and a sustained howl has none, so it returned whatever
             small bump it could find and the ratio came out a decibel when it
             should have been ten. */
          const dFrom = c.t + (c.directFrom != null ? c.directFrom : -1.2 + (c.offset || 0));
          const dTo = c.t + (c.directTo != null ? c.directTo : (c.offset || 0));
          let dLvl = -200;
          for (let w = Math.round(dFrom * vr.sampleRate / W);
            w < Math.round(dTo * vr.sampleRate / W) && (w + 1) * W < vb.length; w++) {
            let s = 0;
            for (let i = w * W; i < (w + 1) * W; i++) s += vb[i] * vb[i];
            dLvl = Math.max(dLvl, db(Math.sqrt(s / W)));
          }
          const rLvl = ar.peaks.length ? Math.max(...ar.peaks.map(p => p.db)) : -200;
          say(`  tail after ${c.kind}: audible for ${f2(ar.audibleTail)} s, ` +
              `RT60 ${f2(ar.rt60)} s, ${ar.peaks.length} discrete arrivals ` +
              `(band floor ${f1(floor)} dBFS)`);
          if (dLvl > -200 && rLvl > -200) {
            say(`    direct path ${f1(dLvl)} dBFS, loudest reflection ${f1(rLvl)} dBFS ` +
                `→ direct leads by ${f1(dLvl - rLvl)} dB`);
            /* What geometry allows, printed next to what was measured, because
               the two are easy to confuse and the confusion cuts both ways.
               For a source half a kilometre out the direct and reflected paths
               are nearly the same length, so the reflection is only a few
               decibels down — this is the one case where a loud slap is
               physical. For a source at your feet it is not: a boot's own
               reflection off a wall D away travels 2D against a direct path of
               about 1.6 m, which is thirty decibels or more. */
            const extra = 240, src = 500;
            const geo = 20 * Math.log10((src + extra) / src) + 1.8 + extra * 0.006;
            say(`    geometry for a source ${src} m out with a reflector adding ` +
                `${extra} m of path: ${f1(geo)} dB of spreading, reflection and ` +
                `absorption. A footstep is the opposite case — see the step decay above.`);
          }
          const ref = c.ref || 0;
          for (const pk of ar.peaks.slice(0, 8)) {
            say(`    arrival at +${f2(pk.t - at + ref)}s after the direct sound  ` +
                `${f1(pk.db)} dBFS  prom ${f1(pk.prom)} dB`);
          }
          out.voices.measures[c.kind + '_tail'] = ar;
        }
      }
      say(`  spectrogram → shots/${path.basename(vfile)}`);
    })();
  }

  if (warnings.length) {
    say('');
    say(`── warnings ────────────────────────────────────────────`);
    for (const w of warnings) say(`  ${w}`);
    out.warnings = warnings;
  }

  fs.writeFileSync(path.join(shotsDir, `${tag}_audio.json`), JSON.stringify(out, null, 2));
});
