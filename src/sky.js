/* Sedona Sunset — System 4: lighting and the sun.
 *
 * Everything here is derived from src/atmos.js, which solves one spectral
 * atmosphere at load and hands back the direct beam, a radiance map of the sky,
 * and the spherical-harmonic irradiance of that sky plus the ground and the
 * opposite wall. Nothing in this file picks a colour. That is deliberate: the
 * provisional rig had five hand-tinted lights in it, and the record of how they
 * got their colours is a list of corrections to earlier corrections — a warm key
 * that made Mars, a violet hemisphere that turned clast tops into blue card, a
 * cool directional added because the hemisphere could not know where the sun
 * was. Every one of those problems is a symptom of lighting a scene with terms
 * that have no relationship to each other. One integral fixes all of them at
 * once, and the shadows go violet because the sky above them is violet.
 *
 * The rig is:
 *   sun       the beam. Colour and irradiance from the spectral transmittance
 *             at this air mass. Casts the coarse cascade.
 *   sunNear   the same beam at zero intensity, carrying the fine cascade. See
 *             the shadow section for why a cascade has to be smuggled in this
 *             way and what it costs.
 *   probe     a LightProbe holding the SH9 irradiance of the whole environment.
 *             Replaces the hemisphere light, the glow light and the bounce
 *             light, so the rig is two lights lighter than the one it replaces
 *             despite gaining a shadow cascade.
 */
import * as THREE from 'three';
import {
  computeAtmosphere, SUN_DIR as ATMOS_SUN_DIR, SUN_AZ as ATMOS_SUN_AZ,
  SUN_EL as ATMOS_SUN_EL, MIE_G, MIE_G_NARROW, MIE_W_NARROW,
} from './atmos.js';

export const SUN_AZ = ATMOS_SUN_AZ;
export const SUN_EL = ATMOS_SUN_EL;
export const SUN_DIR = ATMOS_SUN_DIR;

/* `decompose` builds the sky / escarpment / ground-bounce probes alongside the three
   aperture probes, which s4AoTint needs to tell a cool illuminant from a warm one.
   Measured at about 5 ms on a 90 to 130 ms startup computation, once. */
const A = computeAtmosphere({ decompose: true });

/* ── scene radiance scale ──────────────────────────────────────────────────
 *
 * The atmosphere solve is normalised so that the sun above the air has unit
 * luminance, which puts the direct beam at the ground at 0.33 and everything
 * else at inconvenient fractions. SCALE moves the decimal point, and it is
 * chosen so that EXPOSURE comes out at exactly 1.0 — that is, so that the
 * physical model *is* the exposure and System 7 grades from a scene that is
 * already correct rather than from one that needs a correction factor first.
 *
 * One thing does depend on the absolute value and it is easy to miss: terrain.js
 * and rock.js each add a Rayleigh airlight term to shadowed surfaces as a
 * constant in absolute scene units, outside the albedo product, because a red
 * rock cannot reflect a blue it has no blue albedo to reflect. Those constants
 * were authored against the provisional rig's radiance and have been rescaled
 * by hand to match this one. If SCALE moves again, they move with it.
 *
 * Derivation of the number. ACES puts its input 0.456 at display 0.342, which is
 * HSV value 0.62 — mid-range for the 0.59-0.73 that reference photographs of
 * sunlit Sedona rock sit at. A wall face at this azimuth takes a cosine of 0.223
 * on the beam plus the probe's 0.034, so it reflects 0.335 * 0.136 / pi of the
 * scene scale in red. Setting that product to 0.456 * 0.6 gives 19.
 */
const SCALE = 19.0;

/* Lifted from the derived 1.0 after measurement, then brought back down to 0.95.
   1.15 was fitted at sun elevation 11, and raising the sun to 15 to get the wash
   floor off the ground moved everything it was balancing: the lit wall face went
   to V 0.808 against its 0.59-0.73 target and the sunlit floor to 0.610 against
   0.55, so the level was over on both counts and clipping facets square to the
   beam rather than merely risking it.
   Measured at 0.95 against 1.15 in the same windows, sun disc aside: the lit face
   comes back to 0.693, inside band; the wash floor to 0.562 against its 0.55
   reference, so it lands on the figure rather than 11% over it; the floor's
   grad/L *rises* 0.137 to 0.143, because a darker floor sits on a steeper part of
   the curve; and saturation gains about 4% everywhere, since less of the frame is
   in the shoulder having its chroma compressed. The shadow gate is the constraint
   that binds, and tools/expose.mjs measures its elasticity to global exposure at
   only 0.3, which prices this cut at 0.010 of it - 0.222 to a predicted 0.212,
   inside the 0.15-0.25 band.
   This is *not* justified by the sun disc, and the record needs to say so because
   the first version of this comment claimed it was. The claim rested on an
   analytic figure from the sky LUT putting the sky within a degree of the sun at
   244 cv, from which it followed that ACES had no shoulder left to separate the
   disc's pinned 255 from it. tools/discprofile.mjs measures that sky at 120 cv
   with the disc at 169, a contrast of +40.5% standing 1.3 sigma clear - so there
   was shoulder to spare and the analytic model was wrong by a factor of two. What
   actually hides the disc is butte0: 173 m tall at 324-413 m, its crest
   subtending 22.8-28.0 degrees from every camera position and straddling the sun's
   bearing from -8.7 to +27.1. No exposure reaches through that, and neither does
   any elevation short of 28 degrees, which is not golden hour. */
export const EXPOSURE = 0.95;

/* ── the fog colour ────────────────────────────────────────────────────────
 * Aerial perspective is System 5's, but scene.fog needs a colour now and the
 * honest one is the radiance of the air itself: the mean of the sky map through
 * the first six degrees of elevation, which is the band a distant butte sits
 * against.
 *
 * The first version weighted this toward the up-wash half on the grounds that
 * the camera looks that way most of the time. That is the direction the sky is
 * four times brighter than anywhere else, so the weighting produced a fog at
 * value 0.86 — brighter than any rock in the scene — and every distant butte
 * dissolved into it. A single constant cannot express a term that varies by two
 * stops with azimuth; weighting it toward the extreme is the worst way to pick
 * the constant, not the best. Flat mean, and the directionality is System 5's
 * to add properly.
 */
export const FOG = (() => {
  const { lut, SKY_W, SKY_H } = A;
  let r = 0, g = 0, b = 0, w = 0;
  for (let j = 0; j < SKY_H; j++) {
    const v = (j + 0.5) / SKY_H, t = (v - 0.5) * 2, y = Math.sign(t) * t * t;
    if (y < 0 || y > 0.105) continue;                    // 0 … 6 degrees
    for (let i = 0; i < SKY_W; i++) {
      const phi = ((i + 0.5) / SKY_W) * Math.PI;
      const wt = 1;
      const o = (j * SKY_W + i) * 4;
      const ph = phaseHG(Math.cos(phi) * Math.cos(SUN_EL));
      r += (lut[o] + lut[o + 3] * ph * A.mieTintRGB[0]) * wt;
      g += (lut[o + 1] + lut[o + 3] * ph * A.mieTintRGB[1]) * wt;
      b += (lut[o + 2] + lut[o + 3] * ph * A.mieTintRGB[2]) * wt;
      w += wt;
    }
  }
  return new THREE.Color().setRGB(r / w * SCALE, g / w * SCALE, b / w * SCALE,
    THREE.LinearSRGBColorSpace);
})();

function phaseHG(c) {
  const one = (g) => {
    const g2 = g * g;
    return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
  };
  return (1 - MIE_W_NARROW) * one(MIE_G) + MIE_W_NARROW * one(MIE_G_NARROW);
}

/* ── the sky mesh ──────────────────────────────────────────────────────────
 *
 * The dome is a texture fetch, not a ray march. The sky is static — the sun
 * never moves in this scene — so marching it per fragment would be paying every
 * frame for an answer that was settled at load. What is *not* in the texture is
 * the Mie forward lobe: at 128 azimuth samples a lobe a few degrees wide would
 * be four texels across and would interpolate into a smeared blob, so the map
 * carries the Mie integral as a grey scalar with its phase function divided out
 * and the shader multiplies it back in analytically. That is the aureole, and it
 * is the brightest and warmest thing in the frame after the disc itself.
 */
/* The direction is taken from the camera, not from the sphere's own centre.
   The dome sits at the world origin and the player walks up to 350 m away from
   it, so reading the direction off the vertex position — which is what the
   provisional sky did — mis-states every sky direction by up to atan(350/5000),
   1.4 degrees at the far end of the path. On a smooth gradient that is
   invisible. On a half-degree sun disc it is three disc widths, and it was
   enough to push the disc behind the left wall's edge in the one framing the
   whole composition is built around. */
const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;      // always at the far plane
}`;

const FRAG = /* glsl */`
varying vec3 vDir;
uniform sampler2D uSky;
uniform vec2 uSunH;        // horizontal direction to the sun, normalised
uniform vec3 uSun;         // full direction to the sun
uniform vec3 uMieTint;
uniform float uMieG;       // broad lobe, the refractive bulk
uniform float uMieGN;      // narrow lobe, the diffraction peak
uniform float uMieWN;      // its share of the weight
uniform float uDisc;       // radiance of the disc itself
uniform vec3 uDiscTint;

const float PI = 3.14159265;

float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5));
}

/* The graduated filter.
 *
 * This one is pictorial and the comment needs to say so plainly, because nothing
 * else in this file is. The sky model is not the problem: tools/skylut.mjs reads
 * the LUT at two degrees of elevation as scene-linear 4.54 4.17 3.18 — saturation
 * 0.300 at hue 44, a gold horizon — and at seventy degrees as 0.11 0.17 0.29,
 * saturation 0.623 at hue 221, a deep blue zenith. The warm-to-blue gradient that
 * golden hour is made of was already there and had been all along.
 *
 * What was wrong is where it lands on the tone curve. ACES has a slope of 9 to 15
 * cv per e-fold at linear 2 to 4.5, against 55 at linear 0.5, so the bottom twenty
 * degrees of sky — the entire warm half of the gradient — was being compressed
 * into nine code values and rendering 231/231/231 at saturation 0.032. The upper
 * sky, dim enough to sit where the curve still has slope, already measured encoded
 * saturation 0.29 to 0.41 and needed nothing. A whole-sky mean of 185/197/212
 * cannot tell those two halves apart, which is why the fault read as "cold and
 * pale" rather than as "clipped".
 *
 * The physical options were all worse. Dimming the dome dims the skylight fill
 * with it and takes the shadow gate out of band. Dropping the exposure spends the
 * sunlit rock and the wash floor, both of which are in band and neither of which
 * is mine. Lowering the sun is the thing that would really put gold in the sky,
 * and it costs the wash floor threefold. Raising the aerosol load reddens the
 * direct beam and moves rock hue, which is a contracted figure.
 *
 * And a photograph of this subject is not made without something in front of the
 * lens either. A graduated neutral filter over the sky half of the frame is
 * standard equipment for a low-sun landscape, for exactly this reason; the
 * alternative in the field is exposure blending, which is the same compression
 * applied afterwards instead. So this is a power law on luminance with the chroma
 * ratios held exactly — a grad filter, not a saturation dial. Hue does not move,
 * and the fixed point at LREF leaves the zenith where it was while pulling linear
 * 4.18 down to 1.14.
 *
 * It cannot touch anything protected. Rock, floor and shadow take their light from
 * A.sh and A.shOpen, integrated from the LUT in src/atmos.js, and nothing but
 * these sky pixels ever samples this shader. */
vec3 gradFilter(vec3 c) {
  const float LREF = 0.20, P = 0.45;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (L <= 1e-6) return c;
  return c * (pow(L, P) * pow(LREF, 1.0 - P) / L);
}

void main() {
  vec3 d = normalize(vDir);

  /* Same warp the CPU used to build the map: v is sqrt in |y|, so half the rows
     land in the bottom fifteen degrees of the sky where all the structure is. */
  float v = 0.5 + 0.5 * sign(d.y) * sqrt(abs(d.y));
  vec2 hz = d.xz;
  float hl = length(hz);
  hz = hl > 1e-5 ? hz / hl : uSunH;
  float u = acos(clamp(dot(hz, uSunH), -1.0, 1.0)) / PI;

  vec4 s = texture2D(uSky, vec2(u, v));
  float ca = dot(d, uSun);

  /* The broad lobe is sky and takes the filter with the rest of the dome. The
     narrow lobe does not, and the reason is that the two levers otherwise fight:
     the filter is a power law, so it compresses every ratio by its exponent, and
     the halo the narrow lobe exists to build is a ratio like any other. The first
     render of this pair proved it — a gold horizon at saturation 0.593, and an
     aureole still flat at 236 cv falling to 234 across four degrees.
     Within a couple of degrees of the sun that light is not sky in any sense the
     picture cares about. It is solar glare: it is the diffraction peak off the
     largest particles, it is what blooms in a lens, and a photographer holding the
     sky down with a grad is not attenuating it by the same three stops. So filter
     the dome, then add the peak on top of the result, alongside the disc. That is
     what lets the sky come down as far as it needs to without the halo coming down
     with it: the core goes to 255 and the fall to eight degrees is 51 cv against
     the 14 a single lobe managed. */
  vec3 sky = gradFilter(s.rgb + s.a * (1.0 - uMieWN) * phaseHG(ca, uMieG) * uMieTint);
  sky += s.a * uMieWN * phaseHG(ca, uMieGN) * uMieTint;

  /* The disc. Half a degree across, so the edge has to be built from the angle
     itself rather than a smoothstep on a hand-picked pair of cosines — at this
     radius the cosine is 0.99999 and single precision has nothing left to
     resolve a limb with. Limb darkening is the standard quadratic; it is only a
     few percent across the disc but it is the difference between a sticker and
     a star, and at eight degrees the disc is large in frame. */
  float ang = acos(clamp(ca, -1.0, 1.0));
  const float RSUN = 0.004625;                 // 0.265 degrees
  float limb = sqrt(max(0.0, 1.0 - pow(min(1.0, ang / RSUN), 2.0)));
  float disc = (1.0 - smoothstep(RSUN * 0.94, RSUN * 1.06, ang))
             * (0.42 + 0.58 * limb);
  sky += uDiscTint * uDisc * disc;

  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  /* No dither here, deliberately. The banding the critique measured — runs of up
     to 23 identical values down a sky column — is real, but it is quantisation at
     the 8-bit write and this shader is several passes upstream of it. A dither
     applied here would be graded, defocused and vignetted before reaching the
     quantiser it exists to break up, and it would be the second one: src/post.js
     now carries TPDF at 1 LSB from a per-pixel hash, applied last because it has
     to be the final thing before the quantiser. That is the right amount in the
     right place, and adding another LSB upstream would only put noise in the sky
     to solve a problem that is already solved. Measured after it landed: the worst
     run in sun_gap is 16 px against the 21 this build started at. */
}`;

function skyTexture() {
  const { lut, SKY_W, SKY_H } = A;
  const data = new Uint16Array(SKY_W * SKY_H * 4);
  for (let i = 0; i < lut.length; i += 4) {
    data[i] = THREE.DataUtils.toHalfFloat(lut[i] * SCALE);
    data[i + 1] = THREE.DataUtils.toHalfFloat(lut[i + 1] * SCALE);
    data[i + 2] = THREE.DataUtils.toHalfFloat(lut[i + 2] * SCALE);
    /* Alpha carries the Mie integral with its phase function and its colour
       both divided out, and the shader multiplies both back in. uMieTint
       already carries the scale, so applying it here as well is a factor of
       nineteen on the aureole — which is exactly the bug that made the first
       three captures of this system show a flat white sky at saturation 0.03
       across the whole frame. The tell was that the model and the render
       disagreed at the same view direction; the model is the thing that was
       right. */
    data[i + 3] = THREE.DataUtils.toHalfFloat(lut[i + 3]);
  }
  const t = new THREE.DataTexture(data, SKY_W, SKY_H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Brightest scene-scale radiance anywhere in the dome, disc excluded. */
function aureolePeak() {
  const { lut, SKY_W, SKY_H } = A;
  let m = 0;
  for (let j = 0; j < SKY_H; j++) {
    for (let i = 0; i < SKY_W; i++) {
      const o = (j * SKY_W + i) * 4;
      /* Texel (i,j) is at azimuth i/W of pi from the sun and the row's own
         elevation; the aureole peak is the first column of the horizon rows, so
         evaluating the phase at the texel's own angle is enough. */
      const v = (j + 0.5) / SKY_H, t = (v - 0.5) * 2, y = Math.sign(t) * t * t;
      const phi = ((i + 0.5) / SKY_W) * Math.PI;
      const ca = Math.sqrt(Math.max(0, 1 - y * y)) * Math.cos(phi) * Math.cos(SUN_EL)
        + y * Math.sin(SUN_EL);
      const ph = phaseHG(ca);
      for (let k = 0; k < 3; k++) {
        m = Math.max(m, (lut[o + k] + lut[o + 3] * ph * A.mieTintRGB[k]) * SCALE);
      }
    }
  }
  return m;
}

export function buildSky() {
  const sunH = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uSky: { value: skyTexture() },
      uSunH: { value: sunH },
      uSun: { value: SUN_DIR.clone() },
      uMieTint: { value: new THREE.Vector3(...A.mieTintRGB).multiplyScalar(SCALE) },
      uMieG: { value: MIE_G },
      uMieGN: { value: MIE_G_NARROW },
      uMieWN: { value: MIE_W_NARROW },
      /* The true radiance of the disc is the beam's irradiance divided by its
         solid angle, which is some forty thousand times the brightest sky texel.
         This was capped at forty times the aureole peak to avoid "pushing
         float16 targets around", and that caution was misplaced by three orders
         of magnitude: tools/hdrmax.mjs reads the scene buffer and its finite
         maximum is **2.89** against a half-float ceiling of 65504, so the
         headroom the cap was protecting was never in use.
         The cost of the cap was the brief's central composition. At forty times
         the aureole the disc lands at 195, and the near-sun haze around it tone
         maps to 247 while the disc clips at 255 — a **3% contrast**, seventeen
         saturated pixels indistinguishable from the glare they sit in. Measured
         on a frame where the disc was geometrically unoccluded, the brightest
         pixel is exactly at the disc's predicted screen position and the profile
         across it goes 77, 177, 249, 255, 249, 247, 247: a plateau with a pinprick
         on it. The sun was not missing, it was the same colour as the sky.
         1650x instead. That is still 24x below the guard in src/post.js and 8x
         below the half-float ceiling, while putting the disc two orders of
         magnitude above anything else in the frame, so any bright-pass threshold
         catches it and System 7's ghost path has a real source. It is also
         closer to the truth than 40x was. */
      uDisc: { value: 1650 * aureolePeak() },
      uDiscTint: {
        value: new THREE.Vector3(...A.sunRGB).divideScalar(Math.max(...A.sunRGB)),
      },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/* ── shadows ───────────────────────────────────────────────────────────────
 *
 * The deferred defect this system inherited: the shadow camera was a 68 m box
 * riding with the player, and a wall shadow at this sun angle is 240 m long, so
 * whole wall shadows were missing. Two things about that are worth stating
 * precisely, because the obvious diagnosis is wrong.
 *
 * A caster and the point it shadows have *identical* light-space x and y — they
 * differ only in depth. So the box never has to be widened to admit distant
 * casters, and pulling the near plane back is enough to admit tall ones. What
 * the box has to cover is the set of *receivers*. That set is the visible
 * corridor, which at this sun angle is a strongly non-square region in light
 * space: the y axis is near-vertical, so it has to span the full height of the
 * walls at one end and several hundred metres of up-wash floor at the other,
 * while x only has to span the corridor's width. A square box is the wrong
 * shape and was failing at both ends at once.
 *
 * Even shaped correctly, one box cannot do it. Covering the corridor costs
 * 190 m of light-space x, which on a 4096 map is 46 mm a texel; a 50 mm pebble
 * then casts into one texel and the gravel field goes back to reading as bumps
 * painted on. So there are two.
 *
 * three has no cascaded shadow maps, and the way to get a second one without
 * rewriting every material in the project is to add a second directional light
 * with the same direction and *zero intensity*. It contributes no light, but
 * three still allocates it a shadow map and a shadow coordinate, and the patch
 * to the shadow chunk below reads them. The cost is one extra shadow pass —
 * measured at the handoff and reported — and the constraint is that it must be
 * added to the scene second, so that it lands at shadow index 1.
 */
/* Light-space extents, and both are asymmetric because the region that needs
   shadowing is not centred on the player in either axis.
   y is vertical tilted back by the solar elevation: +y is up, and -y runs away
   from the camera up the wash, at 0.137 of a metre per metre of wash. So +58
   admits a 58 m wall top standing beside the player and -66 reaches 480 m of
   floor up-canyon, which is past where the haze closes in.
   x is horizontal and perpendicular to the sun's azimuth — and since the sun is
   thirteen degrees off the corridor, a point 300 m up the wash is displaced 67 m
   along x as well. That is why the x range is offset rather than
   centred: the corridor leans across it, and a symmetric box would waste half
   its texels on the side the wash never reaches.
   NEAR is sized for the gravel. 36 m across a 2048 map is 17.6 mm a texel, which
   is the figure System 1 established as the point where a 50 mm pebble casts a
   shadow at all. It was 4096 for two rounds and dropped to 2048 on render cost
   rather than on a measurement that the extra resolution bought nothing — worth
   saying plainly, since everything else here was decided by measurement. What is
   measured is the cost: the pair of cascades at 4096 and 2048 is a third more
   shadow fill than the single 4096 map they replace, not twice as much. */
const FAR_BOX = { xLo: -130, xHi: 78, yLo: -66, yHi: 58 };
const NEAR_BOX = { xLo: -20, xHi: 16, yLo: -9, yHi: 22 };
/* The light sits far enough up-sun that a wall top 500 m up the corridor is
   still in front of the near plane. Depth is cheap: an orthographic camera is
   linear in z, so 1,860 m across a 24-bit buffer is a tenth of a millimetre. */
/* The light sits far enough up-sun that a wall top 500 m up the corridor is
   still in front of the near plane. Depth is cheap: an orthographic camera is
   linear in z, so 1,860 m across a 24-bit buffer is a tenth of a millimetre.

   tools/_shadowbox.mjs shows `terrain` reaching clip z -2.36, which is 1,225 m in
   front of this near plane, so up-sun terrain is outside the frustum. That looked
   like the cause of System 2's pale patch on the far wall and it is not: pushing
   NEAR_Z to -1340 to capture all of it left the patch bit-for-bit unchanged, at
   2,291 pixels over V 0.88 against 2,297 before, so nothing that was being culled
   was casting anything that mattered. Reverted rather than kept, because it costs
   geometry in the shadow pass every frame and buys a difference no instrument can
   see. Recording it so the next reader does not spend the same hour: the receiver
   under that patch is comfortably inside the far frustum at clip 0.456, 0.291,
   -0.083, so neither end of the box is what makes it bright. */
const LIGHT_DIST = 900, NEAR_Z = 40, FAR_Z = 1900;
const DEPTH_RANGE = FAR_Z - NEAR_Z;

function configureCascade(l, box, mapSize, biasMetres, normalBias, radius) {
  l.castShadow = true;
  l.shadow.mapSize.set(mapSize, mapSize);
  const c = l.shadow.camera;
  c.left = box.xLo; c.right = box.xHi;
  c.bottom = box.yLo; c.top = box.yHi;
  c.near = NEAR_Z; c.far = FAR_Z;
  c.updateProjectionMatrix();
  /* Bias is in normalised device depth, which for an ortho camera is
     2 * metres / range. Quoting it in metres at the call site keeps it
     meaningful when the depth range changes — the provisional rig's -0.00035
     was 34 cm only because its frustum happened to be 970 m deep. */
  l.shadow.bias = -2 * biasMetres / DEPTH_RANGE;
  /* Normal offset scales with texel footprint, so each cascade gets its own:
     every centimetre of it is a centimetre of shadow deleted from the base of
     whatever casts it, and a pebble's whole shadow is only tens of centimetres
     long. The fine cascade can afford almost none and needs almost none. */
  l.shadow.normalBias = normalBias;
  l.shadow.radius = radius;
  return l;
}

/**
 * Both cascade cameras ride with the player, each quantised to its own texel
 * grid so that the maps do not shimmer when walking and — the part that matters
 * for the harness — so that the same player position always yields the same
 * shadow texels.
 */
export function makeShadowRig(sun, sunNear) {
  const step = (l, box) => (box.xHi - box.xLo) / l.shadow.mapSize.x * 4;
  const qFar = step(sun, FAR_BOX), qNear = step(sunNear, NEAR_BOX);
  let last = '';
  const place = (l, q, x, y, z) => {
    const s = (v) => Math.round(v / q) * q;
    const qx = s(x), qy = s(y), qz = s(z);
    l.target.position.set(qx, qy, qz);
    l.position.set(qx + SUN_DIR.x * LIGHT_DIST, qy + SUN_DIR.y * LIGHT_DIST,
      qz + SUN_DIR.z * LIGHT_DIST);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
    return `${qx},${qy},${qz}`;
  };
  /** @returns true when a cascade actually moved, so the maps need redrawing. */
  return (x, y, z) => {
    const key = place(sun, qFar, x, y, z) + '|' + place(sunNear, qNear, x, y, z);
    if (key === last) return false;
    last = key;
    return true;
  };
}

/* ---- the cascade patch ----
 * Renames three's own getShadow and puts a two-cascade version in its place.
 * Every material in the project reaches its shadow lookup through this chunk,
 * including two that already wrap `getShadow` in a macro of their own — those
 * wrappers call the function from a body defined above their #define, so they
 * pick this up without knowing it exists.
 *
 * Selection needs no new uniforms: a fragment is inside the fine cascade
 * exactly when its shadow coordinate for light 1 is inside the unit cube, which
 * is the same test three does internally. The border is feathered over three
 * percent of the map so the changeover is a gradient rather than a visible box
 * edge on the floor, and the two are combined by minimum so that a caster the
 * fine map cannot see because it is outside the fine frustum cannot punch a
 * hole in the coarse map's shadow.
 */
/* #hardshadow drops back to three's fixed one-texel kernel while leaving
   everything else about the build alone. It exists because the penumbra change
   could not otherwise be attributed: the capture before it and the capture
   after it also straddle System 5's shaft fix, which brightened shaded rock by
   itself, so a before/after pair across the two measures the sum of two edits
   and can convict either. With this, both halves of the pair come from the same
   tree in the same minute. */
const NO_ASTERN = /(^|[#&,])noastern(\b|$|[&,])/.test(
  (typeof location !== 'undefined' ? location.hash || '' : '').toLowerCase());
const HARD_SHADOW = /(^|[#&])hardshadow(\b|$|&)/.test(
  (typeof location !== 'undefined' ? location.hash || '' : '').toLowerCase());
/* The grazing bias in s4AoTint: how much faster the horizon band closes than the
   zenith as local relief occludes a surface. `#aok=1` is a true ablation, because at
   an exponent of 1 the split degenerates to the uniform scalar it replaces and the
   returned gain is vec3(1) at every depth. */
const AO_K = (() => {
  const m = /(^|[#&])aok=([0-9.]+)/.exec(
    (typeof location !== 'undefined' ? location.hash || '' : '').toLowerCase());
  /* 2 ships. #aok=1 is an exact algebraic identity - the solve gives vWall = vSky = ao
     and the gain is vec3(1) at every depth - which makes it a true ablation and is how
     the exchange rate below was measured. That control is worth the paragraph: running
     it showed lit rock at 0.617 with the term provably inert, against 0.621 in a
     capture ninety minutes earlier, so 0.004 of what looked like this term's cost was
     an in-flight textures.js drift and the real price of aok=2 is 0.003 of lit
     saturation for 0.018 of shaded. Without the identity capture that would have been
     filed as a bad trade and abandoned. */
  const v = m ? Number(m[2]) : 2.0;
  return Number.isFinite(v) && v >= 1 && v <= 6 ? v : 2.0;
})();

let patched = false;
export function patchShadowChunk() {
  if (patched) return;
  patched = true;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (!src.includes('float getShadow(')) {
    console.warn('sky.js: shadow chunk signature changed; cascade patch skipped');
    return;
  }
  THREE.ShaderChunk.shadowmap_pars_fragment =
    src.replace('float getShadow(', 'float getShadowCascade(') + /* glsl */`
#ifdef USE_SHADOWMAP
  /* Receiver-plane depth bias. A constant bias cannot work at this sun
     elevation and the arithmetic says so: the light looks down at eight
     degrees, so one texel of the coarse map — 50.8 mm across the ground —
     steps 50.8 / sin(8) = 365 mm along a horizontal floor and therefore
     361 mm in depth. The bias was 280 mm, and the soft-shadow kernel samples
     three and a half texels either side, so the depth the comparison needed to
     forgive was nearer 1.6 m. The wash floor consequently shadowed *itself*
     everywhere: measured on sys4c, 0.2 to 3 percent of the floor was catching
     sun where the provisional rig had 19 to 74, and even its brightest decile
     sat at the predicted fully-shaded level. Not one part of it was lit.

     Raising the constant instead is the trap. The offset a horizontal floor
     needs at eight degrees is seven times its texel, and applying that
     everywhere deletes the first metre of every cast shadow — which is the
     whole of a pebble's, and System 1 spent four rounds putting pebble shadows
     in. The depth slope is not a constant, so the bias must not be either.

     So measure the slope instead of guessing it. dFdx/dFdy of the shadow
     coordinate give the receiver plane in light space directly; inverting the
     2x2 uv Jacobian turns them into depth-per-texel, which is exactly the
     quantity the comparison needs to forgive. It goes to zero on a face square
     to the beam and rises where the geometry actually is grazing, so a pebble
     keeps its shadow and the floor stops eating its own. Isidoro 2006; the
     cost is four derivatives and a 2x2 solve per light. */
  float rpBias( vec3 p, vec2 mapSize, float radius ) {
    vec2 duvdx = dFdx( p.xy ), duvdy = dFdy( p.xy );
    float det = duvdx.x * duvdy.y - duvdx.y * duvdy.x;
    /* Degenerate where the projected quad collapses — a silhouette edge, or a
       face turned exactly edge-on to the light. No plane to fit, so no bias. */
    if ( abs( det ) < 1e-14 ) return 0.0;
    float dzdx = dFdx( p.z ), dzdy = dFdy( p.z );
    vec2 g = vec2( dzdx * duvdy.y - dzdy * duvdx.y,
                   dzdy * duvdx.x - dzdx * duvdy.x ) / det;
    vec2 texel = ( radius + 1.0 ) / mapSize;
    /* Capped, because the derivative estimate is meaningless across a
       silhouette and an uncapped spike there punches a lit hole through a
       shadow. ${(4.0 / DEPTH_RANGE).toFixed(8)} is four metres of this
       frustum's depth, well past any real slope and well short of the
       thickness of anything that casts. */
    return min( abs( g.x ) * texel.x + abs( g.y ) * texel.y, ${(4.0 / DEPTH_RANGE).toFixed(8)} );
  }

  #if defined( SHADOWMAP_TYPE_PCF_SOFT )
  ${HARD_SHADOW ? '/* #hardshadow: PCSS off */' : '#define SUN_PCSS 1'}

  /* ---- a penumbra the size of the sun ----
   * The sun is a disc half a degree across, not a point, so a shadow edge is a
   * gradient whose width is the occluder's distance times that angle: about
   * 9.3 mm of softness per metre of gap. Nothing in three's shadow path knows
   * this. Worse, shadowRadius — which reads as the control for it, and which
   * this rig has been setting to 3.5 and 1.7 texels — is *ignored* by the
   * PCF_SOFT branch, whose kernel is a fixed bilinear-weighted 3x3 over one
   * texel. The project runs PCF_SOFT everywhere above the lowest tier, so the
   * radius has never done anything at all. That also retracts an experiment
   * recorded further down this file: widening the radius from 3.5 to 10 texels
   * measured no change in floor grad/L, and the reason was not that penumbra
   * width cannot move gradient, it was that both numbers compiled to the same
   * one-texel kernel.
   *
   * The cost of that shows up as a named artifact. In the wall_shade framing a
   * facet of wallL is lit through a grazing gap in the same wall's crest 170 m
   * up-canyon — geometrically correct, confirmed by raycast in
   * tools/_slabmap.mjs, which finds nothing between that facet and the sun and
   * finds the crest across every neighbouring sample. But 170 m of gap is
   * 1.6 m of penumbra, and a one-texel kernel on the 208 m cascade gives 5 cm.
   * Measured on the sRGB frame the terminator rises 10 to 90 percent in 3 px
   * where the geometry says 30. So the patch reads as a hard-edged
   * parallelogram pasted on the rock — the "floating slab" — when it should
   * read as a soft shaft of light. Critics have been calling it geometry for
   * hours and it is not: it is the shadow filter refusing to admit the sun has
   * a size.
   *
   * So size the filter from the blocker distance instead. Search the map for
   * occluders, average their depth, and set the kernel width from the gap:
   * Fernando 2005. Three details are worth more than the sketch.
   *
   * The kernel is a disc in *world* space, not in UV. Both cascades cover more
   * ground across than up — 208 by 124, 36 by 31 — over a square map, so a
   * circle in texels is an ellipse on the rock, off by 1.7x. Scaling the
   * offsets by metres-per-UV per axis costs one multiply and gets it right.
   *
   * Bias is per tap and exact, which is what makes a wide kernel affordable at
   * all. rpBias above estimates one number for the whole kernel from its
   * radius, and at 30 texels that estimate is nonsense: the cap would either
   * eat contact shadows or let the wash floor shadow itself, and this rig has
   * already been round that loop once. Here the receiver plane's depth
   * gradient is evaluated at each tap's own offset, so a floor's own samples
   * land on its own plane and never register as blockers, at any radius, with
   * no cap doing the work. The slope is still limited, because across a
   * silhouette the derivative is garbage and a wide kernel would amplify it,
   * but the limit is per texel of offset rather than a flat ceiling.
   *
   * Tap count follows the radius. A contact shadow is a couple of texels wide
   * and eight taps resolve it; only a penumbra metres across pays for 28. The
   * disc is a golden-angle spiral rotated per pixel, so the places where the
   * taps under-sample become noise at the 1/n step rather than concentric
   * rings, and it stays deterministic because the rotation is a function of the
   * fragment's own coordinate. */
  const float SUN_TAN = 0.00931;    /* tan of the sun's 0.533 degree diameter */
  /* The steepest depth-per-texel it will believe from a derivative. A floor
     under a 15 degree sun runs 0.19 m of depth per texel of the coarse
     cascade, so this clears the honest worst case with margin and still
     refuses the spikes that appear along a silhouette. */
  const float SUN_MAXSLOPE = ${(0.35 / DEPTH_RANGE).toFixed(9)};

  /* Metres across the map, x and y. Keyed on resolution because that is the
     only thing the chunk is handed that distinguishes the cascades. */
  vec2 sunExtent( vec2 mapSize ) {
    return mapSize.x > 3000.0
      ? vec2( ${(FAR_BOX.xHi - FAR_BOX.xLo).toFixed(1)}, ${(FAR_BOX.yHi - FAR_BOX.yLo).toFixed(1)} )
      : vec2( ${(NEAR_BOX.xHi - NEAR_BOX.xLo).toFixed(1)}, ${(NEAR_BOX.yHi - NEAR_BOX.yLo).toFixed(1)} );
  }

  /* Depth per unit UV of the receiver plane, from the same 2x2 solve rpBias
     uses. Zero where the projected quad collapses: no plane, so no correction. */
  vec2 sunPlane( vec3 p ) {
    vec2 duvdx = dFdx( p.xy ), duvdy = dFdy( p.xy );
    float det = duvdx.x * duvdy.y - duvdx.y * duvdy.x;
    if ( abs( det ) < 1e-14 ) return vec2( 0.0 );
    float dzdx = dFdx( p.z ), dzdy = dFdy( p.z );
    return vec2( dzdx * duvdy.y - dzdy * duvdx.y,
                 dzdy * duvdx.x - dzdx * duvdy.x ) / det;
  }

  /* How much deeper the receiver's own surface is at this tap's offset. */
  float sunSlope( vec2 g, vec2 o, vec2 mapSize ) {
    float lim = SUN_MAXSLOPE * length( o * mapSize );
    return clamp( dot( g, o ), -lim, lim );
  }

  vec2 sunSpiral( int i, int n, float rot ) {
    float a = float( i ) * 2.39996323 + rot;
    return sqrt( ( float( i ) + 0.5 ) / float( n ) ) * vec2( cos( a ), sin( a ) );
  }

  float sunSoftShadow( sampler2D map, vec2 mapSize, float intensity, float bias, float radius, vec4 coord ) {
    vec3 p = coord.xyz / coord.w;
    if ( p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0 ) return 1.0;

    vec2 ext = sunExtent( mapSize );
    vec2 uvPerM = 1.0 / ext;
    float texelM = ext.x / mapSize.x;
    /* The widest penumbra each cascade can express. The fine cascade only
       covers 36 m, so nothing inside it can be far enough away to throw more
       than a third of a metre; the coarse one is capped for the search cost. */
    float maxPen = mapSize.x > 3000.0 ? 2.0 : 0.5;
    vec2 g = sunPlane( p );
    float rot = 6.2831853 * fract( 52.9829189 *
      fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );

    /* Blocker search, over half the widest penumbra: a point further outside
       the hard edge than this finds nothing and stays lit, which is exactly
       the outer limit of the gradient the filter can then draw. */
    float search = 0.5 * maxPen, sum = 0.0, cnt = 0.0;
    for ( int i = 0; i < 12; i ++ ) {
      vec2 o = sunSpiral( i, 12, rot ) * search * uvPerM;
      float d = unpackRGBAToDepth( texture2DLodEXT( map, p.xy + o, 0.0 ) );
      if ( d < p.z + bias + sunSlope( g, o, mapSize ) ) { sum += d; cnt += 1.0; }
    }
    if ( cnt < 0.5 ) return 1.0;

    float pen = min( ( p.z - sum / cnt ) * ${DEPTH_RANGE.toFixed(1)} * SUN_TAN, maxPen );

    /* Below a few texels, hand it back to three's kernel. A packed depth map
       cannot be bilinear-filtered — three sets NearestFilter, and it has to,
       since interpolating four packed bytes is meaningless — so three's PCF_SOFT
       emulates the interpolation in the shader with those mix() calls on the
       fractional texel position. A nearest-sampled disc cannot match that at
       one texel: eight taps give eight levels and they land blocky.
       Measured, and this is why the split is here rather than a tidier single
       kernel. Running the disc all the way down to contact cost +0.063 of lit
       rock saturation and +0.033 of V, with the region's median falling as its
       bright tail clipped — the rock's own micro-relief self-shadowing had gone
       binary, so the brightest 40% of a lit window got brighter and more
       saturated while everything else got darker. Ablated against #hardshadow
       in the same tree, so that figure is this kernel's and not the concurrent
       shaft fix landing next to it. Contact shadows are a baseline this project
       has already tuned; the penumbra work has no business touching them. */
    float wide = smoothstep( 3.0, 7.0, pen / texelM );
    float sNarrow = 0.0, sWide = 0.0;
    if ( wide < 1.0 ) {
      sNarrow = getShadowCascade( map, mapSize, intensity,
        bias - rpBias( p, mapSize, radius ), radius, coord );
    }
    if ( wide > 0.0 ) {
      float r = 0.5 * pen;
      int n = int( clamp( r / texelM * 1.2, 8.0, 28.0 ) );
      float s = 0.0;
      /* texture2DLodEXT, not texture2D, and it is the reason X3595 was fired
         thirteen times: "gradient instruction used in a loop with varying
         iteration; partial derivatives may have undefined value". This loop's
         trip count is per-pixel - n comes off the penumbra width and the break
         makes the iteration count vary within a quad - while texture2D asks for
         derivatives so it can pick a mip. **There is no mip to pick.** three
         allocates the shadow map with minFilter and magFilter NearestFilter for
         every type but VSM (WebGLShadowMap.js:152) and WebGLRenderTarget leaves
         generateMipmaps off, so level zero is the only level there is: the
         derivative was computed, found undefined, and discarded. Asking for level
         zero explicitly samples the identical texel and skips the computation,
         which is why the frame hash is unchanged either side of this edit.
         The define is three's own - WebGLProgram.js:881 maps texture2DLodEXT to
         textureLod - so this is not an extension this project is reaching for;
         terrain.js already leans on the sibling texture2DGradEXT.
         Worth carrying the performance agent's caveat: this is a derivative whose
         value is *discarded*, not one whose value is unbounded, so it is not the
         class of bug that produced the grazing lattice. Nothing was rendering
         wrong. It was paying for a derivative on every tap of every shadowed
         pixel and throwing it away. */
      for ( int i = 0; i < 28; i ++ ) {
        if ( i >= n ) break;
        vec2 o = sunSpiral( i, n, rot ) * r * uvPerM;
        float d = unpackRGBAToDepth( texture2DLodEXT( map, p.xy + o, 0.0 ) );
        s += step( p.z + bias + sunSlope( g, o, mapSize ), d );
      }
      sWide = mix( 1.0, s / float( n ), intensity );
    }
    return mix( sNarrow, sWide, wide );
  }
  #endif

  float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    #ifdef SUN_PCSS
      float s = sunSoftShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );
    #else
      float b = shadowBias - rpBias( shadowCoord.xyz / shadowCoord.w, shadowMapSize, shadowRadius );
      float s = getShadowCascade( shadowMap, shadowMapSize, shadowIntensity, b, shadowRadius, shadowCoord );
    #endif
    #if NUM_DIR_LIGHT_SHADOWS > 1
      vec4 nc = vDirectionalShadowCoord[ 1 ];
      vec3 np = nc.xyz / nc.w;
      vec3 edge = min( np, 1.0 - np );
      float inNear = smoothstep( 0.0, 0.03, min( edge.x, edge.y ) )
                   * step( 0.0, np.z ) * step( np.z, 1.0 );
      if ( inNear > 0.0 ) {
        DirectionalLightShadow n = directionalLightShadows[ 1 ];
        #ifdef SUN_PCSS
          float sn = sunSoftShadow( directionalShadowMap[ 1 ], n.shadowMapSize,
            n.shadowIntensity, n.shadowBias, n.shadowRadius, nc );
        #else
          float bn = n.shadowBias - rpBias( np, n.shadowMapSize, n.shadowRadius );
          float sn = getShadowCascade( directionalShadowMap[ 1 ], n.shadowMapSize,
            n.shadowIntensity, bn, n.shadowRadius, nc );
        #endif
        s = mix( s, min( s, sn ), inNear );
      }
    #endif
    return s;
  }
#endif`;
}
patchShadowChunk();

/* ── the rig ───────────────────────────────────────────────────────────────*/

export function buildLights() {
  /* The beam. Colour is the spectral transmittance at air mass 6.86 through
     8,000 m of Rayleigh, 0.032 of aerosol and 300 DU of ozone, integrated
     against the CIE observer — 3,890 K, which is where published measurements
     of direct sun at eight degrees sit. The saturation that comes out of that
     is 0.42 encoded, between the provisional rig's 0.34 and the 0.68 that made
     Mars, and it is not a compromise between them: it is what the number is.
     Intensity is the irradiance, so the light and the sky are on one scale and
     the ratio between key and fill is the atmosphere's rather than a taste. */
  const peak = Math.max(...A.sunRGB);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.color.setRGB(A.sunRGB[0] / peak, A.sunRGB[1] / peak, A.sunRGB[2] / peak,
    THREE.LinearSRGBColorSpace);
  sun.intensity = peak * SCALE;

  /* Penumbra is no longer set here, and these two numbers no longer do
     anything on the path this project renders on. three's PCF_SOFT branch
     ignores `shadowRadius` outright — its kernel is a fixed bilinear 3x3 over
     one texel — so 3.5 and 1.7 were inert from the day they were written, and
     the earlier note claiming 3.5 texels bought 0.18 m of soft edge was simply
     wrong about what the renderer does with the number. Penumbra width is now
     derived per fragment from the blocker distance and the sun's angular
     diameter, up in the shadow chunk; see the comment on sunSoftShadow.

     The experiment that used to be recorded here is retracted rather than
     merely superseded, because it reached a true conclusion by a false route.
     Widening the radius from 3.5 to 10 texels measured floor grad/L at 0.186
     both times and the shaded wall at 0.019 against 0.021, and that was read as
     evidence that cast-shadow edges are too small a share of a region's pixels
     to move a nine-pixel high-pass. They may well be, but this did not show it:
     both settings compiled to the identical one-texel kernel, so the null was
     the null of an experiment that never varied its independent variable. The
     figures below are kept because they still feed rpBias on the low tiers,
     where PCFShadowMap does read the radius. */
  /* Both constants come down hard now that rpBias measures the depth slope
     instead of the rig guessing a worst case for it. 0.28 m and 0.028 m were
     sized for a horizontal floor at eight degrees and were still three times
     short of it, while being far more than a face square to the beam needs —
     the worst of both, which is what a constant bias is at a raking sun. What
     is left here covers only depth quantisation and the wobble a normal map
     puts on the geometric normal, so a pebble now keeps its shadow to within
     a few centimetres of its base rather than losing the first 30 cm. */
  configureCascade(sun, FAR_BOX, 4096, 0.06, 0.010, 3.5);
  sun.name = 'sun';

  const sunNear = new THREE.DirectionalLight(0xffffff, 0);
  configureCascade(sunNear, NEAR_BOX, 2048, 0.02, 0.005, 1.7);
  sunNear.name = 'sunNear';

  /* The fill: the SH9 irradiance of sky, wash floor and opposite wall. This is
     the term the brief calls hemispherical skylight and bounce, and it is one
     object rather than three because they are one integral. An upward-facing
     surface gets 0.030 of irradiance at hue 215 — the blue-violet dome. A face
     turned away from the sun gets 0.030 at hue 230, which is where the violet in
     the shadows comes from and it comes from the sky rather than from a tint. A
     downward-facing one gets 0.012 at hue 23 — the wash floor throwing warm light
     back up under every overhang. None of the three was chosen; they fall out of
     where the energy in this sky actually is. */
  const probe = new THREE.LightProbe(A.sh.clone(), 1);
  probe.sh.scale(SCALE);
  installProbeHeightLerp(A);

  return { sun, sunNear, probe };
}

/* One probe is one aperture, and the aperture is a strong function of height.
 * tools/skyview.mjs measured it: on a lateral normal a point on the wash floor
 * sees 0.215 of the sky, and 0.954 at 70 m up. A LightProbe is a single SH set
 * for the whole scene, so every surface was being handed the floor's figure —
 * which underlights the walls, and the shaded wall face that is crushing spans
 * roughly 5 to 40 m of height where geometry gives it 0.3 to 0.7.
 *
 * So carry two environments and lerp between them: the measured skyline, and the
 * same sky with the escarpment removed. Irradiance is linear in the SH
 * coefficients, so the difference is itself an SH and one extra nine-term
 * evaluation covers it — not two probes.
 *
 * The ground half of both environments is identical by construction, but that
 * does *not* leave undersides untouched, and it would be easy to claim it does:
 * SH9 is a low-order fit, so the sky coefficients leak into a down-facing cosine
 * lobe. Measured in tools/probefit.mjs, a downward normal goes 0.0109 0.0082
 * 0.0074 to 0.0138 0.0107 0.0088 across the full lerp — 19 to 30 percent
 * brighter at the rim, and still warm, R above G above B at both ends.
 *
 * Baked as literals rather than plumbed as uniforms, following src/aerial.js:
 * the environment is fixed for a weather instant, and a global chunk patch would
 * otherwise need its uniform added to every material three builds.
 *
 * UNVERIFIED against a rendered frame. The CPU check in tools/probefit.mjs is
 * good — rms 0.050 in sky visibility across four normals and six heights, level
 * with the 0.02-0.05 the skyline model itself achieves — but the residual is not
 * uniform: it reaches +0.13 on the sun-facing normal high up, because even above
 * the rim that bearing still has far skyline in it while the open probe assumes
 * clear sky. Those surfaces are direct-dominated, so it lands where the fill is
 * the smallest share of the light. */
let BASE_PARS = null, BASE_FRAG = null;

function installProbeHeightLerp(A) {
  /* Exactly three's shGetIrradianceAt constants, folded into the coefficients.
     Read out of the build rather than remembered. */
  const K = [0.886227, 2 * 0.511664, 2 * 0.511664, 2 * 0.511664,
    2 * 0.429043, 2 * 0.429043, 1, 2 * 0.429043, 0.429043];
  const lit = (k) => {
    const o = A.shOpen.coefficients[k], s = A.sh.coefficients[k], f = SCALE * K[k];
    return `vec3(${((o.x - s.x) * f).toFixed(7)},${((o.y - s.y) * f).toFixed(7)},` +
      `${((o.z - s.z) * f).toFixed(7)})`;
  };
  const ast = (k) => {
    const o = A.shAstern.coefficients[k], s = A.sh.coefficients[k], f = SCALE * K[k];
    return `vec3(${((o.x - s.x) * f).toFixed(7)},${((o.y - s.y) * f).toFixed(7)},` +
      `${((o.z - s.z) * f).toFixed(7)})`;
  };
  /* Absolute rather than a difference, because s4AoTint needs the two illuminants'
     own magnitudes and not their separation from anything. */
  const abso = (sh) => (k) => {
    const c = sh.coefficients[k], f = SCALE * K[k];
    return `vec3(${(c.x * f).toFixed(7)},${(c.y * f).toFixed(7)},${(c.z * f).toFixed(7)})`;
  };
  const sky9 = abso(A.shSky);
  const bnc = (() => {
    /* Escarpment and ground bounce together: both are red rock lit mostly by the
       sun, both sit near or below the horizon, and nothing downstream needs them
       apart. One probe instead of two halves the evaluation. */
    const s = { coefficients: A.shWall.coefficients.map((w, k) => ({
      x: w.x + A.shGround.coefficients[k].x,
      y: w.y + A.shGround.coefficients[k].y,
      z: w.z + A.shGround.coefficients[k].z })) };
    return abso(s);
  })();
  const SH9 = (f) => `${f(0)} + ${f(1)} * y + ${f(2)} * z + ${f(3)} * x` +
    ` + ${f(4)} * ( x * y ) + ${f(5)} * ( y * z )` +
    ` + ${f(6)} * ( 0.743125 * z * z - 0.247708 )` +
    ` + ${f(7)} * ( x * z ) + ${f(8)} * ( x * x - y * y )`;
  /* Fitted in tools/probefit.mjs against the raycast table. The two ramps exist
     because the thing that differs between normals is not the level but the
     rate: an up-facing surface is already half open at the floor and saturates
     early, a wall face starts nearly shut and opens late. World Y is used raw —
     the wash floor lies between -1.56 and +1.51 m of zero over the whole 220 m
     traverse, which is three percent of the ramp's scale. */
  const PARS = /* glsl */`
#if defined( USE_LIGHT_PROBES ) && defined( USE_FOG )
  vec3 s4ProbeDelta( vec3 n ) {
    float x = n.x, y = n.y, z = n.z;
    return ${lit(0)} + ${lit(1)} * y + ${lit(2)} * z + ${lit(3)} * x
      + ${lit(4)} * ( x * y ) + ${lit(5)} * ( y * z )
      + ${lit(6)} * ( 0.743125 * z * z - 0.247708 )
      + ${lit(7)} * ( x * z ) + ${lit(8)} * ( x * x - y * y );
  }
  vec3 s4AsternDelta( vec3 n ) {
    float x = n.x, y = n.y, z = n.z;
    return ${ast(0)} + ${ast(1)} * y + ${ast(2)} * z + ${ast(3)} * x
      + ${ast(4)} * ( x * y ) + ${ast(5)} * ( y * z )
      + ${ast(6)} * ( 0.743125 * z * z - 0.247708 )
      + ${ast(7)} * ( x * z ) + ${ast(8)} * ( x * x - y * y );
  }
  /* How open the corridor is behind you, which is the second axis of aperture and
     the one skyview.mjs concluded did not exist. What is astern is the wash you
     have already walked, so it lengthens as you go and its skyline drops:
     tools/_skydist.mjs measures 80 degrees at 8 m along, then 57, 46, 37, 27, 22
     at 30, 46, 62, 92 and 120, flattening near 17 beyond that. Nine measured
     points sit within two degrees of 17 + 63 exp(-(d-8)/45), and world Z stands in
     for arc length because the wash is straight - x holds inside 9 m over 332 m,
     so d is 8 - z to 1.4 percent. That is the whole reason this can be one exp of
     a world coordinate instead of a path lookup.
     Interpolating by sin squared of the skyline rather than by the angle: what the
     two probes differ by is the cosine-weighted solid angle the escarpment covers,
     and that is sin squared of its elevation, so this is the parameter the pair is
     actually linear in. Against the angle it would be off by six points of mix at
     the middle of the walk. */
  float s4AsternOpen( float wz ) {
    float el = min( 0.296706 + 1.099557 * exp( wz * 0.0222222 ), 1.5707963 );
    float s = sin( el );
    return clamp( ( 0.5 - s * s ) * 2.412545, 0.0, 1.0 );
  }
  /* ---- occlusion is one number and it scales three illuminants ----
     The fill on a shaded surface here is 48% sky, 25% escarpment and 27% ground
     bounce by luminance on a lateral face (tools/_probesplit.mjs, exact
     decomposition). Reflected off the rock albedo those are hue -23.9 at 0.252
     saturation, hue 8.6 at 0.920, and hue 10.8 at 0.728. **The sky is already the
     largest of the three by luminance and still loses the chroma fight**, because
     the two warm terms are nearly three times as saturated as it is, and the mix
     lands at hue 5.9 and 0.635 - which is the 0.638 the render measures, so this
     is where shade's colour is decided and not in the encoder.

     Downstream, rock.js and terrain.js multiply the whole sum by one occlusion
     scalar. That preserves the ratio of the three at every depth, so an occluded
     crevice gets less light of exactly the same colour. Real relief does not work
     that way: **a pit's own rim cuts the grazing directions long before it cuts the
     zenith**, and the two warm terms live at and below the horizon while the sky
     lives overhead. So one scalar systematically over-occludes the cool illuminant
     and under-occludes the warm one, and deep shade comes out warmer than it is.

     This returns the per-channel correction for that, built to be unable to cost
     anything already earned. **It is exactly vec3(1) at ao = 1**, so no fully
     visible pixel moves and lit rock's 0.618 cannot drift. And it **preserves
     luminance**: vSky is solved for whatever restores the luminance uniform ao
     would have delivered, so the shadow gate, which is a luminance ratio, cannot
     move either. What is left is chroma alone.

     The one modelled quantity is the grazing bias, the rate at which the horizon
     band closes relative to the zenith, here ao^2. A power is the right shape - at
     ao = 1 nothing is occluded and the bias must vanish - but the exponent is a
     model and not a measurement, so #aok= sweeps it and 1.0 reproduces today's
     behaviour exactly for an ablation.

     Two honest limits. The gain is computed from the base probe while the
     irradiance it multiplies also carries the height and astern lerps, so above
     the rim and far up-canyon it is approximate - both of those open the
     escarpment away anyway, which is the direction that makes the correction
     smaller, so the error is toward doing nothing. And when the luminance solve
     wants vSky above 1 it is capped and vWall re-solved instead, which keeps the
     luminance exact rather than letting the term invent sky that is not there. */
  vec3 s4SkyIrr( vec3 n ) {
    float x = n.x, y = n.y, z = n.z;
    return ${SH9(sky9)};
  }
  vec3 s4BounceIrr( vec3 n ) {
    float x = n.x, y = n.y, z = n.z;
    return ${SH9(bnc)};
  }
  vec3 s4AoTint( vec3 n, float ao ) {
    vec3 Es = max( s4SkyIrr( n ), vec3( 0.0 ) );
    vec3 Eb = max( s4BounceIrr( n ), vec3( 0.0 ) );
    float ls = dot( Es, vec3( 0.2126, 0.7152, 0.0722 ) );
    float lb = dot( Eb, vec3( 0.2126, 0.7152, 0.0722 ) );
    float lt = ao * ( ls + lb );
    float vW = pow( ao, ${AO_K.toFixed(3)} );
    float vS = ( lt - vW * lb ) / max( ls, 1e-6 );
    if ( vS > 1.0 ) { vS = 1.0; vW = ( lt - ls ) / max( lb, 1e-6 ); }
    vS = clamp( vS, 0.0, 1.0 ); vW = clamp( vW, 0.0, 1.0 );
    return ( vS * Es + vW * Eb ) / max( ao * ( Es + Eb ), vec3( 1e-6 ) );
  }
  float s4ProbeOpen( float wy, float ny ) {
    /* The free-exponent fit wanted 1.46 and 1.12; pinning them to 1.5 and 1.125
       gives the same residual to three decimals (0.045 and 0.029), so the two
       pow calls buy nothing and become a sqrt chain. */
    float a = clamp( wy * 0.018692, 0.0, 1.0 );
    float b = clamp( wy * 0.020619, 0.0, 1.0 );
    float tl = a * sqrt( a );
    float tu = b * sqrt( sqrt( sqrt( b ) ) );
    return mix( tl, tu, clamp( ny, 0.0, 1.0 ) );
  }
#else
  /* So a caller in another file does not have to know which materials got probes.
     Any material compiled without them has no fill for this to correct, and a
     gain of one is the honest answer rather than a compile error. */
  vec3 s4AoTint( vec3 n, float ao ) { return vec3( 1.0 ); }
#endif
`;
  /* Rebuild from the pristine chunks every time rather than appending to
     whatever is there. Appending twice redefines a GLSL function, and appending
     once with stale coefficients after a weather change is worse — it fails
     silently and the fill is then wrong by however much the sky moved. */
  if (BASE_PARS === null) {
    BASE_PARS = THREE.ShaderChunk.lights_pars_begin;
    BASE_FRAG = THREE.ShaderChunk.lights_fragment_begin;
  }
  const ANCHOR = 'irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );';
  if (!BASE_FRAG.includes(ANCHOR)) {
    throw new Error('sky.js: three\'s light-probe line moved; the height lerp is not installed');
  }
  THREE.ShaderChunk.lights_pars_begin = BASE_PARS + PARS;
  /* Built as a whole line before the literal rather than as a ternary inside it.
     The ablation used to be spliced in mid-sentence, which meant the block comment
     below opened in one template literal and closed in *both* arms of the ternary.
     The assembled string was valid and the shader compiled, but no single literal
     was well-formed, so `glslcheck` reported an unclosed comment here — and a
     static check with a known-false failure is worse than no check at all. The
     whole tree runs it before committing, and tonight cost several hours to people
     trusting a green result or waving off a red one. The fragility was real as well
     as cosmetic: validity rested on an invariant held in two places with nothing
     enforcing it, and if either arm ever stopped closing the comment the result is
     an unparseable shader, which does not fail loudly — it falls back silently and
     the capture comes back in three's default material. That has cost this project
     two seven-minute renders and once presented as a phantom colour regression.
     Keeping the comment wholly inside the literal removes the invariant instead of
     documenting it: the arms no longer contain comment text, so they cannot stop
     closing something they do not have. */
  const ASTERN = NO_ASTERN
    ? '/* #noastern: the up-canyon aperture is off for this run. */'
    : 'irradiance += s4AsternDelta( s4wn ) * ( s4AsternOpen( vFogW.z ) * ( 1.0 - s4open ) );';
  THREE.ShaderChunk.lights_fragment_begin =
    BASE_FRAG.replace(ANCHOR, `${ANCHOR}
    #if defined( USE_FOG )
      {
        vec3 s4wn = inverseTransformDirection( geometryNormal, viewMatrix );
        float s4open = s4ProbeOpen( vFogW.y, s4wn.y );
        irradiance += s4ProbeDelta( s4wn ) * s4open;
        /* Scaled by what the height lerp has not already opened. Above the rim
           shOpen has no escarpment left in it at any bearing, so there is no
           up-canyon window left to open and crediting one would double-count it.
           #noastern drops this term and nothing else, so the up-canyon aperture
           can be ablated inside one build. Comparing two sessions is not good
           enough for a chroma reading on shade: the fill-only frames sit at V 0.11
           to 0.24, which is far enough down the toe that any tone-curve work
           landing in between moves the hue by more than this term does. */
        ${ASTERN}
      }
    #endif`);
}

/** Everything the report needs, and a guard against the model drifting. */
export const DIAG = {
  scale: SCALE,
  sunRGB: A.sunRGB, sunLum: A.sunLum,
  irradiance: A.irradiance,
  directHorizontal: A.directHorizontal,
  solveMs: A.ms,
};
