/* Sedona Sunset — System 5, part one: aerial perspective.
 *
 * What was here before was `scene.fog = FogExp2`, which is one veil: a single
 * grey mixed in as a function of *range only*. Two critiques have said the same
 * thing about it — that real canyon depth comes from discrete receding
 * ridgelines each a step lighter than the last, and that a flat wash of haze
 * reads as a flat wash of haze. The distance steps are already there: rock.js
 * placed the buttes at 550 / 800 / 1000 / 1450 m specifically so the haze would
 * pass them in stages. What was missing is the *second* axis.
 *
 * That axis is height. Aerosol is not uniformly mixed — it sits in a shallow
 * boundary layer a few hundred metres deep, and at evening, when the ground has
 * stopped convecting, that layer is at its most stratified. So a butte's foot is
 * seen through the full dust column and its cap is seen through a fraction of
 * it, and the same butte is two different distances' worth of haze from top to
 * bottom. That is what makes a ridgeline *end* against the paler one behind it
 * instead of dissolving into it, and it is the difference between layering and a
 * veil. It costs one exponential.
 *
 * The model, evaluated per fragment in the fog chunk:
 *
 *   two species — Rayleigh, wavelength-selective, effectively unstratified over
 *   a two-kilometre scene; and coarse desert dust, near-neutral in colour, in an
 *   exponential layer of scale height H. Both optical depths are the analytic
 *   integral of an exponential density along the actual camera-to-fragment ray,
 *   so a ray that climbs leaves the dust and a ray along the floor does not.
 *
 *   the airlight source is anchored on FOG from sky.js — the measured mean
 *   radiance of the first six degrees of sky, which is System 4's number and
 *   the right one — and *steered*: the dust's forward lobe warms and brightens
 *   it toward the sun and lets it fall cool and dark away from it. sky.js says
 *   plainly that a single constant cannot express a term that varies by two
 *   stops with azimuth and that the directionality is System 5's to add. This
 *   is that term.
 *
 * Deliberately *not* here: any noise. A previous haze attempt put procedural
 * cloud into the air and produced milky blobs floating over the midground with
 * no attachment to depth, which a critic called worse than the flat veil it
 * replaced. Everything in this file is a function of the ray, so every gradient
 * in the result is a depth gradient.
 *
 * And it does not destroy far-field detail. The whole model is `L * T + J`, an
 * affine transform of radiance with a per-pixel-slowly-varying coefficient, so
 * it scales the high- and low-frequency bands of a surface equally: `hf/lf` is
 * invariant under it. Haze is not an excuse for lost texture and cannot be
 * blamed for it either.
 *
 * Implementation note: this patches three's fog shader chunks in place, the same
 * technique sky.js uses for its shadow cascade, because every material in the
 * project reaches its fog through those chunks and none of them are mine to
 * edit. Everything the model needs beyond the ray is a compile-time constant —
 * the sun does not move in this scene — so it adds no uniforms and no per-frame
 * cost anywhere.
 */
import * as THREE from 'three';

/* ── the two species ───────────────────────────────────────────────────────
 *
 * Coefficients are quoted as multiples of `fogDensity`, so scene.fog stays the
 * one master knob it always was and whoever owns exposure later can still turn
 * the air up or down from main.js without coming in here.
 *
 * The Rayleigh triple is lambda^-4 at 615 / 535 / 465 nm normalised to blue.
 * The dust triple is close to neutral with a shallow slope — src/atmos.js makes
 * the same call for the same reason: coarse desert aerosol is large compared to
 * the wavelength and scatters nearly greyly. It is the *blue* excess in the
 * Rayleigh term that lifts and cools distant shadow, and the slight red excess
 * of transmission through dust that keeps a distant sunlit face warm rather
 * than letting it go the mauve that a neutral veil produces.
 */
const BETA_R = [0.327, 0.570, 1.000];   // x fogDensity, per metre, at any height
const R_GAIN = 0.30;
const BETA_M = [1.000, 0.962, 0.905];   // x fogDensity, per metre, at y = Y0
const M_GAIN = 0.68;

/* Scale height of the dust layer, metres, and the datum it is measured from.
 * 210 m is a settled evening boundary layer, and it is chosen against the
 * geometry: rock.js's buttes are 100 to 300 m tall, so a cap stands in air
 * holding about 60% of the dust its foot stands in and the same butte is two
 * distinct distances' worth of haze from top to bottom. Deeper than about 400 m
 * and the whole scene is inside one well-mixed slab again, which is the flat
 * veil with extra arithmetic. */
const H_DUST = 210;
const Y0 = 0;

/* Airlight, as multiples of FOG's *luminance*.
 *
 * Not of FOG itself, and the difference is the whole colour of the far field.
 * FOG is the mean radiance of the low sky, which at this sun elevation is a
 * warm yellow — B/G of 0.70. Using it directly as the airlight colour, which
 * the first version of this file did, paints every distant butte that same
 * yellow and they come out olive: khaki masses receding into khaki. Real
 * distance does not do that. It splits by azimuth, because a distant surface is
 * seen through air that is lit by whatever is shining on that air.
 *
 * So the source functions are separated by species and by what illuminates
 * them. Rayleigh takes a neutral illumination and gets its blue from the
 * lambda^-4 weighting of its own optical depth, which is where the blue of
 * distance actually comes from — not from a blue-painted fog. The dust takes
 * skylight away from the sun and the beam toward it. The result is blue-grey
 * distance in the shaded half of the compass and warm cream distance up the
 * wash, off one lobe and no tinting by hand.
 *
 * The levels are low against FOG and that is deliberate, for a reason the tone
 * curve forces. ACES with three's 0.6 prescale puts linear 0.45 at display 0.88
 * and linear 0.27 at 0.79 — the whole far half of the range is compressed into
 * a tenth of the output. An airlight anchored at FOG itself lands every distant
 * mass on that shoulder, where a 20% radiance step between two ridgelines
 * survives as one code value and the result is a flat white wall no matter how
 * carefully the depths are modelled. Which is precisely the failure the layering
 * is meant to fix, arrived at from the other direction.
 *
 * There is a physical reading of the same numbers and it is not a coincidence:
 * the air in the first kilometre of a canyon at this sun elevation is largely
 * in the walls' shadow, so its source function is a fraction of the free-sky
 * airlight that FOG measures. RAY is Rayleigh's, near-isotropic and lit by the
 * whole dome; AMB and FWD are the dust's, and they run it from 0.145 to 0.445
 * of the sky's luminance across the azimuth. */
/* Measured, not derived. The first pass at these was computed from the model
 * and landed the far field five times too dark, because the analytic estimate
 * assumed a rock albedo and a lit-face radiance that the scene does not have —
 * System 4's exposure and the beam's actual cosine at these faces put the far
 * buttes far lower than the arithmetic said. Numbers here are set from
 * tools/layers.mjs on b1_sun_gap, which reported the far ridge at V 0.38 and
 * B/G 1.01 — a cold grey silhouette where a mass a kilometre away at ten
 * degrees off a low sun should be a warm lift. Raising FWD against RAY moves
 * both: the forward lobe is the warm term and the Rayleigh term is the neutral
 * one whose only job is to make the *anti*-sun distance blue. */
const RAY = 0.16;
const AMB = 0.20;
const FWD = 0.78;
/* How far the forward lobe's colour goes toward the raw beam hue. The beam at
   air mass 6.86 is strongly orange and a haze that colour is a sepia filter;
   what the aureole actually looks like is a warm white, because most of what
   reaches the eye from it has been scattered more than once. */
const SUN_MIX = 0.62;
/* Skylight tint for the dust away from the sun, against a neutral of 1. Barely
   cool — the anti-sun sky at golden hour is not blue, it is grey with the day
   going out of it, and overdoing this is how a desert evening turns into an
   overcast morning. */
const SKY_TINT = [0.95, 0.98, 1.06];

/* Two Henyey-Greenstein lobes. One narrow one is physically the truth for the
 * aureole and visually useless on its own: at g = 0.8 the warm boost lives
 * inside twenty degrees of the disc and the rest of the up-wash view gets
 * nothing. Real haze toward a low sun is bright across a wide swathe because
 * multiple scattering has spread the lobe, so the broad term carries most of
 * the weight and the narrow one puts a core in it. */
const G_BROAD = 0.35, W_BROAD = 0.74;
const G_NARROW = 0.80, W_NARROW = 0.26;

function hg(g, c) {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
}

const f = (x, d = 6) => {
  const s = (+x).toFixed(d);
  return s.includes('.') ? s : s + '.0';
};
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

let installed = false;

/** What the patch actually baked, so a probe can prove it is not all zeros. */
export const AERIAL_DIAG = { installed: false };

/**
 * Replace three's fog chunks with the airlight model.
 *
 * Must be called before the first render, since the chunks are pulled in at
 * shader compile time, and after the lights exist, since it bakes the beam
 * direction and colour. main.js does both.
 *
 * @param {THREE.DirectionalLight} sun   the beam; direction and hue are read off it
 * @param {THREE.Color} fogColor         scene.fog.color, in linear scene radiance
 */
export function installAerial(sun, fogColor) {
  if (installed) return;
  installed = true;

  const src = THREE.ShaderChunk.fog_fragment;
  if (!src || !src.includes('fogColor')) {
    console.warn('aerial.js: fog chunk signature changed; aerial perspective skipped');
    return;
  }

  /* Direction *to* the sun, in world space, read from the light rather than
     from a constant in sky.js — System 4 is still moving it and this way the
     air follows wherever it lands. */
  const d = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();

  /* The beam's hue, normalised to unit maximum so it is a tint and not a level.
     The level is FOG's; mixing a level in here is how the last haze ended up
     brighter than every rock in the scene. */
  const c = sun.color;
  const peak = Math.max(c.r, c.g, c.b) || 1;
  const tint = [c.r / peak, c.g / peak, c.b / peak];

  const fog = [fogColor.r, fogColor.g, fogColor.b];
  const L = 0.2126 * fog[0] + 0.7152 * fog[1] + 0.0722 * fog[2];
  const tl = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2] || 1;
  const jRay = [L * RAY, L * RAY, L * RAY];
  const jSky = SKY_TINT.map((x) => L * x);
  const jSun = tint.map((x) => L * (1 + (x / tl - 1) * SUN_MIX));

  /* Normalise each lobe to its own forward value, so the pair spans 0..1 and
     AMB/FWD are readable as "airlight at the anti-sun" and "extra at the sun"
     rather than as arbitrary gains against a per-steradian phase function. */
  const nB = 1 / hg(G_BROAD, 1), nN = 1 / hg(G_NARROW, 1);

  Object.assign(AERIAL_DIAG, {
    installed: true,
    sun: [d.x, d.y, d.z],
    tint, fogL: L, jRay, jSky, jSun,
    betaR: BETA_R.map((x) => x * R_GAIN),
    betaM: BETA_M.map((x) => x * M_GAIN),
    H: H_DUST,
  });

  const PARS = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogW;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

  const vec3  AER_SUN   = ${v3([d.x, d.y, d.z])};
  const vec3  AER_TINT  = ${v3(tint)};
  const vec3  AER_JRAY  = ${v3(jRay)};
  const vec3  AER_JSKY  = ${v3(jSky)};
  const vec3  AER_JSUN  = ${v3(jSun)};
  const vec3  AER_BETAR = ${v3(BETA_R.map((x) => x * R_GAIN))};
  const vec3  AER_BETAM = ${v3(BETA_M.map((x) => x * M_GAIN))};
  const float AER_H     = ${f(H_DUST, 2)};
  const float AER_Y0    = ${f(Y0, 2)};
  const float AER_AMB   = ${f(AMB)};
  const float AER_FWD   = ${f(FWD)};

  float aerHG(float g, float c) {
    float g2 = g * g;
    return (1.0 - g2) / (12.56637061 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5));
  }

  /* Path integral of exp(-(y - Y0)/H) from the camera to the fragment, in
     metres of equivalent sea-level path. Written as the ground-level path
     length times a shape factor so the small-|dy| limit is exact rather than
     a guarded division: (1 - e^-k)/k -> 1 - k/2 as k -> 0, and single
     precision loses the difference of the two exponentials long before the
     series does. */
  float aerColumn(float y0, float y1, float dist) {
    float k = (y1 - y0) / AER_H;
    float shape = abs(k) < 1e-3 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
    return dist * exp(-(y0 - AER_Y0) / AER_H) * shape;
  }

  vec3 aerialPerspective(vec3 color, vec3 world) {
    vec3 ray = world - cameraPosition;
    float dist = length(ray);
    if (dist < 1e-3) return color;
    vec3 dir = ray / dist;

    #ifdef FOG_EXP2
      float dens = fogDensity;
    #else
      float dens = 1.0 / max(1.0, fogFar - fogNear);
    #endif

    /* Rayleigh is 8 km deep against a 2 km scene, so its own stratification is
       under three percent across the frame and is not worth an exponential;
       the dust layer is the one that is shallow enough to see. */
    vec3 tauR = AER_BETAR * (dens * dist);
    vec3 tauM = AER_BETAM * (dens * aerColumn(cameraPosition.y, world.y, dist));
    vec3 tau = tauR + tauM;
    vec3 T = exp(-tau);

    float ca = dot(dir, AER_SUN);
    float lobe = ${f(W_BROAD)} * aerHG(${f(G_BROAD)}, ca) * ${f(nB)}
               + ${f(W_NARROW)} * aerHG(${f(G_NARROW)}, ca) * ${f(nN)};

    /* Rayleigh's phase is nearly flat and its airlight is overwhelmingly
       multiply-scattered, so it takes a neutral illumination; its colour
       arrives through the lambda^-4 weighting of tauR below. The dust carries
       all of the directionality, and its colour is the colour of whatever is
       lighting it — skylight behind you, the beam ahead. */
    vec3 jR = AER_JRAY;
    vec3 jM = AER_JSKY * AER_AMB + AER_JSUN * (AER_FWD * lobe);

    /* Weight the two source functions by the optical depth each species
       actually contributes in this channel: near the ground the dust wins and
       the air is warm, on a ray that climbs out of the layer the Rayleigh term
       is what is left and distant high rock goes blue. */
    vec3 J = (tauR * jR + tauM * jM) / max(tau, vec3(1e-6));

    return color * T + J * (1.0 - T);
  }
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = PARS;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = aerialPerspective( gl_FragColor.rgb, vFogW );
#endif`;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogW;
#endif`;

  /* World position without a second transform. mvPosition is the only point
     every material — instanced, skinned, morphed, displaced in a patch — agrees
     on, and the view matrix is rigid, so its inverse rotation is the transpose:
     `vec4(v, 0.0) * viewMatrix` is `Rt * v`, and the camera position closes it.
     Going back to `modelMatrix * transformed` instead would silently drop the
     instance matrix and put every pebble's haze at the origin. */
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogW = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
}

/** The model on the CPU, for tools and for sanity-checking the shader. */
export function aerialModel(sun, fogColor, density = 0.0019) {
  const d = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
  const c = sun.color;
  const peak = Math.max(c.r, c.g, c.b) || 1;
  const tint = [c.r / peak, c.g / peak, c.b / peak];
  const fog = [fogColor.r, fogColor.g, fogColor.b];
  const L = 0.2126 * fog[0] + 0.7152 * fog[1] + 0.0722 * fog[2];
  const tl = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2] || 1;
  const jRay = [L * RAY, L * RAY, L * RAY];
  const jSky = SKY_TINT.map((x) => L * x);
  const jSun = tint.map((x) => L * (1 + (x / tl - 1) * SUN_MIX));
  const nB = 1 / hg(G_BROAD, 1), nN = 1 / hg(G_NARROW, 1);
  return function apply(color, cam, world) {
    const rx = world[0] - cam[0], ry = world[1] - cam[1], rz = world[2] - cam[2];
    const dist = Math.hypot(rx, ry, rz);
    if (dist < 1e-3) return color.slice();
    const k = (world[1] - cam[1]) / H_DUST;
    const shape = Math.abs(k) < 1e-3 ? 1 - 0.5 * k : (1 - Math.exp(-k)) / k;
    const col = dist * Math.exp(-(cam[1] - Y0) / H_DUST) * shape;
    const ca = (rx * d.x + ry * d.y + rz * d.z) / dist;
    const lobe = W_BROAD * hg(G_BROAD, ca) * nB + W_NARROW * hg(G_NARROW, ca) * nN;
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const tR = BETA_R[i] * R_GAIN * density * dist;
      const tM = BETA_M[i] * M_GAIN * density * col;
      const t = tR + tM, T = Math.exp(-t);
      const jM = jSky[i] * AMB + jSun[i] * FWD * lobe;
      const J = (tR * jRay[i] + tM * jM) / Math.max(1e-6, t);
      out[i] = color[i] * T + J * (1 - T);
    }
    return out;
  };
}
