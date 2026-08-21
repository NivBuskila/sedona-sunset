/* Attribute a rock artefact to the stage that causes it, in one page load.
 *
 *   node tools/_rockdiag.mjs rd --only wall_shade,bend,sun_gap
 *
 * The whole-scene critique reports a rectangular grid of thin dark lines ruling
 * the far wall in `wall_shade`, with a hard-edged pale parallelogram sitting on
 * it, and the same grid on the mid cliff in `bend`. That description has two
 * candidate causes that need opposite fixes, so guessing costs a build:
 *
 *   normals   creasedMesh emits four unwelded vertices per quad and averages
 *             each one over the neighbours it is allowed to gather from. If the
 *             weld threshold rejects a neighbour the quad flat-shades, and a
 *             field of those is a visible lattice on the mesh's own grid.
 *   shadows   a shadow-map texel projects onto a slanted receiver as a
 *             parallelogram, and acne along the texel grid is rectangular. The
 *             critique's "looks like a lit window" is what a texel that missed
 *             its caster looks like on a wall.
 *
 * So: render the same framing with shadows off, and again with the geometry's
 * own normals as colour. A lattice that survives into the normal buffer is in
 * the mesh; one that vanishes with shadowMap.enabled = false is not.
 *
 * Everything is captured inside a single page load, for the reason tools/
 * _farpair.mjs documents at length: with six agents editing src/, two separate
 * shoot.mjs runs are minutes to hours apart and are not comparable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, capture } from './harness.mjs';
import { VIEWS } from './views.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'rockdiag';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const W = Number(getf('w', 1600)), H = Number(getf('h', 900));
const only = getf('only', '');
const hash = getf('hash', '');

const views = only ? VIEWS.filter(v => only.split(',').includes(v.name)) : VIEWS;
const shotsDir = path.join(DIR, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

await run({ width: W, height: H, waitReady: false }, async ({ page, errs }) => {
  const t0 = Date.now();
  if (hash) {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.reload({ waitUntil: 'commit' });
    console.log(`  #${hash}`);
  }
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  console.log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  /* Built once and parked on the game object so each variant is a flag flip
     rather than an allocation inside the capture loop. */
  await page.evaluate(() => {
    const g = window.__game, T = g._three;
    g.__diag = {
      normal: new T.MeshNormalMaterial({ flatShading: false }),
      flat: new T.MeshNormalMaterial({ flatShading: true }),
      /* A neutral lambert receiver: strips every procedural term the rock
         material adds, so whatever pattern survives is the lighting's. */
      white: new T.MeshLambertMaterial({ color: 0xffffff }),
    };
  });

  const variants = (getf('vars', '') || 'full,noshadow,nojoint,normals,flatnorm,shadowonly').split(',');

  for (const v of views) {
    await page.evaluate(([d, yaw, pitch]) => {
      window.__game.walkTo(d);
      window.__game.lookAt(yaw, pitch);
    }, [v.d, v.yaw, v.pitch]);
    await page.waitForTimeout(400);

    for (const name of variants) {
      await page.evaluate((which) => {
        const g = window.__game, r = g.renderer, s = g._scene, d = g.__diag;
        s.overrideMaterial = null;
        r.shadowMap.enabled = (which !== 'noshadow');
        if (which === 'normals') s.overrideMaterial = d.normal;
        if (which === 'flatnorm') s.overrideMaterial = d.flat;
        if (which === 'shadowonly') s.overrideMaterial = d.white;
        /* The colluvial apron, on and off inside one page load. Comparing
           against a capture from earlier in the night cannot attribute anything:
           System 3 landed juniper work in between, so the vegetation in the two
           frames is not the same vegetation. */
        for (const n of ['apronL', 'apronR']) {
          const o = s.getObjectByName(n);
          if (o) o.visible = (which !== 'noapron');
        }
        /* Shared uniform objects, so setting one value reaches every mesh that
           uses the rock material — walls, buttes and talus alike. */
        s.traverse((o) => {
          const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of ms) {
            const u = m.userData && m.userData.uniforms;
            if (u && u.uJointK) u.uJointK.value = (which === 'nojoint') ? 0 : 1;
          }
        });
        /* Toggling shadowMap.enabled changes the defines the materials were
           compiled with, so without this the flag is set and the frame is
           byte-identical — which is exactly what the first run of this tool
           produced, and would have been read as "shadows are not the cause". */
        s.traverse((o) => {
          if (!o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
        });
        r.shadowMap.needsUpdate = true;
        g.renderOnce(); g.renderOnce();
      }, name);
      await capture(page, path.join(shotsDir, `${tag}_${v.name}_${name}.png`));
    }

    await page.evaluate(() => {
      const g = window.__game;
      g.renderer.shadowMap.enabled = true;
      g._scene.overrideMaterial = null;
      g.renderer.shadowMap.needsUpdate = true;
      g.renderOnce();
    });
    console.log(`  ${v.name}`);
  }

  fs.writeFileSync(path.join(shotsDir, `${tag}.json`), JSON.stringify({ logs: [...new Set(errs)] }, null, 2));
  console.log(`\n${views.length * 4} shots → shots/${tag}_*_{full,noshadow,normals,flatnorm,shadowonly}.png`);
});
