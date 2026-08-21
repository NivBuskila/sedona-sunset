/* Where the varnish is being lost.
 *
 * The critique reports no visible varnish on wall_lit, and loosening the two
 * lithological gates changed the frame by nothing at all — so the term is being
 * killed somewhere else and guessing which factor has cost two renders already.
 * uVarnDbg (a temporary uniform, removed once this had answered) substituted
 * progressively larger subsets of the product:
 *
 *   1  the vertical-face gate alone      — is the mix reaching the frame at all
 *   2  plate profile x hang, ungated     — is the plate geometry over this wall
 *   3  cell lottery x plate profile      — is the hang the thing zeroing it
 *
 * Whichever step first shows tongues is the one above the fault. The answer was
 * that none of them did until the plate profile was widened: the mix reaches the
 * frame at full strength and both lithological gates were innocent, and what was
 * missing was density — one tongue every nineteen metres of wall.
 *
 * Kept because the uniform is cheap to reinstate and this is the second feature
 * in this project that existed, was correct, and could not be seen.
 */
import { run, capture } from './harness.mjs';
import { VIEWS } from './views.mjs';

const view = process.argv[2] || 'wall_lit';
const v = VIEWS.find((q) => q.name === view);

await run({ width: 1600, height: 900, hash: 'high&noadapt' }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  for (const k of [0, 1, 2, 3]) {
    await page.evaluate(([vv, kk]) => {
      const g = window.__game;
      g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch);
      g._scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const u = m.userData && m.userData.uniforms;
          if (u && u.uVarnDbg) u.uVarnDbg.value = kk;
        }
      });
      g.renderOnce(); g.renderOnce();
    }, [v, k]);
    await capture(page, 'shots/vdbg_' + view + '_' + k + '.png');
    console.log('  step ' + k);
  }
});
