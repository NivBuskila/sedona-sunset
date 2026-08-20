/* System 6 measurement.
 *
 * usage: node tools/audioprobe.mjs [tag] [--seconds 120] [--seed 1234] [--sr 24000]
 *
 * A visual critic cannot hear the soundscape and neither can the author, so the
 * only honest way to review it is to measure it. This loads the page through
 * the ordinary harness, asks it to render its *own* audio graph — the same
 * nodes, the same scheduler, the same seed — into an OfflineAudioContext, and
 * pulls the PCM back out. Offline rendering is both far faster than real time
 * and exactly deterministic, so a two-minute soundscape is measured in a few
 * seconds and two runs of the same build give identical numbers.
 *
 * What comes out: level statistics overall and per band, the distribution of
 * level over time (which is how "the quiet is the feature" stops being an
 * assertion and becomes a number), discrete event detection with timings and
 * spacing, spectral centroid, and the hygiene checks — clipping, DC offset,
 * and stretches of true digital silence. Plus a spectrogram PNG so the whole
 * two minutes can be looked at in one glance.
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
const SECONDS = Number(getf('seconds', 120));
const SR = Number(getf('sr', 24000));
const SEED = getf('seed', '') === '' ? undefined : Number(getf('seed'));

const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

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

/** Short-time magnitude spectra. Returns power per bin, already normalised. */
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

/* ── analysis ──────────────────────────────────────────────────────────── */

function analyse(x, sr, meta) {
  const n = x.length;

  /* Sample-level distribution. The headline claim — "most of this recording is
     below −45 dBFS" — is a claim about instantaneous amplitude, so measure it
     that way as well as in windows; the two answer slightly different
     questions and quoting only the flattering one would be dishonest. */
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

  /* Windowed level, 50 ms, which is roughly the ear's integration time and so
     is the better proxy for "does this feel loud". */
  const W = Math.round(0.05 * sr);
  const wins = Math.floor(n / W);
  const wl = new Float64Array(wins);
  for (let w = 0; w < wins; w++) {
    let s = 0;
    for (let i = w * W; i < (w + 1) * W; i++) s += x[i] * x[i];
    wl[w] = db(Math.sqrt(s / W));
  }
  const sorted = Float64Array.from(wl).sort();
  const pc = (p) => sorted[Math.min(wins - 1, Math.floor(p * wins))];
  const belowWin = THRESH.map(t => wl.reduce((c, v) => c + (v < t ? 1 : 0), 0));

  /* Bands, from an averaged periodogram over the whole take. */
  const S = stft(x, 1024, 256);
  const bandEdges = [20, 120, 500, 2000, 6000, sr / 2];
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
  // Periodogram power sums to mean-square for a sinusoid-normalised transform;
  // halve to convert amplitude-squared into RMS-squared.
  const bandRms = Array.from(bandPow, p => db(Math.sqrt(p / 2)));

  /* Discrete events. The wind bed is not an event, so the threshold floats on
     the bed: the twentieth percentile of the 20 ms level is "how quiet it is
     when nothing is happening", and anything nine decibels above that for at
     least eighty milliseconds is something happening. Gaps under 350 ms are
     joined so that a yip sequence counts as one coyote, not five. */
  const EW = Math.round(0.02 * sr);
  const ewins = Math.floor(n / EW);
  const el = new Float64Array(ewins);
  for (let w = 0; w < ewins; w++) {
    let s = 0;
    for (let i = w * EW; i < (w + 1) * EW; i++) s += x[i] * x[i];
    el[w] = db(Math.sqrt(s / EW));
  }
  /* Filtered noise wanders several decibels over a 20 ms window purely by
     chance, so a bare threshold on the raw envelope reports a dozen "events"
     that are nothing but the bed breathing. A three-window median throws those
     away without touching a real transient, which lasts several windows. */
  const em = new Float64Array(ewins);
  for (let w = 0; w < ewins; w++) {
    const a = el[Math.max(0, w - 1)], b = el[w], c = el[Math.min(ewins - 1, w + 1)];
    em[w] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  const esort = Float64Array.from(em).sort();
  const bed = esort[Math.floor(0.20 * ewins)];
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
  const gaps = [];
  for (let i = 1; i < evs.length; i++) gaps.push(evs[i].t - (evs[i - 1].t + evs[i - 1].dur));
  gaps.sort((a, b) => a - b);

  /* Footsteps are deliberately quiet enough that they do not survive the
     event detector above — which is the brief, but "too quiet to measure" and
     "not there" look identical in a level plot. So detect them the way they
     actually differ from the bed: as transients. A 5 ms envelope against a
     200 ms trailing average finds anything with a sharp attack regardless of
     how far above the bed it sits. The control is the count outside the walk
     segments, which should be near zero — that is what proves the steps are
     tied to the player walking and are not a timer running underneath. */
  /* The detector runs band-limited, so its own level figure is the level of
     the crunch band and not of the step. Re-measure each hit against the full
     signal, which is the number that can be compared with the bed. */
  const steps = transients(x, sr).map(s => {
    const i0 = Math.max(0, Math.round((s.t - 0.006) * sr));
    const i1 = Math.min(n, i0 + Math.round(0.03 * sr));
    let ss = 0;
    for (let i = i0; i < i1; i++) ss += x[i] * x[i];
    return { t: s.t, peak: db(Math.sqrt(ss / (i1 - i0))) };
  });
  const walkSpan = (meta && meta.segments) || [];
  const inWalk = (t) => walkSpan.some(([a, d]) => t >= a - 0.1 && t < a + d + 0.4);
  const stepsIn = steps.filter(s => inWalk(s.t));
  const stepsOut = steps.filter(s => !inWalk(s.t));
  const iv = [];
  for (let i = 1; i < stepsIn.length; i++) {
    const g2 = stepsIn[i].t - stepsIn[i - 1].t;
    if (g2 < 2) iv.push(g2);
  }
  const lv = stepsIn.map(s => s.peak).sort((a, b) => a - b);
  iv.sort((a, b) => a - b);
  const walkSeconds = walkSpan.reduce((s, [, d]) => s + d, 0);

  return {
    footsteps: {
      inWalk: stepsIn.length, outsideWalk: stepsOut.length,
      walkSeconds,
      interval: iv.length ? { min: iv[0], median: iv[iv.length >> 1], max: iv[iv.length - 1] } : null,
      level: lv.length
        ? { min: lv[0], median: lv[lv.length >> 1], max: lv[lv.length - 1], spread: lv[lv.length - 1] - lv[0] }
        : null,
    },
    seconds: n / sr, sampleRate: sr,
    rms: db(rms), peak: db(peak), crest: db(peak) - db(rms),
    dc: dc / n,
    longestSilentMs: longestSilent / sr * 1000,
    thresholds: THRESH,
    belowSamplePct: belowSample.map(c => 100 * c / n),
    belowWinPct: belowWin.map(c => 100 * c / wins),
    winPercentiles: { p5: pc(0.05), p25: pc(0.25), p50: pc(0.5), p90: pc(0.9), p99: pc(0.99), max: sorted[wins - 1] },
    bandEdges, bandRms, centroid,
    bed, thr, events: evs,
    gapStats: gaps.length
      ? { min: gaps[0], median: gaps[gaps.length >> 1], max: gaps[gaps.length - 1] }
      : null,
    winLevel: wl, spec: S, meta,
  };
}

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

function spectrogram(a, file) {
  const S = a.spec, sr = a.sampleRate;
  const PW = 1400, PH = 360, LM = 46, RM = 56, TOP = 20, LVH = 96, BM = 16;
  const W = LM + PW + RM, H = TOP + PH + 6 + LVH + BM;
  const c = new Canvas(W, H);

  const DB_LO = -108, DB_HI = -26;
  const F_LO = 30, F_HI = Math.min(12000, sr / 2);
  const logf = (f) => Math.log(f / F_LO) / Math.log(F_HI / F_LO);

  // Row -> bin range, precomputed.
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

  // Frequency axis.
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (f > F_HI) continue;
    const y = TOP + PH - 1 - Math.round(logf(f) * PH);
    for (let x = LM - 3; x < LM; x++) c.set(x, y, GREY);
    for (let x = LM; x < LM + PW; x += 6) c.set(x, y, DIM);
    const lbl = f >= 1000 ? `${f / 1000}k` : `${f}`;
    c.text(LM - 6 - lbl.length * 4, y - 2, lbl, GREY);
  }
  c.text(2, TOP + 2, 'Hz', GREY);

  // Time axis and event ticks along the top strip.
  const step = a.seconds > 90 ? 20 : 10;
  for (let t = 0; t <= a.seconds; t += step) {
    const x = LM + Math.round(t / a.seconds * PW);
    for (let y = TOP; y < TOP + PH; y += 8) c.set(x, y, [44, 44, 52]);
    for (let y = H - BM; y < H - BM + 3; y++) c.set(x, y, GREY);
    c.text(Math.min(W - 14, x - 4), H - BM + 5, `${t}s`, GREY);
  }
  for (const e of a.events) {
    const x0 = LM + Math.round(e.t / a.seconds * PW);
    const x1 = LM + Math.max(x0 + 1, Math.round((e.t + e.dur) / a.seconds * PW));
    c.rect(x0, 4, Math.max(1, x1 - x0), 6, [250, 220, 120]);
  }
  if (a.meta && a.meta.coyotes) {
    for (const t of a.meta.coyotes) {
      const x = LM + Math.round(t / a.seconds * PW);
      c.rect(x - 1, 2, 3, 12, [120, 230, 255]);
    }
  }

  // Level-over-time panel: this is the quiet, drawn.
  const LY = TOP + PH + 6;
  c.rect(LM, LY, PW, LVH, [18, 18, 22]);
  const L_LO = -96, L_HI = -12;
  const ly = (d) => LY + LVH - 1 - Math.round((Math.max(L_LO, Math.min(L_HI, d)) - L_LO) / (L_HI - L_LO) * (LVH - 1));
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
    const ya = ly(hi), yb = ly(lo);
    for (let y = ya; y <= yb; y++) c.set(LM + x, y, WHITE);
  }

  // Colour bar.
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

const shotsDir = path.join(DIR, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

await run({ width: 640, height: 360 }, async ({ page, errs }) => {
  page.setDefaultTimeout(0);
  await page.waitForTimeout(1500);

  const ok = await page.evaluate(() => !!(window.__game && window.__game.audio && window.__game.audio.available));
  if (!ok) throw new Error('window.__game.audio is not available');

  console.log(`  rendering ${SECONDS}s offline at ${SR} Hz …`);
  const t0 = Date.now();
  const res = await page.evaluate(
    ([seconds, sampleRate, seed]) => window.__game.audio.renderOffline({ seconds, sampleRate, seed }),
    [SECONDS, SR, SEED]);
  console.log(`  offline render + transfer: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const perFrameMs = await page.evaluate(() => window.__game.audio._bench(4000));
  const ctxState = await page.evaluate(() => window.__game.audio.state);

  const raw = Buffer.from(res.pcm, 'base64');
  const i16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const x = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) x[i] = i16[i] / res.scale;

  const a = analyse(x, res.sampleRate, res);

  const pngFile = path.join(shotsDir, `${tag}_spectrogram.png`);
  const dims = spectrogram(a, pngFile);

  /* ── report ── */
  const T = a.thresholds;
  const bandName = ['20-120', '120-500', '500-2k', '2k-6k', `6k-${Math.round(a.sampleRate / 2000)}k`];
  const lines = [];
  const say = (s) => { lines.push(s); console.log(s); };

  say('');
  say(`── level ───────────────────────────────────────────────`);
  say(`  duration        ${f2(a.seconds)} s @ ${a.sampleRate} Hz   (context: ${ctxState})`);
  say(`  RMS             ${f2(a.rms)} dBFS`);
  say(`  peak            ${f2(a.peak)} dBFS  (L ${f2(20 * Math.log10(res.peakL || 1e-12))}, R ${f2(20 * Math.log10(res.peakR || 1e-12))})`);
  say(`  crest factor    ${f2(a.crest)} dB`);
  say(`  spectral centroid ${Math.round(a.centroid)} Hz`);
  say('');
  say(`── bands (RMS, dBFS) ───────────────────────────────────`);
  a.bandRms.forEach((v, i) => say(`  ${bandName[i].padEnd(8)} ${f2(v).padStart(8)}`));
  say('');
  say(`── the quiet ───────────────────────────────────────────`);
  say(`  threshold   % of samples   % of 50 ms windows`);
  T.forEach((t, i) => say(
    `  below ${String(t).padStart(3)} dBFS   ${a.belowSamplePct[i].toFixed(1).padStart(6)}%` +
    `        ${a.belowWinPct[i].toFixed(1).padStart(6)}%`));
  const p = a.winPercentiles;
  say(`  50 ms level percentiles  p5 ${f2(p.p5)}  p25 ${f2(p.p25)}  p50 ${f2(p.p50)}` +
      `  p90 ${f2(p.p90)}  p99 ${f2(p.p99)}  max ${f2(p.max)} dBFS`);
  say(`  bed level (p20 of 20 ms) ${f2(a.bed)} dBFS; event threshold ${f2(a.thr)} dBFS`);
  say('');
  say(`── events ──────────────────────────────────────────────`);
  say(`  detected ${a.events.length} discrete events above the bed`);
  if (a.gapStats) {
    say(`  spacing   min ${f2(a.gapStats.min)}s  median ${f2(a.gapStats.median)}s  max ${f2(a.gapStats.max)}s`);
  }
  say(`  scheduler placed ${res.gusts.length} gusts and ${res.coyotes.length} coyote calls`);
  say(`  coyote at: ${res.coyotes.length ? res.coyotes.join(', ') + ' s' : '(none in window)'}`);
  for (const e of a.events.slice(0, 24)) {
    say(`    t=${e.t.toFixed(2).padStart(7)}s  dur ${e.dur.toFixed(2).padStart(5)}s  ` +
        `peak ${f2(e.peak).padStart(7)} dBFS  centroid ${String(Math.round(e.centroid)).padStart(5)} Hz`);
  }
  if (a.events.length > 24) say(`    … ${a.events.length - 24} more`);
  say('');
  const fsx = a.footsteps;
  say(`── footsteps (transient detector) ──────────────────────`);
  say(`  ${fsx.inWalk} transients during ${fsx.walkSeconds}s of scripted walking, ` +
      `${fsx.outsideWalk} during the ${(a.seconds - fsx.walkSeconds).toFixed(0)}s standing still`);
  if (fsx.interval) {
    say(`  stride interval  min ${f2(fsx.interval.min)}s  median ${f2(fsx.interval.median)}s  max ${f2(fsx.interval.max)}s`);
  }
  if (fsx.level) {
    say(`  step level       min ${f2(fsx.level.min)}  median ${f2(fsx.level.median)}  ` +
        `max ${f2(fsx.level.max)} dBFS  (spread ${f2(fsx.level.spread)} dB)`);
    say(`  above bed        ${f2(fsx.level.median - a.bed)} dB at the median step`);
  }
  say('');
  say(`── hygiene ─────────────────────────────────────────────`);
  say(`  clipped samples      ${res.clipped}`);
  say(`  DC offset            L ${res.dcL.toExponential(2)}  R ${res.dcR.toExponential(2)}`);
  say(`  longest true silence ${a.longestSilentMs.toFixed(1)} ms  (denormal risk if large)`);
  say(`  main-thread cost     ${perFrameMs.toFixed(4)} ms per update() call`);
  say('');
  say(`  spectrogram → shots/${path.basename(pngFile)}  (${dims.W}x${dims.H})`);

  fs.writeFileSync(path.join(shotsDir, `${tag}_audio.json`), JSON.stringify({
    seconds: a.seconds, sampleRate: a.sampleRate, seed: SEED === undefined ? 'default' : SEED,
    rms: a.rms, peak: a.peak, crest: a.crest, centroid: a.centroid,
    bands: Object.fromEntries(bandName.map((n, i) => [n, a.bandRms[i]])),
    belowSamplePct: Object.fromEntries(T.map((t, i) => [t, a.belowSamplePct[i]])),
    belowWinPct: Object.fromEntries(T.map((t, i) => [t, a.belowWinPct[i]])),
    winPercentiles: a.winPercentiles,
    bed: a.bed, events: a.events, gapStats: a.gapStats, footsteps: a.footsteps,
    gusts: res.gusts, coyotes: res.coyotes,
    clipped: res.clipped, dcL: res.dcL, dcR: res.dcR,
    longestSilentMs: a.longestSilentMs, perFrameMs,
    pageErrors: [...new Set(errs)],
  }, null, 2));
});
