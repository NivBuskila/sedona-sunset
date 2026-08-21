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
2. Red rock buttes
3. The juniper
4. Lighting and sun
5. Heat haze and atmosphere — including **wind-driven sand at ground level** (saltation):
   low ribbons of grains skipping across the wash floor, snaking around cobbles and pouring
   off the lee edge of bank crests. Distinct from the airborne dust in the sunbeams, and
   hugging the surface rather than filling the volume. The wind direction here must agree
   with the deposited sand in System 1 — grains piling against the upstream face of clasts —
   and with the wind bed in System 6, so the moving sand, the drifted sand and the sound are
   all one weather system. Keep it sparse and intermittent; gusts, not a sandstorm. The
   desert stillness is the feature, and the sand should mostly be still with occasional
   movement that makes the stillness noticeable.
6. Sound design
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
