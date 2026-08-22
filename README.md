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

**The first load takes under a minute** — around fifty seconds on a desktop GPU. It tells you
so as it starts, and it tells you what it is
doing: a dark screen comes up immediately and names each stage as it goes — the wash floor,
the sandstone, cutting the wash, raising the canyon walls, scattering the stones, the
juniper, the sky. Everything you are about to look at is being drawn pixel by pixel in code
before the first frame can be shown, and that is what the wait buys.

Two of those stages take twelve to fourteen seconds on their own, so the message will sit still for a
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

On a computer that isn't doing anything else, the walk runs at about **37 frames a second
at the full 2560×1440 setting** on an RTX 4060, and the game quietly lowers the resolution
and detail to keep the motion smooth rather than letting it stutter — **settling at
1280×720, where the same walk runs at about 89**.

Those are honest numbers and they are measured ones, not targets. The scene is expensive
to draw at full resolution, so the game renders into a smaller buffer and lets the screen
scale it back up, choosing how much smaller by watching how long frames are actually
taking. It is aiming for 120 frames a second, which this scene cannot reach on this card
at any setting, so left alone it goes all the way down to the softest setting it has and
gives you the smoothest picture instead of the sharpest one.

**If you would rather have the sharper picture, load `http://localhost:8099/#target=60`.**
That asks it for a steady 60 instead of an unreachable 120, and it settles around
1997×1123 — hard to tell from native on a 1440p monitor — at roughly 52. Which of those
two you prefer is a matter of taste and neither is wrong.

**Give it a couple of seconds to find its level.** It starts at full 2560×1440 and steps
down to the setting it settles on within about two and a half seconds of the first frame.
You will probably not notice it happen.

The whole range it can choose from, measured on an RTX 4060 at 2560×1440 with nothing else
running on the machine. *Walking* is the column that matters, because walking is what you
do — standing still is cheaper, since the sun's shadow maps only have to be redrawn when
you move:

| what it renders | standing still | **walking** |
|---|---|---|
| 2560×1440 — full, no scaling | 43 fps | **37 fps** |
| 2253×1267 | 49 fps | **42 fps** |
| 2253×1267, fewer atmosphere samples | 56 fps | **48 fps** |
| 1997×1123 | 62 fps | **52 fps** |
| 1997×1123, lighter effects | 76 fps | **63 fps** |
| 1741×979 | 85 fps | **72 fps** |
| 1741×979, no bloom or depth of field | 99 fps | **74 fps** |
| 1485×835 | 112 fps | **84 fps** |
| 1280×720 | 126 fps | **89 fps** |

So it will not give you 120 frames a second while you are walking, at any setting, on this
card — the bottom of that list is 89, and that is where it ends up by default. If your
monitor runs at 200 Hz you will not saturate it. What you do get is a frame rate that
holds its number rather than collapsing when you turn to face the wall.

These are also a floor rather than a best guess: the way they were timed makes the
computer do its own work and the graphics card's work one after the other, where in
normal play the two overlap. Real play should be a little better than the table, never
worse.

If you would rather have the sharpest possible image and do not mind the high thirties,
load `http://localhost:8099/#high`, which pins it at full 1440p and turns the automatic
adjustment off. Any of these addresses has to be loaded fresh — typing `#high` onto the
end of a page that is already open does nothing, because the setting is only read once at
startup.

One last thing. It will use as much of your graphics card as you let it, so if something
else demanding is running at the same time it will notice and quietly drop its own quality
to keep the frame rate up. When that other thing finishes it climbs back on its own — it
tries a step up every so often and keeps the one that fits — so nothing is lost permanently
and you should not need to reload.

## Everything in it is generated in code

There are no asset files of any kind in this project. No photographs, no models, no
recordings, nothing downloaded at runtime. The page's only dependency is the Three.js
library, served from `node_modules`.

That means the red rock, the layered cliff faces, the gravel underfoot, the sand ripples,
the juniper and its shadow, the sky, the haze and the low sun are all written as
mathematics and drawn into memory the moment you open the page — which is what the long
first load is buying you.

The sound is the same. The wind, the grit skittering along the ground, your own footsteps
changing as the surface under them changes, a canyon wren, a raven, a coyote somewhere off
in the dark, the echo off the canyon walls — none of it is a recorded sample. It is all synthesised live in the browser, and it
is genuinely quiet, because a desert wash at dusk is quiet. You may want to turn your
volume up a little more than you would expect.

## The wash holds you

The walk is a corridor between canyon walls and it is now built like one. Walk hard at a
cliff and the ground stops giving over the last stride or so rather than stopping you dead
against something invisible; the same happens at the head of the wash and a little way back
behind the start. It sits about seven to eighteen metres either side of the channel
depending on how wide the wash is at that point, which is far enough out that walking the
walk — even wandering five or six metres off the line, which everyone does — never touches
it. You have to go and look for it.

Press **0** to get back to the start at any time.
