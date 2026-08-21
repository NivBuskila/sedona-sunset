/* Scratch A/B for System 5's particle layers.

   node tools/_a5probe.mjs [view] [saltDrive]
*/
import { run, capture } from './harness.mjs';

const VIEWS = {
  ground: [30, 10, -38],
  sun_gap: [120, 0, 6],
  wash_mid: [46, 0, 0],
  wash_low: [8, 0, -4],
};
const name = process.argv[2] || 'ground';
const drive = process.argv[3] === undefined ? null : Number(process.argv[3]);
const [d, yaw, pitch] = VIEWS[name];

await run({ width: 800, height: 450, waitReady: false }, async ({ page, errs }) => {
  await page.waitForFunction(() => !!window.__game, null, { timeout: 600_000 });
  await page.evaluate(() => window.__game.begin());
  await page.waitForTimeout(3000);

  const info = await page.evaluate(([dd, y, p, dr]) => {
    const g = window.__game, s = g._scene;
    g.walkTo(dd); g.lookAt(y, p);
    const dust = s.getObjectByName('dust'), salt = s.getObjectByName('saltation');
    window.__p = { dust, salt };
    if (dr !== null) salt.material.uniforms.uSal.value = dr;
    return {
      sal: salt.material.uniforms.uSal.value,
      dustDrive: dust.material.uniforms.uDrive.value,
      speed: salt.material.uniforms.uSpeed.value,
      wind: [salt.material.uniforms.uWind.value.x, salt.material.uniforms.uWind.value.y],
      cam: g._camera.position.toArray().map((v) => +v.toFixed(2)),
      clock: g._atmo._diag.wind.clock,
    };
  }, [d, yaw, pitch, drive]);
  console.log(JSON.stringify(info));

  const shot = async (tag, fn) => { await page.evaluate(fn); await capture(page, `shots/_ab_${tag}.png`); };
  await shot('off', () => { window.__p.dust.visible = false; window.__p.salt.visible = false; });
  await shot('salt', () => { window.__p.salt.visible = true; });
  await shot('both', () => { window.__p.dust.visible = true; });
  console.log('errors ' + errs.length);
  console.log([...new Set(errs)].slice(0, 4).join('\n'));
});
