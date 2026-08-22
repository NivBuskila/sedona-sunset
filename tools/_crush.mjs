/* How much of the frame has no room left for colour?
 *
 * System 4's finding, and the number behind the critique's first complaint about
 * the shaded wall: 40.8% of wall_shade has its minimum channel under ten code
 * values and 6.0% is black on every channel. Shaded sandstone is hue 4.5 degrees
 * at saturation 0.47, which needs blue near twenty code values to exist at all.
 * With blue at six the chroma is not wrong — there is nowhere to put it, and what
 * comes out is one quantised blood-brown, which is exactly "muddy rather than
 * dark".
 *
 * A mean cannot see this. Lifting every pixel whose max channel is under 10 cv
 * moves the region mean by 1.3% and the shadow gate from 0.211 to 0.214, still
 * mid-band, which is why the gate never caught it. So measure the bottom of the
 * distribution directly.
 *
 * Sky is excluded by luminance, because a night-black sky region would otherwise
 * count as crush and every frame here has a lot of frame that is not rock.
 *
 *   node tools/_crush.mjs shots/s2m_wall_shade.png
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));

console.log('file                          min<10   min<20   allblack   minCh mean  p50  p90');
for (const f of files) {
  const { w, h, px, ch } = decode(readFileSync(f));
  let n = 0, u10 = 0, u20 = 0, blk = 0;
  const mins = [];
  for (let i = 0, p = 0; i < w * h; i++, p += ch) {
    const r = px[p], g = px[p + 1], b = px[p + 2];
    /* Anything bright enough to be sky is not a crushed shadow. The shaded-wall
       framings put the sky at 150+ and the rock at 20-40, so this separates
       cleanly and does not need a mask. */
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > 120) continue;
    const mn = Math.min(r, g, b);
    n++; mins.push(mn);
    if (mn < 10) u10++;
    if (mn < 20) u20++;
    if (r === 0 && g === 0 && b === 0) blk++;
  }
  mins.sort((a, b) => a - b);
  const pc = (k) => `${(100 * k / n).toFixed(1)}%`.padStart(7);
  const mean = mins.reduce((a, b) => a + b, 0) / n;
  console.log(`${f.replace(/^.*[\\/]/, '').replace(/\.png$/, '').padEnd(28)} `
    + `${pc(u10)}  ${pc(u20)}  ${pc(blk)}     `
    + `${mean.toFixed(1).padStart(5)} ${String(mins[n >> 1]).padStart(4)} `
    + `${String(mins[Math.floor(n * 0.9)]).padStart(4)}`);
}
