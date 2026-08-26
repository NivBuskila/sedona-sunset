# Sedona Sunset

A first-person walk up a dirt wash between red rock buttes in Sedona, Arizona, at
golden hour. You start at the mouth of the wash with the sun low in the gap ahead
of you and walk about 330 m up the channel to where it heads into a box canyon.

![Up the wash toward the sun gap: the layered walls, the juniper's shadow raking
the floor, the far butte through the notch](media/01-sun-gap.webp)

*Straight out of the deployed build in a GPU-backed Chromium, once generation had
finished. Nothing in it is composited and nothing is retouched — every pixel of
it, the rock, the gravel, the sky and the haze, was computed in the GPU a few
seconds before the shutter.*

**Walk it: https://starknightt.github.io/sedona-sunset/** — desktop, keyboard and
mouse.

**Read the brief it was built from: [PROMPT.md](PROMPT.md).** One page, and the
build/critique loop at the end of it is most of why this looks the way it does.

**It takes under a minute to start, and the page will not respond while it
works.** That is not a download and it is not broken. A dark screen comes up
within milliseconds and names each stage as it goes: the wash floor, the
sandstone, cutting the wash, raising the canyon walls, scattering the stones, the
juniper, the sky. Two of those stages take twelve to fourteen seconds on their
own, so the message sits still for a while and the tab ignores a click while it
does. That is the work happening.

**That is the first visit only.** Every texture, the wash floor, the canyon walls
and the talus blocks are written to IndexedDB once they have been computed, and
every load after the first reads them back instead of recomputing them: the seven
texture stages drop from 6.4 seconds to 0.16, the terrain from 13.9 to 0.2, the
canyon walls from 19.1 to 0.1, and the whole boot from 66 seconds to 27. What
comes back is bit for bit what went in — every attribute and every texel hashed
and compared across a cold and a warm load — so this buys time and changes
nothing you can see. Editing any source file invalidates the whole store on the
next load, and if it cannot be used at all, a private window or a full disk, the
page just generates everything again and waits the way it used to. What is left
of the wait is mostly the gravel, which is deliberately not cached; there is a
reason, and it is in `CONTRACT.md`.

**Every mesh, texture, material and sound in this project is generated
procedurally in code.** There are no image files, no models, no HDRIs and no
audio recordings anywhere in the repository, and nothing is ever fetched from the
network. One qualification, stated plainly because that claim is the point of the
project: a *repeat* visit reads the heavy geometry back from IndexedDB rather
than recomputing it, so it does load something — a file your own browser computed
and wrote on your own disk a visit ago, byte for byte what the generator
produced. The first visit still computes every one of them, and nothing ever
comes from anywhere else.
The red rock, the layered cliff faces, the gravel underfoot, the sand ripples,
the juniper and its shadow, the sky, the haze and the low sun are written as
mathematics and drawn into memory the moment you open the page. So is the wind,
the grit skittering along the ground, your own footsteps changing with the
surface under them, the canyon wren, the raven and the echo off the walls — none
of it is a sample, and all of it is synthesised live in the Web Audio API. It is
genuinely quiet, because a desert wash at dusk is quiet, so you may want more
volume than you expect.

There is nothing to do and nothing to collect. There is no crosshair, no HUD and
no menu, on purpose.

---

## Run it

**pnpm, not npm.** The lockfile is pnpm's and npm will install a different
dependency tree.

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:8099/> in Chrome or Edge. Click the canvas to capture
the pointer; that same click starts the sound.

| control | does |
| --- | --- |
| mouse | look, once the pointer is locked by a click |
| `W` `A` `S` `D` | walk, at 1.55 m/s |
| `Shift` | jog |
| `Shift` + `Ctrl` | run, for covering ground quickly |
| `Space` | jump, about 45 cm |
| `0` – `9` | teleport along the wash |
| `Esc` | release the pointer |
| `F3` | frame-rate readout |

The teleports are 0 the start, 1 entering the wash, 2 mid wash, 3 the juniper, 4
the bend, 5 the sun gap, 6 past the second bend, 7 the long straight, 8 the upper
wash, 9 the head of the wash. The walk is meant to be taken on foot at 1.55 m/s,
a real walking pace, and runs about three and a half minutes end to end; the
number keys are for going back to something.

The jump is a person's jump and not a game's — 45 cm and just over half a second
in the air, enough to hop a rill or get up onto a bank, and not enough to reach
anywhere the walk could not take you. You keep the speed you left the ground
with, so there is no steering in mid-air.

The wash is a corridor between canyon walls and is built like one. Walk hard at a
cliff and the ground stops giving over the last stride or so rather than stopping
you dead against something invisible, and the same happens at the head of the
wash and a little way behind the start. The limit sits seven to eighteen metres
either side of the channel depending on its width, which is far enough out that
wandering five or six metres off the line never touches it — 4.2 minutes of
driven wandering, 5.8 m off the centreline, never touched a frame of it.

![The juniper on its bank, with the litter and the shadow it throws down the
wash](media/02-juniper.webp)

## What is in it

- About 26,000 lines of hand-written code across 19 files in `src/`, and roughly
  two hundred measurement tools in `tools/`.
- Seven systems, built and critiqued in order: terrain and the wash, the buttes,
  the juniper, lighting and sun, atmosphere, sound, and post.
- A 330 m walk, with nine fixed capture stations along it and four more that
  cover the outer half nothing used to photograph.
- 3.97 M triangles in the delivered frame, 2.25 M of them clast instances, in 55
  to 70 draw calls depending on where you stand.
- Exactly one juniper tree. It is the only significant vegetation in the project,
  which is a constraint rather than an omission.
- Every texture written texel by texel into a `DataTexture` or a canvas at load,
  which is what the boot buys.

![The lit midwall: bedding, jointing and the arrises that make this the best
surface in the project](media/03-wall.webp)

## Performance

**About 60 fps at native 2560×1440 on an RTX 4060**, measured while walking,
which is the expensive case — standing still is cheaper, because the sun's shadow
maps only have to be redrawn when you move. Measured on a machine verified idle
by SM clock; every worse figure this project recorded during the day turned out
to be a contended card rather than the frame, and a fourteen-commit bisect says
the frame itself was flat to 0.83 ms throughout.

The renderer watches how long frames are taking and can render into a smaller
picture and let the display scale it back up. On this card it mostly does not
need to: over a three-minute walk it chose full 2560×1440 for two thirds of the
time and never went below a mild reduction. It steps down while the first frames
are still compiling and climbs back within about a minute of walking. It is
aiming for a sharp picture at a comfortable sixty rather than the smoothest
possible motion at a soft one, which is the right way round for a walk whose
whole point is the landscape.

The range it can choose from, on an RTX 4060 at 2560×1440 with nothing else
running. *Walking* is the column that matters:

| what it renders | standing still | **walking** |
|---|---|---|
| 2560×1440 — full, no scaling | 58 fps | **55 fps** |
| 2253×1267 | 68 fps | **63 fps** |
| 2253×1267, fewer atmosphere samples | 81 fps | **74 fps** |
| 1997×1123 | 95 fps | **86 fps** |
| 1997×1123, lighter effects | 120 fps | **107 fps** |
| 1741×979 | 141 fps | **123 fps** |
| 1741×979, no bloom or depth of field | 152 fps | **135 fps** |
| 1485×835 | 180 fps | **155 fps** |
| 1280×720 | 203 fps | **176 fps** |

**Those are deliberately cautious numbers, which is why the headline is higher
than the top row.** The way that table is timed makes the CPU's work and the
GPU's work happen one after the other, where in normal play the two overlap.
Timing a real running frame instead gives about 60 at full resolution rather than
the 55 in the table. Every row is a floor.

The frame is fill-bound, not geometry-bound, which is worth knowing before
optimising anything: removing the far ridgelines entirely is worth 0.02 ms of a
30 ms frame. One measurement in that account is **unexplained and is recorded as
unexplained** — the same cell read 16.80 ms in one tool and 23.06 in another on
the same commit, and neither code growth nor machine contention accounts for it.
Two confident causal stories died there in one morning; neither is quoted here.

Two URL hashes override the governor, and both are read once at startup, so they
have to be loaded fresh — typing one onto the end of an open page does nothing:

| hash | does |
| --- | --- |
| `#target=120` | asks for 120 fps, which it very nearly reaches by rendering at 1997×1123 and letting the display scale it up |
| `#high` | pins full 1440p and switches the automatic adjustment off entirely |

Sharper or smoother is a matter of taste; sharper is the default because of what
this particular thing is. The governor will also notice other demanding work on
the machine and quietly drop quality to hold the frame rate, then climb back on
its own when that work finishes — it tries a step up every so often and keeps the
one that fits — so nothing is lost permanently and you should not need to reload.

## What is not good enough yet

An honest list, because the alternative is that you find these yourself and
wonder what else is being oversold. Each one has been measured rather than
guessed at, and several are recorded as bounded and explained rather than as
things nobody got round to.

**A quilted cross-hatch on near-field rock, and pale flat angular slabs.** The
slabs are the largest visual item still open — a playthrough ranked them the most
attention-breaking thing on the route, and they read as untextured placeholder
geometry. The quilt is worse than unfixed, it is *unattributed*: its strongest
suspect, the clast grain layer, has been eliminated on three separate properties
plus a fourth proposed later, and the tiling it was suspected of cannot be
visible because the map's energy below k = 3 is 0.15 per cent of total, about one
code value through the shader that reads it. Both are identical in the ungraded
arm, so neither belongs to the colour grade. The instructive part is that the
metric could not see it at all: the floor carrying a plainly visible cross-hatch
measures a perfectly respectable 0.45 on high-to-low band ratio, on both arms.

**The slabs' side faces read as pure black, and the whole available range is
inside the ACES toe.** Nothing upstream is broken — deleting the entire clast
occlusion chain moves the worst pixel from rgb(6,3,3) to rgb(13,9,7). The
textbook fix fails for a reason worth recording: the worst facet sits 1.27 stops
below the shaded floor, so no operation keyed on level can separate them, and
every gain setting that stays inside the shadow gate's band moves the worst facet
from code 6 to at most code 9.

**Warm shade in the corridor, where the brief imagined blue.** This is physically
correct rather than a defect: on a shaded lateral face the fill decomposes as
47.8 per cent sky, 25.1 per cent escarpment bounce and 27.2 per cent ground
bounce, and the cool term is already the largest by luminance while losing the
chroma fight because the warm terms are three times its saturation. What is left
is bounded by crush rather than by transport. **Every request to brighten shaded
rock in this scene has landed 1.6× beyond the light available to deliver it**,
and that factor has now arrived three times from unrelated premises — from
radiometry, from the project's own photograph-referenced band, and from a single
facet's measured fill budget. The `shade_far` station at 160 m is where the scene
does produce cool shade, and it produces it honestly.

**Cliff jointing is weaker than real Sedona sandstone.** The vertical joint
system exists and was measured before anything was added to it: ablating all four
sets moves the lit midwall's vertical-to-horizontal line ratio only from 0.77 to
0.75. The walls still read more horizontally banded than a real Supai or Coconino
face, and wind-scoured alcoves are not built at all — a gap in the surface
vocabulary rather than a defect in what is there.

**The juniper leans across a wind that nothing else in the scene blows along.**
The tree leans and piles its litter on one heading; the dust, the saltation
ribbons and the bed drift run off another. They are 76° apart. It is nobody's
mistake in particular, and reconciling the two vectors is a real piece of work
rather than a one-line fix.

**The sun disc is deliberately not visible**, which is a knowing deviation from a
brief that asks for it three times. The disc is already geometrically unoccluded
from the lower wash and measures 2.6 per cent contrast against the sky around it;
a defined disc needs roughly a 2 km visual range, which is exactly the air that
flattens the receding ridgelines. The disc and the depth ladder compete for one
dial, and the ridgelines won.

**Nobody in this pipeline has heard the sound.** Every judgement made about it is
from spectrograms and offline DSP measurements. It is complete, it is measured,
and it has never been listened to by the thing that built it.

![The cool half of the walk, 160 m out: shaded floor against sunlit stratified
wall](media/04-shade-far.webp)

## A note on dependencies

`package.json` lists one runtime dependency, but this is not a page that loads
nothing over the network: Three.js 0.180 is fetched from a jsDelivr CDN at
runtime through an importmap in `index.html`, so that the same tree serves both
locally and from GitHub Pages. Three.js and nothing else. `pnpm install` is what
the Playwright capture and measurement harness in `tools/` needs.

The zero-asset claim is a separate one, and it is airtight. There is no
`TextureLoader`, `GLTFLoader`, `RGBELoader`, `AudioLoader`, `FileLoader`,
`fetch`, `XMLHttpRequest`, `new Image` or `createImageBitmap` anywhere in `src/`.
The only binaries in the repository are the four screenshots on this page, and
they are output, not input.

## Stack

Three.js 0.180 · plain ES modules with an importmap · no build step · about
26,000 lines across 19 files in `src/` · Playwright for the capture and
measurement harness in `tools/`. No asset pipeline, because there are no assets.

## Credits

Technique and discipline follow two earlier procedural-scene projects. The
adaptive quality governor in `src/perf.js` is
[nightdrive](https://github.com/StarKnightt/nightdrive)'s structure — resolution
and quality as two ladders interleaved into one degradation order — with
[jungle-trail](https://github.com/StarKnightt/jungle-trail)'s hysteresis on top
of it. The habit that matters most came from jungle-trail too: quote a frame time
in milliseconds measured on the real card, and author the quality ladder against
those numbers rather than against a guess. Both are written up, with what was
taken and what was declined, in [`PERF.md`](PERF.md).

## Licence

MIT — see [`LICENSE`](LICENSE).
