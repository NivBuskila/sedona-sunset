/* The shadow gate, as the reviewer defines it: mean relative luminance of the
   shadowed region over the sunlit region, both read off the sRGB PNG. Windows are
   sat.mjs's own rock windows so the number is comparable to every earlier one. */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';
const W = [0.30, 0.24, 0.34, 0.34];
const mean = (f) => {
  const { w, h, ch, px } = decode(readFileSync(f));
  const x0 = Math.round(W[0] * w), y0 = Math.round(W[1] * h);
  const x1 = x0 + Math.round(W[2] * w), y1 = y0 + Math.round(W[3] * h);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * ch;
    s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++;
  }
  return s / n;
};
for (const tag of process.argv.slice(2)) {
  const sh = mean(`shots/${tag}_wall_shade.png`), li = mean(`shots/${tag}_wall_lit.png`);
  console.log(`  ${tag}   shaded ${sh.toFixed(1)} cv   sunlit ${li.toFixed(1)} cv   gate ${(sh / li).toFixed(3)}`);
}
