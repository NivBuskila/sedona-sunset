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
 * luminance, which puts the direct beam at the ground at 0.33 and the whole
 * scene at inconvenient fractions. SCALE just moves the decimal point: it is
 * cancelled exactly by EXPOSURE below, so its value is arbitrary and only two
 * things depend on it. One is readability — with SCALE at 9.05 the direct beam
 * lands on a luminance of 3.0 and the numbers in the report are legible. The
 * other is that terrain.js and rock.js each add a small Rayleigh airlight term
 * in absolute scene units, so the frame's overall radiance cannot be changed
 * without those two constants moving with it.
 */
const SCALE = 9.05;

/* Derived, not dialled. ACES maps its input through a curve whose midpoint sits
 * near 0.5, and a sunlit Sedona face should land at HSV value 0.59-0.73 — call
 * it 0.66, which is 0.376 of full output and needs about 0.5 going in. A sunlit
 * vertical face here receives SCALE * 0.374 of irradiance and reflects roughly a
 * third of it in the red channel, so the exposure that puts the red channel at
 * 0.5 after three's internal /0.6 is the figure below. It is checked against a
 * measured render rather than trusted; see the report.
 */
export const EXPOSURE = 0.62;

/* ── the fog colour ────────────────────────────────────────────────────────
 * Aerial perspective is System 5's, but scene.fog needs a colour now and the
 * honest one is the radiance of the air itself. Taken as the azimuth-weighted
 * mean of the sky map through the first six degrees of elevation, weighted
 * toward the up-wash half because that is where the camera spends its time and
 * a single constant has to be a compromise somewhere.
 */
export const FOG = (() => {
  const { lut, SKY_W, SKY_H } = A;
  let r = 0, g = 0, b = 0, w = 0;
  for (let j = 0; j < SKY_H; j++) {
    const v = (j + 0.5) / SKY_H, t = (v - 0.5) * 2, y = Math.sign(t) * t * t;
    if (y < 0 || y > 0.105) continue;                    // 0 … 6 degrees
    for (let i = 0; i < SKY_W; i++) {
      const phi = ((i + 0.5) / SKY_W) * Math.PI;
      /* Toward the sun the air is a bright orange glow and away from it a dusty
         rose; the camera looks up-wash most of the time, so the mean is biased
         that way rather than being flat. */
      const wt = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(phi));
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
const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
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
    data[i + 3] = THREE.DataUtils.toHalfFloat(lut[i + 3] * SCALE);
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
         solid angle, which is forty thousand times the brightest sky texel and
         is not a number any tone curve is going to do something sensible with
         before System 7 puts a bloom under it. Capped at sixty times the
         aureole peak: comfortably clipped, so the disc is white with a warm
         fringe, without pushing float16 render targets around. */
      uDisc: { value: 60 * SCALE * 0.24 },
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
export const SHADOW_HALF = 34;      // kept for compatibility; no longer used

/* Light-space extents. x is horizontal and perpendicular to the sun's azimuth;
   y is vertical tilted back by the solar elevation, so +y is up and a little
   down-wash and -y runs up the wash toward the sun.
   FAR: +62 admits a 62 m wall top standing at the player, and -78 reaches
   560 m of wash floor up-canyon, which is past where the haze closes in.
   NEAR: sized for the gravel. 34 m of x on a 4096 map is 8.3 mm a texel, half
   the 17 mm the provisional single map managed, so pebble contact shadows come
   out better than before rather than being traded away for the wall shadows. */
const FAR_BOX = { x: 95, yLo: -78, yHi: 62 };
const NEAR_BOX = { x: 17, yLo: -11, yHi: 25 };
/* The light sits far enough up-sun that a wall top 500 m up the corridor is
   still in front of the near plane. Depth is cheap: an orthographic camera is
   linear in z, so 1,860 m across a 24-bit buffer is a tenth of a millimetre. */
const LIGHT_DIST = 900, NEAR_Z = 40, FAR_Z = 1900;
const DEPTH_RANGE = FAR_Z - NEAR_Z;

function configureCascade(l, box, mapSize, biasMetres, normalBias, radius) {
  l.castShadow = true;
  l.shadow.mapSize.set(mapSize, mapSize);
  const c = l.shadow.camera;
  c.left = -box.x; c.right = box.x;
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
  const qFar = (FAR_BOX.x * 2) / sun.shadow.mapSize.x * 4;
  const qNear = (NEAR_BOX.x * 2) / sunNear.shadow.mapSize.x * 4;
  const place = (l, q, x, y, z) => {
    const s = (v) => Math.round(v / q) * q;
    const qx = s(x), qy = s(y), qz = s(z);
    l.target.position.set(qx, qy, qz);
    l.position.set(qx + SUN_DIR.x * LIGHT_DIST, qy + SUN_DIR.y * LIGHT_DIST,
      qz + SUN_DIR.z * LIGHT_DIST);
    l.target.updateMatrixWorld();
    l.updateMatrixWorld();
  };
  return (x, y, z) => {
    place(sun, qFar, x, y, z);
    place(sunNear, qNear, x, y, z);
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
  float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    float s = getShadowCascade( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );
    #if NUM_DIR_LIGHT_SHADOWS > 1
      vec4 nc = vDirectionalShadowCoord[ 1 ];
      vec3 np = nc.xyz / nc.w;
      vec3 edge = min( np, 1.0 - np );
      float inNear = smoothstep( 0.0, 0.03, min( edge.x, edge.y ) )
                   * step( 0.0, np.z ) * step( np.z, 1.0 );
      if ( inNear > 0.0 ) {
        DirectionalLightShadow n = directionalLightShadows[ 1 ];
        float sn = getShadowCascade( directionalShadowMap[ 1 ], n.shadowMapSize,
          n.shadowIntensity, n.shadowBias, n.shadowRadius, nc );
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
     8,000 m of Rayleigh, 0.055 of aerosol and 300 DU of ozone, integrated
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
     kernel at 3.5 texels is 0.16 m here — short of the truth, but an order of
     magnitude closer than one texel. */
  configureCascade(sun, FAR_BOX, 4096, 0.30, 0.030, 3.5);
  sun.name = 'sun';

  const sunNear = new THREE.DirectionalLight(0xffffff, 0);
  configureCascade(sunNear, NEAR_BOX, 4096, 0.05, 0.007, 1.6);
  sunNear.name = 'sunNear';

  /* The fill: the SH9 irradiance of sky, wash floor and opposite wall. This is
     the term the brief calls hemispherical skylight and bounce, and it is one
     object rather than three because they are one integral. An upward-facing
     surface gets 0.031 of irradiance at hue 215 — the blue-violet dome. A
     downward-facing one gets 0.019 at hue 22 — the wash floor throwing warm
     light back up under every overhang. Neither was chosen; both fall out of
     where the energy in this sky actually is. */
  const probe = new THREE.LightProbe(A.sh.clone(), 1);
  probe.sh.scale(SCALE);

  return { sun, sunNear, probe };
}

/** Everything the report needs, and a guard against the model drifting. */
export const DIAG = {
  scale: SCALE,
  sunRGB: A.sunRGB, sunLum: A.sunLum,
  irradiance: A.irradiance,
  directHorizontal: A.directHorizontal,
  solveMs: A.ms,
};
