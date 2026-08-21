/* Sedona Sunset — System 7: post-processing and polish.
 *
 * Everything between "the scene has been shaded" and "these are the bytes in
 * the PNG": tone mapping, grade, defocus, lens flare, vignette, chromatic
 * aberration, grain and dither.
 *
 * ── where this sits in the frame, and why it does not own the shimmer ───────
 *
 * System 5 draws the whole scene into an RGBA16F multisampled target and blits
 * it back through a heat-haze displacement. That was deliberately built as one
 * isolated stage so a later chain could compose with it, and it is left exactly
 * where it is. The only thing this file does to it is change where its blit
 * lands:
 *
 *   scene ──► shimmer.rt (RGBA16F, MSAA)      System 5
 *          ──► sceneRT   (RGBA16F, linear)    System 5's blit, redirected here
 *          ──► bright/blur/flare (quarter res)
 *          ──► canvas                          grade, tonemap, grain
 *
 * The redirect is the one piece of cleverness in the file and it earns its
 * keep. three decides whether to run `<tonemapping_fragment>` and
 * `<colorspace_fragment>` from whether the current render target is null — see
 * WebGLPrograms.getParameters. So the shimmer blit, which is written to end in
 * those two includes, tone maps and sRGB-encodes when it draws to the canvas
 * and does *neither* when it draws into a target. Pointing it at a float target
 * therefore hands this chain the frame in scene-linear radiance, with no edits
 * to atmosphere.js and no second copy of its shader. Turn post off and the same
 * file goes back to owning the frame unchanged.
 *
 * ── the constraint the grade is built around ────────────────────────────────
 *
 * Several surfaces in this scene have colour that is measured correct against
 * real photographs: lit rock at saturation 0.615-0.626, hue +18.9 to +19.4,
 * V 0.589-0.600, all on the brightest 40% of a `wall_lit` crop. A grade that
 * "pushes oranges and teals" can destroy that in one line.
 *
 * So the tone curve here is *the same ACES fit three already applies*,
 * reproduced verbatim from tonemapping_pars_fragment rather than replaced. With
 * every grade term at zero this chain is a bit-exact identity on the tonemapped
 * frame, which means the measured baseline is preserved by construction and
 * every number that moves can be attributed to one term. The grade itself is a
 * split-tone of a few percent per channel — warm into the highlights, blue-
 * violet into the shadows — plus a vibrance that is gated *off* above
 * saturation 0.6 precisely so it cannot touch lit rock.
 *
 * "Teal" in a warm desert grade is the shadows cooling, not the frame drifting
 * cyan. There is no global channel rotation anywhere in this file.
 *
 * ── determinism ─────────────────────────────────────────────────────────────
 *
 * The harness calls walkTo, waits 400 ms with the loop running, then renders.
 * Anything driven by the wall clock differs between two captures of the same
 * viewpoint — System 5 measured 8.8% of pixels moving that way before it froze
 * its particle clock on walkTo. The grain here does the same thing: it is a
 * fixed noise texture read at an offset derived from a phase, and walkTo pins
 * that phase to a pure function of the walk distance and freezes it until the
 * player actually moves. Every other term in the chain is a function of the
 * camera alone.
 *
 * ── cost ────────────────────────────────────────────────────────────────────
 *
 * Five added passes, four of them at quarter resolution. On the reference
 * numbers for this GPU a ten-pass chain including half-res raymarching came to
 * under a millisecond, so the pass count is not the thing to watch — the added
 * bandwidth is, and it is one RGBA16F full-res target (~17 MB at 1080p) against
 * the ~100 MB the shimmer buffer already moves. The quality ladder in perf.js
 * sheds the low-res chain first, then the defocus, then the flare; the grade,
 * vignette and grain survive to the bottom tier because they are one pass that
 * has to exist anyway and they are what the scene looks like.
 */
import * as THREE from 'three';

/* ── tunables ───────────────────────────────────────────────────────────────
 *
 * Collected here rather than scattered through the shaders because everything
 * upstream is still moving — lighting and the in-scatter phase function are
 * both in flight — so this chain has to be re-tunable without being rewritten.
 * Each is exposed on the returned handle as `params` and can be overridden from
 * the URL, e.g. `#grain=0` or `#grade=0`, which is how the measurement captures
 * separate one term from another.
 */
export const POST_DEFAULTS = {
  /* Grade. Both tints are normalised to unit Rec.709 luminance, so they rotate
     hue without moving exposure — a tint that also brightens is a tint whose
     effect on a saturation measurement cannot be separated from its effect on
     value. */
  gradeAmount: 1.0,          // master, 0 = bit-exact identity against no post
  shadowTint: [0.9813, 0.9964, 1.0920],  // blue-violet, 11% B over R
  highTint:   [1.0246, 0.9987, 0.9400],  // warm, 9% R over B
  /* Scene-linear luminance at which the split crosses. 0.12 sits between the
     lit rock of this scene (~0.30 linear) and its shaded rock (~0.05), which is
     what makes the two ends of the tint land on the two populations instead of
     averaging over both. Measured through tools/_p7grade.mjs on sys4d: lit rock
     moves saturation 0.604 -> 0.600 and hue 18.9 -> 18.5, and shaded rock moves
     B/G 0.789 -> 0.822 and hue 13.0 -> 11.2. That is the whole of "teal": the
     shadows cool, the lit faces do not move. */
  splitPivot: 0.12,
  vibrance: 0.10,            // low-saturation pixels only; zero above sat 0.60
  /* Chroma-preserving, and applied after the sRGB encode with the pivot at
     encoded middle grey. See the shader for why both of those are corrections
     rather than choices. */
  contrast: 1.03, contrastPivot: 0.5,

  /* Defocus. A physical thin-lens CoC, so the shape of the falloff is not a
     free parameter: 24 mm at f/8 focused at 12 m on a 24 mm-high sensor. That
     is a landscape photographer's stopped-down frame — everything past about
     five metres is inside the circle of confusion and only what is at your feet
     softens. `farPx` is the one non-physical term, a fraction of a pixel of
     softness on geometry past 900 m, and it is deliberately far beyond every
     measurement window in the project. */
  focal: 0.024, fStop: 8.0, focus: 12.0,
  cocMax: 4.0,               // pixels, at 900 lines
  farPx: 0.35, farA: 900.0, farB: 2500.0,

  /* Bloom and flare, in scene-linear radiance. The threshold is above anything
     the rock or the floor reaches, so only the sky near the sun and the sun
     itself feed it. */
  bloomThresh: 0.55, bloomKnee: 0.35, bloomGain: 0.055,
  ghostGain: 0.030, veilGain: 0.055, streakGain: 0.030,

  /* Polish. */
  vignette: 0.20,            // linear light lost at the extreme corner
  aberration: 0.9,           // pixels of radial split at the extreme corner
  grain: 0.010,              // encoded units, shadow amplitude; ~2.5 code values
};

/* ── the grain plate ────────────────────────────────────────────────────────
 *
 * Not a per-pixel hash. White noise reads as digital sensor noise and, more to
 * the point for this project, it is the one thing that would let a structure
 * metric be bought with amplitude: `hf/lf` is a ratio of one-pixel to
 * four-pixel gradient energy, and uncorrelated noise is pure hf. Real film
 * grain is a clumped emulsion, correlated over rather more than a pixel, so the
 * plate is value noise passed through a binomial kernel and renormalised.
 *
 * Three decorrelated channels, so the grain can be mostly luminance with a
 * little chroma in it, which is what colour negative actually does.
 *
 * Fixed integer stream, never Math.random: two page loads must produce the same
 * plate or the determinism check fails on the grain alone.
 */
function grainPlate(n = 256) {
  const raw = new Float32Array(n * n * 3);
  let s = 0x7ea11 >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < raw.length; i++) raw[i] = rnd();

  /* One binomial pass. Wider than this and the plate stops dithering — the
     whole point of the shadow amplitude is that it is a code value or two, and
     a heavily smoothed plate has no energy left at the step it has to break
     up. Narrower and it is white noise again. */
  const out = new Uint8Array(n * n * 4);
  const K = [1, 2, 1];
  const at = (x, y, c) => raw[(((y + n) % n) * n + ((x + n) % n)) * 3 + c];
  for (let c = 0; c < 3; c++) {
    let mn = 1e9, mx = -1e9;
    const tmp = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0, w = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const k = K[i + 1] * K[j + 1];
            v += k * at(x + i, y + j, c); w += k;
          }
        }
        v /= w;
        tmp[y * n + x] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const sc = 255 / Math.max(1e-6, mx - mn);
    for (let i = 0; i < n * n; i++) out[i * 4 + c] = Math.round((tmp[i] - mn) * sc);
  }
  for (let i = 0; i < n * n; i++) out[i * 4 + 3] = 255;

  const t = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.NearestFilter;   // one plate texel per screen pixel, always
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ── shared shader source ───────────────────────────────────────────────────*/

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */`
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* Non-finite guard, and it is not defensive programming — it fixed a visible
 * defect. The first capture through this chain had a hard-edged black rectangle
 * across the sky of the wash_mid view that was absent with the chain switched
 * off, and the mechanism is worth recording because any later pass will hit it
 * too.
 *
 * The scene buffer is RGBA16F, so a radiance above 65504 arrives as +Inf. A
 * tone curve does not care: ACES clamps, and Inf comes out white, which is why
 * nothing upstream had ever noticed. A *bright pass* does care, because its
 * soft knee divides by the luminance — Inf/Inf is NaN. NaN then propagates
 * through both separable blur passes, and since a blur is a sum, one poisoned
 * texel poisons every texel within the kernel: the horizontal pass smears it
 * into a line and the vertical pass turns that line into a rectangle. The hard
 * edges are the kernel's support, which is exactly why it did not look like a
 * shading artefact.
 *
 * A test of x >= 0.0 is false for NaN and for negatives, which is all this
 * needs in
 * GLSL ES 1.00 — isnan() is a 3.0 builtin and this material compiles as 1.00.
 */
vec3 sane(vec3 c) {
  return vec3(c.r >= 0.0 ? min(c.r, 60000.0) : 0.0,
              c.g >= 0.0 ? min(c.g, 60000.0) : 0.0,
              c.b >= 0.0 ? min(c.b, 60000.0) : 0.0);
}
`;

function fullscreenMesh(mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(
    new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/* ── the chain ──────────────────────────────────────────────────────────────*/

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {object} o.atmo          the buildAtmosphere handle (System 5)
 * @param {THREE.DirectionalLight} o.sun
 */
export function createPost({ renderer, camera, atmo, sun }) {
  const hash = (typeof location !== 'undefined' ? location.hash || '' : '').toLowerCase();
  const num = (key, dflt) => {
    const m = hash.match(new RegExp('[#&]' + key + '=([0-9.]+)'));
    return m ? +m[1] : dflt;
  };
  const P = { ...POST_DEFAULTS };
  P.grain = num('grain', P.grain);
  P.gradeAmount = num('grade', P.gradeAmount);
  /* A multiplier on the three flare gains, for one specific job: the sun in
     this scene is below the butte skyline from every standard viewpoint, so it
     is always partly or wholly occluded and the ghosts correctly never fire.
     That is the effect working, and it is also indistinguishable from the
     effect being broken. `#flare=8` makes the geometry visible so it can be
     checked once, rather than shipping a path nothing has ever exercised. */
  P.flareScale = num('flare', 1);
  const disabled = /(^|[#&])nopost(\b|$|&)/.test(hash);

  const plate = grainPlate(256);

  /* ── targets ───────────────────────────────────────────────────────────── */

  let sceneRT = null;          // full res, scene-linear radiance
  let loA = null, loB = null;  // the low-resolution ping-pong
  let W = 0, H = 0, LODIV = 4;

  function allocate(w, h, div) {
    if (sceneRT && W === w && H === h && LODIV === div) return;
    W = w; H = h; LODIV = div;
    if (sceneRT) { sceneRT.dispose(); sceneRT = null; }
    for (const t of [loA, loB]) if (t) t.dispose();
    loA = loB = null;

    sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      /* Needed only by the fallback path, where the shimmer stage is off and
         the scene is drawn straight in here. A renderbuffer, not a texture:
         nothing in this chain reads depth out of it — the defocus reads System
         5's depth texture, which is the same depth from the same pass. */
      depthBuffer: true,
      samples: 0,
    });
    sceneRT.texture.minFilter = THREE.LinearFilter;
    sceneRT.texture.magFilter = THREE.LinearFilter;
    sceneRT.texture.generateMipmaps = false;

    if (div > 0) {
      const lw = Math.max(2, Math.round(w / div)), lh = Math.max(2, Math.round(h / div));
      const mk = () => {
        const t = new THREE.WebGLRenderTarget(lw, lh, {
          type: THREE.HalfFloatType, depthBuffer: false, samples: 0,
        });
        t.texture.minFilter = THREE.LinearFilter;
        t.texture.magFilter = THREE.LinearFilter;
        t.texture.generateMipmaps = false;
        t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      };
      loA = mk(); loB = mk();
    }
  }

  /* ── pass 1: bright extract and downsample ─────────────────────────────── */

  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThresh: { value: P.bloomThresh },
      uKnee: { value: P.bloomKnee },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThresh;
uniform float uKnee;
varying vec2 vUv;
${COMMON}
void main() {
  /* Four bilinear taps on the diagonal of the source texel quad, which at a
     quarter-resolution destination is a sixteen-texel box for the price of
     four fetches. Box rather than a point sample because the sun is a handful
     of very bright pixels and point-sampling it makes the whole flare flicker
     as the camera turns. */
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c = sane(c * 0.25);

  /* Soft knee, so a surface drifting across the threshold as the light changes
     fades in rather than switching on. */
  float l = luma(c);
  float k = clamp(l - uThresh + uKnee, 0.0, 2.0 * uKnee);
  float w = max(l - uThresh, k * k / (4.0 * uKnee + 1e-5)) / max(l, 1e-5);
  gl_FragColor = vec4(c * clamp(w, 0.0, 1.0), 1.0);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── pass 2/3: separable blur ──────────────────────────────────────────── */

  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  /* Nine taps at double spacing. Veiling glare is a very wide, very low
     amplitude skirt — the sharp core of it is the sun itself and is already in
     the frame — so reach matters far more than kernel fidelity here, and the
     bilinear smear between the widely spaced taps is doing useful work rather
     than being an artefact. */
  vec3 c = texture2D(tSrc, vUv).rgb * 0.196;
  c += (texture2D(tSrc, vUv + uDir * 1.0).rgb + texture2D(tSrc, vUv - uDir * 1.0).rgb) * 0.175;
  c += (texture2D(tSrc, vUv + uDir * 2.2).rgb + texture2D(tSrc, vUv - uDir * 2.2).rgb) * 0.121;
  c += (texture2D(tSrc, vUv + uDir * 3.6).rgb + texture2D(tSrc, vUv - uDir * 3.6).rgb) * 0.061;
  c += (texture2D(tSrc, vUv + uDir * 5.2).rgb + texture2D(tSrc, vUv - uDir * 5.2).rgb) * 0.023;
  gl_FragColor = vec4(c, 1.0);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── pass 4: flare ─────────────────────────────────────────────────────── */

  /* Ghosts are the aperture re-imaged by an even number of internal
     reflections, so they land on the line through the sun and the optical
     centre — that is not a stylistic choice, it is where they have to be. `t`
     parameterises that line with 0 at the sun and 1 at frame centre, so t > 1
     is the far side. Radii and tints are a plausible six-element coated lens:
     the small tight ones are the front-group reflections, the large faint ones
     the rear.
     Everything is scaled by the radiance actually measured around the sun in
     this frame, which is what makes occlusion work without an occlusion query:
     a sun behind a butte contributes nothing to the bright buffer, so there is
     nothing to reflect and the flare goes away by itself. */
  const GHOSTS = [
    [-0.34, 0.045, 1.00, 0.62, 0.34, 0.55],
    [0.30, 0.026, 0.55, 0.76, 1.00, 0.30],
    [0.63, 0.078, 1.00, 0.86, 0.56, 0.20],
    [1.00, 0.019, 0.68, 1.00, 0.84, 0.42],
    [1.44, 0.118, 0.38, 0.56, 1.00, 0.12],
    [1.87, 0.056, 1.00, 0.72, 0.46, 0.16],
  ];

  const flareMat = new THREE.ShaderMaterial({
    defines: { FLARE_LEVEL: 2 },
    uniforms: {
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uAspect: { value: 1.777 },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uSunOn: { value: 0 },
      uBase: { value: P.bloomGain },
      uGhost: { value: P.ghostGain },
      uVeil: { value: P.veilGain },
      uStreak: { value: P.streakGain },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec2 uSun;
uniform float uSunOn;
uniform float uBase;
uniform float uGhost;
uniform float uVeil;
uniform float uStreak;
varying vec2 vUv;
${COMMON}

const vec2 CTR = vec2(0.5, 0.5);

void main() {
  /* This buffer leaves already scaled by its final contribution, so the last
     pass adds it at unit gain. Doing the scaling there instead would have
     multiplied the flare terms by the bloom gain as well and made the ghosts
     three orders of magnitude too faint to see. */
  vec3 acc = texture2D(tBloom, vUv).rgb * uBase;

#if FLARE_LEVEL > 0
  if (uSunOn > 0.001) {
    /* The radiance of whatever is actually at the sun's position, from the
       frame itself. Nine taps in a small disc rather than one, so a sun sitting
       on the edge of a butte silhouette gives a partial answer instead of a
       binary one. Clamped, because a sun just outside the frame still puts
       light through the front element and the nearest edge pixels are the best
       evidence available for how much. */
    vec3 sunCol = vec3(0.0);
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float a = fi * 2.39996323;
      float rr = sqrt((fi + 0.5) / 9.0) * 7.0;
      vec2 uv = clamp(uSun + vec2(cos(a), sin(a)) * rr * uTexel, vec2(0.002), vec2(0.998));
      sunCol += texture2D(tBloom, uv).rgb;
    }
    sunCol *= uSunOn / 9.0;

    vec2 q = (vUv - uSun) * vec2(uAspect, 1.0);
    float dSun = length(q);

    /* Veiling glare: light scattered off every surface in the barrel, which is
       a broad low skirt centred on the source and is most of what makes a real
       backlit frame read as a photograph rather than a render. */
    acc += sunCol * uVeil * exp(-dSun * 3.2);

    /* Ghosts. Unrolled from the table above rather than looped over a uniform
       array: six elements, and an if-chain inside a loop compiles to the same
       thing with a branch on top. Each one is brighter at the rim, because a
       ghost is an image of the iris seen through a lens that is not corrected
       at that conjugate. */
${GHOSTS.map(([t, r, tr, tg, tb, gi]) => `    {
      vec2 gp = mix(uSun, CTR, ${t.toFixed(3)});
      float d = length((vUv - gp) * vec2(uAspect, 1.0));
      const float r = ${r.toFixed(4)};
      float a = smoothstep(r, r * 0.70, d) * (0.72 + 0.60 * smoothstep(r * 0.50, r * 0.94, d));
      acc += sunCol * vec3(${tr.toFixed(3)}, ${tg.toFixed(3)}, ${tb.toFixed(3)}) * (a * ${gi.toFixed(3)} * uGhost);
    }`).join('\n')}
  }
#endif

#if FLARE_LEVEL > 1
  /* A faint anamorphic streak. Not from an anamorphic lens — a spherical lens
     with a bright source still throws a horizontal smear off the aperture
     blades and off the sensor cover glass — so it is kept low and warm rather
     than the blue cinema cliche. Seventeen taps with widening spacing, on the
     bright buffer, so like the ghosts it is occluded for free. */
  vec3 st = vec3(0.0);
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    float w = exp(-fi * fi * 0.055);
    st += texture2D(tBloom, vUv + vec2(fi * abs(fi) * 0.9 * uTexel.x, 0.0)).rgb * w;
    wsum += w;
  }
  acc += (st / wsum) * uStreak * vec3(1.0, 0.86, 0.68);
#endif

  gl_FragColor = vec4(acc, 1.0);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── pass 5: defocus, grade, tone map, grain ───────────────────────────── */

  const finalMat = new THREE.ShaderMaterial({
    defines: { DOF_TAPS: 12, USE_BLOOM: 1 },
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      tDepth: { value: null },
      tGrain: { value: plate },
      uRes: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1.777 },
      uNear: { value: 0.06 },
      uFar: { value: 6000 },
      uExposure: { value: 1.0 },

      uCocScale: { value: 0.2 },
      uFocus: { value: P.focus },
      uCocMax: { value: P.cocMax },
      uFarCoc: { value: new THREE.Vector3(P.farPx, P.farA, P.farB) },

      uBloom: { value: P.bloomGain },
      uVignette: { value: P.vignette },
      uAberration: { value: P.aberration },

      uGrade: { value: P.gradeAmount },
      uShadowTint: { value: new THREE.Vector3(...P.shadowTint) },
      uHighTint: { value: new THREE.Vector3(...P.highTint) },
      uSplitPivot: { value: P.splitPivot },
      uVibrance: { value: P.vibrance },
      uContrast: { value: P.contrast },
      uContrastPivot: { value: P.contrastPivot },

      uGrain: { value: P.grain },
      uGrainOff: { value: new THREE.Vector2() },
      uGrainSwz: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform sampler2D tGrain;
uniform vec2 uRes;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform float uExposure;

uniform float uCocScale;
uniform float uFocus;
uniform float uCocMax;
uniform vec3 uFarCoc;

uniform float uBloom;
uniform float uVignette;
uniform float uAberration;

uniform float uGrade;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSplitPivot;
uniform float uVibrance;
uniform float uContrast;
uniform float uContrastPivot;

uniform float uGrain;
uniform vec2 uGrainOff;
uniform float uGrainSwz;

varying vec2 vUv;
${COMMON}

/* ── ACES, verbatim from three's tonemapping_pars_fragment ──────────────────
 *
 * Copied rather than included because this material has toneMapped false — it
 * has to, or three would run the curve a second time on the way to the canvas.
 * Copied rather than replaced with a different filmic curve because every
 * colour figure in CONTRACT.md was measured through *this* curve, and swapping
 * it would invalidate all of them at once for no stated gain. */
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 IN = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602));
  color *= uExposure / 0.6;
  color = IN * color;
  color = rrtOdt(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d > 0.999995) return 1.0e9;        // sky: no near blur, and no far blur either
  float ndc = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

/* Circle of confusion in pixels at 900 lines. The thin-lens form, so the
   asymmetry between near and far is the real one: a foreground object at half
   the focus distance is far more out of focus than a background object at twice
   it, which is why a stopped-down landscape frame softens at your feet and
   nowhere else. */
float cocPx(vec2 uv) {
  float z = viewZ(uv);
  if (z > 1.0e8) return 0.0;
  float c = uCocScale * abs(z - uFocus) / max(z, 0.05);
  c += uFarCoc.x * smoothstep(uFarCoc.y, uFarCoc.z, z);
  return min(c, uCocMax);
}

void main() {
  vec2 rel = (vUv - 0.5) * vec2(uAspect, 1.0);
  float rN = length(rel) / length(vec2(uAspect, 1.0) * 0.5);

  vec3 c = sane(texture2D(tScene, vUv).rgb);

#if DOF_TAPS > 0
  float coc = cocPx(vUv);
  /* Below a third of a pixel a defocus is not a defocus, it is a resample, and
     the branch here is what keeps the cost of this pass in the small part of
     the frame that is actually out of focus. */
  if (coc > 0.35) {
    vec3 acc = c;
    float wsum = 1.0;
    for (int i = 0; i < DOF_TAPS; i++) {
      float fi = float(i) + 0.5;
      float a = fi * 2.39996323;
      float rr = sqrt(fi / float(DOF_TAPS));
      vec2 off = vec2(cos(a), sin(a)) * (rr * coc) / uRes;
      /* Weight by the tap's own circle of confusion so a sharp foreground edge
         does not smear into a blurred background across the silhouette — the
         classic gather-DOF bleed, and the thing that makes cheap defocus look
         like a smudge filter rather than a lens. */
      float w = clamp(cocPx(vUv + off) / max(coc, 1e-3), 0.15, 1.0);
      acc += texture2D(tScene, vUv + off).rgb * w;
      wsum += w;
    }
    c = acc / wsum;
  }
#endif

  /* Lateral chromatic aberration, at the extreme edges only and under a pixel
     even there. A corrected wide-angle lens has essentially none in the middle
     two thirds of the frame and a little in the corners, and putting it
     anywhere else is the single fastest way to make a render look like a
     render with a filter on it. */
  float ab = uAberration * smoothstep(0.55, 1.0, rN);
  if (ab > 0.02) {
    vec2 dir = normalize(rel + 1e-6) / uRes * ab;
    c.r = texture2D(tScene, vUv + dir).r;
    c.b = texture2D(tScene, vUv - dir).b;
  }

#if USE_BLOOM
  c += sane(texture2D(tBloom, vUv).rgb) * uBloom;
#endif

  /* Vignette, applied in linear radiance because that is what it is: light the
     barrel did not deliver to the corner. Applying it after the tone curve
     would darken the corner without the highlight rolloff that a real light
     loss produces. */
  c *= 1.0 - uVignette * smoothstep(0.30, 1.06, rN);

  /* ── grade, before the curve ──────────────────────────────────────────── */
  if (uGrade > 0.0) {
    float l = luma(c);
    /* A ratio rather than a smoothstep on an absolute level: the split has to
       sit at the same place in the *tonal* range whatever the exposure, and
       lighting upstream is still moving. */
    float t = l / (l + uSplitPivot);
    vec3 tint = mix(uShadowTint, uHighTint, t);
    c *= mix(vec3(1.0), tint, uGrade);
  }

  vec3 o = aces(c);

  /* ── grade, after the curve ───────────────────────────────────────────── */
  if (uGrade > 0.0) {
    /* Vibrance, not saturation. Gated hard off above saturation 0.60 so that
       it cannot reach lit rock, which measures 0.62 and is the one colour in
       this scene that is independently verified against real photographs. What
       it does reach is the sky, the haze and the shaded ground, which is where
       a warm-hour frame wants its colour separation. */
    float mx = max(o.r, max(o.g, o.b)), mn = min(o.r, min(o.g, o.b));
    float sat = (mx - mn) / max(mx, 1e-4);
    float g = uVibrance * (1.0 - smoothstep(0.25, 0.60, sat)) * uGrade;
    float ly = luma(o);
    o = mix(vec3(ly), o, 1.0 + g);

  }

  gl_FragColor = vec4(o, 1.0);
  #include <colorspace_fragment>

  /* Contrast, after the encode and on luminance alone. Both of those are
     corrections that were measured rather than reasoned.
     Luminance alone, because a uniform scale of all three channels leaves HSV
     saturation and hue exactly where they were, and the per-channel version of
     this term moved lit rock's saturation by 0.086 — four times the whole rest
     of the grade.
     After the encode, because a pivoted contrast in *linear* light is far more
     aggressive in the shadows than it looks: at a pivot of 0.18 and a gain of
     1.03 a shadow sitting at 0.02 linear comes out 24% darker, and the measured
     symptom was wall_lit midwall dropping from L 0.143 to 0.113 for a term
     that is supposed to be imperceptible. In the encoded domain, which is where
     a photographer's contrast slider lives, the same gain moves that shadow by
     7%. */
  if (uGrade > 0.0) {
    float k = mix(1.0, uContrast, uGrade);
    float le = luma(gl_FragColor.rgb);
    float te = clamp((le - uContrastPivot) * k + uContrastPivot, 0.0, 1.0);
    gl_FragColor.rgb = clamp(gl_FragColor.rgb * (le > 1e-4 ? te / le : 1.0), 0.0, 1.0);
  }

  /* ── grain, after the encode ──────────────────────────────────────────────
   *
   * Deliberately the last thing that happens, and deliberately in encoded
   * units. Grain is a density fluctuation, so it belongs in a perceptual space
   * rather than in radiance — and there is a second job it is doing here. A
   * critic measured the sky quantising at about one code value every eight
   * rows: a smooth gradient crossing an 8-bit step. An amplitude of a code
   * value or two is exactly the dither that breaks that up, and it has to be
   * applied after the quantising transform to do it.
   *
   * Heavier in the shadows, which is backwards for real film — silver grain
   * peaks in the midtones — but right for what a viewer reads as grain, and
   * right for the dither, because the shadows are where the encoded steps are
   * furthest apart in light.
   */
  vec3 n = texture2D(tGrain, (gl_FragCoord.xy + uGrainOff) / 256.0).rgb - 0.5;
  /* Rotating which channel carries the luminance component decorrelates
     successive frames on top of the offset, so a walk does not show the plate
     sliding across the frame as a texture. */
  float mono = uGrainSwz < 0.5 ? n.r : (uGrainSwz < 1.5 ? n.g : n.b);
  vec3 gn = mix(vec3(mono), n, 0.28);
  float ly2 = luma(gl_FragColor.rgb);
  gl_FragColor.rgb += gn * (uGrain * (0.40 + 0.60 * (1.0 - ly2)));
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── plumbing ──────────────────────────────────────────────────────────── */

  const quadScene = new THREE.Scene();
  const quad = fullscreenMesh(brightMat);
  quadScene.add(quad);
  const quadCam = new THREE.Camera();

  function draw(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  /* The redirect. See the file header: three decides to run the tone map and
     the sRGB encode from whether the current target is null, so pointing
     System 5's blit at a float target is what makes it hand over linear
     radiance. Scoped to exactly one call and restored immediately, because a
     renderer with a permanently patched setRenderTarget is a trap for every
     other system in the tree. */
  const realSetRT = renderer.setRenderTarget.bind(renderer);
  function compositeInto(scn, cam, target) {
    renderer.setRenderTarget = (t, a, l) => realSetRT(t === null ? target : t, a, l);
    let did = false;
    try {
      did = atmo.composite(scn, cam);
    } finally {
      renderer.setRenderTarget = realSetRT;
    }
    return did;
  }

  const _v3 = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const sunDir = new THREE.Vector3()
    .subVectors(sun.position, sun.target.position).normalize();

  const lastInfo = { calls: 0, triangles: 0 };
  let haveSceneInfo = false;
  /* Where the flare thinks the sun is, for tools/_p7cap.mjs. "Is the flare
     doing anything" is otherwise unanswerable from a PNG in which the sun is
     behind a butte — and it is behind a butte in most of the standard set,
     which is the scene working as designed rather than the effect failing. */
  const lastSun = { x: 0.5, y: 0.5, on: 0, facing: 0 };

  /* ── grain clock ───────────────────────────────────────────────────────── */

  /* Frozen means "the harness put us here", exactly as in atmosphere.js. Two
     walkTo(46) calls must give the same pixels, and the harness waits 400 ms
     between placing the camera and reading the buffer — so a phase that kept
     advancing through that wait would put a different grain realisation in
     every capture. A human never calls walkTo, and their first step clears it.

     Twenty-four steps a second when it is running, rather than one per frame:
     at 200 fps a fresh realisation every frame is a fizz, not grain. */
  let grainPhase = 0, grainAcc = 0, frozen = false;

  function applyGrainPhase() {
    const p = grainPhase | 0;
    /* A cheap integer hash into the plate, so successive phases land in
       uncorrelated places rather than sliding. */
    let s = Math.imul(p ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    const ox = s % 251;
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
    const oy = s % 241;
    finalMat.uniforms.uGrainOff.value.set(ox, oy);
    finalMat.uniforms.uGrainSwz.value = p % 3;
  }
  applyGrainPhase();

  /* ── tier ──────────────────────────────────────────────────────────────── */

  let level = { dofTaps: 12, flare: 2, bloom: 4 };

  function setLevel(l) {
    const next = { dofTaps: 12, flare: 2, bloom: 4, ...(l || {}) };
    if (next.dofTaps === level.dofTaps && next.flare === level.flare &&
        next.bloom === level.bloom) return;
    level = next;
    finalMat.defines.DOF_TAPS = level.dofTaps;
    finalMat.defines.USE_BLOOM = level.bloom > 0 ? 1 : 0;
    finalMat.needsUpdate = true;
    flareMat.defines.FLARE_LEVEL = level.flare;
    flareMat.needsUpdate = true;
    /* The low-resolution chain is allocated at the divisor the tier asks for,
       and not allocated at all when the tier has no use for it. */
    if (sceneRT) allocate(W, H, level.bloom);
  }

  /* ── the frame ─────────────────────────────────────────────────────────── */

  function render(scn, cam) {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    if (!w || !h) return false;

    if (disabled) {
      if (!atmo.composite(scn, cam)) {
        realSetRT(null);
        renderer.render(scn, cam);
        lastInfo.calls = renderer.info.render.calls;
        lastInfo.triangles = renderer.info.render.triangles;
        haveSceneInfo = true;
      } else haveSceneInfo = false;
      return true;
    }

    allocate(w, h, level.bloom);

    /* 1. the scene, into scene-linear radiance. */
    haveSceneInfo = false;
    if (!compositeInto(scn, cam, sceneRT)) {
      realSetRT(sceneRT);
      renderer.render(scn, cam);
      lastInfo.calls = renderer.info.render.calls;
      lastInfo.triangles = renderer.info.render.triangles;
      haveSceneInfo = true;
    }

    /* Depth: System 5's, when its stage ran. Without it there is no defocus
       and no depth-aware anything, which is the bottom tier by design. */
    const shim = atmo._shimmerMaterial;
    const depth = shim ? shim.uniforms.tDepth.value : null;

    const fu = finalMat.uniforms;
    fu.tScene.value = sceneRT.texture;
    fu.tDepth.value = depth;
    fu.uRes.value.set(w, h);
    fu.uAspect.value = w / h;
    fu.uNear.value = cam.near;
    fu.uFar.value = cam.far;
    fu.uExposure.value = renderer.toneMappingExposure;
    /* The thin-lens constant, in pixels of the *rendered* buffer. Quoted at 900
       lines and scaled, so an 800x450 iteration shows the same optics as a
       1600x900 handoff rather than half of it. */
    const A = P.focal / P.fStop;
    fu.uCocScale.value = A * P.focal * h / (0.024 * Math.max(1e-4, P.focus - P.focal));
    fu.uCocMax.value = P.cocMax * (h / 900);

    const wantDof = level.dofTaps > 0 && !!depth;
    if ((finalMat.defines.DOF_TAPS > 0) !== wantDof) {
      finalMat.defines.DOF_TAPS = wantDof ? level.dofTaps : 0;
      finalMat.needsUpdate = true;
    }

    /* 2-4. the low-resolution chain. */
    if (level.bloom > 0 && loA) {
      const lw = loA.width, lh = loA.height;
      brightMat.uniforms.tSrc.value = sceneRT.texture;
      /* One *full-resolution* texel. A quarter-scale destination texel centre
         lands on a source texel corner, so a tap one source texel away is also
         on a corner and bilinear returns the mean of a 2x2 block — four taps
         at (±1, ±1) therefore cover all sixteen source texels exactly. Getting
         this wrong samples four of the sixteen and makes the sun flicker in
         and out of the flare as the camera turns. */
      brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      brightMat.uniforms.uThresh.value = P.bloomThresh;
      brightMat.uniforms.uKnee.value = P.bloomKnee;
      draw(brightMat, loA);

      blurMat.uniforms.tSrc.value = loA.texture;
      blurMat.uniforms.uDir.value.set(1 / lw, 0);
      draw(blurMat, loB);
      blurMat.uniforms.tSrc.value = loB.texture;
      blurMat.uniforms.uDir.value.set(0, 1 / lh);
      draw(blurMat, loA);

      /* Where the sun is on screen. Behind the camera is the case that has to
         be handled explicitly: project() divides by w, so a point behind the
         eye comes back mirrored into the frame and would hang a flare off the
         wrong side. */
      cam.getWorldDirection(_fwd);
      const facing = _fwd.dot(sunDir);
      let on = 0, sx = 0.5, sy = 0.5;
      if (facing > 0.02) {
        _v3.copy(sunDir).multiplyScalar(1e5).add(cam.position).project(cam);
        sx = _v3.x * 0.5 + 0.5;
        sy = _v3.y * 0.5 + 0.5;
        /* A sun just outside the frame still puts light through the front
           element, so the gate reaches beyond the edge and fades rather than
           switching. Past a third of a frame out there is no path into the
           barrel worth drawing. */
        const ox = Math.max(0, Math.abs(sx - 0.5) - 0.5);
        const oy = Math.max(0, Math.abs(sy - 0.5) - 0.5);
        const out = Math.hypot(ox, oy) / 0.33;
        on = Math.max(0, 1 - out) * Math.min(1, (facing - 0.02) / 0.10);
      }
      lastSun.x = sx; lastSun.y = sy; lastSun.on = on; lastSun.facing = facing;
      const flu = flareMat.uniforms;
      flu.tBloom.value = loA.texture;
      flu.uTexel.value.set(1 / lw, 1 / lh);
      flu.uAspect.value = w / h;
      flu.uSun.value.set(sx, sy);
      flu.uSunOn.value = on;
      flu.uBase.value = P.bloomGain;
      flu.uGhost.value = P.ghostGain * P.flareScale;
      flu.uVeil.value = P.veilGain * P.flareScale;
      flu.uStreak.value = P.streakGain * P.flareScale;
      draw(flareMat, loB);

      fu.tBloom.value = loB.texture;
      fu.uBloom.value = 1.0;
    } else {
      fu.tBloom.value = null;
    }

    /* 5. out. */
    fu.uVignette.value = P.vignette;
    fu.uAberration.value = P.aberration * (h / 900);
    fu.uGrade.value = P.gradeAmount;
    fu.uShadowTint.value.set(...P.shadowTint);
    fu.uHighTint.value.set(...P.highTint);
    fu.uSplitPivot.value = P.splitPivot;
    fu.uVibrance.value = P.vibrance;
    fu.uContrast.value = P.contrast;
    fu.uContrastPivot.value = P.contrastPivot;
    fu.uGrain.value = P.grain;
    fu.uFocus.value = P.focus;
    fu.uFarCoc.value.set(P.farPx * (h / 900), P.farA, P.farB);
    draw(finalMat, null);
    return true;
  }

  return {
    render,
    params: P,
    setLevel,
    get level() { return { ...level }; },

    /** Advance the grain, on the same freeze rule the atmosphere uses. */
    update(dt, moving) {
      if (frozen && !moving) return;
      frozen = false;
      grainAcc += dt;
      const step = 1 / 24;
      if (grainAcc >= step) {
        grainPhase = (grainPhase + Math.floor(grainAcc / step)) | 0;
        grainAcc %= step;
        applyGrainPhase();
      }
    },

    /** Pin the grain to a pure function of the walk distance, and freeze it. */
    setWalk(d) {
      frozen = true;
      grainAcc = 0;
      grainPhase = Math.abs(Math.round((+d || 0) * 7)) % 9973;
      applyGrainPhase();
    },

    /** Scene-pass counts, for `info()` when System 5's stage did not run. */
    lastInfo() { return haveSceneInfo ? lastInfo : null; },

    _diag: {
      get targets() {
        return {
          scene: sceneRT ? [sceneRT.width, sceneRT.height] : null,
          low: loA ? [loA.width, loA.height] : null,
          level: { ...level },
        };
      },
      get grain() { return { phase: grainPhase, frozen }; },
      get sun() { return { ...lastSun }; },
      sunDir: [sunDir.x, sunDir.y, sunDir.z],
    },
  };
}
