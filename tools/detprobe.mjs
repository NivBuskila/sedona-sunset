/* What state does a capture actually settle on?
 *
 *   node tools/detprobe.mjs [distance]
 *
 * A determinism failure is a difference between two page loads, and the pair
 * tools measure it in pixels — which says that something moved and nothing
 * about what. This reads the handful of scalars that a capture is a function
 * of, so two runs of this can be diffed directly and the culprit named without
 * spending a second capture set on a guess:
 *
 *   · the quality governor's tier, render scale and whether it is still
 *     adapting — the ladder changes render scale, shadow map size and particle
 *     counts, so a run that settled on a different rung is a different picture
 *   · the atmosphere's frozen capture clock, which sets every mote position,
 *     the saltation phase and the heat-haze warp
 *   · System 7's grain phase
 *   · the audio clock and the soundscape's lateral proximity term, because a
 *     non-finite one of those throws out of the frame loop every frame
 *
 * Read-only: it walks to a viewpoint and reports, and never writes a PNG.
 */
import { run } from './harness.mjs';

const d = Number(process.argv[2] || 46);

await run({ width: 1600, height: 900, waitReady: false }, async ({ page, errs }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  console.log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const out = await page.evaluate((dist) => {
    const g = window.__game;
    g.walkTo(dist);
    g.lookAt(0, 0);
    const num = (v) => (typeof v === 'number' ? +v.toFixed(6) : v);
    const sc = g.audio && g.audio._sc;
    const cam = g._camera.position;
    const u = sc && sc.path ? sc.path.uOf(cam.x, cam.z) : null;
    return {
      perf: {
        gpu: g.perf.gpu, software: g.perf.software, harness: g.perf.harness,
        adapting: g.perf.adapting, tier: g.perf.tier, scale: g.perf.scale,
        buffer: g.perf.stats().buffer, shadow: g.perf.stats().shadow,
      },
      atmo: g._atmo.wind,
      grain: g._post.grain,
      cam: [num(cam.x), num(cam.y), num(cam.z)],
      audio: {
        state: g.audio.state, time: num(g.audio.time),
        prox: sc ? num(sc.prox) : null,
        uOf: num(u),
        proxFinite: sc ? Number.isFinite(sc.prox) : null,
        gusts: sc ? sc.gusts.length : null,
        schedHead: sc ? num(sc.schedHead) : null,
      },
      info: g.info(),
    };
  }, d);

  console.log(JSON.stringify(out, null, 2));
  if (errs.length) console.log(`\n${errs.length} page error(s)`);
});
