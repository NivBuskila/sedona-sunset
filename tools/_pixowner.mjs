/* Which mesh owns this pixel, by ablation.
 *
 * A companion to _pick.mjs rather than a replacement: that one raycasts, which
 * is one render and exact, but it needs THREE on the page and it answers about
 * the ray rather than about the pixel. This one hides one object at a time and
 * watches the pixel, so it attributes what was actually drawn — through
 * instanced meshes, alpha-tested cards and anything the post chain moved.
 *
 * Three rounds on this project have gone into arguing from a picture about what
 * an artefact *is*. The scene can be asked instead: hide one object, redraw, and
 * see whether the pixel changed. No raycaster, so it needs nothing on the page
 * that the app does not already expose, and it answers for instanced and
 * skinned geometry alike because it is testing the rendered result.
 *
 *   node tools/_pixowner.mjs --view wall_shade --at 0.071,0.348
 */
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const view = opt('view', 'wall_shade');
const pts = opt('at', '0.5,0.5').split(';').map((s) => s.split(',').map(Number));

await run({ width: 1600, height: 900, hash: 'high&noadapt' }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  /* The four far framings are deliberately not in VIEWS — widening that table
     would orphan every figure quoted against it — so accept a camera written out
     as `d,yaw,pitch` for anything outside the standard eight. */
  const v = VIEWS.find((q) => q.name === view)
    || (() => { const [d, yaw, pitch] = view.split(',').map(Number); return { d, yaw, pitch }; })();
  const res = await page.evaluate(([vv, ps]) => {
    const g = window.__game;
    g.walkTo(vv.d); g.lookAt(vv.yaw, vv.pitch);

    const gl = g.renderer.getContext();
    const cv = g.renderer.domElement;
    const read = () => {
      g.renderOnce();
      const out = [];
      for (const [sx, sy] of ps) {
        const px = new Uint8Array(4);
        gl.readPixels(Math.round(sx * cv.width), Math.round((1 - sy) * cv.height),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        out.push([px[0], px[1], px[2]]);
      }
      return out;
    };

    const base = read();
    /* Every object with geometry, deepest first, so a hit is attributed to the
       mesh rather than to the group that contains it. */
    const cand = [];
    g._scene.traverse((o) => { if (o.isMesh || o.isPoints || o.isSprite) cand.push(o); });

    const owners = ps.map(() => null);
    for (const o of cand) {
      if (!o.visible) continue;
      o.visible = false;
      const now = read();
      o.visible = true;
      for (let i = 0; i < ps.length; i++) {
        if (owners[i]) continue;
        const d = Math.abs(now[i][0] - base[i][0]) + Math.abs(now[i][1] - base[i][1]) +
                  Math.abs(now[i][2] - base[i][2]);
        if (d > 12) owners[i] = { name: o.name || o.type, delta: d, now: now[i] };
      }
      if (owners.every(Boolean)) break;
    }
    return { base, owners, n: cand.length };
  }, [v, pts]);

  console.log('\n  ' + view + '   ' + res.n + ' drawable objects tested');
  for (let i = 0; i < pts.length; i++) {
    const o = res.owners[i];
    console.log('  at ' + pts[i].join(',') + '  rgb ' + res.base[i].join(',') +
      (o ? '   owned by ' + o.name + '  (hiding it changes the pixel to ' + o.now.join(',') + ')'
         : '   no single object accounts for it'));
  }
  console.log();
});
