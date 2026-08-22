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
import { buildCorridor, confine } from './corridor.js';
import { Terrain, buildTerrainMesh, makeTerrainMaterial, syncWind, applyScour } from './terrain.js';
import { buildScatter } from './scatter.js';
import { buildWalls, buildDistantButtes, buildTalus, makeRockMaterial } from './rock.js';
import { buildFarRidges } from './farridge.js';
import { buildSky, buildLights, makeShadowRig, FOG, EXPOSURE } from './sky.js';
import { buildJuniper } from './juniper.js';
import { buildVegetation } from './vegetation.js';
import { setPlantAnisotropy } from './plantex.js';
import {
  makeDirt, makeSand, makeRock, makeGrit, makeClastSurface, makeMacro, makeVariance,
  makeCracks, setAnisotropy,
} from './textures.js';
import { createAudio } from './audio.js';
import { installAerial } from './aerial.js';
import { buildAtmosphere } from './atmosphere.js';
import { createPerf } from './perf.js';
import { createPost } from './post.js';

const EYE = 1.65;
const DEG = Math.PI / 180;

/* ── the loading screen ────────────────────────────────────────────────────
 *
 * Cold boot is forty-odd seconds — every texel of every texture in the scene is
 * written in JavaScript before there is anything to show — and until this
 * existed the whole of it was a black, unresponsive tab. Six measured loads ran
 * 36 to 46 s with the main thread blocked solid; screenshot attempts at 5, 10,
 * 15, 20, 25, 30 and 35 seconds all failed because the renderer could not
 * answer. On a slower machine Chrome offers to kill the page.
 *
 * The message has to be painted *and the paint has to have happened* before any
 * generation starts, which is the whole reason this is a prelude with an await
 * after it rather than a line at the top of the file. A message drawn into a
 * canvas and then followed immediately by forty seconds of synchronous work is
 * worth exactly nothing: the compositor never gets a turn, and the user sees the
 * same black tab they saw before.
 *
 * It is its own 2D canvas because a canvas that has handed out a 2D context can
 * never hand out a WebGL one, and it is removed from the document the instant
 * the first real frame is on screen — `document.body` in the shipped frame is
 * `[SCRIPT, CANVAS]` and CONTRACT.md's no-HUD rule keeps it that way.
 */
const loading = (() => {
  const c = document.createElement('canvas');
  c.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:2';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  let w = 0, h = 0;
  /* The boot log. `painted` is the one that matters and it is the reason
     `yieldPaint` distinguishes how it resolved: rAF firing means the browser
     produced a frame, so a `painted` timestamp is proof the message was on
     screen — which a screenshot cannot give, because the request to take one
     goes to the same blocked main thread and simply times out. `stalls` is the
     rest of the story, the longest run of work between two yields. */
  const log = { t0: performance.now(), painted: null, phases: [], stalls: 0 };
  let mark = log.t0;

  function paint(note) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(window.innerWidth * dpr));
    const ch = Math.max(1, Math.round(window.innerHeight * dpr));
    if (cw !== w || ch !== h) { c.width = w = cw; c.height = h = ch; }
    /* Dusk, roughly where the scene it is standing in front of ends up, so the
       first real frame arrives as a change of subject rather than a flash. */
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1a1013');
    sky.addColorStop(0.62, '#3a1f18');
    sky.addColorStop(1, '#120b0a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const px = Math.round(15 * dpr);
    g.font = `${px}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#d8b49a';
    g.fillText(note, w / 2, h / 2);
  }

  /* rAF fires before the paint, so the resolve is deferred one further task to
     land after it. The wall-clock fallback is there because a backgrounded tab
     throttles rAF to nothing and a boot that waits on it would never finish —
     which would take every capture in the repo with it. */
  const yieldPaint = () => new Promise((res) => {
    let done = false;
    const fin = (via) => {
      if (done) return;
      done = true;
      if (via === 'raf' && log.painted === null) log.painted = performance.now() - log.t0;
      res();
    };
    requestAnimationFrame(() => setTimeout(() => fin('raf'), 0));
    setTimeout(() => fin('timer'), 250);
  });

  return {
    log,
    async note(text) {
      const now = performance.now();
      if (log.phases.length) {
        const ms = now - mark;
        log.phases[log.phases.length - 1].ms = Math.round(ms);
        if (ms > log.stalls) log.stalls = Math.round(ms);
      }
      log.phases.push({ note: text, ms: 0 });
      paint(text);
      await yieldPaint();
      mark = performance.now();
    },
    done() {
      log.phases[log.phases.length - 1].ms = Math.round(performance.now() - mark);
      log.total = Math.round(performance.now() - log.t0);
      c.remove();
    },
  };
})();

/* "About forty seconds" and not "about a minute", because the README says forty
   and the two disagreeing is the sort of thing that gets noticed and then
   arbitrated by guesswork. Forty is the measured one: six page loads today, all
   of them after the texture phase was split into seven, ran 39 to 44 seconds
   from navigation to `__game`. If this figure is ever revised, revise it from a
   measurement and change both places. */
await loading.note('Sedona Sunset — drawing the desert. About forty seconds.');

/* ── renderer ──────────────────────────────────────────────────────────── */

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({
  canvas,
  /* Off, and nothing is given up by it while System 5's shimmer pass owns the
     frame. The scene is drawn into that pass's own offscreen target, which
     carries four samples of its own; the canvas then receives exactly one
     full-screen quad covering every pixel. Multisampling a primitive with no
     interior edges produces the same pixels it would without — every sample in
     a pixel holds the same value — so this was buying an identical picture in
     exchange for a multisampled RGBA8 backbuffer allocated at the window size
     and resolved every single frame.
     The one setting where it mattered is the bottom of System 7's quality
     ladder, which switches the shimmer pass off entirely; a tier that gives up
     the heat haze to stay above thirty is not a tier that wants to be paying
     for multisampling either. */
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,   // required by the harness capture path
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/* System 4 owns this now, and derives it: the lights carry real irradiances, so
   the exposure is the one number that turns them into pixels and it is chosen to
   land a sunlit rock face in the 0.59-0.73 that reference photographs sit at.
   See EXPOSURE in sky.js. */
renderer.toneMappingExposure = EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* Off, and driven by syncShadow instead. The cascade cameras are snapped to a
   texel grid, so their maps are a function of the *quantised* player position
   and are bit-identical between two frames that quantise the same — which is
   most frames while walking and all frames while standing. Redrawing them anyway
   costs two full passes over every caster in the scene, and the frame probe in
   particular used to pay for three sets of them per capture: one for the frame,
   one for the readback render and one for the sky mask, which does not even
   sample a shadow. */
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
/* FOG is scene-linear radiance and its brightest channel is 1.0923, so routing it
   through getHex() clamped red and green to 1.0 and handed src/aerial.js a colour
   6.7% dark and 46% desaturated — 0.1615 of saturation down to 0.0869. Only the
   luminance of it survives aerial's `sources()`, so the chroma loss costs nothing
   in practice and the level loss is the whole of it, but there is no reason to
   quantise a float to eight bits on the way between two systems that both want
   the float. Copy it instead. */
scene.fog = new THREE.FogExp2(0x000000, 0.0019);
scene.fog.color.copy(FOG);

/* Far plane 9000 rather than 6000: System 2's far ridgelines reach 7.3 km, and
   the aerial ladder they exist to feed is a statement about the *ratio* of the
   nearest and furthest masses, so clipping the back of it defeats the purpose.
   Nothing else in the scene notices — depth precision at a 0.06 near plane is
   set by the near plane, and the only geometry now living between 6 and 9 km is
   a single pale rim with nothing behind it to fight. */
const camera = new THREE.PerspectiveCamera(
  58, window.innerWidth / window.innerHeight, 0.06, 9000);
camera.rotation.order = 'YXZ';

/* ── content ───────────────────────────────────────────────────────────────
 *
 * The awaits between the phases below are the loading screen's whole reason for
 * being able to say anything after the first line. Each one is a single frame's
 * yield — a few tens of milliseconds against forty seconds of work — and what
 * it buys is a tab that repaints and answers the compositor between phases
 * instead of one that Chrome offers to kill. Nothing about the order changes.
 *
 * Deliberately *not* an attempt to move generation into workers. Every one of
 * these hands back a live THREE object built against this context.
 */

/* Split one texture per yield rather than built as one object literal, because
   this block is the longest stall in the boot by a wide margin and an
   unbroken one is a tab that cannot answer for twenty seconds. The two 1024s
   are most of it. Same calls, same order, same textures. */
const tex = {};
await loading.note('Drawing the wash floor…');
tex.dirt = makeDirt(1024);
await loading.note('Drawing sand…');
tex.sand = makeSand(512);
await loading.note('Drawing sandstone…');
tex.rock = makeRock(1024);
await loading.note('Drawing grit…');
/* The footprint-locked detail layer. Small, because it carries no low
   frequencies — see makeGrit for why that is the property that lets rock.js
   read it at whatever scale a pixel happens to be. */
tex.grit = makeGrit(256);
await loading.note('Drawing gravel…');
tex.clast = makeClastSurface(512);
await loading.note('Weathering it…');
tex.macro = makeMacro(512);
tex.variance = makeVariance(512);
tex.crack = makeCracks(512);

await loading.note('Cutting the wash…');

const path = new WashPath();
const terrain = new Terrain(path);
const terrainMesh = buildTerrainMesh(terrain, makeTerrainMaterial(tex));
scene.add(terrainMesh);

await loading.note('Raising the canyon walls…');

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

/* System 2's far band: four receding ridgelines from 2.3 to 7.3 km, which is
   the geometry src/aerial.js asks for in GEOMETRY_NEEDED — the scene's deepest
   sightline was 1450 m, and over that baseline the only way to get a legible
   depth ladder was air thick enough to contradict a blue zenith. Its own group,
   not in `rocks`, because it carries no rock material and the vegetation
   scatter walks that list looking for cliffs to grow under. */
await loading.note('Setting the far country…');

const farRidges = buildFarRidges(terrain, path);
scene.add(farRidges);

await loading.note('Scattering the stones…');

const clasts = buildScatter(terrain, tex);
/* The boulders dig hollows the mesh was built too early to know about. */
applyScour(terrainMesh, terrain);
for (const m of clasts) scene.add(m);

/* System 3: the hero juniper, and the sparse pinyon-juniper scatter that says
   this is 4,500 ft in Arizona rather than an empty desert. */
await loading.note('Growing the juniper…');

setPlantAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
for (const m of buildJuniper(terrain, tex)) scene.add(m);
for (const m of buildVegetation(path, terrain, rocks)) scene.add(m);

/* The clast material needs the viewport height to turn an instance's world radius
   into a projected pixel radius, which is what drives its level of detail. */
const clastU = clasts[0].material.userData.uniforms;
function syncViewport() {
  clastU.uVpH.value = renderer.domElement.height || window.innerHeight;
}
syncViewport();

await loading.note('Lighting the sky…');

const sky = buildSky();
sky.scale.setScalar(5000);
scene.add(sky);

/* Order matters: the cascade patch in sky.js reads shadow index 1, and the
   index is assigned in the order the scene is traversed. sunNear second. */
const { sun, sunNear, probe: skyProbe } = buildLights();
scene.add(sun, sun.target, sunNear, sunNear.target, skyProbe);

/* System 6. Silent until a gesture resumes the context, and inert if the
   browser has no audio at all — it must never be able to stop the scene. */
const audio = createAudio({ camera, canvas, path });
/* Tonight's wind lives with the audio, which is its timing and strength
   authority. The drifted sand on the wash floor has to agree with the gust bed
   and the saltation, so it is pointed at the same heading here rather than
   keeping a second copy of the constant. */
syncWind(terrainMesh.material, audio.api);

/* ── player ────────────────────────────────────────────────────────────── */

/* Lateral confinement. The ground clamp has always been solid — a hundred
   metres off-piste at 12 m/s in six directions produces no fall-through and no
   NaN — but nothing stopped the player walking sideways *through* a canyon
   wall, and twenty-five metres of strafing did exactly that. See corridor.js
   for why this is a soft limit on distance from the wash centreline rather than
   collision against the wall mesh, and for how its width is read out of the
   cross-section instead of being a number somebody chose. */
const corridor = buildCorridor(path, terrain);

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

/* Both cascade cameras ride with the player, each quantised to its own texel
   grid so the maps do not shimmer while walking and — the part the harness
   depends on — so the same player position always yields the same shadow
   texels. sky.js owns the arithmetic. */
const shadowRig = makeShadowRig(sun, sunNear);
/* And each cascade is redrawn only when *that* cascade moved, which is the half
 * of the paragraph above that was missing.
 *
 * `renderer.shadowMap.needsUpdate` is one flag for the whole pass, so raising it
 * redraws both cascades. But the two grids are quantised at very different
 * pitches, the fine one a fraction of the coarse: while walking the fine cascade
 * moves on nearly every frame and the coarse cascade moves on roughly one frame
 * in five — and the coarse one was being redrawn on all five. It is the expensive
 * one, 4096 against 2048, and both passes walk the same ~2.1 M triangles of
 * terrain and rock.
 *
 * That the cost is the *draw* and not the fill was measured before this was
 * written, and it is what makes this the right lever instead of a smaller map:
 * the walking penalty is a flat +3.3 ms and it does not move when the tier steps
 * the maps from 4096/2048 to 1024/512. Sixteen times less depth written for the
 * same milliseconds means what is being paid for is walking the casters, and the
 * only thing that removes that is not walking them.
 *
 * three gates each light on `shadow.autoUpdate === false && shadow.needsUpdate
 * === false` and clears the flag after drawing, so this needs no patch — unlike
 * the cascade split itself. Nothing about the picture changes: a cascade is
 * skipped exactly on the frames where redrawing it would write the same texels,
 * which is the same argument the global flag is already making, one level down,
 * and is why the harness's pixel-identical recapture is unaffected. The position
 * is read back off the light rather than returned from the rig because sky.js
 * owns that arithmetic and is being edited by someone else tonight. */
sun.shadow.autoUpdate = false;
sunNear.shadow.autoUpdate = false;
/* `renderer.shadowMap.needsUpdate = true` has to keep meaning "redraw
   everything", because four tools in tools/ set it directly to force a redraw
   after they have changed a material or a light, and none of them know cascades
   are scheduled separately now. So the public flag forces both cascades and the
   frame loop below uses a private path that does not. Writing false is three
   clearing the flag after a pass and must not force anything. */
let shadowPass = true;
Object.defineProperty(renderer.shadowMap, 'needsUpdate', {
  get: () => shadowPass,
  set: (v) => {
    shadowPass = v;
    if (v) { sun.shadow.needsUpdate = true; sunNear.shadow.needsUpdate = true; }
  },
});
/* NaN, not 0, so the first call cannot decide a cascade has not moved. The
   quantised far target on frame one really can be exactly the origin. */
const shadowWas = [NaN, NaN, NaN, NaN, NaN, NaN];
function syncShadow() {
  if (!shadowRig(player.x, player.y, player.z)) return;
  shadowPass = true;
  const p = [sun.target.position, sunNear.target.position];
  for (let i = 0; i < 2; i++) {
    const t = p[i], k = i * 3;
    if (t.x === shadowWas[k] && t.y === shadowWas[k + 1] && t.z === shadowWas[k + 2]) continue;
    shadowWas[k] = t.x; shadowWas[k + 1] = t.y; shadowWas[k + 2] = t.z;
    (i ? sunNear : sun).shadow.needsUpdate = true;
  }
}

placeAt(0);
player.yaw = path.headingAt(0);
syncCamera();
syncShadow();

/* ── System 5: the air ─────────────────────────────────────────────────────
 *
 * Both of these read the beam's direction off the light rather than off a
 * constant, so they inherit System 4's sun wherever it ends up — which is why
 * they are down here and not up beside buildLights(). A DirectionalLight is
 * born at the origin with its target at the origin; the direction only exists
 * once the shadow rig has placed it, four lines up. Installed before the first
 * renderOnce() at the bottom of this file, which is when the fog chunks the
 * aerial patch rewrites are actually compiled.
 */
installAerial(sun, scene.fog.color);
const atmo = buildAtmosphere({
  scene, camera, renderer, terrain, path, sun, audio: audio.api,
});

/* The frame probe's scratch target, declared here rather than beside the probe
   because the governor's onResize below invalidates it during construction and
   a `let` at its old position was still in the temporal dead zone at that
   point — a ReferenceError that stopped the page building at all. */
let maskRT = null;

/* ── System 7: post-processing ─────────────────────────────────────────────
 *
 * The grade, defocus, flare, vignette and grain. It composes with System 5's
 * shimmer rather than replacing it — see src/post.js for how — so the frame
 * still goes through exactly one heat-haze stage and comes out the other side
 * as scene-linear radiance for this chain to tone map.
 */
const post = createPost({ renderer, camera, atmo, sun });

/* ── System 7: the quality governor ────────────────────────────────────────
 *
 * Down here because it reaches into the atmosphere and into the particle clouds
 * by name, so both have to exist first. It is deliberately inert at boot: under
 * a software rasteriser it pins the top tier and disables adaptation, so every
 * capture in shots/ is a picture of what a GPU draws rather than of whatever
 * SwiftShader's frame time talked it into. Its top tier is byte-identical to
 * the settings this scene has always had.
 */
const perf = createPerf({
  renderer, scene, camera, atmo, post, sun, sunNear,
  onResize() { syncViewport(); maskRT = null; },
});

/* ── first-person controls (human only; never touched by walkTo) ───────── */

const keys = Object.create(null);
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => canvas.requestPointerLock());

/* Number keys jump to the eight framings the capture harness shoots, which are
   also simply the best places to stand — they were chosen to cover the long view
   up the wash, the ground underfoot, a lit wall, a shaded one, the bend and the
   sun gap. Routed through the same walkTo/lookAt the harness uses, so a jump
   lands exactly where a capture would and cannot drift from it. */
/* 1–5 are the capture framings, so what you see is what the critics see. 6–9
   walk the rest of the wash, which runs about 340 m and which those five all
   sit inside the first third of. 0 returns to the start. */
const SPOTS = [
  { key: 'Digit1', d: 8,   yaw: 0,   pitch: -4 },  // low, entering the wash
  { key: 'Digit2', d: 46,  yaw: 0,   pitch: 0 },   // mid wash, toward the sun
  { key: 'Digit3', d: 62,  yaw: 34,  pitch: 3 },   // the juniper
  { key: 'Digit4', d: 92,  yaw: -22, pitch: 2 },   // the bend
  { key: 'Digit5', d: 120, yaw: 0,   pitch: 6 },   // the sun gap
  { key: 'Digit6', d: 170, yaw: 0,   pitch: 2 },   // past the second bend
  { key: 'Digit7', d: 220, yaw: 0,   pitch: 2 },   // the long straight
  { key: 'Digit8', d: 270, yaw: 0,   pitch: 2 },   // the upper wash
  { key: 'Digit9', d: 320, yaw: 0,   pitch: 4 },   // the far end
  { key: 'Digit0', d: 0,   yaw: 0,   pitch: 0 },   // back to the start
];
addEventListener('keydown', e => {
  const spot = SPOTS.find(s => s.key === e.code);
  if (!spot) return;
  api.walkTo(spot.d);
  api.lookAt(spot.yaw, spot.pitch);
});
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  // syncCamera applies yaw negated (rotation.y = -yaw), so mouse-right has to
  // increase yaw to turn the view right.
  player.yaw += e.movementX * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * 0.0022));
});
/* Sizing goes through the governor, because the render scale is a factor on it
   and two places computing the buffer size independently is how a frame ends up
   blitted into a corner of the screen. */
addEventListener('resize', () => perf.resize());

function step(dt) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  /* 1.55 m/s is a real walking pace and it is the default because the scene is
     meant to be walked. Shift is a jog; Shift with Ctrl is a frank cheat for
     covering the wash quickly when you are looking for something. */
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const turbo = sprint && (keys.ControlLeft || keys.ControlRight);
  const speed = turbo ? 12 : sprint ? 4.2 : 1.55;

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

  /* Confinement acts on the velocity, before it is integrated, so it is not a
     position fixup that can accumulate and so it is identically inert at rest —
     the loop stays a fixed point when no key is held, which every capture
     depends on. It also never fires in the middle of the wash: the limit is
     eight to eighteen metres either side of the centreline the player walks. */
  confine(corridor, path, player, path.atZ(player.z, _q), dt);

  player.x += player.vx * dt;
  player.z += player.vz * dt;
  player.y = groundAt(player.x, player.z);

  const sp = Math.hypot(player.vx, player.vz);
  if (sp < 0.004) player.bob = 0;
  else player.bob = Math.sin((player.bob0 = (player.bob0 || 0) + dt * sp * 5.4)) * 0.032;
}

/* ── frame probe ───────────────────────────────────────────────────────── */

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
  /* Points rendered through a mesh override material come out as stray single
     texels, and at 1/8 scale a stray texel is a whole region of the mask. */
  atmo.setHidden(true);
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
  atmo.setHidden(false);
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
/* Cleared the first time audio.update throws; see the frame loop. */
let audioLive = true;

function renderOnce() {
  syncCamera();
  syncShadow();
  camera.updateMatrixWorld();
  /* System 7's chain owns the frame, and System 5's shimmer is its first stage
     — post.render drives the composite and falls back to a plain scene render
     if the tier has switched the shimmer off, so this stays one call whatever
     the quality settings are. */
  if (!post.render(scene, camera)) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }
  lastRenderWasMask = false;
}

function frame(t) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (paused) { last = t; return; }
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  /* The governor owns the frame cap, the GPU timer bracket and the adaptive
     tier. It returns false only when an explicit #fps cap says this rAF tick is
     not owed a frame — uncapped, which is the default, it is always true, so
     nothing about the existing loop changes. */
  if (!perf.beginFrame(dt)) return;
  const t0 = performance.now();
  step(dt);
  /* The comment beside createAudio says the sound must never be able to stop
     the scene, and until now nothing enforced it. src/audio.js has been writing
     a non-finite value into `eg1.gain` from _scheduleWind — `this.prox` goes
     NaN, which is `path.uOf(player.x, player.z)` — and a throw here takes
     atmo.update, post.update and renderOnce with it for the rest of the
     session: the loop keeps being scheduled and keeps dying at the same line,
     so the page stops rendering entirely while still looking alive. That is a
     measurement hazard for every system, not just for System 6, because the
     harness's captures come from renderOnce called directly and therefore keep
     working, so the only symptom is that the 4-second settle and the 400 ms
     wait stopped settling anything.
     Reported once and then switched off, rather than swallowed: a silent catch
     in a frame loop is how a bug lives for a month, and once per page is enough
     for it to appear in the harness's error manifest. */
  if (audioLive) {
    try {
      audio.update(dt, player);
    } catch (e) {
      audioLive = false;
      console.error('audio.update threw; audio is now inert for this page', e);
    }
  }
  const moving = Math.hypot(player.vx, player.vz) > 0;
  atmo.update(dt, moving);
  /* Same freeze rule as the atmosphere, for the same reason: the grain phase
     must not advance through the 400 ms the harness waits between walkTo and
     the capture, or two shots of one viewpoint differ. */
  post.update(dt, moving);
  renderOnce();
  perf.endFrame(performance.now() - t0, dt);
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
    /* Settles the air too: the particle clock becomes a pure function of the
       distance, so a capture is a fixed instant of the weather rather than of
       the wall clock. */
    atmo.setWalk(+d || 0);
    post.setWalk(+d || 0);
  },
  lookAt(yawDeg, pitchDeg) {
    player.yaw = path.headingAt(currentS()) + (+yawDeg || 0) * DEG;
    player.pitch = (+pitchDeg || 0) * DEG;
    syncCamera();
  },
  info() {
    if (lastRenderWasMask) renderOnce();
    const i = renderer.info;
    /* renderer.info is reset per render() call, so after a shimmer composite it
       is describing the fullscreen triangle. The scene pass snapshots itself. */
    const s = atmo.lastInfo() || post.lastInfo() ||
      { calls: i.render.calls, triangles: i.render.triangles };
    return {
      calls: s.calls,
      triangles: s.triangles,
      textures: i.memory.textures,
      programs: i.programs ? i.programs.length : 0,
    };
  },
  probe,
  /* System 7. tools/bench.mjs drives the tier ladder through this, and F3 opens
     the live readout without any tooling at all. */
  perf,
  audio: audio.api,
  // handy while developing; not part of the contract
  /* The namespace itself, so a probe can construct a Raycaster. Every
     screen-space route to "is the sun disc occluded" failed for a different
     reason — post's scene target is stale whenever the bloom chain is off, and
     comparing a sky-on frame against a sky-off one is defeated by veiling
     glare, which is computed from the whole frame and so perturbs every pixel.
     Geometry is the only ground truth and reaching it needed one line. See
     tools/sundisc.mjs. A dynamic `import('three')` inside an evaluate context is
     not an alternative: it hangs rather than throwing. */
  _three: THREE,
  _scene: scene, _camera: camera, _terrain: terrain, _path: path, _atmo: atmo,
  _post: post,
  /* When the loading message reached the screen, how long each generation phase
     blocked for, and the worst of them. tools/_bootpaint.mjs reads it; nothing
     in the contract surface does. */
  _boot: loading.log,
  _corridor: corridor,
  _instances: clasts.reduce((n, m) => n + m.count, 0),
};

/* Shader compilation is the last long stall of the boot and the loading screen
   should still be up for it, so the note goes before the render and the screen
   comes down after. */
await loading.note('Compiling shaders…');
renderOnce();   // compile everything before the harness starts timing
/* The scene is on the canvas, so the message can go. `document.body` is back to
   `[SCRIPT, CANVAS]` from here on, which is the shipped state CONTRACT.md's
   no-HUD rule requires and which a QA check verifies. */
loading.done();
/* Unchanged, and deliberately: the harness waits on this global with a long
   timeout and nothing above may move when or how it appears. */
window.__game = api;

/* The harness drives the loop itself, via begin() after it has waited for
   __game to appear. A human opening the page has nothing to call it for them,
   so without this the scene boots paused: a black window that ignores every
   key. begin() guards on `running`, so the harness calling it later is a
   no-op and capture stays deterministic. */
api.begin();
