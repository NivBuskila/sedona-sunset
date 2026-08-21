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

## Shadow-to-sunlit ratio: defined in encoded sRGB

The "shadowed rock sits at 15–25% of sunlit" target is **mean relative luminance of the
shadowed region over mean relative luminance of the sunlit region, both read off the
sRGB-encoded PNG** — not linear radiance, and not HSV value.

The reason is that the figure came from critics measuring real photographs with image
tools, and a photograph is encoded. Reading the same scene three ways gives 0.072 linear,
0.30 encoded and 0.45 as an HSV-V ratio; only the encoded number is comparable with where
the target came from. Quote the space whenever quoting the ratio.

By that definition the current build sits at **0.30 against a target of 0.15–0.25** — the
fill is too strong, but by less than the linear reading would suggest.

Separately and unambiguously: the away-from-sun fill is **numerically grey**. Measured
irradiance [0.0294, 0.0300, 0.0330] is a 12% spread, while the brief and every critique
call for violet. A neutral fill on red rock desaturates it, which is its own defect
regardless of intensity.

## Vegetation colour, measured from real photographs

| Sample | sat mean | sat p95 | hue median |
| --- | --- | --- | --- |
| Real Utah juniper, sunlit crown | **0.631** | 1.000 | **66.8°** |
| Real juniper, shaded crown | 0.635 | 1.000 | 64.1° |
| Real foliage macro | 0.505 – 0.604 | 0.89 – 1.00 | 67.8° |
| Real pinyon-juniper woodland, distant + hazed | 0.374 | 0.778 | 63.9° |

**"Desaturated therefore dusty" is backwards.** A wild Utah juniper on red rock in full sun
measures 0.63 mean saturation — inside the range usually assumed for a lush garden conifer.
Chroma is not what makes a desert juniper look desert. **Hue and value are**: real juniper
sits at 64–68°, a distinctly olive yellow-green, at low value. The dusty look in life comes
from the grey-blue waxy bloom on the scale leaves shifting hue and dropping value, not from
crushing chroma. Even distant woodland seen through kilometres of haze holds 0.374.

Two measurement notes. HSV saturation is invariant under a uniform exposure scale, so a
dark frame does **not** by itself explain low saturation. But an *additive* ambient or haze
pedestal does crush it — so measure a material's base albedo directly rather than through
the light rig before rebalancing colour.

## One weather system

Three systems reference the wind and they must agree. Ownership is split so nobody has to
guess:

There are **two** winds, and conflating them is what caused the mess below.

- **Tonight's wind** — heading **0.12 rad, blowing down-wash** — drives everything that
  moves or was recently deposited: the audio gust bed, the visible saltation, and the sand
  drifted against clasts. A wash between walls channels air *along* itself, so along-wash is
  also the physically right default, and it is what the saltation and the up-wash grain
  piles already assume.
- **The prevailing wind** — roughly across the wash — is a *different quantity* and only the
  juniper uses it. A tree's lean records decades of prevailing weather, not this evening's
  breeze, so it legitimately differs from tonight's wind and should not be reconciled with
  it. `src/juniper.js` should export it as `PREVAILING`, not `WIND`, so the distinction is
  visible at the call site.

**This was broken and is being fixed.** `src/atmosphere.js` and `src/audio.js` each held a
private `WIND_HEADING = 0.12` while `src/juniper.js` exported `WIND` as (0.94, 0.34) — and
an earlier arbitration of mine wrongly made the juniper's value authoritative for everything,
which sent the drifted sand across the wash while the blowing sand and the sound went along
it. Nobody was importing anybody. A shared constant that three files each define privately
is not shared.
- **Timing and strength** belong to the audio system: `window.__game.audio.wind` for
  current state, `windAt(t)` analytic for any time, `gusts(from, to)` for the schedule.
  **Heading lives there too.** `src/terrain.js` now takes the drifted sand's direction
  from `audio.api.windAt`, called once at boot from `main.js` via `syncWind`, and keeps
  only a fallback constant for a material built before the audio exists.

  A note for anyone else importing it: `windAt` returns the *instantaneous* heading, which
  wanders 0.26 rad either side of the mean and turns another 0.35 with each gust. That is
  right for anything moving and wrong for anything deposited — a drift of sand records
  where the wind has been for the last hour, and reading the live value would also make it
  change between two captures of the same frame. `syncWind` averages the direction vector
  over one full period of the slow wander (2π/0.021 = 299 s), which cancels that term
  exactly. **Deposits take the integral; motion takes the instant.**

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

### The sun was inside the skyline, and only the wall was ever being measured

Recorded because the failure was invisible to every metric the system was watching, and
because the shape of it is likely to recur.

The sun sat at azimuth −13°, elevation 8° for several rounds, chosen on a four-row table of
wall measurements that is still in `src/atmos.js` and is still correct. Every row of it
measures the `wall_lit` crop. None of them looks at the floor, and the floor was at **1.5%
sunlit** in all of them — `tools/horizon.mjs` marches the heightfield along the sun's
bearing and finds a butte skyline of 4° to 14°, so an 8° sun was *inside the silhouette*
and the wash was in full cast shadow. A capture with the shadow map switched off came back
at 51%, which is what ruled out grazing cosine and shadow bias as explanations.

That is what took the ground's `hf/lf` down and made System 1's granular structure
unreadable. It was first read as microshadow flattening, then as a correct response to a
hemispherical light, and it was neither: the light was simply absent.

Elevation 11° and azimuth −9° clear the skyline. Measured across the settings tried:

| azimuth | elev | floor sunlit | wall sat | wall V | grad/L |
|---|---|---|---|---|---|
| −13 | 8 | 0.015 | 0.633 | 0.639 | 0.118 |
| −13 | 11 | 0.057 | 0.605 | 0.753 | 0.156 |
| −5 | 8 | 0.261 | 0.627 | 0.259 | 0.126 |
| **−9** | **11** | **0.705** | **0.617** | **0.565** | **0.152** |

**The floor spans a factor of forty-seven across settings that move the wall by a fifth.**
It was always the sensitive axis and it was never measured. The lesson is not about the
sun: a table of measurements is evidence only about the thing in the crop, and a system
that reports eight viewpoints can still be steered by one of them for four rounds.

### Violet shadows on red rock cannot come from the fill, and here is the arithmetic

The brief asks for violet shadows and the fill was fairly criticised as numerically grey.
Both halves of that are true and the conclusion does not follow.

Rock albedo is [0.335, 0.152, 0.082], so its **B/G is 0.54**. Reflected light cannot be
bluer than incident × albedo, so a fill would have to arrive at B/G ≈ 1.85 — bluer than the
zenith at this sun elevation — for shadowed rock to reflect B/G ≥ 1 and read violet. No
physically-obtainable fill does that. The proof is in the frame: the *same* fill lands on
sand at B/G **0.923**, hue 6.7, and on rock at B/G **0.780**, hue 12.0. The fill is cool;
the rock throws three quarters of the blue away.

The fill's own chroma, from `tools/fillprobe.mjs`, is not grey once it is read per normal —
B/R **1.93** up-facing (hue 218), **1.29** on a vertical, **0.62** on an underside (hue 21).
That is a 3.1× warm-to-cool swing across normals, which is both halves of what the brief
asks for. The [0.0294, 0.0300, 0.0330] reading that looked grey was taken on the one normal
that averages the blue dome against the warm ground, and it was also inflated by
`FLOOR_SUNLIT`, on which see below.

**So the violet on shadowed rock is airlight, not reflectance**, and it is System 5's
in-scatter term — the same term whose neutral source function is recorded above. Anything
System 4 does to force it would be compensating in the light for a defect in the column.

`FLOOR_SUNLIT` in `src/atmos.js` was the one real defect here. It was reasoned at 0.32,
applied to the entire lower hemisphere, and it conflated two quantities: the open wash is
0.70 sunlit at the new sun position, but what a rock face sees below its own horizon is the
few metres of floor at its base, in that face's own shadow. Solid angle decides it and the
near floor has nearly all of it. At 0.70 a shaded vertical goes **pink, hue 331**. At 0.05
it reads B/R 1.29 at a 23% channel spread against 1.12 at 11%, and the underside keeps its
warm bounce — the bounce's *hue* is 21 at every value in the sweep, only its weight moves.

### Blue chips on the wash floor — a scatter defect that a lit floor makes visible

Not System 4's, but System 4's light is what reveals it, and the mechanism is the one
above, so it is recorded here. `sys4d_wash_mid` has flat blue-violet quads scattered over
the floor and the mid-ground. Counting pixels where B > R + 8 in the lower half of the
frame: **2.33% in `sys4c`, 1.18% in `sys4d`**, mean rgb(64,59,92) and rgb(68,61,95). So
they predate the sun move and the move halved them — but a dark blue chip on a dark floor
is invisible and the same chip on a lit warm floor is not, which is why they appear new.

Their B/G is **1.56**, against 0.54 for rock albedo and ~1.20 for the fill on a vertical.
Nothing with a red-rock albedo can produce that. It is a **neutral-albedo element taking
the up-facing sky fill**, which is B/R 1.93 at hue 218 — correct physics for a grey pebble
under open sky, and scatter.js does place off-white Coconino and dark basalt clasts. Two
things suggest it is nonetheless a defect rather than a shadowed grey pebble: the value is
too extreme for one, and they read as *flat* chips, which points at a billboarded or
single-quad element whose normal is pinned up so it takes the full sky lobe regardless of
how it lies. Whoever owns the clast scatter should check the normals on the flat
population. Do not fix it by cooling the fill; the fill is the one term here that measures
correct.

### The blue chips: resolved, and it was not the normals

Recorded because the diagnosis in the section above was wrong in a way worth
keeping. The chips were an additive Rayleigh-spectrum constant in `scatter.js` —
`vec3(0.012, 0.024, 0.090) * 0.85`, applied at full strength to every clast facet
turned away from the sun. `terrain.js` carried the identical term and deleted it
a round earlier for the identical reason; the copy on the clasts outlived it.

Measured rather than argued. Inverting the tone curve on the chip population in
`sys4d_wash_mid` — mean rgb(67,62,98) at exposure 1.15 — recovers linear
(0.063, 0.056, 0.109). The term alone supplies (0.010, 0.020, 0.077): **70% of
the blue channel**. What is left is (0.052, 0.036, 0.033) at B/G 0.92, which is
what a shaded red clast under a violet sky should be. Magnified crops show
ordinary tabular clasts, correctly seated, with a correctly lit warm sliver on
the sunward facet — no billboard and no pinned normal anywhere in it.

Deleting it takes the affected fraction of the lower frame from **1.18% to
0.05%**, and the survivors read B/G 1.20 rather than 1.56, which is shadow and
foliage rather than chips. The lavender sand-sheet patches went with it; they
were the same term on the same surfaces.

The general lesson: the term was justified against a light rig that had no sky
in it. When System 4's SH probe arrived, every compensating hack written for the
old rig became a defect, and they do not announce themselves — one was found and
removed, its twin was not. **Grep for the constant, not for the file.**

### Deferred terrain defects, carried forward from System 1

Not forgiven, only deferred. Revisit these after System 4 and System 7.

- **Midground detail collapse — the standing hypothesis is disproved, and the
  gap is amplitude rather than spectrum.** `tools/_dirtprobe.mjs` generates the
  dirt map in node and averages it over the anisotropic box a midground pixel
  actually covers (5 texels across the view by 30 along it, worked from the
  capture geometry). The map's *shape* survives completely — grad 0.0250 at mip 0
  against 0.0251 at the midground footprint, hf/lf 0.65 against 0.65 — so it does
  not go to wax and there is nothing there for sharper sampling to recover. What
  it loses is amplitude: luminance sd 0.077 → 0.046, and a nine-pixel high-pass
  RMS of **0.038** against 0.115–0.137 in real photographs.

  That 0.038 is a ceiling on what pigment can do, and the arithmetic says so:
  lifting a band from 0.059 to 0.115 needs another 0.099 RMS in quadrature, and
  at the midground's mean luminance of 0.335 that is a third of the mean. No
  albedo mottle on dirt is that contrasty. **Only shadow is**, which is why the
  fifth attempt authored the shadowed *area fraction* of the bed rather than more
  colour.

  Fifth attempt, measured against a matched control (both `--hash nopost`, so
  System 7's chain is out of the comparison): `wash_mid` mid 0.0590 → 0.0623,
  `bend` mid 0.0355 → 0.0378, near field unchanged at 0.1120 → 0.1125. A real
  move and a small one. What is in it: a spatially varying micro-shadow fraction
  in place of the flat 0.26 constant the raking march collapsed to; a ripple
  train whose lee flank casts a one-sided shadow, wavelength scaled by the new
  `aFlow` attribute; flow-parallel current lineation at 5.5, 8.5 and 13 cm,
  chosen because a midground pixel is 12 mm across the view and 76 mm along it,
  so nothing coarser than about 11 cm *across* the line of sight can land inside
  a nine-pixel kernel — every across-channel term the shader had was 19 to 72 cm,
  visible and outside the window; and the grit map read footprint-locked, at the
  geometric mean of the two footprints.

  **The remaining gap is structural and it is not the sampling.** A gravel bed
  has hundreds of stones per square metre; the scatter has 1.7, because a real
  density is millions of instances. So the bed is a texture, a texture converges
  on its mean under a footprint, and the honest lever is contrast between lit and
  shadowed bed. That makes the shadow-to-sunlit ratio — 0.312 against a 0.15–0.25
  target — the largest remaining term in this measurement, and it is System 4's.

  Two traps paid for here. Extending the mud-crack curl's fade to a 9 cm
  footprint lifted the mid band by a quarter and did it by producing a net of
  glowing worms across every pan: `bumpFrom` builds a normal from `dFdx` of a
  sampled value, and past the feature size that derivative is the difference
  between two independent mip samples, not a slope. **A derivative bump cannot be
  extended past its own feature size, however good the reason.** And overlapping
  the ripple train with the lineation multiplied a train varying along the
  channel by one varying across it: the product of two gratings is a grid, and
  the floor came out as brickwork. They are now mutually exclusive, which is also
  the bedform phase diagram — lineation is upper-flow-regime plane bed, ripples
  are lower.
- **Clast burial and scour geometry** — worked in `sys1n`. The upstream wedge and
  downstream tail already existed and three critics still called it the strongest
  tell; a magnified crop says why. A wedge on one side and a tail on the other
  leave the stone's *waterline* — where it meets the bed all the way round — a
  clean intersection between a hull and a smooth plane, and a real one is not
  clean. There is now a broad flat fillet lens centred on each scoured clast,
  mostly below the surface, a shade darker and damper because the fines at a
  stone's foot sit in its shadow and hold moisture. Median burial is up from 0.64
  to 0.74 of the clast's half-thickness.

  **Real excavation now exists, for boulders only, in `sys1p`.** `Terrain.addScour`
  registers a hollow and `heightAtQ` folds it in, so the player walks in them and
  every clast, fillet, tail and collar stone placed after a boulder sits on the
  dug bed. The shape is the one an obstacle in alluvium produces: a horseshoe open
  downstream, deepest on the upstream shoulders and the flanks, zero directly
  under the stone because the stone is *supported* there — which is also why it
  needs no cooperation from the seating code. Depth is 0.42 of the stone's radius
  and the lifted sediment reappears as a low mound in the lee.

  Boulders only, and that is the grid rather than a preference: the mesh is 0.20 m
  in x but **0.42 m in z**, so a hollow has to be a couple of metres across before
  it can be expressed at all. A 0.46 m boulder gives one 2.4 m across, which is
  five z-columns; a cobble's would be two, which is a dimple. Below that size the
  fillet and the burial remain the model, and they are the right model.

  Note that the mesh is built before the clasts exist, so `applyScour(mesh,
  terrain)` re-levels it afterwards — one add per vertex of the same pure term
  `heightAt` reports, so the two cannot drift apart. And note that adding this
  changes the *whole* clast layout: placement rejects candidates on slope, slope
  now differs near boulders, and one changed accept/reject re-randomises
  everything downstream in the RNG stream. Object-by-object before/after crops
  are therefore impossible across this change; region statistics still compare,
  because the floor is statistically homogeneous.
- **Flow sorting** — density contrast raised hard in `sys1n`; the terms were
  already right and were mixed with too much constant. A lag band with a stringer
  through it now carries several times the density of the swept ground a metre
  away. Armoured lag surfaces are expressed as a *tone* (self-shadowing) rather
  than as real pavement, because real pavement density is unreachable by
  instancing.
- **Clast shape** — per-class plan aspect in `sys1n`, 0.72–1.55 on gravel against
  one global 0.88–1.18 band. The long axis is taken out of the short one rather
  than added to the long, which keeps the minimum dimension fixed so a bladed
  clast does not become the knife-edged splinter the narrow band was protecting
  against. Imbrication holds at 0.72–0.84 but scatters ±32° rather than ±20°.
- **Aeolian sand** — put in, in `sys1n`, now that WIND is shared. Sand banks on
  the *lee* face only, between slopes of about 0.03 and 0.175, so it stops dead
  at the crest line where the windward face begins and cannot ice a bank.

  **Now on tonight's wind, imported from the audio, in `sys1p`** — see "One weather
  system". Two bugs came out of that revert. The first is the arbitration: pointed
  at the juniper's across-wash `WIND` the drift went across the channel while the
  saltation and the sound went along it. The second was hiding underneath and is
  worse: the lee test was `dot(gN.xz, wind)` and for a height field the normal is
  (-dh/dx, 1, -dh/dz), so `gN.xz` is *uphill*. Every drift it placed was on the
  **windward** face. It survived a round because the direction was wrong too, and
  sand in the wrong place looks like sand in the wrong place either way. Now that
  the wind runs along the wash the deposit is much smaller — the cut banks face
  across the channel and are neither windward nor lee, so it lands on the
  downstream faces of transverse features only. That is the correct answer and it
  is a lot less sand than the across-wash guess it replaces.
- **Ripples** — wavelength now scales with flow depth through a new `aFlow` vertex
  attribute (three fixed trains crossfaded, since frequency cannot vary
  continuously without the phase drifting), with a beat partner for crest
  bifurcation and the existing plane-bed patches. The phase is warped by a
  metre-scale field: warping it with the macro maps alone leaves it constant over
  the two metres a crest occupies, which is a second route to corduroy.
- **Polka-dot cut banks** — bank clasts blend 0.74 toward the matrix rather than
  0.55, and their per-instance value jitter is squeezed on bank faces, where it
  was doing more of the work than the lithology.
- **Residual 1–2 px hash** — largely identified. The clast surface map's bedding
  lamination is authored at 3 mm and the UVs hold that physical size, so on a
  large clast in the near field 3 mm is about one pixel; a one-pixel periodic
  ridge crossed by the per-lamina hardness hash is a moiré that reads as woven
  cloth. The lamination is cut hard and the clast normal now relaxes toward the
  geometric normal as the footprint passes the map's feature size, the same fade
  the terrain has had for a round.
- **Mud-crack plate relief** — the *relief* is still near-field only, on purpose;
  see the derivative-bump trap above. The curl reaches the mid distance as a tone.
- No talus cone as a discrete landform.
- **The pale boulders: the clast material was the problem, not its pigment.** Four
  colour attacks had moved a near-field one from rgb(162,132,102) to (152,119,89)
  against a bed near (120,85,62) and it was still the loudest object in `ground`.
  Stopping and measuring the *surface* settled it. `tools/_clastprobe.mjs` shades
  one clast facet out of the real maps through a real mip pyramid, the way
  `wallprobe.mjs` does for rock: mean one-pixel gradient **0.0201 at 1.5 mm per
  pixel falling to 0.0028 at 35 mm**, a sevenfold collapse, with hf/lf 0.55 near
  and *above 1.0* far — a map mipped down to noise around its own mean. Identical
  signature to the rock walls, identical cure: the grit layer, no content below a
  fourteenth of its own tile and therefore no scale of its own, sampled at
  whatever scale the pixel footprint asks for. Same probe after: **0.032 to 0.033
  and flat across distance, hf/lf 0.62–0.77.**

  Four mechanisms out of one texture fetch, and the critique named three of them.
  A tone stipple. Crevice occlusion on *direct and indirect alike* — an aoMap-style
  indirect multiply is the conventional place for it and it is wrong here, because
  at eight degrees of sun elevation the direct term is most of the light and a
  crevice that only darkens the sky contribution leaves the sunlit grain as flat
  as it was. A small tangent-space normal. And dust on the sky-facing facets only,
  weighted by instance size: a slab has lain in one attitude for decades and
  collects a film of whatever the wash is made of on every face the sky can see,
  which is why real desert talus has red tops and pale sides, while a pebble is
  turned over by every flood and keeps its own lithology.

  **Still open, and it is now a lithology question rather than a surface one.** The
  loudest object in `p1c_ground` is a `slab`/`block` plate on the talus apron at
  V 0.702, hue 24.6°, B/G 0.655, against bed at V 0.524, hue 20.3°, B/G 0.608 — so
  a third brighter than its bed. Those classes draw from `CDF_B`, the buff
  sandstone mix, and pale Coconino talus below a Coconino wall is correct geology.
  If it is still wrong at that value then the *mix* is wrong, not the material.
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

### `layers.mjs` numbers from before 21 Aug are partly wrong

Its sky test cut on absolute brightness, so it was exposure-dependent. When System 4's floor
luminance restoration and System 7's grade landed, sky bands that had been under the
threshold crossed it — and on at least one view the top five bands held 4,000 pixels at
saturation 0.16 and B/G 1.08, which is sky being credited as a ridgeline step. It now finds
the skyline geometrically per column, which is exposure-invariant. Under the fixed metric
every view reports a non-zero step count, including the one that previously read zero.

Treat any step-count or edge-share figure quoted before that fix as unreliable.

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

- `tools/_clastprobe.mjs`, first run, put every pixel of the facet at 0.95 in encoded
  sRGB, where the curve is nearly flat and every gradient it existed to measure was
  compressed fivefold. **A probe with a free exposure has to be exposed.** Check the
  reported mean before reading anything else it says.

Two habits follow. Have a measurement report its own noise floor so a reader can see
whether a result clears it. And when a statistic is aggregated over a whole take, ask what
fraction of that take it is actually describing: a full-duration band RMS is dominated by
the loud 15% and says nothing about the quiet 85%, which in an ambience *is the piece*.

### Amplitude is not structure, and `hf/lf` cannot tell them apart

`_clastprobe.mjs` was exposed correctly, round-tripped, and still recommended a setting
that came out of the render as high-contrast polka dots. The grit layer's normal channel
at its full authored amplitude is a tangent slope near 0.8; at eight degrees of sun
elevation that is enough to swing a grain from fully lit to fully shadowed, so the grain
field goes *binary*. A binary field has an excellent one-pixel gradient and a very good
hf/lf, and it looks like pebble-dash render. The metric was measuring the right band and
saying nothing about what was in it.

The fix was to weight the three channels the other way round — normal smallest at 0.25,
tone and cavity carrying the signal — which is also the physically right division, because
at a grazing sun a granular surface expresses itself mostly through self-shadowing rather
than through facet orientation. **Read `sd` next to `grad`** and distrust any setting
whose contrast runs far past the surface it is meant to resemble.

Second lesson from the same change, and a cheaper one: it also had the grit locked to the
*geometric mean* of the anisotropic footprint, which is what `terrain.js` does, and copying
that put the grain two to four pixels across. Two to four pixels is not grain at any
amplitude. The terrain locks to the mean because its pixels are grazing everywhere and it
needs the layer to survive the long axis; a clast should lock to the **short** axis, one
texel per pixel across the view, and let the texture's own anisotropic filtering — 8:1
here — cover the long one.

### Three's vertex chunks do not run in the order you inject them

`scatter.js`'s level-of-detail block computed the projected pixel radius in its
`begin_vertex` injection and consumed it in its `color_vertex` injection. But three's
vertex `main()` is `uv_vertex`, `color_vertex`, six normal chunks, *then* `begin_vertex` —
so the colour convergence was reading `vFar` a whole chunk before anything assigned it.
An unwritten varying is undefined, this driver hands back zero, and the effect is that the
distance colour fade the code documents at length **had never once run**. The geometry cull
and the normal flattening were fine, because those sit at or after `begin_vertex`, which is
why the gravel hash still went away and nothing pointed at this.

Nothing measured it either, and nothing would have: the term it disabled was a *reduction*
in midground variance, so its absence looks like a scene with slightly more variance than
intended, which is not a defect anyone reports. **When injecting into `onBeforeCompile`,
check the chunk order in the three build rather than assuming the order they appear in the
material's documentation.** One grep settles it:
`node -e "const s=require('fs').readFileSync('node_modules/three/build/three.module.js','utf8');const i=s.indexOf('#define STANDARD');console.log(s.slice(s.indexOf('void main()',i),i+900))"`

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
   `hf/lf` drop it was reported as, and it is directional rather than global — in the same
   frames the `wash_mid` *wall* went the other way, 0.193 → 0.354. Against `tools/atmos.mjs`
   the floor's own model predicts `L` 0.416 sunlit and 0.184 shaded; it measures 0.122, so
   the sampled floor is not merely grazed by an 8° sun, it is below the model's own shaded
   figure. Sun-relative-to-wash-axis and shadow-cascade coverage are both still open as the
   mechanism; the arithmetic above rules out "correctly exposed grazing floor" and nothing
   more.

   `hf/lf` falling from 0.58 to 0.52 on a floor that moved into shade is at least partly
   the **correct** response rather than a regression: a hemispherical source fills the
   one-pixel relief a raking beam would carve, so shaded granular ground genuinely measures
   flatter. But it is not the whole story, because the fill is measurably too strong. On the
   same surface in the same frame — `sys4c` `wall_lit`, brightest 40% against darkest 40% —
   shade sits at **0.347** of sun in HSV V, against a brief asking 0.15–0.25.

   **That target needs a colour space before it can be met.** The same fill measures 0.072
   of sunlit in linear luminance, 0.30 encoded, and 0.45 as the predictor's rock V ratio —
   one is far below the band, one is at its top, two are above it. Until it is stated which,
   the number cannot be aimed at, and I would rather say so than pick the reading that
   flatters the render. What *is* unambiguous is the fill's chroma: the probe's away-from-sun
   irradiance is [0.0294, 0.0300, 0.0330], a 12% spread. It is described as violet and is
   numerically grey, and a near-neutral fill on red rock is a desaturating wash — which is
   the mechanism behind shaded rock losing 0.16 of saturation where lit rock lost 0.06.

   One dead end, so nobody repeats it: raising the escarpment coverage (`COVER_MAX`,
   `COVER_TOP` in `atmos.js`) to the geometry its own comment derives — solid walls to 53°
   rather than 0.46 of the horizon to 31° — moves the ratio the **wrong** way, 0.452 → 0.535,
   and darkens the sunlit wall with it. Replacing sky with sunlit red rock adds more red
   bounce to a red face than the blue it takes away. The comment also overstates what the
   code does: cosine-weighted, the present coverage removes about 3% of the upward
   irradiance, not "a little over half the dome".
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
