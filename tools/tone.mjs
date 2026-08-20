/* The tone curve, in isolation, so exposure can be solved instead of guessed.
 *
 *   node tools/tone.mjs fwd 0.72 0.58 0.52          # linear scene -> sRGB, sat, V
 *   node tools/tone.mjs inv 229 204 185             # a measured pixel -> linear scene
 *   node tools/tone.mjs sweep 229 204 185           # that pixel across exposures
 *
 * Why this exists. The fourth critique found the wash floor sitting at V 0.86
 * with a median of 0.90, and correctly identified that as the cause of the
 * saturation deficit rather than a symptom of it: HSV saturation is
 * (max-min)/max, ACES compresses the channels together as they approach the
 * shoulder, and a pixel at V 0.95 physically cannot carry much of it. Pushing
 * pigment to fix that only clips harder. The knob is exposure.
 *
 * But a render is twenty minutes on a software rasteriser, so tuning exposure by
 * shooting is a whole evening for three data points. The tone curve is a pure
 * function of one variable and the frames are already measured, so it can be
 * inverted: recover the linear radiance behind a measured pixel, then push it
 * back through the curve at a different exposure. That turns the question into
 * arithmetic and costs one render to confirm.
 *
 * The matrices are ACES AP1 and are what three.js uses verbatim in
 * ACESFilmicToneMapping; the shoulder fit is RRTAndODTFit. Kept exact rather
 * than approximated, because the whole point is that the desaturation toward the
 * shoulder is *in the matrices* — a naive Reinhard model would predict the
 * saturation loss as zero and give the wrong answer.
 */

const IN_M = [
  [0.59719, 0.35458, 0.04823],
  [0.07600, 0.90834, 0.01566],
  [0.02840, 0.13383, 0.83777],
];
const OUT_M = [
  [ 1.60475, -0.53108, -0.07367],
  [-0.10208,  1.10813, -0.00605],
  [-0.00327, -0.07276,  1.07602],
];

const mul = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const fit = (v) => v.map(x => {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.432951) + 0.238081;
  return a / b;
});
const sat01 = (v) => v.map(x => Math.min(1, Math.max(0, x)));

/** Linear scene radiance to display-referred sRGB in [0,1]. */
export function forward(lin, exposure) {
  let c = lin.map(x => x * exposure / 0.6);
  c = sat01(mul(OUT_M, fit(mul(IN_M, c))));
  return c.map(x => x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}

/** sRGB back to linear scene radiance, by bisection per channel on the full chain. */
export function inverse(srgb, exposure) {
  /* Not analytic: the ACES matrices couple the channels, so a channel's display
     value depends on all three inputs. Bisecting the whole vector jointly on a
     fixed hue ray is stable and accurate enough — the ray is what a scaling of
     exposure preserves anyway, which is exactly the question being asked. */
  const dir = srgb.map(x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const peak = Math.max(...dir, 1e-6);
  const unit = dir.map(x => x / peak);
  let lo = 0, hi = 64;
  for (let i = 0; i < 90; i++) {
    const m = (lo + hi) / 2;
    const got = forward(unit.map(x => x * m), exposure);
    if (Math.max(...got) < Math.max(...srgb)) lo = m; else hi = m;
  }
  const k = (lo + hi) / 2;
  return unit.map(x => x * k);
}

export const hsv = (c) => {
  const mx = Math.max(...c), mn = Math.min(...c);
  return { s: mx <= 0 ? 0 : (mx - mn) / mx, v: mx };
};

const show = (label, srgb) => {
  const { s, v } = hsv(srgb);
  console.log(`${label.padEnd(16)} rgb ${srgb.map(x => (x * 255).toFixed(0).padStart(4)).join('')}` +
    `   sat ${s.toFixed(3)}  V ${v.toFixed(3)}`);
};

const [mode, ...rest] = process.argv.slice(2);
const nums = rest.map(Number).filter(n => Number.isFinite(n));

if (mode === 'fwd') {
  const lin = nums.slice(0, 3);
  for (const e of [0.60, 0.66, 0.72, 0.78, 0.82, 0.90]) show(`exposure ${e}`, forward(lin, e));
} else if (mode === 'inv') {
  const e = nums[3] ?? 0.82;
  const lin = inverse(nums.slice(0, 3).map(x => x / 255), e);
  console.log(`linear scene radiance  ${lin.map(x => x.toFixed(4)).join('  ')}   (at exposure ${e})`);
  show('round trip', forward(lin, e));
} else if (mode === 'sweep') {
  const e0 = nums[3] ?? 0.82;
  const lin = inverse(nums.slice(0, 3).map(x => x / 255), e0);
  console.log(`behind rgb ${nums.slice(0, 3).join(' ')} at exposure ${e0}: ` +
    `linear ${lin.map(x => x.toFixed(3)).join(' ')}`);
  for (const e of [0.44, 0.50, 0.56, 0.62, 0.68, 0.74, 0.82]) show(`exposure ${e}`, forward(lin, e));
} else {
  console.log('usage: tone.mjs fwd|inv|sweep r g b [exposure]');
}
