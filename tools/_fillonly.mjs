/* What colour is this scene's shade, actually?
 *
 *   node tools/_fillonly.mjs [tag] [--only wash_mid,bend]
 *
 * Every number quoted so far about "shaded" rock has come from the darkest 40
 * percent of a region, and on the wash floor that population is not shade. The
 * sun is nine degrees off the corridor axis at fifteen degrees elevation, and
 * tools/fillprobe.mjs --floor measures the open wash floor at 0.70 *sunlit*, so
 * the darkest 40 percent of it is grazing-lit dirt with pebble shadows in it -
 * a mixture whose hue is a weighted average of the sun and the fill, quoted as
 * though it were the fill. That is a well-defined number of the wrong thing, and
 * it is the same failure mode System 5 hit this round by measuring a region
 * another agent had rendering in false colour.
 *
 * So render the shade directly instead of hunting for it. Zero the two sun
 * cascades and pass air=0, and what is left on screen is the scene lit by
 * nothing but the skylight dome and the bounce - which is the definition of
 * shade, with no thresholding, no masking and no population selection to argue
 * about. Anything cool in the lighting model has to show up here, and if it does
 * not show up here it does not exist.
 *
 * The paired full-light frame is captured in the same session so the comparison
 * cannot straddle a tree change. That matters more than usual tonight.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from './harness.mjs';
import { VIEWS } from './views.mjs';

const args = process.argv.slice(2);
const tag = (args[0] && !args[0].startsWith('--')) ? args[0] : 'fo';
const getf = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const only = getf('only', 'wash_mid,bend,wall_shade,ground');
const want = only.split(',').map((s) => s.trim()).filter(Boolean);
const pool = VIEWS.filter((v) => want.includes(v.name));
const dir = path.join(process.cwd(), 'shots');

const extra = getf('hash', '');
await run({ width: 1600, height: 900, hash: 'high&noadapt&air=0' + (extra ? '&' + extra : '') },
  async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);

  for (const v of pool) {
    for (const mode of ['full', 'fill']) {
      const ok = await page.evaluate(([view, mode]) => {
        const g = window.__game, scene = g._scene;
        g.walkTo(view.d); g.lookAt(view.yaw, view.pitch);
        const suns = [];
        scene.traverse((o) => { if (o.isDirectionalLight) suns.push(o); });
        if (mode === 'fill') {
          if (!window.__sunSaved) {
            window.__sunSaved = suns.map((s) => s.intensity);
          }
          suns.forEach((s) => { s.intensity = 0; });
        } else if (window.__sunSaved) {
          suns.forEach((s, i) => { s.intensity = window.__sunSaved[i]; });
        }
        return suns.length;
      }, [v, mode]);
      await page.waitForTimeout(700);
      const buf = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(dir, `${tag}_${mode}_${v.name}.png`), buf);
      console.log(`  ${v.name.padEnd(11)} ${mode.padEnd(5)} ${ok} dir lights  →  shots/${tag}_${mode}_${v.name}.png`);
    }
  }
  if (errs.length) console.log('\npage errors:', errs.slice(0, 3));
});
