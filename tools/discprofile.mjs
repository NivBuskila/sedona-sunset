/* Does the sun disc stand clear of the sky it sits on?
 *
 *   node tools/discprofile.mjs shots/sys4k_wash_low.png 0.36 0.25
 *
 * tools/sundisc.mjs answers whether anything is in front of the disc. That is a
 * different question from whether you can see it, and the first time this was
 * asked the answer was that a geometrically clear disc was seventeen saturated
 * pixels on a plateau at 247 — a 3% contrast, invisible — because the near-sun sky
 * was already in the tone curve's shoulder under air at a 1.76 km visual range.
 *
 * So this reads a radial luminance profile out from the disc's screen position and
 * reports the one number that decides it: the disc's own peak against the sky
 * immediately around it. A disc that reads has to clear its background by more
 * than the background's own variation, or it is a ripple.
 *
 * The angular radius is 0.00465 rad and the profile is reported in pixels, so the
 * disc's own extent is worked out from the camera's vertical field of view rather
 * than assumed — pass it if the default is wrong for the capture.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const [file, sxs, sys, fovs] = process.argv.slice(2);
if (!sys) {
  console.error('usage: node tools/discprofile.mjs <png> <sx> <sy> [vfov deg]');
  process.exit(1);
}
const FOV = +(fovs ?? 55);
const { w, h, ch, px } = decode(readFileSync(file));
const cx = +sxs * w, cy = +sys * h;

const pxPerDeg = h / FOV;
const discR = 0.00465 * 180 / Math.PI * pxPerDeg;   // angular radius -> px

const LUM = [0.2126, 0.7152, 0.0722];
const at = (x, y) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const i = (Math.round(y) * w + Math.round(x)) * ch;
  return { l: (px[i] * LUM[0] + px[i + 1] * LUM[1] + px[i + 2] * LUM[2]), r: px[i], g: px[i + 1], b: px[i + 2] };
};

console.log(`${file}\n  disc at screen ${sxs},${sys} = pixel ${cx.toFixed(0)},${cy.toFixed(0)}` +
  `   vfov ${FOV} deg -> disc radius ${discR.toFixed(1)} px\n`);

console.log('  ring (px)      n    mean L   max L   sd     mean rgb');
const rings = [[0, discR], [discR, 2 * discR], [2 * discR, 4 * discR],
  [4 * discR, 8 * discR], [8 * discR, 16 * discR], [16 * discR, 32 * discR]];
const stats = [];
for (const [r0, r1] of rings) {
  const ls = [], rs = [0, 0, 0];
  const R = Math.ceil(r1);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, y);
    if (d < r0 || d >= r1) continue;
    const s = at(cx + x, cy + y);
    if (!s) continue;
    ls.push(s.l); rs[0] += s.r; rs[1] += s.g; rs[2] += s.b;
  }
  if (!ls.length) continue;
  const m = ls.reduce((a, b) => a + b, 0) / ls.length;
  const sd = Math.sqrt(ls.reduce((a, b) => a + (b - m) ** 2, 0) / ls.length);
  stats.push({ r0, r1, m, max: Math.max(...ls), sd, n: ls.length });
  console.log(`  ${r0.toFixed(1).padStart(5)}-${r1.toFixed(1).padEnd(6)} ${String(ls.length).padStart(6)}  ` +
    `${m.toFixed(2).padStart(7)} ${Math.max(...ls).toFixed(0).padStart(7)} ${sd.toFixed(2).padStart(6)}   ` +
    rs.map((v) => (v / ls.length).toFixed(0).padStart(4)).join(' '));
}

const disc = stats[0];
const near = stats[2] ?? stats[1];
if (disc && near) {
  const contrast = (disc.m - near.m) / near.m;
  console.log(`\n  disc mean ${disc.m.toFixed(2)}   surrounding sky ${near.m.toFixed(2)}` +
    `   contrast ${(100 * contrast).toFixed(1)}%`);
  console.log(`  sky's own variation over that annulus: sd ${near.sd.toFixed(2)}, ` +
    `so the disc stands ${((disc.m - near.m) / (near.sd || 1e-6)).toFixed(1)} sigma above it`);
  const verdict = disc.m >= 254 && near.m >= 250 ? 'both clipped - the disc is inside a blown region'
    : (disc.m - near.m) / (near.sd || 1e-6) < 2 ? 'reads as a ripple, not as a sun'
      : 'stands clear of its background';
  console.log(`  -> ${verdict}`);
}
