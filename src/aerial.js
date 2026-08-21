/* Sedona Sunset — System 5, part one: aerial perspective.
 *
 * What was here before was `scene.fog = FogExp2`, which is one veil: a single
 * grey mixed in as a function of *range only*. Two critiques have said the same
 * thing about it — that real canyon depth comes from discrete receding
 * ridgelines each a step lighter than the last, and that a flat wash of haze
 * reads as a flat wash of haze. The distance steps are already there: rock.js
 * placed the buttes at 550 / 800 / 1000 / 1450 m specifically so the haze would
 * pass them in stages. What was missing is the *second* axis.
 *
 * That axis is height. Aerosol is not uniformly mixed — it sits in a shallow
 * boundary layer a few hundred metres deep, and at evening, when the ground has
 * stopped convecting, that layer is at its most stratified. So a butte's foot is
 * seen through the full dust column and its cap is seen through a fraction of
 * it, and the same butte is two different distances' worth of haze from top to
 * bottom. That is what makes a ridgeline *end* against the paler one behind it
 * instead of dissolving into it, and it is the difference between layering and a
 * veil. It costs one exponential.
 *
 * The model, evaluated per fragment in the fog chunk:
 *
 *   two species — Rayleigh, wavelength-selective, effectively unstratified over
 *   a two-kilometre scene; and coarse desert dust, near-neutral in colour, in an
 *   exponential layer of scale height H. Both optical depths are the analytic
 *   integral of an exponential density along the actual camera-to-fragment ray,
 *   so a ray that climbs leaves the dust and a ray along the floor does not.
 *
 *   the airlight source is anchored on FOG from sky.js — the measured mean
 *   radiance of the first six degrees of sky, which is System 4's number and
 *   the right one — and *steered*: the dust's forward lobe warms and brightens
 *   it toward the sun and lets it fall cool and dark away from it. sky.js says
 *   plainly that a single constant cannot express a term that varies by two
 *   stops with azimuth and that the directionality is System 5's to add. This
 *   is that term.
 *
 * Deliberately *not* here: any noise. A previous haze attempt put procedural
 * cloud into the air and produced milky blobs floating over the midground with
 * no attachment to depth, which a critic called worse than the flat veil it
 * replaced. Everything in this file is a function of the ray, so every gradient
 * in the result is a depth gradient.
 *
 * And it does not destroy far-field detail. The whole model is `L * T + J`, an
 * affine transform of radiance with a per-pixel-slowly-varying coefficient, so
 * it scales the high- and low-frequency bands of a surface equally: `hf/lf` is
 * invariant under it. Haze is not an excuse for lost texture and cannot be
 * blamed for it either.
 *
 * Implementation note: this patches three's fog shader chunks in place, the same
 * technique sky.js uses for its shadow cascade, because every material in the
 * project reaches its fog through those chunks and none of them are mine to
 * edit. Everything the model needs beyond the ray is a compile-time constant —
 * the sun does not move in this scene — so it adds no uniforms and no per-frame
 * cost anywhere.
 */
import * as THREE from 'three';

/* ── the two species ───────────────────────────────────────────────────────
 *
 * Coefficients are quoted as multiples of `fogDensity`, so scene.fog stays the
 * one master knob it always was and whoever owns exposure later can still turn
 * the air up or down from main.js without coming in here.
 *
 * The Rayleigh triple is lambda^-4 at 615 / 535 / 465 nm normalised to blue.
 * The dust triple is close to neutral with a shallow slope — src/atmos.js makes
 * the same call for the same reason: coarse desert aerosol is large compared to
 * the wavelength and scatters nearly greyly. It is the *blue* excess in the
 * Rayleigh term that lifts and cools distant shadow, and the slight red excess
 * of transmission through dust that keeps a distant sunlit face warm rather
 * than letting it go the mauve that a neutral veil produces.
 */
/* ---- stratification, and where the air was actually wrong -------------------
 *
 * A critic put a contradiction to this file: a 1.76 km visual range and a blue
 * zenith cannot coexist, because that column would be featureless brown. The
 * recommendation was to cap the dust in a shallow layer with clean air above.
 *
 * Working it through located the fault somewhere else, and the arithmetic is
 * worth keeping because it is not where either of us first looked. The dust was
 * *already* stratified — H_DUST is 210 m, shallower than the few hundred metres
 * to 1.5 km suggested — and contributes only 0.26 of optical depth to a zenith
 * column. The term with no height dependence whatsoever is the Rayleigh one:
 * it was applied as `density * dist`, uniform to infinity, at 3.25e-4 per metre
 * against a physical sea-level value at 550 nm of 1.16e-5. Twenty-eight times
 * too thick and unstratified, it put 2.60 of the zenith's 2.86 optical depth
 * there by itself. So 91% of the brown column the critic predicted was one
 * coefficient, and the "clean air above" was missing for that reason rather than
 * for want of a cap on the dust.
 *
 * Cutting it to 0.05 leaves the zenith at 0.587 — 4.9x thinner — and costs
 * almost nothing in the horizontal, because over the 550 m the scene actually
 * contains, Rayleigh was never more than a tenth of the optical depth. It is not
 * taken all the way to physical: at 0.05 the term stands in for the fine-mode
 * aerosol that accompanies blowing dust, which genuinely carries a steep
 * spectral slope, and it is what makes distance away from the sun read blue-grey
 * rather than warm. Taking it to 0.011 would be true Rayleigh and would flatten
 * that. Named as the approximation it is.
 *
 * The dust gain then sets the visual range, and it was swept rather than picked.
 * tools/airsweep.mjs at four settings, measuring layers.mjs on the three views
 * the ladder is judged on, found a clear knee:
 *
 *     dust   range     sun_gap sat    juniper sat   wash_low sat
 *     0.40   4.98 km    1 step 33%     1 step 31%    1 step 24%
 *     0.56   3.56 km    2 steps 41%    1 step 35%    1 step 24%
 *     0.76   2.62 km    2 steps 42%    1 step 33%    2 steps 33%
 *     1.00   1.99 km    2 steps 43%    1 step 31%    1 step 19%
 *
 * The ladder recovers almost all of its strength by 3.56 km and is then flat:
 * thickening the air another 1.8x buys two points of edge share on the view it
 * is strongest in and nothing anywhere else. So the trade is not gradual, it has
 * a corner, and the corner is where to sit. 0.56 it is — 1.4x thinner than the
 * air a critic called the day after a haboob, with the ladder intact.
 *
 * ---- and then the geometry landed, which changed the answer ----------------
 *
 * That corner was real but it was a property of the *scene*, not of the air. Its
 * cause is stated above and it turned out to be the whole story: the deepest
 * sightline was 550 m, airlight share goes as 1 - exp(-beta*d), so the only way
 * to get separation between masses 550 m apart was to make beta large. System 2
 * then built receding ridgelines at 2.3, 3.4, 5.0 and 7.3 km. With a baseline an
 * order of magnitude longer, the same ladder is available at a tenth of the
 * extinction, and re-sweeping says so plainly — weighted edge share on sun_gap,
 * which is the statistic to read since the best-strip figure was retired:
 *
 *     dust   range      sun_gap sat / V   juniper sat / V   wash_low sat / V
 *     0.12   22.1 km       8% / 17%          9% / 25%          2% / 13%
 *     0.18   16.4 km       5% / 15%          8% / 21%          2% / 11%
 *     0.27   11.8 km       5% / 15%          9% / 22%          4% / 11%
 *     0.56    6.2 km       9% / 19%          8% / 20%          4% / 12%
 *
 * There is no corner anywhere in that range. Across 3.6x of extinction the ladder
 * moves by a few points in either direction, inside a within-frame spread of
 * 0-40%. The corner has been bought out by the baseline, exactly as predicted,
 * and extinction is now free to be whatever is physically honest because the
 * layering no longer depends on it.
 *
 * So: 0.15, about 19 km, mid-band in the 15-30 km asked for. Defensible as an
 * active blowing-dust evening rather than the annual mean, consistent with a
 * scene that has sand moving across the floor, and 5.8x thinner than the air a
 * critic called the day after a haboob.
 *
 * Note Rayleigh sets a floor on how clear this can get: it does not scale with
 * the dust dial, and at R_GAIN 0.05 it is 24% of the extinction at this setting.
 * Taking the dust to zero would still leave about 29 km. */
const BETA_R = [0.327, 0.570, 1.000];   // x fogDensity, per metre, at any height
const R_GAIN = 0.05;
const BETA_M = [1.000, 0.962, 0.905];   // x fogDensity, per metre, at y = Y0
const M_GAIN = 0.084;                   // 0.56 x 0.15, the swept dial, baked

/* What 15-30 km visual range would need from System 2, with the arithmetic, so
 * the request is checkable rather than a preference.
 *
 * Airlight share is 1 - e^(-beta*d), so thinning the air and keeping the ladder
 * requires d to grow by the same factor beta shrinks. At the current far mass of
 * about 550 m:
 *
 *     visual range   airlight share at 550 m   at 1450 m   at 4 km   at 8 km
 *     2.50 km (was)          0.62                 0.92      1.00      1.00
 *     4.98 km (now)          0.42                 0.76      0.98      1.00
 *     13.3 km                0.25                 0.52      0.87      0.98
 *
 * So 13-15 km is not a thin ladder, it is a ladder measured over the wrong
 * baseline: at 4-8 km it is stronger than anything the scene has now. Far ridges
 * at 2-8 km would let the extinction drop another 2.6x and *gain* contrast at
 * the back. Below that they merely fade. This is the whole of the disagreement
 * about extinction, and it is a geometry request, not an atmosphere dial.
 *
 * DELIVERED. System 2 built four curtains at 2.3, 3.4, 5.0 and 7.3 km, and the
 * prediction held: the ladder is now flat from 6 km to 22 km of visual range
 * instead of collapsing below 4 km, so extinction came down 5.8x to 19 km with
 * no measurable cost. Left in place as the record of a checkable request, since
 * the arithmetic above is what carried the argument. */
const GEOMETRY_NEEDED = 'delivered: far ridgelines at 2.3-7.3 km';

/* Scale height of the dust layer, metres, and the datum it is measured from.
 * 210 m is a settled evening boundary layer, and it is chosen against the
 * geometry: rock.js's buttes are 100 to 300 m tall, so a cap stands in air
 * holding about 60% of the dust its foot stands in and the same butte is two
 * distinct distances' worth of haze from top to bottom. Deeper than about 400 m
 * and the whole scene is inside one well-mixed slab again, which is the flat
 * veil with extra arithmetic. */
const H_DUST = 210;
const Y0 = 0;

/* A third species: the shallow suspension layer that the blowing sand feeds.
 *
 * Two defects turned out to be this one omission. A critic found the height law
 * did not manifest — on a distant ridge, saturation read 0.205 at the cap
 * against 0.216 at the foot, flat where a 210 m column should show the cap
 * clearer — and separately that the base of the far walls, backlit against the
 * gap, was crisp and dark where a real dusty wash shows a luminous warm band
 * hugging the floor. Both follow from the same arithmetic: over a 200 m wall,
 * a 210 m scale height varies by a factor of 1.1, which is no vertical
 * structure at all. The term was reaching the shader; it had nothing to say.
 *
 * What produces a visible band is the layer the saltation is throwing grains
 * into, which is metres to tens of metres deep, not hundreds. At 16 m a distant
 * wall's foot picks up a fifth again of optical depth while its cap picks up
 * four percent, so the height law becomes legible and the band appears exactly
 * where a backlit wash puts one.
 *
 * Measured from the same Y0 datum as the deep layer, which is the wash floor's
 * own elevation, so it hugs the floor and thins out over ground that stands
 * above it. That is right for this scene and would be wrong in a scene whose
 * ground was not roughly one plane; noted rather than hidden. */
const BETA_S = [1.000, 0.985, 0.955];
const S_GAIN = 0.35;
const H_SUSP = 16;

/* Airlight, as multiples of FOG's *luminance*.
 *
 * Not of FOG itself, and the difference is the whole colour of the far field.
 * FOG is the mean radiance of the low sky, which at this sun elevation is a
 * warm yellow — B/G of 0.70. Using it directly as the airlight colour, which
 * the first version of this file did, paints every distant butte that same
 * yellow and they come out olive: khaki masses receding into khaki. Real
 * distance does not do that. It splits by azimuth, because a distant surface is
 * seen through air that is lit by whatever is shining on that air.
 *
 * So the source functions are separated by species and by what illuminates
 * them. Rayleigh takes a neutral illumination and gets its blue from the
 * lambda^-4 weighting of its own optical depth, which is where the blue of
 * distance actually comes from — not from a blue-painted fog. The dust takes
 * skylight away from the sun and the beam toward it. The result is blue-grey
 * distance in the shaded half of the compass and warm cream distance up the
 * wash, off one lobe and no tinting by hand.
 *
 * The levels are low against FOG and that is deliberate, for a reason the tone
 * curve forces. ACES with three's 0.6 prescale puts linear 0.45 at display 0.88
 * and linear 0.27 at 0.79 — the whole far half of the range is compressed into
 * a tenth of the output. An airlight anchored at FOG itself lands every distant
 * mass on that shoulder, where a 20% radiance step between two ridgelines
 * survives as one code value and the result is a flat white wall no matter how
 * carefully the depths are modelled. Which is precisely the failure the layering
 * is meant to fix, arrived at from the other direction.
 *
 * There is a physical reading of the same numbers and it is not a coincidence:
 * the air in the first kilometre of a canyon at this sun elevation is largely
 * in the walls' shadow, so its source function is a fraction of the free-sky
 * airlight that FOG measures. RAY is Rayleigh's, near-isotropic and lit by the
 * whole dome; AMB and FWD are the dust's, and they run it from 0.145 to 0.445
 * of the sky's luminance across the azimuth. */
/* Measured, not derived. The first pass at these was computed from the model
 * and landed the far field five times too dark, because the analytic estimate
 * assumed a rock albedo and a lit-face radiance that the scene does not have —
 * System 4's exposure and the beam's actual cosine at these faces put the far
 * buttes far lower than the arithmetic said. Numbers here are set from
 * tools/layers.mjs on b1_sun_gap, which reported the far ridge at V 0.38 and
 * B/G 1.01 — a cold grey silhouette where a mass a kilometre away at ten
 * degrees off a low sun should be a warm lift. Raising FWD against RAY moves
 * both: the forward lobe is the warm term and the Rayleigh term is the neutral
 * one whose only job is to make the *anti*-sun distance blue. */
const RAY = 0.16;
const AMB = 0.20;
const FWD = 0.78;

/* One knob on the whole far-field source, so the near-field column below can be
   introduced without moving the depth ladder that tools/layers.mjs measures.
   Splitting the source into a near and a far zone necessarily removes some of
   the airlight at every distance — about a fifth of a long ray's scattering
   happens within the first S_ILL metres — so the far source has to come up by
   the reciprocal of that to leave the far field where it was. Set by
   measurement, not derived: layers.mjs on sun_gap and juniper. */
const FAR_GAIN = 1.45;

/* How far the forward lobe's colour goes toward the raw beam hue.
 *
 * Was 0.62, on the argument that the aureole is multiply scattered and so
 * washes toward white. That argument is right about the *aureole* and wrong
 * about everything else the term feeds, and the cost was that the airlight
 * converged to milky white at the limit instead of amber, and that near-field
 * inscatter landed on red rock as grey. A critic put it exactly: the dust was
 * being lit by a white sun while the rock was lit by a red one, and both come
 * from the same light. At 1.0 the dust is lit by the beam that is actually in
 * the scene, hue and all. Note this changes only chroma: jSun is normalised to
 * unit luminance before the mix, so no level in the far field moves and the
 * value ladder is untouched. */
const SUN_MIX = 1.0;
/* Skylight tint for the dust away from the sun, against a neutral of 1. Barely
   cool — the anti-sun sky at golden hour is not blue, it is grey with the day
   going out of it, and overdoing this is how a desert evening turns into an
   overcast morning. */
const SKY_TINT = [0.95, 0.98, 1.06];

/* Two Henyey-Greenstein lobes. One narrow one is physically the truth for the
 * aureole and visually useless on its own: at g = 0.8 the warm boost lives
 * inside twenty degrees of the disc and the rest of the up-wash view gets
 * nothing. Real haze toward a low sun is bright across a wide swathe because
 * multiple scattering has spread the lobe, so the broad term carries most of
 * the weight and the narrow one puts a core in it. */
/* Weights moved from 0.74/0.26 toward the narrow term. The old pair was so
   broad that the lobe only fell from 1.00 to 0.61 over the first 26 degrees off
   the sun, which is flat enough that two ridges either side of the gap measured
   the same B/G and the frame commissioned for a sunbeam had no aureole in it.
   0.58/0.42 at g = 0.85 falls 1.00 -> 0.66 -> 0.48 over the same span. The
   broad term still carries most of the wide-angle far field, which is what the
   depth ladder is made of away from the sun. */
const G_BROAD = 0.35, W_BROAD = 0.58;
const G_NARROW = 0.85, W_NARROW = 0.42;

/* ---- the near-field column -------------------------------------------------
 *
 * The model above is a uniformly lit atmosphere: one source function per
 * direction, applied at every distance in proportion to optical depth. That is
 * correct for the far field and wrong close in, and the error was found the
 * hard way — as a rock colour regression attributed to lighting. At 46 m the
 * uniform model delivers about 7% of the pixel as inscatter, and because the
 * source was near-neutral (see SUN_MIX above) and BETA_R weights blue, what
 * landed on red rock was grey light concentrated in the channel red rock has
 * least of. Saturation being (max - min)/max, that desaturates it, and because
 * the lift is a fixed radiance it bit harder as surfaces darkened: shaded rock
 * lost 0.16 of saturation against lit rock's 0.06.
 *
 * The fix is not in the density. Inscatter goes as J*(1 - e^-Bd), which is very
 * nearly J*B*d at both 46 m and 550 m, so scaling B moves the near and far
 * fields together: halving it and restoring the far field with J buys 16% at
 * 46 m and costs 22% at the back. Worked twice, arithmetically, before writing
 * any of this.
 *
 * What does separate them is that the air is not uniformly lit. The camera
 * stands in a wash between banks with the sun eight degrees up; the air in the
 * first tens of metres is inside a corridor, lit only through the aperture
 * between the crests and by bounce off the walls, while the air out around the
 * distant buttes stands in the open beam under the whole dome. So the source
 * function ramps:
 *
 *     ill(s) = e^(-s/S) * near  +  (1 - e^(-s/S)) * far
 *
 * and the inscatter integral stays closed-form. With k = B/(B + 1/S), which is
 * distance-independent and is exactly the share of any ray's scattering that
 * happens inside the near zone:
 *
 *     Bnear = k * (1 - e^-(tau + d/S))
 *     Bfar  = (1 - e^-tau) - Bnear
 *
 * At 46 m that puts 87% of the (already reduced) inscatter under the near
 * source, and at 550 m only 30%, which is the separation the density could not
 * give. The far field loses about a fifth, restored by FAR_GAIN above.
 *
 * The near source is also the right colour for the first time. A corridor of
 * sunlit red sandstone bounces intensely warm light into the air at its foot,
 * and the aperture overhead is the warm low sky. Light of roughly the rock's
 * own hue does almost no damage to the rock's saturation, which is why real
 * canyons do not go grey at 40 m: adding 7% neutral to a rock at 0.686
 * saturation costs 0.046, and adding the same luminance warm costs 0.007. */
const S_ILL = 150;

/* Near-zone source level, in units of FOG's luminance. Set so the inscatter at
   46 m comes to about a third of what the uniform model delivered. */
const NEAR_LVL = 0.061;

/* Reflectance hue of the corridor walls, from CONTRACT's measured B/G band for
   golden-hour Sedona rock, mid-band. Not a free tint: it is what the near
   source is bouncing off. */
const WALL_ALBEDO = [1.0, 0.60, 0.37];
/* Share of the near zone's illumination that arrives off the walls rather than
   straight down through the aperture. */
const WALL_SHARE = 0.55;
/* The near air still forward-scatters whatever beam reaches it, so the near
   source is not isotropic either — without this the haze in front of you does
   not brighten when you turn into the sun. */
const NEAR_FWD = 0.9;

/* ---- the two extinction dials ----------------------------------------------
 *
 * AIR scales the two long-range species, Rayleigh and the 210 m dust. SUSP
 * scales the 16 m suspension layer. They are separate on purpose: the near-
 * ground band and the height law need the shallow layer, and the complaint that
 * the air reads like the day after a haboob is about the long sightlines. One
 * dial cannot serve both, and the first thing the sweep below asked was whether
 * they really do want different answers.
 *
 * Overridable from the URL — `#medium,air=0.25` — so a sweep is four page loads
 * inside one render-lock acquisition rather than four edit-and-rebuild rounds.
 * Absent a hash both are 1 and nothing changes, so this costs the shipped build
 * exactly one constant fold. */
function hashNum(key, dflt) {
  try {
    if (typeof location === 'undefined' || !location.hash) return dflt;
    const m = new RegExp(`(?:^|[#,&;])${key}=([0-9]*\\.?[0-9]+)`).exec(location.hash);
    return m ? Number(m[1]) : dflt;
  } catch (e) { return dflt; }
}
const AIR = hashNum('air', 1);
const SUSP = hashNum('susp', 1);
/* The dust gain on its own, separately from AIR.
 *
 * These have to be separable because the two changes they represent are not the
 * same kind of change. Cutting Rayleigh from 0.30 to 0.05 corrected an outright
 * error — an unstratified term at 28x its physical coefficient, carrying 91% of
 * a zenith column that should have been clear — and there is no version of this
 * scene where putting that back is right. The dust gain is a composition call
 * about how hazy a golden-hour evening should read, and it is the one that wants
 * sweeping. Rolling both into one dial would mean paying for the correction with
 * the composition or the other way round. */
const DUST = hashNum('dust', 1);

/** The three extinction coefficients as baked, after the dials. */
function betas() {
  return {
    R: BETA_R.map((x) => x * R_GAIN * AIR),
    M: BETA_M.map((x) => x * M_GAIN * AIR * DUST),
    S: BETA_S.map((x) => x * S_GAIN * SUSP),
  };
}

/* One source of truth for the volumetric march in atmosphere.js.
 *
 * The marched in-scatter and this fog chunk are two integrations of the same
 * medium — the march does it stepwise with a visibility term, the chunk does it
 * closed-form assuming V = 1 — so they have to agree on the medium or the shafts
 * will sit in air of a different density than the haze around them. Exported
 * rather than duplicated because the gains moved twice this round and a copy
 * would already be stale. Coefficients are multiples of fogDensity; the caller
 * multiplies by scene.fog.density. */
export function aerialCoeffs(sun, fogColor) {
  const B = betas();
  /* The source radiance matters as much as the coefficients, and getting it from
     anywhere else is how the march ends up on a different scale from the haze.
     The first version of the shaft pass used sun.intensity, which is the beam's
     irradiance and two orders larger than the airlight source: it added a
     quarter of the display range to the frame. jSun is what the chunk itself
     puts into the forward lobe, so a marched term built on it lands in the same
     units as the term it is correcting. */
  const s = sun && fogColor ? sources(sun, fogColor) : null;
  return {
    betaR: B.R, betaM: B.M, betaS: B.S,
    H: H_DUST, hSusp: H_SUSP, y0: Y0,
    gBroad: G_BROAD, wBroad: W_BROAD, gNarrow: G_NARROW, wNarrow: W_NARROW,
    jSun: s ? s.jSun : [1, 1, 1],
    jSky: s ? s.jSky : [1, 1, 1],
  };
}

function hg(g, c) {
  const g2 = g * g;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
}

const f = (x, d = 6) => {
  const s = (+x).toFixed(d);
  return s.includes('.') ? s : s + '.0';
};
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

/**
 * The source functions, derived once from the light and the fog colour.
 *
 * Shared by the shader patch and by the CPU mirror below so the two cannot
 * drift — System 4's builder drives the mirror to predict frame colour, and a
 * mirror that has fallen behind the shader is worse than no mirror.
 */
function sources(sun, fogColor) {
  const d = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
  const c = sun.color;
  const peak = Math.max(c.r, c.g, c.b) || 1;
  const tint = [c.r / peak, c.g / peak, c.b / peak];
  const fog = [fogColor.r, fogColor.g, fogColor.b];
  const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const L = lum(fog);
  const tl = lum(tint) || 1;

  const jRay = [0, 1, 2].map(() => L * RAY * FAR_GAIN);
  const jSky = SKY_TINT.map((x) => L * x * FAR_GAIN);
  /* Unit-luminance beam hue, then mixed toward neutral by SUN_MIX. At
     SUN_MIX = 1 this is the beam's own chroma at the beam's own luminance
     share, which is what makes the limit amber rather than milky. */
  const jSun = tint.map((x) => L * (1 + (x / tl - 1) * SUN_MIX) * FAR_GAIN);

  /* The near zone's illuminant: bounce off sunlit walls, plus the low sky
     through the aperture. Normalised to unit luminance so NEAR_LVL is a level
     and this is purely a hue. */
  const wall = tint.map((x, i) => x * WALL_ALBEDO[i]);
  const wn = wall.map((x) => x / (lum(wall) || 1));
  const sn = fog.map((x) => x / (L || 1));
  const mix = wn.map((x, i) => WALL_SHARE * x + (1 - WALL_SHARE) * sn[i]);
  const mn = lum(mix) || 1;
  const jNear = mix.map((x) => L * NEAR_LVL * x / mn);

  return { d, tint, L, jRay, jSky, jSun, jNear };
}

let installed = false;

/** What the patch actually baked, so a probe can prove it is not all zeros. */
export const AERIAL_DIAG = { installed: false };

/**
 * Replace three's fog chunks with the airlight model.
 *
 * Must be called before the first render, since the chunks are pulled in at
 * shader compile time, and after the lights exist, since it bakes the beam
 * direction and colour. main.js does both.
 *
 * @param {THREE.DirectionalLight} sun   the beam; direction and hue are read off it
 * @param {THREE.Color} fogColor         scene.fog.color, in linear scene radiance
 */
export function installAerial(sun, fogColor) {
  if (installed) return;
  installed = true;

  const src = THREE.ShaderChunk.fog_fragment;
  if (!src || !src.includes('fogColor')) {
    console.warn('aerial.js: fog chunk signature changed; aerial perspective skipped');
    return;
  }

  /* Direction *to* the sun, in world space, read from the light rather than
     from a constant in sky.js — System 4 is still moving it and this way the
     air follows wherever it lands. */
  const { d, tint, L, jRay, jSky, jSun, jNear } = sources(sun, fogColor);

  /* Normalise each lobe to its own forward value, so the pair spans 0..1 and
     AMB/FWD are readable as "airlight at the anti-sun" and "extra at the sun"
     rather than as arbitrary gains against a per-steradian phase function. */
  const nB = 1 / hg(G_BROAD, 1), nN = 1 / hg(G_NARROW, 1);

  Object.assign(AERIAL_DIAG, {
    installed: true,
    sun: [d.x, d.y, d.z],
    tint, fogL: L, jRay, jSky, jSun, jNear,
    betaR: betas().R, betaM: betas().M, betaS: betas().S,
    H: H_DUST, hS: H_SUSP, sIll: S_ILL, farGain: FAR_GAIN,
    air: AIR, susp: SUSP, dust: DUST,
  });

  /* Published so a measurement can check what was actually baked rather than
     what it believes it asked for. This exists because the first extinction
     sweep silently produced four byte-identical frames — a fragment-only
     navigation does not re-run a module, so the dial never reached the shader
     and every setting measured the same build. Twelve frames of agreement
     looked like a robust ladder instead of a broken harness. A measurement that
     cannot detect its own no-op is worse than no measurement. */
  if (typeof window !== 'undefined') window.__AERIAL_DIAG = AERIAL_DIAG;

  const PARS = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogW;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

  const vec3  AER_SUN   = ${v3([d.x, d.y, d.z])};
  const vec3  AER_TINT  = ${v3(tint)};
  const vec3  AER_JRAY  = ${v3(jRay)};
  const vec3  AER_JSKY  = ${v3(jSky)};
  const vec3  AER_JSUN  = ${v3(jSun)};
  const vec3  AER_JNEAR = ${v3(jNear)};
  const vec3  AER_BETAR = ${v3(betas().R)};
  const vec3  AER_BETAM = ${v3(betas().M)};
  const vec3  AER_BETAS = ${v3(betas().S)};
  const float AER_H     = ${f(H_DUST, 2)};
  const float AER_HS    = ${f(H_SUSP, 2)};
  const float AER_Y0    = ${f(Y0, 2)};
  const float AER_AMB   = ${f(AMB)};
  const float AER_FWD   = ${f(FWD)};
  const float AER_SILL  = ${f(S_ILL, 2)};
  const float AER_NFWD  = ${f(NEAR_FWD)};

  float aerHG(float g, float c) {
    float g2 = g * g;
    return (1.0 - g2) / (12.56637061 * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5));
  }

  /* Path integral of exp(-(y - Y0)/H) from the camera to the fragment, in
     metres of equivalent sea-level path. Written as the ground-level path
     length times a shape factor so the small-|dy| limit is exact rather than
     a guarded division: (1 - e^-k)/k -> 1 - k/2 as k -> 0, and single
     precision loses the difference of the two exponentials long before the
     series does. */
  float aerColumn(float y0, float y1, float dist, float H) {
    float k = (y1 - y0) / H;
    float shape = abs(k) < 1e-3 ? 1.0 - 0.5 * k : (1.0 - exp(-k)) / k;
    return dist * exp(-(y0 - AER_Y0) / H) * shape;
  }

  vec3 aerialPerspective(vec3 color, vec3 world) {
    vec3 ray = world - cameraPosition;
    float dist = length(ray);
    if (dist < 1e-3) return color;
    vec3 dir = ray / dist;

    #ifdef FOG_EXP2
      float dens = fogDensity;
    #else
      float dens = 1.0 / max(1.0, fogFar - fogNear);
    #endif

    /* Rayleigh is 8 km deep against a 2 km scene, so its own stratification is
       under three percent across the frame and is not worth an exponential;
       the dust layer is the one that is shallow enough to see. */
    vec3 tauR = AER_BETAR * (dens * dist);
    vec3 tauM = AER_BETAM * (dens * aerColumn(cameraPosition.y, world.y, dist, AER_H))
              + AER_BETAS * (dens * aerColumn(cameraPosition.y, world.y, dist, AER_HS));
    vec3 tau = tauR + tauM;
    vec3 T = exp(-tau);

    float ca = dot(dir, AER_SUN);
    float lobe = ${f(W_BROAD)} * aerHG(${f(G_BROAD)}, ca) * ${f(nB)}
               + ${f(W_NARROW)} * aerHG(${f(G_NARROW)}, ca) * ${f(nN)};

    /* Rayleigh's phase is nearly flat and its airlight is overwhelmingly
       multiply-scattered, so it takes a neutral illumination; its colour
       arrives through the lambda^-4 weighting of tauR below. The dust carries
       all of the directionality, and its colour is the colour of whatever is
       lighting it — skylight behind you, the beam ahead. */
    vec3 jR = AER_JRAY;
    vec3 jM = AER_JSKY * AER_AMB + AER_JSUN * (AER_FWD * lobe);

    /* Weight the two source functions by the optical depth each species
       actually contributes in this channel: near the ground the dust wins and
       the air is warm, on a ray that climbs out of the layer the Rayleigh term
       is what is left and distant high rock goes blue. */
    vec3 J = (tauR * jR + tauM * jM) / max(tau, vec3(1e-6));

    /* Split the column by how well lit the air along it is. kN is the share of
       this ray's scattering that happens inside the first AER_SILL metres and
       is independent of distance; Bn is that share actually delivered to the
       eye after its own extinction. */
    float ds = dist / AER_SILL;
    vec3 kN = tau / (tau + vec3(ds));
    vec3 Bn = kN * (1.0 - exp(-(tau + vec3(ds))));
    vec3 Bf = max(vec3(0.0), (1.0 - T) - Bn);

    /* The near zone is lit by wall bounce and the aperture, and still forward-
       scatters whatever beam reaches it. */
    vec3 jN = AER_JNEAR * (1.0 + AER_NFWD * lobe);

    return color * T + jN * Bn + J * Bf;
  }
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = PARS;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = aerialPerspective( gl_FragColor.rgb, vFogW );
#endif`;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogW;
#endif`;

  /* World position without a second transform. mvPosition is the only point
     every material — instanced, skinned, morphed, displaced in a patch — agrees
     on, and the view matrix is rigid, so its inverse rotation is the transpose:
     `vec4(v, 0.0) * viewMatrix` is `Rt * v`, and the camera position closes it.
     Going back to `modelMatrix * transformed` instead would silently drop the
     instance matrix and put every pebble's haze at the origin. */
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogW = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
}

/** The model on the CPU, for tools and for sanity-checking the shader. */
export function aerialModel(sun, fogColor, density = 0.0019) {
  const { d, jRay, jSky, jSun, jNear } = sources(sun, fogColor);
  const nB = 1 / hg(G_BROAD, 1), nN = 1 / hg(G_NARROW, 1);
  const B = betas();
  return function apply(color, cam, world) {
    const rx = world[0] - cam[0], ry = world[1] - cam[1], rz = world[2] - cam[2];
    const dist = Math.hypot(rx, ry, rz);
    if (dist < 1e-3) return color.slice();
    const column = (H) => {
      const k = (world[1] - cam[1]) / H;
      const shape = Math.abs(k) < 1e-3 ? 1 - 0.5 * k : (1 - Math.exp(-k)) / k;
      return dist * Math.exp(-(cam[1] - Y0) / H) * shape;
    };
    const col = column(H_DUST), colS = column(H_SUSP);
    const ca = (rx * d.x + ry * d.y + rz * d.z) / dist;
    const lobe = W_BROAD * hg(G_BROAD, ca) * nB + W_NARROW * hg(G_NARROW, ca) * nN;
    const ds = dist / S_ILL;
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const tR = B.R[i] * density * dist;
      const tM = B.M[i] * density * col + B.S[i] * density * colS;
      const t = tR + tM, T = Math.exp(-t);
      const jM = jSky[i] * AMB + jSun[i] * FWD * lobe;
      const J = (tR * jRay[i] + tM * jM) / Math.max(1e-6, t);
      const Bn = (t / (t + ds)) * (1 - Math.exp(-(t + ds)));
      const Bf = Math.max(0, (1 - T) - Bn);
      out[i] = color[i] * T + jNear[i] * (1 + NEAR_FWD * lobe) * Bn + J * Bf;
    }
    return out;
  };
}
