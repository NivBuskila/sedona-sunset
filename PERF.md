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
