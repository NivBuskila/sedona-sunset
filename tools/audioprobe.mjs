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
  const out = [];
  let last = -1e9, acc = 0;
  for (let w = 0; w < n; w++) {
    if (w >= K) {
      const mean = acc / K;
      const rise = db(e[w]) - db(mean);
      const t = w * W / sr;
      if (rise > riseDb && e[w] > e[w - 1] && (w + 1 >= n || e[w] >= e[w + 1]) && t - last > minGap) {
        last = t;
        out.push({ t, peak: db(e[w]), rise });
      }
      acc -= e[w - K];
    }
    acc += e[w];
  }
  return out;
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
    const hit = steps.some(s => s.t >= e.t - 0.05 && s.t <= e.t + e.dur + 0.05);
    const call = calls.find(c => c.t >= e.t - 3 && c.t <= e.t + e.dur + 1);
    e.kind = call ? call.kind : (hit && e.dur < 0.6) ? 'step' : 'wind';
  }
  const windEvs = evs.filter(e => e.kind === 'wind');
  const callEvs = evs.filter(e => e.kind !== 'wind' && e.kind !== 'step');
  const gaps = [];
  for (let i = 1; i < windEvs.length; i++) {
    gaps.push(windEvs[i].t - (windEvs[i - 1].t + windEvs[i - 1].dur));
  }
  gaps.sort((a, b) => a - b);
  const stepLv = stepsIn.map(s => s.peak).sort((a, b) => a - b);
  const walkSeconds = segs.reduce((s, [, d]) => s + d, 0);

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
  // How much of the top octave is sitting at the display floor of the PNG.
  const floorBins = (() => {
    const b0 = Math.max(1, Math.round(6000 * S.N / sr));
    const b1 = Math.min(S.bins - 1, Math.round(Math.min(12000, sr / 2 - 1) * S.N / sr));
    if (b1 <= b0 || !quiet.length) return NaN;
    let at = 0, tot = 0;
    for (const f of quiet) {
      for (let k = b0; k <= b1; k++) {
        tot++;
        if (db(Math.sqrt(S.power[f * S.bins + k] / 2)) <= -108) at++;
      }
    }
    return 100 * at / tot;
  })();

  /* ── inter-band envelope correlation ──
     The headline diagnostic. One noise source under one gain node gives a flat
     matrix; a physical process must decorrelate as the bands separate. */
  const envs = CORR_BANDS.map(fc => bandSeries(S, sr, fc));
  const corr = envs.map(a => envs.map(b => +pearson(a, b).toFixed(2)));

  /* ── recurring narrow peaks ──
     The rock-edge resonances are only real if they can be found: bins standing
     more than 1.5 dB above a third-octave smoothing of their own spectrum, in
     the same place, in a decent fraction of the loud frames. */
  const loud = [];
  for (let f = 0; f < S.frames; f++) {
    const t = (f * S.hop + S.N / 2) / sr;
    const ew = Math.min(ewins - 1, Math.floor(t / (EW / sr)));
    if (em[ew] > bed + 8) loud.push(f);
  }
  const promHits = new Float64Array(S.bins);
  const promAmt = new Float64Array(S.bins);
  for (const f of loud) {
    for (let k = 4; k < S.bins - 4; k++) {
      const hz = k * sr / S.N;
      if (hz < 300 || hz > 8000) continue;
      const w = Math.max(2, Math.round(k * 0.12));
      let sm = 0, c = 0;
      for (let j = Math.max(1, k - w); j <= Math.min(S.bins - 1, k + w); j++) {
        sm += S.power[f * S.bins + j]; c++;
      }
      const p = 10 * Math.log10(Math.max(S.power[f * S.bins + k], 1e-24) / Math.max(sm / c, 1e-24));
      if (p > 1.5) { promHits[k]++; promAmt[k] += p; }
    }
  }
  /* The bar is 45% of loud frames, not 25%. Filtered noise crosses a 1.5 dB
     prominence in roughly a quarter of frames at any bin purely by chance, so
     a 25% threshold reports the noise floor as a resonance — which is what a
     scattered list of "peaks" all sitting at 25-29% actually was. */
  const narrow = [];
  for (let k = 0; k < S.bins; k++) {
    if (loud.length && promHits[k] / loud.length > 0.45) {
      narrow.push({ hz: Math.round(k * sr / S.N), frac: promHits[k] / loud.length, prom: promAmt[k] / promHits[k] });
    }
  }
  narrow.sort((a, b) => b.prom - a.prom);

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
    footsteps: {
      inWalk: stepsIn.length, outsideWalk: stepsOut.length, walkSeconds,
      level: stepLv.length
        ? { min: stepLv[0], median: stepLv[stepLv.length >> 1], max: stepLv[stepLv.length - 1],
            spread: stepLv[stepLv.length - 1] - stepLv[0] } : null,
      gait: gait(stepsIn),
    },
    bedSpec, bedFloorPct: floorBins, quietFrames: quiet.length,
    corrBands: CORR_BANDS, corr, narrow: narrow.slice(0, 8),
    winLevel: wl, spec: S, meta,
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
    let sum = 0;
    for (let fr = 0; fr < S.frames; fr++) {
      let peakP = 0;
      for (let j = Math.max(1, k - 2); j <= Math.min(S.bins - 1, k + 2); j++) {
        peakP = Math.max(peakP, S.power[fr * S.bins + j]);
      }
      let sm = 0, c = 0;
      for (let j = Math.max(1, k - w); j <= Math.min(S.bins - 1, k + w); j++) {
        sm += S.power[fr * S.bins + j]; c++;
      }
      sum += 10 * Math.log10(Math.max(peakP, 1e-24) / Math.max(sm / c, 1e-24));
    }
    return { f, prom: sum / S.frames };
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
function arrivals(x, sr, t0, t1, floorDb) {
  const W = Math.round(0.02 * sr);
  const a = Math.round(t0 * sr / W), b = Math.round(t1 * sr / W);
  const e = [];
  for (let w = a; w < b; w++) {
    let s = 0;
    for (let i = w * W; i < (w + 1) * W && i < x.length; i++) s += x[i] * x[i];
    e.push(db(Math.sqrt(s / W)));
  }
  const gate = floorDb + 4;
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

const DB_LO = -108, DB_HI = -26;

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
  for (const d of [-100, -80, -60, -40, -30]) {
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

await run({ width: 640, height: 360 }, async ({ page, errs }) => {
  page.setDefaultTimeout(0);
  await page.waitForTimeout(1500);

  const ok = await page.evaluate(() =>
    !!(window.__game && window.__game.audio && window.__game.audio.available));
  if (!ok) throw new Error('window.__game.audio is not available');

  console.log(`  rendering ${SECONDS}s offline at ${SR} Hz …`);
  const t0 = Date.now();
  const res = await page.evaluate(
    ([seconds, sampleRate, seed]) => window.__game.audio.renderOffline({ seconds, sampleRate, seed }),
    [SECONDS, SR, SEED]);
  console.log(`  offline render + transfer: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const perFrameMs = await page.evaluate(() => window.__game.audio._bench(4000));
  const ctxState = await page.evaluate(() => window.__game.audio.state);

  /* The contract check calls __game.probe(), which renders the scene twice on
     a software rasteriser and costs minutes. Worth it on a real measurement
     run, not worth it while iterating on a filter cutoff. */
  const contract = has('fast') ? null : await page.evaluate(() => {
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
  });

  const a = analyse(decode(res), res.sampleRate, res);

  /* Named per duration so a long exploratory run cannot clobber the 120 s
     reference the critic works from; the unsuffixed name is still written for
     the canonical length. */
  const specFile = path.join(shotsDir, `${tag}_spectrogram_${SECONDS}s.png`);
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
  say(`  6-12 kHz bins pinned at the -108 dB display floor: ${f1(a.bedFloorPct)}%`);
  say('');
  say(`── inter-band envelope correlation ─────────────────────`);
  say(`        ${a.corrBands.map(f => hz(f).padStart(6)).join('')}`);
  a.corr.forEach((row, i) => say(
    `  ${hz(a.corrBands[i]).padStart(5)} ${row.map(v => v.toFixed(2).padStart(6)).join('')}`));
  {
    const n = a.corrBands.length;
    const adj = [], far = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      (j - i === 1 ? adj : j - i >= 5 ? far : []).push(a.corr[i][j]);
    }
    const mean = (v) => v.reduce((p, q) => p + q, 0) / (v.length || 1);
    say(`  adjacent bands r=${f2(mean(adj))}   >=5 bands apart r=${f2(mean(far))}   ` +
        `30Hz-2kHz r=${f2(a.corr[0][6])}`);
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
  if (!a.narrow.length) say(`  none: no bin stood >1.5 dB over third-octave smoothing in >25% of loud frames`);
  for (const nn of a.narrow) {
    say(`  ${String(nn.hz).padStart(5)} Hz  prominence ${f2(nn.prom)} dB  in ${(nn.frac * 100).toFixed(0)}% of loud frames`);
  }
  say('');
  const fsx = a.footsteps;
  say(`── footsteps and gait ──────────────────────────────────`);
  say(`  ${fsx.inWalk} transients during ${fsx.walkSeconds}s of walking, ` +
      `${fsx.outsideWalk} during the ${(a.seconds - fsx.walkSeconds).toFixed(0)}s standing still`);
  if (fsx.level) {
    say(`  step level    min ${f2(fsx.level.min)}  median ${f2(fsx.level.median)}  ` +
        `max ${f2(fsx.level.max)} dBFS  (spread ${f2(fsx.level.spread)} dB)`);
    say(`  vs bed        ${f2(fsx.level.median - a.bed)} dB above the bed`);
    const gustPeak = Math.max(...a.windEvents.map(e => e.peak), -120);
    say(`  vs wind       ${f2(fsx.level.median - gustPeak)} dB relative to the loudest gust ` +
        `(${f2(gustPeak)} dBFS)`);
  }
  if (fsx.gait) {
    const g = fsx.gait;
    say(`  detected      mean ${f2(g.mean)}s  sd ${(g.sd * 1000).toFixed(1)}ms  CV ${f1(g.cv)}%` +
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
  }
  if (fsx.gait) {
    say(`  comb          ${(sg || fsx.gait).comb.join(' ')}`);
    say(`  survives      ${(sg || fsx.gait).combSurvives} strides above r=0.2` +
        `   (detected train: ${fsx.gait.combSurvives})`);
  }
  say('');
  say(`── hygiene ─────────────────────────────────────────────`);
  say(`  clipped samples      ${res.clipped}`);
  say(`  DC offset            L ${res.dcL.toExponential(2)}  R ${res.dcR.toExponential(2)}`);
  say(`  longest true silence ${f1(a.longestSilentMs)} ms`);
  say(`  main-thread cost     ${perFrameMs.toFixed(4)} ms per update() call`);
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
    seconds: a.seconds, sampleRate: a.sampleRate, seed: SEED === undefined ? 'default' : SEED,
    truePeak: db(truePeak), peakL: db(res.peakL), peakR: db(res.peakR),
    monoPeak: a.peakMono, monoRms: a.rmsMono, crest: a.crest, centroid: a.centroid,
    fullTakeBands: Object.fromEntries(bandName.map((n, i) => [n, a.bandRms[i]])),
    bedSpectrum: Object.fromEntries(a.bedSpec.map(b => [b.f, b.db])),
    bedFloorPct: a.bedFloorPct,
    corrBands: a.corrBands, corr: a.corr,
    belowSamplePct: Object.fromEntries(T.map((t, i) => [t, a.belowSamplePct[i]])),
    belowWinPct: Object.fromEntries(T.map((t, i) => [t, a.belowWinPct[i]])),
    stillBelowWinPct: a.stillBelowWinPct
      ? Object.fromEntries(T.map((t, i) => [t, a.stillBelowWinPct[i]])) : null,
    winPercentiles: a.winPercentiles, stillPercentiles: a.stillPercentiles,
    bed: a.bed, events: a.events, gapStats: a.gapStats, narrow: a.narrow,
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
    } else {
      console.log('  rendering forced-voice take …');
      const vr = await page.evaluate(([sampleRate, seed]) =>
        window.__game.audio.renderVoices({ sampleRate, seed }), [SR, SEED]);
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
      for (const c of vr.cues) {
        say(`  ${c.kind.padEnd(12)} cued ${f2(c.t).padStart(6)}s  ` +
            `peak30ms ${f2(cueLevel(c.t, c.kind.startsWith('gust') ? 12 : 6)).padStart(7)} dBFS  ` +
            `${c.note || ''}`);
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
        if (c.measure === 'peaks' && c.peaks) {
          const pp = peakProminence(vx, vr.sampleRate, c.t + (c.offset || 0), c.span || 4, c.peaks);
          say(`  rock-edge tones during ${c.kind}: ` +
              pp.map(v => `${v.f} Hz +${f1(v.prom)} dB`).join(', '));
          out.voices.measures[c.kind + '_peaks'] = pp;
        }
        if (c.measure === 'tail') {
          /* Band-limited to where the animal is, and measured against the bed
             in that same band, so the wind cannot masquerade as a reverb tail. */
          const vb = bandpass(vx, vr.sampleRate, c.band || 700, 0.8);
          const at = c.t + (c.offset || 0);
          const W = Math.round(0.02 * vr.sampleRate);
          const quietWins = [];
          for (let w = Math.round((at + 5) * vr.sampleRate / W);
            w < Math.round((at + 9) * vr.sampleRate / W) && (w + 1) * W < vb.length; w++) {
            let s = 0;
            for (let i = w * W; i < (w + 1) * W; i++) s += vb[i] * vb[i];
            quietWins.push(db(Math.sqrt(s / W)));
          }
          const floor = quietWins.length ? median(quietWins) : -90;
          const ar = arrivals(vb, vr.sampleRate, at, at + 3.4, floor);
          say(`  tail after ${c.kind}: audible for ${f2(ar.audibleTail)} s, ` +
              `RT60 ${f2(ar.rt60)} s, ${ar.peaks.length} discrete arrivals ` +
              `(band floor ${f1(floor)} dBFS)`);
          for (const pk of ar.peaks.slice(0, 8)) {
            say(`    arrival at +${f2(pk.t - at)}s  ${f1(pk.db)} dBFS  prom ${f1(pk.prom)} dB`);
          }
          out.voices.measures[c.kind + '_tail'] = ar;
        }
      }
      say(`  spectrogram → shots/${path.basename(vfile)}`);
    }
  }

  fs.writeFileSync(path.join(shotsDir, `${tag}_audio.json`), JSON.stringify(out, null, 2));
});
