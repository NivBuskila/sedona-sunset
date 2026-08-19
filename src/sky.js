/* PROVISIONAL — System 4 (Lighting and sun) replaces all of this.
 *
 * The terrain cannot be judged in a vacuum: red oxide dirt only looks like red
 * oxide dirt under low warm light, and loose stone only reads as stone if it
 * casts a shadow. So there is just enough sky and sun here to light the ground
 * honestly and give the horizon something to sit against. It is a vertical
 * gradient with a sun disc — no scattering model, no aerial perspective, no
 * atmosphere. Do not build on it.
 *
 * Two decisions here are doing real work for the terrain and should survive in
 * spirit into System 4:
 *
 * The sun is genuinely low — about two and a half degrees. That is what makes
 * every pebble throw a shadow ten to twenty times its own diameter, and those
 * raking shadow fingers are the difference between a floor strewn with stones
 * and a floor with bumps painted on it.
 *
 * The fill is blue-violet, not warm. At golden hour the shadowed side of a
 * Sedona wall is lit almost entirely by the sky dome, which is cool, and the
 * warm/cool split between lit and shadowed is most of what makes those
 * photographs work. A warm key over warm ambient collapses the whole palette
 * into one hue and is the clearest sign of a scene lit by one directional light.
 */
import * as THREE from 'three';

/* Elevation ~7.7 degrees, a couple of degrees off the mean axis of the path so
   the sun sits inside the corridor but not dead centre.
   Two and a half degrees was tried first and is much worse. On a smooth surface
   the width of the band where N·L crosses zero scales with the sun's height, and
   below about five degrees that band is thinner than a pixel: every gentle swell
   in the terrain resolves into a razor-thin bright crest with a long shadow
   behind it, and a slope covered in those reads as scratched metal rather than
   as raking light. Eight degrees still throws a shadow the better part of ten
   times the height of what casts it, which is what the low sun was for. */
export const SUN_AZ = 0.055;
export const SUN_EL = 0.135;
export const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZ), Math.sin(SUN_EL), -Math.cos(SUN_AZ)).normalize();

export const HORIZON = new THREE.Color(0.92, 0.52, 0.28);
export const FOG = new THREE.Color(0.66, 0.42, 0.34);

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
uniform vec3 uSun;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uGround;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  /* The cool band matters as much as the warm one: it is the source of the
     violet fill, and if the whole dome is orange the shadows have nowhere to
     get their colour from. */
  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.10, h));
  sky = mix(sky, uZenith, smoothstep(0.06, 0.52, h));
  sky = mix(uGround, sky, smoothstep(-0.10, 0.005, h));

  /* Away from the sun the horizon cools off — the anti-solar sky at sunset is
     a dusty blue-violet, and it is what a wall in shadow is actually lit by. */
  float az = smoothstep(0.35, -0.55, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))));
  sky = mix(sky, sky * vec3(0.62, 0.72, 1.20), az * (1.0 - smoothstep(0.05, 0.45, h)) * 0.85);

  float ca = max(dot(d, uSun), 0.0);
  sky += uHorizon * pow(ca, 11.0) * 0.55;
  sky += vec3(1.70, 0.88, 0.34) * pow(ca, 110.0) * 2.0;
  sky += vec3(1.70, 1.16, 0.74) * smoothstep(0.99965, 0.99990, ca) * 9.0;

  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uHorizon: { value: new THREE.Color(1.45, 0.66, 0.28) },
      uMid: { value: new THREE.Color(0.52, 0.31, 0.36) },
      uZenith: { value: new THREE.Color(0.075, 0.105, 0.30) },
      uGround: { value: new THREE.Color(0.22, 0.13, 0.13) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/* The shadow camera is deliberately small and the map deliberately large: at
   96 m across a 4096 map that is 23 mm per texel, which is what it takes for a
   50 mm pebble to cast anything at all. A 190 m box would put four pebbles in
   one texel and the whole gravel field would go back to reading as bumps. The
   trade is that terrain beyond about fifty metres off the corridor axis stops
   self-shadowing, which at this sun angle is hidden inside the haze anyway. */
export const SHADOW_HALF = 48;

/** PROVISIONAL golden-hour key + sky fill. Replaced wholesale by System 4. */
export function buildLights() {
  /* The key has to dominate. At eight degrees a level surface only receives about
     an eighth of the sun's normal irradiance, so a key sized to look sensible
     on paper loses to the sky dome and the whole frame goes milky — lit ground
     and shadowed ground end up within a third of a stop of each other, every
     surface picks up the dome's lilac, and the red washes out to pale magenta.
     Sized so lit ground sits about three times shadowed ground instead. */
  const sun = new THREE.DirectionalLight(0xffa652, 30.0);
  sun.position.copy(SUN_DIR).multiplyScalar(600);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const c = sun.shadow.camera;
  c.left = -SHADOW_HALF; c.right = SHADOW_HALF;
  c.top = SHADOW_HALF; c.bottom = -SHADOW_HALF;
  /* The light is nearly horizontal, so the depth range has to span the whole
     corridor along the sun axis rather than just the visible box. */
  c.near = 180; c.far = 1150;
  sun.shadow.bias = -0.00016;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 1.0;

  /* The dome is the main source now, and it is doing double duty: warm-lilac
     above because a sunset sky is orange near the horizon and violet higher up,
     and a hot red bounce below off the dirt itself. Vertical faces turned away
     from the sun pick up the lilac, which is where the warm/cool contrast comes
     from — without it the shadow side is just a darker copy of the lit side. */
  /* High enough that a shadow is a colour rather than a hole — a cut bank's
     undershadow at three percent of the lit ground is a crushed black patch, and
     crushed blacks read as a rendering fault long before they read as contrast —
     but no higher. The fill's job is to put violet *into the shadows*, and a fill
     strong enough to be visible on the lit side puts it everywhere instead. */
  const hemi = new THREE.HemisphereLight(0xb99ab6, 0xa04f28, 1.45);

  /* The bright sky immediately around the sun is a large, soft source in its
     own right. Casts nothing. */
  const glow = new THREE.DirectionalLight(0xffb078, 1.15);
  glow.position.set(Math.sin(SUN_AZ) * 300, 78, -Math.cos(SUN_AZ) * 300);

  /* Wash of light off the far canyon wall, from behind. Cool, because that wall
     is itself mostly sky-lit at this hour. */
  /* Carries most of the violet now that the dome has been pulled back. It only
     reaches faces turned away from the sun, which is exactly where the cool half
     of the warm/cool split is supposed to land. */
  const bounce = new THREE.DirectionalLight(0x9a86c4, 1.15);
  bounce.position.set(-SUN_DIR.x * 300, 130, 320);

  return { sun, hemi, glow, bounce };
}
