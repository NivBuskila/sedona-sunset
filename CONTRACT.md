# Sedona Sunset — Build Contract

## Delivery summary

**What it is.** A first-person walk, about 330 m, up a dirt wash between red rock buttes in
Sedona at golden hour. Seven systems — terrain and the wash, the buttes, the juniper, lighting
and sun, atmosphere, sound, post — built and critiqued over several days. **Every mesh, every
texture and every sound is generated in code at page load; there is not one asset file in the
project**, and the only dependency is `three`. That constraint was held completely and it is
the thing this build is proudest of.

**What is genuinely good.** The wall rock is the best surface in the project and a critic
singled it out — `wall_lit` and `sun_gap` are clean at full resolution and `far_270` is the
strongest frame in the set. The arrival works now: the wash heads up into a real box canyon
with a breached apron, a pour-off notch and distant land visible *through* it, where a month
ago it read as "the trail ran out" — and it reads without the player thinking to look up,
because the view eases up twelve degrees over the last forty-five metres out of a budget it
cannot exceed. **The last forty metres now carries the highest wall detail on the route**
— 0.46–0.52 against 0.31–0.39 across the first hundred — where the previous walk measured it
as the softest thing on the route. Colour is measured against real
photographs rather than asserted, and lit rock sits inside its bands on hue, value and B/G. The
`shade_far` station carries the only paired window in the project — the same dirt in sun and in
fill — and the 2.4° of cooling it measures is the best colour evidence in the handoff. The sound
is complete and its quiet is the feature. The corridor holds you without ever being felt: 4.2
minutes of driven wandering, 5.8 m off the centreline, zero frames touched. And the loading
screen means the boot — just under a minute — is a wait rather than a hung tab.

**Closed in the last two days, so nobody re-opens them.** The straight fifty-column skyline
(a reversed path heading, one quad stretched 83 m across the corridor). The streaked `far_320`
headwall and the waxy mid distance, which turned out to be **one defect**: the grit texture
packs a normal in `G,B` and the ground shader read only `R` and `A`. The arrival reading only
if you looked up. Each is written up with the eliminations that found it, and each of those
sections now carries a banner saying it is closed.

**What is honestly still weak.** More than one would like on delivery morning, and none of it
is hidden:

- **Performance is much better than this file said for most of the day, and the difference was
  never the code.** The contract asked for 120+ fps at 1440p. Measured on a machine verified idle
  by SM clock: **about 60 fps walking at native 2560×1440**, and the governor holds native
  resolution rather than scaling down. **120 fps walking is reachable, but only into a reduced
  buffer** — 107 fps at 1997×1123, 123 at 1741×979 — so the brief is met at an upscaled buffer and
  not at a native one, which is said plainly rather than implied. **Every earlier and worse figure
  in this file — 30.5 ms, 37 fps, the descent to 1280×720 — was a contended machine, and the
  bisect plus a paired two-commit control says the frame itself never moved all day.** See
  `PERF.md` §16, and §16.1 in particular: the "unexplained six milliseconds" is closed, and the
  cause was an idle-detection gate that had been calibrated against an already-loaded card. The
  frame is fill-bound, not geometry-bound. One measurement in that
  account is **unexplained and is recorded as unexplained**: the same cell read 16.80 ms in one
  tool and 23.06 in another on the same commit, and neither code growth (a fourteen-commit
  bisect says the frame is flat to 0.83 ms) nor machine contention (23.06 quiet against 23.30
  contended) accounts for it. Two confident causal stories died there in one morning; do not
  quote either.
- **A near-field quilted tiling pattern on rock, and pale flat angular slabs.** **The
  playthrough ranked the slabs the most attention-breaking thing on the whole route**, and they
  are the largest visual item still open. Both are present in the delivery set, both identical
  in the ungraded arm so neither is the grade's, and the slabs read as untextured placeholder
  geometry and are new since the previous build. `hf/lf` measured the quilted floor at a
  perfectly respectable 0.45 — see rule 10, which exists because of it.
- **The juniper leans across a wind that nothing else in the scene blows along.** `juniper.js`
  leans and piles its litter on (0.94, 0.34); the dust, the saltation ribbons and the bed drift
  run off `WIND_HEADING = 0.12` in `atmosphere.js` and `audio.js`, driven live through
  `syncWind()`. Those are **76° apart**. Worse, `terrain.js:1252` documents its `uWind` uniform
  as *"the shared WIND"* and says the other systems "should agree with this; it is exported for
  that" — **which was never true of the shipped build**: nothing outside `juniper.js` ever
  imported it. The export has been renamed `PREVAILING` so the name can no longer imply the
  agreement, but the comment is still wrong and **the two vectors are still 76° apart**. It is
  nobody's mistake in particular and it was too large to start on delivery morning. Fixing the
  comment is a one-line change in `terrain.js`; reconciling the vectors is not.
- **Mid-distance floor detail — much improved, and the remaining limit is a different thing.**
  This was two items ago the second-worst defect on the route and it is now largely closed: the
  head slopes went from 0.16 relative contrast against a 0.38–0.40 strip to **0.2525 against
  0.409**, half the deficit, and the channel floor that read as wax reads as gravel. **The
  honest remaining limit is broad tonal banding from mesh undulation under a 15° sun**, and
  that is geometry — no texture layer can remove it, only put material on it. It is a smaller
  complaint than the one it replaced. The three earlier attempts that were built, measured and
  reverted are still worth reading: the surface is **bounded from three directions** in "The
  wash floor, bounded from three directions".
- **Warm shade in the corridor.** The brief imagined blue canyon shade. What the corridor
  actually delivers is warm shade, and that is **physically correct rather than a defect**: on
  a shaded lateral face the fill decomposes as 47.8% sky, 25.1% escarpment bounce, 27.2% ground
  bounce, and the cool term is already the largest by luminance while losing the chroma fight
  because the warm terms are three times its saturation. The genuine modelling error inside
  that — one occlusion scalar applied to three differently-occluded illuminants — has been
  corrected. What is left is bounded by **crush, not by transport**: the shaded window is only
  44–48% chroma headroom, and the shadow gate at 0.242 against a 0.25 ceiling means the obvious
  remedy of lifting shade is spent. `shade_far` at 160 m is where the scene does produce cool
  shade, and it produces it honestly.
- **Cliff jointing is weaker than real Sedona sandstone.** The vertical joint system exists and
  was measured before anything was added: ablating all four sets moves the lit midwall's
  vertical-to-horizontal line ratio only **0.77 → 0.75**. The termination phase was fixed so a
  joint dies at a different height on each slab, but the walls still read more horizontally
  banded than a real Supai/Coconino face. Wind-scoured **alcoves are not built at all** — a
  genuine gap in the surface vocabulary rather than a defect in what is there.
- **The sun disc is deliberately not visible**, and that is a knowing deviation from a brief
  that asks for it three times. It is not a failure of effort: the disc is already
  geometrically unoccluded in `wash_low` and measures 2.6% contrast against the sky around it,
  and a defined disc requires roughly a 2 km visual range, which is exactly the air that
  flattens the receding ridgelines. The disc and the depth ladder compete for one dial. **Do
  not re-open this by carving a saddle in the skyline.**
- **Smaller, named.** A stipple on wide penumbra edges — this filter's, confirmed by ablation,
  with two published mechanisms both withdrawn and a third recorded as an unverified lead. A
  masonry read on `wall_lit`, accepted as shipped because the same arrises are what make
  `sun_gap`'s wall good. The slopes flanking the wash head are still the softest geometry on
  the route, though they are no longer an outlier — the station that read 0.16 against a 0.409
  mean now reads 0.2525. And **nobody in this pipeline has heard the sound** — every judgement
  on it is from spectrograms.

**Two things to know before quoting anything in this file.** Read **THE PROCESS RULES** below
first; they are fifteen hard-won rules with the instances that earned them, and rule 3 in
particular will stop you quoting a number against the wrong population. And several figures
here were **superseded or retracted**, and are struck in place with a pointer rather than
deleted, because each had already been quoted downstream. If a figure is struck, the pointer
next to it is the current answer. **This applies hardest to the frame-rate figures**: every
"120 fps", "123", "59 fps" and "55 fps" in this file was taken with the camera held, and the
only table to quote is "The delivery table — 2560×1440, RTX 4060, machine gated quiet".

## The governing instruction

> "just do whatever you find good and it should be a great experience for user that's it"

Where a measurement and the experience disagree, **the experience wins.** This project has
proved that repeatedly and expensively: a shimmer that measured too weak and looked like
melting; a soundscape whose quiet scored 8.5 and read as horror; a metric that could not see
the one change that fixed the thing a user pointed at. **At least twelve instruments have now
been caught measuring the wrong thing** — this sentence read "nine" for most of the project
and was overtaken three times without being updated, which is itself an instance of the rule
below that a figure outlives the day it was measured on.

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
- ~~**Performance budget.** Target 120+ fps at 1440p on an RTX 4060 / Ryzen 5 7600X. The
  user games on the same machine, so the running app must not saturate CPU or GPU. Keep
  draw calls under ~150 and triangles under ~3M. Use instancing for anything repeated.~~
  **Struck as a set of numbers, kept as an intent.** The machine and the "do not saturate
  it" clause stand. The three figures do not. The frame ships at **3.97 M triangles** and
  the triangle ceiling was measured to be the wrong axis entirely — removing the far
  ridgelines is worth 0.02 ms of a 30 ms frame, and the frame is fill-bound. **120 fps at
  native 1440p is not reachable on this scene on this GPU** with the camera moving; it *is*
  reachable into a reduced buffer, at 1741×979 upscaled. The shipped figure is **about 60 fps
  walking at native 2560×1440**, with the governor holding native resolution — measured on a
  verified-idle machine, `PERF.md` §16. Figures below 60 elsewhere in this file were taken on a
  contended card. See "Triangles are not what this frame costs" and,
  for the one table to quote, **"The delivery table — 2560×1440, RTX 4060, machine gated
  quiet"** — every earlier fps table on this project was taken with the camera held and is not
  what a walking player gets, and every "120 fps", "123", "59 fps" and "55 fps" figure in this
  file is one of those.

# THE PROCESS RULES — read these before measuring anything

Every rule below was paid for with hours, most of them more than once. They were scattered
through seven thousand lines of this file in the order they were learned; they are gathered
here in the order they are needed, each with the instances that earned it, because a rule
without its instances is an aphorism and this project has a rule about those (rule 7). The
long-form account of each is still in place further down and is worth reading when you hit
the thing it describes.

Rules 1–10 were consolidated the morning of delivery; **11–15 were earned on the last night and
added after**, which is itself the shape of the thing — three of them come from one defect that
took four sections to find because a comment, a gradient band and a utilisation percentage each
pointed confidently at the wrong place.

## Rule 1 — A negative result is only evidence if the thing you removed was doing something

**Diff for liveness before believing an ablation.** Render the ablated frame against the
unablated one and quote the percentage of differing pixels and the mean delta. If the change
is near zero you have not excluded your candidate; you have discovered that your ablation did
nothing, which is a different and much less useful fact.

This is the single most transferable lesson on the project. Six instances, in five disguises:

1. **The anisotropy gate (System 1).** A gate to fade the grit where the footprint ratio
   exceeds ten. The re-render was byte-identical, read as "the fix did not help". It was "the
   gate never fired" — which additionally established that the ratio never exceeds ten in any
   of these framings, so nobody should reach for an anisotropy explanation again.
2. **`shadowMap.enabled` — a compile-time define written at runtime.** `bench.mjs`'s
   `-shadow` column read **0.05 ms of a 30.49 ms frame** for a term that was **23 ms** of it,
   and the number was quoted upward as evidence that shadows were free. Three does not relink
   on a runtime change, so the column measured the same shader twice.
3. **`shadowRadius` — ignored outright by `PCFSoftShadowMap`.** `PCF_SOFT` compiles a fixed
   bilinear-weighted 3×3 over a single texel and never reads the uniform, so the 3.5 and 1.7
   texels these cascades have carried since they were built have never done anything. The
   experiment that widened 3.5 to 10, measured floor `grad/L` unchanged at 0.186 and concluded
   that cast-shadow edges are too small a share of a region to move a nine-pixel high-pass
   **reached a plausible conclusion by a route that proved nothing.**
4. **The wall-rock branch (System 1).** Substituting `gWN` for `mix(gWN, rockWN, rockW)` moved
   1.98% of pixels at a mean of 0.05. That is not an exclusion by ablation, it is an exclusion
   *by construction*: `rockW` is `wallM * (…)`, `wallM` is `smoothstep(0.06, 0.42, vWall)`, and
   that is ~0 on the bank in question. A candidate would have been crossed off having never
   been tested.
5. **The bedform comb.** Two renders went into it on the strength of its wavelengths before
   anyone read the line above it: `bedW` is multiplied by `floorB` and by
   `(1.0 - smoothstep(0.06, 0.20, slope))`, so it is largely off on a bank and was never live
   at the artefact. **Read the gate before ablating the term** — a term's gate is cheaper to
   read than its behaviour is to measure.
6. **`_fillcost`'s applied-flag,** the mirror image: a correct ablation that printed
   `NO — CHECK` beside a real 4.44 ms saving. See rule 2.

**The shape both compile-time cases share, and it is worth recognising rather than
re-deriving: a renderer setting consumed at compile time raises no error when written at
runtime.** It silently keeps the old value, and every measurement downstream is precise,
reproducible and about nothing. Before publishing that a term does not matter, prove the term
moved — drive it to an absurd value and confirm the frame visibly breaks, read back the
compiled program, or dump the define. **A null is evidence only once the independent variable
is known to have varied.**

**The corollary, which is what found the far_270 lattice.** An ablation that *is* live and
still leaves the artefact is a real exclusion, and a strong one. Of the five live ablations
run against that lattice, four excluded a candidate and the fifth found it.

**The structural answer is a flag the shader branches on, which cannot quietly not exist.**
`#hardshadow`, `#noastern`, `#aok=1`, `uJointK` and `uWarpK` all exist for this. `#aok=1` is
the model: at an exponent of one the solve returns `vWall = vSky = ao` and the gain is
`vec3(1)` at every depth, so it is an **exact algebraic identity** rather than an
approximately-inert setting, and running it confirmed the term was inert to the digit.

**And a coincidence that survives arithmetic is still a coincidence.** The sand map's relief
is documented as "a ripple train at a quarter of a metre" and the lattice dots measured about
24 cm. The match was exact, it is the kind of agreement that normally settles a question, and
the ablation came back live at 22.1% with the lattice completely unmoved. The bed spacing
later turned out to be 7.7–25 cm, so the *same* 24 cm matched the true cause as well.

## Rule 2 — A tool that measures nothing must not print a number

Nine instances, so it is a rule rather than an observation:

1. **`grad.mjs`** turned an unrecognised flag into a `NaN` crop, selected no pixels, and
   printed a header with no rows.
2. **`_p7name.mjs`** silently measured nothing when given a mode that does not exist.
3. **`shoot.mjs`** would take an `--only` matching no viewpoint, render nothing, and write a
   manifest with an empty results array.
4. **`_clastprobe.mjs`** would take `--only bogus`, switch off *both* the coarse map and the
   grit, and print a table for a facet with nothing on it.
5. **`_clastprobe.mjs` again, first run**, put every pixel of the facet at 0.95 in encoded
   sRGB, where the curve is nearly flat and every gradient it existed to measure was
   compressed fivefold. **A probe with a free exposure has to be exposed** — check the
   reported mean before reading anything else it says.
6. **`bench.mjs`'s `-shadow` column** printed 0.05 ms for three quarters of the frame. A
   broken ablation with a plausible number attached is this rule and rule 1 at once.
7. **`fillcost.mjs`** printed `NO — CHECK` beside every row *including a real 4.44 ms saving*.
   `customProgramCacheKey` carries the ablation's name, which is what stops fourteen variants
   sharing one compiled program — and it also means each program sits in three's cache from
   block 0 onward, so `onBeforeCompile` never runs again and the applied-flag, read once per
   timing block, kept the *last* block's reading. It now records site counts for the life of
   the run and prints the count rather than a boolean, because **"matched nothing" and "was
   never asked" are different failures that `false` conflates.** *(A cache key that makes an
   ablation measurable also makes the evidence that it applied unobservable on every run after
   the first. And when a warning and a plausible number disagree, find out which is lying
   before quoting either.)*
8. **`settle.mjs`** reports how it exited, on the view's line and in the run manifest, because
   a settle that quietly falls back to its ceiling is a silent under-settle wearing a different
   hat. **A framing that prints `CEILING` is not established as byte-stable and a byte diff
   against it is not evidence of anything.**
9. **`tools/gate.mjs`** runs its anti-empty guards first and, if any trips, the verdict is
   `NO MEASUREMENT`, nothing else is reported, and the exit code is 2 — because a gate that
   passes on an empty measurement is worse than no gate: it is trusted.

**Why this is worse than ordinary sloppiness, and it is specific to this project: an empty or
zero measurement is usually the *interesting* answer here.** It is what a successful ablation
looks like, what a byte-identical control looks like, and what a fixed defect looks like. An
instrument that returns that same answer in response to a typo is producing the single most
misleading output available to it.

`tools/argcheck.mjs` carries `die`, `finite`, `oneOf` and `nonEmpty`; all four exit 2 and name
the mistake. **`nonEmpty` goes immediately before the first number is printed.** It is three
lines to adopt and every probe that takes a flag should.

The general form, and the counterpart to rule 7: **an instrument should be able to fail out
loud. A tool that cannot report that it is wrong is only ever reporting that it ran.**
`tools/_probesplit.mjs` is the shape to copy — it asserts that its three parts close on the
whole to 0.0000% before it prints a single number. That check cost four lines.

## Rule 3 — Population discipline: quote the population, the crop, the threshold and the resolution beside every colour figure

**A number recorded as evidence and read later as a requirement** is the failure mode, and it
has landed nine times. Every one of these figures was arithmetically correct for what it
measured. The recurring shape is not error, it is that **a name travels between tools while
the population underneath it does not.**

| what was quoted | what it actually was | direction of the error |
| --- | --- | --- |
| lit rock 0.687 at 14.6° against 0.615–0.626 | the whole window, not the brightest 40% | false regression |
| `V` 0.687 against "0.589–0.600" | two old readings, the second one a band's *floor* quoted back as its ceiling | false regression |
| wash floor 0.737 against 0.55 | `--lit` sunlit population against a whole-window target | would have cut exposure hard |
| every "shaded" figure, from the darkest 40% | a floor measuring 0.70 sunlit: grazing-lit dirt with pebble shadows | shade read warm for weeks |
| `hf/lf` 0.49 against 0.54–0.75 | 1600×900 against a band derived at photographic resolution | false shortfall |
| lit rock at hue −146.7°, B/G 1.193 | **there was no rock in the frame** — an undeclared uniform failed the link and the fixed rectangle measured the sky behind the hole | routed as a material fault |
| the injury harness firing nothing when all eighteen rock meshes were hidden | all five injuries ran at one framing where the rock was outside the frustum anyway | a check believed to be weak that was merely aimed wrong |
| whole-frame true-black 0.583% → 0.552% | a whole-frame statistic cannot see a localised defect that is a fraction of a percent — the ablation removed *every* hole from `bend` | a real fix read as no fix |
| whole-frame crush 40.8% → 44.4% | the foreground lost a juniper and gained cast shadows while two vegetation files were uncommitted | **a plant leaving frame moved it by more than the fix did** |

**Two of these are two tools sharing a name for different populations**, which is the version
that is hardest to catch:

- **`sat.mjs --lit` against `sat.mjs`.** The flagship figure had two honest answers on the same
  commit — **0.615 at 21°** and **0.687 at 14.6°** — and was nearly routed as a live regression
  on the most-defended number in the project. The axis is the brightest-fraction threshold: the
  unrestricted window includes the oblique and self-shadowed parts of the same wall, which are
  redder and more saturated, so dropping the restriction drags saturation up and hue down
  together. **That is what walks hue six degrees, and it is why neither clipping story could
  account for it** — clipping moves the top of the range, so it moves saturation while leaving
  hue in band.
- **`grad.mjs` and `hf.mjs` measure `ground`'s floor at different distances** — y 0.32–0.58,
  mid-frame, against y 0.80–0.98, at the camera's feet. Different distances, different
  footprints, different surfaces. **Every "hold grad/L while hf9 climbs" statement made about
  `ground` was a statement about two places at once**, and on consistent bands `ground` turns
  out to be under-detailed at *every* distance rather than balanced against a ceiling — a
  different problem with a different fix from the one being pursued. `tools/_band2.mjs` reports
  both metrics over one rectangle and should be the tool for any two-sided target from here.

The **contract population**, in full, because every part of it has now been the ambiguity:
view `wall_lit`; crop the fractional rectangle `[0.30, 0.24, 0.34, 0.34]`; the brightest **40%**
ranked by max channel, after discarding pixels whose max channel is under 12 code values;
statistic the mean per-pixel HSV `(max − min)/max`; either arm, but say which; and quote the
resolution.

Three standing requirements on every tool in `tools/`:

- **Print bands in labelled layers.** *Acceptance bands, from Sedona reference photographs* are
  a different thing from *drift guards, tighter than the photographs, earned rather than
  referenced*. A figure outside layer one is a fault; a figure outside layer two is a change to
  explain. Those are not the same conversation.
- **Never print a historical reading in the position where a limit goes.** That single
  formatting decision cost two false regressions on the project's two most-quoted numbers.
- **Quote the population with the number** — window, threshold, resolution, arm. A tool that
  cannot say which population it measured should refuse.

Two arithmetic traps that ride along with this. **`hf9` is an unnormalised RMS**, so part of a
gap between two framings is exposure rather than surface — `wash_mid`'s near band is 19%
brighter than `ground`'s. Print `hf9/L` beside it for the same reason `grad/L` is printed
beside `grad`. And **a hue angle without its chroma magnitude is meaningless**: hue is an angle
on a circle whose radius is the chroma, and as the radius goes to zero the angle stays perfectly
well defined and stops meaning anything. **Report hue with B/R or B/G beside it, always.**

## Rule 4 — A baseline is a measurement, and it expires

> **Two figures ninety minutes apart in a churning tree are two afters, not a before and an
> after.**

Four instances. The one that earned the promotion **inverted a decision**:

1. **`s4AoTint`.** Measured against a baseline taken ninety minutes earlier, the term looked
   like it cost 0.007 of lit saturation to buy 0.018 of shaded — a bad enough exchange on a
   defended metric that **the recommendation to ship it inert was already drafted.** Run
   against `#aok=1`, an exact algebraic identity in the same tree, shaded saturation came back
   at 0.638 to the digit (confirming inertness) and lit rock read **0.617, not 0.621.** Four
   thousandths of the apparent cost belonged to a `textures.js` edit that landed in between.
   The real price is **0.003 for 0.018, six to one in favour**, and the change was worth
   having. It is also why lit rock sits a thousandth under its band floor at 0.614: **that
   thousandth is the texture drift, not the term.**
2. **`bl1`.** Four hours old and worthless as a baseline once three other systems had committed
   into the window. The `bumpFrom` tilt bound was therefore re-shot back to back against the
   same function with `MAXTILT = 1e9` — an exact no-op, so the pair differed in nothing but the
   bound.
3. **Two captures are not a pair.** An A/B taken as two `shoot.mjs` runs is not matched, and
   with six agents committing it is routinely not even close: the gap is not the ninety seconds
   they render for, it is however long the second waits on the capture lock, which has run over
   an hour. One attempt lost its control to a file rewritten **22 seconds** after the first half
   finished, and the pixel diff reached the bottom of the frame, where the thing being ablated
   could not possibly reach. Another pair differed by 84–92% of the frame. **If a diff touches
   pixels the change cannot reach, the pair is contaminated — check that before believing it.**
4. **The `_fillonly` blue-violet shift**, published as dramatic, was a cross-session comparison
   whose halves were **2.5 hours apart**, spanning another system's tone-curve work, on a frame
   that was also corrupt (rule 5). A term whose own delta is 1.02× in luminance cannot double a
   level, and noticing that arithmetic is what prompted the check.

**Toggle inside one page load instead.** `_farpair.mjs` screenshots twice around a single
visibility flip; `postpair.mjs` freezes `src/` to a snapshot and serves both halves from the
copy; `shadowpair.mjs`, `#hardshadow`, `#noastern` and `#aok=1` do it in the shader. Matched by
construction. **Build the ablation before the measurement, not after an argument about it.**

## Rule 5 — Look at the patch before quoting a number from it

**Two agents nearly published measurements of another agent's debug visualisation.**

1. A `_fillonly` "after" frame rendered the wash floor as **pale lavender with its ground
   texture gone and red debug stripes across it**, from another agent's uncommitted edit to
   `terrain.js` or `rock.js`. **Nothing in the metrics flagged it, because the saturation of a
   lavender floor is a perfectly well-defined number.** The reading was published before it was
   looked at.
2. A second `_fillonly` pair had the wash floor blown to near-white in a fill-only render,
   which is not physical, while `terrain.js`, `rock.js` and `vegetation.js` were **all
   uncommitted**. That time the rule held: the frames were discarded without a figure being
   taken off them.

The rule in full: **look at the frame before measuring it, and check `git status` before
believing either.** It has since paid for itself twice more — it is what caught the near-field
quilting and the pale slabs in the final delivery set, on a floor whose `hf/lf` measured a
perfectly respectable 0.45, and it is the reason that set was stopped rather than shipped.

The converse is just as expensive and has happened three times: **a measurement can be fully
satisfied by something that looks wrong.** The clast grit layer at full normal amplitude turned
a grazing sun into a binary lit/unlit decision per grain, and a binary field has an excellent
one-pixel gradient and a very good `hf/lf` — and looks like pebble-dash. **A metric bounds a
defect; it does not certify a fix.** Every number in this file that moved in the right direction
was also looked at magnified before it was believed, and the ones that were not are in the
failure lists.

## Rule 6 — A statistic that returns the same answer for two populations cannot be evidence about either

The final critic failed the build on shade colour, measured as mean chroma by luminance decile
in the lower 45% of the frame, showing the darkest decile redder and more saturated than the
brightest. **The numbers reproduce exactly.** The disproof was not an argument about tone
curves — it was running the same instrument on **sunlit** dirt in the same window shape:
saturation 0.696 → 0.471 across the deciles, against the shaded row's 0.758 → 0.493, with no
shade in it and 0–5% crush against 98%. Sorting any surface by luminance and reading chroma off
the ends produces "darker is redder and more saturated", because that is what a tone curve does
to a warm-lit red substrate.

> Where a metric is suspected of measuring the instrument rather than the scene, **find the
> population where the effect must be absent and check the metric is absent there too.** That
> is cheaper than reasoning about the mechanism and it is decisive where reasoning is not.

## Rule 7 — An aphorism that explains an observation is not evidence for it

> **Before publishing a mechanism, produce the one number that would look different if it were
> false.** If that number cannot be named, the mechanism is a story about the observation and
> not a finding from it.

The instance. The stipple on the lit patch in `wall_shade` was attributed to a hard early-out
in the blocker search and compressed to: *an averaging kernel degrades to noise of amplitude
1/n; a kernel with a hard early-out degrades to noise of amplitude 1.* That sentence is true in
general, it is memorable, it explained the observation cleanly, and **it is not what was
happening** — the confidence blend it implies was implemented and the artifact was unchanged,
pixel for pixel. The disproof is one line of pixels across the edge:

```
23  25  49  67  46  46  47  47  65  77  66  79  62  77  96  89  103
```

**A continuous ramp with 12–20% noise on it, not a binary flip between two levels — which rules
out amplitude-1 noise on sight.** It cost about four seconds to produce after the fact.

The failure was not the hypothesis; hypotheses are free. It was that **the hypothesis arrived
already phrased as a lesson, and a mechanism that is pleasing to state feels like it has been
checked.** The more quotable a mechanism is, the more it needs a measurement standing in front
of it, because its quotability is doing work that evidence should be doing.

Two aggravating factors, both of which generalise. **The claim was amplified back by the
coordinator as something to keep applying, and that felt like corroboration.** It is not — a
coordinator repeating a claim is the same claim, arriving from the direction that confidence
comes from; nothing about a restatement is independent. And it **overturned a correct prior
note** at `sky.js:640` in favour of a better-sounding one, which is the direction this trap
usually runs, because a new sharp idea always sounds more like insight than an old accurate one.

Note the asymmetry with rule 6, which is the durable part: **that one held because it is a
procedure — go and measure the population where the effect must be absent — while this one
failed because it is an explanation. Procedures survive contact with data; explanations are
what data is for.**

## Rule 8 — Attribution has to reach the triangle, not stop at the mesh

`tools/_pixowner.mjs` named `wallL` as the owner of the "left mesa" pixels in `shade_far`.
**That was true, and it cost four rounds** — a crest-snap diagnosis, a crest fix that measured
nothing, five rim-planting strategies that each measured 0.50 px, and an elegant, correct piece
of physics about end-on skylines being envelopes rather than profiles, applied to an object
that was not a landform. The next question was **which triangle of `wallL`, and how big.**

`tools/_rimtri.mjs` takes the raycast hit's `faceIndex` back through the index buffer and
reports the drawing triangle with its edge lengths. The tell was unmistakable:
**0.99 / 83.04 / 82.76 m in a grid whose columns are 0.62 m apart.** A silhouette drawn across
the middle of one triangle cannot vary however much the crest varies, because there are no
vertices there to carry it.

> **An elegant argument about why something is impossible is worth exactly as much as the
> attribution of the object it is about.**

**The symptom that should send you here first: a silhouette or surface that no parameter change
can move.** Both instances of the domain bug in rule 9 presented that way. If a feature is
insensitive to the parameter that generates it, stop tuning the parameter and ask what geometry
is actually there. Usually the answer is that there is almost none.

The order that works: `_pixowner.mjs` (which mesh — necessary and *not* sufficient) →
`_rimtri.mjs` (which triangle, with its edge lengths) → `_skystraight.mjs` (residual from a
fitted line, on the PNG, in a second, with no `src` import to be blocked by anyone else's
mid-edit file). `_pixowner.mjs` does earn its keep at step one: it settled in a single render
what three rounds of argument from pictures had not, naming `apronL` where the thing looked
like a wall.

Two related cautions from the same round. **`tools/_skyenv.mjs` should not be trusted** — it
bins vertex positions, so its envelope is the envelope of a face's *corners* rather than of the
drawn edge, which against an 83 m triangle is a different object; and it measured *flatness* on
an edge that rises at slope 0.159, so it scored a perfect ruler as unremarkable. And **a
node-side `buildWalls(path, terrain, {})` is not the wall the app draws** — one reported no rock
above y 0 where the running scene has wall at y 46.8. Ask the running scene.

## Rule 9 — A domain-clamped array must be checked at both ends, and a derived accessor must clamp both its samples

This produced **two of the project's most conspicuous defects, independently, from opposite
ends of the same array**, and neither was findable from the picture.

**The shape.** `WashPath.posAt` clamps its parameter into the path's real domain,
`[-11.99, 332.3]` m. That is correct and defensive. The bug is in the *consumer*: a loop that
walks `s` past either end gets the same clamped point back for every iteration, so N columns are
placed on one point, and any lateral offset then fans that stack of coincident columns into a
sheet standing where no landform is. **A defensive clamp does not protect a caller that never
asks whether it is inside the domain — it hides the fact that it is not.** The failure is
silent, because a clamped parametric lookup returns a valid point and the geometry that lands
there is well-formed rather than NaN, so nothing in `nanhunt` or a bounding-sphere check sees it.

| | out-of-domain run | columns stacked | what it produced |
|---|---|---|---|
| far end | `S1 = 356` against `length = 332.3` | 39, at x 0.0, z −319.9 | the **`far_320` ledge** — aprons leaning on the stack met on the axis as a berm 14–16 m high, hiding a 24 m amphitheatre behind it |
| near end | `S0 = -34` against `-sZero = -11.99` | 36, at x 0.0, z 20.0 | half of the **`shade_far` ruler** |

**The second failure mode is worse: a derived accessor clamped asymmetrically.** `headingAt`
differences two `posAt` samples and clamped **only the backward one**, at zero rather than at
`-sZero`. Below `s = -3` the two samples straddled the origin *backwards*, so the heading
reversed — **−177.6° at `s = -34` against a true +5.7°** — through a degenerate
`atan2(0, -0) = 180°` at exactly `s = -3` where they coincide. `cNx = cos(th) * side` therefore
flipped, fifty columns were built on the far side of the corridor, and the single transition
column stretched one quad **83 m** across it at near-constant height. **A derived quantity must
clamp to the same domain as the accessor it is built on, and it must clamp *both* samples**, or
it returns a confidently wrong value in the interior of a range where the underlying accessor is
perfectly fine.

Fixed by `sEndOf(path)` and `sStartOf(path)` in `rock.js`, six metres of margin each, so the end
fades finish on real path rather than on the clamp.

**Why the far end was found first, and the near end took another night.** Nothing frames the
start of the walk. The far end is the payoff shot and a critic described the defect there within
hours; the near end is only visible from a station added late, looking back down-canyon, and
even then it presented as a plausible landform — a "left mesa" with a straight rim — rather than
as an error. **A defect out of frame is not a smaller defect, only a later one.**

## Rule 10 — `hf/lf` is blind to a regular mid-frequency pattern

The newest, found on the final shoot, and the reason the delivery set was stopped.

**A two-band ratio reads a tiling defect as healthy texture**, because the energy is not in the
high band. The `ground` floor measures **0.45 on both arms with the quilted cross-hatch plainly
visible in the frame.** So a tiling defect can be at its worst while every structure figure in
this document looks correct. It was caught only by looking at the frame before measuring it
(rule 5).

Two bounds already recorded that belong beside it, because together they say what this metric
is and is not for:

- **`hf/lf` cannot see *where* energy sits in the spectrum**, only how much there is. Filling
  the 0.4–1.6 m octaves and tripling the bedform amplitude moved `wash_mid` floor `hf/lf` from
  0.59 to 0.59, exactly, while `grad/L` went 0.203 → 0.219 and the octave table moved
  substantially. **Use the octave table for structure questions.**
- **`hf/lf` is resolution-dependent** and the 0.54–0.75 reference band was derived from
  photographs at their own pixels per metre. Byte-identical rock measures midwall 0.49 at
  1600×900 and 0.54 at 2560×1440. Quote the resolution and compare only at equal resolution.

So `hf/lf` remains the right gate for "has this surface gone to wax overall", and the wrong one
for "is the spectrum the right shape", "is this tiling", and any comparison across two
resolutions.

## Rule 11 — A comment that describes the symptom is evidence about the author's intent, not about current behaviour

**And the code most likely to carry that description is the code written to *prevent* it.** Three
instances in one night, all on the `far_320` headwall streaks, all of them pulling an hour each
away from the thing that was actually wrong:

1. **`rill` and `gully` in the height field.** `gully`'s own comment names converging gullies;
   the critic reported streaks converging at the base of a gully. Both ablated — real geometry
   changes, triangle count moved — and both **innocent**.
2. **The triplanar branch**, whose comment reads *"every feature smears into a long streak, all of
   them parallel, and the bank ends up looking brushed"* — the complaint almost verbatim. Painting
   its blend weight into the frame showed **1.0 exactly where the streaks are**. It exists for
   this artefact and it was working correctly.
3. **The 24 cm** that matched the sand ripple wavelength and the bed spacing exactly, and was
   neither. The numeric and the verbal case are one failure.

In all three an observation that discriminated between *categories* was available and was
outranked by one that matched *vocabulary*. Here it was **"no shadow terminator inside them"**,
which says shading rather than geometry before any ablation is run. **Rank the discriminating
observation first; a matching name is the weakest evidence in the room.** The corollary is the
one that cost the most: the real cause was an *absence* — `terrain.js` never read the two
channels `makeGrit` packs the normal into — and **nothing writes a comment about a term that
is not there.**

## Rule 12 — A metric can pass a setting the eye refuses, and when the sun is grazing, terminator crossing is the column to rank

Rule 5's converse, promoted because it recurred with two *sanctioned* guardrails rather than an
ad-hoc figure, and because the round that found it also found which column to trust.

`GRIT_N` at 2.2 was rendered and **rejected by eye on `far_270`** — the mid floor came back as
high-contrast hash with too many fully-dark texels, torn straw rather than gravel. At the same
moment its `grad/L` read **0.1508, comfortably inside the 0.12–0.16 band**, and its RMS tangent
slope was **0.284 against a trap at 0.8**, a third of the way there. Both guardrails passed it.

| `GRIT_N` | RMS slope | past terminator | eye |
|---|---|---|---|
| 1.0 | 0.129 | 0.1% | invisible |
| **1.4 (shipped)** | **0.181** | **1.7%** | gravel |
| 2.2 | 0.284 | 9.7% | torn straw |

**The terminator-crossing fraction is the column that agreed with the eye**, at 9.7% against 1.7%,
and it is the first time it has been the one that did. That is the fourth instance of `hf/lf` and
its relatives being blind to this family — the earlier ones being the pebble-dash grit at full
amplitude, whose binary lit/unlit field has an excellent one-pixel gradient and a very good
`hf/lf`; the quilted floor at 0.45 in rule 10; and the shimmer that measured too weak and looked
like melting. **When the sun is grazing, rank terminator crossing above RMS and above the
gradient band.** A gradient band bounds a defect; it does not certify a setting.

## Rule 13 — Relative contrast and `hf/lf` are both resolution-dependent, so only ratios within one run survive

**Relative contrast is a per-pixel Laplacian and it scales with resolution**, exactly as `hf/lf`
does. A number taken at 1600×900 cannot be set beside one taken at 2560×1440, in either metric.

- `hf/lf`: byte-identical rock measures midwall **0.49 at 1600×900 and 0.54 at 2560×1440**, and
  the 0.54–0.75 reference band came from photographs at their own pixels per metre. That produced
  a false shortfall, which is already in rule 3's table.
- Relative contrast: the walk figures — the head slopes at 0.16, the strip at 0.38–0.40, the same
  station later at 0.2525 against a 0.409 mean — are only comparable because `tools/_walk2.mjs`
  now takes width and height as arguments and both runs were taken at 2560×1440.

**What survives a resolution change is the ratio between stations of one run**, and both of the
walk's headline claims are stated that way for this reason: 0.41 of the route average before,
0.62 after. State the resolution beside the figure, and prefer a within-run ratio to an absolute
whenever one is available. This is rule 3's population discipline arriving on the structure
metrics, and it now applies to every one of them.

## Rule 14 — A point estimate the build can outgrow between commits rots; a bound holds

The loading screen and the README were corrected from a guess to a measurement — **six page loads
at 39–44 s, so "about forty seconds"** — and one hour later the same probe read **49.0 s**, with
`Raising the canyon walls` at 14.0 s (was 11.4) and `Scattering the stones` at 12.5 s: exactly the
two phases that were being worked. Nobody noticed. Both strings now say **under a minute**.

The asymmetry is what makes this a rule rather than a mistake. Under-promising a wait leaves the
reader watching an apparently-stuck screen for the overrun, **which is the precise failure the
loading screen exists to prevent** — so a point estimate is not merely imprecise here, it is
imprecise in the direction that costs the most.

This is the same lesson as the eleven-degree comment in `gate.mjs`: **a figure in prose cannot
notice the thing it describes moving.** The difference is the remedy. Where the premise can be
handed to code, hand it to code — `gate.mjs` now imports `SUN_EL_DEG` and refuses if it differs
from `MEASURED_AT_SUN_DEG`. Where it cannot be checked cheaply, **make it a bound instead of a
point**, and accept the vagueness as the price of not rotting.

## Rule 15 — `utilization.gpu` counts time with any kernel resident, so gate on the memory controller

An animated desktop wallpaper at 60 fps reads **65% utilisation while consuming almost nothing**,
because the field is the fraction of sampled time in which *any* kernel was resident, not the
fraction of the machine being used. **This is precisely why the contention story was so
convincing**: the box showed a 65–100% utilisation floor, six unexplained milliseconds needed a
home, and the two facts appeared to be one fact. A quiet-machine run then measured **23.06 ms held
against 23.30 contended** — 0.24 ms, not 6 — and the story died.

The memory controller separates the cases, and the three readings on this box are worth keeping:

| state | `utilization.gpu` | memory controller |
|---|---|---|
| idle, animated wallpaper | 63–66% | **12%** (max 13) |
| an agent capture running | 88–100% | **16–19%** |
| a game running | 100% | **34%** |

`tools/_regress.mjs` gates the run on the memory controller and prints load beside every number;
`gate.mjs --preflight` exists so the non-GPU half can run at all when the machine is not ours.
The general form is rule 2 wearing a different hat: **a field that returns a high number for an
idle machine is an instrument that cannot report the thing you are asking it about**, and reading
it as though it could is what turned an unexplained measurement into a confident wrong one.

## Performance budget, measured on the target machine

Reference numbers from a comparable Three.js scene on this exact RTX 4060, at 1600×900:
**6.6 M triangles across ~1050 draw calls cost 6–9 ms**, and a ten-pass post chain
(half-res volumetric raymarching, SSAO, bloom, defocus, grade) came to **under 1 ms total**.

Two conclusions, both load-bearing:

- **Geometry is not this project's problem.** At 2.19 M triangles and ~50 draw calls we are
  an order of magnitude inside a budget that scene met comfortably. Do not spend effort on
  LOD or draw-call reduction without a measurement saying otherwise.
  *(The conclusion held and was later measured directly; the count did not. The build ships
  at 3.97 M triangles, 2.25 M of them clast instances — see "Triangles are not what this
  frame costs". Quote 3.97 M, not 2.19 M.)*
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

~~On the flat-face estimator the build has moved 0.514 → 0.344 against a 0.15–0.25 target, so
it is heading the right way and more occlusion is still wanted — **but see the constraint
below before chasing it.**~~

**Superseded. The estimator stands; the reading and the conclusion do not.** 0.344 was a
reading taken while `terrain.js`'s shadow wrapper was still handing shaded banks a phantom
sun, which inflated the ratio project-wide. On the fixed wrapper the gate measures **0.222,
inside the band**, and it has since sat at 0.211–0.242 across the delivery captures. **More
occlusion is not wanted and nothing should be tuned against this number again** — see "The
gate is closed. Stop spending on it." Note also that the gate now depends on System 7's toe:
the ungraded arm reads 0.255, over the ceiling, and the graded arm 0.234. Quote the arm.

## Shadow-to-sunlit ratio: defined in encoded sRGB

The "shadowed rock sits at 15–25% of sunlit" target is **mean relative luminance of the
shadowed region over mean relative luminance of the sunlit region, both read off the
sRGB-encoded PNG** — not linear radiance, and not HSV value.

The reason is that the figure came from critics measuring real photographs with image
tools, and a photograph is encoded. Reading the same scene three ways gives 0.072 linear,
0.30 encoded and 0.45 as an HSV-V ratio; only the encoded number is comparable with where
the target came from. Quote the space whenever quoting the ratio.

The definition above is current and load-bearing. The two readings that followed it are not:

~~By that definition the current build sits at **0.30 against a target of 0.15–0.25** — the
fill is too strong, but by less than the linear reading would suggest.~~
**Superseded — 0.30 was measured through the phantom-sun leak. The gate is 0.211–0.242 and
in band. The fill is not too strong; see "The gate is closed. Stop spending on it."**

~~Separately and unambiguously: the away-from-sun fill is **numerically grey**. Measured
irradiance [0.0294, 0.0300, 0.0330] is a 12% spread, while the brief and every critique
call for violet. A neutral fill on red rock desaturates it, which is its own defect
regardless of intensity.~~
**Withdrawn. The fill is not grey.** That triplet is one normal — the one that averages the
blue dome against the warm ground — and it was additionally inflated by `FLOOR_SUNLIT`. Read
per normal, `tools/fillprobe.mjs` gives B/R **1.93** up-facing (hue 218), **1.29** on a
vertical and **0.62** on an underside: a 3.1× warm-to-cool swing, which is both halves of
what the brief asks for. See "Violet shadows on red rock cannot come from the fill". A single
irradiance triplet is a reading on one normal and must never be quoted as "the fill".

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

**Partly addressed. The wait is unchanged; the black frozen tab is not.** `src/main.js`
now paints a dusk-coloured canvas carrying one line of text and *yields* before any
generation begins, then yields between phases so the line can say which one is running.
The distinction that matters is that the yield is the fix and the paint is not: a message
drawn into a canvas in front of forty seconds of synchronous work never reaches the
compositor, and the tab a person sees is the same black one. Measured on a GPU box at
twelve cores, boot is 40–43 s and the message is on screen at **8 ms**.

**A screenshot cannot measure this and it is worth knowing why.** Six cold loads had been
characterised by screenshot attempts at 5, 10, 15, 20, 25, 30 and 35 s, every one of which
failed — and they still fail with the loading screen working perfectly, because taking a
screenshot is a request to the same blocked main thread. The instrument and the defect
share a bottleneck. What does measure it is a timestamp taken *inside a `requestAnimationFrame`
callback*, since rAF only runs when the browser is producing a frame; `window.__game._boot`
carries that stamp plus the duration of every phase, and `tools/_bootpaint.mjs` reads it.
A grab issued with a long timeout instead of a short one is also served — at the first
yield — and returns the loading screen itself rather than a timeout.

The remaining cost is three stalls that cannot be broken up without restructuring files
other systems own: the wall curtain at 11 s, the clast scatter at 10 s and the terrain mesh
at 8 s. Workers were explicitly *not* attempted; every one of these hands back a live THREE
object built against this context.

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

## Pebble cast shadows: the march is right, the bed is too shallow

The critic: "at this sun angle every pebble on a wash floor throws a shadow one to three
times its own length, and there is not one such shadow in this frame." Measured with
`tools/_rakeprobe.mjs`, which runs the shader's march literally on the real dirt map in
node, 40000 paired probe points, no GL and no render. Three separate questions, and they
have three different answers.

**Reach is correct, and was checked rather than assumed.** The height channel runs 24 mm
peak to peak with an sd of 4.0 mm, so at a 15° sun the tallest thing in the map casts 90 mm
and one sd casts 15 mm. The shipped march reaches 88 mm. A reference march run out to
300 mm at one sample per texel finds **exactly** what 88 mm finds, to four decimals.
**Nobody should ever spend time lengthening it.** This was a live hypothesis — a march
tuned for a higher sun cannot produce a long shadow at 15° however sharp its samples — and
it is a good hypothesis, which is why it needs closing in writing rather than leaving to be
re-raised. It is closed. The march cannot be short for the map, because the map has nothing
further out to find.

**And the near-end fix worked, was free, and changed nothing visible — which is evidence,
not failure.** Geometric spacing is strictly more correct and took shadowed area from 11.6%
to 14.4% for the same eight fetches. Rendered, it moved `ground` floor `hf` from 0.0555 to
0.0557 and `grad/L` not at all. A fix that is right and invisible is the strongest possible
pointer at the real cause: it eliminates the whole class of explanation it belongs to. Both
of these negatives cost one offline probe between them and no renders.

**Sampling was wrong at the near end, and that fix is free.** The tile is 2.54 mm per texel
and the march stepped 11 mm, so its first sample landed 4.3 texels out and stepped clean
over the base of every grain shadow in the field — the darkest, most contiguous and most
legible part of a raking shadow. Same eight fetches, spaced geometrically from 2.5 mm to
88 mm instead of evenly:

| march | shadowed area | mean occlusion |
|---|---|---|
| eight even steps of 11 mm (shipped until now) | 11.6% | 0.0521 |
| eight geometric, 2.5 → 88 mm | **14.4%** | 0.0553 |
| thirty-five even steps, same 88 mm reach | 15.3% | 0.0598 |
| one hundred and twenty steps out to 300 mm | 15.3% | 0.0598 |

So eight geometric steps buy 92% of what a dense march finds, for eight fetches instead of
thirty-five. Landed.

**And the thing that actually caps it, which is none of the above.** The bed is too shallow
for its own feature size. Grains that read 30–60 mm across in `ground` sit on a height
field with 4 mm of sd, so a typical grain stands 4–8 mm proud and casts 15–30 mm — a shadow
shorter than the grain is wide, which is precisely "matte ellipsoids with no cast shadows".
No march can fix that; it is not there to be found. What the depth is worth, holding the
march at eight geometric fetches and scaling its reach with the relief:

| relief | shadowed area | mean occlusion |
|---|---|---|
| as shipped | 14.4% | 0.055 |
| ×1.5 | 23.4% | 0.093 |
| ×2 | 31.2% | 0.125 |
| ×3 | 42.3% | 0.171 |

A real wash floor under a 15° sun is somewhere in the ×2 to ×3 rows, which is also what the
critic's "one to three times its own length" implies. Two people reaching the same number
from photographs and from a height field.

### It was then built at ×1.5, captured paired, and reverted — and it did not fail the way anyone expected

The depth cannot be changed by scaling the height array: `packARM` renormalises the channel
to its own min and max, so a deeper `h` produces a bit-identical texture. Depth lives
entirely in the two constants that *interpret* the channel — the normal map strength in
`makeDirt` and `uSunRise` in `terrain.js` — which must agree or the bed's shadows and its
shading describe different surfaces, and nothing would report it. Those are now one
exported value, `DIRT_RELIEF_K`, with the march's reach derived from it.

Paired capture, both sides at commit `460acdd`, `ground` / `wash_mid` / `far_270`:

| | grad/L ground | grad/L wash_mid | hf/lf ground | hf/lf wash_mid | L mean ground |
|---|---|---|---|---|---|
| K = 1.0 | 0.151 | 0.160 | 0.47 | 0.58 | 0.368 |
| K = 1.5 | **0.172** | **0.192** | 0.47 | 0.57 | 0.362 |

**It is not the binary-field trap.** `hf/lf` is unchanged to two decimals in all three
framings, which is a flat contrast scaling and not the spectral shift that trap produces;
mean luminance barely moves; and the patch looks *better* — more pebble definition, no salt
and pepper. The pre-measurement predicted this: the terminator-crossing fraction goes 7.8%
at K=1 to 13.1% at 1.5, with RMS tangent slope 0.452 to 0.678, and the trap is on record at
"a tangent slope near 0.8". 1.5 is under it. ×2, at slope 0.904 and 18.0% past the
terminator, is over it and should not be tried without re-running the probe.

**It failed on `grad/L` leaving the 0.12–0.16 reference band, and that is a real failure**:
it means the floor carries more one-pixel gradient than a photograph of the real thing. The
transfer is linear at about 0.042 of grad/L per unit K, so the band admits **K = 1.21 at
most**, worth roughly 18% shadowed area against the 31–42% a real wash floor has. Reverted
to K = 1.0, which emits the literal `1.66300` for the march ratio and multiplies the other
two constants by exactly 1.0, so it is a provable no-op rather than a measured-small one.

### The actual result: the gradient budget is misallocated, and scaling cannot fix that

This is the useful finding and it explains why the surface has resisted five rounds. Our
floor sits at the **top** of the grad/L band while its 9-pixel high-frequency energy is
0.056 against a real arroyo photograph's 0.115–0.137 — **half**. So the frame is already
spending a photograph's entire one-pixel gradient budget, and spending it at the finest
scale on grit, where a photograph spends it at pebble scale on cast shadow. Scaling the
relief raises both bands together, so it runs out of budget long before the pebble band
arrives — which is exactly what the paired capture measured.

The move that works is therefore a **rebalance and not a multiplier**: take contrast out of
the sub-pixel grit and put it into pebble-scale relief, so grad/L holds while hf9 climbs.

### Correction: hf9 was misquoted above, and the corrected figures change the target

The "0.056 against 0.115–0.137" in the paragraph above is wrong and the error is worth
naming because a whole round of work was scoped from it. 0.056 is `grad.mjs`'s **one-pixel
gradient**. `hf9` is a different statistic — RMS of a 9-pixel box high-pass, from
`tools/hf.mjs` — and it is reported per horizontal band, which on a floor framing means per
distance. Measured properly on the same captures:

| view / band | reference | K = 1.0 | K = 1.5 |
|---|---|---|---|
| `ground` near | 0.075–0.094 | 0.0748 — at the floor | 0.0893 |
| `ground` mid | 0.115–0.137 | 0.0895 | 0.1057 |
| `wash_mid` near | 0.075–0.094 | **0.1128 — 20% over** | 0.1300 |
| `wash_mid` mid | 0.115–0.137 | 0.0715 | 0.0736 |
| `far_270` mid | 0.115–0.137 | 0.0572 | 0.0592 |

So the near field is at or **above** the photographic reference everywhere, not at half of
it. The mid field is short everywhere and barely responds to relief at all — 3% on
`wash_mid` and `far_270` against 18% on `ground` — which is exactly what the melt probe
already predicted: at 30 m the shading normal is 0.0061 of RMS tangent slope before the
grainF fade and 0.0010 after, so **no texture change can matter there because no texture
arrives**. The mid-field shortfall is not reachable from the dirt map at all.

### The rebalance was then built, swept offline, captured, and reverted

`makeDirt` now takes a `BED` weight per band — `fines` and `grit` are the 6–16 mm features
that land at one to four pixels in `ground`, `coarse` is the 40–94 mm class that lands at
nine and up — all defaulting to 1.0 as exact no-ops. `tools/_bedbalance.mjs` sweeps them
against a simulated near-field render and reports both metrics plus the terminator guard.

**The predictor was validated before it was used, and half of it failed.** Against the
K = 1.5 capture it predicted hf9 within 4.3 points but over-predicted grad/L by 2.11×. The
reason is structural and worth keeping: the simulation shades from the height map alone,
while the real one-pixel gradient also carries albedo mottle, the grit layer, the rake term,
the ripple and lineation shadows and the instanced clasts, all of which dilute a change to
the normal field. Its hf9 column is a usable ranking; its grad/L column is divided by that
measured over-response and treated as indicative only.

Best safe candidate — `fines` 0.5, `grit` 0.6, K = 1.5, chosen because the higher-hf9 rows
ran to RMS tangent slope 0.787 and 0.819 against the trap's recorded 0.8. Captured:

| | `ground` grad/L | `ground` hf9 near | `wash_mid` grad/L | `wash_mid` hf9 near |
|---|---|---|---|---|
| baseline | 0.151 | 0.0748 | 0.160 | 0.1128 |
| rebalanced | **0.156** ✓ | **0.0804** ✓ | **0.177** ✗ | 0.1281 |

`ground` did exactly what it was supposed to: grad/L stayed in band and hf9 climbed off the
floor into the reference range. `wash_mid` left the band and the change was reverted.

### The result: no global weighting can satisfy both framings, because they want opposite things

This is the finding, and it is a bounded impossibility rather than a failed tuning.

- `ground` is **under**-detailed at 9 px (0.0748, at the reference floor) and has grad/L
  headroom (0.151 against a 0.160 ceiling).
- `wash_mid` is **over**-detailed at 9 px (0.1128 against a 0.075–0.094 reference, 20% over)
  and has **no** grad/L headroom at all — it already sits exactly on the 0.160 ceiling.

They therefore want opposite changes, and `wash_mid` is about three times more sensitive to
the knob than `ground` is: the same edit moved it +10.6% against `ground`'s +3.3%. Holding
`wash_mid` at or under 0.160 requires roughly zero net change, which means K ≤ 1.0, and at
K = 1.0 with the fine band reduced `ground`'s hf9 falls to about 0.067 — below its reference
floor. There is no setting of a global weight that improves one without failing the other.
Two independent capture pairs give the same linear picture.

**The way out is footprint-dependent amplitude, and it now has a positive justification
rather than only a negative one.** The two framings differ by footprint geometry: `ground`
looks down at the floor with a near-isotropic footprint, `wash_mid` grazes it with a heavily
elongated one. The correct amount of surface detail per pixel depends on how much surface
that pixel covers, and the shader currently applies one amplitude regardless — which is why
one framing is 20% above the photographic reference while another is at its floor. The
variable needed is already in the shader as `aniso`. Note the target is *not* "boost
`ground` and hold `wash_mid`": `wash_mid` should come **down** toward reference at the same
time, which makes this a correction rather than a compensation hack.

Caveat for whoever picks this up: `hf.mjs` bands are horizontal strips of the frame, so
`wash_mid`'s "near" strip is its near floor but may include instanced clasts as well as the
bed. Worth confirming with a tighter crop before tuning against that 0.1128.

## For System 2 and System 4: the occlusion change, and what it does and does not reach

Landed in `terrain.js` at `2548d04`. **System 2: this is the expression to match at
`rock.js`'s `reflectedLight.indirectDiffuse *= tAO`**, so the two surfaces do not diverge.

```glsl
vec3 aoA = material.diffuseColor;
vec3 aoC1 =  2.0404 * aoA - 0.3324;
vec3 aoC2 = -4.7951 * aoA + 0.6417;
vec3 aoC3 =  2.7552 * aoA + 0.6903;
reflectedLight.indirectDiffuse *=
  clamp(tAO * (aoC1 * tAO * tAO + aoC2 * tAO + aoC3), vec3(tAO), vec3(1.0));
```

It is the Jimenez multi-bounce fit. Two properties are why it was chosen over anything
tuned: the cubic evaluates to 1 at visibility 1 and the clamp pins it there, so an
unoccluded surface is **exactly** unchanged rather than approximately; and it is clamped
below by `tAO`, so it can never darken anything. The only pixels it can reach are the ones
being crushed. Both properties are structural, not calibrated, which is what makes it safe
to land on delivery morning without a tuning pass.

**System 4, one result you need before you measure.** On `ao1` (1280×720, terrain change
only, `rock.js` not yet converted):

| framing | min channel < 10 cv | black on all channels |
|---|---|---|
| `wall_shade` | 40.6% | 0.01% |
| `far_320` | 25.3% | 0.00% |
| `wash_mid` | 16.8% | 0.00% |
| `far_270` | 9.5% | 0.00% |
| `ground` | 7.2% | 0.00% |

**`wall_shade`'s 40.6% is essentially your 40.8% and that is correct, not a failure.**
`wall_shade` is rock, so the terrain change cannot reach it — that number should move when
System 2 lands the twin, and if it does not, the fault is elsewhere. What did move is the
all-channel black, from your 6.0% to 0.01%, and that is the terrain's share of it.

Not verified by me, and yours to check rather than mine to assert: whether **lit** surfaces
moved. The change is an exact identity only at `tAO = 1`, and a sunlit surface with
`tAO = 0.8` does get slightly more indirect, tinted toward its own albedo — small, because
indirect is a minority of a sunlit pixel, but not zero. I did not take a paired capture for
it because doing so meant dirtying the tree again for nine minutes and that is what cost
you last round. Lit rock on `ao1_far_270` reads hue 23.8° with `grad/L` 0.151 on the ground
floor, still in band, but that is a single framing at reduced resolution and is not the
measurement you would make.

## far_320: the amphitheatre is built, and the player is standing 20 m short of its rim

> **The defect described here is fixed — see "The arrival, landed: the apron is breached by
> the channel that drained it".** The diagnosis below is correct and the measurement is the
> one that found it, but the section closes with "the specified fix, not landed because it is
> delivery morning", and that is no longer true: the highest point on the `far_320` ray is now
> the headwall at 125 m rather than the 6.4 m mound at 20 m, and `far_270` is unmoved. The
> arithmetic below about the onset being insufficient on its own also held — the landed fix
> subtracts the apron term inside the channel rather than moving the onset.

Measured with `tools/_headlook.mjs`, which marches the ground along the view ray from a
station and reports each sample's elevation angle above the eye. No render. The critic
read the arrival as "a low rounded gravel mound, not a canyon head", and the three
candidate explanations were that the camera is not looking at the head, that the
sun-bearing col lowered it into a mound, or that something is still in front of it. **It
is the third**, and the numbers say so unambiguously.

From station 320 the eye is at z −307.7, y 7.96. Along the view bearing:

| range | ground | above eye | elevation |
|---|---|---|---|
| 20 m | 12.81 | +4.85 | **13.6°** ← the frame is this |
| 55 m | 9.67 | +1.71 | 1.8° |
| 130 m | 36.58 | +28.62 | 12.4° |
| 180 m | 40.80 | +32.84 | 10.3° |

So the profile is a **lip at 20 m**, the pour-off notch cut down behind it at 55 m, and the
real headwall climbing to 40 m beyond 115 m. The headwall is genuinely there and genuinely
24 m of relief — and every bit of it is hidden behind a 6.4 m apron crest twenty metres in
front of the camera, which fills 27% of frame height on its own. The gravel mound the
critic describes is a real object, correctly rendered; it is simply the wrong object.

**Why the lip is there.** `_headRise` ramps the colluvial apron over `smoothstep(-274, -336, z)`
and cuts the pour-off notch over `smoothstep(-332, -374, z)`. Those two ranges barely
overlap, so the apron reaches its crest at about z −328 and the notch only begins to bite
past −332. The channel therefore does not connect: the incision starts on the far side of
the crest it is supposed to have cut. That is not just a composition problem, it is
unphysical — the water that cut the pour-off had to leave through the apron, so the apron
must be breached on the axis.

**The fix, specified and not landed.** Pull the notch's onset upstream so the incision runs
through the apron rather than beginning behind it, and check that the lip drops below the
sight line to the bowl. Arithmetic before anyone spends a render on it: moving the onset to
−306 only takes the lip from 13.87 to about 11.6 m, still 3.6 m above the eye and still
blocking at 10°, so **the onset alone is not enough** and the notch wants depth as well as
reach. Not landed because it is delivery morning, captures are running nine minutes under
contention, and this is iterative landform tuning against a frame that also has to keep
`far_270` — currently the strongest frame in the set at 93.3 median — untouched, and
`far_270`'s station at z ≈ −258 is only fifty metres upstream of any change here.

**A symmetry worth keeping.** The col was deliberately cut on the sun's bearing rather than
the axis, and the note above it says why: "an axial notch misses the sight line by fourteen
metres at the far end." That was right, and it fixed the light. The mirror image is what
bites here — the sun-bearing col is nine degrees off the *view* axis, so light gets into
the bowl and the player's line of sight does not. Checked directly: along the −9° sun
bearing the near rise is 16.4°, higher still. **A landform can be open to the sun and closed
to the eye, and one measurement does not stand in for the other.**

## RULE: a tool that measures nothing must not print a number

*(This is the original write-up. **The rule and its full instance list now live in rule 2 at
the top of this file**, which is at nine instances; the "four" below is the count on the night
it was written. Kept because the reasoning is here.)*

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

*(This is the original write-up. **The rule and its full instance list now live in rule 1 at
the top of this file**, which adds `shadowRadius` — the second compile-time flag — and the
bedform comb's unread gate to the three below.)*

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
from each viewpoint's eye. *(**The sun has since moved.** It ships at azimuth −9°, **elevation
15°** — see "The gate was a geometry problem". Every "shipped" in this section and the two
around it means elevation 11, which was shipped when they were written. The occlusion verdicts
here were also fired from `sundisc.mjs`'s stale `VIEWS` table, four degrees off the real eye;
see "`tools/sundisc.mjs` was raycasting from a camera nobody photographs". The section's
conclusion — that contrast and not geometry is what hides the disc — survives both, and was
re-reached independently afterwards.)* At the shipped azimuth −9°, elevation 11° the disc is in frame
in all four views and blocked in all four — by `butte0` at 469–493 m in the two wash views,
and by `wallL` at **58 m** in `sun_gap` and `bend`. Two different occluders, and the one
guarding the composition view is a near wall, not a distant butte. Candidates, all measured
on the same worktree at HEAD:

| candidate | disc | floor sunlit | floor grad/L | wall sat | wall V | wall grad/L |
|---|---|---|---|---|---|---|
| az −9, el 11 (shipped *at the time*) | blocked, all 4 | 0.735 | 0.180 | 0.615 | 0.589 | 0.132 |
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

> **Two later corrections to this whole section, both load-bearing.** First, **`hf/lf` is
> resolution-dependent**, and neither the render column above nor the 0.54–0.75 reference band
> carries a resolution. The band came from photographs at *their own* pixels per metre; the
> same byte-identical rock measures midwall 0.49 at 1600×900 and 0.54 at 2560×1440. **Quote
> the resolution with every `hf/lf` figure and compare only figures shot at the same one** —
> see "Quote the resolution beside any `hf/lf` figure". This applies retroactively to most
> `hf/lf` numbers recorded in this file, including the sys2g row above. Second, **`hf/lf` is
> blind to a regular mid-frequency pattern**: a two-band ratio reads a tiling defect as
> healthy texture, and the near-field quilting in the delivery set sits on a floor measuring a
> perfectly respectable 0.45. It is the right gate for "has this gone to wax" and the wrong
> one for "is the spectrum the right shape" (use the octave table) and for "is it tiling" (use
> your eyes). Note also that the gate is written as 0.55 here and the band floor as 0.54
> elsewhere in this file; the difference has never been reconciled and is inside the
> instrument's own sensitivity to framing.

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

## System 7 delivery record: `sys7ship` and `sys7px` — the set that ships

Shot at **`9c7d0c4`** with `src/` clean, on the **frame-convergence settle**; every view
converged in 1.7–2.1 s. Tags deleted before shooting, one resolution per tag.

- **`sys7ship`** — 2560×1440, 13 views × 2 arms, 26 frames, manifests log **0** entries.
- **`sys7px`** — 1997×1123, same 13 views × 2 arms, 26 frames, **0** logged entries.

**The buffer question has closed.** On an idle machine the governor now holds **rung 0 —
native 2560×1440, no upscaling** — so `sys7ship` *is* the shipped buffer, and this record is no
longer a bracket around an unmeasured rung. `sys7px` is kept as the second point that proves the
pixel-scale terms hold under a 1.28× resolution change; it is no longer load-bearing for delivery.
The morning's 1997×1123 figure was measured on a contended machine by a quiet-gate that had itself
been calibrated on a loaded card.

**Provenance.** One commit landed between the two shoots and it touched only this document —
`git diff --stat 9c7d0c4..7de1126 -- src/` is empty. Lit rock reads 0.612 / 20.6° in both sets and
0.612–0.613 / 20.7° in both controls, agreeing to 0.001 and 0.1° across the resolution change,
which is far tighter than any source change could produce.

### The three flagged figures: two held, one recovered

| | previous shoot | **this set** | verdict |
| --- | --- | --- | --- |
| shadow gate, graded | 0.237 | **0.234** | eased back |
| shadow gate, control | 0.258 — over by 0.008 | **0.255** — over by 0.005 | dependency holds, no worse |
| graded headroom | 0.013 | **0.016** | recovered |
| lit rock saturation | 0.612 | **0.612** | steady, third shoot running |
| midwall `hf/lf` | 0.50 | **0.53** | recovered |

The gate's dependency on the toe **still holds and has stopped tightening**: the ungraded arm reads
0.255 against the 0.25 ceiling at *both* resolutions, and the toe brings the frame to 0.234. The
0.003 rise that narrowed the headroom last shoot has reversed.

**Midwall `hf/lf` recovering to 0.53 confirms the mechanism rather than contradicting it.** `grad`
has been pinned at **0.0150** across all three shoots while `grad@4` went 0.0283 → 0.0299 → 0.0283.
The high band never moved. The ratio fell and rose entirely on the *denominator*, which is the
clearest possible demonstration of the limitation recorded below: this number tracks spectral
balance, and it moved twice without the high-frequency detail changing at all.

### Colour, with the spread and the clipped fraction beside every figure

| window | graded | control | band |
| --- | --- | --- | --- |
| lit rock saturation | 0.612 | 0.612 | 0.615–0.626 — 0.003 under, **accepted drift** |
| lit rock hue | 20.6° | 20.7° | 18.9–21.1° |
| lit rock V | 0.691 | 0.693 | 0.59–0.73 |
| lit rock q25–q75 | 0.56–0.67 | 0.56–0.68 | spread intact |
| clipped ≥254 / ≥250 | 0.04% / 0.45% | 0.00% / 0.05% | — |
| far rock 270 saturation | 0.468 | 0.472 | — |
| far rock 270 hue | 24.8° | 24.9° | — |

`FAR_COL` was retuned upstream this shoot (saturation 0.601 → 0.628, luminance −4.6%). Far rock at
270 m reads 0.468 against 0.472 in the control — the far-field convergence colour moved, and the
grade's treatment of it did not: a 0.004 separation, the same as the previous set.

### The paired window — the strongest single piece of evidence in the record

`shade_far`'s two windows are **the same dirt**, one in sun and one in fill, each uniform in
illumination by construction — 99% and 100% kept — and both measured whole.

| 2560×1440 | graded | control | the chain |
| --- | --- | --- | --- |
| floor **shade** hue median | **4.3°** | 6.7° | −2.4°, cooler |
| floor **shade** hue q25 | **−3.0°** | 0.0° | past red into magenta |
| floor **shade** B/G | **0.895** | 0.833 | +0.062 |
| floor **lit** hue median | 21.3° | 21.6° | −0.3° |
| floor **lit** B/G | 0.608 | 0.603 | +0.005 |
| floor shade `grad/L` | 0.104 | 0.093 | +0.011 |

The shaded row moves **2.4° cooler** and its lower quartile crosses zero into magenta; the sunlit
row of the same dirt moves **0.3°**. That is the brief's "teal" — shadows cooling, not a global
cyan drift — and its "purple shadows in the crevices", as measurement rather than impression. No
unpaired window can separate those two claims, because a hue difference between two *different*
surfaces is always partly pigment. `grad/L` rising 0.093 → 0.104 says the deepening does not wax
over the micro-relief.

### Banding, edges and structure, both buffers

| | 1440p graded | control | 1997×1123 graded | control |
| --- | --- | --- | --- | --- |
| sky worst run, `sun_gap` | **8** | 42 | **8** | 33 |
| `wash_mid` worst run | **7** | 36 | **7** | 28 |
| step cv | 0.651 | 0.125 | 0.711 | 0.185 |
| flat% | 42% | 94% | 42% | 93% |
| skyline jump median | **68.2** | 86.7 | **65.9** | 80.0 |
| skyline jump p90 | **116.0** | 193.6 | **118.5** | 191.6 |
| intermediate rows per edge | 1.14 | 1.05 | 1.17 | 1.06 |
| midwall `hf/lf` | 0.53 | 0.53 | 0.52 | 0.52 |
| upper wall `hf/lf` | 0.62 | 0.62 | 0.66 | 0.65 |

Black clipping 0.06% graded against 0.01%. Corner falloff 0.995–0.997 on bright pixels, 0.906–0.912
over all pixels including the sky.

## `hf/lf` cannot see periodicity, and more detail can lower it

Two independent failures of the project's canonical surface metric, in opposite directions.
**Neither is a bug in the tool; both are the same structural limitation of a two-band ratio,** and
they are recorded because the gap will otherwise be rediscovered by someone shipping a tiled
surface with a clean number in hand.

1. **A regular mid-frequency pattern reads as healthy texture.** The `ground` floor measures 0.45
   on both arms with a quilted cross-hatch plainly visible in the frame. A band ratio asks how much
   energy is high against low; it does not ask whether that energy is *periodic*. Tiling puts its
   energy in a narrow band at one spatial frequency with a fixed phase, which is indistinguishable
   to a two-band sum from the broadband energy of real grit. **A tiling defect can therefore be at
   its worst while every structure figure in this document looks correct.**
2. **The ratio moves on the denominator.** Midwall went 0.53 → 0.50 → 0.53 across three shoots
   while `grad` sat at 0.0150 every single time. The high-frequency content never changed; only the
   low band did. A falling `hf/lf` therefore does not mean detail was lost, and a rising one does
   not mean detail was gained.

**So `hf/lf` measures spectral balance, not quality, and it is silent on regularity.** Periodicity
needs an **autocorrelation** — a tiled texture shows sharp secondary peaks at the tile pitch, real
grit does not — or a **spectral peak test** against the local noise floor. A band ratio cannot
substitute for either, and no care in choosing the crop will fix it.

Until such a test exists the standing rule is the one that actually caught every defect worth
catching: **look at the frame before measuring it, at full resolution, in the near field.** That
rule has now paid for itself four times and is the reason three sets were stopped rather than
shipped.

## Defects outstanding in the shipped set

All are present **identically in the ungraded control arm**, so none is the grade's, and all sit in
regions no figure in the record covers.

1. **A pale grass plant renders as flat unlit blades, with two detached and floating.** At the right
   edge of `wall_shade`, close to camera and in deep shade, the straw-coloured grass class draws as
   uniformly-coloured cream lozenges with hard edges, no internal shading variation, and no
   response to blade orientation — differently-angled blades share one flat tone. Two blades are
   clearly separated from the plant body and hover against the wall. The blade pixels reach V 0.612
   against a shaded wall at V 0.099. Identical in both arms. At the distances of `juniper` and
   `sun_gap` the same class reads correctly, so this is a **close-range, deep-shade** failure, and
   it is the most likely thing in the set for a critic to name.
2. **The quilted cross-hatch on near-field rock — a recorded decision, still present.** The two
   large boulders in `ground` carry a regular cross-hatched relief that reads as woven fabric.
   Invisible to `hf/lf` per above.
3. **The combed fibre on steep far slopes — a recorded decision, staying.** `far_320`'s slopes read
   as fine parallel striations. Three hypotheses were each falsified by render; the only available
   fallback would strip grain from exactly the faces the far-field detail was added to serve.
4. **The pale corner clasts are improved but still prominent.** Attribution was corrected upstream
   from dust film to lithology — the morning's dust fix was a no-op on them by construction — and
   the transported mix was thinned 0.320 → 0.215. Measured effect in `shade_far`'s corner: the pale
   population went 9.1% → **8.8%** of the crop, saturation 0.364 → **0.371**, and V dropped
   0.859 → **0.796**. The V fall is the real gain: those clasts no longer outshine the sunlit floor
   (V 0.636). They remain large flat plates at roughly half the floor's saturation (0.626).
5. **A single-file row of bright grains hugs the upslope silhouette of each corner slab.** Reads as
   a stippled bead line. Sediment piling against an obstruction is geologically right, but the
   regularity — one grain deep, exactly following the edge — reads as an artifact. Both arms. Minor.

A measurement note that cost real time and generalises: the first check of the dust fix used three
patches chosen by eye, which came back **identical to three decimals** and suggested the fix had
not landed. It had, and a per-pixel difference map showed it lighting up every clast and leaving
the bare dirt between them black. **A patch chosen by eye is not a population** — the same error as
the saturation disagreement, arrived at a sixth way.

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
rescue it either: `high` 31.04 ms, `medium` 24.62, `low` 20.38, `potato` 18.03 — so ~~the
bottom rung of the governor is 55 fps~~, and there is no tier in the ladder that reaches the
brief. *(The 55 was potato at native resolution, which is a setting the governor never selects —
see "A tier is not a rung" below. The conclusion in this sentence survived every correction since
and is the one that stuck, though the numbers under it have all moved up: on a verified-idle machine
the delivery run reads **55 fps moving at rung 0** fenced — about 60 in a live loop — and 176 at the
floor. **120 fps moving is reached at rung 5, 1741×979**, so the brief is met at a reduced buffer
and not at a native one. The figures to quote are in "The delivery table" below.)* The lever is fragment cost and resolution, not vertices. From
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

The frame is **30.5 ms → 15.7–16.9 ms at 2560×1440 on the top tier** and ~~the governor's
ladder reaches 120 fps at rung 4 and 182 fps at its floor~~. Full account in `PERF.md` §9;
what belongs here is the method and the two instrument failures, because both recur.

*(Both figures in that sentence were measured with the camera held, and neither is what a walking
player gets. On a machine **verified idle by SM clock** the same cell is **17.15 ms held and 18.07
moving**, and 120 fps moving is reached at rung 5. The frame did not grow — a fourteen-commit bisect
puts it flat to within 0.83 ms, endpoints interleaved and 0.18 apart, and a two-commit control an
afternoon apart reads 22.22 against 22.05 under one load — so the difference between 16.8 and 23.06
was never the scene. **It was the machine after all**: the run that "gated quiet" at 23.06 was gated
by a threshold fitted to a contended card, so quiet and contended were compared against each other.
Item 1 of "The ladder as a player walks it" has the table. That section adds two more
instrument failures to the two this section names, both of the same kind: an instrument that could
not be pointed at the thing being measured, and a measurement recorded without the conditions it
was taken under.)*

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

> **Superseded. The numbers to quote are in "The delivery table — 2560×1440, RTX 4060, machine
> gated quiet" below.** This table is a true record of `fa8b9ec` as measured, and it is measured
> **with the camera held**, which does not pay the +3.2 ms a walking player pays. That much still
> stands. Two successive explanations for why it reads six milliseconds faster than every later
> measurement of the same cell do not:
>
> - ~~the frame had "grown 6.5 ms at rung 0"~~ — a fourteen-commit bisect says it did not grow at
>   all, flat to within 0.83 ms with the endpoints interleaved.
> - ~~"it was taken before the GPU acquired a 65–100% utilisation floor from other work on this
>   box, which costs another 6 ms and is nothing to do with the scene"~~ — struck as withdrawn on
>   the evidence that a "quiet-gated" run read 23.06 against 23.30 contended. **Reinstated: this
>   was right all along.** Both of those readings were contended, because the gate that passed
>   them had been calibrated against a loaded card. Verified idle by SM clock, the same cell reads
>   **17.15 ms**.
>
> **The gap is closed and it was foreign GPU load.** On the one cell where both tools measured the
> same thing, `bench.mjs` read `wash_mid` at **16.80 ms** and `_regress.mjs` read **23.06** — and
> `_regress.mjs` now reads **17.15** on a machine idle by a gate that can tell. Do not quote the
> growth story, which a bisect killed; the contention story is the surviving one, and it took three
> attempts and a corrected instrument to establish. Note also that this table is
> `sun_gap` per rung while the delivery table's `held` column is `wash_mid`; the spread *between*
> stations is wider than four rungs of the ladder, so do not read the two tables row against row.

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

~~The governor targets 8.33 ms and settles at rung 4, so the shipped experience on this machine
is **120+ fps at an upscaled 1997×1123**, and `#high` pins 2560×1440 at 59.~~ **Struck: those are
held-camera figures and neither survives** — but the *shape* of the struck claim was closer than
its replacements. On a verified-idle machine the delivery run puts rung 4 at **107 fps moving** and
rung 0 at **55 fps moving** (about 60 live). The governor's target is now 60 rather than 120, and it
**settles at rung 0, native 2560×1440** — measured, `PERF.md` §16.3. **120 fps moving is reached at
rung 5, 1741×979**, so the brief is met into a reduced buffer and not at native. Quoting a
scale-1.0 tier row as the fallback is the error the row above documents — and quoting a
held-camera row as the shipped experience is the error this sentence was.

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
instead: **the penumbra moves the 8.33 ms rung by one step** — that budget is reached at rung 4
(low / 0.78) with it and rung 3 (medium / 0.78) without, at the same 1997×1123. So a
terminator that rises over 27 px instead of 3 costs one quality tier at the target framerate
and no resolution. Recorded as a trade, not a recommendation: it is a picture decision.

*(Said "the 120 fps rung" until the delivery run. 8.33 ms is reached at rung 4 only with the camera
held; moving, rung 4 is 15.85 ms and nothing on the ladder reaches the budget. The one-step
conclusion is unaffected — it is a difference between two columns of the same table — but the rung
does not carry that name.)*

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


## The ladder as a player walks it, which is not the ladder above

Everything in the two sections above was measured with `tools/bench.mjs` — loop paused, camera
held, `renderOnce` driven by hand through each rung. A real-browser playthrough then measured the
governor settling two rungs below where that table says it should, unable to climb back, and
spending the first forty seconds at half the target. All three reproduced on an idle machine, and
one of them is much larger than reported. `tools/govern.mjs` is the instrument; `PERF.md` §11 is
the account. **The four things to know before quoting a number from this file:**

**1. The frame did not move 39%. Why two tools disagree about it is unexplained, and this entry has
now been wrong twice.** `bench.mjs` read `wash_mid` at **16.80 ms** on `fa8b9ec` around 05:00 and
**24.48** on `2548d04` around 07:45, and a second instrument in a different page agreed with the
second figure. Both instruments were right; the inference — that the only thing which had changed
between two measurements two hours apart was the code — was wrong. `tools/_regress.mjs` measures
bench's own top-left cell from a detached worktree, and **every source commit in the window reads
22.4–23.2 ms, a spread of 0.83 across fourteen commits**, with the endpoints alternated three times
each and differing by 0.18. **The bisect is the answer to the question and it stands.**

This entry then said the difference was contention; then that it was unexplained. **It was
contention, and the reason the test appeared to exonerate contention is that the gate deciding
"quiet" had been calibrated against an already-loaded card.** The full account is `PERF.md` §16.1;
the short version, measured on a released machine:

| foreign load at boot | same cell, held |
|---|---|
| **sm clock 285–405 MHz**, gpu 18%, mem 31% | **17.15 ms** — actually idle |
| sm clock 2835 MHz, gpu 34%, mem 10% | 22.05 ms |
| sm clock 2835 MHz, gpu 56%, mem 10% | 22.22 ms |
| gpu 63%, mem 12% — the morning's "gated quiet" run | 23.06 ms |

And the code is not the variable, checked rather than assumed: **`2038823` and `d4dac2b` measured
minutes apart under one load read 22.22 and 22.05 ms** — two trees an afternoon of scene work apart,
differing by 0.17. So the bisect stands and extends across the whole day. 16.80 was an idle reading;
17.15 is 16.80 measured again on a machine that is idle for the first time since.

**Gate on the SM clock. Both of the fields this file previously recommended are wrong.** At rest this
card sits at **285–405 MHz** and under any real render work it boosts to **2820–2840** and stays —
unambiguous. `utilization.gpu` alone swung **2–77% inside twelve seconds** in one unchanging state.
And `utilization.memory`, which the paragraph here used to recommend, runs **inversely**: 30–38% at
true idle against 2–14% under a shader load, because an idle desktop's memory traffic is display
scanout and a busy one's is arithmetic. The old advice — "this box rests at gpu 63–66%/mem 12%" —
was written from samples taken while fourteen agent browsers were on the card, and it defined a
contended state as rest.

**The lesson, which is the one durable thing here: a millisecond recorded without the machine's
state beside it cannot be compared with one taken two hours later** — and a *threshold* calibrated
against an unverified normal inherits whatever was wrong with that normal and launders it into every
measurement it gates. This gate was not loose by accident; it was loose because it had been fitted
to the thing it existed to exclude, which is why it survived a fourteen-commit bisect, an explicit
quiet-versus-contended A/B, and two written corrections in this file. Nothing downstream of a bad
gate can detect a bad gate. Three confident causal stories died on this one number; the one that
lived was found by re-deriving what idle looks like with the machine actually idle.

**1b. The indirect-light fix costs 0.6 ms of a 23 ms frame** — priced by paired ablation in one
page load, three runs, with the site count checked so a stale pattern cannot read as a free
feature. The Jimenez cubic is 0.2 and `s4AoTint` is 0.5. Cliff jointing is 0.1 and is gated off at
the station where that was measured, so treat it as a lower bound. **Nothing in the visual work of
that window is worth negotiating**; ALU does not register against this shader's twenty-odd
dependent fetches, which §7 above already established.

**2. A walking player pays +3.2 ms that no bench has ever measured, and it is two things.** Both
cascades redraw only when the rig moves and `bench.mjs` holds the camera still. Suppressing only
the shadow passes splits it: **+0.8 ms is everything else walking does** and **+2.4 ms is the two
cascade redraws**. It does not shrink as the tier steps the maps from 4096/2048 to 1024/512 —
sixteen times less depth for the same milliseconds — so it is the caster walk, not the depth fill,
and the only thing that removes it is not walking them.

**2b. So one of those milliseconds has been taken, at no cost to the picture.**
`renderer.shadowMap.needsUpdate` is one flag for the whole pass, so raising it redrew *both*
cascades — but the grids are quantised at very different pitches, and while walking the fine
cascade moves on nearly every frame while the coarse one, which is four times the map, moves on
about one frame in five and was redrawn on all five. Scheduling them apart takes the redraw penalty
from **+2.43 to +1.43 ms** with held, walk and every pixel unchanged: a cascade is skipped exactly
on the frames where redrawing it would write the same texels, which is the argument the global flag
was already making one level up. **That is a bigger number than the entire indirect-light fix
costs**, so the frame is 0.4 ms ahead of where giving up the picture would have left it.

**2c. For System 4: the eight warnings are gone, and here is the control.** `eba1fc0`'s
`texture2DLodEXT` removes all of them — `tools/govern.mjs --warnonly` reports 8 distinct X3595 at
`eba1fc0^` and **0** at `eba1fc0`, both in the same minute through the same probe, which is the part
that matters since a zero from a probe that has stopped working looks exactly like a zero from a
fix that worked. `--warnonly` also takes `--root` now, so it can be pointed at a committed worktree
instead of a tree with files mid-edit. It bought no measurable frame time, which is the expected
result and not a disappointing one: this is a derivative whose value is *discarded*, not one whose
value is unbounded, so asking for level zero stops the compiler computing something nobody read. It
is not the bug class that produced the grazing lattice. The conditional `getShadowCascade` guess was
not needed — nothing remains to attribute.

**3. `bench.mjs`'s three stations are not the expensive ones.** `wash_mid`, `wall_lit` and
`sun_gap` are all at 46 m or beyond. The spread *between* stations is wider than four rungs of the
ladder: at rung 0, `ground` is 13.9 ms and `wash_mid` is 23.3. Anything tuned on those three
framings cannot say what the walk costs.

### The delivery table — 2560×1440, RTX 4060, machine verified idle by SM clock

> **This is the one to quote, and it replaces the version of this table that stood until the
> machine was released.** That earlier table was taken behind a gate that passed a card at 63%
> foreign load, so every row of it was 26% slow; it is preserved in `PERF.md` §16.1 only as
> evidence. Frozen tree at `d4dac2b`, served from a committed detached worktree so nothing could
> land inside the run, `src/` verified byte-identical to the main tree by tree hash. Pre-launch:
> **sm clock 285–405 MHz — the field that actually decides — gpu 18% (6–37), mem 31%, 37 samples.**
> No game, no other captures, no agent browsers. Frame confirmed real at mean luminance **80.82**
> and **0.32%** clipped, which also matches the morning's figure despite an afternoon of far-field
> and dust-film work landing. Two passes keeping the lower reading per rung: contention is strictly
> additive, so of two readings the smaller is the better estimate of *the scene*. Monotone in both
> columns, per-rung spread printed.

`held` is `bench.mjs`'s own method at `wash_mid` — `d: 46, yaw: 0, pitch: 0` — and is directly
comparable with the table above. `moving` is what a walk pays, and it is the column that matters,
because walking is what the player does. Both include the cascade-scheduling fix.

| rung | tier | scale | buffer | held ms | held fps | **moving ms** | **moving fps** | spread |
|---|---|---|---|---|---|---|---|---|
| 0 | high | 1.00 | 2560×1440 | 17.15 | 58 | **18.07** | **55** | 0.91 |
| 1 | high | 0.88 | 2253×1267 | 14.63 | 68 | **15.89** | **63** | 0.45 |
| 2 | medium | 0.88 | 2253×1267 | 12.33 | 81 | **13.44** | **74** | 0.70 |
| 3 | medium | 0.78 | 1997×1123 | 10.54 | 95 | **11.69** | **86** | 0.95 |
| 4 | low | 0.78 | 1997×1123 | 8.36 | 120 | **9.34** | **107** | 0.93 |
| 5 | low | 0.68 | 1741×979 | 7.10 | 141 | **8.14** | **123** | 0.23 |
| 6 | potato | 0.68 | 1741×979 | 6.59 | 152 | **7.43** | **135** | 0.42 |
| 7 | potato | 0.58 | 1485×835 | 5.55 | 180 | **6.47** | **155** | 1.99 |
| 8 | potato | 0.50 | 1280×720 | 4.92 | 203 | **5.67** | **176** | 0.91 |

**What the user gets, and it is what the README now says.** **About 60 fps walking at native
2560×1440** — 55 by the fenced method above, ~60 by the live-loop measurement below, which is the
better instrument for this question. **120 fps walking is reachable, but only into a reduced
buffer**: 107 fps at 1997×1123 and 123 at 1741×979. So the brief is met at an upscaled buffer and
not at a native one, which is worth saying precisely rather than as a flat failure.

**And the governor settles at rung 0 — native 2560×1440, no upscaling — measured, twice.** A
180 s walk from a cold load descended to rung 4 while the first frames compiled, climbed
4→3→2→1→0 by t=60 s, and held rung 0 for the remaining 120 s. Uncapped it spends 44 s at rung 0
and 40 s at rung 1, stepping down only at the most expensive framings. `PERF.md` §16.3 has the
trace; §15 has the policy, and the prediction it carried — rung 3 or 4 — was pessimistic by four
rungs and is marked as such.

The target change to 60 therefore stands, though the reason it was made turned out to be an
artifact: on contended numbers 120 drove the ladder to the floor, and on true ones it would settle
at rung 4 for 107 fps, which is no pathology at all. 60 is still the better default because it
holds **native** resolution on this card, and a walk whose point is the landscape should not
upscale to buy frames it does not need. `#target=120` restores the old behaviour.

**These figures are a floor, not a best estimate, and that has now been quantified.** They are wall
time across `renderOnce` behind a one-pixel `readPixels` fence, which serialises CPU submit behind
GPU execution where a real loop overlaps them and pays about the larger. Measured at one rung, one
station, one page: `renderOnce` held reads **10.65 ms**, `renderOnce` moving **17.90**, and the
governor's GPU timer around a whole live frame — *more* work — reads **10.66**. A real frame costs
**7.2 ms less** than the fenced measurement of a smaller amount of work. The live figure across a
walk at rung 0 is a GPU median of **16.09 ms, about 62 fps**, which is where the README's "about
60" comes from. `PERF.md` §16.4 has the method, including why an uncapped `fps` counter is useless
here — it swings 138 to 1053 because the CPU loop spins ahead of the GPU.

None of that is a regression. §10's table was accurate when it was taken and the frame has not
grown — see item 1 above, where the 16.80 is now reproduced as 17.15 on an idle machine and the
gap is closed. 3.2 ms of the walk was always invisible to every bench in the project, and 1.0 ms of
that has now been recovered at no cost to the picture.

Rung 8 is new: `RSCALE` gains a 0.50 step. It is worth 0.6–0.8 ms and that is said plainly rather
than implied, because resolution has stopped being the strong lever it was — `@0.7res` takes
`wash_mid` from 24.48 to 17.95, so 49% of the pixels now save 27% of the frame. The rung exists
because a governor whose bottom step is over budget has nowhere to put a struggling machine.

### What the governor does now

**What it targets: 16.67 ms, 60 fps, fixed — and it was 120.** It **settles at rung 0, native
2560×1440**, measured over a 180 s walk twice (`PERF.md` §16.3), holding native resolution for two
thirds of the trace and stepping down only at the most expensive framings when run uncapped.

The change from 120 was made on contended numbers, where no rung reached 8.33 ms and the target
therefore fired the descend rule everywhere and walked the ladder to the floor — 1280×720 upscaled
to a 1440p panel, a soft picture bought for no frame rate. **On idle numbers that pathology does not
exist**: 120 would settle at rung 4 for 107 fps. The general point still stands and is worth keeping,
because it is not obvious — a system whose only lever is picture-for-frame-time, given a frame time
it cannot reach, will correctly give away all of the picture, and every individual decision on the
way down looks right. 60 remains the better default on this card for the simpler reason that it
holds **native** resolution. `#target=120` restores the old target exactly.
**Captures are unaffected**: the harness clause pins `pinned = 0`, `adapting` is false, and
`adapt()` returns before the target is read, so no gate in this file needs re-shooting, and
`bench.mjs` walks the ladder through explicit `setRung()` which never consults it.
`#target=N` overrides it, `#fps=N` caps the loop and
targets that, and every threshold is a multiple of the target so moving it moves the policy
coherently. It is deliberately not inferred from the panel: measuring the refresh period from the
loop's shortest observed interval reads the *scene's* frame time on a vsynced uncapped loop, so a
machine running at 40 fps concludes 40 is the target and never adapts — the governor switches itself
off on exactly the hardware that needs it. The signal is the GPU timer's median where the extension
exists, CPU frame time where it does not, and **nothing at all after a rung change**, which is
handled by returning rather than by falling through to `cpuMs` — that would read submit time as
enormous headroom one frame after a change, which is a climb loop with no brakes. Full policy,
constants and reasoning: `PERF.md` §15.

**Cold start: 2.5 s, was 17.** The governor was accumulating its clock and its holds from
`main.js`'s `dt`, which is `Math.min(0.05, ...)`. That clamp is right for `step()` and exactly
wrong for a governor whose subject is wall-clock slowness: during the compile-heavy first frames a
170 ms frame advanced its clock by 50 ms. First rung change 8.5 s → **1.3 s**, settled 17.0 s →
**2.5 s**. Note that this is *why there is no optimistic start* — the opening is now two and a half
seconds, so starting low would cost a fast machine a climb it does not need.

**The ratchet is gone, and the band was not the thing to widen.** The old rule descended above
`t × 1.15` and climbed below `t × 0.62`, and every rung below 4 cost *between* those two, so a
transient stall degraded the picture until reload. The gate was asking the wrong question: "is
this rung very cheap" rather than "would the next rung up fit", and a rung step is worth 6–20%
here against a 38% headroom demand. The governor now remembers what each rung cost, expires that
memory after 8 s because the player is walking, probes a climb for 900 ms, reverts one step if it
overruns, and puts a failed rung on a 15/30/60 s backoff whose expiry clears the price — so
nothing is closed off permanently. Verified by putting it at the floor and watching: it climbed
8→7→6→5→4→3→2→1 with no oscillation, back where it started after 37 s. **That test had to be run at
`#target=60`**, because at the then-shipping 120 nothing on this tree reaches 8.33 ms, so the
governor correctly sat at the floor and a working ladder was indistinguishable from a broken one.
Having to reach for `#target=60` to see the ladder work at all was the first clue that 120 was the
wrong default; it took another hour to notice that it was also the reason the picture was soft.

**On a contended machine — a game, a stream, a compile — expect it at the floor within a few
seconds**, and expect it to climb back on its own when the other work stops: three seconds of
continuous headroom, then a probe per rung, and backoffs that clear their prices as they expire. No
reload needed. That recovery is the specific thing the ratchet broke. What it cannot do is hide
contention; it can trade picture for frame time and nothing else.

**`#adapt` is new and matters to anyone writing a probe.** `perf.js` pins the top tier whenever
`navigator.webdriver` is set, which is right and is why every capture is deterministic — but it
also meant the governor was the one system in this project that no instrument could observe. Only
`tools/govern.mjs` sets `#adapt`. Do not set it in a capture.

### Thirteen shader warnings, and they are all one loop

`X3595: gradient instruction used in a loop with varying iteration` — 8 distinct on a fresh boot,
13 in the playthrough, the difference being how many programs have compiled. Attributed by
ablation rather than by matching line numbers, because the numbers in those messages are into
ANGLE's generated HLSL: `#adapt` gives 8, `#adapt&hardshadow` gives **0**. Every one is
`src/sky.js:734–739`, the variable-width penumbra spiral, whose trip count `n` is per-pixel while
`texture2D` needs derivatives to pick a mip.

**For System 4, whose file it is.** The fix is one token and is identical by construction — the
shadow map is `NearestFilter` with `generateMipmaps` off, so there is no mip to select and the
derivative is computed and discarded. `texture2D( map, p.xy + o )` becomes
`texture2DLodEXT( map, p.xy + o, 0.0 )`; `three.module.js:6454` defines that as `textureLod`, and
`terrain.js` already uses the sibling `texture2DGradEXT` define at 6457, so the mechanism is live
in this project today. Not done here because `sky.js` was dirty with in-flight work throughout,
and staging a hunk into a file someone else is editing is how `sky.js` got destroyed once already.
It is not the bug class that produced the grazing lattice — that was a derivative whose *value*
was unbounded, this is one whose value is discarded — so it is console noise sitting on a real
one-token improvement, not a correctness risk.
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
| hue q25 | **−3.0°** | 18.4° | ~~a quarter of the shaded floor past red into magenta~~ withdrawn, see below |
| B/G | **0.888** | 0.631 | the fill is far bluer than the sun |
| saturation | 0.641 | 0.627 | shade holds its pigment |
| V | 0.131 | 0.642 | |
| grad/L | **0.124** | 0.120 | structure survives the fill |
| hf/lf | 0.51 | 0.55 | |

Two things worth reading off this. ~~The brief's **"purple shadows in the crevices" is now a number
rather than an impression**: hue median 4.1° with the lower quartile at −3.0° means a quarter of the
shaded floor has wrapped past red into the magenta quadrant, at B/G 0.888 against the sunlit
0.631.~~ **Withdrawn — see "A retraction of my own" below.** At this population's B/R of 0.28 a
negative hue angle is one code value of blue over green, i.e. the dither. What survives is the
**17.2° of hue separation on one albedo** and the B/G split of 0.888 shaded against 0.631 sunlit,
which are chroma-magnitude statements and do stand. And `grad/L` holds at
**0.124 in shade against 0.120 in sun**, both inside the 0.12–0.16
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

### A block comment that closed inside a ternary, and why a known-false red is worse than no check

`glslcheck` reported `src/sky.js:959 unclosed=1` and everyone knew to ignore it. The cause: the
`#noastern` ablation was spliced into the middle of a sentence, so the block comment opened in one
template literal and closed in **both arms of the ternary**. The assembled string was valid and the
shader compiled, so the check was wrong about the outcome — but it was right about the structure,
because no single literal was well-formed.

Worth fixing rather than annotating, for two reasons. **A static check with a known-false failure is
worse than no check**: the whole tree runs `glslcheck` before committing, and this night alone cost
several hours to people trusting a green result or waving off a red one. And the fragility was real
as well as cosmetic — validity rested on an invariant held in two places with nothing enforcing it,
and node cannot see it, because the file parses either way. If an arm ever stopped closing that
comment the result is an unparseable shader, which **does not fail loudly**: it falls back silently
and the capture returns in three's default material. That has cost two seven-minute renders here
and once presented as a phantom colour regression.

The fix removes the invariant instead of documenting it. The astern line is built as a whole string
before the literal and interpolated as `${ASTERN}`, so the comment lives entirely inside one
literal and the arms hold no comment text — they cannot stop closing something they do not contain.
`glslcheck` exits 0 across `src/*.js`. **Generalises: never let a comment span a template-literal
boundary or a ternary arm.** Interpolate a finished line instead; the check is per-literal and
cannot reason across the concatenation.

Verified on paired same-build captures, since this touches the shipping path. Frame statistics are
identical (`sky=153.1 gnd=56.8`, `lum med=24 p99=214`), and every figure on the paired window
matches to three decimals — `floor shade` hue 4.1° at B/G 0.888, `floor lit` 21.3° at 0.631,
`grad/L` 0.124 and 0.120 — with zero logged errors in both manifests. The arm that changed most is
the ablation, so it was shot as well, and **it still ablates**: `#noastern` takes the shaded floor
from B/G 0.888 to 0.818 and its hue q25 from −3.0° to 0.0°, while moving the sunlit floor by 0.008.
A flag that compiled to nothing would have read identical, which is the failure this whole section
is about.

## Arbitrating the final critic's shade-colour finding: the statistic is an artifact, the complaint is real

The critic failed the build at 5.3/10 with shade colour as finding 1 in all thirteen frames, measured
as mean hue, saturation and B/R in the lower 45% of a frame by luminance decile, showing the darkest
decile redder and more saturated than the brightest. **The numbers reproduce, the reading of them does
not survive a control, and the underlying complaint is nevertheless correct.** All three of those are
true at once and they have different owners, so they are separated here.

### The numbers reproduce

`tools/_decile.mjs` on `sys7final_wall_shade`, lower 45%, the critic's own instrument:

| decile | hue | sat | B/R | V | mean min channel | under 10 cv |
| --- | --- | --- | --- | --- | --- | --- |
| darkest 10% | 7.4° | 0.857 | 0.162 | 0.083 | **2.9 cv** | **100%** |
| 10–20% | 8.1° | 0.754 | 0.255 | 0.120 | 7.3 cv | 76% |
| 50–60% | 18.6° | 0.683 | 0.317 | 0.536 | 42.7 cv | 0% |
| brightest 10% | 30.9° | 0.485 | 0.517 | 0.815 | 107.2 cv | 0% |

Against their 7.1°/0.85/0.153 and 29.1°/0.49/0.514. This is not a measurement dispute.

### The control says the statistic is not about the illuminant

The two right-hand columns are why the instrument cannot support the conclusion. **HSV saturation is
(max − min)/max, and both terms misbehave near black**: a pixel at R 20 cv, B 1 cv reads saturation
0.95 whatever light produced it, because blue has run out of code values rather than because the
illuminant was red. `tools/hue.mjs` has excluded V < 0.06 for exactly this reason since the day it
was written. In the darkest decile the mean smallest channel is **2.9 code values** and every pixel
is under ten.

The decisive test is the `shade_far` paired window, because both rows are the same dirt:

| | darkest 20% | brightest 20% | crush |
| --- | --- | --- | --- |
| `floor shade` — fill only | hue 1.1°, sat 0.758 | hue 1.3°, sat 0.493 | 98% → 2% under 10 cv |
| `floor lit` — **sun only** | hue 14.7°, sat 0.696 | hue 30.1°, sat 0.471 | **5% → 0%** |

**Sunlit dirt shows the same gradient at the same magnitude with no shade and no crush in it**
— saturation 0.696 → 0.471 against the shaded row's 0.758 → 0.493, on 0–5% crush and a smallest
channel running 29 to 112 code values. Sorting any surface by luminance and reading chroma off the
ends produces "darker is redder and more saturated", because that is what a tone curve does to a
warm-lit red substrate. A statistic that returns the same answer for a sun-only population as for a
fill-only one is not evidence about either illuminant.

### But the complaint underneath it is correct, and this part is ours

Analytically, in scene-linear, no encoder involved — `tools/_litguard.mjs`, one face, one albedo:

| | hue | saturation |
| --- | --- | --- |
| sunlit | 17.3° | **0.785** |
| same face shaded | 4.5° | **0.468** |

**Physics says shade should be forty percent less saturated than sun, which is precisely the
critic's point.** The render delivers the two populations at roughly equal saturation — 0.63 lit
against 0.64 shaded as window means. So the desaturation that skylit shade is supposed to have is
not arriving, and saying "the metric is an artifact" does not dispose of that.

The cause is **level, not chroma**. The shaded floor sits at V 0.099–0.193 with its smallest channel
between 6 and 24 code values. On `sys7final_wall_shade`, **40.8% of the frame has its minimum channel
under 10 cv**, 18.9% is under 10 by luminance — the critic's 13.5% is the same family — and 6.0% is
black on every channel. The shade's true colour, hue 4.5° at saturation 0.47 and linear B/R 0.67,
needs blue somewhere near 20 code values to be expressible. It has six. **The chroma is not wrong;
there is no room left to put it in.**

### A retraction of my own

I reported the `shade_far` shaded floor at hue q25 −3.0° and called a quarter of it "wrapped past red
into the magenta quadrant", offering it as the brief's purple shadows made measurable. **That was
over-read and it is withdrawn.** At B/R 0.28 a negative hue angle is one code value of blue over
green — it is the dither pattern, not a pigment. The critic is right that it does not read violet,
and right about why in substance if not in mechanism: there is no blue signal to see. Hue angle
requires a chroma magnitude to be meaningful and I quoted the angle without the magnitude, which is
the same error as quoting saturation without the clipped fraction.

### The critic's two findings are one defect, not a contradiction

Finding 1 says shaded surfaces are too warm and too red. Their missing-qualities list says at number
2 that the opposite shaded wall should be *drenched in orange reflected light* and that here "shaded
walls just go black". Those look mutually exclusive and are not. **Both are symptoms of an
underfilled shaded wall.** Raising the fill lifts the minimum channel off the quantisation floor,
which *lowers* measured saturation and lets the 13° hue offset appear; and it simultaneously gives
the wall the visible bounce-lit form that finding 2 is asking for. The instinct that the two
illuminants need to be more **separated** rather than the shade uniformly cooler is the correct
reading: separation is currently being destroyed by the encoder floor, not by the transport.

### The gate and the crush are both right

Raised as a contradiction — the gate says 0.211 in band while 13.5% of the frame is under 10/255.
**Neither is wrong. A mean ratio cannot constrain the bottom of a distribution.** Measured on the
frame: lifting every pixel whose maximum channel is under 10 cv up to 20/11/7 cv moves the region
mean by **1.3%**, taking the gate from 0.211 to **0.214** — still mid-band. So the entire crushed
tail can be fixed without the gate noticing, and the gate never had anything to say about it.

### What this makes the fix, and what is not yet proven

The leading candidate is `reflectedLight.indirectDiffuse *= tAO` — `src/rock.js:2602` and
`src/terrain.js:2670`. A geometric occlusion term multiplying indirect light to zero is not physical:
an occluded crevice is still lit by its own walls, and for red sandstone that inter-reflection is
warm, which is the orange bounce the critic is asking for by name. A multi-bounce occlusion curve
tints toward the surface's own albedo instead of toward black and never crushes, so it lifts exactly
the pixels that are crushed and leaves open surfaces alone. **This is not yet measured**, because the
instrument for it is a fill-only render and that could not be run — see below. It is a candidate with
a mechanism, not a result.

## The floating slab is not floating, is not a penumbra, and the stipple is mine

Looked at rather than raycast this time, which was the right instruction. `tools/_crop.mjs` cuts the
critic's own coordinates out of `sys7final_wall_shade` at 4x, nearest-neighbour, because a defect
described as stippled is a per-pixel pattern and any smoothing filter destroys the evidence.

**It is the wall.** The patch carries the wall's own bedding planes, and they are continuous with the
strata either side of it — the same laminae enter the bright region and leave it at the same heights.
The two smaller instances in `bend` settle it: one sits exactly along the top of a bench, the other
down the edge of a buttress. **Those are grazing sun catching the tops of ledges on an otherwise
shaded wall, which is correct, and it is a real Sedona look.** There is no floating quadrilateral and
nothing is lit that should not be. The earlier raycast conclusion was right about the geometry.

Two things are wrong with it anyway.

**The stipple is a defect and it is mine, at `src/sky.js:700`.** The blocker search is twelve taps on
a golden-angle spiral rotated per pixel, followed by `if ( cnt < 0.5 ) return 1.0;`. At the outer
boundary of a penumbra the occluder covers only part of the search disc, so **whether any of twelve
taps lands on it is decided by that per-pixel rotation** — and the consequence of missing is not a
slightly-lighter sample, it is an immediate hard return of fully lit. A binary per-pixel decision
driven by a hash is salt-and-pepper, which is exactly what the critic describes and exactly which
edges carry it: stippled where the occluder is sparse across the search disc, smooth where it is
dense. The comment at line 640 anticipated undersampling as *"noise at the 1/n step rather than
concentric rings"* and that reasoning is sound for the filter loop, which averages; it does not hold
for the search loop, which early-outs. **An averaging kernel degrades to noise of amplitude 1/n; a
kernel with a hard early-out degrades to noise of amplitude 1.** Widening the penumbra from 3 px to
27 px did not cause this and did not fix it; it enlarged the region over which it is visible.

The fix is a confidence blend on `cnt / 12.0` in place of the hard early-out, so the outer boundary
fades rather than flipping. It is a few instructions and it touches shadow values, so it needs a
paired capture to clear the gate and lit rock — which is why it is not in this commit.

**And it reads as floating because the wall around it has no tonal information.** 40.8% of that frame
has its smallest channel under ten code values and 6.0% is black on every channel. A correctly lit
ledge top against a wall carrying no form at all is a bright shape on a void, which is what a
floating slab looks like. This is the same defect as the shade-colour finding above, and fixing the
crush does more for the slab's appearance than anything done to the shadow filter — including the
penumbra work already landed.

## Two frames discarded, and the instrument that could not be run

`tools/_fillonly.mjs` is the right instrument for every open question above and it could not be used.
The pair it produced has the wash floor blown to near-white in a fill-only render, which is not
physical, and the tree explains it: **`src/terrain.js`, `src/rock.js` and `src/vegetation.js` were all
uncommitted while it ran.** The frames were discarded without a figure being taken off them.

That is the second time this exact trap has caught this work — the first cost a published reading on a
frame another agent had rendering lavender with debug stripes. The rule that came out of it held this
time: **look at the frame before measuring it, and check `git status` before believing either.** The
arbitration above therefore rests only on things that cannot be contaminated — `sys7final_*`, which is
System 7's committed delivery record and the frames the critic actually judged; `s4w_shade_far`, whose
figures were verified identical to a predecessor capture; and `_litguard`/`_coolshade`, which are
analytic and render nothing. **Nobody can produce a same-build verification of a shaded-surface change
until those three files land.**

## Two rules from the shade arbitration, stated so they are findable

**Quoting a hue angle without its chroma magnitude is the same error as quoting a saturation without
the clipped fraction beside it.** Hue is an angle on a circle whose radius is the chroma; as the
radius goes to zero the angle is still perfectly well defined and means nothing. I published "a
quarter of the shaded floor has wrapped past red into the magenta quadrant" off a hue q25 of −3.0°,
and it was repeated upward as the brief's purple shadows made measurable. At the B/R of 0.28 that
population actually carries, a negative hue angle is one code value of blue over green — it is the
dither pattern. `tools/hue.mjs` has excluded V < 0.06 for this reason since the day it was written;
the same discipline applies to the chroma radius and not only to the value. **Report hue with B/R or
B/G beside it, always.**

**A statistic that returns the same answer for two populations cannot be evidence about either.**
The final critic's shade finding was mean chroma by luminance decile, and the disproof was not an
argument about tone curves — it was running the same instrument on sunlit dirt in the same window
shape and getting the same gradient at the same magnitude, with no shade in it and no crush. Where a
metric is suspected of measuring the instrument rather than the scene, **find the population where
the effect must be absent and check the metric is absent there too.** That is cheaper than reasoning
about the mechanism and it is decisive where reasoning is not.

## Retraction: the stipple is mine, and neither mechanism I published for it survived

The ablation is clean and it is worth stating first, because it is the one part of this that held.
`#hardshadow` on the same tree, same frame, same crop: **the lit patch has perfectly hard edges and
no stipple whatsoever.** With the PCSS filter on, it stipples. So the artifact is unambiguously this
filter's, which is what the earlier entry claimed and remains true.

Everything published about *why* was wrong, twice.

**Withdrawn: the hard early-out mechanism.** I attributed the stipple to `if ( cnt < 0.5 ) return
1.0;` after the twelve-tap blocker search, on the reasoning that whether a tap lands on a sparse
occluder is decided by the per-pixel rotation and the cost of missing is a full-amplitude flip. From
that I generalised: *an averaging kernel degrades to noise of amplitude 1/n; a kernel with a hard
early-out degrades to noise of amplitude 1* — and asserted that the line-640 comment had reasoned
correctly about the filter loop and misapplied it to the search loop. **It is a good sentence and it
is not what is happening here.** I implemented the confidence blend it implies and the artifact was
unchanged, pixel for pixel. The measurement that should have preceded the claim: luminance across
the stippled edge runs 23, 25, 49, 67, 46, 46, 47, 47, 65, 77, 66, 79, 62, 77, 96, 89, 103 — **a
continuous ramp with roughly 12–20% noise on it, not a binary flip between two levels.** A
continuous ramp rules out amplitude-1 noise on inspection, and one line of pixel values would have
said so before any of it was written down. The original line-640 comment was closer to right than my
correction of it.

**Withdrawn: within-pixel tap count.** Second attempt, that the noise is the filter's own 1/n with
`n` sitting on its floor of 8 — arithmetically plausible, since `pen` caps at 2 m against a 0.10 m
far-cascade texel, so `r / texelM * 1.2` lands near the floor rather than the ceiling, and 1/8 is
12.5% against a measured 12–20%. Raised the wide-path floor from 8 to 20 taps. **Unchanged.** Both
attempts are reverted; `src/sky.js` is at its delivered state.

**What is left, and it is a hypothesis and labelled as one.** The remaining per-pixel variable is the
filter *radius*: `pen` is derived from `sum / cnt` over twelve blocker taps, so every pixel averages
a disc of a slightly different size, and **more taps inside a pixel cannot reduce variance that comes
from the pixel's disc being a different size than its neighbour's** — which is exactly why the second
attempt did nothing, and is the first thing consistent with all three results. The diagnostic is to
hold `pen` constant and see whether the stipple goes; it did not run, because the capture died on a
page error out of another agent's file while five source files were mid-edit.

**The corollary that matters more than the fix.** With the filter off, the patch is a hard-edged
bright quadrilateral — the decal that critics named originally. With it on, the edge is soft and
noisy. The penumbra work traded a hard edge for a grainy one, and *both* read as artificial for the
same reason: they sit against a wall carrying no tone at all. The crush fix is worth more here than
any further work on this filter, and that conclusion did not depend on getting the mechanism right.

## The walls were scenery you passed through, and a corridor limit is the cheap fix

Found by walking the build rather than by looking at it, which is the whole point: every
instrument this project has ever pointed at the scene judges a still frame from a fixed
station, and none of them can see that twenty-five metres of strafing — sixteen seconds —
puts the camera *inside* a canyon wall. Fifty metres put it on top of one, eighty out of
the mouth ran off the end of the built world, and a curious player reached the first of
those in under a minute. The ground clamp was never the problem and was never touched.

**The corridor limit is in `src/corridor.js` and it beats mesh collision on three counts,
not one.** Cost is the obvious one and the least interesting. The two that decided it:

- **It cannot be climbed.** A wall you collide with is a wall you can walk up if it has a
  talus pile leaning on it, and this corridor has aprons the length of both sides.
- **It cannot leak.** No tunnelling case, no missing back face, and nothing to go wrong at
  the seam where the wall curtain meets the apron.

**Read the width out of the cross-section, and read it twice.** Per side, per metre of arc
length, the limit is the lesser of `Terrain.frame().ws` — the talus toe, i.e. where the
floor stops being floor — plus slack, and where the height field first stands `WALL_RISE`
above the floor less a clearance, which is the same question `rock.js` asks to seat the
foot of the cliff. Neither reading alone is safe: `ws` runs past the toe where the wall has
been eaten into a bay, and the rise march finds the wrong thing at the head of the wash
where the floor itself is climbing. The result opens to 18 m where the wash is wide and
closes to 8 m at the head, with nothing hard-coded.

**`WALL_RISE = 4.5` is the number doing the work, and the cautious value is the wrong one.**
Cut banks in this wash reach 3.0 m. Any threshold below about 3.5 finds the bank crest
instead of the wall and pulls the limit in to five or six metres in places the wash is
genuinely thirty across — which is an invisible wall in the playable middle of the walk,
arrived at from the safe direction. The failure mode of a confinement system is not only
letting people out.

**Apply it to velocity, not to position.** A positional remap applied to the integrated
position is re-applied to its own output on the next frame and drifts. Bleeding the outward
component of the velocity across a 1.6 m band before integration does not, is identically
zero at rest — so the render loop is still the fixed point every capture depends on — and
reads as the ground refusing rather than as a box. `walkTo` places the player on the
centreline, so no capture ever enters this code path.

**The verification is a driven trajectory, and it belongs in Node.** "Does it stop you" is
easy and a hard clamp would pass it; the question is whether it can be *felt* while walking
the walk, and that is a property of a trajectory. `src/corridor.js` is pure JavaScript over
the height field and `step`'s velocity model is eight lines, so `tools/_walktest.mjs` walks
a wandering walker over the whole route in a second and a half instead of paying a
six-minute boot per attempt. Measured: 4.2 minutes of walk, drifting up to 5.8 m off the
centreline, **never nudged sideways once**, closest approach 5.07 m of clearance, and the
only stop it meets is the head of the wash 0.05 m short of it. `tools/_corridor.mjs` checks
the limit against `rock.js`'s own plan position for the cliff foot, reproduced from its
constants; clearance runs 1.1 to 16 m positive over the walk.

The one thing the walk test copies rather than imports is `step` itself, because `main.js`
owns the canvas and cannot be loaded without a document. If the two drift, the walk test is
measuring a game nobody is playing.

## An aphorism that explains the observation is not evidence for it

The sharpest thing to come out of the stipple round is not a fix, because there wasn't one. It is the
reason two wrong mechanisms got published with confidence.

I proposed that the artifact came from a hard early-out in the blocker search, and compressed it to:
*an averaging kernel degrades to noise of amplitude 1/n; a kernel with a hard early-out degrades to
noise of amplitude 1.* That sentence is true in general, it is memorable, it explained the
observation cleanly, and **it is not what was happening.** The measurement that disproves it is one
line of pixels across the edge:

```
23  25  49  67  46  46  47  47  65  77  66  79  62  77  96  89  103
```

**A continuous ramp with 12–20% noise on it, not a binary flip between two levels — which rules out
amplitude-1 noise on sight.** One line of pixel values would have stopped the whole thing before it
was written down, and it cost about four seconds to produce after the fact.

The failure was not the hypothesis; hypotheses are free. It was that the hypothesis arrived already
phrased as a lesson, and **a mechanism that is pleasing to state feels like it has been checked.**
That is the mechanism of the error and it is worth more than the shader detail: the more quotable a
mechanism is, the more it needs a measurement standing in front of it, because its quotability is
doing work that evidence should be doing. The rule, stated for use:

> **Before publishing a mechanism, produce the one number that would look different if it were
> false.** If that number cannot be named, the mechanism is a story about the observation and not a
> finding from it.

Two aggravating factors, recorded because both generalise. **The claim was amplified back to me by
the coordinator as something to keep applying, and that felt like corroboration.** It is not — a
coordinator repeating a claim is the same claim, arriving from the direction that confidence comes
from. Nothing about a restatement is independent. And I had a *prior* comment in `sky.js` at line 640
that had reasoned correctly about the same code; my error was to overturn a correct note in favour of
a better-sounding one, which is the direction this trap usually runs, because a new sharp idea always
sounds more like insight than an old accurate one.

The companion rule from the same round sits above: a statistic that returns the same answer for two
populations cannot be evidence about either. Note the asymmetry between them. **That one held because
it was a procedure — go and measure the population where the effect must be absent — while the kernel
aphorism failed because it was an explanation.** Procedures survive contact with data; explanations
are what data is for.

## Unlanded lead: the stipple is a filter-radius variance, not a sampling-count one

Recorded because it is the first story consistent with all three results and it should not have to be
re-derived. **Not implemented, not verified, and deliberately left alone** — the artifact is secondary
to the crush that makes it visible, and two attempts on it were already one too many.

What is established, by same-tree ablation: with `#hardshadow` the lit patch in `wall_shade` has hard
edges and no stipple; with the PCSS filter on it stipples. The artifact is this filter's. What is
ruled out, each by implementing it and measuring no change: the hard early-out on the blocker search,
and the filter's within-pixel tap count, raised from a floor of 8 to 20.

The lead. `pen` is computed as `sum / cnt` over the twelve blocker taps, and it sets the filter radius
`r = 0.5 * pen`. So **each pixel averages a disc of a different size from its neighbour's**, because
each pixel's radius is a twelve-sample estimate with its own sampling error. Supersampling inside a
pixel cannot reduce that variance — it converges each pixel accurately onto its own wrong radius —
which is exactly why raising the tap floor to 20 did nothing, and is the only one of the three stories
that predicts that result rather than being surprised by it.

The diagnostic, written out so it can be run in one capture. Replace the `pen` line with
`float pen = maxPen;`, which holds the radius constant across the frame at the cost of a uniformly
over-wide penumbra, and shoot `wall_shade` at 2560×1440. **If the stipple goes, the variance is the
radius estimate and the fix is to stabilise `pen` — spatially, or by widening the blocker search, or
by quantising `pen` to a few discrete steps so neighbours agree.** If it survives, the radius is
exonerated too and the remaining candidate is the per-pixel `rot` interacting with a shadow-map
feature finer than the disc. Attempted once and lost to a page error from another agent's file; it
needs a clean tree, which is the same thing everything else here needs.

## Verification: the fill lift is safe, it fixes the slab's real defect, and it does not close the shade-colour finding

Measured with `tools/_filllift.mjs s4v1 sys7final`, both captures 2560×1440, `wall_shade` /
`wall_lit` / `shade_far`. **The comparison is same-tone-curve**: `post.js` did not move between
them, and the only renderer commits in between are the two occlusion twins
(`terrain` 2548d04, `rock` 25c93fb), the rock joint-block follow-up 0609843, and the terrain
rake-march spacing 0dbd81d. That check is not a formality — the last three chroma readings this
project trusted were all taken across a tone-curve edit or a broken shader.

### 1. Shaded saturation did not move toward 0.468. It moved away.

| `wall_shade` rock window | before | after |
| --- | --- | --- |
| saturation, whole window | 0.714 | 0.723 |
| saturation, pixels with chroma headroom | 0.625 | **0.638** |
| headroom share of window | 41% | 43% |

Target was 0.468 and the delivered figure was 0.625, so this is **+0.013 in the wrong direction**.
The mechanism is not a bug, and it is visible in one line of per-channel means:

| `wall_shade` rock window | R | G | B |
| --- | --- | --- | --- |
| mean code value, before | 22.1 | 9.2 | 6.8 |
| mean code value, after | 25.9 | 10.8 | 7.7 |
| lift | **+17.2%** | **+17.4%** | **+13.2%** |

**A purely proportional lift cannot change HSV saturation at all — `(max-min)/max` is
scale-invariant.** Saturation rose because the lift is *warm-biased*: B/R falls from 0.308 to
0.297. And that is exactly what the change is specified to do. Tinting occlusion toward albedo
re-illuminates the surface with **its own colour**, and this surface is red.

So the conclusion is stronger than "the fix underdelivered". **An occlusion term cannot reach
0.468 in principle.** 0.468 is the saturation this face has when the *sky* lights it; the albedo
tint adds red rock light, so pushing it harder moves shade further from the target, not closer.
Reaching 0.468 requires the *illuminant* in deep shade to be bluer, which is the astern-aperture
work already landed and already sitting at the corridor's geometric limit. **The critic's number
one finding is not closed, and no amount of occlusion tuning will close it.**

### 2. Crush: down on the rock, and the frame-level figure is contaminated

In the rock window every channel decrushed, which is the result the change was for:

| under 10 cv, rock window | R | G | B |
| --- | --- | --- | --- |
| before | 29.5% | 59.1% | 70.4% |
| after | **20.7%** | **51.8%** | **65.1%** |

All-channel black fell 0.38% → **0.06%**, the rock twin of System 1's terrain result.

Whole-frame `wall_shade` min-channel-under-10 reads **40.8% → 44.4%, up 3.6 points**, and
**that figure must not be quoted as this change's effect.** The frame's foreground lost its
juniper and gained soft diagonal cast shadows across the pebble field — mid-floor V drops from
114.8 to 38.7 in one 120-row band — and `juniper.js` and `vegetation.js` were both uncommitted
while the capture ran. `shade_far`'s floor over the same interval is essentially unchanged, which
is what says the darkening is local vegetation and not a terrain regression. **Frame-level crush
cannot serve as a verification statistic while vegetation is in flight**, because a plant moving
out of frame changes it by more than the fix does. The rock window is the attributable measurement
and it is unambiguous.

### 3. The lit guardrail is clean

| | before | after | band | verdict |
| --- | --- | --- | --- | --- |
| lit rock saturation, brightest 40% | 0.618 | **0.621** | 0.615–0.626 | holds |
| lit rock hue | 20.9° | **21.2°** | 18.9–21.1° | holds at the edge |
| sunlit wash floor saturation | 0.567 | **0.564** | 0.47–0.56 mean | holds |

System 1 flagged that the change is an exact identity only at full visibility, so a sunlit pixel
at 0.8 visibility does take slightly more indirect light. **That is real and it measures +0.003
saturation** — about a fifth of the band — so the flag was correct and the cost is affordable.

### 4. What this did fix is the slab, by the route that was predicted

The slab is unchanged: same bright quadrilateral, same stippled edge. But the corollary that
justified standing down on the filter was that **filter off or filter on, the patch reads as
artificial because it sits against a wall carrying no tone.** Cropping the same 547×240 region
from both captures, the wall goes from a flat dark brown mass to a surface with **visible
horizontal bedding and vertical joints running through it.** The commit title said "the joints
get to exist" and they now do.

So the highest-value work on that artifact was indeed not in the shadow filter, and the stipple
was correctly abandoned. Recording it plainly: **the filter was the wrong place to fix a defect
whose visibility was set by the tone around it, and two attempts were spent there before the
surrounding tone was measured.**

### Lead, unverified: one occlusion factor is applied to two differently-occluded illuminants

Recorded with its diagnostic and not implemented, in the form the previous entry asks for.

Indirect light here is multiplied by a single `tAO` before the albedo tint. But it arrives from
two sources with **very different visibility**: skylight from overhead, which a crevice floor
still sees a good deal of, and escarpment bounce from the side walls, which a crevice occludes
almost completely. Applying one factor to both and then tinting the remainder toward albedo will
systematically warm deep shade, because it removes sky and wall light in the same proportion and
then replaces the loss with red.

The prediction that distinguishes it: **the deeper the occlusion, the warmer the error should
get.** So bin `wall_shade`'s rock window by `tAO` and read B/R per bin — if B/R falls
monotonically as `tAO` falls, the single factor is the defect and the fix is to occlude the sky
probe and the bounce probe separately, which is cheap because both probes already exist. If B/R
is flat in `tAO`, this story is wrong too. **It is a lead with a number attached, not a finding,
and it is stated that way because the last two mechanisms published from this desk without one
were both no-ops.**

## The gate, and the one check in it that does not care about exposure

`node tools/gate.mjs` is the pre-delivery gate. It refuses and exits non-zero.
Run it before you hand anything over; `--allow-dirty` to gate a working copy,
`--bless` to rewrite the reference from a build you have looked at, `--injure`
to watch every render check fail on purpose.

It is built around the three failures this project has already shipped past
itself, and the interesting thing is that **only one of the three was visible to
anything static**. An undeclared uniform in `rock.js` made every rock program
fail to link, so the walls, both aprons and all ten buttes drew nothing while a
colour probe faithfully measured the sky standing behind the hole. A debug line
painted the ground white with zero console errors and zero warnings, because the
shader compiled perfectly. An unclosed comment in `terrain.js` blew the wash
floor near-white. In two of the three the code was valid and the picture was
wrong, which is why the core of the gate is a measured picture.

Two layers, and the split is the design:

- **FLOOR** — absolute bounds on what this scene can be, measured on it, not
  computed from solar geometry. Hard-coded, and `--bless` cannot move them;
  `--bless` refuses outright if a FLOOR check fails, so you cannot bless a white
  desert into the reference. Each bound is labelled `MEASURED` or `FAILURE` in
  `tools/gate.mjs` — see "The FLOOR bounds were right and their stated reason was
  not" below, which is the audit finding and the re-derivation at 15°.
- **DRIFT** — bands around `tools/gate.ref.json`, taken from a known-good build.
  Deliberately wide, 15-35%, because a gate that cries wolf every time a tuning
  lands is a gate that gets bypassed, and that is worse than not having one.
  Two runs of the same six framings twenty minutes apart moved by about 1.5%, so
  there is an order of magnitude between the noise and the bands.

**`floorRG` is the most valuable number in the file**, and it is worth
understanding why. It is the red-to-green ratio of the bottom third of the frame,
which is wash floor in every framing the gate uses, and it sits at 1.56-1.87 on
a good build. Every other measure is a brightness, and every brightness is a
moving target while an indirect-light lift and a ground self-shadowing pass are
landing — set a ceiling tight enough to be a good detector and it will refuse a
legitimate tuning by lunchtime. Chroma has no such problem: red rock in warm
light is red at any exposure, and **white is achromatic at any exposure**. The
white-ground injury reads R/G 1.026 against a healthy 1.730. That check would
have caught the debug line on its own, with no reference build, no console error
and no golden image.

The second-most valuable is `skyOverGround`, for the same reason, and it carries
a lesson about deriving a bound from the wrong end. Sky over ground measures
2.74-7.59 on a good build. My first instinct was a floor of 1.15 — safely below
anything observed. But the two known white-desert states read `groundAvg` 124.5
and 155.8 under a sky around 190, which is a ratio of 1.53: **a bound chosen from
the healthy side would have let both of the failures it exists for straight
through.** The bound is 2.0, and it is derived from the failures.

### The injury harness, and the check it immediately proved was broken

`--injure` breaks the live page five ways inside a single page load — white
ground, all eighteen rock meshes hidden, exposure zeroed, `NaN` into a live
uniform, a `div` appended to `body` — measures each, reverts it, and **requires
each one to have been refused**. If a deliberate breakage is not caught, the gate
fails on that alone. A gate nobody has watched fail is not a gate.

This paid for itself on the first run. Four of the five were refused; hiding
every rock mesh fired **nothing at all**. The check was not weak — it was being
asked from a viewpoint that could not answer. All five injuries ran at one
framing, a steep down-pitch at the wash floor, where the rock is largely outside
the frustum anyway, so the rendered triangle count barely moved and the ground
was terrain either way. **This is the same error as measuring lit sandstone in a
rectangle with no sandstone in it**, which has already cost this project a
published number, and it arrived here by exactly the same route: an instrument
aimed somewhere the answer was not.

The fix was both halves. Each injury now names the framing it is visible in —
the missing rock is asked from `shade`, a wall face with no sky in it at all,
which is the framing the real failure produced its most confident wrong number
in. And a new check, `rockTris`, sums triangles over the meshes `rock.js` names
by traversing the scene graph rather than reading the frame, so it gives the same
answer from every viewpoint: 569k healthy, 0 injured. **A framing-dependent check
needs a framing chosen to make it fail, and a check that does not depend on the
framing is better than one that does.**

### What it refuses to be fooled by

The rule that a tool measuring nothing must not print a number applies hardest
here, because a gate that passes on an empty measurement is worse than no gate —
it is trusted. So the anti-empty guards run first and, if any of them trips, the
verdict is `NO MEASUREMENT`, nothing else is reported, and the exit code is 2:

- The expected six framings must all have measured, and the pixel count and the
  floor-band pixel count must both be non-zero.
- The six must not have produced *identical* numbers, which would mean the probe
  is not a function of the frame.
- `probe()` is called twice per framing with a re-render between, and the two
  must agree exactly.
- At least one framing must have contained sky, or the whole sky-over-ground
  family tested nothing. A framing with no sky in it is skipped explicitly
  rather than passed as though it had some — `shade` has none, and its
  `skyOverGround` is not evaluated.
- At least one program must have linked, or the link check inspected nothing.

Also checked: page errors and console errors must be empty — **this is the check
that was already sitting in the capture manifest during the missing-rock failure
and went unread, so the gate reads it for you**; `document.body` is still
`[SCRIPT, CANVAS]`; every program reports `LINK_STATUS`; no non-finite bounding
sphere or material uniform anywhere in the visible scene; `window.__game` appears
within seven minutes.

And a preflight that needs no browser, which is the other half of why deliveries
break — not that the tool did not exist but that nobody ran all four of them:
`git status` on `src`, `index.html` and `package.json` must be clean (this is the
check that answers "is the tree clean", which is the question the gate exists to
let you ask), every `src/*.js` parses, then `_p7pre.mjs`, `glslcheck.mjs`,
`_bootprobe.mjs` and `_walktest.mjs` in turn. The corridor walk test is in there
deliberately: terrain heights move under it every time somebody touches
`terrain.js`, and it costs a second and a half.

The gate pins `#high`. The adaptive governor is a moving target by design and you
cannot draw a reference band around one.

## An end-on skyline is an envelope, not a profile

> **SUPERSEDED — read "Superseded: it was a reversed heading" at the foot of this section
> before quoting anything in it.** The physics below is sound and the conclusion it reaches —
> that no crest change can straighten an end-on skyline — was **sound physics applied to the
> wrong object**. The "left mesa" was not a landform and not an envelope over many stations:
> it was the interior of **one 83 m triangle** built by a reversed heading at the near end of
> the wall curtain's domain. Fixing that moved the residual 0.50 → 21.42 px, which the
> impossibility argument says cannot happen. Kept in place because the *way* it went wrong is
> the transferable part, and because the argument was quoted upward as a measured
> impossibility.

The final critique's second-ranked finding, and the object it called the most conspicuous in
the set, was a "left mesa" in `shade_far` with a "perfectly straight, un-notched, un-eroded"
rimline over a "wood veneer" face and a "cream-white band of constant thickness running
perfectly parallel to the rim".

**It is not a mesa.** `tools/_pixowner.mjs` attributes those pixels to `wallL`, and hiding
`wallL` puts sky at the rim: it is the corridor wall seen end-on from the new station looking
back down-canyon. `tools/_aniso.mjs` — new, because every surface instrument here was
isotropic and would score a sheet of perfect horizontal rules the same as a jointed cliff —
puts that crop at **0.67 vertical-to-horizontal coherent-line energy, the most
horizontal-dominated surface anywhere in the set**, against 0.79 for the same walls seen
square-on. The critique was measuring something real.

The cause is the crest snap, and the snap is right: a rim is the top of whatever bed survived
and it steps between bed tops. What was wrong was *how often*. `raw` turns over once in
139 m, so the nearest of the ten `CREST_LEVELS` is the same level for 50 to 100 m at a
stretch and the rim is exactly constant across a whole framing. Invisible across the wall,
which is why it survived; a ruler along it. It also accounts for the cream band with no
second cause: bedding is level, so a layer band is level, and a rim that is also level sits a
constant distance above it.

### The part worth more than the fix

The obvious repair — step the crest between beds more often — was landed and measured on the
crest itself with `tools/_crestprof.mjs`: eight steps of 3 to 11 m over 200 m. **It changed
the frame essentially not at all**, and the reason is geometry rather than amplitude.

Square-on, one screen column is one station and the crest profile *is* the skyline. End-on,
one column spans tens of metres of wall and the skyline is the **upper envelope** of the crest
over every station in that column. An envelope is set by the *un-notched* stations, so a notch
narrower than a bearing bin is invisible at any depth. `tools/_skyenv.mjs` bins every mesh
vertex by bearing from the eye and takes the maximum elevation angle per bin, which is exactly
the silhouette, with no render: it showed the envelope **pinned at crest 55.6 m across the
whole visible run**, the 51.6 m notches appearing in isolated alternating bins, and the
apparent rise of the "straight line" coming from range closing from 97 m to 73 m rather than
from anything about the rock.

Widening the notch does not rescue it either. At an 80 m wavelength the half cycle is 40 m of
wall and `shade_far` sees only about 70 m of wall in total, so the whole framing falls inside
one half cycle and the envelope returns to a single constant level. **Short notches make a
comb the eye reads straight past; long ones are wider than the frame.** The only thing that
moves an end-on skyline is amplitude comparable to the crest's own variation — genuinely
taking a long section of wall down — which is a landform change across every framing and not
a delivery-morning one.

So the crest term is set at a 40 m wavelength and 6.5 m amplitude, chosen for the case it
*can* fix: **10 level changes over the first 200 m of `wallL` and 7 of `wallR`, with steps of
3 to 11 m**, which are the "dead-straight horizontal top line" complaints in `bend`, `far_170`
and `far_220`. Strictly subtractive, which is the rule this file already applies to the butte
rims and for the stated reason: the corridor skyline is what the sun disc clears, and a
perturbation that can only lower a crest cannot cost that anything, while a symmetric one
needs re-verifying every time an amplitude moves.

**The cheap fix for `shade_far` is not in `rock.js`.** The critique's own list of what is
missing from that rimline includes "no vegetation breaking it". A juniper or two on the rim
breaks a geometrically straight silhouette at zero cost to the rock, and it is the one
intervention here whose cost does not scale with how much wall is in frame.

### Superseded: it was a reversed heading, and the mesa was never a landform

**Everything above about `shade_far` is wrong about its object, and the "measured impossibility"
it concluded with was measured off a surface that should not have existed.** Recorded rather
than deleted because the way it went wrong is the useful part.

`WashPath.headingAt` clamped its *backward* sample at `s = 0` while leaving the forward sample
free, so below `s = -3` the two straddled the origin backwards and the heading came out
reversed — **-177.6° at `s = -34` and -174.5° at `s = -3.2` against a true +5.7°**, through a
degenerate `atan2(0, -0) = 180°` at exactly `s = -3` where the samples coincide. Since
`cNx = cos(th) * side`, fifty columns of the curtain were built on the **far side of the
corridor**, and the one transition column at `s = -3` stretched a single quad **eighty-three
metres** across it, from x -42 to x +40 at a near-constant y 46.8.

The ruler was the **interior of that one triangle**. `tools/_rimtri.mjs` — new, reports the
drawing triangle for a pixel by taking the raycast hit's `faceIndex` back through the index
buffer — returns corner separations of **0.99 / 83.04 / 82.76 m** between two adjacent 0.62 m
columns. A silhouette drawn across the middle of one triangle cannot vary however much the
crest varies, because there are no vertices there to carry it. That is why the crest fix did
nothing here while measuring 23, 18 and 15 px of residual in `bend`, `far_170` and `far_220`,
and why five separate rim-planting strategies all measured 0.50 px.

Fixed by clamping `headingAt` to `-sZero` instead of to zero, and by clamping the curtain's
near end to the path's real domain with `sStartOf`, mirroring `sEndOf` — the same
out-of-domain stacking that produced the `far_320` ledge, at the other end of the same array,
missed the first time because nothing frames the start of the walk. On a same-HEAD pair,
`_skystraight.mjs` on `shade_far` goes from **0.50 to 21.42 px** worst residual over the
straightest 200 columns and 0.79 to 51.11 px median; `far_270` is unmoved at 6.93 → 6.99 px and
saturation 0.483 → 0.482; lit rock holds at 0.671 saturation and 13.9° hue. Triangles fall
22-52k per view, since the removed columns were never in the world.

**`tools/_skyenv.mjs` should not be trusted and `_crestprof.mjs` only for profiles.** Two
independent faults, both found by System 3:

- It bins **vertex positions**, so its envelope is the envelope of a face's *corners*, not of
  the drawn edge. Against an 83 m triangle those are different objects, and its "pinned at
  crest 55.6 m" was the corner stack.
- It measured **flatness**, and this edge *rises* at slope 0.159. A flatness test scores every
  bin as a step and calls a perfect ruler unremarkable. `_skystraight.mjs` fits a line and
  reports the residual, which is the critic's actual statistic, on the PNG, in a second, with
  no `src` import to be blocked by anyone else's mid-edit file.

Two further traps worth keeping: `buildWalls` does not return the distant buttes, since
`buildDistantButtes` is a separate call, so any pass harvesting rock off `buildWalls` alone has
never seen them; and **a node-side `buildWalls(path, terrain, {})` is not the wall the app
draws** — one reported no rock above y 0 where the running scene has wall at y 46.8. Ask the
running scene.

The general claim about end-on envelopes is still true as physics. It simply did not apply,
because this was not an envelope over many stations — it was one triangle. **An elegant
argument about why something is impossible is worth exactly as much as the attribution of the
object it is about**, and the attribution here stopped at "`_pixowner.mjs` says `wallL`" when
the next question was which *triangle* of `wallL`, and how big.

### Two rules this leaves behind

- **A crest measurement square-on does not predict the same crest end-on.** Use
  `_skystraight.mjs` for silhouette questions and `_crestprof.mjs` for profile questions, and
  do not quote one at the other. This is the same shape as the sun-versus-view finding recorded
  for the wash head: *a landform can be open to the sun and closed to the eye*, and a rim can
  be stepped to the profile and straight to the silhouette.
- **Isotropic surface statistics cannot see directional structure.** `grad.mjs`, `hf.mjs` and
  `wallprobe.mjs` all scored these walls fine. Quote `_aniso.mjs`'s vertical/horizontal
  coherent-line ratio whenever the complaint is about bedding, jointing or plywood.

## The vertical joints existed and contributed three per cent

Measured before anything was added, which is what the brief asked for. Ablating the entire
four-set joint system through `uJointK` moves the lit midwall's vertical/horizontal line ratio
from **0.77 to 0.75**. Four sets, four fetches, three per cent of the wall's structure. They
were not too weak and not lost to distance — `jointRes` passes all four at this footprint —
they were gated off for most of the wall by a termination term whose two periods were both
functions of height with a 90 m along-wall phase. At any given height it therefore held one
value across a whole hero framing, which cut every vertical into metre-and-a-half dashes *and*
laid another horizontal band over a wall already accused of being nothing but horizontal
bands.

Termination phase now comes off a joint-block index, so a joint dies at a different height on
each slab. The same index cuts the bedding, which is the half that answers "running
continuously across the entire face": a joint is a free face, so the slabs either side weather
back independently and a bed contact is a sharp lip on one and a rounded nothing on the next.
Bedding stays level — faking a wobble into it is a failure this file has already made once —
but a trace is no longer the same trace for four hundred metres.

**A structural term must not be able to darken anything.** The first form of the block field
was two-sided and it cost 0.012 of lit saturation, 0.618 out to 0.630 against a defended
0.615–0.626, while taking `wall_shade`'s min-channel-under-20 share from 66.2% to 68.4% —
making worse the very crush the occlusion fix exists to relieve. Both terms are now one-sided
and can only lighten. Same discipline System 1 applied to the multi-bounce curve, right for
the same reason: a term added for structure should not move a measured population downward, or
its effect is a calibration rather than an identity. A bed trace that dies on one slab and
survives on the next breaks continuity exactly as well as one that deepens, so nothing was
given up for it.

## The occlusion fix, and the part of the crush it cannot reach

Landed in `rock.js` character-for-character identical to `terrain.js`'s line in `2548d04`, as
asked. Both properties that make it safe are identities rather than calibrations: exactly unity
at visibility 1, so an unoccluded surface cannot move, and clamped below by the occlusion term,
so it can never darken.

Measured with the new `tools/_crush.mjs`, which reports the bottom of the distribution because
a mean cannot see this — lifting every pixel whose max channel is under 10 cv moves the region
mean 1.3% and the shadow gate from 0.211 to 0.214, still mid-band, which is why the gate never
caught it.

| | min channel < 10 cv | < 20 cv | mean min channel |
| --- | --- | --- | --- |
| `wall_lit` before | 38.3% | 62.8% | 20.5 |
| `wall_lit` after | **34.7%** | **60.1%** | **21.2** |
| `wall_shade` before | 43.1% | 66.2% | 18.6 |
| `wall_shade` after | 42.4% | 68.4% | 16.9 |

**On `wall_lit` the fix reads. On `wall_shade` it does not, and it cannot.** This is what the
change's own note predicted: the lift is albedo-weighted, so at the `tAO` floor of 0.18 red
rises about 37% and blue about 2%, and a red crevice having little blue light to bounce is
correct physics rather than a defect in the curve. On `wall_shade` the wall is *in shadow*, so
every photon reaching it is indirect and its blue is the product of sky irradiance and a blue
albedo near 0.115. **No occlusion term can raise that product.** Carrying blue from six code
values to twenty is a question about the shaded illuminant or the shaded albedo, not about
visibility. That is the handoff, with the arithmetic done.

The `< 20 cv` regression in that table was the two-sided block field and is reversed.

## A class of bug: check *both* ends of a domain-clamped array

This has now produced two of the project's most conspicuous defects independently, from
opposite ends of the same array, and neither was findable from the picture. It is a class, not
two incidents, and the next person should check for it by construction rather than wait for a
critic to frame it.

**The shape.** `WashPath.posAt` clamps its parameter into the path's real domain, which is
`[-sZero, length]` = `[-11.99, 332.3]` m. That is correct and defensive. The bug is in the
*consumer*: a loop that walks `s` past either end gets the same clamped point back for every
iteration, so N columns are placed on one point, and any lateral offset then fans that stack of
coincident columns into a sheet standing where no landform is. A defensive clamp does not
protect a caller that never asks whether it is inside the domain — it hides the fact that it is
not.

| | out-of-domain run | columns stacked | what it produced |
|---|---|---|---|
| far end | `S1 = 356` against `length = 332.3` | 39, at x 0.0, z -319.9 | the **`far_320` ledge** — aprons leaning on the stack met on the axis as a berm 14-16 m high, hiding a 24 m amphitheatre behind it |
| near end | `S0 = -34` against `-sZero = -11.99` | 36, at x 0.0, z 20.0 | half of the **`shade_far` ruler** |

Fixed by `sEndOf(path)` and `sStartOf(path)` in `rock.js`, six metres of margin each, so the
end fades finish on real path rather than on the clamp.

**The second failure mode, which is worse: a derived accessor clamped asymmetrically.**
`headingAt` differences two `posAt` samples and clamped only the backward one, at zero rather
than at `-sZero`. Below `s = -3` the two samples straddled the origin *backwards*, so the
heading reversed — **-177.6° at `s = -34` against a true +5.7°** — through a degenerate
`atan2(0, -0) = 180°` at exactly `s = -3` where they coincide. `cNx = cos(th) * side` therefore
flipped and fifty columns were built on the far side of the corridor, with the single transition
column stretching one quad **83 m** across it at near-constant height. So: a derived quantity
must clamp to the same domain as the accessor it is built on, and it must clamp *both* samples,
or it will return a confidently wrong value in the interior of a range where the underlying
accessor is fine.

**Why the far end was found first, and the near end took another night.** Nothing frames the
start of the walk. The far end is the payoff shot and the defect there was described by a
critic within hours; the near end is only visible from a station added late, looking back
down-canyon, and even then it presented as a plausible landform — a "left mesa" with a straight
rim — rather than as an error. **A defect out of frame is not a smaller defect, only a later
one.**

**The diagnostics, in the order that works.**

1. `tools/_pixowner.mjs` — which mesh drew the pixel. Necessary, and *not sufficient*: it said
   "`wallL`", which was true and cost four rounds of reasoning about the wall's crest.
2. `tools/_rimtri.mjs` — which **triangle** drew the pixel, by taking the raycast hit's
   `faceIndex` back through the index buffer, reported with its edge lengths. This is the one
   that closes the gap, and the tell is unmistakable: **0.99 / 83.04 / 82.76 m** in a grid whose
   columns are 0.62 m apart. Coincident or near-coincident corners, or one enormous edge, in an
   otherwise uniform grid, means the generator ran outside its domain.
3. `tools/_skystraight.mjs` — residual from a fitted line, on the PNG, in a second, for
   iterating.

**The symptom that should send you here first:** a silhouette or surface that **no parameter
change can move**. Both instances presented that way — the crest term stepped ten times in
200 m and measured 23, 18 and 15 px of residual in `bend`, `far_170` and `far_220` while
measuring 0.50 px here, and five separate rim-planting strategies each measured 0.50 px. If a
feature is insensitive to the parameter that generates it, stop tuning the parameter and ask
what geometry is actually there. Usually the answer is that there is almost none.

## `far_320`: the blocking lip is in the height field, not in the talus

Worth stating because the item arrived described as an apron problem and the apron cap is
mine. `tools/_headlook.mjs`, which produced the 6.4 m crest twenty metres in front of the
camera, marches `terrain.heightAt` and nothing else — it never sees a rock mesh. So the object
it measured is the colluvial ramp in the height field, `_headRise`, and not `apronL`/`apronR`.
The talus aprons at that station were already clamped earlier the same night: the wall curtain
is held to `sEndOf(path)` and apron reach to seven tenths of the wall's set-back, precisely so
nothing of mine stands across the mouth of the wash head. That clamp is verified and still in
place. The remaining lip is the ramp, and the specified fix — pulling the notch onset upstream
so the incision runs *through* the apron rather than beginning behind it — is a change to the
same height field.

## The probe split: diagnostic confirmed, landed, and the honest size of it

### The diagnostic said yes, and not marginally

The falsification condition recorded earlier was to bin a rendered window by `tAO` and read B/R.
That test was replaced with a stronger one, and the substitution is worth stating: **the frame
carries no per-pixel `tAO`, and the binning could not have answered the question that decided
whether to spend the remaining time — how much blue is there to find at all.** The ceiling on any
reweighting of occlusion is the sky-only case, so `tools/_probesplit.mjs` decomposes the fill into
the three illuminants it is a sum of and reflects each off the rock albedo alone. `env` is
`mix(sky, wall, cov)` above the horizon and local ground below it, so the split is exact rather
than modelled, and the tool asserts the three probes close on the summed probe — 0.0000% — before
printing anything.

On a shaded lateral face, which is what `wall_shade`'s rock window is made of:

| illuminant | share of fill, by luminance | hue | saturation |
| --- | --- | --- | --- |
| sky | **47.8%** | −23.9° | **0.252** |
| escarpment | 25.1% | 8.6° | 0.920 |
| ground bounce | 27.2% | 10.8° | 0.728 |
| all three, as shipped | 100% | 5.9° | **0.635** |

**The sky is already the largest of the three by luminance and still loses the chroma fight**,
because the two warm terms are nearly three times as saturated as it is. And the mix lands at
0.635 against the render's measured 0.638 — so **shade's colour is decided in the illuminant, and
the encoder is exonerated.** The earlier suspicion that ACES or the toe was inflating it was
wrong, and `post.js` says why in its own comment: contrast and toe act on luminance as a scalar,
and a positive scalar cannot move saturation or hue at all.

### What was landed, and why it cannot spend anything earned

`s4AoTint` in `src/sky.js`, called from the one expression `rock.js` and `terrain.js` share.
Two properties by construction rather than by measurement: **exactly `vec3(1)` at full
visibility**, so no lit pixel moves, and **luminance-preserving**, because `vSky` is solved for
whatever restores the luminance uniform occlusion would have delivered — so the shadow gate, being
a luminance ratio, cannot move either. What is left is chroma alone.

The physics is that **local relief cuts grazing directions long before it cuts the zenith** — a
pit's own rim closes the horizon while the slot overhead stays open — and the two warm illuminants
live at and below the horizon while the sky lives overhead. One scalar therefore over-occludes the
cool term and under-occludes the warm ones at every depth.

Measured at 2560×1440 on the `wall_shade` rock window, pixels with chroma headroom:

| | pre-change | `#aok=1` (inert) | `#aok=1.5` | `#aok=2` shipped |
| --- | --- | --- | --- | --- |
| shaded saturation | 0.638 | **0.638** | 0.629 | **0.620** |
| lit rock saturation | 0.621 | **0.617** | 0.615 | 0.614 |
| shadow gate | 0.248 | 0.243 | 0.243 | 0.242 |
| crush, min<10 whole frame | 44.4% | — | 42.6% | 42.2% |

### The identity capture is the reason those numbers mean anything

`#aok=1` is an exact algebraic identity — at an exponent of one the solve returns `vWall = vSky =
ao` and the gain is `vec3(1)` at every depth — so it is a true ablation rather than an
approximate one. Running it returned shaded saturation at 0.638 to the digit, which confirms the
term is inert as claimed. **And it returned lit rock at 0.617, against the 0.621 measured ninety
minutes earlier with the term absent entirely.**

So 0.004 of what looked like this term's cost was an in-flight `textures.js` drift, and the real
price of the shipped setting is **0.003 of lit saturation for 0.018 of shaded** — six to one in
favour, where the uncontrolled reading said it was a losing trade about to be abandoned. It is
also why lit rock sits a thousandth under its band floor at 0.614: **that thousandth is the
texture drift, not this term**, and it belongs to the texture's owner.

The general rule, third instance tonight and the first where the control was run *before* the
report rather than after: **a baseline is a measurement and it expires.** Two figures taken ninety
minutes apart in a tree with five files in flight are not a before and an after, they are two
afters. The inert setting exists so the comparison can be made inside one build, and it paid for
itself the first time it was used.

### The honest ceiling, which is lower than the decomposition implies

The decomposition says a shaded face could reach 0.335 saturation at the occlusion floor. The
render moved 0.018. The gap is not a bug and it is worth writing down, because it bounds anything
further in this direction:

**`tAO` is a texture micro-occlusion, not slot geometry.** `rock.js` pulls it toward 0.88 with
distance and `terrain.js` toward 0.80, and both clamp it well off zero. It represents the shading
between grains, which is real — but the thing that makes a canyon crevice dark is metre-scale
geometry that `tAO` never sees. **The lever is correct and the signal driving it is weak**, so the
available gain is roughly a fifth of what the light transport offers. Driving it properly needs a
geometric occlusion or a bent normal, which this frame does not carry and which is not a two-hour
change.

Second bound, and it is the one that has kept reappearing all night: **the shaded window is only
44 to 48% chroma-headroom.** Better than half its pixels have a channel under ten code values, so
whatever the illuminant does, the encoding cannot express it there. Crush remains the binding
constraint on shade colour, and the shadow gate at 0.242 against a 0.25 ceiling says the obvious
remedy — lifting shade — is spent. That corner is real and it is not System 4's to open alone.

## The shade-colour deviation, with the bounds rather than the argument

Recorded so the next person inherits measurements instead of a position. **Warm shade in this
corridor is substantially correct for the geometry; the part of it that was a genuine modelling
error has been corrected; and what remains is bounded by crush rather than by light transport.**
Each clause is checkable.

**Correct for the geometry.** Five of the eight original standard views sit inside a slot whose
walls fill 45 to 80 degrees of their sky with sunlit red rock. On a shaded lateral face there, the
exact three-way decomposition of the fill (`tools/_probesplit.mjs`, parts closing on the whole to
0.0000%) reads:

| illuminant | share of fill, by luminance | reflected hue | reflected saturation |
| --- | --- | --- | --- |
| sky | **47.8%** | −23.9° | **0.252** |
| escarpment | 25.1% | 8.6° | 0.920 |
| ground bounce | 27.2% | 10.8° | 0.728 |

**The cool illuminant is already the larger one by luminance and still loses the chroma fight**,
because the warm terms are close to three times its saturation. That is not a defect to be tuned
out; it is what a red slot at 15° sun elevation does. The blue canyon shade the critique asks for
belongs to a wider canyon open to the dome, and this scene does produce it where the geometry
allows — which is why `shade_far` was added at 160 m, where the up-canyon aperture mix runs 0.93
to 0.99 and the fill arrives at hue 317.

**The genuine error, now corrected.** One occlusion scalar was multiplying all three of those
illuminants, which preserves their ratio at every depth — so an occluded crevice received less
light of exactly the same colour, when real relief cuts grazing directions long before it cuts the
zenith and the two warm terms are the ones near the horizon. `s4AoTint` corrects it. Measured:
shaded saturation 0.638 → 0.620, crush 44.4% → 42.2%, for 0.003 of lit saturation.

**Bounded by crush, not by transport.** Two numbers set the ceiling, and both are the reason
further work on the illuminant will not pay:

- **`tAO` is texture micro-occlusion and cannot see the geometry that darkens a crevice.**
  `rock.js` pulls it toward 0.88 with distance and `terrain.js` toward 0.80, both clamped well off
  zero. It models shading between grains, which is real, while the thing that makes a canyon slot
  dark is metre-scale. The decomposition says a shaded face could reach 0.335 saturation at the
  occlusion floor; the render moved 0.018. **The lever is correct and the signal driving it is
  weak** — roughly a fifth of the available gain. Doing better needs a geometric occlusion term or
  a bent normal, neither of which this frame carries.
- **The shaded window is only 44 to 48% chroma headroom.** More than half its pixels have a
  channel under ten code values, so whatever the illuminant does, the encoding cannot express it
  there. And the obvious remedy is spent: the shadow gate sits at 0.242 against a 0.25 ceiling, so
  shade cannot be lifted to open that headroom without leaving its band.

One correction to carry forward so it is not chased: **lit rock sitting a thousandth under its
band floor at 0.614 is an in-flight `textures.js` drift, not `s4AoTint`.** The inert-setting
control measured the term's own cost at 0.003 and the drift at 0.004. See below.

## A baseline is a measurement, and it expires

Promoted to a rule of its own because tonight produced three instances and only the last one was
caught before it was published rather than after.

> **A baseline is a measurement and it expires. Two figures ninety minutes apart in a tree with
> five files in flight are two afters, not a before and an after.**

The instance that earned the promotion. `s4AoTint` shipped with `#aok=1` as an exact algebraic
identity — at an exponent of one the solve returns `vWall = vSky = ao` and the gain is `vec3(1)` at
every depth — specifically so the term could be ablated inside one build. Run against the
uncontrolled baseline, the term looked like it cost 0.007 of lit saturation to buy 0.018 of shaded,
which is a bad enough exchange on a defended metric that **the recommendation to ship it inert was
already drafted.** Run against the identity in the same tree, shaded saturation came back at 0.638
to the digit, confirming inertness — and lit rock read **0.617, not the 0.621 measured ninety
minutes earlier.** Four thousandths of the apparent cost belonged to a `textures.js` edit that
landed in between. The real price is 0.003 for 0.018, six to one in favour, and the change is worth
having.

So the control did not merely improve a number's precision, it **inverted the decision.** That is
the argument for building the ablation before the measurement rather than after an argument about
it, and it is the specific thing that was missing from the two stipple mechanisms earlier tonight:
both were measured against a tree that had moved, and neither had an inert setting to compare
against.

Two supporting notes, both already paid for in this file. The earlier `_fillonly` reading that
showed a dramatic blue-violet shift was a cross-session comparison spanning a `post.js` edit *and*
a corrupted frame — same failure, twice over. And the whole-frame crush figure could not be quoted
either way, because the foreground lost a juniper and gained cast shadows while two vegetation
files were uncommitted: **a plant leaving frame moved that statistic by more than the fix did.**

## The instrument discipline worth keeping

`tools/_probesplit.mjs` is the shape to copy. It decomposes the fill into three illuminants and
**asserts that the parts close on the whole to 0.0000% before it prints a single number** — so the
decomposition is verified rather than assumed, and any error in it is visible immediately instead
of being laundered into a conclusion. That check cost four lines. It also exonerated the encoder as
a byproduct: the analytic mix reads 0.635 against the render's 0.638, which is what located shade's
colour in the illuminant rather than in ACES or the toe, and retired a suspicion that had survived
several hours on plausibility alone.

The general form, and the counterpart to the aphorism rule above: **an instrument should be able to
fail out loud.** A tool that cannot report that it is wrong is only ever reporting that it ran.

### Two things learned by running the gate at a tree four agents were editing

**Do not pipe the gate through `tail`.** The refusal is the exit code and a pipe
reports the *last* command's status, so `node tools/gate.mjs | tail -40` exits 0
on a build the gate refused. That is the failure the gate exists to prevent,
reintroduced by the habit of trimming output. Run it bare; it is not verbose.

**The gate no longer waits out a page that has already thrown.** `waitForFunction`
on `window.__game` needs a seven-minute timeout, because boot legitimately blocks
the main thread for forty seconds. But when `vegetation.js` threw
`ReferenceError: x is not defined` at second forty-five, the gate sat there for
the remaining six minutes to learn what the console knew immediately. It now
watches the page-error channel and the global together and stops on whichever
arrives, which turns a seven-minute refusal into a one-minute one. At quarter to
midday that is the difference between the gate being run and being skipped.

Worth recording what that run showed about the preflight, too: `_p7pre.mjs`
reported that every module evaluates and `_bootprobe.mjs` reported that the scene
builds, and the page still could not boot, because the fault was inside
`planVegetation` at run time rather than at module scope. **The cheap checks
narrow the search; they do not replace loading the page.** Any future
reorganisation that drops the browser leg to save forty seconds has removed the
only leg that has ever caught anything on its own.

## Two metrics on two different surfaces, and the floor gradient's local minimum

The anisotropy mechanism was authorised as a correction rather than a
compensation: `ground` under-detailed, `wash_mid` twenty per cent over, one
amplitude applied to both because the shader never read its own footprint. The
mechanism exists and the separation is real. It does not fix this, and the
reason is worth more than the change would have been.

**First, the target was not well posed, and neither was the number I reported
it against.** `grad.mjs` and `hf.mjs` each carry their own per-view crops and
for `ground` they do not overlap: `grad.mjs` measures the floor at y 0.32-0.58,
mid-frame, and `hf.mjs`'s near band is y 0.80-0.98, at the camera's feet. Those
are different distances, so different footprints, so different surfaces. Every
"hold grad/L while hf9 climbs" statement made about `ground` was a statement
about two places at once. `tools/_band2.mjs` reports both metrics plus `hf9/L`
over one rectangle. It should be the tool for any two-sided target from here.

Measured on identical bands, the picture is coherent for the first time, and it
is not the picture the two-sided target described:

| band | footG | grad/L (0.12-0.16) | hf9 | reference |
|---|---|---|---|---|
| `ground` near | 9.1 mm | 0.088 under | 0.0741 | 0.075-0.094 |
| `ground` mid | 12.1 mm | 0.116 just under | 0.0896 | 0.115-0.137 |
| `wash_mid` near | 17.9 mm | 0.168 over | 0.1130 | over |
| `wash_mid` mid | 28.4 mm | 0.121 in | 0.0716 | short |

`ground` is under-detailed at every distance, not balanced against a
gradient ceiling. Note also that `hf9` is an unnormalised RMS: `wash_mid`'s near
band is nineteen per cent brighter than `ground`'s, and some of the gap between
0.1130 and 0.0741 is exposure rather than surface. `hf9/L` is printed beside it
for the same reason `grad/L` is printed beside `grad`.

**The footprint separates the framings.** Painted through the shader and read
back — `footG` is the geometric mean of the footprint axes, so the linear scale
of its area — the four bands are 9.1, 12.1, 17.9 and 28.4 mm, monotone, and the
correction each needs runs along that axis. Instanced clasts are only fourteen
per cent of `wash_mid`'s near band; the terrain is eighty-six. Filtering the
paint on chromaticity is how that was separated, and it needs a tolerance of two
code values because dithering runs after the paint and exact grey never
survives.

**The mechanism was built and it made both framings worse.** Amplitude
`clamp(0.0120/footG, 0.85, 1.35)` on the bed's tilt and on the height difference
the rake marches, so shadow and normal stay coherent. `ground` moved the way it
should — grad/L 0.088 to 0.107, hf9 0.0741 to 0.0862, both toward reference. The
wash floor was cut to 0.85 and its gradient went **up** sixteen per cent. On the
stated criteria both fail: `ground` floor 0.151 to 0.168, `wash_mid` floor 0.160
to 0.179, both out of band. Reverted.

**The reason, and it is the third bound on this surface.** Pinning `gAmp` to 1.0
reproduces the baseline exactly — grad/L 0.1680 against 0.1680, hf9 0.1130
against 0.1130 — so the plumbing is a clean no-op and the gate itself did this.
That gives three amplitudes at the same band:

| bed amplitude, `wash_mid` near | grad/L |
|---|---|
| 0.85 | 0.196 |
| 1.00 as shipped | 0.168 |
| 1.50 | 0.205 |

**The shipped setting is a local minimum.** The floor's luminance gradient rises
whether relief is added or removed, so no scaling of bed amplitude reduces it in
either direction, and the lever has no sign there rather than the wrong one. A
grazing sun explains it: that bed is already rough enough to self-shadow into
flat-lit and flat-dark, and flattening it walks the whole band back toward the
terminator where sensitivity to tilt is greatest. It also explains why the
earlier rebalance found `wash_mid` three times more responsive than `ground`.
Whatever makes that floor read over-detailed, it is not the amount of relief.

Two smaller negatives from the same session. The grit detail layer — `gritK`,
the term that fades in as the dirt grain fades out — carries **none** of either
near band: zeroing both its consumers leaves `wash_mid` near at 0.1130 and
`ground` wholly unchanged, and moves only `wash_mid`'s mid band, by 3.8%. It was
the obvious lever and it is not connected to the thing it looks connected to.
And `dirtN` is a mix of two mip taps and is deliberately shorter than unit
length; the lerp against flat below reads that length as strength. Normalising
it while scaling raised both framings by more than the gate removed. Scale the
tilt in place.

The mid field stays short and is not chased. At 30 m the shading normal is
0.0010 of tangent slope after the fade, so no texture change reaches it; that is
the documented structural limit, not a failure of this change.

Three directions now bound this surface: no global rebalance satisfies both
framings, no relief amplitude does either, and the gradient is stationary in
amplitude at the framing that needs it lowered. The mechanism is specified and
the footprints are measured for whoever picks it up. The remaining candidate is
not amplitude but *character* — spatial frequency or the albedo mottle rather
than the normal field — and nothing in tonight's work has tested that.

### What the frames show, which is an eyeball and not a measurement

Looking at `ground` and `wash_mid` after the revert sharpens the closing
question above, and points at why the lever had no sign.

**The two framings differ in clast-to-matrix ratio, and both metrics may be
reading the clasts rather than the bed.** On `ground` the matrix *between* the
stones is visibly smooth and unshaped — that is where the missing grad/L 0.088
lives — while the stones themselves are strongly lit, hard-edged and read as
sitting on the surface rather than in it. On `wash_mid`'s near floor the excess
is the opposite: a dense scatter of small dark chips over a matrix that is not
obviously too busy. So `ground` is short of *matrix* and `wash_mid` is long on
*population*, and a bed amplitude gate moves neither, because in both frames the
one-pixel gradient is dominated by clast silhouettes.

That is a coherent explanation of the local minimum: changing bed relief barely
shifts a statistic carried by clast edges, while it does perturb which pixels sit
near the terminator, so the response is shallow and non-monotone rather than
signed. It is consistent with every measurement in the section above, and it is
still an eyeball — it has not been tested.

**The test for whoever picks this up** is to mask the instanced clasts out and
re-run `tools/_band2.mjs` on the matrix alone. If `wash_mid`'s near band falls
into the 0.12-0.16 band once the clasts are excluded, then the surface is not
over-detailed at all and the population count is the defect, which is a
different fix in a different file from anything tried tonight. If it does not
fall, the bed really is too busy there and the character question stands.
`far_270` is clean on this framing: the lattice fix is holding, no
salt-and-pepper, and the bank reads as rock.

## The wash floor, bounded from three directions — a map, not a mystery

Three independent attempts to move the wash floor's detail were built, measured
and reverted. Each is written up in full above; this collects them so the next
person inherits the shape of the problem rather than three separate defeats.

| bound | mechanism | where it stops | number |
|---|---|---|---|
| 1 | global relief scaling, `DIRT_RELIEF_K` | the gradient band | admits **K ≤ 1.21**; transfer is 0.042 of grad/L per unit K |
| 2 | global grit / pebble band weighting | the two framings want opposite changes | no weighting satisfies both; `wash_mid` is 3x the more sensitive |
| 3 | footprint-keyed amplitude, `clamp(0.0120/footG, ·)` | **the lever has no sign** | 0.85 → 0.196, 1.00 → 0.168, 1.50 → 0.205 |

**The third is the strange one and the most valuable.** The shipped amplitude
sits at a local *minimum* of `wash_mid`'s floor gradient: adding relief raises
it and removing relief raises it. There is no direction to push. Bounds 1 and 2
say a lever is too small or points two ways at once; bound 3 says the lever is
not connected to the quantity at all. Anyone arriving with "just turn the bed
detail up/down a bit" has already been answered, in both directions, with a
no-op check confirming the plumbing (`gAmp` pinned to 1.0 reproduces the
baseline to four decimals, so the gate and not the wiring produced the rise).

Note also that the footprint mechanism itself *works* — `footG` cleanly
separates the framings, 9.1 mm at `ground`'s near band against 17.9 mm at the
wash floor, measured by painting it through the shader and reading it back. The
mechanism is available and specified. It simply has nothing useful to drive.

### Hypothesis, not a finding: the metrics are reading the clasts

`ground` is short of *matrix* between the stones — the smooth unshaped ground
around them is where the missing grad/L 0.088 lives — while `wash_mid`'s near
floor is long on chip *population* over a matrix that is not obviously too busy.
If the one-pixel gradient is dominated by clast silhouettes in both frames, a
bed amplitude gate cannot move either, and a stationary response is exactly what
that would look like. This is consistent with all three bounds and with the grit
ablation, and it is **an eyeball. It has not been tested.**

**The test, written out.** Mask the instanced clasts and re-run
`tools/_band2.mjs` on the matrix alone.
- If `wash_mid`'s near band falls into 0.12–0.16 once the clasts are excluded,
  the surface is not over-detailed at all and the *population count* is the
  defect — a different fix in a different file from anything tried here.
- If it does not fall, the bed really is too busy and the remaining candidate is
  character rather than amplitude: spatial frequency, or the albedo mottle
  instead of the normal field. Nothing tried has tested that.

### The measurement error, plainly, because it invalidates a chain of reasoning

**`grad.mjs` and `hf.mjs` measure `ground`'s floor at different distances** —
y 0.32–0.58 against y 0.80–0.98. Every "hold grad/L while hf9 climbs" statement
made about `ground`, by me and downstream of me, was about two surfaces at once.
On consistent bands `ground` is under-detailed at *every* distance rather than
balanced against a ceiling, which is a different problem with a different fix
from the one that was being pursued.

Two aggravations worth carrying. `hf9` is an **unnormalised RMS**, so part of the
`wash_mid`-versus-`ground` gap is exposure and not surface: that band is 19%
brighter. `tools/_band2.mjs` prints `hf9/L` beside it for the same reason
`grad/L` is printed beside `grad`, and it reports both metrics over one
rectangle so a two-sided target can actually be stated.

This is the eighth instance tonight of a figure being precise about the wrong
thing, and the second where **two tools shared a name for different
populations**. The recurring shape is not arithmetic error — every number was
correct for what it measured. It is that a name travels between tools while the
population underneath it does not. A metric quoted without its region, its
banding and its normalisation is a different metric.

## The arrival, landed: the apron is breached by the channel that drained it

`far_320` scored 3.0 — *"arriving does not feel like arriving; it feels like the
trail ran out."* The specification above was right and is now landed.

**What was wrong.** The colluvial apron ramps over `smoothstep(-274, -336, z)`
and reached its full ten metres on the axis at about z −328; the pour-off notch
only began to bite at −332. The incision therefore started four metres *behind*
the crest it was supposed to have cut. As composition that is a 6.4 m mound
twenty metres from the camera hiding a real 24 m amphitheatre. As landform it is
unphysical: the water that cut the pour-off had to leave through the apron.

**The fix is an identity, not a new onset.** `ramp * ramp * 10.0` *is* the
apron, so the breach subtracts that same term inside the channel. The apron can
then never dam the channel that drains it, at any future apron height, without
anyone re-deriving a z range that has to agree with another one. Two things had
to be added, and both were found by measurement rather than by eye:

- **The breach must hand off to the notch, not add to it.** `ramp` saturates at
  1 and stays there, so an unwindowed breach goes on cutting its ten metres
  through the entire headwall, deepening the pour-off far behind the apron.
  That dropped `far_270`'s skyline from 10.10° to 8.15° — the highest-scoring
  frame in the set, fifty metres upstream. Fading the breach out over exactly
  the range the notch fades in holds the total cut near ten metres instead of
  nineteen. `far_270` returns to 10.10° at 180 m, bit-identical to `BREACH = 0`.
- **The cut must clear System 2's talus toes.** A first pass at the notch's full
  9.5 m width undercut the aprons, which reach in to |x| 4.4 at this station,
  and left one standing on nothing — a hard-edged rectangular slab in the hero
  frame. `_pixowner` named `apronR` on three points rather than arguing from the
  picture. The breach now carries its own width. **Do not** narrow `CHAN_W` to
  achieve this: it is the notch's width, `far_270` sees the notch, and taking it
  to 4.0 moves that frame from 10.10° to 12.07°.

**Depth was the surprise.** The lip only needed about a metre: the threshold
where it stops being the highest thing on the ray lies between `BREACH` 0.05 and
0.10. A full cut works but drops the walker 3.2 m into a slot with 52° walls
two metres away, which trades a berm for a trench and reads worse than the
defect. Shipped at **0.55**, which leaves the lip at 4.66° against a 13.16°
headwall — eight and a half degrees of margin — for a 1.76 m drop.

| | before | after |
|---|---|---|
| highest point on the `far_320` ray | 13.62° at **20 m** (the mound) | 13.16° at **125 m** (the headwall) |
| the lip at 20 m | 13.62° | 4.66° |
| ground out to 40 m | above the eye | below the eye, climbing from 45 m |
| `far_270` skyline | 10.10° at 180 m | 10.10° at 180 m |

**Checked from eye height on the path, not only from the capture station.**
`_headlook` marches from `path.posAt(d)` at 1.62 m, which is the walker, and the
head reads as a headwall from every station on the approach: 14.69° at 280,
12.65° at 300, 13.16° at 320. The playthrough's *"low dark ridge with bright sky
over it"* is gone — the frame now shows a wash floor converging into the head
with distant land visible **through** the notch rather than sky over a berm.

Guardrails: `far_270` grad/L 0.094 → 0.095, sat mean 0.486 → 0.487, V 0.480 →
0.483. `wash_mid` is byte-identical on both metrics — expected, since
`_headRise` returns 0 for z > −274 — and no measured colour target moved.

**Left for System 2, not a defect in their work.** Lowering the channel by 1.76 m
moves ground out from under the inner toes of the head aprons. At the shipped
width nothing shows, but their seating was computed against the old surface, so
if the breach is ever deepened those toes want re-seating rather than clamping.

### The injury that reproduced the trap exactly

`--injure`'s sixth breakage is failure #1 by its cause rather than its symptom:
`uThisWasNeverDeclared` injected into `wallR`'s fragment shader via
`onBeforeCompile`. Three.js logs `VALIDATE_STATUS false`, the program does not
link, and the wall stops drawing. What it measured is worth writing down, because
it is the trap in one line:

```
undeclared uniform @lit   gnd 90.0 (was 50.2)   R/G 1.781 (was 1.781)
```

**The chroma is identical to four decimal places.** With the wall gone the probe
is measuring the sky standing behind the hole, and the sky is warm at golden hour,
so every colour-based check reports a perfectly plausible number about a frame
with a hole in it — which is precisely what happened for real, at hue -147 with a
one-degree spread. `floorRG`, the check that catches a white ground with no
reference and no console error, is *blind* to this one. Two things caught it:
`gl.getProgramParameter(LINK_STATUS)`, asked of the driver directly, and
`skyOverGround` falling to 1.7 because the ground average had been contaminated
upward by sky. **The lesson is not that one check is better. It is that a colour
probe cannot tell you whether the thing you aimed it at is there**, so something
in the gate has to ask a question that is not about colour.

That injury runs last, and it is the only one whose position is fixed. Restoring
`onBeforeCompile` compiles a good program but the failed one stays in
`renderer.info.programs`, so `programs` kept firing against whichever injury ran
after it. An injury table that blames the wrong breakage is worse than a short
one.

## The second walkthrough, on a clean tree

`node tools/_walk2.mjs` walks the route at twenty-metre stations, closes to six
over the last forty, and captures thirty-two framings in one page load. It also
rephotographs the four framings I captured before tonight's light work landed, at
the same size, so there is a real before and after rather than a memory of one.

**The corridor is unaffected by the terrain that moved under it.** Re-derived
from the current height field: 346 samples, mean half-width 15.7 m, narrowest
7.4 m at the head. Driven, it is still not felt — 4.2 minutes of walking, |u|
peaking at 5.82 m off the line, **zero frames touched**, and the closest the
wander ever came to the soft band was 4.05 m of clearance. The eighteen strafe
and end-stop cases all hold to within 0.01 m of their limit.

The four rephotographs are worth recording precisely because they are boring:
every band, luminance and detail, is within 1-3% of the pre-change capture, and
`bend`'s far-ground luminance is 22.5 against 22.5. The near-ground detail is
down slightly and consistently — 0.345 to 0.317, 0.410 to 0.389, 0.439 to 0.412 —
which is the `gAmp` bed-amplitude re-tune arriving as expected, at the near end,
in the direction it was aimed. The changes that did land are elsewhere: the far
end of the route is markedly brighter (the gate's `far` framing went 23.4 to 45.1
on ground average across the morning) and `wall_shade` opened up enough to
contain sky at all, where it previously contained none.

### The last forty metres: much better, and now the softest thing on the route

> **The heading is now the opposite of true.** The third walk measures the last forty metres at
> **0.46–0.52 relative contrast from 292 m to 328 m, against 0.31–0.39 across the first hundred**
> — the highest wall detail on the route rather than the softest. The `head_up` outlier this
> section found at 0.16 is what the grit-normal fix was aimed at, and it now reads 0.2525. The
> measurement below was correct when taken; keep it as the *before*, not as the status.

It is rock. Red gravel bed, a proper channel narrowing into the box canyon, a
stratified far butte through the gap, and — this is the indirect-light work
showing — a shaded left bank at 322 m where the clasts are still legible instead
of being crushed to black. Nothing about it now reads as unfinished.

What is left is that the slopes flanking the head are the smoothest geometry
anywhere on the walk: big rounded forms with a streaky vertical grain that reads
closer to a dune than to sandstone, and no bedding at all. It measures, too. The
`wall` band's relative contrast is 0.38-0.40 all along the strip and **0.16 at
`head_up`, the lowest of all thirty-two stations** — less than half the route
average, and the only station that is an outlier rather than noise.

### The mid distance is still waxy, and the frames name the mechanism

> **Superseded — largely fixed. See "The 30 m detail cliff: fixed" and "The third walk".** The
> localisation below is correct and is what made the fix findable: it is the channel floor and the
> colluvial slopes, and the boundary is a distance rather than a place. What is stale is
> ~~"this one is not fixed"~~ and the implication that the 30 m fade is the mechanism to attack.
> The third walk reads the head slopes at **0.2525 against a 0.409 strip mean**, a ratio of 0.62
> where it was 0.41, and the mid-distance channel floor reads as gravel rather than wax. **The
> honest remaining limit is different in kind**: broad tonal banding from mesh undulation under a
> 15° sun, which is geometry and which no texture layer can remove.

This one is not fixed, and the useful part of this walkthrough is that it is now
specific rather than an adjective. **It is the channel floor and the low
colluvial slopes, not the walls.** The wall at 200 m is good — strata, rim
vegetation, uncrushed warm shade, relative contrast 0.83, the highest reading on
the route. The floor beyond the near field is not: at 240 m the bottom third of
the frame is pebbles, gravel and flakes, and from about the middle of the frame
onward the bed becomes a smooth waxy surface with no clast detail at all, with
the dome-like colluvial forms either side of the channel completely untextured.

The mechanism is named in `terrain.js`'s own comment — "the plastic that the fade
at 30 m already threatens". Beyond that fade the bed grain is gone, and beyond
the clast scatter radius the stones stop; where both have run out, which is
everything past the near field in a long straight, there is nothing left but
smooth shading. Near field sharp, mid distance waxy, and the boundary is a
distance rather than a place.

**A caution about measuring it, which cost a wrong answer here first.** The
horizontal-band metric says the mid distance at 200 m is as detailed as the near
field, 0.37 against 0.36, of a frame that plainly is not. The bands are innocent:
at pitch 0 the band containing the mid-distance floor also contains the cut
banks, the stratified walls and the rim vegetation, and they outvote the floor.
`tools/_detail.mjs --floor` uses narrow centred windows that see channel floor
only, and those do show it — far-floor contrast relative to near-floor runs
1.14, 1.14, 1.56 over the first hundred metres and 0.81, 0.77, 1.03 from 200 m.
Weaker than the frames look, and the window is small enough that its content
depends on where the channel happens to bend, so treat it as corroboration and
not as the measurement. **A band wide enough to be robust is wide enough to
average away the thing you are asking about**, which is the same failure as the
rectangle with no sandstone in it, arrived at from a third direction.

### A fourth white desert, by accident, and what it says about the thresholds

At 09:15 this morning the working copy — mid-edit, four agents live — rendered
the wash floor snow-white and untextured with the cliff walls, clasts and juniper
all correct. It was a transient of somebody's unsaved work and it was gone within
the hour, so it is nobody's committed defect. But it is the best possible test
case, because it is an *accidental* failure of exactly the class the gate exists
for rather than one I designed the gate around. The two frames are left in
`shots/_gateproof_whitefloor_40m.png` and `..._head.png`, but `shots/` is
gitignored, so the numbers below are the durable record and not the pictures.
The other thirty frames of that walk were deleted rather than kept: four agents
in this tree judge by the PNGs in `shots/`, and a set captured off a broken
working copy sitting among them is a contaminated measurement waiting to happen.

Run the gate's own floor thresholds against them:

```
shake_f040       floorRG 1.069   floorL 131.2   REFUSED (chroma and luminance)
final_f040       floorRG 1.555   floorL  98.2   passes
shake_head_up    floorRG 1.005   floorL 104.7   REFUSED (chroma only)
final_head_up    floorRG 1.651   floorL  48.2   passes
```

**Look at the third line.** A completely white, completely untextured desert, and
its luminance is 104.7 — comfortably inside the [6, 122] band, well below the
124.5 that the earlier white-desert state read, and closer to the healthy `floor`
framing's 90 than to anything a luminance bound could refuse without also
refusing legitimate builds. Every brightness-based check in the gate passes this
frame. `floorRG` reads 1.005 and refuses it outright.

The reason is geometric, not lucky. A white surface is white in a frame that got
brighter *and* in one that did not: which way the exposure moved depends on how
much sky was in shot and where the sun was, so brightness is a coincidence of
framing, while achromaticity is the failure itself. **The check that survives is
the one measuring the property that broke, not a property correlated with it.**
Tonight's three known failures were all found by luminance because all three
happened to be bright; the fourth was not, and it is the one that shows why
`floorRG` is the number to keep if only one could be kept.

## The FLOOR bounds were right and their stated reason was not

An audit caught `tools/gate.mjs` justifying its FLOOR bounds as *"what a dry wash
at an eleven-degree sun can physically be"* when **the scene ships at 15°**. The
audit's conclusion — bounds probably fine, derivation stale — is correct, and the
history says something worth having straight.

`SUN_EL_DEG` went 8° → 11° → 15°, reaching 15 at `b775e33` on 21 August at 23:14.
Every number in the gate was measured on 22 August. **So the bounds were never
derived from 11° at all; they were measured at 15° and described as 11°**, the
phrase carried over from an earlier session's language. That distinction decides
what the fix is. If they had been computed from 11° they would need recomputing.
Being measured, they need their provenance stated correctly and nothing else.

Re-derived at 15°, nothing moved, and here is why each side holds:

- The `MEASURED` bounds — `floorL`, `floorRG`, `contrast`, `whiteFrac`,
  `blackFrac`, `triangles`, `rockTris`, `calls`, and the healthy side of
  `groundAvg` — are readings off the shipped 15° scene. There is nothing to
  re-derive; the blessed reference *is* the measurement.
- The `FAILURE` bounds are the only ones the sun could touch, because the two
  white-desert readings of 124.5 and 155.8 may predate the move. They survive it
  **in the safe direction**: a higher sun puts more irradiance on a horizontal
  floor, `sin 15° / sin 11°` being about 1.36, so the same failure measured at 15°
  reads *brighter* and sits further outside the ceiling of 118, not nearer it.
  `skyOverGround`'s floor of 2.0 is a ratio and was measured at 15° directly
  (2.74 to 7.59), and a white ground still reads about 1.5 there.
- `floorRG` is the bound the sun has least purchase on of anything in the file,
  which is worth noticing while re-deriving. Raising the sun changes how much
  light lands on the floor; it barely touches the ratio between the channels
  coming back off it. The check that measures the property rather than something
  correlated with it is also the check that is robust to the scene changing
  underneath it.

Two corrections beyond the sun: the comment claimed skies of "170-205" where the
gate's own six framings measure 139.9 to 189.0, and the ground maximum was written
as 89.7 where it is now 90.0. Both are now the measured figures.

### The fix is a check, not a corrected sentence

A comment cannot notice itself going stale, and correcting this one leaves the
next reader exactly as exposed as I left this one. So `gate.mjs` records
`MEASURED_AT_SUN_DEG = 15.0`, imports `SUN_EL_DEG` from `src/atmos.js` in
preflight, and refuses if they differ:

```
FAIL  sun elevation        ships 15°, bounds measured at 11°
  · the scene ships at 15° and the FLOOR bounds and the reference were measured at 11°.
    The bounds are empirical, so this is not automatically a defect — but it means nobody has
    looked. Re-measure, confirm or adjust the bounds, update MEASURED_AT_SUN_DEG, and re-bless.
```

Proven by temporarily setting the constant to 11 and watching it refuse. The sun
is also recorded in `gate.ref.json` on bless. **This is the generalisable lesson
from a night that lost hours to measurements read later as targets: where a record
states a premise the code can check, make the code check it.** No bound moved, so
`--injure` was not re-run for a threshold change; the six injuries were last
watched to fire at `31e7a4b` and the bounds they exercise are unchanged.

## Two documentation inconsistencies, settled

> **Superseded within two hours, in the direction that makes the point.** Both strings now say
> **under a minute**, not forty seconds: the same probe read **49.0 s** an hour later, on a build
> that had grown while two agents worked on the two slowest phases. See "The third walk" — *a
> point estimate the build can outgrow between commits rots; a bound holds.* The reasoning below
> for preferring the measurement over the guess is right; picking a *point* was the mistake.

**Boot.** The loading screen said "About a minute" and the README said forty
seconds. Forty is the measured one and the screen was the outlier — six page loads
on 22 August, all after the texture phase was split into seven, ran 39 to 44
seconds from navigation to `__game`, and `main.js`'s own comments already said
"forty-odd". ~~Both now say forty seconds~~, and the comment beside the string says to
revise it from a measurement if it is ever revised.

`tools/_bootpaint.mjs` on the delivery build puts the in-page total at **41.3 s**
*(and at **49.0 s** two hours later — see "The third walk")*,
with the message on screen at 7 ms and the longest single stall 11.4 s. The split
did not lengthen the boot; it broke up the silence. The four phases worth knowing
are raising the canyon walls at 11.4 s, scattering the stones at 10.4 s, cutting
the wash at 7.8 s and compiling shaders at 5.5 s — between them 82% of the wait,
so anybody wanting a shorter boot has four places to look and not fourteen.

**`juniper.js` exports `PREVAILING`, not `WIND`.** The record had it as a should
and it had not landed. It was safe: nothing outside `juniper.js` imported it, and
the two internal uses are the tree's lean and its wind-piled litter. Verified with
`node --check` and `_p7pre.mjs`, which reports `ok juniper.js`.

The rename turned out to be worth more than tidiness, because the bare name had
already caused the confusion it was meant to prevent. `terrain.js:1252` documents
its `uWind` uniform as *"the shared WIND"* — and it is not this vector. It starts
from `TONIGHT_FALLBACK` and is then driven live off the audio wind through
`syncWind()`, which runs on `WIND_HEADING = 0.12` in `atmosphere.js` and
`audio.js`. That heading points about **seventy-six degrees** away from juniper's
(0.94, 0.34). So the old comment's claim that "System 5's saltation ribbons and
System 6's wind bed should agree with this; it is exported for that" was never
true of the shipped build — nothing imported it and the other systems run on a
different direction.

Two things follow, neither of which I have acted on. `terrain.js:1252`'s comment
is wrong and should say it is the audio wind; I left it alone because terrain was
live in that file. And **the juniper leans across a wind that the dust, the
saltation ribbons and the bed drift do not blow along.** That is a real
inconsistency rather than a naming one, it is nobody's mistake in particular, and
it is too large to start at half past ten on delivery day. It is recorded here so
it is not rediscovered from scratch.

## The `far_320` headwall streaks are not in the height field

> **Fixed at root — see "The 30 m detail cliff: fixed. The grit layer's normal, reprojected".**
> This section and the three that follow it are the elimination chain that found it, and every
> exclusion in them held. Read them for the method, not for the status: the headwall streaking is
> no longer an open defect. The one hypothesis below that was *wrong* — the world-XZ plan
> projection — is killed in the next section by the render it asks for.

Not landed, and reverted. What follows is what was eliminated, so the next
person does not spend their first hour where I spent mine.

The critic reads the upper headwall as *"long, parallel, soft-edged streaks…
brushed hair, drizzled candle wax… no bedding, no facets, no shadow terminator,
no scale cue"*, and gives the diagnostic that **the streaks cross what should be
separate landforms without breaking**. That points at something applied in a
space that does not know about landforms, which is right, and it points *away*
from the two height-field terms that look guilty. Both were tested and both are
innocent:

| ablated | expectation | result |
|---|---|---|
| `rill`, `ridged(z*0.19, x*0.022)` — grooves every 5 m in z, near-constant over 45 m in x, and carried by `0.62*ramp + 0.85*wall` with a **single phase across both landforms** | the obvious suspect, and it matches the "crosses without breaking" detail exactly | **streaks unchanged** |
| `gully`, `ridged(x*0.085, z*0.016)` — flutes every 12 m in x running 62 m in z, i.e. parallel lines down the wall converging in perspective, and named "converging" in its own comment | matches "flow down and to the left, converging at the base" | **streaks unchanged** |

Two independent ablations, each a real geometry change (triangle count moved),
each leaving the signature untouched. **The streaks are shading, not landform.**
That is also what "no shadow terminator inside them" was telling us, and I should
have weighted it higher than the two terms whose comments happened to use the
critic's vocabulary — a term that *describes* itself as converging gullies is not
thereby the converging thing you can see.

They are also visible in `ao1_far_320`, from before the breach, so the arrival
geometry did not cause them and reverting it would not remove them.

**The untested candidate, stated so it can be tested rather than believed.** A
world-XZ (plan) projected shading term smeared across a steep face produces
exactly this: soft parallel streaks down the fall line, converging in
perspective, indifferent to landform boundaries because the projection is
indifferent to them, and with no relief of its own so no terminator inside them.
`terrain.js` has a triplanar branch with a blend weight for precisely this
problem. **The next step is one instrumented render painting that blend weight,
to see whether the streak region is being fed by the stretched horizontal
projection.** I did not get to it; it is the first thing to do, and it is cheap.

### The grit layer's slope gate, verified safe and reverted as no-benefit

Separately: `floorB` and `floorM` both carry `smoothstep(0.34, 0.12, slope)`, so
the far-field grain layer — the one term designed to carry detail past the grain
fade at 30 m — is **switched off entirely on anything steeper than a gentle
grade**. That includes the colluvial slopes flanking the head, which the
playthrough measured as the only outlier station on the route at 0.16 relative
contrast against 0.38–0.40. The gate excludes the surface the layer exists to
serve, which still looks like a real defect.

Widening it to `smoothstep(0.75, 0.45, slope)` (rock and wall still excluded,
only the slope cutoff moving to near-vertical) is **measurably safe**: `ground`
and `wash_mid` come back byte-identical on both bands — the gate was never
binding on a flat floor — and `far_270` colour is identical to three decimals.
It is also **measurably worthless on its own**: no visible change to the head
slopes, and zero movement on the mid-distance floor it was also meant to help.
Reverted on that basis rather than on risk. It buys nothing and would have cost
System 7 a reshoot.

That last point is the honest correction to my own reasoning: I inferred the
slope gate was the cause of the smooth head slopes from reading the mask, and
the render says the slopes are smooth for some other reason. **Reading a gate
and concluding it is binding is the same error as quoting a metric without its
population** — the tenth instance tonight, and the second I have committed
myself.

### Mid-distance floor, for the record

~~Untouched and unfixed.~~ **Fixed later the same morning, and this paragraph is the reasoning
that pointed at the fix.** The grit layer was measured contributing 3.9% of the mid
band's energy, so reaching the per-band `hf9` reference from 0.0716 needs roughly
4.7x its amplitude, which at that footprint is a noise risk rather than a detail
gain. There is gradient headroom there — mid `grad/L` is 0.121 against a 0.12–0.16
band — so the room exists; ~~the mechanism to spend it does not yet~~.

> The mechanism was there and was not being read: `makeGrit` packs a normal in `G,B` and
> `terrain.js` read only `R` and `A`. The headroom named above is exactly what was spent —
> `wash_mid` mid `grad/L` 0.1220 → **0.1374**, inside the same 0.12–0.16 band. The amplitude
> question this paragraph frames as a noise risk was real and was settled by the terminator-crossing
> predictor rather than by eye. See "The 30 m detail cliff: fixed".

### Tooling note

`tools/glslcheck.mjs` does not parse the JavaScript that wraps the shader, so a
backtick inside a shader template literal passes it and fails only in the page.
That cost one seven-minute render tonight and it is the fifth instance of this
exact failure. `_p7pre` catches it. Run `_p7pre`, not `glslcheck`, before any
capture that follows an edit inside a template literal.

### Correction: my `--only` guard broke the no-flag path

Commit 133365e taught `shoot.mjs` to refuse a partial `--only` match. It also
broke omitting the flag entirely: the default was `''` while the guard tested
`only !== null`, so no flag read as an explicitly empty list, and every caller
that does not pass `--only` — including `tools/postpair.mjs`, i.e. the full-pool
path — died instead of shooting the pool. Another agent found and fixed it; the
fix is theirs and I have not touched it.

Worth recording against the tool-hardening thread rather than quietly fixing,
because the failure is instructive in the same way the others were. **I tested
every path I was thinking about and not the one I was not** — three invocations,
all of them passing `--only`, because `--only` was what I had just changed. A
guard added to a flag is a change to the behaviour of *omitting* that flag, and
that is the case least likely to appear in the tests written alongside it.
Tonight's count of tools taught to refuse rather than quietly answer a different
question is five; this is the first where the refusal itself became the defect.

## The `far_320` streaks, localised to the shading normal by elimination

> **This section is right and the defect it localises is now fixed** — see "The 30 m detail cliff:
> fixed". "The defect is an absence, not a presence" is the sentence that found it. Only the
> closing recommendation is stale: it names the `grainF` fade and the grit slope gate as the two
> knobs, and the next section proves the fade cannot work at that range. The knob that worked was
> a third one — the grit layer's unread normal channels.

The specified diagnostic was run. **It killed the candidate**, and a second cheap
render then narrowed the cause considerably. Nothing landed; `src/` is clean.

**The triplanar is not under-engaged.** Painting `steep`, `1 - sandW` and their
product `w` into the frame shows the streaked upper slopes as pure white — slope
gate fully open, sand classification zero, **triplanar blend weight 1.0 exactly
where the streaks are**. The plan-projection-smear hypothesis is dead. It was a
good hypothesis: it explained the soft parallel form, the perspective
convergence, and the indifference to landform boundaries. It is simply not what
is happening.

Worth noting how seductive it was. The triplanar branch exists *specifically*
for this artefact and its own comment reads: *"every feature smears into a long
streak, all of them parallel, and the bank ends up looking brushed."* That is
the critic's complaint almost word for word, written next to the code that
prevents it — and the code is working. **That is the third naming coincidence
tonight**, after the two height-field terms whose comments matched the critic's
vocabulary and were innocent.

**The albedo is clean.** Painting `gA` alone shows fine, even, granular texture
across those slopes with no streaking of any kind. So the streaks are not in the
surface colour; they are in how it is being lit.

| eliminated | how | result |
|---|---|---|
| `rill` (height field) | ablation, triangle count moved | streaks unchanged |
| `gully` (height field) | ablation, triangle count moved | streaks unchanged |
| triplanar blend weight | painted `steep`, `1-sandW`, `w` | 1.0 on the streaks; fully engaged |
| albedo | painted `gA` | clean; no streaks present |

**What that leaves, and why it is consistent.** The streaks are in the shading
normal or in an occlusion term. There is a specific reason to suspect the
normal: inside the triplanar branch the detail normal is blended as
`mix(vec3(0,0,1), pN, 0.16 + 0.84 * grainF)`, and at this distance `grainF` is
zero, so **84% of the detail normal is faded out and the shading is driven by
the interpolated mesh normal almost alone.** A surface lit by a smooth
interpolated normal with no detail normal on it, over a slope with long-
wavelength height variation, gives exactly what the critic reports: soft
parallel tonal bands with no bedding, no facets, no terminator and no scale cue,
following the fall line and converging in perspective, and crossing landform
boundaries because the mesh normal field does not know about them either.

This also reconciles the two innocent ablations. `rill` and `gully` change *which*
undulations exist; they do not change the fact that at this distance nothing but
the mesh normal is shading them. Removing one set of undulations leaves the
others reading the same way.

**The next test, cheap and specified.** Paint `gWN` as RGB in the same slot. If
the streaks are visible in the normal field, the cause is the mesh normal and
the fix is in the `grainF` fade on the triplanar branch — the same 30 m cliff
already documented as the mid-distance limit, arriving here as a *far*-field
defect on a steep surface, where it matters more because the slope faces the
light. If the normal is smooth, paint `tAO` and `gRake` next; it is an occlusion
term.

Not attempted: the fade is the term I was told three times not to reopen in the
near field, and reaching for it at 11:10 on delivery morning, against a record
already shot, is not a decision to take at speed. It is a small change in one
place with a clear hypothesis and a one-render test, and it is the first thing
to do.

### The rule this earns

Numerical coincidence and **naming** coincidence are the same trap. The 24 cm
that matched the sand ripple and the bed spacing exactly cost an evening; three
times tonight a term whose *comment* matched the reported symptom pulled
attention away from an observation that already ruled its whole category out.
Here that observation was **"no shadow terminator inside them"**, which says
shading rather than geometry before any ablation is run, and which I ranked
below two comments that happened to use the word converging. Rank the
observation that discriminates between categories above the one that matches
vocabulary.

### And the normal field is smooth, which inverts the problem

One further render, painting `gWN`. The upper slopes come back **glassy** —
broad, soft, long-wavelength undulation and no fine detail anywhere on them —
while the near floor in the same frame is visibly stippled with pebble relief.
The streak-shaped tonal bands *are* present in the normal field, but only as
gentle lobes; at a 15 degree sun grazing that slope, a small normal deviation
produces a large luminance swing, which is the amplifier turning soft undulation
into hard-looking streaks.

**So the defect is an absence, not a presence.** There is no streak-making term
to find and remove. What the frame shows is the generic appearance of *any*
smooth undulation lit at grazing incidence with no detail normal on top of it —
and that is precisely why both height-field ablations came back innocent. `rill`
and `gully` each change which undulations exist; neither changes the fact that
nothing finer is shading them. Remove one and the others read identically.

The critic's phrasing turns out to be literally accurate rather than
metaphorical: *"There is no rock inside them."* There is no detail normal inside
them. `0.16 + 0.84 * grainF` with `grainF` at zero removes 84% of it, and the
grit layer that is supposed to stand in past that fade is gated off on slope by
`floorB`/`floorM` — the gate whose widening was measured safe earlier tonight
and reverted as worthless *on its own*. It may not be worthless in combination
with a fade change; that pairing is untested and is the obvious thing to try.

**Restated for whoever takes it:** do not hunt for the term drawing the streaks.
Put detail back on far, steep, granular surfaces. The two knobs are the `grainF`
fade inside the triplanar branch and the slope gate on the grit layer, and the
one-render test for any candidate is the `gWN` paint — if the upper slopes stop
being glassy, it is working. This is the same 30 m detail cliff already
documented as the mid-distance floor limit, arriving as a far-field defect on a
steep surface, where it costs far more because the slope faces the light.

## The fade was tried, and the blocker is the mip chain, not the weight

> **This is the section that redirected the fix, and the fix it specifies landed** — see "The 30 m
> detail cliff: fixed". Its closing sentence, *"give the footprint-locked grit layer a normal
> contribution on far steep ground"*, is what shipped as `GRIT_N`. Nothing here is stale; it is
> recorded as a negative result and it is the most load-bearing negative result in the thread.

Authorised, built, measured, reverted. `src/` clean. The result is the most
useful thing in this thread because it rules out the whole family of fixes I had
just recommended.

**The change.** Inside the triplanar branch, `0.16 + 0.84 * grainF` became
`0.16 + 0.84 * max(grainF, farG)` with `farG = smoothstep(0.014, 0.035, footG)`
— an identity rather than a tuned number, restoring at distance exactly the
weight the near field already gets. `max` makes the near field byte-identical
*by construction*: `farG` is exactly zero below a 14 mm footprint, outside
ground's mid band at 12.1 mm, so the expression is `grainF` there and nothing
downstream can differ. Paired with the grit layer's slope-gate widening.

**It did nothing to the headwall.** `far_320` is visually unchanged. The reason
is not the weight and could not have been fixed by any weight:

> The triplanar dirt normal is projected at world scale — `vWPos.zy * 0.3846`,
> about 2.6 m per tile. At 125 m the footprint is of order 100 mm, which is
> roughly twenty texels per pixel, so the mip chain has already averaged that
> map to flat before the blend weight is applied. **Raising the weight of a
> texture the filter has already removed recovers nothing.**

That is a different limit from the one in the record. The documented 30 m cliff
was about `grainF` fading the term out. This says that even with `grainF`
defeated, a **world-locked** texture cannot carry detail at that distance, because
its screen-space frequency falls with range by construction. The fade is not the
cause; it is downstream of the cause, and removing it changes nothing.

**What this implies for the fix, and it is a redirection.** Detail at 125 m has
to come from a **footprint-locked** layer — one whose UV scale tracks the
footprint so its features stay a constant size in screen space. The project
already has exactly one: the grit layer, whose `gLod`/`gSc` do precisely this and
which is faded *in* with footprint for this reason. It is the right mechanism
and it is in the right place. **It has no normal component** — it drives an
albedo mottle and a socket term only, and the streaks are a shading defect that
albedo cannot reach, as the clean `gA` paint showed.

So the fix is: give the footprint-locked grit layer a normal contribution on far
steep ground. That is a real change to the surface shader, not a constant, and
it wants measuring against the gradient band and the binary-field trap. It is
not a delivery-morning change, and it is now specified.

**Near-field gate, reported precisely rather than as a verdict.** Against a
same-HEAD clean baseline, `ground` differs on 0.38% of pixels confined to y
0.00–0.08 — the far skyline — and `wash_mid` on 8.44% at y 0.33–0.76, the mid
distance and its banks. Both measured floor bands are unchanged to four decimals
on every column. So the near field held, and the change did reach the mid
distance; it simply did not help where it was aimed. Reverted regardless, because
the frame it was authorised for is unchanged and an unverified 8% of `wash_mid`
is not something to ship at 11:15 against a record already shot.

## The rule: three naming coincidences in one night

**A comment that describes the symptom is evidence about the author's intent,
not about the current behaviour** — and the code most likely to carry that
description is the code written to *prevent* it. Three instances tonight:

1. `rill` and `gully` — the latter's comment names converging gullies, and the
   critic reported streaks converging at the base of a gully. Ablated: innocent.
2. The **triplanar branch**, whose own comment reads *"every feature smears into
   a long streak, all of them parallel, and the bank ends up looking brushed"* —
   the complaint almost verbatim, beside code that measured at full weight and
   working correctly. It exists for this artefact. It is not causing it.
3. The **24 cm** that matched the sand ripple wavelength and the bed spacing
   exactly, and was neither.

The numeric and the verbal case are the same failure. In all three, an
observation that discriminated between *categories* was available and outranked
by one that matched *vocabulary*: here, "no shadow terminator inside them" said
shading rather than geometry before any ablation was run. Rank the discriminating
observation first; a matching name is the weakest evidence in the room.

---

## The 30 m detail cliff: fixed. The grit layer's normal, reprojected

**Status: landed.** `src/terrain.js`, `GRIT_N = 1.4`. This is one change for the
two worst remaining defects — the `far_320` headwall streaking (critic's
number-one finding) and the mid-distance floor waxiness — which the previous
round established are one defect seen on a slope and seen flat.

### What was actually wrong: an unread channel

`makeGrit` packs **`R` = tone, `G` = normal x, `B` = normal y, `A` = ao**.
`terrain.js` read `gr.r` and `gr.a` and *never read `G,B` at all*. `rock.js` has
always read them, as `domApply((gr.gb - 0.5) * 1.9, gN)`. So the one layer in the
shader whose feature size is held constant in screen space — `gLod`/`gSc` key it
to `footG`, which is why it is faded *in* with footprint — was contributing an
albedo mottle and a socket term and no shading whatsoever.

Everything else in the ground shader is world-locked and is flattened by the mip
chain long before 100 m. Past a 40 mm footprint `grainF` has faded the dirt
normal to its 0.16 floor and the mesh normal shades the surface nearly alone:
broad undulation with no relief on it. Under a 15° sun a small normal deviation
is a large luminance swing, so on a slope facing the light that undulation reads
as long parallel streaks, and it crosses landform boundaries because the
undulation does. **The defect was an absence, which is why ablating `rill` and
`gully` each came back innocent.**

### The correction inside the correction: the grit layer needed reprojecting too

First attempt read `gr.gb` directly and was invisible at `GRIT_N` 1.0. Rather
than assume it was too weak, it was driven to **6.0** as a discriminator. The
head came back *combed into long parallel fibres* — and the grit map is an
isotropic worley packing, so **an isotropic map can only produce parallel marks
if the projection is stretching it**. `gUV` is world XZ, exactly as the dirt's
was before the triplanar branch was added for it. The layer brought in to break
the streaks was delivering its detail already aligned with them.

Fixing it is the reprojection the dirt layer already has, applied to the same
map, inside the existing `steep` branch and reusing its `pw` and `pdx/pdy`:
four `texture2DGradEXT` fetches, gated on `gritNK > 0.002` so no near or flat
ground pays for them. **The mechanism was right and the projection was wrong,
and the amplitude sweep is what separated those** — at 1.0 "no effect" and "wrong
space" are indistinguishable; at 6.0 they are not.

### Results

| | baseline | shipped (1.4) | band |
|---|---|---|---|
| `ground` near+mid, every metric | — | **identical to 4 dp** | — |
| `ground` near field pixels | — | **byte-identical** y 0.17–1.00 | — |
| `wash_mid` near, every metric | — | **identical to 4 dp** | — |
| `wash_mid` mid `grad/L` | 0.1220 | **0.1374** | 0.12–0.16 ✓ |
| `wash_mid` mid `hf9/L` | 0.1796 | **0.1958** (+9%) | detail arriving |
| `ground` hue / `wash_mid` sat | — | **unmoved** | — |

`far_320`: the continuous combed fibres are gone from the headwall, replaced by
discrete lit facets with dark between them. The broad tonal banding from the mesh
undulation remains — that is geometry — but the critic's actual complaint,
*"there is no rock inside them: no bedding, no facets, no shadow terminator, no
scale cue"*, is answered: there are now facets and terminators at grain scale.
**This is a partial fix of the streaking and a full fix of the absence.**
`far_220` and `far_270` both improve, their mid floors carrying granular detail
where they went waxy.

### Byte-identity by construction, not by measurement

`gritNK = smoothstep(0.020, 0.045, footG) * (1 - rockW) * (1 - wallM)`. The onset
is chosen against measured footprints rather than tuned: `ground` samples its
near and mid bands at 9.1 and 12.1 mm and `wash_mid` its near at 17.9 mm, so the
gate is **exactly zero** on all three and nothing downstream can differ by a bit.
It first carries weight in `wash_mid`'s mid band at 28.4 mm — the population the
gradient headroom belonged to — and saturates on the `far_320` head at ~100 mm.
Same pattern as the `gridK` work and the `max(grainF, farG)` attempt: *state the
gate in the units the guardrail is measured in, and the guardrail cannot be
violated by arithmetic.* Verified: 0 differing pixels below y 0.17 on `ground`.

No slope gate, deliberately. The two defects are one defect seen flat and seen on
a slope, so gating on slope would have fixed half of it by construction.

### Amplitude: chosen by the trap predictor, not by eye

`tools/_gritn.mjs` runs the binary-field guard offline before any render. RMS
tangent slope has the trap at 0.8 and never came close (1.4 → 0.181). **The
predictor that bound the choice was the terminator-crossing fraction**, which is
the one `_rakeprobe` says actually predicts salt and pepper:

| `GRIT_N` | RMS slope | past terminator |
|---|---|---|
| 1.0 | 0.129 | 0.1% |
| **1.4 (shipped)** | **0.181** | **1.7%** |
| 1.9 | 0.246 | 6.1% |
| 2.2 | 0.284 | 9.7% |

2.2 was rendered and rejected **by eye on `far_270`**, whose mid floor came back
as high-contrast hash with too many fully-dark texels — torn straw rather than
gravel — at the same time as its `grad/L` (0.1508) was still comfortably inside
the band and its RMS was a third of the trap. *The gradient band and the RMS trap
both passed a setting the eye refused.* That is the fourth instance of `hf/lf`
and its relatives being blind to this family, and the first time the
terminator-crossing column has been the one that agreed with the eye — at 9.7%
against 1.7%. **Rank that column, not RMS, when the sun is grazing.**

### For whoever picks this up

- `rock.js` reads these channels at **1.9** on a close face and is fine there,
  because the trap is a property of *grazing* light and not of the map.
- The remaining `far_320` banding is mesh-normal undulation under a 15° sun. It
  is a height-field or a light-angle problem, not a texture one; no detail layer
  will remove it, only put material on it.
- `tools/_banddiff.mjs` exists now because `pxdiff`'s frame-wide figure cannot
  distinguish "gate leaking into the near field" from "gate working as specified
  in the far strip" — on a floor framing, **bands are distances**, and a
  distance-gated change can only be verified per band.

## The third walk: the two worst things are fixed, and the clock moved

Walked end to end at 2560x1440 on the delivery build, 32 stations, plus the
corridor simulation and a boot probe. Both defects called out on the first walk
are gone, one measurement moved that nobody was watching, and the ending is now
the most detailed part of the route rather than the weakest.

**The mid-distance waxiness and the weak head were one defect and it is fixed.**
The first walk measured relative contrast on the head slopes at 0.16 against
0.38-0.40 elsewhere — a ratio of 0.41 against the route. The same station now
reads 0.2525 against a strip mean of 0.409, a ratio of **0.62**. Half the deficit
closed. Visually the change is not subtle: the combed vertical fibres on the head
slopes are replaced by discrete lit clasts, and the mid-distance channel floor
that read as wax now reads as gravel. The stated limit is honest and visible —
broad tonal sweeps from mesh undulation under a low sun remain on the mid-distance
floor, and they read as softness even though the grain is now there. That is a
smaller complaint than the one it replaced, and it is geometry.

**The last forty metres now carries the highest wall detail on the route**: 0.46
to 0.52 from 292 m to 328 m against 0.31 to 0.39 across the first hundred. The
route used to fall off a cliff at the end and now rises into it.

Note when comparing these figures: **relative contrast is a per-pixel Laplacian
and scales with resolution**, so a number taken at 1600x900 cannot be set beside
one taken at 2560x1440. `tools/_walk2.mjs` now takes width and height as
arguments for that reason. What survives the resolution change is the *ratio
between stations of one run*, which is what both readings above are.

**Boot has grown from 41.3s to 49.0s and nobody noticed.** An hour after the
loading message was set to "about forty seconds" on six measurements of 39-44s,
the same probe reads 49.0s: `Raising the canyon walls` 14.0s (was 11.4) and
`Scattering the stones` 12.5s, exactly the two areas that were being worked. The
message and README now say **under a minute**, because a point estimate the build
can outgrow between commits is worse than a bound — under-promising leaves the
reader watching an apparently-stuck screen for the overrun, which is the failure
the loading screen exists to prevent. **A bound holds while a point estimate
rots.** This is the same lesson as the 11-degree comment: a figure in prose cannot
notice the thing it describes moving. The difference is that the sun bound could
be handed to the gate and this one cannot cheaply, so it was made vague instead.

Corridor unchanged after terrain moved under it again: 4.2 minutes of wandering
walk, 0 frames touched laterally, closest approach 4.05 m of clearance, and the
head of the wash still the only place it is felt.

## The arrival lift, and why it is a budget rather than a controller

The walk ends against a headwall worth seeing which, walked at eye level, is not
seen: the hummock underfoot fills the bottom of the frame. Pitched up twelve
degrees the same spot reads as an arrival. Nothing in a walk with no UI prompts
you to raise your view, so `arrivalLift` in `main.js` eases it up over the last
forty-five metres.

**Eye height was not the lever it looked like.** The audit suggested raising it
on the grounds that 1.55 m is short for a standing adult. `EYE` is **1.65 m**;
1.55 is the walking *speed* in m/s, two hundred lines further down. 1.65 m is an
ordinary standing eye height and raising it would have been unjustified, so the
fix is the pitch easing and not the height.

Three properties keep it a nudge and not a camera take-over, which matters
because there are no cutscenes here and there should not be one at the end:

- **It is spent from a budget.** `lifted` accumulates everything ever applied and
  the ramp is a ceiling on it, so total authority over the whole walk is twelve
  degrees and not one more. Look down afterwards and it stays down — the budget
  is gone and nothing pushes back. A controller holding a target would fight the
  mouse for as long as you held the view, and *that* is what reads as being
  taken over. The distinction is the whole design.
- **It only moves while walking forward.** At rest it is exactly inert, the same
  property that makes `confine` a fixed point and that every capture depends on.
- **It is keyed to distance remaining**, not to a place, so it follows the head
  if the path is re-cut.

**The record is unreachable from it, and that was proved rather than argued.**
The capture harness drives the camera with `walkTo` and `lookAt` and never
presses a key, so the strong form of "are the framings unmoved" is not "do they
match another build" but "can walking move them at all". `tools/_lift.mjs` reads
all thirteen camera world matrices, walks from 280 m to the head with W held
until the entire budget is spent, and reads them again: **all thirteen
bit-identical**. Sixteen numbers per framing is the whole framing, and comparing
matrices is stronger than comparing pixels because it cannot be satisfied by a
coincidence of tone mapping.

Measured ramp, jogging in: 0.00° at 280 m, 0.19° at 290, 2.86° at 302, 7.19° at
313, 11.54° at 327, 11.92° at the head. The smoothstep is doing the work it was
chosen for — no perceptible onset and no snap at the top.

## The lift, derived offline, and a number of mine that was wrong

The GPU stopped being ours mid-task — the user started a game, `.gpu` came out
and `.unattended` went in — so the rest of the lift's justification was done in
Node against the real height field, which is where it should have been done
first. `tools/_lookup.mjs` marches the field forward from the eye along the
centreline and measures two angles per station: the elevation of the highest
ground within six metres (the hummock underfoot, below which every ray lands on
something you could touch) and the elevation of the skyline ahead. With a 58°
vertical field of view the fraction of frame height eaten by near ground is then
closed form.

**It corrected me.** I reported that at eye level in the last metres "the bottom
60% of the frame is the hummock you are standing on". The geometry says **41%**.
The impression was right and the number was invented, and the number is the part
that would have been quoted. The lift takes the worst case from 41% to 28%.

It also says the implemented ramp is more than the geometry strictly needs — 11.9°
at the head against 9.3° wanted — and that this costs nothing, because the
skyline sits at 13.7° and the frame is ±29°, so there is no ceiling anywhere near
where the ramp operates. The onset is later than the ramp assumes: near ground
runs 22–28% of frame for the whole approach and only becomes distinctive past
s=306, about twenty-five metres out, not forty-five. The gentler forty-five metre
ramp covers it anyway and starting later would need a steeper curve, which is the
thing that would be felt.

**The tool reports at half a degree and refuses at three, and that gap is the
design.** A quarter of the frame is taste — I chose it — so a check that failed on
half a degree under it would be policing my own preference and would be tuned
away rather than believed. Three degrees inside the ramp's own window is a claim
about the geometry instead. Losing the skyline is not taste at any size, so that
refuses on the first degree.

## Running the gate when the machine is not ours

`gate.mjs --preflight` runs everything that does not need a GPU and stops: parse,
module evaluation, shader source, the scene build, the walker simulation, the
sun-elevation guard. It exists because a browser rendering this scene comes
straight out of a game's frame rate, and because under software rasterisation
every colour bound in the file is measuring a frame nobody will ever see — it
would refuse a good build or bless a bad one with equal confidence.

**It is not a substitute for the gate and it says so on the way out.** It cannot
see a black frame, a white desert or an unlinked program. A build that has only
passed the preflight has not passed the gate.

---

## The pale flat slabs: the dust film now scales with the proud fraction

**Status: landed, CPU-side, census-verified. Visual confirmation outstanding.**
`src/scatter.js`. System 2's fix #1, which was the right one of the three.

### Why fix #1 and not #2 or #3

All three would have moved the number. #1 is the only one that corrects the
*interaction*, which is what actually broke: the sky-facing dust dates to the
21st, the burial to `9320488` this morning, and **neither is wrong alone**.
`resid` ramps the film *up* with radius because a big clast lies still longest,
which is true; but the same size classes are the deeply seated ones, so the
stones given the most film are the ones showing the least of themselves. The
product was the defect.

Decisively, it is written **against the seat rather than as a constant**, so it
cannot drift out of agreement with the burial the way #2 and #3 would - the dust
now follows the seat wherever the seat goes. That is the same shape as the apron
breach: an identity, not a tuned onset. Tonight produced this regression and
three separate bugs from constants that had to agree in two places; a fix with no
such invariant is worth more than a fix with a good number in it.

It is also the only one of the three that is entirely CPU-side and therefore
verifiable tonight on a machine that is being played on.

### The mechanism is fully determined on the CPU

Worth recording because it is not obvious from either end: `dustK` **is** `aDust`
verbatim. The vertex stage packs it as `vSeat = normalize(seat) * (1 + aDust)`
and the fragment stage recovers it as `length(vSeat) - 1`. So

    cDust = (0.34 + 0.66 * smoothstep(-0.12, 0.52, n.y)) * min(0.80, 0.42 * aDust)

and on the up-facing facet, where the orientation term is 1.0 and where the
defect is reported, the delivered film is exactly `min(0.80, 0.42 * aDust)`.
**No shader change was needed and none was made.** `tools/_dustfilm.mjs` prints
that quantity per class; `_slabwho` prints the raw weight, which is not the same
thing.

### Before and after, s 0..100 m

Delivered film on a sky-facing facet. 0.80 is the cap - four fifths of the way to
a constant colour.

| class | before p50 | before MAX | after p50 | after MAX |
|---|---|---|---|---|
| `cobble3` | 0.058 | **0.800** | 0.031 | **0.458** |
| `block0` / `block2` / `block3` | 0.010 | **0.800** | 0.007 | 0.44-0.60 |
| `boulder0/1/2` | **0.243** | 0.513 | 0.136 | 0.349 |
| `slab1` | 0.180 | 0.712 | 0.095 | 0.405 |
| `gravel*` | 0.000 | 0.124 | 0.000 | 0.089 |

`cobble` is the class that matters - 3600 instances, ~1730 in the first hundred
metres - and it comes off the cap to 0.458. The floor was chosen to land it
there because **0.45 is where System 2 independently put it** by dropping the
shader cap; two mechanisms agreeing on a number is better evidence than either
alone, and it is the smaller of the two candidate changes, which is the right way
round for the one that cannot be seen tonight.

### Guardrails, proved offline

`_slabwho 100 14` before and after is **identical in every column except
`dust`** - instance count, pale count and pale%, dip, aspect, `seat`, mean
albedo RGB, hue and saturation all unchanged to the printed precision. So:

- **The burial is untouched.** `seat` is identical (boulder0 -0.173 both runs).
  `buried` was only *hoisted* above the dust weight so both terms could read it;
  `sink` and `hTrue` are not reassigned between the old and new call sites.
- **No CPU-side colour movement.** `setColorAt` is unchanged, so the per-instance
  albedo written into the scene is bit-identical.

**Outstanding, and it needs a frame:** the film is a *shader* effect on top of
that albedo, so the rendered floor colour on `wash_low` / `ground` will move by
design, and `grad/L` on those framings is not measurable from the CPU. Those two
guardrails are unverified.

### A measurement error in the instrument, worth recording

`_slabwho`'s `t` column prints the instance **y scale** (`halfH`), not the clast's
true vertical half-extent, which is `halfH * cl.flat` with `flat` running
0.42-0.86. Reading `t` as thickness overstates it by up to 2.4x. That is what
produced "a 0.52 x 0.34 m stone has about 6 cm standing proud" - the true figure
is nearer 2-3 cm, and the coarse classes are 85-95% buried rather than ~75%.
`scatter.js` already carries a long comment recording this exact confusion
causing a shipped bug once tonight; it has now caused a misread of the evidence
as well. Same trap, second visit, different instrument.

## The near-field quilted cross-hatch: scatter's grain layer is ruled OUT

> **The quilt is still unattributed - do not stop reading here.** This section
> clears three specific properties of the clast grain layer and is still correct.
> A fourth property of the same expression was proposed afterwards, the two
> octaves being in registration with each other, and that was investigated and
> also came back negative. See *"The octave crossfade"* below, which supersedes
> nothing here but is where the open question and the one-render test now live.

By reading plus one offline measurement, no render.

1. **Its tiling cannot be visible.** The layer samples `uGrit` on a world-locked
   planar projection, so the map repeats every `1/gScC` metres - about 0.25 m in
   the near field, which is exactly quilt scale, and was the reason to suspect it.
   But a tile repeat is only visible in proportion to the map's *low-frequency*
   content, and `makeGrit`'s is negligible: energy at k <= 3 is **0.150%** of
   total for the tone channel and **0.034%** for occlusion, amplitude 0.0025 and
   0.0015. Through `1.0 + (grC.r - 0.427) * 1.30` that is about **one code
   value**. The map is mean-removed per octave by construction, which is why.
2. **It cannot produce per-instance seams.** `gUVc` is world position, not an
   instance UV, so adjacent clasts sharing a facing sample one continuous field.
3. **It cannot produce hard LOD bands.** `gLodC`/`gFlC` are crossfaded by
   `mix(..., gLodC - gFlC)`, and in any case iso-footprint contours on a floor
   are 1D bands, not a cross-hatch.

The hard triplanar branch (`aWc.y > max(aWc.x, aWc.z) ? ... : ...`) *is* an
unblended discontinuity and would give abrupt direction changes across facet
boundaries - but on the near-field floor almost every clast is sky-facing, so the
branch does not flip there. It is a flank effect, not a floor one.

**A discriminating prediction for whoever takes this next, free of charge:** if
the pattern were any footprint-keyed texture layer, its world-space period would
**step by powers of two with distance**, because `gScC = exp2(-floor(gLod))`. A
joint azimuth grid has a period fixed in world space and independent of distance.
One crop at two distances separates them without a new render.

---

## The octave crossfade: the identity is provable, the fix is a translation

**Status: not landed. `src/` untouched.** The continuity property System 2 asks
about is real and provable by reading. The efficacy is not, and I can show by
substitution why.

### The identity holds

For `mix(tex(uv*s + k*n), tex(uv*s*0.5 + k*(n+1)), frac)` with `n = gFlC` and
`s = exp2(-n)`, at a level boundary `gLodC -> m`:

- from below, `gFlC = m-1` and `frac -> 1`, giving the coarse tap
  `uv*2^-m + k*m`;
- from above, `gFlC = m` and `frac -> 0`, giving the fine tap `uv*2^-m + k*m`.

Identical. Level continuity stays an identity rather than a tuned onset, exactly
as claimed. One correction to the rationale: a *constant* offset added to both
taps would also preserve continuity - it just would not do anything, because it
translates both taps equally. What breaks continuity is an offset applied to one
tap only. The level-accumulating form is needed for efficacy, not for seamlessness.

### But it cannot decorrelate the pair, and that is algebra

Put `A(p) = f(s*p + c1)`, `B(p) = f(s*p/2 + c2)` and substitute `q = s*p + c1`:

    A = f(q),    B = f(q/2 + (c2 - c1/2))

**For any pair of constants, B remains a half-scale copy of A displaced by one
constant.** The proposed offset changes that constant from 0 to
`kPhase*(gFlC/2 + 1)`. It moves where the two octaves coincide; it does not stop
them coinciding. A translation commutes with the scaling relationship, so it
cannot break it.

Measured, sweeping a one-texel window along a lattice cell (`tools/_octnode.mjs`):

| variant | peak local tap correlation | at |
|---|---|---|
| as shipped | 0.827 | 0.066 m |
| translation, kPhase 0.618034 | 0.788 | **0.331 m** |
| rotation, 90 deg per level | 0.751 | 0.405 m |

The peak moves and does not shrink. That is the signature of a phase change.

### And the mechanism is not measurable offline at all

`tools/_octphase.mjs`, on the real map at two realistic footprints:

- **Global tap correlation 0.008.** The two octaves are uncorrelated.
- **The coincidence is a point, not a patch.** `A = B` requires
  `p == 2(c2-c1)/s (mod 2/s)` in *both* axes at once, so the nodes are isolated;
  and because A traverses the map at twice B's rate they decorrelate within about
  one fine texel, which at `gScC = 4` is **0.98 mm on a 500 mm lattice**. There is
  no finite region where the two taps agree.
- **The one strong periodic term is not the pair.** Autocorrelation 0.287 at
  exactly 250 mm is tap A's own tile repeat: the predicted value for a mix of a
  tile-periodic and a non-periodic tap at `frac = 0.62` is
  `(1-w)^2/((1-w)^2+w^2) = 0.27`. Its visibility is bounded by the map's
  low-frequency energy, measured this morning at **0.15%**, about one code value.
- At `gScC = 2, frac = 0.5` the offset makes both measured structure metrics
  slightly **worse** (contrast CoV 0.090 -> 0.108, peak AC 0.013 -> 0.025).

### Why I have not landed it

The standard set was "land it if the identity is provable by reading". The
identity is provable; the efficacy is disprovable, and that outranks. Landing a
change to a frozen tree that costs a reshoot, when substitution says it relocates
rather than removes and no measurement shows a benefit, is the same call as the
slope gate reverted as *measurably worthless rather than measurably risky*.

**None of this touches System 2's observation.** The 13 px and 20 px families in
the frame are real, their frustum enumeration stands, and their 2.35 m lattice is
correctly excluded at fifty times too coarse. What is not established is the
mechanism, and the defect is unattributed again.

### The cheap decisive test, for when a frame is free

The claim is that the artefact needs *both* octaves contributing, which is why it
is said to be worst where `frac ~ 0.7` and clean at wall range where the weight
sits near an endpoint. **A single octave cannot be in registration with itself**,
so forcing the crossfade weight to an endpoint decides it.

The test: replace `gLodC - gFlC` with a literal `0.0`, shoot; then `1.0`, shoot.
Two renders, no other change. Run it on `far_320` as well as the reported clast
framing, for the reason in the three-site note above.

The two outcomes, and both are worth having:

- **The quilt survives either endpoint.** The octave pair is exonerated. The
  artefact is a property of a single tap - the map, the projection, or the
  footprint keying - and the search moves there. This is the outcome my offline
  work predicts.
- **It vanishes at both endpoints and returns in the middle.** The mechanism is
  confirmed against my analysis, and the fix is the rotation below rather than
  the translation. In that case my measurements were looking for an extended
  correlation that the artefact does not have, and the note about `A = B` being
  a point rather than a patch is where the error would be.

Same shape as the triplanar-weight paint that cleared the blend weight earlier:
one instrumented render that can only come back with a useful answer.

### And if it is confirmed, the fix wants an operation that does not commute

A rotation applied per level preserves the identity for the same reason the
offset does - the coarse tap at level `n` is transformed by `R^(n+1)`, which is
what the fine tap at level `n+1` is transformed by - while breaking the scaling
relationship rather than its phase. A 90 degree, two-cycle rotation is a
component swap and a negate, no transcendentals:

    vec2 rA = mod(gFlC, 2.0) < 0.5 ? gUVc : vec2(-gUVc.y, gUVc.x);

Offered as the corrected form, not as something to land unseen.

### THREE sites carry this expression, and terrain's is the dangerous one

Read this before touching any of them.

| site | reads the mix into |
|---|---|
| `scatter.js:811` | clast tone and cavity - where the artefact was *reported* |
| `rock.js:1961` | wall tone and cavity - System 2's, deliberately untouched |
| **`terrain.js:1500`** | tone, cavity **and, since `3dbeefa`, the shading normal** |

It is three instances, not two, and they are not equivalent in consequence.
`terrain.js`'s became load-bearing this morning: `3dbeefa` began reading
`gr.gb` from that same mixed sample as a detail normal on far ground. So if this
mechanism is ever confirmed, terrain carries it into the **normal field** rather
than only into tone and cavity - a periodic structure in shading under a 15
degree sun, which is a materially worse failure than the one that was reported
and lands on the far slopes that fix was written for.

The corollary for the ablation below: **run it on `far_320` as well as on the
reported clast framing.** A `frac` ablation on scatter alone would clear the
reported instance and leave the worse one untested.

---

## The octave ablation: run, and the octave pair is EXONERATED

**Result: the quilt survives both endpoints at full strength.** A single octave
cannot be in registration with itself, so the two-octave crossfade is not the
mechanism. This was the outcome the offline analysis predicted, and it means the
quilt is **unattributed again with its strongest suspect eliminated** - which is
the more important half of the result.

Run on the GPU path at HEAD `7c0cbfc`, working tree carrying only another
agent's `tools/shoot.mjs`. `gLodC - gFlC` was forced to a literal at **all three
sites at once** - `scatter.js:811`, `rock.js:1961`, `terrain.js:1500` - because
the question was whether the mechanism exists at all, not which site owns it.
Frame hashes moved on every variant, so the ablation was live. `src/` was
restored immediately afterwards and is clean.

### The numbers, on System 2's own instrument and their own reported object

`tools/_lattice.mjs` on the `ground` boulder, identical bands across the three
frames. This is internally controlled: same frame, same bands, one variable.

| band | family | shipped | `frac = 0` | `frac = 1` |
|---|---|---|---|---|
| upper face | 28.3 px @ 8 deg | r 0.235 | r **0.239** | r 0.195 |
| lower face | 34.5 px @ 68 deg | r 0.386 | r **0.441** | r 0.354 |
| lower face | 30.1 px @ 6 deg | r 0.352 | r **0.427** | r 0.326 |

The two crossing families survive at **identical periods and angles**, and at
`frac = 0` they are the *strongest* of the three. Same on `far_320`, where the
lower band is 34.4 px @ 26 deg at r 0.105 / 0.102 / 0.097 across the three -
unchanged to within noise. Shooting `far_320` mattered: clearing only the
reported clast framing would have left terrain's normal-field instance untested.

By eye at 4x on the boulder face, the dark stipple is present in all three; it
changes character slightly with the octave, as it must, and never goes away.

### What this does and does not settle

- **Settled:** the octave pair is not the mechanism. The proposed phase fix is
  now doubly dead - it was a translation of a relationship it could not break,
  *and* the relationship was not the cause.
- **Settled:** the `A = B` is a point, not a patch reasoning stands. Had the
  quilt vanished at both endpoints and returned in the middle, that is where the
  error would have been; it did not, so it holds.
- **Not settled:** what draws the quilt. Still open.

### The next hypothesis, labelled as one

The families are two crossing directions at a roughly fixed screen period, on a
surface whose texture comes from a **world-planar projection sampled at close to
one texel per pixel by design** - `gLodC = log2(cFootG * 256.0)` targets exactly
that, and the comment beside it says so deliberately: *"slightly under a texel
per pixel ... is the sampling rate at which mip level zero is actually used"*.

One texel per pixel is the Nyquist edge. A stochastic texture sampled there
aliases, and the alias of a planar-projected grid on a tilted facet is **two
crossing families whose angles are the screen projections of the texture's u and
v axes** - which is the shape of what is measured. That would also explain why it
survives a single octave, why the period is screen-constant rather than obeying
perspective, and why it is worst on a large tilted near-field facet.

**The test is the same shape and one render:** add a constant to `gLodC` - `+1.0`
samples at half the frequency, well clear of Nyquist - and see whether the
families collapse. If they do, the fix is an LOD bias and the cost is a little
softness in the grain, traded against a regular pattern. If they do not, this
hypothesis dies with the others and the projection itself is next.

I have **not** run it: the ablation was the authorised turn on the lock and
others are queued behind it.

---

## The Nyquist test: NEGATIVE. And the grit layer is eliminated entirely.

`+1.0` on the LOD at all three sites, one render (`nyq1`), GPU path, HEAD
`9a94490` with a clean tree. `src/` was unchanged since the `ab0` baseline, so
that baseline still stood and the test cost exactly one render.

**The families did not collapse, and they did not double either.** They held at
*identical periods and angles*, with r down about a fifth:

| band | family | shipped | LOD `+1.0` |
|---|---|---|---|
| upper face | 28.3 px @ 8 deg | r 0.235 | r 0.200 |
| lower face | 34.5 px @ 68 deg | r 0.386 | r 0.311 |
| lower face | 30.1 px @ 6 deg | r 0.352 | r 0.288 |

That double negative is the informative part. `+1.0` halves the grit sampling
frequency: a **texture feature** would have doubled to 56-68 px, and a **Nyquist
alias** would have vanished. Neither happened. A pattern whose screen period is
invariant to a 2x change in the layer's sampling scale is not drawn by that
layer.

Combined with the octave ablation, two independent properties of the grit layer
- its octave structure and its sampling scale - have now been changed with no
effect on period or angle. **The grit layer is eliminated.** The r drop of a
fifth is its genuine contribution to the band's *energy*; it contributes
texture, but it does not draw the families.

### The instrument's noise floor, measured before anything was read into it

A 30 px lag inside a 55 px band has little overlap, so `_lattice.mjs` was run on
clean floor in the same frame with no reported quilt. At the same band size
(160x60) it returns r 0.128-0.142; at 300x150 it falls to 0.081-0.105. So small
bands inflate r, and the floor for these bands is **r ~= 0.14**. The boulder's
0.386 is roughly 2.7x that and is real signal.

**This also corrects the far_320 reading.** Its families sit at r 0.081-0.176,
at or barely above the floor. far_320 should not be treated as the same defect
on this evidence; the strong, real instance is the near-field clast, which is
what was reported in the first place.

### The attribution that now fits, with the arithmetic

`scatter.js:626`, in the vertex stage:

```glsl
float uvK = clamp(iRad * 34.0, 1.0, 18.0);
vMapUv *= uvK;    // and vNormalMapUv, vRoughnessMapUv
```

The clast's albedo, normal and roughness maps are tiled a **fixed number of
times across the hull**. That count is per object - not per world metre, not per
pixel - so the screen period is the object's screen diameter divided by the
count, it does not change with range, and **nothing in the grit layer can move
it.** Those are exactly the invariances the two ablations kept running into.

`tools/_uvk.mjs` projects the capture camera and reports the instances whose
screen disc covers the measured band:

| instance | iRad | screen dia | uvK | predicted period |
|---|---|---|---|---|
| `scour` | 0.631 m | 533 px | **18.0** (clamped) | **29.6 px** |
| `scour` | 0.444 m | 341 px | 15.1 | 22.6 px |
| `scour` | 0.277 m | 192 px | 9.4 | 20.4 px |

Measured: **19.0, 28.3, 30.1, 34.5 px**. The dominant instance predicts 29.6
against 28.3 and 30.1 measured, and the smaller ones predict 20.4-22.6 against
19.0. Two independent families, both matching within a few percent, from a
mechanism whose invariances were already established by the ablations.

Note the ceiling: `iRad * 34` is 21.5 for the dominant instance and is **clamped
to 18**, so every large clast carries the *same* repeat count regardless of
size. That is a mechanism for one consistent pattern across all the biggest
stones, which is what a quilt across the boulders is.

This is also **scatter-only**. `rock.js` and `terrain.js` have no `uvK`, so if
this is confirmed, terrain's normal field is not exposed to it - which retires
the worry recorded against the three-site note.

### The pre-registered test, not run

One render, and a **positive** prediction rather than a vanish: halve `uvK` and
the periods must **double**, 29.6 px to about 59 px, at unchanged angles.

- If they double, it is attributed.
- If they hold at 28-34 px again, the tiling dies with the other two and the
  remaining suspect is the hull geometry itself.

Not run: the authorised test was Nyquist, it returned a negative so there is no
trade to decide, and the performance measurements need an idle machine.

---

## The uvK test: `uvK` is causal, and my period arithmetic was coincidence

One render (`uvk5`), `uvK` halved in `scatter.js:626`, GPU path, HEAD `a5bd14b`,
`src/` unchanged since the `ab0` baseline so that baseline still stood.
`far_320` came back **byte-identical** (`#ebb7a1e4`), a clean control confirming
the change is scoped to clasts and confirming the earlier correction that
`far_320` is not this defect.

### First, a trap I walked into and caught

`_lattice.mjs` searches lags to `MAXD = 34`, so **no period above ~34 px on an
axis is findable.** The prediction under test was "the period doubles to about
59 px", which the instrument could not have seen: a family moving *out* of range
is reported identically to a family that went away. The first measurement showed
a collapse and that collapse was uninterpretable.

This is the **third** time an instrument has answered a question I did not ask,
and all three are one family: the window not matching the question. A global
coefficient averaged a point-coincidence away, a one-axis fold never landed on a
two-axis node, and now a search range shorter than the predicted answer. Added
`--maxd` as an **opt-in** argument, default unchanged, so every number already in
the record still means what it meant.

### Re-measured with a range that can see a doubling

Band 220x190 on the boulder, search to 80 px. Floor for this band size, from
clean floor in the same frame: **r ~= 0.084**.

| family | `ab0` shipped | `uvK` halved |
|---|---|---|
| **29-31 px @ 6-8 deg** | **r 0.172** | **gone** (below 0.098) |
| 39.1 px @ 3 deg | r 0.132 | r 0.127 |
| 70-73 px @ -9 deg | r 0.103 | r 0.099 |
| *predicted 59-62 px* | - | **nothing** |

**What is established:** halving `uvK` destroys the dominant family. This is the
*first and only* change that has moved it. The octave ablation and the LOD change
both left period and angle identical; this removes the strongest family outright.
By eye the boulder face changes from an even, regular stipple to a coarser and
more irregular one. **`uvK` is causal.**

**What is falsified:** my pre-registered prediction. The period did **not**
double, and nothing appeared near 59-62 px. The other two families are unmoved,
so this is not a global softening.

So the simple model - screen period = screen diameter / tile count - is **wrong**,
and with it the arithmetic that made this the strongest lead. Predicted 29.6
against measured 28.3 and 30.1 was **a coincidence**. That is the third numerical
coincidence to be seductive today, after the 24 cm ripple match and the octave
lattice, and it is the one I was most confident in. A quantitative match earns a
test; it does not substitute for one.

**Where that leaves the mechanism:** `uvK` sets how hard the base maps are
minified across the hull, not only how many times they repeat. At 18 the maps are
minified severely; halving reduces that. A minification artefact would be
destroyed by the change without its period being the tile period - which is
exactly the pair of results observed. That is a hypothesis and it has earned
nothing yet.

### The trade, for the coordinator

`uvK` is causal, so a fix exists, but lowering the count is the wrong lever: it
trades the pattern for texel density on the largest stones, in the strongest
stretch of the walk, and the clamp at 18 exists to hold that density.

**A per-instance rotation or offset of the hull UVs is the better candidate**,
because coherence *across* stones is what makes a weave read as manufactured, and
it costs no density on any one stone. Note this test does not bear on it: the
measurement is on a single instance, so it says nothing about inter-instance
coherence either way. That needs its own framing and its own test.

---

## far_320 striations: diagnosed from source and geometry, two defects, no render

The grit normal exposed a defect that was always in the mapping, as System 7
suspected. It is **two** defects, both in the reprojection I added, and both are
measurable offline. `tools/_dipaniso.mjs` measures them on the real height field.

### 1. The reprojection gate straddles the crossover, and engages on the wrong side

A planar projection on a tilted surface is undistorted along strike and
stretched along **dip** by one over the cosine of the angle between surface and
projection plane. For a slope at theta:

- XZ projection (the default): stretch `1/cos(theta)`
- the vertical pair: at best `1/sin(theta)`

**These cross at exactly 45 degrees.** Below it the XZ projection is the *less*
stretched one. But the gate is

```glsl
float steep = smoothstep(0.14, 0.40, 1.0 - gN.y);   // 30.7 deg to 53.1 deg
```

so it begins at 31 degrees and is already at 0.36 average weight in the 38-45
band - blending **toward the more stretched projection, along the dip line**,
which is the direction the striations run.

Measured over far_320's headwall:

| slope | n | mean `steep` | XZ stretch | vertical | delivered | |
|---|---|---|---|---|---|---|
| 31-38 | 779 | 0.07 | 1.22 | 2.67 | **1.30** | harmful |
| 38-45 | 957 | 0.36 | 1.33 | 2.26 | **1.66** | harmful |
| 45-53 | 459 | 0.78 | 1.48 | 2.19 | **2.00** | harmful |
| 53-90 | 154 | 1.00 | 1.84 | 2.00 | **2.00** | harmful |

**The reprojection increases the stretch on every sloped band it touches.** At
38-45 degrees it delivers 1.66 where doing nothing would deliver 1.33.

It is harmful even above 45, and that is a second-order bug worth naming: `pw =
ax/(ax+az)` blends the two vertical projections **linearly**, so a slope facing
diagonally gets the average of two bad projections rather than the better one.
`triW` two lines above already uses `pow(abs(gN), 4.0)` for exactly this reason
and the grit branch does not use it.

**This predicts the reported severity ordering before being told it:** 36.0% of
far_320's sloped samples are in the harmful regime against **23.7%** of
far_270's, and far_270 is reported mild while far_320 bites.

### 2. The tangent frame does not know which projection supplied the sample

`gr.gb` is a tangent-space normal in the **texture's own u,v**. Under ZY those
are world Z and Y; under XY, world X and Y. But:

```glsl
vec3 tsToWorld(vec3 n, vec3 N){
  vec3 ax = abs(N.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  ...
```

builds its frame from world X regardless, so nothing carries the projection's
axis choice into the interpretation. Measured angle between the axis the texture
means by u and the axis it is applied along, over the reprojected surface:
**mean 41.2 degrees, max 90.0.**

The frame is orthonormal, so this is a rotation and not a stretch - which is why
"stretched tangent frame" was close but not quite it. The consequence is worse
than a stretch: combined with defect 1 the features are elongated along dip
*and* the shading gradient is rotated to run along the fibre rather than across
it. Long, fine, parallel, softly-lit - which is what silk is.

### Why the fix still looked right this morning

It did help, and the record is not wrong: the headwall went from glassy to
faceted. That gain came from **reading the normal at all**, which was the actual
absence. The reprojection shipped alongside it as a correction to the UV
stretch, and it is the part that is wrong - it addressed the right problem in
the wrong direction and its damage was hidden under the much larger gain.

### The candidate fix, and why it is a fix rather than an attenuation

Two lines, both principled, neither a tuned onset:

1. Gate the grit reprojection at the **crossover** rather than across it -
   engage above 45 degrees (`slope > 0.293`) instead of from 31.
2. Sharpen the vertical blend with the `pow(...,4)` weighting `triW` already
   uses, so a diagonal slope gets the better projection rather than the mean of
   two worse ones.

Defect 2 needs the frame to be derived from the projection actually used. That
is a change to `tsToWorld`'s contract and is the larger of the two.

**Slope-gated attenuation remains the fallback and would be a compromise, not a
fix** - it would trade the striations back for the glassiness on exactly the
faces the grit normal was added to serve.

### Pre-registered diagnostic, one render, not yet run

Ablate the grit reprojection only - keep XZ on steep ground, changing nothing
else. **Prediction: the striations reduce markedly on far_320**, because by the
table above the ablation lowers delivered stretch from 1.66-2.00 back to
1.33-1.84 on the bands that dominate the frame. If they do not reduce, defect 1
is not the driver and defect 2 carries it alone, which changes which fix to
take first.

Held: performance has four measurements that need an idle machine and has not
reported.

### Second item: why the dust fix could not have reached `shade_far`'s corner class

The proud-fraction term is **multiplicative**:

```js
const resid  = clamp((rad - 0.075) / 0.16, 0, 1);
const dustW  = resid * (0.30 + 2.85 * clamp((paleL - 0.33) / 0.19, 0, 1))
                     * (0.48 + 0.52 * (1 - buried));      // <- this morning's fix
```

`resid` is **zero for any clast under 0.075 m radius**, and zero times the new
term is still zero. So for those classes the fix is a no-op *by construction* -
this is not a gate that fails to reach them, it is a scaling applied to a
quantity that is already nothing.

The census at s 175 shows which classes are in that state - mean `aDust` 0.00 on
`granule0-2`, `gravel0-4`, `scour`, `collar` and `talus0-3`, against 0.10 on
cobble, 0.22-0.30 on slab and 0.32-0.37 on boulder.

**The consequence matters more than the mechanism:** if the corner class carries
no dust, then its paleness is **not the dust film** - it is the per-instance
lithology. System 7's numbers are consistent with that, since saturation barely
moved (0.362 to 0.364) while the fix demonstrably worked everywhere it had
something to scale. The lever for that class is the pale fraction of the
lithology mix, and `MIX_TRANSPORTED` is recorded earlier in this file as never
having been thinned while `MIX_LOCAL` was, for this exact complaint.

**Not yet attributed:** which class actually draws those corner pixels.
`_pixowner` answers it in one render and should be folded into the next turn
rather than argued from the picture. Two candidate readings - a sub-75 mm class
with no dust to scale, or a pale lithology in a larger class - and they take
different fixes, so the render is worth waiting for.

A note against the tool: `_slabwho` prints mean albedo as 0.000 when a mesh has
no `instanceColor`, which is indistinguishable from a genuinely black instance
colour. `talus0-3` print that way. I nearly attributed a different path from it
before noticing `dip`, `aspect` and `seat` were non-zero on the same rows. The
zeros should be printed as a dash.

---

## The reprojection ablation: my prediction was falsified, and inverted

Pre-registered: *"striations reduce markedly on far_320"* with the grit
reprojection ablated. **They increased sharply.** With XZ retained on steep
ground the whole headwall combs into long heavy fibre; the shipped frame is
mild by comparison. Renders `rp0` (ablated) against the `ab0` baseline, which
was still valid because `src/` had not moved since it was taken.

**The reprojection is load-bearing and must not be removed.** That is the
opposite of what my analysis said, and the analysis was wrong in a way worth
recording.

### Where the model went wrong

`_dipaniso.mjs` computes the **geometric stretch of the texture** on a tilted
plane, which is real and correctly calculated. It is not the quantity that makes
the streaks. What smears the surface is the **anisotropy of the sample
footprint** under a grazing view: on a steep face seen near edge-on the XZ
projection's footprint is enormously elongated, the filter averages along that
axis, and the result is a smear along the dip. The vertical projections have a
far rounder footprint on the same face, which is why swapping to them helps.

So the model measured a real thing that was not the mechanism, and being
quantitative did not save it.

**And I over-claimed the corroboration.** I presented "predicts the severity
ordering, 36.0% against 23.7%" as though it discriminated. It does not: far_320
simply has more steep ground than far_270, so *any* slope-driven mechanism
predicts that ordering. It was consistent with my model and with every rival,
and I read it as support. That is the fourth instrument-shaped error today and
the first where the instrument was my own reasoning rather than a tool.

### The tangent frame is real, and is not the driver either

Defect 2 measured true - the frame is built from world X regardless of which
projection supplied `gr.gb`, a mean 41.2 degrees off and up to a quarter turn.
Implemented properly as `tsToWorldAx`, with the axis matched to the dominant
projection (`world Z` when `|N.x|` leads on steep ground, `world X` otherwise),
which is byte-safe in the near field because `gritNK` is zero there.

Rendered as `tf1`. **By eye the striations are essentially unchanged**, and the
directional autocorrelation on the lit slope is ambiguous rather than improved.
It is a correctness fix with no demonstrable benefit, so it is **not landed** -
the tree is frozen and a reshoot costs more than an invisible correction is
worth. The code is described here so it can be picked up:

```glsl
vec3 gAx = (steep > 0.006 && abs(gN.x) >= abs(gN.z))
         ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
gWN = tsToWorldAx(normalize(vec3((gritGB - 0.5) * (GRIT_N * gritNK), 1.0)), gWN, gAx);
```

### What the ablation actually points at, untested

Since the reprojection **helps**, the candidate it suggests is the inverse of my
original proposal: apply it *earlier and harder* rather than later. `steep =
smoothstep(0.14, 0.40, slope)` delivers only 0.36 average weight across the
38-45 degree band that dominates far_320, so most of the frame is getting a
third of a treatment that works. Bringing that to full weight, and sharpening
`pw` with the `pow(...,4)` weighting `triW` already uses, is the untested lever
- and performance has just reported 26% headroom, so a fourth fetch pair is
affordable in a way it was not this morning.

**Not run.** It is a new hypothesis after two failed ones and it needs its own
turn rather than a rushed change on a frozen tree.

## `shade_far`'s corner class, attributed by render

`_pixowner` on the two palest corner pixels:

- `0.010,0.927`  rgb 237,219,183  ->  **`gravel3`** (hiding it gives 222,180,135)
- `0.058,0.897`  rgb 220,161,111  ->  **`scour`**

Both are classes the census puts at **`aDust` 0.00-0.01**, because `resid =
clamp((rad - 0.075) / 0.16, 0, 1)` is zero below a 75 mm radius. So the
proud-fraction term multiplies nothing and the morning's fix is a no-op on them
**by construction** - confirmed by render, not inferred.

**Their paleness is per-instance lithology, not the dust film.** The lever is the
pale fraction of the mix, and `MIX_TRANSPORTED` is on record earlier in this file
as never having been thinned while `MIX_LOCAL` was, for this exact complaint.
That is a one-constant change on a CPU path with an offline census to verify it,
and it is the right next item for this defect.

---

## `MIX_TRANSPORTED` thinned — landed, verified offline

The colours were already on target and were not touched: the pale entries were
brought to 1.2-1.3x the matrix deliberately and measure 1.18, 1.24 and 1.31.
What had never been done is what `MIX_LOCAL` had done to it for this same
complaint — its **share**. Cut by value rather than saturation, following the
file's own diagnosis that *"a pale and neutral clast is the combination that
reads as concrete"*: the three bright-and-desaturated entries halved, the two
buffs trimmed, weight to the local red family and the two dark entries.

|  | before | after |
|---|---|---|
| pale share (census criterion) | 0.320 | **0.215** |
| bright-pale (Coconino, caprock, quartz) | 0.130 | **0.065** |
| local red family | 0.370 | 0.455 |
| sum | 1.0000 | 1.0000 |

All ten lithologies keep a share; the polychrome scatter is the point and
flattening it to red is the opposite mistake. Local red at 0.455 still matches
the "about half" the existing note claims.

**Census, s 0-175 m** - the classes `_pixowner` attributed the corner pixels to:

| class | pale% before | pale% after |
|---|---|---|
| `gravel3` | 27.5% | **22.5%** |
| `gravel0-4` | 27.5-29.6% | 22.5-23.9% |
| `granule0-2` | 27.7-28.4% | 22.1-23.1% |
| `cobble0-3` | 23.6-28.2% | 18.7-21.7% |
| `collar` | 14.4% | 14.4% (unchanged) |
| `pavement0-2` | 12.1-15.6% | 12.1-15.6% (unchanged) |
| `block0-3` | 24.0-29.9% | 24.0-29.9% (unchanged) |

The unchanged rows are the control: they draw `MIX_LOCAL`, `MIX_BLOCK` and their
own mixes, and they are identical to the digit. The change is scoped exactly to
the mix that was edited.

**Reported honestly: the instance-count effect is smaller than the share cut.**
The share fell 33% relative and the pale instance count fell **18%** relative,
because the census's criterion is on the final per-instance albedo after jitter
and dusting rather than on the raw lithology draw, so entries migrate across the
boundary in both directions. The share is the thing that was changed; 18% is the
thing that was delivered.

`FAR_COL` moves with it by design - it is documented as *"computed rather than
guessed so it tracks the palette"* - by **-4.6% luminance**, with saturation
rising 0.601 to 0.628. That is the intended direction and not a colour
regression, but it is a real change to the far-field convergence colour and is
recorded as such.

**Visual confirmation rides along with the next capture; it does not need its own.**

---

## far_320 striations: SHIPPED AS A KNOWN DEFECT. Read this first.

**The positive finding, which is the one that matters to anyone editing this
code: the grit reprojection is LOAD-BEARING. Do not remove it.**

It is gated by `steep = smoothstep(0.14, 0.40, 1.0 - gN.y)` in `terrain.js` and
it looks wrong - it opens at 31 degrees, saturates at 53, and a plausible
geometric argument says it blends toward the *more* stretched projection below
the 45 degree crossover. I made that argument, quantified it, and it is wrong.
Ablating the reprojection makes the combing **dramatically worse**: the whole
headwall goes to heavy fibre and the shipped frame is mild by comparison. The
model was computing the geometric stretch of the texture on a tilted plane,
which is real and is not the mechanism; what smears is the anisotropy of the
*sample footprint* under a grazing view, and the vertical pair's footprint is
far rounder on a steep face.

A pre-registered prediction that comes back **inverted** is the strongest form
that result can take, and it is the reason this paragraph exists. If you are
reading that gate and it looks wrong to you, it looked wrong to me too. Render
the ablation before you touch it.

**The decision:** ship the mild combing. The fallback - a slope-gated attenuation
of `GRIT_N` - would buy the combing back **only by removing grain from exactly
the faces the grit normal was added to serve**, trading away the far-field
detail that took the last forty metres from the weakest part of the route to the
most detailed. That is a worse frame, precisely and not merely arguably. A
defect with three eliminated hypotheses, a known-harmful fallback and a written
account of what was tried is a legitimate thing to deliver.

### Pre-registering a prediction: BOTH halves, and the second is the skippable one

Stated once and then broken twice in one afternoon, so it is written out in full:

1. **The prediction must be able to distinguish.** A result every rival
   hypothesis also predicts is not evidence. The severity ordering between
   far_320 and far_270 followed from far_320 simply having more steep ground, so
   it was consistent with every slope-driven mechanism, and I read it as support.
2. **The prediction's region must carry enough sample to be observed.** This is
   the half that is easy to skip. I predicted byte-identity above 53 degrees when
   only **3% of far_320's sloped samples are above 53 degrees** - 154 of 5163, in
   my own table earlier in this file. The prediction was untestable for want of
   sample, and an untestable prediction returning a null reads exactly like a
   confirmed one.

Both failures are the same thing: **confidence calibrated against a prediction
that cannot fail.** It is the same shape as the performance gate calibrated from
samples taken on a contended machine, which therefore certified contention as
rest and survived a fourteen-commit bisect, an explicit A/B and two written
corrections. **Nothing below a bad gate can detect a bad gate**, and a
prediction is a gate on belief.

The second failure happened *immediately after* I diagnosed the first, which is
the useful part rather than the embarrassing one: it demonstrates that rule 1
alone is insufficient guidance.

## The three hypotheses, each with a render, each dead

1. **The reprojection is the stretcher.** Falsified and *inverted* - see the
   section above. It is load-bearing; do not remove it.
2. **A rotated tangent frame.** Real and measured: `tsToWorld` builds its frame
   from world X regardless of which projection supplied `gr.gb`, a mean 41.2
   degrees off and up to a quarter turn. Fixed correctly as `tsToWorldAx` with
   the axis matched to the dominant projection, byte-safe in the near field
   because `gritNK` is zero there. **Visually null.** A correctness fix with no
   demonstrable benefit is not worth a reshoot on a frozen tree, so it is not
   landed; the code is recorded above for pickup.
3. **The reprojection is under-applied.** Gate narrowed from `smoothstep(0.14,
   0.40, slope)` to `smoothstep(0.14, 0.24, slope)`, taking full weight from 53.1
   degrees down to 40.5 - the inverse of hypothesis 1 and following the
   ablation's empirical direction rather than a model. `pw` was deliberately
   **not** sharpened in the same render, because it acts on all steep ground and
   would have destroyed the discriminating signature. **Striations essentially
   unchanged.** Reverted.

The one untried lever is the `pow(...,4)` sharpening of `pw` on its own, the
only part of the reprojection path not yet varied. Not run: three failures is a
complete answer and a fourth guess on a frozen tree is not worth the reshoot.

A methodological note for whoever picks this up. The diff on hypothesis 3 came
back at 22-68% of pixels in every horizontal band, which looks like a clean
falsification of the byte-identity prediction and is not one - see the
pre-registration section above for why. Do not read that number as evidence
about the mechanism; it is evidence about the prediction.

**Decision taken: ship the mild combing.** Recommended on the reasoning above and
accepted. The fallback - a slope-gated attenuation of `GRIT_N` - would work only
by removing grain from exactly the faces the grit normal was added to serve,
trading the far-field detail that took the last forty metres from the weakest
part of the route to the most detailed. That is a worse frame, not a better one.
This is a decision on the evidence, not an unfinished item.

## What the gate is blind to: a sparse population inside the band

**A banded-mean instrument cannot see a change carried by a sparse population
within its band.** This is a property of the gate, not an incident, and it should
be read alongside every green verdict it ever gives.

The worked example is the delivery build. The transported lithology mix was
thinned — pale share 0.320 down to 0.215, about 18% relative delivered because
the census criterion is post-jitter albedo — and `FAR_COL` moved with it,
luminance −4.6% and saturation 0.601 to 0.628. The `far` framing looks straight
at that colour. It came back **identical to every digit**: median, p99, sky,
ground, floor luminance and floor chroma all unchanged. The `floor` framing did
move, and in the right direction — luminance 99.6 to 99.1, R/G 1.728 to 1.733,
slightly darker and slightly redder, which is what removing pale material does.

Nothing was wrong. `uFarCol` is applied to the *scattered clasts* as they
converge at range, so the pixels carrying the change are a thin scatter inside a
band whose statistic is a mean over everything else. **The gate certified that
nothing moved outside its bands. It did not certify that the far-field colour
change looks right, and it could not have.**

This is the third instrument this week to fail in the same shape, and naming the
shape is worth more than the three fixes:

- `hf/lf` is blind to a regular mid-frequency pattern, because the ratio spans it.
- A patch chosen by eye is not a population, so it cannot speak for one.
- A banded mean is blind to a sparse population inside the band.

Each time, the measurement window did not match the question. It is a different
failure from a wrong bound and it does not announce itself: the instrument
returns a confident number that is true about the thing it measured and silent
about the thing you asked. When a change is known to be carried by a minority of
pixels, **look at the frames.** A green gate is assurance that nothing broke
loudly, not that an intended change landed well.

And note that `FAR_COL` is *derived* from `MIX_TRANSPORTED` in `scatter.js`, not
set beside it. The palette shift and the lithology thinning are one edit with two
consequences and they are not separately tunable — anyone reaching for one of
them is reaching for both.

## `rockTris` is the ablation check, and it earned its column

`rockTris` reads 544k identically across all six framings and unchanged from the
morning's run. It is easy to read that as a column of scenery, so name what it
does: three ablations were forced and restored in `scatter.js`, `rock.js` and
`terrain.js` during one afternoon's investigation, and a forced ablation that
survives its revert is a stray literal suppressing geometry. That is precisely
what a scene-graph-wide count of rock triangles refuses, and it is why the count
is taken over the whole graph rather than over what the frustum happened to keep.
It was added to catch `rock missing`, which frustum culling had let past a
per-frame triangle count; the afternoon gave it a second and more likely job.

---

# The black clast side faces are the ACES toe, not the clast material

**The critic's number-one finding is not in `src/scatter.js` and cannot be fixed
there.** Attributed by ablation and by inverting the transfer curve on the
shipped frame. This is the positive result; the four eliminated hypotheses below
matter less than it does.

## What was measured

`_pixowner` on `shots/sys7ship_juniper.png`, at the centroids of the largest
dark blobs rather than at points chosen by eye (`tools/_darkspots.mjs` finds
them, because a patch chosen by eye is not a population - System 7 nearly
produced a false negative on the dust fix that way):

| point | renders | owner | ground revealed behind it |
|---|---|---|---|
| 0.2269, 0.7500 | rgb(6,3,3) | `boulder0` | rgb(155,106,75) |
| 0.1589, 0.7599 | rgb(18,7,9) | `cobble1` | rgb(156,126,98) |
| 0.2153, 0.8098 | rgb(33,10,5) | `terrain` | rgb(176,130,90) |

So the objects are mine, and the pairing of a shaded facet with the sunlit
ground beside it is established by ablation rather than by looking.

**They are not black.** Nothing in any of the four reported crops is literal
0,0,0. The darkest pixel in the juniper crop is rgb(7,0,2).

## The arithmetic that settles it

Inverting three.js's ACES fit on both members of each pair recovers the
scene-linear ratio the renderer was actually given (`tools/_toneratio.mjs`):

| | display ratio | recovered scene ratio |
|---|---|---|
| `boulder0` | 0.62% | **3.91%** |
| `cobble1` | 1.31% | **5.84%** |

And independently, without touching the frame at all
(`tools/_faceratio.mjs`), from the real atmosphere plus the material's own
occlusion chain:

- unoccluded anti-sun vertical facet: **8.73%** of a sunlit horizontal
- after `occ = max(mesoAO * contact, 0.34)`: **2.97% to 6.58%**, and **3.95%**
  at a boulder's typical `aoI` of 0.54

**3.91% recovered against 3.95% predicted. The shading is correct.** Not
approximately, not within-tolerance-if-you-squint - the frame contains exactly
the value the material intends, and the material's value is a defensible
fraction of what the atmosphere delivers.

ACES compresses that scene ratio by a factor of **6.3** on its way to the
display. A physically-correct 4% facet arrives as 0.6%, which is sRGB code 4.

## Why no fix is available in my file

This is the number that closes the question. Pushing fractions of the ground's
scene value through the same curve:

| scene fraction | arrives as sRGB code |
|---|---|
| 8.73% (all occlusion deleted) | **13.2** |
| 6.00% | 7.5 |
| 3.95% (shipped) | 3.8 |

**Deleting the entire clast occlusion chain - every AO term, the burial factor,
the contact darkening, the floor - moves rgb(6,3,3) to about rgb(13,9,7).** Still
black, and it would undo the shaded-bank fix and the bedding cue to get there.
There is no setting of anything in `scatter.js` that takes these faces out of
black, because the whole available range lies inside the toe.

## What this explains that a material fix never could

- **Why the defect keeps returning in changed form.** It has been reported on
  pebbles, then on gravel voids, now on slab side faces. It is not a population
  at all - it is a luminance band, and every population that enters that band
  acquires it.
- **Why the chroma is right while the value is wrong.** Measured dark-facet hue
  4-8 deg at saturation 0.62-0.77; the analytic anti-sun facet is hue 8.0 at
  0.783. A toe crushes value and roughly preserves channel ratio, so a correctly
  coloured facet arrives correctly coloured and invisible.
- **Why "zero bounce from a surrounding surface that is blazing orange" is a
  fair description of a frame in which the bounce is entirely present.** It is
  there at 4% in scene-linear. The curve takes it to 0.6%.
- **Why my own `0.34` floor helped and did not solve it.** It lifted the worst
  cases off literal 0,0,0, which is what the holes were. It could not lift
  anything out of the toe, because the toe covers the whole band.

## The two complaints are in tension, and whoever takes this should know

The critic asks for two things: side faces that are not black, and a contact
shadow so the clasts stop sitting proud. The `contact` term that darkens a
clast's own base is *the* bedding cue - its comment says so - and it is one of
the terms holding the side faces down. Lifting the undersides to answer the
first complaint removes the cue that answers the second. A transfer-curve fix
gives both; a material fix trades them.

## Where it goes

The grade, not the material. Two observations for whoever owns it:

- **The grade is already fighting this and winning slightly.** At the attributed
  boulder pixel, `nopost` medians L=2.8 and `post` medians L=4.8 - post lifts the
  shadow end by about 1.7x. My first hypothesis was that the grade was crushing
  the blacks; it is doing the opposite.
- **The size of the ask.** To bring a 4% scene facet to an sRGB code near 35,
  where it would read as dark rock rather than as a hole, the transfer has to
  deliver about 7% of the ground's display value where it now delivers 0.62% - an
  eleven-fold lift at that level. That is a tone-mapping decision (ACES has an
  unusually hard toe; AgX and Neutral are far gentler there), not a grade tweak,
  and it is above my file and above my authority.

## Four hypotheses eliminated on the way, each with a number

1. **Detail crushed by quantisation.** Falsified and inverted. The dark
   population carries **2.1 to 4.7 times** the *relative* local contrast of the
   lit surface. Detail is present; it is 1-2 codes in absolute terms because the
   level is low, but the surface is not flat-filled.
2. **The grade crushing the shadow end.** Falsified and inverted - see above,
   post lifts by 1.7x over nopost.
3. **Card geometry.** Falsified. "Quasi-rectangular or hexagonal with a bright
   flat top and a hard horizontal cut" is a precise description of a low-facet
   hull, so it deserved a check. `tools/_hullface.mjs` builds the actual hulls:
   the largest single planar facet is **6.5-9.3%** of surface area and the
   largest near-up facet **5.9-8.1%**, across 23-53 distinct planes. The two
   earlier rounds of bevel work succeeded. **Do not redo them.**
4. **A sky-visibility occlusion applied to light that is mostly not sky.** This
   was my own best idea and it is wrong; see the correction below.

## My own two errors, both caught, one by luck

**Naming coincidence again, and I had written up someone else's instance of it
this morning.** I read `_probesplit.mjs`'s row "wall facing away from sun" -
sky share 19.1%, escarpment 53.5% - and concluded that a clast's side facet is
lit overwhelmingly by non-sky, so scaling it by a sky-visibility term
over-darkens it by a large factor. That row is a **wall**: a surface high
against the escarpment, with a different aperture and a different horizon. A
clast side facet on the wash floor measures **71.5% sky** (`tools/_skyshare.mjs`),
against 73.3% on an up-facing one. The sky share is nearly flat across the whole
upper hemisphere, so there is no orientation-dependent error to correct and the
existing comment - *"uniform over the facet rather than keyed to its normal,
deliberately"* - is right, for a reason its author did not state. I took a row
because its label matched the sentence I wanted to write.

**And a borrowed constant.** I used `EXPOSURE = 1.15`, quoted from `scatter.js`'s
blue-chip note, where it is that *capture's* exposure. The shipped value in
`sky.js` is **0.95**. The conclusion survived unchanged - the recovered ratios
are identical to three significant figures, because ACES is close to a power law
in that region and a ratio is therefore scale-invariant - but **it survived by
luck rather than by design**, and had the value landed nearer the shoulder it
would not have. A constant read from a comment is a constant from whenever that
comment was written. Read it from source.

## On the quilt, since the record is being corrected

The critic's finding that the quilted cross-hatch is on **every flat slab**
rather than one boulder does not weaken the `uvK` result - it strengthens it.
The tiling count is per-instance and applies to every clast, and its clamp means
every large clast carries the *same* repeat count regardless of size. A defect
that is coherent across all large flat clasts is what that mechanism predicts,
and "one boulder" was always the weakest part of the attribution. What remains
unexplained is only why halving the count destroyed the pattern without doubling
its period. The per-instance UV rotation or offset already proposed is still the
right first thing to try, and it is now aimed at a population rather than at an
object.

## Rows of windows: the varnish, not the alcoves

The ship critic's second finding was a grid of soft-edged dark rounded
rectangles, roughly equal in width and spacing, arranged in horizontal rows
along the bedding, in `wash_mid`, `bend`, `far_220` and `shade_far`. It is
**desert varnish**, established by ablation on a new declared `uVarnK`: with the
term at zero the rectangles are gone and the dark shapes that remain are alcove
geometry, which is irregular. The critic's guess that a real feature was being
laid out on a lattice was right.

Two placement faults, and neither was about strength.

**Cells got by flooring a scaled station are a lattice no per-cell jitter can
break.** The tongues sit in cells of 9.5 m and 3.33 m, and each carries one
plate at a hashed position inside its own cell. That randomises where a plate
sits *within* a cell but there is still exactly one per cell, so the spacing
distribution stays narrow and the eye reads a rhythm. This is a general trap and
it is worth stating as one: **jitter inside a cell does not remove the cell's
period; only warping the coordinate before the floor does.** The cure is a
monotone warp - amplitude times frequency times 1.5 held under 1 per term, or
the coordinate folds and cells invert - which makes the cells unequal and, as a
free by-product, varies each plate's world width.

**The source height was the wrong horizon.** Every tongue hung from `lTop` with
a couple of metres of jitter, and `lTop` is the top of the *lithological unit*,
not of a bed. Units here are eight to twenty metres thick, so every tongue in a
unit began inside the same two-metre band: one row per unit, and three units in
a framing is the three rows that were counted. The source now scatters through
the unit, snapped to a bed contact, because a lip is still what sheds a tongue.

Also fixed in passing, and it is a shape fault rather than a distribution one: a
plate of constant lateral width, held over the ten metres its darkness decays
across, **is** a rounded rectangle. Width now tapers downward and the plate
wanders laterally as it descends.

Third time on this project that a regular period was the whole problem and a
phase warp rather than an amplitude was the cure, after the crest that held one
bed level for 50-100 m and the apron rows at a dead-regular pitch.

### buildWalls returns a creased mesh, and offline rock measurement works

The heading is the finding, because at least one agent has already concluded the
opposite and reasoned from it for hours.

`buildWalls` returns a **creased** mesh - `creasedMesh` splits vertices per face
so hard edges can carry their own normals - so the `(column, row)` grid the
generator wrote is *not* the vertex order that comes back, and index arithmetic
on it returns nonsense. Bin by the station and column-height channels of `aRock`
instead. This is almost certainly what made an earlier node-side scratch report
no rock above y 0 on a wall that this same build puts at **y 67.1**: the layout
was wrong, not the build. Offline rock measurement works.

`tools/_blobrow.mjs` tried to score the complaint directly by finding the dark
patches and measuring their row concentration and pitch. **It does not work**,
and it is committed saying so. It finds eight to eleven patches per crop, so a
pitch CV rests on three to six samples, and it scores the *before* frames at
0.91-1.26 times chance for row concentration - no rows - on the crops where the
rows are plainly visible. What settled the question was an ablation, because an
ablation isolates a **term** and needs no feature recognition at all. Recognising
the feature was the hard problem and it was never the problem that needed
solving.

## Vertical jointing is a rebuild, and here is the measurement that says so

The critic's sharpest line - bedding "wraps around the form like grain on
lathe-turned wood, instead of being cut by it" - is half right, and the half it
gets wrong points at the wrong fix. Bedding *is* a function of height on a real
cliff, beds being horizontal, and a horizontal bed exposed on a convex prow
really does continue round it. What a real cliff has that this one does not is a
**surface built of joint-bounded planar facets**, so the bedding trace is a
polyline that kinks at every joint. "Cut by it" is a statement about the
surface, not about the laminae.

`tools/_jointstep.mjs` measures the surface off the built wall. Over 9074
column-to-column steps on `wallL`:

| lateral step over one 0.62 m column | share |
| --- | --- |
| median | 0.158 m, a face tilted 14 deg from the wall |
| >= 0.6 m (44 deg) | 3.38% |
| >= 1.0 m (58 deg) | 0.57% |

Joint *planes* do exist - the steepest 2% of steps persist into the band below
42% of the time against 6% by chance, so seven times chance - so the machinery
is not absent. It is **sparse**: 52 near-vertical facets across 19 height bands
of a 296 m wall is one per roughly 110 m, where this country has a joint every
3 to 15 m. Ten to thirty times too few.

That is also why ablating the whole joint system moves the line-anisotropy ratio
by only 3%, from 0.77 to 0.75. The joints are a shading term painted on a smooth
surface, and no shading term can terminate a lamina, because there is no break
in the surface for it to terminate against. The 3% is not weak machinery; it is
the correct answer to a different question.

**And the density cannot simply be raised, because it was already tried.**
`38b4a1a` found the previous form - a 0.040-wide threshold ramp with a 1.5 m
offset, which is a near-vertical facet - and removed it, widening the ramp to
0.090 and cutting the depth to 1.1 m, because adjacent columns differing by the
full offset gave "the row of bright triangular notches along every shaded bench"
and "the perfectly straight polygonal boundary that reads as a boolean cut
rather than a fracture". The facets were traded away to kill those two artifacts.
Raising density now reopens both.

So what is actually being asked for is four pieces of new work, not a parameter:

1. **Steps placed on column boundaries.** A discontinuity inside a column
   aliases against the 0.62 m sampling, which is the barcode lesson; on a
   boundary it is exactly representable as a near-vertical quad.
2. **A fracture-face material path.** A joint face is fresh rock in shadow and
   must read dark and matte. The existing `fresh` channel is the wrong sign - it
   marks unweathered rock, no varnish and no dust, so it makes a facet
   *brighter*, which is precisely the bright-notch artifact. This is a new
   channel, not a reuse.
3. **Coherence by construction.** A joint is a plane, so its station must not
   depend on height. Today's driver is a 2-D noise in (station, height), which is
   why coherence measures 42% and not ~100%.
4. **Talus.** A joint-bounded block that has stepped out went somewhere, and the
   critic names its absence separately: the cliffs meet the banks cleanly.

Crossbedding, which the critic calls the single biggest reason the rock reads
synthetic, is larger still and separate: it requires bedding to stop being f(y)
and become f(y - x tan(dip)) inside bounded sets, which touches every reader of
the bedding field including the CPU-side `subResist` that `bedResist` must match
exactly.

This is a rebuild of the wall's lateral-offset field plus a new material channel
plus a bedding reparameterisation. It is more than today, and the honest thing
is to say so rather than to spend the time moving 3% by another 3%.

---

## System 7: the black-sided slabs, and the local shadow lift

The critic's top finding — flat pale slabs whose side faces read as pure black next
to blazing orange ground — was attributed to the transfer function rather than to
any material, and the attribution holds. Terrain reached it two ways; a third route
here avoids the sky-visibility figure they self-flagged, and uses the scene's own
shaded floor to pin sky-only illumination on an open horizontal surface: it sits at
7.4% of the sunlit floor, so a facet at the measured 71.5% visibility predicts 5.3%
and the frame contains 3.1%. Burial and contact darkening cover the rest. Nothing
upstream is broken, and deleting the whole clast occlusion chain moves the worst
pixel only from rgb(6,3,3) to rgb(13,9,7) — **the entire available range is inside
the ACES toe.**

### Why the obvious fix does not work

A lift keyed on luminance, applied in scene-linear immediately before ACES, is the
textbook answer and it fails here for a reason worth recording. The worst facet sits
at 0.0092 scene-linear and the shaded floor at 0.0221 — **1.27 stops apart**. No
operation keyed on level can separate them. And the shadow gate is a *mean* over a
shaded window, so it moves with the whole population rather than with the worst
pixel, which means it moves first and by more:

| gain | knee | shadow gate | ceiling | verdict |
| --- | --- | --- | --- | --- |
| 4 | 0.045 | 0.418 | 0.25 | far out of band |

Every setting inside the band moved the worst facet from code 6 to at most code 9.

### What does work: discriminating on spatial scale

The two populations differ, just not in level. A clast side face is a **small** dark
region surrounded by blazing ground; the shaded wall is a **large** one. Comparing
each pixel against the local *maximum* separates them — on a facet one tap lands on
lit ground, and in the middle of a big shadow no tap does at any radius, however
dark it is. Measured on the shipped frames, that mask reads **0.219 on ground's dark
facets against 0.011 inside the gate window**, a twentyfold separation, where the
level key has none.

Two things make it cheap enough to live in the existing grade pass rather than
costing a blur chain:

- **Maximum, not mean.** Max is what survives a low tap count. Eight taps against
  the local max reproduce a 24px gaussian's answer to within two code values.
- **On sqrt of linear luminance**, which is one instruction per tap, and the
  thresholds were swept in that same space so prediction and implementation cannot
  drift apart.

### The hollow the mask caused, and why widening cannot fix it

**Caught by looking at the delivery frames before measuring them.** A local maximum
with a single radius **hollows out any dark region wider than twice that radius**:
near the edge a tap reaches lit ground and the pixel lifts, past the radius none
does and it stays put, and because eight taps make the mask a staircase in distance
the change lands within a few pixels. On a clast side face 123×30 px across:

| point | ungraded | one unweighted ring |
| --- | --- | --- |
| outer band | rgb(12,3,4) | rgb(40,21,20) |
| inner region | rgb(13,4,3) | rgb(11,2,3) |

Ungraded those two are **the same value — there is no rectangle in the frame.** The
lift raised the border 3.3× and left the middle alone, *manufacturing* a hard-edged
black rectangle: precisely the artefact the term exists to remove, and worse than
doing nothing.

**A second wider ring closes it and cannot be used.** The wall's own shadow bands are
tens of pixels across, so a 96px ring finds lit rock nearly everywhere inside them
and **17% of `wall_lit` washes into fill light** — obvious in a three-way crop.
**In this scene the facet scale and the shadow-band scale overlap, so no radius
separates them.** Anyone tempted to widen the radius should read that twice.

**Subtracting a distance term is the fix.** Discounting each tap by how far it is
makes the mask decay with distance to the nearest lit pixel instead of stopping dead
at the radius, so a facet fills as a gradient and a wide shadow's interior is reached
only weakly. Same eight taps. Swept:

| radius | falloff | facet centre | facet border | `wall_lit` vs one ring |
| --- | --- | --- | --- | --- |
| **48** | **0.22** | **43** | **40** | **−0.7 cv** |
| 48 | 0.35 | 34 | 40 | −1.8 cv |
| 32 | 0.15 | 11 | 40 | −0.9 cv (hollow remains) |

Shipped at radius 48, falloff 0.22: the facet is uniform and the wall keeps its
depth. **The general lesson is that a masked local operator must be checked for what
it does to regions larger than its own kernel, and the check is a full-resolution
crop, not a mean.** No aggregate figure in the table below moved when this artefact
was present — the gate, lit rock and the floor rows were all in band with a black
rectangle sitting in the frame.

The tap radius **scales with resolution** and the mask thresholds do **not**, for
the reason recorded above for grain and the silhouette gate: the radius is a
distance in the image plane, so what it calls "the neighbourhood" must stay a fixed
fraction of the frame, while a contrast threshold must not move.

### The trade, measured

Paired capture, 2560x1440, nine-view pool, control arm `#lift=1` which is the
shipped ACES chain untouched. The shipped default is byte-identical to the `#lift=5`
arm, so these figures describe what ships.

| figure | shipped ACES | **gain 5, shipped** | gain 8 | band |
| --- | --- | --- | --- | --- |
| **worst facets (<=7cv), ground** | 3.6 cv | **16.7 cv (4.6x)** | 26.5 cv (7.3x) | — |
| all dark facets (<=14cv) | 7.0 cv | **22.1 cv (3.1x)** | 32.9 cv (4.7x) | — |
| **shadow gate** | 0.223 | **0.214** | 0.208 | 0.15–0.25 |
| lit rock saturation | 0.613 | **0.614** | 0.614 | 0.42–0.65 |
| lit rock hue | 20.6° | **20.5°** | 20.5° | +15.6–31° |
| lit rock V | 0.690 | **0.685** | 0.685 | 0.59–0.73 |
| floor shade, sat / V | 0.641 / 0.131 | **0.640 / 0.132** | — | — |
| floor lit, sat / V | 0.626 / 0.636 | **0.623 / 0.640** | — | — |
| midwall hf/lf | 0.53 | **0.53** | 0.52 | ≥0.55 gate |
| wash floor hf/lf | 0.49 | **0.49** | — | — |
| banding: run / step / flat | 9 / 0.722 / 42% | **identical** | identical | — |
| clipped >=250 | 0.45% | **0.44%** | 0.44% | — |
| black at 0,0,0 | 0.07% | **0.07%** | 0.07% | — |

Two results in that table are worth reading twice. **The gate improves rather than
degrades** — the mask finds more to open in the sunlit window's crevices than in the
shaded wall's flat, so the denominator rises faster than the numerator. And the
**absolute** shadow gradient on midwall rises 20% (0.0153 to 0.0183 at gain 8),
because detail that was crushed flat against the floor is now above it: the lift
recovers structure rather than costing it. `grad/L` falls 3%, which is the honest
way to state the same thing.

### Why 5 and not 8

**Chosen by eye against a three-way capture, not from the table.** 8 measures better
on every figure and looks worse: by then the gravel's inter-pebble shadows are
lifted too and the ground reads as a pushed shadows slider rather than as light. 5
takes the side faces off the floor and leaves the relief alone. This is the second
time on this system that looking has overruled a number, and the first time it went
the other way — a 4x downscale of the shaded wall read as flattened and brighter,
and at full resolution the two arms are almost indistinguishable, which is what the
rising gradient had already said. **Downscales are for finding candidates; only
full-resolution crops settle them.**

`shadowLift` in `src/post.js` is the whole of the decision if anyone disagrees with
that judgement, and `#lift=N` sweeps it live. The eight taps are on the tier ladder
as `post.lift` and compile out on potato.

### The delivery record: `sys7d` / `sys7dpx`

Nine views × two arms at each of two buffers, 36 frames, **every manifest logs 0
entries**, settle by frame convergence at 180 frames, one resolution per tag.
`sys7far` adds `far_220` for the varnish look-check. The control arm is `#nopost`,
so the left column is the scene with no post chain at all.

**2560×1440 — the shipped buffer, since the governor holds rung 0 natively.**

| figure | ungraded control | **graded, ships** | band |
| --- | --- | --- | --- |
| worst facets ≤7cv, `ground` | 3.7 cv | **19.0 cv (5.1×)** | — |
| dark facets ≤14cv, `ground` | 6.3 cv | **21.5 cv (3.4×)** | — |
| **shadow gate** | 0.244 | **0.213** | 0.15–0.25 |
| lit rock saturation | 0.613 | **0.614** | 0.42–0.65 |
| lit rock hue | 20.7° | **20.5°** | +15.6–31° |
| lit rock V | 0.692 | **0.685** | 0.59–0.73 |
| floor **shade**, sat / hue / V | 0.658 / 6.7° / 0.149 | **0.641 / 4.3° / 0.131** | paired |
| floor **lit**, sat / hue / V | 0.625 / 21.6° / 0.642 | **0.623 / 21.3° / 0.638** | paired |
| midwall hf/lf | 0.53 | **0.53** | — |
| upper wall hf/lf | 0.62 | **0.62** | — |
| wash floor / wall hf/lf | 0.49 / 0.60 | **0.49 / 0.62** | — |
| banding `sun_gap`, run / step / flat | 42 / 0.125 / 94% | **8 / 0.651 / 42%** | — |
| banding `wash_mid`, run / step / flat | 36 / 0.171 / 92% | **7 / 0.670 / 43%** | — |
| clipped ≥250 / ≥254, `wall_lit` | 0.05% / 0.00% | **0.44% / 0.04%** | — |
| black at 0,0,0 / within 2, `wall_shade` | 0.01% / 1.17% | **0.07% / 1.28%** | — |

**1997×1123 — the second buffer, for the pixel-scale figures.**

| figure | value | note |
| --- | --- | --- |
| lit rock sat / hue / V | 0.614 / 20.5° / 0.684 | colour is resolution-invariant, as recorded |
| shadow gate | 0.213 | identical to 1440p |
| floor shade / lit, sat | 0.640 / 0.625 | within 0.001 of 1440p |
| worst facets ≤7cv | 3.7 → 17.4 cv (4.7×) | slightly less reach, radius scales |
| banding `sun_gap` | 8 / 0.711 / 42% vs ungraded 33 / 0.185 / 93% | dither's margin widens |
| midwall / upper / wash floor hf/lf | 0.52 / 0.66 / 0.52 | **resolution-dependent, as recorded** |

**Cost.** The lift's eight taps at rung 0, 2560×1440: **17.91 ms against 17.89 ms**
with the term off. Inside noise. On the ladder as `post.lift`, compiled out on potato.

### Two residuals, stated rather than hidden

1. **A facet inside an already-shaded field stays at code 11.** Measured on
   `juniper`, a slab face reads rgb(11,4,3) and the shadowed ground around it
   rgb(26,10,10). **Identical in both arms** — the mask correctly finds no lit
   neighbour, so the lift does not fire, and the face/ground ratio is 0.40 graded
   against 0.36 ungraded, i.e. the grade slightly improves the separation. Reaching
   it requires lifting large dark regions, which is the luminance-keyed family that
   takes the gate to 0.418. **This one is genuinely blocked, not deferred.**
2. **The near-field clasts are rectangular boxes** — flat top, straight side, hard
   90° edges — which reads as a brick rather than a fractured sandstone slab. That
   is geometry and belongs with the transported-lithology work, not with the grade.

---

# The clast shape complaint: measured, decomposed, and not landed

**The lever that exists improves the average stone and does not touch the worst
ones, which is the entire complaint. Recommending no change, with the number
that says so.**

## First, a correction to my own earlier measurement

`tools/_hullface.mjs` reported the largest planar facet at 6.5-9.3% of hull
surface area over 23-53 planes, and I concluded the bevel work had succeeded and
must not be redone. **That measurement is correct and it answers the wrong
question**, by a factor of four.

It measured the whole hull. The camera never sees the whole hull. `sink` runs
0.34 to 0.95 of a clast's vertical *half*-extent, so what stands above the bed is
only 20-24% of its total height - a thin cap off the top of a convex body, which
is not a small version of that body. Measured over the cap that is actually
visible, and weighted by projected area from a near-field camera
(`tools/_visface.mjs`):

| | whole hull | as presented to the camera |
|---|---|---|
| largest single plane | 6.5-9.3% | **27.8-34.1%** |
| top three planes | - | **58-73%** |
| distinct planes | 23-53 | 8.6-16.5 |

So the coordinator's second hypothesis is right: **the facet count is fine and
the facet distribution is not.** A clast presents three big flat facets carrying
about two thirds of everything the camera sees of it. That is a brick.

The general form is worth keeping, because it is the fourth instance this week:
an aggregate taken over a population the viewer cannot see is not a measurement
of what the viewer sees. Burial made 76-80% of every clast invisible and the
statistic went on averaging over all of it.

## The flat plates are `cobble`, attributed rather than assumed

`tools/_paleblob.mjs` finds the large desaturated plates by search - they are
conspicuous precisely because they are pale and flat against saturated orange
bed - and `_pixowner` attributes the two largest to **`cobble1` and `cobble2`**.

Not `slab`, not `pavement`. `cobble` has `flat: 0.42`, the most tabular setting
in the class table, 3600 instances, and it is a near-field class.

A process note: my first three probe coordinates were read off a *magnified*
crop as displayed rather than off the crop's own pixel grid, the viewer had
scaled it, and all three landed on bare ground and attributed to terrain. One
render wasted. `tools/_at.mjs` now checks a normalised coordinate against the
capture in a few milliseconds, which is the cheap half of what the render was
doing.

## The lever that works on the mean

Bevel directions are drawn uniformly over the sphere, so roughly half the facet
budget lands on the underside, which is buried, and much of the rest below the
bed line. The seating aligns the clast's local +y with the ground normal before
a modest tilt, so local +y is world up for essentially the whole population and
the budget can be moved without changing its size.

Biasing bevel points into the visible band (`tools/_topbias.mjs`), **at flat
triangle count**:

| class | largest visible plane | top-3 | tris |
|---|---|---|---|
| cobble | 29.0% -> 23.6% | 64.2% -> 54.2% | 34 -> 37 |
| pavement | 31.2% -> 23.2% | 65.9% -> 51.2% | 38 -> 42 |
| slab | 26.2% -> 18.7% | 60.2% -> 44.1% | 47 -> 48 |
| boulder | 32.1% -> 20.1% | 65.0% -> 44.0% | 54 -> 53 |

Non-monotone, turning around past bias 0.40-0.55 as the flanks start to starve.
Real, free, and in the right direction.

## And the measurement that says not to land it

The critic is not looking at the average stone. "The single worst object in the
whole set" is a statement about a tail, so `tools/_flattail.mjs` reports the
distribution rather than the mean, over 800 seatings per setting:

| bias | mean | >35% | >45% | **>55%** |
|---|---|---|---|---|
| 0.00 (shipped) | 29.7% | 19.3% | 7.0% | **3.4%** |
| 0.25 | 25.8% | 16.0% | 6.1% | **3.5%** |
| 0.40 | 24.6% | 14.4% | 6.4% | **3.6%** |
| 0.55 | 25.0% | 14.0% | 6.4% | **3.6%** |

**The tail does not move. At >55% it is very slightly worse.** The mean falls by
a sixth and the stones that read as bricks are exactly as they were.

The reason is structural. A cobble presenting one plane at over half its visible
area is one seated nearly flat, and that plane is set by the four top corners of
the jittered box - four points hull into two triangles and therefore into one
broad plane however far apart in height they are. Bevel points chamfer that
plane's rim; they cannot break its middle.

**A cross-check that the tail figure is the right one.** 3.4% of 3600 cobbles is
about 120 worst-case stones across the near field. The critic counted "forty-plus
of them" in the `ground` framing alone - same order, and about what one framing's
share of the near field should contain. The statistic and the complaint are
counting the same objects.

So: landing the bias would change the geometry of every clast in the scene,
could not be verified by eye before the critic reports, and by its own numbers
would leave all 120 offending stones untouched. That is the trade declined three
times already today and it is declined again here.

## The waterline, and an instrument I do not trust

The silhouette carries one straight edge at about 32% of its perimeter, and the
whole bottom arc is about 52% (`tools/_silho.mjs`, `tools/_silho2.mjs`).
Spending bevel budget on jittered box-edge midpoints, which is where a long
silhouette run between two corners could be broken, moves the longest free edge
from 25.2% to 24.5-27.0% - nothing.

Why the contact is exactly straight: the near-field terrain grid is **0.20 m in
X by 0.42 m in Z** and a cobble is 0.14-0.38 m across, so the bed is a single
triangle under a typical cobble. It is not approximately planar there, it is
exactly planar, and a plane through a convex body is a straight line.

`scatter.js` already contains a mechanism written for this exact defect, in
almost the same words - the `fillet`, whose comment reads *"leave the stone's
waterline, the line where it meets the bed all the way round, a clean
intersection between a hull and a smooth plane. A real one is not clean... its
job is entirely to break that waterline."* It fires on 62% of qualifying
cobbles. But it is a lens **centred** on the stone, sx and sz both 1.55-2.10
radii against sy 0.26-0.40, so it is very nearly a surface of revolution about
the clast's own axis - and a centred smooth convex surface raises a waterline
without breaking it. Breaking one needs azimuthal variation.

**I could not demonstrate that.** `tools/_waterline.mjs` returned no difference
between a bare plane, a fillet and a collar, and reported 12.7% chord deviation
on the bare plane, which is inconsistent with the silhouette measurement above.
Either the tracer is too coarse or the bed models are too weak. **The null is
not reported as a result**; the argument about axisymmetry stands on its
geometry and not on that tool, and the tool should be fixed or discarded before
anyone quotes it.

## What would actually work, for whoever picks this up

Not more facets - that direction is now closed with numbers, twice. The tail is
set by the four top corners of a jittered box hulling into one broad plane, so
the candidates are:

1. **More gross points, not more bevel points.** The 8 box corners set the
   silhouette and the big planes; the bevel only chamfers between them. Adding
   structural points would change the shape statistics of every class and needs
   its own verification.
2. **Reduce the number of cobbles seated broad-face-up.** `tiltCap` caps tilt by
   aspect, and it exists because tilted thin plates became "paper-thin
   knife-edged wings". Any move here re-opens that defect.
3. **Accept it.** 3.4% of cobbles at >55%, about 120 stones, mostly small.

Option 1 is the only one that attacks the measured cause, and it is a
population-level change that wants a render and a critic, not a blind landing
while a set is being judged.

---

# Breaking the clast top face: the mechanism found, the fix measured, and why it cannot ship

**Vertical bumpiness is the only thing that breaks the lid, and vertical extent
is what burial measures thickness against. You cannot buy one without spending
the other. Third closed door, with the trade quantified.**

## The instrument was wrong, and that is the finding worth keeping

Every facet statistic I ran yesterday and today merged triangles into a plane
when their normals agreed to a dot product of 0.9995 - about 1.8 degrees. That
is a geometric test, and the complaint is perceptual. Under one dominant sun a
patch spanning less than about ten degrees of normal shades within a couple of
code values and reads as one flat lid. A top made of six facets two degrees
apart scores as six planes at ten percent each and *looks* like a paving slab.

Measured at ten degrees instead of two, over the stones that actually cover
screen area (`tools/_perceface.mjs`):

| merge tolerance | 1.8 deg (geometric) | 10 deg (perceptual) |
|---|---|---|
| cobble, largest face | 32% | **57%** |
| cobble, share over 55% | 1% | **59%** |
| pavement | 32% / 2% | 56% / 46% |
| boulder | 30% / 0% | 48% / 25% |

**A majority of the large near-field stones present one visually flat face
covering more than half of what you see of them.** That is the brick, it is
real, and it was invisible to every tool I built because they all merged at two
degrees. "The shape measures fine" and "the crop shows paving slabs" were both
true statements about different measurements.

## The general rule, now with four instances

The coordinator asked for the visible-area correction to be stated generally.
It is broader than shape, and today produced four of the same error:

1. **Whole hull instead of the visible cap.** Burial leaves a fifth of the
   height above the bed; largest facet 6.5-9.3% became 27.8-34.1%. Wrong by 4x.
2. **Whole population instead of the stones that cover pixels.** The >55% tail
   turned out to be 87% deeply buried slivers at mean sink 0.85 - one facet
   because there is no room for two - while the largest screen-area quartile
   had **0.0%**. (`tools/_tailwho.mjs`)
3. **Exact normals instead of perceived ones.** 32% became 57%, above.
4. **Bounding extent instead of projected area.** I held half-height to +0.0%
   and horizontal radius to 1.5%, rendered, and the stones were visibly
   smaller - one plate lost 22% of its pixels, and projected area was down
   12-21% across every class. (`tools/_projarea.mjs`, now a standing check)

**A statistic must be taken in the space the viewer occupies.** Not the whole
object but the visible part, not the whole population but the part that covers
pixels, not exact normals but perceived ones, not bounding extents but
projected area. Each of these cleared something that was wrong.

## Correcting the numbers I reported this afternoon

`tools/_flattail.mjs` had a bug: `if (rand() < bias)` drew a random number even
at bias 0, so the baseline row consumed a different stream from `angularClast`
and **was not the shipped hull** - 8 of 32 points matched, every bevel point
moved. `_topbias.mjs` and `_silho.mjs` had the same fault. All three are now
guarded with `bias > 0 &&`.

Corrected, and it inverts the report:

| | I reported | actually |
|---|---|---|
| shipped >55% tail | 3.4% | **0.8%** |
| with the bevel bias | 3.6% | 3.6% |

The bias does not "leave the tail alone" - it makes it **4.4x worse**. Two
independently written tools now agree on 0.8-0.9% for shipped. **I withdraw the
"120 stones against the critic's forty-plus" cross-check**; it was built on the
wrong number, and the tail it counted was slivers nobody can see.

## The lever that works

Not the corners. Widening the corner y-jitter at constant mean does almost
nothing (56% -> 53-57%), because the four top corners are not what forms the
top. Bevel points sit at `t * (0.99 to 1.23)` of the box surface, so for any
direction near +y they land at a height of `ay * (0.99 to 1.23)` - **a band
twelve percent wide spread across the whole horizontal area of the lid.** Points
at nearly constant height over an area *are* a plane. The bevel points were not
breaking the lid, they were building it.

Widening that band to `0.86 + rand()*0.50` and rescaling the hull back to the
shipped half-height (`tools/_bevall.mjs`):

| class | >55% perceived face | tris |
|---|---|---|
| cobble | 54% -> **27%** | 39 -> 34 |
| block | 61% -> **21%** | 45 -> 37 |
| pavement | 37% -> **17%** | 42 -> 37 |
| boulder | 23% -> **10%** | 53 -> 46 |
| slab | 57% -> 49% | 50 -> 42 |
| granule / gravel | 39->41%, 20->24% | slightly worse |

Total triangles **down 13.9%**, half-height +0.0%, horizontal radius within
1.5%, spike ratio up 3-4%.

## And the reason it cannot ship

Widening costs size, unavoidably: a hull takes the maximum, and widening a
distribution about a fixed mean raises its expected maximum. Giving it back has
exactly two options and they are mutually exclusive.

- **Rescale all three axes.** Extents hold, and **projected area falls 12-21%** -
  fifteen percent off the near field's clast coverage, toward a barer bed. The
  render confirmed it by eye: the worst plate lost 22% of its pixels.
- **Rescale y alone.** Projected area holds to within 0.6-4.9% and half-height
  is exact, so burial is untouched - and **the fix disappears**. Cobble returns
  to 60% with 62% over 55%, which is the shipped baseline. Squashing y flattens
  the very bumps that created the angular spread.

**The bumps are in y, and y is what `hTrue` and therefore burial, dust and the
shadow gate are measured against.** There is no version that breaks the lid
without either shrinking the stones or moving the burial.

The render was made and looked at (`shots/bevfix_ground.png`, uniform version).
It is honest about both halves: the dead-straight mitred edges are visibly
broken and the outline is irregular where it was a clean pentagon - a real
improvement - **and the top is still one flat lid**, and the stone is smaller.
A partial fix, bought with a regression on a verified figure, landed blind while
a critic is judging, is the trade declined four times today. Reverted; `src/` is
untouched.

## What is actually left

The cap needs vertical relief, and geometry cannot supply it without paying
burial or coverage. That leaves the option this whole thread has not touched:
**supply the relief in shading rather than in geometry.** A normal map or
detail-normal on the clast top with a few degrees of variation at centimetre
scale would break the perceived face without moving one vertex, one extent, or
one census figure. Whether the clast material already has a usable tangent frame
for that is a different investigation from this one.

Also still open and cheaper than the hull: the straight waterline. The
near-field terrain grid is 0.20 x 0.42 m against a 0.14-0.38 m cobble, so the
bed under a stone is one triangle - exactly planar, hence a dead-straight
contact. That is a property of the bed, not of thousands of instances, and it
feeds both "floating slabs with no contact shadow" and "unweathered extruded
prisms".

## Ground bounce on a near-vertical facet at clast scale (System 4)

The finding was that near-black verticals sit in open ground, that this is the
signature of one light with weak bounce, and that a real Sedona photograph carries
enough orange off the lit floor to put such a facet at **90-110 in red** against our
measured 37. Terrain had already shown the render is faithful to the prediction and
that deleting the whole clast occlusion chain moves the pixel only to about (13,9,7),
so the question was narrowed correctly: **the render draws what the atmosphere tells
it, and the open question is whether what it is told is right.**

Both halves of the answer turned out to be true. There was a missing term, and the
target is beyond what transport can deliver.

### The instrument, and why it is a ratio

`tools/_clastbounce.mjs` reports the **side/top irradiance ratio**, never an absolute
code value, and that is the whole design. `sky.js` multiplies both the sun and the SH
probe by `SCALE = 19`, and post applies a grade this file does not model. In a side/top
ratio SCALE cancels exactly, and so does albedo, **because the top and the side of one
slab are the same material.**

Solving the slab's albedo from the measured top face as a check recovered 17.1x the
known rock albedo against a pipeline SCALE of 19x - a 10% agreement on a chain that was
never calibrated, which is the reason to trust the ratios below and *not* to quote a
code value from them without anchoring on a measured pixel first.

### The missing term: irradiance is cosine-weighted and the constant was not

`FLOOR_SUNLIT` admitted **0.05** of the floor's sunlit fraction to the entire lower
hemisphere. The comment above it reasons that a rock face's downward view is dominated
by the near floor, which sits in that face's own shadow, and concludes that the open
wash's measured 0.70 does not belong there. It also records that an earlier estimate of
"roughly a third" was revised *down* to 0.05 on that argument.

The argument is right about solid angle and wrong about irradiance. **Irradiance is
cosine-weighted solid angle**, and on a near-vertical facet the cosine weight peaks at
the horizon and falls to zero looking straight down - the opposite of where the
self-shadowed near floor lives. The shadow line of any long occluder sits at a
depression equal to the sun's elevation, so the sunlit floor occupies depression 0 to
15 degrees: a thin band carrying almost no raw solid angle and carrying the most heavily
weighted directions a vertical facet has. Integrating cos^2 over that band against the
hemisphere's own pi/4 gives **0.326**, or **0.228** after the wash's own measured 0.70
sunlit fraction. Against 0.05. The estimate that was discarded was closer than the
correction that replaced it.

Neither number was ever the right *shape* of answer, because the correct value depends
on the normal - 0.228 for a vertical, near zero for an underside looking into its own
shadow, undefined for an up normal that sees no ground. One constant over the whole
lower hemisphere is wrong for two of the three whatever it is set to, which is the same
failure as the corridor modelled with one doorway.

So the lower hemisphere is now the two zones it actually has, and the band is delivered
**analytically** rather than through the probe: within each zone the radiance is uniform,
so on any normal the exact contribution is `bandExcess * F(ny)`, with `F` the band's
cosine-weighted geometric factor, integrated and fitted in `tools/_bandfit.mjs` to 0.59%
of peak. `F(0) = 0.5113` against the hand-derived `pi/2 * 0.326 = 0.512`, which is the
derivation and the integral agreeing independently.

`F` is **structurally zero on an up normal** - it is `(1 - ny)` times a polynomial - so
no sunlit floor or lit rock pixel can move. That is the property lit rock's guardrail
sits behind, and it is the reason to prefer the analytic form: routed through the SH
probe the same term lifted up-facing normals by 2%, and an up-facing normal is every
sunlit floor pixel in the frame.

### Retraction: the 63% SH loss did not exist

Commit `0b4f84d` claimed, as measured fact in a source comment, that an order-2 SH probe
loses **63%** of the band - x2.06 delivered against x5.59 exact - and moved the term out
of the probe for that reason. **That figure was wrong.** The probe tracks the exact answer
to **1.0%** on a vertical and 4.8% on an underside.

The 63% came from a brute-force integral that used the two zones' *sunlit fractions*,
0.70 against 0.05, as their radiances. Radiance is `albedo * (frac * sun * sin(el) +
skyIrradiance) / pi`, and that additive sky term does not scale with the fraction at all,
so the true ratio between the zones is **3.3, not 14**. The instrument inflated the band
fourfold and the "loss" was the gap between a correctly delivered value and a target it
had invented.

The mechanism was seductive because it is true in general - order-2 SH genuinely cannot
hold a thin annulus - and because a prior check had appeared to confirm the projection
was fine on a *uniform* hemisphere, so the story "I validated it on the wrong signal"
fitted perfectly. **A mechanism that explains a number is not evidence that the number is
real, and this is the second time in this file that a compelling mechanism arrived with a
figure produced by a toy model.** The rule already in this document - an aphorism that
explains the observation is not evidence for it - applies to one's own instruments first.

### Delivered, on paired same-build captures at 1600x900

Both halves from one tree in one minute via the `#noband` ablation, with identical
triangle counts, which matters because the tree also carried post's local lift and two
live agents.

| | ablated | landed |
|---|---|---|
| lit rock saturation / hue | 0.615 / 20.7 | **0.617 / 20.7** (guardrail 0.614, holds) |
| shadow gate | 0.213 | **0.234** (ceiling 0.25) |
| `wall_shade` crush, lum < 10 | 16.7% | **11.2%** (-5.5 points) |
| `wall_shade` crush, min < 10 | 41.8% | **38.6%** (-3.2 points) |
| dark facets in open sun, mean red | 46.7 | **47.7** |
| ... share under 40 red | 24.7% | **20.3%** (-4.4 points) |
| `wall_shade` dark facets, median red | 31 | **34** |

The dark-facet population is selected the way the finding describes it rather than by a
window average: **dark pixels whose surroundings are bright**, at full resolution
(`tools/_facetlift.mjs`). A window average is the wrong instrument here because the frame
is mostly floor and averaging the floor in buries the population being complained about.

Honest size of it: **+1 to +3 code values on the facets, and a fifth of the sub-40
population gone.** Real, visible in the crush figures, and much smaller than the analytic
+9 predicted for a bare facet - because the darkest facets are also the most occluded,
and the occlusion chain scales the band down with everything else. Correctly so: the band
is what an *exposed* facet sees.

It cost 0.021 of the shadow gate, which had 0.037 of headroom.

### The target is 1.6x beyond correct transport, and is already in the frame

For a facet with **no direct sun at all**, the hard ceiling is a fully sunlit infinite
floor filling its lower hemisphere plus this corridor's warm upper one: **side/top 0.250**,
which is `albedo_g / 2` plus the sky and escarpment terms, and needs no model to state.
The critic's 90-110 in red implies **0.401**. So no ground bounce of any strength reaches
it, and the remaining gap after this correction is not a missing term.

But "side face" is four different populations, and at 15 degrees of elevation the beam is
seventeen times the fill, which makes the terminator a cliff rather than a gradient.
Sweeping the dip:

- **facing away from the sun** - holds 46 in red out to 43 degrees of tilt, then jumps to
  177 at 46. There is no dip at which it reads 90-110.
- **facing across the sun's azimuth** - sits on the terminator at 64, and **two degrees of
  dip toward the sun puts it at 91.**

So **90-110 is not unreachable; it is what this render already delivers to a cross-sun
facet with a couple of degrees of dip.** The most likely reading of the disagreement is
that the photograph's "vertical carrying orange bounce" is a near-terminator facet
catching grazing beam, and ours is an anti-sun facet lit by bounce alone. Those are two
different surfaces and no transport change reconciles them.

### The tension worth surfacing

The finding says the dynamic range should be *compressed* and that shadows are the
brightest part of the story. The contract caps shadow-to-sunlit at **0.25**, which is a
cap on exactly that. This correction spent 0.021 of the 0.037 that was available. A real
Boynton frame twenty minutes before the sun leaves the rim plausibly sits above 0.25, so
**further progress on this finding is a decision about the gate ceiling rather than a
transport bug**, and that is not System 4's call to make.
