/* System 7: the quality governor, and the only place in the project that
 * measures anything about the GPU.
 *
 * ── why this file exists ────────────────────────────────────────────────────
 *
 * Every capture in this project renders through SwiftShader, a CPU software
 * rasteriser, so that a render never touches the GPU of the machine the user is
 * playing on. That is the right call and it is not changing. The consequence is
 * that until now nothing here had ever been measured on real hardware, and the
 * scene shipped with no quality controls at all: one fixed setting, pixel ratio
 * pinned to 1, an uncapped requestAnimationFrame loop, and every system drawing
 * at full strength whatever the frame time came out at.
 *
 * On a 200 Hz display that is a specific and quite bad failure mode. rAF fires
 * every 5 ms. A frame that takes 11 ms therefore misses every other vsync, and
 * a frame that drifts around 10 ms alternates between 100 and 200 fps — which
 * reads as stutter even though the average is fine. The scene does not need to
 * be fast so much as it needs to be *able to choose* how fast to be.
 *
 * ── what it borrows ─────────────────────────────────────────────────────────
 *
 * The structure is nightdrive's, which solved exactly this: a small table of
 * tiers, a separate render-scale ladder, and an interleaved degradation order
 * so that neither runs far ahead of the other. Pixels are shed before world is
 * shed, because resolution is the least visible thing to lose. The hysteresis
 * is jungle-trail's: drop only after sustained evidence, climb back only after
 * a long clean run, and never climb back above a setting that has already
 * failed once, so the governor settles instead of oscillating between two
 * tiers — which looks worse than sitting at the lower one.
 *
 * ── the constraint that shapes the defaults ─────────────────────────────────
 *
 * The capture harness cannot be modified and does not pass a tier. So the
 * governor must be *invisible* to it: under automation this pins the top tier
 * and disables adaptation outright. Without that, SwiftShader — which takes
 * tens of seconds a frame — would walk the tier all the way down within the
 * harness's four-second settle and every measured gate in CONTRACT.md would be
 * measured against a picture nobody with a GPU will ever see; and on the GPU
 * path, where the frame is fast enough that the ladder mostly holds, two page
 * loads could still settle differently on incidental timing and break the
 * pixel-identical recapture the contract requires.
 *
 * ── URL flags ───────────────────────────────────────────────────────────────
 *
 *   #high #medium #low #potato   pin a tier and stop adaptation
 *   #scale=0.8                   pin the render scale
 *   #fps=120                     cap the loop, and adapt toward that rate
 *   #target=200                  adapt toward a rate without capping the loop
 *                                (default 60 — see "the governor" below for why
 *                                 it is not 120, which cost the picture)
 *   #perf                        live overlay: tier, scale, cpu/gpu ms, calls
 *   #noadapt                     leave the tier alone but keep the readout
 *   #adapt                       adapt even under automation — see `automated`
 *
 * F3 toggles the overlay at any time, which is the only way to read a number
 * off this scene without running a tool.
 */
import * as THREE from 'three';

/* ── the tiers ──────────────────────────────────────────────────────────────
 *
 * Only levers this system can pull without reaching into another system's
 * geometry. Each is chosen because its cost is measurable and its visual cost
 * is either nil or confined to the tier that pays it:
 *
 *   shadowFar/shadowNear  the two cascade maps. Both are redrawn only when the
 *                         rig moves, so this is a fill cost on the frames where
 *                         the player is walking, not on every frame.
 *                         The near map is the one that matters and the ladder
 *                         used to leave it alone. It is the second cascade, so
 *                         it is pure addition on top of a scene that already
 *                         renders its shadows: at 2048 it is 4.2 M depth
 *                         samples, and the terrain and rock it redraws are the
 *                         two heaviest meshes in the scene at roughly 2.1 M
 *                         triangles between them. `medium` held it at 2048
 *                         while stepping the far map 4096 to 3072, which spent
 *                         a quarter of the far map's fill and none of the near
 *                         map's -- so the tier that exists to buy back a
 *                         struggling frame left the addition untouched. It
 *                         steps 2048/1536/1024/512 now, and the bottom rung is
 *                         a sixteenth of the top one's fill.
 *                         The two draw calls this costs are not the cost and
 *                         should not be optimised for; tools/bench.mjs counts
 *                         53 calls for the whole frame.
 *                         Resolution is safe to step here because the receiver
 *                         plane bias in src/sky.js derives its bias from
 *                         shadowMapSize, so a smaller map widens its own bias
 *                         and does not start acneing -- it goes soft, which is
 *                         the failure a lower tier is allowed to have.
 *   shimmer               the heat-haze composite. Turning it off does not just
 *                         remove a full-screen pass, it removes the half-float
 *                         multisampled render target the whole scene is drawn
 *                         into and the resolve of it.
 *   samples               MSAA on that target. 4x on RGBA16F at 1080p is 66 MB
 *                         of colour written and resolved every frame; the same
 *                         picture at 2x is 33 MB and at 0 is 16 MB.
 *   dust/salt             fraction of the particle draw range kept. The two
 *                         point clouds are 56,000 blended sprites with
 *                         frustum culling switched off, so every one of them is
 *                         vertex-shaded whether it is on screen or behind the
 *                         camera.
 *   softShadow            PCFSoft is the most expensive filter three offers.
 *                         It cannot be changed after boot without recompiling
 *                         every material, so it is read once, at startup.
 *   post                  System 7's chain, as three separate levers because
 *                         they cost quite different things.
 *                         `bloom` is the divisor of the low-resolution buffer
 *                         the bright pass, the two blurs and the flare all run
 *                         at, and 0 drops those four passes and their two
 *                         RGBA16F targets entirely.
 *                         `dofTaps` is the defocus gather. It is branch-gated
 *                         on the circle of confusion, so it costs nothing over
 *                         most of the frame and a lot on the metre or two of
 *                         ground at the bottom of a downward view — which is
 *                         also exactly where a struggling machine is least
 *                         likely to be looking at anything interesting. 0
 *                         compiles the gather out.
 *                         `flare` is 2 for ghosts, veil and the anamorphic
 *                         streak, 1 for ghosts and veil, 0 for neither. The
 *                         streak is the expensive half at seventeen taps.
 *                         The grade, the vignette, the aberration and the grain
 *                         are not on the ladder at any tier. They are one pass
 *                         that has to exist regardless — something has to tone
 *                         map — and they are what the scene looks like, so
 *                         spending them would change the picture rather than
 *                         its quality.
 */
/* `far` is how many of System 2's far ridgeline planes are drawn, nearest
   first. Four is the whole ladder at 69 k triangles and four draw calls, which
   is noise on this GPU; the reason it is on the ladder at all is that the two
   furthest are the cheapest thing in the scene to give up — they are the
   palest, the smallest on screen, and by 5 km the airlight is nine tenths of
   the pixel, so what a bottom tier loses by dropping them is a tone step rather
   than an object. */
/* Deliberately not on the ladder: System 4's probe height lerp, the term that
   blends the wash floor's sky aperture toward the open sky as a surface climbs.
   tools/shadercost.mjs puts it at zero texture fetches and zero derivatives —
   four sqrts and about eleven vec3 multiply-adds on a scene that pays twenty-odd
   dependent fetches per ground pixel. Gating it would need a #define, so a tier
   change would recompile every lit program mid-play, and a compile hitch costs
   more than the term does in its whole lifetime. Leave it on at potato. */
/* `samples` now governs *both* float targets the scene can be drawn into —
   System 5's shimmer buffer and System 7's sceneRT — because which of the two
   the scene lands in depends on whether System 5's stage is enabled, and a
   ladder that set the sample count on only one of them made the frame's
   antialiasing a side effect of another system's feature flag. It was, and it
   cost two agents a contradictory measurement each. One number, applied to
   whichever target the scene actually goes to.
   Note that this is why it stays 0 at low and potato even though skyline
   aliasing is the most visible defect at any tier: at that point the bandwidth
   is the reason the tier exists. What carries those rungs instead is System 7's
   along-edge resolve, which works on the encoded frame and so is independent of
   the sample count — it is deliberately at full strength on every rung, being
   about six texture fetches, which is less than the branch to skip it. */
export const QTIERS = [
  { name: 'high',   shadowFar: 4096, shadowNear: 2048, shimmer: true,  samples: 4, shafts: 2, dust: 1.00, salt: 1.00, far: 4, softShadow: true,  post: { bloom: 4, dofTaps: 12, flare: 2, edge: 1 } },
  { name: 'medium', shadowFar: 3072, shadowNear: 1536, shimmer: true,  samples: 2, shafts: 2, dust: 0.70, salt: 0.70, far: 4, softShadow: true,  post: { bloom: 4, dofTaps:  6, flare: 2, edge: 1 } },
  { name: 'low',    shadowFar: 2048, shadowNear: 1024, shimmer: true,  samples: 0, shafts: 1, dust: 0.45, salt: 0.40, far: 3, softShadow: false, post: { bloom: 8, dofTaps:  0, flare: 1, edge: 1 } },
  { name: 'potato', shadowFar: 1024, shadowNear:  512, shimmer: false, samples: 0, shafts: 1, dust: 0.25, salt: 0.20, far: 2, softShadow: false, post: { bloom: 0, dofTaps:  0, flare: 0, edge: 1 } },
];

/* 0.50 is new, and it is the honest kind of addition: it buys about a
   millisecond, which is said here rather than implied. When the ladder was
   tuned, halving the pixel count took a third off the frame and resolution was
   by far the strongest lever available. It is not any more — measured on the
   tree as it stands, tools/bench.mjs's `@0.7res` column takes wash_mid from
   24.48 to 17.95, so 49% of the pixels save 27% of the frame, and the remaining
   17.95 is vertex work, the two shadow cascades, the resolve and the post chain
   in an order nobody has yet attributed. Stepping 0.58 to 0.50 is 74% of the
   pixels for 91% of the frame. The rung exists because a governor whose bottom
   step is still over budget has nowhere to put a struggling machine, not because
   it closes the gap. */
const RSCALE = [1.0, 0.88, 0.78, 0.68, 0.58, 0.50];

/* Degradation order, as pairs of (scale index, tier index). Interleaved, and it
   opens with a pure resolution step: the frame is overwhelmingly fragment-bound
   — measured, at 2560x1440, the terrain fragment shader alone is 9.1 ms of a
   15.7 ms frame — so the first thing worth trying is simply fewer fragments,
   and it is the change the eye is least likely to notice on a 200 Hz panel
   where the alternative is a dropped frame.

   ── retuned against tools/bench.mjs's rung table rather than reasoned ───────

   The previous order was [0,0] [1,0] [2,0] [2,1] [3,1] [3,2] [4,2] [4,3] — three
   resolution steps before any quality at all, then quality trailing resolution
   by a rung the rest of the way. That was written before anything had been
   measured on a GPU, and the measurement does not support it. Per rung at
   sun_gap, 2560x1440, on the 4060:

     high   15.73  13.27  11.46   9.88   8.51     at scale 1.00 .88 .78 .68 .58
     medium 13.33  11.28   9.78   8.46   7.31
     low    10.75   8.98   7.68   6.54   5.56
     potato  9.99   8.34   7.13   6.06   5.14

   Read down a column rather than along a row: once the shadow filter stopped
   being three quarters of the frame, a *tier* step became worth roughly as much
   as a scale step and costs less picture than one. The old order reached the
   8.33 ms budget at medium/0.68 — 1741x979. This one reaches it at low/0.78 —
   1997x1123, which is 34% more pixels at a shorter frame. (Both the table and
   the budget above are held-camera and predate the moving measurements; the
   target is now 16.67. The conclusion is a comparison of two orderings under
   one instrument, so it is unaffected.) Both numbers are
   measured; the trade the retune makes is MSAA for resolution, and it is the
   right way round because System 7's along-edge resolve runs at full strength
   on every rung precisely so that the samples-0 rungs are not left bare.

   The bottom rung is potato at 0.58, and it is now 5.14 ms — 195 fps — against
   the 18.03 ms that was recorded as the ladder's floor. That figure was potato
   at *native* resolution, which is a setting the governor never selects: see
   the note on `rungs` below. */
const LADDER = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [5, 3]];

const SOFTWARE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;

/* Is the page being driven by the capture harness rather than by a person?
 *
 * The pin below used to be keyed to SOFTWARE alone, on the assumption that a
 * capture is always a SwiftShader capture. That assumption expired the day
 * tools/harness.mjs grew a `.gpu` marker: on the D3D11 path `software` is
 * false, so adaptation was live during every GPU capture, and a governor whose
 * whole job is to react to incidental frame timing is the one thing that must
 * not be running while two page loads are being compared pixel for pixel.
 * Nothing was measured settling on a different tier, but the failure mode is
 * silent by construction — a rung change costs a render scale, and a capture
 * at 0.88 scale looks like a slightly soft build rather than like a bug.
 *
 * `navigator.webdriver` is exactly the question being asked: it is set by
 * Chromium when the page is under automation, so it is true for every probe in
 * tools/ and false for the person whose GPU this is. It also covers the case
 * the SOFTWARE test never could, which is a real GPU under the harness.
 *
 * ── and why there has to be a way out of it ─────────────────────────────────
 *
 * The clause is right and it had one consequence nobody wanted: **the governor
 * was the only system in this project that no tool could observe.** Every probe
 * in tools/ sets `navigator.webdriver`, so every probe pinned the top tier and
 * switched adaptation off — which means the ladder had only ever been measured
 * by driving it by hand through setTier and setRung, one rung at a time, with
 * the loop paused. That prices a rung. It cannot say which rung the governor
 * chooses, how long it takes to get there, or whether it can get back, and
 * those are the three things a player experiences. The first real-browser
 * playthrough found it settling two rungs below where the rung table said it
 * would and unable to climb out again, and none of that was visible to any
 * instrument here.
 *
 * `#adapt` opts back in, explicitly and per URL. Nothing in tools/ sets it
 * except tools/govern.mjs, whose whole subject is the governor, so captures and
 * benches are unaffected — and a flag that has to be asked for cannot pin a
 * capture by accident, which is the failure the clause exists to prevent. */
function automated() {
  try { return !!(typeof navigator !== 'undefined' && navigator.webdriver); } catch (_) { return false; }
}

function rendererName(renderer) {
  try {
    const gl = renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch (_) { return ''; }
}

/* ── GPU timing ─────────────────────────────────────────────────────────────
 *
 * The single measurement that would have prevented this whole situation, and it
 * costs nothing to have running. performance.now() around a frame times how
 * fast JavaScript can *submit* draw calls, which for a scene of fifty is
 * microseconds regardless of what the shaders do — the same trap jungle-trail's
 * perf tool documents, where adding a post-processing pass appeared to make the
 * frame faster.
 *
 * EXT_disjoint_timer_query_webgl2 asks the hardware instead. A query is opened
 * at the top of the frame and closed at the bottom; results arrive some frames
 * later, so they are collected from a small pool and reported as a rolling
 * median. `disjoint` means the GPU was preempted mid-query — by the compositor,
 * or by whatever else the machine is running — and the sample is discarded
 * rather than reported as a spike.
 */
class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = null;
    try { this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (_) {}
    this.pool = [];
    this.pending = [];
    this.open = null;
    this.samples = [];
    this.ms = 0;
    this.available = !!this.ext;
  }

  begin() {
    if (!this.ext || this.open) return;
    const gl = this.gl;
    const q = this.pool.length ? this.pool.pop() : gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = q;
  }

  end() {
    if (!this.ext || !this.open) return;
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
    this._collect();
  }

  /* Called whenever the rung changes. The reported figure is a median over up
     to 31 samples, so for the first thirty-one frames after a rung change it is
     a median of two different settings — and the governor's next decision is
     taken off exactly that number. Worse than merely lagging: a climb that
     should be reverted in one second cannot be seen to have failed until the
     window has rolled over. Flushing costs the governor one hold of blindness,
     which `hold` was already imposing anyway. */
  reset() {
    this.samples.length = 0;
    this.ms = 0;
  }

  _collect() {
    const gl = this.gl, ext = this.ext;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const keep = [];
    for (const q of this.pending) {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { keep.push(q); continue; }
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        this.samples.push(ns / 1e6);
        if (this.samples.length > 31) this.samples.shift();
      }
      this.pool.push(q);
    }
    this.pending = keep;
    if (this.samples.length) {
      const s = this.samples.slice().sort((a, b) => a - b);
      this.ms = s[s.length >> 1];
    }
  }
}

/**
 * Install the governor.
 *
 * Everything it touches it reaches through an object it was handed or through
 * the scene graph by name, so no other system's file has to know it exists.
 *
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {object} o.atmo            the buildAtmosphere handle
 * @param {object} [o.post]          the createPost handle
 * @param {THREE.DirectionalLight} o.sun      coarse cascade
 * @param {THREE.DirectionalLight} o.sunNear  fine cascade
 * @param {() => void} o.onResize    re-derive anything sized in device pixels
 */
export function createPerf({ renderer, scene, camera, atmo, post, sun, sunNear, onResize }) {
  const hash = (location.hash || '').toLowerCase();
  const flag = (re) => re.test(hash);
  const num = (key, dflt) => {
    const m = hash.match(new RegExp(key + '=([0-9.]+)'));
    return m ? +m[1] : dflt;
  };

  const gpuName = rendererName(renderer);
  const software = SOFTWARE.test(gpuName);

  let pinned = -1;
  for (let i = 0; i < QTIERS.length; i++) if (flag(new RegExp('(^|[#&])' + QTIERS[i].name))) pinned = i;

  /* The harness clause. A capture — software rasteriser or real GPU — gets the
     top tier and no adaptation, so that a capture is a picture of what a GPU
     would draw and, just as importantly, is the *same* picture every time.
     tools/bench.mjs still walks the ladder, because setTier() is an explicit
     call and does not go through `adapting`. */
  const harness = automated();
  /* Anchored on `#` or `&`, because `#noadapt` contains the string `adapt` and
     a loose test would have every existing probe opting into the thing the
     clause below exists to switch off. */
  const askedToAdapt = flag(/(^|[#&])adapt(&|$)/);
  if ((software || harness) && pinned < 0 && !askedToAdapt) pinned = 0;

  const scalePin = num('scale', 0);
  const frameCap = num('fps', 0);
  const adapting = pinned < 0 && !flag(/noadapt/);

  /* Kept only for the overlay's counts. The *ladder* goes through
     atmo.setParticleFraction now: reaching in by name found `dust` and
     `saltation` but not `saltation_far`, so every rung below the top left the
     far saltation layer at full count — half the particle cost the tier
     thought it had spent was still being paid. System 5 exposed the call for
     exactly this, and it also owns the knowledge of how many layers there are,
     which is not a thing this file should be tracking. */
  const dust = scene.getObjectByName('dust');
  const salt = scene.getObjectByName('saltation');
  const dustN = dust ? dust.geometry.attributes.position.count : 0;
  const saltN = salt ? salt.geometry.attributes.position.count : 0;
  /* System 2's far band. Reached by name for the same reason the particle
     clouds are: nothing in this file should have to be constructed with a
     reference to every system it governs. Absent — an older build, or a probe
     that assembles a partial scene — the tier simply has one fewer knob. */
  const farRidge = scene.getObjectByName('farridge');

  const timer = new GpuTimer(renderer);

  let li = 0;                 // index into LADDER
  let qi = pinned < 0 ? 0 : pinned;
  let ri = 0;
  /* `floorI` used to live here — "never climb back above a rung that already
     failed". It was a single index, so it could record *that* a rung had failed
     but not why or by how much, and it was decremented one notch per twelve
     seconds of headroom that the climb gate made unreachable. The per-rung price
     table and cooldowns below say the same thing with a number instead of a
     flag, and forget it on a timer instead of never. */
  let cpuMs = 0, fps = 0;
  /* When the render loop last ran. The GPU timer is opened in beginFrame and
     closed in endFrame, so it only ever measures the *loop's* frames — and
     tools/bench.mjs pauses the loop and drives renderOnce by hand, which means
     stats() was handing it a reading left over from before the pause. It read
     11.5 ms against a measured frame of 4.5, identically across all four tiers,
     which is exactly what a stale number looks like once you know to ask. A
     measurement that cannot be taken has to say so rather than return the last
     one that could. */
  let lastLive = -1e9;
  const LIVE_MS = 500;

  /* ── applying a tier ──────────────────────────────────────────────────── */

  let scaleOverride = 0;
  const curScale = () => scaleOverride || scalePin || RSCALE[ri];
  function applyScale() {
    const s = curScale();
    const w = Math.max(2, Math.round(innerWidth * s));
    const h = Math.max(2, Math.round(innerHeight * s));
    /* updateStyle false: the canvas keeps its CSS 100%/100% and the browser
       stretches the smaller buffer over it, which is what makes this free.
       Rounded to whole pixels once, here, because the shimmer target is sized
       from renderer.domElement and a fractional disagreement between the two
       is the class of bug that blits the frame into a corner of the screen. */
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (onResize) onResize();
  }

  function applyTier() {
    const q = QTIERS[qi];
    for (const [l, size] of [[sun, q.shadowFar], [sunNear, q.shadowNear]]) {
      if (!l || l.shadow.mapSize.x === size) continue;
      l.shadow.mapSize.set(size, size);
      /* Dropping the map is what makes the new size take effect; three
         reallocates it on the next shadow pass. */
      if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
      /* Per light as well as globally, because main.js schedules the two cascades
         independently now — it sets shadow.autoUpdate = false on both so that a
         cascade which has not moved is not redrawn while walking. A resize is the
         one case where a cascade must redraw without having moved, and without
         this line the light whose map was just disposed would wait for the player
         to cross a texel boundary before it had a map at all. */
      l.shadow.needsUpdate = true;
    }
    renderer.shadowMap.needsUpdate = true;

    if (atmo) {
      if (atmo.setShimmerSamples) atmo.setShimmerSamples(q.samples);
      atmo.setShimmer(q.shimmer);
      /* The marched in-scatter, which System 5 built three rungs for and nobody
         had connected. It is worth connecting: their own ablation puts the march
         at 2.0 ms, which makes it the most expensive single pass in the frame by
         a factor of four over the whole of System 7's chain.
         Never 0, though it exists. Dropping the pass removes a *subtractive*
         correction, so the canyon gets brighter — a bottom tier that renders a
         different picture rather than a rougher one, which is the line this
         ladder is built not to cross. Halving the steps costs shadow-boundary
         crispness and nothing else, on their measurement, so that is the rung. */
      if (atmo.setShaftQuality) atmo.setShaftQuality(q.shafts);
    }
    /* The same sample count on System 7's scene target. Set from the same rung
       and unconditionally, because the whole point is that the frame's
       antialiasing must not depend on which of the two paths is live. */
    if (post && post.setSamples) post.setSamples(q.samples);
    /* setDrawRange under the hood rather than rebuilding the buffers: the
       attribute data is already resident, the particles are distributed by a
       hash over the index so any prefix of them is still an even scatter, and
       the change costs one number. Both clouds have frustumCulled off, so this
       is the only thing that reduces their vertex cost at all. */
    if (atmo && atmo.setParticleFraction) atmo.setParticleFraction(q.dust, q.salt);
    else {
      if (dust) dust.geometry.setDrawRange(0, Math.max(1, Math.round(dustN * q.dust)));
      if (salt) salt.geometry.setDrawRange(0, Math.max(1, Math.round(saltN * q.salt)));
    }

    if (post && post.setLevel) post.setLevel(q.post);

    if (farRidge && farRidge.setDetail) farRidge.setDetail(q.far);
  }

  function gotoRung(i) {
    li = Math.max(0, Math.min(LADDER.length - 1, i));
    const [r, q] = LADDER[li];
    const rChanged = r !== ri, qChanged = q !== qi;
    ri = r; qi = q;
    if (rChanged) applyScale();
    if (qChanged) applyTier();
    if (rChanged || qChanged) timer.reset();
    return rChanged || qChanged;
  }

  /* ── the governor ─────────────────────────────────────────────────────────
   *
   * The target is a fixed frame rate, not an inferred one. The first version of
   * this tried to measure the panel's refresh period from the loop's shortest
   * observed interval, on the theory that the refresh period is the deadline a
   * frame actually misses. It does not work, and the way it fails is the worst
   * kind: on a vsynced uncapped loop the shortest interval you can observe is
   * the *scene's* frame time, not the panel's. A machine running this at 40 fps
   * measures 40, concludes that 40 is the target, and never adapts — the
   * governor switches itself off on precisely the hardware that needs it.
   *
   * So: **60 fps, 16.67 ms.** It was 120 for most of this project's life, on the
   * reasoning that the panel is 200 Hz and its owner's reference for "smooth" is
   * a AAA title at 200+. That reasoning was sound and the consequence was not,
   * and the consequence is the whole argument for the number being 60 now.
   *
   * Measured: no rung on this ladder reaches 8.33 ms with the camera moving —
   * the floor, 1280x720, is 11.27 ms. So a target of 120 is unsatisfiable
   * everywhere, the descend rule fires at every rung, and the governor walks to
   * the bottom of the ladder and stays there. **Aiming at 120 does not produce
   * 120; it produces 1280x720 upscaled to a 1440p display**, which is the
   * softest picture this project can draw, on a machine that renders 1997x1123
   * comfortably. The cost of chasing an unreachable number is paid entirely in
   * image quality, and none of it comes back as frame rate.
   *
   * At 60 the descend rule fires above 19.17 ms, which the mid-ladder rungs
   * clear while moving, so the governor has somewhere to stand that is not the
   * floor. The trade is deliberate and it is the brief's own priority order:
   * this is a walking simulator whose point is the picture, 50-plus is smooth
   * for a walking pace, and 89 fps buys nothing on a 200 Hz panel if the thing
   * being shown at 89 is 720p.
   *
   * Every threshold in `adapt()` is a multiple of `target()`, so this moves the
   * whole policy coherently rather than one gate of it. The wall-clock constants
   * — hold, probe, cooldown, price TTL — are properties of a walking player and
   * a shader compile, not of a frame budget, and deliberately do not scale.
   *
   *   #target=120   the old default, for a smoother and softer picture
   *   #target=200   adapt toward 200 fps without capping the loop
   *   #fps=60       cap the loop at 60 and adapt toward it
   */
  const targetFps = num('target', 0) || frameCap || 60;
  const target = () => 1000 / targetFps;

  /* ── the timebase, which was the wrong one ──────────────────────────────────
   *
   * `clock` and `hold` were accumulated from the loop's `dt`, and main.js's dt
   * is `Math.min(0.05, ...)`. That clamp is right for `step()` — a physics
   * integrator handed a one-second frame must not teleport the player — and it
   * is exactly wrong here, because the governor's entire subject is wall-clock
   * slowness. During the compile-heavy first frames the clamp means a 170 ms
   * frame advances the governor's clock by 50 ms, so `clock < 2.5` gates on
   * fifty frames rather than on two and a half seconds, and every `hold` after
   * it stretches the same way.
   *
   * Measured on tools/govern.mjs before this change: from a cold load the ladder
   * held rung 0 for **8.5 s** and did not settle until **17 s**, against the
   * 2.5 + 2.5 + 2.5 the holds are written to produce. The first real-browser
   * playthrough saw forty seconds of it, which is the same bug on a machine that
   * was also under contention. The governor now keeps its own clock, in wall
   * milliseconds, and the loop's dt is only used for what dt is for. */
  let t0Adapt = 0;
  let holdUntil = 0;
  let goodSince = 0;

  /* ── what each rung has actually cost, and why an absolute climb gate cannot
   *    work ─────────────────────────────────────────────────────────────────
   *
   * The old rule was: descend above `t * 1.15`, climb below `t * 0.62`. On this
   * scene at the then-current 120 fps target those are 9.58 ms and 5.17 ms —
   * quoted at the target of the day, since that is what made them
   * unsatisfiable; at today's 60 they would read 19.17 and 10.33, and the
   * argument below is about the *ratio* and holds at either — and the measured
   * cost of every rung
   * below 4 sits *between* them — so the governor could descend and then never
   * satisfy the condition to come back. A transient stall was permanent until
   * the page was reloaded. The playthrough found it sitting at the floor for 99
   * of 108 samples across nine minutes.
   *
   * Widening the gate is not the fix, because the gate is asking the wrong
   * question. `cost < t * 0.62` asks "is the current rung very cheap"; what
   * decides a climb is "would the *next rung up* fit". Those differ by the size
   * of a rung step, which is 6% to 20% here — so a fixed 38% headroom
   * requirement is between two and six times the size of the step it is
   * gating, and at the bottom of the ladder it is unsatisfiable by construction.
   *
   * So remember the price instead of guessing it. `seen[i]` is what rung i has
   * cost on this machine, blended, and a climb needs the rung above to be known
   * cheap enough or not known at all. A rung that then fails to hold the budget
   * is put on a cooldown that doubles each time, and when the cooldown expires
   * its remembered price is *cleared* — so it becomes probeable again. That is
   * the part that makes this not a ratchet: nothing is ever closed off
   * permanently, but a rung that keeps failing is retried at 15 s, then 30, then
   * 60, which is rare enough to be invisible and often enough to recover.
   */
  const seen = new Array(LADDER.length).fill(0);
  const seenAt = new Array(LADDER.length).fill(0);
  const cool = new Array(LADDER.length).fill(0);
  let probeFrom = -1;         // the rung a climb-probe left, while it is on trial
  let probeUntil = 0;
  let settled = false;        // has the ladder been inside the band even once

  const CLIMB = 0.92;         // headroom needed to consider climbing at all
  const CLIMB_HOLD = 3000;    // and for how long, in ms of continuous headroom
  const PROBE_MS = 5000;      // a climb is on trial for this long
  const COOL0 = 15000;        // first cooldown on a rung that failed a probe
  const COOL_MAX = 60000;
  /* A price goes stale, and this is the difference between the two memories.
     `cool` is a penalty: this rung was tried and could not hold the budget, so
     back off, doubling. `seen` is only an estimate, and it expires — because
     what a rung costs depends on where the player is standing, and the player is
     walking. The first version of this had no TTL and measured the consequence:
     descending through rung 5 recorded its price at the mouth of the wash, the
     walk reached the cheap far end where the frame ran at a third of that, and
     the governor still would not climb past 6 because a fifty-second-old
     estimate said 5 would not fit. That is the same ratchet in a new place, and
     a stale number is the reason both times. */
  const SEEN_TTL = 8000;

  function adapt() {
    if (!adapting) return;
    const now = performance.now();
    if (!t0Adapt) { t0Adapt = now; holdUntil = now + 1200; }

    /* Cooldowns run on wall time too, and expiring one forgets that rung's
       price — the cooldown *is* the "worth another look" timer. Prices expire on
       their own shorter clock, except for the rung being stood on, which is
       being re-measured every frame anyway. */
    for (let i = 0; i < cool.length; i++) {
      if (cool[i] && now >= cool[i]) { cool[i] = 0; seen[i] = 0; }
      else if (i !== li && seen[i] && !cool[i] && now - seenAt[i] > SEEN_TTL) seen[i] = 0;
    }

    const t = target();
    /* GPU time where it is available, because that is the quantity every lever
       here moves. Falling back to CPU frame time is the old, blunter signal and
       is still better than nothing on a driver with the extension disabled.
       Nothing at all is the third case and it has to be handled rather than
       coerced: after a rung change the timer is flushed, and treating an empty
       median as `cpuMs` would hand the governor the *submit* time — a couple of
       milliseconds on a scene of sixty draws — read as enormous headroom, one
       frame after a rung change. That is a climb loop with no brakes. */
    const cost = timer.available ? timer.ms : cpuMs;
    if (!(cost > 0)) return;

    seen[li] = seen[li] ? seen[li] + (cost - seen[li]) * 0.25 : cost;
    seenAt[li] = now;
    if (probeFrom >= 0 && now >= probeUntil) probeFrom = -1;
    if (now < holdUntil) return;

    /* ---- down ---- */
    if (cost > t * 1.15 && li < LADDER.length - 1) {
      /* A failed probe: the rung we are standing on is the one that cannot hold
         the budget, so price it, back off, and go back exactly where we came
         from. Deliberately not the multi-step drop below — a probe fails on one
         reading, that reading is sometimes a viewpoint rather than a rung, and
         letting a spike compute a three-rung descent turns a failed look into a
         visible collapse. Measured: a probe from 8 to 7 failed on a spike as the
         walk entered the wash mouth, and the ratio would have sent it three
         rungs past the floor it had just left. */
      if (probeFrom > li) {
        cool[li] = now + Math.min(COOL_MAX, (cool[li] ? COOL0 * 2 : COOL0));
        const back = probeFrom;
        probeFrom = -1;
        gotoRung(back);
        goodSince = 0;
        holdUntil = now + (settled ? 2500 : 700);
        return;
      }
      /* A machine at a fifth of the target does not want one notch a second for
         half a minute; it wants to be somewhere playable now. */
      const r = t / cost;
      const steps = r > 0.72 ? 1 : r > 0.45 ? 2 : 3;
      gotoRung(li + steps);
      goodSince = 0;
      /* Short while the ladder is still finding its level, so a cold load
         reaches a playable rung in a couple of seconds rather than in
         seventeen; normal once it has been inside the band once. */
      holdUntil = now + (settled ? 2500 : 700);
      return;
    }

    if (cost <= t * 1.15) settled = true;

    /* ---- up ---- */
    if (cost < t * CLIMB) {
      if (!goodSince) goodSince = now;
    } else {
      goodSince = 0;
    }
    if (li > 0 && goodSince && now - goodSince >= CLIMB_HOLD && !cool[li - 1]) {
      const up = seen[li - 1];
      if (!up || up < t * 1.02) {
        probeFrom = li;
        probeUntil = now + PROBE_MS;
        gotoRung(li - 1);
        goodSince = 0;
        /* Deliberately short. A probe that does not fit has to be caught and
           undone in about a second, or the cost of looking is a visible
           excursion rather than a blink. The timer was flushed by gotoRung, so
           by the time this expires the median is entirely about the new rung. */
        holdUntil = now + 900;
      }
    }
  }

  /* ── overlay ────────────────────────────────────────────────────────────── */

  let el = null;
  const _v2 = new THREE.Vector2();

  /** Draw calls and triangles for the *scene* pass, not for the last blit. */
  function sceneCounts() {
    const s = (atmo && atmo.lastInfo && atmo.lastInfo()) ||
              (post && post.lastInfo && post.lastInfo());
    return s || renderer.info.render;
  }

  function overlay() {
    if (!el) {
      el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:10px;top:10px;z-index:80;background:#000c;' +
        'color:#8ef;font:11px/1.45 ui-monospace,Consolas,monospace;padding:8px 11px;' +
        'white-space:pre;pointer-events:none';
      document.body.appendChild(el);
    }
    const i = renderer.info;
    const d = renderer.getDrawingBufferSize(_v2);
    /* renderer.info is reset per render() call, and the last render of a frame
       is now a full-screen triangle, so reading it directly reports `calls 1`.
       The scene pass snapshots itself — System 5's when its stage ran, System
       7's otherwise — which is what the counts in this readout have to mean if
       anyone is going to compare them with the budget in CONTRACT.md. */
    const s = sceneCounts();
    el.textContent =
      `${QTIERS[qi].name}${pinned >= 0 ? ' (pinned)' : ''}  scale ${(curScale()).toFixed(2)}  rung ${li}\n` +
      `fps ${fps.toFixed(0)}  cpu ${cpuMs.toFixed(2)}ms  ` +
      `gpu ${timer.available ? timer.ms.toFixed(2) + 'ms' : 'n/a'}  target ${target().toFixed(2)}ms\n` +
      `buffer ${d.x}x${d.y}   calls ${s.calls}  tris ${(s.triangles / 1000) | 0}k  ` +
      `prog ${i.programs ? i.programs.length : 0}  tex ${i.memory.textures}\n` +
      `shadow ${sun.shadow.mapSize.x}/${sunNear.shadow.mapSize.x}  ` +
      `shimmer ${QTIERS[qi].shimmer ? QTIERS[qi].samples + 'x' : 'off'}  ` +
      `shafts ${QTIERS[qi].shafts || 'off'}  ` +
      `dust ${Math.round(dustN * QTIERS[qi].dust)}  salt ${Math.round(saltN * QTIERS[qi].salt)}\n` +
      `post bloom ${QTIERS[qi].post.bloom ? '1/' + QTIERS[qi].post.bloom : 'off'}  ` +
      `dof ${QTIERS[qi].post.dofTaps || 'off'}  flare ${QTIERS[qi].post.flare}  ` +
      /* Read off the chain rather than off the tier, because the sample count it
         actually carries depends on whether it owns the scene draw — and that is
         the number someone asking "is this frame antialiased" needs. */
      `aa ${post ? (post.samples ? post.samples + 'x own' : QTIERS[qi].samples + 'x s5') : '—'}` +
      ` +edge\n` +
      gpuName;
  }
  /* F3, because that is where a debug readout lives and because it is the only
     way the person whose GPU this actually is can read a number off the scene
     without running a tool. #perf opens it at boot. */
  let showOverlay = flag(/perf/);
  addEventListener('keydown', (e) => {
    if (e.code !== 'F3') return;
    e.preventDefault();
    showOverlay = !showOverlay;
    if (!showOverlay && el) { el.remove(); el = null; }
  });

  /* ── boot ───────────────────────────────────────────────────────────────── */

  /* Read once and never changed: swapping the shadow filter recompiles every
     material in the scene, and that stall is worse than the saving. */
  if (!QTIERS[qi].softShadow) renderer.shadowMap.type = THREE.PCFShadowMap;
  /* A pinned tier keeps full resolution. nightdrive's equivalent pins a *rung*
     of the interleaved ladder, so pinning `medium` there also drops the render
     scale — which is right for a rescue setting and wrong for a comparison. The
     two ladders are separate here so that the tier table tools/bench.mjs prints
     measures the quality tiers and nothing else, and the resolution ladder is
     measured on its own by the @0.7res column. #scale overrides either way. */
  li = Math.max(0, LADDER.findIndex(p => p[1] === qi));
  ri = 0;
  applyScale();
  applyTier();

  let acc = 0;

  return {
    QTIERS,
    gpu: gpuName,
    software,
    /* Whether the harness clause fired, so a probe can assert that a capture
       was taken with adaptation off rather than assume it. */
    harness,
    get adapting() { return adapting; },
    get tier() { return QTIERS[qi].name; },
    get scale() { return curScale(); },
    get frameCap() { return frameCap; },

    /** Bracket the frame. Returns false when a frame cap says to skip it. */
    beginFrame(dt) {
      if (frameCap) {
        acc += dt;
        const budget = 1 / frameCap;
        if (acc < budget * 0.94) return false;
        acc = 0;
      }
      timer.begin();
      return true;
    },

    endFrame(cpu, dt) {
      timer.end();
      lastLive = performance.now();
      cpuMs = cpuMs ? cpuMs + (cpu - cpuMs) * 0.12 : cpu;
      const inst = 1 / Math.max(1e-4, dt);
      fps = fps ? fps * 0.9 + inst * 0.1 : inst;
      adapt();
      if (showOverlay) overlay();
    },

    get fps() { return fps; },

    resize() { applyScale(); },

    /** Used by tools/bench.mjs to walk the tiers on a real GPU. */
    setTier(name) {
      const i = QTIERS.findIndex(q => q.name === name);
      if (i < 0 || i === qi) return QTIERS[qi].name;
      qi = i;
      /* Quality only. The render scale is the other ladder and is left where it
         is, so a tier comparison is a comparison of tiers. */
      li = Math.max(0, LADDER.findIndex(p => p[1] === i));
      applyTier();
      return QTIERS[qi].name;
    },
    setScale(s) { scaleOverride = +s || 0; applyScale(); },

    /* ── the ladder as the governor actually walks it ─────────────────────
     *
     * Exposed because the tier table was being read as the answer to "does the
     * quality ladder reach the target" and it is not that question. setTier
     * changes the quality tier and deliberately leaves the render scale at 1.0,
     * so a `potato` row is potato at native resolution — a setting nothing ever
     * runs at. The governor's bottom step is rung 7, which is potato *and* a
     * 0.58 render scale, and the two differ by most of the frame on a
     * fill-bound scene. A ladder measured one lever at a time cannot say
     * whether the interleaved ladder lands inside the budget, and reporting
     * that it could not was how "the bottom rung is 55 fps" got written down.
     */
    get rungs() {
      return LADDER.map(([r, q], i) => ({ i, scale: RSCALE[r], tier: QTIERS[q].name }));
    },
    /** Move to rung `i` of the interleaved ladder — scale and tier together. */
    setRung(i) { scaleOverride = 0; gotoRung(i); return li; },

    /** Everything a benchmark wants in one object. */
    stats() {
      const i = renderer.info;
      const d = renderer.getDrawingBufferSize(_v2);
      const s = sceneCounts();
      return {
        tier: QTIERS[qi].name,
        /* The rung, not just the tier. A tier plus a scale is two numbers that
           happen to agree; the rung is the thing the governor actually holds,
           and a trace of it over time is the only way to see a ratchet. */
        rung: li,
        /* Enough of the governor's own state to tell a settled ladder from a
           jammed one. `probing` is true while a climb is on trial; `coolNext` is
           how many milliseconds until the rung above may be tried again, which is
           the number that used to be invisible and permanent. */
        probing: probeFrom >= 0,
        coolNext: li > 0 && cool[li - 1] ? Math.round(cool[li - 1] - performance.now()) : 0,
        scale: curScale(),
        buffer: [d.x, d.y],
        fps: +fps.toFixed(1),
        cpuMs: +cpuMs.toFixed(3),
        /* Null rather than 0 when the median is empty. It is empty for a fraction
           of a second after every rung change, because gotoRung flushes it, and
           a printed 0.00 in a trace reads as a measurement of a free frame
           rather than as the absence of one. */
        gpuMs: timer.available && timer.ms > 0 && performance.now() - lastLive < LIVE_MS
          ? +timer.ms.toFixed(3) : null,
        gpuTimerAvailable: timer.available,
        gpuTimerLive: performance.now() - lastLive < LIVE_MS,
        calls: s.calls,
        triangles: s.triangles,
        programs: i.programs ? i.programs.length : 0,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
        shadow: [sun.shadow.mapSize.x, sunNear.shadow.mapSize.x],
        post: post ? post.level : null,
        gpu: gpuName,
      };
    },
  };
}
