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
 * Per-vertex outputs travel with the mesh, each so that the shader can put a
 * material exactly where the geomorphology put the deposit:
 *   aRef    elevation *before* the stratigraphic benching pass, so band colour
 *           lands exactly where the geometry put the ledge
 *   aPan    ponded-silt coverage, so mud cracks appear only where mud could form
 *   aWall   canyon wall against wash bank, which slope alone cannot distinguish
 *   aSheet  slack-water sand sheet, so drifted sand is deposited by a mechanism
 *           rather than painted onto whatever happens to be flat
 *   aFlow   how deep the last flood ran here, 1 in the thalweg to 0 on the
 *           terrace. Ripple wavelength scales with flow depth — that is the
 *           relationship, not a stylistic one — so the bedform in the shader
 *           needs to know it, and a wash floor combed at one pitch from bank to
 *           bank is the corduroy this has twice been criticised for.
 */
import * as THREE from 'three';
import { fbm, ridged, clamp, smoothstep, mix } from './noise.js';
import { SUN_DIR, SUN_EL } from './sky.js';
import { DIRT_RELIEF_K } from './textures.js';

/* The grain bed's depth, from the one place it is stated. 25 mm per height unit
   times K. Both the sun's climb through the height field and the geometric
   march's reach are derived from it, so a deeper bed automatically gets the
   longer shadows it casts rather than the same short ones sampled differently. */
const DIRT_RELIEF_M = 0.025 * DIRT_RELIEF_K;
const RAKE_NEAR = 0.0025;                                  // metres, first sample
/* 88 mm is what the height channel's full 24 mm range casts at this sun, and it
   was measured rather than picked; a deeper bed casts further, so the reach
   scales with K and the ratio with K^(1/7).
   Written as a scaling of the hand-computed 1.663 rather than recomputed from
   the reach, so that K = 1 emits the literal 1.66300 — the same value the
   shipped shader had, exactly, and therefore an exact no-op. That is not
   pedantry: `rake` is a max() over the samples, so it is a threshold, and
   recomputing the ratio to five decimals instead of three moved the reach by
   0.03 mm out of 88 and flipped 0.0945% of bytes in `ground` by up to 41/255.
   A tiny change to a reduction is not a tiny change to its output. */
const RAKE_RATIO = 1.663 * Math.pow(DIRT_RELIEF_K, 1 / 7);
const RAKE_FAR = RAKE_NEAR * Math.pow(RAKE_RATIO, 7);      // for the comment only
/* Tonight's wind, which is not the same quantity as the prevailing wind the
   juniper's lean records. A drift of sand was deposited this evening, so it
   belongs to tonight's wind along with the gust bed and the saltation, and
   audio.js is that authority: `windAt` is analytic, deterministic and public.
   `syncWind` below reads it. This is only the fallback for a material built
   before the audio exists, and it is deliberately the same 0.12 rad down-wash
   heading so a page with a dead audio context still agrees with itself. */
/* How much of the colluvial apron the drainage channel cuts away on the axis,
   and how wide that channel is. See `_headRise`. Named here rather than inline
   because they are the two numbers anyone re-opening the arrival will want to
   move, and because the sight line to the amphitheatre depends on both. */
const BREACH = 0.55;
const CHAN_W = 9.5;
/* The breach is narrower than the pour-off notch it hands off to, and that is
   not cosmetic. `CHAN_W` is the notch's original width and `far_270` sees that
   notch from fifty metres upstream, so changing it moves the highest-scoring
   frame in the set — measured, 10.10 deg to 12.07 at CHAN_W 4. The breach needs
   its own width for a separate reason: System 2's talus toes reach in to |x| 4.4
   at this station, and a cut that goes under them leaves their aprons standing
   on nothing, which is what a first pass at 9.5 did. */
const BREACH_W = 11.0;

const TONIGHT_FALLBACK = 0.12;

/* Scour hollow geometry. SC_IN is where the stone's own footing ends and the pit
   begins, SC_OUT where the pit dies, both in radii of the stone. SC_CELL is the
   lookup grid, comfortably wider than the widest footprint. */
const SC_IN = 0.95, SC_OUT = 2.60, SC_CELL = 4.0;

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

/* ── the sampling grid, as a value rather than as a number in a comment ─────
 *
 * These two tables are the single definition of where the mesh puts its rows
 * and columns. `buildTerrainMesh` builds its axes from them and `meshStepX` /
 * `meshStepZ` below read the built axes back, so any displacement term that
 * needs to know the sampling rate can *ask* instead of quoting a figure.
 *
 * This exists because of a real defect. The band-limit reasoning above `swA`
 * stated the grid as "0.20 m across and 0.42 m along" and worked out how many
 * octaves were safe from those two numbers. Extending the z-table to reach the
 * wash head later put 0.615 m rows into the head zone, which quietly falsified
 * that reasoning — the comment was a hundred lines from the table and nothing
 * connected them. The isotropic fine-relief term whose finest octave sits at
 * 1.17 m was safe against the floor's 0.84 m Nyquist and aliased against the
 * head's 1.23 m, and it came back as a diamond lattice of dark facets on a bank
 * at 270 m that took a day to attribute.
 *
 * The general rule, which is the reusable part: **a sampling argument that
 * quotes a constant from elsewhere in the file is a landmine, and it goes off
 * in a framing nobody is looking at.** Read the spacing.
 */
const X_SEG = [[-52, -30, 0.32], [-30, -17, 0.26], [-17, 17, 0.20],
               [17, 30, 0.26], [30, 52, 0.32]];
const Z_SEG = [[-404, -320, 0.86], [-320, -280, 0.62],
               [-280, -256, 0.48], [-256, 14, 0.42]];
const X_AXIS = axis(X_SEG, -1600, 1600, 1.12);
const Z_AXIS = axis(Z_SEG, -1900, 220, 1.14);

/**
 * Local spacing of a sorted axis at `v`, by bisection on the axis itself.
 *
 * Blended with the neighbouring cell rather than returned raw. The raw gap is a
 * staircase — it jumps 0.48 to 0.62 at one row — and anything that scales an
 * amplitude by it would step at that row, which is a dead straight line across
 * the wash and the exact artefact the graded axis exists to avoid. Blending by
 * distance from the cell centre makes the spacing continuous: both sides of a
 * boundary agree on the mean of the two gaps.
 */
function stepOf(ax, v) {
  const n = ax.length - 1;
  if (v <= ax[0]) return ax[1] - ax[0];
  if (v >= ax[n]) return ax[n] - ax[n - 1];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ax[m] > v) hi = m; else lo = m; }
  const g = ax[hi] - ax[lo];
  const t = (v - ax[lo]) / g - 0.5;
  const j = t < 0 ? lo - 1 : hi + 1;
  if (j < 0 || j > n) return g;
  const gn = t < 0 ? ax[lo] - ax[j] : ax[j] - ax[hi];
  return g + (gn - g) * Math.abs(t);
}
export const meshStepX = (x) => stepOf(X_AXIS, x);
/* Three taps over about two metres. The z axis is the graded one, and one cell
   of blending is not quite enough to keep a 0.48-to-0.86 transition from
   reading as a ramp across the channel. */
export const meshStepZ = (z) =>
  (stepOf(Z_AXIS, z - 1.1) + stepOf(Z_AXIS, z) + stepOf(Z_AXIS, z + 1.1)) / 3;

/* Finest wavelength an fbm of this base frequency and octave count contains,
   given the lacunarity fbm() actually uses. */
const LAC = 2.03;
const fineLambda = (freq, oct) => 1 / (freq * Math.pow(LAC, oct - 1));

/**
 * Attenuation for a displacement term whose finest octave is `lambda` metres,
 * sampled by a grid of spacing `d`. One at three samples per wavelength and
 * above, zero at two, which is Nyquist and the point the term stops being
 * relief and starts being per-vertex speckle.
 *
 * The window is deliberately 1.8–2.6 rather than 2.0–3.0. Everything on the
 * floor was authored and verified against 0.42 × 0.20 m rows, and some of it
 * sits close to the limit on purpose; a window starting at 2.0 would pull
 * amplitude out of the near field, which is measured good and is not what is
 * broken. 1.8–2.6 is a no-op at the authored spacing and bites only where the
 * grid is coarser than the term was written for.
 */
const gridK = (lambda, d) => smoothstep(1.8, 2.6, lambda / d);

/**
 * Terms that are authored hard against the grid on purpose and cannot be faded
 * without undoing measured work — the bar roughness is deliberately elongated
 * ten to one so it sits just inside the across-channel spacing, and that is the
 * whole design of it. They get a boot check instead of a gate: if anyone
 * coarsens the axis under them, this says so with the numbers rather than
 * letting it come back as a lattice in a framing nobody is looking at.
 */
const BAND_LIMITED = [
  { name: 'swA bar roughness', fx: 1.12, fz: 0.115, oct: 2 },
  { name: 'swB swale crease',  fx: 0.80, fz: 0.082, oct: 2 },
];

/* Scoped to the dense core of each axis, which is where these terms are meant
   to be read: the 0.20 m x segment they were written against, and the full
   authored z run out to the head. Beyond the core the axis expands
   geometrically and nothing is claimed about it. */
function assertBandLimits() {
  let dx = 0, dz = 0;
  for (let i = 1; i < X_AXIS.length; i++)
    if (X_AXIS[i] > -17 && X_AXIS[i - 1] < 17) dx = Math.max(dx, X_AXIS[i] - X_AXIS[i - 1]);
  for (let i = 1; i < Z_AXIS.length; i++)
    if (Z_AXIS[i] > -404 && Z_AXIS[i - 1] < 14) dz = Math.max(dz, Z_AXIS[i] - Z_AXIS[i - 1]);
  const bad = [];
  for (const t of BAND_LIMITED) {
    const rx = fineLambda(t.fx, t.oct) / dx, rz = fineLambda(t.fz, t.oct) / dz;
    if (rx < 2 || rz < 2) bad.push(
      `  ${t.name}: ${rx.toFixed(2)} samples/wavelength across (dx ${dx.toFixed(3)} m), ` +
      `${rz.toFixed(2)} along (dz ${dz.toFixed(3)} m)`);
  }
  if (bad.length) throw new Error(
    'terrain: displacement term is now below the mesh Nyquist and will alias as a ' +
    'regular lattice of facets.\n' + bad.join('\n') +
    '\nEither restore the spacing in X_SEG / Z_SEG, drop an octave from the term, ' +
    'or move it behind gridK() so it fades with the local grid.');
}

/* ── height field ──────────────────────────────────────────────────────── */

export class Terrain {
  constructor(path) {
    this.path = path;
    this._q = {};
    this._f = {};
    this._f2 = {};
    this.oRef = 0;   // pre-bench elevation
    this.oPan = 0;   // ponded silt coverage
    this.oSheet = 0; // slack-water sand sheet coverage
    this.oFlow = 0;  // flow depth of the last flood, 1 in the thalweg
    this._scour = null;   // lazily built; see addScour
  }

  /* ── scour hollows ───────────────────────────────────────────────────────
   *
   * "No clast burial or scour geometry" has been named by four critics running,
   * and the last round answered the burial half — clasts sink, they get a fillet
   * of banked fines and a depositional tail — while leaving the scour half as
   * decoration. Nothing was actually *excavated*. A stone sitting in a dish it
   * dug is a different silhouette from a stone sitting in a dish drawn around
   * it, and at a low sun the difference is the whole thing: the pit's upstream
   * wall is a real shadow cast on real ground.
   *
   * So this is a genuine deformation of the height field. The shape is the one
   * an obstacle in alluvium actually produces: a horseshoe open downstream. The
   * flow divides against the upstream face, the horseshoe vortex scours the
   * upstream shoulders and both flanks hardest, and the sediment it lifts is
   * dropped immediately behind in the separation shadow as a low mound. It is
   * zero directly under the stone, because the stone is *supported* by the bed
   * there — which is also why this needs no cooperation from the seating code.
   *
   * Only boulders qualify, and that is a resolution limit rather than a choice.
   * The grid is 0.20 m in x but 0.42 m in z, so a hollow has to be a couple of
   * metres across before the mesh can express it at all; a 0.46 m boulder gives
   * one 2.4 m across, which is five z-columns. A cobble's would be 1 m across —
   * two columns, which is a dimple, not a pit. Below that size the fillet and
   * the burial remain the model, and they are the right model, because a cobble
   * genuinely does not scour a hole you could see from standing height.
   *
   * Registered during the clast scatter and folded into `heightAtQ`, so the
   * player walks in the hollows and everything placed afterwards — the fillets,
   * the tails, the collar stones — sits on the excavated bed rather than on the
   * surface that used to be there. The mesh is built before the clasts exist, so
   * `applyScour` below re-levels it afterwards.
   */
  addScour(x, z, rad, dnX, dnZ, depth) {
    if (!this._scour) this._scour = new Map();
    const out = rad * SC_OUT;
    const s = { x, z, r: rad, dx: dnX, dz: dnZ, d: depth };
    /* Inserted into every cell its footprint touches, so a query reads exactly
       one cell and never has to widen to a neighbourhood. */
    const i0 = Math.floor((x - out) / SC_CELL), i1 = Math.floor((x + out) / SC_CELL);
    const j0 = Math.floor((z - out) / SC_CELL), j1 = Math.floor((z + out) / SC_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = i * 73856093 ^ j * 19349663;
        let l = this._scour.get(k);
        if (!l) this._scour.set(k, l = []);
        l.push(s);
      }
    }
  }

  /** Signed height delta from every registered hollow. Negative is excavated. */
  scourAt(x, z) {
    if (!this._scour) return 0;
    const i = Math.floor(x / SC_CELL), j = Math.floor(z / SC_CELL);
    const l = this._scour.get(i * 73856093 ^ j * 19349663);
    if (!l) return 0;
    let tot = 0;
    for (let n = 0; n < l.length; n++) {
      const s = l[n];
      const dx = x - s.x, dz = z - s.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const t = dist / s.r;
      if (t >= SC_OUT || t <= SC_IN) continue;
      /* Radial envelope: nothing under the stone, a smooth lobe out to SC_OUT. */
      const env = Math.sin(Math.PI * (t - SC_IN) / (SC_OUT - SC_IN));
      /* Downstream-ness of this sample about the stone, +1 dead astern. */
      const c = dist < 1e-5 ? 0 : (dx * s.dx + dz * s.dz) / dist;
      /* 1 upstream and on the flanks, 0 in the lee. The flanks land near 0.46,
         which is what makes it a horseshoe rather than a crescent. */
      const dig = smoothstep(-0.62, 0.72, -c);
      tot += s.d * env * (0.36 * (1 - dig) - dig);
    }
    return tot;
  }

  /**
   * Slack-water sand sheet: where the flow was slow enough to drop its fine
   * fraction and not strong enough to leave a coarse lag. The inside of a bend,
   * clear of the active channel.
   *
   * Split out so the mesh can carry it to the shader. Sand was being placed on a
   * slope test alone, and a slope test cannot tell a bar top from a channel bed —
   * so a pale sheet glazed the whole floor including the thalweg, which is the one
   * place a flood scours down to gravel every time. Deposition is a mechanism, and
   * the mechanism is already in `facies`; this is the same expression, hoisted so
   * both the clast scatter and the surface shader read one answer.
   */
  sheetField(x, z, f) {
    return (1 - f.bendOut)
      * smoothstep(0.44, 0.68, 0.5 + 0.5 * fbm(x * 0.048, z * 0.048, 3, 241))
      * smoothstep(f.wc + 0.5, f.wc + 3.0, f.av);
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

    /* ── the head of the wash ────────────────────────────────────────────────
     * Every drainage starts somewhere. This one did not: the cross-section was a
     * function of arc length with no terminating condition, so the channel ran
     * on past the end of the path table as a uniform extrusion, and a walker who
     * used the number keys to jump to the far end of the walk arrived at the
     * edge of the built world and stared straight at it.
     *
     * Closing it is done by taking the widths to nothing rather than by putting
     * a wall across, because a wall across a channel is a dam and reads as one.
     * A real wash head is a place where the channel simply runs out: the flow
     * that cut it was collected from a slope rather than delivered by an
     * upstream reach, so the bed shallows, the banks lose their height, the
     * whole section narrows to a scour line and then to nothing, and what is
     * left is the hillside the water came off. Everything below is the same
     * cross-section machinery with its widths driven to zero, which means the
     * transition cannot seam — there is no second landform to blend into.
     *
     * Driven from z rather than from s deliberately. Arc length comes from the
     * path table, which clamps at its last row, so every s-dependent term in
     * this file freezes there and freezing is the one behaviour a terminating
     * condition must not have. z keeps counting. */
    const hd = z > -274 ? 0 : smoothstep(-274, -332, z);
    out.hd = hd;
    if (hd > 0) {
      /* The channel goes first and fastest — a wash head is recognisable
         because the thing you have been walking in disappears from under you. */
      out.wc *= 1 - 0.88 * hd;
      out.wt *= 1 - 0.80 * hd;
      out.ws *= 1 - 0.62 * hd;
      out.dc *= 1 - 0.94 * hd;
      /* Cut banks need flow against an outside bend to exist and there is no
         flow left up here, so they die with the channel that made them. */
      out.hb *= 1 - hd;
    }
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
    const sheet = this.sheetField(x, z, f);
    bar = Math.max(0, bar - sheet * 1.3);

    /* Coarse lag concentrates in bands where the flood was steepest, and
       between them the bed is scoured bare. Constant density is the loudest
       tell that stones were placed by a loop. */
    const lag = smoothstep(0.42, 0.80, ridged(f.s * 0.028, 0.5, 2, 261));
    /* Stringers. A flood does not lay its coarse fraction down evenly even inside
       a lag band: competence varies across the channel as well as along it, so the
       cobbles collect into ribbons a metre or two wide drawn out along the flow,
       with swept ground between them. Anisotropic on purpose — ten times the
       correlation length along the wash as across it — because that elongation is
       the part the eye reads as current. Multiplied into the coarse classes, this is
       what turns one constant areal density into a patchy bed. */
    const string = smoothstep(0.40, 0.74,
      0.5 + 0.5 * fbm(f.u * 0.62 + 40, f.s * 0.062, 3, 281));
    const bare = Math.max(
      smoothstep(0.50, 0.70, 0.5 + 0.5 * fbm(x * 0.032, z * 0.032, 3, 251)),
      smoothstep(0.58, 0.78, 0.5 + 0.5 * fbm(x * 0.110, z * 0.110, 2, 253)));

    /* Nothing coarse rests on dried mud — the flood that laid the silt down had
       already dropped everything heavier upstream. */
    const pan = this.panField(x, z, f);

    /* Rockfall is episodic and it arrives down the gullies, so an apron is a run
       of heaps with swept ground between them, not an even sprinkle.
       Sharpened, and the reason is a critique of the pale blocks: "one or two
       conspicuous blocks in a frame is the reference; a field of them is not".
       The floor here was 0.10, which is small but never zero, so every square
       metre of apron got a background sprinkle and the lobes were a modulation on
       top of an even field rather than the whole story. At 0.02 the ground
       between heaps is genuinely swept.
       The peak came *down* from 1.65 at the same time, and it has to: the
       placement test clamps the weight to one, so a peak well above one means
       every candidate inside a lobe is accepted, and sharpening the field without
       lowering its peak just funnels the same total count into a smaller area.
       The first attempt did exactly that and put a pile of blocks in the near
       field denser than the even sprinkle it replaced.
       The lobes are also larger — a 25 m
       wavelength rather than 18 — because a rockfall lobe is the debris of one
       event off one gully, and there are not that many gullies. */
    const pile = 0.02 + 1.15 * smoothstep(0.50, 0.86, 0.5 + 0.5 *
      fbm(x * 0.040, z * 0.040, 3, 271));

    /* ---- the head's colluvial slopes ----
     * Named as "smooth surfaces with parallel diagonal streaks, pale specks
     * smeared into elongated tails along the slope direction — stretched UV, not
     * colluvium". Magnified, the streaks are individual platy clasts, each
     * foreshortened into a sliver by a grazing view of a slope they all share and
     * therefore all elongated the same way. That is geometrically correct; what
     * makes it read as a smear is that the slope has nothing else on it. A real
     * colluvial slope is graded — coarse angular blocks gathering toward the toe
     * where gravity took them, fines held higher up — so the cure is a population
     * that changes down the slope, not a projection fix.
     *
     * `headT` is the toe weighting: strongest on the lower half of the slope,
     * because a block that came off the rim does not stop halfway. */
    const hav = Math.abs(f.u);
    const head = smoothstep(-290, -330, z) * smoothstep(5.0, 16.0, hav);
    /* Held to the toe. Measured, the head's flanks run a gradient of 0.7 to 2.0
       from about fourteen metres out, which is past every coarse class's own
       maxSlope gate, so weighting blocks onto the mid-slope would simply have
       them rejected and changed nothing. It is also the right answer physically:
       a block comes to rest where the slope flattens. The steep part above stays
       bare, and what breaks it up there is the rilling, not the clasts. */
    const headT = head * (1 - smoothstep(10.0, 26.0, hav));
    return { chan, bar, terr, tal, talPos, sheet, bare, lag, string, pan, pile,
             head, headT, f };
  }

  heightAtQ(x, z, q) {
    const f = this.frame(x, z, q);
    const { s, u, av, side, bendOut } = f;
    this.oPan = 0;
    this.oWall = 0;
    this.oSheet = 0;
    this.oFlow = 0;

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
      const h = mix(near, fh, far) + this._headRise(x, z);
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

      /* ---- and the octaves underneath them, which were empty ──────────────
       * The three staircases above are metre-to-decametre forms and there was
       * nothing below them at all. tools/_bandprobe.mjs measured the floor's
       * slope per octave and it rises monotonically into the metre band — 0.021
       * at 5-10 cm against 0.114 at 1.6-3.2 m — where a self-affine natural
       * surface holds it roughly constant. A user walking the scene called the
       * result "melting", and that is exactly what a spectrum shaped like this
       * looks like: large smooth forms with glassy flanks. The staircases were
       * themselves a fix for the same complaint, softened afterwards to stop
       * their risers snapping to the grid, and the softening is what made them
       * wax. So the answer is to roughen their flanks rather than to add more of
       * them, and the failure mode on each side is known — too hard reads as
       * poured concrete, too soft reads as poured wax.
       *
       * Strongly elongated downstream, which is doing two jobs at once. It is
       * the right geomorphology, because everything a flow leaves on a bar
       * surface is drawn out along the current: swales, gravel stringers, the
       * low benches between anastomosing threads. And it is the only orientation
       * that survives being looked at: a midground pixel spans 29 mm across the
       * view against 615 mm along it at 30 m, going to 58 x 2456 mm at 60 m, so
       * anything whose phase varies downstream is averaged over metres and
       * returns its mean. Across-channel variation is resolvable to the horizon.
       *
       * It is also the only orientation the *mesh* can carry. The grid is 0.20 m
       * across the wash and 0.42 m along it, so the shortest across-channel
       * wavelength that survives sampling is 0.40 m and the shortest downstream
       * one is 0.84 m. A term elongated ten to one sits comfortably inside both;
       * an isotropic one at the same scale would alias along the wash. */
      /* Deliberately *not* carried below the grid. Two octaves from a base of
         about 0.9 m across the wash reaches 0.43 m, which is the shortest thing
         the 0.20 m across-channel spacing can represent; a third octave would
         put half its energy under the sampler and come back as grid noise. What
         belongs below 0.4 m goes in the shading normal instead, where it can be
         band-limited honestly — see the bedform block in the fragment shader. */
      const swA = fbm(x * 1.12, z * 0.115, 2, 331);
      /* A slow across-channel wander used to warp the phase of the term below,
         so its swales bend and merge instead of running as parallel grooves.
         Corduroy is a named defect on this floor and a regular comb at bar
         scale would be the third time. */
      const swW = fbm(x * 0.21, z * 0.045, 2, 337);
      /* Ridged rather than plain, because a bar surface is a set of rounded
         swales separated by narrower benches rather than a sine. Ridged puts the
         sharp feature at the bottom of the swale, where the thread actually ran,
         and a crease is what throws a shadow line at eleven degrees of sun. */
      const swB = ridged(x * 0.80 + swW * 1.4, z * 0.082, 2, 341);
      /* Amplitude modulated by the coarse field so the roughness belongs to the
         bar it sits on rather than running through the whole floor at one
         strength — a uniform overlay is the corduroy complaint waiting to
         happen. l1b is one of the staircase inputs, so the fine texture is
         correlated with the form it is roughening: benches are worked, hollows
         are swept smooth. */
      const swK = 0.45 + 0.95 * l1b;
      h += floorZone * swK * (0.330 * swA + 0.205 * (swB - 0.60));
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
    this.oSheet = this.sheetField(x, z, f);
    /* Flow depth of the last flood. The channel carried it deepest and the
       terrace only saw the top of the flood, so this falls from the thalweg
       outward and is scaled by the incision depth, which is the depth of water
       that cut it. It is a *depth*, not a facies: the ripple wavelength a flow
       leaves behind scales with it, and letting the shader read it is what
       stops the ripple train running at one pitch from bank to bank. */
    this.oFlow = (1 - smoothstep(f.wc * 0.4, f.wt + 1.2, av))
               * clamp(0.30 + 0.55 * f.dc, 0, 1);

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
    h += talRaw * 4.4 * cone * (0.86 + 0.28 * fbm(x * 0.30, z * 0.30, 2, 191))
       + smoothstep(0.04, 0.30, talRaw) * cone
         * 0.52 * fbm(x * 0.28, z * 0.28, 2, 192);
    const tal = talRaw;

    const openEnd = smoothstep(215, 330, s);   // let the far end of the wash breathe
    const wStart = f.ws + 8.5;
    const wRun = 18 + 14 * (0.5 + 0.5 * fbm(s * 0.011, side > 0 ? 101 : 137, 3, 73));
    /* ---- SYSTEM 2 ----
       This used to rise sixteen to thirty-nine metres and *was* the canyon wall.
       It is not any more: the wall is rock, built as a curtain in rock.js, and a
       height field cannot draw rock — y = f(x, z) is single-valued, so the
       steepest thing it can express is a slope, which is why every round of work
       on this surface produced a better dune. What is left here is the footslope
       the rock stands on: the apron the talus rests against, tall enough to bury
       the foot of the lowest cliff and to close the back of a side canyon, and
       nothing more. The wash floor and the cut banks above are untouched. */
    const wallH = (7 + 6 * (0.5 + 0.5 * fbm(s * 0.0085, side > 0 ? 7 : 19, 3, 79))
                 + 3 * (0.5 + 0.5 * fbm(s * 0.021, 91, 2, 83))) * (1 - 0.40 * openEnd);
    const t = clamp((av - wStart) / wRun, 0, 1);
    const ramp = t * t * (3 - 2 * t);
    /* Exported so the shader can tell a canyon wall from a bank in the wash
       floor. They can share a slope angle and be made of completely different
       things — one is rock, the other is a section through last decade's
       floods — and slope alone cannot distinguish them. */
    this.oWall = ramp;
    h += ramp * wallH;
    h += clamp(av - (wStart + wRun), 0, 45) * 0.20 * (0.7 + 0.3 * fbm(s * 0.02, 5, 2, 87));

    /* Coarse footslope form. Halved along with the height above: at a seventh of
       the relief it used to have, the amplitude that gave a thirty-metre wall its
       spurs would give a seven-metre apron a set of pits. */
    h += ramp * (1.05 * fbm(x * 0.031, z * 0.031, 4, 117)
               + 1.10 * (ridged(x * 0.026, z * 0.026, 3, 118) - 0.45));

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
      /* Cut shallower. A four-metre groove leaves a metre-scale lip between it and
         its neighbour, and at eight degrees of solar elevation that lip is a blown
         cream highlight running the full height of the wall — a whole wall of them
         is the corduroy read, and it got louder once the macro tonal noise that had
         been masking it came down. Depth is not what makes drainage legible;
         convergence is, and that is what `merge` and the fans do. */
      /* Scaled with the footslope. Two and a third metres of gully was sized for a
         thirty-metre wall; on a seven-metre apron it is a trench. */
      const cut = 0.90 * m1 * (0.30 + 0.70 * (1 - t))
                + 0.38 * merge * gGate * smoothstep(0.50, 1.00, r2) * smoothstep(0.12, 0.72, t);
      h -= ramp * cut * smoothstep(0.0, 0.13, t);

      /* Every gully mouth drops what it carried. Widened and deepened: a debris
         fan is the visible *product* of the drainage above it, and rills that
         deposit nothing are the other half of why they read as corduroy rather
         than as a drainage network. */
      const fanAxis = 1 - Math.min(1, Math.abs(av - f.ws - 3.0) / 9.5);
      h += m1 * fanAxis * fanAxis * 1.6;
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
      /* Also scaled to the footslope. Real stratigraphic benching is System 2's
         now, cut into the rock curtain where it can be vertical; three metres of
         it on a seven-metre debris apron would be inventing rock outcrops in the
         middle of the talus. */
      h += ramp * (r - 0.42) * 1.0;
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
    /* These two terms are isotropic and ungated by `floorZone`, so unlike the
       bar roughness they run on the banks and up into the head, where the rows
       are 0.615 m rather than 0.42 m. Rather than quote either figure, ask the
       axis what the spacing is here and fade each term as its finest octave
       approaches that grid's Nyquist. On the floor both ratios sit above the
       window and this is exactly a no-op; in the head zone the 0.42-frequency
       term's finest octave falls to 1.9 samples per wavelength and is removed,
       which is the diamond lattice. See `gridK` for why the window is 1.8–2.6
       and not 2.0–3.0. */
    const dGrid = Math.max(meshStepX(x), meshStepZ(z));
    const k114 = gridK(fineLambda(0.42, 2), dGrid);
    const k115 = gridK(fineLambda(0.34, 2), dGrid);
    h += (1 - ramp) * flat * (coarse * (0.34 * fbm(x * 0.036, z * 0.036, 3, 109)
                                      + 0.18 * fbm(x * 0.105, z * 0.105, 3, 111))
                            + 0.150 * fbm(x * 0.255, z * 0.255, 2, 113)
                            + 0.085 * k114 * fbm(x * 0.42, z * 0.42, 2, 114)
                            + 0.030 * k115 * fbm(x * 0.34, z * 0.34, 2, 115))
       /* Held down hard on the wall ramp. Sixty centimetres of relief at a
          two-metre wavelength on a slope this steep, under a sun this low, is a
          field of blown crests and black troughs — the wall's texture stops being
          rock and becomes a bright hatch. */
       + ramp * (0.30 * fbm(x * 0.13, z * 0.13, 3, 119)
               + 0.06 * fbm(x * 0.30, z * 0.30, 2, 121));

    /* Last, so the hollows are cut into the finished bed rather than being
       smoothed over by anything downstream of here. Free until the first
       boulder registers one. */
    if (this._scour) h += this.scourAt(x, z);

    return h + this._headRise(x, z);
  }

  /**
   * The hillside the wash comes off, added on top of everything else.
   *
   * Two parts. A ramp, which is the drainage's own long profile steepening as it
   * approaches its source — every stream bed does this and it is the reason a
   * wash head is uphill rather than merely absent. Then the slope above it,
   * which is what the water was collected from.
   *
   * Applied to the far-field branch as well as the corridor, and tapered in z
   * only. That is the whole reason it cannot seam: a term that faded out
   * laterally would leave the corridor thirty metres higher than the ground
   * beside it and put a scarp down each side of the wash for its full length.
   * Ground that rises across its entire width is a hillside; ground that rises
   * only in the middle is an embankment.
   *
   * The plan form is broken up with noise at twenty and thirty metres, because a
   * head that closes on a clean line across the channel is a dam. Real ones
   * close in bays and buttresses, and the noise is enough to give the rim a
   * profile rather than a horizon.
   */
  _headRise(x, z) {
    if (z > -274) return 0;
    const ramp = smoothstep(-274, -336, z);
    /* Standing far enough back to be a view rather than an obstruction. The
       first attempt put the toe fourteen metres from where the walk ends and
       rose forty metres over fifty, which subtends about fifty degrees: not a
       canyon head but a wall in the face, and it filled the frame with one dark
       mass. Set back to thirty metres and spread over sixty, the rim comes in
       around seventeen degrees above the eye with sky over it, which is what
       standing at the head of a wash actually looks like.
       It is also backlit, the sun being up-wash, so the near face is in shadow
       by construction — that is correct for this hour and is why it wants to be
       read against sky rather than made to fill the frame. */
    /* ---- an amphitheatre, not a berm ----
     * Reported as "a ruler-straight, slightly tilted ledge running the full
     * width of frame with uniform horizontal striping and zero erosional
     * variation… it reads as a retaining wall", and that is a fair description
     * of what a function of z alone has to look like. The rise was
     * smoothstep(-340, -400, z) with only a 48 m fBm on top, so every contour of
     * the headwall was a line of constant z — which from a camera standing on the
     * centreline is a horizontal straight edge across the whole frame.
     *
     * A real wash head closes in from the sides before it closes across the
     * middle, because the tributary slopes are eating into it from three
     * directions at once. So the onset is displaced in z by how far out you are:
     * the flanks reach full height twenty-six metres sooner than the axis, which
     * curves the contours around the viewer into a bowl. A plan-form fBm on top
     * of that stops the bowl being a parabola. */
    const ax = Math.abs(x);
    const zw = z - 26.0 * smoothstep(3.0, 30.0, ax)
                 - 16.0 * fbm(x * 0.028, z * 0.010, 3, 431);
    const wall = smoothstep(-340, -400, zw);
    /* The pour-off. A wash head is where the water comes *over*, so the one place
     * the headwall is not a wall is on the axis: a notch cut back into it with
     * the plunge below. Without this the channel simply runs into the slope. */
    const chan = 1.0 - smoothstep(2.0, CHAN_W, ax);
    const notch = 9.5 * chan * smoothstep(-332, -374, z);
    /* ---- the channel breaches the apron, because it drained through it ----
     * The apron reached its full height on the axis at about z -328 and the
     * pour-off only began to bite at -332, so the incision started four metres
     * *behind* the crest it was supposed to have cut. Read as composition that
     * is a lip hiding the amphitheatre; read as landform it is unphysical. The
     * water that cut the pour-off had to leave through the apron, so the apron
     * cannot stand unbroken across the axis.
     *
     * Rather than choose a new onset and re-tune it against the sight line,
     * key the breach to the apron itself. `ramp * ramp * 10.0` *is* the apron,
     * so subtracting that same term inside the channel means the apron can
     * never dam the channel that drains it — at any future apron height, and
     * without anyone re-deriving a z range that has to agree with another one.
     * BREACH below 1 leaves a residual sill, which is real for a channel that
     * aggrades as it leaves a canyon head; 1.0 is a clean cut.
     *
     * The breach hands off to the notch rather than adding to it. `ramp`
     * saturates at 1 and stays there, so an unwindowed breach goes on cutting
     * its ten metres through the whole headwall as well, deepening the pour-off
     * far behind the apron and dropping `far_270`'s skyline by 1.9 degrees
     * fifty metres upstream. Fading it out over exactly the range the notch
     * fades in keeps the total cut at about ten metres everywhere instead of
     * nineteen, so the channel is continuous and only the apron is breached. */
    const breach = BREACH * (1.0 - smoothstep(1.5, BREACH_W, ax)) * ramp * ramp * 10.0
                 * (1.0 - smoothstep(-332, -374, z));
    /* Side gullies converging on the head, which is the other half of "zero
     * erosional variation" — a colluvial slope this size is drained, and the
     * drainage is what gives it its vertical grain. */
    const gully = 3.4 * wall * (ridged(x * 0.085, z * 0.016, 2, 437) - 0.52);
    /* ---- the col the sun sits in ----
     * The brief says the sun sits ahead in a gap between formations and pulls you
     * forward, and the walk was ending in a bowl at 14.5/255 — a fifth of the
     * light it starts in, with the payoff as the darkest part of the experience.
     * Ray-marching the height field toward the sun from the centreline names the
     * culprit without ambiguity: at every station from z = -260 back, the highest
     * obstruction is *this headwall's own west flank*, at z = -355 to -396 and 40
     * to 50 m up, and it clears the 15 degree sun by a margin that grows from 1.5
     * degrees to 12. The amphitheatre closed the aperture the brief depends on.
     *
     * So the fix is a col cut on the sun's own bearing rather than on the axis.
     * The sun is at azimuth -9 degrees, horizontal bearing (-0.156, -0.988), which
     * is nine degrees west of straight up-wash, so the notch has to lean west as it
     * goes — an axial notch misses it by fourteen metres at the far end. `perp` is
     * the perpendicular distance from that bearing line, so the cut follows the
     * sight line to the sun exactly, which is also the only shape that opens the
     * aperture without flattening the bowl on the other three sides.
     *
     * This is not a lighting cheat dressed as terrain. A wash head *is* a drainage
     * col — the water that cut the wash came over it — so the one place the
     * headwall should be low is where the drainage comes from, and the sun sitting
     * in that gap is the composition the brief asks for rather than one imposed on
     * it. Exposure and albedo are untouched. */
    /* ---- rills, because a drained slope is not smooth ----
     * The other half of "smooth surfaces with parallel diagonal streaks": the
     * streaks are real clasts foreshortened by a grazing view, and they read as a
     * smear because the surface under them has no form of its own at the scale
     * the eye is checking. A colluvial slope this size is drained, and draining
     * cuts rills — grooves running down the fall line, periodic across it. On
     * these flanks the fall line is roughly across-wash, so the pattern is high
     * frequency in z and slow in x, which is the opposite of the bedform on the
     * floor and is why it cannot simply be borrowed from there. Kept off the
     * channel itself, where the water is doing something else.
     *
     * Carried by the ramp as well as the wall, and that is the whole point: the
     * slopes the streaks were reported on sit at z = -300 to -330, which is the
     * ramp's zone and not the headwall's, so keying the rills to the wall alone
     * put them entirely behind the part of the head anybody can see. */
    const rill = (0.62 * ramp + 0.85 * wall)
               * (ridged(z * 0.19, x * 0.022, 2, 443) - 0.5)
               * smoothstep(4.0, 13.0, Math.abs(x));
    const perp = Math.abs(-0.988 * x + 0.156 * (z + 300.0));
    const col = wall * (1 - smoothstep(9.0, 30.0, perp)) * 17.0;
    return ramp * ramp * 10.0
         + wall * (26.0 + 11.0 * fbm(x * 0.021, z * 0.021, 3, 421)
                        + 6.0 * (ridged(x * 0.034, z * 0.034, 2, 423) - 0.5))
         - notch - breach - gully - col - rill;
  }

  /** Height at the far-field crossover, so the blend starts from something
   *  continuous with the wall it is leaving. */
  _nearShoulder(f, x, z) {
    const wStart = f.ws + 8.5;
    const wRun = 18 + 14 * (0.5 + 0.5 * fbm(f.s * 0.011, f.side > 0 ? 101 : 137, 3, 73));
    const wallH = 7 + 6 * (0.5 + 0.5 * fbm(f.s * 0.0085, f.side > 0 ? 7 : 19, 3, 79));
    return 0.0125 * f.s + wallH + clamp(145 - (wStart + wRun), 0, 45) * 0.20
         + 2.0 * fbm(x * 0.031, z * 0.031, 3, 117);
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
  const xs = X_AXIS;
  /* The dense zone has to reach the end of the *walk*, which it did not. It
     stopped at -256 while the path runs to -320 and the number keys jump the
     player anywhere along it, so the last fifth of the walk was rendered by the
     geometric expansion tail: rows 1 m apart at -270, 3 m at -300, 6 m at -308.
     A wash cross-section a few metres wide sampled every six metres is not a
     wash, and what it drew instead was the two defects reported from the far
     end — a dead straight slab across the channel at -270, which is the first
     giant quad seen face-on, and a black wall filling the frame at -320, which
     is the player standing inside the expansion tail with a single quad in front
     of them. Neither was the edge of the world. The world runs to -1900; only
     the resolution stopped.
     Graded in three steps out to the head so no single column carries a step
     ratio above 1.32 — the same reason the x axis is graded, since a jump in
     spacing leaves a crease along one row, and a dead straight line across the
     wash is the thing this whole file exists to avoid. */
  const zs = Z_AXIS;
  assertBandLimits();

  const nx = xs.length, nz = zs.length;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const ref = new Float32Array(count);
  const pan = new Float32Array(count);
  const wall = new Float32Array(count);
  const sheet = new Float32Array(count);
  const flow = new Float32Array(count);
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
      sheet[k] = terrain.oSheet;
      flow[k] = terrain.oFlow;
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
  g.setAttribute('aSheet', new THREE.BufferAttribute(sheet, 1));
  g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
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

/**
 * Re-level the terrain mesh into the scour hollows the clast scatter registered.
 *
 * The ordering is unavoidable and this is the cheap way out of it. The clasts
 * need the finished bed to seat on, so they have to be placed after the mesh
 * exists; the hollows they dig belong to the mesh, so they have to be applied
 * before it is drawn. Rather than restructure the boot into two passes and risk
 * the two disagreeing, the vertices already carry their own x and z, and
 * `scourAt` is a pure signed delta — so this is one add per vertex and a normal
 * recompute, and it cannot drift out of step with what `heightAt` reports to the
 * player because it is literally the same term.
 */
export function applyScour(mesh, terrain) {
  if (!terrain._scour) return;
  const g = mesh.geometry;
  const p = g.getAttribute('position');
  const a = p.array;
  let moved = 0;
  for (let k = 0; k < p.count; k++) {
    const o = k * 3;
    const d = terrain.scourAt(a[o], a[o + 2]);
    if (d !== 0) { a[o + 1] += d; moved++; }
  }
  if (!moved) return;
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

/* ── surface shader ────────────────────────────────────────────────────── */

const FRAG_PREFIX = /* glsl */`
uniform sampler2D uDirtA; uniform sampler2D uDirtN; uniform sampler2D uDirtM;
uniform sampler2D uSandA; uniform sampler2D uSandN; uniform sampler2D uSandM;
uniform sampler2D uRockA; uniform sampler2D uRockN; uniform sampler2D uRockM;
uniform sampler2D uMacro; uniform sampler2D uVar; uniform sampler2D uCrack;
uniform sampler2D uGrit;
uniform vec3  uDamp;
uniform vec3  uCool;
uniform vec3  uSilt;
uniform vec3  uStone;
uniform vec2  uSunStep;   // dirt-tile UV travelled per metre along the sun azimuth
uniform float uSunRise;   // grain-height units gained per metre along it
uniform vec2  uWind;      // the shared WIND, the direction the wind blows toward
uniform float uBedT;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vRef;
varying float vPan;
varying float vWall;
varying float vSheet;
varying float vFlow;

float tRough;
/* Pixel-footprint confidence, 1 near and 0 once a pixel covers many grains, and
   the grain-scale sun occlusion. Both set in the surface block and read by the
   filtered shadow lookup, which runs later. */
float gFoot = 1.0;
float gRake = 1.0;
float gShadow = 1.0;
float tAO;
vec3  tNrmW;

vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

/* ---- band-limited sine ----
   Amplitude rolls off as the phase gradient approaches half a cycle per pixel,
   which is the Nyquist limit for this feature in this direction, so the term
   fades out smoothly instead of aliasing.

   Taking fwidth of the *phase* rather than of world position is the whole point,
   and getting that wrong is why the first attempt at midground detail moved the
   measured high-frequency energy by nothing at all. On the wash floor the sun is
   at eight degrees and the camera is looking almost along the surface, so one
   pixel covers something like half a metre along the view axis and a few
   millimetres across it. A max of dFdx and dFdy of world position reports the
   long axis, so every feature between a centimetre and a metre is filtered away —
   including all the detail that is still perfectly resolvable in the
   perpendicular direction, which for a ripple train whose crests run across the
   channel is exactly the direction that matters. Differentiating the phase picks
   up the anisotropy for free. */
float bsin(float ph) {
  return sin(ph * 6.2831853) * (1.0 - smoothstep(0.22, 0.55, fwidth(ph)));
}

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

/* ---- the same two, with the derivatives passed in ----
   Everything below that is worth skipping is skipped behind a weight test, and
   a weight derived from a texture or from the slope is not uniform across a
   2x2 quad: the fragments on the far side of a rock/floor boundary take the
   other path, and an implicitly-differentiated fetch inside divergent control
   flow has no defined derivative. Which is exactly why the first version of
   this shader sampled everything unconditionally.

   Handing the gradients in resolves that completely. dFdx(vWPos) is evaluated
   once, at the top of the shader, where every fragment in the quad reaches it;
   the branch then only decides whether to *use* it. The gradient of a planar
   projection scaled by a constant is that constant times the gradient of the
   position, so no per-plane derivative is needed either — one pair of vectors
   covers all three projections and all three maps.

   texture2DGradEXT is three's own alias for textureGrad, defined in the WebGL2
   prefix of every GLSL1 program it compiles, so this needs no extension dance. */
vec3 triSampleG(sampler2D t, vec3 p, vec3 w, float sc, vec3 dx, vec3 dy){
  return texture2DGradEXT(t, p.zy * sc, dx.zy * sc, dy.zy * sc).rgb * w.x
       + texture2DGradEXT(t, p.xz * sc, dx.xz * sc, dy.xz * sc).rgb * w.y
       + texture2DGradEXT(t, p.xy * sc, dx.xy * sc, dy.xy * sc).rgb * w.z;
}

vec3 triNormalG(sampler2D t, vec3 p, vec3 w, float sc, vec3 N, vec3 dx, vec3 dy){
  vec3 nx = texture2DGradEXT(t, p.zy * sc, dx.zy * sc, dy.zy * sc).xyz * 2.0 - 1.0;
  vec3 ny = texture2DGradEXT(t, p.xz * sc, dx.xz * sc, dy.xz * sc).xyz * 2.0 - 1.0;
  vec3 nz = texture2DGradEXT(t, p.xy * sc, dx.xy * sc, dy.xy * sc).xyz * 2.0 - 1.0;
  nx = vec3(nx.xy + N.zy, abs(nx.z) * N.x);
  ny = vec3(ny.xy + N.xz, abs(ny.z) * N.y);
  nz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
  return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
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
  /* ---- bound the tilt, because det goes to zero at grazing incidence ───────
     The line this replaces was normalize(abs(det) * N - scale * grad). Both
     halves are correct: grad is perpendicular to N, det is the pixel
     footprint's area projected onto N, and grad/det is the true surface
     gradient of hgt, which is what a bump wants and is view-independent.

     The trouble is that det is a *finite difference* estimate of that area, and
     it collapses toward zero as the surface turns edge-on. When it does, the
     abs(det) * N term shrinks out of the expression and the perturbation
     dominates the result — the returned normal tends to grad's direction no
     matter how small scale is. The tilt is tan(theta) = scale*|grad| / |det|,
     with nothing bounding it. So on any grazing surface this function returns a
     normal driven entirely by two derivatives that, at that incidence, are
     sampling a scalar far below its Nyquist limit and are therefore not small
     but *wrong* — and wrong with spatial regularity, because the wrap is
     regular. That is the far_270 diamond lattice, and it is why every attempt
     to fix it by fading the amplitude in front of the call failed: no value of
     scale bounds a ratio whose denominator is going to zero.

     Capping the tilt fixes it at the only place it can be fixed, and the cap is
     an *exact* identity below it — the multiplier is 1.0 bit-for-bit, not merely
     small — so the only surfaces it can touch are ones already returning a tilt
     no legitimate call site produces.

     MAXTILT was chosen by measurement rather than by argument. Painting the
     multiplier into the albedo shows where it engages: at 0.45 it fires on the
     lattice dots and on nothing else in any framing, which localises the defect
     but is far too loose to cure it, because an 0.45 tilt near the terminator
     still swings a pixel from lit to shadowed. At 0.10 it fires across the whole
     lattice, across a striped patch on the bend right bank, and nowhere in
     ground. That is the value here. Do not read the cap as an amplitude control:
     it does not reduce the artefact, it removes it, because below the cap the
     term is untouched and above it the estimate was never valid.

     Verification, paired against this same function with MAXTILT set to 1e9,
     which is an exact no-op: ground 0.002% of pixels differing at a mean of
     0.0001/255, wash_mid 0.130%, and hf/lf and grad/L identical to four decimals
     on ground, wash_mid and bend. Everything it does change, it improves — see
     "bounding bumpFrom at grazing incidence" in CONTRACT.md for the surfaces
     that turned out to be quietly carrying this. */
  const float MAXTILT = 0.10;
  vec3  p  = scale * grad;
  float ad = abs(det);
  float pl = length(p);
  p *= min(1.0, (ad * MAXTILT) / max(pl, 1e-12));
  return normalize(ad * N - p);
}
`;

const SURFACE = /* glsl */`
vec3 gN = normalize(vWNrm);
vec2 wxz = vWPos.xz;

/* ---- pixel footprint, and why every bump here is filtered by it ----
   The world-space width of one pixel at this fragment. At grazing incidence it
   grows without bound along the view axis, and that is exactly where the grain
   shading was breaking down into a black-and-white hash across the midground.
   Averaging *albedo* over a footprint is what the mip chain already does
   correctly. Averaging *normals* is not, because the lighting of a normal is
   nonlinear: mip-averaging a grain field toward flat and then lighting it is a
   completely different answer from lighting each grain and averaging the results,
   and the max-of-populations packing in the grain map makes it worse still — the
   packed height field has no mip-safe form at all. The only stable answer once a
   pixel covers many grains is to stop perturbing the normal and shade the surface
   flat, letting the albedo mip carry a fine even stipple, which is precisely what
   distant gravel looks like. Each relief term below is therefore gated by the
   footprint against its own feature size. */
/* Hoisted out of foot so the branches below have gradients to hand. Every
   fragment in a quad executes this line whichever path it later takes, which
   is the property the skipped fetches depend on. */
vec3 pdx = dFdx(vWPos), pdy = dFdy(vWPos);
float foot = max(length(pdx), length(pdy));
/* ---- manual anisotropic sampling for the floor ----
   This is what the mid-distance flatness actually was, and four rounds of shader
   work failed to move it because the detail was already gone before any of that
   code ran. A pixel on the wash floor at thirty metres covers about 0.4 m along
   the view axis and 2.6 cm across it. Mip selection uses the larger, so the dirt
   map — which tiles at 2.6 m, so a 10 cm pebble is forty texels — is sampled at a
   level that averages a hundred and fifty texels, and every trace of gravel is
   filtered out. Across the pixel it was never unresolvable at all; a tenth of a
   metre is four pixels wide.

   That is exactly what anisotropic filtering exists to fix, and the textures do
   request it, but the capture runs on a software rasteriser where the extension
   is not something to rely on. Biasing the level by the log ratio of the two axes
   does the same job with one tap and no extension: it sharpens toward what the
   short axis can resolve. One tap under-filters along the long axis, so this goes
   on albedo and not on normals — a normal is what scintillates, because shading
   is non-linear in it, whereas colour aliasing at this scale is the grain of the
   surface and reads as gravel. Capped at three levels, which is eight to one. */
float footMin = min(length(pdx), length(pdy));
float aniso = -clamp(log2(foot / max(footMin, 1e-5)), 0.0, 3.0);
float grainF = 1.0 - smoothstep(0.007, 0.040, foot);   // grains, 5-30 mm
float platF  = 1.0 - smoothstep(0.030, 0.120, foot);   // mud plates, 3-15 cm
float rockF  = 1.0 - smoothstep(0.045, 0.260, foot);   // rock grain, 3-25 cm
/* Against the shadow map's texel size rather than a feature size: the map is 4096
   over 68 m, so a texel is 17 mm and a single binary sample stops meaning anything
   much beyond that. */
gFoot = 1.0 - smoothstep(0.020, 0.075, foot);

/* ---- footprint-locked grit, the floor's copy of System 2's fix ────────────
 * CONTRACT.md's account of why the cliff went to wax applies verbatim to the
 * floor: a texture pinned to a world scale has no content at all past the range
 * where its texels fall under a pixel, because the mip chain hands back its
 * mean. The offline probe says the dirt map's *shape* survives — grad 0.0250 at
 * mip 0 against 0.0251 at the midground footprint — but its amplitude does not:
 * luminance sd 0.077 down to 0.046, and a nine-pixel high-pass RMS of 0.038
 * where a real arroyo photograph holds 0.115-0.137. Sharper sampling cannot
 * return amplitude that averaging removed; only a layer with no size of its own
 * can.
 *
 * So the same grit map rock.js reads is read here, at whatever scale the pixel
 * asks for, snapped to octaves with the bracketing pair crossfaded so nothing
 * pops as the camera walks. It has no content below a fourteenth of its own
 * tile, which is the property that makes reading it at an arbitrary scale
 * honest rather than a cheat.
 *
 * The one difference from the wall is anisotropy, and it decides the lock. A
 * midground floor pixel is about 12 mm across the view and 76 mm along it, a
 * ratio of six. Locking to the long axis, as the wall does, would smear the
 * layer across five pixels horizontally and put nothing in the band; locking to
 * the short axis would alias badly along the view. The geometric mean of the two
 * splits it — a couple of pixels of blur across, a little under a texel per
 * pixel along — and both of those land inside the nine-pixel window the
 * midground is judged with.
 *
 * Faded *in* with the footprint rather than out, which is the opposite of every
 * other detail term here and is deliberate. Near, the dirt map's own grain
 * carries this band and the near field already measures a shade crisper than the
 * reference; far, that grain is gone and this stands in for it. The two are
 * complementary halves of one surface, not a term and its distance fade. */
float footG = sqrt(max(foot, 1e-5) * max(footMin, 1e-5));
/* A footprint-keyed bed amplitude was tried here and reverted. footG does
   separate the two floor framings cleanly — 9.1 mm at ground's near band
   against 17.9 mm at the wash floor's — so the mechanism is available. It does
   not help: the wash floor's gradient is at a local *minimum* in bed amplitude,
   rising for both 0.85x and 1.5x, so no scaling of relief reduces it in either
   direction. Numbers and the no-op check in CONTRACT.md. */
float gLod = log2(max(footG, 2e-4) * 256.0 * 0.9);
float gFl = floor(gLod), gTw = gLod - gFl;
float gSc = exp2(-gFl);
vec2 gUV = wxz + vec2(3.7, 12.9);
vec4 gr = mix(texture2D(uGrit, gUV * gSc), texture2D(uGrit, gUV * gSc * 0.5), gTw);
float gritK = smoothstep(0.007, 0.030, footG);
/* Tangent-space strength for the same map's normal channels, applied on far
   ground below. rock.js reads this map at 1.9 on a close face; this is lower
   because the population it lands on is grazing-lit, which is the geometry where
   grain normals turn to salt and pepper before the structure metric notices. */
const float GRIT_N = 1.4;

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
vec3 dirtA = mix(texture2D(uDirtA, d1, aniso).rgb, texture2D(uDirtA, d2, aniso).rgb, dB);
vec3 dirtN = mix(texture2D(uDirtN, d1).xyz, texture2D(uDirtN, d2).xyz, dB) * 2.0 - 1.0;
vec3 dirtM = mix(texture2D(uDirtM, d1, aniso).rgb, texture2D(uDirtM, d2, aniso).rgb, dB);

/* ---- drifted sand ---- */
vec2 s1 = rot2(wxz, 0.35) * 0.4545;   // 2.2 m tile
vec2 sdx = dFdx(s1), sdy = dFdy(s1);
vec3 sandA = vec3(0.0), sandN = vec3(0.0, 0.0, 1.0), sandM = vec3(0.0);

/* A sand sheet ends in a crisp depositional lobe, not a crossfade. Hard
   threshold on a lobe-shaped field rather than a wide smoothstep. */
float sandF = mac.r * 1.15 + (mac2.r - 0.5) * 0.55 + (vr.b - 0.5) * 0.30;
/* Pulled back. A sand sheet covering half the floor turns the wash into a dune
   field: smooth, pale, featureless ramps with no clast structure in them at all,
   which is what the terrace ramps had become. Sand belongs in the slack water on
   the inside of bends and nowhere else. */
/* Silt pans win over sand where they overlap: both want the slack water on the
   inside of a bend, and if sand takes it the mud has nowhere left to be. */
/* Narrowed. Dried mud forms in ponded silt at the channel margin — a patch a few
   metres across, not a facies covering a third of the floor, and at the previous
   coverage the pan was competing with the gravel bed for the frame. */
float panRaw = smoothstep(0.24, 0.62, vPan);
/* ---- sand only on ground flat enough to hold it ----
   The slope gate ran out to 0.30, which is a face of about forty-five degrees, so
   sand carried straight over every bank crest and down the far side in an
   unbroken sheet — described as icing on a cake, or flour spilled from above, and
   that is exactly what an unbounded slope gate looks like. Neither mechanism that
   puts sand on a slope works that way. Fluvial sand is deposited by water and
   water does not climb: it fills the channel and the slack water inside bends and
   stops at a slip-face. Aeolian sand does climb, but only where it has a wind
   fetch, and it rests at the angle of repose with a distinct toe — it cannot glaze
   a crest and continue over the lip. Confined to genuinely flat ground, the first
   mechanism is modelled correctly and the second is simply absent, which is a far
   better answer than both of them being wrong. */
/* And gated on the deposit, not just on the gradient. A pale sheet was running
   the length of the channel including straight down the thalweg — measured at
   value 0.82 with saturation 0.27, the worst-reading surface in the set, and
   geologically backwards: the thalweg is the one place a flood scours to gravel
   every single time it runs. vSheet is the slack-water field the clast scatter
   already uses to keep stones *out* of the sand, so gating the sand on it makes
   the two agree instead of describing different floods. */
float sandW = smoothstep(0.62, 0.68, sandF) * smoothstep(0.10, 0.42, vSheet)
            * (1.0 - rockW) * (1.0 - wallM)
            * smoothstep(0.135, 0.045, slope) * (1.0 - panRaw * 0.9);

/* ---- and the aeolian half, which was noted as simply absent ----
   The note left with the slope gate above said the honest thing: fluvial sand is
   deposited by water, water does not climb, and confining sand to flat ground
   models that mechanism correctly and leaves the other one out entirely. The
   other one can now be put in, because the wind has a shared direction —
   tonight's wind, out of audio.js, the direction it blows *toward* — so the
   drifted sand, the blowing grains and the sound are one weather system rather
   than three private guesses. Tonight's wind runs *along* the wash, which is
   physically what a channel between walls does to air, so this deposits on the
   downstream faces of transverse features and leaves the cut banks — which face
   across the channel and are therefore neither windward nor lee — alone. That
   is a much smaller deposit than the across-wash guess it replaces, and it is
   the right one.
   A drift is a *lee* deposit. Grains saltate up the windward face, separate at
   the crest and fall out in the still air behind it, so sand banks against the
   downwind side of a bank and the windward side is swept to lag. For a height
   field the normal is (-dh/dx, 1, -dh/dz), so downhill is -gN.xz and a face is
   in the lee when its downhill points along the wind. The previous round had
   this dotted against +gN.xz, which is uphill, so every drift it placed was on
   the *windward* face — a sign error that survived because the direction was
   also wrong, and two wrongs looked like scattered sand either way.
   And it rests at the angle of repose with a toe, which is the other half of the
   icing complaint: the upper gate at slope 0.265 is about thirty-nine degrees,
   past which nothing stays, and the lower gate keeps it off ground flat enough
   for the fluvial term to own. So it cannot glaze a crest and run over the lip —
   it stops dead at the crest line, which is where the windward face begins. */
vec2 down = -gN.xz;
float dl = length(down);
float lee = dl < 1e-4 ? 0.0 : dot(down / dl, uWind);
float aeolW = smoothstep(0.16, 0.52, lee)
            * smoothstep(0.030, 0.085, slope) * (1.0 - smoothstep(0.175, 0.265, slope))
            * smoothstep(0.44, 0.66, mac2.r * 0.70 + vr.b * 0.46)
            * (1.0 - rockW) * (1.0 - wallM) * (1.0 - panRaw * 0.9);
float aeoF = aeolW * 0.88;
sandW = max(sandW, aeoF);

/* Three fetches that only matter inside a sand lobe, and a sand lobe is slack
   water on the inside of a bend — a few percent of the floor by area and none
   of the wall. Everywhere else mix(dirt, sand, 0.0) was being paid for in
   full. The LOD bias the unbranched call carried becomes a gradient scale:
   lod is log2 of the gradient, so multiplying the gradient by exp2(bias) adds
   the bias, and aniso is negative, so this sharpens exactly as before. */
if (sandW > 0.0015) {
  float ka = exp2(aniso);
  sandA = texture2DGradEXT(uSandA, s1, sdx * ka, sdy * ka).rgb;
  sandN = texture2DGradEXT(uSandN, s1, sdx, sdy).xyz * 2.0 - 1.0;
  sandM = texture2DGradEXT(uSandM, s1, sdx * ka, sdy * ka).rgb;
}

/* ---- raking grain shadows, marched in the height map ----
 * With the sun at eight degrees, a one-centimetre grain throws a shadow seven
 * centimetres long, and a floor covered in those raking fingers is most of what
 * separates a bed strewn with stones from a bed with bumps painted on it. A
 * shadow map cannot deliver them at this sun angle: the depth slope across a
 * texel at eighty-two degrees of incidence forces a bias larger than the whole
 * length of the shadow, so anything small enough to matter is either erased by
 * the bias or reduced to per-pixel acne, and that trade is what the frame's worst
 * artefact came out of.
 *
 * Marching the grain height field toward the sun instead gives the same shadows
 * from the map that produced the grains, with none of that. Eight taps at eleven
 * millimetres reach about nine centimetres, which covers what a grain of this size
 * casts, and because it is ordinary texture sampling it filters through the mip
 * chain and converges on the mean occlusion rather than on noise. It multiplies
 * the direct term only, through the same shadow hook, because that is what it is.
 */
/* ---- and why the march is now behind a gate ----
 * Nine fetches, and they were unconditional. Read the line that consumes them:
 *
 *   gRake = 1 - mix(0.26, rakeRes, grainF) * 0.88 * smoothstep(0.35, 0.10, slope)
 *
 * The march only reaches the output through rakeRes, and rakeRes only
 * reaches it through grainF. So there are two whole regimes in which all nine
 * fetches are computed and then multiplied by zero:
 *
 *   · anything steeper than about twenty degrees, where the slope term is out —
 *     which is every canyon wall, every bank face and all the talus;
 *   · anything past the footprint where individual grains stop resolving,
 *     grainF = 0 and the term collapses to the constant 0.26 mean. On the wash
 *     floor under a grazing camera that is everything beyond roughly a dozen
 *     metres, which is the large majority of the ground pixels in a long shot.
 *
 * The gate is on the product of the two, so the branch is only taken where the
 * result would actually differ. rakeRes keeps its declaration outside so the
 * mean-occlusion fallback on the next line is unchanged in both regimes.
 */
/* ---- bedform, and the micro-shadow fraction it controls ─────────────────
 *
 * This block exists because four previous attempts to move the midground
 * measurement failed, and the offline test CONTRACT.md asked for before a fifth
 * says why. Generating the dirt map in node and averaging it over the
 * anisotropic box a midground pixel actually covers — 5 texels across the view
 * by 30 along it, worked from the capture geometry — the map keeps its shape
 * completely: grad 0.0250 at mip 0 against 0.0251 at the midground footprint,
 * hf/lf 0.65 against 0.65. So the standing hypothesis is **wrong**: the albedo
 * has not gone to wax and there is nothing there for sharper sampling to
 * recover. What it loses is *amplitude* — luminance sd 0.077 to 0.046, and a
 * 9-pixel high-pass RMS of 0.038 where a real arroyo photograph holds
 * 0.115-0.137.
 *
 * A 0.038 ceiling from pigment says pigment cannot be the answer. Arithmetic:
 * to lift a band from 0.058 to 0.115 needs another 0.099 RMS added in
 * quadrature, and at the midground's mean luminance of 0.335 that is a third of
 * the mean — a contrast no albedo mottle on dirt has. Only one thing on a wash
 * floor is that contrasty, and it is the same thing that makes a gravel bed
 * legible at all under an eleven-degree sun: shadow.
 *
 * So what is authored here is the *shadowed area fraction* of the bed, as a
 * smooth tone. It is the quantity the raking march already computes per grain
 * and then throws away past the range where individual grains resolve, where it
 * collapses to a single constant 0.26 over the whole floor — a flat tone
 * carrying exactly zero energy in any band. That constant is a real physical
 * quantity and it is emphatically not constant: a coarse armoured lag under a
 * grazing sun hides forty per cent of its own area, a planed sand bed hides ten,
 * and a ripple trough is in shadow while its crest is not.
 *
 * Three properties make this the right carrier rather than another mottle.
 * It multiplies the *direct* term only, so the shaded fraction keeps the violet
 * sky fill and the contrast is coloured rather than grey. It is a tone, so it
 * survives the mip chain, the terminator and the footprint filter intact — the
 * thing CONTRACT.md warns pigment does, except here the feature genuinely is a
 * tone and not a hole. And it is gated by grainF, so it is *only* active where
 * individual grains have stopped resolving: the near field, which already
 * measures slightly crisper than the reference band, is untouched by
 * construction.
 */
float floorB = (1.0 - rockW) * (1.0 - wallM) * smoothstep(0.34, 0.12, slope);

/* Armoured lag. Where a flood swept the fines out from between the coarse
   fraction it leaves a close-packed pavement one clast thick, and that surface
   is both greyer and far more self-shadowing than the sand beside it. The
   patches have hard edges because the flow that cut them did. */
float armour = smoothstep(0.44, 0.61, mac2.b * 0.66 + vr.g * 0.52) * floorB;

/* ---- the ripple train ----
   Wavelength scales with flow depth, which is the relationship and not a taste
   knob: a ripple is a bedform in equilibrium with the flow that built it, so the
   thalweg carries a long train and the bar margin a short one. Frequency cannot
   be varied continuously without the phase drifting, so three fixed trains are
   crossfaded by vFlow, which the mesh carries from the same cross-section the
   channel was cut from.
   Then a fourth train at a wavelength close to the third and tilted a few
   degrees across it. Two nearby wavelengths beat, and the beat is what makes a
   crest run for a couple of metres, split, and die out — bifurcation, which is
   the thing a single train cannot do and the reason an unbroken train reads as
   corduroy however hard its phase is warped. */
/* ---- and the phase has to wander by whole wavelengths ----
   The first version of this warped the phase with the macro maps alone, which
   tile at 61 m and 7 m: over the two or three metres a crest actually occupies
   the warp is constant, so the train came out perfectly regular locally and
   rendered as woven fabric — the corduroy read, arrived at from the opposite
   direction. A ripple crest is a metre long, curves, and hands over to its
   neighbour. The warp therefore has to be worth more than one wavelength over
   about a metre, which is what the last term here supplies.
   It costs nothing in band limiting: a warp of three wavelengths over a metre
   adds about 0.4 to the phase gradient against a base of eleven, so bsin's own
   Nyquist roll-off is unaffected. */
float rpW = (mac2.g - 0.5) * 0.42 + (vr.r - 0.5) * 0.13
          + 0.34 * (texture2D(uMacro, rot2(wxz, 0.61) * 0.34).g - 0.5);
float rpPh = vWPos.z + rpW;
float dSel = clamp(vFlow * 1.30 + (mac.g - 0.5) * 0.55, 0.0, 1.0);
float rip = mix(mix(bsin(rpPh / 0.093), bsin(rpPh / 0.152), smoothstep(0.0, 0.52, dSel)),
                bsin(rpPh / 0.246), smoothstep(0.48, 1.0, dSel));
rip = rip * 0.66 + 0.44 * bsin(rpPh / 0.171 + dot(wxz, vec2(0.21, 0.0)));
/* Plane-bed patches, where the flow ran fast enough to wash the train out
   entirely. A bed rippled edge to edge only ever saw one flow regime. */
float rpBed = smoothstep(0.26, 0.50, mac2.a * 0.7 + vr.g * 0.5);
/* Coverage widened. The previous gates multiplied down to about fifteen per cent
   of the floor, which is why the term measured as nothing: a feature present on a
   sixth of the pixels at a tenth of the contrast is not a bedform, it is a
   rounding error. A wash floor a week after a flood is rippled over most of its
   area — the plane-bed patches above are the exception and they are still here. */
float rpF = floorB * rpBed * smoothstep(0.22, 0.48, mac.r * 0.62 + vr.g * 0.5)
          * (0.72 + 0.48 * sandW);

/* ---- current lineation, and why it is this fine ----
   The metric is an RMS over a nine-pixel box high-pass, and at the midground a
   pixel spans about 12 mm across the view against 76 mm along it. So a feature
   only lands inside that kernel if it is under roughly 11 cm *across* the line
   of sight, and every across-channel term this shader had was between 19 and 72
   cm — visible, geologically defensible, and outside the window being measured.
   These three are 5.5, 8.5 and 13 cm, which is 4 to 11 pixels there.
   They are flow-parallel on purpose, and that is both what survives a grazing
   view and what is actually on a gravel bed: parting lineation and pebble
   stringers are drawn out along the current, so their variation is across it.
   bsin differentiates the phase rather than the position, so each one fades on
   its own Nyquist limit in its own direction instead of being filtered away by
   whichever screen axis is worse.
   Warped by a metre-scale field for the same reason the ripple train is: three
   parallel trains at fixed spacings and fixed directions is a grating, and a
   grating is the thing being avoided. */
float linW = 0.28 * (texture2D(uVar, rot2(wxz, 1.94) * 0.62).r - 0.5);
float lin = 0.44 * bsin(dot(wxz, vec2(0.9990, 0.0447)) / 0.055 + linW * 5.0)
          + 0.36 * bsin(dot(wxz, vec2(0.9961, -0.0880)) / 0.085 + linW * 3.4)
          + 0.30 * bsin(dot(wxz, vec2(0.9981, 0.0616)) / 0.131 + linW * 2.2);

float rakeW = 0.88 * smoothstep(0.35, 0.10, slope);
float rake = 0.0;
if (rakeW * grainF > 0.002) {
  /* ---- march the map at the mip everything else reads it at ----
     These gradients used to be the raw dFdx/dFdy of d1, which is up to three
     mip levels blurrier than the read of this very same map thirty lines up:
     dirtA and dirtM both take aniso as an LOD bias, worth -3 on a floor seen
     down its length, and dirtN is sharp. So the relief that draws the pebbles
     was being sampled at mip 0-ish and the relief that shadows them at mip 3,
     where a 25 mm grain field has been averaged most of the way to its mean.
     That is the whole defect: the bumps were visible and their shadows were
     being marched across a surface that had been smoothed flat before the
     march started, so the term returned a sprinkle of 25 mm specks instead of
     a bed of raking shadows. Scaling the gradients by exp2(aniso) is exactly
     the same LOD the biased fetches get — a bias of b is a gradient scale of
     2^b — expressed the only way texture2DGradEXT will take it.
     Note this is a *sharpening*, so it cannot reach further than the data: on
     an isotropic footprint aniso is 0, the scale is 1.0 and the march is
     bit-identical to what it was. It only bites where the footprint is
     elongated, which is every floor seen down the wash. */
  float lodK = exp2(aniso);
  vec2 ddx = dFdx(d1) * lodK, ddy = dFdy(d1) * lodK;
  float dirtH = texture2DGradEXT(uDirtM, d1, ddx, ddy).b;
  /* ---- and space the samples geometrically, not evenly ----
     These were eight even steps of 11 mm. The reach that gives is right and was
     checked rather than assumed: the map's height channel runs 24 mm peak to
     peak, so at a 15 degree sun the tallest thing in it casts 90 mm, and a
     reference march run out to 300 mm at one sample per texel finds *exactly*
     what 88 mm finds. Nothing is being missed beyond the end.
     What was being missed is the near end. The tile is 2.54 mm per texel, so a
     first sample at 11 mm lands 4.3 texels out and steps clean over the base of
     every grain shadow in the field — which is the part of a raking shadow that
     is darkest, most contiguous and most legible. Measured on the real map, over
     40000 paired points: even 11 mm steps put 11.6% of the floor in some shadow,
     the same reach sampled at every texel puts 15.3%, and eight *geometric*
     steps from 2.5 mm to 88 mm reach 14.4% — 92% of the dense result for eight
     fetches instead of thirty-five. The ratio is constant so it costs one
     multiply per step rather than a pow.
     Note what this does not fix, because it is worth not mistaking one for the
     other: the ceiling here is the bed's own depth. See tools/_rakeprobe.mjs and
     the note in CONTRACT.md. */
  float t = ${RAKE_NEAR.toFixed(5)};
  for (int k = 1; k <= 8; k++) {
    float hs = texture2DGradEXT(uDirtM, d1 + uSunStep * t, ddx, ddy).b;
    rake = max(rake, hs - (dirtH + t * uSunRise));
    t *= ${RAKE_RATIO.toFixed(5)};                        // to ${(RAKE_FAR * 1000).toFixed(0)} mm in eight
  }
}
/* ---- and the part that must survive the footprint ----
   Fading this out with the grains, as it was, threw away the wrong half. Two
   different quantities are tangled here. *Which* grains are shadowed is a
   per-grain fact and it stops being resolvable once a pixel covers several of
   them, so that has to go. *How much* of the surface is shadowed is a property of
   the bed and is true at any distance: a packed grain bed under an eight-degree sun
   has something like a quarter of its area in shadow whether you can see the
   individual shadows or not. Losing it made the mid-distance floor brighter and
   flatter than the near field, which is the measured symptom — high-frequency
   energy falling three to five fold with depth where a real photograph's
   mid-distance band is the busiest part of the frame.
   So the resolved term crossfades into the mean rather than into nothing. It
   cools as well as darkens for free, because this multiplies the warm key only and
   what is left is the violet sky fill. */
float rakeRes = clamp(rake * 3.4, 0.0, 1.0);
/* The mean shadowed fraction, in place of the flat 0.26 this used to collapse
   to. Centred so the floor's mean luminance does not move — armour runs a little
   under half the floor, so 0.13 + 0.29 * armour averages near the old constant —
   and the bedform terms swing about it. lin and rip are signed, so they cost
   nothing at the mean and everything at the pixel. */
float msh = clamp(0.13 + 0.29 * armour - sandW * 0.045, 0.015, 0.60);
gRake = 1.0 - mix(msh, rakeRes, grainF) * rakeW;

/* ---- the cast shadow of the bedform itself, at every distance ----
 * Separate from the block above and deliberately *not* gated by grainF, because
 * this is not a sub-pixel statistic — it is a shadow a hand's breadth long, and
 * the reason it has to be here rather than in relief is that the ripple is
 * fifteen centimetres and the mesh row spacing is forty-two.
 *
 * A shadow is one-sided, so this is not the sinusoid: the lee flank goes dark
 * and the crest and the stoss face do not. Under an eleven-degree sun a two-
 * centimetre ripple on a fifteen-centimetre pitch throws a shadow that covers
 * most of its own lee, which is why the amplitude is this large — a real
 * rippled bed at this sun angle is genuinely a third in shadow, and that
 * contrast is the entire reason a bedform is legible in a golden-hour
 * photograph and invisible at noon.
 *
 * The important property, and the reason this lands where four rounds of
 * sampling work did not: the *same world feature* is low frequency near and
 * high frequency far. A 15 cm ripple at three metres is forty pixels, so it
 * sits in the denominator; at twelve metres it is five, which is inside the
 * nine-pixel kernel the midground is judged with; past twenty-five bsin fades
 * it on its own Nyquist limit rather than aliasing. So it lifts the mid band
 * without touching the near field, which already measures a little crisper than
 * the reference — and that is a property of the geometry, not of a distance
 * fade someone chose. */
/* Mean-removed, and that is not cosmetic bookkeeping. A one-sided shadow has a
   positive mean by construction, so the first version of this took eight per cent
   off the floor's direct light — the floor measured 0.354 down to 0.316 — which
   is a brightness change dressed up as a texture change, and System 4 has just
   spent a round getting that floor lit. The constants are the measured means of
   the two smoothsteps over a uniform argument, so what is left is contrast at
   zero cost in exposure. */
float ripSh = (smoothstep(-0.18, -0.92, rip) - 0.24) * rpF * 0.34;
/* And the same for the lineation, at the finer end. Current lineation on a
   gravel bed is a train of low ridges of clustered pebbles a few centimetres
   apart drawn out along the flow, and at this sun elevation each one shades the
   trough beside it. Across the line of sight, so it survives the grazing view. */
/* Mutually exclusive with the ripple train, which is not a hack to avoid a
   pattern — it is the bedform phase diagram. Current lineation is an
   upper-flow-regime plane-bed structure and ripples are a lower-flow one, so a
   patch of bed carries one or the other and never both. Overlapping them put a
   train varying along the channel across a train varying across it, and the
   product of two gratings is a grid: magnified, the floor came out as
   brickwork. */
float linSh = (smoothstep(-0.14, -0.84, lin) - 0.22) * floorB * 0.19
            * (1.0 - clamp(rpF * 1.35, 0.0, 0.92));
/* The grit's crevice occlusion, as a shadow on the direct term rather than as a
   pigment — a socket between grains is a hole, and CONTRACT.md is explicit that
   a hole given pigment survives to distance as a flat spot facing nowhere.
   Mean-removed against the map's measured mean of 0.934 so this costs nothing in
   average luminance and everything at the pixel; unlike the sinusoids above it
   is a *packing*, so at strength it reads as a stony bed rather than as fabric,
   which is what the ripple term could not do. */
float gSock = clamp((0.934 - gr.a) * 2.4, -0.5, 0.5) * gritK * floorB;
gRake *= (1.0 - ripSh) * (1.0 - linSh) * clamp(1.0 - gSock, 0.32, 1.34);

vec3 gA  = mix(dirtA, sandA, sandW);
vec3 gM  = mix(dirtM, sandM, sandW);
/* Relax each normal toward flat as the footprint passes *its own* feature size.
   The dirt map's relief is grains, a few millimetres to three centimetres, and it
   has to go early. The sand map's is a ripple train at a quarter of a metre, which
   is resolvable four times as far out, and fading it on the grain schedule is what
   left the sand reading as a blank hillshaded surface with no bedform on it. */
vec3 gNt = normalize(mix(
  normalize(mix(vec3(0.0, 0.0, 1.0), dirtN, 0.16 + 0.84 * grainF)),
  normalize(mix(vec3(0.0, 0.0, 1.0), sandN, 0.16 + 0.84 * platF)),
  sandW));
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
/* Computed before the steep branch because the branch needs it to decide whether
   to pay for the grit layer's reprojection; applied after it. */
float gritNK = smoothstep(0.020, 0.045, footG) * (1.0 - rockW) * (1.0 - wallM);
vec2 gritGB = gr.gb;

vec3 triW = pow(abs(gN), vec3(4.0));
triW /= max(triW.x + triW.y + triW.z, 1e-4);
float steep = smoothstep(0.14, 0.40, slope);
if (steep > 0.006) {
  /* Only the two vertical projections are needed: the sample above already is
     the horizontal one, so this blends against it rather than recomputing it. */
  float ax = abs(gN.x), az = abs(gN.z);
  float pw = ax / max(ax + az, 1e-4);
  vec2 uzy = vWPos.zy * 0.3846, uxy = vWPos.xy * 0.3846;
  /* Explicit gradients, for the same reason the rock block below has them: this
     branch was already here and already divergent, so these three pairs of
     fetches have been running on undefined derivatives on the wall-ramp edges
     the whole time. The gradient of a scaled planar projection is the scaled
     gradient of the position, and pdx/pdy are quad-uniform. */
  vec2 zdx = pdx.zy * 0.3846, zdy = pdy.zy * 0.3846;
  vec2 xdx = pdx.xy * 0.3846, xdy = pdy.xy * 0.3846;
  vec3 pA = mix(texture2DGradEXT(uDirtA, uxy, xdx, xdy).rgb,
                texture2DGradEXT(uDirtA, uzy, zdx, zdy).rgb, pw);
  vec3 pM = mix(texture2DGradEXT(uDirtM, uxy, xdx, xdy).rgb,
                texture2DGradEXT(uDirtM, uzy, zdx, zdy).rgb, pw);
  vec3 pN = mix(texture2DGradEXT(uDirtN, uxy, xdx, xdy).xyz,
                texture2DGradEXT(uDirtN, uzy, zdx, zdy).xyz, pw) * 2.0 - 1.0;
  float w = steep * (1.0 - sandW);
  gA  = mix(gA, pA, w);
  gM  = mix(gM, pM, w);
  gWN = normalize(mix(gWN, tsToWorld(normalize(mix(vec3(0.0, 0.0, 1.0), pN,
        0.16 + 0.84 * grainF)), gN), w));
  /* The grit layer needs the same reprojection and for exactly the same reason.
     Its UV is world XZ, as the dirt's was, so on a slope its grains are drawn
     out along the dip line. Read at GRIT_N 6.0 the far_320 head came back combed
     into long parallel fibres, and an isotropic worley packing can only produce
     parallel marks if the projection is stretching it - so the layer added to
     break the streaks was delivering its detail already aligned with them.
     Four fetches, only on steep ground that is also past the gritNK onset. */
  if (gritNK > 0.002) {
    vec2 gz = (vWPos.zy + vec2(3.7, 12.9)) * gSc;
    vec2 gx = (vWPos.xy + vec2(3.7, 12.9)) * gSc;
    vec2 gzdx = pdx.zy * gSc, gzdy = pdy.zy * gSc;
    vec2 gxdx = pdx.xy * gSc, gxdy = pdy.xy * gSc;
    vec2 gp0 = mix(texture2DGradEXT(uGrit, gx, gxdx, gxdy).gb,
                   texture2DGradEXT(uGrit, gz, gzdx, gzdy).gb, pw);
    vec2 gp1 = mix(texture2DGradEXT(uGrit, gx * 0.5, gxdx * 0.5, gxdy * 0.5).gb,
                   texture2DGradEXT(uGrit, gz * 0.5, gzdx * 0.5, gzdy * 0.5).gb, pw);
    gritGB = mix(gritGB, mix(gp0, gp1, gTw), w);
  }
}

/* ---- the grit layer's normal, on far ground ----
   makeGrit packs a normal into G,B and this shader has never read it: the layer
   drives an albedo mottle (gr.r) and a socket (gr.a) and nothing else. rock.js
   has always read it, as domApply((gr.gb - 0.5) * 1.9, gN); terrain has not.

   This is the only layer in the shader whose feature size is held constant in
   screen space - gLod/gSc key the sample to footG - so it is the only detail
   here that does not thin out with distance. Every other normal is world-locked
   and is flattened by the mip chain long before 100 m. Past a 40 mm footprint
   grainF has faded the dirt normal to its 0.16 floor and the mesh normal shades
   the surface very nearly alone: broad undulation with no relief on it. Under a
   15 degree sun a small normal deviation is a large luminance swing, so on a
   slope facing the light that undulation reads as long parallel streaks, and it
   crosses landform boundaries because the undulation does. That is the far_320
   headwall, and the flat version of the same absence is the mid-distance floor.
   It is an absence rather than a term to remove, which is why ablating rill and
   gully each came back innocent.

   The onset puts it outside the near field by construction rather than by
   measurement: ground samples its near and mid bands at 9.1 and 12.1 mm and
   wash_mid its near at 17.9 mm, so gritNK is exactly zero on all three and
   nothing downstream can differ by a bit. It first carries weight in wash_mid's
   mid band at 28.4 mm - the population the gradient headroom belongs to - and
   is saturated on the far_320 head at about 100 mm. No slope gate: the two
   defects are one defect seen flat and seen on a slope, so a gate on slope
   would fix half of it by construction. */
if (gritNK > 0.002) {
  /* Composed in the frame of the normal already computed rather than mixed
     toward a replacement, so the sand bedform and the triplanar reprojection
     survive underneath it instead of being crossfaded away at range. */
  gWN = tsToWorld(normalize(vec3((gritGB - 0.5) * (GRIT_N * gritNK), 1.0)), gWN);
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
/* ---- and why this was the frame's worst artefact ----
   The plate *edges* are the finest feature in the scene: a shrinkage crack is one
   to three centimetres wide, an order of magnitude below the plate it bounds. So
   the fade has to be keyed to the crack width, not to the plate size — at eight
   metres and a grazing angle the plates are still three pixels across, which is
   why gating this on plate size left it running at full strength, and a
   two-and-a-half unit height step across a one-pixel line drives the shading
   normal straight through the terminator. The result was a hard-edged cream and
   near-black hash spread across the whole midground of every frame: bimodal, high
   contrast, and following the crack net rather than the ground. It was diagnosed as
   the gravel layer disintegrating; it was the mud.

   The contrast is also cut hard, and rebalanced from the crack onto the curl. Real
   desiccation polygons curl *upward* at their rims as they dry, so at a low sun each
   plate catches a highlight along its sun-facing rim and throws a hairline shadow on
   the other side, and the plate top is smoother than the sand around it. It is the
   raised rim that carries the read, not a dark line: a deep black groove between
   pale plates is a decal, which is what this had become. */
/* ---- and why the plate relief is allowed further out now ----
   This faded the curl out between footprints of 4 and 16 mm, which is inside two
   metres of the camera: past a stride the pan was a flat painted net, which is
   how "no mud-crack plate relief" survived a round in which mud cracks were
   built. The reason the gate was that tight was real — a two-and-a-half unit
   height step across a one-pixel crack drives the shading normal through the
   terminator and produces a cream-and-black hash — but that argument is about
   the *crack*, which is one to three centimetres wide, and the thing that
   carries a dried pan at distance is not the crack. It is the plate: a
   hand's-width polygon curled up at its rim, which at an eleven-degree sun
   catches a highlight along one edge and lays a hard shadow across its
   neighbour. A ten-centimetre plate is still four pixels at eight metres.
   ---- and the first attempt at that was wrong in an instructive way ----
   Widening the curl's fade to a nine-centimetre footprint did lift the
   midground measurement by a quarter, and it did it by producing a net of
   glowing worms across every pan — the "net of glowing filaments over dark
   cores" this file already warns about, arrived at from the other end. The
   mechanism is specific and worth recording: the curl is applied through
   bumpFrom, which builds a normal from dFdx of a *sampled value*. Once the
   footprint exceeds the feature, that derivative is not the slope of the plate,
   it is the difference between two independent mip samples — noise, amplified
   by the bump scale and then lit by a raking sun. A derivative bump cannot be
   extended past its own feature size at all, however good the reason.
   So the relief keeps its original tight gate and the *tone* carries the
   distance, which is what CONTRACT.md says about this whole class of feature:
   pigment survives what geometry does not. */
float crkF = 1.0 - smoothstep(0.004, 0.016, foot);
float curlF = 1.0 - smoothstep(0.022, 0.090, foot);
/* ---- polarity: a crack is a groove, not a weld ----
 * Reported as broken: "a raised polygon lattice, bright tan welts, heavily
 * stair-stepped… if this is meant to be desiccation cracking, it is inverted:
 * real mudcracks are recessed dark lines in a mud drape, not raised bright
 * ridges standing proud of a gravel bed."
 *
 * The reading is correct and the cause is the balance of these two terms. Both
 * halves are real features — the crack is a groove and the plate rim genuinely
 * curls up as it dries — but the rim was weighted slightly *above* the groove
 * (0.95 against 0.85) while also being the brighter of the two in albedo. A
 * continuous net that is both raised and pale is a weld bead, and once the sun
 * is raking it the rim catches a highlight along its whole length, so the net
 * reads as the positive feature and the plate as the background. That is the
 * figure and the ground the wrong way round.
 *
 * A real dried pan is the opposite: what you see from any distance is a dark
 * net, because the crack is a shadowed slot a centimetre wide and the curl is a
 * couple of millimetres of lift you only notice on the sun-facing rim. So the
 * groove takes the weight and the rim is left as the small highlight it should
 * always have been. It also fixes most of the aliasing complaint for free —
 * the stair-stepping was the derivative bump running at full strength on the
 * brightest, most continuous feature in the map. */
float crackH = (ck.b * 0.26 - ck.r * 1.35) * panW * crkF;
/* Weak on purpose. The curl rim is a couple of millimetres of lift on a plate a
   hand's width across, and a rim strong enough to be unmissable is a bright wire —
   the pan came out as a net of glowing filaments over dark cores, which is the
   decal read from the other direction. It should be a highlight you notice on the
   sun-facing side of each plate, no more. */
gWN = bumpFrom(crackH, gWN, 0.048 * crkF);
/* The curl as a tone, which is what reaches the mid distance. A plate rim that
   has lifted off the bed is a couple of millimetres of relief and no shadow to
   speak of at eight metres, but it is genuinely paler — it dried first, it is
   dustier, and it is the part a passing flood polishes last. Small, and in
   pigment, so it neither aliases nor needs a derivative. */
gA *= 1.0 + (ck.b - 0.30) * 0.06 * panW * curlF;
gA = mix(gA, gA * uSilt * (0.88 + ck.g * 0.30), panW * 0.95);
/* And the crack darkens harder, for the same reason: the net has to be the dark
   feature. A shrinkage crack is a slot open to a sliver of sky and nothing else,
   so it is the darkest thing on a dried pan by a long way. */
gA *= 1.0 - ck.r * panW * 0.56 * (0.30 + 0.70 * crkF);
/* Clay dries smoother than the sand it sits in — a separate cue from the relief,
   and one that survives to any distance because it is a roughness difference over
   a whole patch rather than a feature. */
gM.g = mix(gM.g, 0.86, panW * 0.75);
gM.r *= 1.0 - ck.r * panW * 0.40 * (0.30 + 0.70 * crkF);

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
/* Never on the wash head. Stratification is a *section* — it means you are
   looking at a face the channel has cut down through flood deposits — and the
   head is the opposite thing, a colluvial slope built up by material coming down
   it. Run there it drew horizontal bands keyed to world height straight across a
   surface with no beds in it, which is the "uniform horizontal striping" half of
   the retaining-wall read. */
float headM = smoothstep(-286.0, -322.0, vWPos.z);
float bankW = smoothstep(0.28, 0.52, slope) * (1.0 - wallM) * (1.0 - sandW)
            * (1.0 - headM)
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
  /* This line was the far_270 diamond lattice, and the fix is not here — it is
     the tilt bound inside bumpFrom. Do not reach for a footprint fade in front
     of the call: that was tried, measured live at 43% of pixels, and left the
     lattice untouched, for the reason written up at bumpFrom. */
  gWN = bumpFrom((coarse - 0.5) * inBed * bankW, gWN, 0.022 * platF);
}

/* ---- wall rock, triplanar so vertical faces do not smear ----
 * Nine fetches — three maps, three planes each — and the note left with them
 * said that branching them behind a rockW test was the obvious first cut if
 * headroom ever got tight. It is, and this is it.
 *
 * rockW is wallM * (0.34 + 0.66 * smoothstep(...)), and wallM is
 * smoothstep(0.06, 0.42, vWall) — so it is identically zero everywhere off
 * the wall ramp. That is the entire wash floor, the terraces, the whole
 * foreground of the low views and most of the pixels of the wide ones. On all
 * of them the three lines below resolved to mix(ground, rock, 0.0): nine
 * texture fetches, three of them a full triplanar normal reconstruct with its
 * three normalizes, computed and then discarded.
 *
 * The reason it was not branched before is real and is answered above rather
 * than ignored: rockW varies per fragment, so a quad on the wall's edge
 * diverges, and an implicitly-differentiated fetch in divergent flow has no
 * defined derivative. triSampleG/triNormalG take the gradients that were
 * computed at the top of the shader, so there is nothing left to be undefined.
 */
vec3 albedo, arm, wN;
if (rockW > 0.002) {
  vec3 rockA = triSampleG(uRockA, vWPos, triW, 0.0715, pdx, pdy);   // 14 m tile
  vec3 rockM = triSampleG(uRockM, vWPos, triW, 0.0715, pdx, pdy);
  /* Filtered against the footprint like the ground grain, and for the same
     reason: the rock map's own relief is centimetres, so on a wall face seen at
     fifty metres a pixel spans a dozen grains. Unfiltered, that came out as
     chunky warm speckles on the wall slopes that read as glitter rather than as
     rock. */
  vec3 rockWN = normalize(mix(gN, triNormalG(uRockN, vWPos, triW, 0.0715, gN, pdx, pdy),
                              0.12 + 0.88 * rockF));

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
  rockA *= mix(vec3(0.86, 0.70, 0.62), vec3(1.10, 1.05, 0.96), resist * smoothstep(0.0, 0.20, bedFr));
  rockM.g = clamp(rockM.g * mix(1.06, 0.90, resist), 0.2, 1.0);

  albedo = mix(gA, rockA, rockW);
  arm    = mix(gM, rockM, rockW);
  wN     = normalize(mix(gWN, rockWN, rockW));
} else {
  albedo = gA;
  arm    = gM;
  wN     = gWN;
}

/* ---- midground bedform relief: the only normal that survives out there ──────
 * A user walking the scene called the 30-60 m floor "melting", and that word is
 * about form rather than surface, so it was worth measuring the normal instead
 * of the albedo for once. tools/_meltprobe.mjs does it offline. The result ends
 * five rounds of work aimed at the wrong quantity:
 *
 *   dirt normal map, RMS tangent slope    mip 0          0.3233
 *   at 30 m, filtered as actually sampled                0.0061
 *   ...after the 0.16 + 0.84*grainF fade                 0.0010
 *
 * Three parts in a thousand. **At 30 m and beyond the shading normal is, to
 * within a fraction of a percent, the interpolated geometric normal of the
 * mesh.** No texture change can matter there, because no texture arrives.
 *
 * And the mesh has nothing to give either, which was the other half of the
 * probe: the height field's RMS across-wash slope is 0.4407 over a 5 cm baseline
 * against 0.4286 over 20 cm, a ratio of 1.028. The field is smooth below the
 * grid, so the grid is faithful and refining it would recover 3% of nothing.
 * The form at that scale was never authored.
 *
 * Which leaves authoring it here, and the footprint dictates its shape
 * completely. A midground pixel is 29 mm across the view and 615 mm along it at
 * 30 m, rising to 58 x 2456 mm at 60 m — an anisotropy of 21:1 going on 42:1.
 * Anything whose phase varies along the view is averaged over hundreds of texels
 * and returns its mean. Only structure that varies *across* the view survives,
 * which on a wash floor means bedforms whose crests run downstream: braid
 * ridges, gravel stringers, the low benches between anastomosing threads. Those
 * are the right geomorphology anyway.
 *
 * The obliquity budget is tight and is the part that is easy to get wrong. The
 * albedo mottle above already runs across-channel and still dies by 60 m,
 * because its directions carry a 6-14 degree tilt off pure across-channel and at
 * 42:1 that tilt is multiplied by forty-two before it reaches fwidth. The rule
 * that falls out is that a wave of wavelength L tolerates a downstream direction
 * component of about 0.12 L, so the short wavelengths here are within half a
 * degree of pure across-channel and only the metre-scale one is allowed to lean.
 *
 * Amplitudes are set from the shading response rather than by eye. The sun is at
 * -9 degrees azimuth against a wash heading near +9, so it makes an 18 degree
 * angle with the channel: an across-channel slope sees 0.31 of the solar azimuth
 * and the base term is sin(11 deg) = 0.19, giving a luminance modulation of
 * about 1.6 times the slope. Slopes of 0.08 to 0.12 therefore buy 13 to 19 per
 * cent, which is a real bedform reading. It is also safely off the cliff this
 * project has fallen down twice: self-shadowing would need a slope past 0.6, so
 * this cannot go binary the way the clast grit did, and the metric it moves will
 * be measuring structure rather than a lit/unlit decision.
 *
 * Ramped in on the footprint so the near field is untouched. Close up, form at
 * this scale is carried by the clasts and the grain, both of which are already
 * modelled and both of which are sharp; the ramp means this term is a midground
 * replacement for them rather than an addition on top. */
float bedW = smoothstep(0.006, 0.022, footMin) * floorB
           * (1.0 - smoothstep(0.06, 0.20, slope));
if (bedW > 0.004) {
  /* Four wavelengths from 0.11 to 0.48 m. The top of that range is where the
     height field's new flank roughness takes over — it now carries 0.4 m and up
     as real geometry — and the bottom is set by the footprint, since 0.11 m is
     about four pixels across the view at 30 m and two at 60 m, where bk1
     retires it. A fifth term at 0.76 m was tried and removed as double-counting
     against the mesh. */
  const vec2 bd1 = vec2(1.00000,  0.0000), bd2 = vec2(0.99993, -0.0120);
  const vec2 bd3 = vec2(0.99968,  0.0252), bd4 = vec2(0.99899, -0.0450);
  const float bl1 = 0.11, bl2 = 0.18, bl3 = 0.30, bl4 = 0.48;
  /* Phase offsets, which the previous version did not have and needed. Every
     term was cos(TAU * dot/L) and therefore equal to one wherever dot(wxz, d)
     was zero, so all five crests coincided on a line down the wash and the
     stack's peak was the arithmetic sum of its amplitudes rather than about
     three sigma. Offsetting them keeps the RMS while cutting the worst case,
     which is what allows the amplitudes below to be as large as they are. */
  /* ---- warped across, straight along ────────────────────────────────────────
   * Four fixed wavelengths are a comb, and an amplitude envelope alone does not
   * cure that: it makes the comb loud here and quiet there, but where it is
   * loud the teeth are still evenly spaced and the eye reads a rake. The
   * periodicity has to go, and the only question is which axis can afford it.
   *
   * Warping the phase *downstream* is what one would normally do and is exactly
   * what cannot be afforded here. A pixel is 2.46 m long at 60 m, so a phase
   * that changes along the view is averaged over that length and the term
   * returns its mean — the same mechanism that removes the dirt normal map at
   * this range. The budget works out at about a 1 per cent lateral wander per
   * unit of downstream run for the 0.11 m term, which is not enough to matter.
   *
   * But warping the phase by a function of the *across-channel* coordinate
   * alone costs nothing at all, because it adds no downstream phase gradient
   * whatever. The crests stay dead straight and perfectly parallel to the flow —
   * so fwidth is untouched and the term survives exactly as before — while
   * their *spacing* becomes irregular: bunched in places, opened out in others.
   * That is the difference between a rake and a bar surface, and it is free. */
  float bax = dot(wxz, bd1);
  float bwo = 0.055 * sin(bax * 0.83) + 0.031 * sin(bax * 1.97 + 1.3)
            + 0.018 * sin(bax * 4.30 - 0.6);
  float bp1 = (bax             + bwo) / bl1 + 0.00;
  float bp2 = (dot(wxz, bd2) + bwo) / bl2 + 0.37;
  float bp3 = (dot(wxz, bd3) + bwo) / bl3 + 0.62;
  float bp4 = (dot(wxz, bd4) + bwo) / bl4 + 0.19;
  /* Same band limit bsin uses, kept per-term so each wavelength dies on its own
     schedule rather than the shortest one taking the rest with it.

     Worth knowing before anyone tunes this: fwidth of a *phase* is a finite
     difference of a periodic function, and it under-reports once the phase
     advances more than half a cycle per pixel, because the difference wraps. A
     comb at nearly one cycle per pixel differences to nearly zero, so the gate
     reads wide open exactly where the component is aliasing worst. Replacing
     these four with a footprint test — 1.0 - smoothstep(0.28, 0.55, footMin/blN),
     which is a derivative of position and cannot wrap — is almost certainly the
     more correct form. It was written, rendered and reverted only because it
     changed nothing about the artefact being chased at the time and this term
     is measured good; it is a real improvement waiting for someone with a
     budget to verify it against the midground metrics. */
  float bk1 = 1.0 - smoothstep(0.22, 0.55, fwidth(bp1));
  float bk2 = 1.0 - smoothstep(0.22, 0.55, fwidth(bp2));
  float bk3 = 1.0 - smoothstep(0.22, 0.55, fwidth(bp3));
  float bk4 = 1.0 - smoothstep(0.22, 0.55, fwidth(bp4));
  /* Slope amplitudes, not height amplitudes — the shading response is linear in
     slope and it is the quantity the arithmetic above is about. The gradient of
     A*sin(2*pi*p) with respect to world position is A*2*pi*cos(2*pi*p)*d/L, so
     working in slope means the constants below *are* the slopes.
     
     Raised roughly 2.2x from the first version, which measured 13 levels out of
     255 and was correct in construction but inaudible. The ceiling is set by
     self-shadowing rather than by taste: the sun sits eleven degrees up and
     eighteen degrees off the channel, so an across-channel facet goes to the
     terminator at a slope of 0.63, and past that the term stops being relief and
     becomes a lit/unlit decision. That is the cliff the clast grit fell down —
     a binary field scores beautifully on a one-pixel gradient and looks like
     confetti. These sum to 0.46 in the worst case and about 0.36 at three sigma,
     so there is roughly a factor of two of headroom and the term stays linear.
     RMS slope is 0.121, which against the 1.6x shading response of this sun
     geometry is a 19 per cent luminance modulation: a bedform one can see. */
  const float TAU = 6.2831853;
  /* Braiding rather than corduroy: the amplitude is modulated by the macro noise
     so threads appear and die out along their length. That modulation varies
     downstream, which the footprint will filter to its mean — which is exactly
     right, because a filtered amplitude is a uniform bedform and a filtered
     *phase* is no bedform at all. This is why the term is built as a fixed comb
     with a varying envelope and not as noise. */
  float bAmp = 0.55 + 0.55 * mac2.b;
  /* ---- the envelope, which is what stops this being corduroy ────────────────
   * The first version at full amplitude was combed: four fixed wavelengths at
   * one strength everywhere, crests running the entire twenty-metre length of a
   * bar without interruption. Corduroy is a named defect on this floor and that
   * would have been the third time.
   *
   * mac2 was supposed to prevent it and cannot, for a reason worth stating
   * because it constrains every fix available here. mac2 varies over about
   * eighteen metres and mostly *downstream*, and downstream is the axis the
   * footprint destroys — at 60 m a pixel is 2.46 m long, so an envelope that
   * changes along the view is averaged out and the comb it was breaking up
   * reassembles as a uniform one. Anything that is to break this term at range
   * has to vary **across** the channel, on the same axis as the term itself.
   *
   * So the envelopes below are functions of the across-channel coordinate at
   * two to five metres, drifting slowly downstream so the pattern is not a
   * fixed set of stripes bolted to the world. Each term gets a different
   * combination, so typically two of the four are strong at any given place and
   * the others are near their floor. That is a braid bar in plan view: threads
   * of one calibre running for a few metres, dying out, another calibre taking
   * over alongside. It is also cheap — six sines and no texture fetch, which
   * matters because a fetch here would be mip-selected off the 2.46 m
   * downstream derivative and come back as its own mean anyway. */
  float baz = dot(wxz, vec2(-bd1.y, bd1.x));
  float bdr = 0.35 * sin(baz * 0.081) + 0.22 * sin(baz * 0.203 + 2.1);
  float eA = sin(bax * 3.57 + bdr * 3.0);
  float eB = sin(bax * 2.16 + 1.7 - bdr * 2.2);
  float eC = sin(bax * 1.25 - 0.9 + bdr * 1.4);
  float w1 = 0.18 + 0.82 * clamp(0.5 + 0.35 * eA + 0.25 * eC, 0.0, 1.0);
  float w2 = 0.18 + 0.82 * clamp(0.5 + 0.40 * eB - 0.20 * eA, 0.0, 1.0);
  float w3 = 0.18 + 0.82 * clamp(0.5 + 0.35 * eC + 0.20 * eB, 0.0, 1.0);
  float w4 = 0.18 + 0.82 * clamp(0.5 - 0.30 * eA + 0.30 * eB, 0.0, 1.0);
  float bc1 = 0.145 * bk1 * w1 * cos(TAU * bp1);
  float bc2 = 0.135 * bk2 * w2 * cos(TAU * bp2);
  float bc3 = 0.123 * bk3 * w3 * cos(TAU * bp3);
  float bc4 = 0.108 * bk4 * w4 * cos(TAU * bp4);
  float bgx = (bc1 * bd1.x + bc2 * bd2.x + bc3 * bd3.x + bc4 * bd4.x) * bAmp;
  float bgz = (bc1 * bd1.y + bc2 * bd2.y + bc3 * bd3.y + bc4 * bd4.y) * bAmp;
  /* A hard stop short of the terminator. An across-channel facet turns away
     from this sun at a slope of 0.63, and past that the term stops being relief
     and becomes a lit/unlit decision — which is the cliff the clast grit fell
     down, where a binary field scored well on a one-pixel gradient and looked
     like confetti. Typical excursions here are around 0.10 and three sigma is
     0.35, so this clamp should almost never engage; it is here so that the
     places where the envelopes happen to coincide cannot go binary. */
  bgx = clamp(bgx, -0.42, 0.42);
  wN = normalize(wN - vec3(bgx, 0.0, bgz) * bedW);
  /* A bedform is a deposit as well as a shape, so the crests are winnowed a
     shade paler and the troughs hold the fines. Small, and mean-zero, because
     the point of this term is the normal — but a relief with no tonal
     correlate reads as embossing. */
  albedo *= 1.0 + (0.055 * bk2 * w2 * sin(TAU * bp2)
                 + 0.045 * bk4 * w4 * sin(TAU * bp4)) * bedW * bAmp * 0.9;
}

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
/* Tightened again, and this is the third attempt at it. The compound range was
   still 2.4 to 1 — a patch of wall two and a half times brighter than the patch
   beside it, at a scale of tens of metres and with no relief to explain it, which
   is a milky veil floating over the geometry however it is coloured. It was
   reported as a rendering bug twice. Variance in *value* at macro scale has to stay
   inside the band where the eye reads it as the same material, and everything
   interesting has to happen below that. */
float bright = (0.90 + mac.g * 0.20) * (0.95 + mac2.g * 0.10) * (0.96 + vr.g * 0.09);
albedo *= bright;

/* ---- what actually carries the mid distance ----
 * Measured, the floor's high-frequency energy fell three to five fold between the
 * near field and twenty to forty metres, where a real dry-wash photograph either
 * holds level or *rises* — the mid-distance band is the busiest part of the frame,
 * because more objects fall into each pixel and the eye is looking across the
 * surface rather than down at it. The previous round fixed a grazing-angle hash by
 * filtering relief against the pixel footprint, which was right, and took the
 * albedo variance out with it, which was not.
 *
 * The distinction is scale, not kind. A cobble at thirty metres is below a pixel,
 * so its *shape* has to average out and its normal has to stop being perturbed. Its
 * *colour* does not average out, because the thing the eye reads at that range is
 * not one cobble but the tone of the gravel bar it belongs to against the sand
 * beside it — and that patch is metres across, tens of pixels, nowhere near the
 * resolution limit. So variance below a pixel is filtered and variance above it is
 * not, and everything below runs unfiltered by construction.
 *
 * Two terms. Facies patches, because a wash floor is a mosaic of surfaces with
 * genuinely different colours — an armoured gravel lag is greyer and flatter than
 * the clean sand sheet next to it, and ground still damp under the surface is
 * darker and more purple than either. Both are expressed in *chroma*, not value:
 * value variance at macro scale is what came out as milky blobs floating over the
 * midground, twice, and the lesson from that is not to abandon macro variance but
 * to keep it out of the luminance channel where the eye reads it as depth.
 */
float floorM = (1.0 - rockW) * (1.0 - wallM) * smoothstep(0.34, 0.12, slope);
/* Narrow thresholds on purpose: the edge of a gravel lag or a sand lobe is a crisp
   line shaped by the flow that laid it, and a wide crossfade is the visible
   material seam the floor was criticised for two rounds ago. */
float lagP  = smoothstep(0.47, 0.59, mac2.b * 0.66 + vr.g * 0.52) * floorM * (1.0 - sandW);
float dampP = smoothstep(0.58, 0.71, mac.b * 0.70 + vr.r * 0.46) * floorM;
/* A hue rotation, not a desaturation. The first attempt mixed the lag patches
   toward their own luminance and cost the one region already measuring at target
   eight hundredths of saturation — the frame has three separate desaturating
   passes over it already (the dust base, the varnish patches, the haze) and a
   fourth is how a floor ends up as the narrow mauve band this has twice been. A
   scaling of the channels keeps the chroma and moves the hue, which is what
   distinguishes a mixed-lithology gravel armour from the oxide-stained fines
   around it in the first place. */
albedo = mix(albedo, albedo * vec3(0.94, 0.98, 1.06), lagP * 0.42);
albedo = mix(albedo, albedo * vec3(1.06, 0.86, 0.86), dampP * 0.34);

/* Ripple banding, in world space rather than in the sand map, and that is the
   whole point of it. A ripple train's individual crests are a quarter of a metre
   apart and gone by fifteen metres, but the crests are not independent — they
   align into bands a metre or two wide running across the channel, and a
   correlated feature at that wavelength is still several pixels deep at forty
   metres. Uncorrelated pebble noise cannot survive downsampling and this can,
   which is why it belongs here and not in a tiling albedo map where the mip chain
   averages it away. Amplitude is small and purely tonal — it is the shadowed flank
   of each band being marginally darker, not a bump. */
float bandPh = vWPos.z * 0.62 + (mac2.r - 0.5) * 5.4 + (vr.b - 0.5) * 2.4;
float band = 0.5 + 0.5 * sin(bandPh * 6.2831853);
float bandW = floorM * smoothstep(0.34, 0.58, mac.r * 0.62 + vr.g * 0.5);
albedo *= 1.0 + (band - 0.5) * 0.13 * bandW;

/* ---- and the same thing again at the scale the metric can actually see ----
   The band above is a metre and a half from crest to crest. Worked through, that
   subtends about a hundred pixels at thirty metres, and the high-pass the
   midground is being judged with has a nine-pixel kernel — so a metre-scale
   feature contributes exactly nothing to the number, however visible it is. It
   was answering the description of the defect without touching the measurement.

   What lands in a nine-pixel window at twenty to forty metres is fifteen to
   thirty centimetres of world space, which is the spacing of the individual
   ripple crests and the size of the cobbles between them. So the train has to be
   carried at its own wavelength, not just as its envelope.

   The reason this can be done analytically here when it could not be done as
   relief is that a sine has a known response to a box filter. Its amplitude is
   attenuated by sinc(pi * foot / lambda), which is a smooth roll-off to zero as
   the footprint approaches the wavelength — so it fades out instead of aliasing,
   and it is honest about when it stops being resolvable rather than being cut off
   at an arbitrary distance. Two wavelengths beating against each other so the
   train bifurcates and dies out along its length rather than combing the whole
   floor at one pitch, which is the corduroy this was criticised for.

   rip, lin, rpF and armour are now built once, up beside the raking
   march, because the same bedform has to drive both the pigment here and the
   shadowed-area fraction there — and it is the shadow that carries the band.
   Authoring them twice is how a ripple crest ends up lit by one field and
   shadowed by another. The pigment share is small on purpose: a ripple crest is
   not a different colour from its trough, it is the same sand catching a
   grazing sun, so putting the contrast into pigment is what would make it a
   painted stripe. */
albedo *= 1.0 + rip * 0.075 * rpF
              + lin * 0.045 * floorB * (1.0 - clamp(rpF * 1.35, 0.0, 0.92));
/* And the grit's tone, at the same footprint-locked scale. Mean-removed against
   the map's measured 0.427. Small beside the occlusion above, because most of
   what distinguishes one patch of a gravel bed from the next at this range is
   how much of it is in its own shadow, not what colour it is. */
albedo *= 1.0 + (gr.r - 0.427) * 1.45 * gritK * floorM;

/* Cobble-scale chroma mottle. A gravel bar at thirty metres has stopped being a
   collection of readable stones and become a *tone* — greyer and flatter than the
   sand beside it — and that tone is what has been missing. Averaging colour over a
   footprint is what a mip chain does correctly and does not need help with; the
   reason the midground went flat is that the relief filter was applied to the
   pigment too.
   Built from band-limited sinusoids rather than a texture fetch, for the same
   anisotropy reason: mip level selection is driven by the longer of the two
   derivatives, so a tiling map at this scale is chosen at a blurred level and
   averages to flat under exactly the grazing view where this detail is wanted.
   Two crossed pairs at incommensurate spacings and off-axis angles, which gives
   irregular patches of a quarter to a half metre without an axis-aligned grid.

   Summed rather than multiplied, because a product of band-limited terms
   collapses to zero the moment *either* factor becomes unresolvable.

   And oriented across the channel, which is the part that took three renders to
   get right. fwidth is the sum of both screen derivatives, so every term is
   filtered by whichever screen axis is worse — and under a grazing view the
   vertical axis is catastrophically worse, about 0.4 m of ground per pixel at
   twenty-five metres against a couple of centimetres horizontally. Any wave with
   a component along the view direction is therefore filtered out entirely, which
   is what happened to the first two attempts: measured, they changed the mid-band
   pixels by about 1% and the metric by nothing.

   What survives a grazing view is structure that varies *across* the line of
   sight, and it happens that this is also the honest geomorphology. A ripple
   train's crests run across the channel, so its phase varies downstream — along
   the view axis — and at twenty-five metres a 15 cm spacing genuinely cannot be
   resolved; no filter choice changes that. But braid channels, gravel stringers
   and the tonal edges of bars run *with* the flow, so their variation is
   across-channel and stays resolvable to the horizon. Those are what carry a real
   wash floor at distance, and they are what belongs here. */
float mA = bsin(dot(wxz, vec2(0.995, 0.100)) / 0.29)
         + bsin(dot(wxz, vec2(0.985, -0.174)) / 0.47);
float mB = bsin(dot(wxz, vec2(0.999, 0.045)) / 0.19)
         + bsin(dot(wxz, vec2(0.970, 0.242)) / 0.72);
/* Irregular along its length, so it reads as braiding rather than as the combed
   parallel streaks this floor has been criticised for once already. */
float mJ = 0.55 + 0.45 * (mac2.b * 0.6 + vr.g * 0.7);
float mtl = clamp(0.5 + (0.20 * mA + 0.15 * mB) * mJ, 0.0, 1.0);
albedo *= 1.0 + (mtl - 0.5) * 0.34 * floorM;
albedo = mix(albedo, albedo * vec3(0.93, 0.99, 1.07),
             smoothstep(0.56, 0.78, mtl) * floorM * 0.5);
/* Not on the mud: dried silt goes dusty buff, and a violet cast over it turns
   the pans into lilac lace. */
/* The grey-violet patches are patches. Run at half strength over most of the
   frame this is not variance, it is a desaturation pass: Sedona dirt is hematite,
   and hematite is a saturated red, not a pale magenta. */
/* Off the walls almost entirely. A grey-violet patch on a rock face is a desert
   varnish, which is a thin coating on a *joint* face and follows the geometry; a
   soft-edged one at macro scale that ignores the geometry is the milky veil again. */
float coolP = smoothstep(0.62, 0.90, vr.r) * (1.0 - rockW * 0.85) * (1.0 - panW);
albedo = mix(albedo, dot(albedo, vec3(0.31, 0.52, 0.17)) * uCool, coolP * 0.26);
albedo = mix(albedo, albedo * vec3(1.09, 1.04, 0.97), smoothstep(0.34, 0.72, vr.b) * 0.26);
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
   How much is a measured question, and the measurement it was tuned to was wrong:
   the floor figure it chased — 0.09 saturation — is wet grey concrete, and a real
   sunlit wash floor measures 0.47 to 0.56 with a tail out to 0.88. A floor dusted
   this hard came out a narrow mauve-beige band. The dust on the floor is therefore
   pulled back to roughly what the walls carry; the floor's saturated tail is the
   clasts' job, not the matrix's, since a tail raised here would just be the orange
   membrane again. */
float aLum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
float dustW = mix(0.02, 0.22, rockW) * (1.0 - panW * 0.4);
albedo = mix(albedo, aLum * uStone, dustW);

diffuseColor.rgb *= albedo;
/* Dry sandstone and dirt have no specular lobe worth the name. Letting roughness
   reach 0.30 put a white sparkle on every sunlit crest — the surface read as wet
   or glittery, and a hard low key makes that worse because the highlight lands on
   whatever facet happens to face it. */
tRough = clamp(arm.g * (0.96 + (mac2.g - 0.5) * 0.14), 0.72, 1.0);
/* Occlusion holds its mean into the distance but loses its variance: the average
   darkening between grains is real at any range, the per-grain contrast is not
   resolvable and was half of the hash. */
tAO    = clamp(arm.r * (0.74 + cav * 0.36), 0.34, 1.0);
tAO    = mix(0.80, tAO, 0.30 + 0.70 * grainF);
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
    uGrit: { value: tex.grit },
    uDamp: { value: new THREE.Color(0.54, 0.37, 0.44) },
    uCool: { value: new THREE.Color(1.02, 0.94, 1.10) },
    uSilt: { value: new THREE.Color(1.14, 1.06, 0.94) },
    /* pale grey-buff quartz sand: what the oxide is a coating on */
    uStone: { value: new THREE.Color(1.06, 1.00, 0.94) },
    /* The dirt tile is 2.6 m and carries about 25 mm of relief, so one metre along
       the sun azimuth is 0.3846 of a tile and the ray climbs tan(elevation) metres,
       which is 5.6 height units. Both derived rather than tuned so they stay
       correct if the sun or the tile changes. */
    uSunStep: { value: new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize().multiplyScalar(0.3846) },
    uSunRise: { value: Math.tan(SUN_EL) / DIRT_RELIEF_M },
    uWind: { value: new THREE.Vector2(Math.sin(TONIGHT_FALLBACK), Math.cos(TONIGHT_FALLBACK)) },
    uBedT: { value: BED_T },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader =
      'attribute float aRef;\nattribute float aPan;\nattribute float aWall;\n' +
      'attribute float aSheet;\nattribute float aFlow;\n' +
      'varying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying float vRef;\nvarying float vPan;\n' +
      'varying float vWall;\nvarying float vSheet;\nvarying float vFlow;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '  vRef = aRef;\n  vPan = aPan;\n  vWall = aWall;\n  vSheet = aSheet;\n' +
        '  vFlow = aFlow;')
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);');

    shader.fragmentShader = FRAG_PREFIX + shader.fragmentShader;
    /* ---- filtered shadow lookup ----
       The worst artefact in the last set was a hard-edged black-and-white pixel
       hash across the midground of every frame, and at magnification it turned out
       to be bimodal: cream and near-black, nothing between. That is not texture
       aliasing, it is the shadow *test* — a binary comparison sampled once per
       pixel. Two things make it violent here. The sun sits at eight degrees, so on
       the wash floor the light arrives at eighty-two degrees of incidence and the
       depth slope across one shadow texel is enormous, which is the classic recipe
       for acne; and the bed is covered in occluders a couple of shadow texels
       across, which cannot be represented and so flicker in and out per pixel.

       Bias and caster changes deal with the cause. This deals with what is left:
       once a screen pixel covers many shadow texels, a single binary sample is the
       wrong answer at any bias, and the right answer is the mean coverage over the
       footprint. Converging toward a partial value as the footprint grows is a
       cheap stand-in for that mean, and it is what makes distant gravel settle into
       an even stipple instead of a hash. The macro re-points every call site in
       the stock lighting chunk without patching it. */
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <shadowmap_pars_fragment>', /* glsl */`
      #include <shadowmap_pars_fragment>
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        /* ---- one bilinear coverage sample, for the footprint taps only ----
         * The four taps below exist to estimate the *mean* shadow coverage over
         * a pixel's footprint. They were each a full getShadow, and at the time
         * a full getShadow was sixteen texture2DCompare calls under PCF_SOFT and
         * seventeen under PCF — so the wrapper was eighty comparisons per light
         * and, with two directional lights in this scene, a hundred and sixty
         * per ground fragment. tools/fillcost.mjs prices the whole terrain
         * fragment shader at 24.2 ms of a 30.7 ms frame at 1440p, and
         * tools/terrcost.mjs puts 23 of those 24 in these five lookups: the
         * forty-one texture fetches this file's own comments worry about are
         * about two milliseconds between them.
         *
         * The redundancy was geometric. PCF_SOFT already integrates a 4x4 texel
         * neighbourhood, and these offsets are 2.6 texels — so five kernels
         * covering roughly nine texels square were being sampled eighty times.
         * A bilinear 4-tap at each offset samples the same neighbourhood at a
         * quarter of the cost, and it is the right kind of estimator for what
         * this term wants: an *interpolated* coverage, not a binary test, so
         * the average of the five stays smooth and the salt-and-pepper this
         * wrapper was built to remove does not come back. A single hard
         * texture2DCompare per offset would be cheaper again and is exactly the
         * bimodal sample the wrapper exists to avoid.
         *
         * That paragraph is past tense now, and the reduction is worth more
         * rather than less. getShadow is no longer three's fixed kernel: it is
         * a blocker-search penumbra, so the centre tap integrates up to two
         * metres of the coarse cascade where these offsets still sit at 2.6
         * texels. The five samples therefore no longer cover one shared
         * neighbourhood, and the overlap argument above does not carry over —
         * worth saying plainly, because a justification that has quietly
         * stopped applying is how most of the wrong turns in this file
         * happened. What replaces it is that the two are answering different
         * questions and both are still answered: the centre resolves the
         * penumbra, which is a property of the blocker, and these four
         * estimate the mean over the screen footprint, which is a property of
         * the range. Re-measured on the penumbra path at 1440p,
         * tools/terrcost.mjs: this block 0.50 ms, the centre tap 3.80, and
         * putting the four full getShadow calls back — which is what the taps
         * were before, priced as the footFull row — costs +18.2 ms, taking
         * wash_mid from 17.1 to 35.3. The penumbra tripled what the reduction
         * saves, because each restored offset would now be a blocker search and
         * a spiral rather than sixteen comparisons.
         *
         * Verified rather than argued, tools/shadowpair.mjs across all nine
         * views: mean absolute difference 0.05 to 0.35 of a code value, every
         * grad and hf/lf window identical to four digits, lit rock 0.619 at hue
         * 14.6 on both sides. The floating-slab crop on wallL is byte-identical,
         * which is the run's own negative control — that surface is rock.js's
         * and this wrapper cannot reach it.
         *
         * The centre tap is left as the stock getShadow, untouched, so the
         * penumbra it carries is bit-identical. */
        float footTap(sampler2D sm, vec2 sz, float si, float sb, vec4 sc) {
          vec3 c = sc.xyz / sc.w;
          c.z += sb;
          float sh = 1.0;
          if (c.x >= 0.0 && c.x <= 1.0 && c.y >= 0.0 && c.y <= 1.0 && c.z <= 1.0) {
            vec2 tx = vec2(1.0) / sz;
            vec2 f = fract(c.xy * sz + 0.5);
            vec2 uv = c.xy - f * tx;
            sh = mix(mix(texture2DCompare(sm, uv, c.z),
                         texture2DCompare(sm, uv + vec2(tx.x, 0.0), c.z), f.x),
                     mix(texture2DCompare(sm, uv + vec2(0.0, tx.y), c.z),
                         texture2DCompare(sm, uv + tx, c.z), f.x), f.y);
          }
          return mix(1.0, sh, si);
        }
        float footShadow(sampler2D sm, vec2 sz, float si, float sb, float sr, vec4 sc) {
          float s = getShadow(sm, sz, si, sb, sr, sc);
          /* Kept for the airlight term below. getShadowMask() only exists in the
             shadow-mask chunk, which meshphysical does not include, so the value
             has to be caught on the way past — and this wrapper is already the
             single point every shadow lookup in the lighting chunk goes through. */
          gShadow = min(gShadow, s);
          /* ---- converge on the footprint's own mean, not on a constant ----
             This used to read mix(s, mix(s, 0.55, 0.80), 1.0 - gFoot), which in
             the far field returns 0.2*s + 0.44. The intent was right — once a
             screen pixel covers many shadow texels the mean coverage is the
             correct answer and a single binary test is not — but a constant
             cannot tell the two cases apart. A footprint over a gravel bed
             really is about half lit, and 0.55 is a fair guess at it. A footprint
             inside the cast shadow of a butte is lit not at all, and there the
             constant hands the surface forty-four per cent of full sunlight that
             nothing in the scene is emitting.
             That leak is then multiplied by gRake, which carries every
             high-frequency term the direct light is supposed to modulate — the
             rake march, the ripple and lineation shadows, the grit's sockets. So
             a distant shaded bank got a phantom sun at nearly half strength with
             the full micro-shadow signal written across it, which is exactly the
             "every shaded bank turns into noise instead of ground" complaint.
             Measured on the far_270 bank, the leak was supplying 39% of the
             luminance and 60% of the standard deviation.
             So take the mean rather than guess it: four extra taps at the
             footprint's own spread, averaged with the centre. Deep inside a
             shadow all five agree on zero and the surface goes properly dark;
             over a hash they disagree and the average is the coverage the
             footprint actually has. Offsets are pre-divide, hence the * sc.w,
             and they collapse to zero in the near field so this is a no-op
             there — which also keeps it out of non-uniform control flow, since
             these are implicit-LOD fetches. */
          float wide = 1.0 - gFoot;
          /* ---- and the near field does not pay for it at all ----
             At wide = 0 the offsets are zero and the mix weight is zero, so the
             four taps return s and are then discarded: the block is an exact
             identity there, not an approximation of one, and skipping it cannot
             move a pixel. The branch is safe with implicit-LOD fetches inside it
             because a shadow map has no mip chain — three builds it with
             NearestFilter and generateMipmaps off — so there is no derivative
             for divergent flow to leave undefined. That is the one condition
             under which this file is allowed a gated fetch without handing the
             gradients in, and it is worth stating rather than assuming. */
          float m = 4.0 * s;
          if (wide > 0.02) {
            vec2 t = (2.6 * wide / sz) * sc.w;
            m = footTap(sm, sz, si, sb, sc + vec4( t.x,  t.y, 0.0, 0.0))
              + footTap(sm, sz, si, sb, sc + vec4(-t.x,  t.y, 0.0, 0.0))
              + footTap(sm, sz, si, sb, sc + vec4( t.x, -t.y, 0.0, 0.0))
              + footTap(sm, sz, si, sb, sc + vec4(-t.x, -t.y, 0.0, 0.0));
          }
          return gRake * mix(s, (s + m) * 0.2, wide * 0.85);
        }
        #define getShadow(a, b, c, d, e, f) footShadow(a, b, c, d, e, f)
      #endif`);
    /* ---- kill the grazing-angle specular sheen ----
     * This is what the floor's missing saturation actually was, and it took three
     * wrong diagnoses to find. Measured across the eight frames, floor saturation
     * ordered itself perfectly by how far the view axis pointed into the sun and
     * how grazing it was: 0.53 looking across the wash, 0.50 looking down at it,
     * 0.41 up-wash, 0.29 straight into the sun. Nothing about albedo is
     * view-dependent, so it was never a pigment problem — and inverting the tone
     * curve on those pixels showed exposure was powerless too, a stop and a half
     * moving the worst region by five hundredths.
     *
     * MeshStandardMaterial sets specularF90 to 1.0, so the Fresnel term climbs to
     * fully reflective white at grazing incidence. That is right for a smooth
     * dielectric and badly wrong for this: dry dirt and sand are rough, porous and
     * dust-coated, the coherent surface reflection is broken up by roughness at
     * every scale and by multiple scattering between grains, and a wash floor does
     * not turn into a mirror when you look along it. Leaving it at 1.0 laid a
     * near-white veil of the sun's own colour over every surface seen edge-on,
     * which desaturated it, drove its value toward clipping, and picked out the
     * ripple crests as the pale streaks that read as combed hair or ski tracks.
     * A little is real, so a little is kept. */
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_physical_fragment>', /* glsl */`
      #include <lights_physical_fragment>
      material.specularColor *= 0.55;
      material.specularF90 *= 0.16;`)
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', /* glsl */`
      /* ---- occlusion tints toward the albedo, it does not go to black ----
       * This was reflectedLight.indirectDiffuse *= tAO, and a geometric
       * occlusion term multiplying indirect light toward zero is not a physical
       * quantity. tAO answers "how much of the sky can this point see", and
       * scaling the sky term by it is right as far as it goes — but a crevice
       * that cannot see the sky is not dark, it is lit by its own walls, and for
       * red sandstone every one of those bounces is warm. Driving it to zero
       * throws away the part of the light that is *most* strongly coloured by
       * the rock.
       *
       * What that cost, measured by System 4: 40.8% of wall_shade had its
       * minimum channel under ten code values and 6.0% was black on every
       * channel. Shaded sandstone is hue 4.5 at saturation 0.47, which needs
       * blue near twenty code values to exist at all, and it had six. The
       * chroma was never wrong — there was nowhere to put it.
       *
       * The replacement is the Jimenez multi-bounce fit: a cubic in visibility
       * whose coefficients are a function of albedo, so occlusion approaches the
       * surface's own colour instead of black. Two properties make it the right
       * shape here rather than merely a brighter one:
       *
       *   - at v = 1 the cubic evaluates to 1 and the clamp pins it there, so an
       *     unoccluded surface is *exactly* unchanged. Open sunlit ground cannot
       *     move, which is the guardrail this had to meet.
       *   - it is clamped below by v, so it can never darken anything. The only
       *     pixels it can reach are the ones being crushed.
       *
       * Note this is deliberately the *same* expression System 2 is putting at
       * rock.js's matching line, so the two surfaces do not diverge in approach.
       * If you change one, change both.
       *
       * Why a mean-based gate could never have caught this: lifting every pixel
       * whose max channel is under 10 cv moves the region mean by 1.3% and the
       * shadow ratio from 0.211 to 0.214, still mid-band. A ratio of means says
       * nothing about the bottom of a distribution. */
      vec3 aoA = material.diffuseColor;
      vec3 aoC1 =  2.0404 * aoA - 0.3324;
      vec3 aoC2 = -4.7951 * aoA + 0.6417;
      vec3 aoC3 =  2.7552 * aoA + 0.6903;
      /* And the second half of the same correction. The note above is right that
         tAO answers "how much of the sky can this point see" - the defect is that it
         is then applied to the escarpment bounce and the ground bounce as well, which
         do not live in the same part of the hemisphere as the sky and are not
         occluded by the same amount by the same relief. s4AoTint returns the
         per-channel correction; the physics, the measurements and the #aok= ablation
         are in src/sky.js beside it. It is vec3(1) at tAO = 1 and it preserves
         luminance, so neither open sunlit ground nor the shadow gate can move. Same
         expression as rock.js's matching line - change both. */
      reflectedLight.indirectDiffuse *=
        clamp(tAO * (aoC1 * tAO * tAO + aoC2 * tAO + aoC3), vec3(tAO), vec3(1.0))
        * s4AoTint(tNrmW, tAO);

      /* ---- there used to be an additive shadow airlight here; System 4 ----
         System 1 added it, and its reasoning was sound at the time: measured on
         the sys1h floor, shadow sat at the right luminance but at rgb(59,24,21),
         with blue the *lowest* channel, and no amount of blue in a hemisphere
         light can change that, because reflected light is the product of
         illuminant and albedo and this dirt has a blue albedo near 0.1. So a
         Rayleigh term was added outside the albedo product, where it could put a
         cool cast on a surface that had no way to reflect one.
         That was right about the old rig and is wrong about this one: the light
         probe carries the sky's
         own spherical-harmonic irradiance, so an upward-facing surface in shadow
         now receives 0.023, 0.030, 0.042 — blue-dominant, from the sky that is
         actually above it — and comes out a cool neutral without help.
         Keeping the term on top of that was measurably harmful. Its channel
         ratio is roughly 1 : 2 : 7, and CONTRACT.md's own diagnostic is that a
         magenta cast shows as blue at or above green: measured on the last
         capture the shadowed wash floor ran B/G 1.03 and the floor underfoot
         1.13, against 0.32 to 0.90 in real golden-hour photographs. It was
         pushing exactly the defect the hue work has been chasing for four
         rounds, on the only surfaces with enough blue albedo to take it.
         Genuine distance airlight has not been lost. scene.fog is an exponential
         airlight over the whole frame and its colour is now the measured mean
         radiance of the sky's own horizon band, which is warm and runs B/G 0.70
         — a real term with the real colour, rather than a shadow-only constant
         with a Rayleigh spectrum that no light in this scene has. */`);
  };
  mat.customProgramCacheKey = () => 'sedona-terrain-v3';
  return mat;
}

/**
 * Point the drifted sand at tonight's wind, read from the audio system.
 *
 * The audio's `windAt` is the authority, but it returns the *instantaneous*
 * heading — a gust bed that wanders 0.26 rad either side of the mean and turns
 * another 0.35 with each gust. A drift is not instantaneous. It is the
 * integral: a pile of sand records where the wind has been blowing for the last
 * hour, not where it is pointing at the instant the shutter opens. So this
 * averages the direction vector over one full period of the slow wander
 * (2*pi/0.021 = 299 s), which cancels that term exactly and averages the gust
 * turns down to nothing. The result is a deposit that does not change between
 * two captures of the same scene, which reading `api.wind.heading` live would.
 *
 * Called once at boot, after the audio exists.
 */
export function syncWind(material, audioApi) {
  const u = material && material.userData && material.userData.uniforms;
  if (!u || !u.uWind || !audioApi || typeof audioApi.windAt !== 'function') return;
  const SPAN = 2 * Math.PI / 0.021, STEP = 1.4;
  let sx = 0, sz = 0, n = 0;
  for (let t = 0; t < SPAN; t += STEP) {
    const w = audioApi.windAt(t);
    if (!w || !Number.isFinite(w.dirX) || !Number.isFinite(w.dirZ)) continue;
    sx += w.dirX; sz += w.dirZ; n++;
  }
  if (!n) return;
  const l = Math.hypot(sx, sz);
  if (l < 1e-3) return;      /* a wind with no mean direction drifts nothing */
  u.uWind.value.set(sx / l, sz / l);
}
