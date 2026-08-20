/* Sedona Sunset — System 6: sound design.
 *
 * The brief is one sentence: "the quiet is the feature". So this is not an
 * ambience bed with events sprinkled on it; it is a mostly-empty timeline with
 * a wind bed sitting far enough down that you only notice it when it moves.
 * Everything is synthesized — three looping noise buffers, three oscillators,
 * one procedurally generated impulse response, and a lot of scheduled gain
 * envelopes. There are no sample files and nothing is fetched.
 *
 * Two structural decisions drive the whole file:
 *
 *   · Nothing is allocated per event. Web Audio's BufferSourceNode is
 *     single-shot, which is the usual reason ambience systems build a small
 *     graph per grain and then spend their frame budget in the garbage
 *     collector. Instead every sound source here is a long-lived looping node
 *     whose gain sits at zero, and an "event" is a handful of automation points
 *     written onto parameters that already exist. Steady-state cost is a few
 *     parameter writes per second.
 *
 *   · `update()` takes an absolute time rather than reading `ctx.currentTime`,
 *     and every event is scheduled at an absolute time ahead of the playhead.
 *     That is what lets the identical graph and the identical scheduling code
 *     run inside an OfflineAudioContext at many times real speed, which is how
 *     tools/audioprobe.mjs measures this system. The thing being measured is
 *     the thing that ships, not a re-implementation of it.
 *
 * The wind is the authority for weather: `windAt(t)` is analytic and public, so
 * System 5's wind-blown sand can be driven from the same gust envelope and the
 * same direction that the sound is using, rather than a second wind that
 * disagrees with the first.
 */
import * as THREE from 'three';

const SEED = 0x5ed04a;

/* World-space heading the wind blows *toward*, in radians, measured the same
   way as WashPath: 0 means +Z, which is down-wash, away from the sun. So the
   wind comes up the wash at your face and the drifted sand piles on the
   up-wash faces of the clasts, which is what System 1 already drew. */
const WIND_HEADING = 0.12;

/* Half-width of the wash used to turn lateral offset into "how close are the
   walls", which drives the wet/dry balance and the whistling. Approximate on
   purpose — the reverb wants a trend, not a measurement. */
const WASH_HALF = 13;

const TAU = Math.PI * 2;

/* ── small helpers ─────────────────────────────────────────────────────── */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Ramp to a value, tolerating a time that has already gone past. */
function ramp(param, value, t) {
  param.linearRampToValueAtTime(value, t);
}

/**
 * Attack/decay envelope written onto a gain that is otherwise at zero.
 * The decay is a `setTargetAtTime` exponential — a linear decay on a noise
 * burst reads as a synthetic "wipe" rather than something dying away — closed
 * off by a hard zero so the parameter is genuinely idle between events and
 * cannot leave a tail running under the next one.
 */
function burst(param, t0, peak, attack, decay) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.setTargetAtTime(0, t0 + attack, decay * 0.26);
  param.setValueAtTime(0, t0 + attack + decay);
}

/* ── procedural buffers ────────────────────────────────────────────────── */

/**
 * Pink noise, loopable without a seam.
 *
 * White noise loops audibly: the discontinuity at the wrap is a click, and
 * with a low-frequency-heavy spectrum it is a thump. Generating `n + fade`
 * samples and cross-fading the surplus back over the head makes sample n-1
 * continuous with sample 0, so the loop point is inaudible even though the
 * buffer is only a few seconds long.
 */
function pinkNoise(ctx, rand, seconds, targetRMS = 0.2) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const fade = Math.floor(0.12 * sr);
  const gen = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < gen.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    gen[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  const out = new Float32Array(n);
  out.set(gen.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = gen[i] * Math.sqrt(w) + gen[n + i] * Math.sqrt(1 - w);
  }
  /* Pink noise generated by an IIR cascade carries a small DC term, and a DC
     term in a looping buffer becomes a permanent DC offset on the master bus.
     It measures around -90 dBFS, which is inaudible and still wrong: it eats
     headroom and it shows up in the probe's hygiene check. */
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let s = 0;
  for (let i = 0; i < n; i++) { out[i] -= mean; s += out[i] * out[i]; }
  const g = targetRMS / (Math.sqrt(s / n) || 1);
  for (let i = 0; i < n; i++) out[i] *= g;

  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(out, 0);
  return buf;
}

/**
 * Sparse grains: very short exponentially-decaying noise bursts at random
 * times. Filtered, this is what sand actually sounds like — a lot of tiny
 * uncorrelated impacts, not a hiss. Reused for the crunch layer of footsteps
 * with a different playback rate, which is most of why every step is
 * different from the last.
 */
function grainNoise(ctx, rand, seconds, density) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const count = Math.floor(seconds * density);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(rand() * (n - 400));
    const len = 12 + Math.floor(rand() * Math.min(220, sr * 0.005));
    const amp = 0.25 + rand() * 0.75;
    const decay = 1 / len;
    for (let i = 0; i < len && at + i < n; i++) {
      out[at + i] += (rand() * 2 - 1) * amp * Math.exp(-i * decay * 3.4);
    }
  }
  // Keep the last 40 ms clear so the loop wrap lands on silence.
  const tail = Math.floor(0.04 * sr);
  for (let i = n - tail; i < n; i++) out[i] *= (n - i) / tail;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.8 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;

  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(out, 0);
  return buf;
}

/**
 * Impulse response for a wash between rock walls.
 *
 * Not a hall and not a plate. A sandy channel with two hard walls forty metres
 * apart gives you a sparse set of distinct early reflections off the walls,
 * then a short, dark, gappy tail — most of the energy above two kilohertz is
 * absorbed by the sand and scattered by the broken rock face, so the decay time
 * is strongly frequency-dependent. That is modelled here with a one-pole
 * lowpass whose cutoff falls as the tail proceeds, which is cheap and gets the
 * important part right: the reverb gets darker as it dies, and the tail is
 * long enough at the bottom to make the coyote sound like it is a long way off.
 *
 * The two channels are generated from independent noise so the tail is
 * decorrelated and the space has width.
 */
function canyonIR(ctx, rand, seconds = 2.6) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);

  // Wall reflections: distances in metres, converted to delay at 343 m/s.
  const walls = [11, 14.5, 19, 23, 27, 34, 41, 52, 63, 78];

  for (let c = 0; c < 2; c++) {
    const out = new Float32Array(n);
    // Diffuse tail. Two exponentials — a fast dense one and a slow low one —
    // and a progressively closing lowpass.
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = 0.62 * Math.exp(-t / 0.42) + 0.38 * Math.exp(-t / 1.35);
      // Cutoff sweeps from ~4.5 kHz down to ~380 Hz across the tail.
      const fc = 4500 * Math.exp(-t / 0.75) + 380;
      const a = 1 - Math.exp(-TAU * fc / sr);
      lp += a * ((rand() * 2 - 1) - lp);
      out[i] = lp * env;
    }
    // Early reflections, slightly different per channel so the walls are not
    // in the middle of the head.
    for (let k = 0; k < walls.length; k++) {
      const d = walls[k] * (1 + (c ? 0.06 : -0.06) * (1 + rand() * 0.5));
      const at = Math.floor((d / 343) * sr);
      const amp = (0.55 / (1 + d * 0.09)) * (0.6 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1);
      const len = Math.floor(sr * (0.002 + rand() * 0.004));
      for (let i = 0; i < len && at + i < n; i++) {
        out[at + i] += (rand() * 2 - 1) * amp * (1 - i / len);
      }
    }
    // Kill the first few milliseconds: this is a reverb, not a delay line, and
    // anything routed here is meant to arrive with no direct signal at all.
    const pre = Math.floor(sr * 0.008);
    for (let i = 0; i < pre; i++) out[i] *= i / pre;

    let s = 0;
    for (let i = 0; i < n; i++) s += out[i] * out[i];
    const g = 0.55 / (Math.sqrt(s / n) * Math.sqrt(seconds) || 1);
    for (let i = 0; i < n; i++) out[i] *= g;
    buf.copyToChannel(out, c);
  }
  return buf;
}

/* ── the soundscape ────────────────────────────────────────────────────── */

/**
 * The whole graph, parameterised only by an AudioContext. Works identically in
 * a live AudioContext and an OfflineAudioContext; the only difference is who
 * calls `update()` and with what clock.
 */
export class Soundscape {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} out  where the master bus lands
   * @param {{seed?:number, path?:object}} opts
   */
  constructor(ctx, out, opts = {}) {
    this.ctx = ctx;
    this.path = opts.path || null;
    this.seed = opts.seed === undefined ? SEED : opts.seed;
    const rand = this.rand = mulberry32(this.seed);
    /* A second stream for scheduling decisions, kept separate from buffer
       generation so that changing a buffer length does not reshuffle every
       gust in the timeline. */
    this.erand = mulberry32(this.seed ^ 0x9e3779b9);

    this.pink = pinkNoise(ctx, rand, 11.3);
    this.grain = grainNoise(ctx, rand, 6.7, 130);
    this.ir = canyonIR(ctx, rand);

    const g = (v) => { const nd = ctx.createGain(); nd.gain.value = v; return nd; };
    const bq = (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; if (q !== undefined) f.Q.value = q;
      return f;
    };
    const sp = (pan) => {
      const p = ctx.createStereoPanner(); p.pan.value = pan; return p;
    };
    const loop = (buffer, offset, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer; s.loop = true; s.playbackRate.value = rate;
      s._offset = offset;
      return s;
    };

    /* master ------------------------------------------------------------ */
    this.master = g(1);
    /* Purely a seatbelt. Everything here runs thirty decibels below the
       threshold, so the compressor never engages; it exists so that a future
       mistake in a gain envelope cannot ship a clipped frame. */
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -8;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp).connect(out);

    this.dry = g(1);
    this.dry.connect(this.master);

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.ir;
    this.convolver.normalize = false;
    this.wet = g(0.9);
    this.convolver.connect(this.wet).connect(this.master);

    /* sources ----------------------------------------------------------- */
    this.nA = loop(this.pink, 0);
    this.nB = loop(this.pink, 3.1, 0.87);
    this.nC = loop(this.pink, 6.9, 1.13);
    this.gSand = loop(this.grain, 0, 1);
    this.gStep = loop(this.grain, 2.3, 1);

    /* wind -------------------------------------------------------------- */
    /* Four branches, because wind in a rock channel is not one sound: a low
       broadband rush that is mostly felt, a mid body that carries the sense of
       air moving, and two narrow resonances that only speak up in a gust —
       those are the edges of the rock, and they are the difference between
       wind and a noise generator. */
    /* Starts at the lull value, not at some nominal mid level: the first
       scheduled ramp is half a second out, and anything louder here fades down
       into it, which is an audible "the sound just started" on page load. */
    this.windBus = g(0.008);
    this.windBus.connect(this.dry);
    this.windSend = g(0.30);
    this.windBus.connect(this.windSend).connect(this.convolver);

    this.wHP = bq('highpass', 75, 0.7);
    this.nA.connect(this.wHP);

    this.wLow = bq('lowpass', 220, 0.7);
    this.gLow = g(1.0);
    this.wHP.connect(this.wLow).connect(this.gLow).connect(sp(-0.10)).connect(this.windBus);

    this.wBody = bq('bandpass', 480, 0.75);
    this.gBody = g(0.70);
    this.nB.connect(this.wBody).connect(this.gBody).connect(sp(0.26)).connect(this.windBus);

    this.wWhis1 = bq('bandpass', 1250, 9);
    this.gWhis1 = g(0);
    this.nB.connect(this.wWhis1).connect(this.gWhis1).connect(sp(-0.50)).connect(this.windBus);

    this.wWhis2 = bq('bandpass', 2100, 15);
    this.gWhis2 = g(0);
    this.nA.connect(this.wWhis2).connect(this.gWhis2).connect(sp(0.54)).connect(this.windBus);

    /* Grit: the top octaves of moving air, which are what tell you the wind is
       carrying something. Sits thirty decibels under the body and is gated on
       gust strength, so the lull has essentially no top end — which is the
       correct answer for still desert air and is also what makes a gust read
       as an arrival rather than a level change. */
    this.wGrit = bq('highpass', 2600, 0.6);
    this.gGrit = g(0);
    this.nC.connect(this.wGrit).connect(this.gGrit).connect(sp(0.08)).connect(this.windBus);

    /* room tone --------------------------------------------------------- */
    /* Even "silence" in a canyon is not digital zero. This sits about seventy
       decibels down and is inaudible in isolation, but its absence is
       audible: without it the gaps between gusts are a dead channel, which
       reads as a stopped recording rather than a still evening. It also keeps
       the graph out of denormal territory. */
    this.rtLP = bq('lowpass', 105, 0.6);
    this.rtGain = g(0.0016);
    this.nC.connect(this.rtLP).connect(this.rtGain).connect(this.dry);

    /* sand -------------------------------------------------------------- */
    this.sandPan = ctx.createPanner();
    this._initPanner(this.sandPan, 3, 45);
    this.sandBP = bq('bandpass', 2600, 1.0);
    this.sandGain = g(0);
    this.nC.connect(this.sandBP).connect(this.sandGain).connect(this.sandPan);

    this.trickleBP = bq('bandpass', 3600, 1.5);
    this.trickleGain = g(0);
    this.gSand.connect(this.trickleBP).connect(this.trickleGain).connect(this.sandPan);

    this.sandPan.connect(this.dry);
    this.sandSend = g(0.45);
    this.sandPan.connect(this.sandSend).connect(this.convolver);

    /* footsteps --------------------------------------------------------- */
    this.stepPan = sp(0);
    this.stepLP = bq('lowpass', 620, 0.9);
    this.stepGain = g(0);
    this.nB.connect(this.stepLP).connect(this.stepGain).connect(this.stepPan);

    this.crunchBP = bq('bandpass', 1900, 1.1);
    this.crunchGain = g(0);
    this.gStep.connect(this.crunchBP).connect(this.crunchGain).connect(this.stepPan);

    this.stepPan.connect(this.dry);
    this.stepSend = g(0.18);
    this.stepPan.connect(this.stepSend).connect(this.convolver);

    /* coyote ------------------------------------------------------------ */
    /* Two detuned saws for the buzzy vocal-fold edge, a sine an octave down
       for the body, a bandpass standing in for the vocal tract, and then two
       cascaded lowpasses because that is what a kilometre of air does to a
       sound. Everything goes into the convolver and nothing goes to the dry
       bus: at that distance you do not hear the animal, you hear the walls
       being hit by the animal. */
    this.coyMix = g(0);
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'sawtooth'; this.oscB.detune.value = 11;
    this.oscS = ctx.createOscillator(); this.oscS.type = 'sine';
    this.oscA.frequency.value = 500;
    this.oscB.frequency.value = 500;
    this.oscS.frequency.value = 250;
    this.coyA = g(0.5); this.coyB = g(0.35); this.coyS = g(0.45);
    this.oscA.connect(this.coyA).connect(this.coyMix);
    this.oscB.connect(this.coyB).connect(this.coyMix);
    this.oscS.connect(this.coyS).connect(this.coyMix);

    this.vib = ctx.createOscillator(); this.vib.type = 'sine'; this.vib.frequency.value = 5.6;
    this.vibDepth = g(9);
    this.vib.connect(this.vibDepth);
    this.vibDepth.connect(this.oscA.frequency);
    this.vibDepth.connect(this.oscB.frequency);

    this.coyBP = bq('bandpass', 760, 1.9);
    this.coyLP1 = bq('lowpass', 900, 0.7);
    this.coyLP2 = bq('lowpass', 1150, 0.7);
    this.coyPan = ctx.createPanner();
    this._initPanner(this.coyPan, 40, 4000, 0);
    this.coySend = g(1.5);
    this.coyMix.connect(this.coyBP).connect(this.coyLP1).connect(this.coyLP2)
      .connect(this.coyPan).connect(this.coySend).connect(this.convolver);

    /* state ------------------------------------------------------------- */
    this.gusts = [];
    this.coyotes = [];
    this.gustsTo = 0;
    this.coyotesTo = 0;
    this.schedHead = 0;
    this.prox = 0.5;
    this.strideAcc = 0;
    this.stepSide = 1;
    this.started = false;
    this.lastCoyoteAt = -1e9;

    /** Live, read-only weather state. System 5 reads this. */
    this.wind = {
      heading: WIND_HEADING, dirX: Math.sin(WIND_HEADING), dirZ: Math.cos(WIND_HEADING),
      gust: 0, speed: 0.6, base: 0,
    };
  }

  _initPanner(p, refDistance, maxDistance, rolloff = 1) {
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.maxDistance = maxDistance;
    p.rolloffFactor = rolloff;
    p.positionX.value = 0; p.positionY.value = 0; p.positionZ.value = -1;
  }

  /** Start every long-lived source. Call once, before any scheduling. */
  start(t0) {
    if (this.started) return;
    this.started = true;
    for (const s of [this.nA, this.nB, this.nC, this.gSand, this.gStep]) {
      s.start(t0, s._offset % s.buffer.duration);
    }
    this.oscA.start(t0); this.oscB.start(t0); this.oscS.start(t0); this.vib.start(t0);
    this.schedHead = t0;
  }

  /* ── weather ─────────────────────────────────────────────────────────── */

  /** Extend the gust list far enough ahead to cover `until`. */
  _ensureGusts(until) {
    while (this.gustsTo < until) {
      const r = this.erand;
      /* Gaps of twelve to fifty seconds. The long end is deliberate: a gust
         every eight seconds is weather, and weather is not what this scene
         is. The gaps are where the system does its work. */
      const gap = 11 + r() * 32;
      const t0 = this.gustsTo + gap;
      const dur = 5 + r() * 11;
      /* Most gusts are small. The cube keeps the distribution bottom-heavy so
         a strong gust stays an event rather than a rhythm. */
      const peak = 0.16 + 0.74 * Math.pow(r(), 2.1);
      const gust = { t0, dur, peak, turn: (r() * 2 - 1) * 0.5, sand: false };
      this.gusts.push(gust);
      this.gustsTo = t0 + dur;
      if (this.gusts.length > 64) this.gusts.splice(0, 32);
    }
  }

  /**
   * The wind at an absolute time. Analytic, deterministic, and the single
   * source of truth for both the audio and (via `window.__game.audio.wind`)
   * anything visual that has to agree with it.
   *
   * @returns {{g:number, heading:number, dirX:number, dirZ:number, speed:number, base:number}}
   */
  windAt(t, out) {
    this._ensureGusts(t + 4);
    const base = clamp(
      0.105 + 0.075 * Math.sin(t * 0.0431 + 1.3) + 0.045 * Math.sin(t * 0.0177 + 0.4) +
      0.03 * Math.sin(t * 0.0091 + 2.7), 0.02, 0.36);
    let gsum = 0, turn = 0;
    for (let i = 0; i < this.gusts.length; i++) {
      const gu = this.gusts[i];
      if (t < gu.t0 || t > gu.t0 + gu.dur) continue;
      const u = (t - gu.t0) / gu.dur;
      /* Skewed so the rise is quicker than the fall — a gust arrives and
         then lets go, it does not breathe symmetrically. */
      const s = Math.sin(Math.PI * Math.pow(u, 0.62));
      const flutter = 0.86 + 0.14 * Math.sin(t * 2.31 + gu.t0);
      gsum += gu.peak * s * s * flutter;
      turn += gu.turn * s;
    }
    const g = clamp01(base + gsum);
    const heading = WIND_HEADING + 0.26 * Math.sin(t * 0.021 + 0.8) + turn * 0.35;
    const o = out || {};
    o.g = g;
    o.base = base;
    o.heading = heading;
    o.dirX = Math.sin(heading);
    o.dirZ = Math.cos(heading);
    o.speed = 0.5 + 8.4 * g;
    return o;
  }

  /* ── scheduling ──────────────────────────────────────────────────────── */

  /**
   * Write the wind automation forward to a fixed horizon.
   *
   * Half-second granularity with linear ramps between: the fastest thing the
   * wind envelope does is a five-second attack, so half a second is far below
   * the point where the interpolation is audible, and it costs six parameter
   * writes per half second of timeline — a couple of hundred microseconds per
   * *second*, not per frame.
   */
  _scheduleWind(now) {
    const HORIZON = 2.0, STEP = 0.5;
    if (this.schedHead < now) this.schedHead = now;
    const w = this._w || (this._w = {});
    while (this.schedHead < now + HORIZON) {
      const t = this.schedHead + STEP;
      this.windAt(t, w);
      const gg = w.g;
      const prox = this.prox;

      /* Strongly superlinear on purpose. A wind bed whose lull is only fifteen
         decibels under its gusts is a continuous noise with bumps in it; the
         still air has to drop far enough that you stop hearing it entirely,
         because the gust only lands if there was nothing there before it. */
      ramp(this.windBus.gain, 0.0075 + 0.42 * Math.pow(gg, 2.4) + 0.018 * gg, t);
      ramp(this.wLow.frequency, 165 + 700 * gg, t);
      ramp(this.wBody.frequency, 420 + 1150 * gg, t);

      /* The whistles are gated hard: below about a third of full gust there is
         no edge tone at all, and they need a wall nearby to have an edge to
         come off. Ungated they turn into a kettle, which is the single fastest
         way to make procedural wind sound procedural. */
      const edge = clamp01((gg - 0.34) / 0.5);
      const wallGate = 0.25 + 0.75 * prox;
      ramp(this.gWhis1.gain, 0.26 * edge * edge * wallGate, t);
      ramp(this.gWhis2.gain, 0.24 * edge * edge * edge * wallGate, t);
      ramp(this.gGrit.gain, 0.18 * Math.pow(clamp01((gg - 0.2) / 0.7), 2), t);
      ramp(this.wWhis1.frequency, 1080 + 980 * gg + 130 * Math.sin(t * 0.37), t);
      ramp(this.wWhis2.frequency, 1950 + 1500 * gg + 210 * Math.sin(t * 0.23 + 1.1), t);

      /* Closer walls means more of the wind arrives as reflection. */
      ramp(this.wet.gain, 0.55 + 0.75 * prox, t);

      this.schedHead = t;
    }
  }

  /**
   * Sand for a gust. Bursts land inside the gust's own envelope, which is the
   * whole point — sand that moves on its own schedule immediately reads as a
   * separate sound effect rather than as a consequence of the wind.
   */
  _scheduleSand(gust) {
    if (gust.sand) return;
    gust.sand = true;
    if (gust.peak < 0.22) return;                 // a light gust moves nothing
    const r = this.erand;
    const n = 1 + Math.floor(r() * (gust.peak > 0.6 ? 4 : 2.4));
    for (let i = 0; i < n; i++) {
      const at = gust.t0 + gust.dur * (0.18 + 0.62 * r());
      const dur = 0.35 + r() * 1.5;
      const strength = gust.peak * (0.4 + 0.6 * r());
      burst(this.sandGain.gain, at, 0.085 * strength, 0.09 + r() * 0.2, dur);
      this.sandBP.frequency.setValueAtTime(1900 + r() * 3400, at);
      // Grains trickling down the bank, following the burst rather than
      // sitting on top of it.
      if (r() < 0.75) {
        const gt = at + 0.15 + r() * 0.5;
        burst(this.trickleGain.gain, gt, 0.050 * strength, 0.05, 0.5 + r() * 1.9);
        this.gSand.playbackRate.setValueAtTime(0.75 + r() * 0.7, gt);
      }
    }
  }

  /** Place the sand source a few metres downwind of wherever the player is. */
  _placeSand(t, x, z, w) {
    const d = 4 + 7 * ((Math.sin(t * 0.13) + 1) * 0.5);
    this.sandPan.positionX.setValueAtTime(x + w.dirX * d + w.dirZ * 3, t);
    this.sandPan.positionY.setValueAtTime(0, t);
    this.sandPan.positionZ.setValueAtTime(z + w.dirZ * d - w.dirX * 3, t);
  }

  /* ── coyote ──────────────────────────────────────────────────────────── */

  _ensureCoyotes(until) {
    while (this.coyotesTo < until) {
      const r = this.erand;
      /* First call comes early enough that a two-minute measurement usually
         catches one; after that it is every three to six minutes. */
      const gap = this.coyotes.length === 0 ? 52 + r() * 40 : 170 + r() * 190;
      const t0 = this.coyotesTo + gap;
      this.coyotes.push({ t0, done: false, bearing: (r() * 2 - 1) * Math.PI });
      this.coyotesTo = t0;
      if (this.coyotes.length > 16) this.coyotes.splice(0, 8);
    }
  }

  /**
   * A yip-howl. Three to six short rising yips, a beat of nothing, then the
   * howl: a slow rise to a held note that sags and then falls away. The vibrato
   * oscillator is always running and always connected, so the "performance"
   * here is nothing but frequency and gain automation on nodes that already
   * exist.
   */
  _fireCoyote(t0, bearing) {
    const r = this.erand;
    const ctx = this.ctx;
    const fA = this.oscA.frequency, fB = this.oscB.frequency, fS = this.oscS.frequency;
    const gm = this.coyMix.gain;

    // 400 m out, on a bearing, slightly above the wash floor.
    const D = 380 + r() * 260;
    const px = Math.sin(bearing) * D, pz = Math.cos(bearing) * D;
    this.coyPan.positionX.setValueAtTime(px, Math.max(0, t0 - 0.05));
    this.coyPan.positionY.setValueAtTime(18, Math.max(0, t0 - 0.05));
    this.coyPan.positionZ.setValueAtTime(pz, Math.max(0, t0 - 0.05));

    let t = t0;
    const yips = 3 + Math.floor(r() * 4);
    for (let i = 0; i < yips; i++) {
      const len = 0.085 + r() * 0.075;
      const f0 = 430 + r() * 120 + i * 28;
      const f1 = f0 * (1.55 + r() * 0.5);
      fA.setValueAtTime(f0, t);
      fA.exponentialRampToValueAtTime(f1, t + len * 0.55);
      fA.exponentialRampToValueAtTime(f1 * 0.72, t + len);
      fB.setValueAtTime(f0 * 1.004, t);
      fB.exponentialRampToValueAtTime(f1 * 1.004, t + len * 0.55);
      fB.exponentialRampToValueAtTime(f1 * 0.72, t + len);
      fS.setValueAtTime(f0 * 0.5, t);
      fS.exponentialRampToValueAtTime(f1 * 0.5, t + len * 0.6);
      burst(gm, t, 0.20 + r() * 0.1, 0.012, len);
      t += len + 0.075 + r() * 0.13;
    }

    t += 0.18 + r() * 0.3;
    const hl = 1.7 + r() * 1.1;
    const hf = 380 + r() * 130;
    fA.setValueAtTime(hf * 0.78, t);
    fA.exponentialRampToValueAtTime(hf, t + hl * 0.16);
    fA.exponentialRampToValueAtTime(hf * 1.07, t + hl * 0.55);
    fA.exponentialRampToValueAtTime(hf * 0.62, t + hl);
    fB.setValueAtTime(hf * 0.78, t);
    fB.exponentialRampToValueAtTime(hf * 1.002, t + hl * 0.16);
    fB.exponentialRampToValueAtTime(hf * 1.072, t + hl * 0.55);
    fB.exponentialRampToValueAtTime(hf * 0.62, t + hl);
    fS.setValueAtTime(hf * 0.39, t);
    fS.exponentialRampToValueAtTime(hf * 0.5, t + hl * 0.5);
    fS.exponentialRampToValueAtTime(hf * 0.31, t + hl);
    this.vibDepth.gain.setValueAtTime(3, t);
    this.vibDepth.gain.linearRampToValueAtTime(13, t + hl * 0.6);
    this.vibDepth.gain.linearRampToValueAtTime(4, t + hl);

    gm.setValueAtTime(0, t);
    gm.linearRampToValueAtTime(0.30, t + 0.22);
    gm.linearRampToValueAtTime(0.26, t + hl * 0.6);
    gm.setTargetAtTime(0, t + hl * 0.6, hl * 0.16);
    gm.setValueAtTime(0, t + hl + 0.5);
    this.lastCoyoteAt = t0;
    return t + hl + 0.5;
  }

  /* ── footsteps ───────────────────────────────────────────────────────── */

  /**
   * How gravelly the ground is here, 0 = fine sand, 1 = coarse lag gravel.
   * Deliberately its own cheap field rather than a query into the terrain: the
   * terrain module is being rewritten by someone else this week, and a wrong
   * footstep timbre is a far smaller failure than a broken import. The trend it
   * encodes is the true one — fines in the middle of the channel, armoured lag
   * out towards the banks.
   */
  _surfaceAt(x, z, u) {
    const patch = Math.sin(x * 0.21 + z * 0.13) * Math.cos(z * 0.17 - x * 0.09);
    const bank = clamp01(Math.abs(u) / 9);
    return clamp01(0.34 + 0.34 * patch + 0.42 * bank);
  }

  /** One footstep at absolute time `t`. Six parameter writes, no allocation. */
  _step(t, x, z, u, speed) {
    const r = this.erand;
    const gravel = this._surfaceAt(x, z, u);
    const vary = 0.72 + r() * 0.56;
    const load = clamp(speed / 1.6, 0.55, 1.5);

    /* Sand is a soft dull thud with the energy under a kilohertz; gravel is a
       sharper, brighter click with a lot more crunch and much less body. The
       step gets pushed along that axis, then everything is jittered per step —
       level, timbre, decay, and the grain playback rate — because a footstep
       loop is recognisable within about four steps. */
    const bodyF = lerp(420, 900, gravel) * (0.85 + r() * 0.3);
    const bodyLvl = lerp(0.082, 0.038, gravel) * vary * load;
    const bodyDec = lerp(0.11, 0.055, gravel) * (0.8 + r() * 0.45);

    this.stepLP.frequency.setValueAtTime(bodyF, t);
    burst(this.stepGain.gain, t, bodyLvl, 0.004 + r() * 0.004, bodyDec);

    const crF = lerp(1250, 3100, gravel) * (0.85 + r() * 0.35);
    const crLvl = lerp(0.055, 0.135, gravel) * vary * load;
    const crDec = lerp(0.075, 0.13, gravel) * (0.8 + r() * 0.5);
    this.crunchBP.frequency.setValueAtTime(crF, t);
    this.crunchBP.Q.setValueAtTime(0.8 + gravel * 0.9, t);
    this.gStep.playbackRate.setValueAtTime(0.7 + r() * 0.85 + gravel * 0.35, t);
    burst(this.crunchGain.gain, t + 0.004, crLvl, 0.003, crDec);

    this.stepPan.pan.setValueAtTime(this.stepSide * (0.1 + r() * 0.14), t);
    this.stepSide = -this.stepSide;
  }

  /* ── per-frame ───────────────────────────────────────────────────────── */

  /**
   * @param {number} now absolute context time
   * @param {{x:number,z:number,speed:number,dt:number,u?:number}} st
   */
  update(now, st) {
    const w = this.windAt(now, this._wNow || (this._wNow = {}));
    this.wind.gust = w.g;
    this.wind.base = w.base;
    this.wind.heading = w.heading;
    this.wind.dirX = w.dirX;
    this.wind.dirZ = w.dirZ;
    this.wind.speed = w.speed;

    let u = st.u;
    if (u === undefined) u = this.path ? this.path.uOf(st.x, st.z) : 0;
    this.prox = clamp01(Math.abs(u) / WASH_HALF);

    this._scheduleWind(now);

    /* Sand and coyotes are laid down as soon as their gust or their slot is
       decided, which is up to half a minute ahead. Nothing here has to happen
       on any particular frame. */
    this._ensureGusts(now + 30);
    for (let i = 0; i < this.gusts.length; i++) {
      const gu = this.gusts[i];
      if (!gu.sand && gu.t0 < now + 30) this._scheduleSand(gu);
    }
    this._ensureCoyotes(now + 30);
    for (let i = 0; i < this.coyotes.length; i++) {
      const c = this.coyotes[i];
      if (!c.done && c.t0 < now + 20) { c.done = true; this._fireCoyote(c.t0, c.bearing); }
    }

    // Sand position follows the player, cheaply and rarely.
    if (now - (this._sandPlaced || -1) > 1.0) {
      this._sandPlaced = now;
      this._placeSand(now + 0.05, st.x, st.z, w);
    }

    /* Footsteps are the one thing that cannot be scheduled ahead, because they
       depend on a player who has not decided to walk yet. Stride length rather
       than a timer, so cadence follows speed for free. */
    const speed = st.speed;
    if (speed > 0.12) {
      const stride = lerp(0.72, 0.98, clamp01((speed - 1.2) / 2.4));
      this.strideAcc += speed * st.dt;
      if (this.strideAcc >= stride) {
        this.strideAcc -= stride;
        if (this.strideAcc > stride) this.strideAcc = 0;   // after a long hitch
        this._step(now + 0.03, st.x, st.z, u, speed);
      }
    } else if (this.strideAcc !== 0) {
      // Land the next step promptly when walking resumes rather than mid-stride.
      this.strideAcc = 0.55;
    }
  }
}

/* ── realtime wrapper ──────────────────────────────────────────────────── */

/**
 * Build the live system and hook it to the camera and the canvas.
 *
 * Returns an object with `update(dt, player)` and an `api` suitable for
 * hanging off `window.__game.audio`. If audio is unavailable for any reason —
 * no AudioContext, a construction failure — both are inert stubs, because a
 * scene that fails to draw because the sound failed to build is a much worse
 * bug than a silent scene.
 */
export function createAudio({ camera, canvas, path, seed } = {}) {
  const stub = {
    update() {},
    api: {
      setEnabled() {}, gust() {}, coyote() {}, available: false,
      wind: { heading: WIND_HEADING, dirX: Math.sin(WIND_HEADING), dirZ: Math.cos(WIND_HEADING), gust: 0, speed: 0, base: 0 },
      windAt() { return { g: 0, heading: WIND_HEADING, dirX: 0, dirZ: 1, speed: 0, base: 0 }; },
      renderOffline() { return Promise.reject(new Error('audio unavailable')); },
    },
  };

  let listener, sc, ctx;
  try {
    if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) {
      return stub;
    }
    listener = new THREE.AudioListener();
    ctx = listener.context;
    if (camera) camera.add(listener);
    listener.gain.gain.value = 1;
    sc = new Soundscape(ctx, listener.getInput(), { path, seed });
    sc.start(ctx.currentTime);
  } catch (e) {
    return stub;
  }

  let enabled = true;
  let started = false;

  /* Autoplay: the context is created suspended and stays that way until a
     gesture. Resuming is attached to the same click that already grabs pointer
     lock, plus the first key press, and every call swallows its rejection —
     a page nobody has clicked must not put anything in the console. */
  const resume = () => {
    if (ctx.state === 'suspended') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  };
  if (canvas) canvas.addEventListener('click', resume);
  if (typeof addEventListener === 'function') {
    addEventListener('keydown', resume, { passive: true });
    addEventListener('pointerdown', resume, { passive: true });
  }
  resume();   // a no-op where a gesture is required; succeeds under the harness

  const stt = { x: 0, z: 0, speed: 0, dt: 0.016 };

  function update(dt, player) {
    const now = ctx.currentTime;
    if (!enabled || ctx.state !== 'running') {
      /* Still advance the published weather even with no audible output, so a
         page that has never been clicked does not hand System 5 a dead wind. */
      const w = sc.windAt(now);
      Object.assign(sc.wind, {
        gust: w.g, base: w.base, heading: w.heading,
        dirX: w.dirX, dirZ: w.dirZ, speed: w.speed,
      });
      return;
    }
    // The first running frame may arrive long after start(); do not try to
    // schedule the interval that elapsed while the context was suspended.
    if (!started) { started = true; sc.schedHead = Math.max(sc.schedHead, now); }
    stt.x = player.x; stt.z = player.z;
    stt.speed = Math.hypot(player.vx || 0, player.vz || 0);
    stt.dt = dt;
    sc.update(now, stt);
  }

  const api = {
    available: true,
    /** Silence or restore the whole system. No UI ships for this. */
    setEnabled(b) {
      enabled = !!b;
      sc.master.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.05);
    },
    /** Force a gust now, for testing. `strength` in 0..1. */
    gust(strength = 0.8) {
      const t0 = ctx.currentTime + 0.1;
      const gu = { t0, dur: 5 + strength * 8, peak: clamp01(strength), turn: 0, sand: false };
      sc.gusts.push(gu);
      sc._scheduleSand(gu);
      return gu;
    },
    /** Force a coyote now, for testing. */
    coyote() { return sc._fireCoyote(ctx.currentTime + 0.15, (Math.random() * 2 - 1) * Math.PI); },
    /** Live weather, shared with anything visual that has to agree with it. */
    get wind() { return sc.wind; },
    /** Weather at an arbitrary absolute context time. */
    windAt(t) { return sc.windAt(t); },
    get time() { return ctx.currentTime; },
    get state() { return ctx.state; },
    /** Offline render of this exact graph; see tools/audioprobe.mjs. */
    renderOffline: (opts) => renderOffline({ path, seed, ...(opts || {}) }),
    /** Cost of one update() call in milliseconds, averaged over `n`. */
    _bench(n = 4000) {
      const t = performance.now();
      for (let i = 0; i < n; i++) update(0.016, { x: 0, z: -40 - i * 0.001, vx: 0, vz: 0 });
      return (performance.now() - t) / n;
    },
    _sc: sc,
  };

  return { update, api };
}

/* ── offline render, for measurement ───────────────────────────────────── */

/**
 * Render the same graph, the same scheduler and the same random seed into an
 * OfflineAudioContext, driving it with a scripted walk.
 *
 * Twenty-four kilohertz because nothing in this soundscape has meaningful
 * energy above about six: the wind whistles top out near four, and the coyote
 * is behind two cascaded lowpasses at a kilohertz. Halving the rate halves the
 * render time and the transfer size for no measurable loss.
 *
 * Returns Int16 mono PCM as base64 with the scale factor used, plus the
 * per-channel figures that a mono downmix would destroy.
 */
export async function renderOffline({
  seconds = 120, sampleRate = 24000, seed, path = null, walk = null,
} = {}) {
  const len = Math.ceil(seconds * sampleRate);
  const oc = new OfflineAudioContext(2, len, sampleRate);
  const sc = new Soundscape(oc, oc.destination, { seed, path });
  sc.start(0);

  /* A scripted walk, so footsteps and wall proximity are exercised rather than
     asserted. Standing still is the default state, which is the honest one. */
  const segments = walk || [[14, 22], [58, 16], [92, 19]];  // [start, duration]
  const walking = (t) => segments.some(([a, d]) => t >= a && t < a + d);

  const DT = 1 / 30;
  const st = { x: 0, z: 0, speed: 0, dt: DT, u: 0 };
  let dist = 0;
  const p = new THREE.Vector3();
  for (let t = 0; t < seconds; t += DT) {
    const sp = walking(t) ? 1.45 : 0;
    dist += sp * DT;
    if (path) {
      path.posAt(dist, p);
      st.x = p.x; st.z = p.z;
      st.u = 0.9 * Math.sin(dist * 0.11);   // drifting off the centreline
    } else {
      st.x = 0.9 * Math.sin(dist * 0.11);
      st.z = -dist;
      st.u = st.x;
    }
    st.speed = sp;
    /* Listener rides with the walk; the offline context has no Object3D graph
       to do it, so set the AudioListener parameters directly. */
    oc.listener.positionX.setValueAtTime(st.x, t);
    oc.listener.positionY.setValueAtTime(1.65, t);
    oc.listener.positionZ.setValueAtTime(st.z, t);
    sc.update(t, st);
  }

  const buf = await oc.startRendering();
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

  let peakL = 0, peakR = 0, dcL = 0, dcR = 0, clipped = 0, sumsq = 0;
  for (let i = 0; i < len; i++) {
    const a = L[i], b = R[i];
    const aa = Math.abs(a), ab = Math.abs(b);
    if (aa > peakL) peakL = aa;
    if (ab > peakR) peakR = ab;
    dcL += a; dcR += b;
    if (aa >= 0.999 || ab >= 0.999) clipped++;
    sumsq += (a * a + b * b) * 0.5;
  }

  // Mono downmix at a scale that puts the true peak just under full Int16.
  const peak = Math.max(peakL, peakR, 1e-9);
  const scale = Math.min(32000 / peak, 1e7);
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const v = (L[i] + R[i]) * 0.5 * scale;
    pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0;
  }

  // base64 in chunks; a single fromCharCode over three million samples blows
  // the argument limit.
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }

  return {
    seconds, sampleRate, length: len, scale,
    peakL, peakR, clipped,
    dcL: dcL / len, dcR: dcR / len,
    rms: Math.sqrt(sumsq / len),
    segments,
    gusts: sc.gusts.filter(g => g.t0 < seconds).map(g => ({
      t: +g.t0.toFixed(2), dur: +g.dur.toFixed(2), peak: +g.peak.toFixed(3),
    })),
    coyotes: sc.coyotes.filter(c => c.t0 < seconds).map(c => +c.t0.toFixed(2)),
    pcm: btoa(bin),
  };
}
