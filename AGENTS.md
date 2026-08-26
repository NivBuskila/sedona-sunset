# Agents / Dev Notes

## What this is
A fully procedural Three.js first-person walk through Sedona, Arizona at golden hour. No assets — all geometry, textures, and audio are generated in code at load time.

## How to run
```bash
docker compose -f docker-compose.base44.yml up -d
```
Then open port 3000. The page will show a black screen with loading messages for 30–60 seconds while it procedurally generates the entire scene on the GPU/CPU.

## Quirks
- **Long cold boot**: Generation takes 30–60s of blocking JS. The page is unresponsive during this time — that's expected. A *repeat* visit is much faster; see the bake store below.
- **The bake store (`src/bake.js`)**: the generated textures and the heavy geometry are cached in IndexedDB (14 entries, ~91 MB), so only the first load on a given browser pays full price — 66 s cold, 27 s warm. Three things about it are worth knowing before you debug anything odd:
  - **A code change invalidates it automatically.** The cache key carries a SHA-256 of every `src/*.js` the browser actually loaded, discovered from `performance.getEntriesByType('resource')` — so there is no file list to keep in sync, and editing any module orphans every entry on the next load. If you are ever unsure, `window.__game._clearBake()` empties it.
  - **It fails silently by design.** No IndexedDB, quota exceeded, another tab holding an older DB version — every one of those falls through to plain generation. A slow boot is a *symptom*, never a break; check `window.__game._bake` for `hits`/`misses`/`state`.
  - **Do not cache anything whose generation has side effects** unless the side effects are cached too. `buildScatter` is the standing example and the reason it is not in the store: it registers scour hollows on the height field as it places clasts, and the player's feet read those. Skipping the loop without replaying the registrations would leave the ground and the footfall disagreeing.
- **Where the boot time actually is**: not in the textures, despite how much texel-by-texel loop code there is — all seven texture stages are 6.4 s of 66. The three geometry stages are 51 s. Measure before optimising.
- **Measuring a cold boot**: the timings live in `window.__game._boot` (`total`, and `phases` with per-phase ms). Call `_clearBake()` and reload, or use a fresh browser profile, or you will measure the warm path and think generation got fast.
- **No build step**: Plain ES modules with an importmap pulling Three.js from CDN.
- **No external services or secrets needed** — everything is client-side.
- The dev server is a minimal Node.js HTTP static file server in `tools/serve.mjs`.
