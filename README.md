# Sedona Sunset

A first-person walk up a dirt wash between red rock buttes in Sedona, Arizona, at golden
hour. You start at the mouth of the wash with the sun low in the gap ahead of you, and you
walk about 330 metres up the channel to where it heads up into a box canyon.

There is nothing to do and nothing to collect. It is a place to be in for ten minutes.

## Running it

You need [Node.js](https://nodejs.org/) and **pnpm** — not npm; the lockfile is pnpm's and
npm will install a different dependency tree.

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:8099/** in Chrome or Edge.

**The first load takes about forty seconds.** It tells you so, and it tells you what it is
doing: a dark screen comes up immediately and names each stage as it goes — the wash floor,
the sandstone, cutting the wash, raising the canyon walls, scattering the stones, the
juniper, the sky. Everything you are about to look at is being drawn pixel by pixel in code
before the first frame can be shown, and that is what the wait buys.

A couple of those stages take ten seconds on their own, so the message will sit still for a
while and the tab will ignore a click while it does. That is the work happening, not a
hang. Reloading starts the wait over from the beginning, so it is worth sitting through.

## Controls

Click on the window once to capture the mouse. That same click also starts the sound.

| | |
| --- | --- |
| **Mouse** | look around |
| **W A S D** | walk |
| **Shift** | jog |
| **Shift + Ctrl** | run, for covering ground quickly |
| **Esc** | release the mouse |
| **F3** | frame-rate readout, if you want to see it |

**Number keys jump you along the wash**, which is the quickest way to see all of it:

| | | | | |
| --- | --- | --- | --- | --- |
| **0** the start | **1** entering the wash | **2** mid wash | **3** the juniper | **4** the bend |
| **5** the sun gap | **6** past the second bend | **7** the long straight | **8** the upper wash | **9** the head of the wash |

The walk is meant to be taken on foot at 1.55 m/s, which is a real walking pace and takes
about three and a half minutes end to end. The number keys are there for when you want to
go back to something.

There is no crosshair, no HUD and no menu, on purpose.

## How it will run

On a machine like the one this was built for — an RTX 4060 at 2560×1440 — it holds
**120 frames a second or better**, and that is what it aims for.

It gets there by adjusting itself. The scene is expensive to draw at full resolution, so
the game renders into a somewhat smaller buffer and lets the screen scale it back up, and
it chooses how much smaller by watching how long frames are actually taking. Left alone it
settles on an upscaled buffer somewhere around 1741×979 to 1997×1123, which on a 1440p
monitor is hard to tell from native and is roughly twice as fast.

**Give it a minute to find its level.** For the first three quarters of a minute after
loading it runs at full 2560×1440 and about 55 fps, and only then steps down to the setting
that holds 120. That is the one rough patch in the whole thing and waiting it out is all it
needs.

If you would rather have the sharpest possible image and do not mind about 59 fps, load
`http://localhost:8099/#high`, which pins it at full 1440p and turns the automatic
adjustment off. The address has to be loaded fresh — typing `#high` onto the end of a page
that is already open does nothing, because the setting is only read once at startup.

One last thing. It will use as much of your graphics card as you let it, so if something
else demanding is running at the same time it will notice and quietly drop its own quality
to keep the frame rate up. It is slow to put that quality back afterwards, so if the picture
ever looks soft for no reason, a reload will reset it.

## Everything in it is generated in code

There are no asset files of any kind in this project. No photographs, no models, no
recordings, nothing downloaded at runtime. The only thing it installs is the Three.js
library.

That means the red rock, the layered cliff faces, the gravel underfoot, the sand ripples,
the juniper and its shadow, the sky, the haze and the low sun are all written as
mathematics and drawn into memory the moment you open the page — which is what the long
first load is buying you.

The sound is the same. The wind, the grit skittering along the ground, your own footsteps
changing as the surface under them changes, the wrens and sparrows, the echo off the canyon
walls — none of it is a recorded sample. It is all synthesised live in the browser, and it
is genuinely quiet, because a desert wash at dusk is quiet. You may want to turn your
volume up a little more than you would expect.

## The wash holds you

The walk is a corridor between canyon walls and it is now built like one. Walk hard at a
cliff and the ground stops giving over the last stride or so rather than stopping you dead
against something invisible; the same happens at the head of the wash and a little way back
behind the start. It sits eight to eighteen metres either side of the channel depending on
how wide the wash is at that point, which is far enough out that walking the walk — even
wandering several metres off the line, which everyone does — never touches it. You have to
go and look for it.

Press **0** to get back to the start at any time.
