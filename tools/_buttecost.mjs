/* How much of the frame did the butte shadow fix take with it?
 *
 *   node tools/_buttecost.mjs
 *
 * System 4 diagnosed the pale patch on the far wall as butte0 not casting, and
 * routed a one-line fix to System 2, which landed as 0e9f46c. The patch is gone.
 * But every view in the next capture round came back with a ground median of 9-13
 * against the high twenties before it, and the sky unchanged at 226 - so the frame
 * lost light on the ground and only on the ground, which is the signature of a new
 * shadow rather than a new level.
 *
 * That matters for the exposure decision now in flight, because a level fitted
 * against a frame that has since gone into shadow is fitted against nothing. So
 * separate the two before touching the level again: toggle castShadow on the butte
 * meshes at runtime and read the same windows both ways. rock.js is System 2's and
 * this does not write to it.
 */
import { run, capture } from './harness.mjs';
import { byName } from './views.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const SHOTS = [['ground', [0.20, 0.80, 0.55, 0.95]], ['wall_lit', [0.30, 0.80, 0.20, 0.70]]];

await run({ width: 1600, height: 900 }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  for (const cast of [true, false]) {
    const n = await page.evaluate((c) => {
      let k = 0;
      window.__game._scene.traverse((o) => {
        if (o.isMesh && /^butte/.test(o.name || '')) { o.castShadow = c; k++; }
      });
      window.__game.renderer.shadowMap.needsUpdate = true;
      return k;
    }, cast);
    for (const [name] of SHOTS) {
      const v = byName(name);
      await page.evaluate(([d, y, p]) => { window.__game.walkTo(d); window.__game.lookAt(y, p); },
        [v.d, v.yaw, v.pitch]);
      await page.waitForTimeout(700);
      await capture(page, `shots/_bcost_${name}_${cast ? 'on' : 'off'}.png`);
    }
    if (cast) console.log(`\n  ${n} butte meshes toggled\n`);
  }
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
});

const read = (f, win) => {
  const { w, h, ch, px } = decode(readFileSync(f));
  const x0 = Math.round(win[0] * w), x1 = Math.round(win[1] * w);
  const y0 = Math.round(win[2] * h), y1 = Math.round(win[3] * h);
  let sv = 0, n = 0, dark = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * ch;
      const V = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
      sv += V; n++; if (V < 0.12) dark++;
    }
  }
  return { V: sv / n, dark: dark / n };
};

console.log('  window        buttes casting   buttes not casting    delta');
for (const [name, win] of SHOTS) {
  const on = read(`shots/_bcost_${name}_on.png`, win);
  const off = read(`shots/_bcost_${name}_off.png`, win);
  console.log(`  ${name.padEnd(12)}  V ${on.V.toFixed(3)}          V ${off.V.toFixed(3)}         ` +
    `${((on.V / off.V - 1) * 100).toFixed(1)}%`);
  console.log(`  ${''.padEnd(12)}  below V 0.12 ${(100 * on.dark).toFixed(1)}%      ` +
    `${(100 * off.dark).toFixed(1)}%`);
}
console.log('');
