/* The gain in the space that decides visibility: encoded code values.
 * A fraction of scene-linear background was the wrong specification -- the sky sits
 * in the shoulder where the curve is flat, so a 5% linear lift there is 2cv and
 * invisible, while the same 5% in the toe is tens of cv and a firefly. */
import fs from 'fs';
import { decode } from './png.mjs';
const lum = (im, p) => (0.2126 * im.px[p] + 0.7152 * im.px[p+1] + 0.0722 * im.px[p+2]) / 255;
const base = decode.bind(null);
console.log('\n  encoded delta from the ghost term, 2560x1440, against #ghost=0');
console.log('  "on sky" is pixels whose own luma is above 0.5, which is where a disc should read.\n');
console.log('  view      gain    touched   median  p95   peak    >25cv   sky median  sky p95  sky peak');
for (const v of ['sun_gap', 'bend', 'juniper']) {
  const A = decode(fs.readFileSync(`shots/sys7gs0_${v}.png`));
  for (const [tag, g] of [['sys7gs0p15', 0.15], ['sys7gs0p45', 0.45]]) {
    const B = decode(fs.readFileSync(`shots/${tag}_${v}.png`));
    const all = [], sky = [];
    let n25 = 0;
    for (let i = 0; i < A.w * A.h; i++) {
      const p = i * A.ch;
      let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, B.px[p+c] - A.px[p+c]);
      if (d <= 0) continue;
      all.push(d); if (d > 25) n25++;
      if (lum(A, p) > 0.5) sky.push(d);
    }
    all.sort((a,b)=>a-b); sky.sort((a,b)=>a-b);
    const q = (a, f) => a.length ? a[Math.min(a.length-1, Math.floor(a.length*f))] : 0;
    console.log(`  ${v.padEnd(9)} ${g.toFixed(2)}  ${(100*all.length/(A.w*A.h)).toFixed(2).padStart(6)}%  ` +
      `${String(q(all,0.5)).padStart(6)} ${String(q(all,0.95)).padStart(4)} ${String(q(all,1)).padStart(6)} ` +
      `${String(n25).padStart(7)}   ${String(q(sky,0.5)).padStart(9)} ${String(q(sky,0.95)).padStart(8)} ${String(q(sky,1)).padStart(9)}`);
  }
}
console.log('\n  a restrained ghost on sky wants a few code values at its peak -- enough to see');
console.log('  on a smooth gradient, not enough to name. >25cv anywhere is the firefly count.');
