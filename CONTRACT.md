# Sedona Sunset — Build Contract

A first-person walk up a dirt wash between red rock buttes in Sedona, Arizona, at golden
hour. Everything — every mesh, texture, and sound — is generated procedurally in code.
There are no external asset files of any kind.

The goal is photographic realism. The bar is that a paused frame is indistinguishable from
a real sunset photograph of Sedona. Not stylized, not low-poly, not "good for a browser".

## Hard rules

- **Zero external assets.** No image files, no model files, no audio files, no CDN fetches
  at runtime. `three` is imported from `node_modules` and served locally; that is the only
  dependency. Every texture is written into a canvas or a `DataTexture` in code. Every
  sound is synthesized with the Web Audio API.
- **No UI and no HUD.** No crosshair, no text, no menus, no debug overlay in the shipped
  frame. Movement and atmosphere only.
- **No forest and no water.** Exactly one juniper tree is the only significant vegetation,
  plus a few dead grasses at its base.
- **Performance budget.** Target 120+ fps at 1440p on an RTX 4060 / Ryzen 5 7600X. The
  user games on the same machine, so the running app must not saturate CPU or GPU. Keep
  draw calls under ~150 and triangles under ~3M. Use instancing for anything repeated.

## Performance budget, measured on the target machine

Reference numbers from a comparable Three.js scene on this exact RTX 4060, at 1600×900:
**6.6 M triangles across ~1050 draw calls cost 6–9 ms**, and a ten-pass post chain
(half-res volumetric raymarching, SSAO, bloom, defocus, grade) came to **under 1 ms total**.

Two conclusions, both load-bearing:

- **Geometry is not this project's problem.** At 2.19 M triangles and ~50 draw calls we are
  an order of magnitude inside a budget that scene met comfortably. Do not spend effort on
  LOD or draw-call reduction without a measurement saying otherwise.
- **The cost is fragment shading and bandwidth.** Terrain was doing 23 unconditional
  texture fetches per ground pixel; the shimmer pass draws the whole scene into RGBA16F at
  4× multisampling, which is ~66 MB of colour plus ~33 MB of depth written and resolved
  every frame at 1080p.

Three measurement traps, each paid for once already:

- Watching framerate cannot work against a capped loop.
- `glFinish()` in the page returns when Chromium hands over the command buffer, not when
  the hardware drains it. The symptom was "adding post-processing made the frame faster".
- Sequential A-then-B comparison charges the driver's clock ramp to whichever ran first.

`tools/shadercost.mjs` counts texture fetches statically, charging helpers transitively to
their call sites. `tools/bench.mjs` runs a real-GPU ablation table and the tier ladder.
`src/perf.js` is the quality-tier governor: its top tier is byte-identical to the scene as
built, and under a software rasteriser it pins that tier and disables adaptation so
captures are unaffected. Adaptation descends multiple steps at once (one notch at a time
left a struggling machine half a minute from playable), lifts only after a long clean run
so it settles rather than hunts, and queues tier changes rather than applying them at once
— a re-mesh stall lands on a machine already struggling, and a long enough stall trips the
display driver's watchdog.

## One weather system

Three systems reference the wind and they must agree. Ownership is split so nobody has to
guess:

- **Direction** is `WIND`, exported from `src/juniper.js` — (0.94, 0.34) normalised, the
  direction the wind blows *toward*. It runs across the wash rather than along it, chosen
  so the hero juniper's lean reads in its framing.
- **Timing and strength** belong to the audio system: `window.__game.audio.wind` for
  current state, `windAt(t)` analytic for any time, `gusts(from, to)` for the schedule.

So the sand you see moving, the sand drifted against the upstream face of clasts, the lean
of the tree, and the wind you hear are one system. Anything that needs a different wind
should move the shared constant, not keep a private one.

## Page boot cost is a real user-facing problem

`tools/boot.mjs` measures it: **370 seconds on four cores**, because every texture in the
scene is written texel by texel in JavaScript before the first frame. That is why the
harness's two-minute readiness window started failing every capture, and `tools/shoot.mjs`
now waits a budget sized to the real boot.

Faster hardware hides it but does not fix it — a person opening this page still waits.
Procedural generation is a hard requirement so the work cannot be removed, but it can be
moved: generate at lower resolution first and refine, defer textures not needed for the
first frame, move generation into workers, or cache into IndexedDB after the first visit.
Unowned and unscheduled; worth doing before this is ever shown to anyone.

## Working alongside other agents

Several systems are built in parallel, so more than one agent may be editing the tree at
once.

- **Never `git add -A` or `git add .`** — stage explicit paths only. An agent doing this
  swept another's in-flight files into an unrelated commit. Nothing was lost that time; it
  will not always be so lucky, and the commit history becomes a poor record of who changed
  what.
- Work in your own new modules. Do not restructure files another system owns.
- `src/main.js` is shared. Re-read it from disk immediately before editing, make a small
  targeted replacement, and never rewrite the whole file.
- Commit small and often, so a collision costs minutes rather than hours.
- Expect transient breakage from other agents mid-edit. A page error naming a file you do
  not own is probably somebody's half-written shader, not your bug — re-check before
  chasing it.

## Colour targets, measured from real photographs

These are HSV saturation figures measured on *region crops* of real Sedona and Arizona
photographs — never on whole frames, which average in the sky and are meaningless.

| Surface | mean | p95 | p99 |
| --- | --- | --- | --- |
| Sedona rock, warm low sun | 0.42 – 0.65 | 0.59 – 1.00 | — |
| Sunlit dry wash floor | 0.47 – 0.56 | 0.67 – 0.74 | 0.88 |

An earlier critique asserted rock at 0.31–0.36 and a wash floor at **0.09**. Those figures
were measured badly and do not survive contact with real photographs; a wash floor at 0.09
is wet grey concrete. Chasing them desaturated the floor into mauve-beige. **Do not use
them.** Anyone proposing a new colour target must measure real photographs and show the
numbers.

**Hue matters as much as saturation, and was missed for four rounds.** Real Sedona rock in
warm light clusters at **+22° to +31°** — orange. Measured renders have sat at −15° to +3°,
which is magenta-red, and that plum cast is a large part of why the scene kept reading as
Mars or Wadi Rum. The B/G channel ratio is a quick proxy: real golden-hour rock runs
0.32–0.90, with blue well below green; a magenta-cast render runs 0.87–1.21, with blue equal
to or above green. Check hue whenever you check saturation.

Saturation on rock is **solved** as of `sys2e` — mean 0.62–0.67, p95 0.87–0.92, p99 0.90–0.96
on lit rock, inside the real-photograph range and if anything conservative. Do not push it
up and do not let a later round pull it down. The remaining colour work is a hue rotation,
not a saturation change.

**Measure the target's own population, and check the provenance of a target before
declaring a regression against it.** The rock figures above were reported as a
pre-lighting measurement and used to call System 4 a regression. They are not
pre-lighting. They come from `sys2h`, captured 08:58, and System 4's sun, spectral sky,
SH probe and exposure 1.15 were all committed by 07:45 — so the frame that defines
"colour is correct" already had the new light in it. The genuinely pre-lighting frames
are `sys2f`, `sys2g` and `sys3a`, and on the lit rock of `wall_lit` they measure hue
**−2.4°** at B/G **1.04**: the magenta cast this document spends a section on. The
+16.5° was never reachable under the provisional light, and no lighting change can be a
regression away from a number that lighting produced.

The second half of the same error is population. These are targets "on lit rock", but
`sat.mjs`'s `wall_lit` window is a fixed rectangle holding both sunlit and self-shadowed
faces, and under a directional key those two are different materials to the metric. On
the brightest 40% — the lit population the target describes — `sys4c` reads sat **0.626**
against a target of 0.627, hue **+19.4°** between the stated +16.5° and the real cluster
of +22–31°, V **0.600** which is the first frame in the project inside the 0.59–0.73
reference band, and B/G **0.644** inside the real 0.32–0.90. On the whole rectangle the
same frame reads 0.538, because the shadowed half is now a luminous violet rather than a
dark magenta. Quote the window with the number, or the two are not comparable.

**Surface structure has a measured target too, and it is the one that decides photorealism.**
`tools/grad.mjs` reports the mean absolute one-pixel luminance gradient over a region — the
statistic that separates rock from wax, and the one that variance cannot: a broad Lambertian
ramp across a cliff has a large standard deviation and no material in it whatsoever.

| Region | grad | grad/L |
| --- | --- | --- |
| Courthouse Butte cliff face (photo) | 0.074 – 0.085 | 0.12 – 0.16 |
| Coconino face, fine grained (photo) | 0.027 | ≈ 0.05 |
| Cathedral Rock face (photo) | 0.026 | ≈ 0.05 |
| `sys2e` `wall_lit` midwall | 0.0046 | 0.030 |
| `sys2f` `wall_lit` midwall | 0.0120 | 0.086 |
| `sys2f` `wall_shade` face | 0.0500 | 0.099 |

Read **grad/L** when exposures differ, and while System 4's lighting is provisional they
differ by a factor of four: a gradient is a difference of luminances, so the same material at
half the exposure measures half the gradient, and `wall_lit` sits at L 0.14 against 0.59–0.73
in the reference photographs. Below about 0.026 raw on a well-exposed face, a surface is
polished plastic regardless of how good its colour is.

Two things are worth knowing before attacking this number on a new surface. First, a sum of
smooth noise cannot produce it however many octaves go in — the result is one continuous
membrane, and both the wash floor and the cliff face failed this way. Pack discrete elements
and combine them by maximum. Second, a texture pinned to a world scale **cannot hold the
number at distance**: past the range where its texels fall under a pixel the mip chain
returns its mean. Real rock is structured at every scale, which is why a photograph of a
cliff has pixel-scale energy at two metres and at two hundred, so the honest model is a
detail layer with no low frequencies in it whose sampling scale follows the pixel footprint.
See `makeGrit` in `src/textures.js` and its use in `src/rock.js`.

The distribution matters more than the mean. A real wash floor gets its saturation spread
from mixed lithology — iron-stained red clasts, desert-varnished near-black pebbles, and
orange mud stringers sitting beside pale quartz sand. That produces a long saturated tail
(p99 ≈ 0.88). A narrow band at any mean reads as procedural however well the mean is
matched, so widen the tail rather than raising the average.

## Build order

Each system is critiqued before the next one starts, and systems are built one at a time —
never two at once.

**Terrain is deliberately being left short of the bar.** System 1 held at 5.5/10 across
three critique rounds, not because it stopped improving but because each round fixed the
previous blocker and exposed a new one. A growing share of what remains is not System 1's
to fix: exposure and tonemap belong to System 7, warm-grey shadows that should be violet
belong to System 4, and the wall surfaces get replaced wholesale by System 2. Judging
terrain against a photorealism bar while the lighting and grading are still placeholders
has hit diminishing returns.

So the wash floor moves on at roughly 6/10 and **terrain is revisited once real lighting
and grading exist**, when the remaining defects can be judged against a scene that is
actually lit.

### The near-field aerial term is the largest colour lever in the scene, and it is not lighting

Whoever owns System 5 should read this; it was found while diagnosing a colour drift blamed
on System 4, and it is measured rather than argued.

`installAerial` replaces three's fog chunks, so the airlight applies to *everything*
fogged at *every* distance, scaled by `scene.fog.density` — 0.0019/m. At the `wall_lit`
wall, 46 m out, that is roughly **7% of the pixel arriving as inscatter**. The source
function is near-neutral by construction (`RAY`'s is flat grey, the dust's is `SKY_TINT`
within 6% of neutral), and `BETA_R` is [0.327, 0.570, 1.000] — so what lands on a red
rock is grey light weighted toward the channel that red rock has *least* of. HSV
saturation is (max − min)/max, and this raises min.

That is aerial perspective behaving correctly in kind, and much too strongly in the near
field. Driving System 5's own CPU mirror, `aerialModel`, with the exactly-recovered linear
radiance behind `sys2h`'s lit rock predicts, at 40 m, sat 0.627 and B/G 0.660. The frame
measures **0.626 and 0.644**. Nothing was fitted; the constants are System 5's and the
radiance is System 2's. It also explains why the effect looked like a lighting bug: the
lift is a fixed radiance, so its *relative* size grows as the surface darkens, which is
why shaded rock lost 0.16 of saturation where lit rock lost 0.06, and why the far wall in
`wash_mid` now measures grad/L 0.020 — flat plastic, well under the 0.026 floor — while
its `L` reads a bright 0.354.

Two things follow. **The density is System 4's number but the near-field falloff is
System 5's model**, and cutting the density globally would take the far field with it,
which `tools/layers.mjs` measured as correct; the fix belongs in the column, not the
scale. And **the aerial term must be measured on near geometry, not only on the far
ridge** — it was calibrated on a butte a kilometre out, where it is right, and nobody
looked at what the same constants did to a wall at forty metres.

### Deferred terrain defects, carried forward from System 1

Not forgiven, only deferred. Revisit these after System 4 and System 7.

- **Midground detail collapse.** High-frequency energy in the 20–40 m band measures
  ~0.052 against 0.115–0.137 in real arroyo photographs — a 3–5× shortfall exactly where a
  real photograph is *busiest*, since more objects fall into each pixel when looking across
  a surface rather than down at it. Four attempts failed to move it. The standing hypothesis
  is that the dirt albedo has no energy at gravel scale to begin with, in which case no
  amount of sharper sampling can recover detail that was never authored — test that offline
  before touching the sampling again. What must carry this band is albedo and lithology
  mottle, micro-shadow fraction as a smooth tone, correlated ripple-crest banding, patch
  boundaries, and a handful of individual cobble silhouettes — **not** relief detail.
- **No clast burial or scour geometry.** Named by three consecutive critics as the strongest
  surviving "objects dropped onto a surface" tell. Needs an upstream sand fillet, a
  downstream scour tail, imbrication (consistent upstream dip), and partial burial.
- Uniform clast density — no flow-sorted bars, stringers or armoured lag surfaces.
- Small clasts still ellipsoids sharing aspect ratio and long-axis orientation.
- Sand draping over every bank crest like icing; fluvial and aeolian sand are not
  distinguished.
- Corduroy ripples at constant amplitude — no wavelength scaling with flow depth, no crest
  bifurcation, no plane-bed patches.
- Polka-dot cut banks: high-contrast pale ellipsoids on a dark matrix at uniform density.
- Residual 1–2 px hash on *shaded* cut banks.
- No talus cone; no mud-crack plate relief.
- Shadow ambient is warm grey and red-dominant — needs a hemispherical skylight term so
  shadows go cool/violet. **System 4 owns this.**
- **Ground `hf/lf` regressed when the new lighting landed** and needs re-checking once
  System 4 settles: `wash_mid` floor 0.58 → 0.50, `bend` sand 0.62 → 0.54, `ground` floor
  0.47 → 0.45. No ground surface was edited in that window, so the cause is almost certainly
  the light rather than the material.
- The pale confetti specks on the wash floor and the lavender sand sheet are System 1
  albedos reacting to the new skylight — recheck both after System 4.

### A texture pinned to a world scale goes to wax at distance

Twice now — System 1's wash floor and System 2's cliff face — a surface has been correct up
close and turned to smooth wax further away, and both times the first diagnosis was wrong.
There are two distinct causes and they need separate fixes.

1. **A sum of smooth noise is one continuous membrane**, however many octaves go into it.
   Granular material is a *packing*: elements occupy space, the largest stand proudest, and
   smaller ones fill the gaps. Combine populations by maximum, not by sum.
2. **A texture at a fixed world scale cannot hold detail at distance at all.** Past the
   range where its texels fall below a pixel, the mip chain returns its mean and the surface
   goes flat. Real rock and real ground do not do this, because they are structured at every
   scale — which is why a photograph of a cliff has pixel-scale energy at two metres and at
   two hundred. The fix is a detail layer with **no low-frequency content**, sampled at
   whatever scale the pixel footprint asks for, snapped to octaves with the bracketing pair
   crossfaded.

Note also that a detail layer which is only ever *brighter* than its surface reads as dust.
Grain needs its dark half — the sockets left where grains have fallen out.

### Measuring surface structure

`tools/grad.mjs` measures mean absolute per-pixel luminance gradient on a region crop, and
also prints an `hf/lf` column — the ratio of high- to low-frequency energy.

**`hf/lf` is the canonical metric. Report it. Do not report `grad/L`.**

| | render (sys2g) | real Sedona rock |
| --- | --- | --- |
| raw grad | 0.0078 – 0.0415 | 0.0274 – 0.0604 |
| **hf/lf** | **0.30 – 0.44** | **0.54 – 0.75** |

Raw gradient is easy to game: a dense field of high-contrast mid-frequency blobs raises it
8.5× without adding any material. That is exactly what happened once — grad went up 8.5×
while `hf/lf` did not move at all. `hf/lf` is dimensionless, exposure-invariant and
haze-invariant (atmospheric scattering is an affine transform of radiance and scales both
bands equally), so it measures the thing we actually care about and cannot be bought with
amplitude.

**Pass condition for rock: `hf/lf` ≥ 0.55**, the bottom of the real range.

### How to move `hf/lf`, and how to iterate on it in seconds

`hf/lf` is a statement about the *spectrum of the maps*, far more than about anything the
scene does. `tools/wallprobe.mjs` shades a flat wall out of the actual procedural maps —
same world scales as `rock.js`, same footprint-locked octave pair, same normal composition
and terminator fade, through a real mip pyramid — and reports the same statistics
`grad.mjs` does, in seconds rather than the eight-to-twenty minutes a three-view capture
costs under contention. Its absolute numbers are not the render's, because it has no
shadows, no bedding geometry and no aerial perspective. What transfers is the ratio and its
direction of travel. `--only coarse|fine|grit` isolates one contributor, which is the
difference between knowing which term is dragging and guessing at it.

Two things determine the answer, and both were wrong once:

- **Spectral slope.** Amplitude must fall only *slowly* with wavelength — near enough as its
  cube root over the range a pixel sees. A layer built with amplitudes 1.00 / 0.40 / 0.155
  across a 5.6× scale range is falling as roughly the wavelength itself: the coarsest
  population dominates, and it measured 0.41 in isolation at every distance. Sum octaves at
  a near-flat law rather than letting one win by maximum. Within an octave a packing is
  still right, because grains occupy space; across octaves a fractal surface is a sum. And
  weight the *finest* octaves generously, because shading responds to slope and slope for a
  given amplitude goes as the reciprocal of the wavelength.
- **Sampling rate.** A detail map read at 1.7 texels per pixel is read a whole mip level up:
  the driver averages away everything at the texel scale and hands back the coarse
  populations. Locking it to slightly *under* one texel per pixel — 0.9 — is what makes mip
  level zero actually get used, and mip zero is the only level with the top octave still in
  it. That one number moved the grit layer from 0.41 to 0.65 with no change to the map.

Two dead ends, both tested, so nobody spends a round on them:

- **Quantisation is not holding the number down.** It is tempting when the frame sits at a
  mean of 0.11 — byte value 29, where a 14% per-pixel contrast is four code values wide — to
  suppose 8-bit truncation is eating the fine content. `wallprobe --expose` scales to a target
  mean and quantises, and the ratio does not move: 0.68 at means of 0.50, 0.30, 0.20 and 0.11.
  Sub-step content does not vanish under rounding, it dithers, and dither is white.
- **Amplitude and spectrum are independent knobs.** Halving a layer's contrast left its ratio
  at 0.68, unchanged at every distance. So a layer that is too loud can be quietened without
  giving back frequency content — and, the direction that matters, a layer in the wrong band
  *cannot be fixed by turning it up*. That is the whole trap of the raw gradient.

There is also a real gap between what the maps can do and what the capture measures — the
probe read 0.68 on a planar wall while the capture read 0.52 — and it is not a discrepancy,
it is the scene: bedding tone, cast shadow, macro variation and aerial perspective are all
low-frequency, all legitimate content, and all in the denominator. The levers on that side
are therefore the weights of the highest-frequency terms, and any broad tonal band whose
contrast is not earning its place. A sub-bed tone step is the clearest example — it is a wide
horizontal ribbon, so every unit of it lands in the denominator, and what should carry a bed
at distance is the shadow line under its lip, which is geometry.

And one thing that will silently undo all of it: **pigment survives what geometry does not.**
Albedo goes through the mip chain and every terminator fade intact, so any feature you author
as a colour change will still be there when its normal has faded to nothing — as a flat spot
facing nowhere. That is how a field of weathering pits ended up reading as fly-dirt on a
scanned negative while raising raw gradient 8.5×. If a feature is a hole, give it depth,
occlusion and a rim, keep its normal alive on shaded faces, and give it almost no pigment at
all. A terminator floor of 0.05 does not fade a decimetre cavity, it deletes it.

`grad/L` was tried and rejected. The physics is sound in principle — for a Lambertian
surface, spatial contrast really is proportional to mean radiance — but it divides by a
*regional* mean, so a region that is half cast shadow has its denominator dragged down by
geometry rather than exposure and scores inflated. Empirically it runs *anti*-correlated
with luminance across real photographs (0.048 on a bright macro to 0.201 on a dark cliff of
the same rock type). Tested honestly at matched luminance — render L 0.141 scoring 0.087
against real rock at L 0.137 scoring 0.201 — it does not rescue an underexposed frame; it
only shrinks the apparent failure from 3× to 2.3×.

### Verify the instrument before you trust the measurement

This project runs on measurement, so a broken instrument is worse than no instrument — it
sends work confidently in the wrong direction. Three real examples:

- A narrow-peak detector tested each frame's raw periodogram bin against its neighbours.
  A raw bin of filtered noise is exponentially distributed, so over two minutes *some* bin
  clears its neighbours by 20 dB by chance alone. It reported a "harmonic series" that was
  bins 25/50/75/100 — exact multiples — of its own variance. Fix: average across frames
  first (a real resonance is stationary in frequency, noise is not) and report the
  detector's own noise level so the threshold is auditable.
- With that fixed, the detector found a *genuine* comb and attributed it to rock edge tones.
  It was a coyote and its answering neighbour. A search built to find stationary narrow
  combs will find voices.
- A "footsteps are quieter than the wind" figure compared step level against a gust peak
  measured over a window that contained the footsteps — a comparison of the footsteps with
  themselves.
- `tools/tone.mjs`'s `inverse` was not one. It normalised a pixel by its peak channel and
  bisected for that peak's magnitude alone, so it recovered a radiance on the wrong ray:
  fed the lit rock of `sys2h` it returned something whose forward image had saturation
  0.770 against the 0.689 it was given. An 0.081 error, in the same direction as the drift
  it was being used to investigate, in the one tool whose entire purpose is to separate
  exposure from pigment. The channel coupling it discarded *is* the effect being modelled.
  Every stage of ACES is invertible in closed form — the shoulder is a ratio of quadratics,
  so it is one root, not a search — and it now round-trips a measured population to 0.000
  saturation. **Round-trip an instrument on real data before using it.** A one-line
  assertion would have caught this.

Two habits follow. Have a measurement report its own noise floor so a reader can see
whether a result clears it. And when a statistic is aggregated over a whole take, ask what
fraction of that take it is actually describing: a full-duration band RMS is dominated by
the loud 15% and says nothing about the quiet 85%, which in an ambience *is the piece*.

### A process note worth keeping

Three rounds running, the measured symptom pointed at the wrong mechanism. The "gravel
aliasing" was actually the mud-crack net, filtered on plate size rather than crack width.
The "exposure problem" was actually a grazing-angle specular veil, which raises value and
crushes saturation exactly as over-exposure does. Critics are reliable about *what looks
wrong* and unreliable about *why*. Always re-diagnose from magnified crops before acting on
a stated cause — including one stated by the coordinator.

1. Terrain and wash path
2. Red rock buttes — **COMPLETE on its metric**, pending a post-lighting review. Three
   build rounds, two independent critiques (3.5 → 5.5 photorealism, 5.0 → 6.5
   reads-as-Sedona). The `hf/lf` gate of 0.55 is met on every rock region: `wall_shade`
   0.38 → 0.59, `wall_lit` midwall 0.48 → 0.55, all others 0.55–0.61. Colour is measured
   correct and **must not be touched** — hue +16.5° against real Cathedral Rock at +15.6°,
   saturation 0.627/0.667 against a real range of 0.441–0.659. Those two figures are
   `sys2h`'s `wall_lit` and `wall_shade` windows, captured 08:58 and therefore *under*
   System 4's light, not before it; see the provenance note in the colour section before
   using them to judge a lighting change.

   Still short, for the post-lighting pass: fine horizontal lamination still runs further
   edge-to-edge than a real face; varnish plates read as soft dark smudges rather than
   mineral tongues; `wall_lit` midwall sits exactly on the gate at 0.55 rather than
   comfortably inside it. The last of these should improve on exposure alone.
3. The juniper
4. Lighting and sun — spectral sky, SH skylight probe and two-cascade shadows are in and
   the rock is in band (see the provenance note above). **The open defect is the wash
   floor, and it is System 4's.** Between `sys2f` and the first frame under the new light,
   every ground region lost a factor of 3.5–3.9 in `L`: `wash_mid` floor 0.395 → 0.122,
   `bend` sand 0.432 → 0.136, `ground` floor 0.224 → 0.118. That is far larger than the
   `hf/lf` drop it was reported as, and it is not a fill washing out microshadow — in the
   same frames the `wash_mid` *wall* went the other way, 0.193 → 0.354. Wall bright, floor
   dark, at a floor/wall ratio of 0.34: the floor is in the bank's shadow, which at 8°
   elevation is 140 m long from a 20 m bank.

   Two consequences worth separating. The shadow *level* is fine — 0.34 of the lit
   neighbour, against a brief asking for 0.15–0.25 — so the fill is not the problem. And
   `hf/lf` falling from 0.58 to 0.52 on a floor that moved into shade is the **correct**
   response, not a regression: a hemispherical source fills one-pixel relief that a raking
   beam would carve, so shaded granular ground genuinely measures flatter. Chasing that
   ratio by weakening the skylight would be chasing physics. The thing to fix is that the
   floor the metric samples is shaded at all, which is a question of where the sun is
   relative to the wash axis, not of how the ground is lit once it is there.
5. Heat haze and atmosphere — including **wind-driven sand at ground level** (saltation):
   low ribbons of grains skipping across the wash floor, snaking around cobbles and pouring
   off the lee edge of bank crests. Distinct from the airborne dust in the sunbeams, and
   hugging the surface rather than filling the volume. The wind direction here must agree
   with the deposited sand in System 1 — grains piling against the upstream face of clasts —
   and with the wind bed in System 6, so the moving sand, the drifted sand and the sound are
   all one weather system. Keep it sparse and intermittent; gusts, not a sandstorm. The
   desert stillness is the feature, and the sand should mostly be still with occasional
   movement that makes the stillness noticeable.
6. Sound design — **COMPLETE.** Three build rounds, two independent critiques (6.5 → 7.5
   realism, 8.5 on "the quiet is the feature"). Final state: quiet bed with a real HF floor
   (8 kHz at −90.5 dBFS, 6.6% of 6–12 kHz bins at the analysis floor, down from 45.8%),
   88% of windows below −45 dBFS, band-decoupled gusts with 13.4 dB of spectral diversity,
   geometry-derived wall reflections out to 220 ms, a coyote with a 19.3% glissando and
   5.3 Hz vibrato, canyon wren, raven, and flow-proportional aeolian edge tones.
   **Nobody in this pipeline can hear it** — every judgement is from measurement and
   spectrograms, so the aesthetic result is unverified until a human listens.
   The wind is the weather authority: `window.__game.audio.wind` is a read-only view,
   `windAt(t)` is analytic, and `gusts(from, to)` returns the burst schedule. **System 5
   must drive its visible blowing sand from these**, so the sand you see and the wind you
   hear are one system.
7. Post-processing and polish

## The `window.__game` capture API

The capture harness is shared and must not be modified. The page must expose a global
`window.__game` as soon as the scene is constructed, with exactly this surface:

```js
window.__game = {
  renderer,                  // the THREE.WebGLRenderer
  fps,                       // number, updated each frame
  begin(),                   // start the render loop (harness calls this once)
  setPaused(bool),           // stop/resume the loop
  renderOnce(),              // render exactly one frame synchronously
  walkTo(distance),          // place the player this many metres along the wash path
  lookAt(yawDeg, pitchDeg),  // absolute look angles; yaw 0 = up the wash toward the sun,
                             // pitch 0 = level, negative = down at the ground
  info(),                    // renderer.info summary: {calls, triangles, textures, programs}
  probe(),                   // luminance histogram of the current frame
};
```

`walkTo` and `lookAt` must be deterministic and must fully settle the scene (no springs or
easing left in flight) so that two captures at the same arguments are pixel-identical.

`renderOnce` renders into a buffer that is still readable by `toDataURL` in the same task,
so the renderer must be created with `preserveDrawingBuffer: false` and captured exactly as
`tools/harness.mjs` does it.

## Capture and critique

`node tools/shoot.mjs <tag>` renders the standard viewpoint set into `shots/` using headless
Chromium on SwiftShader, pinned to four cores at idle priority. It never touches the GPU and
is safe to run while the user is gaming. **Never launch a headed browser and never run a dev
server in the background.**

Every system is critiqued by a separate agent that sees only the rendered PNGs, never the
code. The critic compares against real Sedona sunset photography and rates photorealism out
of 10. A system is done when the critic scores it 8.5+ and stops reporting
"looks like a game" failures.
