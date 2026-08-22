/* _banddiff.mjs — where two captures differ, by horizontal band.
 *
 *   node tools/_banddiff.mjs shots/a_ground.png shots/b_ground.png [bands]
 *
 * pxdiff gives one number for the frame, which cannot answer the question that
 * matters for a distance-gated change: a floor framing is a distance ramp up the
 * frame, so "1.4% of pixels differ" is either a gate leaking into the near field
 * or a gate working exactly as specified in the far strip, and the frame-wide
 * figure cannot tell those apart. Bands are distances here.
 */
import fs from 'node:fs';
import { decode } from './png.mjs';

const [fa, fb, nbArg] = process.argv.slice(2);
if (!fa || !fb) { console.error('usage: _banddiff.mjs a.png b.png [bands]'); process.exit(2); }
const NB = Math.max(2, Number(nbArg) || 12);

const a = decode(fs.readFileSync(fa)), b = decode(fs.readFileSync(fb));
if (a.w !== b.w || a.h !== b.h) {
  console.error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`); process.exit(2);
}

console.log(`${fa}\n${fb}\n${a.w}x${a.h}, ${NB} bands, top of frame first\n`);
console.log('   y range        diff%     max   mean    n>=5');
let anyNear = 0;
for (let band = 0; band < NB; band++) {
  const y0 = Math.floor(band * a.h / NB), y1 = Math.floor((band + 1) * a.h / NB);
  let diff = 0, mx = 0, sum = 0, n5 = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < a.w; x++) {
      const ka = (y * a.w + x) * a.ch, kb = (y * b.w + x) * b.ch;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.px[ka + c] - b.px[kb + c]));
      if (d > 0) diff++;
      if (d >= 5) n5++;
      if (d > mx) mx = d;
      sum += d; n++;
    }
  }
  const pct = 100 * diff / n;
  console.log(`  ${(y0 / a.h).toFixed(2)}-${(y1 / a.h).toFixed(2)}   ${pct.toFixed(3).padStart(8)}%  ${String(mx).padStart(4)}  ` +
    `${(sum / n).toFixed(3).padStart(6)}  ${String(n5).padStart(6)}`);
  if (band >= NB / 2 && diff > 0) anyNear += diff;
}
console.log(`\nlower half (nearer ground): ${anyNear} differing pixels` +
  (anyNear === 0 ? '  — byte-identical' : ''));
