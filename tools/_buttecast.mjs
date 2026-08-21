/* What the distant buttes' shadows cost the canyon, priced by toggling the flag.
 *
 * This is the measurement that found the defect: with castShadow on, the wash
 * floor lost 81% of its value and the lit wall 59%, with the sky unchanged —
 * light lost on the ground only, which is a shadow rather than an exposure
 * change. It is repeated here because a placement fix has to be verified against
 * the same instrument that found the problem, not against a different one.
 *
 * Both states in one page load. A toggle of castShadow needs the shadow map
 * rebuilt and the materials recompiled, or the second state is byte-identical to
 * the first and reads as "the buttes were never the cause" — a confident negative,
 * and the tenth measurement failure recorded on this project was exactly that.
 */
import { run, capture } from './harness.mjs';
import { decode } from './png.mjs';
import { VIEWS } from './views.mjs';
import fs from 'node:fs';

const WANT = ['wash_low', 'wash_mid', 'sun_gap', 'wall_lit'];

const lum = (px, k) => px[k] * 0.2126 + px[k + 1] * 0.7152 + px[k + 2] * 0.0722;

/* Sky is neutral-to-cool and bright; ground is red and darker. Same classifier
   the terrace tool uses, for the same reason: a luminance threshold alone puts
   bright lit ground on the sky side near the sun. */
function split(im) {
  const g = [], s = [];
  for (let y = 0; y < im.h; y += 2) {
    for (let x = 0; x < im.w; x += 2) {
      const k = (y * im.w + x) * im.ch;
      const L = lum(im.px, k);
      if (im.px[k] - im.px[k + 2] <= 6 && L > 120) s.push(L); else g.push(L);
    }
  }
  const med = (a) => a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 0;
  return { ground: med(g), sky: med(s) };
}

await run({ width: 800, height: 450, hash: 'high&noadapt' }, async ({ page }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(4000);

  const rows = [];
  for (const name of WANT) {
    const v = VIEWS.find((q) => q.name === name);
    const out = {};
    for (const cast of [true, false]) {
      await page.evaluate(([vv, c]) => {
        const g = window.__game;
        g.walkTo(vv.d);
        g.lookAt(vv.yaw, vv.pitch);
        let n = 0;
        g._scene.traverse((o) => {
          if (/^butte\d+$/.test(o.name)) { o.castShadow = c; n++; }
        });
        /* Without these two the second state is the first state. */
        g._scene.traverse((o) => {
          if (!o.material) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
        });
        g.renderer.shadowMap.needsUpdate = true;
        g.renderOnce(); g.renderOnce();
        return n;
      }, [v, cast]);
      const f = 'tmp/_cast.png';
      await capture(page, f);
      out[cast ? 'on' : 'off'] = split(decode(fs.readFileSync(f)));
    }
    rows.push({ name, ...out });
  }

  console.log('\n  distant-butte shadows, priced by the flag');
  console.log('  view        ground cast/no-cast      loss    sky cast/no-cast');
  for (const r of rows) {
    const loss = r.off.ground > 0 ? (1 - r.on.ground / r.off.ground) * 100 : 0;
    console.log('  ' + r.name.padEnd(11) +
      (r.on.ground.toFixed(1) + ' / ' + r.off.ground.toFixed(1)).padStart(15) +
      (loss.toFixed(0) + '%').padStart(9) + '   ' +
      (r.on.sky.toFixed(1) + ' / ' + r.off.sky.toFixed(1)).padStart(15));
  }
  console.log('\n  a loss near zero means the buttes no longer shade the canyon;');
  console.log('  the sky column is the control and must not move either way.\n');
});
