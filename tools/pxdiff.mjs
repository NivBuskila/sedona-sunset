/* Differing-pixel statistics between two captures of the same viewpoint.
 *
 *   node tools/pxdiff.mjs shots/a_wash_mid.png shots/b_wash_mid.png
 *   node tools/pxdiff.mjs --pair det0 det0_same          (every view in a postpair set)
 *
 * postpair.mjs reports `identical` or `differs`, which is the right answer for
 * a gate and useless for a bisection: a candidate that halves the noise and one
 * that does nothing both read `differs`. This reports the number.
 *
 * `diff%` is the share of pixels whose RGB is not bit-identical, which is the
 * figure quoted in CONTRACT.md's determinism work. `max` and `mean` are over
 * the per-channel absolute delta, and `n>=5` counts pixels with a delta a
 * viewer could see, so a thin frame-wide scatter can be told from a few large
 * localised differences.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decode } from './png.mjs';

function stats(fa, fb) {
  const a = decode(fs.readFileSync(fa)), b = decode(fs.readFileSync(fb));
  if (a.w !== b.w || a.h !== b.h) throw new Error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const n = a.w * a.h;
  let diff = 0, max = 0, sum = 0, big = 0;
  for (let i = 0; i < n; i++) {
    const ka = i * a.ch, kb = i * b.ch;
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(a.px[ka + c] - b.px[kb + c]);
      if (e > d) d = e;
    }
    if (d) { diff++; sum += d; if (d > max) max = d; if (d >= 5) big++; }
  }
  return { w: a.w, h: a.h, n, pct: 100 * diff / n, max, mean: diff ? sum / diff : 0, big };
}

const args = process.argv.slice(2);
const pi = args.indexOf('--pair');

if (pi >= 0) {
  const [ta, tb] = args.slice(pi + 1);
  const dir = path.resolve('shots');
  const views = fs.readdirSync(dir)
    .filter(f => f.startsWith(`${ta}_`) && f.endsWith('.png'))
    .map(f => f.slice(ta.length + 1, -4))
    .filter(v => fs.existsSync(path.join(dir, `${tb}_${v}.png`)))
    .sort();
  if (!views.length) throw new Error(`no shared views between ${ta}_* and ${tb}_*`);
  let worst = 0;
  for (const v of views) {
    const s = stats(path.join(dir, `${ta}_${v}.png`), path.join(dir, `${tb}_${v}.png`));
    worst = Math.max(worst, s.pct);
    console.log(`  ${v.padEnd(11)} diff ${s.pct.toFixed(3).padStart(7)}%   ` +
                `max ${String(s.max).padStart(3)}  mean ${s.mean.toFixed(2)}  n>=5 ${s.big}`);
  }
  console.log(`\n${ta} vs ${tb}: worst view ${worst.toFixed(3)}% differing` +
              (worst === 0 ? '  — identical' : ''));
} else {
  const s = stats(args[0], args[1]);
  console.log(`${s.w}x${s.h}  diff ${s.pct.toFixed(3)}%  max ${s.max}  ` +
              `mean ${s.mean.toFixed(2)}  n>=5 ${s.big}`);
}
