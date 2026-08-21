/* Which buffer the scene is actually drawn into, and how many samples it has.
 *
 *   node tools/_aaprobe.mjs
 *
 * The whole-scene critique reports hard stair-step jaggies on every silhouette
 * against bright sky, and notes that the harness pins the top quality tier,
 * which is 4x multisampling — so either something bypasses it or the edge is
 * alpha-tested rather than geometric. Both `main.js` (antialias: false on the
 * context) and `post.js` (samples: 0 on sceneRT) are consistent with the first,
 * and post.js carries a note saying so in as many words. But which target
 * receives the scene depends on whether System 5's stage is live at the tier the
 * harness pins, and that is a runtime fact, not a readable one.
 *
 * So ask the renderer. Reports the tier, both candidate targets and their
 * sample counts, and which one three last bound.
 */
import { run } from './harness.mjs';

await run({ width: 1600, height: 900, waitReady: false }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  const r = await page.evaluate(() => {
    const g = window.__game, R = g.renderer;
    const seen = [];
    /* Wrap setRenderTarget for one frame: the target bound immediately before
       the largest draw is the one the scene lands in, and nothing else has to
       be assumed about either chain's internals. */
    const orig = R.setRenderTarget.bind(R);
    R.setRenderTarget = (t, ...rest) => {
      seen.push(t ? {
        w: t.width, h: t.height,
        samples: t.samples,
        type: t.texture && t.texture.type,
        depthTexture: !!t.depthTexture,
      } : null);
      return orig(t, ...rest);
    };
    g.renderOnce();
    R.setRenderTarget = orig;

    const info = g.probe ? g.probe() : null;
    return {
      contextAA: R.getContext().getContextAttributes().antialias,
      tier: info && info.tier !== undefined ? info.tier : (g.perf && g.perf.tier),
      targets: seen,
      probe: info,
    };
  });

  console.log(`context antialias: ${r.contextAA}`);
  console.log(`tier: ${JSON.stringify(r.tier)}`);
  console.log(`\nrender targets bound during one frame, in order:`);
  for (const t of r.targets) {
    console.log('  ' + (t === null ? 'canvas (null)'
      : `${t.w}x${t.h}  samples=${t.samples}  type=${t.type}  depthTex=${t.depthTexture}`));
  }
  const msaa = r.targets.filter(t => t && t.samples > 0);
  console.log(`\ntargets with samples > 0: ${msaa.length}`);
  if (r.probe) console.log(`probe: ${JSON.stringify(r.probe)}`);
});
