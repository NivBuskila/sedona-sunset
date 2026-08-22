/* Does the page say anything while it is generating, and is it gone afterwards?
 *
 * The defect this answers: six cold loads measured 36 to 46 seconds of black,
 * frozen tab, with the main thread blocked so hard that screenshot attempts at
 * 5, 10, 15, 20, 25, 30 and 35 seconds all failed outright — the renderer could
 * not answer the request. There was no spinner and no text.
 *
 * So the measurement is the screenshot itself, and the fact that it *returns*
 * is half the result. This walks a schedule of wall-clock stations, tries to
 * grab the tab at each one with a short timeout, and reports whether the grab
 * succeeded and what colour came back. A black frame and a failed grab are
 * different findings and are printed differently.
 *
 * It then waits the boot out and checks the two things that must be true at the
 * other end: `document.body` is back to `[SCRIPT, CANVAS]` — CONTRACT.md's
 * no-HUD rule, verified by QA — and the capture path the harness uses still
 * produces a frame.
 *
 *   node tools/_bootpaint.mjs
 *
 * Runs on SwiftShader like every other capture here, so the boot it measures is
 * several times the one a person with a GPU waits through. What transfers is
 * the ordering — painted before generation, gone after — not the seconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, capture } from './harness.mjs';
import { decode } from './png.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(DIR, 'tmp');
fs.mkdirSync(OUT, { recursive: true });

const STATIONS = [1500, 4000, 8000, 15000, 25000, 40000, 60000, 90000];

const mean = (png) => {
  const { w, h, ch, px } = decode(png);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = (h >> 2); y < h - (h >> 2); y += 3) {
    for (let x = (w >> 2); x < w - (w >> 2); x += 3) {
      const i = (y * w + x) * ch;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
  }
  return [r / n, g / n, b / n];
};

await run({ width: 800, height: 450, waitReady: false }, async ({ page, errs }) => {
  const t0 = Date.now();
  let painted = 0, failed = 0, black = 0;

  /* A grab with a long fuse, issued before anything else. The stations below
     time out because they ask a blocked thread for an answer *now*; this one
     waits, and is served at the first yield between generation phases — so it
     comes back with the loading screen itself rather than with a timeout. */
  try {
    const shot = await page.screenshot({ timeout: 120_000 });
    const [r, g, b] = mean(shot);
    fs.writeFileSync(path.join(OUT, 'bootpaint_loading.png'), shot);
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s   the loading screen: ` +
                `rgb ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)} → tmp/bootpaint_loading.png`);
  } catch {
    console.log('  the loading screen was never served');
    failed++;
  }

  for (const at of STATIONS) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const el = ((Date.now() - t0) / 1000).toFixed(1);
    let shot = null;
    try {
      shot = await page.screenshot({ timeout: 6000 });
    } catch {
      failed++;
      console.log(`  ${el.padStart(6)}s   SCREENSHOT FAILED — main thread blocked`);
      continue;
    }
    const [r, g, b] = mean(shot);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 2) { black++; console.log(`  ${el.padStart(6)}s   black frame`); }
    else { painted++; console.log(`  ${el.padStart(6)}s   rgb ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)}   L ${lum.toFixed(1)}`); }
    if (at === STATIONS[0]) fs.writeFileSync(path.join(OUT, 'bootpaint_first.png'), shot);
  }

  await page.waitForFunction(() => !!window.__game, null, { timeout: 420_000 });
  const bootS = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n  __game after ${bootS}s`);

  /* The screenshots above cannot see the loading message while the thread is
     blocked, because taking one is a request to that thread. The page's own
     record can: `painted` is stamped from inside a requestAnimationFrame
     callback, and rAF only runs when the browser is producing a frame. */
  const boot = await page.evaluate(() => window.__game._boot);
  console.log(`  message on screen at ${boot.painted === null ? 'NEVER' : boot.painted.toFixed(0) + ' ms'}` +
              `, boot total ${(boot.total / 1000).toFixed(1)}s, longest single stall ${(boot.stalls / 1000).toFixed(1)}s`);
  for (const p of boot.phases) {
    console.log(`     ${String(p.ms).padStart(6)} ms  ${p.note}`);
  }

  const dom = await page.evaluate(() => [...document.body.children].map((e) => e.tagName));
  console.log(`  document.body = [${dom.join(', ')}]`);

  await page.evaluate(() => window.__game.begin());
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
  const dom2 = await page.evaluate(() => [...document.body.children].map((e) => e.tagName));
  const file = path.join(OUT, 'bootpaint_scene.png');
  await capture(page, file);
  const [r, g, b] = mean(fs.readFileSync(file));

  console.log(`  after begin() document.body = [${dom2.join(', ')}]`);
  console.log(`  captured frame rgb ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)} → tmp/bootpaint_scene.png`);
  console.log(`\n  ${painted} stations painted, ${black} black, ${failed} unanswered`);
  const ok = boot.painted !== null && boot.painted < 2000 && black === 0 &&
             dom2.length === 2 && dom2[0] === 'SCRIPT' && dom2[1] === 'CANVAS';
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
  if (errs.length) console.log(`  ${errs.length} page error(s) — see below`);
});
