# Agents / Dev Notes

## What this is
A fully procedural Three.js first-person walk through Sedona, Arizona at golden hour. No assets — all geometry, textures, and audio are generated in code at load time.

## How to run
```bash
docker compose -f docker-compose.base44.yml up -d
```
Then open port 3000. The page will show a black screen with loading messages for 30–60 seconds while it procedurally generates the entire scene on the GPU/CPU.

## Quirks
- **Long cold boot**: Generation takes 30–60s of blocking JS. The page is unresponsive during this time — that's expected.
- **No build step**: Plain ES modules with an importmap pulling Three.js from CDN.
- **No external services or secrets needed** — everything is client-side.
- The dev server is a minimal Node.js HTTP static file server in `tools/serve.mjs`.
