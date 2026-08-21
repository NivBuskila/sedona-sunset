/* The fill is too warm on shade. Which term is doing it?
 *
 *   node tools/_fillterms.mjs
 *
 * Established so far, and all of it measured rather than reasoned: rendered with
 * the sun switched off (tools/_fillonly.mjs) the wash floor reads hue 2.6 at
 * saturation 0.606, and the shaded wall in wall_shade reads hue 5.7 at 0.723 -
 * which is within noise of its full-light figure, so that wall genuinely is
 * fill-lit and its colour is the fill's colour. Violet-grey shade needs
 * reflected B/G above 1 at a saturation nearer 0.3. So the fill is the thing to
 * account for, and it is warm.
 *
 * The arithmetic that decides what is even reachable: reflected B/G is the
 * illuminant's B/G times the albedo's, so shade can only read cool where the
 * illuminant's B/G clears the albedo's G/B. Those are 1.514 for the wash floor
 * and 1.335 for the escarpment rock. The dome alone delivers 1.484 on an
 * up-facing normal, which clears the rock and misses the floor; with the
 * escarpment mixed in it falls to 1.362.
 *
 * So the escarpment is the term that decides it, and it is built from three
 * sources with very different colours - direct sun on the far wall, sky on the
 * far wall, and the wash floor bouncing up onto it. This prints each one's share
 * of the escarpment's radiance and its chroma, so the warmth can be attributed
 * to a source instead of to "the escarpment". A term that is merely large is a
 * modelling choice; a term that is large *and* built on the wrong quantity is a
 * bug, and this file has already caught one of those - the near-floor bounce was
 * being fed the regional 0.70-sunlit floor when it wanted the face's own
 * shadowed footing, and it turned shaded verticals pink.
 */
import { computeAtmosphere, SUN_DIR, GROUND_ALBEDO } from '../src/atmos.js';

const hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: mx > 0 ? d / mx : 0 };
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const A = computeAtmosphere();
const ROCK = [0.2890, 0.1617, 0.1211];
const WALL_SKYVIS = 0.20, FLOOR_VIEW = 0.5, SUN_EL = 15 * Math.PI / 180;
const WALL_LIT = 0.57;

/* Rebuild the three sources of wallRadiance exactly as src/atmos.js does, at the
   escarpment's brightest configuration - a wall square to the sun at its crest,
   which is what the away-from-sun lobe is looking at. */
const skyVertLum = 0.5 * lum(A.irradiance ? [0, 0, 0] : [0, 0, 0]);   // placeholder, see below
const skyVert = A.irradiance.skyHorizontal;      // sky irradiance, horizontal
const terms = [
  ['direct sun on the far wall', A.sunRGB.map((c) => c * WALL_LIT * Math.cos(SUN_EL))],
  ['sky on the far wall', A.irradiance.vertAnti.map((c) => c * WALL_SKYVIS / 1)],
  ['wash floor bounced up onto it', A.groundRGB.map((c) => c * Math.PI * FLOOR_VIEW)],
];

console.log('\n  the three sources feeding the escarpment, at a sunlit crest');
console.log('  (irradiance on the far wall, before its own albedo)\n');
let tot = 0;
for (const [, v] of terms) tot += lum(v);
for (const [lab, v] of terms) {
  const q = hsv(...v);
  console.log(`    ${lab.padEnd(32)} ${(100 * lum(v) / tot).toFixed(0).padStart(3)}% of it` +
    `   hue ${q.h.toFixed(0).padStart(4)}  sat ${q.s.toFixed(3)}  B/G ${(v[2] / v[1]).toFixed(3)}`);
}
const sum = [0, 1, 2].map((k) => terms.reduce((a, [, v]) => a + v[k], 0));
const refl = sum.map((c, k) => c * ROCK[k] / Math.PI);
const qs = hsv(...sum), qr = hsv(...refl);
console.log(`    ${'--- their sum'.padEnd(32)}          ` +
  `   hue ${qs.h.toFixed(0).padStart(4)}  sat ${qs.s.toFixed(3)}  B/G ${(sum[2] / sum[1]).toFixed(3)}`);
console.log(`    ${'--- leaving the escarpment'.padEnd(32)}          ` +
  `   hue ${qr.h.toFixed(0).padStart(4)}  sat ${qr.s.toFixed(3)}  B/G ${(refl[2] / refl[1]).toFixed(3)}`);

/* And what the dome delivers, for scale: the escarpment only matters in
   proportion to the sky it displaced. */
const sky = A.irradiance.horizontal;
const qk = hsv(...sky);
console.log(`\n  for scale, the dome's own irradiance on a horizontal:` +
  `   hue ${qk.h.toFixed(0).padStart(4)}  sat ${qk.s.toFixed(3)}  B/G ${(sky[2] / sky[1]).toFixed(3)}`);
console.log(`  escarpment radiance is ${(lum(refl) / (lum(sky) / Math.PI)).toFixed(2)}x the sky's mean radiance,`);
console.log('  and it covers the whole hemisphere below the 45 degree skyline.');

console.log(`\n  albedo G/B, the bar the illuminant has to clear:` +
  `  wash floor ${(GROUND_ALBEDO[1] / GROUND_ALBEDO[2]).toFixed(3)}` +
  `   escarpment rock ${(ROCK[1] / ROCK[2]).toFixed(3)}`);
