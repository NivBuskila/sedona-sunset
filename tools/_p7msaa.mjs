/* Is anything in this frame multisampled, and if not, why not?
 *
 * System 2 probed the frame by wrapping setRenderTarget and reported that no
 * multisampled target is bound at any point, which does not match reading the
 * code: perf.js's top tier asks for four samples, atmosphere.js allocates its
 * scene target with them, three 0.180 supports MSAA alongside a depth texture,
 * and the shaft pass keeps that target alive even with the shimmer displacement
 * off. One of those statements is wrong and no amount of further reading will
 * say which, so this asks the driver.
 *
 * It reports three things per target actually bound during one frame: what three
 * was asked for (`samples`), what three built (whether a multisampled
 * framebuffer object exists in its private properties), and what the driver says
 * is bound (GL_SAMPLES on the live framebuffer), which is the only one of the
 * three that cannot be argued with.
 *
 *   node tools/_p7msaa.mjs
 */
import { run } from './harness.mjs';

await run({ width: 800, height: 450 }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  const out = await page.evaluate(() => {
    const g = window.__game;
    const r = g.renderer;
    const gl = r.getContext();
    g.walkTo(46); g.lookAt(0, 0);

    /* Both branches, in one run, because measuring one of them and reading the
       code for the other is exactly how this turned into two agents with
       opposite answers. The second pass disables System 5's stage, which is what
       hands the scene draw to System 7's own target — the configuration that
       ships if the shafts are ever retired, and the one that had no samples. */
    const probe = (label) => {

      /* Wrapped at the GL level, not at renderer.setRenderTarget.
       *
       * The obvious probe is to wrap setRenderTarget, and it silently returns
       * nothing: post.js binds its own reference to the method at construction
       * and temporarily replaces the property during the composite, so a wrapper
       * installed later is both bypassed by the bound reference and then
       * overwritten. glBindFramebuffer is underneath all of that, and GL_SAMPLES
       * on the freshly bound framebuffer is the driver's own answer to the only
       * question that matters. */
      const seen = new Map();
      const order = [];
      const realBind = gl.bindFramebuffer.bind(gl);
      let draws = 0;
      const realDraw = gl.drawElements.bind(gl);
      const realDrawI = gl.drawElementsInstanced ? gl.drawElementsInstanced.bind(gl) : null;
      let cur = 'none';
      gl.bindFramebuffer = function (target, fb) {
        const out = realBind(target, fb);
        if (target === gl.FRAMEBUFFER || target === gl.DRAW_FRAMEBUFFER) {
          let s = null;
          try { s = gl.getParameter(gl.SAMPLES); } catch (e) { s = 'err'; }
          cur = (fb === null ? 'canvas' : 'fbo') + ':' + s;
          if (!seen.has(cur)) { seen.set(cur, { samples: s, binds: 0, draws: 0 }); order.push(cur); }
          seen.get(cur).binds++;
        }
        return out;
      };
      gl.drawElements = function (...a) { draws++; if (seen.has(cur)) seen.get(cur).draws++; return realDraw(...a); };
      if (realDrawI) {
        gl.drawElementsInstanced = function (...a) {
          draws++; if (seen.has(cur)) seen.get(cur).draws++; return realDrawI(...a);
        };
      }

      g.renderOnce();
      gl.bindFramebuffer = realBind;
      gl.drawElements = realDraw;
      if (realDrawI) gl.drawElementsInstanced = realDrawI;

      /* Tag what we can identify, so the list is readable. */
      const post = g._post && g._post._diag ? g._post._diag : null;
      const atmo = g._atmo || null;
      return {
        label,
        sceneRT: post && post.sceneRT
          ? { w: post.sceneRT.width, samples: post.sceneRT.samples | 0, depthTex: !!post.sceneRT.depthTexture }
          : null,
        targets: post ? post.targets : null,
        shafts: atmo && atmo.shaftInfo ? atmo.shaftInfo().enabled : 'unknown',
        draws,
        seen: order.map(k => ({ key: k, ...seen.get(k) })),
      };
    };

    const shipped = probe('shipped');

    const atmo = g._atmo;
    if (atmo) { atmo.setShimmer(false); if (atmo.setShaftQuality) atmo.setShaftQuality(0); }
    /* Two frames, not one: the sample count follows the previous frame's branch
       by design, so the first frame after the switch is the reallocation and the
       second is the steady state a capture would see. */
    g.renderOnce();
    const fallback = probe('fallback, System 5 stage off');

    return {
      contextAA: !!(gl.getContextAttributes() || {}).antialias,
      maxSamples: gl.getParameter(gl.MAX_SAMPLES),
      tier: g._perf ? g._perf.stats() : null,
      runs: [shipped, fallback],
    };
  });

  console.log(`\ncanvas antialias attribute: ${out.contextAA}    driver MAX_SAMPLES: ${out.maxSamples}`);
  if (out.tier) console.log(`tier: ${out.tier.tier || JSON.stringify(out.tier).slice(0, 120)}`);
  for (const run of out.runs) {
    console.log(`\n── ${run.label} ──`);
    console.log(`post sceneRT: ${JSON.stringify(run.sceneRT)}`);
    console.log(`ownDraw (System 7 drew the scene): ${run.targets ? run.targets.ownDraw : '?'}` +
                `    shaft pass: ${run.shafts}`);
    console.log(`framebuffers bound during one frame (${run.draws} indexed draws total):`);
    console.log('  driver SAMPLES   binds   draws');
    for (const s of run.seen) {
      console.log(`  ${String(s.samples).padStart(14)}  ${String(s.binds).padStart(6)}  ${String(s.draws).padStart(6)}`);
    }
    const msDraws = run.seen.filter(s => s.samples > 1).reduce((a, s) => a + s.draws, 0);
    console.log(`  => ${msDraws} of ${run.draws} draws land in a multisampled framebuffer.`);
  }
  if (errs.length) console.log('\npage errors:\n  ' + errs.join('\n  '));
});
