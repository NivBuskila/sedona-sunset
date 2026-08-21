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
  SUN_EL as ATMOS_SUN_EL, MIE_G,
} from './atmos.js';

export const SUN_AZ = ATMOS_SUN_AZ;
export const SUN_EL = ATMOS_SUN_EL;
export const SUN_DIR = ATMOS_SUN_DIR;

const A = computeAtmosphere();

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

/* Lifted from the derived 1.0 after measurement. The derivation puts a flat
   lit wall face at value 0.62, dead centre of the reference band, but the frames
   it produces have a median luminance in the high twenties because at this sun
   angle most of what is on screen is self-shadowed rock and floor in the left
   wall's shadow. 1.15 puts the lit face at 0.71 and the sunlit floor at 0.55
   with saturation 0.53 — every one of those inside its measured target — at the
   cost of clipping facets that stand square to the beam, which is what a
   photograph exposed for a golden-hour cliff does anyway. */
export const EXPOSURE = 1.15;

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
  const g2 = MIE_G * MIE_G;
  return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * MIE_G * c), 1.5));
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
uniform float uMieG;
uniform float uDisc;       // radiance of the disc itself
uniform vec3 uDiscTint;

const float PI = 3.14159265;

float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5));
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
  vec3 sky = s.rgb + s.a * phaseHG(ca, uMieG) * uMieTint;

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

  float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    float b = shadowBias - rpBias( shadowCoord.xyz / shadowCoord.w, shadowMapSize, shadowRadius );
    float s = getShadowCascade( shadowMap, shadowMapSize, shadowIntensity, b, shadowRadius, shadowCoord );
    #if NUM_DIR_LIGHT_SHADOWS > 1
      vec4 nc = vDirectionalShadowCoord[ 1 ];
      vec3 np = nc.xyz / nc.w;
      vec3 edge = min( np, 1.0 - np );
      float inNear = smoothstep( 0.0, 0.03, min( edge.x, edge.y ) )
                   * step( 0.0, np.z ) * step( np.z, 1.0 );
      if ( inNear > 0.0 ) {
        DirectionalLightShadow n = directionalLightShadows[ 1 ];
        float bn = n.shadowBias - rpBias( np, n.shadowMapSize, n.shadowRadius );
        float sn = getShadowCascade( directionalShadowMap[ 1 ], n.shadowMapSize,
          n.shadowIntensity, bn, n.shadowRadius, nc );
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

  /* Penumbra, on the coarse cascade. The sun is half a degree across, so a
     shadow cast 240 m throws a 2 m soft edge, and a hard edge at that distance
     is the loudest "this is a renderer" tell in a long raking shot. three's PCF
     kernel at 3.5 texels is 0.18 m here — short of the truth, but an order of
     magnitude closer than one texel.

     Measured, and left alone. Widening to 10 texels (0.51 m, which is the
     physical figure for a half-degree sun behind rock 50 m away) was tried as a
     way to recover the floor structure that deepening the shade had cost, on the
     theory that hard edges convert shadow depth into local gradient. It does
     not: floor grad/L reads 0.186 at 3.5 texels and 0.186 at 10, and the shaded
     wall face 0.019 against 0.021. Cast-shadow edges are too small a share of a
     region's pixels to show up in a nine-pixel high-pass; what sets floor grad/L
     is the ratio of direct to fill, because the bed's structure is a modulation
     of direct light. Reverted rather than kept, because rpBias scales its texel
     estimate with radius and 10 texels nearly triples the receiver-plane bias on
     the far cascade — an unmeasured risk of shadows detaching from contact, in
     exchange for no measured benefit. A penumbra that widens with occluder
     distance is a real want, but PCF cannot express it; that needs PCSS. */
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
  THREE.ShaderChunk.lights_fragment_begin =
    BASE_FRAG.replace(ANCHOR, `${ANCHOR}
    #if defined( USE_FOG )
      {
        vec3 s4wn = inverseTransformDirection( geometryNormal, viewMatrix );
        irradiance += s4ProbeDelta( s4wn ) * s4ProbeOpen( vFogW.y, s4wn.y );
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
