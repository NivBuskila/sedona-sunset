/* Scratch: does anything break when the heat shimmer is switched off?
 *
 *   node tools/_a5off.mjs
 *
 * Two things ride on the shimmer's offscreen target rather than on the shimmer:
 * the marched in-scatter reads its depth texture, and System 7's defocus reads
 * the same depth. And the dust field's shadow lookup used to be fed from inside
 * the branch that only runs when the pass does, so turning the effect off
 * un-shadowed 34,000 motes as a side effect.
 *
 * None of that is visible in a frame that renders without erroring, which is
 * exactly why it is worth asserting rather than eyeballing.
 */
import { run } from './harness.mjs';

await run({ width: 800, height: 450, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.evaluate(() => { window.__game.walkTo(120); window.__game.lookAt(0, 6); });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(() => {
    const g = window.__game, a = g._atmo;
    const dust = g._scene.getObjectByName('dust');
    const du = dust.material.uniforms;
    const sm = a._shimmerMaterial;
    return {
      shimmerAmp: sm ? sm.uniforms.uAmp.value : null,
      shimmerDepth: !!(sm && sm.uniforms.tDepth.value),
      shafts: a.shaftInfo(),
      moteHasShadow: du.uHasShadow.value,
      moteMapBound: !!du.uShadowMap.value,
      passRan: !!a.lastInfo(),
    };
  });

  const chk = (ok, label, got) =>
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}${got === undefined ? '' : `  (${got})`}`);

  console.log('\nheat shimmer off by default:');
  chk(r.shimmerAmp === 0, 'displacement amplitude is zero', r.shimmerAmp);
  console.log('\nwhat must survive it:');
  chk(r.shafts.enabled, 'marched in-scatter still enabled');
  chk(r.shafts.hasShadow, 'shafts still have the shadow map');
  chk(r.moteHasShadow === 1, 'motes still sample the shadow map', r.moteHasShadow);
  chk(r.moteMapBound, 'mote shadow map is bound');
  chk(r.shimmerDepth, 'depth texture still published for System 7 defocus');
  chk(r.passRan, 'pass reports its draw-call figures');
  console.log(`\n  shafts: ${r.shafts.steps} steps, gain ${r.shafts.gain}, ` +
    `half-res ${r.shafts.halfRes}`);
  console.log(`  page errors: ${errs.length}`);
});
