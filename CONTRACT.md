# Sedona Sunset — Build Contract

## The governing instruction

> "just do whatever you find good and it should be a great experience for user that's it"

Where a measurement and the experience disagree, **the experience wins.** This project has
proved that repeatedly and expensively: a shimmer that measured too weak and looked like
melting; a soundscape whose quiet scored 8.5 and read as horror; a metric that could not see
the one change that fixed the thing a user pointed at. Nine instruments have now been caught
measuring the wrong thing.

Measurement is still how we work — it is the only way to tell a real change from a hopeful
one — but it is the instrument, not the goal. If a frame looks wrong while every number is
green, the numbers are wrong.

Do not stop to ask which of two good options to take. Take the better one and record why.

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

## Shadow-to-sunlit ratio: flat face against flat face

Two estimators disagree by 3× on the same frame, so the gate needs one named. **Use the
flat-face comparison**: a flat shaded face measured against a flat sunlit face, both read
off the sRGB-encoded PNG.

The reason is provenance. The 15–25% figure came from critics measuring real photographs
with image tools, and what they compared was a shaded rock face against a sunlit rock face
— not a percentile split within one region. The alternative, darkest-40% against
brightest-40% within a single view, matches how `sat.mjs` and `hue.mjs` pick their
populations but does not match where the number came from, and it reads systematically
lower because both tails include partially-lit pixels.

On the flat-face estimator the build has moved 0.514 → 0.344 against a 0.15–0.25 target, so
it is heading the right way and more occlusion is still wanted — **but see the constraint
below before chasing it.**

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

## Open, unassigned: white/black faceted shards in the near foreground

Visible bottom-left of `sys3e_wall_shade.png` — a cluster of hard-edged facets, some pure
white and some pure black, in the immediate foreground. It reads as a clast or talus block
whose shading has failed rather than as geometry that is merely ugly: pure black beside pure
white on adjacent facets of one object is the signature of a bad normal, a NaN, or a
material that is not receiving light at all.

Confirmed **not** System 3's — the nearest vegetation instance of any class to that camera
is 8.8 m away and is a grass card. So it belongs to whoever owns the clast or talus it is.
Note the juniper's NaN was found by scanning buffers **pre-merge** with `tools/nanhunt.mjs`,
which names the limb and ring instead of an index into 30,000 merged vertices; the same
technique will localise this quickly if it is a NaN.

Three separate critics have already had to write around an untextured object in these frames.
Whoever picks this up should verify from a magnified crop that it is gone from `wall_shade`,
`wall_lit` and `wash_mid`.

## Never run `pnpm install`

`node_modules/playwright` has vanished mid-session twice, breaking captures for whoever was
mid-run, and both times it came back on its own. That is what a concurrent `pnpm install`
looks like from the outside: pnpm rewrites `node_modules`, and during that window the
package is genuinely absent.

Dependencies are installed and correct. **Do not run `pnpm install`, `pnpm add`, or any
package manager command.** If a module appears to be missing, wait thirty seconds and retry
before concluding anything — you are probably watching somebody else's install. If it is
still missing, report it rather than repairing it, because a second install is what turns
one agent's brief outage into everybody's.

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

**The gate is the real-photograph band, not a previous build's numbers.** Rock saturation
was once recorded here as 0.615–0.626 with hue 18.9–19.4°, which was simply what one build
measured on the day. Lighting has legitimately moved since — sun elevation 11° → 15°, a
measured escarpment, a height-lerped probe, extinction from 1.76 km to ~19 km — and chasing
a stale snapshot would mean undoing correct work to match an accident.

Current measured state on the ungraded control: **saturation 0.591, hue 21.1°, value 0.720**.
All three sit inside the real-photograph bands (0.42–0.65, +15.6–31°, 0.59–0.73), so this
passes. Note value is at the very top of its band — the scene is about as bright as a Sedona
reference gets, and further exposure should go down rather than up.

Judge against the photographic bands. Re-measure and re-record the build's own figures when
lighting changes, rather than treating an old snapshot as a target.

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

### The sun disc: re-tested under thin air, and geometry is not the constraint at all

**Retested after System 5 took the visual range from 1.76 km to about 19 km, which was the stated
reason to defer this. The disc still does not read, and the geometry question should not be
re-opened.** At the shipped sun the disc is *already geometrically clear* in `wash_low` —
`tools/sundisc.mjs` confirms nothing is in front of it — and measured there against the sky
immediately around it, it stands **+0.1 code value, 0.0% contrast** graded, and +0.5 cv, 0.2%
ungraded. That is the whole argument in one number: the disc is unoccluded and invisible, so carving
a notch in the skyline on the sun's bearing would faithfully reproduce an invisible disc in a second
view. The far-ridgeline agent should not be commissioned for it.

Why, with the arithmetic, so nobody has to take it on faith. The sky beside the disc sits at 3.40
scene-linear. ACES puts 0.97 linear at 230 cv and 0.50 at 204 cv, so **the near-sun sky would have
to come down 6.8× before a 10% step could read at all.** Thinning the air does not do that and was
never going to: the near-sun brightness there is the forward-scattered Mie aureole, which scales
with the sun's own radiance rather than with the extinction, and thin air keeps the disc bright
alongside it. Both land in the shoulder together. The condition for a *defined* disc is the opposite
of what the far field wants — a sun you can look at is a sun dimmed to where the curve still has
slope, which is heavy haze and a 2 km visual range, and System 5 has correctly spent that on the
receding ridgelines instead. **The disc and the far field are competing for the same dial, and the
far field won on merit.**

So the sun stays implied rather than shown, and the honest version of the brief's requirement is
what the frame already does: an aureole, a raking beam, and long shadows.

**One methodology trap, recorded because it produced a confident wrong answer for several minutes.**
The first re-measurement reported the contrast rising from 3% to 20% and looked like vindication. It
was an artefact: the disc sits within a few pixels of the butte silhouette, so the annulus used as
"surrounding sky" was averaging in dark rock and flattering the disc by dragging the reference down.
The azimuthal standard deviation of 37 code values on what should have been clear sky was the tell,
and it was visible in the number before it was understood. `tools/discprofile.mjs` now takes the
background from sky-classified pixels only. **A background estimate that includes the thing you are
measuring against is worse than no measurement, because it comes with a plausible number attached.**

### Measured and declined: azimuth −13 buys the gate and costs the floor

For the record so it is not re-opened as an easy win. At elevation 11, azimuth −13 takes the
shadow-to-sunlit gate to **0.243 — inside its 0.15–0.25 band for the first time in this project.**
It costs **62% of the wash floor's level**, taking floor L from 0.137 to 0.052 and floor grad/L from
0.192 to 0.230, back out of band on the far side.

Declined. The floor is what the player walks on for the whole experience, System 1 spent six rounds
building structure into it, and it had only just entered its own band from above. 0.07 of a ratio is
not worth 62% of the thing the eye is on. The gate stays near 0.31 with the toe, and the remaining
distance is accepted rather than bought.

### Check the incidence before you conclude anything about the fill

The single most expensive mistake of the project, and it is a one-line rule. The wall takes a cosine
of `-sin(azimuth + 7.5)` on the beam, which at azimuth −9 is **0.026** — the surface the
shadow-to-sunlit gate is measured on was lit at **88 degrees of incidence**. The measured gate read
0.428 while this same model's prediction for a *sun-facing* vertical was 0.189, and that factor of
two-plus was geometry, not light. An entire day went into dimming the fill, rewriting the escarpment
model, widening penumbras and correcting albedos, all of it aimed at a numerator when the problem
was that the denominator had almost no sun on it.

The tell was available from the start and was even written down: `atmos.js` printed "wall, cos 0.03
on beam" in its own predicted-pixels table. It was read as a description and not as a diagnosis.

**So: before concluding anything about a fill, a probe, or a grade from a ratio, check the incidence
angle on both surfaces the ratio is taken from.** A gate between two faces is only a statement about
lighting if both faces are actually lit.

### The sun disc is hidden by two independent things, and geometry is the lesser one

The brief asks three times for a visible sun low in the gap, and `sys7a` does not have
one. It would be natural to spend geometry or sun position on that. Measured, neither
would work on its own.

**Occlusion.** `tools/sundisc.mjs` raycasts five rays across the disc's true angular width
from each viewpoint's eye. At the shipped azimuth −9°, elevation 11° the disc is in frame
in all four views and blocked in all four — by `butte0` at 469–493 m in the two wash views,
and by `wallL` at **58 m** in `sun_gap` and `bend`. Two different occluders, and the one
guarding the composition view is a near wall, not a distant butte. Candidates, all measured
on the same worktree at HEAD:

| candidate | disc | floor sunlit | floor grad/L | wall sat | wall V | wall grad/L |
|---|---|---|---|---|---|---|
| az −9, el 11 (shipped) | blocked, all 4 | 0.735 | 0.180 | 0.615 | 0.589 | 0.132 |
| az −4, el 11 | **clear, all 4** | 0.800 | 0.147 | 0.545 | **0.247** | 0.143 |
| az −10, el 18 | **clear, all 4** | 0.961 | **0.098** | 0.512 | 0.805 | 0.153 |

The skyline has a real gap from azimuth −4° to +6° that is open at every elevation down to
9°; the sun sits 5° outside it. So the cheap route is 5° of azimuth, and its cost is the
lit wall — value 0.247, which puts the project's own rock-colour gate in shade. Elevation
18° clears it while keeping the azimuth and lighting everything, and its cost is the
floor's structure: grad/L 0.098 against a reference band of 0.12–0.16, because a sun that
high stops raking. That is System 1's granular detail going flat again, and the brief's
"heavy and low" with it.

**Contrast, which is the one that actually matters.** A frame was rendered at az −4 where
the disc is geometrically clear. It is still invisible, and the pixels say why: the
brightest pixel sits exactly at the disc's predicted screen position, and the luminance
profile across it reads 77, 177, 249, **255**, 249, 247, 247. The disc is seventeen
saturated pixels on a plateau at 247 — a **3% contrast**. The near-sun sky is already in
the tone curve's shoulder before the disc is drawn.

Neither lever moves that. Raising the disc radiance from 40× the aureole peak to 1650×
— a defect worth fixing on its own, see `src/sky.js`, since the cap was guarding half-float
headroom that `tools/hdrmax.mjs` measures as unused by four orders of magnitude — only
widens the clip: saturated pixels 17 → 23, pixels above L 250 873 → 1172, peak unchanged at
255. Cutting exposure 1.15 → 0.90 moves the plateau 247 → 244 while taking the floor from
0.800 to 0.690 sunlit and the wall from V 0.247 to 0.200. ACES's shoulder is compressing a
22% exposure cut into three code values.

**So the sun cannot be made visible by moving it, by brightening it, or by exposure.** What
has to come down is the near-sun haze itself — System 5's in-scatter, whose source function
a critic independently found to be neutral white while the sun reddens the rock, and which
System 5 is correcting with solar transmittance and a Henyey–Greenstein phase. That
correction reduces exactly the near-sun brightness that is clipping. **Do not spend a notch
into `wallL` at 58 m, or the lit wall, until it lands** — either would buy a geometrically
unoccluded disc that still reads as a 3% ripple, which is the frame that was just rendered.
Re-measure with `tools/sundisc.mjs` afterwards; the azimuth decision is worth making then.

### Three ways to ask "is the sun occluded" that all give wrong answers

Kept because each failure looks like a result, and two of them produced tables that were
confidently wrong before the third was tried.

`tools/horizon.mjs` marches the terrain heightfield. The buttes are separate meshes, so it
reported the sun clear at elevation 11 while System 7 reported it occluded from every
viewpoint. Both were right about different geometry.

Reading post's `_diag.sceneRT` gave two contradictory answers for the same candidate on
consecutive runs: that buffer is only rewritten while the bloom chain is live, so the tier
governor can turn it off on a slow frame and leave a *stale* frame to be measured.

Testing a sky-off frame against black reported everything occluded — the grade lifts the
black floor and adds grain, so no pixel in a finished frame is ever zero. Differencing a
sky-on frame against a sky-off one then reported everything clear, because veiling glare is
computed from the whole frame, so removing the sky perturbs every pixel including the ones
standing on rock.

Geometry is the only ground truth. `window.__game._three` exists so a probe can build a
Raycaster; a dynamic `import('three')` inside an evaluate context hangs rather than
throwing, which cost seven minutes of wall clock before that was understood.

### The wash is a room with one lit doorway, and the fill was modelled as open country

The skylight fill's level is set by an escarpment term in `src/atmos.js` that had two reasoned
constants in it: a coverage of 0.46 of the horizon thinning out at 31 degrees. `tools/skyview.mjs`
now measures what they were guessing at, by firing a hemisphere of rays from the standard
viewpoints. The skyline round a point on the wash floor stands at **36 to 54 degrees at eleven of
twelve bearings, with a single window at 15 degrees — at bearing 189, which is the sun's own
bearing to within a degree.**

Both constants were low, and the lateral weighting was worse than low. It credited open sky
up-canyon, where the skyline is 45 degrees, and up-canyon is exactly the bearing the
away-from-sun fill integrates over. A wall face was being given 0.89 of the sky where geometry
gives it **0.215**, which is why substituting rock for sky moved the fill by 2.3% instead of the
factor it should.

Replacing the band with a measured skyline reproduces the raycast on all four normals — blocked
0.407 / 0.818 / 0.768 / 0.524 modelled against 0.431 / 0.800 / 0.785 / 0.575 measured — so the
parameters are calibrated to geometry and the gate moving is a consequence rather than a fit.

Two further things the rays settled:

- **Sky visibility is a function of height, not position along the wash.** It is 0.20 to 0.30 on a
  lateral normal at 18, 46, 78 and 120 m, but climbs 0.215 → 0.262 → 0.321 → 0.456 → 0.744 →
  0.954 from the floor to 70 m up. The rim is near 65 m.
- **The sunlit fraction of that skyline is 0.123 to 0.218** across the viewpoints, and it is zero
  over the lower forty percent of the wall and 0.5 to 0.75 at the crest. A smoothstep integrates
  to exactly one half over its span, so a crest of 0.57 starting at four tenths of the height
  gives a mean of 0.171 against a measured 0.170. That makes it a measurement, not a knob.

It is also the *only* escarpment parameter that matters. Swept over its range it moves the shaded
fill from B/R 0.27 to 0.94, while the wall's own sky visibility moves the shadow-to-sunlit ratio
by 0.002 — the wall's radiance is set by what the sun does to its crest, not by the sky it sees.
Bounce from a floor that is seventy percent sunlit is an obligatory term (a vertical face over an
infinite Lambertian plane collects radiance × π/2, so the coefficient is geometry) and it is worth
+0.009 on the ratio.

**The estimator matters more than the lighting.** On one build, shadow-to-sunlit reads 0.125
comparing the darkest 40% against the brightest 40% within `wall_lit`, and 0.37 comparing a flat
shaded face in `wall_shade` against a flat sunlit one in `wall_lit`. Three times, from the choice
of population alone. `tools/fillprobe.mjs --ratio` uses the first, matching the 40/40 split
`sat.mjs` and `hue.mjs` use, so a ratio and a colour always describe the same two populations —
but the target's provenance is critics with image tools on photographs, which is the second.
Quote the estimator whenever quoting the ratio, and note that on a region more than about two
thirds sunlit the darkest 40% is not shadow at all and the number is meaningless: `wash_mid` and
`ground` read 0.33 to 0.39 for that reason alone.

Two costs came with it. Floor grad/L went from 0.141 to 0.186 against a 0.12–0.16 target, and the
shaded wall face from 0.044 to 0.021.

The first is headroom rather than damage. Floor structure is a modulation of direct light, so its
contrast scales with how far shadowed bed sits below sunlit bed: the same authored texture now
reads 32% more contrasty, which is the direction five rounds of work on that bed were trying to
reach against a stated ceiling of 0.038 high-pass RMS versus 0.115–0.137 in photographs.
Amplitude is the cheap knob for landing back inside the band; contrast that was not there is not.

The second is a real defect. That face is lit by fill alone, and at mean relative luminance 0.039
its gradient of 0.0075 is only a few code values, so 8-bit quantisation and the grade's black
floor start eating the structure. It is the binding constraint on how dim the fill may go.

**Built, and unverified against a rendered frame: the probe was built for the floor, and the walls
are not on the floor.** The rays measured sky visibility climbing 0.215 → 0.262 → 0.321 → 0.456 →
0.744 → 0.954 from the wash floor to 70 m up, but a `LightProbe` is one set of SH coefficients for
the whole scene, so every surface was given the floor's aperture. The shaded wall face that is
crushing spans roughly 5 to 40 m of height, where geometry gives it 0.3 to 0.7 of the sky against
the 0.215 the probe assumed — so something like a factor of two of that crush is self-inflicted,
and recoverable *without* touching the escarpment or the ratio.

`src/atmos.js` now also integrates the same environment with the escarpment removed, and
`src/sky.js` lerps between the two per fragment on world height. Irradiance is linear in the SH
coefficients, so the difference is itself an SH and one extra nine-term evaluation covers it
rather than two probes. A scalar multiply on indirect would have been the cheap version and is
wrong in kind: it removes the sky without adding the rock that replaces it, which is the old
lateral-band error running backwards.

What the CPU can and cannot settle, from `tools/probefit.mjs`:

- **The constant folding is exact.** `closed + delta` reproduces three's own `shGetIrradianceAt`
  on the open probe to 5.9e-16 relative, across five normals. Worth checking rather than trusting,
  because a wrong basis constant would have shown up as nothing more specific than a slightly flat
  frame.
- **The ramp fit is level with the skyline model's own calibration**: rms 0.050 in sky visibility
  over four normals and six heights, against 0.02–0.05 for the skyline itself. Two ramps blended on
  `normal.y`, because what differs between normals is the *rate* — an up-facing surface is already
  half open at the floor and saturates early, a wall face starts nearly shut and opens late.
- **The residual is not uniform.** It reaches +0.13 on the sun-facing normal high up, because even
  above the rim that bearing still has far skyline in it while the open probe assumes clear sky.
  Those surfaces are direct-dominated, so the error lands where the fill is the smallest share of
  the light.
- **Undersides are not untouched, and it would be easy to claim they are.** The ground half of both
  environments is identical by construction, but SH9 is low order and the sky coefficients leak
  into a down-facing lobe: a downward normal goes 0.0109 0.0082 0.0074 to 0.0138 0.0107 0.0088
  across the full lerp. Still warm at both ends, R above G above B.
- **World Y is used raw.** The wash floor lies between −1.56 and +1.51 m of zero over the whole
  220 m traverse, which is three percent of the ramp's 53.5 m scale.

Not on the quality ladder, deliberately: zero texture fetches and zero derivatives by
`tools/shadercost.mjs`, four sqrts and about eleven vec3 multiply-adds. Gating it would need a
`#define`, so a tier change would recompile every lit program mid-play, and one compile hitch
costs more than the term does in its lifetime. The free-exponent fit wanted 1.46 and 1.12; pinning
to 1.5 and 1.125 gives the same residual to three decimals, so two `pow` calls became a sqrt chain
for nothing.

The one capture this needs should be taken after System 7's black-floor work, since the crush
metric moves when they change it — and it should be one shot reporting the crush and the ratio
together, not an iteration loop.

**Verified, and the cost turned out to be a correction.** Measured as a true pair — one tree, the
lerp reverted in `src/sky.js` and `src/atmos.js` and nothing else, both frames under System 7's
cubic toe:

| | lerp off | lerp on |
| --- | --- | --- |
| shaded wall face, L mean | 0.039 | 0.048 |
| shaded wall face, pixels pinned at zero | 0.12% | 0.04% |
| shaded wall face, p1 | 0.93 cv | 1.43 cv |
| shaded wall face, grad/L | 0.261 | 0.191 |
| wall_lit midwall, grad/L | 0.213 | 0.167 |
| floor, grad/L | 0.186 | 0.186 |
| gate, flat face | 0.361 | 0.362 |
| lit rock saturation | 0.672 | 0.664 |

The shaded face gains 23% of level and loses two thirds of its clipped pixels, and **the floor is
identical to every reported digit** — which is the check worth having, because the ramp is meant to
be zero at the floor and the floor is where the probe was already right.

The gradient figures read as a 27% loss and are not one. Real Sedona cliff faces measure 0.088–0.201
grad/L, and both wall regions were *above* that band before the lerp and are inside it after: the
shaded face 0.261 to 0.191, midwall 0.213 to 0.167. The 0.12–0.16 band that made these look like
regressions is a floor figure, from arroyo ground, and does not apply to a vertical face. A wall
lit only through a slot reads as too contrasty for rock, and adding back the sky it can actually
see is what fixes that, so the direction is right twice over.

Absolute gradient falls 12% while level rises 23%, and that is encoding rather than physics: the
added fill is spatially smooth, so it raises the level into a shallower part of the transfer curve
and compresses the structure already there. It is the same arithmetic System 7 measured when
dimming, running backwards.

The gate does not move — 0.361 to 0.362. Brightening a shaded face is exactly the gate's numerator,
so this was the one number at risk, and it survives because the ramp is near zero over the lower
part of the face that the gate's population is drawn from.

### Lit rock left its band, and it was the escarpment — the same change that bought the gate

Lit rock saturation was measured at 0.690 in the ungraded control against a 0.615–0.626 contract
figure, with four candidates named: the escarpment change, the height lerp, System 5's in-scatter
and extinction work, or the far ridgelines. **It is the escarpment, and it is a single commit.**

Bisected with captures rather than argued, `wall_lit` only, `sat.mjs --lit` so the population
matches, each one 42 seconds on the GPU:

| commit | time | frame median | lit rock sat |
| --- | --- | --- | --- |
| `3eefc49` System 5, extinction at the swept knee | 17:00 | 36 | 0.598 |
| `30e3a3d` through the far ridgelines and the perf pin | 17:13 | 36 | 0.598 |
| `8d6ac73` through the juniper NaN fix | 17:28 | 36 | 0.598 |
| `803ea63` through the saltation sheet | 17:59 | 36 | 0.600 |
| **`3e19549` the measured escarpment skyline** | **18:37** | **19** | **0.672** |
| `b1be79f` the escarpment, cleaned up | 20:30 | 19 | 0.675 |
| `1bae73b` the height lerp | 20:42 | 23 | 0.665 |

Five captures spanning fourteen commits from five systems sit at 0.598–0.600, so System 5 and
System 2 are cleared with measurements rather than reasoning. The step is entirely at one commit,
and it is mine.

**Two false trails are worth recording, because both were plausible and both were wrong.** The
first: the chronology of the tags said the jump was at `sys4e`, and `sys5f` — another system's
capture from another system's session — showed it eighteen minutes later, which looked like proof
the cause was shared upstream and not mine. It was not. Every agent works the same working tree,
so my *uncommitted* escarpment edits were live in their capture too. A tag's timestamp dates the
capture, not the commit, and the two differ by half an hour here.

The second: the escarpment's fill is redder than what it replaced, so the arithmetic was run on
whether a fill that small could move saturation at all — probe irradiance 0.0159 against a rock
pixel of 0.1454, about one percent, apparently far too small. That comparison is meaningless: one
side is irradiance and the other is a tone-mapped pixel with `SCALE` 19 in between. The measurement
settles it in the other direction — the crop's median falls 36 to 19 when the escarpment lands, so
the fill was nearly half of that region's light. **Do not let a units mismatch overrule a
measurement, and do not run the arithmetic in encoded space.**

**The mechanism is a genuine trade, and it is separable.** Fill *luminance* sets the shadow-to-sunlit
gate; fill *chroma* sets rock saturation. Modelling the wash as a room took the gate 0.514 → 0.344
and simultaneously replaced blue-rich open-sky fill with dimmer, redder rock bounce — so red rock in
a red room measures more saturated. Both numbers moved because both are the same physical change,
not because one is a defect. The per-band decomposition of `sys5e` against `sys4e` confirms it is a
uniform veil that left rather than a material that changed: every brightness band from 0–32 to
144–255 lost 5–17 code values and gained saturation, which no localised albedo edit does.

The height lerp recovers 0.010 of the 0.072 without touching the gate, and that is the only free
part. The rest is a choice between a gate figure and a colour figure, and it belongs to whoever owns
the composition rather than to the system that surfaced it. Recorded, not silently traded away.

**The chroma lever was taken, it found a real defect, and it bought 0.004.** Both halves of that
are worth having.

The defect is real and was not a matter of degree. The escarpment's albedo was 0.335 0.152 0.082 at
0.755 saturation, and System 2's stratigraphic column — in this repo, with a linear albedo and a
thickness per bed — has nothing in it above 0.644. The fill was bouncing off the reddest hematite
lens inside the reddest bed and calling it a cliff. A real section here is eight red beds, one grey
limestone ledge, and twelve metres of cream Coconino on top; `tools/wallalbedo.mjs` averages the
actual `LAYERS` table weighted by solid angle from the wash floor, which is the conservative of the
two available weightings because it foreshortens the pale cap from 17 percent of the section to 6.7
percent of the view. That gives 0.289 0.162 0.121 at 0.581 saturation, held to the old luminance to
four decimals. A second instance of the same error sat one term along: the sky the far wall sees was
reduced to a scalar luminance and multiplied into all three channels, handing the bluest source in
the scene to rock as grey. Rescaled to carry the same luminance it always did.

Measured as a pair at one HEAD, control and change:

| | before | after |
| --- | --- | --- |
| fill B/R, across | 0.591 | 0.673 |
| fill luminance, across | 0.0111 | 0.0109 |
| lit rock saturation | 0.670 | **0.666** |
| lit rock hue | 12.9 | 13.6 |
| gate, flat face | 0.116 / 0.273 | 0.116 / 0.276 |
| floor grad/L | 0.192 | 0.192 |

The fill's chroma moved 14 percent at 2 percent of luminance, exactly as designed, and lit rock
moved 0.004. **The residual is 0.040 and the chroma lever cannot reach it.**

The reason is worth recording, because it also corrects the diagnosis above. The escarpment's 0.072
was not a chroma effect — it was a *level* effect. That change dropped the crop's median from 36 to
19 code values, and this transfer curve saturates as it darkens: within one frame, lit rock runs
0.844 saturation at V 0.043 up to 0.571 at V 0.874. Replacing sky with rock made the frame darker
far more than it made it redder, and darker is what raised the number. Correcting the chroma to the
scene's own stratigraphy was still the right thing to do — it removes a surface model that was
indefensible on its own terms — but it was never going to recover a level effect.

### The gate was a geometry problem, and the wall was grazed at 88 degrees

**The whole evening of dimming the fill was fighting the wrong thing.** The wall takes a cosine of
`-sin(azimuth + 7.5)` on the beam, which at azimuth −9 is **0.026** — the surface the gate's
denominator is measured on was lit at 88 degrees of incidence. That is why the measured gate read
0.428 while this model's own prediction for a *sun-facing* vertical is 0.189. The fill was never the
problem; the denominator was.

Two levers, and `tools/expose.mjs` separates them by inverting an ungraded capture through the exact
ACES curve, changing the level in scene-linear, and re-encoding:

| lever | gate | sunlit V | lit sat | shaded face |
| --- | --- | --- | --- | --- |
| unchanged | 0.428 | 0.552 | 0.672 | 19.68 cv |
| exposure ×1.30 | **0.467** | 0.617 | 0.636 | 25.77 cv |
| sun only ×1.50 | **0.363** | 0.625 | 0.641 | 19.68 cv |

**Global exposure moves the gate the wrong way**, and that is worth knowing before anyone reaches
for it: the curve is compressive, so the shaded numerator sits on a steeper part of it than the
sunlit denominator and rises faster. Raising the level helps saturation and V either way, but only a
*sun-side* raise helps the gate, and the sun's irradiance is derived from the atmosphere solve
rather than being a dial. So the lever is where the sun is.

Measured, nine captures over the azimuth-elevation plane, against the bands: wall V 0.59–0.73, wall
saturation 0.615–0.626, gate 0.15–0.25, floor grad/L 0.12–0.16.

| az | el | wall V | wall sat | gate | floor L | floor grad/L |
| --- | --- | --- | --- | --- | --- | --- |
| −9 | 11 | 0.563 | 0.666 | 0.343 | 0.137 | 0.192 |
| −11 | 11 | 0.662 | 0.654 | 0.284 | 0.052 | 0.230 |
| −13 | 11 | 0.740 | 0.631 | **0.243** | 0.052 | 0.230 |
| −12 | 13 | 0.750 | 0.601 | 0.269 | 0.062 | 0.210 |
| −13 | 14 | 0.797 | 0.569 | 0.258 | 0.067 | 0.200 |
| −11 | 15 | 0.776 | 0.569 | 0.286 | 0.272 | **0.149** |
| −10 | 15 | 0.752 | 0.579 | 0.301 | 0.430 | **0.157** |
| **−9** | **15** | **0.725** | 0.589 | 0.338 | 0.469 | **0.130** |
| −13 | 17 | 0.844 | 0.516 | 0.273 | 0.127 | 0.099 |

Elevation and azimuth do different jobs and the table separates them cleanly. **Elevation fixes
everything except the gate**: at azimuth −9, going 11 to 15 puts wall V inside its band, floor
grad/L inside its band from above it, brings saturation down from over the top of the
real-photograph range into it, moves hue toward target, and makes the floor three times brighter
rather than dimmer. **Azimuth is the only thing that moves the gate**, because it is the only thing
that changes the wall's cosine — −13 takes the gate to 0.243, inside its band for the first time in
the project, and costs 62 percent of the floor's level.

Shipped as azimuth −9, elevation 15: the elevation-only move, because it takes four figures toward
band and spends nothing. The gate stays where it is at 0.338, and closing it needs either the
azimuth trade above or the toe. The one real cost is shadow length, 5.1 times the height of what
casts it down to 3.7 — still long, but a brief-level property and recorded as spent.

And the azimuth conflict is now fully pinned, because `-sin(azimuth + 7.5)` changes sign at −7.5:
**below that the wall is lit and the sun disc is blocked; above it the disc can clear and the wall
is past its own terminator.** `tools/sundisc.mjs` over az −16…−4 by 2 and el 11/13/15 finds the disc
clear in all four views only at azimuth −4, or −6 at elevation 15. Azimuth −4 gives the wall a
cosine of −0.061, which is to say no direct light at all. The sun disc and the lit wall cannot both
be had at this corridor heading, and the disc is one view's composition while the wall carries three
measured gates. At the shipped elevation of 15 the disc does clear in `wash_low`, which is the free
part of it.

Which points the remaining 0.040 somewhere useful rather than at the gate. **The sunlit wall is
below its own band**: `wall_lit` V measures 0.563 against a documented 0.59–0.73. Level is the
lever, and there are two of them — the shaded face is the gate's numerator and raising it is
forbidden, but the sunlit face is the *denominator*, and raising that lowers the saturation and the
gate ratio at the same time. Both of the remaining figures want the same move, and it is exposure
and the grade's shoulder rather than anything in the fill. That is the toe loop's territory, so it
goes there rather than being spent here.

**A penumbra widening was tried as the explanation for the first cost, and it is not.** The theory
was that hard shadow edges convert shadow depth straight into local gradient, and the far
cascade's 3.5-texel kernel is 0.18 m where a half-degree sun behind rock 50 m away throws 0.46 m.
Measured: floor grad/L 0.186 at 3.5 texels and **0.186 at 10**, shaded wall 0.019 against 0.021.
Cast-shadow edges are too small a share of a region's pixels to register in a nine-pixel
high-pass. Reverted, because rpBias scales with radius and 10 texels nearly triples the
receiver-plane bias for no measured gain.

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

- **The pale clasts are a requested feature, and the defect was their distribution.**
  Ruled on by the coordinator with history nobody downstream had, and worth keeping
  because the temptation to delete them will recur. The *first* critique of this
  project listed "zero lithological variety in the clasts — every stone in every
  frame is the same tan-grey chip" among its most damaging defects and asked for
  buff-white Coconino by name, calling the polychrome scatter "one of the most
  recognisable signatures of the place"; the first terrain critique noted that
  locals specifically remark on "the big off-white boulders sitting incongruously
  on the red soil". **Do not remove the buff mix.** Three rounds of work bought
  that variety.

  What was wrong was measured: a `slab`/`block` plate at V 0.702 against a bed at
  0.524, a third brighter, and a field of them spread evenly across the apron.
  Too many, too clean, too even. So in `sys1q`, three changes and no palette edit:

  - **Dusted much harder on the pale end specifically.** Fresh Coconino is
    off-white; Coconino that has lain in a wash weathers to a duller browner buff
    and carries the same red film as everything around it. The sky-facing dust
    weight now scales with the instance's own lithology luminance as well as its
    size, so a pale block takes about three and a half times the film of a dark
    one, capped at two thirds — past that it stops being dusty Coconino and
    becomes a lump of bed, which deletes the lithology instead of weathering it.
  - **Confined to the apron toe, in lobes.** Coconino is the *cap*, so a pale
    block started its fall from the top of the wall, and how far a block leaves
    the wall scales with how far it fell — the coarse pale fraction belongs at
    talPos 0, not spread up the ramp. Combined with `pile`, which describes
    rockfall as episodic, this rejects about four in five pale coarse draws. The
    survivors are pushed *up* in size, which is the point rather than a side
    effect: a few big conspicuous pale blocks read as Sedona, many medium ones
    read as builders' rubble. Same pale area, concentrated.
  - **`pile` sharpened** from a floor of 0.10 to 0.02 and its wavelength raised
    from 18 m to 25 m. The old floor was small but never zero, so the lobes were a
    modulation on top of an even field rather than the whole story; now the ground
    between heaps is genuinely swept. One gully, one event, one lobe.

  Also, and this was a separate bug rather than a taste question: the `bankF` gate
  started at eleven degrees of slope, and the pale ovals a critic found on the
  shaded bank in `wash_low` were on a bank *toe*, which is gentler than that. None
  of the provenance logic was firing on them — they drew from the general mix and
  skipped the matrix blend, which is exactly the polka-dot mechanism on a surface
  the gate could not see. Onset now six degrees.
- Shadow ambient is warm grey and red-dominant — needs a hemispherical skylight term so
  shadows go cool/violet. **System 4 owns this.**
- **Ground `hf/lf` regressed when the new lighting landed** and needs re-checking once
  System 4 settles: `wash_mid` floor 0.58 → 0.50, `bend` sand 0.62 → 0.54, `ground` floor
  0.47 → 0.45. No ground surface was edited in that window, so the cause is almost certainly
  the light rather than the material.
- The pale confetti specks on the wash floor and the lavender sand sheet are System 1
  albedos reacting to the new skylight — recheck both after System 4.

### Past ~30 m the shading normal IS the mesh normal

Measured, not argued. A pixel on the wash floor spans **29 × 615 mm at 30 m**, rising to
58 × 2456 mm at 60 m — an anisotropy of 21:1 going to 42:1. Against that footprint the dirt
normal map's RMS tangent slope falls from **0.3233 at mip 0 to 0.0061 as actually sampled at
30 m**, and to **0.0010** after the shader's own grain fade. Three parts in a thousand. Even
with perfect anisotropic filtering the ceiling is about 1%.

**So beyond 30 m the shading normal is, to within a fraction of a percent, the interpolated
geometric normal of the mesh.** A surviving albedo over a vanished normal is exactly
"correctly coloured, soft shape" — which is what a user independently described as
"melting". Five rounds of midground texture work were aimed at a quantity that arrives at
0.3% strength.

The height field's octave spectrum shows where the real gap is. A self-affine natural
surface holds roughly constant slope per octave; this one rises monotonically into the
metre band and the fine end carries a fifth of the coarse end:

| octave | RMS slope | share |
| --- | --- | --- |
| 0.05–0.10 m | 0.0211 | 3.5% |
| 0.20–0.40 m | 0.0574 | 9.4% |
| 0.80–1.60 m | 0.1063 | 17.4% |
| 1.60–3.20 m | 0.1135 | 18.6% |
| 6.40–12.8 m | 0.0939 | 15.4% |

**The 0.1–1 m band is where the work belongs.** The mesh can carry it to about 0.4 m
across-wash and 0.84 m along, given 0.20 × 0.42 m spacing; below that it must be the shading
normal, and there only across-channel content survives the anisotropic footprint.

A caution recorded with it: the metre-scale mounds that read as wax are **stepped bar
margins added as a previous fix for this same defect** — hard risers meant to keep the floor
readable at thirty metres — which were then softened to stop them snapping to the grid and
reading as concrete pads. The softening that made them safe is what made them wax. Roughen
their flanks rather than adding more of them.

#### How it was filled: split the band at the mesh's Nyquist, not by taste

Two terms, and the boundary between them is not a judgement call. The grid is 0.20 m across
the wash and 0.42 m along, so 0.40 m is the shortest wavelength it can represent. Above that
line detail belongs in the height field, below it in the shading normal, and putting either
on the wrong side of the line wastes it — height field content under 0.4 m comes back as grid
noise, and normal-map content over it duplicates geometry that is already there.

Above the line, **flank roughness on the bars, elongated about ten to one downstream.** The
elongation does three jobs at once and is the whole design: it is the right geomorphology,
because everything a flow leaves on a bar is drawn out along the current; it is the only
orientation that survives a 21:1 footprint; and it is the only orientation the *grid* can
carry, since an isotropic term at the same scale would be well sampled across the wash and
alias along it. Result, against the table above:

| octave | before | after |
| --- | --- | --- |
| 0.40–0.80 m | 0.0805 | 0.1095 |
| 0.80–1.60 m | 0.1063 | 0.1290 |
| 1.60–3.20 m | 0.1135 | 0.1229 |
| 3.20–6.40 m | 0.1023 | 0.1036 |
| 6.40–12.8 m | 0.0939 | 0.0938 |

The mesh-representable range is now flat within 1.375× and the fine end is no longer its
minimum. Below 0.4 m the field is deliberately left quiet, because the mesh would only alias
it.

Below the line, the across-channel bedform in the fragment shader, raised 2.2× — it was
correct in construction and inaudible at 13 levels out of 255.

#### Two ways a comb of fixed wavelengths betrays itself

Both were in the first version of the bedform term and both are easy to write again.

**Every `cos(TAU * dot(wxz, d) / L)` equals one where `dot` is zero.** Four terms meant to be
independent all crested on a single line down the wash, so the stack's worst case was the
arithmetic sum of its amplitudes rather than about three sigma. That is a factor of two of
amplitude thrown away, and it caps the term below the level where it can be seen. Give each
wavelength a phase offset.

**An amplitude envelope does not cure periodicity.** It makes the comb loud here and quiet
there, and where it is loud the teeth are still evenly spaced, so the eye still reads a rake.
Periodicity has to be attacked directly — and the axis matters. Warping phase *downstream* is
the reflex and is exactly what cannot be afforded, because a pixel is 2.46 m long at 60 m and
any downstream phase gradient is averaged away along with the term carrying it; the budget
works out at about 1% lateral wander per unit of downstream run. **Warping phase by the
across-channel coordinate alone is free.** It adds no downstream phase gradient whatever, so
`fwidth` never sees it and survivability is untouched, while the crest *spacing* becomes
irregular — bunched here, opened out there. Dead-straight crests at irregular spacing is a
bar surface; dead-straight crests at regular spacing is a rake. Same for the envelope: it
must vary across the channel, since a downstream-varying envelope is filtered to its mean and
the comb it was breaking up reassembles.

Generalised: **on a strongly anisotropic footprint, every property of a term — amplitude,
phase, orientation — has a cheap axis and an expensive one, and they are the same axis for
all three.** Vary things across the view. Along it, only the mean arrives.

#### `hf/lf` was blind to the fix

Worth recording alongside, because it is the fourth instrument failure on this project.
Filling the 0.4–1.6 m octaves and tripling the bedform amplitude moved `wash_mid` floor
`hf/lf` from 0.59 to 0.59, exactly, while `grad/L` went 0.203 → 0.219 and the octave table
moved as tabulated above. The band metric integrates over the whole spectrum and reports how
much energy there is, not where it is, so a change that redistributes energy into an empty
octave is invisible to it. **Use the octave table for structure questions.** `hf/lf` remains
the right gate for "has this surface gone to wax overall", and the wrong one for "is the
spectrum the right shape".

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

**The 0.12–0.16 `grad/L` band is a *floor* figure, not a wall one.** It came from measuring
real arroyo ground and it is what System 1 is held to. Walls have their own reference: real
Sedona cliff faces measure **0.088–0.201 `grad/L`**, so a wall at 0.200 is at the top of the
real range rather than outside it. Two agents have now compared a wall against the floor
band; do not do it again.

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

### Two captures are not a pair

An A/B taken as two `shoot.mjs` runs is not matched, and with six agents committing it is
routinely not even close. The gap between the halves is not the ninety seconds they render
for — it is however long the second waits on the capture lock, which has run over an hour.
One attempt lost its control to a file rewritten **22 seconds** after the first half
finished; the pixel diff reached the bottom of the frame, where the thing being ablated
could not possibly reach. Another pair differed by 84–92% of the frame.

**Toggle inside one page load instead.** `tools/_farpair.mjs` screenshots twice around a
single visibility flip: same modules, same textures, same sun, one bit different. Matched by
construction. `tools/postpair.mjs` solves the same problem from the other side by freezing
`src/` to a snapshot and serving both halves from the copy.

If a diff touches pixels the change cannot reach, the pair is contaminated — check that
before believing the result.

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

**And the converse, which has now happened three times: a measurement can be fully
satisfied by something that looks wrong.** The clast grit layer at full normal amplitude
turned a grazing sun into a binary lit/unlit decision per grain, and a binary field has an
excellent one-pixel gradient — the metric was measuring the right band and saying nothing
about what was in it. Same shape as the narrow-peak detector that found a harmonic series
in its own variance, and as the `hf/lf` figure quoted against a floor the eye cannot
resolve. **A metric bounds a defect; it does not certify a fix.** Every number in this file
that moved in the right direction was also looked at magnified before it was believed, and
the two that were not are both in the failure list above.

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
4. Lighting and sun — **the sun disc is deliberately not visible, and this is a knowing
   deviation from the brief.** The brief asks three times for the sun to sit low in the gap.
   It cannot, and the reason is physical rather than a failure of effort.

   At the shipped sun the disc is *already geometrically unoccluded* in `wash_low`, and it
   measures **+0.1 code value, 0.0% contrast** against the sky immediately around it. The
   near-sun sky sits at 3.40 scene-linear, and ACES puts 0.97 linear at 230 cv against 0.50
   at 204 — so **that sky would have to come down 6.8×** before a 10% step could read.

   Thinning the air cannot deliver that, because the brightness beside the sun is the
   forward-scattered Mie aureole, which scales with the sun's own radiance rather than with
   extinction. Thin air keeps the disc bright *alongside* it and both land in the tone
   curve's shoulder together. **A defined disc requires heavy haze at roughly a 2 km visual
   range** — which is exactly the air that flattens the receding ridgelines into one mass.
   The disc and the depth ladder compete for one dial, and the far field won on merit.

   Do not re-open this by carving a saddle in the skyline: geometry is not the binding
   constraint, so a notch would faithfully reproduce an invisible disc in a second view.
   What the frame delivers instead is the aureole, a raking beam and long shadows.

   **Measured and declined:** azimuth −13 reaches a shadow gate of 0.243, inside band for
   the first time in the project, at the cost of 62% of the wash floor's level (floor L
   0.137 → 0.052) and floor `grad/L` out of band on the far side. Not worth it. — spectral sky, SH skylight probe and two-cascade shadows are in and
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
5. Heat haze and atmosphere — **heat shimmer is OFF by direct user instruction.** It was
   built, and a units bug had it delivering a sixth of nominal for three rounds; once
   corrected to full strength the user immediately identified the mid-distance floor as
   "melting" and asked for it gone. The physics was right and the look is not wanted. Keep
   the code behind a flag, default off, and **do not re-enable it to satisfy a metric.**

   The general instruction that came with it, which applies to every system: *"we need
   clean… visually should be good, like you can see in that jungle one there was no filter
   or something like that."* Anything a viewer can identify as an *effect* rather than as
   the scene is wrong here, however physically defensible. That covers visible grain,
   chromatic aberration, heavy vignetting, obvious depth-of-field, and any screen-space
   distortion. Subtle enough to be invisible is the bar; if it reads as a filter, it is off. — including **wind-driven sand at ground level** (saltation):
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

## Shaded rock is warmer than sunlit rock because the canyon is a red room

The whole-scene critique ranks this third overall and calls it "the biggest single coherence
error, and why the shaded walls look like black-maroon cardboard". It is real. Measured on
`sys4l`, at sun elevation 15:

| | saturation | hue | B/G | V |
| --- | --- | --- | --- | --- |
| lit wall | 0.590 | 21.1° | 0.662 | 0.723 |
| shaded wall | 0.654 | 10.9° | 0.739 | 0.292 |

Shade is 0.064 more saturated and **10.2° warmer** than light, where real skylit shade on red
rock should be less saturated and cooler. Half of the critique's complaint is already gone —
it measured shaded wall V at 0.086–0.111 on `sys7e` and V is now 0.292, because raising the
sun from 11° to 15° tripled it — and the shaded wall's B/G of 0.739 is now *bluer* than the
wash floor's 0.647–0.718, not starved relative to it. The saturation and hue inversion is
what remains.

`tools/shadechroma.mjs` evaluates the fill exactly as `installProbeHeightLerp` does and
reproduces the rendered shaded wall to 0.012 of saturation and 3° of hue, so this is not a
shader defect. It is what the geometry implies, and the numbers say so plainly:

| fill on a shaded wall face | B/R | fill hue | rock sat |
| --- | --- | --- | --- |
| at 2 m | 0.500 | 9° | 0.791 |
| at 20 m | 0.797 | 350° | 0.666 |
| at 40 m | 1.242 | 235° | 0.480 |

The fill arriving on shaded rock is **orange** below about 15 m and only turns blue above 30.
Attribution at 20 m: taking the opposite wall's bounce out moves B/R from 0.797 to 1.270 and
rock saturation from 0.666 to 0.468, and 65% of that bounce is direct sun on the opposite
crest, 31% the wash floor it stands over, 4% the sky it can see. The bounce is not a knob —
`eDirect = facing * lit * cos(SUN_EL)` is a cosine on a vertical face and the albedo is the
area-weighted mean of System 2's own stratigraphic column. A sunlit red wall opposite a
shaded red wall really does make the shaded one redder.

**The aperture lever is exhausted, and this is the part worth not re-litigating.** Against the
raycast ground truth in `tools/probefit.mjs`, the shipped lateral ramp delivers 0.45 of the
allowed sky visibility at 6 m and 0.77–0.91 through 14–44 m, so it *is* low and fixing it is
worth doing. But the ceiling is set by geometry, not by the fit: the 5–40 m band the shaded
walls occupy is 51–68% blocked by rock. Correcting the fit perfectly moves the aperture at
20 m from 0.229 to 0.27, which is:

| open fraction | rock sat | rock hue |
| --- | --- | --- |
| 0.229, as shipped | 0.666 | 8.0° |
| 0.27, a perfect fit to the raycast | 0.645 | 7.9° |
| 0.75, what saturation 0.45 would need | ~0.45 | 5.9° |

**0.021 of the 0.20 of saturation needed, and none of the hue.** The hue half is not a
question of magnitude at all: rock hue turns cool only once the incident light's B/G clears
the albedo's own G/B of 1.335, and a **fully open sky delivers 1.285**. No aperture, however
large, flips the sign, because the fill is multiplied by rock albedo and the albedo throws the
blue away. This is the same argument that killed violet-on-rock-from-fill, now with a number
on it.

So the term that can fix this is one that is **added in front of the rock rather than
multiplied by its albedo**, which means airlight. That is System 5's in-scatter, and the same
critique independently measures aerial perspective at a **0% median saturation edge in all
eight views** — the term that would do this is currently not landing. **Routed to System 5.**
System 4's contribution is the ramp re-fit, worth 0.02, and it is not worth capturing on its
own.

## `tools/sundisc.mjs` was raycasting from a camera nobody photographs

Its `VIEWS` table was hand-copied from `tools/shoot.mjs` and had drifted: `wash_low` was
d 18 pitch 0 against the capture's d 8 pitch −4, and `bend` was d 78 yaw −28 against d 92
yaw −22. So it projected the sun to screen 0.365,0.25 while the disc in the frame under
review sits at **0.325,0.171** — four degrees away, against a disc half a degree wide. Every
occlusion verdict and the whole azimuth sweep that tool produced was fired along the right
bearing from the wrong eye, including "the disc is unoccluded" and the azimuth −13 trade.
The table now lives in `tools/views.mjs` and both import it.

At its true position the disc is not invisible, just weak: 2.6% contrast graded and 5.7%
ungraded against the sky immediately around it, 0.4–0.5 sigma of that sky's own variation.
`_diag.sunDir`, the `DirectionalLight` and the sky shader's `uSun` all agree to the second
decimal, so the scene was never inconsistent — only the tool was.

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
