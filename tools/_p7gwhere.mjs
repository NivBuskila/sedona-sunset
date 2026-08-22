/* Where are the hard-pushed ghost pixels, and what is next to them? A disc is a
 * smooth low-amplitude thing, so any pixel it lifts by hundreds of percent is not
 * the disc reading loudly -- it is the gate being evaluated somewhere other than
 * where the pixel is. */
import fs from 'fs';
import { decode } from './png.mjs';
const lum = (im, p) => (0.2126 * im.px[p] + 0.7152 * im.px[p+1] + 0.0722 * im.px[p+2]) / 255;
for (const v of process.argv.slice(3)) {
  const A = decode(fs.readFileSync(`shots/${process.argv[2]}_ghost0_${v}.png`));
  const B = decode(fs.readFileSync(`shots/${process.argv[2]}_${v}.png`));
  const hits = [];
  for (let y = 1; y < A.h - 1; y++) for (let x = 1; x < A.w - 1; x++) {
    const p = (y * A.w + x) * A.ch;
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, B.px[p+c] - A.px[p+c]);
    if (d < 25) continue;
    /* brightest neighbour in the CONTROL arm: if this dark pixel abuts sky, the
       low-res gate saw the sky and not the pixel */
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      nb = Math.max(nb, lum(A, ((y+dy) * A.w + (x+dx)) * A.ch));
    }
    hits.push({ x, y, d, self: lum(A, p), nb });
  }
  hits.sort((a, b) => b.d - a.d);
  const edge = hits.filter(h => h.nb > h.self * 2.0).length;
  console.log(`\n  ${v}: ${hits.length} pixels lifted 25cv or more`);
  if (!hits.length) continue;
  console.log(`    of those, ${edge} (${(100*edge/hits.length).toFixed(0)}%) have a neighbour at least 2x their own brightness`);
  console.log(`    hardest five:`);
  for (const h of hits.slice(0, 5))
    console.log(`      (${h.x},${h.y})  +${h.d}cv  own luma ${h.self.toFixed(3)}  brightest neighbour ${h.nb.toFixed(3)}  ratio ${(h.nb/Math.max(h.self,1e-4)).toFixed(1)}x`);
  const ys = hits.map(h => h.y), xs = hits.map(h => h.x);
  console.log(`    bounding box x ${Math.min(...xs)}-${Math.max(...xs)}, y ${Math.min(...ys)}-${Math.max(...ys)} of ${A.w}x${A.h}`);
}
