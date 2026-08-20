/* Sedona Sunset — System 1: terrain and the wash path.
 *
 * Boots the scene, wires first-person walking, and exposes the `window.__game`
 * capture surface that CONTRACT.md specifies.
 *
 * Determinism note, because it is the thing that is easy to break: the render
 * loop has to be a fixed point when no key is held. Velocity snaps to zero
 * below a threshold rather than decaying forever, head bob is reset to phase
 * zero at rest, the ground clamp is absolute rather than a spring, and the
 * shadow camera is snapped to a quantised grid derived from the player
 * position. So two `walkTo(46)` calls a second apart produce the same pixels.
 */
import * as THREE from 'three';
import { WashPath } from './path.js';
import { Terrain, buildTerrainMesh, makeTerrainMaterial } from './terrain.js';
import { buildScatter } from './scatter.js';
import { buildWalls, buildDistantButtes, buildTalus, makeRockMaterial } from './rock.js';
import { buildSky, buildLights, SUN_DIR, FOG, SHADOW_HALF } from './sky.js';
import {
  makeDirt, makeSand, makeRock, makeClastSurface, makeMacro, makeVariance, makeCracks,
  setAnisotropy,
} from './textures.js';

const EYE = 1.65;
const DEG = Math.PI / 180;

/* ── renderer ──────────────────────────────────────────────────────────── */

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,   // required by the harness capture path
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/* Exposed for the midtones, not the floor. The scene's real dynamic range at
   two degrees of solar elevation is about twenty to one between a sun-facing
   rock face and level ground, so an exposure that lifts the wash floor to a
   comfortable middle grey flattens everything else into pale cream. A
   photographer would let the floor sit dark and keep the walls.
   Trimmed, but only a little, and the measurement is the reason it is only a
   little. Five of the eight frames had their floor sitting at value 0.76 to 0.87
   where the tone curve's shoulder has no room left for chroma, so exposure was the
   obvious suspect. Inverting the curve on those exact pixels says otherwise: two
   thirds of a stop down buys six hundredths of saturation and costs the lit rock
   face a third of its value. The washed-out regions were washed out because they
   were pale sand, and the pigment is fixed in textures.js. This much is worth
   having for the highlight roll-off; more would be paying for nothing. */
renderer.toneMappingExposure = 0.74;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG.getHex(), 0.0019);

const camera = new THREE.PerspectiveCamera(
  58, window.innerWidth / window.innerHeight, 0.06, 6000);
camera.rotation.order = 'YXZ';

/* ── content ───────────────────────────────────────────────────────────── */

const tex = {
  dirt: makeDirt(1024),
  sand: makeSand(512),
  rock: makeRock(1024),
  clast: makeClastSurface(512),
  macro: makeMacro(512),
  variance: makeVariance(512),
  crack: makeCracks(512),
};

const path = new WashPath();
const terrain = new Terrain(path);
const terrainMesh = buildTerrainMesh(terrain, makeTerrainMaterial(tex));
scene.add(terrainMesh);

/* System 2. The rock is not part of the height field — see rock.js for why a
   height field cannot draw a cliff — so it arrives as its own meshes: two wall
   curtains, a set of discrete distant buttes for the aerial perspective to layer,
   and the coarse talus at the junction between the two. */
const rockMat = makeRockMaterial(tex);
const rocks = [
  ...buildWalls(path, terrain, rockMat),
  ...buildDistantButtes(terrain, rockMat),
  ...buildTalus(path, terrain, rockMat),
];
for (const m of rocks) scene.add(m);

const clasts = buildScatter(terrain, tex);
for (const m of clasts) scene.add(m);

/* The clast material needs the viewport height to turn an instance's world radius
   into a projected pixel radius, which is what drives its level of detail. */
const clastU = clasts[0].material.userData.uniforms;
function syncViewport() {
  clastU.uVpH.value = renderer.domElement.height || window.innerHeight;
}
syncViewport();

const sky = buildSky();
sky.scale.setScalar(5000);
scene.add(sky);

const { sun, hemi, glow, bounce } = buildLights();
scene.add(sun, sun.target, hemi, glow, bounce);

/* ── player ────────────────────────────────────────────────────────────── */

const player = {
  x: 0, y: 0, z: 0,
  vx: 0, vz: 0,
  yaw: 0,        // absolute world yaw, radians; 0 = looking straight down -Z
  pitch: 0,
  bob: 0,
};

const _q = {};

function groundAt(x, z) {
  return terrain.heightAtQ(x, z, path.atZ(z, _q));
}

/** Distance walked, recovered from world position — the inverse of walkTo. */
function currentS() {
  return path.atZ(player.z, _q).s;
}

function placeAt(d) {
  const p = path.posAt(d);
  player.x = p.x;
  player.z = p.z;
  player.vx = 0; player.vz = 0; player.bob = 0;
  player.y = groundAt(player.x, player.z);
}

function syncCamera() {
  camera.position.set(player.x, player.y + EYE + player.bob, player.z);
  camera.rotation.set(player.pitch, -player.yaw, 0, 'YXZ');
}

/* Shadow camera rides with the player, quantised so the map does not shimmer
   and, more importantly, so the same player position always yields the same
   shadow texels. The step is four shadow texels, small enough that walking does
   not visibly pop and coarse enough to stay exactly reproducible. */
const SHADOW_Q = (SHADOW_HALF * 2) / 1024;
function syncShadow() {
  const q = (v) => Math.round(v / SHADOW_Q) * SHADOW_Q;
  const qx = q(player.x), qz = q(player.z), qy = q(player.y);
  sun.target.position.set(qx, qy, qz);
  sun.position.set(qx + SUN_DIR.x * 600, qy + SUN_DIR.y * 600, qz + SUN_DIR.z * 600);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}

placeAt(0);
player.yaw = path.headingAt(0);
syncCamera();
syncShadow();

/* ── first-person controls (human only; never touched by walkTo) ───────── */

const keys = Object.create(null);
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => canvas.requestPointerLock());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  // syncCamera applies yaw negated (rotation.y = -yaw), so mouse-right has to
  // increase yaw to turn the view right.
  player.yaw += e.movementX * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0022));
});
addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncViewport();
  maskRT = null;
});

function step(dt) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const speed = (keys.ShiftLeft || keys.ShiftRight) ? 3.4 : 1.55;

  let ax = 0, az = 0;
  if (f || r) {
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    // forward = (sin yaw, -cos yaw); right = (cos yaw, sin yaw)
    ax = s * f + c * r;
    az = -c * f + s * r;
    const l = Math.hypot(ax, az) || 1;
    ax = ax / l * speed; az = az / l * speed;
  }

  /* Critically damped approach to the target velocity, then an absolute snap
     to zero — a decaying exponential never actually reaches rest, and a
     never-resting player breaks pixel-identical recapture. */
  const k = 1 - Math.exp(-12 * dt);
  player.vx += (ax - player.vx) * k;
  player.vz += (az - player.vz) * k;
  if (!f && !r && Math.hypot(player.vx, player.vz) < 0.004) { player.vx = 0; player.vz = 0; }

  player.x += player.vx * dt;
  player.z += player.vz * dt;
  player.y = groundAt(player.x, player.z);

  const sp = Math.hypot(player.vx, player.vz);
  if (sp < 0.004) player.bob = 0;
  else player.bob = Math.sin((player.bob0 = (player.bob0 || 0) + dt * sp * 5.4)) * 0.032;
}

/* ── frame probe ───────────────────────────────────────────────────────── */

let maskRT = null;
/* renderer.info is reset per render() call, so info() has to know whether the
   last thing drawn was a real frame or the 1/8-scale mask pass. */
let lastRenderWasMask = false;
const maskMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });

/**
 * Split the frame into sky and ground without a depth readback: re-render at
 * 1/8 scale with everything forced flat black on a white background, so any
 * white texel is a texel the geometry did not cover.
 */
function skyMask(w, h) {
  const mw = Math.max(8, w >> 3), mh = Math.max(8, h >> 3);
  if (!maskRT || maskRT.width !== mw || maskRT.height !== mh) {
    if (maskRT) maskRT.dispose();
    maskRT = new THREE.WebGLRenderTarget(mw, mh, { depthBuffer: true });
  }
  const prevBg = scene.background, prevFog = scene.fog, prevSky = sky.visible;
  scene.background = new THREE.Color(0xffffff);
  scene.fog = null;
  sky.visible = false;
  scene.overrideMaterial = maskMat;
  renderer.setRenderTarget(maskRT);
  renderer.render(scene, camera);
  const buf = new Uint8Array(mw * mh * 4);
  renderer.readRenderTargetPixels(maskRT, 0, 0, mw, mh, buf);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  scene.background = prevBg;
  scene.fog = prevFog;
  sky.visible = prevSky;
  lastRenderWasMask = true;
  return { buf, mw, mh };
}

function probe() {
  const gl = renderer.getContext();
  const w = renderer.domElement.width, h = renderer.domElement.height;

  renderOnce();
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const { buf: mask, mw, mh } = skyMask(w, h);

  const hist = new Uint32Array(256);
  let skySum = 0, skyN = 0, gndSum = 0, gndN = 0, max = 0;
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, (y * mh / h) | 0);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) | 0;
      hist[l]++;
      if (l > max) max = l;
      const mx = Math.min(mw - 1, (x * mw / w) | 0);
      if (mask[(my * mw + mx) * 4] > 127) { skySum += l; skyN++; }
      else { gndSum += l; gndN++; }
    }
  }

  const total = w * h;
  const pct = (p) => {
    let acc = 0, want = total * p;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= want) return i; }
    return 255;
  };
  return {
    median: pct(0.5), p90: pct(0.9), p99: pct(0.99), max,
    skyAvg: skyN ? +(skySum / skyN).toFixed(1) : 0,
    groundAvg: gndN ? +(gndSum / gndN).toFixed(1) : 0,
  };
}

/* ── loop ──────────────────────────────────────────────────────────────── */

let paused = true, running = false, last = 0, fpsSmoothed = 0;

function renderOnce() {
  syncCamera();
  syncShadow();
  camera.updateMatrixWorld();
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  lastRenderWasMask = false;
}

function frame(t) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (paused) { last = t; return; }
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  step(dt);
  renderOnce();
  const inst = 1 / Math.max(1e-4, dt);
  fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.9 + inst * 0.1 : inst;
  api.fps = fpsSmoothed;
}

/* ── capture API (CONTRACT.md) ─────────────────────────────────────────── */

const api = {
  renderer,
  fps: 0,
  begin() {
    if (running) return;
    running = true; paused = false; last = performance.now();
    requestAnimationFrame(frame);
  },
  setPaused(b) { paused = !!b; },
  renderOnce,
  walkTo(d) {
    placeAt(+d || 0);
    player.bob0 = 0;
    syncCamera();
    syncShadow();
  },
  lookAt(yawDeg, pitchDeg) {
    player.yaw = path.headingAt(currentS()) + (+yawDeg || 0) * DEG;
    player.pitch = (+pitchDeg || 0) * DEG;
    syncCamera();
  },
  info() {
    if (lastRenderWasMask) renderOnce();
    const i = renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      textures: i.memory.textures,
      programs: i.programs ? i.programs.length : 0,
    };
  },
  probe,
  // handy while developing; not part of the contract
  _scene: scene, _camera: camera, _terrain: terrain, _path: path,
  _instances: clasts.reduce((n, m) => n + m.count, 0),
};

renderOnce();   // compile everything before the harness starts timing
window.__game = api;

/* The harness drives the loop itself, via begin() after it has waited for
   __game to appear. A human opening the page has nothing to call it for them,
   so without this the scene boots paused: a black window that ignores every
   key. begin() guards on `running`, so the harness calling it later is a
   no-op and capture stays deterministic. */
api.begin();
