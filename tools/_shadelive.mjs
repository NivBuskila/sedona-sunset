/* Does the shader actually compile, on the GPU, in forty seconds?
 *
 * glslcheck.mjs parses the shader literals and _p7pre.mjs evaluates every module,
 * and neither can see a GLSL semantic error: a use-before-declaration in the
 * injected chunk passed both and then cost a seven-and-a-half minute four-view
 * capture at 2560x1440, which came back with the compile log where the frames
 * should have been. That is the second capture round this class of bug has taken.
 *
 * Boots the page once at a token resolution, walks a couple of viewpoints so the
 * rock, terrain and vegetation materials are all forced through compilation, and
 * prints whatever the page said. No PNGs, nothing to measure, one question only:
 * is it safe to spend the render.
 *
 *   node tools/_shadelive.mjs
 */
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

await run({ width: 480, height: 270, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);
  for (const nm of ['wall_lit', 'far_220', 'bend', 'ground']) {
    const v = VIEWS.find((q) => q.name === nm);
    if (!v) continue;
    await page.evaluate(([vv]) => {
      const g = window.__game;
      g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch); g.renderOnce(); g.renderOnce();
    }, [v]);
  }
  /* The rock meshes, asked of the scene graph: a material whose program failed to
     link still sits in the scene and still reports a geometry, so the count going
     to zero is not the signal — the page's own error log is. */
  const n = await page.evaluate(() => {
    let k = 0;
    window.__game._scene.traverse((o) => {
      if (o.isMesh && /wall|apron|butte|talus/i.test(o.name || '')) k++;
    });
    return k;
  });
  console.log(`  ${n} rock meshes in the graph`);
  if (errs.length) {
    console.log(`\n  ${errs.length} page error(s) — DO NOT SPEND A CAPTURE:\n`);
    for (const e of errs) console.log(String(e).split('\n').slice(0, 24).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('  no page errors — safe to shoot');
  }
});
