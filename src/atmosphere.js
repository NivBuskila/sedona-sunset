/* Sedona Sunset — System 5: the air.
 *
 * Three things live here, and they are one system because they are all driven
 * by the same weather:
 *
 *   dust        fine motes suspended in the corridor, catching the low sun.
 *               This is what turns "bright" into "shafts".
 *   saltation   wind-driven sand hugging the wash floor. Sparse and
 *               intermittent by construction: the stillness is the feature and
 *               the sand exists to make the stillness noticeable.
 *   shimmer     heat distortion in the first metres of air above ground, seen
 *               as a screen-space refraction of whatever is behind it.
 *
 * Aerial perspective is the fourth part and lives in src/aerial.js, because it
 * is a shader-chunk patch rather than an object in the scene.
 *
 * ── the weather, and why it is mirrored rather than read ───────────────────
 *
 * System 6 owns the wind and publishes it three ways: `wind` (live), `windAt(t)`
 * (analytic) and `gusts(from, to)` (the schedule). The obvious wiring is to read
 * `wind` every frame, and for a human walking around that is exactly right and
 * exactly what happens.
 *
 * It cannot be the whole story, because the capture harness requires that two
 * `walkTo(46)` calls produce identical pixels, and the live wind is a function
 * of the audio clock. Sampling `windAt` at a virtual time does not fix it
 * either: the gust schedule is a *stream*, generated forward on demand and
 * pruned behind, so the same past instant does not answer the same way twice
 * once thirty-two gusts have been dropped off the front.
 *
 * So this file keeps its own append-only mirror of System 6's gust schedule,
 * forced out to a fixed horizon at construction and extended as the audio
 * generates more. The envelope arithmetic over that list is a copy of
 * `Soundscape.windAt` — a dozen lines, duplicated deliberately, because the
 * alternative is a second wind model that disagrees with the first. The gusts
 * are System 6's own gusts, at System 6's own times, with System 6's own peaks:
 * when you hear one, the sand moves, because it is the same event.
 *
 * `walkTo(d)` then maps distance into a fixed, fully-mirrored 22-second window
 * of that timeline, so a capture is a real moment of the real weather and is
 * the *same* real moment every time it is asked for.
 *
 * One approximation is recorded honestly: the audio's per-band gust drive
 * (`bg[]`, of which band 2 is the hiss that saltation should really follow) is
 * not on the public interface, only the gust's `char`, which is what decides
 * whether a gust is a low rumble through the wash or a dry rasp off a ledge.
 * Saltation is driven by the envelope weighted by `char`, which gets the same
 * answer to the question that matters — this gust moves sand, that one does not
 * — without reaching into System 6's internals.
 */
import * as THREE from 'three';
import { aerialCoeffs } from './aerial.js';

/* Straight from audio.js, and it must stay in step with it: the heading the
   wind blows *toward*, 0 meaning +Z, which is down-wash and away from the sun.
   So the wind is in your face as you walk up the wash, the sand streams past
   you toward the mouth, and grains pile on the up-wash faces of clasts — which
   is the side System 1 already drew them piled on. */
const WIND_HEADING = 0.12;

const EYE = 1.65;

/* ── the wind mirror ───────────────────────────────────────────────────────*/

class Wind {
  /**
   * @param {object} audio  window.__game.audio, or the inert stub
   */
  constructor(audio) {
    this.audio = audio;
    this.gusts = [];
    this.seen = new Set();
    /* Zero, not `audio.time`. This anchors the deterministic capture window,
       and it was anchored to the AudioContext clock at the moment the
       atmosphere was constructed — which is boot time, which varies by seconds
       between two page loads. So `captureTime(46)` returned a different instant
       of the weather every run: different mote positions, different saltation,
       and, because the shimmer pass takes the same clock, a slightly different
       heat-haze warp over the whole frame. Two captures of one viewpoint from
       one frozen src/ differed in 11% of their pixels because of this line.
       Anchoring at zero costs nothing: System 6's gust schedule is a seeded
       PRNG walked forward from t=0, so `gusts()` over a fixed absolute window
       returns the same gusts on every load. The live path is unaffected — it
       reads `audio.time` per frame in update(). */
    this.t0 = 0;

    /* Force the capture window out now, once.
     *
     * Its length is set by the gust statistics rather than picked: System 6
     * spaces gusts 11 to 43 seconds apart and runs them 5 to 16 seconds, so a
     * window much under forty seconds can easily contain no gust at all and
     * every capture in the set would then show a dead calm — which is not
     * "sparse and intermittent", it is broken. Forty-four seconds reliably
     * contains one or two, so some viewpoints catch sand moving and some catch
     * the stillness, which is the intended reading.
     *
     * Forcing this far ahead is safe: System 6's own update extends the
     * schedule to now+30 every frame regardless, and two or three gusts is
     * nowhere near the sixty-four at which it starts pruning behind itself. */
    this.CAP_LO = this.t0 + 2;
    this.CAP_HI = this.t0 + 46;
    this.pump(this.t0, 48);
    /* And do not *assume* it: the schedule is random, and a window that happens
       to contain no gust would give a capture set with no moving sand anywhere
       in it — a silent failure that looks like the feature working. Extend
       until there is one, or give up at three minutes and let the base wind
       carry it. */
    for (let i = 0; i < 4 && !this.gustsInWindow(); i++) {
      this.CAP_HI += 34;
      this.pump(this.t0, this.CAP_HI - this.t0 + 2);
    }

    this.state = { gust: 0, sal: 0, dirX: Math.sin(WIND_HEADING), dirZ: Math.cos(WIND_HEADING), speed: 0.5 };
  }

  /** Copy any newly scheduled gusts into the mirror. Never removes. */
  pump(now, ahead = 20) {
    let list;
    try { list = this.audio.gusts(now - 1, now + ahead); } catch (e) { return; }
    if (!list || !list.length) return;
    for (const g of list) {
      const k = g.t0.toFixed(4);
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      this.gusts.push({ t0: g.t0, dur: g.dur, peak: g.peak, char: g.char === undefined ? 0.5 : g.char });
    }
  }

  /** Does the deterministic capture window contain any gust at all? */
  gustsInWindow() {
    return this.gusts.some((g) => g.t0 + g.dur > this.CAP_LO && g.t0 < this.CAP_HI);
  }

  /**
   * The moment in the capture window at which the bed is moving hardest.
   *
   * The whole design of this system is that the desert is still and the sand
   * moves rarely, which is right for the scene and leaves the sub-system
   * unreviewable: a critic looking at eight stills correctly reported that
   * saltation shipped with no evidence, because by construction there was
   * nothing in the frames to see. This exists so a gust can be captured on
   * purpose, deterministically, as an extra frame beside the standard set —
   * without loosening the threshold that keeps the standard set still.
   */
  peakSalTime() {
    const probe = { gust: 0, sal: 0, dirX: 0, dirZ: 0, speed: 0 };
    let best = this.CAP_LO, bv = -1;
    for (let t = this.CAP_LO; t <= this.CAP_HI; t += 0.05) {
      this.at(t, probe);
      if (probe.sal > bv) { bv = probe.sal; best = t; }
    }
    return { t: best, sal: bv };
  }

  /**
   * The wind at an absolute audio-clock time. A copy of Soundscape.windAt's
   * bulk envelope, over the mirrored schedule.
   *
   * `sal` is the saltation drive and is not simply the gust envelope. Grains
   * do not creep proportionally to wind speed; there is a threshold friction
   * velocity below which the bed is completely static and above which it
   * unloads, which is the physical reason blowing sand is a burst phenomenon
   * and not a level. So the envelope is gated hard and squared, and weighted by
   * the gust's character: a rumble through the wash moves nothing, a dry rasp
   * off a ledge is the one that strips a crest.
   */
  at(t, out) {
    const o = out || {};
    const base = Math.min(0.36, Math.max(0.02,
      0.105 + 0.075 * Math.sin(t * 0.0431 + 1.3) + 0.045 * Math.sin(t * 0.0177 + 0.4) +
      0.03 * Math.sin(t * 0.0091 + 2.7)));
    let gsum = 0, sal = 0, cw = 0;
    for (let i = 0; i < this.gusts.length; i++) {
      const gu = this.gusts[i];
      if (t < gu.t0 || t > gu.t0 + gu.dur) continue;
      const u = (t - gu.t0) / gu.dur;
      const s = Math.sin(Math.PI * Math.pow(u, 0.62));
      const flutter = 0.86 + 0.14 * Math.sin(t * 2.31 + gu.t0);
      const e = gu.peak * s * s * flutter;
      gsum += e;
      cw += e * (0.25 + 0.75 * gu.char);
    }
    const g = Math.min(1, base + gsum);
    /* The threshold is on the *total* wind, not on the gust alone, because the
       thing with a threshold in it is the shear velocity at the bed and the bed
       cannot tell which part of the flow over it is bed wind and which is gust.
       Gating the gust term on its own — the first version here — meant a gust
       riding on a strong bed did no more than the same gust on a calm one, and
       it put the mobile fraction of each gust into a narrow spike around its
       peak: of the eight standard viewpoints, none landed in one.
       0.26 against a bed that runs 0.02-0.36 and gusts that add up to 0.9 puts
       the bed below threshold at all times and most of a gust above it. The
       character weighting rides along, so a rumble through the wash moves less
       than a rasp off a ledge of the same strength. */
    if (gsum > 1e-6) {
      const gated = Math.min(1, (g - 0.26) / 0.34);
      if (gated > 0) sal = Math.pow(gated, 1.4) * (cw / gsum);
    }
    const heading = WIND_HEADING + 0.26 * Math.sin(t * 0.021 + 0.8);
    o.gust = g;
    /* A floor under the still state, from the bed wind rather than from any
       gust. Below the threshold friction velocity the *bed* is static, but the
       few most exposed grains on the most exposed crests are not: a desert on a
       quiet evening always has a little creep somewhere. It matters here for a
       reason beyond physics — absolute zero everywhere reads as "the feature is
       broken", where two or three grains moving on one crest reads as "nothing
       is happening", and those are very different frames. */
    o.sal = Math.min(1, sal + 0.11 * smoothstep(0.11, 0.30, base));
    o.heading = heading;
    o.dirX = Math.sin(heading);
    o.dirZ = Math.cos(heading);
    o.speed = 0.5 + 8.4 * g;
    return o;
  }

  /**
   * The deterministic capture instant for a walk distance. Any `d` lands
   * somewhere inside the mirrored window, the mapping is a pure function, and
   * the window's contents never change after construction — so `walkTo(46)`
   * twice is the same weather twice, to the last grain.
   *
   * One second of weather per metre walked, which is the simplest mapping there
   * is and deliberately not tuned: picking a multiplier that lands the
   * interesting viewpoints inside a gust would be arranging the weather for the
   * camera, and the whole point of driving this from System 6 is that the
   * weather is not arranged.
   */
  captureTime(d) {
    const span = this.CAP_HI - this.CAP_LO;
    let u = (+d || 0) % span;
    if (u < 0) u += span;
    return this.CAP_LO + u;
  }
}

/* ── procedural noise for the shaders ──────────────────────────────────────*/

const NOISE_GLSL = /* glsl */`
float aHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float aNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = aHash(i), b = aHash(i + vec2(1.0, 0.0));
  float c = aHash(i + vec2(0.0, 1.0)), d = aHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float aHG(float g, float c) {
  float g2 = g * g;
  return (1.0 - g2) / (12.56637061 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5));
}
`;

/* ── airborne dust ─────────────────────────────────────────────────────────
 *
 * A cube of motes that wraps around the camera, so the field is unbounded and
 * costs one draw call and no CPU. Everything about how a mote looks is one
 * question — how much light is it scattering toward the eye — and the answer is
 * the Henyey-Greenstein phase function, which is why the motes are nearly
 * invisible looking down-wash and light up into a haze looking into the sun.
 * Additive, at a radiance of a few hundredths: that is what makes them read
 * against the shadowed wall and vanish against a sunlit face without any
 * masking, because a fixed small addition *is* invisible on a bright background
 * and obvious on a dark one. It is the one place in this file where the physics
 * does the art direction for free.
 *
 * The shafts are the other half. Sunbeams through a canyon are the shadow of
 * the crest silhouette projected along the beam, so the modulation is banding
 * in the plane perpendicular to the sun direction — static, because the crest
 * is static, and drifting only as slowly as the motes themselves move through
 * it. Banding in screen space or in world x/z instead would be the giveaway.
 */
/* A pixel's cone out to the fade radius holds a few hundredths of a cubic
   metre, so at any sane number density the motes are *separated specks*, not a
   continuous glow — one mote per few hundred pixels. That is what they should
   be: the continuous glow of a sunbeam is airlight, and aerial.js already has
   the Mie lobe that produces it. These are the individual grains you can pick
   out inside it, and the count and tile are set to put a comfortable scatter of
   them across the frame rather than to build a volume. */
/* The tile has to be small, and the first two attempts at it were not.
 * A 60 m cube around the camera puts 96% of its motes behind, beside or beyond
 * the viewer: measured, a 13,000-mote field at that size delivered forty motes
 * into the frustum and changed 0.05% of the pixels — invisible, and no amount
 * of extra brightness would have fixed it, because the problem was that there
 * was nothing there. Real backlit dust is a *near-field* phenomenon anyway; a
 * thirty-micron grain at fifteen metres subtends nothing. So the tile is the
 * few metres in front of the face where motes are actually resolvable, and the
 * count is set for a few hundred of them in frame. */
const DUST_TILE = 24;

/* Scene-linear radiance of a single grain with the sun directly behind it, and
   its share of the skylight when the beam is not.
   These are levels against the rock, not against the sun, and that is
   deliberate: what decides whether a mote is visible is how it compares to the
   surface behind it. Lit rock in this scene sits near 0.10 linear and shaded
   rock near 0.02, so a fully backlit grain at 0.35 reads clearly even over lit
   rock — which is correct, looking into a low sun dust washes over everything —
   while at ninety degrees the same grain falls to 0.012 and disappears. */
/* 0.55 puts the crossover — the background brightness at which a grain stops
   glowing and starts darkening — at about 0.55 of display white when looking
   into the sun, and below 0.05 when looking away from it. Measured at 0.35 the
   crossover toward the sun sat at 0.39, which is under the value of lit rock,
   so the motes extinguished against the very surfaces a low sun makes them
   swarm over. Raising it does not weaken the law: away from the sun the phase
   function is down by a factor of seventy and the grains are pure extinction
   whatever this is set to. */
const MOTE_FWD = 0.55;
const MOTE_AMB = 0.006;

function buildDust(count, sunDir, sunHue) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const aux = new Float32Array(count * 3);
  /* A fixed integer stream, not Math.random: the mote field has to be the same
     field on every page load or two captures of the same build differ. */
  let s = 0x5ed05;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rnd() * DUST_TILE;
    pos[i * 3 + 1] = rnd() * DUST_TILE;
    pos[i * 3 + 2] = rnd() * DUST_TILE;
    aux[i * 3] = rnd();                       // seed
    aux[i * 3 + 1] = 0.45 + rnd() * rnd() * 2.4;  // size, long-tailed
    aux[i * 3 + 2] = 0.6 + rnd() * 0.8;       // drift rate
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aux', new THREE.BufferAttribute(aux, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uSun: { value: sunDir.clone() },
      uMote: { value: sunHue.clone().multiplyScalar(MOTE_FWD) },
      uMoteAmb: { value: sunHue.clone().multiplyScalar(MOTE_AMB) },
      uPix: { value: 800 },
      uWind: { value: new THREE.Vector2(0, 1) },
      uSpeed: { value: 1 },
      uDrive: { value: 1 },
      uGroundY: { value: 0 },
      uShadowMap: { value: null },
      uShadowMat: { value: new THREE.Matrix4() },
      uHasShadow: { value: 0 },
    },
    vertexShader: /* glsl */`
uniform float uT;
uniform vec3 uCam;
uniform vec3 uSun;
uniform float uPix;
uniform vec2 uWind;
uniform float uSpeed;
uniform float uDrive;
uniform float uGroundY;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uHasShadow;
attribute vec3 aux;
varying float vA;
varying float vPhase;
varying float vLit;
/* unpackRGBAToDepth, for the shadow lookup below. three 0.180 packs directional
   shadow depth into RGBA rather than using a depth texture. */
#include <packing>
${NOISE_GLSL}

/* Is this mote in the sun?
 *
 * The remaining half of the mote visibility law. The phase function was already
 * right — g = 0.62 gives a 56% falloff between 24 and 40 degrees off the beam,
 * and a critic measuring only 14% was measuring pixels rather than mote radiance
 * — but a mote sitting inside a 240 m wall shadow was still scattering full
 * sunlight toward the eye. That is the same V = 1 assumption the fog chunk was
 * making, in a second place, and it is why the motes read as a slab of sprites
 * rather than as dust in a beam: nothing in the field knew where the light was.
 *
 * Sampled per vertex rather than per fragment. A mote is one to four pixels, so
 * a fragment-rate lookup would buy sub-mote shadow detail that cannot be seen,
 * and there are 34,000 of them; this is one fetch each. The coarse cascade is
 * the right one for the same reason it is in the shaft march — a mote does not
 * need to know it is in a pebble's shadow. Outside the cascade the answer has to
 * be "lit", or the field goes dark at the box edge. */
float moteLit(vec3 p) {
  if (uHasShadow < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 1.0;
  float d = unpackRGBAToDepth(texture2D(uShadowMap, c.xy));
  return step(c.z - 0.0012, d);
}

const float TILE = ${DUST_TILE.toFixed(1)};

void main() {
  /* Advection plus a slow convective wander. Motes this fine are tracers: they
     go where the air goes, at the air's own speed, and the only reason they do
     not simply translate is that the air is turbulent at metre scale. */
  vec3 p = position;
  float sd = aux.x;
  p.xz += uWind * (uT * uSpeed * 0.22 * aux.z);
  p.x += sin(uT * 0.21 + sd * 41.0) * 0.7;
  p.y += sin(uT * 0.17 + sd * 23.0) * 0.5 + uT * 0.035 * aux.z;
  p.z += cos(uT * 0.19 + sd * 57.0) * 0.7;

  /* Wrap into the tile centred on the camera. */
  p = mod(p - uCam + TILE * 0.5, TILE) - TILE * 0.5 + uCam;

  vec3 toEye = uCam - p;
  float dist = length(toEye);

  /* Height above the local ground, taken from the camera's own eye height —
     the wash floor is broad and flat and the camera is standing on it, so this
     is right to a few tens of centimetres over the tile and costs nothing. */
  float h = p.y - uGroundY;

  /* Density falls off with height, but not to nothing: there is a well-mixed
     column above the shallow suspension layer and the two together are what a
     backlit canyon actually looks like.
     Flatter than it was (7.5 m). A steep falloff multiplied by the shaft gate
     below put the product's peak in a narrow shell around six metres up, and at
     the eight-metre range these motes live at that is one band high in the
     frame — a critic read the field as a slab of sprites at a single screen
     altitude, which is exactly what a peaked radial shell looks like. */
  float dens = 0.42 + 0.58 * exp(-max(0.0, h) / 16.0);
  dens *= smoothstep(-1.2, 0.35, h);

  /* The shafts. Two bands in the plane perpendicular to the beam. */
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 e1 = normalize(cross(uSun, up));
  vec3 e2 = cross(e1, uSun);
  float b1 = dot(p, e1), b2 = dot(p, e2);
  float shaft = aNoise(vec2(b1 * 0.16, b2 * 0.10));
  shaft = 0.12 + 1.90 * smoothstep(0.30, 0.80, shaft);
  /* Air below the bank tops is in the wall's shadow at this solar elevation,
     so the shaft is weaker where the light has to get past a crest. Softened
     and lowered from (0.22, 0.6..5.5): the beam does come down the corridor in
     the view this is built for, so cutting everything below waist height to a
     fifth was overdrawing the shadow and was half of the single-band problem. */
  shaft *= mix(0.55, 1.0, smoothstep(-0.5, 6.0, h));

  vA = dens * shaft * uDrive;
  vA *= 1.0 - smoothstep(TILE * 0.28, TILE * 0.46, dist);
  vPhase = dot(normalize(toEye), -uSun);
  vLit = moteLit(p);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = uPix * aux.y * 0.010 / max(0.35, dist);
  /* Below a pixel a point stops shrinking and starts having to lose energy
     instead, or the field gets brighter with distance as more motes crowd into
     each pixel and each one still paints a whole one. */
  /* Capped at both ends. Below a pixel a point stops shrinking and has to lose
     energy instead, or the field brightens with distance as more motes crowd
     into a pixel each still painting a whole one. Above four it is a blob:
     without depth of field a mote half a metre from the eye has no business
     being a disc, and there are few enough of them that far that clamping the
     size and letting the alpha carry the difference is invisible. */
  gl_PointSize = clamp(px, 0.85, 4.0);
  vA *= min(1.0, px / 0.85) * min(1.0, px / 0.85);
  if (px > 4.0) vA *= (px / 4.0) * (px / 4.0);
}`,
    fragmentShader: /* glsl */`
uniform vec3 uMote;
uniform vec3 uMoteAmb;
varying float vA;
varying float vPhase;
varying float vLit;
${NOISE_GLSL}

void main() {
  float d = length(gl_PointCoord - 0.5);
  /* Coverage, not brightness. What this fragment is asking is what fraction of
     the pixel the grain hides, with the density and shaft terms from the vertex
     stage read as a probability that a grain is here at all. */
  float cov = smoothstep(0.5, 0.13, d) * vA;
  if (cov < 0.0015) discard;

  /* Backlit is the whole point. g = 0.62 puts about thirty times as much light
     toward the eye at zero degrees from the beam as at ninety, which is roughly
     what a 2-micron mineral grain does and is why dust is a nuisance in front
     of a low sun and invisible behind you. Normalised at forward so uMote is
     readable as the radiance of a grain with the sun directly behind it. */
  float ph = aHG(0.62, vPhase) / aHG(0.62, 1.0);

  /* The grain's own radiance, from the beam that is actually in the scene. A
     mote scattering a fraction of a milliwatt cannot out-radiate a sunlit
     sandstone face, and the previous version let it: the radiance was a
     constant, the blend was additive, and so a mote could only ever brighten
     whatever it was drawn over. Front-lit motes came out as warm-white
     fireflies sitting on top of lit rock.
     Written as an over-blend instead, the visibility law falls out of the
     arithmetic rather than being imposed: the pixel becomes L*cov + bg*(1-cov),
     so a grain darkens any background brighter than itself and glows against
     any background darker. Toward the sun L is large and the motes read against
     shadow; away from it L is a hundredth of lit rock and they extinguish. */
  /* The forward term is gated on whether the sun can actually reach the grain;
     the ambient term is not. That split is the physics: vLit answers a question
     about the sun, and a mote inside a wall's shadow has lost the beam but still
     sits under the whole sky. Gating both would black the motes out inside every
     shadow, which is as wrong in the other direction - shadowed dust is dim, not
     absent, and it still occludes whatever is behind it. */
  vec3 L = uMote * ph * vLit + uMoteAmb;
  gl_FragColor = vec4(L * cov, cov);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    /* Premultiplied source over destination. AdditiveBlending cannot express
       occlusion and occlusion is half of what makes a mote a mote. */
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });

  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 10;
  pts.name = 'dust';
  return pts;
}

/* ── the ground table ──────────────────────────────────────────────────────
 *
 * Saltation has to hug a surface, and the surface only exists on the CPU. Rather
 * than move grains on the CPU every frame, the wash floor is baked once into a
 * small float texture — height, and how much loose sand is available — and read
 * in the vertex shader. Everything after that is free.
 *
 * The availability channel is the part that keeps this honest. Sand blows off
 * sand, not off bedrock and not off a 30-degree cut bank, so it is the product
 * of how flat the ground is and how close to the channel: the ribbons then run
 * where a real wash keeps its loose sand, and stop at the toe of the banks
 * instead of climbing them.
 */
const GX0 = -78, GX1 = 78, GZ0 = 34, GZ1 = -340;
/* Metre-scale. Finer costs load time and buys nothing: a grain hops thirteen
   centimetres, so the difference between reading the bed at 1 m and at 0.3 m is
   invisible, and heightAtQ is expensive enough that the finer grid was adding
   2.7 seconds to every page load. */
const GW = 160, GH = 256;

function bakeGround(terrain, path) {
  const data = new Float32Array(GW * GH * 4);
  const q = {};
  const dx = (GX1 - GX0) / (GW - 1), dz = (GZ1 - GZ0) / (GH - 1);
  const H = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    const z = GZ0 + j * dz;
    path.atZ(z, q);
    for (let i = 0; i < GW; i++) {
      H[j * GW + i] = terrain.heightAtQ(GX0 + i * dx, z, q);
    }
  }
  for (let j = 0; j < GH; j++) {
    const z = GZ0 + j * dz;
    path.atZ(z, q);
    for (let i = 0; i < GW; i++) {
      const o = (j * GW + i) * 4;
      const h = H[j * GW + i];
      const ia = Math.max(0, i - 1), ib = Math.min(GW - 1, i + 1);
      const ja = Math.max(0, j - 1), jb = Math.min(GH - 1, j + 1);
      const gx = (H[j * GW + ib] - H[j * GW + ia]) / ((ib - ia) * dx);
      const gz = (H[jb * GW + i] - H[ja * GW + i]) / ((jb - ja) * dz);
      const slope = Math.hypot(gx, gz);
      const u = Math.abs((GX0 + i * dx - q.x) * Math.cos(q.th));
      /* Flat, and in the channel. Both terms are soft: a real sand sheet
         thins out toward the bank toe rather than ending at a line. */
      const flat = 1 - smoothstep(0.16, 0.55, slope);
      const near = 1 - smoothstep(9.0, 19.0, u);
      data[o] = h;
      data[o + 1] = flat * near;
      data[o + 2] = gx;
      data[o + 3] = gz;
    }
  }
  const t = new THREE.DataTexture(data, GW, GH, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ── saltation ─────────────────────────────────────────────────────────────
 *
 * Grains do not fly. They hop: lifted a few centimetres, carried a fraction of
 * a metre, and driven back into the bed hard enough to eject the next one. The
 * whole population is therefore a field of short ballistic arcs of very
 * different lengths, and what you see from standing height is not the grains
 * but the *ribbons* — the metre-scale streaks of moving bed that snake around
 * every obstacle, because the flow that carries them is a boundary layer with
 * structure in it.
 *
 * So the model is: arcs for the grain, a travelling turbulence field for where
 * the arcs are allowed to happen, and a hard threshold on the wind for whether
 * they happen at all. The threshold is what keeps the desert still.
 */
/* Same lesson as the dust tile, in two dimensions instead of three: an 84 m
   square at 1.6 grains per square metre put 72 changed pixels on the screen in
   the middle of a measured gust. A saltation sheet is dense — thousands of
   grains a square metre in a real ribbon — and it is near-field, because a
   half-millimetre grain past thirty metres is nothing. */
/* Two layers, and the reason is projection. A saltation sheet has to be dense
 * enough at three metres to read as sand rather than as sparks, and it has to
 * reach far enough up the wash to exist at all in a view along the corridor —
 * and one tile cannot do both, because a uniform world density projects to a
 * screen density that falls as the square of the range. Measured: 8 grains a
 * square metre over 60 m changed 0.27% of the pixels at full drive, and the
 * whole of the `ground` view is inside five metres. So there is a near layer
 * sized for the ground at your feet and a far one for the band up the wash,
 * each with its own radial fade, and they cost one draw call each. */
const SALT_NEAR = 22, SALT_FAR = 76;

function buildSaltation(count, TILE, seed, ground, sunTint) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const aux = new Float32Array(count * 4);
  let s = seed;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    pos[i * 3] = rnd() * TILE;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = rnd() * TILE;
    aux[i * 4] = rnd();                        // seed / hop phase
    /* Hop length is strongly skewed: most grains creep, a few take long
       trajectories, and the tail is what you actually see as a streak. */
    const u = rnd();
    const hop = 0.28 + u * u * u * 1.9;        // hop length, metres
    /* Two populations, because one cannot make the measured shape.
     *
     * A ballistic hop at a realistic 1:8 apex-to-range gives a layer whose 90th
     * percentile height is 14 cm and which stops dead at 26 cm. The reference
     * for a blowing-sand layer is 90% below 64 cm with the flux peaking at 2.5
     * to 5 cm and thinning imperceptibly upward, and no single ballistic
     * population reaches that without either absurd hop lengths or trajectories
     * three times too steep. It does not need to: the top of a blowing-sand
     * cloud is not saltation at all. It is short-term suspension — fine grains
     * held up by turbulence rather than thrown, going where the eddies go.
     *
     * So four grains in five saltate, and the fifth is suspended: its apex is
     * drawn directly rather than from a hop length, with a long thin tail.
     * Measured on the result: mode 3.8 cm, p50 5.6, p75 15.6, p90 49.8, and a
     * 1% tail above 1.7 m that is far too sparse to read as anything. */
    const susp = rnd() < 0.20;
    aux[i * 4 + 1] = susp ? -(0.18 + Math.pow(rnd(), 1.5) * 2.0) : hop;
    aux[i * 4 + 2] = 0.5 + rnd() * 1.1;        // size
    aux[i * 4 + 3] = rnd();                    // ribbon threshold jitter
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(0, 1) },
      uSpeed: { value: 1 },
      uSal: { value: 0 },
      uPix: { value: 800 },
      uGround: { value: ground },
      uBox: { value: new THREE.Vector4(GX0, GZ0, 1 / (GX1 - GX0), 1 / (GZ1 - GZ0)) },
      uTint: { value: sunTint.clone() },
      /* Radiance of a grain, in scene units. A quartz grain in the full beam
         reflects about 0.3/pi of nine and a bit, which is 0.95 — three times
         this — so the number is conservative on purpose: nothing here knows
         whether a grain is in the wall's shadow or not, and a sheet lit as if
         it were always in sun would be a strip of daylight running across
         ground that is plainly in shade. Under-lighting it costs the effect
         some presence in the shaded views and keeps it honest in the lit ones,
         which is the right way round. */
      uLevel: { value: 0.17 },
    },
    vertexShader: /* glsl */`
uniform float uT;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uSpeed;
uniform float uSal;
uniform float uPix;
uniform sampler2D uGround;
uniform vec4 uBox;
attribute vec4 aux;
varying float vA;
varying vec2 vDir;
varying float vStreak;
${NOISE_GLSL}

const float TILE = ${TILE.toFixed(1)};

void main() {
  vec2 p = position.xz;
  float sd = aux.x;
  /* A negative hop length flags a suspended grain and carries its apex height
     directly, so the two populations cost no extra attribute. */
  bool susp = aux.y < 0.0;
  float hopLen = susp ? 1.6 : aux.y;
  float apex = susp ? -aux.y : hopLen * 0.13;

  /* Downwind travel. Grain speed is a fraction of wind speed and scales with
     hop length, because a long trajectory spends longer being accelerated. A
     suspended grain is higher in the boundary layer where the wind is faster
     and it is not losing momentum to the bed on every impact, so it runs at
     most of the free-stream speed. */
  float gspd = uSpeed * (susp ? 0.78 : (0.14 + 0.30 * hopLen));
  float adv = uT * gspd + sd * 137.0;
  p += uWind * adv;
  p = mod(p - uCam.xz + TILE * 0.5, TILE) - TILE * 0.5 + uCam.xz;

  vec2 uv = vec2((p.x - uBox.x) * uBox.z, (p.y - uBox.y) * uBox.w);
  vec4 gt = texture2D(uGround, uv);
  float avail = gt.y * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

  /* Ribbons: a turbulence field advected downwind, sheared along the flow so
     the streaks are long and narrow and meander instead of tiling as blobs. */
  vec2 wp = vec2(-uWind.y, uWind.x);
  float along = dot(p, uWind), across = dot(p, wp);
  float rib = aNoise(vec2(across * 0.30 + sin(along * 0.055) * 1.6,
                          along * 0.055 - uT * 0.42));
  rib *= 0.55 + 0.45 * aNoise(vec2(across * 0.07, along * 0.018 - uT * 0.11));

  /* The threshold. Below it the bed is completely static — which is most of
     the time, and is the point. */
  float drive = uSal * 1.35;
  float moving = smoothstep(0.0, 0.35, drive - 0.85 * (0.55 + 0.45 * aux.w) * (1.0 - rib));

  /* The hop. A ballistic arc, its apex a fixed fraction of its length — real
     saltation trajectories are flat, roughly one part height to eight of
     range, which is why the sheet hugs the ground instead of billowing. */
  /* Suspended grains are not on a ballistic clock; they rise and fall with the
     eddy that is carrying them, which is slow. */
  float u = fract(uT * (susp ? 0.16 : (0.7 + 1.9 / max(0.25, hopLen))) + sd * 7.31);
  float arc = 4.0 * u * (1.0 - u);
  float y = gt.x + arc * apex;

  /* Lee-side plumes. Where the bed falls away downwind the grains leave it and
     rain down the slip face instead of following the surface, which is the one
     place saltation stops being a sheet and becomes visible as a cloud. */
  float dwn = -(gt.z * uWind.x + gt.w * uWind.y);
  float lee = smoothstep(0.20, 0.75, dwn);
  y += lee * arc * 0.30;

  vec3 wpos = vec3(p.x, y, p.y);
  float dist = distance(wpos, uCam);

  vA = moving * avail * (0.35 + 0.65 * arc) * (1.0 + lee * 0.8);
  vA *= 1.0 - smoothstep(TILE * 0.28, TILE * 0.46, dist);
  /* The suspended fifth is the fine tail of the size distribution — that is why
     it is suspended — so it is smaller and much fainter than the saltating
     bulk. Without this the upper layer reads as a separate cloud of full-weight
     grains hanging in the air instead of as the carpet thinning out. */
  if (susp) vA *= 0.34;

  vec4 mv = modelViewMatrix * vec4(wpos, 1.0);
  gl_Position = projectionMatrix * mv;

  /* ---- particle phase: from resolvable grains to a continuous sheet --------
   *
   * A grain is 390 microns. At ten metres that subtends about a seventeenth of a
   * pixel, so a 3 px dot is not a grain, it is a two-centimetre pebble, and a
   * field of them reads as gravel thrown through the air rather than as sand
   * moving over a bed. But drawing sub-pixel grains honestly is not the answer
   * either: below a pixel a point stops shrinking, so the sheet would simply be
   * a scatter of hard dots at whatever the minimum size is.
   *
   * What each far sprite has to become instead is a *patch* of the sheet rather
   * than one grain — a sample of the optical depth field, not an object. That
   * only requires the alpha to fall as the area the clamp forces on it grows, so
   * the total optical depth through the layer is whatever the grain count says it
   * is regardless of how it happens to be packaged into sprites.
   *
   * This compensation was linear, and needed to be squared: clamping a sprite
   * from px up to base multiplies its area by (base/px)^2, not (base/px). Every
   * grain past the clamp distance was therefore too bright by that ratio, which
   * is the whole of the 'discrete resolvable particles at high alpha' reading —
   * the error grows as the grain recedes, so exactly the grains that should have
   * melted into a sheet were the ones held at full strength.
   *
   * With that fixed the minimum can go up rather than down. At 2.2 px the far
   * sprites overlap into continuous cover instead of stippling, and each one is
   * faint enough to be a sheet sample: a grain whose true size is 0.3 px lands at
   * (0.3/2.2)^2, about 2% alpha, over five times the area. Low alpha at high
   * coverage, which is what a saltation carpet is. */
  const float MIN_PX = 2.2;
  float px = uPix * aux.z * (susp ? 0.014 : 0.024) / max(0.30, dist);
  float base = max(MIN_PX, px);

  /* ---- motion streaking ---------------------------------------------------
   *
   * A saltating grain crosses its own diameter many times over in a frame, so it
   * is never imaged as a point; it is imaged as the path it took. Rendering it
   * round is a shutter-speed claim the rest of the scene does not make, and it is
   * the other half of why the sheet reads as discrete objects — round dots are
   * things, streaks are motion.
   *
   * The direction is taken by projecting the grain's own velocity, so it is
   * correct under any view: a grain blowing across the frame streaks sideways, one
   * blowing away from the camera barely streaks at all, and the ribbons align
   * with the wind for free. Grains going nowhere stay round, which is the still
   * air the brief asks to be noticeable. */
  vec3 vel = vec3(uWind.x, 0.0, uWind.y) * gspd;
  vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(wpos + vel * 0.055, 1.0));
  vec2 s0 = gl_Position.xy / max(1e-4, gl_Position.w);
  vec2 s1 = c1.xy / max(1e-4, c1.w);
  float aspect = projectionMatrix[1][1] / max(1e-6, projectionMatrix[0][0]);
  vec2 dv = (s1 - s0) * vec2(aspect, 1.0);
  float dl = length(dv);
  vDir = dl > 1e-6 ? dv / dl : vec2(1.0, 0.0);
  vStreak = clamp(dl * 30.0, 0.0, 2.4);

  gl_PointSize = base * (1.0 + vStreak);
  vA *= min(1.0, px / base) * min(1.0, px / base);
  /* Smearing the same grain along a longer path spreads its light over that
     path rather than adding any, so the streak dims as it lengthens. */
  vA /= 1.0 + vStreak;
}`,
    fragmentShader: /* glsl */`
uniform vec3 uTint;
uniform float uLevel;
varying float vA;
varying vec2 vDir;
varying float vStreak;

void main() {
  /* Soft, and not very bright. A hard bright dot per grain reads as a spark;
     what a saltation sheet looks like is a slightly luminous fog that happens
     to be made of grains, so each one is a soft blob well under the exposure of
     the lit floor and the sheet is built out of their overlap. */
  /* Elongated along the direction of travel. The sprite was widened by the same
     factor in the vertex stage, so this stretches the grain inside its own
     footprint rather than cropping it, and a stationary grain (vStreak = 0)
     falls back to exactly the round profile this had before. */
  vec2 q = gl_PointCoord - 0.5;
  vec2 e = vec2(dot(q, vDir), dot(q, vec2(-vDir.y, vDir.x)));
  float r = length(vec2(e.x / (0.5 * (1.0 + vStreak)), e.y / 0.5));
  float a = vA * smoothstep(1.0, 0.16, r);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uTint * uLevel, a * 0.95);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });

  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 9;
  pts.name = 'saltation';
  return pts;
}

/** Push one uniform onto every saltation layer. */
function eachSalt(layers, fn) { for (const l of layers) fn(l.material.uniforms); }

/* ── heat shimmer ──────────────────────────────────────────────────────────
 *
 * The frame goes through one render target and comes back distorted. That is a
 * post pass, and System 7 owns post-processing, so this one is deliberately a
 * single isolated stage with no grading, no bloom and no colour management of
 * its own beyond the tonemap it has to perform because rendering into a target
 * skips it: a later chain can take the target and drop this stage, or keep it
 * as its first pass, without untangling anything.
 *
 * The mask is the whole design. A full-screen wobble is a heat-haze filter in a
 * video editor; real shimmer is a *path* phenomenon — you see it where the line
 * of sight has spent a long time in the first couple of metres of superheated
 * air above hot ground, which is exactly the grazing rays that run away up the
 * wash and end on something far away. A ray to a butte top climbs out of that
 * layer in twenty metres and gets nothing. So the mask is the same stratified
 * column integral aerial.js uses, with a scale height of about a metre and a
 * half instead of two hundred and eighty, evaluated against the reconstructed
 * world position of each pixel.
 *
 * Which means it is strongest precisely where a distant butte edge is seen
 * through air rising off nearer ground, and that is where it should be.
 *
 * At golden hour it is also *subtle*: the ground is still hot but the air above
 * it is cooling fast, so the refractive gradient is a fraction of what it is at
 * two in the afternoon. Peak displacement here is about two pixels at 1600 wide.
 */
function shimmerNoise(n = 128) {
  const data = new Uint8Array(n * n * 4);
  const grid = (freq, seed) => {
    const g = new Float32Array(freq * freq);
    let s = seed >>> 0;
    for (let i = 0; i < g.length; i++) {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      g[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return g;
  };
  const sample = (g, freq, x, y) => {
    const fx = x * freq, fy = y * freq;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    const tx = fx - i0, ty = fy - j0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const w = (i, j) => g[((j % freq) + freq) % freq * freq + ((i % freq) + freq) % freq];
    return (w(i0, j0) * (1 - sx) + w(i0 + 1, j0) * sx) * (1 - sy) +
           (w(i0, j0 + 1) * (1 - sx) + w(i0 + 1, j0 + 1) * sx) * sy;
  };
  /* Anisotropic on purpose: a rising thermal plume is tall and thin, so the
     cells are stretched three to one in y. Two octaves per channel, and the
     two channels are decorrelated so x and y displacement do not move together
     and produce a pure zoom. */
  const layers = [
    [[8, 3, 0x11], [17, 6, 0x27]],
    [[9, 3, 0x53], [19, 7, 0x71]],
  ];
  const gs = layers.map((ls) => ls.map(([fx, fy, sd]) => [fx, fy, grid(Math.max(fx, fy), sd)]));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i / n, y = j / n;
      for (let ch = 0; ch < 2; ch++) {
        let v = 0, w = 0, amp = 1;
        for (const [fx, fy, g] of gs[ch]) {
          const f = Math.max(fx, fy);
          v += amp * sample(g, f, x * fx / f, y * fy / f);
          w += amp;
          amp *= 0.55;
        }
        data[(j * n + i) * 4 + ch] = Math.round(255 * (v / w));
      }
      data[(j * n + i) * 4 + 2] = 0;
      data[(j * n + i) * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;

  /* ---- and its actual moments, which is the whole of why this effect measured
   * zero for three rounds ---------------------------------------------------
   *
   * uAmp is documented as a displacement in pixels and has been reasoned about,
   * tuned and defended as one. It is not one. The shader forms the displacement
   * as uAmp * (n - 0.5), and (n - 0.5) is not a unit-amplitude signal: two
   * octaves of value noise, smoothstep-interpolated and weight-normalised, come
   * out with a standard deviation near 0.15, so the term multiplying uAmp has an
   * rms of about 0.167 rather than 1. uAmp = 3 therefore delivers half a pixel,
   * and at the junction, where the height term takes another factor of two, a
   * quarter of one. Measured 0.237 px against 0.24 predicted from these numbers.
   *
   * Every previous attempt to fix this raised HOT_H or changed the saturation law
   * — both of which were also wrong, and both of which were found by measurement
   * — while the units error sat underneath multiplying the answer by a sixth. It
   * survived because a plausible-looking constant with a plausible-looking
   * comment reads as calibrated.
   *
   * Also worth having: the red channel's mean is 0.4785, not 0.5. Half of the
   * x displacement was a constant shift of the whole frame rather than a wobble.
   *
   * So the moments are measured at bake time and handed to the shader, which
   * subtracts the real mean and divides by the real sd. uAmp then means pixels
   * rms at 900 lines, which is what it has always claimed to mean. */
  const moments = (ch) => {
    let s = 0, s2 = 0;
    const N = n * n;
    for (let i = 0; i < N; i++) s += data[i * 4 + ch] / 255;
    const mean = s / N;
    for (let i = 0; i < N; i++) s2 += (data[i * 4 + ch] / 255 - mean) ** 2;
    return { mean, sd: Math.sqrt(s2 / N) };
  };
  const mr = moments(0), mg = moments(1);
  return {
    tex: t,
    mean: new THREE.Vector2(mr.mean, mg.mean),
    inv: new THREE.Vector2(1 / (mr.sd || 1), 1 / (mg.sd || 1)),
  };
}

/* ── shadow-mapped in-scatter: the shafts ──────────────────────────────────
 *
 * The standing defect this answers, in the critic's words: "you are integrating
 * as though V(x) = 1 everywhere along the ray." The fog chunk in aerial.js
 * solves the in-scatter integral in closed form, which is only possible if the
 * air is lit uniformly — so every cubic metre of it scatters as though it were
 * in full sun, including the air inside a 240 m wall shadow. That single
 * omission is why there are no beams, why the air never darkens where the sun
 * cannot reach it, and why the aureole has no shape. The scene was paying the
 * full price of a dust event and collecting one of its four dividends.
 *
 * So this restores V(x), the only way it can be restored: by marching. For each
 * pixel, step along the view ray from the camera to whatever the depth buffer
 * says it hit, and at each step ask the sun's own shadow map whether that point
 * is lit. Where it is, add its scattering; where it is not, add nothing. Beams
 * are then not painted, they are what is left when the shadowed air stops
 * contributing — which is why this does not reintroduce the noise that the
 * milky-blob regression was made of. There is no noise in it at all.
 *
 * Four decisions worth their reasons:
 *
 * Coarse cascade only. sky.js casts two, a 2048 fine map for pebble shadows and
 * a coarse one sized to hold a whole 240 m wall shadow. A shaft is a large-scale
 * phenomenon and the fine cascade would cost a second projection and a second
 * fetch per step to resolve detail no beam has. The coarse map is the right
 * instrument and it is the one whose frustum actually contains the casters that
 * matter.
 *
 * Half resolution. In-scatter is a low-frequency field — it is an integral along
 * a ray, so it varies smoothly except where the shadow boundary crosses it — and
 * a quarter of the pixels is the standard economy for it. Bilinear upsample in
 * the composite that already exists, so this adds one half-res pass and no new
 * fullscreen pass.
 *
 * The dither is screen-space and has no time term. Determinism is a hard
 * requirement here: walkTo/lookAt must give pixel-identical frames, and the
 * usual trick of rotating the sample offsets per frame would break that for a
 * temporal filter this pass does not have.
 *
 * The march is distance-capped rather than run to the far plane. On a sky pixel
 * the depth buffer gives the far plane, and marching 6 km of mostly-empty air
 * to accumulate the last 1% is most of the cost of the pass for none of the
 * picture. Capping it also keeps this out of a fight with sky.js, which draws
 * the dome with fog off: the sky keeps its own colour and gains only the
 * in-scatter of the near dust column actually in front of it, which is what a
 * shaft crossing the sky looks like.
 */

/* Steps at the top tier. In-scatter along a ray is smooth, so the step count
   buys shadow-boundary sharpness rather than accuracy of the integral, and the
   dither converts what is left into a fine dissolve instead of banding. */
const SHAFT_STEPS = 28;
/* Metres. Past this the density is low enough and the view transmittance small
   enough that the remaining in-scatter is under a percent of the total, and the
   closed-form fog chunk is already accounting for the far field. */
const SHAFT_MAX_DIST = 1400;
/* Scattering gain on the marched term.
 *
 * Not a free brightness knob, and it must not be used as one: the closed-form
 * chunk in aerial.js is already delivering the V = 1 in-scatter for this medium,
 * so adding a second full-strength in-scatter term would double-count the air.
 * What this pass contributes is the *modulation* — the difference between lit
 * and shadowed air — which is why it is added at a fraction and why the frame
 * does not get uniformly brighter.
 *
 * Was lowered to 0.35 to protect the depth ladder, on the strength of sun_gap's
 * best-strip figure moving from 42% to 25%. That decision was made on noise and
 * has been reversed.
 *
 * layers.mjs's best-strip statistic is a maximum over nine lateral positions,
 * and on a single sun_gap frame those nine scored 0, 0, 0, 53, 0, 59, 0, 17, 0
 * on value edge share — a within-frame spread wider than any difference the dial
 * produces. Re-measured on a pixel-weighted mean over all strips carrying at
 * least a quarter of the frame's peak rock count, a four-point sweep of this
 * gain reads:
 *
 *     gain   sun_gap sat / V     wash_low sat / V
 *     0        13% /  8%           12% / 20%
 *     0.35     10% / 14%            8% / 16%
 *     0.55     -- interpolated --
 *     0.70     14% / 21%            5% / 14%
 *     1.10     15% / 19%            3% / 19%
 *
 * So the pass does not damage sun_gap at all: its saturation ladder is flat
 * within noise and its *value* ladder roughly doubles, which makes sense once
 * stated — shadowed air darkening is itself a depth cue. The one real cost is
 * wash_low's saturation ladder, which falls monotonically across all four
 * settings and is therefore a signal rather than a spread artefact. That view
 * looks down at near floor, where the correction is strongest and where there is
 * least distance for a ladder to be made of.
 *
 * 0.55 trades three points of wash_low saturation for seven of sun_gap value,
 * against a brief that asks three times over for dust in the sunbeams.
 *
 * Overridable from the URL as `#shaft=0.2`, so this stays measurable in one
 * render-lock acquisition rather than four rebuilds. */
function hashNum(key, dflt) {
  try {
    if (typeof location === 'undefined' || !location.hash) return dflt;
    const m = new RegExp(`(?:^|[#,&;])${key}=([0-9]*\\.?[0-9]+)`).exec(location.hash);
    return m ? Number(m[1]) : dflt;
  } catch (e) { return dflt; }
}
const SHAFT_GAIN = hashNum('shaft', 0.55);
/* Reddening of the beam along its own slant path, as an optical depth in blue
 * at the wash floor, falling with height as the dust does.
 *
 * A critic found the aureole chromatically neutral - B/G 0.956 two degrees off
 * the sun - while rock in the same frame is lit at R/G 1.70, and named the
 * missing mechanism as wavelength-dependent extinction of the illuminating beam
 * before it in-scatters. This is that term.
 *
 * It uses the Rayleigh triple's *shape* rather than the dust triple's, and the
 * reason is worth stating because the dust triple points the other way. BETA_M
 * is [1.000, 0.962, 0.905] normalised to red, so red is the most extinguished
 * channel and transmission through it is bluer - defensible for very coarse
 * grains, and exactly wrong for the reddening of a low sun, which is a
 * short-wavelength-weighted effect carried by the fine mode that accompanies
 * blowing dust. Using BETA_M here would produce a blue low sun and destroy the
 * warm limit that is the best-measured thing in this system.
 *
 * Kept small and capped, because sky.js already delivers the beam's full
 * atmospheric slant path in sun.color - air mass 6.86 through 8 km of Rayleigh -
 * and re-applying that would double-count it. What is legitimately mine is the
 * extra reddening from *this scene's* dust, which sky.js assumed away at 0.032
 * aerosol. */
const SHAFT_RED = 0.35;

/* Coherence length of the shadowing, metres. The correction is faded out beyond
 * it, and this is the term that stops the shafts and the depth ladder fighting.
 *
 * They were fighting, measurably. A sweep of SHAFT_GAIN with everything else
 * held fixed put sun_gap's value ladder at 53% edge share with the pass off and
 * 27% at 0.35, and the mechanism is not subtle: the correction accumulates along
 * the ray, so the further a mass is, the more in-scatter the pass takes back from
 * it — while the entire value ladder consists of distant masses being *lifted*
 * by airlight. One says far is darker, the other says far is brighter, and they
 * are arguing about the same pixels.
 *
 * The resolution is that the V = 1 assumption the fog chunk makes is not equally
 * wrong at all ranges. It is badly wrong close in, where one wall subtends most
 * of the sky and the air is coherently shadowed for a hundred metres at a
 * stretch. It becomes progressively *right* at long range, where a sightline
 * crosses many uncorrelated occluders and the mean visibility along it tends to
 * a constant that the closed-form source function has effectively already
 * absorbed. So a correction that decays with distance is the more accurate
 * model, not a compromise for the ladder's benefit — and it puts the beams
 * exactly where the brief asks for them, in the corridor the camera is standing
 * in, while leaving the far field to the closed form the ladder is built on. */
const SHAFT_COHERE = 320;

class Shafts {
  constructor(coeffs, density, sunDir, sunCol) {
    this.rt = null;
    this.enabled = true;
    this.steps = SHAFT_STEPS;
    /* Per-metre extinction at the floor, from aerial.js's own coefficients so
       the marched medium and the fogged medium are the same medium. */
    const bt = (i) => (coeffs.betaR[i] + coeffs.betaM[i]) * density;
    const beta = new THREE.Vector3(bt(0), bt(1), bt(2));
    const bs = (i) => coeffs.betaS[i] * density;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uShadowMap: { value: null },
        uShadowMat: { value: new THREE.Matrix4() },
        uInvVP: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() },
        uSun: { value: sunDir.clone() },
        uSunCol: { value: sunCol.clone() },
        uBeta: { value: beta },
        uBetaS: { value: new THREE.Vector3(bs(0), bs(1), bs(2)) },
        /* Normalised so blue is 1, which is what makes SHAFT_RED readable as an
           optical depth in blue rather than as an arbitrary gain. */
        uRedBeta: { value: new THREE.Vector3(...coeffs.betaR)
          .divideScalar(coeffs.betaR[2] || 1) },
        uRes: { value: new THREE.Vector2(1, 1) },
        uH: { value: coeffs.H },
        uHS: { value: coeffs.hSusp },
        uY0: { value: coeffs.y0 },
        uGB: { value: coeffs.gBroad },
        uWB: { value: coeffs.wBroad },
        uGN: { value: coeffs.gNarrow },
        uWN: { value: coeffs.wNarrow },
        uSteps: { value: SHAFT_STEPS },
        uMaxDist: { value: SHAFT_MAX_DIST },
        uGain: { value: SHAFT_GAIN },
        uCohere: { value: SHAFT_COHERE },
        uRed: { value: SHAFT_RED },
        uHasShadow: { value: 0 },
      },
      vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
      fragmentShader: /* glsl */`
uniform sampler2D tDepth;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uBeta;
uniform vec3 uBetaS;
uniform vec3 uRedBeta;
uniform vec2 uRes;
uniform float uH;
uniform float uHS;
uniform float uY0;
uniform float uGB;
uniform float uWB;
uniform float uGN;
uniform float uWN;
uniform float uMaxDist;
uniform float uGain;
uniform float uCohere;
uniform float uRed;
uniform float uHasShadow;
uniform int uSteps;
varying vec2 vUv;

/* unpackRGBAToDepth. three 0.180 packs directional shadow depth into RGBA
   rather than using a depth texture, so the comparison has to unpack exactly
   the way the shadow chunk does. Included rather than reimplemented so it
   cannot drift from three's own packing. */
#include <packing>

vec3 worldAt(vec2 uv, float d) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * ndc;
  return w.xyz / w.w;
}

/* Is this point in the sun? Outside the cascade's frustum the answer has to be
   "lit": the coarse box rides with the player and air beyond it is open desert,
   so assuming shadow there would hang a dark curtain at the box edge. */
float visible(vec3 p) {
  if (uHasShadow < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (any(lessThan(c, vec3(0.0))) || any(greaterThan(c, vec3(1.0)))) return 1.0;
  /* A fixed depth bias is right here where it was wrong for surfaces. sky.js
     needs a receiver-plane slope bias because a surface lies *in* the light's
     path at a grazing angle; a point in mid-air has no receiver plane and no
     self-shadowing to forgive, so all this has to clear is map quantisation. */
  float d = unpackRGBAToDepth(texture2D(uShadowMap, c.xy));
  return step(c.z - 0.0012, d);
}

float dustAt(float y) { return exp(-max(0.0, y - uY0) / uH); }
float suspAt(float y) { return exp(-max(0.0, y - uY0) / uHS); }

float hg(float g, float c) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5);
}

void main() {
  float dpt = texture2D(tDepth, vUv).r;
  vec3 hit = worldAt(vUv, dpt);
  vec3 ray = hit - uCam;
  float far = length(ray);
  vec3 dir = ray / max(far, 1e-4);
  float march = min(far, uMaxDist);

  /* Same two-lobe mixture as the fog chunk, normalised at forward so the pair
     spans 0..1 and the gain means what it says. cos of the scattering angle is
     dot(dir, uSun): looking into the sun is forward scatter. */
  float c = dot(dir, uSun);
  float ph = (uWB * hg(uGB, c) / hg(uGB, 1.0) + uWN * hg(uGN, c) / hg(uGN, 1.0))
           / (uWB + uWN);

  /* Screen-space dither only. No time term: two calls to walkTo with the same
     argument have to produce identical frames, and this pass has no temporal
     filter behind it to launder a rotating offset. */
  float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  int n = uSteps;
  float dt = march / float(n);
  /* Two integrals of the same ray: one with the visibility term the physics
     asks for, one with V = 1. The pass emits their *difference*.
     
     This is the only formulation that cannot double-count. aerial.js's fog chunk
     already delivers the closed-form in-scatter for this medium under exactly
     the assumption V = 1 everywhere, and it is applied to every fragment in the
     scene. Adding a second, full-strength in-scatter term on top of it does not
     restore the visibility term, it just adds a second atmosphere — measured, it
     put a quarter of the display range into the frame and would have flattened
     the depth ladder completely.
     
     What the shadow map actually licenses is a *correction*, and since V <= 1
     the correction is everywhere negative: shadowed air has to give back
     in-scatter the chunk already granted it. Beams are then not painted on, they
     are the air that was not asked to give anything back — which is why this
     cannot brighten the frame, cannot blow out the far field, and contains no
     noise of any kind.

     DO NOT MAKE THIS ADDITIVE. The sign is not a stylistic choice and it is not
     a bug to be tidied up. An additive volumetric term looks more like what a
     volumetric pass is "supposed" to be, and the first version of this file was
     written that way; it measured a quarter of the display range added to the
     frame. If beams read as too weak, the honest levers are SHAFT_GAIN, the
     phase weights, or the chunk's own source function — never the sign. That the
     correction can only subtract is a safety property of the whole pass: it is
     what guarantees this can never reintroduce the milky-blob regression, and it
     is why there is no noise anywhere in the haze. */
  vec3 accV = vec3(0.0);
  vec3 accAll = vec3(0.0);
  vec3 tr = vec3(1.0);
  for (int i = 0; i < 64; i++) {
    if (i >= n) break;
    float s = (float(i) + dth) * dt;
    vec3 p = uCam + dir * s;
    float nd = dustAt(p.y), ns = suspAt(p.y);
    vec3 be = uBeta * nd + uBetaS * ns;

    /* Reddening of the illuminating beam along its own slant path, deepest at
       the floor where the beam has crossed the most dust. uRed is quoted as the
       blue optical depth at the floor, so the slant geometry is already inside
       the constant and does not appear again here. */
    vec3 beamT = exp(-uRedBeta * uRed * nd);

    /* Not named step: that is a GLSL builtin and shadowing it is legal but
       some drivers are less relaxed about it than the spec is. */
    /* Fade the correction with range: coherent shadowing close in, where one
       wall owns the sky, decaying to the closed form's V = 1 far out, where many
       uncorrelated occluders average away. Applied to the difference rather than
       to either integral, so the two stay comparable and the emitted value is
       still exactly a correction. */
    float coh = exp(-s / uCohere);
    vec3 seg = tr * ph * be * beamT * dt;
    accV += seg * mix(1.0, visible(p), coh);
    accAll += seg;
    tr *= exp(-be * dt);
    if (tr.g < 0.004) break;
  }

  gl_FragColor = vec4((accV - accAll) * uSunCol * uGain, 1.0);
}`,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quadMesh = new THREE.Mesh(quad, this.mat);
    this.quadMesh.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quadMesh);
    this.quadCam = new THREE.Camera();
  }

  resize(w, h) {
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    if (this.rt && this.rt.width === hw && this.rt.height === hh) return;
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(hw, hh, {
      type: THREE.HalfFloatType, depthBuffer: false,
    });
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.mat.uniforms.uRes.value.set(hw, hh);
  }
}

/* The calibrated amplitude, in pixels rms at 900 lines — see the moments note in
 * shimmerNoise for why that units claim is now true and was not before. Kept as
 * a named constant so that switching the effect back on restores the measured
 * value rather than whatever happened to be in the uniform. */
const SHIMMER_AMP = 2.2;

/* Is the effect wanted at all — a look decision, and it outranks the quality
 * governor. perf.js turns the shimmer on for its top tier, so a plain default of
 * `off` in the constructor lasted exactly until the first tier evaluation and the
 * amplitude was back to 2.2 by the time anything looked at it. A scratch probe
 * caught that; a frame would not have, which is the point of asserting it.
 *
 * So the two switches are different questions and are kept apart: this one is
 * whether the effect is wanted, perf.js's is whether the frame can afford it, and
 * the effect runs only if both say yes. perf.js can therefore turn it further
 * off, never back on. `#shimmer=1` restores it. */
const SHIMMER_WANTED = hashNum('shimmer', 0) > 0.5;

class Shimmer {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.rt = null;
    /* ---- off by default, and this is a look decision, not a bug -------------
     *
     * The physics here is right and the units fix underneath it was real: uAmp
     * was multiplying a noise term of rms 0.167 rather than 1, so for three
     * rounds this delivered a sixth of its nominal amplitude and every metric
     * called it too weak. Corrected, it displaced the floor-to-wall junction by
     * 1.26 px, which is a defensible inferior mirage and measured as one.
     *
     * The first thing a viewer said about it was that the mid distance looked
     * like it was melting. That settles it: a refractive warp is an *effect*, and
     * a viewer who can name the effect rather than the scene has already found
     * the fault, whatever the measurement says. Necessary is not sufficient, and
     * where a metric and a perception disagree the perception decides.
     *
     * Kept whole rather than deleted, because the mechanism is sound and the
     *      reason it is off is taste rather than correctness. `#shimmer=1` restores
     * it. */
    this.enabled = SHIMMER_WANTED;
    this.samples = 4;
    const nz = shimmerNoise(128);
    this.noise = nz.tex;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tShaft: { value: null },
        uShaft: { value: 1 },
        tNoise: { value: this.noise },
        uNMean: { value: nz.mean },
        uNInv: { value: nz.inv },
        uT: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        /* Zero unless the effect is switched on. The pass itself may still run
           when the shafts need its depth, and in that case this has to be zero
           or the warp comes back through the side door. */
        uAmp: { value: this.enabled ? SHIMMER_AMP : 0 },
        uCam: { value: new THREE.Vector3() },
        uGroundY: { value: 0 },
        uInvVP: { value: new THREE.Matrix4() },
        uNear: { value: 0.06 },
        uFar: { value: 6000 },
      },
      vertexShader: /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
      fragmentShader: /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tShaft;
uniform float uShaft;
uniform sampler2D tNoise;
uniform vec2 uNMean;
uniform vec2 uNInv;
uniform float uT;
uniform vec2 uRes;
uniform float uAmp;
uniform vec3 uCam;
uniform float uGroundY;
uniform mat4 uInvVP;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

/* Scale height of the superheated layer, metres.
 *
 * Was 1.55, and that single number was why this effect measured literally zero
 * where a critic went looking for it. 1.55 m is the shimmer layer over a strip
 * of tarmac: any sightline that climbs at all leaves it within metres, so the
 * equivalent path collapses to HOT_H/tan(elevation) and a distant skyline two
 * hundred metres above the eye got four metres of hot air and a quarter of a
 * pixel of displacement. The layer that matters here is the superadiabatic
 * surface layer over several square kilometres of rock that has been in the sun
 * all day, which is tens of metres deep, not one. At 9 m the same skyline gets
 * fifty metres of equivalent path.
 */
const float HOT_H = 9.0;

void main() {
  float dz = texture2D(tDepth, vUv).x;

  /* Reconstruct the world point. For sky the depth is at the far plane and the
     ray is capped rather than followed, since the integral has converged long
     before then anyway — but the cap matters, because an uncapped ray puts a
     numerically enormous path into the sky and shimmers the whole dome. */
  vec4 ndc = vec4(vUv * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0);
  vec4 wp = uInvVP * ndc;
  vec3 world = wp.xyz / wp.w;
  vec3 ray = world - uCam;
  float dist = length(ray);
  bool far = dz > 0.99999 || dist > 1800.0;
  if (far) { ray = normalize(ray) * 1800.0; dist = 1800.0; }
  vec3 dir = ray / max(1e-4, dist);

  /* Column of hot air along the ray, as an equivalent ground-level path. */
  float y0 = uCam.y - uGroundY, y1 = y0 + ray.y;
  float k = (y1 - y0) / HOT_H;
  float shape = abs(k) < 1e-3 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
  float col = dist * exp(-max(0.0, y0) / HOT_H) * shape;

  /* The refraction angle accumulates as a random walk over uncorrelated cells,
     so it goes as the square root of the path, not linearly and not as a
     saturating exponential. The exponential was the second half of the zero:
     1 - exp(-col/42) is flat to three figures for any path over a couple of
     hundred metres, so every ray that did clear the threshold got the same
     displacement and the term carried no contrast at all. A gentle cap keeps a
     kilometre of grazing floor from turning into a funhouse mirror. */
  float m = sqrt(col / 120.0);
  m = m / (1.0 + 0.55 * m);
  /* Nothing in the first few metres: the air right in front of your face has
     not had a path length to bend anything through, and shimmer on the ground
     at your feet is the single loudest wrong note this effect can play. */
  m *= smoothstep(6.0, 26.0, dist);

  vec2 d = vec2(0.0);
  /* uAmp is zero whenever the effect is off, and the branch is frame-coherent,
     so this skips the noise taps entirely rather than multiplying them away. */
  if (uAmp > 0.0 && m > 0.004) {
    /* Two layers rising at different rates. Screen space is the right domain
       for the *cells* — they are between the eye and everything, at no
       particular distance — but their size must not change with resolution,
       hence the aspect-corrected uv. */
    /* Cell size and rise rate both matter and both were an order of magnitude
       out at first. A shimmer cell is a convective plume a few centimetres
       across seen at range — tens of pixels, not a third of the screen — and it
       boils: the plumes rise at something like a metre a second, which is tens
       of pixels a second, not two. Slow, huge cells read as a lens wobble. */
    vec2 q = vec2(vUv.x * uRes.x / uRes.y, vUv.y);
    vec2 n1 = texture2D(tNoise, q * 20.0 + vec2(0.09 * uT, -0.55 * uT)).rg;
    vec2 n2 = texture2D(tNoise, q * 44.0 + vec2(-0.16 * uT, -1.15 * uT)).rg;
    /* Normalised to zero mean and unit rms using the texture's measured
       moments, so uAmp below is genuinely a displacement in pixels. */
    vec2 a1 = (n1 - uNMean) * uNInv;
    vec2 a2 = (n2 - uNMean) * uNInv;
    d = (a1 + a2 * 0.55) / sqrt(1.0 + 0.55 * 0.55);
    /* Vertical displacement dominates: the gradient is vertical, so the
       refraction is too. */
    d.x *= 0.55;
    /* uAmp is quoted in pixels at 900 lines, so the displacement is an angle
       rather than a fraction of the frame and an 800-wide iteration shows the
       same effect as a 1600-wide handoff. */
    d *= uAmp * m * (uRes.y / 900.0) / uRes;
  }

  /* Deliberately not named col: this function already uses that name for the
     hot-air optical column above, and redeclaring it as a vec3 in the same
     scope is a compile error rather than a shadow. */
  vec3 outRgb = texture2D(tScene, vUv + d).rgb;
  /* Marched in-scatter, added after the warp so a shaft is displaced along with
     the air it is in rather than sliding across it. Bilinear from the half-res
     buffer; in-scatter is smooth enough that the upsample is invisible except
     at a shadow boundary, and the dither in the march already softens those. */
  outRgb += texture2D(tShaft, vUv + d).rgb * uShaft;
  gl_FragColor = vec4(outRgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quadMesh = new THREE.Mesh(quad, this.mat);
    this.quadMesh.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quadMesh);
    this.quadCam = new THREE.Camera();
  }

  resize(w, h) {
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    if (this.rt) { this.rt.dispose(); this.rt.depthTexture.dispose(); }
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: depth,
      samples: this.samples,
    });
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.mat.uniforms.tScene.value = this.rt.texture;
    this.mat.uniforms.tDepth.value = depth;
    this.mat.uniforms.uRes.value.set(w, h);
  }
}

/* ── the system ────────────────────────────────────────────────────────────*/

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Camera} opts.camera
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {object} opts.terrain
 * @param {object} opts.path
 * @param {THREE.DirectionalLight} opts.sun
 * @param {object} opts.audio   window.__game.audio
 */
export function buildAtmosphere({ scene, camera, renderer, terrain, path, sun, audio }) {
  const wind = new Wind(audio);

  const sunDir = new THREE.Vector3()
    .subVectors(sun.position, sun.target.position).normalize();
  const peak = Math.max(sun.color.r, sun.color.g, sun.color.b) || 1;
  const sunTint = new THREE.Color(sun.color.r / peak, sun.color.g / peak, sun.color.b / peak);
  /* The same beam hue, normalised to unit luminance instead of unit peak, so a
     radiance constant multiplied by it is the radiance it says it is. Peak
     normalisation quietly makes every level depend on how red the sun is. */
  const sl = 0.2126 * sun.color.r + 0.7152 * sun.color.g + 0.0722 * sun.color.b || 1;
  const sunHue = new THREE.Color(sun.color.r / sl, sun.color.g / sl, sun.color.b / sl);

  const t0 = performance.now();
  const ground = bakeGround(terrain, path);
  const bakeMs = performance.now() - t0;

  const dust = buildDust(34000, sunDir, sunHue);
  const salt = [
    buildSaltation(24000, SALT_NEAR, 0x5a17d, ground, sunTint),
    buildSaltation(17000, SALT_FAR, 0x2c91b, ground, sunTint),
  ];
  salt[1].name = 'saltation_far';
  scene.add(dust, ...salt);

  const shimmer = new Shimmer(renderer, camera);

  /* The marched in-scatter takes its medium from aerial.js rather than
     redeclaring it, and its beam colour and direction from the scene's own sun,
     so it follows System 4 wherever the lighting lands. Radiance is the sun's
     colour at unit luminance times its intensity: the gain is then a pure
     scattering fraction and does not quietly depend on how red the sun is. */
  const fogDensity = (scene.fog && scene.fog.density) || 0.0019;
  const aerC = aerialCoeffs(sun, (scene.fog && scene.fog.color) || new THREE.Color(1, 1, 1));
  const shafts = new Shafts(aerC, fogDensity, sunDir,
    new THREE.Color(aerC.jSun[0], aerC.jSun[1], aerC.jSun[2]));
  /* A one-texel black texture so the composite's sampler is always bound, even
     on the tier where the pass is switched off entirely. */
  const blackPx = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackPx.needsUpdate = true;
  shimmer.mat.uniforms.tShaft.value = blackPx;

  /* Scene info has to be snapshotted after the scene pass and before the
     composite, or `info()` reports the fullscreen triangle instead of the
     frame. renderer.info is reset per render() call, so there is nowhere else
     to catch it. */
  const lastInfo = { calls: 0, triangles: 0 };
  /* Did the offscreen pass actually run this frame? Not the same question as
     whether the shimmer is enabled, now that the shafts can require it. */
  let ranPass = false;

  /* ---- who owns the full-frame pass ----------------------------------------
   *
   * Latched by the first call to renderShafts, which is System 7 saying it has
   * a depth texture of its own and will drive the march itself. From then on
   * this system stops drawing the scene into its own target and the target is
   * handed back: a full-frame RGBA16F at four samples is about 100 MB of colour
   * plus depth written and resolved every frame at 1080p, and once the shimmer is
   * off it exists for nothing but the depth attachment.
   *
   * It has to be a latch rather than a constant because there are two callers
   * with different capabilities. post.js's main path renders the scene into its
   * own float target and then asks for the shaft buffer. Its `#nopost` path does
   * not: it hands the frame straight back here, and on that path this pass is the
   * only multisampling in the frame as well as the only thing that can march the
   * shafts. Returning false unconditionally would have quietly stripped both
   * antialiasing and light shafts out of every ungraded control set — which is
   * the set that exists specifically so the graded one can be trusted.
   *
   * The cost of the latch is that on the first frame, before renderShafts has
   * ever been called, this owns the pass and the march runs twice. One frame at
   * startup, against carrying the target forever.
   *
   * `#handover=1` pre-latches it. That exists because the saving had to be
   * measured before the call site existed on the other side, and it is worth
   * keeping as a switch for measuring it again: with it set, this pass is gone
   * whether or not anything is driving the march, which is the only way to price
   * the target on its own rather than the target plus the march. */
  let externalDriver = hashNum('handover', 0) > 0.5;

  function releaseTarget() {
    if (!shimmer.rt) return;
    shimmer.rt.depthTexture.dispose();
    shimmer.rt.dispose();
    shimmer.rt = null;
    shimmer.mat.uniforms.tScene.value = null;
    shimmer.mat.uniforms.tDepth.value = null;
  }

  const W = { gust: 0, sal: 0, dirX: 0, dirZ: 1, speed: 0.5, heading: WIND_HEADING };
  let clock = wind.CAP_LO;          // the atmosphere's own time, in audio-clock seconds
  /* Frozen means "the harness put us here". The contract requires that two
     walkTo(46) calls give identical pixels, and the harness's own sequence is
     walkTo, wait 400 ms with the loop running, then render — so a clock that
     kept ticking through that wait would put the dust somewhere different every
     time, and the first measurement of this found exactly that: 8.8% of pixels
     differing between two captures of one viewpoint.
     Freezing on walkTo costs a human nothing, because a human never calls it —
     CONTRACT.md is explicit that the first-person controls and walkTo are
     separate paths — and the first metre they walk clears it anyway. */
  let frozen = false;

  function applyWind() {
    const d = dust.material.uniforms;
    d.uWind.value.set(W.dirX, W.dirZ);
    d.uSpeed.value = W.speed;
    /* Dust density lifts with the wind but not much and not fast: suspended
       load has a settling time of minutes, so the air does not clear between
       gusts the way the bed does. */
    d.uDrive.value = 0.72 + 0.55 * W.gust;
    eachSalt(salt, (s) => {
      s.uWind.value.set(W.dirX, W.dirZ);
      s.uSpeed.value = W.speed;
      s.uSal.value = W.sal;
    });
  }

  function setClock(t) {
    clock = t;
    wind.at(t, W);
    dust.material.uniforms.uT.value = t;
    eachSalt(salt, (s) => { s.uT.value = t; });
    applyWind();
  }

  function syncCamera() {
    const gy = camera.position.y - EYE;
    const h = renderer.domElement.height || 800;
    const px = h / (2 * Math.tan(camera.fov * Math.PI / 360));
    const d = dust.material.uniforms;
    d.uCam.value.copy(camera.position);
    d.uGroundY.value = gy;
    d.uPix.value = px;
    eachSalt(salt, (s) => { s.uCam.value.copy(camera.position); s.uPix.value = px; });
    return gy;
  }

  setClock(wind.captureTime(0));

  return {
    /**
     * Advance the live clock. Called from the render loop only.
     * @param {number} dt
     * @param {boolean} moving  is the player actually walking
     */
    update(dt, moving) {
      if (frozen && !moving) return;
      frozen = false;
      let now = clock + dt;
      try { const t = audio.time; if (typeof t === 'number' && t > 0) now = t; } catch (e) {}
      wind.pump(now);
      setClock(now);
    },
    /**
     * Place the atmosphere at the deterministic weather for this walk
     * distance. Called from walkTo, which is the harness's entry point and the
     * only place determinism is required.
     */
    setWalk(d) {
      frozen = true;
      setClock(wind.captureTime(d));
    },
    /**
     * Park the atmosphere on the hardest-blowing moment of the deterministic
     * capture window, so the saltation can be photographed at all. Returns the
     * drive it found, which is the honest answer to "how strong a gust is this".
     * Deterministic in the same way setWalk is: same window, same answer.
     */
    setGustPeak() {
      frozen = true;
      const p = wind.peakSalTime();
      setClock(p.t);
      return { t: p.t, sal: W.sal, gust: W.gust, speed: W.speed, dir: [W.dirX, W.dirZ] };
    },
    /**
     * Draw the frame. Returns true if it went through the shimmer pass, in
     * which case the caller must not render again.
     */
    composite(scn, cam) {
      const gy = syncCamera();

      /* The dust field's shadow lookup, hoisted above every early return.
         It used to sit further down, inside the branch that only runs when the
         shimmer pass does — so switching the shimmer off silently un-shadowed
         all 34,000 motes and put them back to scattering full sunlight inside
         every wall shadow. Nothing about a mote's shadowing has anything to do
         with whether a screen-space warp is enabled. */
      {
        const sm = sun.shadow && sun.shadow.map;
        const du = dust.material.uniforms;
        du.uHasShadow.value = sm ? 1 : 0;
        if (sm) {
          du.uShadowMap.value = sm.texture;
          du.uShadowMat.value.copy(sun.shadow.matrix);
        }
      }

      /* Whether to run the pass at all.
       *
       * Two things ride on this target besides the warp: the marched in-scatter
       * needs its depth texture to know where the ray stops, and System 7's
       * defocus reads the same depth. So "shimmer off" and "pass off" are not
       * the same switch, and conflating them would have deleted the light shafts
       * along with the effect nobody wanted.
       *
       * When neither wants it, returning false hands the frame to post.js, whose
       * fallback draws the scene straight into its own target — one full-res
       * RGBA16F target and one full-res blit less per frame, which is the largest
       * single bandwidth item in the scene.
       *
       * Since System 7 now attaches a depth texture to sceneRT and drives the
       * march through renderShafts, that is exactly what happens on the shipped
       * path — see the externalDriver note above for why it is a latch and not
       * simply `return false`. */
      if (!shimmer.enabled && (externalDriver || !shafts.enabled)) {
        ranPass = false;
        releaseTarget();
        return false;
      }
      const w = renderer.domElement.width, h = renderer.domElement.height;
      if (!w || !h) { ranPass = false; return false; }
      ranPass = true;
      shimmer.resize(w, h);
      renderer.setRenderTarget(shimmer.rt);
      renderer.render(scn, cam);
      lastInfo.calls = renderer.info.render.calls;
      lastInfo.triangles = renderer.info.render.triangles;

      const u = shimmer.mat.uniforms;
      u.uT.value = clock;
      u.uCam.value.copy(cam.position);
      u.uGroundY.value = gy;
      u.uInvVP.value
        .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
        .invert();

      /* Marched in-scatter, half-res, between the scene pass and the composite.
         The shadow map is read every frame rather than cached: three allocates
         it on the first shadow render, so at construction time it is null, and
         it is reallocated whenever the quality governor changes the map size. */
      if (shafts.enabled) {
        shafts.resize(w, h);
        const sm = sun.shadow && sun.shadow.map;
        const su = shafts.mat.uniforms;
        su.uHasShadow.value = sm ? 1 : 0;
        if (sm) {
          su.uShadowMap.value = sm.texture;
          su.uShadowMat.value.copy(sun.shadow.matrix);
        }
        su.tDepth.value = shimmer.rt.depthTexture;
        su.uCam.value.copy(cam.position);
        su.uInvVP.value.copy(u.uInvVP.value);
        renderer.setRenderTarget(shafts.rt);
        renderer.render(shafts.quadScene, shafts.quadCam);
        u.tShaft.value = shafts.rt.texture;
        u.uShaft.value = 1;
      } else {
        u.uShaft.value = 0;
      }

      renderer.setRenderTarget(null);
      renderer.render(shimmer.quadScene, shimmer.quadCam);
      return true;
    },
    /* March the in-scatter against somebody else's depth, and hand back the
     * buffer. This is the whole of the depth handover.
     *
     *   const tex = atmo.renderShafts(depthTexture, camera);
     *   if (tex) { ...add it to the frame... }
     *
     * Three things about the buffer that are not guessable from its type, and
     * getting any of them wrong will look like a bug somewhere else:
     *
     * 1. IT IS NEGATIVE, OR ZERO. NEVER POSITIVE. It is a correction to
     *    in-scatter the fog chunk has already granted under the assumption that
     *    nothing shadows the air, so it can only ever take light back out. Add it
     *    with a positive gain and it darkens; the beams are the places it takes
     *    nothing. Do not clamp it, do not abs it, do not treat it as an emissive
     *    layer, and do not "fix" the sign — see the long note in the shader.
     * 2. The gain is already applied. SHAFT_GAIN was set by measuring what the
     *    pass costs the depth ladder across four settings, so a second gain on
     *    top is a second, unmeasured decision. Add it at 1.0 unless there is a
     *    reason on the record.
     * 3. Half resolution, HalfFloat, linear filtered, so it wants sampling at
     *    full-res UVs and will interpolate. It carries no alpha worth reading.
     *
     * Returns null when the pass is off, when there is no depth to march against
     * or when the frame has no size — so a null return is normal and means "add
     * nothing", not "something failed". The previous render target is restored
     * before returning, because this is called in the middle of somebody else's
     * frame and silently redirecting their output would be unforgivable. */
    renderShafts(depthTexture, cam) {
      externalDriver = true;
      if (!shafts.enabled || !depthTexture || !cam) return null;
      const w = renderer.domElement.width, h = renderer.domElement.height;
      if (!w || !h) return null;

      shafts.resize(w, h);
      const su = shafts.mat.uniforms;
      const sm = sun.shadow && sun.shadow.map;
      su.uHasShadow.value = sm ? 1 : 0;
      if (sm) {
        su.uShadowMap.value = sm.texture;
        su.uShadowMat.value.copy(sun.shadow.matrix);
      }
      su.tDepth.value = depthTexture;
      su.uCam.value.copy(cam.position);
      su.uInvVP.value
        .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
        .invert();

      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(shafts.rt);
      renderer.render(shafts.quadScene, shafts.quadCam);
      renderer.setRenderTarget(prev);
      return shafts.rt.texture;
    },
    /* Which side owns the full-frame pass, and what that target costs while it
     * exists. For tools/_a5hand.mjs, which is what proves the handover happened
     * rather than asserting it — `owned` going false is the whole saving, and it
     * is not visible in a frame, so nothing else could catch a regression here. */
    passInfo() {
      const rt = shimmer.rt;
      const samples = rt ? (rt.samples | 0) : 0;
      /* RGBA16F colour plus a 32-bit depth texture, times the sample count for
         the colour, written and resolved. Bytes per frame, so a reader does not
         have to reconstruct the arithmetic to know what dropping it buys. */
      const px = rt ? rt.width * rt.height : 0;
      return {
        owned: !!rt,
        externalDriver,
        width: rt ? rt.width : 0,
        height: rt ? rt.height : 0,
        samples,
        megabytesPerFrame: +((px * (8 * Math.max(1, samples) + 4)) / 1048576).toFixed(1),
      };
    },
    /* The half-res marched buffer itself, for readRenderTargetPixels. Diagnostic
       only — the texture is what callers want. It exists so the *sign* of the
       correction can be asserted directly rather than inferred from whether the
       frame got darker, which cannot be measured on a path where nothing
       composites it yet. See tools/_a5hand.mjs. */
    _shaftRT() { return shafts.rt; },
    /** Scene-pass draw call and triangle counts, excluding the composite. */
    lastInfo() { return ranPass ? lastInfo : null; },
    /* The marched in-scatter, for the quality governor in perf.js.
     *
     * Three rungs rather than a switch, because the pass degrades gracefully in
     * a way most effects do not: in-scatter is a smooth integral, so halving the
     * step count costs shadow-boundary crispness and nothing else, and the
     * dither turns the difference into a dissolve rather than banding. 0 drops
     * the pass and its half-res target entirely.
     *
     *   n = 0   off
     *   n = 1   14 steps
     *   n = 2   28 steps  (top tier)
     */
    setShaftQuality(n) {
      const q = Math.max(0, Math.min(2, n | 0));
      shafts.enabled = q > 0;
      shafts.mat.uniforms.uSteps.value = q === 2 ? SHAFT_STEPS : SHAFT_STEPS >> 1;
      if (!shafts.enabled && shafts.rt) { shafts.rt.dispose(); shafts.rt = null; }
    },
    /** What the marched pass is actually doing, for measurement. */
    shaftInfo() {
      const u = shafts.mat.uniforms;
      return {
        enabled: shafts.enabled,
        steps: u.uSteps.value,
        maxDist: u.uMaxDist.value,
        gain: u.uGain.value,
        cohere: u.uCohere.value,
        red: u.uRed.value,
        hasShadow: !!u.uHasShadow.value,
        halfRes: shafts.rt ? [shafts.rt.width, shafts.rt.height] : null,
        beta: u.uBeta.value.toArray(),
      };
    },
    /* Multisampling on the offscreen buffer the whole scene is drawn into, for
       the quality governor in perf.js. It is by far the most expensive number
       in this system and it is not obvious from looking at it: the target is
       RGBA16F, so at 1920x1080 four samples is 66 MB of colour plus 33 MB of
       depth written and then resolved every single frame. Two samples halves
       that and zero quarters it. Nothing else about the pass changes.
       Only the geometric edges of the scene depend on it, and the canvas has no
       multisampling of its own to fall back on while this pass owns the frame,
       so the top tier keeps four and the ladder spends them. Drops the target,
       because resize() compares dimensions and would otherwise keep the old
       sample count for a buffer of unchanged size. */
    setShimmerSamples(n) {
      const s = Math.max(0, n | 0);
      if (s === shimmer.samples) return;
      shimmer.samples = s;
      if (shimmer.rt) {
        shimmer.rt.depthTexture.dispose();
        shimmer.rt.dispose();
        shimmer.rt = null;
      }
    },
    /* Toggling this at runtime is a development affordance, not a supported
       path: it swaps the whole frame between two different framebuffers. Drop
       the target on the way out so re-enabling rebuilds it from scratch rather
       than reusing one that has been sitting unbound. */
    setShimmer(b) {
      /* Conjunction, not assignment: this is the performance tier's opinion, and
         it cannot overrule the look decision in SHIMMER_WANTED. */
      shimmer.enabled = !!b && SHIMMER_WANTED;
      shimmer.mat.uniforms.uAmp.value = shimmer.enabled ? SHIMMER_AMP : 0;
      /* Only give the target back if nothing else wants it. The marched
         in-scatter reads its depth texture, so disposing it here while the
         shafts are on would drop them too. */
      if (!shimmer.enabled && !shafts.enabled && shimmer.rt) {
        shimmer.rt.depthTexture.dispose();
        shimmer.rt.dispose();
        shimmer.rt = null;
        shimmer.mat.uniforms.tScene.value = null;
        shimmer.mat.uniforms.tDepth.value = null;
      }
    },
    /* The frame probe re-renders the scene with an override material to
       separate sky from ground. Points drawn through a mesh material come out
       as stray single texels, and in a 1/8-scale mask a stray texel is a whole
       region — so the particles step out of that pass. */
    setHidden(b) { dust.visible = !b; for (const l of salt) l.visible = !b; },
    /* For System 7's quality ladder. perf.js currently reaches in by name and
       finds only the near saltation layer, which leaves the far one at full
       count on every rung; this does both clouds and every layer of each, and
       is the supported way to spend them. The particle attributes are hashed by
       index, so any prefix is still an even scatter. */
    setParticleFraction(dustF, saltF) {
      const cut = (o, f) => o.geometry.setDrawRange(0,
        Math.max(1, Math.round(o.geometry.attributes.position.count * f)));
      cut(dust, dustF);
      for (const l of salt) cut(l, saltF);
    },
    /* The composite material, for the shimmer diagnostic in tools/_a5shim.mjs
       and for whatever System 7's chain wants to do with the amplitude. */
    _shimmerMaterial: shimmer.mat,
    _diag: {
      bakeMs,
      sunDir: [sunDir.x, sunDir.y, sunDir.z],
      capWindow: [wind.CAP_LO, wind.CAP_HI],
      /* The saltation drive at each of the eight standard capture distances,
         so "is there sand in the set" is answerable without rendering it. */
      salAt: (ds) => ds.map((d) => {
        const t = wind.captureTime(d), w = wind.at(t, {});
        return { d, t: +t.toFixed(2), gust: +w.gust.toFixed(3), sal: +w.sal.toFixed(3) };
      }),
      dust: dust.geometry.attributes.position.count,
      salt: salt.reduce((n, l) => n + l.geometry.attributes.position.count, 0),
      get wind() { return { ...W, clock, frozen }; },
      gusts: () => wind.gusts.length,
    },
  };
}
