/* Find the station for the ninth view.
 *
 *   node tools/_scout.mjs [tag] [--ds 150,175,200] [--yaws 0,35,60] [--pitch -8]
 *
 * The eight standard views all sit at 120 m or nearer, and five of them at 46 m
 * or nearer, which is inside the part of the corridor whose walls fill 45 to 80
 * degrees of the sky with sunlit red rock. Warm shade there is what correct light
 * transport gives. But tools/_skydist.mjs shows the corridor opening astern as
 * the walk lengthens, and past 150 m the up-canyon aperture mix runs 0.93 to 0.99
 * and the fill arrives at hue 317 - so the cool half of the walk exists, the
 * player traverses it, and no view in the set has ever photographed it. Every
 * critique this project has received was formed on the warm half.
 *
 * The brief is shaded ground against sunlit wall, because the contrast is the
 * point and not the shade on its own: a frame of uniformly cool dirt would prove
 * the fill works and would say nothing about whether the warm/cool split reads.
 * So sweep station and bearing and look at the frames rather than at a number -
 * composition is the one thing in this project no metric is entitled to decide.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from './harness.mjs';

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'scout';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const ds = getf('ds', '150,175,200').split(',').map(Number);
const yaws = getf('yaws', '0,35,60').split(',').map(Number);
const pitch = Number(getf('pitch', -8));
const dir = path.join(process.cwd(), 'shots');

await run({ width: 960, height: 540, hash: 'high&noadapt' }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  for (const d of ds) {
    for (const y of yaws) {
      await page.evaluate(([d, y, p]) => {
        window.__game.walkTo(d); window.__game.lookAt(y, p);
      }, [d, y, pitch]);
      await page.waitForTimeout(600);
      const buf = await page.screenshot({ type: 'png' });
      const f = `${tag}_d${d}_y${y}.png`;
      fs.writeFileSync(path.join(dir, f), buf);
      console.log(`  d ${String(d).padStart(3)}  yaw ${String(y).padStart(4)}  →  shots/${f}`);
    }
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});
