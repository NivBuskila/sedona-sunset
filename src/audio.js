/* Sedona Sunset — System 6: sound design.
 *
 * The brief is one sentence: "the quiet is the feature". So this is not an
 * ambience bed with events sprinkled on it; it is a mostly-empty timeline with
 * a wind bed sitting far enough down that you only notice it when it moves.
 * Everything is synthesized — looping noise buffers, a handful of oscillators
 * with designed harmonic spectra, and two procedurally generated impulse
 * responses. There are no sample files and nothing is fetched.
 *
 * Three structural decisions drive the whole file:
 *
 *   · Nothing is allocated per event. Web Audio's BufferSourceNode is
 *     single-shot, which is the usual reason ambience systems build a small
 *     graph per grain and then spend their frame budget in the garbage
 *     collector. Instead every sound source here is a long-lived node whose
 *     gain sits at zero, and an "event" is a handful of automation points
 *     written onto parameters that already exist.
 *
 *   · `update()` takes an absolute time rather than reading `ctx.currentTime`,
 *     and every event is scheduled at an absolute time ahead of the playhead.
 *     That is what lets the identical graph and the identical scheduling code
 *     run inside an OfflineAudioContext at many times real speed, which is how
 *     tools/audioprobe.mjs measures this system. The thing being measured is
 *     the thing that ships, not a re-implementation of it.
 *
 *   · The wind is not one noise source under one gain. It is four band voices
 *     — rush, body, hiss and air — each with its own onset threshold, lag,
 *     duration and slow drift, and each gust picks a *character* that decides
 *     which of them dominates. This is the difference between air finding
 *     surfaces and a volume knob on a hiss, and it is measurable: see the
 *     inter-band correlation matrix the probe prints. A shared gain node makes
 *     that matrix flat, which is what the first version of this file did.
 *
 * The wind is the authority for weather: `windAt(t)` is analytic and public, so
 * System 5's wind-blown sand can be driven from the same gust envelope, the
 * same direction and the same hiss-band drive that the sound is using, rather
 * than a second wind that disagrees with the first.
 */
import * as THREE from 'three';

const SEED = 0x5ed04a;

/* World-space heading the wind blows *toward*, in radians, measured the same
   way as WashPath: 0 means +Z, which is down-wash, away from the sun. So the
   wind comes up the wash at your face and the drifted sand piles on the
   up-wash faces of the clasts, which is what System 1 already drew. */
const WIND_HEADING = 0.12;

/* Half-width of the wash, used to turn lateral offset into "how close are the
   walls", which drives the wet/dry balance and the edge tones. Approximate on
   purpose — the reverb wants a trend, not a measurement. */
const WASH_HALF = 13;

/* Footstep bus trim. The perspective of a first-person walk is set by exactly
   two numbers — this one and the gust drive below — and they are deliberately
   moved together in opposite directions. Raising the boots alone would lift the
   overall level, which is the one thing this piece cannot afford; lowering the
   gusts alone would leave a hard gust reading as a breeze against the bed. Half
   the correction each way puts the boots in front of the weather and leaves the
   sum where it was. Note that neither number touches the bed floors, so the
   eighty per cent of the take that is quiet is unaffected by either. */
const FEET = 1.41;

/* The bed's high-frequency floor, as one number. It used to be written twice —
   once where the band is built and once where it is scheduled every frame — and
   the scheduler's copy silently won, so changing the constructor's value moved
   the full-take band RMS (which the scheduler does not reach at render start)
   without moving the bed spectrum at all. */
const AIR_FLOOR = 0.0043;

const TAU = Math.PI * 2;

/* Frequencies the rock edges sing at. A fixed ladder rather than a fresh
   random number per gust: a resonance is a property of a place, so the same
   ledge whistling twice should whistle at the same pitch. That also makes the
   feature falsifiable — the probe looks for narrow peaks that recur, and
   randomising the frequency every time would guarantee it never finds any. */
const EDGE_LADDER = [880, 1180, 1560, 2050, 2700, 3400];

/* Harmonic spectra, as amplitudes indexed by harmonic number.
 *
 * These are the whole answer to "oscillator or voice". A canid howl carries
 * four to eight partials within about twenty decibels and the fundamental is
 * often not the strongest; two detuned saws through a low lowpass gives two
 * partials and a cliff. A designed PeriodicWave costs exactly the same as a
 * sawtooth to run and gets the ratio-locking for free, so there is no reason
 * to approximate this with filters. */
const HARM = {
  howl: [0, 0.75, 1.00, 0.66, 0.46, 0.31, 0.20, 0.13, 0.085, 0.05],
  yip: [0, 0.62, 1.00, 0.88, 0.66, 0.47, 0.33, 0.22, 0.15, 0.10],
  /* A canyon wren is nearly a pure whistle, but nearly is not exactly: at h2
     fourteen decibels down the second partial fell under any usable analysis
     floor and each note measured as a lone sinusoid, which reads as a
     synthesizer blip rather than a bird. Nine decibels down is still a whistle
     and is visible. */
  wren: [0, 1.00, 0.35, 0.13, 0.05, 0.02],
  raven: [0, 0.85, 1.00, 0.90, 0.72, 0.58, 0.44, 0.33, 0.25, 0.18, 0.13, 0.09],
};

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

/** Smooth 0..1 with zero slope at both ends. */
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/* ── procedural buffers ────────────────────────────────────────────────── */

/**
 * Loopable noise, either pink or white.
 *
 * White noise loops audibly: the discontinuity at the wrap is a click, and
 * with a low-frequency-heavy spectrum it is a thump. Generating `n + fade`
 * samples and cross-fading the surplus back over the head makes sample n-1
 * continuous with sample 0, so the loop point is inaudible even though the
 * buffer is only a few seconds long.
 *
 * Both colours are needed. Pink is right for the low rush and the body, where
 * the energy really is concentrated at the bottom. It is wrong for the hiss and
 * for sand: pink noise has so little energy above two kilohertz that a band
 * gain large enough to be audible up there is large enough to boom, which is
 * why the first version of this file measured a 2–6 kHz band thirty decibels
 * below its 120–500 Hz band whatever the gust was doing.
 */
function noiseBuffer(ctx, rand, seconds, { pink = true, rms = 0.2 } = {}) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const fade = Math.floor(0.12 * sr);
  const gen = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < gen.length; i++) {
    const w = rand() * 2 - 1;
    if (!pink) { gen[i] = w; continue; }
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
  /* An IIR-generated pink cascade carries a small DC term, and DC in a looping
     buffer becomes a permanent offset on the master bus: inaudible, still
     wrong, and it shows up in the probe's hygiene check. */
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let s = 0;
  for (let i = 0; i < n; i++) { out[i] -= mean; s += out[i] * out[i]; }
  const g = rms / (Math.sqrt(s / n) || 1);
  for (let i = 0; i < n; i++) out[i] *= g;

  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(out, 0);
  return buf;
}

/**
 * Grains: very short exponentially-decaying noise bursts at random times.
 * Filtered, this is what granular material actually sounds like — a lot of tiny
 * uncorrelated impacts, not a hiss.
 *
 * Density is the whole character. Sparse, you hear individual grains ticking,
 * which is right for sand trickling down a bank. Dense, the impacts overlap
 * into a crunch, which is right for a boot: a footfall displaces hundreds of
 * clasts at once, not a dozen. Density also sets the crest factor, and that
 * matters for the mix as much as for the timbre — at a low density the peaks
 * are single grains standing twenty decibels over the mean, so any gain that
 * makes the crunch audible makes the peaks enormous.
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
  const tail = Math.floor(0.04 * sr);
  for (let i = n - tail; i < n; i++) out[i] *= (n - i) / tail;
  /* Sparse grains are zero-mean only in expectation; a few hundred of them
     leave a measurable offset, and a looping buffer turns that into a
     permanent one on the master bus. */
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  let peak = 0;
  for (let i = 0; i < n; i++) { out[i] -= mean; peak = Math.max(peak, Math.abs(out[i])); }
  const g = 0.8 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;

  const buf = ctx.createBuffer(1, n, sr);
  buf.copyToChannel(out, 0);
  return buf;
}

/**
 * The near field: a sandy channel with banks a few metres away.
 *
 * Short and dark. A handful of early reflections off the cut banks and the
 * boulders, then a tail that is done inside half a second, because there is no
 * enclosure — the wash is open to the sky and most of the energy leaves
 * upwards rather than bouncing. Used for wind, sand and footsteps, at a low
 * wet level; its job is to stop those sounds being anechoic, not to be heard.
 */
function washIR(ctx, rand, seconds = 0.9) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const banks = [2.6, 4.1, 5.8, 7.5, 9.9, 13.0, 17.5, 23.0];
  for (let c = 0; c < 2; c++) {
    const out = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t / 0.115);
      const fc = 5200 * Math.exp(-t / 0.20) + 520;
      const a = 1 - Math.exp(-TAU * fc / sr);
      lp += a * ((rand() * 2 - 1) - lp);
      out[i] = lp * env;
    }
    for (const d0 of banks) {
      const d = d0 * (1 + (c ? 0.07 : -0.07) * (0.6 + rand() * 0.8));
      const at = Math.floor((d / 343) * sr);
      const amp = (0.7 / (1 + d * 0.25)) * (0.6 + rand() * 0.7) * (rand() < 0.5 ? -1 : 1);
      const len = Math.floor(sr * (0.0015 + rand() * 0.003));
      for (let i = 0; i < len && at + i < n; i++) {
        out[at + i] += (rand() * 2 - 1) * amp * (1 - i / len);
      }
    }
    const pre = Math.floor(sr * 0.004);
    for (let i = 0; i < pre; i++) out[i] *= i / pre;
    /* A one-pole lowpass on noise has a DC term, and an impulse response with
       DC turns every input offset into an output offset. */
    let mean = 0;
    for (let i = 0; i < n; i++) mean += out[i];
    mean /= n;
    let s = 0;
    for (let i = 0; i < n; i++) { out[i] -= mean; s += out[i] * out[i]; }
    /* Unit L2 norm, which is the only normalisation that makes a send level
       mean anything: a broadband input comes out at the same RMS it went in,
       so `send × wet` is the wet/dry ratio and nothing else. */
    const g = 1 / (Math.sqrt(s) || 1);
    for (let i = 0; i < n; i++) out[i] *= g;
    buf.copyToChannel(out, c);
  }
  return buf;
}

/**
 * The far field: red-rock walls a few hundred metres off.
 *
 * This is deliberately *not* a reverb. An open-topped canyon has no enclosure
 * and therefore no diffuse field to build up; what comes back from a sound half
 * a kilometre away is two or three discrete slaps off the big faces, each one
 * duller and quieter than the last, and then nothing at all. Modelling that as
 * an exponentially decaying noise tail — which is what the first version of
 * this file did — produces a six-second RT60, which is a stone cathedral.
 *
 * So: silence, then three arrivals at path lengths of roughly 210, 390 and
 * 590 metres, each a short diffuse burst with its own progressively lower
 * lowpass, and genuine near-silence between them.
 */
function canyonEchoIR(ctx, rand, seconds = 2.1) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  // [delay s, level, cutoff Hz, spread s]
  const slaps = [
    [0.62, 1.00, 1500, 0.075],
    [1.14, 0.58, 900, 0.100],
    [1.71, 0.30, 540, 0.130],
  ];
  for (let c = 0; c < 2; c++) {
    const out = new Float32Array(n);
    for (const [d0, lvl, fc, spread] of slaps) {
      // A few metres of path difference between the ears at this range is
      // nothing; the decorrelation that matters is in the scattering.
      const at = Math.floor((d0 * (1 + (c ? 0.004 : -0.004))) * sr);
      const len = Math.floor(spread * sr);
      let lp = 0;
      const a = 1 - Math.exp(-TAU * fc / sr);
      for (let i = 0; i < len && at + i < n; i++) {
        lp += a * ((rand() * 2 - 1) - lp);
        // Rises over a couple of milliseconds, then decays inside the spread:
        // a broken rock face scatters, it does not ring.
        const rise = Math.min(1, i / (sr * 0.004));
        out[at + i] += lp * lvl * rise * Math.exp(-i / (len * 0.34));
      }
    }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += out[i];
    mean /= n;
    let s = 0;
    for (let i = 0; i < n; i++) { out[i] -= mean; s += out[i] * out[i]; }
    const g = 1 / (Math.sqrt(s) || 1);
    for (let i = 0; i < n; i++) out[i] *= g;
    buf.copyToChannel(out, c);
  }
  return buf;
}

/* ── voices ────────────────────────────────────────────────────────────── */

/**
 * A distant animal.
 *
 * One chain: two oscillators sharing a designed harmonic spectrum (detuned so
 * the voice has the roughness of a real larynx rather than the purity of a
 * synthesiser), a second oscillator carrying a brighter spectrum for the short
 * calls, a formant peak, then the distance filters, then a direct path plus a
 * send to the canyon slapback.
 *
 * The distance filters are the part worth being careful about. ISO 9613 air
 * absorption at Sedona conditions costs about 29 dB more at 4 kHz than at
 * 500 Hz over half a kilometre, but it costs only about 2 dB between 1.05 and
 * 1.58 kHz. So the received spectrum has to roll off hard at the top while
 * staying nearly flat across the low harmonics — a gentle lowpass plus a high
 * shelf, not a steep lowpass with its corner sitting between h2 and h3.
 */
class Canid {
  constructor(ctx, out, echo, harmA, harmB) {
    const g = (v) => { const nd = ctx.createGain(); nd.gain.value = v; return nd; };
    this.ctx = ctx;
    this.mix = g(1);

    const waveA = ctx.createPeriodicWave(
      new Float32Array(harmA.length), Float32Array.from(harmA), { disableNormalization: false });
    const waveB = ctx.createPeriodicWave(
      new Float32Array(harmB.length), Float32Array.from(harmB), { disableNormalization: false });

    /* Separate oscillators per timbre rather than one with setPeriodicWave.
       setPeriodicWave is not schedulable — it applies the moment it is called —
       so in an offline render, where every event is scheduled before rendering
       starts, the last call would win for the entire take. */
    this.oscA = ctx.createOscillator(); this.oscA.setPeriodicWave(waveA);
    this.oscB = ctx.createOscillator(); this.oscB.setPeriodicWave(waveA);
    this.oscB.detune.value = 8;
    this.oscY = ctx.createOscillator(); this.oscY.setPeriodicWave(waveB);
    this.sustain = g(0);
    this.short = g(0);
    this.oscA.connect(this.sustain);
    this.oscB.connect(this.sustain);
    this.oscY.connect(this.short);
    this.sustain.connect(this.mix);
    this.short.connect(this.mix);

    this.formant = ctx.createBiquadFilter();
    this.formant.type = 'peaking';
    this.formant.frequency.value = 820; this.formant.Q.value = 1.4; this.formant.gain.value = 5;

    /* Three gentle stages rather than one steep one. A single lowpass with its
       corner between h2 and h3 puts a 24 dB cliff in the middle of the voice,
       which is wrong twice over: air absorption between 1.05 and 1.58 kHz is
       about two decibels, and it is 4 kHz and above that half a kilometre of
       desert air really destroys. So: nearly flat across the low harmonics,
       falling steadily, and thirty decibels down by four kilohertz. */
    this.airLP = ctx.createBiquadFilter();
    this.airLP.type = 'lowpass'; this.airLP.frequency.value = 2600; this.airLP.Q.value = 0.4;
    this.airLP2 = ctx.createBiquadFilter();
    this.airLP2.type = 'lowpass'; this.airLP2.frequency.value = 3800; this.airLP2.Q.value = 0.7;
    this.airShelf = ctx.createBiquadFilter();
    this.airShelf.type = 'highshelf'; this.airShelf.frequency.value = 3600;
    this.airShelf.gain.value = -21;

    this.level = g(0);
    this.pan = ctx.createPanner();
    this.pan.panningModel = 'equalpower';
    this.pan.distanceModel = 'inverse';
    this.pan.refDistance = 40; this.pan.maxDistance = 6000; this.pan.rolloffFactor = 0;
    this.pan.positionX.value = 0; this.pan.positionY.value = 10; this.pan.positionZ.value = -400;

    this.mix.connect(this.formant).connect(this.airLP).connect(this.airLP2)
      .connect(this.airShelf).connect(this.level).connect(this.pan);
    /* A direct path, and it is the loudest arrival. At half a kilometre across
       open desert there is nothing between you and the animal; the earlier
       fully-wet routing put the echo in front of the sound that caused it. */
    this.pan.connect(out);
    this.echoSend = g(0.55);
    this.pan.connect(this.echoSend).connect(echo);
  }

  start(t0) {
    this.oscA.start(t0); this.oscB.start(t0); this.oscY.start(t0);
  }

  place(t, bearing, distance, height = 14) {
    const at = Math.max(0, t);
    this.pan.positionX.setValueAtTime(Math.sin(bearing) * distance, at);
    this.pan.positionY.setValueAtTime(height, at);
    this.pan.positionZ.setValueAtTime(Math.cos(bearing) * distance, at);
  }
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
   * @param {{seed?:number, path?:object, quiet?:boolean}} opts
   */
  constructor(ctx, out, opts = {}) {
    this.ctx = ctx;
    this.path = opts.path || null;
    this.seed = opts.seed === undefined ? SEED : opts.seed;
    /* `quiet` suppresses the random schedule so that a forced-event render
       measures one thing at a time. */
    this.quiet = !!opts.quiet;
    const rand = this.rand = mulberry32(this.seed);
    this.erand = mulberry32(this.seed ^ 0x9e3779b9);

    /* Two independent buffers per colour. The wind's stereo image is built by
       feeding the left and right filter chains from genuinely different noise
       rather than by panning one source, which is both a better image and the
       only way to guarantee the channels are balanced — the earlier panned
       version ran the left channel 2.8 dB hot because correlated sources at
       different pan positions do not cancel. */
    this.pinkL = noiseBuffer(ctx, rand, 11.3, { pink: true });
    this.pinkR = noiseBuffer(ctx, rand, 11.3, { pink: true });
    this.whiteL = noiseBuffer(ctx, rand, 7.9, { pink: false, rms: 0.2 });
    this.whiteR = noiseBuffer(ctx, rand, 7.9, { pink: false, rms: 0.2 });
    this.grain = grainNoise(ctx, rand, 6.7, 130);
    this.grainFine = grainNoise(ctx, rand, 5.3, 850);

    const g = (v) => { const nd = ctx.createGain(); nd.gain.value = v; return nd; };
    const bq = (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; if (q !== undefined) f.Q.value = q;
      return f;
    };
    const sp = (pan) => { const p = ctx.createStereoPanner(); p.pan.value = pan; return p; };
    const loop = (buffer, offset, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer; s.loop = true; s.playbackRate.value = rate;
      s._offset = offset;
      return s;
    };
    this._g = g; this._bq = bq;

    /* master ------------------------------------------------------------ */
    this.master = g(1);
    /* Purely a seatbelt. Everything here runs well below the threshold, so the
       compressor never engages; it exists so that a future mistake in a gain
       envelope cannot ship a clipped frame. */
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -3;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp).connect(out);

    this.dry = g(1);
    this.dry.connect(this.master);

    /* `normalize` before `buffer`, not after. Setting it afterwards has no
       effect until the next buffer assignment, so the convolver silently keeps
       the implementation's own equal-power scaling — which is roughly sane, and
       therefore hides the mistake, but it means every send level in this file
       would have been calibrated against a number the spec does not define. */
    this.wash = ctx.createConvolver();
    this.wash.normalize = false;
    this.wash.buffer = washIR(ctx, rand);
    this.washWet = g(1.0);
    this.wash.connect(this.washWet).connect(this.master);

    this.echo = ctx.createConvolver();
    this.echo.normalize = false;
    this.echo.buffer = canyonEchoIR(ctx, rand);
    this.echoWet = g(1.0);
    this.echo.connect(this.echoWet).connect(this.master);

    /* sources ----------------------------------------------------------- */
    this.srcs = [];
    const src = (buf, off, rate) => { const s = loop(buf, off, rate); this.srcs.push(s); return s; };
    const pkL = src(this.pinkL, 0), pkR = src(this.pinkR, 1.7);
    const pk2L = src(this.pinkL, 5.3, 0.93), pk2R = src(this.pinkR, 7.9, 1.07);
    const whL = src(this.whiteL, 0), whR = src(this.whiteR, 2.9);
    const wh2L = src(this.whiteL, 4.4), wh2R = src(this.whiteR, 6.1);
    this.gSand = src(this.grain, 0);
    this.gStep = src(this.grainFine, 2.3);
    this.nRoom = src(this.pinkR, 3.4, 0.87);

    /* ── the wind, as four band voices ──────────────────────────────────
       Each band is a stereo pair of filters fed from independent noise,
       merged, and controlled by exactly one gain. The bands share nothing but
       the weather. */
    this.windBus = g(1);
    this.windBus.connect(this.dry);
    this.windSend = g(0.34);
    this.windBus.connect(this.windSend).connect(this.wash);
    /* A big gust rolling down the wash does come back off the far walls, so
       the rush band gets a little of the slapback. Gated on the gust, since
       still air has nothing to send. */
    this.windEcho = g(0);
    this.windBus.connect(this.windEcho).connect(this.echo);

    const band = (lSrc, rSrc, type, freq, q, gain) => {
      const fL = bq(type, freq, q), fR = bq(type, freq, q);
      const m = ctx.createChannelMerger(2);
      lSrc.connect(fL); rSrc.connect(fR);
      fL.connect(m, 0, 0); fR.connect(m, 0, 1);
      const gn = g(gain);
      m.connect(gn).connect(this.windBus);
      return { fL, fR, gain: gn };
    };

    // Low broadband rush. Highpassed first: below about 70 Hz there is nothing
    // but headroom being eaten.
    const hpL = bq('highpass', 72, 0.7), hpR = bq('highpass', 72, 0.7);
    pkL.connect(hpL); pkR.connect(hpR);
    this.rush = band(hpL, hpR, 'lowpass', 220, 0.7, 0);
    // Mid body. Sources swapped left for right relative to the rush, so the
    // two bands are not the same noise in the same ear.
    this.body = band(pk2R, pk2L, 'bandpass', 470, 0.75, 0);
    // Hiss: white, because pink has nothing up here to amplify.
    this.hiss = band(whL, whR, 'bandpass', 2200, 0.5, 0);
    /* Rasp: the very top of the wind, off needles and sharp edges. Its own
       band rather than the top of the hiss because one wide bandpass locks
       2 kHz to 4 kHz however carefully the gain is drawn — and a locked pair
       an octave apart is exactly the artefact the band split exists to remove. */
    this.rasp = band(wh2R, wh2L, 'bandpass', 4200, 0.6, 0);
    /* Air: the bed's high-frequency floor, and the thing that says "outdoors".
       Real desert quiet is not quiet up here. It is a fine continuous hiss off
       sand, dry grass and juniper needles with the far-field insect floor under
       it, and that hiss is most of what tells the ear the space is open. Without
       it the whole piece reads as a filtered rumble with events on top rather
       than as a place.
       This band was previously forty-odd decibels under the rush and cornered at
       5.2 kHz, which put it about one decibel above the measurement floor: a
       number that improved twice without the condition ever improving once,
       because both values were silence. It is sixteen decibels louder now and
       corners more than an octave lower, so the whole 3-12 kHz span has a real
       floor instead of a censored one. It is still thirty decibels under the
       rush and it does not move the overall level — but it is now audible, which
       was the entire point. */
    this.air = band(wh2L, wh2R, 'highpass', 3000, 0.55, AIR_FLOOR);
    /* Tilted, not cut, and only slightly. The natural outdoor spectrum falls
       through the mid and then flattens out across the top two octaves rather
       than continuing down, so the target is a shallow plateau from about three
       kilohertz to Nyquist sitting a couple of decibels over the minimum near
       one kilohertz. Overshooting this is its own defect: a first pass put
       2.8 kHz seven decibels *above* 1 kHz, which is a hump, and a hump up there
       reads as tape hiss rather than as open air. A lowpass corner anywhere near
       the render's Nyquist is worse still — it collapses the top of the band,
       which reads as "the bed dies above ten kilohertz", the original defect one
       octave higher. */
    this.airTilt = bq('highshelf', 4200);
    this.airTilt.gain.value = -1.8;
    this.air.gain.disconnect();
    this.air.gain.connect(this.airTilt).connect(this.windBus);
    /* And one barely-there narrow band in the insect register, breathing on a
       half-minute cycle so the floor is not a flat hiss. */
    this.stridul = band(wh2R, wh2L, 'bandpass', 4600, 7, 0);

    /* Rock-edge tones. Panned hard and opposite, with the stronger of the two
       alternating sides gust by gust so the stereo image stays balanced over
       time. */
    /* Q of fifty-odd, not sixteen. Two reasons, and they point the same way.
       Physically, vortex shedding off a hard lip is a fairly pure tone, not a
       band of noise. Practically, a Q of 16 at 1560 Hz is a hundred hertz wide,
       which is a third of a third-octave band, so the filter's own skirts land
       inside any third-octave reference window and the tone cannot measure as
       prominent however loud it is made — prominence saturates around three
       decibels and raising the level just makes the gust brighter. Narrowing
       the band raises the prominence and *lowers* the energy, which is the rare
       change that improves the measurement and the mix at once. */
    this.edge1 = bq('bandpass', 1560, 55);
    this.eg1 = g(0);
    whL.connect(this.edge1).connect(this.eg1).connect(sp(-0.62)).connect(this.windBus);
    this.edge2 = bq('bandpass', 2700, 70);
    this.eg2 = g(0);
    whR.connect(this.edge2).connect(this.eg2).connect(sp(0.62)).connect(this.windBus);
    /* Loud enough to stand about ten decibels over the broadband at their own
       frequency. The earlier version had them roughly one decibel over, which
       is to say they were not there: a search for narrow peaks with more than
       1.5 dB prominence found nothing recurring. An aeolian tone off a rock lip
       is a clear whistle, not a hint of one.
       Equal levels on the two sides, deliberately. Two lips at genuinely
       different distances would differ in level, but over a two-minute take
       with three gusts that difference does not average out, and it is what
       left the earlier mix running three decibels hot on the left. The stereo
       interest is carried by the two different pitches instead, which costs
       nothing and cannot unbalance anything. */
    this.edgeLvl = 2.0;

    /* room tone --------------------------------------------------------- */
    this.rtLP = bq('lowpass', 105, 0.6);
    this.rtGain = g(0.0016);
    this.nRoom.connect(this.rtLP).connect(this.rtGain).connect(this.dry);

    /* sand -------------------------------------------------------------- */
    this.sandPan = ctx.createPanner();
    this.sandPan.panningModel = 'equalpower';
    this.sandPan.distanceModel = 'inverse';
    this.sandPan.refDistance = 3; this.sandPan.maxDistance = 45; this.sandPan.rolloffFactor = 1;
    this.sandPan.positionX.value = 0; this.sandPan.positionY.value = 0;
    this.sandPan.positionZ.value = -4;
    this.sandBP = bq('bandpass', 2600, 1.0);
    this.sandGain = g(0);
    wh2L.connect(this.sandBP).connect(this.sandGain).connect(this.sandPan);
    this.trickleBP = bq('bandpass', 3600, 1.5);
    this.trickleGain = g(0);
    this.gSand.connect(this.trickleBP).connect(this.trickleGain).connect(this.sandPan);
    this.sandPan.connect(this.dry);
    this.sandSend = g(0.45);
    this.sandPan.connect(this.sandSend).connect(this.wash);

    /* footsteps --------------------------------------------------------- */
    this.stepPan = sp(0);
    this.stepLP = bq('lowpass', 620, 0.9);
    /* A boot on sand has a body around two to five hundred hertz and nothing
       below a hundred. Lowpassed pink noise has most of its energy in the
       bottom octave by construction, so the footstep layer was spending the
       majority of its power under 100 Hz — inaudible on anything, but counted
       in full by every RMS measurement. Highpassing first is what makes it
       possible to put the boots in front of the weather, which is a question
       about the 300 Hz-3 kHz band, without moving the overall level, which is
       a question about total power. */
    this.stepHP = bq('highpass', 115, 0.7);
    this.stepGain = g(0);
    pk2L.connect(this.stepHP).connect(this.stepLP).connect(this.stepGain)
      .connect(this.stepPan);
    this.crunchBP = bq('bandpass', 1900, 1.1);
    this.crunchGain = g(0);
    this.gStep.connect(this.crunchBP).connect(this.crunchGain).connect(this.stepPan);
    /* Kicked stones get their own voice so a pebble can land after the step
       that launched it without truncating its envelope. */
    this.pebbleBP = bq('bandpass', 4200, 2.2);
    this.pebbleGain = g(0);
    whR.connect(this.pebbleBP).connect(this.pebbleGain).connect(this.stepPan);
    /* One gain for the whole foot, downstream of the pan, so the perspective
       question — are my own boots louder than the weather? — has a single
       answer in a single place rather than being spread across four burst
       amplitudes that have to be kept in step with each other. */
    this.feet = g(FEET);
    this.stepPan.connect(this.feet).connect(this.dry);
    this.stepSend = g(0.22);
    this.feet.connect(this.stepSend).connect(this.wash);

    /* ── slapback off the walls ──
       The one thing that most says "I am standing between rock faces" is that
       every transient you make comes back to you a fraction of a second later.
       Without it each footstep died in place: eleven decibels down inside the
       first frame and at the local background by a quarter of a second, which is
       an anechoic chamber, not a wash.
       Four discrete taps, and the levels are derived rather than dialled. A
       reflector D away puts the reflected path at 2D against a direct path of
       about 1.6 m from boot to ears, so the spherical spreading loss is
       20·log10(2D/1.6); rough sandstone at a glancing angle costs another four
       or five decibels, and the far tap loses a couple more to air absorption
       over ninety metres. That arithmetic is the whole design, and it is worth
       stating what it rules out: a slap ten decibels under your own boot would
       need a reflector about two metres away. At the distance a butte actually
       is, the honest answer is thirty to forty decibels down — which lands the
       near taps just above the bed and the far tap just under it, so they are
       heard as space rather than as echo. That is what this sounds like
       outdoors, and it is why the effect has to be built from geometry: dialled
       by ear it comes out either inaudible or theatrical.
       Delays are fixed because the wash's dimensions are fixed. Only the level
       tracks the player, via `prox` below. */
    this.slap = g(1);
    this.feet.connect(this.slap);
    /* Only the very bottom is removed. A rock face tens of metres across is an
       acoustically large mirror for anything above a couple of hundred hertz, so
       the step's body does come back; what does not is the sub-100 Hz thump,
       which is mostly ground-borne and arrives as mud. */
    this.slapHP = bq('highpass', 180, 0.7);
    this.slap.connect(this.slapHP);
    /* Eight returns, not two.
       Four discrete taps put the audible part of the effect inside the first
       hundred and fifty milliseconds and nothing after it, which is honest about
       the spreading loss but wrong about the place: a wash is not two parallel
       mirrors. It is a channel with a cut bank on one side, a gravel terrace on
       the other, boulders, juniper, and a butte face standing back from all of
       it. Every one of those returns something, and their arrivals overlap.
       Filling in the twenty-to-thirty-five-metre range with the scatterers that
       are actually there raises the hundred-to-two-hundred-and-fifty millisecond
       region by a few decibels without any single reflection being louder than
       geometry allows — which is the difference between a slap and a space. */
    for (const [D, lp, pan] of [[13.0, 8500, -0.70], [15.6, 8000, 0.75],
      [19.0, 7000, 0.55], [22.0, 6800, -0.45],
      [26.0, 6000, 0.35], [31.0, 5200, -0.55],
      [35.0, 4600, 0.60], [45.0, 3800, -0.30]]) {
      const path = 2 * D;
      /* Spreading, reflection loss, and air absorption over the extra path.
         Two decibels of reflection loss rather than four: a butte face is not a
         point mirror, it is a large rough surface, so what comes back is the
         specular return plus everything the whole face scatters, integrated over
         an area far bigger than the first Fresnel zone. */
      const lossDb = 20 * Math.log10(path / 1.6) + 1.8 + path * 0.022;
      const d = ctx.createDelay(1.0);
      d.delayTime.value = path / 343;
      const f = bq('lowpass', lp, 0.7);
      this.slapHP.connect(d).connect(f)
        .connect(g(Math.pow(10, -lossDb / 20))).connect(sp(pan)).connect(this.master);
    }

    /* animals ----------------------------------------------------------- */
    this.coyA = new Canid(ctx, this.dry, this.echo, HARM.howl, HARM.yip);
    this.coyB = new Canid(ctx, this.dry, this.echo, HARM.howl, HARM.yip);
    /* One vibrato oscillator, two depth gains: the waver is per-animal but the
       oscillator is shared, because two animals wavering at exactly the same
       rate is inaudible and one fewer node is one fewer node. */
    this.vib = ctx.createOscillator(); this.vib.type = 'sine'; this.vib.frequency.value = 5.4;
    this.vibA = g(0); this.vibB = g(0);
    this.vib.connect(this.vibA); this.vib.connect(this.vibB);
    this.vibA.connect(this.coyA.oscA.frequency);
    this.vibA.connect(this.coyA.oscB.frequency);
    this.vibB.connect(this.coyB.oscA.frequency);
    this.vibB.connect(this.coyB.oscB.frequency);

    /* Canyon wren: the descending cascade is the signature sound of red rock
       country and it is sung at dusk. Nearly a pure whistle, so a simple
       harmonic spectrum and a much gentler distance filter than the coyote —
       this bird is a couple of hundred metres away, not half a kilometre. */
    this.wren = ctx.createOscillator();
    this.wren.setPeriodicWave(ctx.createPeriodicWave(
      new Float32Array(HARM.wren.length), Float32Array.from(HARM.wren),
      { disableNormalization: false }));
    this.wrenGain = g(0);
    this.wrenLP = bq('lowpass', 7000, 0.6);
    this.wrenPan = ctx.createPanner();
    this.wrenPan.panningModel = 'equalpower';
    this.wrenPan.distanceModel = 'inverse';
    this.wrenPan.refDistance = 30; this.wrenPan.maxDistance = 2000; this.wrenPan.rolloffFactor = 0;
    this.wrenPan.positionZ.value = -160;
    this.wren.connect(this.wrenGain).connect(this.wrenLP).connect(this.wrenPan);
    this.wrenPan.connect(this.dry);
    /* Down from 0.30. At that send the two-second canyon impulse response kept
       repeating the cascade's last note for another three seconds, so the
       gesture stopped and the sound did not. A bird two hundred metres out
       across open air gets much less return relative to its direct path than a
       boot beside a bank does. */
    this.wrenEcho = g(0.11);
    this.wrenPan.connect(this.wrenEcho).connect(this.echo);

    /* Raven: a croak is a harsh harmonic stack chopped by a roughness in the
       hundred-hertz region, which is amplitude modulation and not a filter. */
    this.raven = ctx.createOscillator();
    this.raven.setPeriodicWave(ctx.createPeriodicWave(
      new Float32Array(HARM.raven.length), Float32Array.from(HARM.raven),
      { disableNormalization: false }));
    this.ravenAM = g(0.55);
    this.ravenLFO = ctx.createOscillator();
    this.ravenLFO.type = 'sine'; this.ravenLFO.frequency.value = 108;
    this.ravenDepth = g(0.45);
    this.ravenLFO.connect(this.ravenDepth).connect(this.ravenAM.gain);
    this.ravenGain = g(0);
    this.ravenLP = bq('lowpass', 2100, 0.5);
    this.ravenShelf = bq('highshelf', 2000);
    this.ravenShelf.gain.value = -14;
    this.ravenPan = ctx.createPanner();
    this.ravenPan.panningModel = 'equalpower';
    this.ravenPan.distanceModel = 'inverse';
    this.ravenPan.refDistance = 40; this.ravenPan.maxDistance = 4000;
    this.ravenPan.rolloffFactor = 0;
    this.ravenPan.positionZ.value = -500;
    this.raven.connect(this.ravenAM).connect(this.ravenGain).connect(this.ravenLP)
      .connect(this.ravenShelf).connect(this.ravenPan);
    this.ravenPan.connect(this.dry);
    this.ravenEcho = g(0.5);
    this.ravenPan.connect(this.ravenEcho).connect(this.echo);

    /* state ------------------------------------------------------------- */
    this.gusts = [];
    this.calls = [];          // {t0, kind, done, …}
    this.gustsTo = 0;
    this.callsTo = { coyote: 0, wren: 0, raven: 0 };
    this.schedHead = 0;
    this.prox = 0.5;
    this.strideAcc = 0;
    this.stepSide = 1;
    this.pause = 0;
    this.started = false;
    this.fired = [];          // what actually got scheduled, for the probe
    this.stepTimes = [];

    this.wind = {
      heading: WIND_HEADING, dirX: Math.sin(WIND_HEADING), dirZ: Math.cos(WIND_HEADING),
      gust: 0, speed: 0.6, base: 0, hiss: 0, rush: 0,
    };
  }

  /** Start every long-lived source. Call once, before any scheduling. */
  start(t0) {
    if (this.started) return;
    this.started = true;
    for (const s of this.srcs) s.start(t0, s._offset % s.buffer.duration);
    this.coyA.start(t0); this.coyB.start(t0);
    this.vib.start(t0);
    this.wren.start(t0);
    this.raven.start(t0); this.ravenLFO.start(t0);
    this.schedHead = t0;
  }

  /* ── weather ─────────────────────────────────────────────────────────── */

  /**
   * Extend the gust list far enough ahead to cover `until`.
   *
   * Each gust gets a character and, independently, a full set of per-band
   * timings. That is what makes two gusts different events rather than the same
   * event at two volumes: one arrives as a low moan that takes six seconds to
   * build, the next is a dry rasp that is on you in half a second and gone
   * before the rumble has started.
   */
  _ensureGusts(until) {
    if (this.quiet) { this.gustsTo = Math.max(this.gustsTo, until); return; }
    while (this.gustsTo < until) {
      const r = this.erand;
      const gap = 11 + r() * 32;
      const t0 = this.gustsTo + gap;
      const dur = 5 + r() * 11;
      /* Bottom-heavy: a strong gust has to stay an event rather than becoming
         a rhythm. */
      const peak = 0.16 + 0.74 * Math.pow(r(), 2.1);
      const gust = this._makeGust(t0, dur, peak);
      this.gusts.push(gust);
      this.gustsTo = t0 + dur;
      if (this.gusts.length > 64) this.gusts.splice(0, 32);
    }
  }

  /**
   * One gust, with a character and an independent per-band response.
   *
   * `char` runs from 0 (a low moan through the wash) to 1 (a dry rasp off a
   * ledge) and sets the *relative* band weights, so the timbre of the wind
   * changes from gust to gust independently of how loud it is. The per-band
   * timings are drawn separately again: one gust's hiss can arrive a second
   * before its rumble and be finished before the rumble peaks, and the next
   * one's need not.
   */
  _makeGust(t0, dur, peak, character) {
    const r = this.erand;
    /* Roughly a third hiss-dominated, a third mixed, a third pure rumble. */
    let char = character;
    if (char === undefined) {
      const cr = r();
      char = cr < 0.34 ? 0.70 + 0.30 * r()
        : cr < 0.70 ? 0.28 + 0.30 * r()
          : 0.02 + 0.22 * r();
    }
    return {
      t0, dur, peak, char,
      turn: (r() * 2 - 1) * 0.5,
      sand: false,
      /* lag is in units of the gust duration; thr is the fraction of the raw
         shape below which this band says nothing; skew bends the rise; scale
         shortens or lengthens the band's own window. */
      b: [
        // rush: heavy air, late and slow, speaks at almost any wind speed
        { thr: 0.02 + r() * 0.08, lag: 0.02 + r() * 0.12, scale: 1.00 + r() * 0.35,
          skew: 0.72 + r() * 0.16, w: 1.05 - 0.80 * char },
        // body: the middle of the wash, roughly in step with the gust
        { thr: 0.06 + r() * 0.12, lag: -0.02 + r() * 0.08, scale: 0.85 + r() * 0.25,
          skew: 0.55 + r() * 0.15, w: 0.55 + 0.75 * (1 - Math.abs(char - 0.5) * 2) },
        // hiss: small-scale turbulence, arrives first, dies early, and needs
        // real wind speed before it exists at all
        { thr: 0.16 + r() * 0.22, lag: -0.10 + r() * 0.12, scale: 0.45 + r() * 0.35,
          skew: 0.28 + r() * 0.20, w: 0.06 + 1.30 * Math.pow(char, 1.5) },
        // rasp: the top of the spectrum. Earlier still, briefer still, and the
        // fussiest about wind speed of the four.
        { thr: 0.24 + r() * 0.26, lag: -0.14 + r() * 0.13, scale: 0.32 + r() * 0.30,
          skew: 0.20 + r() * 0.18, w: 0.04 + 1.10 * Math.pow(char, 1.9) },
      ],
      edge: [
        EDGE_LADDER[(r() * EDGE_LADDER.length) | 0],
        EDGE_LADDER[(r() * EDGE_LADDER.length) | 0],
      ],
      edgeSwap: r() < 0.5,
    };
  }

  /**
   * Slow drift for one band: three independent sines, mostly in the 5–100 s
   * range, with no period shared between bands.
   *
   * This is doing two jobs. It gives the bed movement on the medium timescale —
   * real air swells and subsides over five to thirty seconds, and a bed that
   * holds within two decibels for half a minute reads as a level rather than as
   * a place. And because each band drifts on its own periods, the bands are
   * decorrelated during the *quiet*, not only during gusts.
   */
  _drift(i, t) {
    const P = [
      [26.3, 41.7, 97.1], [17.1, 33.3, 71.3], [9.4, 21.7, 47.3],
      [13.7, 29.9, 61.1], [31.1, 63.7, 151.0],
    ][i];
    const ph = [0.7, 2.4, 4.1, 5.6, 3.2][i];
    return (Math.sin(TAU * t / P[0] + ph) * 0.55 +
            Math.sin(TAU * t / P[1] + ph * 1.7) * 0.30 +
            Math.sin(TAU * t / P[2] + ph * 2.3) * 0.15);
  }

  /**
   * The wind at an absolute time. Analytic, deterministic, and the single
   * source of truth for both the audio and anything visual that has to agree
   * with it.
   *
   * `g` is the overall gust envelope, unchanged in meaning from before. `bg` is
   * the per-band drive, which is what makes the bands independent; `hiss` is
   * the one System 5 wants, because saltation follows small-scale turbulence
   * rather than the bulk flow.
   */
  windAt(t, out) {
    this._ensureGusts(t + 4);
    const base = clamp(
      0.105 + 0.075 * Math.sin(t * 0.0431 + 1.3) + 0.045 * Math.sin(t * 0.0177 + 0.4) +
      0.03 * Math.sin(t * 0.0091 + 2.7), 0.02, 0.36);
    let gsum = 0, turn = 0;
    const bg = (out && out.bg) || [0, 0, 0, 0];
    bg[0] = bg[1] = bg[2] = bg[3] = 0;
    for (let i = 0; i < this.gusts.length; i++) {
      const gu = this.gusts[i];
      if (t < gu.t0 - gu.dur * 0.2 || t > gu.t0 + gu.dur * 1.5) continue;
      const u = (t - gu.t0) / gu.dur;
      if (u >= 0 && u <= 1) {
        const s = Math.sin(Math.PI * Math.pow(u, 0.62));
        const flutter = 0.86 + 0.14 * Math.sin(t * 2.31 + gu.t0);
        gsum += gu.peak * s * s * flutter;
        turn += gu.turn * s;
      }
      for (let b = 0; b < 4; b++) {
        const p = gu.b[b];
        const ub = (u - p.lag) / p.scale;
        if (ub <= 0 || ub >= 1) continue;
        const raw = Math.sin(Math.PI * Math.pow(ub, p.skew));
        const gated = (raw - p.thr) / (1 - p.thr);
        if (gated <= 0) continue;
        /* Band-specific fast texture. Different rates per band, so even inside
           one gust the bands are not tracing the same curve. */
        const tex = 1 + 0.16 * Math.sin(t * (3.1 + b * 2.7) + gu.t0 * (1 + b));
        bg[b] += gu.peak * p.w * gated * gated * tex;
      }
    }
    const g = clamp01(base + gsum);
    const heading = WIND_HEADING + 0.26 * Math.sin(t * 0.021 + 0.8) + turn * 0.35;
    const o = out || {};
    o.g = g;
    o.base = base;
    o.bg = bg;
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
   * Quarter-second granularity with linear ramps between. The fastest thing
   * any band does is a hiss onset of a few hundred milliseconds, so a quarter
   * second is below the point where the interpolation is audible, and it costs
   * about seventy parameter writes per *second* of timeline — a few tens of
   * microseconds per frame, not per event.
   */
  _scheduleWind(now) {
    const HORIZON = 2.0, STEP = 0.25;
    if (this.schedHead < now) this.schedHead = now;
    const w = this._w || (this._w = { bg: [0, 0, 0, 0] });
    while (this.schedHead < now + HORIZON) {
      const t = this.schedHead + STEP;
      this.windAt(t, w);
      const prox = this.prox;
      const bg = w.bg;

      /* Each band: its own bed floor with its own slow drift, plus its own
         gust drive with its own exponent. The shared `base` gets a small
         weight — some correlation between bands is physical, since they are
         all being pushed by one atmosphere — but it is a minority term, and
         everything else about the bands is independent. */
      const common = Math.exp(0.30 * (w.base - 0.11) * 8);
      /* The gust drive is ten decibels below where it started.
         Both halves of the footstep problem cannot be solved by moving the
         footsteps: a first-person walk needs its own boots above the weather,
         and raising them the seventeen decibels that would take on its own puts
         fourteen decibels onto the overall level, which is the one thing the
         mix must not do. So the wind comes down four and the boots go up four,
         and the gust still stands twenty-eight decibels clear of the bed —
         which is a hard gust in a quiet place, and about what a real one
         measures. */
      const bed = [0.0075, 0.0042, 0.0014, 0.00045];
      const drive = [0.108, 0.063, 0.032, 0.0178];
      const expo = [2.20, 2.00, 1.55, 1.45];
      const nodes = [this.rush, this.body, this.hiss, this.rasp];
      for (let b = 0; b < 4; b++) {
        const v = bed[b] * common * Math.exp(0.62 * this._drift(b, t)) +
                  drive[b] * Math.pow(bg[b], expo[b]);
        ramp(nodes[b].gain.gain, v, t);
      }

      ramp(this.rush.fL.frequency, 150 + 480 * clamp01(bg[0]), t);
      ramp(this.rush.fR.frequency, 150 + 480 * clamp01(bg[0]), t);
      ramp(this.body.fL.frequency, 400 + 760 * clamp01(bg[1]), t);
      ramp(this.body.fR.frequency, 400 + 760 * clamp01(bg[1]), t);
      ramp(this.hiss.fL.frequency, 1450 + 1400 * clamp01(bg[2]), t);
      ramp(this.hiss.fR.frequency, 1450 + 1400 * clamp01(bg[2]), t);
      ramp(this.rasp.fL.frequency, 3600 + 1900 * clamp01(bg[3]), t);
      ramp(this.rasp.fR.frequency, 3600 + 1900 * clamp01(bg[3]), t);

      /* The air floor drifts by a few decibels over a couple of minutes, never
         switches off, and rises with the wind.
         The rise matters as much as the floor. The loudest gust in the piece had
         nothing at all in its top octave, which is backwards: more flow over the
         same sand and needles means more hiss, and the top of the spectrum is
         where a gust announces itself first. It is driven from the rasp band's
         own gust response rather than the overall gust so that this does not
         quietly re-couple the top of the spectrum to the bottom — those two
         already share a correlation block, and the low bands stay out of it. */
      ramp(this.air.gain.gain,
        AIR_FLOOR * Math.exp(0.30 * this._drift(4, t)) * (1 + 2.4 * clamp01(bg[3])), t);
      /* The insect band comes and goes on a half-minute cycle and only the
         bottom third of its range is audible at all. */
      const bug = clamp01(Math.sin(TAU * t / 37.3 + 1.1) * 0.5 + 0.5 - 0.45) / 0.55;
      ramp(this.stridul.gain.gain, 0.0034 * bug * bug, t);

      /* Rock edges. Driven by the hiss band, not the overall gust: an edge
         tone exists because fast air is separating off a lip, which is the
         same thing that makes the hiss. Needs a wall nearby to have a lip. */
      const gu = this._gustAt(t);
      const edge = clamp01((bg[2] - 0.22) / 0.55);
      /* A floor under the wall term. Standing in the middle of the wash you are
         still surrounded by boulders and juniper; an aeolian tone needs a sharp
         lip a few metres away, not a canyon. With no floor the edge tones only
         existed when the player hugged a bank, which in practice meant never —
         and an inaudible feature is not a feature. */
      const wall = 0.45 + 0.55 * prox;
      const eA = this.edgeLvl * edge * edge * wall;
      ramp(this.eg1.gain, eA, t);
      ramp(this.eg2.gain, eA, t);
      if (gu) {
        /* Which lip is on which side changes gust to gust — the wind is coming
           from a slightly different quarter each time — but the ladder of
           available pitches does not, because a resonance is a property of a
           place. That is what makes the feature falsifiable. */
        const lo = gu.edgeSwap ? gu.edge[1] : gu.edge[0];
        const hi = gu.edgeSwap ? gu.edge[0] : gu.edge[1];
        /* Pitch proportional to flow speed. This is the whole physics of an edge
           tone — Strouhal's number fixes f·d/U, so the frequency is the flow
           velocity divided by the size of the lip — and it was missing: the
           ladder entry was fixed and the only movement was a few per cent of
           cosmetic wobble, so the tones sat still while the gust swung twenty
           decibels around them. The hiss band's drive is the local flow proxy,
           and radiated amplitude goes roughly as its cube, so the cube root of
           the drive is the velocity: about an octave of sweep end to end, which
           is what the swing is worth.
           The ladder is still the ladder. It is now the pitch at the reference
           flow rather than the only pitch, which is both what a real lip does
           and still falsifiable: the same ledge in the same gust sings the same
           note. */
        const flow = 0.62 + 0.80 * Math.cbrt(clamp01(bg[2]));
        ramp(this.edge1.frequency, lo * flow * (1 + 0.025 * Math.sin(t * 0.9)), t);
        ramp(this.edge2.frequency, hi * flow * (1 + 0.02 * Math.sin(t * 1.3 + 2)), t);
      }

      /* Closer walls means more of the near field arrives as reflection — but
         only a little of it either way. An open-topped wash sends most of the
         energy straight up and never gets it back. */
      ramp(this.washWet.gain, 0.30 + 0.55 * prox, t);
      /* The slap taps keep their delays — the wash is the width it is — but they
         get louder as the player drifts towards a bank, which is the audible
         half of walking across a canyon floor. */
      ramp(this.slap.gain, 0.72 + 0.62 * prox, t);
      // Only a real gust gets a return off the far walls.
      ramp(this.windEcho.gain, 0.16 * Math.pow(clamp01((w.g - 0.45) / 0.55), 2), t);

      this.schedHead = t;
    }
  }

  /** The gust covering time t, if any. */
  _gustAt(t) {
    for (let i = 0; i < this.gusts.length; i++) {
      const gu = this.gusts[i];
      if (t >= gu.t0 - gu.dur * 0.2 && t <= gu.t0 + gu.dur * 1.3) return gu;
    }
    return null;
  }

  /**
   * Sand for a gust. Bursts land inside the gust's *hiss* window rather than
   * its overall envelope, because saltation is driven by the same small-scale
   * turbulence as the hiss; a rumble-dominated gust barely moves grain.
   */
  _scheduleSand(gust) {
    if (gust.sand) return;
    gust.sand = true;
    const drive = gust.peak * gust.b[2].w;
    if (drive < 0.22) return;
    const r = this.erand;
    const p = gust.b[2];
    const n = 1 + Math.floor(r() * (drive > 0.55 ? 4 : 2.4));
    for (let i = 0; i < n; i++) {
      const u = p.lag + p.scale * (0.15 + 0.65 * r());
      const at = gust.t0 + gust.dur * u;
      const dur = 0.35 + r() * 1.5;
      const strength = drive * (0.45 + 0.55 * r());
      burst(this.sandGain.gain, at, 0.024 * strength, 0.09 + r() * 0.2, dur);
      this.sandBP.frequency.setValueAtTime(2100 + r() * 3600, at);
      if (r() < 0.75) {
        const gt = at + 0.15 + r() * 0.5;
        burst(this.trickleGain.gain, gt, 0.040 * strength, 0.05, 0.5 + r() * 1.9);
        this.gSand.playbackRate.setValueAtTime(0.75 + r() * 0.7, gt);
      }
    }
  }

  _placeSand(t, x, z, w) {
    const d = 4 + 7 * ((Math.sin(t * 0.13) + 1) * 0.5);
    this.sandPan.positionX.setValueAtTime(x + w.dirX * d + w.dirZ * 3, t);
    this.sandPan.positionY.setValueAtTime(0, t);
    this.sandPan.positionZ.setValueAtTime(z + w.dirZ * d - w.dirX * 3, t);
  }

  /* ── animals ─────────────────────────────────────────────────────────── */

  _ensureCalls(until) {
    if (this.quiet) {
      for (const k in this.callsTo) this.callsTo[k] = Math.max(this.callsTo[k], until);
      return;
    }
    const r = this.erand;
    /* First-of-kind offsets are staggered so the three species do not all
       arrive in the first minute, and so a two-minute measurement catches at
       most one or two of them. */
    /* Exponential waiting times, not uniform ones, and longer means.
       Two things were wrong with the old table. The gaps were drawn uniformly
       from a narrow window, which is a metronome with jitter rather than a
       random process: it forbids both the long silence and the coincidence that
       a real evening has, and because every species had its own near-fixed
       period the events arrived in a pattern that read as arranged — one in the
       first minute, four in the second. A Poisson process has exponentially
       distributed gaps and no memory, so it has no third act. And there were
       simply too many: five vocalisations in two minutes is more than a wash at
       golden hour gives you. These means put the expectation at two or three,
       with a real chance of none, which is the honest number.
       `refractory` is the one non-Poisson part and it is physical: an animal
       that has just finished calling does not immediately start again. */
    const spec = {
      coyote: { first: 95, mean: 230, refractory: 25 },
      wren: { first: 120, mean: 200, refractory: 20 },
      raven: { first: 175, mean: 260, refractory: 30 },
    };
    for (const kind in spec) {
      const s = spec[kind];
      while (this.callsTo[kind] < until) {
        const mean = this.callsTo[kind] === 0 ? s.first : s.mean;
        const gap = s.refractory - mean * Math.log(1 - r() * 0.999);
        const t0 = this.callsTo[kind] + gap;
        this.calls.push({ t0, kind, done: false, bearing: (r() * 2 - 1) * Math.PI });
        this.callsTo[kind] = t0;
      }
    }
    if (this.calls.length > 48) this.calls.splice(0, 24);
  }

  /**
   * One canid call: yips then a howl, on the given voice.
   *
   * Pitch is the part that separates an animal from a tone generator. The
   * yips wander rather than climbing a scale; the howl rises into its note,
   * wavers through the sustain with a vibrato that itself deepens and then
   * relaxes, and either glides down or stops abruptly at the end. Nothing here
   * is a held frequency.
   */
  _call(voice, vibGain, t0, bearing, f0, distance, ending) {
    const r = this.erand;
    const fA = voice.oscA.frequency, fB = voice.oscB.frequency, fY = voice.oscY.frequency;
    voice.place(t0 - 0.05, bearing, distance);
    voice.formant.frequency.setValueAtTime(f0 * (1.35 + r() * 0.5), t0);

    /* Yips, on the brighter oscillator. */
    let t = t0;
    const yips = 3 + Math.floor(r() * 4);
    for (let i = 0; i < yips; i++) {
      const len = 0.08 + r() * 0.08;
      const a = f0 * (1.25 + r() * 0.75);
      const b = a * (1.35 + r() * 0.45);
      fY.setValueAtTime(a, t);
      fY.exponentialRampToValueAtTime(b, t + len * 0.5);
      fY.exponentialRampToValueAtTime(b * (0.6 + r() * 0.2), t + len);
      burst(voice.short.gain, t, 0.55 + r() * 0.3, 0.010, len);
      t += len + 0.07 + r() * 0.15;
    }

    /* The howl. */
    const gap = 0.2 + r() * 0.35;
    const hAt = t + gap;
    const hl = 1.6 + r() * 1.2;
    /* Rise into the note, glissando down across the sustain, then an ending.
       A note held to within a couple of per cent with a slow sag is the single
       thing that most makes a synthesised howl sound synthesised, and that is
       what this was: an arch about a fifth as deep as it needed to be, fading
       out at pitch. A real howl falls fifteen to forty per cent across the
       sustain and finishes with a gesture — it either breaks upward into yips
       or drops away hard. The mid-sustain waver that used to be drawn into this
       curve as three extra ramps is gone: the vibrato below is now deep enough
       to supply it, and a waver made of three ramps is periodic in a way a real
       one is not. */
    const peak = 1.02 + r() * 0.06;
    /* The measured fall comes out a little under the scheduled one, because the
       tracker reads a median-smoothed trend and the vibrato rounds off both
       extremes of it. A scheduled 0.17 measured 15.8%, which is the bar itself,
       so the bottom of the range sits at 0.22 to keep the quietest seed clear
       of it. */
    const fall = 0.22 + r() * 0.18;
    const endMul = peak * (1 - fall);
    /* `ending` exists for the measurement, not for the scene. The reverb tail is
       measured in the window after the call, and a call that breaks upward into
       yips puts real vocalisation inside that window, where it is indistinguish-
       able from a reflection — the first run of this reported the terminal yips
       as eight discrete arrivals of a two-second reverb. A measurement cue has
       to be able to ask for the ending that leaves the window clean. */
    const breaks = ending ? ending === 'break' : r() < 0.45;
    const tEnd = hAt + hl + (breaks ? 0.07 : 0.13);
    const setF = (param, mul) => {
      param.setValueAtTime(f0 * 0.70 * mul, hAt);
      param.exponentialRampToValueAtTime(f0 * peak * mul, hAt + hl * 0.17);
      param.exponentialRampToValueAtTime(f0 * (peak - fall * 0.34) * mul, hAt + hl * 0.58);
      param.exponentialRampToValueAtTime(f0 * endMul * mul, hAt + hl);
      /* The ending is written onto the same parameter as the sustain so the two
         cannot drift out of step with each other. */
      param.exponentialRampToValueAtTime(f0 * endMul * (breaks ? 1.85 : 0.52) * mul, tEnd);
    };
    setF(fA, 1);
    setF(fB, 1.003);
    /* Depth in hertz, because this gain feeds `frequency` rather than `detune`.
       Three to eight per cent of the fundamental at five-odd hertz, which is
       what a real howl wavers by. The previous two-to-twelve hertz was a fifth
       of that at this pitch, and read as a steady tone with a tremble on it. */
    /* A fixed number of hertz against a falling pitch, so the relative depth
       grows as the glissando descends — by the end of the fall the same offset is
       around a third deeper than it is at the top. That is the right direction:
       a real howl's waver widens as the note drops. The range below is set so
       that the average across the sustain lands mid-band rather than so that the
       top of the note does.
       This coefficient was briefly trimmed to two thirds of what it is now, on
       the strength of a depth reading of eleven per cent. That reading was the
       instrument, not the sound: the residual it measured contained the
       glissando's own curvature and the pitch tracker's bin jitter as well as
       the waver. Fitting a sinusoid across the vibrato band only, which is what
       the probe does now, puts this at a little over five per cent. */
    const vd = f0 * (0.027 + r() * 0.030);
    vibGain.gain.setValueAtTime(vd * 0.35, hAt);
    vibGain.gain.linearRampToValueAtTime(vd, hAt + hl * 0.5);
    vibGain.gain.linearRampToValueAtTime(vd * 0.5, hAt + hl);
    vibGain.gain.setValueAtTime(0, tEnd + 0.05);

    const gs = voice.sustain.gain;
    gs.setValueAtTime(0, hAt);
    gs.linearRampToValueAtTime(0.5, hAt + 0.18);
    gs.linearRampToValueAtTime(0.44, hAt + hl * 0.72);
    gs.linearRampToValueAtTime(0.34, hAt + hl);
    if (breaks) {
      gs.linearRampToValueAtTime(0, tEnd);
    } else {
      gs.setTargetAtTime(0, hAt + hl, 0.045);
      gs.setValueAtTime(0, tEnd + 0.2);
    }

    /* Breaking upward into yips. This is a real and common ending and it is the
       one that most clearly reads as an animal deciding to stop, rather than a
       generator being switched off. */
    let tail = tEnd;
    if (breaks) {
      const nb = 2 + Math.floor(r() * 3);
      tail = tEnd + 0.03;
      for (let i = 0; i < nb; i++) {
        const len = 0.05 + r() * 0.06;
        const a = f0 * endMul * (1.7 + r() * 0.8);
        fY.setValueAtTime(a, tail);
        fY.exponentialRampToValueAtTime(a * (0.72 + r() * 0.2), tail + len);
        burst(voice.short.gain, tail, 0.40 + r() * 0.25, 0.008, len);
        tail += len + 0.05 + r() * 0.07;
      }
    }

    /* Held down deliberately. The gentler distance filters pass eleven decibels
       more than the steep pair they replaced, and the level has to come back
       out somewhere or the animal stops being half a kilometre away — the
       spectrum would be right and the loudness would give it away. */
    const lvl = 0.058 + r() * 0.020;
    voice.level.gain.setValueAtTime(lvl, Math.max(0, t0 - 0.1));
    return { end: tail + 0.5, howlAt: hAt, howlEnd: hAt + hl, f0 };
  }

  /**
   * A coyote bout. Lone coyotes repeat — two to five calls inside a minute —
   * and at dusk in northern Arizona a second animal answering is the norm. A
   * single call with nothing after it reads as a sound effect; the answer is
   * what makes it an animal.
   */
  _fireCoyote(t0, bearing, ending, solo) {
    const r = this.erand;
    const f0 = 430 + r() * 170;
    const dist = 380 + r() * 260;
    /* One or two calls, not two to four: the bout was most of the crowding.
       `solo` is for the reverb measurement only — a second call or an answer
       lands inside the tail window and is indistinguishable there from a
       reflection, which is how a bout came to be reported as an eight-second
       RT60. */
    const n = solo ? 1 : 1 + Math.floor(r() * 2);
    /* Every call is reported separately, with its own start and duration.
       Reporting only the first leaves the repeats looking like unexplained
       sound, and a measurement that has to account for them will file them as
       weather — which is how a repeat howl gets reported as a recurring narrow
       resonance in the wind. Reporting the bout as one span is no better: the
       gaps between calls run to fifteen seconds and are genuinely quiet, so a
       single envelope over the whole bout would blind the same measurement to
       every gust that happens to fall inside it. */
    let t = t0, last = null;
    const parts = [];
    const recs = [];
    for (let i = 0; i < n; i++) {
      const at = t;
      last = this._call(this.coyA, this.vibA, at, bearing + (r() * 2 - 1) * 0.25,
        f0 * (1 + (r() * 2 - 1) * 0.04), dist, i === 0 ? ending : undefined);
      parts.push(last);
      recs.push({ kind: 'coyote', t: +at.toFixed(2), dur: +(last.end - at).toFixed(2) });
      t = last.end + 8 + r() * 15;
    }
    /* The answer. Deliberately off the first animal's pitch — coyotes avoid
       each other's frequencies, which is why two of them sound like six. */
    let answer = null;
    if (!solo && r() < 0.40) {
      const semis = (r() < 0.5 ? -1 : 1) * (3 + r() * 4);
      const aAt = parts[Math.min(parts.length - 1, 1 + ((r() * 2) | 0))].end + 1.5 + r() * 5;
      answer = this._call(this.coyB, this.vibB, aAt,
        bearing + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 1.4),
        f0 * Math.pow(2, semis / 12), dist * (0.8 + r() * 0.7));
      recs.push({ kind: 'coyote', t: +aAt.toFixed(2), dur: +(answer.end - aAt).toFixed(2) });
    }
    recs.sort((p, q) => p.t - q.t);
    Object.assign(recs[0], {
      calls: n, answered: !!answer, f0: +f0.toFixed(1),
      howlAt: +parts[0].howlAt.toFixed(3), howlEnd: +parts[0].howlEnd.toFixed(3),
    });
    for (const rc of recs) this.fired.push(rc);
    return parts[0];
  }

  /**
   * Canyon wren: ten to sixteen clear whistled notes falling through a couple
   * of octaves, decelerating as they go, ending in two or three buzzy notes.
   * The deceleration is the recognisable part — an evenly spaced descending
   * scale is a doorbell.
   */
  _fireWren(t0, bearing) {
    const r = this.erand;
    const f = this.wren.frequency;
    const g = this.wrenGain.gain;
    /* A canyon wren starts near five kilohertz, not three, and the whole
       cascade is over in a second and a half to three seconds. This started a
       third too low and ran about twice too long. */
    const top = 4500 + r() * 1000;
    const bottom = 1100 + r() * 300;
    const n = 9 + Math.floor(r() * 5);
    const dist = 110 + r() * 150;
    this.wrenPan.positionX.setValueAtTime(Math.sin(bearing) * dist, Math.max(0, t0 - 0.05));
    this.wrenPan.positionY.setValueAtTime(8 + r() * 14, Math.max(0, t0 - 0.05));
    this.wrenPan.positionZ.setValueAtTime(Math.cos(bearing) * dist, Math.max(0, t0 - 0.05));

    let t = t0;
    /* Up by seven decibels, and it is a correction rather than a change of mind:
       strengthening the second and third partials made the PeriodicWave
       renormalise, which quietly took that much off the fundamental and left the
       bird eight decibels further away than it was meant to be. */
    const lvl = 0.058 + r() * 0.031;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const fc = top * Math.pow(bottom / top, Math.pow(u, 0.86));
      const len = 0.030 + 0.026 * u + r() * 0.012;
      f.setValueAtTime(fc * 1.035, t);
      f.exponentialRampToValueAtTime(fc * 0.93, t + len);
      burst(g, t, lvl * (1 - 0.25 * u) * (0.85 + r() * 0.3), 0.006, len);
      // Decelerating: notes start about 85 ms apart and end near 165 ms.
      t += len + 0.048 + 0.085 * Math.pow(u, 1.3) + r() * 0.012;
    }
    /* The buzzy tail, and the ending. A real cascade stops — often on two or
       three harsh notes — rather than trailing off on a held pitch. These are
       short and they fall hard inside their own length, which is what makes the
       last note read as the last note. */
    const nb = 2 + Math.floor(r() * 2);
    for (let i = 0; i < nb; i++) {
      const fc = bottom * (0.95 - i * 0.06);
      const len = 0.055 + r() * 0.030;
      f.setValueAtTime(fc * 1.06, t);
      f.exponentialRampToValueAtTime(fc * 0.82, t + len);
      burst(g, t, lvl * (0.62 - i * 0.12), 0.008, len * 0.8);
      t += len + 0.040 + r() * 0.030;
    }
    this.fired.push({ kind: 'wren', t: +t0.toFixed(2), notes: n + nb,
      dur: +(t - t0).toFixed(2),
      top: Math.round(top), bottom: Math.round(bottom) });
    return { end: t };
  }

  /** Raven: two to four croaks across open air. */
  _fireRaven(t0, bearing) {
    const r = this.erand;
    const dist = 320 + r() * 480;
    this.ravenPan.positionX.setValueAtTime(Math.sin(bearing) * dist, Math.max(0, t0 - 0.05));
    this.ravenPan.positionY.setValueAtTime(30 + r() * 60, Math.max(0, t0 - 0.05));
    this.ravenPan.positionZ.setValueAtTime(Math.cos(bearing) * dist, Math.max(0, t0 - 0.05));
    const f0 = 330 + r() * 130;
    let t = t0;
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const len = 0.24 + r() * 0.16;
      const f = f0 * (0.94 + r() * 0.14);
      this.raven.frequency.setValueAtTime(f, t);
      this.raven.frequency.linearRampToValueAtTime(f * (0.88 + r() * 0.08), t + len);
      this.ravenLFO.frequency.setValueAtTime(85 + r() * 55, t);
      burst(this.ravenGain.gain, t, 0.075 + r() * 0.03, 0.02, len);
      t += len + 0.32 + r() * 0.6;
    }
    this.fired.push({ kind: 'raven', t: +t0.toFixed(2), croaks: n,
      dur: +(t - t0).toFixed(2), f0: +f0.toFixed(1) });
    return { end: t };
  }

  /* ── footsteps ───────────────────────────────────────────────────────── */

  /**
   * How gravelly the ground is here, 0 = fine sand, 1 = coarse lag gravel.
   * Deliberately its own cheap field rather than a query into the terrain: the
   * terrain module is owned by another system, and a slightly wrong footstep
   * timbre is a far smaller failure than a broken import. The trend it encodes
   * is the true one — fines in the middle of the channel, armoured lag out
   * towards the banks.
   */
  _surfaceAt(x, z, u) {
    const patch = Math.sin(x * 0.21 + z * 0.13) * Math.cos(z * 0.17 - x * 0.09);
    const bank = clamp01(Math.abs(u) / 9);
    return clamp01(0.34 + 0.34 * patch + 0.42 * bank);
  }

  /**
   * One footstep.
   *
   * Level: these are the player's own boots a metre and a half from their ears,
   * and in a first-person walk they are the loudest thing in the world — a boot
   * on gravel runs thirty-five to forty-five decibels over a twenty-dBA desert
   * ambient. The first version of this file had them sixteen decibels *below*
   * the distant wind, which inverts the entire perspective of the scene. They
   * are still quiet in absolute terms; they are simply no longer behind the
   * weather.
   *
   * Variation: a fixed stride length gives a step-duration coefficient of
   * variation around two per cent, which is a third of what a human manages on
   * a flat treadmill and a fifth of what uneven ground produces. Sand, gravel
   * and cobble belong at the top of the measured range, so the interval carries
   * per-step jitter, a systematic left/right difference, a slow drift, and the
   * occasional outright hesitation. Every fourth step or so is a scuff rather
   * than a footfall, and one in ten kicks a stone loose.
   */
  _step(t, x, z, u, speed) {
    const r = this.erand;
    const gravel = this._surfaceAt(x, z, u);
    const left = this.stepSide > 0;
    /* Real gait is asymmetric: one leg lands a little harder and a little
       brighter than the other, consistently, for as long as you watch. Widened,
       because at six and five per cent the difference was there in the code and
       not in the autocorrelation — no odd-even alternation survived to be
       measured, which is the same as the two feet being one foot. The grain
       layer gets its own offset on top, so the difference is in the timbre and
       not only in the level. */
    const legLvl = left ? 1.13 : 0.88;
    const legTone = left ? 1.11 : 0.90;
    const vary = 0.66 + r() * 0.68;
    const load = clamp(speed / 1.6, 0.55, 1.5);
    const scuff = r() < 0.11;

    if (scuff) {
      /* A drag over the surface: no impact, a long rasp, and much more of the
         grain layer than the body. */
      const len = 0.20 + r() * 0.20;
      this.stepLP.frequency.setValueAtTime(lerp(300, 560, gravel) * legTone, t);
      burst(this.stepGain.gain, t, 0.175 * vary * load, 0.025 + r() * 0.025, len);
      this.crunchBP.frequency.setValueAtTime(lerp(1400, 2600, gravel) * legTone, t);
      this.crunchBP.Q.setValueAtTime(0.55, t);
      this.gStep.playbackRate.setValueAtTime(0.55 + r() * 0.4, t);
      burst(this.crunchGain.gain, t, 0.44 * vary * load, 0.03, len * 1.15);
    } else {
      /* Which layer leads. A boot in dry wash sand and gravel is mostly the
         sound of grains shearing against each other, two to eight kilohertz and
         still going at twelve; the dull body under it is the secondary event.
         This was the other way round — peaking near a hundred hertz, flat to
         four kilohertz and then falling off a cliff — which is the spectrum of
         a mallet on a drum head, not a boot on sand. So the body comes down and
         the crunch comes up and moves an octave higher with a wider filter.
         Total power is about where it was: the energy moved up the spectrum
         rather than being added to. */
      const bodyF = lerp(420, 900, gravel) * (0.85 + r() * 0.3) * legTone;
      const bodyLvl = lerp(0.30, 0.145, gravel) * vary * load * legLvl;
      const bodyDec = lerp(0.11, 0.055, gravel) * (0.8 + r() * 0.45);
      this.stepLP.frequency.setValueAtTime(bodyF, t);
      burst(this.stepGain.gain, t, bodyLvl, 0.004 + r() * 0.004, bodyDec);

      const crF = lerp(2300, 5200, gravel) * (0.85 + r() * 0.35) * legTone;
      /* Widening the filter to a Q under a half quadrupled the bandwidth, so the
         level has to come back down by about as much or the crunch arrives as a
         click: the first pass at this put the true peak at -5.9 dBFS with the
         total power barely moved, which is a crest factor problem rather than a
         loudness one and would clip on some other seed. */
      const crLvl = lerp(0.28, 0.62, gravel) * vary * load * legLvl;
      const crDec = lerp(0.075, 0.13, gravel) * (0.8 + r() * 0.5);
      this.crunchBP.frequency.setValueAtTime(crF, t);
      /* Wide, because grain-on-grain noise is broadband. A Q near one made the
         crunch a resonance sitting on the body rather than a band of hiss over
         the top of it. */
      this.crunchBP.Q.setValueAtTime(0.42 + gravel * 0.34, t);
      this.gStep.playbackRate.setValueAtTime(0.7 + r() * 0.85 + gravel * 0.35, t);
      burst(this.crunchGain.gain, t + 0.004, crLvl, 0.003, crDec);
    }

    /* Kicked stones. More likely on gravel, and sometimes they bounce twice. */
    if (r() < 0.06 + 0.14 * gravel) {
      const pt = t + 0.055 + r() * 0.14;
      this.pebbleBP.frequency.setValueAtTime(3400 + r() * 2800, pt);
      burst(this.pebbleGain.gain, pt, 0.16 + r() * 0.19, 0.002, 0.03 + r() * 0.04);
      if (r() < 0.45) {
        const pt2 = pt + 0.075 + r() * 0.10;
        burst(this.pebbleGain.gain, pt2, 0.095 + r() * 0.095, 0.002, 0.025 + r() * 0.03);
      }
    }

    this.stepPan.pan.setValueAtTime(this.stepSide * (0.12 + r() * 0.12), t);
    this.stepSide = -this.stepSide;
    /* The scheduled times, so a measurement can tell the difference between a
       loose gait and a loose detector. An 8 ms envelope on a band-limited
       signal places a scuff's onset tens of milliseconds late, which inflates
       an interval spread that may be perfectly tight at the source. */
    this.stepTimes.push({ t: +t.toFixed(4), scuff, left, gravel: +gravel.toFixed(3) });
    if (this.stepTimes.length > 4096) this.stepTimes.splice(0, 2048);
    return scuff;
  }

  /* ── per-frame ───────────────────────────────────────────────────────── */

  /**
   * @param {number} now absolute context time
   * @param {{x:number,z:number,speed:number,dt:number,u?:number}} st
   */
  update(now, st) {
    const w = this.windAt(now, this._wNow || (this._wNow = { bg: [0, 0, 0] }));
    const W = this.wind;
    W.gust = w.g; W.base = w.base; W.heading = w.heading;
    W.dirX = w.dirX; W.dirZ = w.dirZ; W.speed = w.speed;
    W.rush = w.bg[0]; W.hiss = w.bg[2];

    let u = st.u;
    if (u === undefined) u = this.path ? this.path.uOf(st.x, st.z) : 0;
    this.prox = clamp01(Math.abs(u) / WASH_HALF);

    this._scheduleWind(now);

    this._ensureGusts(now + 30);
    for (let i = 0; i < this.gusts.length; i++) {
      const gu = this.gusts[i];
      if (!gu.sand && gu.t0 < now + 30) this._scheduleSand(gu);
    }
    this._ensureCalls(now + 30);
    for (let i = 0; i < this.calls.length; i++) {
      const c = this.calls[i];
      if (c.done || c.t0 >= now + 20) continue;
      c.done = true;
      if (c.kind === 'coyote') this._fireCoyote(c.t0, c.bearing);
      else if (c.kind === 'wren') this._fireWren(c.t0, c.bearing);
      else this._fireRaven(c.t0, c.bearing);
    }

    if (now - (this._sandPlaced || -1) > 1.0) {
      this._sandPlaced = now;
      this._placeSand(now + 0.05, st.x, st.z, w);
    }

    /* Footsteps are the one thing that cannot be scheduled ahead, because they
       depend on a player who has not decided to walk yet. Stride length rather
       than a timer, so cadence follows speed for free. */
    const speed = st.speed;
    if (speed > 0.12) {
      const r = this.erand;
      const base = lerp(0.72, 0.98, clamp01((speed - 1.2) / 2.4));
      /* Jitter, a systematic left/right difference, and a slow drift. The
         drift is what stops the sequence being periodic on a longer horizon:
         with only per-step jitter the phase random-walks but the mean stride
         is exact, and an autocorrelation still finds the comb. */
      /* Four per cent, not two. Two is the bottom of the human range and it did
         not survive to the autocorrelation; real walking runs two to six. */
      const asym = this.stepSide > 0 ? 1.040 : 0.960;
      const drift = 1 + 0.028 * Math.sin(now * 0.31) + 0.018 * Math.sin(now * 0.11 + 1.7);
      const stride = base * asym * drift * (1 + (r() * 2 - 1) * 0.045) + this.pause;
      this.strideAcc += speed * st.dt;
      if (this.strideAcc >= stride) {
        this.strideAcc -= stride;
        if (this.strideAcc > stride) this.strideAcc = 0;
        const scuffed = this._step(now + 0.03, st.x, st.z, u, speed);
        /* A hesitation: picking a line over cobbles, or a moment's pause. Left
           in the stride accumulator so the *next* interval is long. Kept rare
           and modest — a stride that occasionally triples is not a walk, and
           the target is the top of the measured human range on uneven ground,
           not a stumble. */
        this.pause = (r() < 0.012) ? (0.08 + r() * 0.14) * speed
          : scuffed ? (0.015 + r() * 0.04) * speed : 0;
      }
    } else if (this.strideAcc !== 0) {
      this.strideAcc = 0.55;
      this.pause = 0;
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
      setEnabled() {}, gust() {}, coyote() {}, wren() {}, raven() {}, available: false,
      wind: { heading: WIND_HEADING, dirX: Math.sin(WIND_HEADING), dirZ: Math.cos(WIND_HEADING), gust: 0, speed: 0, base: 0, hiss: 0, rush: 0 },
      windAt() { return { g: 0, heading: WIND_HEADING, dirX: 0, dirZ: 1, speed: 0, base: 0, bg: [0, 0, 0] }; },
      gusts() { return []; },
      renderOffline() { return Promise.reject(new Error('audio unavailable')); },
      renderVoices() { return Promise.reject(new Error('audio unavailable')); },
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

  /* Getters onto the live state rather than a copy, so reading is free and
     writing does not take. */
  const windView = Object.freeze(Object.defineProperties({}, Object.fromEntries(
    ['gust', 'base', 'heading', 'dirX', 'dirZ', 'speed', 'hiss', 'rush'].map(
      k => [k, { enumerable: true, get: () => sc.wind[k] }]))));

  function update(dt, player) {
    const now = ctx.currentTime;
    if (!enabled || ctx.state !== 'running') {
      /* Still advance the published weather even with no audible output, so a
         page that has never been clicked does not hand System 5 a dead wind. */
      const w = sc.windAt(now);
      Object.assign(sc.wind, {
        gust: w.g, base: w.base, heading: w.heading, dirX: w.dirX, dirZ: w.dirZ,
        speed: w.speed, rush: w.bg[0], hiss: w.bg[2],
      });
      return;
    }
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
    /**
     * Force a gust now, for testing. `strength` in 0..1, `character` 0 = low
     * rumble through the wash, 1 = dry hiss off a ledge.
     */
    gust(strength = 0.8, character) {
      /* Two and a bit seconds out, not immediately: the wind automation is
         written to a two-second horizon, and the scheduler only ever writes
         forward, so a gust inserted at `now` would have its onset silently
         clipped by automation that has already been laid down. */
      const t0 = ctx.currentTime + 2.2;
      const gu = sc._makeGust(t0, 5 + strength * 8, clamp01(strength),
        character === undefined ? undefined : clamp01(character));
      sc.gusts.push(gu);
      sc._scheduleSand(gu);
      return gu;
    },
    /** Force a coyote bout now, for testing. */
    coyote() { return sc._fireCoyote(ctx.currentTime + 0.15, (Math.random() * 2 - 1) * Math.PI); },
    /** Force a canyon wren cascade now, for testing. */
    wren() { return sc._fireWren(ctx.currentTime + 0.15, (Math.random() * 2 - 1) * Math.PI); },
    /** Force a raven now, for testing. */
    raven() { return sc._fireRaven(ctx.currentTime + 0.15, (Math.random() * 2 - 1) * Math.PI); },
    /**
     * Live weather. Read-only by construction — System 5's blowing sand has to
     * agree with the sound, and the way that goes wrong is one of them quietly
     * writing to the other's state. `hiss` is the band to drive saltation
     * from: grains move with small-scale turbulence, not with the bulk flow.
     */
    wind: windView,
    /** Weather at an arbitrary absolute context time, past or future. */
    windAt(t) { return sc.windAt(t); },
    /**
     * Gust windows overlapping [from, to], as `{t0, dur, peak, char}`.
     * Saltation is a burst phenomenon, so anything visual wanting to spawn
     * grains ahead of time needs the schedule, not just the instantaneous
     * value. `char` says whether this gust is a rumble or a rasp, which is also
     * whether it will move much sand.
     */
    gusts(from = ctx.currentTime, to = ctx.currentTime + 60) {
      sc._ensureGusts(to);
      return sc.gusts
        .filter(g => g.t0 + g.dur >= from && g.t0 <= to)
        .map(g => ({ t0: g.t0, dur: g.dur, peak: g.peak, char: g.char }));
    },
    get time() { return ctx.currentTime; },
    get state() { return ctx.state; },
    /** Offline render of this exact graph; see tools/audioprobe.mjs. */
    renderOffline: (opts) => renderOffline({ path, seed, ...(opts || {}) }),
    /** Offline render with every rare voice cued at a known time. */
    renderVoices: (opts) => renderVoices({ path, seed, ...(opts || {}) }),
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

/** Pack a rendered stereo buffer into transferable Int16 mono plus real stats. */
function pack(buf, extra) {
  const len = buf.length;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  let peakL = 0, peakR = 0, dcL = 0, dcR = 0, clipped = 0, sqL = 0, sqR = 0;
  for (let i = 0; i < len; i++) {
    const a = L[i], b = R[i];
    const aa = Math.abs(a), ab = Math.abs(b);
    if (aa > peakL) peakL = aa;
    if (ab > peakR) peakR = ab;
    dcL += a; dcR += b;
    sqL += a * a; sqR += b * b;
    if (aa >= 0.999 || ab >= 0.999) clipped++;
  }
  const peak = Math.max(peakL, peakR, 1e-9);
  const scale = Math.min(32000 / peak, 1e7);
  const pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const v = (L[i] + R[i]) * 0.5 * scale;
    pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return Object.assign({
    length: len, scale, peakL, peakR, clipped,
    dcL: dcL / len, dcR: dcR / len,
    rmsL: Math.sqrt(sqL / len), rmsR: Math.sqrt(sqR / len),
    rms: Math.sqrt((sqL + sqR) / (2 * len)),
    pcm: btoa(bin),
  }, extra);
}

/**
 * Drive a Soundscape through a scripted walk in an OfflineAudioContext.
 *
 * Twenty-four kilohertz because nothing here has meaningful energy above about
 * six: the hiss band tops out near four and the coyote is behind a lowpass and
 * a shelf. Halving the rate halves the render time and the transfer size for no
 * measurable loss.
 */
async function simulate({ seconds, sampleRate, seed, path, segments, quiet, cue }) {
  const len = Math.ceil(seconds * sampleRate);
  const oc = new OfflineAudioContext(2, len, sampleRate);
  const sc = new Soundscape(oc, oc.destination, { seed, path, quiet });
  sc.start(0);

  const walking = (t) => segments.some(([a, d]) => t >= a && t < a + d);
  const DT = 1 / 30;
  const st = { x: 0, z: 0, speed: 0, dt: DT, u: 0 };
  let dist = 0;
  const p = new THREE.Vector3();
  for (let t = 0; t < seconds; t += DT) {
    const sp = walking(t) ? 1.45 : 0;
    dist += sp * DT;
    /* Wander across the channel rather than tracking the centreline. Lateral
       offset drives the wall proximity, and a walk that stays within a metre of
       the middle never exercises it — which silently turns off everything that
       depends on being near a bank. */
    const u = 4.5 * Math.sin(dist * 0.07) + 1.8 * Math.sin(dist * 0.23 + 1.1);
    if (path) {
      path.posAt(dist, p);
      st.x = p.x + u; st.z = p.z;
    } else {
      st.x = u;
      st.z = -dist;
    }
    st.u = u;
    st.speed = sp;
    oc.listener.positionX.setValueAtTime(st.x, t);
    oc.listener.positionY.setValueAtTime(1.65, t);
    oc.listener.positionZ.setValueAtTime(st.z, t);
    if (cue) cue(sc, t, DT);
    sc.update(t, st);
  }
  const buf = await oc.startRendering();
  return { sc, buf };
}

/** The honest take: the real schedule, a scripted walk, nothing forced. */
export async function renderOffline({
  seconds = 120, sampleRate = 24000, seed, path = null, walk = null,
} = {}) {
  const segments = walk || [[14, 22], [58, 16], [92, 19]];
  const { sc, buf } = await simulate({ seconds, sampleRate, seed, path, segments });
  return pack(buf, {
    seconds, sampleRate, segments,
    gusts: sc.gusts.filter(g => g.t0 < seconds).map(g => ({
      t: +g.t0.toFixed(2), dur: +g.dur.toFixed(2), peak: +g.peak.toFixed(3),
      char: +g.char.toFixed(2),
    })),
    calls: sc.fired.filter(f => f.t < seconds),
    steps: sc.stepTimes,
  });
}

/**
 * The forced take.
 *
 * The rare voices are rare on purpose, so waiting for one is not a measurement
 * strategy. Here each is cued at a known time with the random schedule
 * suppressed, so harmonic structure, pitch trajectory and the reverb's
 * discrete arrivals can be measured against a clean background.
 */
export async function renderVoices({ sampleRate = 24000, seed, path = null } = {}) {
  const seconds = 66;
  const segments = [[52, 12]];
  const plan = [
    { t: 2.0, kind: 'gust-rumble' },
    { t: 16.0, kind: 'gust-hiss' },
    { t: 29.0, kind: 'coyote' },
    { t: 42.0, kind: 'wren' },
    { t: 47.5, kind: 'raven' },
  ];
  const cues = [];
  let idx = 0;
  /* Cued three seconds early. The wind scheduler writes automation to a
     two-second horizon and only ever writes forward, so a gust inserted at its
     own onset would have that onset clipped by parameter events already laid
     down — the forced take would then measure something quieter than the thing
     it is meant to be measuring. */
  const LEAD = 3;
  const cue = (sc, t, dt) => {
    while (idx < plan.length && plan[idx].t - LEAD < t + dt) {
      const c = plan[idx++];
      if (c.kind === 'gust-rumble' || c.kind === 'gust-hiss') {
        const hiss = c.kind === 'gust-hiss';
        const gu = {
          t0: c.t, dur: 9, peak: 0.85, char: hiss ? 0.92 : 0.06, turn: 0, sand: false,
          b: [
            { thr: 0.05, lag: 0.08, scale: 1.2, skew: 0.80, w: hiss ? 0.31 : 1.00 },
            { thr: 0.10, lag: 0.02, scale: 1.0, skew: 0.62, w: 0.67 },
            { thr: 0.22, lag: -0.05, scale: 0.60, skew: 0.34, w: hiss ? 1.22 : 0.07 },
            { thr: 0.30, lag: -0.09, scale: 0.45, skew: 0.26, w: hiss ? 1.00 : 0.05 },
          ],
          edge: [1560, 2700], edgeSwap: false,
        };
        sc.gusts.push(gu);
        sc._scheduleSand(gu);
        cues.push({
          t: c.t, kind: c.kind, note: `char ${gu.char}`,
          /* The edge frequencies are known, so the prominence of the rock-edge
             tones can be measured where they are meant to be rather than hoping
             a blind peak search finds them. A blind search over a hundred and
             twenty seconds of mostly-quiet cannot tell a real narrow peak from
             the two or three decibels of shaping that filtered noise gives away
             for free. */
          measure: hiss ? 'peaks' : undefined,
          peaks: hiss ? gu.edge.slice() : undefined,
          offset: 2.0, span: 4.0,
        });
      } else if (c.kind === 'coyote') {
        // One call, dropped ending: the reverb window below stays clean.
        const first = sc._fireCoyote(c.t, 0.9, 'drop', true);
        cues.push({
          t: c.t, kind: 'coyote', measure: 'harmonics',
          offset: +(first.howlAt - c.t + 0.45).toFixed(3),
          f0lo: Math.round(first.f0 * 0.72), f0hi: Math.round(first.f0 * 1.3),
          note: `f0 ${first.f0.toFixed(0)} Hz, howl at +${(first.howlAt - c.t).toFixed(2)}s`,
        });
        cues.push({
          t: c.t, kind: 'coyote-pitch', measure: 'pitch',
          offset: +(first.howlAt - c.t).toFixed(3),
          span: +(first.howlEnd - first.howlAt + 0.2).toFixed(3),
          /* Around h2, not the fundamental. h2 is the loudest partial of this
             voice, so a band around h1 loses the track to it as soon as the
             glide brings h2 inside; a band that only h2 can occupy cannot. */
          harmonic: 2,
          f0lo: Math.round(first.f0 * 1.15), f0hi: Math.round(first.f0 * 2.45),
          note: 'howl trajectory: glissando depth, vibrato and ending',
        });
        cues.push({
          t: c.t, kind: 'coyote-tail', measure: 'tail',
          /* Well clear of the howl's own release, which is a few hundred
             milliseconds of exponential decay and would otherwise be measured
             as the first two reflections of a reverb it has not reached yet. */
          offset: +(first.howlEnd - c.t + 0.45).toFixed(3),
          /* The analysis window has to start clear of the howl, but the slap
             delays are specified from the direct sound, so the probe needs to
             know how far it skipped in order to report the two in the same
             frame of reference. Without this the reflections read 0.45 s early
             and look like early reflections of an enclosure. */
          ref: 0.45,
          /* The direct sound is the howl at full voice, not its release. Taking
             it from the second before the analysis window put the reference
             inside the closing decay, where the level depends on where the
             envelope happened to be — which is why the direct-to-reflection
             ratio moved five decibels between runs that changed nothing about
             the reverb. */
          directFrom: +(first.howlAt - c.t + 0.35).toFixed(3),
          directTo: +(first.howlEnd - c.t - 0.15).toFixed(3),
          band: Math.round(first.f0 * 1.6),
          note: 'canyon slapback after the first howl',
        });
      } else if (c.kind === 'wren') {
        const w = sc._fireWren(c.t, -1.2);
        cues.push({ t: c.t, kind: 'wren', note: `cascade to +${(w.end - c.t).toFixed(2)}s` });
      } else {
        sc._fireRaven(c.t, 2.4);
        cues.push({ t: c.t, kind: 'raven', measure: 'harmonics', offset: 0.09,
          f0lo: 260, f0hi: 520, note: 'croak' });
      }
    }
  };
  const { sc, buf } = await simulate({
    seconds, sampleRate, seed, path, segments, quiet: true, cue,
  });
  cues.push({ t: 52, kind: 'walk', note: '12 s of walking' });
  return pack(buf, { seconds, sampleRate, segments, cues, gusts: [], calls: sc.fired });
}
