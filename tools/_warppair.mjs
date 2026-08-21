/* Ablate one named scalar uniform on the rock materials, inside one page load.
 *
 * Written for the registration warp: `wall_lit` midwall reads hf/lf 0.49 against
 * a gate of 0.55, and the shortfall is upstream of System 7's chain — they
 * measured 0.49 ungraded against 0.50 graded. The warp landed the same night and
 * it slides the sampling domain of the albedo, the AO and the normal together, so
 * it was the first suspect: a domain warp is a local rescaling, and a local
 * rescaling of a high-frequency octave can cost high-frequency energy while
 * leaving the low-frequency term alone, which is the shape of a falling hf/lf.
 *
 * Toggled inside one load rather than across two shoot.mjs runs, because two
 * captures are not a pair — same modules, same textures, same sun, same frame,
 * one uniform different. Works for any `uXxxK`-style scalar the material declares
 * for this purpose: `uWarpK`, `uJointK`.
 *
 *   node tools/_warppair.mjs uWarpK wall_lit
 *   node tools/grad.mjs shots/uWarpK1_wall_lit.png shots/uWarpK0_wall_lit.png
 */
import { run, capture } from './harness.mjs';
import { VIEWS } from './views.mjs';

const knob = process.argv[2] || 'uWarpK';
const view = process.argv[3] || 'wall_lit';
const v = VIEWS.find((q) => q.name === view)
  || (() => { const [d, yaw, pitch] = view.split(',').map(Number); return { d, yaw, pitch }; })();

await run({ width: 1600, height: 900, hash: 'high&noadapt&nopost' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  for (const k of [1, 0]) {
    const set = await page.evaluate(([vv, kk, nm]) => {
      const g = window.__game;
      g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch);
      let n = 0;
      g._scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const u = m.userData && m.userData.uniforms;
          if (u && u[nm]) { u[nm].value = kk; n++; }
        }
      });
      g.renderOnce(); g.renderOnce();
      return n;
    }, [v, k, knob]);
    await capture(page, `shots/${knob}${k}_${view}.png`);
    console.log(`  ${knob} ${k}  on ${set} rock materials`);
  }
  if (errs.length) console.log('  page errors present — do not trust these frames');
});
