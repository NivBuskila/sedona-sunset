/* Sedona Sunset — System 7: post-processing and polish.
 *
 * Everything between "the scene has been shaded" and "these are the bytes in
 * the PNG": tone mapping, grade, defocus, lens flare, vignette, chromatic
 * aberration, grain and dither.
 *
 * ── where this sits in the frame, and why it does not own the shimmer ───────
 *
 * System 5 draws the whole scene into an RGBA16F multisampled target and blits
 * it back through a heat-haze displacement. That was deliberately built as one
 * isolated stage so a later chain could compose with it, and it is left exactly
 * where it is. The only thing this file does to it is change where its blit
 * lands:
 *
 *   scene ──► shimmer.rt (RGBA16F, MSAA)      System 5
 *          ──► sceneRT   (RGBA16F, linear)    System 5's blit, redirected here
 *          ──► bright/blur/flare (quarter res)
 *          ──► canvas                          grade, tonemap, grain
 *
 * The redirect is the one piece of cleverness in the file and it earns its
 * keep. three decides whether to run `<tonemapping_fragment>` and
 * `<colorspace_fragment>` from whether the current render target is null — see
 * WebGLPrograms.getParameters. So the shimmer blit, which is written to end in
 * those two includes, tone maps and sRGB-encodes when it draws to the canvas
 * and does *neither* when it draws into a target. Pointing it at a float target
 * therefore hands this chain the frame in scene-linear radiance, with no edits
 * to atmosphere.js and no second copy of its shader. Turn post off and the same
 * file goes back to owning the frame unchanged.
 *
 * ── the constraint the grade is built around ────────────────────────────────
 *
 * Several surfaces in this scene have colour that is measured correct against
 * real photographs: lit rock at saturation 0.615-0.626, hue +18.9 to +19.4,
 * V 0.589-0.600, all on the brightest 40% of a `wall_lit` crop. A grade that
 * "pushes oranges and teals" can destroy that in one line.
 *
 * So the tone curve here is *the same ACES fit three already applies*,
 * reproduced verbatim from tonemapping_pars_fragment rather than replaced. With
 * every grade term at zero this chain is a bit-exact identity on the tonemapped
 * frame, which means the measured baseline is preserved by construction and
 * every number that moves can be attributed to one term. The grade itself is a
 * split-tone of a few percent per channel — warm into the highlights, blue-
 * violet into the shadows — plus a vibrance that is gated *off* above
 * saturation 0.6 precisely so it cannot touch lit rock.
 *
 * "Teal" in a warm desert grade is the shadows cooling, not the frame drifting
 * cyan. There is no global channel rotation anywhere in this file.
 *
 * ── determinism ─────────────────────────────────────────────────────────────
 *
 * The harness calls walkTo, waits 400 ms with the loop running, then renders.
 * Anything driven by the wall clock differs between two captures of the same
 * viewpoint — System 5 measured 8.8% of pixels moving that way before it froze
 * its particle clock on walkTo. The grain here does the same thing: it is a
 * fixed noise texture read at an offset derived from a phase, and walkTo pins
 * that phase to a pure function of the walk distance and freezes it until the
 * player actually moves. Every other term in the chain is a function of the
 * camera alone.
 *
 * ── cost ────────────────────────────────────────────────────────────────────
 *
 * Five added passes, four of them at quarter resolution. On the reference
 * numbers for this GPU a ten-pass chain including half-res raymarching came to
 * under a millisecond, so the pass count is not the thing to watch — the added
 * bandwidth is, and it is one RGBA16F full-res target (~17 MB at 1080p) against
 * the ~100 MB the shimmer buffer already moves. The quality ladder in perf.js
 * sheds the low-res chain first, then the defocus, then the flare; the grade,
 * vignette and grain survive to the bottom tier because they are one pass that
 * has to exist anyway and they are what the scene looks like.
 */
import * as THREE from 'three';

/* ── tunables ───────────────────────────────────────────────────────────────
 *
 * Collected here rather than scattered through the shaders because everything
 * upstream is still moving — lighting and the in-scatter phase function are
 * both in flight — so this chain has to be re-tunable without being rewritten.
 * Each is exposed on the returned handle as `params` and can be overridden from
 * the URL, e.g. `#grain=0` or `#grade=0`, which is how the measurement captures
 * separate one term from another.
 *
 * `#nopost` switches the whole chain out, and that one is not a debug aid: this
 * chain moves saturation, hue and `hf/lf`, which are the numbers four other
 * systems are judged on, so every handoff set from here ships with a matching
 * ungraded control. `tools/postpair.mjs` produces the pair from one frozen
 * source tree and exists so that cannot be forgotten.
 */
export const POST_DEFAULTS = {
  /* Grade. Both tints are normalised to unit Rec.709 luminance, so they rotate
     hue without moving exposure — a tint that also brightens is a tint whose
     effect on a saturation measurement cannot be separated from its effect on
     value. */
  gradeAmount: 1.0,          // master, 0 = bit-exact identity against no post
  shadowTint: [0.9813, 0.9964, 1.0920],  // blue-violet, 11% B over R
  highTint:   [1.0246, 0.9987, 0.9400],  // warm, 9% R over B
  /* Scene-linear luminance at which the split crosses. 0.12 sits between the
     lit rock of this scene (~0.30 linear) and its shaded rock (~0.05), which is
     what makes the two ends of the tint land on the two populations instead of
     averaging over both. Measured through tools/_p7grade.mjs on sys4d: lit rock
     moves saturation 0.604 -> 0.600 and hue 18.9 -> 18.5, and shaded rock moves
     B/G 0.789 -> 0.822 and hue 13.0 -> 11.2. That is the whole of "teal": the
     shadows cool, the lit faces do not move. */
  splitPivot: 0.12,
  vibrance: 0.10,            // low-saturation pixels only; zero above sat 0.60

  /* ── the shadow lift, and why it is here rather than in the toe ────────────
   *
   * The critic's first finding was clast side faces that read as pure black
   * beside blazing orange ground. Terrain attributed it to this chain, and the
   * attribution holds: the shading is right and ACES is what loses it.
   *
   * The frame contains scene-linear 0.0092 on the worst facet against 0.30 on
   * the sunlit floor behind it — 3.1%. That the 3.1% is *correct* has an
   * independent check that needs no sky-visibility figure at all: the shaded
   * floor of this scene sits at 7.4% of the sunlit floor, which pins sky-only
   * illumination on a fully open horizontal surface, so a facet at the measured
   * 71.5% sky visibility predicts 5.3% and burial and contact darkening take it
   * the rest of the way down. Nothing upstream is broken.
   *
   * ACES is. It reaches 0.0092 with a toe so hard that the value arrives at code
   * 6, and deleting the *entire* clast occlusion chain — every AO term, burial,
   * contact darkening — moves it only to about code 13. The whole available range
   * is inside the toe, which is why the defect reappeared on a new population
   * every time a material was blamed: it is a luminance band, not a population.
   *
   * The obvious response — reach for the toe below — is the wrong end of the
   * pipe twice over. That curve runs on *encoded* luminance after ACES has
   * already compressed the bottom two stops into six code values, so it can only
   * stretch what survived; and ACES flattens the contrast *between* dark facets
   * on the way, so re-expanding afterwards recovers the level without recovering
   * the separation. Acting in scene-linear before the curve keeps both, and costs
   * no precision because the frame is float until the final write.
   *
   * The shape is a soft knee: `shadowLift` gain at zero, falling as (1 - y/knee)^2
   * to exactly unity at `shadowLiftKnee` scene-linear luminance. So everything
   * above the knee is untouched *by construction* rather than by measurement,
   * which is the property that makes this safe to ship against a colour record —
   * lit rock at 0.365 linear and the sunlit floor at 0.30 cannot move, because
   * the term is identically 1.0 there. And it is a scalar on all three channels,
   * so like every other term in this file it leaves HSV saturation and hue
   * exactly where they were.
   *
   * Keyed on luminance alone this term is dead: the facet at 0.0092 and the shaded
   * floor at 0.0221 are 1.27 stops apart, and the gate is a *mean* over a shaded
   * window, so it moves with the population rather than with the worst pixel and
   * it moves first. Measured at gain 4, knee 0.045 the gate went to 0.418 against
   * a 0.25 ceiling. The local-maximum mask in the shader is what rescued it, by
   * discriminating on spatial scale instead — and with it the gate goes the other
   * way, to 0.214, because the mask finds more to open in the sunlit window's
   * crevices than in the shaded wall's flat.
   *
   * Shipped at 5, chosen by eye against a three-way capture and not by the table.
   * 8 measures better on every figure — worst facets to 26.5 cv against 16.7 —
   * and looks worse, because by then the gravel's inter-pebble shadows are lifted
   * too and the ground reads as a pushed shadows slider rather than as light. 5
   * takes the side faces off the floor and leaves the relief alone. Every
   * protected figure holds or improves at 5; the numbers are in CONTRACT.md, and
   * this constant is the whole of the decision if anyone disagrees with my eye. */
  shadowLift: 5.0,
  shadowLiftKnee: 0.045,
  /* Radius of the local-maximum taps, in pixels at 1440 lines, and the mask ramp
     on sqrt(linear luminance). The radius is an optical size and so scales with
     the frame like the circle of confusion and the grain do, rather than being a
     contrast threshold that must not — see CONTRACT.md on which post terms scale
     and which do not, which was got wrong once already on the silhouette gate. */
  shadowLiftRadius: 24,
  shadowLiftMask: [0.10, 0.30],
  /* Chroma-preserving, and applied after the sRGB encode with the pivot at
     encoded middle grey. See the shader for why both of those are corrections
     rather than choices. */
  contrast: 1.03, contrastPivot: 0.5,

  /* The shadow toe, and it exists because the contrast term above was quietly
     destroying shadow detail. A pivoted gain is algebraically a gain *plus a
     negative offset*: (e - p)k + p is ke - (k-1)p, so it is a subtractive black
     point at (k-1)p/k encoded, which at k 1.03 and p 0.5 is 3.7 code values.
     Everything below that clamped to zero. Measured on the shaded wall face,
     2.2% of it was pinned at exactly zero against 0.0% ungraded, and the first
     percentile went from 3 code values to 0. Clipped shadow does not read as
     dark, it reads as a hole, and System 4 was being asked to dim into it.
     So below `toeTop` the curve is replaced by a cubic Hermite that matches the
     contrast line's value and slope at toeTop and is pinned at the origin with
     slope `toeSlope`.

     **`toeSlope` is the slope at the origin and it is a clipping threshold, not
     a shape parameter.** This was the mistake, it shipped, and a critique found
     it: the curve is injective, so in floating point nothing positive maps to
     zero, and that was taken as "nothing can clip". The output is 8-bit. Near
     the origin the curve is te ~ toeSlope * e, so every input below
     0.5/toeSlope code values rounds to black — at the 0.20 that shipped, that is
     everything under 2.5 code values against 0.5 in the control. Whole-frame,
     that took wall_shade from 0.03% at literal zero to 1.38% and bend from 0.88%
     to 1.81%, and it is what turned flat shaded clasts into holes. A tone curve
     is only non-clipping to the precision it is written into.

     So toeSlope is 1.0, which is the only value that adds no clipping at all:
     unit slope at the origin means the first code value maps to itself. It still
     darkens, because the curve has to arrive at (A-p)k+p at the anchor, which is
     below A, so it sags to get there. Measured through tools/_p7toe.mjs, that
     costs the gate 0.205 -> 0.228 and buys the shaded face back 9.8 -> 11.2 code
     values with the whole-frame zero count at the control's figure.

     Where the knee sits matters more than how deep it is, and this is the whole
     tuning rule: the shaded face has to land on the steep flank, not inside the
     toe. Measured on two ungraded builds through tools/_p7toe.mjs, the same
     curve at toeTop 0.17 moved the shaded face's gradient +10% on a build whose
     face sat at 33 code values and -10% on one whose face sat at 14. So
     **toeTop wants to be about two and a half times the shaded face level**,
     and it needs revisiting whenever the fill moves. At the present face of
     ~13 code values that is 0.111.

     With the origin slope pinned at 1, toeTop became the single dial on the whole
     trade and it is worth writing the numbers down, because the two things it
     trades are a visible defect against a metric. The toe has to meet the
     contrast line at the anchor, and the contrast line is what actually crushes
     the bottom — a pivoted gain at k 1.03 and p 0.5 costs 29% at 12 code values
     all by itself — so a *higher* anchor means the toe covers more of the bottom
     and lifts more of it back. Predicted through tools/_p7toe.mjs, at 12 cv:

       anchor 0.080   gate 0.228   dark end at 0.82 of ungraded
       anchor 0.111   gate 0.237   dark end at 0.90
       anchor 0.150   gate 0.245   dark end at 0.94

     0.111 is the choice. The gate's band is 0.15-0.25 and 0.237 is inside it with
     the ungraded frame at 0.258, so the grade is still what brings it into band;
     the crush is what a critique could see. If the gate has to come back toward
     0.20 this is the dial, and the cost of moving it is legible above rather than
     something the next person has to rediscover. `#toe=` and `#toes=` sweep it. */
  toeTop: 0.111, toeSlope: 1.00,

  /* The highlight shoulder, which is the toe's mirror and was missed for the same
     reason the toe's clipping was: a pivoted gain has a symmetric problem at the
     top and the clamp hides it. The line crosses one at 0.9854 encoded, so
     everything above 251 code values flattened to white, and the chain was adding
     0.31% of the lit-rock window at 250+ against 0.04% ungraded. That is small,
     and it is worth having anyway for two reasons beyond the metric: clipped
     highlights on sunlit sandstone are a photographic failure, and the sun disc is
     now visible in the gap with the sky's range near it much wider than when this
     curve was tuned, so the term most likely to clip next has just arrived.
     0.86 is 219 code values, chosen to sit far above every measured window — lit
     rock's mean max channel is 170 — so it cannot move a contract figure. 0.45
     keeps the Hermite monotone, which needs both end slopes inside three times the
     mean slope over the span, here 2.77. `#sh=` and `#shs=` sweep it, 0 is off. */
  shoulderTop: 0.86, shoulderSlope: 0.45,

  /* Defocus. A physical thin-lens circle of confusion, so the shape of the
     falloff is not a free parameter: 24 mm at f/11 focused at 20 m on a 24 mm
     sensor. That is what a landscape photographer at golden hour is actually
     shooting, and it puts the circle at 0.10 px at infinity, 0.34 px at 4.5 m
     and 1.9 px at 1 m — a frame that is sharp everywhere except the ground
     immediately at your feet.
     f/8 focused at 12 m was tried first and is where the numbers come from: it
     is still inside the standard 0.03 mm acceptable-sharpness criterion, but
     it put 1.1 px on the floor at 2 m, and that measured — wash_mid floor
     hf/lf 0.57 -> 0.51, ground floor 0.47 -> 0.41. Both of those are surfaces
     System 1 is being judged on and neither of them is out of focus in a real
     photograph of a wash.
     `skipPx` is the other half of that fix. Below it the gather does not run at
     all, so nothing from about 2.4 m to infinity is resampled even by a
     fraction of a pixel.
     `farPx` is the one non-physical term and it is off. The physical model
     already says 0.10 px at a kilometre, which is correctly nothing, and
     anything larger would be spending exactly the far-field structure System 2
     spent three rounds earning. The ramp is left in place for whoever decides
     otherwise, with a measurement. */
  focal: 0.024, fStop: 11.0, focus: 20.0,
  cocMax: 4.0,               // pixels, at 900 lines
  skipPx: 0.75,
  farPx: 0.0, farA: 900.0, farB: 2500.0,

  /* Bloom and flare, in scene-linear radiance. The threshold is above anything
     the rock or the floor reaches, so only the sky near the sun and the sun
     itself feed it. */
  /* The gain was 0.055 and it was the one term in the audit that arithmetic
     could not bound, because a halo's height depends on what is on the other
     side of the edge. Measured on a frozen pair, it put +8.3 code values on the
     rock two pixels under the skyline of `bend`, decaying to nothing over about
     thirty — a glow hugging a ridge line, which is the most recognisable render
     tell in the list and worse than anything the grade was doing. The addition
     is linear in this gain, so a quarter of it lands the same edge near 2 cv.
     If the sun ever needs a bigger glow than that, raise `bloomThresh` toward
     the sky's own radiance instead: it is the threshold, not the gain, that
     decides whether an ordinary bright sky counts as a highlight. */
  bloomThresh: 0.55, bloomKnee: 0.35, bloomGain: 0.013,
  /* These three were wrong by a factor of twenty and there was no way to know
   * until the sun's screen position came inside a frame, which it now has.
   *
   * The gains were set against a source that never fired. Everything below is
   * proportional to the radiance in the bright buffer at the sun's position,
   * which is what makes occlusion free — a butte in front of the sun leaves that
   * position dark and the flare goes away by itself, with no visibility query.
   * The cost of that is that the gains are only meaningful against a known
   * source, and the only source available for tuning was a forced one.
   *
   * Measured the first time it fired, on wash_low of the sys7d pair: the veil
   * added 0.113 in linear radiance at its peak, onto rock sitting at 0.029, and
   * took a block of shaded floor from 34 to 123 code values. Mean over the whole
   * frame was +22 cv. Solving back through the tone curve for a +6 cv peak gives
   * a factor of 0.047, and the three keep their tuned ratios.
   *
   * The source there measured about 2.06, which is sky glow and not a disc, so
   * the ceiling below at knee+range = 60 was never reached and the calibration
   * would have broken all over again the moment the disc cleared. A ceiling that
   * is never the operative limit is not a safety bound, it is decoration. So it
   * now sits just above the sky, at 4: sky glow of 2-3 passes almost unclamped,
   * so the bloom above is unaffected, and a disc of hundreds clamps to 4, which
   * is at most a doubling of the veil measured here. Bounded, and it does mean
   * the flare stops responding to the disc's brightness above the clamp — a fair
   * trade for an effect whose source is a nine-tap average of a quarter-scale
   * blur, which is not a flux measurement in the first place. */
  ghostGain: 0.0014, veilGain: 0.0026, streakGain: 0.0014,
  /* Ceiling on the flare *source*, not on the flare, and it is the reason the
     gains above are a calibration rather than a guess. The soft knee is an
     identity below `flareKnee` and asymptotes at knee+range, so the sky's own
     2-3 passes through almost untouched while a solar disc of hundreds arrives
     as 4. The gains are calibrated at that clamp; see above for what happened
     when they were calibrated against nothing. */
  flareKnee: 2.0, flareRange: 2.0,

  /* Polish, and all three of these were set by an audit rather than by eye.
   *
   * The standing instruction is that anything identifiable as an *effect* rather
   * than as the scene is wrong here, however physically defensible, and to err
   * off where borderline. That is a claim about visible magnitudes, so
   * tools/_p7audit.mjs puts each one in the units a viewer sees, at 1440 lines
   * rather than at the 900 the parameters are quoted in. Two of the three moved.
   *
   * Vignette was 0.20, which is a real 24 mm at f/11 — about a third of a stop
   * in the corner — and it cost 16.6 code values at mid grey there. A smooth
   * radial ramp that size is nameable by anyone who thinks to look at a corner,
   * so this is deliberately sub-physical: 0.05 is 3.8 cv at worst, under a
   * smoothstep that leaves the middle of the frame untouched, which is a corner
   * that measures darker and does not read as darkening.
   *
   * That measurement was taken at mid grey and it was the wrong place. A
   * critique found the top corners of `wash_mid` at 0.735 of the ungraded frame
   * and read it as a graduated filter on bright sky; the corners are at 18 code
   * values, so it is the dark end, and the reason a 5% light loss lands as 31%
   * there is two amplifications the mid-grey probe could not see. The encode is
   * the first: enc = 1.055*L^(1/2.4) - 0.055, and that constant offset is a large
   * fraction of a small encoded value, so a 5% loss in L is 4.6% of enc at 12 cv
   * against 2.0% at 200. The toe was the second and much the larger, and it is
   * fixed above. tools/_p7name.mjs --attrib separates the two by tabulating the
   * graded/ungraded ratio against level *and* radius, which is the measurement
   * that should have been taken: a light loss is flat in level and falls with
   * radius, a tone curve is the reverse, and this scene's dark corners and bright
   * centre confound the two in exactly the way that makes the second look like
   * the first. 0.025 is 1.9 cv at mid grey and holds the dark corner inside 2%
   * of the ungraded frame once the toe is not multiplying it. */
  vignette: 0.025,           // linear light lost at the extreme corner
  /* Off, and the code path stays. At 0.9 the extreme corner split 0.90 px at
     900 lines and 1.44 px at 1440 — over a pixel is exactly where a colour
     fringe resolves as a fringe, and it was the most nameable term in the list.
     Under half a pixel it cannot resolve at all, so the honest choices were
     "invisible" or "off", and off also skips two texture fetches. 0.3 is the
     largest value that stays sub-pixel at 1440 if anyone wants it back. */
  aberration: 0.0,           // pixels of radial split at the extreme corner
  /* Encoded units. Kept, because it is the one term here that measures *below*
     the quantisation it is dithering: 0.44 code values rms in the shadows and
     0.26 in the highlights, against a step of 1.0. The peak is +-1.6 cv and it
     is four sigma, so it lands on a fraction of a percent of pixels. Nothing at
     that level can be named as grain; what it can do is break a contour. Measured on the near-white sky of `juniper`, where a critic found
     the gradient stepping about once every eight rows, the plate takes the
     contour spacing from 14.5 rows to 10.5 and the distinct-colour count up
     with it. */
  grain: 0.013,
  /* Code values, peak to peak, at the 8-bit boundary. 1.5 rather than the
     textbook 1.0, and the reason is that this is interleaved gradient noise
     rather than white: swept on a synthetic ramp at the sky's own gradient, 1.0
     leaves runs of 10 to 16 code values at one level and 1.5 takes them to 3,
     while still costing less than a white triangular dither at 1.0. Above about
     2 the pattern starts to be resolvable on a flat surface, which is the ceiling.
     See the resolve shader for why this is a separate term from the grain rather
     than more of it. `#dith=` sweeps it; 0 is the control. */
  dither: 1.5,

  /* The silhouette resolve, and it is worth explaining why a fifth polish term
   * exists at all when restraint is the theme of the whole project.
   *
   * The whole-scene critique calls the butte skyline against bright sky the one
   * edge that reads as broken rather than imperfect. Two agents measured the
   * cause and disagreed; the driver's answer, from tools/_p7msaa.mjs, is that 26
   * of 48 indexed draws land in a four-sample framebuffer, so the scene *is*
   * antialiased and always was. The edge is bad anyway, and four coverage
   * samples is the whole reason: the silhouette carries about 150 code values
   * across one pixel, and four samples can put at most three intermediate levels
   * into it. Measured on sys7e, the median largest one-pixel jump is 114 and the
   * edge carries 0.73 intermediate rows per column — one partly covered pixel,
   * which is exactly what MSAA at 4x looks like when it is working.
   *
   * More samples barely helps: System 2's 3200x1800 control, which is sixteen
   * effective samples, only reaches 91. That is a 20% return for four times the
   * sampling, because the limit is not the sample count, it is that a
   * high-contrast geometric edge lands inside one pixel.
   *
   * What is actually visible is not the step across the edge — a photograph of a
   * backlit ridge has a hard edge too — it is that the partly covered pixel
   * exists in one column and not the next, and that alternation marching along
   * the ridge is the staircase. So this blurs *along* the local edge direction
   * and never across it: the profile through the edge is untouched, and the
   * columns that had no transition pixel get one. Measured at amount 0.75 the
   * median jump goes 114 -> 78 with the intermediate rows up to 0.99, which beats
   * the supersampled reference by a wide margin at about a twentieth of the cost.
   *
   * The gate is what keeps it off everything else, and it is the reason this is
   * not a filter. It reads the local luminance range over the four neighbours:
   * rock and floor interiors measure 6 to 10 code values of range, a silhouette
   * against sky measures 95, so a threshold in the tens separates them with two
   * decimal orders to spare.
   *
   * Where exactly it sits was swept rather than chosen. At 40 the surface figures
   * do move, slightly and only on the one standard crop that straddles a
   * silhouette: bend's wall window went hf/lf 0.56 -> 0.55, which is the gate
   * exactly, from 0.92% of its pixels sitting on a 95 code value edge. Nothing
   * below 40 was touched at all — measured, with tools/_p7edge.mjs --touch — so
   * it was structure of the right kind rather than leakage. Sitting on a contract
   * figure is still not somewhere to sit, and the sweep says the trade is nearly
   * free: at 70 every surface figure reads identically to ungraded and the edge
   * median gives up 0.8 of 32 code values. So 70, and the 1% is the price of not
   * taking anything measurable off Systems 1 and 2. */
  edgeAmount: 0.75,
  edgeLo: 70 / 255, edgeHi: 130 / 255,
};

/* ── the grain plate ────────────────────────────────────────────────────────
 *
 * Not a per-pixel hash. White noise reads as digital sensor noise and, more to
 * the point for this project, it is the one thing that would let a structure
 * metric be bought with amplitude: `hf/lf` is a ratio of one-pixel to
 * four-pixel gradient energy, and uncorrelated noise is pure hf. Real film
 * grain is a clumped emulsion, correlated over rather more than a pixel, so the
 * plate is value noise passed through a binomial kernel and renormalised.
 *
 * Three decorrelated channels, so the grain can be mostly luminance with a
 * little chroma in it, which is what colour negative actually does.
 *
 * Fixed integer stream, never Math.random: two page loads must produce the same
 * plate or the determinism check fails on the grain alone.
 */
function grainPlate(n = 256) {
  const raw = new Float32Array(n * n * 3);
  let s = 0x7ea11 >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < raw.length; i++) raw[i] = rnd();

  /* One binomial pass. Wider than this and the plate stops dithering — the
     whole point of the shadow amplitude is that it is a code value or two, and
     a heavily smoothed plate has no energy left at the step it has to break
     up. Narrower and it is white noise again. */
  const out = new Uint8Array(n * n * 4);
  const K = [1, 2, 1];
  const at = (x, y, c) => raw[(((y + n) % n) * n + ((x + n) % n)) * 3 + c];
  for (let c = 0; c < 3; c++) {
    let mn = 1e9, mx = -1e9;
    const tmp = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0, w = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const k = K[i + 1] * K[j + 1];
            v += k * at(x + i, y + j, c); w += k;
          }
        }
        v /= w;
        tmp[y * n + x] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const sc = 255 / Math.max(1e-6, mx - mn);
    for (let i = 0; i < n * n; i++) out[i * 4 + c] = Math.round((tmp[i] - mn) * sc);
  }
  for (let i = 0; i < n * n; i++) out[i * 4 + 3] = 255;

  const t = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.NearestFilter;   // one plate texel per screen pixel, always
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ── shared shader source ───────────────────────────────────────────────────*/

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMMON = /* glsl */`
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* Non-finite guard, and it is not defensive programming — it fixed a visible
 * defect. The first capture through this chain had a hard-edged black rectangle
 * across the sky of the wash_mid view that was absent with the chain switched
 * off, and the mechanism is worth recording because any later pass will hit it
 * too.
 *
 * The mechanism below was inferred rather than measured, and the measurement
 * says it is wrong. tools/hdrmax.mjs reads the linear values out of this very
 * buffer: in the wash_mid view the finite maximum is 2.89 and there are zero
 * +Inf channels, so nothing here ever approached 65504 and no overflow was
 * involved. There were six NaN channels -- two adjacent texels -- and they
 * survive with the sky dome hidden, which rules out the sky shader too. Its
 * output is bounded at about 203 by construction: the LUT is finite, the
 * Henyey-Greenstein phase peaks at 2.43 for g = 0.76, and the disc radiance is
 * capped at forty times the aureole peak.
 *
 * The real source is upstream of every pass here. Bisecting the scene graph,
 * hiding juniper-wood takes the count from six to zero, and scanning its
 * buffers finds 33 non-finite floats in its color vertex attribute -- 11
 * vertices, first at index 11565. Vertex colour multiplies into diffuse, so
 * those vertices emit NaN directly, and only two pixels show it because the
 * faces are tiny and far. (juniper-hummock separately carries 44 degenerate
 * triangles of 1144 and one zero-length normal.) That is System 3's to fix.
 *
 * The guard below is still right and should stay: it is what stopped two texels
 * of somebody else's bad geometry from becoming a rectangle across the sky, and
 * it costs nothing. Only the explanation needed correcting. The general lesson
 * is the reason for keeping this note: a plausible mechanism that explains the
 * symptom is not the same as the mechanism, and "a radiance above half-float
 * range" sent the investigation into the one shader that could be proved
 * innocent with arithmetic.
 *
 * A note for whoever edits this next, having just cost two people ten minutes:
 * this comment is inside the COMMON template literal, so a backtick anywhere in
 * it terminates the string and the module stops parsing at the next keyword.
 * Write code names bare in here.
 *
 * For the record, the inferred chain was this, and it remains a real hazard for
 * any pass that reads the frame arithmetically, just not what happened here.
 * The scene buffer is RGBA16F, so a radiance above 65504 arrives as +Inf. A
 * tone curve does not care: ACES clamps, and Inf comes out white, which is why
 * nothing upstream had ever noticed. A *bright pass* does care, because its
 * soft knee divides by the luminance — Inf/Inf is NaN. NaN then propagates
 * through both separable blur passes, and since a blur is a sum, one poisoned
 * texel poisons every texel within the kernel: the horizontal pass smears it
 * into a line and the vertical pass turns that line into a rectangle. The hard
 * edges are the kernel's support, which is exactly why it did not look like a
 * shading artefact.
 *
 * A test of x >= 0.0 is false for NaN and for negatives, which is all this
 * needs in GLSL ES 1.00 — isnan() is a 3.0 builtin and this material compiles
 * as 1.00, and it catches the measured cause and the inferred one alike.
 */
vec3 sane(vec3 c) {
  return vec3(c.r >= 0.0 ? min(c.r, 60000.0) : 0.0,
              c.g >= 0.0 ? min(c.g, 60000.0) : 0.0,
              c.b >= 0.0 ? min(c.b, 60000.0) : 0.0);
}

/* The same guard for a buffer that is legitimately negative.
 *
 * sane() folds negatives to zero, which is right for radiance and catastrophic
 * for System 5's marched in-scatter: that buffer is a subtractive correction and
 * every sample in it is negative, so passing it through sane() would silently
 * delete the light shafts and leave a composite that looks perfectly wired.
 * Worth the second function rather than a clamp at the call site.
 *
 * This guards non-finite values only, and deliberately does not clamp the sign.
 * Bounding it to negatives would hide the exact regression the sign is checked
 * for — see the shaft note in render(). NaN fails both comparisons, which is the
 * test rather than == because a compiler is entitled to fold x == x to true. */
vec3 finite(vec3 c) {
  return vec3((c.r <= 0.0 || c.r >= 0.0) ? clamp(c.r, -60000.0, 60000.0) : 0.0,
              (c.g <= 0.0 || c.g >= 0.0) ? clamp(c.g, -60000.0, 60000.0) : 0.0,
              (c.b <= 0.0 || c.b >= 0.0) ? clamp(c.b, -60000.0, 60000.0) : 0.0);
}
`;

function fullscreenMesh(mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(
    new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/* ── the chain ──────────────────────────────────────────────────────────────*/

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {object} o.atmo          the buildAtmosphere handle (System 5)
 * @param {THREE.DirectionalLight} o.sun
 */
export function createPost({ renderer, camera, atmo, sun }) {
  const hash = (typeof location !== 'undefined' ? location.hash || '' : '').toLowerCase();
  const num = (key, dflt) => {
    const m = hash.match(new RegExp('[#&]' + key + '=([0-9.]+)'));
    return m ? +m[1] : dflt;
  };
  const P = { ...POST_DEFAULTS };
  P.grain = num('grain', P.grain);
  /* `#vig=0` exists so the vignette can be measured against the rest of the
     chain rather than against the ungraded frame. Every other radial term — the
     aberration gate, the flare's veil, the bloom's spill from a bright sky — also
     varies with radius, so a graded-over-ungraded ratio that falls toward a
     corner is not evidence about the vignette specifically. Pairing graded
     against graded-with-this-off is, and it is the only way to attribute the
     corner without shooting the whole chain term by term. */
  P.vignette = num('vig', P.vignette);
  P.gradeAmount = num('grade', P.gradeAmount);
  /* A multiplier on the three flare gains, for one specific job: the sun in
     this scene is below the butte skyline from every standard viewpoint, so it
     is always partly or wholly occluded and the ghosts correctly never fire.
     That is the effect working, and it is also indistinguishable from the
     effect being broken. `#flare=8` makes the geometry visible so it can be
     checked once, rather than shipping a path nothing has ever exercised. */
  P.flareScale = num('flare', 1);
  /* `#fknee=100000` lifts the flare-source ceiling out of reach, which is how
     the claim that the ceiling is an identity on the present frame gets tested
     rather than asserted: capture with and without and diff the files. */
  P.flareKnee = num('fknee', P.flareKnee);
  /* The shadow toe is a trade between the shadow-to-sunlit gate and structure on
     the lit side, and it has to be re-tuned whenever the fill moves, so both
     ends of it are sweepable from the URL without a rebuild. `#toe=0` restores
     the plain pivoted contrast, black point and all, which is how the toe's own
     contribution gets separated from the rest of the grade. */
  /* The shadow lift's two numbers, sweepable for the same reason the toe's are:
     the knee is a trade against the shadow gate, the gain is a trade against how
     black a physically-correct 3% facet is allowed to read, and both have to be
     re-measured whenever the fill moves. `#lift=1` is the identity and is how the
     shipped arm gets paired against the curve as it was. */
  P.shadowLift = num('lift', P.shadowLift);
  P.shadowLiftKnee = num('liftknee', P.shadowLiftKnee);
  P.shadowLiftRadius = num('liftr', P.shadowLiftRadius);
  P.toeTop = num('toe', P.toeTop);
  P.toeSlope = num('toes', P.toeSlope);
  P.shoulderTop = num('sh', P.shoulderTop);
  P.shoulderSlope = num('shs', P.shoulderSlope);
  /* `#dith=0` is the control for the banding measurement, which needs the run
     lengths with the dither out and everything else identical. */
  P.dither = num('dith', P.dither);
  /* The toe cannot be placed arbitrarily low, and the failure is not graceful.
     The contrast line it has to meet at toeTop crosses zero at p(k-1)/k, which
     is 0.0146 encoded at the shipped values; at or below that the Hermite's top
     endpoint is zero or negative and the curve stops being monotone, which does
     not read as a dark frame, it reads as posterised bands with an inverted one
     at the bottom. Swept at 8192 steps, monotonicity actually fails below about
     0.020, so the clamp sits at three times the crossing — 0.044 — to stay well
     clear of it, and it says so rather than silently moving a swept parameter
     out from under whoever swept it. 0 still means off. */
  if (P.toeTop > 0) {
    const floor = 3 * P.contrastPivot * (P.contrast - 1) / P.contrast;
    if (P.toeTop < floor) {
      console.warn(`[post] toeTop ${P.toeTop} is below the monotone limit; using ${floor.toFixed(4)}`);
      P.toeTop = floor;
    }
  }
  /* The silhouette resolve, sweepable for the same reason the grade is: the
     claim that it fixes the staircase without touching surface structure is two
     measurements on the same frame with this at its value and at zero, and
     needing a rebuild between them is how that check quietly stops happening. */
  P.edgeAmount = num('edge', P.edgeAmount);
  let disabled = /(^|[#&])nopost(\b|$|&)/.test(hash);

  const plate = grainPlate(256);
  /* One black texel, so the shaft sampler is always bound to something real.
     An unbound sampler2D reads as opaque black on this driver and would work by
     accident, but three logs about it every frame and a warning nobody can act
     on is worse than four bytes. */
  const blackPx = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackPx.needsUpdate = true;

  /* ── targets ───────────────────────────────────────────────────────────── */

  let sceneRT = null;          // full res, scene-linear radiance
  let outRT = null;            // full res, display-encoded, for the resolve
  let loA = null, loB = null;  // the low-resolution ping-pong
  let W = 0, H = 0, LODIV = 4;
  /* Multisampling on sceneRT, which is *not* the same question as multisampling
     the frame. See setSamples: it is only paid on the branch where this chain
     draws the scene itself, and it is zero when this target is a blit
     destination, because MSAA on a full-screen quad is 66 MB a frame for
     nothing. */
  let SAMP = 0, wantSamp = 4;

  function allocate(w, h, div, samp) {
    if (sceneRT && W === w && H === h && LODIV === div && SAMP === samp) return;
    W = w; H = h; LODIV = div; SAMP = samp;
    if (sceneRT) {
      if (sceneRT.depthTexture) sceneRT.depthTexture.dispose();
      sceneRT.dispose();
      sceneRT = null;
    }
    for (const t of [loA, loB, outRT]) if (t) t.dispose();
    loA = loB = outRT = null;

    /* A depth *texture*, not a renderbuffer, and it is readable by anyone.
     *
     * Two reasons. The near one: in the fallback path, where System 5's stage is
     * off and the scene is drawn straight in here, this is the only depth there
     * is, and with a renderbuffer nothing could read it — so the defocus was
     * silently off on that path rather than degraded. Now it is not.
     *
     * The far one is a handover. System 5's shimmer displacement is disabled by
     * user instruction, but its target correctly still runs, because the marched
     * in-scatter that makes the light shafts needs a depth texture to know where
     * each ray stops and that target is where the depth lives. So the scene is
     * currently going through an RGBA16F MSAA buffer whose only surviving
     * purpose is to carry depth — the single largest bandwidth item in the frame,
     * for a texture this target can supply for free. Pointing their march at
     * `post._sceneDepth()` lets that buffer go.
     *
     * One thing a migration still needs, and it is theirs to decide: something
     * has to composite the shaft buffer once their blit is no longer there to do
     * it. That is a texture and a gain, which is a chain, not an absorption.
     * The other precondition used to be listed here — that `samples` has to come
     * with the scene draw or the frame loses its only antialiasing — and it is
     * now met on this side by setSamples below, so the handover no longer costs
     * the frame its edges. */
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.format = THREE.DepthFormat;
    sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: depth,
      samples: samp,
    });
    sceneRT.texture.minFilter = THREE.LinearFilter;
    sceneRT.texture.magFilter = THREE.LinearFilter;
    sceneRT.texture.generateMipmaps = false;

    /* The display-space frame the resolve pass reads. Half float rather than
       eight bit on purpose: it holds encoded values, and quantising them here
       would put the 8-bit step *before* the dither that exists to break it up,
       which is the one ordering that makes the grain useless. */
    outRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: false, samples: 0,
    });
    outRT.texture.minFilter = THREE.NearestFilter;
    outRT.texture.magFilter = THREE.NearestFilter;
    outRT.texture.generateMipmaps = false;

    if (div > 0) {
      const lw = Math.max(2, Math.round(w / div)), lh = Math.max(2, Math.round(h / div));
      const mk = () => {
        const t = new THREE.WebGLRenderTarget(lw, lh, {
          type: THREE.HalfFloatType, depthBuffer: false, samples: 0,
        });
        t.texture.minFilter = THREE.LinearFilter;
        t.texture.magFilter = THREE.LinearFilter;
        t.texture.generateMipmaps = false;
        t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
        return t;
      };
      loA = mk(); loB = mk();
    }
  }

  /* ── pass 1: bright extract and downsample ─────────────────────────────── */

  const brightMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThresh: { value: P.bloomThresh },
      uKnee: { value: P.bloomKnee },
      uCeil: { value: new THREE.Vector2(P.flareKnee, P.flareRange) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThresh;
uniform float uKnee;
uniform vec2 uCeil;
varying vec2 vUv;
${COMMON}
void main() {
  /* Four bilinear taps on the diagonal of the source texel quad, which at a
     quarter-resolution destination is a sixteen-texel box for the price of
     four fetches. Box rather than a point sample because the sun is a handful
     of very bright pixels and point-sampling it makes the whole flare flicker
     as the camera turns. */
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c = sane(c * 0.25);

  /* Soft knee, so a surface drifting across the threshold as the light changes
     fades in rather than switching on. */
  float l = luma(c);
  float k = clamp(l - uThresh + uKnee, 0.0, 2.0 * uKnee);
  float w = max(l - uThresh, k * k / (4.0 * uKnee + 1e-5)) / max(l, 1e-5);
  c *= clamp(w, 0.0, 1.0);

  /* Soft ceiling, applied here rather than in the flare pass so that the one
     buffer bounds all four terms that read it — bloom, veil, ghosts, streak.
     Below the knee this is exactly the identity; above it, the source saturates
     at knee+range instead of running away with the solar disc. See flareKnee in
     POST_DEFAULTS for why that matters more than it looks like it should. */
  vec3 over = uCeil.x + uCeil.y * (1.0 - exp(-(c - uCeil.x) / max(uCeil.y, 1e-3)));
  c = mix(c, over, step(vec3(uCeil.x), c));

  gl_FragColor = vec4(c, 1.0);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── pass 2/3: separable blur ──────────────────────────────────────────── */

  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  /* Nine taps at double spacing. Veiling glare is a very wide, very low
     amplitude skirt — the sharp core of it is the sun itself and is already in
     the frame — so reach matters far more than kernel fidelity here, and the
     bilinear smear between the widely spaced taps is doing useful work rather
     than being an artefact. */
  vec3 c = texture2D(tSrc, vUv).rgb * 0.196;
  c += (texture2D(tSrc, vUv + uDir * 1.0).rgb + texture2D(tSrc, vUv - uDir * 1.0).rgb) * 0.175;
  c += (texture2D(tSrc, vUv + uDir * 2.2).rgb + texture2D(tSrc, vUv - uDir * 2.2).rgb) * 0.121;
  c += (texture2D(tSrc, vUv + uDir * 3.6).rgb + texture2D(tSrc, vUv - uDir * 3.6).rgb) * 0.061;
  c += (texture2D(tSrc, vUv + uDir * 5.2).rgb + texture2D(tSrc, vUv - uDir * 5.2).rgb) * 0.023;
  gl_FragColor = vec4(c, 1.0);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── pass 4: flare ─────────────────────────────────────────────────────── */

  /* Ghosts are the aperture re-imaged by an even number of internal
     reflections, so they land on the line through the sun and the optical
     centre — that is not a stylistic choice, it is where they have to be. `t`
     parameterises that line with 0 at the sun and 1 at frame centre, so t > 1
     is the far side. Radii and tints are a plausible six-element coated lens:
     the small tight ones are the front-group reflections, the large faint ones
     the rear.
     Everything is scaled by the radiance actually measured around the sun in
     this frame, which is what makes occlusion work without an occlusion query:
     a sun behind a butte contributes nothing to the bright buffer, so there is
     nothing to reflect and the flare goes away by itself. */
  const GHOSTS = [
    [-0.34, 0.045, 1.00, 0.62, 0.34, 0.55],
    [0.30, 0.026, 0.55, 0.76, 1.00, 0.30],
    [0.63, 0.078, 1.00, 0.86, 0.56, 0.20],
    [1.00, 0.019, 0.68, 1.00, 0.84, 0.42],
    [1.44, 0.118, 0.38, 0.56, 1.00, 0.12],
    [1.87, 0.056, 1.00, 0.72, 0.46, 0.16],
  ];

  const flareMat = new THREE.ShaderMaterial({
    defines: { FLARE_LEVEL: 2 },
    uniforms: {
      tBloom: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uAspect: { value: 1.777 },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uSunOn: { value: 0 },
      uBase: { value: P.bloomGain },
      uGhost: { value: P.ghostGain },
      uVeil: { value: P.veilGain },
      uStreak: { value: P.streakGain },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tBloom;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec2 uSun;
uniform float uSunOn;
uniform float uBase;
uniform float uGhost;
uniform float uVeil;
uniform float uStreak;
varying vec2 vUv;
${COMMON}

const vec2 CTR = vec2(0.5, 0.5);

void main() {
  /* This buffer leaves already scaled by its final contribution, so the last
     pass adds it at unit gain. Doing the scaling there instead would have
     multiplied the flare terms by the bloom gain as well and made the ghosts
     three orders of magnitude too faint to see. */
  vec3 acc = texture2D(tBloom, vUv).rgb * uBase;

#if FLARE_LEVEL > 0
  if (uSunOn > 0.001) {
    /* The radiance of whatever is actually at the sun's position, from the
       frame itself. Nine taps in a small disc rather than one, so a sun sitting
       on the edge of a butte silhouette gives a partial answer instead of a
       binary one. Clamped, because a sun just outside the frame still puts
       light through the front element and the nearest edge pixels are the best
       evidence available for how much. */
    vec3 sunCol = vec3(0.0);
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float a = fi * 2.39996323;
      float rr = sqrt((fi + 0.5) / 9.0) * 7.0;
      vec2 uv = clamp(uSun + vec2(cos(a), sin(a)) * rr * uTexel, vec2(0.002), vec2(0.998));
      sunCol += texture2D(tBloom, uv).rgb;
    }
    sunCol *= uSunOn / 9.0;

    vec2 q = (vUv - uSun) * vec2(uAspect, 1.0);
    float dSun = length(q);

    /* Veiling glare: light scattered off every surface in the barrel, which is
       a broad low skirt centred on the source and is most of what makes a real
       backlit frame read as a photograph rather than a render. */
    acc += sunCol * uVeil * exp(-dSun * 3.2);

    /* Ghosts. Unrolled from the table above rather than looped over a uniform
       array: six elements, and an if-chain inside a loop compiles to the same
       thing with a branch on top. Each one is brighter at the rim, because a
       ghost is an image of the iris seen through a lens that is not corrected
       at that conjugate. */
${GHOSTS.map(([t, r, tr, tg, tb, gi]) => `    {
      vec2 gp = mix(uSun, CTR, ${t.toFixed(3)});
      float d = length((vUv - gp) * vec2(uAspect, 1.0));
      const float r = ${r.toFixed(4)};
      float a = smoothstep(r, r * 0.70, d) * (0.72 + 0.60 * smoothstep(r * 0.50, r * 0.94, d));
      acc += sunCol * vec3(${tr.toFixed(3)}, ${tg.toFixed(3)}, ${tb.toFixed(3)}) * (a * ${gi.toFixed(3)} * uGhost);
    }`).join('\n')}
  }
#endif

#if FLARE_LEVEL > 1
  /* A faint anamorphic streak. Not from an anamorphic lens — a spherical lens
     with a bright source still throws a horizontal smear off the aperture
     blades and off the sensor cover glass — so it is kept low and warm rather
     than the blue cinema cliche. Seventeen taps with widening spacing, on the
     bright buffer, so like the ghosts it is occluded for free. */
  vec3 st = vec3(0.0);
  float wsum = 0.0;
  for (int i = -8; i <= 8; i++) {
    float fi = float(i);
    float w = exp(-fi * fi * 0.055);
    st += texture2D(tBloom, vUv + vec2(fi * abs(fi) * 0.9 * uTexel.x, 0.0)).rgb * w;
    wsum += w;
  }
  acc += (st / wsum) * uStreak * vec3(1.0, 0.86, 0.68);
#endif

  gl_FragColor = vec4(acc, 1.0);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── pass 5: defocus, grade, tone map, grain ───────────────────────────── */

  const finalMat = new THREE.ShaderMaterial({
    defines: { DOF_TAPS: 12, USE_BLOOM: 1 , USE_LIFT: 1 },
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      tDepth: { value: null },
      tShaft: { value: null },
      uShaft: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 1.777 },
      uNear: { value: 0.06 },
      uFar: { value: 6000 },
      uExposure: { value: 1.0 },

      uCocScale: { value: 0.2 },
      uFocus: { value: P.focus },
      uCocMax: { value: P.cocMax },
      uSkip: { value: P.skipPx },
      uFarCoc: { value: new THREE.Vector3(P.farPx, P.farA, P.farB) },

      uBloom: { value: P.bloomGain },
      uVignette: { value: P.vignette },
      uAberration: { value: P.aberration },

      uGrade: { value: P.gradeAmount },
      uShadowTint: { value: new THREE.Vector3(...P.shadowTint) },
      uHighTint: { value: new THREE.Vector3(...P.highTint) },
      uSplitPivot: { value: P.splitPivot },
      uVibrance: { value: P.vibrance },
      uLift: { value: new THREE.Vector2(P.shadowLift, P.shadowLiftKnee) },
      uLiftR: { value: P.shadowLiftRadius },
      uLiftMask: { value: new THREE.Vector2(...P.shadowLiftMask) },
      uContrast: { value: P.contrast },
      uContrastPivot: { value: P.contrastPivot },
      uToe: { value: new THREE.Vector2(P.toeTop, P.toeSlope) },
      uShoulder: { value: new THREE.Vector2(P.shoulderTop, P.shoulderSlope) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform sampler2D tShaft;
uniform float uShaft;
uniform vec2 uRes;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform float uExposure;

uniform float uCocScale;
uniform float uFocus;
uniform float uCocMax;
uniform float uSkip;
uniform vec3 uFarCoc;

uniform float uBloom;
uniform float uVignette;
uniform float uAberration;

uniform float uGrade;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uSplitPivot;
uniform float uVibrance;
uniform float uContrast;
uniform float uContrastPivot;
uniform vec2 uLift;
uniform float uLiftR;
uniform vec2 uLiftMask;
uniform vec2 uToe;
uniform vec2 uShoulder;

varying vec2 vUv;
${COMMON}

/* ── ACES, verbatim from three's tonemapping_pars_fragment ──────────────────
 *
 * Copied rather than included because this material has toneMapped false — it
 * has to, or three would run the curve a second time on the way to the canvas.
 * Copied rather than replaced with a different filmic curve because every
 * colour figure in CONTRACT.md was measured through *this* curve, and swapping
 * it would invalidate all of them at once for no stated gain. */
vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 IN = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602));
  color *= uExposure / 0.6;
  color = IN * color;
  color = rrtOdt(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d > 0.999995) return 1.0e9;        // sky: no near blur, and no far blur either
  float ndc = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

/* Circle of confusion in pixels at 900 lines. The thin-lens form, so the
   asymmetry between near and far is the real one: a foreground object at half
   the focus distance is far more out of focus than a background object at twice
   it, which is why a stopped-down landscape frame softens at your feet and
   nowhere else. */
float cocPx(vec2 uv) {
  float z = viewZ(uv);
  if (z > 1.0e8) return 0.0;
  float c = uCocScale * abs(z - uFocus) / max(z, 0.05);
  c += uFarCoc.x * smoothstep(uFarCoc.y, uFarCoc.z, z);
  return min(c, uCocMax);
}

void main() {
  vec2 rel = (vUv - 0.5) * vec2(uAspect, 1.0);
  float rN = length(rel) / length(vec2(uAspect, 1.0) * 0.5);

  vec3 c = sane(texture2D(tScene, vUv).rgb);

#if DOF_TAPS > 0
  float coc = cocPx(vUv);
  /* Below the skip a defocus is not a defocus, it is a resample. The branch is
     also what keeps the cost of this pass in the small part of the frame that
     is genuinely out of focus — everything past about two and a half metres
     takes the cheap path. */
  if (coc > uSkip) {
    vec3 acc = c;
    float wsum = 1.0;
    for (int i = 0; i < DOF_TAPS; i++) {
      float fi = float(i) + 0.5;
      float a = fi * 2.39996323;
      float rr = sqrt(fi / float(DOF_TAPS));
      vec2 off = vec2(cos(a), sin(a)) * (rr * coc) / uRes;
      /* Weight by the tap's own circle of confusion so a sharp foreground edge
         does not smear into a blurred background across the silhouette — the
         classic gather-DOF bleed, and the thing that makes cheap defocus look
         like a smudge filter rather than a lens. */
      float w = clamp(cocPx(vUv + off) / max(coc, 1e-3), 0.15, 1.0);
      acc += texture2D(tScene, vUv + off).rgb * w;
      wsum += w;
    }
    c = acc / wsum;
  }
#endif

  /* Lateral chromatic aberration, at the extreme edges only and under a pixel
     even there. A corrected wide-angle lens has essentially none in the middle
     two thirds of the frame and a little in the corners, and putting it
     anywhere else is the single fastest way to make a render look like a
     render with a filter on it. */
  float ab = uAberration * smoothstep(0.55, 1.0, rN);
  if (ab > 0.02) {
    vec2 dir = normalize(rel + 1e-6) / uRes * ab;
    c.r = texture2D(tScene, vUv + dir).r;
    c.b = texture2D(tScene, vUv - dir).b;
  }

  /* System 5's marched in-scatter, composited here because this chain now owns
     the frame that used to be theirs.
     Four things about it, all of them theirs and none guessable from the type.
     It is negative everywhere — shadowed air giving back in-scatter the fog
     chunk already granted it on the assumption that nothing shadows the air — so
     it darkens, and the beams are where it takes nothing. Its gain is already
     applied, so this adds at 1.0 rather than inventing a second unmeasured
     decision on top of a sweep they ran. It is half resolution and linear
     filtered, so a full-res UV is the right sampling and the upsample is
     smooth. And it must not go through sane(), which would fold every sample to
     zero; see finite() above.
     Before the tone curve, because it is radiance and not a look. Before the
     vignette too: a lens loses the light in a shaft along with everything else.
     The max() is a guard and not a decision — a correction bounded by what the
     fog granted cannot drive radiance below zero, so if this ever fires the
     premise is wrong and the frame should be measured rather than patched. */
  if (uShaft > 0.0) {
    c = max(c + finite(texture2D(tShaft, vUv).rgb) * uShaft, vec3(0.0));
  }

#if USE_BLOOM
  /* Read off the pre-shaft buffer, and that is a deliberate approximation rather
     than an oversight. Making the bright pass see the correction would mean
     compositing it into sceneRT in a full-res pass of its own; the correction
     tops out at 0.076 of linear radiance against a bright threshold of 0.55, so
     the only pixels whose contribution it could change are those within a
     twelfth of the knee, where the weight is near zero anyway. */
  c += sane(texture2D(tBloom, vUv).rgb) * uBloom;
#endif

  /* Vignette, applied in linear radiance because that is what it is: light the
     barrel did not deliver to the corner. Applying it after the tone curve
     would darken the corner without the highlight rolloff that a real light
     loss produces. */
  c *= 1.0 - uVignette * smoothstep(0.30, 1.06, rN);

  /* ── grade, before the curve ──────────────────────────────────────────── */
  if (uGrade > 0.0) {
    float l = luma(c);
    /* A ratio rather than a smoothstep on an absolute level: the split has to
       sit at the same place in the *tonal* range whatever the exposure, and
       lighting upstream is still moving. */
    float t = l / (l + uSplitPivot);
    vec3 tint = mix(uShadowTint, uHighTint, t);
    c *= mix(vec3(1.0), tint, uGrade);
  }

  /* The shadow lift, in scene-linear, immediately before the curve. Placed
     after the split tone so the tone's pivot still classifies pixels by their
     original luminance and its measured effect on shaded rock is unchanged, and
     before ACES because that is the compression being answered. Identically 1.0
     at and above the knee, so nothing in the measured middle can move. */
#if USE_LIFT
  if (uGrade > 0.0 && uLift.x > 1.0) {
    float ly = max(luma(c), 0.0);
    float wl = max(0.0, 1.0 - ly / uLift.y);
    /* The second key, and the one that makes this affordable. Keyed on luminance
       alone the term is dead on arrival: the facet at 0.0092 scene-linear and the
       shaded floor at 0.0221 are 1.27 stops apart, and the gate is a mean over a
       shaded window, so anything that reaches the facet drags the window with it.
       The two populations do differ, just not in level — a clast side face is a
       *small* dark region surrounded by blazing ground, and the shaded wall is a
       large uniform one. So compare against the local maximum: on a facet one tap
       lands on lit ground and the mask opens, and in the middle of a big shadow no
       tap does at any radius, however dark it is.
       Maximum rather than a mean because it is what survives a low tap count —
       eight taps against the max reproduce a 24px gaussian's answer here to within
       two code values, which is what lets this live in an existing pass instead of
       costing a blur chain. On sqrt of linear luminance because that is one
       instruction and the thresholds were swept in the same space. */
    float s0 = sqrt(ly);
    float mx = s0;
    for (int i = 0; i < 8; i++) {
      float fi = float(i) + 0.5;
      float a = fi * 2.39996323;
      float rr = uLiftR * sqrt(fi / 8.0);
      vec2 off = vec2(cos(a), sin(a)) * rr / uRes;
      mx = max(mx, sqrt(max(luma(sane(texture2D(tScene, vUv + off).rgb)), 0.0)));
    }
    float mask = smoothstep(uLiftMask.x, uLiftMask.y, mx - s0);
    c *= 1.0 + (uLift.x - 1.0) * wl * wl * mask * uGrade;
  }
#endif

  vec3 o = aces(c);

  /* ── grade, after the curve ───────────────────────────────────────────── */
  if (uGrade > 0.0) {
    /* Vibrance, not saturation. Gated hard off above saturation 0.60 so that
       it cannot reach lit rock, which measures 0.62 and is the one colour in
       this scene that is independently verified against real photographs. What
       it does reach is the sky, the haze and the shaded ground, which is where
       a warm-hour frame wants its colour separation. */
    float mx = max(o.r, max(o.g, o.b)), mn = min(o.r, min(o.g, o.b));
    float sat = (mx - mn) / max(mx, 1e-4);
    float g = uVibrance * (1.0 - smoothstep(0.25, 0.60, sat)) * uGrade;
    float ly = luma(o);
    o = mix(vec3(ly), o, 1.0 + g);

  }

  /* The sRGB encode, written out rather than left to three's
     "#include <colorspace_fragment>", and not by preference.
     Three resolves that include at program-compile time from the render target
     it is compiling for, and for any target that is not the canvas it emits
     LinearTransferOETF, which is a no-op. This pass now writes into a float
     target so the silhouette resolve below can read its neighbours in display
     space, and had the include stayed it would have silently stopped encoding —
     leaving the contrast and toe below, which are specified on encoded
     luminance, operating on linear radiance instead. The expression is three's
     sRGBTransferOETF verbatim, 0.41666 and all, because the grade at zero being
     bit-identical to #nopost is a property this file is measured on and an
     honest 1.0/2.4 would break it in the last digit. */
  gl_FragColor = vec4(mix(pow(o, vec3(0.41666)) * 1.055 - vec3(0.055), o * 12.92,
                          vec3(lessThanEqual(o, vec3(0.0031308)))), 1.0);

  /* Contrast and the shadow toe: one transfer curve on encoded luminance.
     Two things about it were corrections that were measured rather than reasoned.
     Luminance alone, because a uniform scale of all three channels leaves HSV
     saturation and hue exactly where they were, and the per-channel version of
     this term moved lit rock's saturation by 0.086 — four times the whole rest
     of the grade.
     Worth being explicit that this covers the toe below as well, because the toe
     was once suspected of a 0.07 saturation excursion on lit rock and the shape
     of the curve is irrelevant to the question. Whatever te comes out of it, the
     pixel is multiplied by te/le, and HSV saturation is (max-min)/max and hue is
     an angle between differences — both invariant under a positive scalar. The
     only way this term can touch either is the clamp at 1.0, which pulls channels
     together and therefore lowers saturation. Measured on a frozen pair across
     all eight viewpoints, graded saturation came out equal to or below the
     ungraded control in every one, and on lit rock the difference was 0.001 at
     0.2 degrees of hue. A saturation *rise* cannot come from here.
     After the encode, because a pivoted contrast in *linear* light is far more
     aggressive in the shadows than it looks: at a pivot of 0.18 and a gain of
     1.03 a shadow sitting at 0.02 linear comes out 24% darker, and the measured
     symptom was wall_lit midwall dropping from L 0.143 to 0.113 for a term
     that is supposed to be imperceptible. In the encoded domain, which is where
     a photographer's contrast slider lives, the same gain moves that shadow by
     7%.
     And the third: a pivoted gain has a negative offset in it and therefore a
     black point, which was clipping 2.2% of the shaded wall face to zero. The
     Hermite below toeTop removes that. See POST_DEFAULTS for the measurement
     and for the rule about where the knee belongs.
     At uGrade 0 every coefficient collapses to the identity — k is 1, vA is A,
     the toe slope is 1, and the Hermite reduces to A*u, which is e. So the
     chain remains provably a no-op against #nopost on every contract figure. */
  if (uGrade > 0.0) {
    float k = mix(1.0, uContrast, uGrade);
    float p = uContrastPivot;
    float A = uToe.x;
    float B = uShoulder.x;
    float le = luma(gl_FragColor.rgb);
    float te;
    if (B > 0.0 && le > B) {
      /* The shoulder, which is the toe's mirror and exists for the same reason:
         a pivoted gain does not only lift the top of the range, it lifts part of
         it past one, and the clamp that catches it is a hard clip. At k 1.03 and
         p 0.5 the line crosses one at 0.9854 encoded, so everything from 251 code
         values up flattened to white — measured on lit rock as 0.31% of the window
         at 250+ against 0.04% ungraded, and 0.02% at 254+ against 0.00%.
         So above shoulderTop the line is replaced by a Hermite that matches its
         value and slope there and lands on exactly (1, 1) with slope
         shoulderSlope. One is reachable only from one, so nothing below white
         can be clipped to white, which is the same guarantee the toe gives at the
         other end, and this time it holds after rounding too: the curve is below
         the line everywhere above the knee, so it cannot round up to 255 where the
         line would not have.
         Placed at 0.86 encoded, which is 219 code values, deliberately far above
         anything the measured windows contain — lit rock's mean max channel is 170
         — so it cannot move a contract figure even in principle. And luminance
         only, so like every other term in this curve it is a scalar multiply and
         leaves HSV saturation and hue exactly where they were. */
      float s1 = mix(1.0, uShoulder.y, uGrade);
      float vB = (B - p) * k + p;
      float h = 1.0 - B;
      float u = (le - B) / h, u2 = u * u, u3 = u2 * u;
      te = vB * (2.0 * u3 - 3.0 * u2 + 1.0)
         + h * k  * (u3 - 2.0 * u2 + u)
         +           (-2.0 * u3 + 3.0 * u2)
         + h * s1 * (u3 - u2);
    } else if (le >= A || A <= 0.0) {
      te = clamp((le - p) * k + p, 0.0, 1.0);
    } else {
      float s0 = mix(1.0, uToe.y, uGrade);
      float vA = (A - p) * k + p;
      float u = le / A, u2 = u * u, u3 = u2 * u;
      te = max(0.0, A * s0 * (u3 - 2.0 * u2 + u)
                  + vA * (-2.0 * u3 + 3.0 * u2)
                  + A * k  * (u3 - u2));
    }
    gl_FragColor.rgb = clamp(gl_FragColor.rgb * (le > 1e-4 ? te / le : 1.0), 0.0, 1.0);
  }

}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── the silhouette resolve, and the grain ─────────────────────────────────
   *
   * The last pass, and the only one that reads the frame in display space.
   *
   * Why it is a pass of its own rather than more arithmetic in the one above:
   * the blend has to average *encoded* neighbours, and a fragment shader cannot
   * see its neighbours' output. The alternative was to tone-map three or four
   * extra taps inline, which means factoring the grade and the toe into a
   * function and re-verifying every contract figure against the refactor. This
   * way the arithmetic here is the same arithmetic that tools/_p7edge.mjs
   * simulated on an actual PNG, so the 114 -> 78 figure is a prediction of this
   * shader rather than an analogy for it.
   *
   * See POST_DEFAULTS for what the terms are and why the gate is where it is.
   */
  const resolveMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uEdge: { value: P.edgeAmount },
      uGate: { value: new THREE.Vector2(P.edgeLo, P.edgeHi) },

      tGrain: { value: plate },
      uGrain: { value: P.grain },
      uGrainOff: { value: new THREE.Vector2() },
      uGrainPx: { value: 256 },
      uGrainSwz: { value: 0 },
      uDither: { value: P.dither / 255 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uEdge;
uniform vec2 uGate;

uniform sampler2D tGrain;
uniform float uGrain;
uniform vec2 uGrainOff;
uniform float uGrainPx;
uniform float uGrainSwz;
uniform float uDither;

varying vec2 vUv;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/* Interleaved gradient noise, and it is here instead of a hash because being
   uncorrelated is not the same as being evenly spread.

   White noise is uniform in space only on average, so some neighbourhoods happen
   to round the same way several times over, and on a shallow ramp that is a
   surviving contour. Measured on a synthetic ramp at the sky's own gradient, a
   1 LSB triangular hash left runs of 21 code values at one level and a 40-row
   ramp left 29 — against a 14-row ramp's 14 undithered, so on the shallow case
   white noise barely helps. This distributes its values evenly over every small
   neighbourhood instead, which is what forces a level change within two or three
   pixels rather than eventually: same ramp, worst run 3, and for *less* noise
   than the triangular hash it replaces.

   Deterministic, being a closed form in pixel coordinates alone: nothing to seed
   and nothing to advance, so it cannot crawl and two captures of one viewpoint
   are identical. The constants are Jimenez's and the fract chain is exact in
   float32 to about 2K lines; past 4K the inner product loses enough mantissa to
   band on its own, which is worth knowing before this ships at that size. */
float ign(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(c, 1.0);

  if (uEdge > 0.0) {
    /* Four taps for the gate and the gradient. Cheap, and they are the only
       unconditional cost this pass adds over a blit. */
    float lc = lum(c);
    float lw = lum(texture2D(tSrc, vUv - vec2(uTexel.x, 0.0)).rgb);
    float le = lum(texture2D(tSrc, vUv + vec2(uTexel.x, 0.0)).rgb);
    float ln = lum(texture2D(tSrc, vUv - vec2(0.0, uTexel.y)).rgb);
    float ls = lum(texture2D(tSrc, vUv + vec2(0.0, uTexel.y)).rgb);

    float mx = max(lc, max(max(lw, le), max(ln, ls)));
    float mn = min(lc, min(min(lw, le), min(ln, ls)));
    float w = smoothstep(uGate.x, uGate.y, mx - mn) * uEdge;

    if (w > 0.002) {
      /* Along the edge, which is perpendicular to the luminance gradient, and
         snapped to whichever axis that is nearer so the two taps land on texel
         centres. A bilinear tap between centres would blur across the edge as
         well as along it, which is the thing this must not do. */
      vec2 g = vec2(le - lw, ls - ln);
      vec2 dir = (abs(g.y) > abs(g.x) ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y));
      vec3 a = texture2D(tSrc, vUv + dir).rgb;
      vec3 b = texture2D(tSrc, vUv - dir).rgb;
      gl_FragColor.rgb = mix(c, 0.5 * (a + b), w);
    }
  }

  /* ── grain, after the encode and after the resolve ────────────────────────
   *
   * Deliberately the last thing that happens, and deliberately in encoded
   * units. Grain is a density fluctuation, so it belongs in a perceptual space
   * rather than in radiance — and there is a second job it is doing here. A
   * critic measured the sky quantising at about one code value every eight
   * rows: a smooth gradient crossing an 8-bit step. An amplitude of a code
   * value or two is exactly the dither that breaks that up, and it has to be
   * applied after the quantising transform to do it.
   *
   * After the resolve, not before, and that ordering is load-bearing in two
   * directions: a blend along the edge would average the grain and halve its
   * amplitude exactly where the eye is most likely to look, and the gate above
   * reads a local luminance range, which grain would raise everywhere by its own
   * peak-to-peak and so widen the gate into surfaces it must not touch.
   *
   * Heavier in the shadows, which is backwards for real film — silver grain
   * peaks in the midtones — but right for what a viewer reads as grain, and
   * right for the dither, because the shadows are where the encoded steps are
   * furthest apart in light.
   */
  /* uGrainPx is 256 at 900 lines and larger above it, so a grain kernel stays the
     same size relative to the *frame* rather than to the pixel. Film grain is a
     property of the stock, so it does not get finer because the scan did: left
     unscaled, the plate would tile 1.6 times more often across a 1440-line frame
     and the grain would read as a different, finer stock at the resolution this
     actually ships at. Errs toward invisible either way, which is why it went
     unnoticed, but it is still a term whose look depended on the capture size. */
  vec3 n = texture2D(tGrain, (gl_FragCoord.xy + uGrainOff) / uGrainPx).rgb - 0.5;
  /* Rotating which channel carries the luminance component decorrelates
     successive frames on top of the offset, so a walk does not show the plate
     sliding across the frame as a texture. */
  float mono = uGrainSwz < 0.5 ? n.r : (uGrainSwz < 1.5 ? n.g : n.b);
  vec3 gn = mix(vec3(mono), n, 0.28);
  float ly2 = lum(gl_FragColor.rgb);
  gl_FragColor.rgb += gn * (uGrain * (0.45 + 0.55 * (1.0 - ly2)));

  /* ── dither, which is not the same thing as the grain ─────────────────────
   *
   * The grain was carrying the dither and a critique found that it cannot. The
   * reasoning that put it there was about amplitude: 0.44 code values rms
   * against a quantisation step of 1.0, therefore under the step, therefore
   * enough. Amplitude is the wrong axis. What dither has to do is decorrelate
   * one pixel's rounding error from its neighbour's, and the grain plate is
   * *smoothed* value noise — that smoothing is exactly what stops it reading as
   * digital noise on a surface, and it also means neighbouring pixels get almost
   * the same offset, so a smooth ramp still crosses a code boundary in one
   * place and the contour survives. Measured down a sky column: runs of 13 to 17
   * pixels at one code value in sun_gap and wash_mid, with and without the
   * grain.
   *
   * So the two terms are separated, because they have opposite requirements.
   * Grain has to stay invisible on a surface, which forces it low-frequency and
   * small. Dither only has to break a contour, and for that it wants to be pure
   * white noise at the Nyquist limit, where the eye's contrast sensitivity is at
   * its floor and a per-pixel offset of one code value cannot be resolved as
   * anything at all.
   *
   * The distribution matters more than the amplitude, which took one wasted
   * measurement to establish. A triangular hash at 1 LSB is the textbook answer
   * and it is the textbook answer to a different question — decorrelating the
   * *error*, which it does. What a smooth sky needs is a level change every few
   * pixels, and white noise only delivers that on average: it took flat pairs
   * down a sky column from 92% to 51%, which is the theoretical figure and still
   * left runs of 14. Interleaved gradient noise spreads evenly over small
   * neighbourhoods, so at 1.5 code values peak it costs 0.43 cv rms — less than a
   * triangular hash at the same peak — and takes the worst run to 3.
   *
   * A pure function of pixel position, so it is deterministic by construction,
   * which is what the capture pipeline needs, and it cannot crawl because there
   * is nothing in it that advances. It is one line inside a pass that already
   * runs, so there is no tier rung on which removing it buys anything.
   *
   * Applied last, after the encode and after the grain, because dither has to
   * be the final thing before the quantiser it is dithering. Anything that
   * filters the image afterwards — the along-edge blend above, in particular —
   * would average adjacent samples and undo the independence that is the whole
   * point. */
  gl_FragColor.rgb += vec3((ign(gl_FragCoord.xy) - 0.5) * uDither);
}`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  /* ── plumbing ──────────────────────────────────────────────────────────── */

  const quadScene = new THREE.Scene();
  const quad = fullscreenMesh(brightMat);
  quadScene.add(quad);
  const quadCam = new THREE.Camera();

  function draw(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  /* The redirect. See the file header: three decides to run the tone map and
     the sRGB encode from whether the current target is null, so pointing
     System 5's blit at a float target is what makes it hand over linear
     radiance. Scoped to exactly one call and restored immediately, because a
     renderer with a permanently patched setRenderTarget is a trap for every
     other system in the tree. */
  const realSetRT = renderer.setRenderTarget.bind(renderer);
  function compositeInto(scn, cam, target) {
    renderer.setRenderTarget = (t, a, l) => realSetRT(t === null ? target : t, a, l);
    let did = false;
    try {
      did = atmo.composite(scn, cam);
    } finally {
      renderer.setRenderTarget = realSetRT;
    }
    return did;
  }

  const _v3 = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const sunDir = new THREE.Vector3()
    .subVectors(sun.position, sun.target.position).normalize();

  const lastInfo = { calls: 0, triangles: 0 };
  let haveSceneInfo = false;
  /* Which branch drew the scene last frame. Starts true so that if this chain
     turns out to own the scene draw, the very first frame is already sampled —
     guessing the other way would cost the first capture its edges, and guessing
     this way costs one reallocation. */
  let ownDraw = true;
  /* Where the flare thinks the sun is, read off `_post._diag` and shown on F3.
     "Is the flare doing anything" is otherwise unanswerable from a PNG in which
     the sun is behind a butte — and it is behind a butte in most of the
     standard set, which is the scene working as designed rather than the effect
     failing. That is changing: System 4 is clearing the disc into the gap, at
     which point this is how to confirm the flare is anchored to it. */
  const lastSun = { x: 0.5, y: 0.5, on: 0, facing: 0 };

  /* ── grain clock ───────────────────────────────────────────────────────── */

  /* Frozen means "the harness put us here", exactly as in atmosphere.js. Two
     walkTo(46) calls must give the same pixels, and the harness waits 400 ms
     between placing the camera and reading the buffer — so a phase that kept
     advancing through that wait would put a different grain realisation in
     every capture. A human never calls walkTo, and their first step clears it.

     Twenty-four steps a second when it is running, rather than one per frame:
     at 200 fps a fresh realisation every frame is a fizz, not grain. */
  let grainPhase = 0, grainAcc = 0, frozen = false;

  function applyGrainPhase() {
    const p = grainPhase | 0;
    /* A cheap integer hash into the plate, so successive phases land in
       uncorrelated places rather than sliding. */
    let s = Math.imul(p ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    const ox = s % 251;
    s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
    const oy = s % 241;
    resolveMat.uniforms.uGrainOff.value.set(ox, oy);
    resolveMat.uniforms.uGrainSwz.value = p % 3;
  }
  applyGrainPhase();

  /* ── tier ──────────────────────────────────────────────────────────────── */

  let level = { dofTaps: 12, flare: 2, bloom: 4, edge: 1 };

  function setLevel(l) {
    const next = { dofTaps: 12, flare: 2, bloom: 4, edge: 1, lift: 1, ...(l || {}) };
    if (next.dofTaps === level.dofTaps && next.flare === level.flare &&
        next.bloom === level.bloom && next.edge === level.edge &&
        next.lift === level.lift) return;
    level = next;
    finalMat.defines.DOF_TAPS = level.dofTaps;
    finalMat.defines.USE_BLOOM = level.bloom > 0 ? 1 : 0;
    /* Eight full-resolution taps, which is the whole cost of the shadow lift and
       the only reason it is on the ladder at all. Compiled out rather than
       branched, and off entirely on potato: a tier that has already given up
       bloom, defocus and the flare is not the tier that pays to open shadows. */
    finalMat.defines.USE_LIFT = level.lift > 0 ? 1 : 0;
    finalMat.needsUpdate = true;
    flareMat.defines.FLARE_LEVEL = level.flare;
    flareMat.needsUpdate = true;
    /* The low-resolution chain is allocated at the divisor the tier asks for,
       and not allocated at all when the tier has no use for it. */
    if (sceneRT) allocate(W, H, level.bloom, SAMP);
  }

  /* ── the frame ─────────────────────────────────────────────────────────── */

  function render(scn, cam) {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    if (!w || !h) return false;

    if (disabled) {
      if (!atmo.composite(scn, cam)) {
        realSetRT(null);
        renderer.render(scn, cam);
        lastInfo.calls = renderer.info.render.calls;
        lastInfo.triangles = renderer.info.render.triangles;
        haveSceneInfo = true;
      } else haveSceneInfo = false;
      return true;
    }

    /* Multisampling follows the *branch*, and it has to be decided before the
       branch is taken, so it follows last frame's. Which path renders is a
       property of whether System 5's stage is enabled, and that changes at most
       once in a session — so a one-frame lag costs one reallocation at startup
       and nothing afterwards, and it is far cheaper than the alternative of
       carrying a 4x float target on the path that only blits into it. */
    allocate(w, h, level.bloom, ownDraw ? wantSamp : 0);

    /* 1. the scene, into scene-linear radiance. */
    haveSceneInfo = false;
    if (!compositeInto(scn, cam, sceneRT)) {
      realSetRT(sceneRT);
      renderer.render(scn, cam);
      lastInfo.calls = renderer.info.render.calls;
      lastInfo.triangles = renderer.info.render.triangles;
      haveSceneInfo = true;
    }
    ownDraw = haveSceneInfo;

    /* Depth: System 5's when its stage ran, otherwise this chain's own.
       `haveSceneInfo` is exactly the right test and not a proxy for one — it is
       true only on the branch above that drew the scene into sceneRT itself,
       which is the only branch on which sceneRT's depth holds this frame. The
       composite blit writes colour with depthWrite off, so on the normal path
       sceneRT's depth is whatever was last cleared and reading it would put a
       plane of defocus at the near clip. */
    const shim = atmo._shimmerMaterial;
    const depth = haveSceneInfo
      ? sceneRT.depthTexture
      : (shim ? shim.uniforms.tDepth.value : null);

    /* March System 5's in-scatter against this chain's depth, and take the
     * handover.
     *
     * Called unconditionally, including on the frame where there is nothing to
     * march against, because the call is what latches ownership on their side —
     * their `composite()` keeps drawing the scene into its own full-frame
     * RGBA16F until it has heard from a driver with a depth texture. Skipping the
     * call on the branch where their pass ran would mean it always ran, and the
     * handover would never happen: a deadlock in which each side waits for the
     * other to go first.
     *
     * Passing null on that branch rather than sceneRT's depth is the point.
     * `haveSceneInfo` is false exactly when their composite drew the scene, and
     * on that frame sceneRT's depth attachment holds whatever was last cleared —
     * so marching against it would produce a buffer of nonsense over a frame that
     * already has their own correctly marched shafts in it. Null is their
     * documented "nothing to add", it latches, and it costs no march. One frame at
     * startup, and from the next one this chain owns the scene draw and the depth
     * is its own. */
    let shaftTex = null;
    if (atmo.renderShafts) {
      shaftTex = atmo.renderShafts(haveSceneInfo ? sceneRT.depthTexture : null, cam);
    }

    const fu = finalMat.uniforms;
    fu.tScene.value = sceneRT.texture;
    fu.tDepth.value = depth;
    fu.tShaft.value = shaftTex || blackPx;
    /* Their gain, unmodified. See the composite in the shader. */
    fu.uShaft.value = shaftTex ? 1.0 : 0.0;
    fu.uRes.value.set(w, h);
    fu.uAspect.value = w / h;
    fu.uNear.value = cam.near;
    fu.uFar.value = cam.far;
    fu.uExposure.value = renderer.toneMappingExposure;
    /* The thin-lens constant, in pixels of the *rendered* buffer. Quoted at 900
       lines and scaled, so an 800x450 iteration shows the same optics as a
       1600x900 handoff rather than half of it. */
    const A = P.focal / P.fStop;
    fu.uCocScale.value = A * P.focal * h / (0.024 * Math.max(1e-4, P.focus - P.focal));
    fu.uCocMax.value = P.cocMax * (h / 900);
    fu.uSkip.value = P.skipPx * (h / 900);

    const wantDof = level.dofTaps > 0 && !!depth;
    if ((finalMat.defines.DOF_TAPS > 0) !== wantDof) {
      finalMat.defines.DOF_TAPS = wantDof ? level.dofTaps : 0;
      finalMat.needsUpdate = true;
    }

    /* 2-4. the low-resolution chain. */
    if (level.bloom > 0 && loA) {
      const lw = loA.width, lh = loA.height;
      brightMat.uniforms.tSrc.value = sceneRT.texture;
      /* One *full-resolution* texel. A quarter-scale destination texel centre
         lands on a source texel corner, so a tap one source texel away is also
         on a corner and bilinear returns the mean of a 2x2 block — four taps
         at (±1, ±1) therefore cover all sixteen source texels exactly. Getting
         this wrong samples four of the sixteen and makes the sun flicker in
         and out of the flare as the camera turns. */
      brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      brightMat.uniforms.uThresh.value = P.bloomThresh;
      brightMat.uniforms.uKnee.value = P.bloomKnee;
      brightMat.uniforms.uCeil.value.set(P.flareKnee, P.flareRange);
      draw(brightMat, loA);

      blurMat.uniforms.tSrc.value = loA.texture;
      blurMat.uniforms.uDir.value.set(1 / lw, 0);
      draw(blurMat, loB);
      blurMat.uniforms.tSrc.value = loB.texture;
      blurMat.uniforms.uDir.value.set(0, 1 / lh);
      draw(blurMat, loA);

      /* Where the sun is on screen. Behind the camera is the case that has to
         be handled explicitly: project() divides by w, so a point behind the
         eye comes back mirrored into the frame and would hang a flare off the
         wrong side. */
      cam.getWorldDirection(_fwd);
      const facing = _fwd.dot(sunDir);
      let on = 0, sx = 0.5, sy = 0.5;
      if (facing > 0.02) {
        _v3.copy(sunDir).multiplyScalar(1e5).add(cam.position).project(cam);
        sx = _v3.x * 0.5 + 0.5;
        sy = _v3.y * 0.5 + 0.5;
        /* A sun just outside the frame still puts light through the front
           element, so the gate reaches beyond the edge and fades rather than
           switching. Past a third of a frame out there is no path into the
           barrel worth drawing. */
        const ox = Math.max(0, Math.abs(sx - 0.5) - 0.5);
        const oy = Math.max(0, Math.abs(sy - 0.5) - 0.5);
        const out = Math.hypot(ox, oy) / 0.33;
        on = Math.max(0, 1 - out) * Math.min(1, (facing - 0.02) / 0.10);
      }
      lastSun.x = sx; lastSun.y = sy; lastSun.on = on; lastSun.facing = facing;
      const flu = flareMat.uniforms;
      flu.tBloom.value = loA.texture;
      flu.uTexel.value.set(1 / lw, 1 / lh);
      flu.uAspect.value = w / h;
      flu.uSun.value.set(sx, sy);
      flu.uSunOn.value = on;
      flu.uBase.value = P.bloomGain;
      flu.uGhost.value = P.ghostGain * P.flareScale;
      flu.uVeil.value = P.veilGain * P.flareScale;
      flu.uStreak.value = P.streakGain * P.flareScale;
      draw(flareMat, loB);

      fu.tBloom.value = loB.texture;
      fu.uBloom.value = 1.0;
    } else {
      fu.tBloom.value = null;
    }

    /* 5. out. */
    fu.uVignette.value = P.vignette;
    fu.uAberration.value = P.aberration * (h / 900);
    fu.uGrade.value = P.gradeAmount;
    fu.uShadowTint.value.set(...P.shadowTint);
    fu.uHighTint.value.set(...P.highTint);
    fu.uSplitPivot.value = P.splitPivot;
    fu.uVibrance.value = P.vibrance;
    fu.uLift.value.set(P.shadowLift, P.shadowLiftKnee);
    fu.uLiftMask.value.set(P.shadowLiftMask[0], P.shadowLiftMask[1]);
    fu.uContrast.value = P.contrast;
    fu.uContrastPivot.value = P.contrastPivot;
    fu.uToe.value.set(P.toeTop, P.toeSlope);
    fu.uShoulder.value.set(P.shoulderTop, P.shoulderSlope);
    fu.uFocus.value = P.focus;
    fu.uFarCoc.value.set(P.farPx * (h / 900), P.farA, P.farB);
    draw(finalMat, outRT);

    /* 6. the silhouette resolve, and the grain, in display space. */
    const ru = resolveMat.uniforms;
    ru.tSrc.value = outRT.texture;
    ru.uTexel.value.set(1 / w, 1 / h);
    /* Neither term is scaled by resolution, unlike every other pixel figure in
       this file, and that is deliberate rather than an omission. The artefact is
       one pixel of the rendered buffer wide by definition — it is the sampling
       grid — so a blend one texel along the edge is the right width at any
       resolution. The gate is a luminance range, which is unitless. */
    ru.uEdge.value = level.edge ? P.edgeAmount : 0.0;
    /* The silhouette gate is *not* scaled with resolution, and it was briefly
       scaled on an argument that measurement contradicted. The argument: the gate
       is a threshold on the luminance range across one pixel, the skyline carries
       about 150 code values across a pixel at 900 lines, so at 1440 the same step
       should spread over 1.6 pixels and a fixed threshold would stop firing.
       Measured on paired captures at both sizes, the ungraded median largest
       one-pixel jump across the skyline is 81.5 code values at 900 lines and 85.0
       at 1440 — unchanged, slightly up. A silhouette is a geometric edge and four
       coverage samples resolve it to about one pixel wherever it is drawn; more
       resolution buys more edge pixels, not a softer edge. Scaling the gate by 1.6
       therefore lifted it above the median edge and the resolve stopped firing
       there: the median improvement over the control fell from 23% to 10%, while
       the p90 kept most of its 42-47% because only the strongest edges still
       cleared the raised threshold.
       So the gate stays in absolute code values. The circle of confusion above
       does scale, and the difference is not inconsistency: defocus is an optical
       size in the image plane, which is a fixed fraction of the frame and so a
       varying number of pixels, whereas this is a contrast threshold on an edge
       that is one pixel wide at any size. */
    ru.uGate.value.set(P.edgeLo, P.edgeHi);
    /* The grain plate does scale, unlike the gate above. Grain is a property of
       the stock, not of the sampling: a 256-pixel tile on a 1440-line frame is a
       finer-looking grain than the same tile on a 900-line frame, and would read as
       a different film at the resolution this ships at. Exactly 1.0 at 900 lines,
       so no recorded figure moves. */
    ru.uGrainPx.value = 256 * (h / 900);
    ru.uGrain.value = P.grain;
    /* The shadow lift's tap radius scales for the same reason the grain plate
       does and the silhouette gate does not: it is a distance in the image plane,
       so the region it calls "the neighbourhood" has to stay the same fraction of
       the frame or the mask changes meaning with resolution. Exactly the tuned
       value at 1440 lines, which is what the swept table was measured at. */
    fu.uLiftR.value = P.shadowLiftRadius * (h / 1440);
    draw(resolveMat, null);
    return true;
  }

  return {
    render,
    params: P,
    setLevel,
    /* For tools/bench.mjs's ablation column, and for #nopost. Switching this
       off hands the frame back to System 5's blit exactly as it was before this
       system existed, which is what makes "what does the chain cost" a
       measurable question rather than an argued one. */
    setEnabled(b) { disabled = !b; },
    get level() { return { ...level }; },

    /* Multisampling for the scene draw, wired to the same tier rung that sets
     * System 5's, so the two cannot disagree.
     *
     * Worth stating plainly, because it cost two agents a contradiction: the
     * renderer is created with `antialias: false` and that is correct and should
     * stay. The flag only governs the *default framebuffer*, and nothing in this
     * scene draws to the default framebuffer — the scene lands in a float target
     * either way, because the grade needs linear radiance. So a probe that reads
     * the flag concludes there is no antialiasing, and a probe that reads the
     * draw call finds four samples, and both are looking at real things. The
     * observable that settles it is which framebuffer the *scene* draws bound,
     * which is what tools/_p7msaa.mjs reports and what _diag.targets now exposes.
     *
     * Applied here rather than assumed, so whichever branch owns the scene draw,
     * the frame is sampled. Zero is honoured, for a tier that would rather have
     * the bandwidth. */
    setSamples(n) {
      const s = Math.max(0, Math.min(8, n | 0));
      if (s === wantSamp) return;
      wantSamp = s;
      if (sceneRT && ownDraw) allocate(W, H, LODIV, s);
    },
    get samples() { return sceneRT && ownDraw ? sceneRT.samples : 0; },

    /* The scene depth, for System 5's marched in-scatter.
     *
     * Offered so its shimmer target can be retired: that buffer is RGBA16F with
     * four samples and its displacement is disabled, so what it is currently
     * spending the frame's largest bandwidth item on is a depth texture, which
     * this one already has. Null before the first frame and whenever the chain
     * is off, so a caller has to handle both — and it is only *written* on the
     * branch where this chain draws the scene itself, so a migration means the
     * scene draw moving here rather than just the read moving there. See
     * allocate() for the two things that have to come with it. */
    _sceneDepth() { return sceneRT ? sceneRT.depthTexture : null; },

    /** Advance the grain, on the same freeze rule the atmosphere uses. */
    update(dt, moving) {
      if (frozen && !moving) return;
      frozen = false;
      grainAcc += dt;
      const step = 1 / 24;
      if (grainAcc >= step) {
        grainPhase = (grainPhase + Math.floor(grainAcc / step)) | 0;
        grainAcc %= step;
        applyGrainPhase();
      }
    },

    /** Pin the grain to a pure function of the walk distance, and freeze it. */
    setWalk(d) {
      frozen = true;
      grainAcc = 0;
      grainPhase = Math.abs(Math.round((+d || 0) * 7)) % 9973;
      applyGrainPhase();
    },

    /** Scene-pass counts, for `info()` when System 5's stage did not run. */
    lastInfo() { return haveSceneInfo ? lastInfo : null; },

    _diag: {
      get targets() {
        return {
          scene: sceneRT ? [sceneRT.width, sceneRT.height] : null,
          low: loA ? [loA.width, loA.height] : null,
          level: { ...level },
          /* Reported because "is the frame antialiased" turned into two agents
             measuring different branches and getting opposite answers. samples
             is what this chain's own target carries; ownDraw is whether that
             target is the one the scene was drawn into, and without the second
             the first means nothing. */
          samples: sceneRT ? sceneRT.samples : null,
          ownDraw,
        };
      },
      /* The buffer the bright pass reads, for tools/hdrmax.mjs. Nothing in the
         running app touches this; it exists because the +Inf that produced the
         black rectangle could only be found by reading the linear values, and
         every route to them from outside this closure was worse — a dynamic
         `import('three')` inside an evaluate context hangs instead of throwing,
         and a probe-owned target would have missed System 5's composite. */
      get sceneRT() { return sceneRT; },
      get grain() { return { phase: grainPhase, frozen }; },
      get sun() { return { ...lastSun }; },
      sunDir: [sunDir.x, sunDir.y, sunDir.z],
    },
  };
}
