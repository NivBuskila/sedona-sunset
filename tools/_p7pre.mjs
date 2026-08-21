/* Pre-flight before a capture, because a capture costs twelve minutes and a
 * half-written module in somebody else's file costs the whole twelve.
 *
 * Five agents commit into this tree and a capture takes eight page loads, so the
 * odds of catching a file mid-edit are not small. Two of them have now been paid
 * for at full price: `src/scatter.js` failing to parse, which postpair's snapshot
 * verifier caught for free, and `src/sky.js` throwing `MIE_W_NARROW is not
 * defined` from module top level, which it did not — the file parsed perfectly
 * and the reference error only exists once the module is evaluated.
 *
 * `node --check` cannot see that and neither can glslcheck. `tools/_bootprobe.mjs`
 * can, but only for the modules it actually builds, and sky.js is not one of them.
 * What catches it is simply *evaluating* the module, which for everything that
 * does not need a GL context is a plain dynamic import that costs a second.
 *
 * Modules that touch the DOM or a GL context at import time cannot be checked
 * this way and are listed as skipped rather than quietly passed, so the report
 * does not claim more coverage than it has.
 *
 *   node tools/_p7pre.mjs
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SKIP = new Set(['main.js']);   // owns the canvas and the render loop

const files = readdirSync('src').filter((f) => f.endsWith('.js')).sort();
let bad = 0, skipped = 0;

for (const f of files) {
  if (SKIP.has(f)) { console.log(`  skip  ${f.padEnd(18)} entry point, needs a document`); skipped++; continue; }
  try {
    /* Cache-busted, so a repeated run in a polling loop sees the file as it is
       now rather than as it was when the loop started. */
    await import(pathToFileURL(resolve('src', f)).href + `?t=${Date.now()}`);
    console.log(`  ok    ${f}`);
  } catch (e) {
    const m = String(e && e.message || e).split('\n')[0];
    /* A missing browser global is this tool's limitation, not the file's fault. */
    if (/\b(document|window|navigator|HTMLCanvasElement|AudioContext)\b/.test(m)) {
      console.log(`  skip  ${f.padEnd(18)} needs a browser global: ${m}`);
      skipped++;
    } else {
      console.log(`  FAIL  ${f.padEnd(18)} ${e.constructor.name}: ${m}`);
      bad++;
    }
  }
}

console.log(`\n  ${files.length - bad - skipped} evaluated, ${skipped} skipped, ${bad} failing`);
process.exit(bad ? 1 : 0);
