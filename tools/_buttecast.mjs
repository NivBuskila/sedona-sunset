/* Verify the one-line fix for System 2's pale patch before handing it over.
 *
 *   node tools/_buttecast.mjs
 *
 * The receiver under the patch is wallL at 53 m with n.L 0.921 - a face turned
 * almost straight at the sun, so it is brilliant unless something shades it. The
 * sun ray from it is blocked by butte0 at 520 m, and butte0 has castShadow false
 * (src/rock.js:1253) on the stated grounds that the buttes sit "half a kilometre
 * outside the shadow camera's box, so asking for shadows only costs a second
 * rasterisation of forty thousand triangles that lands nowhere".
 *
 * That is true of seven of the ten. It is false of butte0, butte1 and butte2,
 * which overlap the far cascade in all three axes - butte0 sits at clip z -0.83
 * to -0.54, well inside. For a directional light a caster shares clip x and y
 * with its own shadow, so a butte whose shadow lands on a wall inside the box
 * cannot itself be outside the box in x or y; only z was ever in question, and z
 * spans 1,860 m.
 *
 * So flip it at runtime and photograph the difference. rock.js is System 2's file
 * and this does not touch it.
 */
import { run, capture } from './harness.mjs';
import { byName } from './views.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const V = byName('wall_shade');
const PATCH = { x0: 75, x1: 150, y0: 290, y1: 340 };

await run({ width: 1600, height: 900 }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  const shot = async (cast, file) => {
    const info = await page.evaluate(([v, c]) => {
      const g = window.__game, scene = g._scene;
      const hit = [];
      scene.traverse((o) => {
        if (o.isMesh && /^butte/.test(o.name || '')) { o.castShadow = c; hit.push(o.name); }
      });
      g.renderer.shadowMap.needsUpdate = true;
      g.walkTo(v.d); g.lookAt(v.yaw, v.pitch);
      return { n: hit.length, names: hit.slice(0, 3) };
    }, [V, cast]);
    await page.waitForTimeout(600);
    await capture(page, file);
    return info;
  };

  const a = await shot(false, 'shots/_bc_off.png');
  await shot(true, 'shots/_bc_on.png');
  console.log(`\n  ${a.n} butte meshes toggled\n`);

  const read = (f) => {
    const { w, h, ch, px } = decode(readFileSync(f));
    let n = 0, sum = 0, tot = 0, up = 0;
    for (let y = PATCH.y0; y <= PATCH.y1; y++) {
      for (let x = PATCH.x0; x <= PATCH.x1; x++) {
        const i = (y * w + x) * ch;
        const v = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
        sum += v; tot++; if (v > 0.88) n++;
      }
    }
    /* And the whole upper half, to check the fix is local and has not dropped a
       shadow across rock that was correctly lit. */
    for (let y = 0; y < 450; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * ch;
        if (Math.max(px[i], px[i + 1], px[i + 2]) / 255 > 0.88) up++;
      }
    }
    return { meanV: sum / tot, hot: n, tot, up };
  };
  const off = read('shots/_bc_off.png'), on = read('shots/_bc_on.png');
  console.log('  buttes            patch mean V   pixels over V 0.88   upper-half hot pixels');
  console.log(`  castShadow false      ${off.meanV.toFixed(3)}          ${String(off.hot).padStart(5)} / ${off.tot}            ${off.up}`);
  console.log(`  castShadow true       ${on.meanV.toFixed(3)}          ${String(on.hot).padStart(5)} / ${on.tot}            ${on.up}`);
  console.log(`\n  patch mean V ${((on.meanV / off.meanV - 1) * 100).toFixed(1)}%, ` +
    `hot pixels ${off.hot ? ((on.hot / off.hot - 1) * 100).toFixed(1) : 'n/a'}%`);
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});
