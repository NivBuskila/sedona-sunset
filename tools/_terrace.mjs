/* How much of a butte's silhouette is a dead-level shelf.
 *
 *   node tools/_terrace.mjs shots/rd4_bend_full.png [x0 x1]
 *
 * The whole-scene critique's third rock defect is "dead-straight horizontal
 * caprock edges stacked like a wedding cake", and eyeballing a before/after pair
 * cannot separate a real change from a change of exposure — which matters here
 * because System 4 moved the sun between the two captures. So measure the thing
 * that is actually complained about.
 *
 * The skyline is the topmost non-sky pixel in each column. Sky is separated by
 * luminance: at this exposure the brightest rock in the crop is far below the
 * dimmest sky, and the gap is wide enough that the threshold is not a tuning
 * parameter — the reported `sep` is how many stops of margin it had.
 *
 * A terrace is a run of columns whose skyline y does not move. Reported as the
 * share of skyline columns sitting inside a level run of at least 8 px, and as
 * the longest such run. A wedding cake scores high on both; a weathered butte
 * has a skyline that steps every few pixels and scores near zero.
 */
import { readFileSync } from 'node:fs';
import { decode } from './png.mjs';

const [file, ax0, ax1] = process.argv.slice(2);
const im = decode(readFileSync(file));
const x0 = ax0 ? Math.round(+ax0 * im.w) : 0;
const x1 = ax1 ? Math.round(+ax1 * im.w) : im.w;

const lum = (x, y) => {
  const k = (y * im.w + x) * im.ch;
  return 0.2126 * im.px[k] + 0.7152 * im.px[k + 1] + 0.0722 * im.px[k + 2];
};

/* Sky is separated on hue, not brightness. A luminance cut cannot do it here:
   the sunlit wash floor is brighter than the sky and the near wall is darker
   than the haze, so a threshold that works on one framing inverts on the next —
   which is exactly what the first version of this tool did, reporting 100% of
   the skyline as level because it had classified the dark left-hand wall as
   "rock reaching the top of the frame".
   Every rock surface in this scene is hematite red and sits at R-B of 13 or
   more; the sky is neutral or cool. So R-B is the classifier. Near the sun it
   is blown to 239,239,239, which is why the test is "R-B at or below a small
   positive number" rather than "B above R" — the strict form classified the
   glare as rock and measured the bloom boundary instead of the skyline. */
const isSky = (x, y) => {
  const k = (y * im.w + x) * im.ch;
  return im.px[k] - im.px[k + 2] <= 6 && lum(x, y) > 120;
};

const sky = [];
let margin = 255;
for (let x = x0; x < x1; x++) {
  let y = 0;
  while (y < im.h && isSky(x, y)) y++;
  if (y > 0 && y < im.h) {
    const k = (y * im.w + x) * im.ch, kp = ((y - 1) * im.w + x) * im.ch;
    margin = Math.min(margin, (im.px[k] - im.px[k + 2]) + (im.px[kp + 2] - im.px[kp]));
  }
  sky.push(y >= im.h || y === 0 ? -1 : y);
}

/* Level runs. A one-pixel wobble is still a level shelf to the eye, so a run
   survives a column whose y equals the run's y; anything else ends it. */
const MIN = 8;
let inRun = 0, longest = 0, held = 0, n = 0;
for (let i = 1; i < sky.length; i++) {
  if (sky[i] < 0 || sky[i - 1] < 0) { if (inRun >= MIN) held += inRun; inRun = 0; continue; }
  n++;
  if (sky[i] === sky[i - 1]) { inRun = inRun || 1; inRun++; longest = Math.max(longest, inRun); }
  else { if (inRun >= MIN) held += inRun; inRun = 0; }
}
if (inRun >= MIN) held += inRun;

console.log(`${file}`);
console.log(`  R-B separation at the edge, worst column: ${margin} levels`);
console.log(`  skyline columns ${n}`);
console.log(`  in a level run of >=${MIN}px: ${(100 * held / Math.max(n, 1)).toFixed(1)}%`);
console.log(`  longest level run: ${longest} px`);

/* Edge softness, which is the second rock defect measured on the artefact the
   critic actually sees rather than on the renderer's flags.
 *
 * At a silhouette the R-B signal steps from the sky's (at or below 6) to the
 * rock's (13 or more). Multisampling resolves partial coverage, so the boundary
 * pixel of an edge that is neither exactly vertical nor exactly horizontal
 * holds a *blend* of the two and lands between them. Without it the pixel is
 * one or the other and there is nothing in between.
 *
 * So: for each skyline column take the pixel above the boundary and the pixel
 * on it, and count the column as antialiased if either sits strictly inside the
 * gap. On a near-horizontal edge a hard transition is correct and carries no
 * information, so only columns where the skyline is actually stepping are
 * counted — those are the ones that produce visible stair steps. */
const jumps = [];
for (let i = 1; i < sky.length; i++) {
  if (sky[i] < 0 || sky[i - 1] < 0 || sky[i] === sky[i - 1]) continue;
  const x = x0 + i, y = sky[i];
  let worst = 0;
  for (let d = -2; d < 2; d++) {
    const ya = y + d, yb = y + d + 1;
    if (ya < 0 || yb >= im.h) continue;
    const ka = (ya * im.w + x) * im.ch, kb = (yb * im.w + x) * im.ch;
    worst = Math.max(worst, Math.abs((im.px[kb] - im.px[kb + 2]) - (im.px[ka] - im.px[ka + 2])));
  }
  jumps.push(worst);
}
jumps.sort((a, b) => a - b);
const med = jumps.length ? jumps[jumps.length >> 1] : 0;
console.log(`  stepping columns ${jumps.length}, median largest 1px jump across the edge: ${med} levels`);
