# Performance — System 7

What the frame costs, where it goes, and what was done about it.

This file exists because of one fact: **before this pass, nobody had ever measured
this scene on a GPU.** Every capture in this project renders headless through
SwiftShader, a CPU software rasteriser, deliberately, so that a render never takes
the graphics card away from someone playing a game on this machine. That was the
right call and it has not changed. Its cost is that every performance belief in
the project was inference, and some of it was wrong.

---

## 1. What the reference projects do that this one did not

### `jungle-trail` — measured from the first pass

The important thing about `jungle-trail` is not any single optimisation. It is
that **every system report in its build quoted a frame time in milliseconds,
measured on the real RTX 4060**, and the quality ladder was authored against those
numbers rather than against a guess.

Its harness has two backends (`tools/harness.mjs`), and the GPU one is the
*default*:

```
GPU_ARGS = [ '--use-angle=d3d11', '--enable-gpu-rasterization',
             '--ignore-gpu-blocklist', '--enable-zero-copy' ]
```

with a comment that is the whole trick: *"Headless Chromium defaults to
SwiftShader even when a GPU is present; each of these is needed to get it onto
the real adapter."* It still pins Chromium to four of twelve logical cores at
Idle priority — and notes that the GPU path is **cheaper** on the CPU than
SwiftShader, not more expensive, because the work moves off the CPU entirely.

Its `tools/perf.mjs` gets three things right that a naive timer gets wrong, and
all three are documented in its source as mistakes already paid for:

1. **Watching the framerate cannot work.** The loop is capped, so the browser
   reports 60 for anything that fits in 16 ms. The loop is paused and frames are
   driven by hand.
2. **`glFinish()` in the page is a lie.** Chromium runs WebGL over a command
   buffer into a separate GPU process; `finish()` returns when the queue has been
   handed over, not when the hardware has drained it. It measures how fast
   JavaScript can *submit* draw calls. The symptom was that *"adding
   post-processing appeared to make the frame faster, and ultra came out quicker
   than medium."* A one-pixel `readPixels` cannot return before the frame exists,
   so it is a real fence and costs nothing beyond the wait.
3. **Sequential A-then-B comparison charges the driver's clock ramp to whichever
   ran first.** Blocks are interleaved and the median of seven is reported.

It also learned to stop benchmarking at small sizes: *"at 640×360 a
fragment-bound cost is measured over an eighth of the pixels it really covers,
which flatters an expensive shader into looking free."*

**Real numbers from that build, on this machine** — adapter string confirmed as
`ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002808) Direct3D11 vs_5_0 ps_5_0,
D3D11)`, at 1600×900, loop paused, `readPixels` fence, median of seven:

| viewpoint | tier | frame ms | scene calls | frame calls | triangles |
|---|---|---|---|---|---|
| dense corridor t=0.34 | low | 5.82 | 480 | 978 | 6.6 M |
| dense corridor t=0.34 | high | 8.06 | 490 | 1051 | 6.60 M |
| dense corridor t=0.34 | ultra | 8.71 | 491 | 1071 | 6.60 M |
| ruins clearing t=0.86 | high | 6.05 | 342 | 775 | 5.29 M |
| falls t=0.96 | high | 6.07 | 223 | — | 2.63 M |

Three conclusions that bear directly on this project:

- **Geometry is not the cost.** 6.6 M triangles and a thousand draw calls
  including the shadow pass cost 6–9 ms. This scene's 2.19 M triangles across
  ~50 draw calls are a rounding error by comparison. The brief's suspicion was
  right and this is the evidence for it.
- **A ten-pass post-processing chain — half-res volumetric raymarching, SSAO,
  bloom, defocus, grade — cost 0.1 to 1.0 ms total.** Full-screen passes at
  1080p are simply not expensive on this card. Which means a *single* full-screen
  pass cannot be the problem here either, unless it drags a large buffer behind
  it. (It does. See §3.)
- **The scene pass dominates, and it is fragment cost.** Its own measurements of
  ablations — the ruins' entire 95 k triangles and 28 draw calls came in at
  "−0.14 to +0.39 ms, inside the noise floor" — kept pointing at shading, never
  at submission.

And the honesty note worth copying verbatim: *"the fps column the tool prints is
`1000 / frame ms` with the render loop paused — it is **headroom, not observed
framerate**."*

On **"optimised for every device"**: the actual answer is narrower and more useful
than it sounds. `jungle-trail` did *not* build a mobile port — it concluded that
*"6.6 million triangles, a thousand draw calls, massive plant counts, volumetric
effects … would overwhelm any mobile GPU"* and shipped a **capability gate**
(`src/mobile/`) instead: a screen explaining the requirement, with an "enter
anyway" button, plus touch controls. What makes it run well *on every desktop* is
the four-tier ladder plus device-pixel-ratio scaling, and nothing more exotic:

```js
const TIERS = {
  low:    { dpr: 0.75, shadow: 1024, shadowDist: 45, aniso: 4  },
  medium: { dpr: 1.0,  shadow: 1536, shadowDist: 60, aniso: 8  },
  high:   { dpr: 1.0,  shadow: 2048, shadowDist: 80, aniso: 16 },
  ultra:  { dpr: 1.25, shadow: 3072, shadowDist: 100, aniso: 16 },
};
```

with each subsystem given a `setTier(name)` that spends the budget its own way —
volumetric march steps 14/22/30, AO taps 8/12/14, mirror resolution 0.36/0.5,
defocus taps 6/8/12/16, particle counts. Plus: boot on `high` and never `ultra`,
because *"the first seconds of a load are the worst possible time to be measuring
performance"*; adapt down only after 1.6 s of sustained bad frames, because
*"reacting fast to frame time produces a renderer that oscillates between two
tiers, which looks far worse than either"*; and a hard 60 fps cap, because *"an
uncapped loop on an RTX-class card will happily render this at 300 fps and pull
150 W to do it, for a scene that is a walking pace nature documentary."*

Foliage specifics worth noting, since vegetation has just landed here:
`alphaTest: 0.42` with `side: DoubleSide`, one `InstancedMesh` **per species per
ground tile** so that a tile off screen is one frustum-culled draw call rather
than a full instance buffer submitted anyway, a per-species `cull` distance and a
two-level LOD, and a `LOD_DAMP` shader injection that sharpens alpha against the
mip level so distant leaves dilate instead of eroding into holes.

### `nightdrive` — the governor, and the part `jungle-trail` lacks

`nightdrive` (`index.html`, ~line 5404 onward) has the piece worth porting
directly: **resolution and quality are separate ladders, interleaved into one
degradation order.**

```js
const RSCALE = [1.0, 0.86, 0.74, 0.62, 0.52];
const PERF   = [ [0,0],[1,0],[1,1],[2,1],[2,2],[3,2],[3,3],[4,3] ];
```

*"Degradation order: shed pixels first because that is the least visible, then
start shedding world. Interleaved so neither runs far ahead of the other."*

Everything around it is a scar from something that went wrong, and each is worth
having:

- **Multi-step descent.** *"It stepped one notch at a time, so a machine running
  at 12 fps needed the better part of half a minute to reach a setting it could
  actually hold."* A machine at a fifth of target now drops three rungs at once.
- **A floor that only lifts slowly.** `perfFloor` — a setting that has already
  failed once is not tried again until after a long clean run, so the governor
  settles instead of hunting.
- **Climbing needs proof other than fps.** With a frame cap, a machine with
  triple the power it needs still reads exactly 60. So the upward test is
  "hitting the cap *and* a short CPU frame".
- **Boot guess from the adapter string**, because *"adapting down works, but it
  only works after the fact: an integrated laptop GPU opening on high spends its
  first seconds at single-digit framerates, which is … the state most likely to
  lose the context outright."* SwiftShader is explicitly detected and pinned.
- **Tier changes are queued, not applied at once**, because a several-hundred-
  millisecond re-mesh freeze *"lands on a machine that is already struggling, and
  a long enough stall trips the display driver's watchdog — which is the 'it lags,
  then goes black' the tier change was supposed to prevent."*
- **The shadow filter is chosen once at boot and never changed**, because
  swapping it recompiles every material and that stall costs more than it saves.
- `#high/#medium/#low/#potato` pin a tier — which is what the harness comment in
  this project's own `tools/harness.mjs` is referring to when it mentions
  `#medium`. That comment describes `nightdrive`. **This project had no tier
  system at all.**

### What `sedona-sunset` had, before this pass

Nothing of any of it:

- `renderer.setPixelRatio(1)` and a fixed `setSize`. No render scale.
- No quality tiers, no adaptation, no `setTier` on any system.
- No frame cap. On a 200 Hz panel `requestAnimationFrame` fires every 5 ms.
- No LOD or draw-distance control except the clast material's own pixel-radius
  fade, which is a visual filter and not a budget.
- No instrumentation beyond `renderer.info` counts in `__game.info()` — no frame
  time, no GPU time, no per-pass cost, no on-screen readout.
- Both particle clouds run with `frustumCulled = false`, so every one of 56 000
  point sprites is vertex-shaded whether or not it is in front of the camera.

The failure mode this produces on a 200 Hz display is specific and matches the
complaint exactly. rAF fires every 5 ms. A frame that costs 11 ms misses every
other vsync and presents at 100 fps; a frame that drifts around 10 ms alternates
between 100 and 200. That reads as stutter even when the average is comfortable,
and no amount of "the average is 120" makes it feel smooth. The scene did not
need to be fast so much as it needed to be able to *choose* how fast to be.

---

## 2. Measuring it, without a GPU

Two instruments, both new.

### `tools/shadercost.mjs` — static fragment cost

`tools/glslcheck.mjs` already parses the shader template literals to validate
them. This walks the same literals and counts what sets the price of a pixel:
texture fetches, how many are unconditional, loop trip counts multiplied out,
derivative calls, and a crude ALU proxy. Helper functions are charged to their
call sites and resolved transitively, so a triplanar sampler costs its three
fetches at each of the four places it is called rather than once where it is
declared.

It is not a compiler and does not pretend to be — it cannot see dead-code
elimination and has no idea what share of the screen each material covers. What
it gives is a number that moves when the shader moves, which is what was missing.

```
node tools/shadercost.mjs src/*.js
node tools/shadercost.mjs --detail src/terrain.js     # every fetch, with its gate
```

### `tools/bench.mjs` — real GPU frame time

The one tool in this project that runs on the real adapter by default, and it
does so through the switch `tools/harness.mjs` gained mid-pass (`RENDER_GPU=1` or
a `.gpu` file in the root) rather than keeping a second copy of the launch flags —
those flags are fiddly enough that a divergent copy would end up measuring a
different browser than the one that draws the captures. The fence, the
interleaving and the medians are `jungle-trail`'s.

It does not take the render mutex. A GPU bench and a SwiftShader capture are not
competing for the same device, and making a one-command benchmark queue behind a
twenty-minute capture would mean nobody ever runs it — but it prints a warning if
a capture is live, because the shared four-core budget will still show up in the
figures. It reports, per viewpoint, the full frame time and the frame time with each
major system ablated, then walks the tier ladder. It also reads the GPU's own
answer through `EXT_disjoint_timer_query_webgl2` where the driver exposes it.

**I have not run it.** It touches the GPU, and the standing instruction is that
renders here go through SwiftShader so as not to interrupt whoever is at the
keyboard. See §6 for the command.

### `#perf` / F3 — live readout

`src/perf.js` builds an overlay reporting tier, render scale, fps, CPU frame ms,
GPU frame ms, draw calls, triangles, programs, textures, shadow map sizes,
shimmer sample count and particle counts. F3 toggles it; `#perf` opens it at
boot. This is the zero-tooling path: open the page, press F3, read the numbers.

---

## 3. Where the frame goes

Measured statically; the confidence attached to each item is stated rather than
implied.

### The terrain fragment shader — the largest single cost, high confidence

`tools/shadercost.mjs` on the pre-change source:

```
src/terrain.js      fetch  uncond   cond    loop   deriv     alu
        SURFACE        37      23     14       8       4      43
```

**Twenty-three texture fetches that every ground pixel paid, whatever it was
looking at.** Three of them were doing nothing at all on most of the screen:

| block | fetches | dead where |
|---|---|---|
| rock triplanar (`uRockA`, `uRockM`, `uRockN` × 3 planes) | 9 | `rockW == 0` — the entire wash floor, every terrace, all the foreground of the low views |
| grain-shadow march (`uDirtM`, 8 taps + base) | 9 | any slope past ~20°, and past the footprint where grains stop resolving — most of the ground in a long shot |
| sand triple (`uSandA/N/M`) | 3 | outside a slack-water lobe, which is a few percent of the floor |

The terrain is the largest thing on screen in five of the eight standard
viewpoints. At 1080p, with the ground covering say 55 % of the frame, twenty-three
fetches is on the order of 26 million texture reads per frame from that shader
alone, most of them from 1024² maps with full mip chains. That is where the frame
time was going.

The previous builder left the note: *"if System 7 finds headroom is tight,
branching the rock triplanar behind a `rockW` test is the obvious first cut."*
Correct, and it was blocked on a real problem — see §4.

### The heat-shimmer buffer — large, high confidence, and not visible from the code

`src/atmosphere.js` draws the **entire scene** into its own render target so it
can distort it:

```js
this.samples = 4;
this.rt = new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, depthBuffer: true, depthTexture: depth,
  samples: this.samples,
});
```

RGBA16F is 8 bytes a pixel. At 1920×1080, four samples:

- colour: 1920 × 1080 × 8 × 4 = **66 MB**, written and then resolved every frame
- depth: a 32-bit `DepthTexture` at 4 samples = **33 MB** more

Around 100 MB of framebuffer traffic per frame, before a single texture is read.
At 200 fps that is 20 GB/s of pure resolve bandwidth on a card with about 272
GB/s to spend. This is not the *shader* being expensive — the distortion pass
itself is four fetches — it is the buffer behind it.

Compounding it: the canvas was created with `antialias: true`. While the shimmer
pass owns the frame the canvas receives exactly one full-screen quad, so canvas
multisampling could not affect a single pixel; it was buying an identical picture
in exchange for a multisampled RGBA8 backbuffer resolved every frame.

### Particles — moderate, medium confidence

26 000 dust motes and 30 000 saltation grains, both `Points` with
`frustumCulled = false`. Every vertex is shaded every frame regardless of where
the camera is pointing, and the dust vertex shader evaluates a noise field and a
shaft term per point. Fill is genuinely small — both clamp `gl_PointSize` to
about a pixel and then attenuate alpha to compensate — so this is a vertex and
blend-state cost rather than a fill cost. `jungle-trail` measured its own spray
at effectively zero (5 620 sprites, 0.00–0.19 ms) which suggests the fill really
is free; 56 000 with culling off is a different proposition and is worth the
measurement.

### Alpha-tested foliage — unquantified, and honestly reported as such

`src/vegetation.js` and `src/juniper.js` use `alphaTest` 0.40–0.42 with
`side: DoubleSide`. `DoubleSide` doubles the fragment work on every leaf card,
and `alphaTest` writing depth from a discarding shader defeats early-Z for those
draws. Against that: `jungle-trail` runs the same construction over a *far*
denser canopy at 6.6 M triangles and lands at 8 ms, so the technique is clearly
affordable on this card. **I did not touch it.** Systems 3 and 5 may be live in
those files, the vegetation landed one pass ago, and I have no measurement
saying it is a problem. `tools/bench.mjs` has a `-veg` ablation column for
exactly this question.

### Shadows — already well handled

Two cascades, 4096 and 2048, and crucially `renderer.shadowMap.autoUpdate =
false` with redraws driven by `syncShadow()` only when the quantised rig actually
moves — so a standing player pays nothing and a walking one pays intermittently.
The map sizes are now on the tier ladder, but nothing here needed fixing.

### Geometry — not the problem

2.19 M triangles, ~50 draw calls. `jungle-trail` does three times the triangles
and twenty times the draw calls in 6–9 ms on this exact card. There is no case
for LOD work here, and I did none.

---

## 4. What changed

### `src/terrain.js` — branch the three dead blocks

Unconditional fetches per ground pixel: **23 → 10**. Total work unchanged at 37;
27 of them are now behind a gate that is closed on most of the screen.

The reason this had not been done is genuine and is the interesting part.
`rockW`, `sandW` and the slope/footprint product all vary per fragment, so a 2×2
quad straddling a rock/floor boundary diverges — and an
implicitly-differentiated texture fetch inside divergent control flow has **no
defined derivative**, which is why the shader sampled everything unconditionally
and said so in a comment.

The fix is to stop differentiating implicitly. `dFdx(vWPos)` and `dFdy(vWPos)`
are hoisted to the top of the shader, where every fragment in the quad reaches
them whatever it later does, and the gated fetches become `texture2DGradEXT`
with those gradients handed in. The gradient of a planar projection scaled by a
constant is that constant times the gradient of the position, so one pair of
vectors covers all three triplanar planes and all three maps.
`texture2DGradEXT` is three's own alias for `textureGrad`, defined in the WebGL2
prefix of every GLSL1 program it compiles, so this needs no extension handling.

Two details worth recording:

- The LOD *bias* the anisotropic sand and dirt samples carried (`texture2D(t, uv,
  aniso)`) has no `textureGrad` equivalent, so it becomes a gradient scale:
  `lod` is `log2` of the gradient, so multiplying the gradient by `exp2(bias)`
  adds the bias. `aniso` is negative, so it sharpens exactly as before.
- The pre-existing steep-reprojection branch already had the
  undefined-derivative problem — six fetches inside `if (steep > 0.006)` — and is
  converted at the same time. That is a correctness fix, not a performance one.

**No output value changes.** Every gated block reduces to the identity the
unbranched code computed at weight zero: `mix(a, b, 0.0) == a`.

**Expected saving.** On a pixel of open wash floor the shader goes from 23
unconditional fetches to 10, with the rake march opening only within about a
dozen metres and the rock and sand blocks staying shut. Taking the terrain at
half the frame, that is roughly a 25–35 % cut in the frame's total texture reads.
I will not put a millisecond figure on it without §6.

### `src/main.js` — `antialias: false`

Provably identical output while the shimmer pass owns the frame, for one fewer
full-frame multisample resolve. The only configuration where it matters is the
bottom tier, which switches the shimmer off — and a tier that gives up the heat
haze to hold 30 fps is not a tier that wants to pay for multisampling either.

### `src/atmosphere.js` — `setShimmerSamples(n)`

One additive method, committed on its own so System 5 sees it immediately. Lets
the governor spend the 100 MB/frame identified in §3: four samples at the top
tier, two at medium, none below. Halving the sample count halves both the colour
and the depth traffic.

### `src/perf.js` — the governor (new)

`nightdrive`'s structure with `jungle-trail`'s hysteresis.

```js
QTIERS = [
  { name:'high',   shadowFar:4096, shadowNear:2048, shimmer:true,  samples:4, dust:1.00, salt:1.00, softShadow:true  },
  { name:'medium', shadowFar:3072, shadowNear:2048, shimmer:true,  samples:2, dust:0.70, salt:0.70, softShadow:true  },
  { name:'low',    shadowFar:2048, shadowNear:1024, shimmer:true,  samples:0, dust:0.45, salt:0.40, softShadow:false },
  { name:'potato', shadowFar:1024, shadowNear:1024, shimmer:false, samples:0, dust:0.25, salt:0.20, softShadow:false },
];
RSCALE = [1.0, 0.88, 0.78, 0.68, 0.58];
LADDER = [[0,0],[1,0],[2,0],[2,1],[3,1],[3,2],[4,2],[4,3]];
```

**The top tier is byte-identical to what this scene has always been.** 4096 and
2048 are the sizes `sky.js` already configures; shimmer on at four samples is the
existing default; full particle counts. So `high` is not a new setting, it is the
current one given a name.

The ladder opens with **two pure resolution steps** before any quality is touched,
which is a departure from `nightdrive`'s interleave and is deliberate: this frame
is overwhelmingly fragment-bound — a twenty-fetch shader over most of the screen,
a half-float MSAA buffer — where `nightdrive` was draw-call- and vertex-bound on
integrated parts. Fewer fragments is the lever that actually works here, and on a
200 Hz panel a slightly softer image is a far better trade than a dropped frame.

Particle counts are spent through `geometry.setDrawRange`. The data is already
resident, the particles are distributed by a hash over the index so any prefix is
still an even scatter, and it costs one number — and because both clouds have
frustum culling off, it is the only thing that reduces their vertex cost at all.

The governor reaches everything it touches through an object it was handed or
through the scene graph by name (`scene.getObjectByName('dust')`), so no other
system's file has to know it exists. `src/main.js` gained an import, a
constructor call, two lines in the frame loop and one API field.

**The clause that protects every existing capture:** under a software rasteriser
the governor pins the top tier and disables adaptation outright. Without it,
SwiftShader — tens of seconds a frame — would walk the tier to the bottom within
`shoot.mjs`'s four-second settle, and every measured gate in `CONTRACT.md` would
be measured against a picture nobody with a GPU will ever see. `tools/harness.mjs`
cannot be modified and passes no tier, so the default has to be the safe one.

Frame cap is **off by default**. A 200 Hz gamer has not asked to be capped at 60.
The adaptive target is instead the panel's own refresh period, measured from the
loop's shortest observed interval, clamped to 144 — past which the frame is
already smooth and what the setting buys is heat. `#fps=N` enables a hard cap for
anyone who wants one.

Descent takes up to three rungs at once when the machine is far from target,
climbs one at a time, and `floorI` stops it returning to a rung that has already
failed until after a long clean run.

---

## 5. Visual gates

`CONTRACT.md`: rock `hf/lf` ≥ 0.55, rock hue ≈ +16.5°, rock saturation
0.627/0.667.

The terrain change is argued to be an identity transformation rather than a
tuning, so the expectation is not "still passes" but "unchanged to the last
digit". Measured with `tools/grad.mjs`, `tools/sat.mjs` and `tools/hue.mjs` on
`wall_lit`, `wall_shade` and `wash_mid` — see §7 for the figures.

Note that `hf/lf` and the hue/saturation gates are all measured on **rock
regions**, and the rock material in those windows is `src/rock.js`, which I did
not modify. The terrain shader contributes to the `wash_mid` floor window and to
the wall *ramp* where `rockW > 0`, which is precisely the region where the gate is
open and the code path is unchanged.

---

## 6. Benchmark this on the real GPU

One command, about a minute, headless, still pinned to four of twelve cores at
Idle priority:

```
cd c:\Code\sedona-sunset
node tools/bench.mjs --w 2560 --h 1440
```

Use your real desktop resolution. Benchmarking a fragment-bound scene at a small
size measures the expensive shader over a fraction of the pixels it really covers
and flatters it into looking free — `jungle-trail` learned that one the hard way.
Default is 1920×1080 if you leave the flags off.

Send back **all** of the output. Specifically:

1. **The adapter line.** It should name the RTX 4060 and Direct3D11. If it says
   SwiftShader the GPU flags did not take, the numbers mean nothing, and that is
   itself the thing to report.
2. **`gpu timer query: available` or not.** Decides whether GPU time can be read
   directly or only inferred from wall clock.
3. **The ablation table** — `full`, `-shimmer`, `-particles`, `-shadow`, `-veg`,
   `@0.7res` per viewpoint. This is the answer to "where is the frame time", and
   every subsequent decision depends on it.
4. **The tier ladder table** — whether `high → potato` actually buys what it
   claims. If `medium` is not meaningfully cheaper than `high`, the ladder is
   miscalibrated and I would rather know than guess.

If it fails to launch or falls back to software, this also works and needs no
tooling at all:

```
node tools/serve.mjs
```

then open the page, press **F3**, walk around for ten seconds, and send a
screenshot or the text of the overlay. Add `#perf` to the URL to have it open at
boot, and `#high`, `#medium`, `#low` or `#potato` to pin a tier and compare them
by hand. (I have not run this either — it needs a browser window.)

---

## 7. Measurements after the change

### The reference, from the last capture before this pass

`shots/sys4b_*`, captured 11:04, which is System 4's lighting work and includes
everything up to `c7d22c5` and none of this pass:

```
file                        region      grad     grad@4   hf/lf   L mean  L sd
sys4b_wall_lit              midwall    0.0110   0.0190    0.58   0.159   0.030
                            upper      0.0123   0.0216    0.57   0.148   0.040
sys4b_wall_shade            face       0.0137   0.0228    0.60   0.134   0.037
sys4b_wash_mid              wall       0.0067   0.0114    0.59   0.366   0.032
                            floor      0.0134   0.0258    0.52   0.121   0.039

sat   wall_lit rock lit 0.515   wall_shade rock 0.493
hue   wall_lit 12.6°  midwall 13.3°   wall_shade 11.6°
```

Every rock region is at or above the 0.55 gate. Two things to flag that are not
mine and that somebody should look at: **saturation is 0.515/0.493 against the
0.627/0.667 recorded in `CONTRACT.md`, and hue is 12.6° against +16.5°.** Both
drifted under the lighting and atmosphere work of the last few passes. The
contract numbers are stale, not the code; I am recording it here because the
gate as written now reads as failing and the cause is upstream of this pass.

`shots/sys4b_*` is therefore the right comparison for my change — not the
contract's absolute figures, which are measuring a different lighting rig.

### What is established

**The shaders compile and the scene renders.** `src/main.js` calls `renderOnce()`
*before* it assigns `window.__game`, with the comment "compile everything before
the harness starts timing". So a shader that failed to compile would throw there,
`__game` would never appear, and the harness would time out waiting for it. Three
separate runs got past that point and printed `boot`, which means every program
in the scene — including the rewritten terrain fragment shader with its six
`texture2DGradEXT` sites — compiled and drew a frame.

The alias is confirmed present in the installed three (0.180.0):
`#define texture2DGradEXT textureGrad` is unconditional in `prefixFragment` for
every WebGL2 GLSL1 program, so this needs no extension handling. Macro names
match whole identifiers, so the `#define texture2D texture` that precedes it in
the same prefix does not interfere.

**`tools/wallprobe.mjs`, 5.5 seconds, no browser:**

```
  mpp     grad     grad@4   hf/lf   L mean  note
 0.020  0.0073   0.0105    0.70   0.370   close face  (wall_shade)
 0.090  0.0057   0.0085    0.67   0.370   mid wall    (wall_lit)
 0.350  0.0056   0.0083    0.68   0.370   far plane   (sun_gap)
```

0.67–0.70 against a gate of 0.55, at every footprint. This is the rock map
spectrum shaded through a real mip pyramid, and `hf/lf` is a property of those
maps far more than of anything the scene does — which is exactly why the tool
exists. `src/rock.js` is untouched by this pass, so this is the expected result
and it confirms the rock pipeline is intact.

**`tools/shadercost.mjs`, before and after:**

```
BEFORE  src/terrain.js  SURFACE    37 fetches, 23 unconditional
AFTER   src/terrain.js  SURFACE    37 fetches, 10 unconditional
```

Same total work, thirteen fewer fetches on every pixel that is not looking at
rock, sand, or ground close enough to resolve grain shadows.

### What is not established, and why

**I could not obtain a render.** Three capture attempts were made — 28, 26 and
30+ minutes — and all three died after boot without producing a PNG or an error
message. This is not the change: the same signature appeared on the first attempt,
which predates the governor entirely, and `shots/sys2a.log` shows System 2's own
capture running for an hour with no output either. Three other agents were
capturing concurrently for the whole window, on a machine whose harness pins every
render to four of twelve logical cores at Idle priority by design. Under three-way
contention that is a little over one core each for a software rasteriser, and
nothing completes.

`s7c` (`wash_mid`, `wall_lit`) is running detached so that it survives, writing to
`shots/s7c.log`. `wash_mid` is the right single view: its `wall` window is rock and
its `floor` window is terrain, so one capture exercises both the untouched path and
the changed one. When it lands:

```
node tools/grad.mjs shots/s7c_wash_mid.png shots/s7c_wall_lit.png
node tools/sat.mjs  shots/s7c_wall_lit.png
node tools/hue.mjs  shots/s7c_wall_lit.png
```

The prediction, and it is a strong one rather than a hope: **`wash_mid` floor
`hf/lf` = 0.52 and `wall` = 0.59, unchanged from `sys4b` to the second decimal.**
Every gated block reduces to the identity its unbranched form computed at weight
zero, and each gate opens at a weight — 0.002 for rock, 0.0015 for sand — whose
contribution is a fifth of one 8-bit level. If the floor figure moves at all, the
argument in §4 is wrong and the change should come out.

One confound to note: `05cf0a5` (System 5, shimmer cell scale and near-mote cap)
landed between `sys4b` and `s7c`, and the shimmer is a screen-space warp of the
whole frame, so a small movement in any window may be theirs rather than mine.

---

## 8. What could not be done without real-GPU numbers

- **A millisecond figure for anything.** Every saving above is argued from a
  static fetch count and a bandwidth calculation. The ratios should be right; the
  absolute numbers are unknown, and the ablation table is what turns them real.
- **Calibrating the tier ladder.** The tier deltas are reasoned, not measured. If
  the frame turns out to be dominated by the shimmer buffer then `medium`'s drop
  from four samples to two is most of the win and the shadow sizes are noise; if
  it is dominated by terrain fragments then the render-scale rungs are doing all
  the work and the quality rungs could be gentler. The ladder should be re-tuned
  once there is a table.
- **Whether the foliage is a problem.** `-veg` in the ablation table settles it.
  If it costs more than a millisecond, the next moves are a per-tile
  `InstancedMesh` split for real frustum culling, dropping `DoubleSide` in favour
  of two-sided lighting in the shader, and `jungle-trail`'s mip-aware alpha
  sharpening.
- **`src/rock.js`, which is next.** It still has **15 unconditional fetches**. The
  visible candidate is `rkN2 = domNormal(uRockN, pF, gN, sF)`, the fine-scale
  normal, which is weighted by `grainF` and therefore free to gate at distance
  the same way the terrain's rake march now is. I deliberately did not touch it:
  the `hf/lf` gate lives precisely on those grain and grit layers, `rock.js` is
  115 KB of tightly-measured shader owned by System 2, and doing it blind with no
  frame time to justify the risk is the wrong order of operations.
- **Whether 56 000 unculled point sprites matter.** `-particles` answers it. If
  they do, the fix is `frustumCulled = true` with a bounding sphere, which is
  free, rather than the draw-range trimming the tiers do now.

---

## 9. The frame was 160 shadow comparisons per ground pixel

Written after the second pass, with the GPU numbers §6 asked for. The short
version: the frame went **30.5 ms to 15.7 ms at 2560×1440 on the top tier**, the
governor's ladder now reaches 120 fps at rung 4 and 188 fps at its floor, and
**none of it was where §3 said it would be.** Everything §3 predicted was
reasoned from a static fetch count, and the static fetch count was measuring the
wrong thing by a factor of ten.

### 9.1 An object ablation cannot price a shader

`tools/bench.mjs`'s table proved the frame fill-bound and could not say whose
fill. Every ablation it has hides a *mesh*, and that is the wrong instrument
twice over: hiding the terrain does not price the terrain shader, because
whatever stands behind it has to be shaded instead, and the two largest fragment
consumers in the frame — the ground and the sky dome — are exactly the two that
cannot be hidden without changing which pixels exist.

`tools/fillcost.mjs` ablates the *shader* and leaves the object. Each material's
fragment program gets an early `gl_FragColor = <constant>; return;` spliced into
the top of `main`, which the driver reduces to a write. Same geometry, same
vertex program, same draw order, same overdraw, same shaded-pixel count — only
the per-pixel work is gone.

At 2560×1440, before any of this pass's changes:

| view | full | −ground | −rock | −sky | −clasts | −veg | −particles | −allScene | −msaa | @0.7 |
|---|---|---|---|---|---|---|---|---|---|---|
| `wash_mid` | 30.66 | **6.46** | 29.17 | 30.60 | 30.24 | 29.83 | 30.57 | 4.24 | 23.37 | 19.76 |
| `sun_gap` | 31.20 | **7.13** | 29.09 | 31.13 | 30.96 | 30.13 | 31.14 | 4.28 | 24.60 | 20.06 |
| `wall_lit` | 19.00 | **5.98** | 17.24 | 19.03 | 18.81 | 18.39 | 19.00 | 4.02 | 16.00 | 11.47 |

**The terrain fragment shader is 24.2 ms of a 30.7 ms frame** — 79% — against
1.5 for all eighteen rock meshes, 0.8 for the vegetation and nothing measurable
for the sky, the clasts or the particles. The multisampled half-float target is
the only other item over a millisecond, at 7.3.

Read `allScene` beside `@0.7`: with every scene material neutered the frame is
4.2 ms, and fitting the resolution columns gives fixed 4.5 ms plus 21.4 ms of
fill. That 4.5 is vertex processing, the resolve and the post chain, and it is
the ceiling nothing in a fragment shader can go below.

### 9.2 It was not the texture fetches, and it was never going to be

`tools/terrcost.mjs` does the same thing one block at a time *inside* the
terrain shader, by rewriting the assembled fragment source and re-timing. On the
30.5 ms build, at `wash_mid`:

| block | saving |
|---|---|
| the four footprint shadow taps | **18.45 ms** |
| the centre shadow tap | 5.31 ms |
| wall rock triplanar (9 fetches) | 1.11 |
| every band-limited sine and its `fwidth` | 0.88 |
| the second dirt tile (3 fetches) | 0.44 |
| the raking grain march (9 fetches, 8 looped) | 0.40 |
| steep reprojection (6 fetches) | 0.40 |
| grit, sand, macro, crack, bedform, strat | 0.06 – 0.17 each |

**Twenty-three of the twenty-four milliseconds are in five shadow lookups.** The
forty-one texture fetches this project has been worrying about since the first
perf note — the ones §3 branched, correctly, and §4 counted 23 → 10 of — are
about two milliseconds between them, and the whole of §4's terrain work is worth
less than a tenth of what one unexamined wrapper was costing.

The arithmetic, once seen, is not close. `getShadow` under `PCFSoftShadowMap` is
**sixteen** `texture2DCompare` calls, and under `PCFShadowMap` seventeen — the
soft variant is not a cheaper filter, it is a bilinear-weighted one at the same
tap count. `src/terrain.js` wraps every shadow lookup in a footprint filter that
calls it five times. The scene has two shadow-casting directional lights. That
is **160 shadow texture reads per ground fragment**, and the ground is most of
most frames.

### 9.3 The fix, and why it does not move a pixel

The four offset taps exist to estimate the *mean* shadow coverage over a pixel's
footprint, and the estimator was hugely oversampled: the offsets are 2.6 texels
while `PCF_SOFT` already integrates a 4×4 neighbourhood, so five kernels
covering roughly nine texels square were being sampled eighty times per light.

Each offset becomes a **bilinear 4-tap** coverage lookup. It samples the same
neighbourhood at a quarter of the cost and it stays *interpolated* rather than
binary, which matters: a single hard `texture2DCompare` per offset would be
cheaper again and is precisely the bimodal sample the wrapper was built to
remove. The centre tap is left as the stock `getShadow`, so the penumbra sized
from the sun's angular diameter is bit-identical.

The block is also gated on its own weight. At `wide = 0` the offsets *and* the
mix weight are both zero, so the four taps return `s` and are then discarded:
skipping them is an exact identity, not an approximation of one. The branch is
safe with implicit-LOD fetches inside it because a shadow map has no mip chain —
three builds it `NearestFilter`, `generateMipmaps` off — so there is no
derivative for divergent flow to leave undefined.

Per light: 80 comparisons become 32. Measured, `wash_mid` **30.66 → 16.03 ms**,
`sun_gap` 31.20 → 15.83, `wall_lit` 19.00 → 11.39.

### 9.4 Verified as a pair, in one page load

`CONTRACT.md`: *two captures are not a pair.* `tools/shadowpair.mjs` renders both
halves from one page — one module set, one set of procedural textures, one sun —
with a single substitution in the assembled fragment shader between them, so the
control is the old estimator and nothing else differs. It reports the count of
substitution sites it actually hit, because a change that did nothing and a
change that was never applied look identical.

All eight standard views, 1280×720, on the GPU:

| | mean abs Δ | max Δ | px ≥ 4 cv | frame L before → after |
|---|---|---|---|---|
| `wash_low` | 0.25 cv | 131 | 1.74% | 77.74 → 77.66 |
| `wash_mid` | 0.29 | 99 | 2.00% | 76.05 → 76.08 |
| `ground` | 0.05 | 127 | 0.36% | 91.49 → 91.48 |
| `wall_lit` | 0.29 | 119 | 1.79% | 55.22 → 55.23 |
| `wall_shade` | 0.06 | 86 | 0.46% | 44.78 → 44.80 |
| `bend` | 0.09 | 88 | 0.73% | 45.09 → 45.09 |
| `juniper` | 0.35 | 130 | 2.67% | 68.38 → 68.26 |
| `sun_gap` | 0.31 | 134 | 2.08% | 81.52 → 81.62 |

The maxima are individual pixels on a cast-shadow edge changing side, which is
what any change of shadow estimator does; the population statistic is a mean
absolute difference of a third of a code value and a whole-frame luminance that
moves by at most 0.12 of one.

Every contracted figure holds. `grad` and `hf/lf` are identical in all twelve
windows across the eight views, to the digit `grad.mjs` prints — the largest
movement anywhere is the `juniper` wall window at 0.0289 → 0.0286, and that
window has vegetation in it. Saturation and hue likewise: the biggest excursion
in the set is `sun_gap` floor mid saturation 0.568 → 0.566, and lit rock in
`wall_lit` reads 0.687 both sides at hue 14.6°. **The shadow gate is 0.211
before and 0.211 after** — shaded 11.7 cv over sunlit 55.6 — which is the one
number most at risk from touching a shadow filter and it does not move.
`shadowpair.mjs` reports no page errors, so the frames contain the geometry they
are supposed to.

### 9.5 The ladder was being measured one lever at a time

`perf.setTier` moves the quality tier and deliberately leaves the render scale at
1.0. That is the right control for "what does a tier cost" and the wrong answer
to "does the fallback reach the target", because the governor descends an
*interleaved* ladder whose bottom step is potato **and** a 0.58 render scale. On
a fill-bound frame those two differ by most of the frame. The recorded "the
bottom rung of the governor is 55 fps" was potato at native resolution — a
setting the governor never selects.

`perf.js` now exposes `rungs` and `setRung`, and `bench.mjs` prints the rung
table beside the tier table. With a table to read, the interleave stops being a
reasoned guess. Per rung at `sun_gap`, 2560×1440:

| | 1.00 | 0.88 | 0.78 | 0.68 | 0.58 |
|---|---|---|---|---|---|
| high | 15.73 | 13.27 | 11.46 | 9.88 | 8.51 |
| medium | 13.33 | 11.28 | 9.78 | 8.46 | 7.31 |
| low | 10.75 | 8.98 | 7.68 | 6.54 | 5.56 |
| potato | 9.99 | 8.34 | 7.13 | 6.06 | 5.14 |

Read down a column rather than along a row. Once the shadow filter stopped being
three quarters of the frame, a tier step became worth about as much as a scale
step and costs less picture than one. The order sheds one resolution step and
then alternates, so the 8.33 ms budget is reached at **low / 0.78 — 1997×1123**
where the old order reached it at medium / 0.68 — 1741×979. Same budget, 34%
more pixels. The trade is MSAA for resolution and it is the right way round,
because System 7's along-edge resolve runs at full strength on every rung
precisely so the samples-0 rungs are not left bare.

### 9.6 `bench.mjs`'s `-shadow` column was measuring nothing

Recorded because it is the eleventh instrument failure on this project and it
cost the diagnosis directly. `renderer.shadowMap.enabled` is folded into
`USE_SHADOWMAP` when a program is compiled, and three does not relink on a
runtime change. So flipping it stopped the shadow *maps* being redrawn — which
was already free, since `shadowMap.autoUpdate` is false and a static camera
redraws no cascade — while every lit fragment went on sampling them exactly as
before. The column read 30.54 against a full frame of 30.49 and was written down
as *"shadows, particles and the whole post chain are inside the noise"*, at a
moment when the shadow lookups were 23 of those 30.49 ms.

It now forces every material to relink, in the six warm-up frames rather than in
the timed block, and reads 16.68 against 10.63.

The general form is worth keeping: **a compile-time define toggled at runtime is
an ablation that reports zero for something enormous.** Anything gated by a
`#define` needs `material.needsUpdate` beside it, or the column is a no-op with
a plausible number attached.

### 9.7 Where the remaining time is, and what it would cost to take

At the top tier, 2560×1440, after this pass:

| | ms |
|---|---|
| whole frame, `wash_mid` | 16.0 |
| terrain fragment shader | 9.1 |
| — of which its centre shadow tap | 4.0 |
| — of which the footprint taps | 0.6 |
| — the rest of the material | ~4.5 |
| the 4× half-float target | 3.9 |
| rock | 1.8 |
| vegetation | 1.0 |
| the marched in-scatter | 0.8 |
| fixed: vertex, resolve, post chain | ~4.5 |

Three honest observations and no more work done on them:

- **The centre shadow tap cannot be cut without changing the picture.** It is
  sixteen comparisons across two lights and it carries the penumbra. Halving it
  means `PCFShadowMap` — which is seventeen taps, so not a saving — or fewer
  shadow-casting lights, which is System 4's light rig.
- **The fixed 4.5 ms is now 28% of the frame**, where when the geometry ceiling
  was declared the wrong axis it was 15%. That does not make the ceiling right —
  shaving triangles to reach 3 M still buys nothing measurable — but it does mean
  that the *next* axis after resolution is vertex cost, and 2.25 M of the 3.97 M
  triangles are clast instances. It should be measured before it is touched.
- **The 3.9 ms multisampled target is a top-tier feature and the ladder already
  spends it.** Dropping it at `high` would be removing a feature to buy frame
  time, which is the one thing this pass was told not to do.

## 10. Re-benched on the shipping build, because the penumbra moved underneath it

§9 was measured while five other systems were committing. Four changes have landed
on or beside the shadow path since, and one of them lands on the exact term §9
optimised: System 4's blocker-distance penumbra (`639309d`, `543ea94`), which
replaces three's fixed kernel with a search-plus-disc filter sized from the sun's
angular diameter. The others are System 1's grazing bound in `bumpFrom`
(`af365e8`), System 2's settled rock, System 4's astern sky aperture (`4ac9877`),
System 5/7's fill doorway and silhouette gate (`3f1003a`, `7868b5d`).

The headline number in a delivery note has to come from the build that ships, so
everything below was re-run on `fa8b9ec`.

### 10.1 The penumbra was already in the tree, and the table reproduces

Worth establishing first, because it changes what the re-bench is *for*.
`639309d` landed 04:29 and `543ea94` at 04:46; §9's fix is `4d72ec6` at 04:56 and
its bench ran 05:08–05:11. So §9's figures were **always** measured on the
penumbra path — the re-bench is a confirmation, not a correction.

It confirms. 2560×1440, median of 7 blocks of 30, loop paused:

| | §9 (05:08) | HEAD (06:16) |
|---|---|---|
| `wash_mid` | 16.78 | **16.80** |
| `wall_lit` | 12.24 | **12.23** |
| `sun_gap` | 17.69 | **16.82** |
| rung 0 — high / 1.00 | 16.95 | **16.91** |
| rung 4 — low / 0.78 | 8.12 | **8.21** |
| rung 7 — potato / 0.58 | 5.48 | **5.44** |

Every rung within 0.1 ms except `sun_gap`, which came *down* 0.9. Nothing that
landed in the last hour costs anything measurable, System 1's bound included.
**The ladder needs no retune**: it was tuned against a penumbra-live table, and
8.33 ms is still reached at rung 4.

### 10.2 The reduction and the penumbra are complementary, and the trade is 18 ms

The question worth asking was whether a wider, per-pixel kernel invalidates a
four-tap approximation justified on a 4×4 neighbourhood. The justification does
not survive; the reduction does, and it is worth three times more than when it
was made.

`tools/terrcost.mjs` gained a `footFull` row that puts the **old** estimator back
— four full `getShadow` calls at the offsets — and so reports a negative saving.
At `wash_mid`, against its own 17.07 ms full frame:

| block | Δ ms |
|---|---|
| every shadow lookup this material makes | −4.30 |
| — the centre tap alone (System 4's penumbra) | −3.80 |
| — the four footprint taps (§9's reduction) | −0.58 |
| **the four footprint taps as full `getShadow` again** | **+18.22** |

So the old estimator would take `wash_mid` from 17.1 ms to **35.3** — worse than
the 30.5 the project started at. §9 saved 14.6 ms when it landed; on the penumbra
path the same edit is worth 18.2, because each restored offset would now be a
12-tap blocker search plus a spiral rather than sixteen comparisons. **The
penumbra is only affordable because the offsets were reduced first.** There is no
conflict to arbitrate.

The overlap argument in §9.3 is nevertheless retired, and `src/terrain.js` now
says so beside the code. The five samples no longer cover one shared
neighbourhood: the centre integrates up to 2 m of the coarse cascade where the
offsets still sit at 2.6 texels. What holds instead is that they answer different
questions — the centre resolves the **penumbra**, a property of the blocker; the
four resolve the mean over the **screen footprint**, a property of range — and
both are still answered.

### 10.3 Re-verified as a pair, and it does not band

`tools/shadowpair.mjs` re-run over all nine views. Its default view set was
weighted to the far field first, because the taps are gated on `1 - gFoot` and a
near framing can only ever report zero — a table of zeros from views where the
block does not execute is not evidence about views where it does.

| | mean abs Δ | max Δ | px ≥ 4 cv | p99.9 Δ | changed-px mean |
|---|---|---|---|---|---|
| `wash_low` | 0.247 cv | 131 | 1.74% | 33 | 7.6 |
| `wash_mid` | 0.293 | 99 | 2.00% | 37 | 7.2 |
| `ground` | 0.051 | 127 | 0.36% | 11 | 5.2 |
| `wall_lit` | 0.292 | 119 | 1.80% | 39 | 8.2 |
| `wall_shade` | 0.055 | 86 | 0.46% | 10 | 4.4 |
| `bend` | 0.087 | 87 | 0.74% | 16 | 5.7 |
| `juniper` | 0.350 | 130 | 2.67% | 29 | 7.5 |
| `sun_gap` | 0.315 | 136 | 2.09% | 40 | 8.2 |
| `shade_far` | 0.275 | 123 | 1.76% | 36 | 7.8 |

The first eight rows reproduce §9.4 to the digit — 0.29/99/2.00% at `wash_mid`
then and now — and `shade_far`, which did not exist then, joins the same family.

**Banding was the specific risk and it is not there.** The instrument for it is
`hf/lf`: a filter that has gone blotchy carries its gradient at four pixels
rather than one, so the ratio falls. Across all twelve standard windows plus
three placed by hand on `shade_far`'s soft terminator, `grad`, `grad@4` and
`hf/lf` are identical to four digits. On the terminator crop itself — the widest
penumbra in the capture set — `grad` 0.0323 → 0.0322, `grad@4` 0.0551 → 0.0547,
`hf/lf` 0.59 both sides. The two 3× crops are visually indistinguishable.

Colour holds exactly. **Lit rock reads 0.619 saturation at hue 14.6° on both
sides**, which is the contract figure to three digits; `wash_mid` floor 21.8°
both; `shade_far` shaded floor 4.0° and lit floor 21.1° both.

And the run carries its own negative control: the floating-slab region on `wallL`
is a **byte-identical** crop between the halves. That surface is `rock.js`'s, whose
wrapper only catches the value, so a terrain-side filter cannot reach the defect
System 4's penumbra was built to fix. The two changes do not touch the same pixels.

### 10.4 What the penumbra costs, priced properly

Not a proposal — System 4's penumbra fixes a named defect and is theirs. But a
compile-time feature cannot be ablated at runtime (§9.6), so it needed a second
page load to price at all: `bench.mjs` gained `--hash`, and `#hardshadow` selects
three's fixed kernel at shader-build time.

| | PCSS (ships) | `#hardshadow` | penumbra costs |
|---|---|---|---|
| `wash_mid` | 16.80 | 12.64 | **4.16 ms** |
| `wall_lit` | 12.23 | 9.93 | 2.30 |
| `sun_gap` | 16.82 | 12.15 | 4.67 |

25% of the top-tier frame, and it is the single largest identified item in it.
Stated as a ladder cost rather than a millisecond count: **the penumbra moves the
120 fps rung by one step.** With it, 8.33 ms is rung 4, low / 0.78 / 1997×1123;
without it, rung 3, medium / 0.78 at the same resolution. So the price of a
terminator that rises over 27 px instead of 3 is one quality tier at the target
framerate, at identical pixel count. That is the trade, and on a frame whose worst
critique was a hard-edged parallelogram pasted on rock it looks like the right way
round — but it is a picture decision, not a perf one.

### 10.5 `tools/terrcost.mjs` printed `NO — CHECK` beside every correct number

The twelfth instrument failure, and the mirror image of §9.6 — there a broken
ablation reported a plausible number, here a working ablation reported a broken
warning.

`customProgramCacheKey` carries the ablation's name, which is what stops all
fourteen variants sharing one compiled program. It also means each program is in
three's cache from block 0 onward, so `onBeforeCompile` does not run again — and
the flag was read once per block, so the *last* block's reading was kept: not
compiled, therefore not substituted, therefore `NO — CHECK` printed beside a
4.44 ms saving that was entirely real.

It now records site counts for the life of the run rather than per block, and
prints the count rather than a boolean, because *matched nothing* and *was never
asked* are different failures and `false` conflates them. Every row reads `1`
(and `footFull` reads `4`). The general form, beside §9.6's:

> A cache key that makes an ablation measurable also makes the *evidence* that it
> applied unobservable on every run after the first. Verify once and carry it;
> do not re-read a compile-time flag per timing block.

### 10.6 Where the frame is now, and the two things left in it

At the top tier, 2560×1440, `wash_mid` at 16.8 ms:

| | ms | whose |
|---|---|---|
| the blocker-search penumbra | 4.2 | System 4 — named-defect fix |
| fixed: vertex, MSAA resolve, post chain | ~4.5 | — |
| the 4× half-float target | ~3.9 | System 7, and the ladder spends it |
| terrain, everything except its shadow taps | ~2.7 | 41 fetches, all of them |
| rock, vegetation, marched in-scatter | ~2.9 | |
| the four footprint shadow taps | 0.6 | this pass |

Two observations, no work done on either:

- **Fetch count is still not the axis, now less than ever.** System 1's liveness
  map says the `rockW` branch is inert across the floor and terraces, and it
  measures 1.01 ms where it *is* live; the always-live `steep` branch's six
  fetches are 0.43. The whole of §9.2's "about two milliseconds" holds.
- **The four `fwidth` calls in the bedform comb are measuring the wrong quantity**
  and System 1 has written the correct footprint form beside them. Left alone on
  purpose: the block prices at 0.05–0.08 ms, so there is no cost case, and it is
  measured-good protected work whose replacement they deliberately reverted. It
  should land as a correctness change with its own verification, not smuggled in
  under a perf commit.

## 11. The governor was the one system no instrument could see

Everything in §§6–10 was measured with `tools/bench.mjs`, which pauses the render
loop, holds the camera still, and drives `renderOnce` by hand through each rung.
That is the right instrument for *pricing* a rung and the ladder in §10 is
correctly tuned against it. It cannot answer three questions, and a real-browser
playthrough answered all three unfavourably:

1. which rung does the governor **choose**, with a live loop and a moving camera;
2. how long does it take to get there from a cold load;
3. once it has gone down, can it come **back up**.

The reason none of that was visible here is structural and worth stating plainly.
`src/perf.js` pins the top tier and switches adaptation off whenever
`navigator.webdriver` is set — which is right, because a governor reacting to
incidental timing is the last thing that should be live while two page loads are
compared pixel for pixel. But every probe in `tools/` sets that flag. So the
ladder had only ever been walked by hand, one rung at a time, by the tool that was
measuring it. `#adapt` opts back in explicitly, `tools/govern.mjs` is the only
thing that sets it, and captures are untouched.

### 11.1 The frame cost did not move. The machine did.

**This section said "the frame cost moved 39% under the measurement" and it was
wrong.** The claim is left named in the heading rather than deleted, because it
was written into `CONTRACT.md`, escalated as the most important open item in the
project, and reported to the user — and the correction matters more than the
tidiness. What follows is the bisect.

`tools/bench.mjs` read `wash_mid` at **16.80 ms** at `fa8b9ec` around 05:00 and
**24.48** at `2548d04` around 07:45. Two independent instruments agreed on the
second figure, which is what made it look like a code regression: `govern.mjs
--probe`, a different tool in a different page, read 23.34 at the same station and
rung. Both instruments were right. The inference was not, and the error was
assuming the only thing that had changed between two measurements two hours apart
was the code.

`tools/_regress.mjs` measures one cell — `wash_mid`, tier `high`, scale 1.0,
2560×1440, paused loop, `readPixels` fence, median of five blocks of thirty, which
is precisely bench.mjs's top-left number — from a detached worktree, so an old
commit can be measured without checking anything out in the shared tree.
Every source commit in the window, in order:

| commit | | ms | calls | tris |
|---|---|---|---|---|
| `fa8b9ec` | the 16.80 baseline | **22.91** | 64 | 3.97 M |
| `eaac382` | terrain, tap reduction comment | 22.62 | 64 | 3.97 M |
| `ee49e63` | sky, comment fix | 22.65 | 64 | 3.97 M |
| `2548d04` | **terrain occlusion tint + rake mip** | **22.67** | 64 | 3.97 M |
| `25c93fb` | **rock occlusion tint + joints** | **22.85** | 64 | 3.97 M |
| `0dbd81d` | terrain, geometric rake march | 22.54 | 64 | 3.97 M |
| `9fa6819` | main, loading screen | 22.66 | 64 | 3.97 M |
| `0609843` | rock, joints may only lighten | 23.20 | 64 | 3.97 M |
| `ac39c5f` | rock, rim steps between beds | 23.05 | 64 | 3.96 M |
| `39fe176` | terrain/textures, bed depth | 22.80 | 64 | 3.96 M |
| `7727cc1` | rock, crest wavelength | 22.66 | 64 | 3.96 M |
| `7caa9b7` | atmos, fill decomposition | 22.79 | 64 | 3.96 M |
| `0e81b0c` | **vegetation, shrub transmission** | 22.68 | 70 | 4.00 M |
| `7eef891` | textures, grain bed band weights | 23.14 | 70 | 4.00 M |
| `af1abf0` | HEAD | 23.07 | 70 | 4.00 M |

Flat. The whole spread is **0.83 ms across fourteen commits**, which is inside the
block-to-block spread of a single run. And the endpoints interleaved, alternated
so that machine drift cannot land on one of them:

| | run 1 | run 2 | run 3 | mean |
|---|---|---|---|---|
| `fa8b9ec` | 22.91 | 22.60 | 22.40 | **22.64** |
| `af1abf0` (HEAD) | 23.03 | 23.07 | 22.37 | **22.82** |

**0.18 ms apart.** There is no regression in the code, and there never was.

**The indirect-light fix costs nothing measurable.** `2548d04` reads 22.67 against
`ee49e63`'s 22.65 immediately before it, and `25c93fb` reads 22.85 against
`2548d04`'s 22.67 — both inside noise. So there is no trade to bring: the most
valuable visual change of the night, which took all-channel black from 6% of the
frame to 0.01% and gave the wall behind the floating slab tone, is free. A cubic
per pixel on two heavy shaders is nothing next to twenty-odd dependent texture
fetches; it was the right suspect on timing and the wrong one on arithmetic.
Vegetation shows up in the counts — calls 64 → 70, triangles 3.96 M → 4.00 M — and
not in the milliseconds, which is the same lesson §6 recorded about the triangle
ceiling. Jointing likewise.

**What actually changed is the machine.** Sampled with nothing of this
investigation running, the GPU sits at a **66% utilisation floor** from processes
that have nothing to do with the project — an animated Wallpaper Engine desktop,
the NVIDIA overlay, the editor, and fourteen `chrome`/`node` processes belonging to
the other agents working in this repo tonight. The 16.80 was taken around 05:00
when fewer of those existed. 22.8 / 16.8 is 1.36, which is the shape of a scene
being given roughly two thirds of a GPU instead of all of it.

Three things follow, and the third is the one that matters for delivery:

- **Every absolute number in §11 is a contended number**, including §11.2's table
  and the `moving` column that went into the delivery note. They are self-
  consistent and the *ratios* in them are sound — they were all taken in the same
  session under the same load — but they are a floor on the user's experience and
  not an estimate of it.
- **The 16.80-era figures are not obviously the honest ones either.** They were
  taken with fewer agents running, not with none. Neither end of this is a
  measurement of a machine doing nothing but running the scene, and this project
  does not currently have a way to take one: the render lock serialises captures
  against each other but nothing serialises them against a desktop wallpaper.
- **`bench.mjs` should record the machine, not just the frame.** A tool that
  writes a millisecond into a contract without recording GPU utilisation and clock
  alongside it produces figures that cannot be compared with each other across a
  night, which is exactly what happened. `_regress.mjs` samples the frame's
  luminance for the white-desert trap; the same argument applies to load, and it
  is the cheaper of the two checks.

The one honest way to state the result is as a range with its condition attached,
and that is how the delivery note now states it.
### 11.2 A walking player pays a cascade redraw that no bench ever measured

*(Absolute figures in this section are contended — see §11.1. The `held` against
`moving` difference is a within-session comparison and is unaffected.)*

The two shadow cascades are redrawn only when the rig moves. `bench.mjs` holds the
camera still, so it has never once paid for them. Measured at every rung, camera
held against rig creeping 5 cm a frame, at `wash_low`:

| rung | tier / scale | buffer | held | moving | Δ |
|---|---|---|---|---|---|
| 0 | high / 1.00 | 2560×1440 | 23.3 | 26.9 | +3.6 |
| 4 | low / 0.78 | 1997×1123 | 13.8 | 16.7 | +2.9 |
| 7 | potato / 0.58 | 1485×835 | 9.9 | 13.5 | +3.6 |
| 8 | potato / 0.50 | 1280×720 | 9.2 | 12.7 | +3.5 |

It is flat, at about **+3.4 ms**, and it does not shrink as the tier drops the map
sizes from 4096/2048 to 1024/512 — which says it is the terrain and rock redraw
rather than the depth fill. So the honest figure for a walking player is the
`moving` column, and on this tree **no rung reaches 8.33 ms at any station with
the camera moving.** The bottom rung is 11.4–12.7 ms, which is 79–88 fps.

The stations matter as much as the rungs, and this is the second instrument gap.
`bench.mjs` measures `wash_mid`, `wall_lit` and `sun_gap`, all at 46 m or beyond.
None is where a player boots, and the spread between stations is larger than four
rungs of the ladder: at rung 0, `ground` is 13.9 ms and `wash_mid` is 23.3. A
ladder tuned on three framings from the middle of the range cannot say what the
walk costs.

One cell in that table is contaminated and is left in rather than smoothed: rung 5
at `wash_mid` reads 21.66 held and 26.27 moving, against 16.48 at rung 3 and 10.78
at rung 6 either side of it. A rung cannot cost more than two rungs above it; the
block caught something else on the machine. Everything around it is monotone.

### 11.3 The 45-second cold start was a units bug

`main.js` computes `dt` as `Math.min(0.05, ...)`. The clamp is correct for `step()`
— a physics integrator handed a one-second frame must not teleport the player —
and the governor was accumulating its `clock` and decrementing its `hold` from the
same clamped value. During the compile-heavy first frames a 170 ms frame therefore
advanced the governor's clock by 50 ms, so `clock < 2.5` gated on fifty frames
rather than on two and a half seconds, and every `hold` after it stretched the
same way.

Measured on `govern.mjs`, cold load, 2560×1440:

| | before | after |
|---|---|---|
| first rung change | 8.5 s | **1.3 s** |
| settled | 17.0 s | **2.5 s** |

The playthrough saw forty seconds of it, which is this bug on a machine that was
also contended. The governor now keeps its own clock in wall milliseconds and the
loop's `dt` is used only for what `dt` is for. Note what this makes unnecessary:
an optimistic start. The reason to start low and climb is to avoid a long
sluggish opening, and the opening is now two and a half seconds — so starting low
would cost a fast machine a climb it does not need, to fix something that is no
longer there.

### 11.4 The ratchet, and why widening the band was the wrong fix

The old rule descended above `t * 1.15` and climbed below `t * 0.62` — 9.58 ms and
5.17 ms against a 120 fps target. The measured cost of every rung below 4 sits
*between* those, so the governor could descend and then never satisfy the
condition to return. A background download degraded the picture for the rest of
the session. The baseline trace has it exactly: it sat at rung 7 for 134 of 150
seconds, and it stayed there through samples reading **4.68 and 4.77 ms** — under
the 5.17 threshold — because `floorI` had been set to the rung it had just
descended *to*, so a climb needed twelve seconds of sustained sub-5.17 before it
would even lower the bound by one.

Widening the gate is not the fix, because the gate asks the wrong question.
`cost < t * 0.62` asks "is this rung very cheap". What decides a climb is "would
the next rung up fit", and a rung step is worth 6% to 20% here — so a fixed 38%
headroom requirement is between two and six times the size of the step it gates,
and at the bottom of the ladder it is unsatisfiable by construction.

So the governor remembers the price instead of guessing it:

- `seen[i]` is what rung *i* has cost on this machine, blended at 0.25. A climb
  needs the rung above to be known cheap enough (`< t * 1.02`) or not known at all.
- `seen[i]` **expires after 8 s**, because what a rung costs depends on where the
  player is standing and the player is walking. The first version had no expiry and
  reproduced the ratchet in a new place: descending through rung 5 recorded its
  price at the mouth of the wash, the walk reached the cheap far end where the
  frame ran at a third of that, and the governor still would not climb past 6
  because a fifty-second-old estimate said 5 would not fit.
- A climb is a **probe**: short hold, 900 ms, and if it overruns it goes back
  exactly where it came from and that rung gets a cooldown of 15 s, then 30, then
  60. A cooldown expiring clears the remembered price, so nothing is ever closed
  off permanently — a rung that keeps failing is retried rarely, not never.
- The revert is a single step rather than the ratio-derived multi-step drop. A
  probe fails on one reading and that reading is sometimes a viewpoint rather than
  a rung: one probe failed as the walk entered the wash mouth, and the ratio would
  have sent it three rungs *past* the floor it had just left.
- The GPU timer is flushed on every rung change. It reports a median over 31
  samples, so for the first thirty-one frames after a change it was a median of two
  different settings — and a 900 ms probe cannot be judged on that. An empty median
  now returns "no measurement" rather than falling through to `cpuMs`, which is
  *submit* time and would read as enormous headroom one frame after a rung change.

Verified by putting the ladder at the floor at t=30 s — the state a transient
leaves behind, reached without a transient to confound the reading — and watching:

| t/s | rung | what happened |
|---|---|---|
| 1.3 | 0 → 2 | cold start, first move |
| 2.5 | 2 → 4 | settled |
| 31.3 | 5 → 8 | pushed to the floor |
| 59.3 | 8 → 7 | climb probe, held |
| 63.3 | 7 → 6 | held |
| 67.0 | 6 → 5 | back where it was, 37 s after the push |
| 71.0 | 5 → 4 | |
| 75.0 | 4 → 3 | |
| 80.8 | 3 → 2 | |
| 105.0 | 2 → 1 | settled |

No oscillation anywhere in the trace, and every climb was a probe that held. Run
at `#target=60` on purpose: with nothing on the current tree reaching 8.33 ms the
governor correctly pins at the floor and there is no climb to observe, which would
make a fixed ratchet indistinguishable from a broken one.

The first version of the recovery test ground a second WebGL context to contend
for the device. It worked far too well — the queued draws took four minutes to
drain, the GPU timer went permanently disjoint, and the trace measured the
injection. Recorded rather than quietly replaced, because "the instrument was the
loudest thing in the room" is this project's most repeated failure.

### 11.5 One more rung, and it buys a millisecond

`RSCALE` gains 0.50, so the ladder has a rung 8 at potato / 1280×720. Said
plainly: it is worth **0.6–0.8 ms**. When the ladder was tuned, halving the pixels
took a third off the frame and resolution was by far the strongest lever
available; it is not any more. `bench.mjs`'s `@0.7res` column takes `wash_mid`
from 24.48 to 17.95, so 49% of the pixels save 27% of the frame, and the remaining
17.95 is vertex work, the two cascades, the resolve and the post chain in an order
nobody has yet attributed. The rung exists because a governor whose bottom step is
over budget has nowhere to put a struggling machine, not because it closes the gap.

### 11.6 The thirteen shader warnings are one loop

`X3595: gradient instruction used in a loop with varying iteration`. Attributed by
ablation rather than by matching line numbers, because the numbers in those
messages are into ANGLE's generated HLSL and not into any file in `src/`:

| boot | distinct warnings | X3595 |
|---|---|---|
| `#adapt` | 8 | **8** |
| `#adapt&hardshadow` | 0 | **0** |

Every one of them is `src/sky.js:734–739`, System 4's variable-width penumbra
spiral:

    int n = int( clamp( r / texelM * 1.2, 8.0, 28.0 ) );
    for ( int i = 0; i < 28; i ++ ) {
      if ( i >= n ) break;
      vec2 o = sunSpiral( i, n, rot ) * r * uvPerM;
      float d = unpackRGBAToDepth( texture2D( map, p.xy + o ) );

`n` is per-pixel, so the trip count diverges across a quad, and `texture2D` needs
derivatives to pick a mip level. The count varies with how many programs have
compiled — the playthrough saw 13, a fresh boot here sees 8 — but it is one
construct in one shared chunk, included by every program that receives a shadow.

**The fix is one token and provably identical, and it is not mine to commit.** The
shadow map is `NearestFilter` with `generateMipmaps` off, so there is no mip level
to select and the derivative is computed and discarded:

    float d = unpackRGBAToDepth( texture2DLodEXT( map, p.xy + o, 0.0 ) );

`three.module.js:6454` defines `texture2DLodEXT` as `textureLod` in the GLSL3
prelude, and `terrain.js` already relies on the sibling `texture2DGradEXT` define
at 6457, so the mechanism is in use in this project today. Left to System 4
because `src/sky.js` was dirty with their in-flight work throughout this pass, and
staging a hunk into a file someone else is editing is how `sky.js` got destroyed
once already.

Two things this is *not*. It is not the bug class that produced the grazing
lattice — that was a derivative whose **value** was unbounded; this is a
derivative whose value is discarded. And it is not `fwidth` of a phase
under-reporting, which is §10's note and still open. Nothing here is a correctness
risk today: it is eight lines of console noise standing on a real one-token
improvement.

## 12. Pricing the suspects on today's scene instead of yesterday's build

§11.1's bisect answers "did the frame move" and cannot answer "what does this term
cost", because a checkout measures a whole build and the build kept changing:
vegetation landed inside the window, which is visible in the counts as 64 draw
calls becoming 70. So the terms were priced the way everything else in this file
was priced — one page load, one build, one bit different — with the substitutions
going in through `onBeforeCompile` and the active row folded into
`customProgramCacheKey` so three relinks instead of returning the cached program.

Two guards, both earned rather than precautionary.

**Every row reports how many sites it hit, and zero prints `STALE PATTERN, not a
free feature`.** This caught one immediately: an attempt to price System 4's
`texture2DLodEXT` fix by putting `texture2D` back read 0 sites, because that code
is in three's `shadowmap_pars_fragment` chunk and the chunk is still an
unexpanded `#include` at `onBeforeCompile` time. Without the counter it would have
printed +0.05 ms and read as a clean null on a term that was never touched — which
is exactly how `-shadow` reported 0.05 ms for three quarters of the frame.

**Every row is paired against a baseline measured immediately before it**, and the
delta is against that baseline rather than against one measurement at the start of
the run. The first attempt at this pass was unpaired and its closing `full again`
row came back 3.6 ms above its opening `full` row while GPU utilisation swung
between 58% and 100% inside the window. The effects here are two to six tenths of
a millisecond. Unpaired, all of them are noise wearing a number.

`eba1fc0`, served from a detached worktree so the two files that were mid-edit in
the shared tree could not land inside a run. 2560×1440, `wash_mid`, top tier,
median of four blocks of thirty, three independent runs:

| removing | sites | ms saved | | |
|---|---|---|---|---|
| the Jimenez cubic | 3 | 0.22 | 0.22 | 0.41 |
| `s4AoTint` | 3 | 0.45 | 0.48 | *(+10.18)* |
| **both — `indirectDiffuse *= tAO`, the line as it stood** | 6 | **0.64** | **0.63** | **0.40** |
| cliff jointing, all four `jointTrace` marches | 2 | 0.14 | 0.02 | 0.09 |

**The indirect-light fix costs 0.6 ms of a 23 ms frame. Two and a half per cent.**
There is no trade to bring and nothing to negotiate: the change that took
all-channel black from 6% of the frame to 0.01% and gave the wall behind the
floating slab tone is, for practical purposes, free. It was the right suspect on
timing — it landed on the two heaviest fragment shaders in the hour the number
moved — and the wrong one on arithmetic. A cubic and a normalised probe split are
a few dozen ALU ops against twenty-odd dependent texture fetches; §7 already
recorded that this shader's cost is fetches and shadow taps, and ALU does not
register against them. Looking for a cheaper formulation of the curve would be
optimising 2.5% of the frame, and there are two better milliseconds below.

Three caveats, because each of these numbers has one:

- **The `s4AoTint` +10.18 outlier is not a measurement of anything.** Removing an
  expression cannot make a shader slower by 45%. It is the third row of a run in
  which foreign GPU load moved between 59% and 100%, and it is reported rather
  than dropped because the median of the row that matters — `ind.both`, three
  paired measurements at 0.64, 0.63 and 0.40 — is the figure being quoted, and a
  reader should be able to see how wide the tail on that instrument is.
- **The jointing figure is a lower bound and station-specific.** `jointRes` gates
  the marches on screen-space footprint, and at 46 m they are largely gated off,
  so 0.1 ms is what jointing costs *where this was measured*. This is System 1's
  branch-liveness lesson exactly: a gated branch measured outside its live region
  reads free. It needs a close station before anyone calls it free everywhere.
- **All of it was measured with the GPU 90-100% occupied by other work.** The
  ratios are sound, being paired within a single load; the absolutes are a floor.

## 13. The walking penalty was two things, and one of them is a free millisecond

§11.2 measured a flat +3.4 ms that only a walking player pays and attributed it to
the shadow cascade redraw. The attribution was three quarters right, and naming
the whole of it after the larger half was the error. Suppressing only the two
shadow passes while still paying everything `walkTo` does — height sampling,
collision, the atmosphere and post walk clocks — splits it:

| `wash_mid`, 2560×1440, top tier | ms |
|---|---|
| held | 22.55 |
| moving | 25.77 |
| of which everything walking does *except* the shadow passes | +0.79 |
| of which the two cascade redraws | **+2.43** |

And the redraw half was being paid about five times more often than it needed to
be. `renderer.shadowMap.needsUpdate` is one flag for the whole pass, so raising it
redraws both cascades — but the two are quantised to their own texel grids at very
different pitches, so while walking the fine cascade moves on nearly every frame
and the coarse cascade moves on roughly one frame in five. The coarse one was
redrawn on all five, and it is the expensive one: 4096 against 2048, both passes
walking the same ~2.1 M triangles of terrain and rock.

three already gates each light on `shadow.autoUpdate === false &&
shadow.needsUpdate === false`, so scheduling the two apart needed no patch of
three's chunk — only that `syncShadow` raise each cascade's own flag when *that*
cascade's quantised target moved, rather than raising one flag for both:

| `wash_mid`, 2560×1440, top tier | before | after |
|---|---|---|
| held | 22.55 | 22.61 |
| walk, excluding the shadow passes | +0.79 | +0.81 |
| the two cascade redraws | +2.43 | **+1.43** |
| moving | 25.77 | **24.85** |

**A millisecond, and it costs no picture at all.** A cascade is skipped exactly on
the frames where redrawing it would write the same texels, which is the argument
the global flag was already making one level up — main.js has carried the note
since the flag was introduced that the maps are a function of the *quantised*
player position and are bit-identical between two frames that quantise the same.
The harness's pixel-identical recapture is unaffected for the same reason.

Two details that would have broken it and are handled:

- A tier change resizes a map and disposes it, which is the one case where a
  cascade must redraw without having moved. `perf.js` raises that light's own flag
  there; without it the light whose map was just disposed would wait for the
  player to cross a texel boundary before it had a map at all.
- Four tools in `tools/` set `renderer.shadowMap.needsUpdate = true` directly to
  force a redraw after changing a material, and none of them know cascades are
  scheduled separately now. The public flag therefore still means "redraw
  everything" — it forces both cascades through a property setter — while the
  frame loop uses a private path that does not.

**Weighed against the visual fixes: the cascade change buys 1.00 ms and the entire
indirect-light fix costs 0.63.** Taking the free millisecond and keeping the
picture leaves the frame 0.4 ms ahead of where it would be having given up the
most valuable visual change of the night. That is the whole trade, and it is not
close.

Verified on the shared tree after landing, where the total walking penalty reads
+2.41 against +3.22 before the change — but with the split moved to +0.26 walk and
+2.15 redraw, because `path.js`, `rock.js`, `terrain.js` and `vegetation.js` were
all dirty with other systems' work at that moment and both terms depend on them:
vegetation adds casters to the shadow passes and `path.js` is inside `walkTo`. The
total is the post-fix total; the two halves of it are a different scene's halves.
Worth recording rather than smoothing, because it is the same hazard §12 avoided
by ablating in one load — a two-term split measured across two builds attributes
whatever moved in between to whichever term is being watched.

There is more in the same direction for anyone continuing: the remaining +1.43 is
the fine cascade redrawing on nearly every frame, and its grid is fine enough that
coarsening it — or amortising the coarse cascade over a fixed cadence rather than
a grid — would take more. Both cost picture, unlike this one, so both need a
matched pair before they are proposed.

## 14. The eight shader warnings are gone, confirmed with a control

System 4 landed the one-token fix at `eba1fc0` — `texture2DLodEXT` in both tap
loops of the penumbra filter — and could not verify it removed the warnings,
because nothing in `tools/` surfaces shader warnings and the harness collects
console errors only. `govern.mjs --warnonly` does, and now takes `--root` so it
can serve a committed worktree rather than a tree with files mid-edit:

| | distinct warnings | of which X3595 |
|---|---|---|
| `eba1fc0^` | 8 | 8 |
| `eba1fc0` | **0** | **0** |

The control is the point. A zero from a probe that has stopped working looks
exactly like a zero from a fix that worked, and this file has already recorded two
confident nulls from instruments that were not varying the thing they named. The
parent commit still reports all eight through the same probe in the same minute,
so the zero is the fix.

It bought no measurable frame time. That is the expected result rather than a
disappointing one: as noted when the warnings were attributed, this is a
derivative whose value is *discarded* — the loop's iteration count varies within a
quad, so the implicit gradient is undefined and was never used — not one whose
value is unbounded. Asking for level zero stops the compiler computing something
nobody read. It is not the bug class that produced the grazing lattice, and it was
never going to be worth milliseconds.
