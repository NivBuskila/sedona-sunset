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
/* Tonight's wind, which is not the same quantity as the prevailing wind the
   juniper's lean records. A drift of sand was deposited this evening, so it
   belongs to tonight's wind along with the gust bed and the saltation, and
   audio.js is that authority: `windAt` is analytic, deterministic and public.
   `syncWind` below reads it. This is only the fallback for a material built
   before the audio exists, and it is deliberately the same 0.12 rad down-wash
   heading so a page with a dead audio context still agrees with itself. */
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
       of heaps with swept ground between them, not an even sprinkle. */
    const pile = 0.10 + 1.55 * smoothstep(0.44, 0.80, 0.5 + 0.5 *
      fbm(x * 0.055, z * 0.055, 3, 271));

    return { chan, bar, terr, tal, talPos, sheet, bare, lag, string, pan, pile, f };
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
    h += (1 - ramp) * flat * (coarse * (0.34 * fbm(x * 0.036, z * 0.036, 3, 109)
                                      + 0.18 * fbm(x * 0.105, z * 0.105, 3, 111))
                            + 0.150 * fbm(x * 0.255, z * 0.255, 2, 113)
                            + 0.085 * fbm(x * 0.42, z * 0.42, 2, 114)
                            /* The floor of this term sits above three metres of
                               wavelength. Below that the grid cannot carry it and
                               it comes back as per-vertex speckle, not as grain —
                               grain at that scale is the normal map's job. */
                            + 0.030 * fbm(x * 0.34, z * 0.34, 2, 115))
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

    return h;
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
  const xs = axis([[-52, -30, 0.32], [-30, -17, 0.26], [-17, 17, 0.20],
                   [17, 30, 0.26], [30, 52, 0.32]], -1600, 1600, 1.12);
  const zs = axis([[-256, 14, 0.42]], -1900, 220, 1.14);

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
  return normalize(abs(det) * N - scale * grad);
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
float gLod = log2(max(footG, 2e-4) * 256.0 * 0.9);
float gFl = floor(gLod), gTw = gLod - gFl;
float gSc = exp2(-gFl);
vec2 gUV = wxz + vec2(3.7, 12.9);
vec4 gr = mix(texture2D(uGrit, gUV * gSc), texture2D(uGrit, gUV * gSc * 0.5), gTw);
float gritK = smoothstep(0.007, 0.030, footG);

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
  vec2 ddx = dFdx(d1), ddy = dFdy(d1);
  float dirtH = texture2DGradEXT(uDirtM, d1, ddx, ddy).b;
  for (int k = 1; k <= 8; k++) {
    float t = float(k) * 0.011;                      // metres along the sun azimuth
    float hs = texture2DGradEXT(uDirtM, d1 + uSunStep * t, ddx, ddy).b;
    rake = max(rake, hs - (dirtH + t * uSunRise));
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
float crackH = (ck.b * 0.95 - ck.r * 0.85) * panW * crkF;
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
gA *= 1.0 + (ck.b - 0.30) * 0.16 * panW * curlF;
gA = mix(gA, gA * uSilt * (0.88 + ck.g * 0.30), panW * 0.95);
gA *= 1.0 - ck.r * panW * 0.34 * (0.30 + 0.70 * crkF);
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
    uSunRise: { value: Math.tan(SUN_EL) / 0.025 },
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
        float footShadow(sampler2D sm, vec2 sz, float si, float sb, float sr, vec4 sc) {
          float s = getShadow(sm, sz, si, sb, sr, sc);
          /* Kept for the airlight term below. getShadowMask() only exists in the
             shadow-mask chunk, which meshphysical does not include, so the value
             has to be caught on the way past — and this wrapper is already the
             single point every shadow lookup in the lighting chunk goes through. */
          gShadow = min(gShadow, s);
          return gRake * mix(s, mix(s, 0.55, 0.80), 1.0 - gFoot);
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
      reflectedLight.indirectDiffuse *= tAO;

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
