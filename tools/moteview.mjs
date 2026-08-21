/* Do the dust motes obey a visibility law, or are they fireflies?
 *
 *   node tools/moteview.mjs [--reuse]
 *
 * The complaint was that motes were "front-lit fireflies" — warm-white dots
 * sitting on top of sunlit rock, which a grain scattering a fraction of a
 * milliwatt cannot do. The correct behaviour is signed: a grain adds its own
 * radiance and removes the background's in proportion to what it covers, so it
 * brightens a background darker than itself and *darkens* one brighter.
 *
 * So this captures the dust on and off, toward the sun and away from it, and
 * reports the mean signed change split by how bright the background was. What
 * passing looks like: toward the sun, a clear positive change concentrated in
 * the dark tail; away from the sun, near zero on dark pixels and zero or
 * negative on bright ones. What failing looks like: positive everywhere, and
 * largest where the background is brightest.
 */
import { run, capture } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const reuse = process.argv.includes('--reuse');
const SHOTS = [
  ['toward', 120, 0, 6],
  ['away', 120, 170, 4],
];

if (!reuse) await run({ width: 1200, height: 675, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(2500);
  for (const [tag, d, yaw, pitch] of SHOTS) {
    await page.evaluate(([dd, y, p]) => {
      const g = window.__game;
      g.walkTo(dd); g.lookAt(y, p);
      g._scene.getObjectByName('dust').visible = true;
    }, [d, yaw, pitch]);
    await capture(page, `shots/_mote_${tag}_on.png`);
    await page.evaluate(() => { window.__game._scene.getObjectByName('dust').visible = false; });
    await capture(page, `shots/_mote_${tag}_off.png`);
    await page.evaluate(() => { window.__game._scene.getObjectByName('dust').visible = true; });
  }
  console.log('errors ' + errs.length);
  if (errs.length) console.log([...new Set(errs)].slice(0, 3).join('\n'));
});

const lum = (img, i) => 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2];

for (const [tag] of SHOTS) {
  const on = decode(readFileSync(`shots/_mote_${tag}_on.png`));
  const off = decode(readFileSync(`shots/_mote_${tag}_off.png`));
  /* Five bins of background luminance. Sky is excluded: the motes are in front
     of it too, but the question asked is about rock. */
  const EDGES = [0, 24, 48, 80, 130, 200];
  const bin = EDGES.slice(0, -1).map(() => ({ n: 0, touched: 0, sum: 0, pos: 0, neg: 0 }));
  let touchedTotal = 0, total = 0;
  for (let y = 0; y < on.h; y++) {
    for (let x = 0; x < on.w; x++) {
      const i = (y * on.w + x) * on.ch;
      const b = lum(off, i);
      if (b >= 200) continue;
      const a = lum(on, i);
      let k = -1;
      for (let j = 0; j < bin.length; j++) if (b >= EDGES[j] && b < EDGES[j + 1]) k = j;
      if (k < 0) continue;
      const dd = a - b;
      bin[k].n++; total++;
      if (Math.abs(dd) > 0.5) { bin[k].touched++; touchedTotal++; }
      bin[k].sum += dd;
      if (dd > 0) bin[k].pos += dd; else bin[k].neg += dd;
    }
  }
  console.log(`\n${tag}   ${on.w}x${on.h}   pixels changed ${(100 * touchedTotal / total).toFixed(2)}% of non-sky`);
  console.log('  background lum |      n   touched%   mean d   +sum/px   -sum/px');
  for (let j = 0; j < bin.length; j++) {
    const t = bin[j];
    if (!t.n) continue;
    console.log(`  ${String(EDGES[j]).padStart(4)}..${String(EDGES[j + 1]).padEnd(4)}     | ` +
      `${String(t.n).padStart(7)}   ${(100 * t.touched / t.n).toFixed(2).padStart(6)}   ` +
      `${(t.sum / t.n).toFixed(4).padStart(8)}  ${(t.pos / t.n).toFixed(4).padStart(8)}  ${(t.neg / t.n).toFixed(4).padStart(8)}`);
  }
}
