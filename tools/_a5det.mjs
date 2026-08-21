/* Scratch: are two calls with the same arguments the same pixels?
   node tools/_a5det.mjs
*/
import { run, capture } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const VIEWS = [['sun_gap', 120, 0, 6], ['wash_low', 8, 0, -4]];

await run({ width: 800, height: 450, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);
  for (const [n, d, y, p] of VIEWS) {
    for (const pass of ['a', 'b']) {
      /* Deliberately go somewhere else in between, so the second call has to
         reconstruct the state rather than inherit it. */
      await page.evaluate(() => { window.__game.walkTo(64); window.__game.lookAt(120, -8); });
      await page.waitForTimeout(350);
      await page.evaluate(([dd, yy, pp]) => {
        window.__game.walkTo(dd); window.__game.lookAt(yy, pp);
      }, [d, y, p]);
      await page.waitForTimeout(350);
      await capture(page, `shots/_det_${n}_${pass}.png`);
    }
    await page.evaluate(() => { window.__game._atmo.setGustPeak(); });
    await capture(page, `shots/_det_${n}_g.png`);
  }
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 3).join('\n'));
});

for (const [n] of VIEWS) {
  const a = decode(readFileSync(`shots/_det_${n}_a.png`));
  const b = decode(readFileSync(`shots/_det_${n}_b.png`));
  let diff = 0, worst = 0;
  for (let i = 0; i < a.px.length; i += a.ch) {
    const d = Math.max(Math.abs(a.px[i] - b.px[i]), Math.abs(a.px[i + 1] - b.px[i + 1]),
      Math.abs(a.px[i + 2] - b.px[i + 2]));
    if (d) { diff++; worst = Math.max(worst, d); }
  }
  const total = a.w * a.h;
  console.log(`${n}  differing pixels ${diff} of ${total} (${(100 * diff / total).toFixed(4)}%)  worst ${worst}`);
}
