/* How long the page takes to build itself, and what inside it is expensive.
 *
 * shoot.mjs gives `window.__game` 120 seconds to appear. On four cores that is
 * no longer a comfortable margin, and when it is missed the failure looks
 * exactly like a page error — a timeout with nothing else to go on. This waits
 * as long as it takes instead, and reports the boot time plus whatever the page
 * left in `window.__boot` so the cost can be attributed to a module rather than
 * guessed at.
 *
 *   node tools/boot.mjs
 */
import { run } from './harness.mjs';

await run({ width: 640, height: 360, waitReady: false }, async ({ page, errs }) => {
  const t0 = Date.now();
  await page.waitForFunction(() => !!window.__game, null, { timeout: 900_000 });
  const ms = Date.now() - t0;
  const marks = await page.evaluate(() => window.__boot || null);
  console.log(`\n__game ready after ${(ms / 1000).toFixed(1)} s`);
  if (marks) console.log(JSON.stringify(marks, null, 2));
  if (errs.length) console.log('errors:', errs.slice(0, 6));
});
