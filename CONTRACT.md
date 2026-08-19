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

The distribution matters more than the mean. A real wash floor gets its saturation spread
from mixed lithology — iron-stained red clasts, desert-varnished near-black pebbles, and
orange mud stringers sitting beside pale quartz sand. That produces a long saturated tail
(p99 ≈ 0.88). A narrow band at any mean reads as procedural however well the mean is
matched, so widen the tail rather than raising the average.

## Build order

Each system is built to completion and passes visual critique before the next one starts.
Systems are built one at a time — never two at once.

1. Terrain and wash path
2. Red rock buttes
3. The juniper
4. Lighting and sun
5. Heat haze and atmosphere
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
