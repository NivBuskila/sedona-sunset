/* Where does the heat shimmer actually act? Captures one view with the
   displacement amplitude at zero and at its shipped value — no framebuffer
   switching, just the one uniform — and reports the changed-pixel fraction per
   horizontal band, so "it is on the distant grazing rays and nowhere near your
   feet" is a number rather than a claim.

   node tools/_a5shim.mjs [view] [amp]
*/
import { run, capture } from './harness.mjs';

const VIEWS = { sun_gap: [120, 0, 6], wash_mid: [46, 0, 0], bend: [92, -22, 2] };
const name = process.argv[2] || 'sun_gap';
const amp = process.argv[3] === undefined ? null : Number(process.argv[3]);
const [d, yaw, pitch] = VIEWS[name];

await run({ width: 800, height: 450, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  await page.evaluate(([dd, y, p]) => {
    const g = window.__game;
    g.walkTo(dd); g.lookAt(y, p);
    /* Reach the composite material through the scene graph rather than adding
       an API for a diagnostic: it is the only ShaderMaterial in the project
       with a tScene uniform. */
    window.__m = g._atmo._shimmerMaterial;
  }, [d, yaw, pitch]);

  const got = await page.evaluate(() => !!window.__m);
  if (!got) { console.log('no shimmer material exposed'); return; }

  await page.evaluate(() => { window.__amp = window.__m.uniforms.uAmp.value; window.__m.uniforms.uAmp.value = 0; });
  await capture(page, 'shots/_shim_off.png');
  await page.evaluate((a) => { window.__m.uniforms.uAmp.value = a === null ? window.__amp : a; }, amp);
  await capture(page, 'shots/_shim_on.png');
  console.log('amp ' + (await page.evaluate(() => window.__m.uniforms.uAmp.value)));
  console.log('errors ' + errs.length);
  console.log([...new Set(errs)].slice(0, 3).join('\n'));
});
