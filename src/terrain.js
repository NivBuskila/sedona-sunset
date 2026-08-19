/* Terrain: the height field, the mesh it is sampled into, and the surface
 * shader that dresses it.
 *
 * `heightAt(x, z)` is the single source of truth for ground elevation. The mesh
 * is that function sampled on a grid, and the player's feet call the same
 * function, so the two cannot disagree.
 *
 * The cross-section is the important part. A wash is not a shallow trough: it
 * is *concave*, with an active inner channel incised half a metre or more below
 * an older abandoned terrace, the low point pushed toward the outside of each
 * bend, a raw cut bank on that outside and a point-bar ramp on the inside. The
 * terrace itself is stepped, not smooth — depositional bar margins leave hard
 * risers a decimetre or two high, and those risers are what carries readable
 * structure out to thirty or forty metres. Everything downstream of this file
 * (clast sorting, mud pans, talus) reads the same cross-section, so the surface
 * and the sediment on it describe the same flood.
 *
 * Two per-vertex outputs travel with the mesh:
 *   aRef  elevation *before* the stratigraphic benching pass, so the shader can
 *         put band colour exactly where the geometry put the ledge
 *   aPan  ponded-silt coverage, so mud cracks appear only where mud could form
 */
import * as THREE from 'three';
import { fbm, ridged, clamp, smoothstep, mix } from './noise.js';

/** Staircase with hard risers. `sharp` is the fraction of each step spent rising. */
function stair(v, n, sharp) {
  const f = v * n;
  const i = Math.floor(f);
  return i + smoothstep(1 - sharp, 1, f - i);
}

/* Bed thickness for the wall stratigraphy, shared with the shader so the ledge
   and the colour band are the same feature rather than two guesses. Thick beds
   on purpose: a thirty-metre wall wants two or three dominant ledges, not
   twelve evenly spaced ones, which read as corrugated iron. */
export const BED_T = 4.6;
/* Only about a third of beds are resistant enough to stand out. Evenly
   alternating hard and soft beds is the metronome that makes procedural
   stratigraphy look machined. */
const resistOf = (i) => smoothstep(0.30, 0.72, 0.5 + 0.5 * Math.sin(i * 2.399 + 1.7));

/* ── height field ──────────────────────────────────────────────────────── */

export class Terrain {
  constructor(path) {
    this.path = path;
    this._q = {};
    this._f = {};
    this._f2 = {};
    this.oRef = 0;   // pre-bench elevation
    this.oPan = 0;   // ponded silt coverage
  }

  heightAt(x, z) {
    return this.heightAtQ(x, z, this.path.atZ(z, this._q));
  }

  /**
   * Cross-section parameters at a point, in the wash's own frame.
   * Split out because the clast scatter needs exactly the same channel, bank
   * and talus positions the geometry used — sediment placed against a
   * separately guessed channel is why gravel ends up looking sprinkled.
   */
  frame(x, z, q, out = this._f) {
    const s = q.s;
    const u = (x - q.x) * Math.cos(q.th);
    /* The thalweg swings to the outside of each bend, where the water carries
       most momentum. q.k is signed with travel direction, so this tracks the
       spline instead of being placed by hand. */
    /* Kept modest deliberately. The player walks the centreline, so if the
       thalweg strays five metres off it they stand on the terrace and the
       cross-section in front of them reads as a crowned road with a ditch
       beside it — the exact failure this rewrite exists to remove. Within about
       three metres the incised channel stays in the near field and the frame
       reads concave. */
    const cOff = -clamp(q.k * 140, -1.8, 1.8) + 0.7 * fbm(s * 0.026, 21, 2, 41);
    const v = u - cOff;
    const side = u >= 0 ? 1 : -1;

    out.s = s;
    out.u = u;
    out.av = Math.abs(v);
    out.side = side;
    out.bendOut = clamp(-side * q.k * 320, 0, 1);
    /* Both edges are scalloped in world space. A bank whose position depends
       only on s is a ruler-straight line, which reads as an excavated trench,
       and it also beats against the sampling grid and throws off fine vertical
       striations along the face. Real banks are eaten back in bays. */
    /* Three scales, and the finest one matters most. A crest whose plan position
       is smooth at the scale of the sampling grid gets rendered as a staircase:
       the grid quantises a smooth diagonal line into steps, and a polygonal
       staircase along a bank crest is the single most instantly synthetic thing a
       heightfield can produce. Wobbling the crest below grid spacing turns that
       staircase into an irregular crenellated edge, which is also what an
       undercut bank collapsing in slabs actually looks like. */
    /* The middle scale is the one that matters. It is a few times the grid
       spacing, so it turns the staircase the grid would otherwise make of a smooth
       diagonal crest into an irregular crenellated edge — which is also what an
       undercut bank collapsing in slabs looks like. Anything at or below the grid
       spacing is worse than nothing: it cannot resolve as a bay, so it resolves as
       a row of thin teeth along the lip instead. */
    /* Frequencies capped so the *finest octave* of each term stays above four
       samples of the coarser grid axis. These positions are multiplied by the
       riser gradient — a bank three metres high over 0.85 m of horizontal is a
       gain of three and a half — so a wobble the grid can only just carry becomes
       an alternating half-metre step it cannot carry at all, and the crest renders
       as a checkerboard. Two octaves double the base frequency, so 0.28 puts the
       shortest wavelength at 1.8 m against a 0.42 m row spacing. This is what the
       bank-crest staircase and the sugar-cube patches were: not too little
       resolution, too much frequency. */
    const scallopC = 0.90 * fbm(x * 0.082, z * 0.082, 2, 59)
                   + 0.34 * fbm(x * 0.26, z * 0.26, 2, 64);
    const scallopT = 1.60 * fbm(x * 0.045, z * 0.045, 2, 58)
                   + 0.70 * fbm(x * 0.150, z * 0.150, 2, 60)
                   + 0.40 * fbm(x * 0.28, z * 0.28, 2, 66);

    out.wc = 3.0 + 2.2 * (0.5 + 0.5 * fbm(s * 0.033, 12, 3, 51)) + scallopC;
    /* Incision depth. Nearly a metre at its shallowest: the whole complaint was
       that the floor crowns in the middle, and a channel a foot deep is simply
       not legible against half a metre of bar relief either side of it. The
       player walks the bed, so this is also the difference between standing in a
       wash and standing on a road. */
    out.dc = 0.85 + 0.95 * (0.5 + 0.5 * fbm(s * 0.021, 5, 3, 53));
    out.wt = out.wc + 0.50 + 3.0 + 4.0 * (0.5 + 0.5 * fbm(s * 0.028, 71, 3, 57)) + scallopT;
    /* Bank height, from nothing to about three metres within a hundred metres of
       wash. Running the scarp at a near-constant height on both sides all the way
       up the corridor is what read as a bulldozed levee or an irrigation ditch:
       real cut banks appear where the water was pushed into the outside of a bend,
       die away entirely where it was not, and vary wildly in between. The steep
       power makes long stretches with no bank at all. */
    const hVar = Math.pow(0.5 + 0.5 * fbm(s * 0.05, 91, 2, 61), 1.7);
    const hGate = smoothstep(0.30, 0.62, 0.5 + 0.5 * fbm(s * 0.019, 47, 2, 68));
    out.hb = (0.18 + 2.85 * hVar) * out.bendOut * hGate;
    out.ws = out.wt + 0.55 + 2.0 + 5.0 *
      (0.5 + 0.5 * fbm(s * 0.016, side > 0 ? 31 : 63, 3, 71))       // toe of the talus
      + 2.4 * fbm(x * 0.038, z * 0.038, 2, 62);
    return out;
  }

  /**
   * Ponded fine silt, which is the only place desiccation cracks belong. Two
   * settings: shallow closed depressions on the terrace, and the slack pools in
   * the channel bed where the finest material drops out last as a flood
   * recedes. Both are carved into the height field, so the mud is genuinely in a
   * low spot rather than painted onto the same plane as the gravel.
   */
  panField(x, z, f) {
    const av = f.av;
    const terrZone = smoothstep(f.wc + 0.5, f.wc + 2.2, av)
                   * (1 - smoothstep(f.wt - 0.8, f.wt + 1.2, av));
    const chanZone = 1 - smoothstep(f.wc * 0.55, f.wc * 1.05, av);
    return Math.max(
      terrZone * smoothstep(0.50, 0.70, 0.5 + 0.5 * fbm(x * 0.105, z * 0.105, 3, 231)),
      chanZone * smoothstep(0.50, 0.70, 0.5 + 0.5 * fbm(x * 0.130, z * 0.130, 3, 233)));
  }

  /** Which deposit is at this point. Read by the clast scatter. */
  facies(x, z, q) {
    const f = this.frame(x, z, q, this._f2);
    const av = f.av;
    const chan = 1 - smoothstep(f.wc * 0.85, f.wc + 0.6, av);
    let bar = smoothstep(f.wc, f.wc + 1.1, av) * (1 - smoothstep(f.wt - 1.6, f.wt + 0.3, av));
    const terr = smoothstep(f.wt + 0.2, f.wt + 1.8, av) * (1 - smoothstep(f.ws - 1.2, f.ws + 0.8, av));
    const tal = smoothstep(f.ws - 0.6, f.ws + 2.2, av) * (1 - smoothstep(f.ws + 7.5, f.ws + 12.0, av));
    /* Where across the apron: 0 at the toe, 1 at the head against the wall. A
       talus cone is sorted by how far a block bounced, so the toe is coarse and
       the head is fine, and an apron of uniformly sized shards is the giveaway. */
    const talPos = clamp((av - (f.ws - 0.6)) / 11.0, 0, 1);

    /* Slack water on the inside of a bend drops a sand sheet, and a sand sheet
       has almost no clasts in it at all. */
    const sheet = (1 - f.bendOut)
      * smoothstep(0.44, 0.68, 0.5 + 0.5 * fbm(x * 0.048, z * 0.048, 3, 241))
      * smoothstep(f.wc + 0.5, f.wc + 3.0, av);
    bar = Math.max(0, bar - sheet * 1.3);

    /* Coarse lag concentrates in bands where the flood was steepest, and
       between them the bed is scoured bare. Constant density is the loudest
       tell that stones were placed by a loop. */
    const lag = smoothstep(0.42, 0.80, ridged(f.s * 0.028, 0.5, 2, 261));
    const bare = Math.max(
      smoothstep(0.50, 0.70, 0.5 + 0.5 * fbm(x * 0.032, z * 0.032, 3, 251)),
      smoothstep(0.58, 0.78, 0.5 + 0.5 * fbm(x * 0.110, z * 0.110, 2, 253)));

    /* Nothing coarse rests on dried mud — the flood that laid the silt down had
       already dropped everything heavier upstream. */
    const pan = this.panField(x, z, f);

    /* Rockfall is episodic and it arrives down the gullies, so an apron is a run
       of heaps with swept ground between them, not an even sprinkle. */
    const pile = 0.10 + 1.55 * smoothstep(0.44, 0.80, 0.5 + 0.5 *
      fbm(x * 0.055, z * 0.055, 3, 271));

    return { chan, bar, terr, tal, talPos, sheet, bare, lag, pan, pile, f };
  }

  heightAtQ(x, z, q) {
    const f = this.frame(x, z, q);
    const { s, u, av, side, bendOut } = f;
    this.oPan = 0;
    this.oWall = 0;

    /* ── far field ──
       Distant mesa country, so the sky has a horizon to sit against and the
       haze has discrete ridgelines to separate into layers. Ridged rather than
       plain fBm: crisp crests are what makes aerial perspective legible.
       Provisional scenery, not System 2. */
    if (av > 145) {
      const far = smoothstep(145, 330, av);
      const near = this._nearShoulder(f, x, z);
      const crest = ridged(x * 0.0019, z * 0.0019, 4, 401);
      let fh = 9 + 78 * Math.pow(crest, 1.7) * smoothstep(160, 640, av)
             + 20 * fbm(x * 0.0062, z * 0.0062, 3, 409);
      const far2 = smoothstep(680, 1500, av);
      if (far2 > 0.001) fh = mix(fh, 20 + 34 * ridged(x * 0.0009, z * 0.0009, 3, 419), far2);
      const h = mix(near, fh, far);
      this.oRef = h / BED_T;
      this.oWall = 1;
      return h;
    }

    /* ── longitudinal grade ── */
    let h = 0.0125 * s + 0.55 * fbm(s * 0.0072, 3.7, 2, 21);

    /* ── the active inner channel ──
       A flat scoured bed, then a near-vertical riser about a third of a metre
       wide up to the terrace. The clamped linear ramp is deliberate: a
       smoothstep here produces the rounded fillet that made the previous
       version read as a graded dirt road. */
    const tIn = clamp((av - f.wc) / 1.05, 0, 1);
    h -= f.dc * (1 - tIn);
    h -= 0.13 * (1 - smoothstep(0, f.wc * 0.95, av));   // thalweg trough

    /* ── concavity ──
       Elevation climbs steadily away from the channel. The cross-section has to
       be concave; water cannot leave the middle of a wash as its high point. */
    h += 0.036 * Math.max(0, av - f.wc);

    /* ── the banks ──
       Outside of the bend: a raw cut bank, a hard face up to two metres. Inside:
       a point-bar ramp. Same curvature term, opposite consequences. */
    /* A three-metre scarp given 1.15 m of run is still a 69-degree face, and 1.15 m
       is the narrowest riser the 0.42 m row spacing can put three vertices on. At
       0.85 m it got two, and two vertices cannot describe a step — the crest came
       out as a staircase of grid-aligned blocks, which was the most conspicuously
       synthetic artefact in the set. */
    h += f.hb * clamp((av - f.wt) / 1.15, 0, 1);
    h += (1 - bendOut) * 0.62 * smoothstep(f.wt - 2.5, f.wt + 3.5, av);

    /* ── stepped bar margins ──
       Two staircases, at roughly thirteen and four metres. These hard risers are
       what keeps the floor readable at thirty metres, where smooth noise
       collapses into featureless orange. */
    /* The bed of the active channel is graded by running water and is close to
       flat across its width; the bars and terraces either side are not. Letting
       the bar relief run through the channel is what filled the low point back
       in and left the cross-section reading as a crown. */
    const chanMask = 1 - smoothstep(f.wc * 0.35, f.wc + 0.9, av);
    const floorZone = (1 - smoothstep(f.ws - 3.0, f.ws + 1.0, av)) * (1 - 0.92 * chanMask);
    if (floorZone > 0.001) {
      /* Three staircases, at roughly thirteen, seven and four metres. The middle
         one exists purely to fill the hole at twenty to forty metres, where the
         coarse steps are too far apart to read and the fine ones have gone below
         a pixel — the range over which the floor was collapsing into
         featureless orange. */
      const l1 = 0.5 + 0.5 * fbm(x * 0.076, z * 0.076, 3, 191);
      const l1b = 0.5 + 0.5 * fbm(x * 0.142, z * 0.142, 2, 193);
      const l2 = 0.5 + 0.5 * fbm(x * 0.245, z * 0.245, 2, 197);
      /* Risers spread over a fifth of a step rather than a thirteenth. A hard riser
         is the point of this term, but a riser narrower than a couple of grid
         columns cannot be drawn as a riser: it comes out as a flat-topped plateau
         with vertical sides snapped to the sampling grid, which at bar scale reads
         as a poured concrete pad on the floor of the wash and at the scale where
         two of these staircases interfere reads as a heap of dice. The step height
         is what carries the shadow line; the riser only has to be steep, not
         instantaneous. */
      h += floorZone * (0.215 * stair(l1, 3, 0.19)
                      + 0.105 * stair(l1b, 2, 0.22)
                      + 0.055 * stair(l2, 2, 0.30));
    }

    /* ── braided minor channels ── */
    const braidZone = floorZone * (1 - smoothstep(f.wt + 1.0, f.wt + 4.0, av));
    if (braidZone > 0.001) {
      const br = ridged(s * 0.048, u * 0.105, 3, 151);
      h -= braidZone * 0.27 * smoothstep(0.54, 0.70, br);
    }

    /* ── ponded silt pans ── carved for real, and exported so the shader can
       put desiccation cracks only where mud could actually have dried. */
    const pan = this.panField(x, z, f);
    h -= pan * 0.16;
    this.oPan = pan;

    /* ── talus apron and canyon wall ──
       The apron sits at the angle of repose; the wall above is steeper. The
       junction is where the visual event is, so the apron is a distinct feature
       rather than a blend. */
    /* Linear in `av`, not smoothstepped. A talus apron rests at the angle of
       repose, which means constant slope, which means it meets the flat floor at
       a hard break — and that break is the most visually eventful line in the
       whole scene. Smoothstepping it produces the poured-wax fillet the wall was
       criticised for both rounds: wall becoming floor through a continuous
       rounded blend, with no junction anywhere.
       The apron is also a *cone*, fanning out below a source notch in the wall
       above, so its reach varies several-fold along the wash instead of running as
       a constant-width band. And its surface is lumpy at block scale, because it
       is made of stacked blocks. */
    const talRaw = clamp((av - f.ws) / 8.5, 0, 1);
    const cone = 0.35 + 1.15 * Math.pow(0.5 + 0.5 * fbm(s * 0.026, side > 0 ? 23 : 29, 2, 190), 2.2);
    /* Block-scale lumpiness, but nothing near the sampling grid. The 2.1 term
       here was a 48 cm wavelength on a 20 cm grid, which is not relief — it is a
       function sampled at its own Nyquist frequency, and it rendered as a
       checkerboard of alternate raised and lowered cells: a patch of ground that
       looked like a heap of sugar cubes. Detail at that scale belongs in the normal
       map, where it is not sampled by vertices at all. */
    h += talRaw * 3.3 * cone * (0.86 + 0.28 * fbm(x * 0.30, z * 0.30, 2, 191))
       + smoothstep(0.04, 0.30, talRaw) * cone
         * 0.52 * fbm(x * 0.28, z * 0.28, 2, 192);
    const tal = talRaw;

    const openEnd = smoothstep(215, 330, s);   // let the far end of the wash breathe
    const wStart = f.ws + 8.5;
    const wRun = 21 + 15 * (0.5 + 0.5 * fbm(s * 0.011, side > 0 ? 101 : 137, 3, 73));
    const wallH = (16 + 16 * (0.5 + 0.5 * fbm(s * 0.0085, side > 0 ? 7 : 19, 3, 79))
                 + 7 * (0.5 + 0.5 * fbm(s * 0.021, 91, 2, 83))) * (1 - 0.55 * openEnd);
    const t = clamp((av - wStart) / wRun, 0, 1);
    const ramp = t * t * (3 - 2 * t);
    /* Exported so the shader can tell a canyon wall from a bank in the wash
       floor. They can share a slope angle and be made of completely different
       things — one is rock, the other is a section through last decade's
       floods — and slope alone cannot distinguish them. */
    this.oWall = ramp;
    h += ramp * wallH;
    h += clamp(av - (wStart + wRun), 0, 45) * 0.20 * (0.7 + 0.3 * fbm(s * 0.02, 5, 2, 87));

    /* Coarse wall form. Half ridged, so the wall breaks into spurs separated by
       sharp divides instead of draping as one smooth dune — a wall built only
       from fBm reads as sand however it is textured. */
    h += ramp * (2.1 * fbm(x * 0.031, z * 0.031, 4, 117)
               + 2.7 * (ridged(x * 0.026, z * 0.026, 3, 118) - 0.45));

    /* The coarse form, kept aside for the stratigraphy below to trace. Bedding
       has to be read off a surface that the drainage has not cut into: a gully
       four metres deep is most of a bed thickness, so a bed index taken from the
       final height flips from one bed to the next across every gully edge, and
       with the beds now stepping the profile for real that flip is a four-metre
       cliff between neighbouring vertices — which renders as a row of white
       spikes along the gully rim. A stratum is a plane through the rock; it does
       not care what has been carved out of it. */
    const hStrat = h;

    /* ── dendritic drainage on the wall ──
       Three generations. The fine rills live near the rim and fade downslope;
       the major gullies deepen downslope. That gradient is what reads as small
       channels merging into larger ones, instead of the uniform corduroy a
       single ridged octave produces. Each major gully drops a debris fan onto
       the apron at its mouth, so the drainage deposits something. */
    if (ramp > 0.015) {
      /* Warp the along-wall coordinate so spacing varies with slope instead of
         being metronomic — evenly spaced grooves are the corduroy look. */
      const wp = 3.2 * fbm(av * 0.022, s * 0.006, 2, 177);
      const wq = 3.2 * fbm(av * 0.055, s * 0.017, 2, 179);
      /* The warp has to be worth several groove widths or the spacing stays
         metronomic. At a tenth of a wavelength it only wobbles the grooves; at
         half a wavelength it genuinely crowds them together on the steep panels
         and spreads them out on the gentle ones, which is what varying spacing
         with slope angle looks like. */
      /* The second coordinate has to advance by a whole cycle or more over the
         height of the wall. At a fortieth of a cycle the groove is at a
         constant `s` from top to bottom, and a feature at constant `s` on a
         corridor wall is a perfectly straight line in world space — which is
         where the ruler-straight bright ribs came from. Real rills wander as
         they descend. */
      /* Displaced bodily along the wall by several groove wavelengths. Warping
         only inside the noise argument by a fraction of a wavelength wobbles each
         groove but leaves the *train* metronomic, and a metronomic train is what
         reads as corduroy however much each individual groove wanders. */
      const drift = 9.0 * fbm(s * 0.0042, side > 0 ? 55 : 57, 2, 182);
      const r1 = ridged(s * 0.052 + wp * 0.42 + drift * 0.052, av * 0.018, 3, 171);
      const r2 = ridged(s * 0.145 + wp * 0.70 + wq * 0.30 + drift * 0.145, av * 0.040, 3, 173);
      /* Long stretches of wall carry no drainage at all — a resistant panel, or a
         face that simply has no catchment above it. Rills running unbroken from
         one end of the corridor to the other at constant amplitude is the other
         half of the corduroy read. */
      const gGate = smoothstep(0.22, 0.60, 0.5 + 0.5 * fbm(s * 0.0075, 44, 2, 181));
      const m1 = smoothstep(0.48, 0.95, r1) * gGate;
      /* Rills merge downslope: inside a major gully the fine ones have already
         been captured by it and no longer exist as separate channels. */
      const merge = 1 - 0.85 * m1;
      /* The finest generation is cut shallow and with a wide shoulder. A narrow
         deep groove at a two-metre wavelength leaves a knife-edge lip between
         adjacent grooves, one grid column wide, and a one-column crest whose
         normal happens to face a sun this low fires off a bright hairline that
         reads as a scratch on the wall rather than as relief. */
      /* Two generations only. A third at a two-and-a-half-metre wavelength sits
         right at the limit of what the grid can carry, so it never resolved as
         relief — it resolved as a hairline highlight on its own lip. Grain at
         that scale belongs in the normal map, not in the height field. */
      const cut = 3.8 * m1 * (0.30 + 0.70 * (1 - t))
                + 1.45 * merge * gGate * smoothstep(0.50, 1.00, r2) * smoothstep(0.12, 0.72, t);
      h -= ramp * cut * smoothstep(0.0, 0.13, t);

      const fanAxis = 1 - Math.min(1, Math.abs(av - f.ws - 2.5) / 7.5);
      h += m1 * fanAxis * fanAxis * 1.75;
    }

    /* ── stratigraphy ──
       Resistant beds stand out as ledges with hard tops and bottoms, and the
       ledge follows a contour of the *coarse* form. That ordering is the whole
       trick: bedding read off the final surface wanders with every fine octave
       and disintegrates into scratches, whereas a bed traced on the coarse form
       stays laterally continuous across spurs and gullies the way a real
       stratum does. The same reference goes out as `aRef`, so the shader bands
       exactly the beds the geometry stepped. */
    /* The bed coordinate itself goes out as `aRef`, not the elevation it was
       derived from. The shader cannot reproduce the two fBm terms that warp the
       bedding out of true horizontal, so handing it a raw height left it colouring
       bands at one set of elevations while the geometry stepped at another — the
       colour and the relief were literally different features, which is precisely
       the "bands are paint" complaint. Passing the coordinate makes them the same
       feature by construction. */
    const bf = hStrat / BED_T + 1.05 * fbm(x * 0.010, z * 0.010, 2, 211)
                              + 0.35 * fbm(x * 0.045, z * 0.045, 2, 213);
    this.oRef = bf;
    if (ramp > 0.05) {
      const bi = Math.floor(bf), bt = bf - bi;
      /* Differential erosion, as a signed offset rather than a bulge.
         The previous form added a rounded lump inside every resistant bed, which
         put a swelling on the face but left the *silhouette* smooth — so the
         colour band and the relief never became the same feature, and the bands
         read as paint on a smooth surface. Here a resistant bed stands proud and a
         soft one recesses, each holding its offset flat right across the bed, so
         the profile is a genuine staircase: tread, riser, tread. The offset is
         interpolated across the contacts, narrowly, so there is a visible riser
         without a crack in the mesh.
         `oRef` was captured before this, so the shader bands exactly the beds the
         geometry stepped. */
      /* One expression, and continuous across the contact by construction: the
         offset holds flat at this bed's value all the way across it and then rises
         to the next bed's value in the top fifteen percent, which is exactly where
         the following bed's own expression starts from. Splitting it into a branch
         either side of mid-bed left a jump at every contact — the offset arrived at
         the next bed's value at the top of one bed and then started again from the
         previous one — and a three-metre jump between neighbouring vertices
         renders as a row of white spikes along the bedding plane. */
      const r = mix(resistOf(bi), resistOf(bi + 1), smoothstep(0.72, 1.0, bt));
      h += ramp * (r - 0.42) * 3.0;
    }

    /* ── fine relief, last ──
       World space, so it does not shear as the wash bends. Spread across the
       scales the eye checks at different distances; the pans are smoothed
       because still water leaves silt flat. */
    /* The active channel bed is graded by running water, so its long profile is
       nearly monotonic — the coarse octaves are suppressed inside it. Leaving
       them on puts half-metre swells every ten metres along the bed, and looking
       up-wash across one of those swells is precisely what reads as a crowned
       dirt road. What replaces them is riffle-and-pool: shallow scour hollows
       where the flow was fastest. */
    const inChan = 1 - smoothstep(f.wc * 0.45, f.wc + 1.6, av);
    const coarse = 1 - 0.88 * inChan;
    const flat = 1 - pan * 0.75;
    h -= inChan * 0.17 * smoothstep(0.48, 0.82, ridged(s * 0.062, u * 0.05, 2, 261));
    /* ── mid-field structure ──
       Bar margins and scour hollows at three to eight metres, with hard lips. This
       is the band the eye reads between fifteen and forty metres, and without it
       the floor dissolves into featureless smooth orange just past the near field
       — the detail donut. Grain and clasts cannot help at that distance because
       they are below a pixel; only relief a few tens of centimetres deep with a
       hard edge casting a shadow line survives that far. */
    if (floorZone > 0.02) {
      const bm = ridged(x * 0.155, z * 0.155, 2, 271);
      const lip = smoothstep(0.52, 0.66, bm);
      const hollow = smoothstep(0.62, 0.30, ridged(x * 0.093, z * 0.093, 2, 273));
      h += floorZone * flat * (lip * 0.20 - hollow * 0.16);
    }
    /* Held back deliberately. Smooth fBm at ten to thirty metres, at any
       amplitude the eye can see, reads as dune — rounded, continuously
       differentiable swells. The mid-scale relief on a wash floor is carried by
       the stepped bar margins above, which have hard risers. */
    h += (1 - ramp) * flat * (coarse * (0.34 * fbm(x * 0.036, z * 0.036, 3, 109)
                                      + 0.18 * fbm(x * 0.105, z * 0.105, 3, 111))
                            + 0.150 * fbm(x * 0.255, z * 0.255, 2, 113)
                            + 0.085 * fbm(x * 0.42, z * 0.42, 2, 114)
                            /* The floor of this term sits above three metres of
                               wavelength. Below that the grid cannot carry it and
                               it comes back as per-vertex speckle, not as grain —
                               grain at that scale is the normal map's job. */
                            + 0.030 * fbm(x * 0.34, z * 0.34, 2, 115))
       + ramp * (0.62 * fbm(x * 0.13, z * 0.13, 3, 119)
               + 0.13 * fbm(x * 0.30, z * 0.30, 2, 121));

    return h;
  }

  /** Height at the far-field crossover, so the blend starts from something
   *  continuous with the wall it is leaving. */
  _nearShoulder(f, x, z) {
    const wStart = f.ws + 8.5;
    const wRun = 21 + 15 * (0.5 + 0.5 * fbm(f.s * 0.011, f.side > 0 ? 101 : 137, 3, 73));
    const wallH = 16 + 16 * (0.5 + 0.5 * fbm(f.s * 0.0085, f.side > 0 ? 7 : 19, 3, 79));
    return 0.0125 * f.s + wallH + clamp(145 - (wStart + wRun), 0, 45) * 0.20
         + 4.0 * fbm(x * 0.031, z * 0.031, 3, 117);
  }
}

/* ── grid axes ─────────────────────────────────────────────────────────── */

/**
 * Segmented axis: explicit dense zones, then geometric expansion to the
 * horizon. The corridor and the wall faces both need real resolution — a
 * near-vertical cut bank is only a hard edge if a couple of grid columns land
 * on it — while the far field only has to exist.
 */
function axis(segments, outMin, outMax, growth) {
  const core = [];
  for (const [a, b, st] of segments) {
    const n = Math.max(1, Math.round((b - a) / st));
    for (let i = 0; i < n; i++) core.push(a + (b - a) * i / n);
  }
  core.push(segments[segments.length - 1][1]);
  const lo = [];
  let v = core[0], st = segments[0][2];
  while (v > outMin) { st *= growth; v -= st; lo.push(v); }
  lo.reverse();
  const hi = [];
  v = core[core.length - 1]; st = segments[segments.length - 1][2];
  while (v < outMax) { st *= growth; v += st; hi.push(v); }
  return Float32Array.from([...lo, ...core, ...hi]);
}

/* ── mesh ──────────────────────────────────────────────────────────────── */

export function buildTerrainMesh(terrain, material) {
  /* Graded in several steps rather than two. A step size that jumps from 0.20 to
     0.34 at a single column leaves a crease along that column — a dead straight
     line in world space, and the one thing a landscape never contains is a dead
     straight line. */
  const xs = axis([[-52, -30, 0.32], [-30, -17, 0.26], [-17, 17, 0.20],
                   [17, 30, 0.26], [30, 52, 0.32]], -1600, 1600, 1.12);
  const zs = axis([[-256, 14, 0.42]], -1900, 220, 1.14);

  const nx = xs.length, nz = zs.length;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const ref = new Float32Array(count);
  const pan = new Float32Array(count);
  const wall = new Float32Array(count);
  const q = {};

  for (let j = 0; j < nz; j++) {
    const z = zs[j];
    terrain.path.atZ(z, q);
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const k = row + i;
      const o = k * 3;
      pos[o] = x;
      pos[o + 1] = terrain.heightAtQ(x, z, q);
      pos[o + 2] = z;
      ref[k] = terrain.oRef;
      pan[k] = terrain.oPan;
      wall[k] = terrain.oWall;
    }
  }

  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRef', new THREE.BufferAttribute(ref, 1));
  g.setAttribute('aPan', new THREE.BufferAttribute(pan, 1));
  g.setAttribute('aWall', new THREE.BufferAttribute(wall, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'terrain';
  return mesh;
}

/* ── surface shader ────────────────────────────────────────────────────── */

const FRAG_PREFIX = /* glsl */`
uniform sampler2D uDirtA; uniform sampler2D uDirtN; uniform sampler2D uDirtM;
uniform sampler2D uSandA; uniform sampler2D uSandN; uniform sampler2D uSandM;
uniform sampler2D uRockA; uniform sampler2D uRockN; uniform sampler2D uRockM;
uniform sampler2D uMacro; uniform sampler2D uVar; uniform sampler2D uCrack;
uniform vec3  uDamp;
uniform vec3  uCool;
uniform vec3  uSilt;
uniform vec3  uStone;
uniform float uBedT;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vRef;
varying float vPan;
varying float vWall;

float tRough;
float tAO;
vec3  tNrmW;

vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

vec3 tsToWorld(vec3 n, vec3 N){
  vec3 ax = abs(N.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(ax - N * dot(ax, N));
  vec3 B = cross(T, N);
  return normalize(T * n.x + B * n.y + N * n.z);
}

vec3 triSample(sampler2D t, vec3 p, vec3 w, float sc){
  return texture2D(t, p.zy * sc).rgb * w.x
       + texture2D(t, p.xz * sc).rgb * w.y
       + texture2D(t, p.xy * sc).rgb * w.z;
}

vec3 triNormal(sampler2D t, vec3 p, vec3 w, float sc, vec3 N){
  vec3 nx = texture2D(t, p.zy * sc).xyz * 2.0 - 1.0;
  vec3 ny = texture2D(t, p.xz * sc).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(t, p.xy * sc).xyz * 2.0 - 1.0;
  nx = vec3(nx.xy + N.zy, abs(nx.z) * N.x);
  ny = vec3(ny.xy + N.xz, abs(ny.z) * N.y);
  nz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
  return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
}

/* Derivative bump: a scalar field to a normal perturbation without tangents.
   Used for the mud plates, whose relief is far too fine for geometry. */
vec3 bumpFrom(float hgt, vec3 N, float scale){
  vec3 pdx = dFdx(vWPos), pdy = dFdy(vWPos);
  float hdx = dFdx(hgt), hdy = dFdy(hgt);
  vec3 r1 = cross(pdy, N), r2 = cross(N, pdx);
  float det = dot(pdx, r1);
  vec3 grad = sign(det) * (hdx * r1 + hdy * r2);
  return normalize(abs(det) * N - scale * grad);
}
`;

const SURFACE = /* glsl */`
vec3 gN = normalize(vWNrm);
vec2 wxz = vWPos.xz;

/* Three scales of variation. The 61 m and 18 m maps break up the detail tiles;
   the 7 m map exists to fill the mid distance, where a two-scale scheme leaves
   a hole and the ground collapses into flat colour. */
vec4 mac  = texture2D(uMacro, wxz * 0.0164);
vec4 mac2 = texture2D(uMacro, rot2(wxz, 1.13) * 0.0555);
vec4 vr   = texture2D(uVar,   rot2(wxz, 0.47) * 0.1428);

float slope = 1.0 - clamp(gN.y, 0.0, 1.0);
/* Bare rock only on genuinely steep faces. A cut bank at forty degrees is not
   rock, it is a section through alluvium, and putting a jointed sandstone map on
   it makes the bank look tiled. */
float wallM = smoothstep(0.06, 0.42, vWall);
/* On the wall ramp, rock is the default rather than the exception. Requiring a
   steep slope *as well* left the whole lower two-thirds of every wall wearing the
   dirt map, and with the dirt now carrying a large dust component that came out as
   a grey concrete skirt below a red cap — a horizontal material seam at constant
   elevation, which is one of the things the walls were criticised for. A canyon
   wall is rock from its foot to its rim; what covers the foot is the talus apron,
   and that lives outside the wall ramp entirely. */
float rockW = wallM * (0.34 + 0.66 *
    smoothstep(0.16, 0.58, slope + (mac2.g - 0.5) * 0.26 + (vr.g - 0.5) * 0.16));

/* ---- compacted dirt, two nearby scales ----
   Close in size and irrationally related, so grain and clasts stay the right
   physical size in both while the pattern decorrelates. */
vec2 d1 = wxz * 0.3846;               // 2.6 m tile
vec2 d2 = rot2(wxz, 0.83) * 0.2326;   // 4.3 m tile
float dB = clamp(mac.g * 1.50 - 0.65, 0.12, 0.88);
vec3 dirtA = mix(texture2D(uDirtA, d1).rgb, texture2D(uDirtA, d2).rgb, dB);
vec3 dirtN = mix(texture2D(uDirtN, d1).xyz, texture2D(uDirtN, d2).xyz, dB) * 2.0 - 1.0;
vec3 dirtM = mix(texture2D(uDirtM, d1).rgb, texture2D(uDirtM, d2).rgb, dB);

/* ---- drifted sand ---- */
vec2 s1 = rot2(wxz, 0.35) * 0.4545;   // 2.2 m tile
vec3 sandA = texture2D(uSandA, s1).rgb;
vec3 sandN = texture2D(uSandN, s1).xyz * 2.0 - 1.0;
vec3 sandM = texture2D(uSandM, s1).rgb;

/* A sand sheet ends in a crisp depositional lobe, not a crossfade. Hard
   threshold on a lobe-shaped field rather than a wide smoothstep. */
float sandF = mac.r * 1.15 + (mac2.r - 0.5) * 0.55 + (vr.b - 0.5) * 0.30;
/* Pulled back. A sand sheet covering half the floor turns the wash into a dune
   field: smooth, pale, featureless ramps with no clast structure in them at all,
   which is what the terrace ramps had become. Sand belongs in the slack water on
   the inside of bends and nowhere else. */
/* Silt pans win over sand where they overlap: both want the slack water on the
   inside of a bend, and if sand takes it the mud has nowhere left to be. */
float panRaw = smoothstep(0.10, 0.50, vPan);
float sandW = smoothstep(0.62, 0.68, sandF) * (1.0 - rockW)
            * smoothstep(0.30, 0.10, slope) * (1.0 - panRaw * 0.9);

vec3 gA  = mix(dirtA, sandA, sandW);
vec3 gNt = normalize(mix(dirtN, sandN, sandW));
vec3 gM  = mix(dirtM, sandM, sandW);
vec3 gWN = tsToWorld(gNt, gN);

/* ---- steep ground: reproject ----
   The dirt above is sampled from a top-down XZ projection, which is correct on
   the floor and progressively wrong as the ground tips up. On the face of a cut
   bank it is close to vertical, so a metre of face draws from a couple of
   centimetres of texture: every feature smears into a long streak, all of them
   parallel, and the bank ends up looking brushed. That smear was the strongest
   remaining artefact on the banks — it was hidden before only because the
   triplanar rock map used to cover them. Triplanar the dirt too, and blend it in
   by slope so the flat floor keeps the cheap two-scale sample. */
vec3 triW = pow(abs(gN), vec3(4.0));
triW /= max(triW.x + triW.y + triW.z, 1e-4);
float steep = smoothstep(0.14, 0.40, slope);
if (steep > 0.006) {
  /* Only the two vertical projections are needed: the sample above already is
     the horizontal one, so this blends against it rather than recomputing it. */
  float ax = abs(gN.x), az = abs(gN.z);
  float pw = ax / max(ax + az, 1e-4);
  vec2 uzy = vWPos.zy * 0.3846, uxy = vWPos.xy * 0.3846;
  vec3 pA = mix(texture2D(uDirtA, uxy).rgb, texture2D(uDirtA, uzy).rgb, pw);
  vec3 pM = mix(texture2D(uDirtM, uxy).rgb, texture2D(uDirtM, uzy).rgb, pw);
  vec3 pN = mix(texture2D(uDirtN, uxy).xyz, texture2D(uDirtN, uzy).xyz, pw) * 2.0 - 1.0;
  float w = steep * (1.0 - sandW);
  gA  = mix(gA, pA, w);
  gM  = mix(gM, pM, w);
  gWN = normalize(mix(gWN, tsToWorld(normalize(pN), gN), w));
}

/* ---- desiccation cracks ----
   Only in ponded silt: vPan comes from the pans carved into the height field,
   so the mud is where mud could actually have dried. Plate tops go dusty buff,
   crack interiors go genuinely dark, and the plates curl up at their edges,
   which at this sun angle is what throws the hard shadow lines that make real
   mud cracks dramatic. */
/* Sand is not allowed to erase the pans, only rock is. A silt pan and a sand
   sheet occupy the same slack-water positions, so gating the mud on the absence of
   sand meant that wherever the mask said "still water" it also said "sand" and the
   cracks were cancelled everywhere — which is why two rounds of work on them
   produced a scene with no mud cracks in it anywhere. */
float panW = panRaw * smoothstep(0.24, 0.06, slope) * (1.0 - rockW);
/* One scale only, at 2.6 m, giving plates from about 40 cm down to 13 cm. A
   second finer tile put 5 cm plates on the ground, which alias into a hard
   chequer at any grazing angle and cannot be seen from more than a stride away
   in any case. */
vec3 ck = texture2D(uCrack, rot2(wxz, 2.10) * 0.3846).rgb;
/* Plate tops are dusty buff and genuinely lighter than the gravel around them;
   the crack interiors are genuinely dark. Relying on the curl ridge alone to
   sell the mud leaves a net of bright wires over unchanged ground. */
float crackH = (ck.b * 1.10 - ck.r * 2.4) * panW;
gWN = bumpFrom(crackH, gWN, 0.135);
gA = mix(gA, gA * uSilt * (0.80 + ck.g * 0.46), panW * 0.95);
gA *= 1.0 - ck.r * panW * 0.68;
gM.g = mix(gM.g, 0.99, panW * 0.6);
gM.r *= 1.0 - ck.r * panW * 0.55;

/* ---- stratified alluvium on the bank faces ----
   A cut bank is a section, and a section through flood deposits is layered: a
   coarse gravelly bed a few centimetres thick, then a sandy one, then another,
   each standing slightly proud or slightly recessed. It is the only place in the
   scene where the ground has horizontal structure keyed to world height rather
   than to the surface, and that structure is most of what tells the eye it is
   looking at a cut face rather than at a slope. */
/* Banks only, never the canyon wall — vWall separates them — and only on the
   steep part, in patches. Run across every moderate slope in the scene it stops
   being stratification and becomes pinstripe. */
float bankW = smoothstep(0.28, 0.52, slope) * (1.0 - wallM) * (1.0 - sandW)
            * smoothstep(0.34, 0.68, mac2.r * 0.7 + vr.b * 0.5);
if (bankW > 0.004) {
  /* Bed thickness is itself variable — from about 8 cm to about 40 cm — because
     each bed is one flood and no two floods carried the same load. A constant
     spacing is the difference between stratification and corrugation. */
  float th = 4.0 + 9.0 * mac.b;
  float by  = vWPos.y * th + (mac2.b - 0.5) * 2.20 + (vr.r - 0.5) * 0.85;
  float bid = floor(by);
  float bfr = by - bid;
  float coarse = smoothstep(0.42, 0.58, 0.5 + 0.5 * sin(bid * 1.913 + 0.6));
  /* Hard top and bottom contacts. A bed with soft edges is a gradient, and a
     gradient at constant height is the altitude colour ramp this replaces. */
  float inBed = smoothstep(0.0, 0.10, bfr) * (1.0 - smoothstep(0.88, 1.0, bfr));
  float bw = bankW * inBed;
  /* Low contrast on purpose. Stratification the eye has to look for reads as a
     section through alluvium; stratification it cannot avoid reads as
     corrugated iron, and the relief matters far more than the tone — a visible
     step at every contact turns a bank into a flight of stairs. */
  gA *= mix(vec3(1.0), mix(vec3(0.88, 0.83, 0.80), vec3(1.13, 1.05, 0.93), coarse), bw * 0.34);
  gM.g = mix(gM.g, mix(0.99, 0.88, coarse), bw * 0.4);
  gWN = bumpFrom((coarse - 0.5) * inBed * bankW, gWN, 0.022);
}

/* ---- wall rock, triplanar so vertical faces do not smear ---- */
vec3 rockA = triSample(uRockA, vWPos, triW, 0.0715);   // 14 m tile
vec3 rockM = triSample(uRockM, vWPos, triW, 0.0715);
vec3 rockWN = triNormal(uRockN, vWPos, triW, 0.0715, gN);

/* ---- stratigraphy ----
   Same bed index and resistance function the height field used, driven by the
   pre-bench elevation, so the pale bed and the ledge are one feature. The
   contact is a hard seam because real bedding contacts are. */
float bedF = vRef;
float bedI = floor(bedF);
float bedFr = bedF - bedI;
float resist = smoothstep(0.30, 0.72, 0.5 + 0.5 * sin(bedI * 2.399 + 1.7));
/* The whole bed changes colour, with a hard contact at its base. Deliberately
   no thin seam on the contact itself: a bright hairline at every boundary is
   what turns bedding into cross-hatching. */
rockA *= mix(vec3(0.82, 0.62, 0.55), vec3(1.20, 1.12, 1.00), resist * smoothstep(0.0, 0.20, bedFr));
rockM.g = clamp(rockM.g * mix(1.06, 0.90, resist), 0.2, 1.0);

vec3 albedo = mix(gA, rockA, rockW);
vec3 arm    = mix(gM, rockM, rockW);
vec3 wN     = normalize(mix(gWN, rockWN, rockW));

/* ---- tonal and hue variance ----
   The failure this fixes is a palette spanning twenty-five degrees of hue.
   Patches go grey-violet where iron has leached or a varnish has formed, and
   pale buff where fine dust settled; without that spread every surface is the
   same colour at a different brightness. */
/* Tonal range pulled in. At the previous spread this could reach 1.36, and a
   patch of ground 36 percent brighter than its neighbours, seen at thirty metres
   through a warm haze, does not read as a patch of ground — it reads as a soft
   pale blob floating over the midground, which is exactly what it was mistaken
   for. Variance in value has to stay below the threshold where it competes with
   atmospheric depth. */
float bright = (0.72 + mac.g * 0.48) * (0.90 + mac2.g * 0.20) * (0.92 + vr.g * 0.18);
albedo *= bright;
/* Not on the mud: dried silt goes dusty buff, and a violet cast over it turns
   the pans into lilac lace. */
/* The grey-violet patches are patches. Run at half strength over most of the
   frame this is not variance, it is a desaturation pass: Sedona dirt is hematite,
   and hematite is a saturated red, not a pale magenta. */
float coolP = smoothstep(0.56, 0.86, vr.r) * (1.0 - rockW * 0.5) * (1.0 - panW);
albedo = mix(albedo, dot(albedo, vec3(0.31, 0.52, 0.17)) * uCool, coolP * 0.34);
albedo = mix(albedo, albedo * vec3(1.12, 1.05, 0.96), smoothstep(0.34, 0.72, vr.b) * 0.40);
float cav = mac.a;
float damp = clamp((1.0 - arm.r) * 0.60 + (1.0 - cav) * 0.40, 0.0, 1.0);
albedo = mix(albedo, albedo * uDamp, damp * 0.72);

/* ---- the achromatic base ----
   The iron oxide is a stain on quartz sand that is pale grey-buff underneath, and
   every exposed surface in a desert carries dust. So the mineral has a large
   achromatic component, and a fully saturated red is not what any of this is made
   of. Measured, the previous grade ran at roughly twice the saturation of a
   photograph of the place — the signature of Mars and the Pilbara rather than
   Sedona. This mixes a grey-buff floor underneath rather than desaturating
   uniformly, so lit faces keep their warmth and shadows fall back toward stone.
   The floor gets more of it than the walls: a wash bed is the dustiest surface
   in the landscape and measures almost achromatic. */
float aLum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
float dustW = mix(0.44, 0.22, rockW) * (1.0 - panW * 0.4);
albedo = mix(albedo, aLum * uStone, dustW);

diffuseColor.rgb *= albedo;
/* Dry sandstone and dirt have no specular lobe worth the name. Letting roughness
   reach 0.30 put a white sparkle on every sunlit crest — the surface read as wet
   or glittery, and a hard low key makes that worse because the highlight lands on
   whatever facet happens to face it. */
tRough = clamp(arm.g * (0.96 + (mac2.g - 0.5) * 0.14), 0.72, 1.0);
tAO    = clamp(arm.r * (0.74 + cav * 0.36), 0.34, 1.0);
tNrmW  = wN;
`;

export function makeTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.0, dithering: true,
  });
  mat.userData.uniforms = {
    uDirtA: { value: tex.dirt.albedo }, uDirtN: { value: tex.dirt.normal }, uDirtM: { value: tex.dirt.arm },
    uSandA: { value: tex.sand.albedo }, uSandN: { value: tex.sand.normal }, uSandM: { value: tex.sand.arm },
    uRockA: { value: tex.rock.albedo }, uRockN: { value: tex.rock.normal }, uRockM: { value: tex.rock.arm },
    uMacro: { value: tex.macro }, uVar: { value: tex.variance }, uCrack: { value: tex.crack },
    uDamp: { value: new THREE.Color(0.56, 0.44, 0.54) },
    uCool: { value: new THREE.Color(1.02, 0.94, 1.10) },
    uSilt: { value: new THREE.Color(1.14, 1.06, 0.94) },
    /* pale grey-buff quartz sand: what the oxide is a coating on */
    uStone: { value: new THREE.Color(1.06, 1.00, 0.94) },
    uBedT: { value: BED_T },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader =
      'attribute float aRef;\nattribute float aPan;\nattribute float aWall;\n' +
      'varying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vRef;\nvarying float vPan;\n' +
      'varying float vWall;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '  vRef = aRef;\n  vPan = aPan;\n  vWall = aWall;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);');

    shader.fragmentShader = FRAG_PREFIX + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= tAO;');
  };
  mat.customProgramCacheKey = () => 'sedona-terrain-v3';
  return mat;
}
