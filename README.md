# Sedona Sunset

A first-person walk up a dirt wash between red rock buttes in Sedona, Arizona, at
golden hour. You start at the mouth of the wash with the sun low in the gap ahead
of you and walk about 330 m up the channel to where it heads into a box canyon.

**Every mesh, texture, material and sound in this project is generated
procedurally in code.** There are no image files, no models, no HDRIs and no audio
recordings, and nothing is fetched at runtime. The red rock, the layered cliff
faces, the gravel underfoot, the sand ripples, the juniper and its shadow, the
sky, the haze and the low sun are written as mathematics and drawn into memory
the moment you open the page. So is the wind, the grit skittering along the
ground, your own footsteps changing with the surface under them, the canyon wren,
the raven and the echo off the walls — none of it is a sample. The page's only
dependency is Three.js, one file, pinned.

There is nothing to do and nothing to collect. There is no crosshair, no HUD and
no menu, on purpose.

**Walk it: https://starknightt.github.io/sedona-sunset/** — desktop, keyboard and
mouse. It takes about forty seconds to build the canyon before it lets you in,
and it says so while it works.

---

## Run it

**pnpm, not npm.** The lockfile is pnpm's and npm will install a different
dependency tree.

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:8099/> in Chrome or Edge.

**The first load takes under a minute** on a desktop GPU, and it tells you so. A
dark screen comes up within milliseconds and names each stage as it goes: the
wash floor, the sandstone, cutting the wash, raising the canyon walls, scattering
the stones, the juniper, the sky. Two of those stages take twelve to fourteen
seconds on their own, so the message sits still for a while and the tab ignores a
click while it does. That is the work happening, not a hang. Reloading starts the
wait over from the beginning.

Click the canvas to capture the pointer. That same click starts the sound, which
is worth having — it is deliberately quiet, because a desert wash at dusk is
quiet, so give it more volume than you would expect.

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
in the air, enough to hop a rill or get up onto a bank, and not enough to get
anywhere the walk could not take you. You keep the speed you left the ground
with, so there is no steering in mid-air.

The wash is a corridor between canyon walls and is built like one. Walk hard at a
cliff and the ground stops giving over the last stride or so rather than stopping
you dead against something invisible, and the same happens at the head of the
wash and a little way behind the start. The limit sits seven to eighteen metres
either side of the channel depending on its width, which is far enough out that
wandering five or six metres off the line never touches it.

---

## Performance

**About 60 fps at native 2560×1440 on an RTX 4060**, measured while walking,
which is the expensive case — standing still is cheaper, because the sun's shadow
maps only have to be redrawn when you move.

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

---

## Stack

Three.js 0.180 · plain ES modules with an importmap · no build step · about
26,000 lines across 19 files in `src/` · Playwright for the capture and
measurement harness in `tools/`. No asset pipeline, because there are no assets.
