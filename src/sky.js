/* PROVISIONAL — System 4 (Lighting and sun) replaces all of this.
 *
 * The terrain cannot be judged in a vacuum: red oxide dirt only looks like red
 * oxide dirt under low warm light with a warm bounce. So there is just enough
 * sky and sun here to light the ground honestly and give the horizon something
 * to sit against. It is a vertical gradient with a sun disc — no scattering
 * model, no aerial perspective, no atmosphere. Do not build on it.
 */
import * as THREE from 'three';

/* Sun sits low and up-wash: elevation ~3.4 degrees, a couple of degrees off
   the mean axis of the path so it is inside the corridor but not dead centre. */
export const SUN_AZ = 0.055;
export const SUN_EL = 0.125;
export const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZ), Math.sin(SUN_EL), -Math.cos(SUN_AZ)).normalize();

export const HORIZON = new THREE.Color(0.92, 0.52, 0.28);
export const FOG = new THREE.Color(0.72, 0.44, 0.30);

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

  vec3 sky = mix(uHorizon, uMid, smoothstep(0.0, 0.16, h));
  sky = mix(sky, uZenith, smoothstep(0.10, 0.62, h));
  sky = mix(uGround, sky, smoothstep(-0.10, 0.005, h));

  float ca = max(dot(d, uSun), 0.0);
  /* broad warm glow around the sun, then the disc itself */
  sky += uHorizon * pow(ca, 14.0) * 0.45;
  sky += vec3(1.60, 0.86, 0.36) * pow(ca, 120.0) * 1.8;
  sky += vec3(1.60, 1.10, 0.70) * smoothstep(0.99965, 0.99990, ca) * 9.0;

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
      uHorizon: { value: new THREE.Color(1.85, 0.86, 0.34) },
      uMid: { value: new THREE.Color(0.78, 0.42, 0.34) },
      uZenith: { value: new THREE.Color(0.13, 0.20, 0.44) },
      uGround: { value: new THREE.Color(0.36, 0.20, 0.15) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/** PROVISIONAL golden-hour key + bounce. Replaced wholesale by System 4. */
export function buildLights() {
  const sun = new THREE.DirectionalLight(0xffb26a, 7.2);
  sun.position.copy(SUN_DIR).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -95; c.right = 95; c.top = 95; c.bottom = -95;
  c.near = 50; c.far = 1100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 1.4;

  /* Sky fill plus the warm bounce off the dirt. At this sun angle the bounce
     is most of what fills shadow, and it is red, which is why Sedona shadows
     read violet-brown rather than blue. */
  const hemi = new THREE.HemisphereLight(0x9b93c0, 0xb35d34, 1.5);

  /* Weak second directional from the opposite side, standing in for the wash
     of light off the far canyon wall. Casts nothing. */
  const bounce = new THREE.DirectionalLight(0xdd8a58, 1.25);
  bounce.position.set(-SUN_DIR.x * 300, 140, 320);

  return { sun, hemi, bounce };
}
