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

## The composition the brief asks for is a geometry constraint, and it can be measured

The walk ended in a bowl at ground L 14.5/255 against 63.6 where it starts, so the
payoff was the darkest part of the experience — the exact inverse of a brief that
says the sun sits ahead in a gap between formations and *pulls you forward*.

The useful part is that "is the composition the brief describes physically possible
from here" is a **measurable question**, and answering it took one offline probe and
no renders. Ray-march the height field from the walk's centreline along the sun's
horizontal bearing and record the maximum elevation angle of anything you pass; the
station is lit if that angle is below the sun's elevation. It names the occluder's
position and height as well as the verdict:

| station | occlusion before | after |
|---|---|---|
| −260 | 16.5° shade | 9.5° LIT |
| −300 | 21.8° shade | 16.1° shade (plunge-pool pocket, wanted) |
| −340 | 27.1° shade | 11.6° LIT |

It named the culprit as System 1's own amphitheatre, cut one round earlier: the
headwall's west flank at z = −355 to −396 and 40–50 m up. **A change made to fix one
critique closed the aperture another one depends on**, and nothing in either critique
could have said so, because one is about form and the other about light.

Two notes on the fix worth keeping:

- **Cut along the sun's bearing, not the axis.** The sun is at azimuth −9°, so an
  axial notch misses the sight line by fourteen metres at the far end. Keying the cut
  to perpendicular distance from the bearing line follows the sight line exactly and
  is the only shape that opens the aperture without flattening the bowl on the other
  three sides.
- **It has to be honest terrain, not a lighting cheat.** A wash head *is* a drainage
  col — the water that cut the wash came over it — so the one place the headwall
  should be low is where the drainage comes from. Exposure and albedo were not
  touched, which matters while the tone curve is in flight.

## A no-op change and a change that did not help look identical

A regular diamond lattice of dark dots in `far_270` was diagnosed as the
footprint-locked grit aliasing at extreme anisotropy, and a gate was added to fade
the layer where the footprint ratio exceeds ten. The re-render was **byte-identical**
in the artefact region *and* in the metrics. That is not a fix that failed to help;
it is a gate that never fired, which additionally establishes a fact worth having:
the anisotropy ratio does not exceed ten anywhere in these framings, so the
geometric-mean lock is never stressed and needs no ratio gate. Reverted. Check that a
change is *active* before concluding anything from the fact that it changed nothing.

## Open, System 1's: a regular dot lattice on the far_270 bank

A perfectly periodic diamond grid of dark dots, roughly 24 cm apart in world terms,
in a band across a sunlit bank at about 40 m. Periodic, so a sampling artefact rather
than content.

**Excluded, each by a measurement rather than an argument:**

- The terrain's footprint-locked grit — ablated, no change.
- Anisotropic filtering of that grit — the gate was byte-identical, i.e. never fired
  (see the section above), so the ratio never exceeds ten here and nobody should
  reach for an anisotropy explanation again.
- Clast placement — draws `s` and `u` from the rng with no grid.
- The post chain — the ungraded `--hash nopost` control shows the lattice too.
- **Shadow-map acne.** `footShadow` was made to `return gRake`, dropping the shadow
  lookup and keeping every other term. Ground luminance rose 61 → 73 of 255, so the
  ablation was live; the lattice was **unchanged**. It is not acne, so it is not
  System 4's depth or normal bias, and it should not be routed there.

- **The mesh geometry.** The vertex `N·L` field was mapped across the patch straight
  off the built `BufferGeometry` — 33 rows, printed as ASCII. It is smooth, with large
  coherent blobs and **no per-vertex alternation of any kind**. There is no lattice in
  the geometry.
- **The height field's fine relief.** Both isotropic terms (`fbm` at 0.42 and 0.34,
  the only ungated sub-metre content on a bank) zeroed outright. Lattice unchanged.
- **The bar roughness.** `swA`/`swB` zeroed outright. Lattice unchanged.

**What it is.** With the shadow map gone the dots are still dark, so they are shaded by
their own normals. Measured in the region: dots rgb(105,59,39) against bank
rgb(204,142,96) — **B/G 0.669 against 0.675**, the same material to three decimals, but
half the luminance and much redder (R/G 1.79 against 1.44). Losing the warm-white sun
while keeping the red bounce is a facet turned away from the sun.

Those normals are **fragment-stage, not geometric**. Replacing the terrain's
`normal_fragment_maps` output with the interpolated geometric normal — `tNrmW` swapped
for `vWNrm`, everything else untouched — removes the lattice **completely**, and the
surface is visibly smoother, so the ablation is live. It is therefore somewhere in the
assembly of `wN`, on a bank, and it is System 1's.

**Where it is not: the bedform comb.** The obvious suspect, and wrong. Its phases were
decorrelated (per-component warps instead of one shared `bwo`) — no change. Its band
limit was moved from `fwidth` of the phase to the analytic footprint — no change. Then
the gate was read, which should have come first: `bedW` is multiplied by `floorB` and
by `(1.0 - smoothstep(0.06, 0.20, slope))`, so the term is largely **off on a bank**
and was never live at the artefact. Both changes were reverted; the footprint band
limit is written up in place because the reasoning behind it is sound and reusable
even though it fixed nothing here — see the process note below.

**FOUND — it is the bank lamination `bumpFrom`**, `src/terrain.js`, in the
`bankW > 0.004` block:

```
gWN = bumpFrom((coarse - 0.5) * inBed * bankW, gWN, 0.022 * platF);
```

Commenting out that single line clears the artefact **completely**, at 46.9% of pixels
differing so the ablation is unambiguously live. Everything below is the trail that got
there and, more importantly, why the obvious fix does not work.

**The obvious fix does not work, and this is measured.** The scalar being
differentiated is periodic in world height with period `1.0/th` where
`th = 4.0 + 9.0 * mac.b`, i.e. **7.7 to 25 cm** — and the dots measure about 24 cm,
the thick end of that range. That looks conclusive: a screen-space derivative of a
periodic function, aliasing past half a period. The term even has a footprint fade
already, `platF`, which is calibrated to the *sand* map's quarter-metre ripple train
and is deliberately slow, so it is far too generous for an 0.077 m feature and cannot
know about `th` at all. Every part of that story is true and it is still not the
mechanism: gating the strength on `1.0 - smoothstep(0.28, 0.55, foot * th)` is **live at
43.5% of pixels and leaves the lattice untouched**. Do not re-derive it.

**What the mechanism actually appears to be.** `bumpFrom` ends with

```
float det = dot(pdx, r1);            // r1 = cross(pdy, N)
return normalize(abs(det) * N - scale * grad);
```

`det` is the pixel footprint's area projected onto the surface normal, so it collapses
toward zero at grazing incidence. As it does, the `abs(det) * N` term shrinks out of the
expression and the perturbation dominates the result **without bound, regardless of
`scale`**. On a grazing bank the bump is therefore effectively unclamped, which is why
no amplitude fade in front of it helps and why the artefact is a lens-shaped patch: the
patch is where the bank is most grazing. The regularity comes from `hdx`/`hdy` of the
periodic bed function on top of that.

**LANDED — `af365e8`.** The fix bounds the perturbation against `abs(det)` inside
`bumpFrom` rather than scaling it from outside: cap `length(scale * grad)` at
`MAXTILT * abs(det)`, i.e. cap the tilt the function is allowed to return. Written up
in full at the function; the section below records what it turned out to be worth.

**Where it is not, second pass.** Three renders, each checked for liveness by
diffing against the unablated frame — because one of them was not live and would
otherwise have been read as an exclusion:

- **The wall-rock branch, `rockWN` and the `rockW` blend.** Substituting `gWN` for the
  blended normal changed **1.98%** of pixels at a mean of 0.05, i.e. nothing. That is
  not an exclusion by ablation, it is an exclusion *by construction*: `rockW` is
  `wallM * (...)` and `wallM` is `smoothstep(0.06, 0.42, vWall)`, which is ~0 on this
  bank, so the whole branch was already inert there. Worth stating plainly because the
  render looked like a clean negative and was not one.
- **The steep-ground reprojection normal** (`pN`, the two planar dirt projections
  blended by `pw`). Ablated, **31.93%** of pixels differing at 2.59, so thoroughly
  live. Lattice unchanged. This was the best structural candidate — two projections of
  one texture blended near 50/50 is a textbook interference pattern — and it is wrong.
- **The sand ripple normal** (`sandN`). Ablated, **22.09%** differing at 1.17, live.
  Lattice unchanged. Chased because the sand map's relief is documented as "a ripple
  train at a quarter of a metre" and the dots measure ~24 cm; the match was exact and
  meant nothing.

Both of the candidates the previous pass was left with — `dirtN`'s missing LOD bias and
the `bumpFrom` pair — are now resolved: it is the second, specifically the bank
lamination one. `dirtN` is exonerated. The narrowing that got there:

1. **`dirtN`** — the base ground normal, `mix` of a 2.6 m and a 4.3 m tile rotated 0.83
   rad apart. Two tilings blended is the same interference argument that made the
   reprojection attractive, and unlike its albedo sibling `dirtA` it is fetched with no
   LOD bias.
2. **The two `bumpFrom` calls** — `crackH` (desiccation, `panW`-gated) and the bank
   lamination (`bankW`-gated, so live here). `bumpFrom` differentiates a procedural
   scalar in screen space, which is the same class of instrument as the `fwidth` trap
   below: once the scalar it is differentiating is itself aliasing, the derivative is
   not small, it is *wrong*, and wrong in a spatially regular way.

Note for anyone reading the trail rather than the conclusion: `bumpFrom` was reached by
the *aliasing* argument in point 2, and that argument is only half right. Aliasing
explains why the perturbation is spatially regular; it does not explain why it is large.
The magnitude comes from `det`, and the two together are what make a lattice rather than
a mess. A mechanism that predicts regularity specifically, rather than merely predicting
noise, was the thing worth chasing.

## Bounding `bumpFrom` at grazing incidence — and what else it was quietly doing

`af365e8`. Landed to kill the far_270 lattice; the lattice turned out to be the *smallest*
thing it fixed. Recorded at length because the defect class is general — an unbounded
perturbation at grazing incidence, and grazing is the geometry of every distant bank and
every wash floor seen down its length — so the next surface that reads as digital hash on
a shallow slope should suspect this before suspecting its own texture.

**Choosing the cap by measurement rather than by argument.** The multiplier was painted
into the albedo (`diffuseColor.rgb = mix(red, grey, k)`) and rendered, which answers both
guardrail questions in one capture — where does the bound engage, and does it engage
anywhere it must not. Two renders settled it:

- **At 0.45** the multiplier fires on the lattice dots and on **nothing else in any
  framing**. That is a very strong confirmation of the mechanism — the engagement map is
  the artefact, dot for dot — but 0.45 is far too loose to cure it, because a 0.45 tilt
  near the terminator still swings a pixel from lit to shadowed. The visible lattice was
  only slightly softened.
- **At 0.10** it fires across the whole lattice patch, across a striped patch on the bend
  right bank, on a few bank crests at the top of `wash_mid` — and still nowhere at all in
  `ground`.

That is the useful shape of the result: **the cap is not an amplitude control.** Below it
the term is untouched bit-for-bit; above it the derivative estimate was never valid. So
the right value is the lowest one that is still an exact identity in the near field, and
the engagement map tells you that directly instead of by bisecting on renders.

**Verification, paired against the same function with `MAXTILT = 1e9`** — an exact no-op,
so the pair differs in nothing but the bound, and captured back to back in one session
because `bl1` from four hours earlier was worthless as a baseline once three other systems
had committed into the window:

| framing | pixels differing | mean Δ | hf | grad/L |
|---|---|---|---|---|
| `ground` | 0.002% | 0.0001 | 0.0612 → 0.0612 | 0.166 → 0.166 |
| `wash_mid` | 0.130% | 0.0144 | 0.0618 → 0.0618 | 0.140 → 0.140 |
| `bend` | 0.951% | 0.1948 | 0.0139 → 0.0139 | 0.218 → 0.218 |
| `far_270` | 1.619% | 0.2886 | 0.0327 → 0.0324 | 0.096 → 0.095 |

The near field is unchanged by measurement and by inspection. Everything it *does* change
is a defect nobody had named:

- **`bend`, the right-hand bank** — 0.95% of the frame, and every changed pixel inside one
  small region. Before, that bank is a field of hard horizontal dashes, regular enough to
  read as a display artefact rather than as rock. After, it is a shadowed slope with
  clasts on it. This is a **standard framing**, and it is a bigger visible improvement
  than the far-field lattice the work was aimed at.
- **`far_220`, the near floor** — a reticulated network of vertical hash on the most
  grazing part of the foreground, gone.
- **`far_170` 0.97%, `wash_low` 0.87%, `sun_gap` 0.57%**, all the same signature and all
  confined to grazing banks. **`far_320` is byte-identical** — nothing in it is close
  enough to see.

**The first colour reading was right about *what* all along.** The artefact was originally
described as "facets turned away from the sun", which is exactly what an unbounded normal
perturbation produces, and the description survived every subsequent theory about grids,
anisotropy and ripple wavelengths.

## Landed: the capture settle is frames now, not wall clock

`8ea8680`. `shoot.mjs` waited 400 ms between `walkTo` and the capture. That is about
a hundred frames at 800×450 and **thirteen to twenty-four at 1440p**, and fewer again
while another agent is rendering — so the settle silently bought an order of magnitude
fewer frames exactly as the resolution rose, and fewer still precisely when several
people were capturing and results were most likely to be compared against each other.

`tools/settle.mjs` replaces it with convergence on the frame the harness would actually
take: a floor of 90 frames, then three identical framebuffer hashes five frames apart,
`setPaused`/`renderOnce`/`readPixels` exactly as `capture` does it. **It reports how it
exited**, on the view's line and in the run manifest, because a settle that quietly falls
back to its ceiling is the same silent under-settle wearing a different hat. A framing
that prints `CEILING` is not established as byte-stable and a byte diff against it is not
evidence of anything.

**The boot pass is a different instrument and that is a finding, not a detail.** Run the
convergence settle before the first `walkTo` and it never converges — measured at **1605
frames and 30 s without two matching hashes** — because `walkTo` is what keys the
atmosphere and grain clocks to the station, and before it they are free-running. So the
boot pass is `warmup()`, a frame count with a backstop. That non-convergence is also the
liveness proof for the hash: the same function that never matched twice in 1605 free
frames matches on the first three checks after a `walkTo`, and hashes differently for
every one of the thirteen framings.

**Verified.** Repeated captures of the same viewpoints, byte-compared:

| resolution | condition | result |
|---|---|---|
| 800×450 | quiet | byte-identical |
| 2560×1440 | quiet | byte-identical |
| 1997×1123 (rung 4) | second run under three-way CPU contention | byte-identical |

The clearest evidence that the quantity has actually changed hands: at 1440p the two runs
took **1.7 s and 2.7 s for the same 100 frames**. Under load at rung 4, 1.7 s and 2.6 s,
again for the same 100. The wall clock moved by half; the settle did not.

**What I could not reproduce, stated plainly.** With `--minframes 1` every one of the
thirteen framings converges at **11 frames** — the earliest the checker can possibly
declare it — and those captures are byte-identical to the 90-frame ones. So on this
machine, in these framings, the scene is stable almost immediately after `walkTo` and the
old 400 ms was already sufficient. **The cause is removed and the invariance is measured,
but System 7's two-of-eight mismatch at 1440p was not reproduced here, so this is not
established as the fix for it.** If it recurs, that is still an open question and it should
not be closed by pointing at this commit. One thing seen in passing that may be worth
pulling on: `info.textures` goes 38 → 39 after the first captured view of a run, so a
resource is still becoming resident during capture, and a run's *first* framing is
therefore the one least like the others.

Residual risk worth knowing: convergence stops checking once it is satisfied, so a
resource landing at frame 200 is still not caught. The 180-frame warmup is what covers
that, and it is the knob to raise if a first-view capture is ever suspected.

## RULE: a tool that measures nothing must not print a number

Four instances now, so it is a rule rather than an observation. `grad.mjs` turned an
unrecognised flag into a `NaN` crop, selected no pixels and printed a header with no rows.
`_p7name.mjs` silently measured nothing when given a mode that does not exist. `shoot.mjs`
would take an `--only` matching no viewpoint, render nothing and write a manifest with an
empty results array. `_clastprobe.mjs` would take `--only bogus`, switch off *both* the
coarse map and the grit, and print a table for a facet with nothing on it.

The reason this is worse than ordinary sloppiness is specific to this project: an empty or
zero measurement is usually the *interesting* answer here. It is what a successful ablation
looks like, what a byte-identical control looks like, and what a fixed defect looks like.
An instrument that returns that same answer in response to a typo is producing the single
most misleading output available to it — and we have spent real time tonight on
measurements that turned out to be about something other than what they named.

`tools/argcheck.mjs` carries `die`, `finite`, `oneOf` and `nonEmpty`; all four exit 2 and
name the mistake. `nonEmpty` goes immediately before the first number is printed. It is
three lines to adopt and every probe that takes a flag should.

## RULE: a negative result is only evidence if the thing you removed was doing something

**Diff for liveness before believing an ablation.** Render the ablated frame against the
unablated one and quote the percentage of differing pixels and the mean delta. If the
change is near zero, you have not excluded your candidate — you have discovered that
your ablation did nothing, which is a different and much less useful fact.

This is the single most transferable lesson on the project and it has now cost renders
in three separate systems, in three different disguises:

1. **The anisotropy gate (System 1).** A gate added to fade the grit where the footprint
   ratio exceeds ten. The re-render was byte-identical. Read as "the fix did not help";
   it was actually "the gate never fired", which additionally proved the ratio never
   exceeds ten in these framings.
2. **The `-shadow` bench column (System 7).** A performance ablation that turned out to
   be a no-op because `shadowMap.enabled` is a compile-time define, so the column
   measured the same shader twice.
3. **The wall-rock branch (System 1, this artefact).** Substituting `gWN` for
   `mix(gWN, rockWN, rockW)` moved **1.98%** of pixels at a mean of 0.05. It looked like
   a clean negative and was not one: `rockW` is `wallM * (...)`, `wallM` is
   `smoothstep(0.06, 0.42, vWall)`, and that is ~0 on the bank in question, so the branch
   was already inert and the ablation could not have changed anything. A candidate would
   have been crossed off having never been tested.

The corollary, which caught the actual cause here: an ablation that *is* live and still
leaves the artefact is a real exclusion, and a strong one. Of the five live ablations run
against this lattice, four excluded a candidate and the fifth found it.

**A coincidence that survives arithmetic is still a coincidence.** The sand map's relief
is documented as "a ripple train at a quarter of a metre" and the lattice dots measure
about 24 cm. That match is exact, it is the kind of agreement that normally settles a
question, and it was worth a render — which came back live at 22.1% with the lattice
completely unmoved. The bed spacing later turned out to be 7.7–25 cm, so the *same* 24 cm
matched the true cause as well. Two different mechanisms can predict one number.

## Three process notes from chasing it

**Read the gate before ablating the term.** Two renders went into the bedform comb on
the strength of its wavelengths, when one line above it says it is multiplied by
`floorB` and faded out by slope. A term's gate is cheaper to read than its behaviour is
to measure.

**A screen position is not a world position.** The lattice was asserted to be in the
0.615 m head zone because it is "a bank at about 40 m" and that zone is at about that
range. It is not: painting `vWPos.z` into `diffuseColor` as four flat bands located it
in one render at **z between −280 and −256, where the rows are 0.48 m**. A whole
diagnosis, an arithmetic case and a fix were built on a guessed coordinate. If a
conclusion depends on where something is, spend the one render that measures it.

**Aliasing, moiré, shimmer: a screen-space derivative of a repeating signal is not a
safe band limit, and fails silently.** Keywords for whoever hits this next: aliasing,
moiré, moire, shimmer, sparkle, regular dot pattern, lattice, `fwidth`, `dFdx`,
`dFdy`, `bumpFrom`, mip selection, Nyquist.

The pattern to recognise is a band limit that gates a repeating term on the screen-space
derivative *of that term's own phase or height*, e.g. `1.0 - smoothstep(0.22, 0.55,
fwidth(bpN))`. A finite difference of a periodic function wraps. While the signal
advances less than half a cycle per pixel the difference measures it correctly and the
guard works; past that it folds, and a comb running at nearly one cycle per pixel
differences to nearly **zero**. The gate then reads "slowly varying, keep it" at exactly
the moment the term has become pure moiré. Such a guard is strongest where there is
nothing to guard against and absent where there is, which is why it looks correct in
every near-field test anyone runs against it.

The same objection applies to any `bumpFrom`-style normal built from `dFdx`/`dFdy` of a
procedural scalar: once the scalar aliases, its derivative is not small, it is wrong,
and wrong with spatial regularity — which reads as structure rather than as noise.

The safe form is to compare a derivative of **position** against the feature size:
`footMin` = `min(length(dFdx(P)), length(dFdy(P)))` is smooth, monotone in range and
cannot wrap, so `1.0 - smoothstep(0.28, 0.55, footMin / wavelength)` states Nyquist
directly. That replacement was written, rendered and **deliberately reverted, not
overlooked** — it fixed nothing about the artefact being chased and the bedform term it
would have changed is measured good, so landing it would have been an unverified change
to protected work. It is left written out in the comment beside the four gates. Anyone
picking it up should verify it against the midground metrics first.

**Never `sed -i` by line number in this tree.** A line-numbered revert landed a
statement in the middle of the `footShadow` comment block because the file had shifted
under it, and the same edit left the normal ablation in place — so an entire render was
spent measuring a frame that still had the ablation in it, and it looked like a
successful fix. Exact-text replacement only.

## For the performance agent: which terrain branches are actually live, per framing

Offered because reconstructing this from outside took a purpose-built tool
(`fillcost.mjs`), and because every existing ablation hides a *mesh* rather than a
shader. This is the inside view of `terrain.js`'s branches. All of it was established
while chasing the far_270 lattice, with liveness diffs quoted, so it is measured rather
than read off the source.

| branch | gate | live where |
|---|---|---|
| `rockW > 0.002` — 9 fetches, 3 triplanar reconstructs | `wallM = smoothstep(0.06, 0.42, vWall)` | **Wall ramp only.** Measured ~0 on the far_270 bank: substituting past the whole branch moved 1.98% of pixels at mean 0.05. It is identically zero on the entire wash floor, the terraces and most of the foreground of the low views. Already branched. |
| `steep > 0.006` — 6 fetches (`uDirtA`/`uDirtM`/`uDirtN` × 2 planar projections) | `steep = smoothstep(0.14, 0.40, slope)` | **Every bank in frame**, which is most far framings. Ablating just its normal moved 31.9% of pixels at mean 2.59. This is the one that is quietly always on. |
| `bedW > 0.004` — the bedform comb, no fetches, ~6 sines + 4 `fwidth` | `floorB` × `(1.0 - smoothstep(0.06, 0.20, slope))` × footprint ramp | **Floor only, and only at midground range.** Off on banks. |
| `bankW > 0.004` — lamination, no fetches, one `bumpFrom` | slope, `(1 - wallM)`, `(1 - sandW)`, `(1 - headM)`, macro noise | **Banks, off the wall ramp, off the wash head.** Live at 46.9% of pixels in far_270. |
| sand normal path | `sandW` | Ablating it moved 22.1% of pixels at mean 1.17, so materially live in the far framings. |

Two notes that may be worth more than the table. The `steep` branch is the one to look
at first: it is six fetches, it is not cheap, and unlike the rock branch it is live in
almost every framing that contains a bank. And the four `fwidth` calls in the bedform
comb are not just a cost — they are measuring the wrong quantity (see the aliasing note
below), so if that block is being touched for cost anyway, the footprint form written in
the comment beside them is both cheaper and more correct.

**One change since the map was written**, so the numbers stay honest: `bumpFrom` gained a
tilt bound at `af365e8` — one `length()` and one divide per call, two calls, against a
shader whose measured cost was 160 shadow comparisons and 41 fetches per ground pixel. It
is noise on your budget, and it is load-bearing on correctness, so please do not lift it
if the block is being rewritten for cost. It also means the `bankW` row's "one `bumpFrom`"
and the `panW` desiccation call are now both bounded, which slightly *reduces* the number
of pixels those branches change — but the branches are gated exactly as before, so nothing
in the liveness column moves.

Happy to walk any of this in more detail — that request outranks anything else I have.

## Landed: the mesh grid is a value now, not a number in a comment

The lattice hunt turned up a real latent fault next to it, and that one is fixed.

The band-limit reasoning above `swA` stated the grid as "0.20 m across and 0.42 m
along" and worked out how many octaves were safe **from those two quoted numbers**.
Extending the z-table to reach the wash head later put 0.615 m rows into the head zone,
which silently falsified the argument. The comment was a hundred lines from the table
and nothing connected them.

`src/terrain.js` now has one definition of the grid — `X_SEG` / `Z_SEG`, with
`buildTerrainMesh` building its axes from them — and two ways to consult it:

- **`meshStepX(x)` / `meshStepZ(z)`** read the local spacing back off the built axes by
  bisection, so a displacement term can *ask* what the sampling rate is here. Returned
  blended with the neighbouring cell rather than raw, because the raw gap is a staircase
  and anything scaling an amplitude by it would step at one row — a dead straight line
  across the wash, which is the artefact the graded axis exists to avoid.
- **`gridK(lambda, d)`** fades a term as its finest octave approaches the local Nyquist.
  The window is 1.8–2.6 samples per wavelength, not 2.0–3.0, deliberately: the floor was
  authored against 0.42 × 0.20 m and some of it sits near the limit on purpose, so a
  window starting at 2.0 would pull amplitude out of a near field that is measured good.
  Verified as an exact no-op from z −40 to −240 and biting only past −256.
- **`assertBandLimits()`** covers what cannot be faded without undoing measured work —
  `swA`/`swB` are elongated ten to one *by design* to sit just inside the across-channel
  spacing. It throws at mesh build with the actual samples-per-wavelength and the actual
  spacing. **Verified to fire**: coarsening the dense x segment to 0.30 m produces
  `swA bar roughness: 1.46 samples/wavelength across (dx 0.301 m)`. A check that has
  never been seen to fail is not known to work — that is the byte-identical gate above,
  one hour later.

No rows were added, so the triangle count is unchanged at 966k, which matters with the
frame already over its ceiling. `hf/lf` across the four far framings before and after:
0.54→0.55, 0.52→0.55, 0.56→0.56, 0.57→0.57.

**The reusable lesson: a sampling argument that quotes a constant from elsewhere in the
file is a landmine, and it goes off in a framing nobody is looking at.** Anything
band-limited against mesh spacing should read the spacing rather than quote it.

## Noted, not investigated: the ground floor's drifting grad/L denominator

Recorded so the next person inherits the timeline instead of rediscovering it.

`ground` floor `grad/L` moved **0.139 → 0.164** across the `sys1t`–`sys1u` window
while the region's `L` mean stayed flat at **0.368 → 0.369**. Gradient moving without
mean moving means the floor's high-frequency content changed, not its exposure.

**It is not System 1's.** Every change in that window is gated to `z < −274` and
`ground` looks at the near floor; the ungraded control reads 0.165 against the graded
0.164, which clears System 7's dither; and the grit gate in that window was the no-op
above.

**Candidates, both from outside System 1, both landing in the same window:**

- System 5 corrected its shaft march, which had been removing 55% of the radiance
  from shaded near rock.
- System 2 committed a texture registration warp plus a fourteen-row talus apron.

Either plausibly touches the floor's high-frequency content. **Deliberately not
investigated:** 0.164 against a 0.12–0.16 band is close enough that spending renders
on it before the deadline was the wrong trade. This is the fourth time on this project
a correct change has measured as nothing, or as something, because another correct
change moved the denominator underneath it — see the process notes.

## Closed: the wash head's amphitheatre was behind a rock ledge

`far_320` is the last framing of the walk and it was called the failure that matters
most: "a ruler-straight, slightly tilted ledge running the full width of frame with
uniform horizontal striping and zero erosional variation… it reads as a retaining
wall or a berm."

Half of that was System 1's and is fixed — the headwall's rise was a function of `z`
alone, so every contour was a line of constant `z`, which from a camera on the
centreline is a horizontal straight edge across the whole frame. It is now a bowl
that closes in from the flanks twenty-six metres before it closes on the axis, with
a pour-off notch and converging gullies. Measured on the height field at `z = -350`:
the axis stands at 11 m and `x = 25 m` at 35 m.

**None of it is visible, and the measurement says why.** Between the old head and the
new one — a change that moves twenty-four metres of relief — no pixel in `far_320`
moves by more than 13/255, and the ledge's silhouette does not move at all. A 13/255
shift across 99% of a region is an exposure change, not a geometry change. The ledge
has a dead-straight aliased top edge and fine horizontal laminae under it, so it is
rock, and the amphitheatre is standing behind it.

**Fixed in `b977d26`, and the cause was that the wall curtain ran twenty-four metres
past the end of the path it is hung on.** `WashPath.length` is 332.3 m and `posAt`
clamps beyond it; `src/rock.js` authored the curtain's domain as `S1 = 356`. So the
thirty-nine columns from `s` 332 to 356 were every one of them placed at the same
point — x 0.0, z −319.9, on the corridor axis — and the wall's lateral offsets fanned
that stack of coincident columns into a solid slab standing across the channel. The
apron leaning on it, sized against the wall rather than against the room it had,
reached to |x| 0.0 at fourteen to sixteen metres of height, in front of a bowl whose
axis crest is 11.3 m.

That closes both halves of the measurement. The silhouette did not move because the
occluder is rock geometry and never read the height field; the 13/255 everywhere else
was the exposure responding to a changed skyline it could not show.

Two clamps, both the same statement — geometry cannot claim room it does not have.
The curtain's domain ends six metres inside the path's length, with the existing 46 m
end fade keyed to that end so the crest walks down onto a real column rather than onto
the clamp, and `buildTalus` draws its stations from the same range because blocks drawn
past the end were landing in one heap on the axis. And an apron's reach is capped at
seven tenths of the wall's own set-back, leaving the inner third of the channel clear:
a wash keeps its bed swept, so a talus toe stops where the channel starts rather than
where gravity would let it stop. The seating walk in `apronProfile` cannot catch that
case, because at the head the apron is not floating — it is simply too long for the
room, and a collision test against the ground says nothing about that.

Measured after: apron toes over `s` 320–326 stop at |x| 7.0 and 4.4 against 0.0 before,
`far_320` shows the bowl, the flanking slopes and the sun in the notch, and `sun_gap`
and `far_270` are unchanged. Walls lose 16k triangles.

**Two general points, both cheap to reuse.** A domain constant that indexes a curve has
to be checked against that curve's own length — the failure mode is silent, because a
clamped parametric lookup returns a valid point and the geometry that lands there is
well-formed rather than NaN, so nothing in `nanhunt` or a bounding-sphere check sees it.
And `tools/_pixowner.mjs` settled in one render what three rounds of argument from
pictures had not: it hides one object at a time and watches the pixel, so it attributes
what was actually drawn. It named `apronL`, which no reading of the image would have —
the thing looked like a wall and it was the apron. `tools/_headprofile.mjs` then prints
the along-wash profile of both aprons against the terrain they stand in front of.

## Open: the head slopes read as streaks, and it is not stretched UV

Named alongside the above: "smooth surfaces with parallel diagonal streaks, pale
specks smeared into elongated tails along the slope direction — stretched UV, not
colluvium." Magnified 6×, the streaks resolve into individual platy clasts, each
foreshortened into a sliver by a grazing view of a slope they all share, and all
therefore elongated the same way. That is geometrically correct and it still looks
wrong, because the slope has nothing else on it: no size grading, no chutes, no
blocks. It wants a colluvium pass — larger angular blocks near the toe, sorting down
the slope, and the pale lithologies dusted harder — rather than a projection fix.
Checked and excluded: the shader bedform is already gated off at slope 0.20, and the
XZ projection stretch at these angles is a few per cent.

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

## A correction and the thing it corrects have to be measured in the same length

The clast burial was fixed, tuned and signed off, and the very next critique said
"no burial" again. The reason is that the two quantities involved were measured
against different lengths and nothing in the code said so. Burial is a fraction of
the clast's **thickness**; the slope correction that raises a stone to rest on the
highest ground beneath it is a fraction of its **radius**; and a tabular clast is
three or four times wider than it is thick. So a correction written as a modest
0.55 of one quantity was, in the units of the other, most of it:

| floor gradient over 0.28 m | correction | share of a median gravel's whole burial |
|---|---|---|
| median 0.248 | 0.68 cm | about a third |
| p90 0.831 | 2.29 cm | all of it |
| p99 1.771 | 4.87 cm | twice the clast's entire height |

A tenth of the floor had gravel standing completely proud or floating clear of the
ground. Two further points generalise:

- **It got worse when an unrelated change landed.** Filling the 0.1–1 m band in the
  height field raised the gradient at this baseline everywhere, so a term that was
  merely too strong became catastrophic. A coefficient tuned against one version of
  the terrain is a hidden dependency on that terrain.
- **It also had the wrong sign.** "A stone rests on the highest ground beneath it"
  is true of a stone dropped on a plane it is *not aligned with*. Every placement
  branch already seats the clast on the local surface normal, so the alignment has
  happened and there is nothing left to raise it for. What the normal genuinely
  cannot see is roughness finer than its own sampling baseline, and that leaves gaps
  *under* the clast — so the residual should bury deeper, not shallower. Two
  plausible-sounding sentences, opposite signs, and only one of them applies once
  you know what the code above already did.

## A stack of multiplicative occlusion terms needs a floor, or it makes holes

Large flat clasts on shaded banks rendered at literal `0,0,0` and were reported as
holes punched through the terrain. No single term was wrong. `cCav`, `mesoAO` and
`contact` each multiply the indirect diffuse, each is defensible, and none had a
lower bound, so the worst case was `0.34 × 0.224 × 0.46 = 0.035` of the sky dome.
On a sunlit bed that is invisible. On a shaded bank, where the incident fill is
already at its lowest, it falls below what eight bits can represent.

The floor belongs on the **product**, not on the terms, because weakening the terms
would remove the bedding cue everywhere it was working. It is also the right shape
physically: a crown that is exposed at all sees a good part of the sky, because that
is what being exposed means.

## The count did not move and the defect was still fixed

Worth adding to the list of ways a measurement misleads on this project, because it
is the inverse of the usual one. Ablating the occlusion stack removed every hole
from `bend` — visible immediately in a magnified crop — while the frame's
true-black **count** went from 0.583% to 0.552%. The metric was sound and it was
counting a different population: most of `bend`'s true black is vegetation
silhouette against a bright sky, which swamps a few thousand pixels of hole. A
whole-frame statistic cannot see a localised defect that is a fraction of a
percent, however severe it looks. This defect had to be looked at, not counted.

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
  albedos reacting to the new skylight — recheck both after System 4. **Partly
  resolved**: the specks on *shaded* ground were not albedo at all but the shadow
  wrapper's constant convergence handing shaded banks 44% of full sun with the
  micro-shadow signal on top of it — see "A footprint filter that converges on a
  constant" below. What remains on sunlit ground is still worth a look.

### A footprint filter that converges on a constant cannot tell a partial occlusion from a total one

This was "every shaded bank turns into noise instead of ground", the single most
frequent line in the whole-scene critique, and it survived two rounds of work on
the clast layer because it was never the clast layer. Ablating the direct light
on **every** clast instance moved 0.55% of the shaded bank. It was one constant in
`terrain.js`'s shadow wrapper.

The wrapper is right to exist. Once a screen pixel covers many shadow texels a
single binary depth test is the wrong answer at any bias — the sun is at a low
elevation, the incidence on the floor is grazing, the depth slope across a texel
is enormous, and the bed is covered in occluders a couple of texels across that
cannot be represented and so flicker per pixel. The correct answer is the mean
coverage over the footprint. But the code converged on the **constant 0.55**:

```glsl
return gRake * mix(s, mix(s, 0.55, 0.80), 1.0 - gFoot);   // = 0.2*s + 0.44 far
```

A footprint over a sunlit gravel bed really is about half lit, so on the bed the
constant is a fair guess. A footprint inside the cast shadow of a butte is lit not
at all, and there the constant hands the surface **44% of full sunlight that
nothing in the scene is emitting**. Worse, the leak is multiplied by `gRake`,
which carries every high-frequency term the direct light is supposed to modulate —
the raking march, the ripple and lineation shadows, the grit's sockets. So a
shaded bank received a phantom sun at nearly half strength with the entire
micro-shadow signal written across it. That is the salt and pepper, exactly.

The fix is to take the mean rather than guess it: four extra taps at the
footprint's own spread, averaged with the centre. Deep inside a shadow all five
agree on zero and the ground goes properly dark; over a hash they disagree and the
average is the coverage the footprint actually has, so the anti-acne purpose
survives. Offsets are pre-divide (`* sc.w`) and collapse to zero in the near
field, which keeps the near field bit-identical and keeps implicit-LOD fetches out
of non-uniform control flow.

Measured on `bend`: shaded floor 0.084 → 0.069 with the lit strip unmoved at
0.291 → 0.293, so **shadow-to-sunlit 0.289 → 0.235**, entering the 0.15–0.25 band
from above. Standard deviation in the shaded bank falls 60%, which is the noise
leaving. Far banks the same: `far_270` 0.089 → 0.054, sd 0.079 → 0.032.

**The generalisable form.** Any filter that fades toward a fixed value as
confidence drops is asserting that the fixed value is the population mean. If the
population is bimodal — and lit-versus-shadowed is the most bimodal quantity in a
renderer — that assertion is wrong for one of the two modes, and it will be wrong
in the direction of adding energy where there is none. **Note also that it flatters
the shadow-to-sunlit metric**: it was inflating the measured ratio project-wide,
so some of System 4's 0.312 was this, not their fill.

### Resolution is not extent: the wash "dead end" was neither an edge nor a wall

Two defects were reported from the far end of the walk — a dead straight slab
across the channel at −270 and a black wall filling the frame at −320 — and both
were read as the edge of the built world. They were not. The world runs to
−1900. What ended at −256 was the **dense zone of the mesh's z axis**, while the
path runs to −320 and the number keys can put the player anywhere on it. Past
−256 the geometric expansion tail took over: rows 1 m apart at −270, 3 m at −300,
6 m at −308. The slab is the first giant quad seen face-on and the void is the
player standing inside one.

Worth stating because the two symptoms both look like a missing-geometry bug and
neither is. If a far framing reads as boundary, **check the axis tables before
checking the extents** — `buildTerrainMesh`'s `axis()` segments are the thing that
has to cover the reachable world, not the height field's domain.

The wash now has a head: the channel narrows and shallows past −274 and a backlit
amphitheatre rises behind it, because a real wash between buttes heads up into a
box canyon rather than running on forever. A 340 m wash that ends is a better
scene than a 600 m one that does not. Two calibration notes for whoever touches
it: the first draft stood its toe fourteen metres from the end of the walk and
rose forty metres over fifty, which subtends about fifty degrees — that is not a
canyon head, it is a wall in the face, and it darkened the up-wash view as far
back as −220. Thirty metres of set-back over sixty of run puts the rim near
seventeen degrees with sky above it. And the z segments are graded in three steps
so no column carries a spacing ratio above 1.32, for the same reason the x axis
is graded: a jump in spacing leaves a crease along one row, and a dead straight
line across the wash is the thing that file exists to avoid.

### Density sorting is not size sorting

The facies model had been varying *how many* clasts land at a point for three
rounds — a lag band carries several times the density of swept ground — and the
critique still said "sorted by the last flood… scattered by a random number
generator". The half that was missing is that it never varied **which** clasts.
Every patch drew from the same size distribution, so all sizes were interleaved
everywhere at their global proportions, and a field with correct density structure
and no local size structure still reads as random.

Real bedload sorts because falling water loses competence as it spreads and slows,
dropping its coarse fraction first and its fine last. What it leaves is a mosaic
of patches each *narrow* in size and *different* from its neighbour. So the
quantity to author is **low local variance in grain size with high spatial
variance in the local mean** — not more noise, less of it, arranged.

Two implementation notes. The placement loop already carries `s` and `u`,
arclength down the wash by offset across it, so the field can be built directly in
the flow frame with no rotation — 18 m along by 3 across, which is a real bar's
aspect. And it must be **mean-one**: the loop runs until `cl.count` is placed, so
a mean-one gain redistributes without thinning, and thinning this field has gone
wrong before. Verify that (deciles of the field, total instance count before and
after) rather than assuming it. `wash_mid` floor grad/L 0.176 → 0.138, into the
band from above, with hf/lf 0.55 → 0.59: less raw gradient and more structure,
which is the direction that metric pair is supposed to move.

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

#### `hf/lf` moves with render resolution, so quote the resolution with the number

`wall_lit` midwall read **0.49 against the 0.55 gate** in System 7's ungraded control, with
their whole chain accounting for 0.01 of it — so the shortfall was upstream and it came to
System 2 as a rock defect. It is not one. Three ablations, each toggled inside a single page
load through a declared uniform so the pair differs by one bit and nothing else:

| | midwall `hf/lf` | upper `hf/lf` |
| --- | --- | --- |
| as shipped, 1600×900 | 0.49 | 0.61 |
| registration warp off (`uWarpK` 0) | **0.49** | 0.60 |
| joint traces off (`uJointK` 0) | 0.50 | 0.62 |
| as shipped, **3200×1800** | **0.54** | 0.63 |

The registration warp is exonerated to two decimals — it was the leading suspect, on the
sound reasoning that a domain warp is a local rescaling and a local rescaling of a
high-frequency octave can cost high-frequency energy while leaving the low-frequency term
alone. It does not, here: its summed gradient is 0.23, the stretch stays under a quarter, and
the number does not notice. Joints are exonerated too, and removing them *raises* the figure
slightly, so no surface term the shader evaluates is holding it down.

**Doubling the render resolution moves it 0.49 → 0.54 with the rock byte-identical.** That is
five sixths of the shortfall, bought with no change to any surface. The reason is scale:
`tools/_cropdist.mjs` raycasts the crops and finds the midwall at 41.2 m median with **one
pixel covering 60.8 mm of wall** at 1600×900, and the upper crop at 39.7 m and 54.2 mm. The
rock albedo's fine octave is metres-tiled and a pixel spans tens of texels, so at this
framing the grain is being resolved by the mip chain and not by the shader, and `hf/lf`'s
"high" band is reading whatever relief happens to fall near the 1-pixel scale — which is a
function of how many pixels the wall is drawn into.

Two consequences, both standing:

- **Quote the resolution alongside any `hf/lf` figure**, and compare only figures shot at the
  same resolution. The 0.54–0.75 reference band was measured on photographs at their own
  pixels-per-metre; it is not a resolution-free constant and a 0.06 gap at 1600×900 is inside
  the instrument's own sensitivity to framing.
- **Do not buy this number with amplitude.** At 60 mm per pixel the map cannot deliver it —
  the filter is upstream of the eye. Anything that did move it would be metre-scale relief
  added to make a pixel-scale statistic happier, which is the pebble-dash failure recorded
  below under *Amplitude is not structure*.

So 0.49 is **accepted**. The wall is the best-reviewed rock in the project and a critic
singled it out as convincing; the rule that where a measurement and the experience disagree
the experience wins applies exactly here. Left undone deliberately, not overlooked.

`uWarpK` joins `uJointK` as a permanently declared probe scalar, left at 1.0 by everything
except `tools/_warppair.mjs` — one multiply on a frame that is fill-bound on texture fetches,
and it is the difference between ablating a suspect in forty seconds and arguing about it.
Declared in the shader source rather than injected by the tool, because an undeclared debug
uniform failed the rock shader's compile and cost a full capture round the same night.

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

**0.021 of the 0.20 of saturation needed, and none of the hue.** (That 0.021 was later withdrawn
as well — see below. It was measured against one lateral normal rather than against the joint
target the ramp is fitted to, and the shipped fit is already optimal.) The hue half is not a
question of magnitude at all: rock hue turns cool only once the incident light's B/G clears
the albedo's own G/B of 1.335, and a **fully open sky delivers 1.285**. No aperture, however
large, flips the sign, because the fill is multiplied by rock albedo and the albedo throws the
blue away. This is the same argument that killed violet-on-rock-from-fill, now with a number
on it.

A later `tools/skyview.mjs` run confirms the foundation independently rather than re-using the
table the fit was built on. At d 46 and floor level it returns 0.431 / 0.799 / 0.779 / 0.587
blocked for up / away / across / toward, against the 0.431 / 0.800 / 0.785 / 0.575 in
`probefit.mjs` — reproducible to the third decimal. It also validates the escarpment's two
lit parameters, which the bounce depends on: the sunlit fraction of the skyline by height band
runs 0, 0, 0.13, 0.27, 0.54 from foot to crest, so `WALL_LIT` at 0.57 and `LIT_FOOT` at 0.40
are both measured rather than chosen. And it makes the case stronger going up-wash: on a wall
normal the sky is **0.949 blocked at d 18** against 0.799 at d 46, so the near-wash framings
the critique judges are *more* red-room-bound than the d 46 fit assumes, not less.

So the term that can fix this is one that is **added in front of the rock rather than
multiplied by its albedo**, which means airlight. That is System 5's in-scatter, and the same
critique independently measures aerial perspective at a **0% median saturation edge in all
eight views** — the term that would do this is currently not landing. **Routed to System 5.**
System 4's contribution is the ramp re-fit, worth 0.02, and it is not worth capturing on its
own.

## The gate is closed. Stop spending on it.

Confirmed independently on System 4's own build, not taken on report. `sys4l` against
`sys4m`, across System 1's fix to the shadow wrapper in `terrain.js`:

| | shaded | sunlit | ratio |
| --- | --- | --- | --- |
| `sys4l`, before | 23.8 cv | 63.0 cv | 0.378 |
| `sys4m`, after | 17.6 cv | 79.2 cv | **0.222** |

Both ends moved, which is the signature of a leak rather than a level: the phantom sun was
adding to the shaded numerator *and* the wrapper's constant was capping the sunlit
denominator. Target band is 0.15–0.25 and 0.222 is inside it. **Nothing in System 4 is to be
tuned against this number again** — not the escarpment, not the fill, and specifically not the
azimuth trade, which was already measured and declined at 62% of the wash floor.

## Airlight cannot fix the near shaded wall, and the reason is in three numbers

After System 1's fix the inversion is smaller in saturation and *worse* in hue, because
removing the phantom sun removed the one warm-but-sunlit component that was diluting the
bounce:

| `sys4m` | saturation | hue | V |
| --- | --- | --- | --- |
| lit wall | 0.558 | 24.4° | 0.808 |
| shaded wall | 0.600 | 5.5° | 0.180 |

Shade is now **18.9° warmer** than light, up from 10.2°. The conclusion that the remainder has
to be airlight was right about the mechanism and wrong about this measurement, and three
things settle it:

1. **`sources()` in `src/aerial.js` takes only `lum(fogColor)`.** The fog colour's chroma is
   discarded, so System 4 cannot colour the airlight through it at all; `jRay`, `jSky` and
   `jSun` each carry their own tint and only the level comes from here.
2. **The near-field source is deliberately dark.** `NEAR_LVL` is 0.061, so the air in the
   first stretch is at 6% of the fog's luminance — correctly, because the air in front of a
   shaded wall is shadowed by the same rock the wall is.
3. **And it is warm.** `jNear` is `WALL_SHARE`-weighted toward the wall bounce tint, which is
   sun times rock albedo.

At the receiver's measured 53 m the airlight is roughly a quarter of the rock's own radiance
and pulls warm. So it cannot cool this wall, and no distance term will: the frame's shaded
wall is *near*. Airlight is what separates shaded rock at kilometres, which is the depth
ladder, and that is a different complaint.

**Both of the two corrections System 4 claimed to own were withdrawn on inspection, and neither
was landed.** They are recorded here because the wrong figures were quoted upward first.

*The ramp re-fit, claimed at 0.021, is not a bug.* `tools/probefit.mjs` fits a free exponent at
1.46 for rms 0.045 and the pinned 1.5 gives rms 0.045 — identical, so the shipped ramp is
already the best two-parameter fit to the raycast table. The 0.021 came from comparing it
against the `away` normal alone. Against both lateral normals, which is what a single scalar
has to serve, the delivered visibility is 0.03 *low* on `away` and 0.03 *high* on `across` at
every height: a symmetric compromise, not a systematic error. Re-fitting toward `away` would
move `across` equally wrong in the other direction. That is choosing a favourite normal, and
rms 0.045 is already level with the 0.02–0.05 the skyline calibration itself achieves.

*The varnish correction, claimed at ~17%, was off by an order of magnitude.* 0.34 is a
per-fragment ceiling on a **sparse** feature, not a coverage: `src/rock.js` builds varnish as
plates in cells about 9.5 m along the wall, half the cells carrying one, each 5.5–25.5% of its
cell wide and tapering over 5–12 m. The area-weighted mean is low single digits, so the effect
on a bounce integral is of order 1%, not 17%. There *is* a larger real effect nearby — the lit
wall's area mean sits 28.5% below its own non-dark parts, measured on `sys4m_wall_lit` — but
that number conflates varnish with the wall's self-shadowing, which `WALL_LIT` and the lit
fraction ramp already model, so applying it would double-count. Separating them needs more
than an estimate and was not worth the remaining time against a defect that is 1% wide.

A third lever was tested and is empty: raising the opposite wall's own sky
visibility from 0.20 to 0.85 moves rock saturation 0.666 to 0.669, because **everything
arriving via the opposite wall is multiplied by rock albedo first and therefore arrives red**,
however blue the sky lighting it was. That is the trap in this geometry and it is worth
stating plainly.

## The buttes were not casting shadows, and three of the ten are inside the box

System 2's pale parallelogram on the far wall in `wall_shade` is a shadow hole with a complete
cause. `tools/_shadowbox.mjs`:

- The receiver is `wallL` at 53 m, world y 12.6–15.2 m, at **n·L 0.921** — a face turned almost
  straight at the sun, so it is brilliant unless something shades it.
- It is inside the far cascade at clip 0.456, 0.291, −0.083, so neither hypothesis about the
  box was right, and `rpBias` is not involved either.
- The sun ray from it is blocked by **`butte0` at 520 m**, and `butte0` has `castShadow = false`
  at `src/rock.js:1253`.

The stated reason there is that the buttes are "half a kilometre outside the shadow camera's
box, so asking for shadows only costs a second rasterisation of forty thousand triangles that
lands nowhere". That is true of seven of the ten and false of the three that matter: `butte0`
sits at clip z −0.83..−0.54, fully inside, with x and y both crossing the box, and `butte1` and
`butte2` likewise. The general point is worth keeping — **for a directional light a caster
shares clip x and y with its own shadow**, so a butte whose shadow lands on a wall inside the
box cannot be outside the box in x or y, and only z was ever in question. z spans 1,860 m.

Verified at runtime in `tools/_buttecast.mjs` without touching `rock.js`:

| buttes | patch mean V | pixels over V 0.88 | hot pixels, upper half |
| --- | --- | --- | --- |
| `castShadow false` | 0.676 | 2292 / 3876 | 4171 |
| `castShadow true` | 0.142 | **0** / 3876 | **29** |

The patch goes completely, and the upper half loses 99.3% of its hot pixels — so there were
several holes from this one cause, not one. Cost is 19k triangles for the three that overlap;
the other seven are frustum-culled on a bounding-sphere test. **One line, and it is System 2's
to make.**

Also checked and reverted rather than kept: pushing `NEAR_Z` from 40 to −1340 to capture the
1,225 m of up-sun `terrain` that sits in front of the near plane left the patch at 2,291
pixels against 2,297, so nothing being culled there was casting anything that mattered.

## That fix was right and it exposed the real defect: butte0 stands in front of the sun

The one line landed as `0e9f46c` and the patch went. Then every view in the next capture round
came back with a ground median of 9–13 against the high twenties before it, **sky unchanged at
226** — light lost on the ground and only on the ground, which is a new shadow rather than a
new level. `tools/_buttecost.mjs` toggles `castShadow` at runtime and prices it:

| window | buttes casting | not casting | delta |
| --- | --- | --- | --- |
| wash floor, V | 0.112 | 0.596 | **−81%** |
| wash floor, below V 0.12 | 60.3% | 2.7% | |
| lit wall, V | 0.133 | 0.325 | **−59%** |

At the same time `tools/sundisc.mjs` reports the disc blocked in all four candidate views —
`butte0` at 391 m in `sun_gap` and 477 m in `wash_mid`, vegetation in the other two.

Those are one fact, not two. **`butte0` stands between the hero ground and the sun**, so of
course its shadow covers the canyon and of course the disc is behind it. The shadow was always
geometrically there; `castShadow = false` was concealing a placement problem rather than
causing one, which is exactly why a correct fix presented as a regression. A 173 m butte at
350 m throws cot(15°) × 173 = **646 m** of shadow, and the hero canyon is inside that.

`tools/_butteclear.mjs` measures the clearance, and the numbers close the question:

| | value |
| --- | --- |
| `butte0` height | 173.4 m |
| distance, across the eight views | 324–413 m |
| crest elevation subtended | **22.8°–28.0°** |
| azimuth span relative to the sun's bearing | **−8.7° .. +27.1°** |
| sun | azimuth −9°, elevation 15° |

It straddles the sun in every view. `butte2` at 157.4 m blocks in three of them as well. To
clear `butte0` the sun must rise to 28°, which is not golden hour and abandons the long
shadows the whole brief is built on; or the butte must **drop 85.5 m**, half its height; or the
bearing must swing **8.7°+**, which is thirty times the 0.18–0.30° the caprock notch bought and
is the trade already recorded here as measured-and-declined at 62% of the wash floor.

**So the visible sun is not reachable from System 4's controls, and it is not an exposure,
aureole or elevation problem.** It needs `butte0` moved off the sun's bearing or lowered, which
is placement, in `src/rock.js`, and System 2's. Moving it fixes both halves at once: the disc
comes out from behind it and the canyon comes back into the light.

## Exposure came down to 0.95, and not for the reason first written down

`EXPOSURE` was fitted at 1.15 against sun elevation 11. Raising the sun to 15 to get the wash
floor off the ground moved everything it was balancing: the lit face went to **V 0.808 against
its 0.59–0.73 target** and the sunlit floor to **0.610 against 0.55**, so the level was over on
both counts and clipping facets square to the beam rather than merely risking it. Measured at
0.95 against 1.15 in identical windows, buttes not casting:

| figure | 1.15 | 0.95 | target |
| --- | --- | --- | --- |
| lit face V | 0.808 | **0.693** | 0.59–0.73 |
| wash floor V | 0.610 | **0.562** | 0.55 |
| wash floor grad/L | 0.137 | **0.143** | 0.10–0.20 |
| saturation, both windows | — | **+4%** | |
| shadow gate | 0.222 | 0.212 predicted | 0.15–0.25 |

The floor gets *better* structured as it darkens, because a darker floor sits on a steeper part
of the curve, and the gate's elasticity to global exposure is only 0.3 (`tools/expose.mjs`), so
a 17% cut costs it 0.010. **The gate figure is predicted, not measured** — it cannot be
measured until `butte0` stops shadowing the frame, and it is the one number to re-read
afterwards.

The correction worth recording: the first version of this change was justified by the sun disc,
on an analytic figure from the sky LUT putting the sky within a degree of the sun at 244 cv, and
the argument that ACES therefore had no shoulder left to separate the disc's pinned 255 from it.
`tools/discprofile.mjs` measures that sky at **120 cv with the disc at 169 — +40.5% contrast,
1.3σ clear**. The analytic model was wrong by a factor of two, there was shoulder to spare, and
the disc was already most of the way to visible before `butte0` was in front of it. Exposure
0.95 stands on the four contracted figures above and on nothing about the sun.

## The sky was never cold. It was clipped, and the aureole was a modelling error

The final critique reads the sky as cold, pale and flat — mean 185/197/212, no warm gradient
in any frame, no aureole, the sun a blemish. Measured against the model rather than the frame,
it is none of those things where it is made and all of them where it is written out.

`tools/skylut.mjs` reads the LUT in scene-linear, before the curve:

| elevation | linear R G B | sat | hue | cv at exposure 0.95 |
| --- | --- | --- | --- | --- |
| 2° | 4.54 4.17 3.18 | 0.300 | 44° | 250 250 248 |
| 15° | 1.94 1.97 1.90 | 0.036 | 84° | 241 241 240 |
| 35° | 0.39 0.48 0.66 | 0.411 | 219° | 181 192 207 |
| 70° | 0.11 0.17 0.29 | 0.623 | 221° | 92 117 155 |

A gold horizon grading to a blue zenith — the gradient golden hour is made of was already
there. ACES puts **9 to 15 cv per e-fold at linear 2 to 4.5 against 55 at 0.5**, so the whole
warm half of it was being compressed into nine code values and rendering 231/231/231 at
saturation 0.032, while the upper sky — dim enough to sit where the curve still has slope —
already measured encoded saturation 0.29 to 0.41, inside the 0.30–0.45 the critique asks for,
and needed nothing at all. A whole-sky mean cannot tell those two halves apart. That is why
the fault presented as "cold" when it was "clipped", and why the lever was never chroma.

**The aureole was a separate defect and a real one.** A single Henyey-Greenstein lobe at
g 0.76 falls **7% between half a degree from the sun and four degrees** — a tabletop thirty
degrees across, not a halo, with the disc sitting on it at 4% contrast. That is not a matter of
choosing a better g: a real aerosol phase function has a diffraction peak within a couple of
degrees *and* a refractive bulk across tens of them, HG is a one-parameter family, and fitting
either loses the other. `src/aerial.js` has carried two terms for airlight since it was
written; the dome was the one place still on a single lobe. Now 0.25 of the weight at g 0.96
over 0.70 for the remainder. Each term integrates to unity over the sphere, so this
redistributes the aerosol's scattered light in angle without creating any — which is what
makes it affordable.

Three things were tried and the order matters, because the first two fight:

1. **The two-term phase alone** buys the falloff but leaves the sky clipped.
2. **A grad filter on the dome** — a power law on luminance with chroma ratios held exactly,
   fixed point at LREF 0.20 — buys the gradient. It is pictorial and the comment in `sky.js`
   says so; the physical alternatives all spend something contracted. Dimming the dome dims the
   fill and moves the gate; dropping exposure spends rock and floor; lowering the sun costs the
   wash floor threefold; raising aerosol load reddens the beam and moves rock hue. A graduated
   neutral filter is standard equipment for a low-sun landscape and exposure blending is the
   same compression applied later.
3. But a power law compresses *every* ratio by its exponent, including the halo just built. The
   first render proved it exactly: a gold horizon at saturation 0.593 and an aureole still flat
   at 236 cv falling to 234. So **the narrow lobe is added after the filter**, not through it.
   Within two degrees of the sun that light is solar glare rather than sky — it is what blooms
   in a lens, and nobody holds it down with the same three stops as the sky.

Measured, `sys4n` (before) against `sys4p` (after), `sun_gap`:

| elevation | before | after |
| --- | --- | --- |
| 0–7° | clipped to white | **182/116/75, sat 0.594, hue 22°** |
| 7–11° | 231/230/228, sat 0.024 | 177/170/163, sat 0.137 |
| 11–16° | 231/231/231, sat 0.032 | 208/207/205, sat 0.076 |
| 22–30° | 176/184/196, sat 0.185 | 135/141/155, sat 0.279 |
| 30–90° | 139/142/154, sat 0.337 | 116/117/130, **sat 0.379** |

Saturation is up at every elevation, and the frame now runs gold at hue 22° through a neutral
crossover to blue at hue 237°. The aureole, radially from the disc: **255 → 252 → 250 → 246 →
226 → 175 → 124** across 0.5° to 32°, a fall of 77 cv where a single lobe managed 14.

**Nothing protected moved, and it cannot have.** Rock, floor and shadow take their light from
`A.sh` and `A.shOpen`, integrated from the LUT in `src/atmos.js`; nothing but sky pixels ever
samples the dome shader. `tools/_fillchk.mjs` confirms the phase change at the atmosphere level
too — the fill moves under 0.2% with its chroma moving 0.002 of saturation and 0.2° of hue,
because both lobes carry the same `mieTint` and only the Mie-to-Rayleigh ratio can shift.
Between the two sky builds, lit rock is 0.688 → 0.689 saturation at hue 14.3 → 14.3, and the
gate 0.227 → 0.227.

**Banding was not touched, on purpose.** It is quantisation at the 8-bit write, several passes
downstream, and `src/post.js` now carries TPDF at 1 LSB from a per-pixel hash applied last. A
second dither in the dome would be graded, defocused and vignetted before reaching the
quantiser it exists to break up. It did improve as a side effect, since a steeper cv gradient
crosses more levels: 90 distinct green levels down a `sun_gap` column against 64. The worst run
away from the sun is **15 px**, so it is better but not gone, and finishing it is System 7's.
The 26 px run the tool reports at column 536 is the clipped glare core 14 px from the sun's
centre, which is flat by design and is not a contour.

## Lit rock drifted 0.063 between the critique and now, and it is not System 4's

Recorded because it is a protected figure sitting outside its band and the next reader needs to
know where it came from. The critique measured lit rock at saturation 0.625, hue 20.8°; the
build now measures **0.689, hue 14.3°**. It is not the sky change: `sys4o` and `sys4p` differ
only in the dome shader and read 0.688/14.3 and 0.689/14.3, and the dome cannot reach rock.

By elimination, from the commit clock: the critique was written at 03:05, and the only changes
to land between it and the sky commit at 03:35 are `0191bbb` at 03:07 — System 5's depth
handover and march pricing, which is airlight over rock — and `42209c1` at 03:15, System 7's
toe, whose slope at the origin went 0.20 to 1.0 with the anchor moved to 0.080. Both plausibly
move a saturation and hue read over a region with a lot of low mid-tone in it; neither is mine
to adjust. **The figure to re-read is lit rock saturation and hue, and the two candidates are
in that order.**

## The aureole is System 4's, and it is not the stale dial it looked like

Two aureoles exist and only one is the sky. `src/atmos.js` `MIE_G` plus the Mie integral in
the sky LUT's alpha, multiplied back analytically by `src/sky.js` through `uMieG` and
`uMieTint`, is the dome's forward lobe — the bright patch around the sun. **System 4's.**
`src/aerial.js` `W_BROAD/G_BROAD/W_NARROW/G_NARROW` is the in-scatter phase over scene
geometry, is what the depth ladder is made of, and has `fog: false` on the dome so it never
touches it. **System 5's.** The near-sun sky is dome, so the lever needs no routing.

`tools/aureole.mjs` prices it without a solve per variant, and predicts 244 cv at 1° from the
sun against 245.7 measured, so it can be trusted:

| variant | sky cv at 1° | disc step | sky irradiance |
| --- | --- | --- | --- |
| as shipped, AOD 0.032 | 244 | 11 cv | — |
| amplitude 0.50 | 236 | 19 cv | −7.0% |
| amplitude 0.30 | 230 | 25 cv | −9.8% |
| no Mie at all | 211 | 44 cv | −13.9% |
| **tighter g 0.85** | **251** | **4 cv** | +1.5% |

Two results worth keeping. **Tightening the lobe makes the disc harder to see, not easier** —
a higher `g` concentrates the same energy into the core, so the sky at 1° goes *up* to 251.
And **the amplitude is not stale.** AOD550 is 0.032 against a documented Colorado Plateau
range of 0.025–0.04, so it is already at the thin end; the amplitudes that make the disc read
correspond to AOD 0.010–0.016, below any real desert atmosphere, and `src/atmos.js:181`
records that below 0.02 the horizon glow disappears and the sky goes hard cyan. Reducing it
also costs 7–10% of sky irradiance, which is fill, on the same shaded walls the critique
says are too dark.

Note the cross-system disagreement this exposes: AOD 0.032 over a 1200 m scale height implies
a **106 km visual range**, while System 5's aerial is at **19 km**. Matching them would make
the aureole 5.6× *brighter*, not dimmer. Clear Sedona air is 80–150 km, so the sky is the one
holding the defensible number.

The falloff, against the reference of "a small hard white disc with a tight warm halo in a sky
still blue overhead":

| degrees from sun | 1 | 15 | 30 | 60 | 90 |
| --- | --- | --- | --- | --- | --- |
| cv | 244 | 233 | 217 | 197 | 185 |
| saturation | 0.002 | 0.023 | 0.084 | 0.160 | 0.198 |

The halo is tight and the sky is blue at hue 211 by 15°, so the shape is right. What is wrong
is the level: **saturation 0.198 at 90° against 0.30–0.45 in the reference.** The sky is pale
rather than blue, and that is exposure, not aerosol — dropping exposure from 1.15 to 0.70
takes the 90° sky to saturation 0.280 and the disc step to 20 cv, moving both toward the
reference at once. It is the only lever measured so far that helps the disc and the sky
together, and its cost is the one already recorded above: global exposure lifts the shaded
numerator faster than the sunlit denominator and works against the gate.

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

## Read the capture's own error log before attributing a colour excursion to a material

The tenth instrument failure, and the cheapest one to have avoided. `sys7j`'s ungraded
control measured lit rock at **saturation 0.330, hue −146.7°, B/G 1.193** against 0.615–0.626
and 18.9–21.1° — cyan-blue sunlit sandstone, the wrong side of the colour wheel — and the
attribution around it was careful and correct as far as it went: measured before the grade,
so upstream of post by definition; only `wall_lit` moved, so not an airlight or exposure term;
and HSV saturation and hue are both invariant under the positive scalar the toe applies.

None of that could reach the answer, because **there was no rock in the frame**. `rock.js`
carried three temporary lines from a `tools/_varn.mjs` substitution run whose uniform was
never declared, so the rock fragment program failed to link. `shots/sys7j.json` and
`sys7j_nopost.json` both record it verbatim:

```
ERROR: 0:2377: 'uVarnDbg' : undeclared identifier
```

Every rock mesh in every view drew nothing — the walls, both aprons and all ten buttes — and
the fixed `wall_lit` rectangle measured the sky standing behind them. The sky in that frame
*is* saturation 0.33 at hue −147° with B/G 1.19. The other windows were unmoved to three
decimals because they are floor, sand and juniper crops with no rock in them, which is what
made it look like a rock-material fault rather than the absence of the rock material.

Three things to take from it.

- **The tell was in the number.** The reported hue had a q25–q75 spread of **one degree**
  across the whole crop. No material has a one-degree hue distribution; a flat unlit source
  does. Sunlit rock in the same window a capture earlier reads 17.9–23.9°. When a
  distribution collapses at the same time as its mean moves, suspect that the population has
  been replaced rather than shaded differently.
- **`shoot.mjs` already writes the page errors into `shots/<tag>.json`.** Reading that field
  costs nothing and would have closed this in one second instead of a bisection.
  `tools/_p7pre.mjs` catches a module that throws on evaluation and `tools/glslcheck.mjs`
  catches an unterminated literal, but neither can see a GLSL identifier that does not exist:
  the JS parses, the module evaluates, the geometry builds, and the failure appears only when
  the driver links the assembled string.
- **A debug substitution left in a shader is invisible to every static check in the tree.**
  If a temporary uniform is added, declare it in the uniform block in the same edit, so the
  worst case is a wrong-looking frame rather than no frame at all.

Confirmed on HEAD with a matched ungraded capture and no page errors: lit rock **saturation
0.621, hue 20.9°, B/G 0.638, V 0.676** — inside every band. The excursion does not reproduce,
and the registration warp, the varnish density and the apron phase warp in `11e67dc` are
cleared by measurement rather than by argument.

**One follow-on reading, for whoever shoots the colour handoff.** A second ungraded capture
half an hour later, across `639309d` (the shadow penumbra sized from the sun's angular
diameter) and System 1's in-flight terrain work, reads `wall_lit` lit rock at **saturation
0.687, hue 19.1°, B/G 0.642, V 0.704**. Hue and B/G are in band; the saturation is not, and it
is a level effect rather than a pigment one:

| | `s2v`, before | `s2x`, after |
| --- | --- | --- |
| lit-population saturation | 0.621 | 0.687 |
| lit-population saturation p95 | 0.740 | **1.000** |
| whole-window mean max channel | 58.6 cv | **56.7 cv** |
| pixels with a channel at 254+ | 0.00% | **0.33%** |
| sky mean | 154.8 | 154.5 |

The window got *darker* on the mean while its top began to clip, and the sky is identical to
three tenths of a code value. That is a contrast change on geometry — which is what resizing
a penumbra does — and HSV saturation is (max − min)/max, so a clipped red channel over an
unclipped blue one raises it mechanically. **Re-read this figure after the penumbra settles,
and read the clipped fraction beside it**; nothing in `src/rock.js` moved between the two
captures except the head of the corridor, forty metres behind this camera.

**Re-read on settled geometry, and it does not reproduce.** `sys7k`, `rock.js` at `84837d7`,
twelve views paired, zero page errors in both manifests:

| | `s2x` | `sys7k` ungraded | `sys7k` graded |
| --- | --- | --- | --- |
| lit-population saturation | 0.687 | **0.615** | **0.615** |
| saturation q25–q75 | — | 0.56–0.68 | 0.56–0.68 |
| saturation p95 | **1.000** | 0.732 | 0.732 |
| hue | 19.1° | 21.1° | 20.9° |
| B/G | 0.642 | 0.637 | 0.639 |
| mean max channel | 56.7 cv | 175.7 cv | 175.2 cv |
| pixels with a channel at 254+ | 0.33% | **0.00%** | **0.02%** |
| pixels with a channel at 250+ | — | 0.04% | 0.26% |

The diagnosis was right and the mechanism has cleared: the saturation p95 of **1.000** was the
signature — a population whose minimum channel is at literal zero, which is a clipped channel
and not a pigment — and on settled geometry there is no such tail. Saturation is at the bottom
edge of the band rather than through the top of it, and the grade moves it by 0.000.

Two notes for whoever quotes this next. The **clipped fraction is now a standing column** in
`tools/_p7col.mjs`, which also refuses to print a colour figure at all when the capture's own
manifest logged anything, and prints the interquartile spread beside every mean — the three
guards this episode and its predecessor each paid for. And the residual 0.02% at 254+ is
System 7's: a pivoted gain crosses one at 0.9854 encoded, so it used to flatten every input
from 251 code values up to white. `POST_DEFAULTS.shoulderTop` replaces the line above 0.86
with a Hermite landing on exactly (1, 1), which makes white reachable only from white and holds
251, 252 and 253 apart where all three used to read 255. ~~**`V` is out of band at 0.687 against
0.589–0.600, in the ungraded control as well as the graded frame, so it is an exposure question
and not a grading one.**~~ **Struck: the reading reproduced, but the band did not exist.** 0.589
and 0.600 were both historical readings that this footer printed as limits, and 0.600 is the
*floor* of the photograph-referenced 0.59–0.73 quoted back later as a ceiling. 0.687 is inside
0.59–0.73 and six thousandths under the 0.693 the exposure fit aimed at, so there was never
anything to route. See the V band section below; the correct conclusion was neither exposure nor
grading but the instrument.

## A reading is not a target, and a tool must say which it is printing

Five population errors landed in one night and they share one shape: **a number was recorded as
evidence and read later as a requirement.** The two failures arrived from opposite directions,
which is why neither was caught by sanity alone — one said the renderer had drifted when it had
not, the other would have had exposure cut hard when it was correct.

| what was quoted | what it actually was | direction of the error |
| --- | --- | --- |
| lit rock 0.687 at 14.6° against 0.615–0.626 | the whole window, not the brightest 40% | false regression |
| `V` 0.687 against "0.589–0.600" | two old readings, the second one a band's *floor* | false regression |
| wash floor 0.737 against 0.55 | `--lit` sunlit population against a whole-window target | false over-exposure |
| shaded figures from the darkest 40% | grazing-lit dirt with pebble shadows | shade read warm for weeks |
| `hf/lf` 0.49 against 0.54–0.75 | 1600×900 against a band derived at photographic resolution | false shortfall |

So, as a standing requirement on every measurement tool in `tools/`:

- **Print bands in labelled layers.** `tools/_p7col.mjs` now separates *acceptance bands, from
  Sedona reference photographs* from *drift guards, tighter than the photographs, earned rather
  than referenced*, and says outright that `V` has no drift guard and must be read against
  0.59–0.73. A figure outside layer one is a fault; a figure outside layer two is a change to
  explain, and those are not the same conversation.
- **Never print a historical reading in the position where a limit goes.** That single formatting
  decision cost two false regressions on the project's two most-quoted numbers.
- **Quote the population with the number** — window, threshold, resolution, arm. A tool that
  cannot say which population it measured should refuse, which is what the guards added tonight
  do.

## The lit-rock colour population, written down so two tools cannot disagree again

The flagship figure had two honest answers on the same commit — **0.615 at 21°** and **0.687 at
14.6°** — and it was nearly routed as a live regression on the most-defended number in the
project. It is neither a regression nor a transient. It is two different populations under one
name, and the axis is the **brightest-fraction threshold**.

Measured on one frame, `sys7k_wall_lit`, one crop, at 1600×900:

| population | saturation | hue | V |
| --- | --- | --- | --- |
| brightest 40% — **the contract population** | 0.615 | 20.9° | 0.687 |
| whole window | 0.685 | 14.3° | 0.357 |
| whole window, ungraded | 0.697 | 15.0° | 0.367 |

The unrestricted window includes the oblique and shaded parts of the same wall, which are
redder and more saturated — `bend`'s wall crop reads 0.685 at 7.2° — so dropping the
restriction drags saturation up and hue down together. **That is what walks hue six degrees,
and it is why neither clipping story could account for it**: clipping moves the top of the
range, so it moves saturation while leaving hue in band, which is exactly what System 2
observed and correctly reported.

So the definition, in full, because every part of it has now been the ambiguity:

- **View** `wall_lit`. **Crop** the fractional rectangle `[0.30, 0.24, 0.34, 0.34]` of the
  frame — `sat.mjs`'s `rock lit` window.
- **Population** the brightest **40%** of the crop, ranked by max channel, after discarding
  pixels whose max channel is under 12 code values. `sat.mjs --lit`, `hue.mjs --lit`,
  `_p7col.mjs` by default.
- **Statistic** the mean of the per-pixel HSV saturation, `(max − min) / max`.
- **Either arm.** Graded and ungraded agree to 0.000 on this population, so it does not matter
  which — but say which, because they differ by 0.012 on the *unrestricted* window.
- **Quote the resolution.** See below; it happens not to matter for this statistic, which is
  worth knowing rather than assuming.

`sat.mjs`'s own header already warned that a whole-window figure quoted against these bands
reads as a regression that is not there. That has now happened twice. `tools/_p7col.mjs`
prints the population in its header and shouts when it is given `--all`.

## Quote the resolution beside any `hf/lf` figure, and never compare across resolutions

`hf/lf` is **resolution-dependent** and the 0.54–0.75 reference band is not a resolution-free
constant — it was derived from photographs at their own pixels per metre. System 2 measured the
same build, byte-identical rock, at two sizes: midwall **0.49 at 1600×900 and 0.54 at
3200×1800**, five sixths of the apparent shortfall. The mechanism is that one pixel covers
60.8 mm of wall at 41.2 m, so the albedo's fine octave is being resolved by the mip chain
rather than by the shader, and `hf/lf`'s high band reads whatever relief lands near the
one-pixel scale — which is a function of how many pixels the wall is drawn into, not of the
surface. It also explains a midwall/upper split on one wall with one material: the crops differ
in framing.

Four resolutions of the same `wall_lit` crop, chain on and off, now bracket it — and the last
column matters, because the band floor is 0.54:

| `wall_lit` hf/lf | 1600×900 | 1997×1123 (rung 4) | 2560×1440 | 3200×1800 |
| --- | --- | --- | --- | --- |
| midwall | 0.49 | 0.53 | **0.54** | 0.54 |
| upper | — | 0.65 | 0.62 | — |

**The midwall shortfall is a resolution artefact and it clears at the resolution that ships.**
The chain is neutral on it at both delivery sizes — 0.54 against an ungraded 0.54 at 1440, 0.53
against 0.53 at rung 4 — so the depth of field is not eating far-field detail, which was the
0.55 gate's purpose.

**So: quote the resolution with every `hf/lf` number, and only compare figures shot at the same
one.** This applies retroactively to a good many recorded figures. Buying the number with
amplitude at 60 mm per pixel would add metre-scale relief to please a pixel-scale statistic,
which is the pebble-dash failure already in this document, so 0.49 stands as a recorded
decision.

**The same caution does not transfer to the colour statistics, and that was measured rather
than assumed.** It is a reasonable worry — which pixels fall in the brightest 40% depends on
how the wall is sampled — so it was tested on one build at two render resolutions, and on the
high-resolution frame box-downsampled in linear light so the content is identical:

| `bend` wall crop, brightest 40% | saturation | hue |
| --- | --- | --- |
| rendered 1600×900 | 0.658 | 6.7° |
| rendered 3200×1800 | 0.666 | 7.5° |
| rendered 3200×1800, downsampled to 1600×900 | 0.656 | 6.7° |

0.008 of saturation and 0.8° across a 2× resolution change, and the downsample recovers the
native figure to 0.002. **Saturation and hue of the brightest 40% are resolution-stable**, so
they cannot explain a 0.072 discrepancy, and the resolution caveat is specific to `hf/lf` and
to the other pixel-scale statistics rather than general to the measurement suite.

## Which post terms scale with resolution and which do not

Two of these were got wrong before they were got right, in opposite directions, so the rule
is worth stating rather than re-deriving:

> **A term scales with resolution if it is a fixed fraction of the frame. A contrast threshold
> on an edge that is one pixel wide at any resolution does not.**

- **Scales.** The circle of confusion, because defocus is an optical size in the image plane —
  a fixed fraction of the frame, and therefore a varying number of pixels. The grain plate,
  because grain is a property of the stock: a 256-pixel tile on a 1440-line frame is a finer
  grain than the same tile at 900 lines and would read as a different film.
- **Does not scale.** The silhouette antialiasing gate. This one is counter-intuitive and was
  briefly scaled by `h/900` on the reasonable-sounding inference that a silhouette covers more
  pixels at higher resolution, so a 150-code-value step would spread out and stop clearing a
  fixed 70–130 threshold. **A silhouette is a geometric edge and four coverage samples resolve
  it to about one pixel wherever it is drawn**, so more resolution buys more edge pixels rather
  than a softer edge. Measured on paired captures, the ungraded median largest one-pixel jump
  across the skyline is **81.5 code values at 900 lines and 85.0 at 1440** — unchanged. Scaling
  lifted the gate above the median edge, where it quietly stopped firing: median improvement
  over the control fell **23% → 10%**, while p90 kept most of its 42–47% because only the
  strongest edges still cleared it. Unscaled at 1440 the median is 64.9 against 85.0 (−24%) and
  p90 111.2 against 207.3 (−46%), the 900-line behaviour to within a point on both.

All three scalings are exact identities at 900 lines, so no figure recorded before them moves.

The general lesson, which cost two errors to learn: **a pixel-scale term cannot be trusted to
transfer between resolutions, in either direction, and the only way to know which way it goes
is a paired capture at both sizes.** Shoot at the resolution that ships.

## Shooting at 900 lines understated what the dither is doing

The ungraded control's banding gets substantially worse with resolution, because the same sky
gradient is spread over more rows and every tread lengthens. The dither does not care:

| worst run, sky | 1600×900 | 1997×1123 (rung 4) | 2560×1440 |
| --- | --- | --- | --- |
| dithered | 7–10 | 7–8 | 7–9 |
| ungraded control | 20–27 | 28–33 | 26–43 |
| flat%, dithered / control | 42-44% / 86-91% | 43-44% / 90-92% | 42-44% / 90-94% |

So the margin **widens from about 3× to about 5×** between capture and delivery resolution, and
the pass matters more where it ships than where it was tuned. Any future judgement of the
dither should be made at 1997×1123 or above.

## The 400 ms settle is wall-clock, so determinism has to be checked under load

`tools/shoot.mjs` waits `page.waitForTimeout(400)` between placing the camera and reading the
buffer. That is a **wall-clock** wait, not a frame count, and the number of frames it covers is
therefore a function of resolution and of machine load: roughly a hundred at 800×450, but only
about thirteen to twenty-four at 2560×1440 where the frame costs 17–30 ms — and fewer still when
another agent is capturing at the same time, which the render lock makes common.

Two captures out of eight came back byte-different during the 1440p handoff, which looked like a
seeding bug and is not one. The seeds are sound and both are worth knowing about:

- **Grain is pinned by the walk.** `walkTo(d)` calls `post.setWalk(d)`, which freezes the phase
  and derives it as a pure function of `d`. `shoot.mjs` calls `walkTo` for every view, so grain
  is a closed form in the station, not in elapsed time.
- **The quality governor is pinned for captures.** `perf.js` has an explicit harness clause —
  `navigator.webdriver` or a software rasteriser forces the top tier with no adaptation — so the
  ladder cannot introduce a rung change mid-capture.

Repeating both cases with the machine quiet gave byte-identical output: three consecutive
captures at 800×450 identical, and two at 2560×1440 identical to each other *and* to one of the
two original disagreeing frames. So the mismatch is **something in the pipeline not having
converged inside 400 ms under contention**, and the odd frame out is the early one.

**So: a byte mismatch between repeat captures is not evidence of a seeding bug until it has been
reproduced on a quiet machine.** Check the render lock and other agents' captures first, and
prefer to verify determinism at the resolution and load you intend to quote. A frame-count or
convergence-based settle would remove the class entirely and is the real fix; it is a harness
change and belongs to whoever owns `shoot.mjs`.

## Triangles are not what this frame costs, and the frame costs 31 ms

`tools/bench.mjs` on the real adapter, 2560×1440, top tier, median of seven blocks of thirty:

| view | full | −shimmer | −particles | −shadow | −veg | −post | −far | @0.7 res | tris |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wash_mid` | 30.49 | 30.52 | 30.50 | 30.54 | 29.91 | 30.06 | 30.51 | **19.58** | 3.97 M |
| `wall_lit` | 18.85 | 18.94 | 18.90 | 18.89 | 18.46 | 18.38 | 18.91 | **11.41** | 3.89 M |
| `sun_gap` | 30.93 | 30.99 | 31.02 | 31.07 | 30.23 | 30.57 | 30.95 | **20.02** | 3.92 M |

**Nothing geometric moves it.** Removing the far ridgelines is worth 0.02 ms of 30.49;
vegetation 0.58; shadows, particles and the whole post chain are inside the noise. Cutting
the resolution to 0.7 — 49% of the pixels — takes a third of the frame off. The frame is
fill-bound, exactly as the perf section at the top of this file predicted and for the first
time measured rather than inferred.

So **the ~3 M triangle ceiling is the wrong axis to hold the build to**, and shaving geometry
to reach it buys nothing measurable. Where the triangles are, from `tools/_tricount.mjs`,
which builds every geometry-bearing module in node and charges instanced meshes their full
instance count:

| group | triangles | share |
| --- | --- | --- |
| clast scatter | 2.253 M | 58% |
| terrain mesh | 0.966 M | 25% |
| rock walls + aprons | 0.272 M | 7% |
| rock talus | 0.245 M | 6% |
| far ridges | 0.069 M | 2% |
| distant buttes | 0.063 M | 2% |

The 1.18 M that arrived between `sys7h` (2.80 M) and `sys7i` (3.98 M) is all clast field and
all one commit, `9320488`: bevel counts 8→20 on gravel, 16→24 and 17→26 on cobble and
pavement, plus a new `granule` class at 26,000 instances over three variants (0.624 M on its
own). `scour` is the single largest instanced entry at 32,084 × 20 = 0.642 M. Rock is 15% of
the frame and System 2's apron rows are 12 k of it.

**The real finding is the time, and it is a contract-level problem rather than a system's.**
The target is 120+ fps at 1440p and the top tier delivers **32**. The quality ladder does not
rescue it either: `high` 31.04 ms, `medium` 24.62, `low` 20.38, `potato` 18.03 — so the
bottom rung of the governor is 55 fps, and there is no tier in the ladder that reaches the
brief. The lever is fragment cost and resolution, not vertices. From
`tools/shadercost.mjs`: `terrain.js` is 41 fetches with 14 unconditional and 8 inside a
loop, `rock.js` is 16 with 15 unconditional, `post.js` is 52 across five literals. Note that
`wall_lit`, which is mostly wall, costs 18.9 ms against 30.5 for the two floor-and-sky
framings, which is consistent with the terrain shader being the larger per-pixel bill.

Unowned and unscheduled, and it should be scheduled: a render-scale option, or a pass at
`terrain.js`'s unconditional fetches, is worth more than every geometry reduction available
in the tree. **Whoever picks it up should re-run `tools/bench.mjs` first** — the number above
is one machine, one night, and the ablation columns are what say where to aim.

**Taken up, and half of the paragraph above is wrong. See the next section.** The frame
being fill-bound is right and the triangle ceiling being the wrong axis is right. The
terrain fetch count was not the cost and never had been: it is about two milliseconds of a
thirty-millisecond frame. The `-shadow` column that reads 30.54 against 30.49 in the table
above is **a broken ablation**, not a result — `shadowMap.enabled` is a compile-time define
and three does not relink on a runtime change, so the column switched off a shadow-map
redraw that `autoUpdate = false` had already made free while every fragment went on sampling
the maps. Shadows were 23 of those 30.49 ms.

## Where the frame actually went: 160 shadow comparisons per ground pixel

The frame is **30.5 ms → 15.7–16.9 ms at 2560×1440 on the top tier** and the governor's
ladder reaches 120 fps at rung 4 and 182 fps at its floor. Full account in `PERF.md` §9;
what belongs here is the method and the two instrument failures, because both recur.

**An object ablation cannot price a shader.** Every ablation `bench.mjs` had hides a *mesh*,
which is the wrong instrument twice over: hiding the terrain does not price the terrain
shader, because whatever stands behind it must be shaded instead, and the two largest
fragment consumers — the ground and the sky dome — cannot be hidden without changing which
pixels exist. `tools/fillcost.mjs` ablates the *shader* and leaves the object, by splicing an
early constant write into the top of each material's fragment `main`. Same geometry, same
vertex program, same draw order, same overdraw, same shaded-pixel count.

| `wash_mid`, 2560×1440 | full | −ground | −rock | −sky | −clasts | −veg | −msaa | −allScene |
|---|---|---|---|---|---|---|---|---|
| ms | 30.66 | **6.46** | 29.17 | 30.60 | 30.24 | 29.83 | 23.37 | 4.24 |

**The terrain fragment shader was 24.2 ms of a 30.7 ms frame.** `tools/terrcost.mjs` then
ablates one block at a time inside it, and 23 of those 24 are five shadow lookups. The
arithmetic is not close: `getShadow` is sixteen `texture2DCompare` calls under `PCF_SOFT` and
seventeen under `PCF` — the soft variant is a bilinear-weighted filter at the same tap count,
not a cheaper one — `terrain.js`'s footprint filter calls it five times, and the scene has
two shadow-casting directional lights. **160 shadow texture reads per ground fragment.**

The four offset taps are 2.6 texels apart while `PCF_SOFT` already integrates a 4×4
neighbourhood, so five kernels covering nine texels square were sampled eighty times per
light. Each offset is now a bilinear 4-tap: same neighbourhood, quarter the cost, and still
*interpolated* rather than binary — a single hard compare per offset would be cheaper again
and is exactly the bimodal sample the footprint filter exists to remove. The centre tap is
untouched, so the penumbra sized from the sun's angular diameter is bit-identical, and the
block is gated on its own weight, which is an exact identity in the near field.

**Verified as a pair in one page load** (`tools/shadowpair.mjs`, both halves one module set,
one sun, one substitution between them, substitution-site count reported). All eight views:
mean absolute difference a third of a code value, whole-frame luminance moving at most 0.12
of one, no page errors. `grad` and `hf/lf` identical in all twelve windows to the digit
`grad.mjs` prints; the largest colour excursion in the set is `sun_gap` floor mid saturation
0.568 → 0.566; lit rock in `wall_lit` reads 0.687 at hue 14.6° both sides. **The shadow gate
is 0.211 before and 0.211 after.**

### Two instrument failures, and both generalise

**A compile-time define toggled at runtime is an ablation that reports zero for something
enormous.** That is the `-shadow` column above: it read 0.05 ms for a term that was three
quarters of the frame, and it was quoted upward as evidence. Anything gated by a `#define`
needs `material.needsUpdate` beside it or the column is a no-op with a plausible number
attached. `bench.mjs` now forces the relink, in the warm-up frames, and reads 16.8 against
11.0.

**"My change did nothing" — check the variable was a variable before believing it.** Two of
these turned up in one night in unrelated subsystems, and both produced a confident null from a
knob that was never turned. One is `shadowMap.enabled` immediately above. The other is
**`shadowRadius`, which `PCFSoftShadowMap` ignores outright** — `PCF_SOFT` compiles a fixed
bilinear-weighted 3×3 over a single texel and never reads the uniform, so the 3.5 and 1.7 texels
these cascades have carried since they were built have never done anything, and the experiment
that widened 3.5 to 10, measured floor `grad/L` unchanged at 0.186 and concluded that cast-shadow
edges are too small a share of a region to move a high-pass reached a plausible conclusion by a
route that proved nothing. Full account under "Soft shadows" below.

The shape is identical both times and is worth recognising rather than re-deriving. **A renderer
setting consumed at compile time raises no error when written at runtime** — it silently keeps the
old value, and every measurement downstream is precise, reproducible and about nothing. So before
publishing that a term does not matter, prove the term moved: drive it to an absurd value and
confirm the frame visibly breaks, or read back the compiled program, or dump the define. A null is
evidence only once the independent variable is known to have varied. `#hardshadow` and `#noastern`
exist so that two of these are now ablatable inside a single build, which is the structural answer
— a flag the shader branches on cannot quietly not exist.

**A tier is not a rung.** `perf.setTier` moves the quality tier and deliberately leaves the
render scale at 1.0, which is the right control for "what does a tier cost" and the wrong
answer to "does the fallback reach the target" — the governor descends an *interleaved*
ladder whose bottom step is potato **and** a 0.58 render scale, and on a fill-bound frame
those differ by most of the frame. "The bottom rung of the governor is 55 fps" was measuring
potato at native resolution, which is a setting the governor never selects. `perf.js` now
exposes `rungs` and `setRung` and `bench.mjs` prints both tables.

### The ladder, measured, and the numbers to quote

Per rung at `sun_gap`, 2560×1440, RTX 4060, median of seven blocks of thirty:

| rung | tier | scale | buffer | ms | fps |
|---|---|---|---|---|---|
| 0 | high | 1.00 | 2560×1440 | 16.95 | 59 |
| 1 | high | 0.88 | 2253×1267 | 14.34 | 70 |
| 2 | medium | 0.88 | 2253×1267 | 12.05 | 83 |
| 3 | medium | 0.78 | 1997×1123 | 10.28 | 97 |
| **4** | **low** | **0.78** | **1997×1123** | **8.12** | **123** |
| 5 | low | 0.68 | 1741×979 | 6.91 | 145 |
| 6 | potato | 0.68 | 1741×979 | 6.50 | 154 |
| 7 | potato | 0.58 | 1485×835 | 5.48 | 182 |

The governor targets 8.33 ms and settles at rung 4, so the shipped experience on this machine
is **120+ fps at an upscaled 1997×1123**, and `#high` pins 2560×1440 at 59. Quoting a
scale-1.0 tier row as the fallback is the error the row above documents.

**What is left, and it is not a shader.** The terrain shader is now 9.1 ms, of which 4.0 is
its centre shadow tap — carrying the penumbra, and not reducible without changing the picture
or the light rig. The fixed floor of vertex work, resolve and post chain is **4.5 ms, now 28%
of the frame** where it was 15% when the geometry ceiling was declared the wrong axis. That
does not make the ceiling right — shaving triangles to reach 3 M still buys nothing measurable
— but the next axis after resolution is vertex cost, and 2.25 M of the 3.97 M triangles are
clast instances. Measure it before touching it.

*(One sentence above said "sixteen comparisons across two lights" and no longer does. The
centre tap is System 4's blocker-search penumbra now, not three's fixed kernel; the count is
a 12-tap search plus either three's 16 or up to 28 spiral taps, per cascade. See the next
section.)*

## Re-benched on the shipping build: the penumbra and the tap reduction need each other

The table above was measured while five systems were committing, and one of the things that
landed lands on the exact term it optimised. **It reproduces, and the two changes turn out to
be complementary rather than in tension.** `PERF.md` §10 has the full account; what belongs
here is the shape of the result and one more instrument failure.

**The penumbra was already in the tree when the reduction was measured.** `639309d` landed
04:29, `543ea94` 04:46, the reduction `4d72ec6` 04:56, and its bench ran 05:08. Re-run on
`fa8b9ec` an hour later, every figure is within 0.1 ms — `wash_mid` 16.78 → **16.80**, rung 0
16.95 → **16.91**, rung 4 8.12 → **8.21**, rung 7 5.48 → **5.44** — with `sun_gap` coming
*down* 0.9. Nothing landed in that hour costs anything measurable, System 1's grazing bound
included, and **the ladder needs no retune** because it was tuned against a penumbra-live
table in the first place.

**Restoring the old footprint estimator would now cost +18.2 ms, not +14.6.** Priced directly
rather than extrapolated — `terrcost.mjs` gained a `footFull` row that puts the four full
`getShadow` calls back — `wash_mid` goes 17.1 → **35.3 ms**, worse than the 30.5 the project
started at. Each restored offset would now be a blocker search plus a spiral rather than
sixteen comparisons, so **the penumbra is only affordable because the offsets were reduced
first.** The reduction is worth more on the penumbra path than it was on the fixed-kernel one.

**The justification for the reduction is retired even though the reduction stands**, and that
distinction is the point. The original argument was overlap: five kernels covering nine texels
square. That is no longer true — the centre integrates up to 2 m of the coarse cascade where
the offsets still sit at 2.6 texels. What holds instead is that the two answer different
questions and both are still answered: the centre resolves the **penumbra**, a property of the
blocker; the four resolve the mean over the **screen footprint**, a property of range. A
conclusion that survives while its stated reason expires is worth re-deriving rather than
inheriting, and `src/terrain.js` now carries the corrected version beside the code.

**Banding was the specific risk and it is measurably absent.** The instrument is `hf/lf`: a
filter gone blotchy carries its gradient at four pixels rather than one, so the ratio falls.
Across all twelve standard windows plus three placed by hand on `shade_far`'s soft terminator
— the widest penumbra in the capture set — `grad`, `grad@4` and `hf/lf` are identical to four
digits, 0.0323 → 0.0322 and 0.59 both sides on the terminator itself. Lit rock reads **0.619
saturation at hue 14.6° on both halves**. The first eight rows of the pair table reproduce the
earlier run to the digit, and `shade_far` joins the same family.

**The run's own negative control.** The floating-slab region on `wallL` is a **byte-identical**
crop between the two halves. That surface is `rock.js`'s, whose wrapper only catches the value,
so a terrain-side filter cannot reach the defect the penumbra was built to fix. The two changes
do not touch the same pixels — which is the cleanest possible answer to "is there a conflict".

**What the penumbra costs, since a compile-time feature cannot be ablated at runtime.**
`bench.mjs` gained `--hash`, so `#hardshadow` can be priced in a second page load:

| | PCSS (ships) | `#hardshadow` | penumbra |
|---|---|---|---|
| `wash_mid` | 16.80 | 12.64 | **4.16 ms** |
| `wall_lit` | 12.23 | 9.93 | 2.30 |
| `sun_gap` | 16.82 | 12.15 | 4.67 |

25% of the top-tier frame, the largest single identified item in it. Stated as a ladder cost
instead: **the penumbra moves the 120 fps rung by one step** — 8.33 ms is reached at rung 4
(low / 0.78) with it and rung 3 (medium / 0.78) without, at the same 1997×1123. So a
terminator that rises over 27 px instead of 3 costs one quality tier at the target framerate
and no resolution. Recorded as a trade, not a recommendation: it is a picture decision.

### Instrument failure the twelfth: a working ablation that printed its own failure warning

The mirror of the `-shadow` column. There a broken ablation reported a plausible number; here
a correct ablation reported `NO — CHECK` beside every row, including a real 4.44 ms saving.

`customProgramCacheKey` carries the ablation's name, which is what stops fourteen variants
sharing one compiled program. It also means each program sits in three's cache from block 0
onward, so `onBeforeCompile` never runs again — and the applied-flag was read once per timing
block, so the *last* block's reading was kept: not compiled, therefore not substituted,
therefore a warning printed over a correct measurement. It now records site counts for the
life of the run and prints the count rather than a boolean, because *matched nothing* and *was
never asked* are different failures that `false` conflates.

> **A cache key that makes an ablation measurable also makes the evidence that it applied
> unobservable on every run after the first.** Verify once and carry it forward; do not
> re-read a compile-time flag per timing block. And when a warning and a plausible number
> disagree, find out which is lying before quoting either.

### Two things noted and deliberately not done

- **`src/sky.js:959` trips `glslcheck` with `unclosed=1`, and it predates this pass.** It is a
  false positive on today's source — a GLSL block comment that opens in one template-literal
  chunk and closes inside the `#noastern` ternary's arms, so each arm closes it and the checker,
  which reads literals independently, cannot see that. The assembled string is valid. It is
  still fragile: both arms have to keep closing the comment, and an edit to either breaks the
  shader in a way node cannot see. System 4's to judge.
- **The four `fwidth` calls in the bedform comb are measuring the wrong quantity** and System 1
  has written the correct footprint form beside them. Left alone: the block prices at 0.05–0.08
  ms so there is no cost case, and it is measured-good protected work whose replacement they
  reverted on purpose. It should land as a correctness change with its own verification rather
  than inside a perf commit.

## Accepted and declined, for System 2, so they are decisions rather than oversights

Both were ruled on by the coordinator against the time remaining, and both are real.

- **The masonry read on `wall_lit`.** `tools/_litpatch.mjs` finds 154 patches where a facet
  faces the sun inside a shaded neighbourhood, and at a distance those right angles read as
  coursed blockwork. The mechanism is the along-wall gradient of the lateral offset field:
  where it turns faster than the weld threshold tolerates, the wall breaks into facets whose
  arrises are square to the bedding. Limiting that gradient would round them — and the same
  arrises are what make `sun_gap`'s wall the best rock in the project, so the trade needs
  more render budget than exists before midday. **Accepted as shipped.**
- **Alcoves.** Not built. A real Supai/Coconino wall carries wind-scoured hollows a few
  metres across, and this one has joints, benches and spall scars but no concavities of that
  size. It is a genuine gap in the surface vocabulary rather than a defect in what is there.
  **Deferred, not forgiven.**

## The floating slab is not a shadow hole. It is a shadow edge that is 10x too sharp

Routed to System 4 as a shadow hole on the strength of System 2's ablation: the patch is
5.68x its surround with shadows on and 1.04x with them off, therefore the geometry and the
normals are continuous and the whole difference is the shadow term. Both readings are
correct. The inference is not, and the trap is worth naming because it is a cheap one to fall
into. Turning shadows off removes the occlusion, so the patch matches its surround at 1.04x
whether the shadow map is broken **or** the occluder has a hole in it. That test clears the
receiver's normals, which it does correctly. It cannot see the caster, and the caster is where
this lived.

`tools/_slabmap.mjs` fires a ray at the sun from every cell of a grid covering the patch and
its surround. Every sample inside the slab is **unblocked** — the sun really does reach it —
and every sample in the shadowed surround is blocked by `wallL` itself, at either 1 m of local
relief or about 170 m up-canyon. The render agrees with the raycast at all nine probe points
and at every cell of the 36x20 map. The shadow map is not failing here: a facet of the wall is
lit through a grazing gap in its own crest, and the sun ray clears that crest by a hair —
receiver at y 14, crest at y 55.7–59.5 at 170 m, the sun rising 0.259 per metre, so the ray
passes within a metre of the skyline across the whole patch. Grazing occlusion against a
near-straight crest is what makes the boundary look ruled.

**What was actually wrong is the width of the edge, and that is a light property, so it is
System 4's.** 170 m of gap under a half-degree sun is 1.6 m of penumbra, which at this
framing's 0.05 m/px is about 32 px. Measured on the sRGB frame the terminator rose 10–90% in
**3 px**. A razor edge on an occluder that far away is the loudest "this is a renderer" tell
in a raking shot, and it is what turns a physically correct shaft of light into a decal.

### The reason, and a retraction

three's `PCF_SOFT` branch **ignores `shadowRadius` entirely**. Its kernel is a fixed
bilinear-weighted 3x3 over one texel. This rig has been setting 3.5 and 1.7 texels since the
cascades were built, and the project renders `PCFSoftShadowMap` on every tier above the
lowest, so those numbers have never done anything.

That retracts an experiment recorded in `sky.js`, which reached a true conclusion by a false
route. Widening the radius from 3.5 to 10 texels measured floor `grad/L` at 0.186 both times
and the shaded wall at 0.019 against 0.021, and this was read as evidence that cast-shadow
edges are too small a share of a region's pixels to move a nine-pixel high-pass. They may well
be, but the experiment did not show it: **both settings compiled to the same one-texel
kernel**, so the null was the null of a test that never varied its independent variable.

### The fix, and the one thing it broke on the way

Penumbra width is now derived per fragment from the blocker distance and the sun's angular
diameter. Three details carry their weight. The kernel is a disc in **world** space rather
than in UV, because both cascades cover more ground across than up over a square map and a
circle in texels is a 1.7:1 ellipse on the rock. Bias is **per tap** from the receiver plane's
own depth gradient, which is what makes a 30-texel kernel affordable at all — `rpBias`
estimates one number for the whole kernel from its radius, and at 30 texels that estimate
either eats contact shadows or lets the wash floor shadow itself, a loop this rig has already
been round once. Tap count follows the radius, so contact shadows still cost eight taps and
only a penumbra metres wide pays for 28.

Running that disc all the way down to contact cost **+0.063 of lit rock saturation** and
+0.033 of V, with the region's median falling while its bright tail clipped. A packed depth
map cannot be bilinear-filtered — three sets `NearestFilter`, and must, since interpolating
four packed bytes is meaningless — so `PCF_SOFT` emulates the interpolation in the shader with
those `mix()` calls on the fractional texel position. A nearest-sampled disc at one texel has
eight taps and eight levels and lands blocky beside it, and the rock's own micro-relief
self-shadowing had gone binary under it. So the kernel splits on penumbra width: below three
texels three's kernel keeps it, above seven the disc has it, `smoothstep` between. Contact
shadows are a baseline this project already tuned and the penumbra work has no business
touching them.

`#hardshadow` drops back to the fixed kernel while leaving the rest of the build alone.
Without it none of this could have been attributed, because the captures either side of the
change also straddle System 5's shaft fix, which brightened shaded rock on its own.

| figure | PCSS off | disc everywhere | split kernel, shipped | band |
| --- | --- | --- | --- | --- |
| slab terminator, 10–90% rise | 3 px | 27 px | **27 px** | ~32 px geometric |
| lit rock saturation | 0.622 | 0.685 | **0.616** | 0.615–0.626 |
| lit rock hue | 20.6 | 19.1 | **21.0** | 20–22 |
| shadow gate | 0.232 | 0.231 | **0.213** | 0.15–0.25 |
| floor `grad/L` | 0.087 | — | 0.089 | 0.12–0.16 |

The gate moving 0.227 to 0.232 across the earlier pair was System 5's shaft fix, not the
penumbra: across the same-tree ablation the penumbra moves it by 0.001. The 27 px still stands
after `4d72ec6` rewrote `terrain.js`'s shadow wrapper, re-measured on `sys4s`.

## The shade was brown because the corridor was modelled with one doorway

Two reviewers reported independently that nothing in the scene is cool — the shaded banks read
the same red-brown as the lit rock, only darker, and there is no blue rung anywhere in the
aerial ladder. Both were right, and finding out why took retiring the instrument first.

**Every "shaded" figure quoted in this project so far came from the darkest 40% of a region,
and on the wash floor that population is not shade.** The sun is nine degrees off the corridor
axis at fifteen degrees elevation and `tools/fillprobe.mjs --floor` measures that floor **0.70
sunlit**, so its darkest 40% is grazing-lit dirt with pebble shadows in it — a weighted average
of sun and fill, quoted as though it were the fill. It is a well-defined number of the wrong
thing, and the same failure mode System 5 hit this round by measuring a region that another
agent had rendering in false colour.

`tools/_fillonly.mjs` renders the shade instead of hunting for it: zero the two sun cascades,
pass `air=0`, and what is left is the scene lit by nothing but dome and bounce, with no
threshold and no population selection to argue about. Under that light the wash floor read
**hue 2.6 at saturation 0.606** and the shaded wall **hue 5.7 at 0.723** — the latter within
noise of its full-light figure, so that wall genuinely is fill-lit and the fill is the whole of
what to account for.

### The arithmetic that decides what is even reachable

Reflected B/G is the illuminant's B/G times the albedo's, so shade can only read cool where
the illuminant's B/G clears the albedo's G/B. Those are **1.514** for the wash floor and
**1.335** for the escarpment rock. This is why "make the shadows violet" is not a free
parameter: on this pigment it is a threshold, and a few percent of illuminant chroma either
side of it is the difference between plum and brown.

### The defect

`skylineSin` and `coverAt` put a 45 degree rock skyline at every bearing except a window
toward the sun. **A wash is open up-canyon as well as down.** `tools/_skydist.mjs` bisects the
skyline at 24 bearings and finds the bearing directly astern wide open over most of the walk.

That is the worst bearing to get wrong. The away-from-sun hemisphere is what every shaded face
in this corridor is turned toward, so it is the lobe that lights all the shade — and it was
being filled with escarpment, which `tools/_fillterms.mjs` shows is **92% reflected sunlight
at B/G 0.462**, leaving the far wall at hue 17 and saturation 0.805. The lobe lighting every
shadow in the project was arriving at **hue 10**, warmer than the sunlit rock it is supposed to
contrast with. That is the entire complaint, and it was one missing window.

### It is not a constant, and shipping it as one would have been a cheat

The first fix put a single 20 degree window astern, justified from `_skydist`'s default sweep at
40/100/160/220 m. That sweep is the mistake: three of those four points are past `sun_gap` at
120 m and **none of them is a viewpoint**. Re-run at the distances the standard views actually
sit at, the astern skyline is a strong function of position, because what is behind you is the
corridor you have already walked and it lengthens as you go:

| walk | 8 | 30 | 46 | 62 | 92 | 120 | 160 | 220 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| astern skyline, deg | 79.9 | 57.3 | 45.7 | 37.4 | 27.3 | 22.0 | 17.0 | 17.8 |

So any single value is wrong nearly everywhere. 20 degrees is right past 120 m and absurd at 8,
and the **mean over the eight standard viewpoints is 45 — which is what `SKYLINE` already was.**
Shipping the constant would have bought cool shade by opening a window that geometry says is
shut at five of the eight views. It measured well for the same reason it was wrong.

It becomes the second axis of aperture instead. A third probe carries the open-astern
environment and `sky.js` blends toward it by world Z. Nine measured points sit within two
degrees of `17 + 63·exp(-(d-8)/45)`, and world Z stands in for arc length because the wash is
straight — x holds inside 9 m over 332 m, so `d = 8 - z` to 1.4%. The mix is taken on sin² of
the skyline rather than on the angle, because what the two probes differ by is cosine-weighted
solid angle, which is sin² of its elevation; against the angle it would be six points of mix
out at the middle of the walk. Passing `SKYLINE` to the shared skyline function reproduces the
old model exactly rather than approximately, which is what makes the pair a clean ablation.

This also explains why `skyview.mjs` concluded aperture is a function of height alone: it
sampled 18 through 120 m and saw little change, which is true over that stretch and is the flat
end of a curve that runs to 332. **Both sweeps were right about where they looked.**

| open-astern probe, illuminant | before | after |
| --- | --- | --- |
| away from sun, hue | 10 | **317** |
| away from sun, B/G | 0.855 | **1.190** |
| up-facing, B/G | 1.362 | **1.486** |
| shaded rock, up-facing, saturation | 0.492 | **0.394** |
| shaded bank at 45°, saturation | 0.692 | **0.483** |
| shaded bank at 45° | brown | **plum** |

The mix is 0.00 at `wash_low` and `ground`, 0.04 at the three views at 46 m, 0.37 at `juniper`,
0.72 at `bend`, 0.86 at `sun_gap`. So `wall_shade` keeps the warm bounce the critic named as one
of the good things in the set, while dirt far up-canyon cools even when the camera is near —
which is the population the critique was actually looking at, shaded dirt at 300 m.

In the render, ablated inside one build with `#noastern`:

| fill-only | astern off | astern on |
| --- | --- | --- |
| `wash_mid` floor near, B/G | 0.953 | **0.964** |
| `wash_mid` floor near, saturation | 0.606 | **0.595** |
| `wash_mid` floor mid, B/G | 0.897 | **0.917** |
| `bend` sand, B/G | 0.934 | **0.989** |
| `bend` sand, saturation | 0.644 | **0.586** |
| `bend` shaded wall, B/G | 0.790 | **0.839** |

### The first reading of that was false twice over, and both traps are cheap

It said the floor went to hue 254 at B/G 1.31 with its fill level nearly doubled. That would
have been a large win. It was two separate errors, either of which alone was enough.

It **compared two sessions two and a half hours apart.** The fill-only frames sit at V 0.11 to
0.24, far enough down the toe that any tone work landing in between moves the hue by more than
this term does — and System 7 shipped a highlight shoulder and a silhouette gate inside that
window. A term whose own delta is 1.02x in luminance cannot double a level, and noticing that
arithmetic is what prompted the check.

And the **capture was corrupt**. Looking at the frame — which is the insurance System 5
recommended after producing a self-consistent set of wrong numbers the same way — the wash floor
renders as pale lavender with its ground texture gone and red debug stripes across it, from
another agent's uncommitted edit to `terrain.js` or `rock.js`. Nothing in the metrics flagged
it, because the saturation of a lavender floor is a perfectly well-defined number. `#noastern`
now reproduces the pre-change figures to three decimals, so the pair is an ablation rather than
a comparison, and every figure above is same-build.

Guardrails, on `sys4t` against `sys4r` from before any of this: lit rock saturation 0.620 to
**0.619** at hue **21.0** unchanged, gate 0.211 to **0.211**, floor `grad/L` 0.141 and L 0.368
both unmoved. The positional form is close to free on all three, which the constant was not —
it cost 0.004 of lit saturation, because it was opening a window at 46 m where the geometry
has none.

`tools/_litguard.mjs` explains why it can be free, on the CPU and without a capture: on a face
square to the sun the fill is **4.5% of the light**, and the astern window moves that face's
saturation by **+0.0002** with its hue unchanged to a tenth. Any lit-rock drift larger than
that across these captures belongs to something else — and six commits from other systems
landed between `sys4r` and `sys4s` alone.

### Two hypotheses measured and declined, so they are not retried

- **Aerial perspective inside the fill integral.** The escarpment enters `wallRadiance` as raw
  rock with no extinction and no airlight, while System 5 measures the far landforms in the
  image at 51 and 56% haze — which reads like the same inconsistency, and would have delivered
  a cool term onto exactly the right population. It is not there: `_skydist` puts this skyline
  at **7 to 60 m** over most bearings, where optical depth is under a percent. Only the
  corridor-axis bearings reach 100–220 m, and even those are about 1%.
- **A bluer dome.** `tools/skylut.mjs` puts the sky away from the sun at **B/G 1.39–1.42**,
  which is what Rayleigh's inverse fourth power gives once the slant-path blue loss at this
  elevation is taken out of it — roughly 2.23 in scattering against 0.60 of differential
  transmittance. Ozone is already modelled, Chappuis band and all. The dome is as blue as the
  physics allows and the deficit was never there.

**So System 5's `R_GAIN` does not need to move.** The blue rung the aerial ladder is missing is
a separate question from the shade's hue, and the shade's hue was a geometry error in
`atmos.js`. Their measured constraint — Rayleigh at full strength putting 91% of the zenith's
optical depth in by itself — stays closed, and nothing here reopens it.

### What is left, and it is honest rather than fixable before midday

The shaded wall in `wall_shade` is still warm, and that is **correct for its geometry**: it sits
46 m along, where the astern skyline is 45.7 degrees and the mix is 0.04, and it faces away from
the sun across a corridor whose opposite wall is in full sun at tens of metres. Warm bounce
genuinely dominates its fill, and the critic named that wall's warmth as one of the good things
in the set. The residual warmth on the flanks is the 45 degree escarpment, which is measured
geometry.

**The honest limit is composition, and it is the coordinator's call rather than System 4's.**
Cool shade is available in this scene, but it is a property of the outer walk: the astern skyline
falls past 22 degrees only beyond 120 m, and `sun_gap` at 120 m is the furthest view in the set.
Five of the eight views sit at 46 m or nearer, inside a corridor whose walls fill 45 to 80
degrees of their sky with sunlit red rock, and warm shade there is what correct light transport
gives. If the brief's violet shadows are wanted as a headline rather than as distance, the cheap
way to get them is to **put a viewpoint at 150 to 220 m**, where the mix is 0.95 to 0.99 and the
fill arrives at hue 317. That is a framing decision and it is not one this system should take
unilaterally.

**Not claimed:** floor `grad/L` reads 0.141 against 0.089 across this window and is now inside
its 0.12–0.16 band, but six commits landed between the two captures and `0885589` is explicitly
"clear it of the hf/lf shortfall" in `rock.js`. That improvement belongs to it.

## The ninth viewpoint exists because the camera never visited the cool half of the walk

The astern aperture made the fill's away-from-sun lobe arrive at hue 317 in the outer wash where
it arrives at hue 10 at the head of it, and the immediate question was why no critique had ever
seen that. The answer is where the cameras are. **The eight standard views stop at 120 m and five
of them sit at 46 m or nearer**, inside the stretch of corridor whose walls fill 45–80° of their
own sky with sunlit red rock. Warm shade there is what correct transport gives and it is not going
to be faked. But `tools/_skydist.mjs` measures the up-canyon skyline falling from 80° at 8 m to
about 17° past 160 m, so the cool half of the walk is real, physical, and traversed by the player —
and every verdict this project has received was formed on the warm half. That is a **sampling
failure on our side, not a scene defect**, and the remedy is a station rather than a colour change.

`shade_far`, d 160 yaw −155 pitch −4, now in `tools/views.mjs` so every tool and every critic sees
the same nine. Chosen by looking, over three stations and eleven bearings in `tools/_scout.mjs`,
against a brief of **shaded ground against sunlit wall** — the contrast is the point and not the
shade alone, because a frame of uniformly cool dirt would prove the fill works and say nothing
about whether the warm/cool split reads. This bearing puts shaded floor across the right
foreground with a soft terminator through it, sunlit floor at the left, and a sunlit stratified
wall behind, so the two halves are in one frame and can be compared without remembering another.

Two things the sweep settled that are worth keeping. **Further out is not better**: the outer wash
is wide and its floor is largely grazing-lit, so past about 180 m the shaded fraction falls away
and there is nothing left to contrast against — d 195 on the same bearing is a sunlit frame with a
patch in it. And **the cool shade is not visible looking down-canyon**, because that is into the
sun; the bearings that work look back astern, where a wall shows you its lit face and its own
shadow lies at its foot. The astern aperture mix at this station is 0.945.

## `V` 0.687 was in band, and the band it failed was a log of two old readings

Routed here as an exposure fault on the grounds that an ungraded control cannot be explained by
grading, which is sound reasoning. The reading reproduces exactly — `tools/_p7col.mjs` on
`sys7k_wall_lit` gives **V 0.687 graded, 0.689 ungraded**. The band does not.

`_p7col.mjs`'s footer printed `V 0.589-0.600+`. Neither number is a band. **0.589 is a reading**
from the azimuth-elevation sweep and **0.600 is `sys4c`**, and this document introduces 0.600 in as
many words as *"the first frame in the project inside the 0.59–0.73 reference band"* — so it is
that band's **floor**, quoted back later as its ceiling. The real band is **0.59–0.73, from Sedona
reference photographs**, and it appears four separate times here as exactly that. Both quoted
readings also predate `EXPOSURE` coming down from 1.15 to 0.95, **a fit whose stated success
criterion was putting lit-face V at 0.693 inside 0.59–0.73**. So the footer was asking the renderer
to undo its own exposure fit, and 0.687 sits 0.006 below the number that fit was aiming at.

Measured against the real bands, on the same paired capture:

| figure | graded | ungraded | band | provenance |
| --- | --- | --- | --- | --- |
| lit wall V | 0.687 | 0.689 | 0.59–0.73 | reference photographs |
| lit wall saturation | 0.615 | 0.615 | 0.615–0.626 | earned drift guard |
| lit wall hue | 20.9° | 21.1° | 18.9–21.1° | earned drift guard |
| wash floor V | 0.521 / 0.538 | 0.519 / 0.536 | 0.55 | exposure fit |

**No exposure change, and the arithmetic of the alternative is the argument.** Pulling V from
0.687 to 0.600 is a 0.742× linear cut, `EXPOSURE` 0.95 → 0.705. That would put the lit wall on the
bottom edge of the band it is currently mid-way through, and take the wash floor from 0.521–0.538
down to **0.455–0.470 against its 0.55**, turning a figure that is marginally under target into one
that is clearly under it. Exposure is the one lever that moves everything, so the two guarded
numbers would have gone with it for nothing.

The caution about re-measuring first was well placed and it changed the answer twice. The floor
has genuinely moved since the exposure fit — 0.562 then, 0.521–0.538 now, on the population that
target was written for. And **the first floor figure I measured was 0.737**, because `sat.mjs
--lit` reads the sunlit population while the 0.55 target was written against the whole window. Had
I stopped there I would have reported the floor as 0.19 over target and recommended cutting
exposure hard, which is the same population error as everything else in this section, arrived at
from the opposite direction. Quote the window with the number.

## Instrument retirement: the darkest 40% of the wash floor was never fill

Every shaded figure this project published came from the darkest 40% of a region, and on the wash
floor **that region measures 0.70 sunlit**. Its darkest 40% is therefore grazing-lit dirt with
pebble shadows in it, quoted as though it were skylight fill. That is why the shade read warm and
saturated for weeks in a way no ambient change could shift: the population being measured was
mostly sun. `tools/_fillonly.mjs` is the honest replacement — it zeroes the sun intensities and
the airlight and renders the fill directly, so a shade figure is a shade figure. **Shaded readings
from before it exists should be treated as sunlit readings with a dark percentile taken.**

Two more of my own, both the same failure mode as the band above — a metric being precise about
the wrong thing. I published a fill hue shift as dramatic on a comparison whose two halves were
**captured 2.5 hours apart**, spanning another system's tone-curve work, and whose "after" frame
another agent had rendering **lavender with debug stripes** from an uncommitted terrain edit. Both
errors were in one number and the number looked clean. A cross-session comparison is not an
ablation, and **a frame should be looked at before it is measured**. The structural answer is that
`#noastern` and `#hardshadow` make both terms ablatable inside a single build, so the comparison
cannot span anything.

### What the ninth view measures, and the paired window that makes it a measurement

`shade_far` carries the only **paired** window in the region tables: `floor shade` and `floor lit`,
both on wash floor, one in fill and one in sun. That pairing is the whole value of the station.
Identical albedo either side means every difference between the two rows is light transport and
none of it is pigment — which is the control that no single-window shade figure in this project has
ever had. Added to `sat.mjs`, `hue.mjs` and `grad.mjs` with the same crops in all three.

Measured on `s4v_shade_far`, shipped pipeline, 1600×900:

| figure | `floor shade` | `floor lit` | reads as |
| --- | --- | --- | --- |
| hue median | **4.1°** | 21.3° | 17.2° of separation on one albedo |
| hue q25 | **−3.0°** | 18.4° | a quarter of the shaded floor past red into magenta |
| B/G | **0.888** | 0.631 | the fill is far bluer than the sun |
| saturation | 0.641 | 0.627 | shade holds its pigment |
| V | 0.131 | 0.642 | |
| grad/L | **0.124** | 0.120 | structure survives the fill |
| hf/lf | 0.51 | 0.55 | |

Two things worth reading off this. The brief's **"purple shadows in the crevices" is now a number
rather than an impression**: hue median 4.1° with the lower quartile at −3.0° means a quarter of the
shaded floor has wrapped past red into the magenta quadrant, at B/G 0.888 against the sunlit
0.631. And `grad/L` holds at **0.124 in shade against 0.120 in sun**, both inside the 0.12–0.16
band, so the fill is adding light without flattening micro-relief into wax — the failure mode a
brighter ambient usually buys. `hf/lf` sits at 0.51 against the 0.55 gate on the shaded half, which
is the one figure here under its gate; shade legitimately carries less high-frequency content than
a grazing-lit surface, so this is noted rather than chased.

**No wall window on this view, deliberately.** At 160 m looking astern the near wall's lower face
is in its own shadow and only its top band catches sun, so every crop across it straddled the
terminator and read V 0.35 at a 19-degree hue spread; the one brightly lit rock in frame is the
distant escarpment, which aerial perspective has already desaturated to B/G 0.839 and which is
therefore not a lit-pigment window either. A window holding both sun and shade is precisely the
population error retired above, and the sunlit floor is the better control anyway because it shares
its albedo with the shaded half.
