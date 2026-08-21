/* Sedona Sunset — System 4a: the atmosphere, solved spectrally, once, at load.
 *
 * Everything the lighting rig needs is derived here from one model rather than
 * dialled in by eye, because dialling by eye is how this project got a key light
 * at 0.68 saturation and a frame that read as Mars. The inputs are a solar
 * elevation, a site altitude, an aerosol load and an ozone column. The outputs
 * are the direct beam's colour and irradiance, a radiance map of the whole sky,
 * the spherical-harmonic irradiance of that sky plus the ground bounce, and the
 * colour of the air itself. All of them come out of the same integral, so the
 * violet in the shadows is the violet that is actually overhead and the warm
 * light under an overhang is the wash floor that is actually there.
 *
 * Why spectral and not RGB. Transmittance is exponential in wavelength^-4, so
 * over the width of the blue channel it varies by a factor of three at this air
 * mass. Sampling each channel at one wavelength gets the sun's colour wrong by
 * a long way — three point samples put the beam at 4800 K where the spectral
 * integral puts it at 3700 K, and 1100 K of error in the key light is the whole
 * argument. Thirty-five samples at 10 nm and the CIE observer cost about a fifth
 * of a second at load and remove the question.
 *
 * Nothing in here imports anything else from the project, so it can be run
 * standalone under node — see tools/atmos.mjs, which prints every derived
 * quantity. A model that cannot be inspected outside the renderer is a model
 * that gets believed when it is wrong.
 */
import * as THREE from 'three';

/* ── the site and the hour ─────────────────────────────────────────────── */

/* Eleven degrees, and the floor is why.
   Two and a half was tried in the provisional rig and is much worse: the width
   of the band where N·L crosses zero scales with the sun's height, and below
   about five degrees that band is thinner than a pixel, so every gentle swell
   resolves into a razor-thin bright crest and a slope covered in them reads as
   scratched metal. That put a floor under this number and eight sat on it for
   several rounds.
   What nobody checked was whether the beam reached the ground. It did not.
   Thresholded against this model's own predicted floor levels, the wash floor
   was **1.5% sunlit** at eight degrees, and a capture with the shadow map
   switched off came back at 51% — so the beam was not being lost to a grazing
   cosine or eaten by shadow bias, it was being blocked outright by the buttes.
   tools/horizon.mjs marches the terrain along the sun's bearing and finds a
   skyline of four to fourteen degrees, so eight degrees was *inside* the
   silhouette: the whole wash was in shade, which is what took the ground's
   hf/lf down and left System 1's four rounds of granular structure unlit and
   unreadable.
   Eleven clears it. With the azimuth below, the floor measures 0.70 sunlit and
   L 0.346 — the provisional rig's floor read 0.333, so this is the first frame
   since that rig where the ground is lit at all. It costs nothing on the wall:
   grad/L on the mid wall goes 0.118 to 0.152, further *into* the 0.12-0.16 the
   reference photographs sit at, because a sun that clears the skyline rakes the
   face instead of grazing it below the terminator. Eleven degrees is still
   forty minutes of golden hour, and the shadow is five times the height of what
   casts it rather than seven.

   Eleven to fifteen, because the sunlit wall was below its own band and the only
   physical lever on it is where the sun is. The wall takes a cosine of
   -sin(azimuth + 7.5) on the beam, which is 0.026 here — the "sunlit" wall was
   grazed at 88 degrees of incidence, and no exposure fixes a surface with no light
   on it. That is also why the shadow-to-sunlit gate read 0.428 when this model's
   own prediction for a *sun-facing* vertical is 0.189: the gate's denominator was
   a wall that was barely lit, and the whole evening of dimming the fill was
   fighting a geometry problem.

   Measured, three views, azimuth held at -9 so nothing that depends on the sun's
   bearing moves:

       el    wall V   wall sat   hue    gate    floor L   floor grad/L
       11     0.563     0.666    13.6   0.343    0.137       0.192
       15     0.725     0.589    14.3   0.338    0.469       0.130

   Wall V enters its 0.59-0.73 band, floor grad/L enters the 0.12-0.16 band it was
   above, saturation comes down from over the top of the real-photograph range into
   it, hue moves toward its target, and the floor gets brighter rather than dimmer
   — this does not spend the lit floor to buy the wall, which was the constraint.

   The gate is the one thing elevation does not fix, and the reason is worth
   keeping: raising the sun lights the shaded face's surroundings too, so numerator
   and denominator rise together. Only azimuth separates them, because only azimuth
   changes the wall's cosine. Measured at el 11: azimuth -13 takes the gate to
   0.243, inside its band for the first time, and darkens the floor by 62 percent.
   That trade is not mine to make.

   The cost is shadow length: at fifteen degrees a shadow is 3.7 times the height
   of what casts it rather than 5.1. Still long, and still golden hour, but it is a
   brief-level property and it is recorded here as spent rather than free. */
export const SUN_EL_DEG = 15.0;
/* Off the corridor axis, and further than it looks like it should be.
   The provisional rig had this at +3.15 degrees. Two things are wrong with that
   and both were measured rather than reasoned about, because reasoning about it
   is what produced +3.15 in the first place.
   First the sign. A wall face points across the wash, so the sun has to be off
   to one side for either curtain to receive anything, and +3.15 put what little
   raking light there was on the *left* wall — which means the viewpoint named
   "wall_lit" was the darker of the two and "wall_shade" the brighter. That is
   visible in every capture back to sys1 and had been read as a shader problem
   for four rounds. Under the physical rig at +3.15 the wall_lit crop measured
   HSV value 0.088 against a reference range of 0.59 to 0.73, and no exposure
   fixes that, because there is no light on the surface to expose.
   Second the magnitude. The obvious formula for how much beam a wall running
   along the corridor receives is sin(azimuth), and it is wrong here, because the
   corridor does not run along -Z. tools/sunpos.mjs reads the camera matrices out
   of the running page: the wash's heading at d = 46 is -7.5 degrees, so the
   right-hand wall's inward normal bears -97.5 and the cosine on the beam is
   -sin(azimuth + 7.5). At -10.5 degrees that is 0.05, not the 0.18 the idealised
   formula promised — a factor of four, and the difference between a lit wall and
   a wall lit only by the sky.
   That correction argued for going a long way round, and -22 was tried on it.
   Measured, it is worse on everything, for a reason the arithmetic could not see:
   at -22 the beam meets this wall nearly frontally, the promontories stop
   shadowing each other, and the raking bands that are most of what makes a cliff
   read as rock go away. Measured on the lit population of the wall_lit crop:

       azimuth    hue    B/G     V     grad/L
        -10.5    18.8   0.62   0.56    0.121
        -13      21.5   0.58   0.70    0.134
        -22      13.3   0.80   0.32    0.069

   -13 wins on all four, and the one it wins by most is the surface-structure
   metric that CONTRACT.md says decides photorealism. So -13, and the brightness
   the idealised formula was chasing turns out to have been the wrong thing to
   chase: the wall takes only a 0.10 cosine here and the crop *average* is low,
   but the average is the wrong statistic for a surface that is half in its own
   shadow. The lit half sits at value 0.70 and hue +21.5, which is the population
   the reference band actually describes.

   ---- -9, once the floor was measured instead of the wall ----
   Every row of that table is a measurement of the *wall*, and the wall was the
   only thing being looked at. The floor was at 1.5% sunlit throughout, in all
   three columns, and none of them shows it. Re-run with the wash floor in the
   frame, at the elevation that clears the skyline:

       azimuth  elev   floor sunlit   wall sat   wall V   grad/L    hue
        -13       8        0.015        0.633     0.639    0.118   20.0
        -13      11        0.057        0.605     0.753    0.156   21.8
         -5       8        0.261        0.627     0.259    0.126     --
         -9      11        0.705        0.617     0.565    0.152   19.0

   The floor spans a factor of *forty-seven* across settings that move the wall
   by a fifth. It was always the sensitive axis and it was never measured. -9 and
   11 take the floor from unlit to lit while holding the wall inside every band
   it was already inside, and the structure metric goes up rather than down.
   -5 shows why azimuth alone will not do it: it lights the floor and takes the
   wall to value 0.259, which puts the project's own rock-colour gate in shade
   and unmeasurable. The elevation is what makes -9 affordable.

   ---- and what that costs, which is worth stating plainly ----
   The brief asks for the sun to sit in the gap straight up the wash. It cannot
   also light this wall. The gap's bearing in the sun_gap framing is +9
   degrees, because the wash heading there is +9 and the camera looks along it;
   the wall needs the sun at -8 or further. The two windows do not overlap and no
   azimuth satisfies both.
   The disc is behind the left crest at every azimuth in either window in any case.
   That was checked directly rather than assumed: three renders were spent
   hunting a missing sun disc, including one with the disc widened sixfold, and
   the answer is that at -10.5 the beam direction lands at frame position
   0.32, 0.46 in sun_gap and the pixels there are rock at rgb(34,23,23). The
   sun is occluded in all eight viewpoints. Since it is hidden either way, the
   azimuth is free to be chosen on the light alone — but making the disc visible
   is a real thing the composition is missing, and it needs the left wall's crest
   to drop or the wash's heading near d = 120 to change, neither of which is
   System 4's to touch. */
export const SUN_AZ_DEG = -9.0;

const DEG = Math.PI / 180;
export const SUN_EL = SUN_EL_DEG * DEG;
export const SUN_AZ = SUN_AZ_DEG * DEG;
/* yaw 0 is down -Z, so "up the wash toward the sun" is -Z. */
export const SUN_DIR = new THREE.Vector3(
  Math.sin(SUN_AZ) * Math.cos(SUN_EL),
  Math.sin(SUN_EL),
  -Math.cos(SUN_AZ) * Math.cos(SUN_EL)).normalize();

/* Sedona sits at 1,350 m, which matters: it takes fifteen percent of the
   Rayleigh column off the top and is a large part of why the light here is
   cleaner and less muddy than a sea-level sunset. */
const SITE_ALT = 1350;
/* Vertical aerosol optical depth at 550 nm, measured upward from the site.
   The Colorado Plateau at 1,350 m in clear spring air runs 0.025 to 0.04, and
   0.032 gives a tight bright aureole round the disc with the blue coming back
   above about twenty degrees. Below 0.02 the horizon glow disappears and the
   sky goes to a hard cyan; above 0.1 the distant buttes vanish into milk.

   Worth recording how this number was arrived at, because the first attempt was
   an instrument failure of exactly the kind CONTRACT.md warns about. The
   rendered sky was flat white at saturation 0.03 across the whole frame, the
   obvious suspect was too much aerosol, and 0.055 came down to 0.032 on that
   reasoning. It made almost no difference, which was the clue. Evaluating the
   model and the render at the *same view direction* — 141,161,181 against
   234,231,223 — showed they disagreed, so the aerosol was never the problem:
   sky.js was applying the scene scale to the Mie channel twice and running the
   aureole nineteen times too strong. Diagnose from a disagreement between two
   instruments before adjusting the thing they are both measuring. */
const AOD550 = 0.032;
/* Coarse desert dust is a shallow spectral slope. Fine urban haze would be 1.3. */
const ANGSTROM = 0.8;
/* Single-scattering albedo of the aerosol. Mineral dust absorbs a little. */
const MIE_ALBEDO = 0.90;
/* Henyey-Greenstein asymmetry. 0.76 is the standard continental value, and the
   claim that it "makes the aureole around the sun a few degrees wide" was the
   thing that turned out not to be true: a single HG lobe at 0.76 falls seven per
   cent between half a degree from the sun and four degrees from it, which is not
   an aureole but a tabletop three tens of degrees across. The rendered sky
   measured 241 cv at half a degree and 237 at four, with the disc sitting on it
   at 255 - four per cent of contrast, which is why the critique read the sun as a
   blemish on white paper rather than as a light source.
   One HG term cannot do this job, and the reason is physical rather than a matter
   of picking a better g. A real aerosol phase function has two features an order
   of magnitude apart in angle: a diffraction peak from particles large compared
   with the wavelength, concentrated within a couple of degrees of forward, and a
   broad refractive bulk spanning tens of degrees. HG is a one-parameter family
   and can be fitted to one or the other, never both. Raising g to chase the peak
   drags the bulk in with it and empties the rest of the sky; lowering it to hold
   the bulk flattens the peak into the tabletop above. src/aerial.js has carried
   two terms for airlight since it was written for exactly this reason - the dome
   was the one place still on a single lobe.
   So: a narrow lobe at 0.96 carrying a quarter of the weight, over a broad lobe
   dropped to 0.70 carrying the rest. Each HG term integrates to unity over the
   sphere, so splitting the weight redistributes the aerosol's scattered light in
   angle without creating or destroying any of it - which is the whole reason this
   is affordable. Measured in tools/_skydesign.mjs: the fall from half a degree to
   eight goes from 14 cv to 48, and the dome's contribution to a horizontal
   surface moves 0.08%, so the skylight fill and the shadow gate that depends on
   it do not move at all. */
export const MIE_G = 0.70;
export const MIE_G_NARROW = 0.96;
export const MIE_W_NARROW = 0.25;
/* Dobson units. 300 is the mid-latitude annual mean. Its Chappuis band is
   centred at 600 nm, so ozone takes a bite out of the *orange*, and it is the
   reason a clear zenith stays blue-violet at sunset instead of going grey. */
const OZONE_DU = 300;

const H_RAYLEIGH = 8000;
const H_MIE = 1200;
const R_GROUND = 6360e3 + SITE_ALT;
const ATMO_TOP = 60000;
const R_TOP = R_GROUND + ATMO_TOP;

/* Albedo of what is under the sky here: pale quartz sand and red oxide dirt,
   with the red cliffs standing in it. Measured off the project's own dirt and
   sand albedo maps rather than guessed — this is the number that decides how
   warm the light coming back up from below is, and the brief is explicit that
   the warm-from-below / cool-from-above split is a large part of golden hour. */
export const GROUND_ALBEDO = [0.335, 0.212, 0.140];

/* ── spectral grid and the CIE observer ────────────────────────────────── */

const L0 = 390, DLAM = 10, NLAM = 35;      // 390 … 730 nm
const LAM = new Float64Array(NLAM);
for (let i = 0; i < NLAM; i++) LAM[i] = L0 + i * DLAM;

/* Wyman, Sloan & Shirley (2013), "Simple analytic approximations to the CIE XYZ
   colour matching functions". Multi-lobe Gaussians, accurate to well under a
   percent of peak, and short enough to read. */
function gau(w, mu, s1, s2) { const t = (w - mu) * (w < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
const xBar = (w) => 0.362 * gau(w, 442.0, 0.0624, 0.0374)
  + 1.056 * gau(w, 599.8, 0.0264, 0.0323) - 0.065 * gau(w, 501.1, 0.0490, 0.0382);
const yBar = (w) => 0.821 * gau(w, 568.8, 0.0213, 0.0247) + 0.286 * gau(w, 530.9, 0.0613, 0.0322);
const zBar = (w) => 1.217 * gau(w, 437.0, 0.0845, 0.0278) + 0.681 * gau(w, 459.0, 0.0385, 0.0725);

const CX = new Float64Array(NLAM), CY = new Float64Array(NLAM), CZ = new Float64Array(NLAM);
let ySum = 0;
for (let i = 0; i < NLAM; i++) {
  CX[i] = xBar(LAM[i]); CY[i] = yBar(LAM[i]); CZ[i] = zBar(LAM[i]);
  ySum += CY[i];
}
/* Normalised so a spectrally flat radiance of 1.0 integrates to luminance 1.0.
   Keeps every number below in units a human can sanity-check. */
const KNORM = 1 / ySum;

/* XYZ (D65) → linear sRGB. */
function xyzToRGB(X, Y, Z, out) {
  out[0] = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  out[1] = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  out[2] = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return out;
}

/** Spectral radiance array (length NLAM) → linear sRGB triple. */
export function specToRGB(spec, out = [0, 0, 0]) {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < NLAM; i++) { const v = spec[i]; X += v * CX[i]; Y += v * CY[i]; Z += v * CZ[i]; }
  return xyzToRGB(X * KNORM, Y * KNORM, Z * KNORM, out);
}

/** Luminance of a spectral array, same normalisation. */
export function specLum(spec) {
  let Y = 0;
  for (let i = 0; i < NLAM; i++) Y += spec[i] * CY[i];
  return Y * KNORM;
}

/* ── the beam above the atmosphere ─────────────────────────────────────── */

/* Planck at 5,778 K. The real extraterrestrial spectrum has Fraunhofer lines and
   a UV deficit, but across 390–730 nm it is within a couple of percent of the
   blackbody and none of that survives the CIE integral. */
const SOLAR = new Float64Array(NLAM);
{
  const h = 6.62607015e-34, c = 2.99792458e8, kB = 1.380649e-23, T = 5778;
  for (let i = 0; i < NLAM; i++) {
    const l = LAM[i] * 1e-9;
    SOLAR[i] = (2 * h * c * c) / (l ** 5 * (Math.exp(h * c / (l * kB * T)) - 1));
  }
  const s = specLum(SOLAR);
  for (let i = 0; i < NLAM; i++) SOLAR[i] /= s;   // unit luminance above the air
}

/* ── extinction ────────────────────────────────────────────────────────── */

/* Rayleigh volume scattering coefficient at sea level, 1/m. The constant folds
   in the refractive index and depolarisation of standard air. */
const BR = new Float64Array(NLAM);
/* Aerosol extinction at the *site*, 1/m, from the vertical optical depth. */
const BM = new Float64Array(NLAM);
/* Ozone absorption cross-section, m^2 per molecule. */
const BO = new Float64Array(NLAM);
{
  const bm550 = AOD550 / H_MIE;
  /* Chappuis band, sampled every 20 nm from the standard cross-section curve,
     in 1e-21 cm^2. Peaks at 602 nm — which is why ozone reddens nothing and
     instead removes orange. */
  const OZ = [
    [400, 0.00], [420, 0.05], [440, 0.12], [460, 0.28], [480, 0.55], [500, 1.05],
    [520, 1.85], [540, 2.65], [560, 3.35], [580, 4.35], [600, 5.10], [620, 4.70],
    [640, 3.60], [660, 2.55], [680, 1.55], [700, 1.05], [720, 0.75], [740, 0.55],
  ];
  const ozAt = (w) => {
    if (w <= OZ[0][0]) return OZ[0][1];
    for (let k = 1; k < OZ.length; k++) {
      if (w <= OZ[k][0]) {
        const t = (w - OZ[k - 1][0]) / (OZ[k][0] - OZ[k - 1][0]);
        return OZ[k - 1][1] + t * (OZ[k][1] - OZ[k - 1][1]);
      }
    }
    return OZ[OZ.length - 1][1];
  };
  for (let i = 0; i < NLAM; i++) {
    const w = LAM[i];
    BR[i] = 1.24062e6 / (w * w * w * w);
    BM[i] = bm550 * Math.pow(550 / w, ANGSTROM);
    BO[i] = ozAt(w) * 1e-21 * 1e-4;          // cm^2 → m^2
  }
}

/* Tent ozone layer: peak at 25 km, zero at 10 and 40. Column set by OZONE_DU. */
const OZ_PEAK = (OZONE_DU * 2.687e16 * 1e4) / 15000;   // molecules / m^3
const ozDensity = (h) => {
  const d = 1 - Math.abs(h + SITE_ALT - 25000) / 15000;
  return d > 0 ? OZ_PEAK * d : 0;
};
const rDensity = (h) => Math.exp(-(h + SITE_ALT) / H_RAYLEIGH);
const mDensity = (h) => Math.exp(-h / H_MIE);

/* ── geometry ──────────────────────────────────────────────────────────── */

/** Distance from radius r along a ray whose cosine to the zenith is mu, to R_TOP. */
function distTop(r, mu) {
  const d = r * r * (mu * mu - 1) + R_TOP * R_TOP;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, d)));
}
/** Distance to the ground, or -1 if the ray misses it. */
function distGround(r, mu) {
  if (mu >= 0) return -1;
  const d = r * r * (mu * mu - 1) + R_GROUND * R_GROUND;
  if (d < 0) return -1;
  return -r * mu - Math.sqrt(d);
}

/** Integrated densities (Rayleigh, Mie, ozone column) along a segment. */
function pathDensity(r, mu, len, steps, out) {
  let dR = 0, dM = 0, dO = 0;
  const ds = len / steps;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const rr = Math.sqrt(Math.max(R_GROUND * R_GROUND, r * r + t * t + 2 * r * t * mu));
    const h = rr - R_GROUND;
    dR += rDensity(h); dM += mDensity(h); dO += ozDensity(h);
  }
  out[0] = dR * ds; out[1] = dM * ds; out[2] = dO * ds;
  return out;
}

/* Transmittance to the top of the atmosphere, as the three integrated densities
   rather than 35 exponentials — the spectral part is applied at the point of
   use, which is what keeps the whole model inside a fifth of a second. */
const TR_N = 96, TR_M = 128;
const TRLUT = new Float32Array(TR_N * TR_M * 3);
{
  const tmp = [0, 0, 0];
  for (let j = 0; j < TR_N; j++) {
    /* sqrt warp on altitude: everything that matters is in the first 10 km. */
    const fh = j / (TR_N - 1);
    const h = fh * fh * ATMO_TOP;
    const r = R_GROUND + h;
    for (let i = 0; i < TR_M; i++) {
      /* mu from -0.35 to 1: below that the path is opaque and the value is
         never read for anything but a shadowed sample. */
      const mu = -0.35 + (1.35 * i) / (TR_M - 1);
      const dg = distGround(r, mu);
      const len = dg > 0 ? dg : distTop(r, mu);
      pathDensity(r, mu, len, 24, tmp);
      const o = (j * TR_M + i) * 3;
      /* A ray that meets the ground carries no sun. Flagged by a huge density. */
      TRLUT[o] = dg > 0 ? 1e9 : tmp[0];
      TRLUT[o + 1] = dg > 0 ? 1e9 : tmp[1];
      TRLUT[o + 2] = dg > 0 ? 1e9 : tmp[2];
    }
  }
}
function sunDensity(h, mu, out) {
  const fh = Math.min(1, Math.sqrt(Math.max(0, h) / ATMO_TOP)) * (TR_N - 1);
  const fm = Math.min(TR_M - 1, Math.max(0, ((mu + 0.35) / 1.35) * (TR_M - 1)));
  const j0 = Math.min(TR_N - 2, fh | 0), i0 = Math.min(TR_M - 2, fm | 0);
  const tj = fh - j0, ti = fm - i0;
  for (let k = 0; k < 3; k++) {
    const a = TRLUT[(j0 * TR_M + i0) * 3 + k], b = TRLUT[(j0 * TR_M + i0 + 1) * 3 + k];
    const c = TRLUT[((j0 + 1) * TR_M + i0) * 3 + k], d = TRLUT[((j0 + 1) * TR_M + i0 + 1) * 3 + k];
    out[k] = (a * (1 - ti) + b * ti) * (1 - tj) + (c * (1 - ti) + d * ti) * tj;
  }
  return out;
}

/* ── the direct beam at the ground ─────────────────────────────────────── */

const SUN_SPEC = new Float64Array(NLAM);       // spectral irradiance, normal incidence
{
  const d = [0, 0, 0];
  sunDensity(0, Math.sin(SUN_EL), d);
  for (let i = 0; i < NLAM; i++) {
    SUN_SPEC[i] = SOLAR[i] * Math.exp(-(d[0] * BR[i] + d[1] * BM[i] + d[2] * BO[i]));
  }
}

/* ── the sky ───────────────────────────────────────────────────────────── */

const phaseR = (c) => 0.05968310 * (1 + c * c);          // 3/(16 pi)
const hg1 = (c, g) => {
  const g2 = g * g;
  return (1 - g2) / (12.5663706 * Math.pow(Math.max(1e-4, 1 + g2 - 2 * g * c), 1.5));
};
/* Two terms, narrow over broad. Used by the multiple-scattering solve and by the
   fill integration as well as the dome, so all three stay the same atmosphere. */
const phaseM = (c) => (1 - MIE_W_NARROW) * hg1(c, MIE_G) + MIE_W_NARROW * hg1(c, MIE_G_NARROW);

/* March one view ray and return spectral radiance from Rayleigh single
   scattering plus the isotropic multiple-scattering source `msJ`. The Mie
   forward lobe is deliberately *not* in here: it is a sharp, nearly grey
   function of the angle to the sun, so it is integrated separately as one
   scalar with its phase function factored out and reconstructed analytically in
   the shader. That split is what lets the whole sky live in a 128x64 texture —
   the Rayleigh half is smooth enough to interpolate and the Mie half is not. */
const _d1 = [0, 0, 0], _d2 = [0, 0, 0];
function marchSky(dirY, cosSun, steps, msJ, outR, groundSpec) {
  const mu = dirY;
  const r0 = R_GROUND + 1.6;
  const dg = distGround(r0, mu);
  /* A downward ray meets the wash a few metres away; its radiance is the
     ground's, and there is no useful airlight in front of it. */
  if (dg > 0 && dg < 4000) {
    for (let i = 0; i < NLAM; i++) outR[i] = groundSpec[i];
    return;
  }
  for (let i = 0; i < NLAM; i++) outR[i] = 0;

  const len = dg > 0 ? dg : distTop(r0, mu);
  const pR = phaseR(cosSun);
  const ds = len / steps;
  let dR = 0, dM = 0, dO = 0;              // camera-side integrated densities
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) * ds;
    const rr = Math.sqrt(Math.max(R_GROUND * R_GROUND, r0 * r0 + t * t + 2 * r0 * t * mu));
    const h = rr - R_GROUND;
    const rho = rDensity(h), rhoM = mDensity(h), rhoO = ozDensity(h);
    dR += rho * ds * 0.5; dM += rhoM * ds * 0.5; dO += rhoO * ds * 0.5;

    /* Sun zenith cosine at the sample. The ray climbs, so the sun rises a little
       along it — small, but it is exactly the term that keeps a long grazing
       path from going black at the horizon. */
    const muS = (r0 * Math.sin(SUN_EL) + t * cosSun) / rr;
    sunDensity(h, muS, _d1);

    for (let i = 0; i < NLAM; i++) {
      const tCam = Math.exp(-(dR * BR[i] + dM * BM[i] + dO * BO[i]));
      const tSun = Math.exp(-(_d1[0] * BR[i] + _d1[1] * BM[i] + _d1[2] * BO[i]));
      const bR = BR[i] * rho, bM = BM[i] * MIE_ALBEDO * rhoM;
      outR[i] += tCam * (bR * pR * SOLAR[i] * tSun + (bR + bM) * msJ[i]) * ds;
    }

    dR += rho * ds * 0.5; dM += rhoM * ds * 0.5; dO += rhoO * ds * 0.5;
  }
}

/* The Mie integral wants its own march, because factoring the phase function out
   means it is not a per-wavelength quantity and folding it into the loop above
   made that loop unreadable. It is cheap: one wavelength, same steps. */
function marchMie(dirY, cosSun, steps) {
  const mu = dirY;
  const r0 = R_GROUND + 1.6;
  const dg = distGround(r0, mu);
  if (dg > 0 && dg < 4000) return 0;
  const len = Math.min(dg > 0 ? dg : 1e12, distTop(r0, mu));
  const ds = len / steps;
  let dR = 0, dM = 0, dO = 0, acc = 0;
  const iRef = 17;                            // 560 nm, near the luminance peak
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) * ds;
    const rr = Math.sqrt(Math.max(R_GROUND * R_GROUND, r0 * r0 + t * t + 2 * r0 * t * mu));
    const h = rr - R_GROUND;
    const rho = rDensity(h), rhoM = mDensity(h);
    dR += rho * ds * 0.5; dM += rhoM * ds * 0.5; dO += ozDensity(h) * ds * 0.5;
    const muS = (r0 * Math.sin(SUN_EL) + t * cosSun) / rr;
    sunDensity(h, muS, _d2);
    const tCam = Math.exp(-(dR * BR[iRef] + dM * BM[iRef] + dO * BO[iRef]));
    const tSun = Math.exp(-(_d2[0] * BR[iRef] + _d2[1] * BM[iRef] + _d2[2] * BO[iRef]));
    acc += tCam * BM[iRef] * MIE_ALBEDO * rhoM * tSun * ds;
    dR += rho * ds * 0.5; dM += rhoM * ds * 0.5; dO += ozDensity(h) * ds * 0.5;
  }
  return acc;
}

/* The colour the grey Mie integral has to be multiplied by: the solar spectrum
   attenuated on the way in and out, weighted by the aerosol's own mild spectral
   slope. This is the aureole's hue, and it is the warmest thing in the sky. */
const MIE_TINT = (() => {
  const d = [0, 0, 0];
  sunDensity(0, Math.sin(SUN_EL), d);
  const spec = new Float64Array(NLAM);
  const iRef = 17;
  for (let i = 0; i < NLAM; i++) {
    spec[i] = SOLAR[i] * Math.exp(-(d[0] * BR[i] + d[1] * BM[i] + d[2] * BO[i]))
      * (BM[i] / BM[iRef]);
  }
  return spec;
})();

/* ── build everything ──────────────────────────────────────────────────── */

const SKY_W = 128, SKY_H = 64;

/** view.y → texture v, with a sqrt warp so the horizon gets the resolution. */
export const SKY_V_WARP = 'v = 0.5 + 0.5 * sign(y) * sqrt(abs(y))';

function buildSky(msJ, groundSpec, steps) {
  const rgbLUT = new Float32Array(SKY_W * SKY_H * 4);
  const spec = new Float64Array(NLAM);
  const rgb = [0, 0, 0];
  const sy = Math.sin(SUN_EL), sxz = Math.cos(SUN_EL);
  for (let j = 0; j < SKY_H; j++) {
    const v = (j + 0.5) / SKY_H;
    const t = (v - 0.5) * 2;
    const y = Math.sign(t) * t * t;
    const hxz = Math.sqrt(Math.max(0, 1 - y * y));
    for (let i = 0; i < SKY_W; i++) {
      const phi = ((i + 0.5) / SKY_W) * Math.PI;       // 0 = toward the sun
      const cosSun = hxz * Math.cos(phi) * sxz + y * sy;
      marchSky(y, cosSun, steps, msJ, spec, groundSpec);
      const mie = marchMie(y, cosSun, steps);
      specToRGB(spec, rgb);
      const o = (j * SKY_W + i) * 4;
      rgbLUT[o] = Math.max(0, rgb[0]);
      rgbLUT[o + 1] = Math.max(0, rgb[1]);
      rgbLUT[o + 2] = Math.max(0, rgb[2]);
      rgbLUT[o + 3] = mie;
    }
  }
  return rgbLUT;
}

/* Direction for LUT texel (i,j), used by the SH projection and the irradiance
   integrals so that every derived quantity is reading the same sky the shader
   samples — not a second, differently-approximated one. */
function lutDir(i, j, mirror, out) {
  const v = (j + 0.5) / SKY_H, t = (v - 0.5) * 2;
  const y = Math.sign(t) * t * t;
  const hxz = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = ((i + 0.5) / SKY_W) * Math.PI;
  /* The sun's azimuth in world terms; phi is measured from it. */
  const fx = Math.sin(SUN_AZ), fz = -Math.cos(SUN_AZ);   // horizontal toward the sun
  const rx = -fz * mirror, rz = fx * mirror;             // perpendicular, either side
  out[0] = hxz * (Math.cos(phi) * fx + Math.sin(phi) * rx);
  out[1] = y;
  out[2] = hxz * (Math.cos(phi) * fz + Math.sin(phi) * rz);
  return out;
}

/** Solid angle of one LUT texel, exactly: the sphere is parameterised by y and
 *  azimuth, and dOmega = dy dphi. The row spans v in [j/H,(j+1)/H] and
 *  y = sign(t) t^2 with t = 2v-1, so the y extent is integrated rather than
 *  differentiated — the warp is steep at the poles and a derivative at the row
 *  centre is several percent out there.
 *  Each texel stands for *two* directions, itself and its mirror image across
 *  the solar meridian, so this is the solid angle of one of them. */
function texelSolidAngle(j) {
  const yOf = (v) => { const t = (v - 0.5) * 2; return Math.sign(t) * t * t; };
  const y0 = yOf(j / SKY_H), y1 = yOf((j + 1) / SKY_H);
  return Math.abs(y1 - y0) * (Math.PI / SKY_W);
}

/**
 * @param {object} [over] Overrides for the terms that are properties of *this
 *   canyon* rather than of the atmosphere — the sunlit fraction of the local
 *   floor and the escarpment coverage. They exist so tools/fillprobe.mjs can
 *   sweep them without editing this file, which is how an in-flight edit to the
 *   sun azimuth once ended up committed by another agent's emergency `add -A`.
 */
export function computeAtmosphere(over = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /* Pass A, coarse and single-scattered, to find the multiple-scattering
     ambient and the ground's own radiance. Skipping this step is what makes a
     naive single-scattering sky too dark and far too saturated at low sun. */
  const zero = new Float64Array(NLAM);
  const groundZero = new Float64Array(NLAM);
  const spec = new Float64Array(NLAM);

  const coarseW = 24, coarseH = 16;
  const sy = Math.sin(SUN_EL), sxz = Math.cos(SUN_EL);
  const groundSpec = new Float64Array(groundZero);
  const msJ = new Float64Array(NLAM);
  const meanSky = new Float64Array(NLAM);        // mean radiance, upper hemisphere
  const irrH = new Float64Array(NLAM);           // sky irradiance on a horizontal

  /* One coarse sweep of the dome, with whatever ambient the previous sweep
     produced. Iterating this is the multiple-scattering solve: the sky lights
     the ground, the ground lights the sky, and each order feeds the next. Three
     sweeps is enough — the fourth moves the horizon by under a percent. */
  const sweep = () => {
    meanSky.fill(0); irrH.fill(0);
    let wSum = 0;
    for (let j = 0; j < coarseH; j++) {
      const y = (j + 0.5) / coarseH;             // upper hemisphere only
      const hxz = Math.sqrt(Math.max(0, 1 - y * y));
      for (let i = 0; i < coarseW; i++) {
        const phi = ((i + 0.5) / coarseW) * Math.PI;
        const cosSun = hxz * Math.cos(phi) * sxz + y * sy;
        marchSky(y, cosSun, 14, msJ, spec, groundSpec);
        const mie = marchMie(y, cosSun, 14) * phaseM(cosSun);
        const dw = (1 / coarseH) * (2 * Math.PI / coarseW);
        for (let k = 0; k < NLAM; k++) {
          const L = spec[k] + mie * MIE_TINT[k];
          meanSky[k] += L * dw;
          irrH[k] += L * y * dw;
        }
        wSum += dw;
      }
    }
    for (let k = 0; k < NLAM; k++) meanSky[k] /= wSum;
  };

  for (let pass = 0; pass < 3; pass++) {
    sweep();
    for (let k = 0; k < NLAM; k++) {
      /* What the wash actually sends back up: its albedo times everything
         landing on it, direct and diffuse. This is the term that lights the
         underside of an overhang warm while its top takes cool skylight. */
      groundSpec[k] = albedoAt(LAM[k]) * (SUN_SPEC[k] * sy + irrH[k]) / Math.PI;
      /* Isotropic ambient inside the medium: half the sphere is sky, half is
         ground. Each sweep adds one order, so no analytic series is needed. */
      msJ[k] = 0.5 * meanSky[k] + 0.5 * groundSpec[k];
    }
  }
  void zero;

  /* Pass B: the sky the shader will sample. */
  const lut = buildSky(msJ, groundSpec, 20);

  /* ── derived lighting quantities, all off the same map ───────────────── */

  const sunRGB = specToRGB(SUN_SPEC);
  const sunLum = specLum(SUN_SPEC);
  const mieTintRGB = specToRGB(MIE_TINT);
  const groundRGB = specToRGB(groundSpec);

  /* ---- what is actually around a rock face here, as opposed to overhead ----
     The sky alone puts a shaded face at about a tenth of a sunlit one and makes
     it neutral. Both are wrong, and for the same reason: a face in a wash is not
     under an unobstructed dome. Below it is the wash floor; across from it,
     filling the bottom fifteen degrees or so of its view, is the opposite wall —
     and at this hour the wall on the anti-solar side of the corridor is in full
     sun and is a large, close, red source.
     So the environment used for the fill is the sky with a band near the horizon
     replaced by escarpment. That band does two opposite things and both are
     real: it *removes* sky, which darkens and de-cools the shade, and it *adds*
     red bounce, which warms it. Coverage is kept modest because this is a broad
     wash between buttes, not a slot canyon — the shadows are supposed to come
     out violet, and burying the horizon in red rock is how a previous rig ended
     up with warm grey shade and no warm/cool split at all. */
  /* This was 0.335 0.152 0.082, at 0.755 saturation, and that is not the colour of
     a cliff — it is the colour of the reddest hematite lens inside the reddest bed
     in the section. It is more saturated than *every* bed in System 2's own
     stratigraphic column, whose reddest is 0.644, and bouncing light off it is
     what took lit rock to 0.664-0.672 against a photographic band of 0.42-0.65.
     A real canyon wall is a stack of unequal beds: eight red ones, a grey
     limestone ledge, and twelve metres of cream Coconino on top. The average of
     that stack is what a surface across the wash receives, and tools/wallalbedo.mjs
     computes it from `LAYERS` rather than from a guess — weighted by solid angle
     rather than by thickness, because a point on the floor sees the top of a near
     wall foreshortened into a narrow band. That is deliberately the conservative
     of the two weightings: it drops the pale cap from 17 percent of the section to
     6.7 percent of the view, and the pale cap is what does most of the
     desaturating. By thickness this would be 0.544; by solid angle it is 0.581.
     Held at the old luminance to the fourth decimal, and that part is not
     cosmetic. The escarpment's *level* is calibrated — WALL_LIT and WALL_SKYVIS
     came off raycasts and the shadow-to-sunlit gate is built on them — while its
     chroma never was calibrated against anything. So the measured quantity stays
     and the unmeasured one is corrected, which is also why this cannot move the
     gate: luminance 0.1859 before and 0.1859 after. */
  const ROCK_ALBEDO = over.wallAlbedo ?? [0.2890, 0.1617, 0.1211];
  /* The floor a surface in the wash actually sees is not the one the atmosphere
     solve used. That one is the regional average — open desert, sunlit butte
     flanks, the wash where it is lit — and it is the right thing to bounce back
     into the sky. What is under a rock face *here* is the wash floor, and at
     this sun angle the left wall's shadow covers nearly all of it: the shadow of
     a 40 m wall reaches 1.6 wall-heights across the corridor, which is wider
     than the corridor. Using the regional figure for the local bounce inflates
     the upward light by nearly a factor of two, and that lands squarely on the
     shadow-to-sunlit ratio, which is the measurement this system is judged on.
     Roughly a third of what a surface down here sees is still catching sun —
     bank crests, the mid-channel bars, the reach up-canyon past the shadow
     line — so that is the fraction the beam is admitted at.

     Measuring it turned up something better than a number: the quantity was
     conflated. The open wash floor is 0.70 sunlit at the sun position above —
     measured with tools/fillprobe.mjs --floor, against 0.015 before the sun
     cleared the skyline — but 0.70 is not what belongs here, and putting it
     here turns a shaded vertical face pink at hue 331. The reason is that this
     value is applied to the *entire* lower hemisphere, and what a rock face
     actually sees below its own horizon is dominated by the few metres of floor
     at its base, which is in that face's own shadow whatever the open wash is
     doing two hundred metres up-canyon. Solid angle is what decides it and the
     near floor has almost all of it.
     So this term is the *near, self-shadowed* floor and is small; the open
     wash's 0.70 is a distant bounce that arrives through the near-horizon
     directions and is already carried by the escarpment term below. 0.05 is the
     reach that peeks past the face's own shadow line.
     What that buys, from tools/fillprobe.mjs: a face turned away from the sun
     goes from B/R 1.12 at an 11% channel spread — the reading that was fairly
     called numerically grey — to B/R 1.29 at 23%, hue 224. Undersides keep the
     warm bounce the brief asks for at hue 21 and B/R 0.62; that hue does not
     move across the whole sweep, only its weight does, so this trades no warmth
     for the chroma. And it barely touches intensity: the fill's luminance on a
     vertical moves 0.0366 to 0.0335, so the shadow-to-sunlit ratio is the sky
     and escarpment terms' business, not this one's. */
  const FLOOR_SUNLIT = over.floorSunlit ?? 0.05;
  const localGround = groundSpec.length ? [0, 0, 0] : [0, 0, 0];
  {
    const shaded = new Float64Array(NLAM);
    for (let k = 0; k < NLAM; k++) {
      shaded[k] = albedoAt(LAM[k]) * (FLOOR_SUNLIT * SUN_SPEC[k] * sy + irrH[k]) / Math.PI;
    }
    specToRGB(shaded, localGround);
  }
  /* How much of the sky a surface down in the wash cannot see. The first
     estimate was 0.30 up to fifteen degrees, on the reasoning that this is a
     broad wash and not a slot canyon, and it was far too generous: from the
     floor, a 40 m wall standing 30 m away subtends fifty degrees on its own,
     and there is one on each side. Measured against that geometry the aperture
     is a little over half the dome, and the consequence is the one the target
     asks for — a shaded face falls from 37 percent of a sunlit one to inside
     the 15-25 percent that real Sedona shade sits at. The rock that replaces
     the sky is not a free lunch either way: it takes blue out and puts red
     back, which is most of why shade here reads as warm-dark rather than as a
     blue hole. */
  /* Those two constants were reasoned, and tools/skyview.mjs has now measured
     what they were guessing at by firing a hemisphere of rays from the standard
     viewpoints. The skyline round a point on the wash floor stands at 36 to 54
     degrees at eleven of twelve bearings, with a single window at 15 degrees —
     and that window is at bearing 189, which is the sun's own bearing to within
     a degree. The corridor is a room with one lit doorway.
     Both old constants were badly low, and the lateral weighting was worse than
     low: it credited open sky up-canyon, where the skyline is 45 degrees, and
     up-canyon is exactly the bearing the away-from-sun fill integrates over. A
     wall face was being given 0.89 of the sky where geometry gives it 0.215. */
  const SKYLINE = (over.skylineDeg ?? 45) * DEG;    // rock skyline away from the window
  const GAP_EL = (over.gapDeg ?? 15) * DEG;         // skyline inside the sun window
  const GAP_W = Math.cos((over.gapHalfWidthDeg ?? 22) * DEG);
  const GAP_W2 = Math.cos((over.gapHalfWidthDeg ?? 22) * DEG + 28 * DEG);
  const WALL_SKYVIS = over.wallSkyVis ?? 0.20;      // the far wall is in the same room
  /* Measured, not chosen. tools/skyview.mjs rays to the skyline and then shadow-
     rays from the hit toward the sun: the cosine-weighted sunlit fraction of the
     skyline is 0.123, 0.170, 0.161, 0.218 at the four viewpoints, and it is zero
     over the lower forty percent of the wall and 0.5 to 0.75 at the crest. A
     smoothstep integrates to exactly one half over its span, so a crest of 0.57
     starting at four tenths of the skyline height gives a mean of 0.171 against
     a measured 0.170. This is the only escarpment parameter that matters: swept
     over its range it moves the shaded fill from B/R 0.27 to 0.94, while the
     wall's own sky visibility moves the shadow-to-sunlit ratio by 0.002 and can
     be left alone — the wall's radiance is set by what the sun does to its
     crest, not by the sky it sees. */
  const WALL_LIT = over.wallLit ?? 0.57;            // sunlit fraction at the crest
  const LIT_FOOT = over.litFoot ?? 0.40;            // height it starts, as a fraction
  const FLOOR_VIEW = over.floorView ?? 0.5;         // vertical face over an infinite plane
  const sunH = [SUN_DIR.x, 0, SUN_DIR.z];
  { const l = Math.hypot(sunH[0], sunH[2]); sunH[0] /= l; sunH[2] /= l; }
  /* Sky irradiance on a vertical, needed before the wall term can be evaluated;
     taken from the coarse sweep rather than iterated again. */
  const skyVertLum = 0.5 * specLum(meanSky) * Math.PI;
  /* And the same class of error as the escarpment albedo, one term further along:
     that scalar was multiplied straight into all three channels, so the bluest
     source in the scene was handed to the rock as grey. Rescaled to carry exactly
     the luminance the scalar did, which makes this a chroma correction with no
     energy in it — the gate cannot see it, and neither can anything the raycast
     sweeps calibrated. Small, because the wall's radiance is set by what the sun
     does to its crest rather than by the sky it sees, but it is free and it is in
     the right direction. */
  const skyVertRGB = [0, 0, 0];
  {
    specToRGB(meanSky, skyVertRGB);
    const l = 0.2126 * skyVertRGB[0] + 0.7152 * skyVertRGB[1] + 0.0722 * skyVertRGB[2];
    for (let k = 0; k < 3; k++) skyVertRGB[k] *= l > 0 ? skyVertLum / l : 0;
  }

  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const skylineSin = (d) => {
    const hl = Math.hypot(d[0], d[2]) || 1e-6;
    const towardSun = (d[0] * sunH[0] + d[2] * sunH[2]) / hl;
    const gap = smooth(GAP_W2, GAP_W, towardSun);
    return Math.sin(SKYLINE + (GAP_EL - SKYLINE) * gap);
  };
  const wallRadiance = (d, out) => {
    const hl = Math.hypot(d[0], d[2]) || 1e-6;
    /* A wall seen in direction d faces back along -d, so its cosine to the sun
       is the component of -d along the sun's azimuth. Crucially that cosine is
       small for both of this corridor's walls, because the sun is only thirteen
       degrees off the axis they run along — which is why replacing sky with rock
       darkens the environment here rather than brightening it. */
    const facing = Math.max(0, -(d[0] * sunH[0] + d[2] * sunH[2]) / hl);
    /* A geometric cosine is not enough: with the sun eleven degrees up, a wall
       that faces it is still shadowed over most of its height by whatever stands
       between, which is why the wash floor was in shadow at all until the sun
       was raised. Lit fraction therefore climbs from nothing at the wall's foot
       to full at its crest. Without this the up-canyon skyline reads as a fully
       sunlit cliff and *raises* the shaded fill, which is what it just did. */
    const hs = skylineSin(d);
    const lit = WALL_LIT * smooth(LIT_FOOT * hs, hs, d[1]);
    const eDirect = facing * lit * Math.cos(SUN_EL);
    for (let k = 0; k < 3; k++) {
      /* The wall opposite is standing in the same canyon, so it sees the same
         restricted sky the near wall does. Crediting it half the dome made it
         nearly as bright as the sky it replaced, which is why substituting it
         moved the fill by two percent instead of the factor it should. */
      /* And it stands over a floor that is seventy percent sunlit, which a wall
         cannot help but see. A vertical face looking at an infinite Lambertian
         plane collects radiance * pi / 2, so the coefficient is geometry rather
         than a knob. Leaving this out is what took the shadow ratio past the
         bottom of its band and started crushing the shaded wall's structure:
         grad/L on that face had fallen to 0.019. */
      out[k] = ROCK_ALBEDO[k] * (eDirect * sunRGB[k] + skyVertRGB[k] * WALL_SKYVIS
        + groundRGB[k] * Math.PI * FLOOR_VIEW) / Math.PI;
    }
    return out;
  };
  /* Coverage is now a skyline rather than a lateral band: rock below it, sky
     above, with the doorway toward the sun. The soft edge is there because a
     ridge is not a straight line and because a hard step in the environment
     rings the SH fit. */
  const coverAt = (d) => {
    const y = d[1];
    if (y < 0) return 1;
    const hl = Math.hypot(d[0], d[2]) || 1e-6;
    const towardSun = (d[0] * sunH[0] + d[2] * sunH[2]) / hl;
    const gap = smooth(GAP_W2, GAP_W, towardSun);
    const hs = Math.sin(SKYLINE + (GAP_EL - SKYLINE) * gap);
    return 1 - smooth(hs - 0.07, hs + 0.07, y);
  };

  /* SH9 of that environment. Three's LightProbe takes exactly this and returns
     the cosine-convolved irradiance for any normal, which means the fill is
     directionally correct for free. A hemisphere light cannot do that: it
     interpolates on normal.y, so its cool half lands hardest on upward-facing
     surfaces, which is how the provisional rig turned every pale clast top into
     blue-grey card. */
  const sh = new THREE.SphericalHarmonics3();
  /* And the same environment with the escarpment taken away, which is what a
     surface above the rim actually sees. One probe is one aperture, and the
     aperture the rays measured is a strong function of height — 0.215 of the sky
     on a lateral normal at the wash floor, 0.954 at 70 m — so handing every
     surface the floor's figure underlights the walls by about a factor of two
     where they are crushing. src/sky.js lerps between the two by world height.
     The ground half is deliberately identical in both, so the environment's
     difference is purely the sky-versus-rock substitution — which does not leave
     undersides untouched, because SH9 is low order and the sky coefficients leak
     into a down-facing lobe by 19 to 30 percent. */
  const shOpen = new THREE.SphericalHarmonics3();
  const basis = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const dir = new THREE.Vector3();
  const d3 = [0, 0, 0], env = [0, 0, 0], wall = [0, 0, 0];
  const eH = [0, 0, 0], eVsun = [0, 0, 0], eVanti = [0, 0, 0];
  const eSkyH = [0, 0, 0];

  for (let j = 0; j < SKY_H; j++) {
    const dw = texelSolidAngle(j);
    for (let i = 0; i < SKY_W; i++) {
      const o = (j * SKY_W + i) * 4;
      /* Both mirror images of the stored texel. Folding the sphere in half and
         then summing only one half is a symmetry bug that shows up as a large
         spurious L3 term — the probe develops a bright side for no reason. */
      for (const mirror of [1, -1]) {
        lutDir(i, j, mirror, d3);
        /* Reconstruct exactly what the shader shows: the stored Rayleigh and
           multiple-scattering map plus the analytic Mie lobe. The sun's own
           disc is deliberately left out — the directional light *is* the disc,
           and counting it twice is the classic route to a washed-out frame. */
        const cosSun = d3[0] * SUN_DIR.x + d3[1] * SUN_DIR.y + d3[2] * SUN_DIR.z;
        const ph = phaseM(cosSun);
        const sky0 = lut[o] + lut[o + 3] * ph * mieTintRGB[0];
        const sky1 = lut[o + 1] + lut[o + 3] * ph * mieTintRGB[1];
        const sky2 = lut[o + 2] + lut[o + 3] * ph * mieTintRGB[2];

        const cH = Math.max(0, d3[1]);
        for (let k = 0; k < 3; k++) eSkyH[k] += (k === 0 ? sky0 : k === 1 ? sky1 : sky2) * cH * dw;

        const cov = coverAt(d3);
        if (d3[1] < 0) { env[0] = localGround[0]; env[1] = localGround[1]; env[2] = localGround[2]; }
        else if (cov > 0) {
          wallRadiance(d3, wall);
          env[0] = sky0 + (wall[0] - sky0) * cov;
          env[1] = sky1 + (wall[1] - sky1) * cov;
          env[2] = sky2 + (wall[2] - sky2) * cov;
        } else { env[0] = sky0; env[1] = sky1; env[2] = sky2; }

        dir.set(d3[0], d3[1], d3[2]);
        THREE.SphericalHarmonics3.getBasisAt(dir, basis);
        for (let k = 0; k < 9; k++) {
          sh.coefficients[k].x += basis[k] * env[0] * dw;
          sh.coefficients[k].y += basis[k] * env[1] * dw;
          sh.coefficients[k].z += basis[k] * env[2] * dw;
        }
        const op0 = d3[1] < 0 ? localGround[0] : sky0;
        const op1 = d3[1] < 0 ? localGround[1] : sky1;
        const op2 = d3[1] < 0 ? localGround[2] : sky2;
        for (let k = 0; k < 9; k++) {
          shOpen.coefficients[k].x += basis[k] * op0 * dw;
          shOpen.coefficients[k].y += basis[k] * op1 * dw;
          shOpen.coefficients[k].z += basis[k] * op2 * dw;
        }

        const cS = Math.max(0, (d3[0] * sunH[0] + d3[2] * sunH[2]));
        for (let k = 0; k < 3; k++) {
          eH[k] += env[k] * cH * dw;
          eVsun[k] += env[k] * cS * dw;
          eVanti[k] += env[k] * Math.max(0, -(d3[0] * sunH[0] + d3[2] * sunH[2])) * dw;
        }
      }
    }
  }

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

  return {
    lut, SKY_W, SKY_H,
    sunRGB, sunLum, sunSpec: SUN_SPEC,
    mieTintRGB, groundRGB, groundSpec,
    sh, shOpen,
    irradiance: { horizontal: eH, vertSun: eVsun, vertAnti: eVanti, skyHorizontal: eSkyH },
    directHorizontal: [sunRGB[0] * sy, sunRGB[1] * sy, sunRGB[2] * sy],
    ms,
  };
}

/* A spectral albedo for the wash, interpolated from the three-channel figure —
   linear in wavelength between the sRGB primaries' effective centroids, which
   is crude but is only ever used for a bounce term. */
function albedoAt(w) {
  const [r, g, b] = GROUND_ALBEDO;
  if (w <= 460) return b;
  if (w <= 550) return b + (g - b) * (w - 460) / 90;
  if (w <= 610) return g + (r - g) * (w - 550) / 60;
  return r;
}
