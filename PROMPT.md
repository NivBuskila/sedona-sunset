# The brief

This is the prompt this project was built from. It was pasted into Cursor as a
single message, and everything in the repository came out of it and out of the
critic loop it sets up.

It is reproduced here in full but not verbatim. The original also carried
machine-specific scheduling — hardware, screens, when to stop hammering the
GPU — and none of that says anything about Sedona, so it has been stripped. What
is left is portable: paste it into Cursor or Claude Code, in an empty directory,
and it will run.

---

> Build a first-person walking experience through Sedona, Arizona at golden
> hour. A dirt wash winding between towering red rock buttes. Long shadows
> stretching across the ground, heat haze rippling off the rocks, one lone
> juniper tree. The sun sitting low in a gap between two formations. No forest,
> no water features, no UI, no HUD. Just movement and atmosphere.
>
> This should look like a real photograph from Arizona. Not stylized, not
> low-poly. Think National Geographic cover: warm reds and oranges on sandstone,
> purple shadows in the crevices, dusty golden light catching particles in the
> air. **A paused frame should be indistinguishable from a real sunset photo of
> Sedona.**
>
> The player walks a single winding dirt wash. Red buttes rise on both sides.
> The path curves gently, revealing new rock formations as you walk. The sun is
> always ahead, low in a gap between the rocks, pulling you forward. Dust
> particles drift in the light.
>
> Do this in Three.js. **Zero external assets** — every texture, every mesh and
> every sound generated procedurally in code.
>
> Work on ONE system at a time in this exact order:
>
> 1. **Terrain and wash path** — dry riverbed with sand, pebbles, cracked earth,
>    red dirt; the wash should feel like walking between canyon walls.
> 2. **Red rock buttes** — layered sandstone on both sides, horizontal
>    striations, erosion patterns, overhangs, Sedona's signature red/orange rock
>    with darker iron oxide streaks.
> 3. **The juniper** — one weathered desert juniper, twisted trunk, sparse dusty
>    green foliage, the only vegetation, maybe a few dead grasses at the base.
> 4. **Lighting and sun** — golden hour directional light in the gap between
>    buttes, long dramatic shadows, warm orange on the rock faces, cool purple in
>    the shadows; the sun should feel heavy and low.
> 5. **Heat haze and atmosphere** — heat distortion off the rocks and ground,
>    dust particles in the sunbeams, atmospheric perspective making distant
>    buttes hazy and desaturated.
> 6. **Sound design** — procedural ambient: wind through the wash, distant
>    coyote, sand shifting, the silence of the desert; the quiet is the feature.
> 7. **Post-processing and polish** — warm colour grading, depth of field,
>    subtle lens flare from the sun, film grain.
>
> For each system: build it, then spawn ONE separate sub-agent as a harsh visual
> critic. The critic compares the result against real Sedona sunset photography
> and rates whether it looks photorealistic. If it doesn't, keep iterating on
> that system before moving to the next. **The critic must never be the same
> agent that built the thing, and must only see the rendered output, not the
> code.** `/loop` on each system until the critic says it genuinely looks like a
> real Arizona sunset, not a game. Then move to the next.
>
> Explore for Three.js skills first — `/find-skills threejs AAA game`.
>
> Don't stop until a paused frame looks like an Arizona postcard you'd buy at a
> gift shop in Sedona. Use pnpm, not npm.

---

## The part worth copying

The scene description above is the easy half. Anyone can write "warm reds and
oranges on sandstone" and get something orange back.

The load-bearing instruction is the one about the critic: build a system, then
hand the rendered output — and only the rendered output — to a *different* agent
whose entire job is to say it does not look real yet. The builder is not allowed
to grade its own work, and the critic is not allowed to read the source.

That split is what does the work, for one reason. An agent that can see the code
will explain the picture to itself. It knows there is a three-octave noise field
in the sandstone, so it sees layered rock. Take the code away and it has nothing
to look at but the pixels, and the pixels are all a viewer ever gets. Every
defect this project actually shipped a fix for was found that way — the shadows
being the wrong hue, the haze reading as fog rather than dust, the far buttes
sitting too crisp against the sky. None of those are bugs. Every one of them
ran, produced a plausible image, and only failed against a photograph.

The `/loop` matters too. One round of criticism gets you an agreeable list of
improvements. Looping until the critic signs off is what turns the list into
work, and it is the difference between a scene that has been criticised once and
a scene that has been iterated on.

Both `/loop` and `/find-skills` are Cursor commands and are quoted here as they
were actually used. If you are running this somewhere else, the equivalent is
just: keep going until an independent reviewer that has only seen the image says
stop.
