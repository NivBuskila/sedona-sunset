/* System 2 — the red rock buttes.
 *
 * The whole file exists to answer one criticism: the walls read as smooth
 * conical hillslopes with colour ramps painted on them, which is a sand dune,
 * not sandstone. Sedona is hematite-stained sandstone that is *blocky and
 * horizontally bedded*, capped in cream Coconino, with a grey limestone band
 * running through it, and its silhouette is a staircase — hard beds stand as
 * vertical cliffs, soft beds waste back as benches at the angle of repose, and
 * they alternate. Colour and relief are the same feature or the bands are paint.
 *
 * Three decisions carry the whole thing.
 *
 * **The wall is a curtain, not a height field.** A height field cannot express
 * an overhang, an alcove, or a vertical face — y = f(x, z) is single-valued, so
 * the steepest thing it can draw is a slope, and that is precisely why the
 * terrain walls came out as dunes however they were textured. Here the surface
 * is parameterised the other way round: the lateral offset from the wash
 * centreline is a function of arc length and *elevation*, u = f(s, y). A
 * vertical cliff is du/dy = 0, a bench is du/dy = 1.5, and an undercut is
 * du/dy < 0 — all three are ordinary values of the same function.
 *
 * **Bedding is horizontal, so the column is precomputed once.** Sedona's strata
 * are essentially level across the whole area; you can trace the Fort Apache
 * limestone from one side of a canyon to the other at the same height. That is
 * not a simplification, it is the signature, and it is also what makes this
 * cheap: the retreat integral, the bed contacts and the sample rows in the mesh
 * are all functions of elevation alone and are shared by every column, by both
 * walls, and by the distant buttes.
 *
 * **The mesh is creased.** Rock is defined by fracture, and a fracture is a
 * discontinuity in the normal. Averaged vertex normals destroy exactly that, so
 * the grid is emitted with four vertices per quad and each of them averages only
 * the neighbouring quads whose normal is within a threshold of its own. Bedding
 * contacts, joint arêtes and spall rims come out hard; the bench slopes between
 * them stay smooth.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { fbm, ridged, hash1, rng, clamp, smoothstep, mix } from './noise.js';
import { SUN_DIR } from './sky.js';
import { bake, bakeGeometries } from './bake.js';

/* ── the stratigraphic column ──────────────────────────────────────────────
 *
 * Elevations are in column space: metres above the wash floor datum at that
 * arc length. `rec` is metres of horizontal retreat per metre of rise, which is
 * the cotangent of the face angle — 0.03 is 88 degrees, 1.55 is 33 degrees,
 * which is the angle of repose for the debris a soft bed wastes into. `proud`
 * is a lateral offset held flat across the bed: negative stands the bed out as
 * a ledge, positive recesses it, and it is what turns a colour change into a
 * shadow line. The two together are the cliff-and-bench alternation.
 *
 * The red beds' green and blue have been nudged 1.5 percent up and 5.5 percent
 * down respectively, which sounds like fiddling and is a measurement. Rendered
 * hue on a brightly lit face came out at 17 degrees against 22 to 31 in
 * photographs of Sedona at golden hour, and the blue-to-green ratio at 0.75
 * against a real 0.32 to 0.90 — inside the band but at its top. Both move the
 * same way for the same reason: a Schnebly Hill bed is brick, and brick has less
 * blue in it than peach does. It costs about two hundredths of saturation, which
 * the measured distribution has room for.
 *
 * `col` is a linear diffuse albedo, not a tint on something else. `iron` is how
 * strongly the hematite lenses inside the bed express, which is where the
 * saturated tail of the distribution comes from; `pale` marks the beds that are
 * cream Coconino or grey limestone rather than red.
 */
const CLIFF = 1, BENCH = 2, LEDGE = 3, SLOPE = 4, CAP = 5, SKIRT = 6;
const isVert = (k) => k === CLIFF || k === LEDGE || k === SKIRT;

export const LAYERS = [
  /* Buried: a vertical skirt that guarantees the curtain reaches below whatever
     the terrain is doing at its foot, so there is never a seam. */
  { y0: -15.0, kind: SKIRT, rec: 0.00, proud: 0.00, bedT: 2.4,
    col: [0.242, 0.128, 0.096], iron: 0.30, pale: 0.00, rough: 0.94 },
  /* Hermit-like slope-former, mostly under the talus; where the apron is thin it
     emerges as the red debris ramp the cliff stands on. */
  { y0:  -6.0, kind: SLOPE, rec: 1.55, proud: 0.00, bedT: 2.0,
    col: [0.266, 0.141, 0.106], iron: 0.45, pale: 0.00, rough: 0.95 },
  /* Schnebly Hill, lower cliff. */
  { y0:   3.0, kind: CLIFF, rec: 0.07, proud: -1.15, bedT: 1.75,
    col: [0.386, 0.199, 0.147], iron: 1.00, pale: 0.00, rough: 0.88 },
  { y0:  12.2, kind: BENCH, rec: 1.62, proud:  0.75, bedT: 1.30,
    col: [0.298, 0.162, 0.125], iron: 0.55, pale: 0.00, rough: 0.94 },
  /* Schnebly Hill, middle cliff — the thickest single face in the corridor. */
  { y0:  16.4, kind: CLIFF, rec: 0.05, proud: -1.45, bedT: 2.15,
    col: [0.360, 0.183, 0.135], iron: 1.00, pale: 0.00, rough: 0.87 },
  { y0:  25.8, kind: BENCH, rec: 1.45, proud:  0.62, bedT: 1.15,
    col: [0.310, 0.173, 0.132], iron: 0.55, pale: 0.00, rough: 0.94 },
  /* Schnebly Hill, upper cliff — the vivid one: iron-cemented and freshly spalled. */
  { y0:  29.6, kind: CLIFF, rec: 0.04, proud: -1.65, bedT: 1.55,
    col: [0.436, 0.215, 0.155], iron: 1.35, pale: 0.00, rough: 0.86 },
  /* Fort Apache Member: grey limestone, hard, standing proud as a ledge with an
     undercut beneath it. The one achromatic band in the red, and after the
     Coconino cap the most recognisable thing in a Sedona section. */
  { y0:  38.2, kind: LEDGE, rec: 0.00, proud: -2.55, bedT: 0.85,
    col: [0.302, 0.278, 0.246], iron: 0.10, pale: 0.85, rough: 0.78 },
  { y0:  41.0, kind: BENCH, rec: 0.95, proud:  1.00, bedT: 1.05,
    col: [0.296, 0.160, 0.123], iron: 0.60, pale: 0.00, rough: 0.94 },
  { y0:  46.0, kind: CLIFF, rec: 0.06, proud: -0.70, bedT: 1.60,
    col: [0.378, 0.193, 0.142], iron: 1.10, pale: 0.00, rough: 0.88 },
  { y0:  51.2, kind: BENCH, rec: 1.25, proud:  1.30, bedT: 1.20,
    col: [0.336, 0.195, 0.149], iron: 0.50, pale: 0.10, rough: 0.94 },
  /* Coconino Sandstone: buff-white cross-bedded aeolian sand, the pale cap. The
     contrast against the red below is Sedona's other signature. */
  { y0:  55.0, kind: CLIFF, rec: 0.03, proud: -1.50, bedT: 3.20,
    col: [0.478, 0.402, 0.298], iron: 0.06, pale: 1.00, rough: 0.80 },
  { y0:  67.0, kind: CAP,   rec: 1.80, proud:  1.40, bedT: 2.60,
    col: [0.308, 0.207, 0.149], iron: 0.35, pale: 0.15, rough: 0.96 },
];
/* Cumulative retreat: how far behind the body radius a layer sits because of the
   recessive layers under it. Used by the buttes, where the profile is read against
   the sky and an overhang is unmissable. The walls keep their own local scheme,
   which reads correctly because it is seen face-on rather than in profile. */
const SETBACK = (() => {
  const out = [];
  let acc = 0;
  for (let i = 0; i < LAYERS.length; i++) {
    out.push(acc);
    if (!isVert(LAYERS[i].kind)) acc += LAYERS[i].rec * 0.85;
  }
  return out;
})();
const Y_TOP = 75.0;
const Y_ANCHOR = 3.0;      // foot of the lowest cliff: where the plan is anchored

function layerAt(y) {
  for (let i = LAYERS.length - 1; i >= 0; i--) if (y >= LAYERS[i].y0) return i;
  return 0;
}
const layTop = (i) => (i + 1 < LAYERS.length ? LAYERS[i + 1].y0 : Y_TOP);

/* Erosion levels are not arbitrary: a mesa top is the top of whatever resistant
   bed survived, so summits across an area cluster on a handful of elevations.
   Snapping the crest to these is what produces the flat-topped skyline. */
const CREST_LEVELS = [12.2, 16.4, 25.8, 29.6, 38.2, 41.0, 51.2, 55.0, 67.0, 75.0];

/* Nearest bedding contact, for snapping the rim. A rim is not a smooth curve with
   noise laid over it — it is the top of whatever bed survived, so it steps down
   bed by bed, and every step is a right angle where a joint plane meets a bedding
   plane. Roughening a smooth crest with fBm instead is exactly what produces the
   rounded, lumpy, clay-modelled skyline a critic reads as "soft". The structural
   rows buildColumn already places are those contacts, so this costs a search and
   no triangles at all. */
function snapContact(y) {
  let best = y, bd = 1e9;
  for (let i = 0; i < COL_H_Y.length; i++) {
    const d = Math.abs(COL_H_Y[i] - y);
    if (d < bd) { bd = d; best = COL_H_Y[i]; }
  }
  return best;
}

/* ── sub-bedding ───────────────────────────────────────────────────────────
 *
 * Inside a cliff a real section is not one wall, it is a stack of beds one to
 * three metres thick, each standing a hand's width proud or recessed of its
 * neighbour and each a slightly different tone. The coordinate below is
 * monotonic in y by construction (the sine terms' summed gradient is smaller
 * than the linear one), so the contacts are well defined and unevenly spaced
 * rather than metronomic — and the identical expression exists in the shader, so
 * the tone change and the ledge are the same bed.
 */
function subBed(y, li) {
  const L = LAYERS[li];
  const d = y - L.y0;
  /* Three terms, not two, and the frequencies are chosen to be mutually
     incommensurate. Two sines at 0.23 and 0.61 give a sub-bed thickness that
     repeats every twenty-seven metres, and the autocorrelation of the vertical
     luminance profile on the bend wall duly peaked at 0.51 against 0.11–0.15 on
     photographs — periodic banding, which is one of the loudest procedural tells
     there is. Real bed thicknesses within a formation are near enough lognormal
     and essentially uncorrelated from one bed to the next.
     The constraint on the fix is that this has to stay monotonic in y, or beds
     fold back through each other: the sum of amplitude times frequency must stay
     under 1/bedT, which for the thinnest bed here is 0.42. These three sum to
     0.37. That ceiling is why the answer is three well-spread frequencies rather
     than the six a really flat spectrum would want. */
  return d / L.bedT + 0.44 * Math.sin(d * 0.1873 + li * 2.117)
                    + 0.31 * Math.sin(d * 0.4271 + li * 3.733 + 1.4)
                    + 0.17 * Math.sin(d * 0.9137 + li * 1.259 + 0.6);
}

/* Resistance of a sub-bed, in [0,1], and it has to agree between here and the
   shader to within a hundredth or the geometry steps one bed and the shader
   shades another. That rules out the usual fract(sin(n) * 43758) hash: its
   argument is large, a float32 sine of a large argument has three or four
   digits, and multiplying the error by forty thousand and taking the fractional
   part turns a rounding difference into a completely different answer. Two low-
   frequency sines carry no such amplification and land within a millionth. */
function subResist(id, li) {
  return 0.5 + 0.34 * Math.sin(id * 2.399 + li * 1.113 + 1.7)
             + 0.16 * Math.sin(id * 5.211 + li * 0.770);
}

/* ── the shared vertical sample set ────────────────────────────────────────
 *
 * Because bedding is level, every column of every wall samples the same
 * elevations, and the rows can be placed where the structure is: two rows a
 * hand's width apart at each layer contact and at each resistant sub-bed
 * contact, so the riser is a genuine step in the mesh rather than a ramp smeared
 * over half a metre; coarse rows up the middle of a vertical face, where there
 * is nothing to resolve; fine rows on the benches, which are the curved parts.
 *
 * The amplitudes in subBed are large enough that bed thickness varies by about
 * sixty percent either way and still monotonic — the summed gradient of the two
 * sines stays under the linear term's, which is what keeps the contacts well
 * defined. At the first setting the variation was half that and the first render
 * showed why it was not enough: at two hundred metres a cliff of beds all within
 * twenty percent of two metres reads as corrugated card, not as rock.
 */
function buildColumn() {
  const ys = [], hd = [];
  /* The second argument marks the row as a structural boundary: the seam between
     this row and the one below it is a bedding arête and must never be welded
     smooth, however small the angle across it happens to be at some particular
     column. See creasedMesh for why that matters. */
  const put = (y, hard) => {
    if (!ys.length || y > ys[ys.length - 1] + 1e-4) { ys.push(y); hd.push(hard ? 1 : 0); }
    else if (hard) hd[hd.length - 1] = 1;
  };

  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li], y1 = layTop(li);
    put(L.y0 - 0.075, 1);
    put(L.y0 + 0.075, 1);
    const step = isVert(L.kind) ? 0.95 : L.kind === BENCH ? 0.58 : 1.70;
    /* Sub-bed contacts, but only the resistant ones. A riser is worth two extra
       rows when it is going to be twenty centimetres of shadow line; the soft
       contacts are carried by the shader's bump instead, which costs nothing. */
    const contacts = [];
    if (L.kind === CLIFF || L.kind === LEDGE || L.kind === BENCH) {
      let prev = Math.floor(subBed(L.y0, li));
      for (let y = L.y0; y < y1; y += 0.05) {
        const id = Math.floor(subBed(y, li));
        if (id !== prev) {
          if (subResist(id, li) > 0.62) contacts.push(y);
          prev = id;
        }
      }
    }
    /* Half the riser height. This started at 6.5 cm on the reasoning that a
       bedding contact should be as close to a knife edge as the mesh can make it,
       and that was exactly backwards. The riser is a real facet, and under a sun
       eight degrees above the horizon a facet tilted thirty degrees off vertical
       receives four to six times the irradiance a vertical cliff face does — so
       the brightest thing on the whole wall was a strip a fifth of a metre tall,
       which at any distance is one pixel wide and aliases into a dotted rule. The
       feature is right and its scale was wrong: at 44 cm it is fourteen pixels at
       thirty metres and three at a hundred and fifty, which is a lit ledge instead
       of a dashed line, and it is also closer to what the risers between beds on a
       Schnebly Hill cliff actually measure. */
    /* Taller again, and the lateral step below is smaller, for one reason: the
       riser was still throwing a row of lit triangular teeth along every shaded
       bench in the middle distance. A quad whose two triangles disagree strongly
       in normal shades as two triangles, and a strip 44 cm tall carrying a 40 cm
       lateral step across a 62 cm column pitch is exactly that — a skewed sliver
       tilted forty-two degrees off vertical, which under an eight-degree sun
       receives several times the irradiance of the face it interrupts. Thirty
       centimetres of half-height against a 28 cm step is twenty-five degrees, and
       the ratio falls with the cosine. The step is still a step; it is no longer
       the brightest thing in the frame. */
    const RISE = 0.30;
    let ci = 0;
    for (let y = L.y0 + 0.075; y < y1 - 0.075; y += step) {
      while (ci < contacts.length && contacts[ci] < y) {
        put(contacts[ci] - RISE, 1); put(contacts[ci] + RISE, 1); ci++;
      }
      put(y);
    }
    while (ci < contacts.length) {
      put(contacts[ci] - RISE, 1); put(contacts[ci] + RISE, 1); ci++;
    }
  }
  put(Y_TOP);

  const n = ys.length;
  const Y = Float32Array.from(ys);
  const H = Uint8Array.from(hd);
  const R = new Float32Array(n);      // cumulative retreat
  const P = new Float32Array(n);      // the bed's own proud offset
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += LAYERS[layerAt((Y[i] + Y[i - 1]) * 0.5)].rec * (Y[i] - Y[i - 1]);
    R[i] = acc;
    P[i] = LAYERS[layerAt(Y[i] + 1e-5)].proud;
  }
  /* Measured from the foot of the lowest cliff, which is where the wall's plan
     position is anchored. */
  let r0 = 0;
  for (let i = 0; i < n; i++) if (Y[i] <= Y_ANCHOR) r0 = R[i];
  for (let i = 0; i < n; i++) R[i] -= r0;
  return { Y, R, P, H, n };
}

const COL = buildColumn();

/* Just the structural rows, which are the bedding contacts and the tops of the
   resistant sub-beds — the elevations a rim is allowed to stand at. Only the
   upper of each contact pair, so the list is one entry per bed top rather than
   two twenty-two centimetres apart. */
const COL_H_Y = (() => {
  const out = [];
  for (let i = 0; i < COL.n; i++) {
    if (!COL.H[i]) continue;
    if (out.length && COL.Y[i] - out[out.length - 1] < 0.6) out[out.length - 1] = COL.Y[i];
    else out.push(COL.Y[i]);
  }
  return out;
})();

/** Linear interpolation of a column array at an arbitrary elevation. */
function colAt(arr, y) {
  const Y = COL.Y;
  if (y <= Y[0]) return arr[0];
  if (y >= Y[COL.n - 1]) return arr[COL.n - 1];
  let lo = 0, hi = COL.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Y[m] <= y) lo = m; else hi = m; }
  const t = (y - Y[lo]) / Math.max(1e-6, Y[hi] - Y[lo]);
  return mix(arr[lo], arr[hi], t);
}

/* ── plan-view jointing ────────────────────────────────────────────────────
 *
 * Sandstone splits along near-vertical joint sets, and the wall between them
 * weathers back as flat panels meeting at sharp arêtes. That is a *polyline in
 * plan*, not a wobble: the offset varies linearly within each joint block and
 * changes gradient discontinuously at the block boundary. The discontinuity is
 * in the derivative rather than in the value, so the sampling grid carries it
 * exactly and the crease pass turns it into a hard vertical edge — which is what
 * a buttress is.
 *
 * Squared, so most blocks sit near the reference plane and a few are cut deeply
 * back. An evenly distributed offset gives a wall that undulates; this gives
 * fins with clefts between them.
 */
/* The panel is not a plane, though, and that was the last thing in the set that
   read as a boolean operation rather than as a fracture. A joint face is a
   *fracture surface*: it is rough at every scale, because the crack propagated
   through a rock whose grain and cement varied along its path, and it has since
   retreated unevenly. Two octaves of that, kept gentle enough — sixteen degrees
   and twenty-four — that they stay well inside the weld threshold and so add
   surface to the panel without adding a single new crease to it. The arête at the
   block boundary is untouched; that discontinuity is the point of this function. */
function jointOffset(a, seed, amp) {
  const i = Math.floor(a), t = a - i;
  const v0 = hash1(i, seed), v1 = hash1(i + 1, seed);
  const rough = (fbm(a * 3.1, seed * 0.013, 3, seed + 7) - 0.5) * 0.22
              + (fbm(a * 11.0, seed * 0.021, 2, seed + 13) - 0.5) * 0.085;
  return (mix(v0 * v0, v1 * v1, t) + rough) * amp;
}

/* ── the wall curtain ──────────────────────────────────────────────────────── */

const S0 = -34, S1 = 356;
const DS = 0.62;
const NBACK = 7;

/* The corridor cannot outrun the path it is hung on, and it was doing exactly
   that. `WashPath.length` is 332.3 m and `posAt` clamps past its end, so every
   one of the thirty-nine columns from s = 332 to S1 = 356 was placed at the same
   point — x 0.0, z -319.9, on the corridor axis — and the wall's lateral offsets
   fanned that stack of coincident columns into a solid slab standing across the
   channel at the head of the walk, with the apron leaning on it reaching to
   |x| 0.0 at fourteen to sixteen metres of height.
   That is the ledge in `far_320`: `tools/_pixowner.mjs` attributes it to `apronL`
   and `apronR`, and `tools/_headprofile.mjs` puts its crown five metres above the
   11.3 m the amphitheatre behind it stands at on the axis. It also explains why
   moving twenty-four metres of relief behind it changed no pixel by more than
   13/255 — the occluder is rock geometry and does not depend on the height field
   at all.
   Six metres of margin so the end fade below finishes on real path rather than
   on the clamp. */
const sEndOf = (path) => Math.min(S1, path.length - 6.0);

/* And it cannot outrun it at the near end either, which is the same defect at the
   other end of the same array and went unnoticed because nothing frames the start
   of the walk head-on. The path's domain begins at `-sZero`, 11.99 m behind the
   origin, and `posAt` clamps below that exactly as it clamps above `length`, so
   the thirty-six columns from S0 = -34 to s = -12 were all placed at the one
   point x 0.0, z 20.0 and fanned out by their lateral offsets into the same kind
   of stack that put the ledge in `far_320`.
   Six metres of margin, matching `sEndOf`, which also keeps `headingAt`'s
   backward sample three metres inside the domain. */
const sStartOf = (path) => Math.max(S0, -path.sZero + 6.0);

/** Wash floor datum, used to find the foot of the wall. This has to track the
 *  ground, because the toe search asks where the apron has climbed three metres
 *  above the floor and the floor is what the terrain says it is. */
function datumAt(s) {
  return 0.0125 * Math.max(0, s) + 2.4 * fbm(s * 0.0052, 11.5, 2, 331);
}

/** Datum for the *bedding*, which is a different thing and was wrongly the same
 *  one. Sedona's strata are dead flat over hundreds of metres — you can trace
 *  the Fort Apache limestone from one side of a canyon to the other at the same
 *  height — and that flatness is a signature, not a simplification. Hanging the
 *  column off the floor datum instead put the whole section on the floor's
 *  gradient plus a ±2.4 m wobble with a two-hundred-metre period, which is up to
 *  four and a half degrees of dip, read back off a render as bedding that waves
 *  and tilts down to the right.
 *  A canyon floor does climb, and the correct consequence of that against flat
 *  beds is that the section exposed gets *lower in the column* upstream, which is
 *  how a canyon shallows out towards its head. So a third of the floor's trend is
 *  kept, which is what stops the lowest cliff being buried outright, and the
 *  wobble is gone: 0.4 cm of rise per metre is a quarter of a degree, invisible
 *  across any run of wall the camera can see at once. */
function bedDatumAt(s) {
  return 0.0042 * Math.max(0, s);
}

/** Where the talus apron has climbed three metres above the datum: the foot of
 *  the lowest cliff. Letting the apron decide keeps the rock and the ground from
 *  being placed independently and meeting in a seam. */
function toeAt(terrain, px, pz, nx, nz, dat) {
  const want = dat + Y_ANCHOR;
  for (let av = 7; av < 46; av += 1.0) {
    if (terrain.heightAt(px + nx * av, pz + nz * av) >= want) {
      for (let b = av - 1.0; b < av; b += 0.25) {
        if (terrain.heightAt(px + nx * b, pz + nz * b) >= want) return b;
      }
      return av;
    }
  }
  return 44;
}

function wallGrid(path, terrain, side) {
  const sEnd = sEndOf(path), sStart = sStartOf(path);
  const nu = Math.round((sEnd - sStart) / DS) + 1;
  const nv = COL.n + NBACK;

  const pos = new Float32Array(nu * nv * 3);
  const att = new Float32Array(nu * nv * 4);   // column y, along-wall s, freshness, cavity
  const uu = new Float32Array(nu * nv);        // lateral offset, kept for the cavity pass

  const cS = new Float32Array(nu), cDat = new Float32Array(nu), cBed = new Float32Array(nu);
  const cToe = new Float32Array(nu), cCrest = new Float32Array(nu);
  const cRet = new Float32Array(nu), cPrd = new Float32Array(nu);
  const cX = new Float32Array(nu), cZ = new Float32Array(nu);
  const cNx = new Float32Array(nu), cNz = new Float32Array(nu);

  const p = new THREE.Vector3();

  for (let i = 0; i < nu; i++) {
    const s = sStart + i * DS;
    cS[i] = s;
    path.posAt(s, p);
    const th = path.headingAt(s);
    cNx[i] = Math.cos(th) * side;
    cNz[i] = Math.sin(th) * side;
    cX[i] = p.x; cZ[i] = p.z;
    cDat[i] = datumAt(s);
    cBed[i] = bedDatumAt(s);
    cToe[i] = toeAt(terrain, p.x, p.z, cNx[i], cNz[i], cDat[i]);
  }

  /* Smooth the toe. It is read off a noisy height field one column at a time, and
     an unsmoothed read puts half-metre kinks in the base of a cliff that is
     otherwise straight for thirty metres — which reads as damage rather than as
     structure. Plan-view interest belongs to the joint sets, which are authored,
     not to sampling noise. */
  const toeS = new Float32Array(nu);
  for (let i = 0; i < nu; i++) {
    let a = 0, w = 0;
    for (let k = -7; k <= 7; k++) {
      const j = clamp(i + k, 0, nu - 1), wt = 1 - Math.abs(k) / 8;
      a += cToe[j] * wt; w += wt;
    }
    toeS[i] = a / w;
  }

  for (let i = 0; i < nu; i++) {
    const s = cS[i];
    /* Embayments. The wall is eaten back into bays and stands forward in
       promontories over tens of metres, and a couple of places on each side open
       into a side canyon — which is what makes new formations reveal themselves
       as the path bends. */
    const bay = 9.0 * Math.pow(0.5 + 0.5 * fbm(s * 0.0115, side > 0 ? 61 : 83, 3, 341), 2.0);
    const canyon = smoothstep(0.72, 0.94,
      0.5 + 0.5 * fbm(s * 0.0068, side > 0 ? 17 : 29, 2, 347));
    cToe[i] = toeS[i] + bay + canyon * 22.0;

    cRet[i] = 0.72 + 0.62 * (0.5 + 0.5 * fbm(s * 0.0088, side > 0 ? 5 : 13, 3, 353));
    cPrd[i] = 0.70 + 0.70 * (0.5 + 0.5 * fbm(s * 0.021, side > 0 ? 37 : 43, 2, 359));

    /* Crest, snapped to a resistant bed top. The wash also has to keep breathing
       at its far end, where the sun sits, so the corridor steps down past s = 250
       and the gap up the wash is never closed. */
    const open = smoothstep(250, 356, s) * 0.62 + smoothstep(-8, -34, s) * 0.45;
    /* Centred high enough that the Coconino cap is genuinely exposed over a good
       share of the corridor. At the first setting the crest averaged forty-four
       metres and snapped below the cap almost everywhere, so the scene had no
       cream caprock in it at all — which is throwing away half of what makes a
       Sedona skyline recognisable. */
    let raw = 28 + 60 * (0.5 + 0.5 * fbm(s * 0.0072, side > 0 ? 71 : 97, 3, 367));
    raw -= 8 * canyon;
    /* ---- which bed the rim stands on has to change along the wall ----
       The snap below picks the nearest of ten bed tops, and that is right: a rim
       is the top of whatever bed survived and it steps between them. But `raw`
       above turns over once in a hundred and thirty-nine metres, so the nearest
       level is the *same* level for fifty to a hundred metres at a stretch, and
       the rim is therefore exactly constant over that whole run.
       Across the wall that is invisible, which is why it has survived this long.
       Along it, it is the finding the final critique ranked second overall and
       called the most conspicuous single object in the set: from the shade_far
       station, looking back down-canyon, the left "mesa" with the "perfectly
       straight, un-notched, un-eroded" rimline is not a mesa at all. It is this
       wall seen end-on — tools/_pixowner.mjs attributes those pixels to wallL and
       hiding it puts sky at the rim — and the straight line is one CREST_LEVELS
       entry held across the whole run the frame contains. tools/_aniso.mjs puts
       that crop at 0.67 vertical-to-horizontal line energy, the most
       horizontal-dominated surface in the set against 0.79 for the walls, which
       is the "wood veneer" reading measured.
       It also explains the "cream-white band of constant thickness running
       perfectly parallel to the rim" in the same frame without needing a second
       cause: bedding is level, so a layer band is level, and a rim that is also
       level sits a constant distance above it. Step the rim between beds and the
       parallelism goes with it.
       Strictly subtractive, and that is not a stylistic choice — it is the rule
       this file already applies to the butte rims twelve hundred lines down, for
       the reason given there: the corridor skyline is what System 4 clears the
       sun disc through, and a perturbation that can only *lower* a crest cannot
       cost them anything, whereas a symmetric one would need re-verifying every
       time an amplitude moved. On delivery morning that is the whole argument.
       Six and a half metres, against level spacings of three metres within a pair
       and ten between pairs, so the snap lands on a different bed several times
       over the length of the corridor.
       The wavelength is the part that had to be measured rather than chosen, and
       the first attempt at it — twenty-six metres — was wrong in an instructive
       way. It stepped the crest exactly as intended, eight steps of 3 to 11 m over
       two hundred metres by tools/_crestprof.mjs, and it changed the frame
       essentially not at all. Seen square-on, one screen column is one station and
       the crest profile *is* the skyline; seen end-on, as shade_far sees this wall,
       one column spans tens of metres and the skyline is the *upper envelope* of
       the crest over every station in it. An envelope is set by the un-notched
       stations, so a notch narrower than a bearing bin is invisible at any depth —
       tools/_skyenv.mjs showed the envelope pinned at crest 55.6 m across the whole
       visible run with the 51.6 m notches showing in isolated bins and the
       silhouette still a smooth line, its apparent rise coming from range closing
       from 97 to 73 m rather than from any change in the rock.
       Widening it does not rescue the end-on view either, and it is worth writing
       down why so nobody spends a third round on it. At eighty metres the half
       cycle is forty metres of wall, and shade_far only sees about seventy metres
       of wall in total, so the whole framing falls inside one half cycle and the
       envelope goes back to being one constant level. Short notches make a comb
       the eye reads straight past; long ones are wider than the frame. The end-on
       skyline is set by the *highest* station in each bearing bin, so the only
       thing that moves it is amplitude comparable to the crest's own variation —
       genuinely taking a long section of wall down — which is a landform change
       across every framing and not a delivery-morning one. See CONTRACT.md; the
       cheap fix there is a juniper on the rim, which costs this file nothing.
       So the wavelength is chosen for the case it *can* fix, which is every
       square-on rim: forty metres, giving ten level changes over the first two
       hundred metres of wall with steps of 3 to 11 m. Those are the "dead-straight
       horizontal top line" complaints in bend, far_170 and far_220. */
    raw -= 6.5 * (0.5 + 0.5 * fbm(s * 0.025, side > 0 ? 131 : 137, 2, 383));
    raw *= 1 - open;
    let best = CREST_LEVELS[0], bd = 1e9;
    for (const lv of CREST_LEVELS) { const d = Math.abs(lv - raw); if (d < bd) { bd = d; best = lv; } }
    /* Pulled most of the way onto the bed top but not all of it, and then
       roughened — but roughened only within the band the sampling can carry. The
       second term used to run at 0.32 cycles per metre with two octaves, i.e.
       down to 0.78 metre wavelength on a 0.62 metre grid, and it serrated the
       skyline at exactly the grid pitch. A skyline that is exactly level is a
       table edge; one level to within a metre and notched by the joints is a
       mesa; one notched every other column is a saw blade. */
    /* The roughening stays — a skyline level to the millimetre is a table edge —
       but it is snapped onto a bedding contact afterwards, so the rim descends in
       right-angled steps from one bed top to the next instead of undulating.
       Not all the way onto the contact, and considerably less than the first
       attempt at this. At 0.85 the rims came out cubic: every tread dead level,
       every break exactly one bed, the whole wall milled into rectangular
       terraces. The fault in that reasoning is that a bed top is where the rim
       *starts*, and then it retreats — the tread is a rubble ramp sloping back
       from a broken lip, not a machined shelf. Half strength keeps the steps
       square where they matter, at the lip, and lets the rest of the tread carry
       the roughening that stops it reading as geometry. */
    let crest = mix(raw, best, 0.82)
              + 1.3 * fbm(s * 0.055, side > 0 ? 3 : 8, 2, 373)
              + 0.7 * fbm(s * 0.10, 21, 1, 379);
    crest = mix(crest, snapContact(crest), 0.50);
    /* The ends of the curtain. Without this the wall runs to the last column and
       stops, leaving a forty-metre vertical cut hanging in mid air at the head of
       the corridor — right in the middle of the view every critic praised. It is
       walked down into the apron instead, which also widens the gap the sun sits
       in and hands the far distance over to the buttes. */
    /* Keyed to where the curtain actually ends rather than to the authored S1,
       which is past the end of the path — see `sEndOf`. Same 46 m walk-down; it
       now lands on the last real column instead of on the clamp. */
    /* The near-end walk-down is now 20 m rather than 37, because the curtain
       starts 28 m later than it used to and a 37 m run measured from the new
       start would hold the wall below full height until s = 34 — which is
       corridor that `wash_low` at d 8 stands in. Twenty metres from `sStart`
       finishes by s = 14 and keeps the descent inside the path's domain, at 69
       degrees rather than 55. Steeper is also more honest: the end of a curtain
       wall is a spur nose, not a ramp. */
    const endFade = (1 - smoothstep(sEnd - 46, sEnd - 3, s))
                  * (1 - smoothstep(sStart + 20, sStart + 1.5, s));
    cCrest[i] = Math.max(1.5, crest * endFade);
  }

  /* Where the colluvial apron meets the rock. The wedge cannot guess this: the
     wall's face at any height is `toe` plus a recess, a proud offset and four
     joint offsets, and a head placed at `toe` alone would sit outside the rock
     wherever a fin stands forward and hang in the air. So the apron's head is
     read off the wall's own `u` at the row the apron reaches, recorded as the
     column is built and handed out with the grid.
     Height is set by the chutes, because an apron is a row of coalescing cones
     fed by the gullies above it and not a fillet of even thickness — where a
     chute delivers it stands ten metres up the wall, and between them it thins
     to a metre or two of scree. */
  const apH = new Float32Array(nu), apU = new Float32Array(nu);
  const jHead = new Int32Array(nu);
  for (let i = 0; i < nu; i++) {
    const s = cS[i];
    /* Zero between the chutes rather than a thin skirt everywhere. A continuous
       wedge along four hundred metres of wall is a fillet, and a fillet reads as
       modelling; an apron is a row of cones under the gullies that feed them,
       with bare rock between where nothing is delivered. It also bounds the
       damage the wedge does to System 1's scatter, which roots its plants at
       terrain height and so loses their bases anywhere the apron stands over
       them — confining that to the cones keeps it to a fraction of the wall
       instead of all of it. */
    /* Measured rather than guessed, because the first two settings bracketed it
       from both sides: a continuous 2.2 m floor put a fillet along the whole
       wall, and a 0.46 threshold cut cover to 28% and five cones in 390 m, which
       left `wall_lit` with no apron in frame at all. This is 74 to 81% cover,
       five to seven cones, mean height 3.2 m and the tallest near nine — an
       apron that is present in most framings and genuinely absent between the
       gullies. */
    const chute = smoothstep(0.36, 0.80,
      0.5 + 0.5 * fbm(s * 0.021, side > 0 ? 23 : 47, 3, 419));
    /* Capped at a share of the wall it leans on, which matters at the two ends of
       the corridor and nowhere else: the curtain is walked down to a metre and a
       half there so the sun's gap stays open, and an apron sized independently
       would have stood ten metres above a wall that is no longer there — putting
       System 2's debris on System 4's skyline in the one view they are still
       fighting for. A talus cone cannot be taller than its own cliff anyway. */
    apH[i] = Math.min(10.0 * chute, 0.45 * cCrest[i]);
    const want = Y_ANCHOR + apH[i];
    let bj = 0, bd = 1e9;
    for (let j = 0; j < COL.n; j++) {
      const d = Math.abs(COL.Y[j] - want);
      if (d < bd) { bd = d; bj = j; }
    }
    jHead[i] = bj;
  }

  for (let i = 0; i < nu; i++) {
    const s = cS[i];
    const dat = cBed[i], toe = cToe[i], ret = cRet[i], prd = cPrd[i], crest = cCrest[i];
    /* Joint coordinates are world azimuths, not wash-relative, so the traces cut
       the wall at a changing obliquity as the corridor bends — which is what tells
       the eye the fractures belong to the rock and not to the canyon. */
    const jx = cX[i] + cNx[i] * toe, jz = cZ[i] + cNz[i] * toe;
    const a1 = (jx * 0.9397 + jz * 0.3420) / 8.5;
    const a2 = (jx * -0.2588 + jz * 0.9659) / 19.0;
    const a3 = (jx * 0.6428 + jz * -0.7660) / 3.7;
    const Rc = colAt(COL.R, crest), Pc = colAt(COL.P, crest);

    for (let j = 0; j < COL.n; j++) {
      const over = COL.Y[j] > crest;
      const yc = over ? crest : COL.Y[j];
      const R = over ? Rc : COL.R[j];
      const P = over ? Pc : COL.P[j];
      const li = layerAt(yc + 1e-5);
      const vert = isVert(LAYERS[li].kind) ? 1 : 0;

      let u = toe + R * ret + P * prd;

      /* Two coarse joint sets split the wall into buttresses, and they are shared
         by every bed. That sharing is the point and the first attempt got it
         wrong: giving each layer its own seed put up to seven metres of
         independent offset between one bed and the next, which is larger than the
         ledges themselves and left the section reading as a stack of randomly
         slid slabs rather than as a jointed wall. A joint is a fracture through
         the *rock*, so a fin runs from the talus to the rim; what varies bed to
         bed is only how far each has weathered back into it. */
      /* Except that the pale beds take much less of it, and the Coconino takes
         least of all. It is the strongest cliff-former in the section — a massive
         aeolian sandstone that holds a clean vertical face for two hundred feet —
         and it was coming out as the most broken unit in the wall rather than the
         least, which inverts the one relationship that makes a Sedona skyline
         legible. Well-cemented massive rock is jointed at *wide* spacing and
         retreats by slabbing off whole plates, so its face stays flat between
         joints; it is the thin friable beds that come apart into buttresses. */
      const mass = 1 - LAYERS[li].pale * 0.66;
      u += jointOffset(a1, 101, 3.1) * (0.45 + 0.55 * vert) * mass;
      u += jointOffset(a2, 107, 4.6) * 0.7 * mass;
      u += jointOffset(a1 * 1.7 + li * 0.37, 200 + li, 0.85) * mass;
      u += jointOffset(a3, 300 + li * 7, 1.15) * vert * mass;

      /* Resistant sub-beds stand proud, *in the mesh*. buildColumn has been
         placing a pair of rows nineteen centimetres apart at every strong contact
         from the start and nothing was using them: the step existed in the shader
         as a bump instead, and a hard step differentiated by dFdx over a two-by-
         two pixel quad is a one-pixel black line with a one-pixel white line
         beside it — the dashed rules that crossed every bench and every talus
         block in the first render. A bump map cannot hold an edge, only geometry
         can, so the step goes here and the shader keeps only what is genuinely
         smooth. Fifteen centimetres is a hand's width, which is what the risers
         between beds on a Schnebly Hill cliff measure. */
      const sbi = Math.floor(subBed(yc, li));
      u -= (subResist(sbi, li) - 0.5) * 0.28 * (0.45 + 0.55 * vert);

      /* Alcoves and spall scars. An alcove undercuts a soft bed beneath a hard
         one, so it goes on benches and its rim is the cliff above; a spall scar is
         a shallow flat-bottomed dish where a slab let go, so it goes on cliffs.
         Both are cut with a hard edge on purpose — a soft-edged dent is a dune. */
      let fresh = 0;
      if (vert) {
        /* Sharpening this to a four-hundredth ramp last round was a mistake with
           two visible consequences, and they are the same consequence. A 1.5 m
           lateral offset switched on over four hundredths of its driver is a
           near-vertical wall in the *offset field*, so adjacent columns of the
           grid could differ by the whole 1.5 m — which triangulates into the row
           of bright triangular notches along every shaded bench, and which also
           gives the scar the perfectly straight polygonal boundary that reads as a
           boolean cut rather than a fracture.
           A fracture surface is rough at every scale, and its trace on a face is
           rough too. So the ramp goes back out to nine hundredths, its threshold
           is perturbed by noise an order of magnitude finer than the scar so the
           boundary is ragged rather than straight, and the release surface itself
           carries relief instead of being a plane. Depth comes down to 1.1 m,
           which caps how much any single column can differ from its neighbour. */
        const scarD = ridged(s * 0.055 + li * 4.1, yc * 0.075, 2, 383 + li * 31)
                    + (fbm(s * 0.42, yc * 0.55 + li * 7.3, 2, 397) - 0.5) * 0.075;
        const scar = smoothstep(0.690, 0.780, scarD);
        u += scar * 1.1
           + scar * (1 - scar * 0.5) * 0.34 * (fbm(s * 0.19, yc * 0.26, 2, 401) - 0.5);
        fresh = scar;
      } else {
        u += 2.2 * smoothstep(0.60, 0.86, ridged(s * 0.028, yc * 0.055, 2, 389));
      }

      /* Coarse relief, and *only* coarse. The first version of this line put an
         fbm at 0.21 and another at 0.62 cycles per metre into the offset, with
         three and two octaves on top, so its finest content sat at roughly 1.2
         and 0.8 metre wavelengths — against a 0.62 metre sampling step. That is
         at and past Nyquist, and the render showed exactly what undersampled
         noise looks like on a lit surface: the whole wall covered in dead-
         straight vertical bars about a metre and a half apart, running its full
         height, alternating lit and shadowed because alternate columns of quads
         had been tilted in opposite directions. It read as a barcode.
         Everything here is now held below a quarter of the sampling frequency,
         which is the only band a grid this size can carry. Sub-metre relief
         belongs to the normal map, where it is filtered by mip selection and
         cannot alias into geometry. */
      u += 0.55 * fbm(s * 0.052, yc * 0.070, 2, 397 + li)
         + 0.24 * fbm(s * 0.105, yc * 0.150, 1, 401);

      if (j === jHead[i]) apU[i] = u;

      const k = j * nu + i;
      pos[k * 3] = cX[i] + cNx[i] * u;
      pos[k * 3 + 1] = dat + yc;
      pos[k * 3 + 2] = cZ[i] + cNz[i] * u;
      att[k * 4] = yc;
      att[k * 4 + 1] = s;
      att[k * 4 + 2] = fresh;
      uu[k] = u;
    }

    /* Back slope. The curtain only ever faces the wash; behind the rim it turns
       over and runs down into the terrain so the summit closes and no sky shows
       through. The last row is driven below the ground it lands on, which is what
       guarantees the seal whatever the terrain is doing there. */
    const kTop = (COL.n - 1) * nu + i;
    const uTop = uu[kTop], yTop = pos[kTop * 3 + 1];
    /* Short, therefore steep. At twenty-six to forty-two metres the far side of
       each rim was a shallow ramp, and a shallow ramp descending away from a low
       camera is *visible* — a large khaki mass above every crest, lit by nothing
       but the sky because it faces away from the sun. The far side of a mesa is
       another cliff, not a ramp, so it goes down fast and hides itself. */
    const backRun = 12 + 9 * (0.5 + 0.5 * fbm(s * 0.014, side > 0 ? 9 : 15, 2, 409));
    const ySeal = Math.min(yTop - 4,
      terrain.heightAt(cX[i] + cNx[i] * (uTop + backRun), cZ[i] + cNz[i] * (uTop + backRun)) - 3.0);
    for (let b = 0; b < NBACK; b++) {
      const t = (b + 1) / NBACK;
      const u = uTop + backRun * Math.pow(t, 1.35);
      const k = (COL.n + b) * nu + i;
      pos[k * 3] = cX[i] + cNx[i] * u;
      pos[k * 3 + 1] = mix(yTop, ySeal, t * t * (3 - 2 * t))
                     + 1.6 * (1 - t) * fbm(s * 0.11, b * 1.7, 2, 411);
      pos[k * 3 + 2] = cZ[i] + cNz[i] * u;
      /* The stratigraphic coordinate is *held* at the rim rather than following
         the slope down. Letting it follow put the back of the rim through the
         pale Coconino and the grey Fort Apache on the way down, so every summit
         seen over its own crest had cream and grey bands running diagonally
         across it — bedding is horizontal, and a band that climbs a slope is the
         one thing that instantly reads as projected paint. Behind the rim there
         is no section anyway: it is caprock and the debris off it. */
      att[k * 4] = yTop - cBed[i];
      att[k * 4 + 1] = s;
      /* Flagged, by a value the freshness channel can never legitimately take, so
         the shader can tell a back slope from a cliff face. Holding the
         stratigraphic coordinate at the rim stopped the pale bands running
         diagonally down it, but it left the slope wearing whatever bed happened to
         cap that summit — and where that was the Coconino, the back of the rim came
         out as a large flat sheet of cream, the brightest thing in the frame after
         the sun, reading as a concrete roof. Behind a rim there is no rock face at
         all: it is soil and shattered debris off the caprock. */
      att[k * 4 + 2] = -1;
      uu[k] = u;
    }
  }

  cavityPass(att, uu, nu, nv);
  const hard = new Uint8Array(nv);
  hard.set(COL.H);
  return { pos, att, nu, nv, hard,
    foot: { x: cX, z: cZ, nx: cNx, nz: cNz, s: cS, h: apH, u: apU } };
}

/* How far a point sits back from its own neighbourhood. A cleft between two fins,
   the inside of an alcove and the undercut below a ledge all come out of one
   comparison, and it is the term that stops the wall reading as evenly lit
   however good its silhouette is. */
function cavityPass(att, uu, nu, nv) {
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      let a = 0, w = 0;
      for (let dj = -3; dj <= 3; dj++) {
        const jj = clamp(j + dj, 0, nv - 1);
        for (let di = -6; di <= 6; di += 2) {
          a += uu[jj * nu + clamp(i + di, 0, nu - 1)]; w++;
        }
      }
      const k = j * nu + i;
      att[k * 4 + 3] = clamp((uu[k] - a / w) * 0.55 + 0.5, 0, 1);
    }
  }
}

/* ── creased grid mesh ─────────────────────────────────────────────────────
 *
 * Four vertices per quad, each carrying the average of the neighbouring quad
 * normals that agree with its own to within the threshold. Where the surface is
 * smooth every quad agrees and the result is identical to ordinary averaged
 * normals; at a bedding contact or a joint arête the disagreeing side is dropped
 * and the edge stays hard. This is the difference between a cliff and a dune and
 * it cannot be bought with a normal map, because a normal map cannot change a
 * silhouette or the shading discontinuity across one.
 *
 * An angle threshold alone is not enough, and this is where the dotted rules
 * along every bench lip came from. The riser at a bedding contact is tilted by
 * whatever the difference in the two beds' proud offsets happens to be, and that
 * difference varies column to column with the joint offsets and the coarse
 * relief — so along one contact the riser crosses the threshold and back
 * repeatedly. Where it is under, the seam welds and the top of the riser is
 * shaded as a continuation of the lit face above it; where it is over, the seam
 * creases and the same pixel is shaded as the underside of an overhang. Adjacent
 * columns therefore alternate between the brightest and the darkest tone on the
 * wall, one pixel tall, all the way along the contact: a dotted rule, and one
 * that no amount of widening the riser can remove because the alternation is in
 * the *decision*, not in the facet.
 *
 * So the rows that buildColumn deliberately placed as structural boundaries carry
 * a flag, and a seam across one of those rows never welds regardless of angle.
 * The contact then reads as one continuous arête, which is what it is.
 */
function creasedMesh(grid, cosT, flip) {
  const { pos, att, nu, nv, hard } = grid;
  const qu = nu - 1, qv = nv - 1;
  const nq = qu * qv;
  const sgn = flip ? -1 : 1;

  const qn = new Float32Array(nq * 3);
  const live = new Uint8Array(nq);
  const ax = new THREE.Vector3(), bx = new THREE.Vector3();
  const cx = new THREE.Vector3(), dx = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const get = (i, j, out) => {
    const k = (j * nu + i) * 3;
    return out.set(pos[k], pos[k + 1], pos[k + 2]);
  };

  let nLive = 0;
  for (let j = 0; j < qv; j++) {
    for (let i = 0; i < qu; i++) {
      get(i, j, ax); get(i + 1, j, bx); get(i, j + 1, cx); get(i + 1, j + 1, dx);
      e1.subVectors(dx, ax); e2.subVectors(cx, bx);
      nrm.crossVectors(e2, e1).multiplyScalar(sgn);
      const l = nrm.length();
      const o = (j * qu + i) * 3;
      /* Everything folded onto the crest collapses to a point, and those quads are
         dropped outright rather than emitted as zero-area triangles — which is
         most of what pays for the row density here. */
      if (l > 1e-7 && ax.distanceToSquared(dx) > 1e-6 && bx.distanceToSquared(cx) > 1e-6) {
        qn[o] = nrm.x / l; qn[o + 1] = nrm.y / l; qn[o + 2] = nrm.z / l;
        live[j * qu + i] = 1; nLive++;
      } else { qn[o + 1] = 1; }
    }
  }

  const vp = new Float32Array(nLive * 4 * 3);
  const vn = new Float32Array(nLive * 4 * 3);
  const va = new Float32Array(nLive * 4 * 4);
  const idx = new Uint32Array(nLive * 6);

  const acc = new THREE.Vector3(), own = new THREE.Vector3(), oth = new THREE.Vector3();
  let vi = 0, ii = 0;
  for (let j = 0; j < qv; j++) {
    for (let i = 0; i < qu; i++) {
      const qi = j * qu + i;
      if (!live[qi]) continue;
      own.set(qn[qi * 3], qn[qi * 3 + 1], qn[qi * 3 + 2]);
      const base = vi;
      for (let c = 0; c < 4; c++) {
        const gi = i + (c & 1), gj = j + (c >> 1);
        /* A vertex on a flagged row may only gather from quads on its own side of
           that row, and `own` is at row j by construction. */
        const walled = hard && hard[gj];
        acc.copy(own);
        for (let dj = -1; dj <= 0; dj++) {
          for (let di = -1; di <= 0; di++) {
            const qx = gi + di, qy = gj + dj;
            if (qx < 0 || qy < 0 || qx >= qu || qy >= qv) continue;
            if (walled && qy !== j) continue;
            const q2 = qy * qu + qx;
            if (q2 === qi || !live[q2]) continue;
            oth.set(qn[q2 * 3], qn[q2 * 3 + 1], qn[q2 * 3 + 2]);
            if (oth.dot(own) > cosT) acc.add(oth);
          }
        }
        acc.normalize();
        const g = gj * nu + gi;
        vp[vi * 3] = pos[g * 3]; vp[vi * 3 + 1] = pos[g * 3 + 1]; vp[vi * 3 + 2] = pos[g * 3 + 2];
        vn[vi * 3] = acc.x; vn[vi * 3 + 1] = acc.y; vn[vi * 3 + 2] = acc.z;
        va[vi * 4] = att[g * 4]; va[vi * 4 + 1] = att[g * 4 + 1];
        va[vi * 4 + 2] = att[g * 4 + 2]; va[vi * 4 + 3] = att[g * 4 + 3];
        vi++;
      }
      if (flip) {
        idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2;
        idx[ii++] = base + 1; idx[ii++] = base + 3; idx[ii++] = base + 2;
      } else {
        idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 1;
        idx[ii++] = base + 1; idx[ii++] = base + 2; idx[ii++] = base + 3;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(vp, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(vn, 3));
  g.setAttribute('aRock', new THREE.BufferAttribute(va, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/* ── the colluvial apron ───────────────────────────────────────────────────
 *
 * The whole-scene critique ranks this fifth overall and calls it "the structural
 * reason the two systems don't feel connected": the walls rise straight out of
 * smooth rounded benches, with nothing between the rock and the ground.
 *
 * The obvious response — more talus blocks — was measured and rejected. The wash
 * banks occlude the wall foot in most of the eight framings, so blocks lying on
 * the floor are cover the camera never sees. What is missing is not clasts, it is
 * a *landform*: a wedge of debris banked against the wall that climbs it, breaks
 * its bottom edge, and stands high enough to clear the bank crest. That is the
 * join the critic is describing, and it is on the rock side of the boundary —
 * System 1 keeps the wash floor and its fines.
 *
 * The construction is a cone slope, not a fillet. It springs from the wall face
 * at the height the chutes deliver to, falls at the angle of repose, and stops
 * where the ground overtakes it — which is a different distance in every column,
 * so the outer edge is found by marching rather than set. Two consequences worth
 * stating: where the bank falls away faster than repose the apron stands proud
 * as a cone, which is what talus actually does; and where the bank is already
 * steeper, the apron buries itself and contributes nothing, which is correct and
 * costs only the triangles.
 */
/* Fourteen, up from nine. Nine rows over an apron that reaches forty metres is
   a facet every four and a half, which is coarse enough to read as terracing on
   its own before the phase warp gets a chance to disguise where the rows are.
   The cost is about ten thousand triangles across both aprons, which is a
   quarter of a percent of the frame. */
const AP_ROWS = 14;
/* 34 degrees. Dry angular sandstone rubble sits between 32 and 37, and the top
   of that band reads as a scree cone while the bottom reads as a ramp. */
const AP_TAN = Math.tan(34 * Math.PI / 180);
/* Every second wall column. The apron's shape is driven by the chutes at a
   fifty-metre period and by the bays at ninety, so 1.24 m of along-wash sampling
   is four times finer than anything it carries. */
const AP_STRIDE = 2;
/* Below this the cone is not worth drawing and the column is sunk out of sight
   instead, which is what makes the apron a row of discrete cones rather than a
   continuous fillet along four hundred metres of wall. */
const AP_MIN_H = 0.6;

/* The apron profile, per wall column, cached per side so the talus can be laid
 * on the landform instead of under it.
 *
 * The first build put the wedge in and left buildTalus placing its blocks at
 * terrain.heightAt, which is now several metres *below* the apron wherever a
 * cone stands — so every block was buried inside the thing it is supposed to be
 * the surface of, and the apron rendered as a smooth sand ramp. The blocks are
 * the apron's texture; the wedge is only its shape. They have to agree, and the
 * cheapest way for them to agree is for both to read the same profile.
 *
 * buildWalls is evaluated before buildTalus in main.js's array literal and
 * JavaScript evaluates those left to right, so the cache is populated by the
 * time the talus asks for it. If it ever is not, apronYAt returns -Infinity and
 * the talus falls back to the terrain, which is where it used to be.
 */
const APRON = new Map();

function apronProfile(foot, terrain, side) {
  const src = foot.x.length;
  const uH = new Float32Array(src), yTop = new Float32Array(src);
  const len = new Float32Array(src), live = new Uint8Array(src);
  for (let i = 0; i < src; i++) {
    const x = foot.x[i], z = foot.z[i], nx = foot.nx[i], nz = foot.nz[i];
    const H = foot.h[i];
    /* Driven two and a half metres into the rock, so the head is buried whatever
       the joint offsets are doing locally and there is no lip to catch the light
       along the contact. */
    const u = foot.u[i] + 2.5;
    const g = terrain.heightAt(x + nx * u, z + nz * u);
    uH[i] = u;
    live[i] = H >= AP_MIN_H ? 1 : 0;
    /* Between the chutes the whole column is put three metres under the ground,
       which hides it without a special case anywhere else. */
    yTop[i] = live[i] ? g + H : g - 3.0;
    /* And it cannot reach the middle of the wash, which at the head it was
       doing: `tools/_headprofile.mjs` had `apronL`'s toe at |x| 0.0 to 1.4 over
       s = 310 to 334, so the two aprons met on the corridor axis and buried the
       channel under a continuous ramp. The seating walk below cannot catch that,
       because at the head the ground the apron lands on is genuinely low — the
       apron is not floating, it is simply too long for the room it has.
       A wash keeps its bed swept: debris delivered to the toe is carried off by
       the flow, so a talus toe stops where the channel starts rather than where
       gravity would let it stop. The channel's width is not a quantity this file
       has, but the wall's own set-back tracks it — both narrow together toward the
       head — so the reach is capped at seven tenths of it, leaving the inner
       third of the channel clear. It binds only at the head:
       everywhere in the eight standard framings the seating walk stops the apron
       first. */
    const Lmax = Math.min(H / AP_TAN * 2.4 + 6, Math.max(2.0, u * 0.70));
    let L = Lmax;
    for (let d = 1.0; d <= Lmax; d += 0.5) {
      const yy = yTop[i] - d * AP_TAN + 0.11 * AP_TAN * d * d / Lmax;
      if (yy < terrain.heightAt(x + nx * (u - d), z + nz * (u - d)) - 0.4) { L = d + 1.5; break; }
    }
    len[i] = L;
  }
  const p = { s0: foot.s[0], ds: foot.s.length > 1 ? foot.s[1] - foot.s[0] : 1,
    n: src, uH, yTop, len, live };
  APRON.set(side, p);
  return p;
}

/** Surface height of the apron at arc-length `s`, `u` metres out from the path,
 *  or -Infinity where there is no apron over that point. */
function apronYAt(side, s, u) {
  const p = APRON.get(side);
  if (!p) return -Infinity;
  const i = Math.round((s - p.s0) / p.ds);
  if (i < 0 || i >= p.n || !p.live[i]) return -Infinity;
  const d = p.uH[i] - u;
  if (d < 0 || d > p.len[i]) return -Infinity;
  return p.yTop[i] - d * AP_TAN + 0.11 * AP_TAN * d * d / p.len[i];
}

function apronGrid(foot, terrain, side) {
  const p = apronProfile(foot, terrain, side);
  const src = foot.x.length;
  const nu = Math.floor((src - 1) / AP_STRIDE) + 1;
  const nv = AP_ROWS;
  const pos = new Float32Array(nu * nv * 3);
  const att = new Float32Array(nu * nv * 4);

  for (let ii = 0; ii < nu; ii++) {
    const i = Math.min(src - 1, ii * AP_STRIDE);
    const x = foot.x[i], z = foot.z[i], nx = foot.nx[i], nz = foot.nz[i], s = foot.s[i];
    const uH = p.uH[i], yTop = p.yTop[i], L = p.len[i];
    /* Slightly concave up — a talus slope is at repose near its head and flattens
       into its own toe as the fines wash out — with the concavity written as a
       fraction of the drop so it does not change the angle at the head, only the
       tail. */
    const yAt = (d) => yTop - d * AP_TAN + 0.11 * AP_TAN * d * d / Math.max(L, 1e-3);

    for (let r = 0; r < nv; r++) {
      /* Phase-warped, and that is the whole of the corduroy fix.
         The rows were at r/(nv-1) in every column, so an apron up to forty
         metres long presented eight facet bands at a dead-regular four and a
         half metres, all of them running exactly parallel to the wall — and
         because the flutes below are evaluated at d = (1-t)L, the noise was
         being sampled at the same nine depths in every single column, so it
         reinforced the banding instead of breaking it. This is the bedform
         corduroy again and it has the same cure: not an amplitude envelope,
         which leaves the period where it is, but a warp of the phase. The two
         terms run at eighteen and six metres along the wall and are decorrelated
         between rows by r, so the bands meander independently and locally pinch
         out rather than shifting in unison — which would only have made the
         stripes wavy. Both wavelengths are long against the 1.24 m column
         spacing, so the per-column skew stays near a twentieth of a row and the
         surface does not zigzag. Held at zero on the first and last rows: those
         two are sealed under the ground and the terrain at the head, and a warp
         there would break the seal rather than the stripe. */
      const t0 = r / (nv - 1);
      const w = (r === 0 || r === nv - 1) ? 0
        : (0.44 * fbm(s * 0.055, r * 0.37, 2, 617)
         + 0.26 * fbm(s * 0.170, r * 0.61, 2, 619)) / (nv - 1);
      const t = Math.min(1, Math.max(0, t0 + w));
      const d = (1 - t) * L;
      const u = uH - d;
      /* Chutes and flutes down the slope. Zero at both ends so it can neither
         break the seal at the toe nor push the head back out of the rock. */
      const shape = Math.sin(Math.PI * Math.min(1, t * 1.12));
      let y = yAt(d)
        + (0.55 * fbm(s * 0.075, d * 0.05, 2, 431)
         + 0.28 * fbm(s * 0.23, d * 0.10, 2, 433)) * shape;
      /* The outer row is driven under the ground it lands on, for the same
         reason the back slope is: it makes the seal a property of the
         construction rather than of the terrain happening to cooperate. */
      if (r === 0) y = Math.min(y, terrain.heightAt(x + nx * u, z + nz * u) - 1.2);

      const k = r * nu + ii;
      pos[k * 3] = x + nx * u;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z + nz * u;
      /* Held at the contact rather than following the slope, for the reason the
         back slope documents: a stratigraphic coordinate that climbs a slope
         paints bedding diagonally across it, and bedding is horizontal. The
         debris flag in z is what the shader reads to shade this as colluvium
         instead of as a rock face, which is what it is. */
      att[k * 4] = Y_ANCHOR;
      att[k * 4 + 1] = s;
      att[k * 4 + 2] = -1;
      att[k * 4 + 3] = 0.5;
    }
  }
  return { pos, att, nu, nv, hard: new Uint8Array(nv) };
}

/** Mean of the normal attribute's y, for the winding check below. */
function meanNormalY(g) {
  const n = g.getAttribute('normal');
  let a = 0;
  for (let i = 1; i < n.array.length; i += 3) a += n.array[i];
  return a / (n.array.length / 3);
}

/* Split from the mesh below so the bake store can hold it. The wall curtain and
   its apron are both grown from one `wallGrid`, so caching the curtain alone
   would still leave the grid to be computed for the apron and save nothing —
   they have to go into the store as a pair, and that means the apron's geometry
   has to be obtainable without its mesh. */
function apronGeometry(grid, terrain, side) {
  const ag = apronGrid(grid.foot, terrain, side);
  /* The apron's grid runs along the wash in u and *outward* in v, where the
     wall's runs along the wash and *upward*, so the handedness is not the same
     and is not the same on both sides either. Rather than reason it out — the
     far ridgelines cost a whole capture to a winding argument that was wrong —
     build it, measure which way the normals point, and rebuild flipped if the
     surface is facing into the ground. An apron is very nearly horizontal, so
     mean normal y is unambiguous. */
  let g = creasedMesh(ag, Math.cos(0.9), side < 0);
  if (meanNormalY(g) < 0) g = creasedMesh(ag, Math.cos(0.9), side >= 0);
  return g;
}

function apronMesh(g, material, side) {
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  m.name = 'apron' + (side > 0 ? 'R' : 'L');
  return m;
}

export async function buildWalls(path, terrain, material) {
  const out = [];
  for (const side of [1, -1]) {
    /* The left wall's grid runs the same way round its own normal as the right
       one's does, which means its faces come out inside-out; the winding and the
       normals are both flipped rather than the grid being reversed, because the
       joint azimuths have to stay in world space. */
      /* The weld angle goes from 36 degrees to 45, which is the cheap half of the
         quilt. The quilt is per-quad flat shading in places that ought to be
         smooth: where the lateral offset field turns faster than the weld
         threshold tolerates, a quad finds no neighbour to average with and
         renders as a facet, and a field of facets is a low-frequency term in
         exactly the band that is already too loud. Widening the threshold costs
         nothing on the silhouette — welding changes vertex normals, not vertex
         positions, so the stepped profile is untouched — and the bedding risers do
         not rely on it either, since those are flagged rows and stay hard at any
         angle. What is given up is creasing on genuine fractures in the 36-to-45
         band, and those are gentler than any arris worth creasing. The other half
         of the quilt was the spall scar switching 1.5 m of offset over four
         hundredths of its driver, which is fixed above. */
    /* The curtain and its apron come out of the bake store as a pair, because
       they share the one `wallGrid` that is the cost of this phase. On a hit
       neither grid is built at all. */
    const [g, ag] = await bakeGeometries(`wall${side > 0 ? 'R' : 'L'}`, THREE, () => {
      const grid = wallGrid(path, terrain, side);
      return [creasedMesh(grid, Math.cos(0.78), side < 0),
              apronGeometry(grid, terrain, side)];
    });
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.name = 'wall' + (side > 0 ? 'R' : 'L');
    out.push(m);
    out.push(apronMesh(ag, material, side));
  }
  return out;
}

/* ── distant buttes ────────────────────────────────────────────────────────
 *
 * The same column wrapped round a centre instead of run along a path, so a
 * distant butte is stratified by exactly the rock the near walls are made of and
 * its bands sit at the same heights. Discrete solids rather than a noise field,
 * because what aerial perspective needs is *edges*: a ridgeline that ends against
 * a paler one behind it reads as depth, and a continuous surface fading into haze
 * reads as one flat veil however the fog is tuned.
 */
/* Lateral offset from the corridor axis, distance up-wash, base radius, height
   scale.
   The first placement of this table put every butte more than forty degrees off
   the corridor axis, on the reasoning that the gap up the wash with the sun in it
   is the one thing about this composition every critic has praised and a butte
   across it would be the worst thing this system could do. Rendered, the gap was
   *empty sky* — the near walls hide everything past about twenty-five degrees, so
   all ten had been placed behind them and the long view had no distance in it at
   all, which is the opposite failure and just as bad.
   The sky the camera can actually see up the wash is a narrow wedge: the near
   walls occlude out to roughly twenty-five degrees of azimuth but their crests
   fall away with distance, so above about eight degrees of elevation there is sky
   from ten degrees of azimuth outward. Everything below is placed in that wedge
   and sized to clear the near crests — which means genuinely tall, a hundred to a
   hundred and forty metres, the scale of Bell Rock or Courthouse Butte rather
   than of the corridor walls.
   The sun sits at about three degrees of azimuth and eight of elevation. The two
   long-distance entries sit almost on the axis on purpose, to put a hazed mass
   *under* it, and are held to four degrees of elevation so the disc is never
   touched. The four distance steps — 550, 800, 1000, 1450 metres — are chosen
   against the fog so the haze passes them in legibly separated stages instead of
   flattening them into one veil. */
/* `butte0` moved from [-118, 545] on 22 Aug, and the reasoning is worth keeping
   because the obvious moves are all wrong and the measurements say why.
   Enabling castShadow on these meshes fixed a lit-parallelogram defect and
   exposed a placement one that the disabled flag had been hiding: 148 m of rock
   at 323 m, crest subtending 22.7 degrees, straddling the sun's bearing, and at
   15 degrees of elevation laying 600 m of shadow straight down the hero canyon —
   81% of the wash floor's value and 59% of the lit wall. It was also what hid the
   disc in two of the four views the sun is judged from.
   The trap is that the gap up the wash is narrow and the sun is *in* it. Measured
   from sun_gap, the near wall crest falls 24 degrees at azimuth -14 to 3 degrees
   at 0, so a butte is only visible at all to the right of about -13, which is
   where the sun sits. Every candidate that shifts it left far enough to clear the
   bearing — 160 m, 230 m, 520 m, at four distances — measures 0.0 degrees of
   skyline above the wall. That is not moving the formation, it is deleting it
   behind a wall, which the brief rules out. Lowering fails for the same reason
   from the other end: below 15 degrees it no longer clears a 15-to-24 degree wall
   crest at its own azimuth, so it vanishes too.
   What works is distance. Back 560 m and left 40 puts the crest at 9.9 degrees —
   five clear of the sun, so it cannot occlude the disc at any azimuth — lays the
   shadow tip at z -510, a hundred and fifty metres up-wash of the corridor's far
   end, and leaves it 3.5 degrees wide and 2.0 degrees above the wall crest, in
   the same role this table already gives its two long-distance entries: a hazed
   mass under the sun. It also gains the left side a depth step, standing behind
   butte2 at 318 m of separation rather than in front of it.
   Skyline within +-6 degrees of the sun's bearing: measured per half-degree
   against every butte silhouette from all four viewpoints, the rise is 0.00. */
const BUTTES = [
  [-158, 1105,  95, 2.05], [ 142,  615, 105, 2.30],
  [-222,  800, 125, 2.45], [ 268,  905, 135, 2.20],
  [  40,  845, 155, 0.78], [ 205, 1010, 180, 0.92],
  [-520,  665, 155, 1.85], [ 560,  745, 165, 1.70],
  [ 880,  980, 205, 2.00], [-900, 1105, 215, 1.90],
];

function butteGrid(cx, cz, rad, hs, terrain, seed) {
  /* Low resolution on purpose: at three hundred metres a fifteen-metre bench is
     four pixels, so the column is subsampled to the rows that still describe a
     silhouette and everything finer is left to the shader. */
  const rows = [];
  for (let j = 0; j < COL.n; j += 3) rows.push(j);
  if (rows[rows.length - 1] !== COL.n - 1) rows.push(COL.n - 1);
  const ny = rows.length;
  const nu = 88, nv = ny + 3;

  const pos = new Float32Array(nu * nv * 3);
  const att = new Float32Array(nu * nv * 4);
  const base = terrain.heightAt(cx, cz);

  /* One erosion level for the whole butte, which is what makes a mesa: the same
     resistant bed capping a summit over hundreds of metres. */
  const rawTop = 24 + 48 * hash1(seed, 5);
  let cap = CREST_LEVELS[0];
  for (const lv of CREST_LEVELS) if (Math.abs(lv - rawTop) < Math.abs(cap - rawTop)) cap = lv;

  for (let i = 0; i < nu; i++) {
    const th = (i / nu) * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    const r0 = rad * (1 + 0.30 * fbm(ct * 1.6, st * 1.6, 3, seed)
                        + 0.14 * fbm(ct * 4.4, st * 4.4, 2, seed + 17));
    const ret = 1.4 + 0.9 * fbm(ct * 2.2, st * 2.2, 2, seed + 31);
    const a1 = (ct * rad * 0.4 + st * rad * 0.15) / 12.0;
    const a2 = (ct * -rad * 0.12 + st * rad * 0.42) / 26.0;
    let rTop = rad;
    for (let jj = 0; jj < ny; jj++) {
      const j = rows[jj];
      const over = COL.Y[j] > cap;
      const yq = over ? cap : COL.Y[j];
      const R = over ? colAt(COL.R, cap) : COL.R[j];
      const P = over ? colAt(COL.P, cap) : COL.P[j];
      const li = layerAt(yq + 1e-5);
      /* The proud offset is clamped on the outward side, and this is why. `proud`
         is negative for a bed that stands out as a ledge, and at a multiplier of
         2.4 the Coconino cliff's -1.50 pushed the cap radius out by three and a
         half metres of column space — times a height scale of up to 2.45, so
         nearly nine metres of flare on a butte whose body is a hundred and thirty
         across. That is a Monument Valley hoodoo: a cap wider than the neck under
         it. Sedona's Coconino cap is a vertical cliff flush with or set back from
         the body, so the ledges are allowed to recess freely and to stand out only
         a little. */
      /* Clamping the proud offset was not enough, because the overhang was never
         mainly the proud offset — it was the recess. Every cliff returned to the
         full body radius while the bench under it was cut three to six metres
         inside it, and a full-radius cliff standing on a recessed bench *is* an
         overhang: that is the plate-on-a-neck profile, produced by construction
         rather than by any one bad number.
         A real butte does not work that way. Its cliffs are vertical and each one
         stands *behind* the one below, set back by however far the bench between
         them has retreated, which is why a butte tapers upward and why its
         profile is a staircase and not a stack of mushrooms. So the taper is
         cumulative — each layer inherits the retreat of every recessive layer
         beneath it — and the local recess that used to carry the whole step is
         reduced to under half, just enough for a bench to read as a bench. The
         two together are within a few centimetres of flush at every cliff foot,
         which is what removes the overhangs without flattening the staircase. */
      /* The rim is cut down per azimuth, and this is the wedding cake fix.
         Every vertex in row j took its height straight from COL.Y[j], which is
         one number for the whole ring — so however much the *radius* varied with
         azimuth, each bench top and each cliff brow came out as a perfectly level
         circle, and a stack of level circles seen from the side is the "dead
         straight horizontal caprock edges stacked like a wedding cake" the
         critique reported in `bend`.
         Strictly subtractive, for two reasons. Erosion removes rock: a rim
         degrades by having notches cut into it, not by growing. And the buttes
         are part of the skyline System 4 is still working to clear the sun disc
         through — a perturbation that can only lower a crest cannot cost them
         anything, whereas a symmetric one would need re-verifying every time an
         amplitude moved. The broad term sags the bench between its buttresses;
         the cubed ridged term cuts the sparse deep slots that leave fins standing
         between them, which is the same construction the far ridgelines use.
         `li` is in both noise arguments so successive benches are notched at
         different azimuths — stacking the *same* notch pattern would trade a
         wedding cake for a fluted column. */
      const rimSag = 0.55 * (0.5 + 0.5 * fbm(ct * 2.7 + li * 0.31, st * 2.7, 2, seed + 67));
      const rimCut = 2.60 * Math.pow(ridged(ct * 5.5 + li * 0.9, st * 5.5, 2, seed + 113), 3);
      /* Held off the foot, where the butte has to meet the terrain it stands on
         and a notch would open a gap under it. */
      const dy = -(rimSag + rimCut) * smoothstep(-6.0, 8.0, yq);
      const yv = yq + dy;
      let r = r0 - (SETBACK[li] + R * ret * 0.45 + Math.max(P, -0.40) * 1.5) * hs;
      r -= jointOffset(a1, seed + li * 13, 9.0);
      r -= jointOffset(a2, seed + li * 7 + 5, 14.0);
      r -= 2.4 * fbm(ct * 9 + li, st * 9, 2, seed + 51);
      /* Spires and notches. A distant butte silhouette is serrated — the joints
         weather out into slots and leave fins standing between them — and smooth
         is one of the reliable ways a rendered skyline reads as clay. Cubed, so
         the notches are sparse and deep rather than a general waviness, which is
         what the octave above already provides. */
      r -= 6.0 * Math.pow(ridged(ct * 16 + li * 0.7, st * 16, 2, seed + 83), 3);
      r = Math.max(r, rad * 0.12);
      const k = jj * nu + i;
      pos[k * 3] = cx + ct * r;
      pos[k * 3 + 1] = base + yv * hs - 7;
      pos[k * 3 + 2] = cz + st * r;
      /* The stratigraphic coordinate follows the cut rather than the row, because
         cutting into the stack exposes an older bed — that is what makes a notch
         read as erosion into strata instead of as a dent in a painted surface. */
      att[k * 4] = yv;
      att[k * 4 + 1] = th * 90;
      att[k * 4 + 2] = 0;
      att[k * 4 + 3] = 0.5;
      rTop = r;
    }
    /* Close the top with a low dome rather than a flat lid. It carries the same
       per-azimuth cut as the rows below it, or the summit would come back level
       and hand the silhouette its straight edge back at the one height where it
       is most visible. */
    const capLi = layerAt(cap + 1e-5);
    const capDy = -(0.55 * (0.5 + 0.5 * fbm(ct * 2.7 + capLi * 0.31, st * 2.7, 2, seed + 67))
                  + 2.60 * Math.pow(ridged(ct * 5.5 + capLi * 0.9, st * 5.5, 2, seed + 113), 3))
                  * smoothstep(-6.0, 8.0, cap);
    for (let b = 0; b < 3; b++) {
      const t = (b + 1) / 3;
      const r = rTop * (1 - t * t) * 0.99;
      const k = (ny + b) * nu + i;
      pos[k * 3] = cx + ct * r;
      pos[k * 3 + 1] = base + (cap + capDy) * hs - 7 + t * 2.5 * hs;
      pos[k * 3 + 2] = cz + st * r;
      att[k * 4] = cap + capDy;
      att[k * 4 + 1] = th * 90;
      att[k * 4 + 2] = 0;
      att[k * 4 + 3] = 0.5;
    }
  }
  /* Subsampled rows, so a contact pair only survives as a boundary where both of
     its rows were kept; the rest of the section is carried by tone at this
     distance anyway. */
  const hard = new Uint8Array(nv);
  for (let jj = 1; jj < ny; jj++) hard[jj] = COL.H[rows[jj]] & COL.H[rows[jj] - 1] ? 1 : 0;
  return { pos, att, nu, nv, hard };
}

/** `creasedMesh` with the u axis wrapped, for the radial buttes. */
function creasedRing(grid, cosT) {
  const { pos, att, nu, nv, hard } = grid;
  const nu2 = nu + 1;
  const p2 = new Float32Array(nu2 * nv * 3), a2 = new Float32Array(nu2 * nv * 4);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu2; i++) {
      const src = j * nu + (i % nu), dst = j * nu2 + i;
      for (let c = 0; c < 3; c++) p2[dst * 3 + c] = pos[src * 3 + c];
      for (let c = 0; c < 4; c++) a2[dst * 4 + c] = att[src * 4 + c];
    }
  }
  return creasedMesh({ pos: p2, att: a2, nu: nu2, nv, hard }, cosT, false);
}

export async function buildDistantButtes(terrain, material) {
  const out = [];
  let i = 0;
  /* One store entry for the whole table rather than one per butte. They are
     generated together, they are invalidated together — the table itself is
     part of the source fingerprint — and ten reads cost ten transactions. */
  const geos = await bakeGeometries('buttes', THREE, () => BUTTES.map(
    ([lat, dist, rad, hs], n) =>
      creasedRing(butteGrid(lat, -dist, rad, hs, terrain, 601 + n * 97), Math.cos(0.72))));
  for (const g of geos) {
    const m = new THREE.Mesh(g, material);
    /* These used to be excluded as "half a kilometre outside the shadow camera's
       box". That is true of most of them and false of the ones that matter, and
       the reasoning is worth keeping because it is easy to make again: for a
       directional light **a caster shares clip x and y with its own shadow**, so
       a butte whose shadow falls on a wall inside the box cannot itself be
       outside the box in x or y. Only z can differ, and z spans 1,860 m here.
       `butte0` sits at clip z −0.83..−0.54 — fully inside — and its sun ray is
       what should have been shading a wall face at 53 m sitting at n·L 0.921.

       Leaving it off put direct sun on a wall that is geometrically in shadow:
       2,292 blown pixels in one patch and 4,171 across the upper wall, which
       read as a lit parallelogram pasted onto shaded rock. Enabling it takes
       those to 0 and 29. Three culls the genuinely-distant ones on their
       bounding spheres, so the cost is the ~19k triangles of the ones that
       actually cast. */
    m.castShadow = true;
    m.receiveShadow = false;
    m.name = 'butte' + i;
    out.push(m);
    i++;
  }
  return out;
}

/* ── talus ─────────────────────────────────────────────────────────────────
 *
 * A cliff sheds blocks and they come to rest at the angle of repose, coarse at
 * the toe because a big block bounces further. The wash floor already carries the
 * fine end of this from scatter.js; what was missing is the metre-scale end, the
 * blocks that make the junction between rock and ground an event rather than a
 * line. Angular hulls, because they broke off yesterday and nothing has rounded
 * them.
 */
function talusBlock(seed, flat) {
  const rand = rng(seed);
  const pts = [];
  const ax = 1.0, ay = flat, az = 0.72 + rand() * 0.5;
  for (let i = 0; i < 8; i++) {
    pts.push(new THREE.Vector3(
      ((i & 1) ? 1 : -1) * ax * (0.48 + rand() * 0.62),
      ((i & 2) ? 1 : -1) * ay * (0.48 + rand() * 0.62),
      ((i & 4) ? 1 : -1) * az * (0.48 + rand() * 0.62)));
  }
  for (let i = 0; i < 20; i++) {
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    const j = t * (0.90 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  const g = new ConvexGeometry(pts);
  const p = g.attributes.position;
  const aR = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    /* A fallen block is a piece of the cliff, so it carries bedding of its own —
       in *its* frame, which is now some arbitrary rotation, exactly as a tipped
       slab does. The column coordinate is local height, offset into the middle of
       the lower Schnebly cliff, which is what most of the apron came off. */
    /* The column coordinate spans little more than a single sub-bed now. At 4.5
       it spanned nine metres of section across a block half a metre wide, so a
       fist-sized cobble wore three bedding contacts and an iron lens, arriving at
       whatever angle the block had been tipped to: red stripes painted diagonally
       across the apron at angles unrelated to anything. A fallen block does carry
       its own bedding in its own frame, but a small block is a *piece of one
       bed*, not a section through twelve. */
    aR[i * 4] = 18.0 + p.getY(i) * 0.9;
    aR[i * 4 + 1] = p.getX(i) * 4.0 + p.getZ(i) * 1.8;
    /* Lower. At 0.78 the fresh-face term was adding a fifth of full-strength
       hematite to every block in the apron on top of whatever the lens driver
       gave it, and a talus cone is mostly *old* blocks: they fell decades ago and
       have varnished and dusted since. A handful of fresh faces is the point, and
       the scar term on the walls already provides them. */
    aR[i * 4 + 2] = 0.30;
    aR[i * 4 + 3] = 0.55;
  }
  g.setAttribute('aRock', new THREE.BufferAttribute(aR, 4));
  g.computeBoundingSphere();
  return g;
}

export async function buildTalus(path, terrain, material) {
  /* Its own material rather than the walls'. Same shader, same textures, same
     draw-call cost — only the decimetre sampling scale differs, because these
     blocks are twenty centimetres to two metres across and the wall's 6.45 m
     tile gives one of them a single flat tone. That is the whole of why the
     apron read as pale untextured polyhedra. */
  /* 1.6, down from 5.5. The reason for raising it was real — at the walls' own
     6.45 m tile a 30 cm block gets a single flat tone — but 5.5 overshot badly:
     it put the laminae at two and a half centimetres, so a fist-sized cobble wore
     sixteen of them and came out as a streaked fibrous thing unrelated to
     sandstone. What has changed since is that the grit layer is locked to the
     pixel footprint, so a block now gets all its pixel-scale material from a
     source that does not care how big the block is. The coarse map's remaining
     job on talus is only to say which bed the block came out of, and that wants
     nearly the parent tile. */
  const mat = makeRockMaterial(material.userData.tex, 1.6);
  /* Attempts, not instances: most are rejected because they land between chutes.
     At the first setting there were nine thousand attempts producing seventeen
     hundred blocks up to six metres across, and the render showed why both numbers
     were wrong — an apron of a dozen faceted tents the size of garden sheds with
     bare ground between them, which reads as sculpture. Rockfall is graded: a
     great many blocks between a foot and a yard, a few metres-across slabs near
     the bottom of the cone, and nothing that competes with the cliff it fell off. */
  const VAR = 4, N = 30000;
  const geos = await bakeGeometries('talus-blocks', THREE, () => {
    const gs = [];
    for (let v = 0; v < VAR; v++) gs.push(talusBlock(3100 + v * 11, 0.46 + v * 0.12));
    return gs;
  });

  /* Thirty thousand placement attempts, each one a terrain query, cached as the
     matrices they survive as. Flat rather than a list of `Matrix4` per variant,
     because sixteen floats per block is exactly what `instanceMatrix` wants and
     a stored array of objects would be rebuilt into one anyway.
     Everything the loop needs is allocated inside it, so a hit does no work: the
     `rng` stream is local to this function and nothing downstream reads it, which
     is what makes skipping the loop safe here and not in the clast scatter. */
  const packed = await bake('talus-matrices', () => {
  const lists = [];
  for (let v = 0; v < VAR; v++) lists.push([]);
  const rand = rng(4477);
  const sStart = sStartOf(path);
  const p = new THREE.Vector3();
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler();
  const sc = new THREE.Vector3(), tr = new THREE.Vector3();

  for (let n = 0; n < N; n++) {
    /* Same clamp as the curtain, at both ends: outside the path's domain every
       station is the same point, so blocks drawn from beyond it were all landing
       in one heap on the axis at the head, and blocks drawn from behind the start
       were landing in another with a reversed heading. */
    /* Upper bound held at `sEnd - 6`, exactly where it was, so that correcting
       the lower one does not quietly reshuffle every block on the wall: the
       blocks in view from `wall_lit` and `bend` are a reviewed population and
       this change has no business moving them. */
    const s = sStart + rand() * (sEndOf(path) - 6 - sStart);
    const side = rand() < 0.5 ? 1 : -1;
    path.posAt(s, p);
    const th = path.headingAt(s);
    const nx = Math.cos(th) * side, nz = Math.sin(th) * side;
    const dat = datumAt(s);
    const toe = toeAt(terrain, p.x, p.z, nx, nz, dat);

    /* Sorted along the apron: a block that bounced to the toe is the big one. */
    const t = Math.pow(rand(), 0.65);
    const av = toe - t * (1.0 + 11 * rand());
    if (av < 3) continue;
    /* Rockfall is episodic and arrives down the chutes, so an apron is a run of
       heaps with swept ground between them rather than an even sprinkle. */
    const chute = smoothstep(0.40, 0.78, 0.5 + 0.5 * fbm(s * 0.075, side * 3.1, 3, 421));
    /* Density used to run 0.35 at the cliff foot to 1.10 at the apron toe, which
       is the wrong way round and is most of why the whole-scene critique found
       "no talus at any cliff foot in any view" in a scene that has been building
       talus all along. The size grading along the apron is right — a block that
       bounced clear is the big one — but the *cover* is not: an apron is thickest
       where the rock lands and thins outward into the wash, so the head is where
       it should be continuous. Nearly flat now, leaning slightly outward, which
       roughly doubles the blocks in the first few metres off the wall without
       touching the grading that makes the runout read. */
    /* And weighted onto the wedge, which is the part the first build of the apron
       got wrong in a way that was invisible until it was rendered. The blocks had
       their own chute field at a thirteen-metre period and the apron's cones run
       at forty-eight, from a different seed — so the two were uncorrelated, and
       the cones came out as bare slopes with the rubble scattered on the flat
       between them. That is backwards: the cone *is* the rockfall deposit, and
       the blocks are its surface. Where a block lands on the apron it is now
       given a floor, and off it the old rule is cut to a fifth.
       The constants are solved rather than chosen. The first pair — a floor of
       0.80 and off-apron at 0.55 — looked right and cost 270k triangles, because
       the old rule's mean acceptance is only 0.225 and a floor of 0.80 is not a
       redistribution, it is a near-tripling. The contract puts the ceiling at
       ~3M and the scene arrived at 2.81M, so that setting spent the whole
       remaining headroom of every system on one apron. This pair is 1.34x, about
       forty thousand triangles, and it still leaves the cone six times the cover
       of the swept ground beside it — which is the contrast that reads, not the
       absolute count. */
    const acc = chute * (0.78 + 0.28 * t);
    if (rand() > (apronYAt(side, s, av) > -1e30 ? Math.max(acc, 0.32) : acc * 0.22)) continue;

    const x = p.x + nx * av, z = p.z + nz * av;
    /* Half-extent in metres. The exponent is what makes the grading: a cube root
       of a uniform would put most of the mass at the coarse end, a cube puts it at
       the fine end with a thin tail of slabs, and a talus apron is the latter. */
    /* The coarse tail was still too long. A three-metre slab standing on end in
       the near field is a monolith, not rockfall, and half a dozen of them across
       an apron read as sculpture placed there — a fourth power and a shorter
       toe-coarsening keep the biggest blocks at about two metres, which is the
       size that makes the junction an event without competing with the cliff. */
    /* The fine floor goes from 0.095 to 0.125 of a metre of half-extent. Not a
       taste change: the walls are framed from 40 to 90 m, where a 19 cm block
       buried to half its height presents under two pixels and cannot read as
       anything at all, so the fine end of the grading was being spent on cover
       the frame could not resolve. The coarse tail is untouched — the fourth
       power and the toe coarsening still cap the biggest blocks near two metres,
       which is the size that makes the junction an event without competing with
       the cliff above it. */
    const r = (0.125 + 0.40 * Math.pow(rand(), 4.0)) * (1 + t * 1.2);
    /* Buried deeper. A talus block sitting on the ground with a clean tangent
       line between the two reads as composited into the frame; a real one has
       fines washed in around it and is half swallowed. This is the cheapest half
       of the burial cue — the sand fillet is the other half and belongs to
       System 1's scatter, which is where the wash floor's fines are. */
    /* On the apron where there is one, on the ground where there is not. The
       apron stands up to eleven metres above the height field, so a block laid
       at terrain.heightAt under a cone is not a block on a talus slope, it is a
       block inside a hill — which is exactly what the first build of the wedge
       did, and why that apron rendered as bare sand. */
    const yA = apronYAt(side, s, av);
    const yS = Math.max(terrain.heightAt(x, z), yA === -Infinity ? -1e9 : yA);
    tr.set(x, yS - r * (0.46 + 0.44 * rand()), z);
    e.set(rand() * 6.283, rand() * 6.283, rand() * 6.283);
    qt.setFromEuler(e);
    sc.set(r * (0.8 + rand() * 0.5), r * (0.55 + rand() * 0.5), r * (0.8 + rand() * 0.5));
    lists[(rand() * VAR) | 0].push(m.compose(tr, qt, sc).clone());
  }

    const o = {};
    for (let v = 0; v < VAR; v++) {
      const flat = new Float32Array(lists[v].length * 16);
      for (let i = 0; i < lists[v].length; i++) lists[v][i].toArray(flat, i * 16);
      o['m' + v] = flat;
    }
    return o;
  });

  const out = [];
  for (let v = 0; v < VAR; v++) {
    const flat = packed['m' + v];
    const count = flat.length / 16;
    if (!count) continue;
    const im = new THREE.InstancedMesh(geos[v], mat, count);
    im.instanceMatrix.array.set(flat);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.name = 'talus' + v;
    out.push(im);
  }
  return out;
}

/* ── the rock shader ───────────────────────────────────────────────────────── */

/** The layer table, unrolled into GLSL so the two cannot drift apart. */
function layerGLSL() {
  const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const L0 = LAYERS[0];
  let s = '';
  s += `  vec3 lCol = vec3(${f(L0.col[0])}, ${f(L0.col[1])}, ${f(L0.col[2])});\n`;
  s += `  float lIron = ${f(L0.iron)}, lPale = ${f(L0.pale)}, lRough = ${f(L0.rough)};\n`;
  s += `  float lBot = ${f(L0.y0)}, lTop = ${f(LAYERS[1].y0)}, lBedT = ${f(L0.bedT)};\n`;
  s += `  float lIdx = 0.0, lVert = ${isVert(L0.kind) ? '1.0' : '0.0'};\n`;
  for (let i = 1; i < LAYERS.length; i++) {
    const L = LAYERS[i], top = i + 1 < LAYERS.length ? LAYERS[i + 1].y0 : Y_TOP;
    s += `  { float w = hardstep(${f(L.y0)}, y, hw);\n`;
    s += `    lCol = mix(lCol, vec3(${f(L.col[0])}, ${f(L.col[1])}, ${f(L.col[2])}), w);\n`;
    s += `    lIron = mix(lIron, ${f(L.iron)}, w); lPale = mix(lPale, ${f(L.pale)}, w);\n`;
    s += `    lRough = mix(lRough, ${f(L.rough)}, w);\n`;
    s += `    lBot = mix(lBot, ${f(L.y0)}, w); lTop = mix(lTop, ${f(top)}, w);\n`;
    s += `    lBedT = mix(lBedT, ${f(L.bedT)}, w); lIdx = mix(lIdx, ${f(i)}, w);\n`;
    s += `    lVert = mix(lVert, ${isVert(L.kind) ? '1.0' : '0.0'}, w); }\n`;
  }
  return s;
}

const ROCK_PREFIX = /* glsl */`
uniform sampler2D uRockA; uniform sampler2D uRockN; uniform sampler2D uRockM;
uniform sampler2D uMacro; uniform sampler2D uVar; uniform sampler2D uDirtA;
uniform sampler2D uGrit;
uniform float uDetail;
uniform vec3 uIron;
uniform vec3 uVarnish;
uniform float uRockLum;
uniform vec3 uSunDir;
/* Scales the joint traces, for tools/_rockdiag.mjs. The whole-scene critique
   reported "a regular rectangular grid of thin dark lines ruling the entire far
   wall", and the candidates — mesh seams, shadow acne, joints — need opposite
   fixes, so the term has to be switchable from a probe rather than argued
   about. Left at 1.0 by everything except the probe. */
uniform float uJointK;
uniform float uVarnK;
/* Scales the registration warp, for the same reason and by the same rule: the
   warp is a local rescaling of the sampling domain, and a local rescaling of a
   high-frequency octave is exactly the thing that can cost high-frequency energy
   without touching the low-frequency term — which is the shape of a falling
   hf/lf. So it has to be ablatable inside one page load rather than reasoned
   about, since two captures are not a pair. Left at 1.0 by everything except the
   probe, and declared here rather than injected by a tool: an undeclared debug
   uniform cost this project a capture round tonight. */
uniform float uWarpK;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vRock;

float tRough; float tAO; vec3 tNrmW; float gShadow = 1.0;

/* A contact that is hard when it can be resolved and smooth when it cannot.
   Sedona's bed boundaries are knife-sharp, and that hardness is half of what
   makes the bands read as strata rather than as a gradient — but a knife-sharp
   step sampled once per pixel on a cliff two hundred metres away is a crawling
   line of aliasing. Widening the step to one pixel of the driving coordinate is
   the correct filter and costs one fwidth. */
float hardstep(float e, float x, float w) { return smoothstep(e - w, e + w, x); }

/* Shader-side only, so a large-argument hash is safe here — the CPU never has to
   agree with it, and the argument is always an exact small integer, so every pixel
   in a cell gets bit-identical bits. Declared up here rather than beside the rest
   of the utilities because GLSL has no forward declarations and jointTrace needs
   it; a function used before it is declared is a compile error, and a shader that
   fails to compile still renders — as three's fallback — so it costs a whole
   capture to discover. */
float hash11(float n){ return fract(sin(n * 17.317) * 4321.717); }

/* Smooth signed 1-D value noise off the same hash, for warping a cell coordinate
   before it is floored. Anywhere a feature is placed by flooring a scaled
   station, the cell walls sit on a perfect lattice and no amount of per-cell
   jitter inside the cell removes the period — the jitter moves the feature
   within its cell but there is still exactly one per cell, so the spacing
   distribution stays narrow and the eye reads a rhythm. Warping the coordinate
   makes the cells themselves unequal, which widens the spacing distribution and
   varies the feature's world width for free, and it is the same cure that fixed
   the crest that held one bed level for 50-100 m and the apron rows that sat at
   a dead-regular pitch. Both times it was a phase change and not an amplitude
   change, and that is the point: nothing gets stronger or weaker, it stops being
   periodic. Callers must keep the total slope under 1 or the warp folds and
   cells invert; the bound is 1.5 * amplitude * frequency per term. */
float vwob(float x, float seed) {
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i + seed), hash11(i + 1.0 + seed), f) - 0.5;
}

/* How far below its unit's lip a varnish tongue starts, snapped to whole beds.
   Every tongue used to hang from lTop with 2.2 m of jitter, and lTop is the top
   of the *lithological unit*, not of a bed — units here are eight to twenty
   metres thick, so every tongue in a unit began inside the same two-metre band
   and the tongues formed one horizontal row per unit. Three units visible in a
   framing is three rows, which is exactly what the ship critic counted. So the
   source scatters through the unit instead, snapped to a bed contact because a
   lip is where water sheds; the read goes from one row per unit to a scatter,
   and it is still a lip that sheds each one. */
float vLip(float h, float top, float bot, float bedT) {
  float bt = max(bedT, 0.6);
  return floor(h * max(1.0, (top - bot) / bt) * 0.70) * bt;
}

/* Matched exactly by subResist() on the CPU, which is why it is two low-frequency
   sines rather than the usual large-argument hash. */
float bedResist(float id, float li) {
  return 0.5 + 0.34 * sin(id * 2.399 + li * 1.113 + 1.7)
             + 0.16 * sin(id * 5.211 + li * 0.770);
}

/* Matched exactly by subBed() on the CPU. */
float bedCoord(float d, float bedT, float li) {
  return d / bedT + 0.44 * sin(d * 0.1873 + li * 2.117)
                  + 0.31 * sin(d * 0.4271 + li * 3.733 + 1.4)
                  + 0.17 * sin(d * 0.9137 + li * 1.259 + 0.6);
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

/* Whichever of the three planes a triplanar blend would have given nearly all
   the weight to anyway. One tap instead of three, and it is used for every map
   whose blend seam is not visible: the fine grain scale, where the seam is
   smaller than a texel of the coarse scale; the AO channel, which is a scalar;
   and the ledge dust, which only exists on up-facing surfaces where the xz plane
   already carries a hundred percent of the weight. Three of these against two
   full triplanar calls is the difference between a shader this software
   rasteriser can iterate on and one it cannot. */
vec2 domUV(vec3 p, vec3 a){
  if (a.y > a.x && a.y > a.z) return p.xz;
  return (a.x > a.z) ? p.zy : p.xy;
}

vec3 domNormal(sampler2D t, vec3 p, vec3 N, float sc){
  vec3 a = abs(N), n, o;
  if (a.y > a.x && a.y > a.z) {
    n = texture2D(t, p.xz * sc).xyz * 2.0 - 1.0;
    o = vec3(n.xy + N.xz, abs(n.z) * N.y); o = o.xzy;
  } else if (a.x > a.z) {
    n = texture2D(t, p.zy * sc).xyz * 2.0 - 1.0;
    o = vec3(n.xy + N.zy, abs(n.z) * N.x); o = o.zyx;
  } else {
    n = texture2D(t, p.xy * sc).xyz * 2.0 - 1.0;
    o = vec3(n.xy + N.xy, abs(n.z) * N.z);
  }
  return normalize(o);
}

/* The same whiteout blend as domNormal, but for a tangent-space xy that has
   already been fetched — the grit layer packs its normal alongside its tone and
   its cavity in one texel, so the fetch happens once and the plane mapping is
   applied afterwards. */
vec3 domApply(vec2 nxy, vec3 N){
  vec3 a = abs(N), o;
  float z = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  if (a.y > a.x && a.y > a.z) { o = vec3(nxy + N.xz, z * N.y); o = o.xzy; }
  else if (a.x > a.z)         { o = vec3(nxy + N.zy, z * N.x); o = o.zyx; }
  else                        { o = vec3(nxy + N.xy, z * N.z); }
  return normalize(o);
}

/* Distance to the nearest open joint trace of one set, in metres, as a filtered
   tone in [0,1]. dir is a unit azimuth in plan, sp the mean spacing, w the
   half-width the trace should present — which is at least a pixel or the line
   crawls. Most cell walls are *not* open joints, and where one is open its
   position within the cell and its aperture both vary, because a fracture set
   with a metronomic spacing is a comb. */
/* Returns the groove in x and the *bevel* beside it in y.
 *
 * The lip was previously taken as the top slice of the groove's own profile —
 * clamp(groove * 1.7 - 0.55) — and that is why it rasterised as a row of evenly
 * spaced bright dots rather than as a line. Slicing the top off a profile whose
 * total half-width is already only about a pixel and a half leaves a feature
 * a third of a pixel wide, and a sub-pixel line does not render as a thin line,
 * it renders as a dashed one wherever the sampling grid happens to catch it. The
 * concept was right and the width was impossible.
 *
 * So the bevel is now its own band, outboard of the groove, with a floor on its
 * width of two pixels of world footprint. That is what a bevel physically is: an
 * arris does not come to a knife edge, it retreats to a rounded shoulder of
 * finite radius, and the highlight along it is as wide as the shoulder. Both
 * edges of the band are filtered, so it antialiases in both directions instead
 * of only inward. */
vec2 jointTrace(vec2 p, vec2 dir, float sp, float seed, float w, float thr){
  float t = dot(p, dir) / sp;
  float ti = floor(t), tf = t - ti;
  float open = step(thr, hash11(ti * 1.731 + seed));
  float c = 0.5 + (hash11(ti * 3.117 + seed + 11.0) - 0.5) * 0.7;
  float dd = abs(tf - c) * sp;
  float ap = w * (0.55 + 1.10 * hash11(ti * 5.311 + seed + 29.0));
  float groove = 1.0 - smoothstep(ap * 0.30, ap, dd);
  /* The shoulder: from the groove wall out to a radius of its own, never
     narrower than two pixels, and smooth at both ends. */
  float r0 = ap * 0.75, r1 = max(ap * 2.4, r0 + w * 2.0);
  float bevel = smoothstep(r0, mix(r0, r1, 0.45), dd) * (1.0 - smoothstep(mix(r0, r1, 0.55), r1, dd));
  return vec2(groove, bevel) * open;
}

/* A joint set that the pixel grid can no longer resolve has to fade to its mean
   rather than keep drawing lines.
 *
 * jw holds every trace at about a pixel and a half of *screen* width, which is
 * the right filter for a line that is still separated from its neighbours. It is
 * the wrong one once the spacing itself approaches the footprint: the 0.52 m set
 * is under two pixels apart on a wall a hundred metres out, so instead of four
 * fracture sets the far wall gets a comb of hairlines at a fixed screen pitch,
 * crossed by a second comb at another azimuth. That is the "regular rectangular
 * grid of thin dark lines ruling the entire far wall" the whole-scene critique
 * reported, and it is systemic exactly because it is a function of distance
 * rather than of any one wall.
 *
 * Fading between two and five and a half samples per cell is the usual band: at
 * five the cells are still separately visible, at two they are Nyquist and
 * everything below is aliasing that no width clamp can rescue. The mean the set
 * fades to is already carried by the base albedo, so nothing goes missing —
 * a wall at distance loses its hairlines and keeps its tone. */
float jointRes(float sp, float foot){ return smoothstep(2.0, 5.5, sp / max(foot, 1e-5)); }

vec3 bumpFrom(float hgt, vec3 N, float scale){
  vec3 pdx = dFdx(vWPos), pdy = dFdy(vWPos);
  float hdx = dFdx(hgt), hdy = dFdy(hgt);
  vec3 r1 = cross(pdy, N), r2 = cross(N, pdx);
  float det = dot(pdx, r1);
  vec3 grad = sign(det) * (hdx * r1 + hdy * r2);
  return normalize(abs(det) * N - scale * grad);
}
`;

const ROCK_SURFACE = /* glsl */`
vec3 gN = normalize(vWNrm);
float y = vRock.x;            // column-space elevation: the stratigraphic coordinate
float aS = vRock.y;           // along-wall coordinate, for the vertical streaks
float back = step(vRock.z, -0.5);   // behind the rim: debris and soil, not rock face
float fresh = max(vRock.z, 0.0);    // spall scars: rock exposed since the last frost
float cav = vRock.w;          // how far this point sits back from its neighbourhood

float foot = max(length(dFdx(vWPos)), length(dFdy(vWPos)));
float grainF = 1.0 - smoothstep(0.020, 0.13, foot);   // sandstone grain, 1-6 cm
float bedF   = 1.0 - smoothstep(0.09, 0.55, foot);    // sub-bed relief, 10-50 cm

/* One pixel of the stratigraphic coordinate, which every contact below is
   filtered against. */
float hw = clamp(fwidth(y) * 0.62, 0.012, 0.85);

/* How far this facet is from the terminator, hoisted because both the relief
   fade and the joint lips need it. With the sun eight degrees up, a facet a few
   degrees the wrong side of the terminator receives nothing at all, so anything
   that models a lit millimetre-scale feature has to go out with it. */
float sTerm = smoothstep(-0.02, 0.30, dot(gN, uSunDir));

${layerGLSL()}

/* ---- sub-bedding ----
   The same monotone coordinate the mesh rows were placed on, so the tone step and
   the ledge the geometry cut are one bed. Contacts are hard; the tone difference
   between beds is not large, because stratification you cannot avoid reads as
   corrugated iron, and what carries a bed at distance is the shadow line under
   its lip rather than its colour. */
float sb = bedCoord(y - lBot, lBedT, lIdx);
float sbI = floor(sb);
float sbT = sb - sbI;
float sbR = bedResist(sbI, lIdx);

/* ---- surface grain, triplanar ----
   Two readings of the same packing, two octaves apart. At 0.155 cycles per metre
   the tile is 6.45 m and the map presents what it was authored as — cavernous
   pits of five to twenty-five centimetres, laminae, granular clumps; at 0.62 the
   same tile is 1.61 m and those features come back a quarter of the size, which
   is the sand-grain band. The map is a packing of discrete elements rather than
   a sum of smooth noise, which is the difference between sandstone and wax and
   is the whole reason it was rebuilt. */
vec3 aN = abs(gN);
vec3 triW = pow(aN, vec3(4.0));
triW /= max(triW.x + triW.y + triW.z, 1e-4);

/* ---- registration warp ----
   Both octaves were read at a fixed world position, so the 6.45 m tile landed in
   the same phase on every facet of both walls and the fine octave sat in a fixed
   relationship to it. That is the "one tiling noise on every facet" the critique
   named, and it is what makes a kilometre of cliff read as one manufactured
   material: the eye does not need to see the seam, it only needs to notice that
   the same arrangement of blobs recurs on a lattice.

   The cure is to slide the domain, not to add another map. Six sines at
   wavelengths of 90 to 340 m — long against the tile, incommensurate with each
   other and with it — displace the sample by a few metres in a way that never
   repeats over the length of the wash, so no two stretches of wall present the
   tile in the same phase. Their summed gradient is about 0.23, so the local
   stretch stays under a quarter and the grain does not smear.

   The fine octave gets the warp transposed and negated rather than the same one.
   That is the part that answers "more than one noise across all facets"
   literally: the two octaves now beat against each other differently in
   different places instead of being locked, so the *combination* varies across
   the cliff even where each layer alone is repeating. Six sines and no fetch,
   which is what this frame can afford — it is fill-bound at 1440p. */
vec2 wrp = uWarpK * vec2(
  sin(aS * 0.0561 + 1.7) * 1.9 + sin(aS * 0.0233 - 0.6) * 2.6
    + sin(y * 0.0417 + 2.3) * 1.4,
  sin(y * 0.0331 + 0.9) * 1.7 + sin(aS * 0.0187 + 2.8) * 2.2
    + sin(y * 0.0713 - 1.2) * 0.9);
vec3 pC = vWPos + vec3(wrp.x, wrp.y * 0.55, wrp.y);
vec3 pF = vWPos + vec3(37.1, 11.3, 5.7) + vec3(-wrp.y * 0.7, wrp.x * 0.4, wrp.x * 0.7);

float sC = 0.155 * uDetail, sF = 0.62 * uDetail;
vec3 rkA = triSample(uRockA, pC, triW, sC);
float rkA2 = dot(texture2D(uRockA, domUV(pF, aN) * sF).rgb, vec3(0.299, 0.587, 0.114));
float rkAO = texture2D(uRockM, domUV(pC, aN) * sC).r;
vec3 rkN = triNormal(uRockN, pC, triW, sC, gN);
vec3 rkN2 = domNormal(uRockN, pF, gN, sF);

/* ---- footprint-locked grit ----
   The fractal term, and the one the gradient metric actually lives on. A texture
   at a fixed world scale is gone past the distance where its texels fall under a
   pixel: the mip chain returns its mean and the surface goes to wax, which is
   measurably what the wall was doing at 0.0045 mean one-pixel gradient against
   0.026 to 0.085 for photographs of this rock. Real rock does not do that
   because real rock has structure at every scale, so the honest model is a
   detail layer whose scale follows the pixel footprint.
   Snapped to octaves with the bracketing pair crossfaded, so the size of the
   grain is stable within an octave and nothing pops as the camera walks. The map
   has no content below a fourteenth of its own tile, so reading it at whatever
   scale the footprint asks for implies no particular physical size — which is
   the property that makes this legitimate rather than a cheat.
   One fetch carries tone, normal and cavity. */
vec2 gUV = domUV(vWPos + vec3(3.7, 8.1, 12.9), aN);
/* The lock factor was 1.7 — a texel and two thirds per pixel — and that was the
   second half of the wrong-band failure. A map sampled at 1.7 texels per pixel is
   read a whole mip level up: the driver averages away everything at the texel
   scale and returns the coarse populations, so the layer built to carry pixel-
   scale structure arrived carrying eighteen-pixel blobs. Measured in
   tools/wallprobe.mjs, dropping it to 0.9 moves this layer's one-to-four-pixel
   ratio from 0.41 to 0.65 with no change to the map at all. Slightly under a
   texel per pixel is deliberate: it is the sampling rate at which mip level zero
   is actually used, which is the only level with the top octave still in it. */
float gLod = log2(max(foot, 2e-4) * 256.0 * 0.9);
float gFl = floor(gLod), gTw = gLod - gFl;
float gSc = exp2(-gFl);
vec4 grA = texture2D(uGrit, gUV * gSc);
vec4 grB = texture2D(uGrit, gUV * gSc * 0.5);
vec4 gr = mix(grA, grB, gTw);

/* The rock map's pigment is discarded and only its luminance kept. Its bands were
   authored for a wall that had no stratigraphy of its own; here the strata are
   geometry, so letting its colour through would lay a second, contradictory set
   of bands over the first.
   The divisor is the map's *measured* mean linear luminance, passed in from the
   generator rather than written here as a constant, so that this is a unit-mean
   multiplier and not a brightness change. It matters most where mips collapse:
   wherever a two-by-two pixel quad straddles a geometric edge the texture
   derivative explodes, the sample comes back as the map's mean, and a divisor that
   is not that mean turns every edge in the scene into a fixed brightness error.
   The clamp is the backstop for the same reason — the far tail of a generated
   map's histogram is not something to let multiply an albedo unbounded. */
float lumC = dot(rkA, vec3(0.299, 0.587, 0.114));
float lum = mix(1.0, lumC / uRockLum, 0.88)
/* The second, four-times-finer reading of the rock map, weighted up. Isolated in
   the probe it is the highest-frequency thing in the composition — 0.62 at the
   close face against 0.43 for the coarse reading — and it was contributing at a
   sixth. It is also the only term that carries the *lamina* structure at a scale
   where laminae are a few pixels rather than a few tens, which is the band the
   close-up was missing between the grain and the bedding. */
          * mix(1.0, rkA2 / uRockLum, 0.32 + 0.62 * grainF)
/* Same reasoning as the cavity weight below: a shaded face has no direct light
   for a normal to modulate, so on those facets the grain has to come through as
   tone and occlusion or it does not come through at all. This is the tone half. */
          * (1.0 + (gr.r - 0.5) * (1.85 + 0.85 * (1.0 - sTerm)));
lum = clamp(lum, 0.40, 1.80);

/* Behind the rim, whatever bed capped the summit is buried under its own
   weathering products, so the colour is the debris colour and not the bed's. */
vec3 albedo = mix(lCol, vec3(0.296, 0.170, 0.115), back * 0.55) * lum;
/* The map's *chroma deviation*, at low weight. Its pigment is still discarded —
   the strata are geometry and a second set of painted bands over them is the
   failure this map used to cause — but a unit-luminance chroma ratio carries no
   bands, only the difference between a quartz-rich lamina and an iron-cemented
   one and between one grain and the next. Value variation alone makes a
   grey-scale relief rubbing; a rock face's grain has minerals in it. */
albedo *= mix(vec3(1.0), rkA / max(lumC, 1e-4), 0.26);
lPale *= 1.0 - back * 0.85;

/* ---- cross-bedding ----
   Coconino is a fossil dune field, so its laminae are not level: they sweep in
   inclined sets a metre or two thick, truncated flat at the top of each set. It
   is the most recognisable thing about the cap after its colour, and it is what
   stops a pale band reading as a stripe of paint. */
float xbC = y / 2.3 + 0.21 * sin(aS * 0.031);
float xbSet = floor(xbC);
float xbT = xbC - xbSet;
float xbDir = sin(xbSet * 2.7 + 1.1) > 0.0 ? 1.0 : -1.0;
/* Tangential, not straight. A constant dip within the set gives perfectly
   parallel constant-spacing lines running edge to edge, which is brushed veneer,
   and it was the loudest thing left in the close-up. A real dune foreset does not
   meet the floor of its set at an angle: it *asymptotes* into it, steep at the
   crest and flattening to nearly bedding-parallel at the toe, because that is
   where the avalanching sand came to rest. Scaling the dip by the height within
   the set turns every lamina from a line into the concave sweep a photograph of
   the Coconino shows. */
float tang = 0.16 + 0.84 * pow(xbT, 0.62);
float xbPh = (y + aS * (0.42 + 0.12 * sin(aS * 0.06)) * xbDir * tang) * 2.9 + xbSet * 5.1;
float xb = sin(xbPh);
/* The foresets *inside* the set. One sine per set is four fat stripes, and the
   critique's sharpest single observation about the close-up was that a real face
   shows dozens of fine sub-parallel lines per metre sweeping in arcs, with
   nothing at all between them here. Seven times the frequency puts a lamina every
   five centimetres, phase-modulated by the set's own sine so the train curves
   with the foreset instead of crossing it. */
float xbF = sin(xbPh * (6.5 + 1.5 * sin(aS * 0.19 + xbSet * 2.3))
                + 0.55 * sin(xbPh * 1.7));
/* Reactivation surfaces: the truncations *within* a set, where the dune face was
   scoured and rebuilt before the set as a whole was beheaded. Three or so per set,
   wandering along the wall, each shifting the foreset train's phase across it so
   the laminae above do not line up with the laminae below. Without these the
   sub-parallel lines run uninterrupted from one edge of the face to the other,
   which no cross-bed set does. */
float xbR = xbT * 3.0 + 0.34 * sin(aS * 0.17 + xbSet * 1.9);
float xbRs = floor(xbR);
xbF = mix(xbF, sin(xbPh * 6.5 + xbRs * 2.1), 0.55);
float xbRw = max(0.020, fwidth(xbR) * 1.8);
float xbRcut = (1.0 - smoothstep(0.0, xbRw, min(xbR - xbRs, 1.0 - (xbR - xbRs))));
/* The truncation surface at the top of each set: the flat erosional cut that
   beheaded the dune before the next one buried it. It is a *shadow line*, which
   is what makes a cross-bed set read as a set rather than as diagonal shading.
   The width is taken from fwidth of the *unwrapped* coordinate — fwidth of a
   fract explodes at the wrap and puts a one-pixel line down the whole wall, which
   is the same class of bug as the dotted rules. */
float xbW = max(0.012, fwidth(xbC) * 1.6);
float xbCut = 1.0 - smoothstep(0.0, xbW, min(xbT, 1.0 - xbT));
float xbVis = lVert * (0.30 + 0.70 * lPale);
albedo *= 1.0 + xb * 0.075 * xbVis * (1.0 - smoothstep(0.16, 0.55, foot));
albedo *= 1.0 + xbF * 0.055 * xbVis * (1.0 - smoothstep(0.04, 0.20, foot));
albedo *= 1.0 - xbCut * 0.16 * xbVis;
albedo *= 1.0 - xbRcut * 0.055 * xbVis;

/* ---- iron-oxide lenses ----
   This is where the saturated end of the distribution comes from, and the reason
   it has to be lenses rather than a stronger base colour. Hematite cement is not
   spread evenly through a sandstone; it concentrates along former groundwater
   fronts, in lenses metres across that follow bedding. Those lenses are the parts
   of a Sedona cliff that go genuinely vivid in the last light — a mean pushed up
   instead just makes an orange membrane over everything, which is the failure
   this scene has already had twice. Narrow threshold, strong effect.
   The threshold is the whole control and the first setting had it far too low:
   the driving sum averages about 0.61, so a smoothstep starting at 0.54 was
   putting iron on roughly two thirds of the wall. Measured, that came out at 0.77
   mean saturation against a target band of 0.42 to 0.65 — the vivid *tail* was
   right and the vivid *mean* was the old orange-membrane failure wearing a new
   coat. Started well above    the mean of the driver instead, so a lens is a lens.
   Sampled along bedding rather than in plan, and anisotropically: a groundwater
   front follows the beds, so a lens is two or three times wider than it is tall.
   Sampled in plan it came out as roughly circular blotches of vivid red, which on
   a cliff face read as paint rather than as cement. */
vec4 mac = texture2D(uMacro, vec2(aS * 0.0195 + 0.31, y * 0.052));
vec4 vr  = texture2D(uVar, vec2(aS * 0.037, y * 0.055));

/* Cells about nine and a half metres along the wall, shared with the varnish
   below. Both features need the same thing from them — a run of cliff face that
   is either doing something or not — and one floor and four hashes is cheaper
   than a texture fetch. */
/* Warped before flooring, so the cells are unequal. Slope of the warp is
   1.5 * 3.2 * 0.052 + 1.5 * 1.2 * 0.170 = 0.56, comfortably under 1, so the
   coordinate stays monotone and no cell inverts; cell widths come out between
   about 0.64 and 2.3 times nominal. The ceiling on that stretch is what sets
   these amplitudes rather than the wish for irregularity: a plate's width is a
   fraction of *its cell*, so a stretched cell is a wider plate in world units,
   and the first pass at 0.67 slope put 3x cells on the far cliff in bend whose
   plates came out seven metres wide and read as rounded rectangles again for a
   new reason. The iron lenses read these cells too and
   their spacing was measured over four rounds, but what was measured was the
   *distribution* of lens size and saturation, and an unequal cell broadens that
   distribution rather than shifting it. */
float aSw = aS + 3.2 * vwob(aS * 0.052, 811.0) + 1.2 * vwob(aS * 0.170, 857.0);
float vs = aSw * 0.105;
float vi = floor(vs), vt = vs - vi;
float vh1 = hash11(vi), vh2 = hash11(vi + 37.0);
float vh3 = hash11(vi + 71.0), vh4 = hash11(vi + 113.0);

/* The along-strike break-up. Without it the driver varies only over the macro
   map's fifty-metre period and the bed's own resistance, so a lens that opens at
   all opens along the whole visible run of its bed: a ribbon of vivid red thirty
   metres long and one bed tall, with the constant width and the constant hue that
   makes it read as tape rather than as cement. Groundwater fronts are not that
   tidy; adding a term that decorrelates every nine and a half metres cuts the
   ribbons into lenses without touching their peak saturation, which is the part
   the measured tail depends on. */
float ironC = hash11(vi + 211.0) + 0.55 * hash11(vi + 251.0);
/* A lens sits *inside* a bed. Letting the driver run flat across the whole bed
   thickness filled every bed it opened in from contact to contact, and a band of
   one colour with a hard edge exactly on a bedding plane at both its top and its
   bottom is the definition of a painted stripe — the front stops where the
   permeability changes, which is somewhere in the bed, not at its boundary. */
float ironPh = (sbT + 0.31 * hash11(vi + 293.0)) * 6.28318;
float ironV = 0.55 + 0.45 * sin(ironPh);
/* Which way the lens is closing, analytically. A hematite-cemented lamina is
   *better cemented than the rock around it*, so it stands proud: there is a hard
   shadow line under its lower contact and a lit arris along its top. A critic's
   sharpest observation about these bands was that their edge should be a shadow
   line first and a colour change second — a real cemented layer never merely
   fades — and this is that edge, got from the derivative of the profile that
   already places the lens rather than from a second feature that could drift
   away from it. */
float ironSlope = cos(ironPh);
float ironF = smoothstep(0.78, 1.14, mac.r * 0.62 + vr.g * 0.52
                                   + (sbR - 0.5) * 0.30
                                   + (ironC - 0.775) * 0.52
                                   + (ironV - 0.55) * 0.30) * lIron;
/* And it has to *inhabit the grain*. A colour band on a surface with no material
   in it is a painted stripe by construction, which is why this defect and the
   missing surface were one defect: hematite cement fills the pore space between
   grains, so its strength varies grain to grain and it is absent where a grain
   has weathered out. Modulating the lens by the grit layer's own tone breaks the
   ribbon into cement without touching its peak saturation, which is what the
   measured tail depends on. */
ironF *= 0.45 + 1.10 * gr.r;
/* Hematite is one mineral but its cement is not one colour: the concentration
   varies front to front, and a front rich enough to be nearly maroon sits beside
   one that is orange-red. Holding it at a single value is the other half of why
   the lenses read as tape, and varying it per cell costs nothing and takes
   nothing off the saturated tail — every one of these is above 0.88 in HSV
   saturation, which is what the measured p99 depends on. */
vec3 ironCol = mix(uIron, mix(vec3(0.400, 0.052, 0.046), vec3(0.470, 0.108, 0.022),
                             hash11(vi + 331.0)), 0.70 * hash11(vi + 367.0));
/* Fresh spall faces are unweathered rock: no varnish film, no dust, and the
   pigment at full strength. A cliff with no fresh faces is a cliff nothing has
   fallen off, which is not a cliff. */
/* Ceiling down from 0.88 to 0.60. The *concept* of these bands was accepted — a
   shadow line at the lower contact and a lit arris at the top, which is how a
   cemented lamina actually presents — but the coverage was never revisited, and at
   88% of a saturated hematite red the lens stops being cement in the pore space
   and becomes a coat of paint over the top of it. On a face the sun has left, where
   the surrounding rock falls to a tenth of its lit value and the lens does not, the
   result reads as a plaid of bright red ribbons. Saturation has headroom to give
   here: it was measured at the top of the real range, so taking coverage off the
   lenses costs a little of a surplus and buys back the banded read. */
albedo = mix(albedo, ironCol * lum, clamp(ironF * 0.60 + fresh * 0.26 * lIron, 0.0, 0.92));
float ironBase = ironF * smoothstep(0.25, 0.92, ironSlope);
float ironTop  = ironF * smoothstep(0.25, 0.92, -ironSlope);
albedo *= 1.0 - ironBase * 0.26;
albedo *= 1.0 + ironTop * 0.13 * sTerm;

/* A resistant bed is better cemented, so it is a little paler and a little
   smoother, and the soft bed under it is recessed and holds shadow. */
/* 0.16 down to 0.10. A sub-bed's tone step is real but it is the wrong end of the
   spectrum to spend contrast on: it is a broad horizontal band, so every unit of
   it lands squarely in the low-frequency term the ratio divides by, and it is also
   the thing that makes a face read as brushed veneer — dozens of parallel constant
   tone stripes running edge to edge. What should carry a bed at any distance is the
   shadow line under its lip, which is geometry and is untouched here. */
float sbTone = (sbR - 0.5) * 0.10;
albedo *= 1.0 + sbTone;

/* ---- vertical jointing, below the scale the mesh can cut ----
   Tensional fracture perpendicular to bedding is what carves a Sedona cliff into
   buttresses, and the eye reads "rock" from those verticals at least as much as
   from the bedding. The mesh cuts the metre-scale sets — see jointOffset — but it
   cannot cut the decimetre end, where a joint is a hairline one or two pixels
   wide, and a wall that is horizontally striped and vertically featureless is
   the single largest thing a critic sees.
   Driven off the same world azimuths the geometry uses, so a trace crosses the
   wall at the same changing obliquity as the fins it belongs to and the two read
   as one fracture system rather than as a wall with lines drawn on it.
   Everything here is *tone*, never a bump. A crack is a groove that holds shadow
   with an arris beside it that catches the low sun, and both of those are
   luminance; putting a step through dFdx is what produced the dotted rules this
   file has already had to remove twice. The half-width is held to at least a
   pixel and a half of world footprint, which is the only filter a line needs.
   Joints do not run the full height of a section: they terminate at bedding
   contacts, which is what makes them look like fracture rather than like wire. */
float jw = max(foot * 1.6, 0.022);
/* Every joint plane in this system is vertical and every trace is driven off
   plan coordinates alone, so on a vertical wall the sample point does not change
   with height and each trace paints a dead-straight line the full height of the
   section. Four of those at fixed spacings is a ruled sheet, which is the other
   half of why the far wall read as a lattice rather than as fracture. Displacing
   the sample laterally by a low-frequency function of elevation costs two trig
   calls and makes a trace wander half a metre over twenty of height — a joint
   face is not a plane, it steps and curves as it climbs — and because the
   displacement is shared, all four sets wander together as one rock mass rather
   than sliding against each other. */
vec2 jp = vWPos.xz + vec2(sin(y * 0.37 + 1.3), cos(y * 0.29 + 2.1)) * 0.55;

/* ---- the joint block, and why the bedding needs to know about it ----
   The final critique's first and most valuable finding was that the walls carry
   "perfectly parallel horizontal lines running continuously across the entire
   face with no vertical joint sets, no blocky spall, no cross-fracture", and read
   as sliced plywood. Every surface instrument this project owns is isotropic and
   scored the wall fine, so tools/_aniso.mjs was written to split the gradient by
   direction and to isolate *coherent line* energy from grain. It found two
   things. First, that the vertical/horizontal line ratio at the lit midwall is
   0.79, so the imbalance is real but mild. Second, and this is the number that
   matters: ablating the entire vertical joint system through uJointK moves that
   ratio from 0.77 to 0.75. Four joint sets, four fetches, and the whole system
   contributes three per cent of the wall's structure. The joints were not too
   weak or lost to distance — jointRes passes all four sets at full strength at
   this footprint — they were being switched off by the termination gate for most
   of the wall, in horizontal bands.

   Fixing the gate makes the verticals legible. It does not by itself fix
   "continuously across the entire face", because that is a statement about the
   *horizontal* lines: a bed contact here runs the full length of the wash at
   constant strength, and no real cliff does that. A joint is a free face, so the
   slab on either side of it weathers back independently — one block keeps a sharp
   lip at a contact, its neighbour has retreated and rounded the same contact off,
   and the bed trace steps or dies at every joint it crosses. That differential is
   what turns a striped sheet into stacked masonry-sized blocks, and it is also
   what makes the joints themselves read, because a fracture is legible from the
   disagreement across it more than from its own dark line.

   So: a piecewise-constant index per fracture-bounded block, off the two coarse
   joint azimuths and the same wandering plan coordinate the traces use, so blocks
   and traces are the same fracture system rather than two that nearly agree. The
   bedding terms below are then scaled by it. Cost is two dots and two floors, no
   fetch, on a frame that is fill-bound on texture reads. */
float blk1 = floor(dot(jp, vec2(0.9397, 0.3420)) / 4.10);
float blk2 = floor(dot(jp, vec2(-0.2588, 0.9659)) / 2.35);
float blkH = hash11(blk1 * 37.0 + blk2 * 101.0);
/* How far this block has weathered back relative to its neighbours, signed.
   Biased so most blocks sit near the middle and a minority stand well proud or
   well recessed — a cliff is not a checkerboard of alternating slabs, it is a
   mostly-even face with occasional blocks that have gone. */
float blkR = (blkH - 0.5) * 2.0;
blkR = blkR * abs(blkR);
/* Joints terminate at bedding contacts; the previous form ranged 0.10 to 1.0 and
   so never terminated at all, it only got fainter. Two incommensurate periods
   through a smoothstep with a real zero gives runs of wall with no joint in them,
   which is what makes the remainder read as fracture rather than as ruling.
   Both periods were functions of y with only a very slow along-wall term —
   aS * 0.07 turns over once in ninety metres — so at any given height the gate
   held the same value across the whole of a twenty-to-forty metre hero framing.
   That did two things at once, and they are the two halves of the final
   critique's first finding: it cut every vertical into dashes about a metre and a
   half tall, too short to read as a fracture at all, and because the dashes
   started and stopped at the same height everywhere it laid *another horizontal
   band* over a wall already accused of being nothing but horizontal bands. A
   termination has to vary along strike or it is not a termination, it is a
   course of brickwork. Phase now comes off the block index below, so the joint
   on this slab dies at a different height from the joint on the next, and the
   vertical period is long enough that what survives spans several beds. */
float jvA = 0.5 + 0.5 * sin(y * 0.62 + blkH * 9.4);
float jvB = 0.5 + 0.5 * sin(y * 0.27 + blkH * 4.1 + 2.2);
float jVert = smoothstep(0.16, 0.55, jvA * 0.65 + jvB * 0.35);
vec2 jt2 = jointTrace(jp, vec2(0.9397, 0.3420), 4.10, 3.0, jw * 2.4, 0.55) * (1.00 * jointRes(4.10, foot))
         + jointTrace(jp, vec2(0.9397, 0.3420), 1.35, 7.0, jw * 1.2, 0.60) * (0.80 * jointRes(1.35, foot))
         + jointTrace(jp, vec2(-0.2588, 0.9659), 2.35, 17.0, jw, 0.66) * (0.75 * jointRes(2.35, foot))
         + jointTrace(jp, vec2(0.6428, -0.7660), 0.52, 41.0, jw * 0.8, 0.76) * (0.50 * jointRes(0.52, foot));
jt2 *= uJointK;
float jt = jt2.x;
/* Only on faces steep enough to be a face. A bench top is a rubble tread, and a
   crack drawn across one reads as a scratch on a floor. */
float jFace = smoothstep(0.62, 0.24, abs(gN.y)) * (1.0 - back);
float joint = clamp(jt, 0.0, 1.0) * jFace * jVert * (0.55 + 0.45 * (1.0 - lPale * 0.5));
/* The bevel beside the groove: the arris between two joint blocks is
   case-hardened and retreats to a rounded shoulder, so at eight degrees of solar
   elevation it is the brightest line on the wall. It comes out of jointTrace with
   a guaranteed two-pixel width, which is the whole difference between a line and
   the row of dots this was in the last round. */
float jLip = clamp(jt2.y, 0.0, 1.0) * jFace * jVert;
albedo *= 1.0 - joint * 0.46;
albedo *= 1.0 + jLip * 0.13 * sTerm;
/* The block itself, which is the "no blocky spall" half of the same finding. A
   block that has spalled out sits back from the face, so it is shaded by its own
   surround and holds more of the varnish that runs over it; one that still stands
   proud catches the low sun across its whole width. Applied on faces only and
   scaled by the joints' own visibility, so a block edge never appears where there
   is no fracture to bound it.
   Deliberately a single scalar on all three channels: HSV saturation and hue are
   invariant under a positive scalar, so this cannot move the measured colour that
   System 7 is holding at 0.618 and 20.9 degrees. Kept to nine per cent, which is
   about a stop and a half less than the bedding contrast it sits beside — a block
   read wants to be at the threshold of noticing, and the failure mode on the other
   side of it is a chequerboard.
   One-sided upward for the same reason bedBlk above is one-sided: the two-sided
   form was part of a 0.012 saturation excursion on lit rock and of a worsened
   crush on shaded rock. A block that still stands proud catching the low sun is
   the half of the read that has to be an addition anyway; the recessed half is
   already carried by its bed traces going quiet. */
albedo *= 1.0 + max(blkR, 0.0) * 0.11 * jFace * jVert;
/* ---- and the joint is an aperture, not a scribed line ----
   Darkening the albedo along a crack gives a dark pen line of constant width on a
   flat face, which is what these were. A joint is an *opening*: it has width, it
   has depth, its walls occlude each other so the inside is dark independent of
   which way the sun is, water runs down it so manganese concentrates in it and
   the pigment is darkest at the mouth, and it interrupts whatever bedding trace it
   crosses because the two blocks either side of it have weathered back by
   different amounts. Occlusion is what makes the first of those read; the varnish
   concentration is what makes it read as mineral rather than as ink. */
float jOpen = clamp(jt, 0.0, 1.0) * jFace;

/* ---- desert varnish ----
   Manganese and iron oxides washed out of the rock above and plated onto the face
   below every point where water sheds over a lip. Near-black, faintly cool, and
   *vertical* — it is the one thing on a desert cliff that runs down rather than
   along, and its absence is part of why the walls read as one material. Strongest
   just under the lip of the bed that sheds it, tapering downward, and only on
   faces steep enough for water to run rather than soak.
   The first version of this sampled the variance map at 0.62 and 1.95 cycles per
   metre of along-wall distance with almost no vertical variation, which put a
   streak every metre and a half down the entire length of both walls at full
   height. Compounded with the geometry aliasing it produced the barcode the first
   render came back as. Varnish is not a texture, it is a *few plates*: a handful
   per hundred metres of cliff, each hanging from one notch in the lip above it,
   one to three metres wide, tapering out downward over three to eight metres, and
   broken vertically because the water that plated it did not run evenly. One tap
   carries all of that — the B channel of the variance map is already a
   thresholded sparse mask, which is exactly the right shape for where a plate is,
   and the other channels vary its width, its taper rate and its break-up.
   Both texture-driven versions failed the same way and it is worth saying why,
   because it is not obvious. Reading a plate mask out of a tiling map means
   reading it at essentially constant v — a plate is eighty metres tall and the map
   is a few metres wide — so what comes back is a one-dimensional slice of the
   map, thresholded. A thresholded 1-D slice held constant down forty metres of
   cliff is a rectangle with hard vertical sides, and dark neutral rectangles on
   red under a lilac sky fill read as blue-grey panels stuck to the wall.
   No texture can fix that, because the problem is the *shape*, so the streaks are
   built directly: cells about nine and a half metres along the wall, a third of
   them carrying a plate, each plate a fraction of its cell wide with its edges
   feathered over a third of its own width, hanging from a notch one to three
   metres below the lip of the bed that sheds it and decaying downward over five to
   twelve. Nothing is thresholded and nothing has a straight edge. It also costs no
   texture fetch at all, which on this rasteriser pays for itself. */
/* Tapered and wandering, not a band of constant width running straight down.
   A plate of constant lateral width, held over the five to twelve metres this
   decays across, *is* a soft-edged rounded rectangle — that is what the critic
   is describing, and it is a property of the profile rather than of the
   distribution. A real tongue is widest at the notch that feeds it and narrows
   downward as the sheet-flow spreads and thins, and it drifts across the face
   rather than falling plumb, because it follows the face's own drainage. Both
   are one multiply and one add on a coordinate that is already here. */
float vSrc = lTop - 0.9 - 2.2 * vh4 - vLip(hash11(vi + 149.0), lTop, lBot, lBedT);
float vDn = max(0.0, vSrc - y);
float vW = 0.055 + 0.20 * vh2;
float vWt = vW * (1.0 - 0.72 * smoothstep(0.0, 7.0, vDn));
float vC = vW + (1.0 - 2.0 * vW) * vh3
         + 0.085 * vwob(y * 0.085 + vi * 3.7, 883.0);
float vLat = 1.0 - smoothstep(vWt * 0.30, vWt, abs(vt - vC));
float vHang = smoothstep(vSrc + 0.7, vSrc - 0.8, y)
            * exp2(-vDn * (0.085 + 0.115 * vh2));

/* A second, finer set of tongues, and this is the one that makes varnish
   legible at all.
   Substituting subsets of the product into the frame (tools/_varn.mjs) put the
   fault here rather than in either lithological gate: the mix reaches the frame
   at full strength, but one plate per 9.5 m cell in half the cells is a single
   tongue every nineteen metres, one to five metres wide. Over the twenty to
   forty metres of wall a hero framing actually contains that is one or two
   tongues in the whole frame — which is indistinguishable from none, and is why
   the critique reports seeing no varnish on a wall that has been growing it all
   along. Density was the missing quantity, not strength.
   Its own cells at 3.3 m rather than a shorter period for the existing ones,
   because vi is shared with the iron lenses and their spacing is load-bearing
   for a saturation distribution that took four rounds to measure. Two thirds of
   these carry a plate, so the combined spacing is a tongue about every five
   metres at widths from 0.8 to 3.2 m — dense enough to read as streaking, and
   still nothing like a coat. Taken as a maximum with the coarse set rather than
   a sum: tongues overlap on a real wall, they do not add up to black. */
/* Its own warp, at its own frequencies and phases, because warping both sets
   with one field would slide them together and leave their beat intact — the
   combined spacing is the thing being fixed, not either set's. Slope is
   1.5 * 2.8 * 0.061 + 1.5 * 1.0 * 0.195 = 0.55, so this one is monotone too. */
float aSw2 = aS + 2.8 * vwob(aS * 0.061, 907.0) + 1.0 * vwob(aS * 0.195, 941.0);
float vs2 = aSw2 * 0.30;
float vi2 = floor(vs2), vt2 = vs2 - vi2;
float vg1 = hash11(vi2 + 401.0), vg2 = hash11(vi2 + 437.0), vg3 = hash11(vi2 + 479.0);
float vSrc2 = lTop - 0.6 - 2.6 * vg2 - vLip(hash11(vi2 + 191.0), lTop, lBot, lBedT);
float vDn2 = max(0.0, vSrc2 - y);
float vW2 = 0.12 + 0.34 * vg2;
float vWt2 = vW2 * (1.0 - 0.68 * smoothstep(0.0, 5.5, vDn2));
float vC2 = vW2 + (1.0 - 2.0 * vW2) * vg3
          + 0.15 * vwob(y * 0.110 + vi2 * 2.9, 977.0);
float vLat2 = 1.0 - smoothstep(vWt2 * 0.30, vWt2, abs(vt2 - vC2));
float vHang2 = smoothstep(vSrc2 + 0.7, vSrc2 - 0.8, y)
             * exp2(-vDn2 * (0.070 + 0.100 * vg3));
float vPlate = max(step(0.48, vh1) * vLat * vHang,
                   step(0.32, vg1) * vLat2 * vHang2 * 0.85);
/* Strengthened, and there are more plates. Varnish is the strongest single
   Colorado-Plateau cue there is and it was measurably almost absent: at a third
   of the cells carrying a plate and a ceiling of 0.60 the tongues were legible
   only where two happened to overlap. Half the cells now carry one and they
   reach 0.78, which is what a real manganese tongue does to a face — and because
   a tongue is dark and *vertical* on a wall whose every other feature is
   horizontal, it is also the cheapest thing in this shader that breaks the
   striped read the critique complained of.
   Broken along its own length by the grit layer, so a plate has grain in it
   rather than being a flat wash of dark. */
/* Two of the gates were lithological and varnish is not.
   The critique reports seeing no varnish at all on the lit wall, and the reason
   is that both of the terms that scale it were asking what the *rock* is rather
   than what the face is doing. lVert restricted tongues to the cliff-forming
   layers, and lPale cut them by seventy percent exactly where the wall is
   buff — but a manganese tongue is a coating deposited by water running off a
   shedding lip, and it neither knows nor cares which bed it is running over.
   On a real Colorado Plateau wall the tongues are *most* conspicuous on the pale
   rock, because that is where the contrast is; suppressing them there is
   backwards, and it removed them from precisely the facets the hero framings
   put in the sun. Recessive layers keep a reduced share rather than none, since
   a slope does shed a tongue less cleanly than a cliff does. The vertical-face
   gate stays: that one is about the face, which is the right question. */
float varn = clamp(vPlate * mix(0.45, 1.0, lVert)
           * (1.0 - lPale * 0.35)
           * smoothstep(0.50, 0.14, abs(gN.y)) * (1.0 - fresh)
           * (0.60 + 0.60 * vr.g) * (0.72 + 0.56 * gr.r) * 1.55, 0.0, 0.78);

/* ---- talus varnish, which is the other half of the same mineral ----
   On a cliff, varnish hangs in vertical tongues from a shedding lip, so the gate
   above is a *vertical*-face gate. On a fallen block none of that applies and the
   gate is exactly backwards: a slab that has lain on an apron for centuries
   varnishes on the face pointing at the sky, because that is the face that gets
   the dew and the airborne clay, and the undersides stay the colour of fresh
   rock. Suppressing it there is part of why the apron read as a different
   material from the wall it fell off. uDetail tells the two apart for free — the
   walls sample at 1.0 and the apron at 1.6 — so no new uniform. */
float isTal = step(1.3, uDetail);
float tVarn = isTal * smoothstep(0.30, 0.85, gN.y) * (1.0 - lPale * 0.70)
            * (0.45 + 0.55 * vr.b) * (0.70 + 0.60 * gr.r) * 0.62;
varn = max(varn, clamp(tVarn, 0.0, 0.72));
/* Ablatable, for the same reason and by the same rule as uJointK and uWarpK, and
   declared here rather than injected by a tool because uVarnDbg being injected
   undeclared cost this project a four-view capture at 2560x1440 this morning.
   The ship critic's second finding is a lattice of soft dark rounded rectangles
   in rows along the bedding, and varnish is the strongest candidate by
   construction: vs2 = aS * 0.30 is a fixed 3.33 m cell and vSrc = lTop - 0.9
   - 2.2 * vh4 hangs every tongue from its own bed's lip, which is a regular
   spacing and a shared row origin - exactly the two properties the complaint
   describes. That is a hypothesis about a specific term and it should be
   falsified in one page load rather than argued about, since two captures are
   not a pair. Left at 1.0 by everything except the probe. */
varn *= uVarnK;
/* Manganese concentrated in the joints, per the aperture note above. */
/* Pulled back hard from 0.46. Manganese does concentrate in a joint, but at 0.46
   on top of the groove's own 46% albedo darkening and a doubled occlusion weight,
   every joint in the wall became a wide dark tongue and the face acquired a set of
   vertical black streaks to go with its horizontal ones. Three treatments of the
   same feature compound, which is easy to forget when they are written in three
   different places. */
varn = max(varn, clamp(jOpen * 0.18 * (1.0 - lPale * 0.55) * (0.6 + 0.6 * vr.g),
                       0.0, 0.34));
albedo = mix(albedo, uVarnish * (0.62 + 0.38 * lum), varn);

/* ---- dust and weathered fines on the up-facing surfaces ----
   Every ledge, bench top and joint-block shelf in a desert collects the same pale
   silt the wash floor is made of, and that is most of what makes a stair-stepped
   cliff read as stepped: the treads are a different material from the risers. */
/* The lower threshold has to sit above the bedding risers' own tilt. A riser
   thirty degrees off vertical has an up-component of 0.5, and letting silt
   collect on it painted every bed contact in pale dust — the same one-pixel
   bright line by another route. A bench at the angle of repose is 0.84, so
   there is plenty of room between the two. */
/* And two thirds less of it on the apron. A bench is a horizontal tread that
   catches silt and keeps it; a talus block is a tilted facet on a slope that
   sheds, so what pale fines it holds are a film in its hollows, not a coat. Pale
   dirt laid over half a block is most of why the apron measured grey. */
float dustW = smoothstep(0.58, 0.92, gN.y)
            * (0.40 + 0.45 * smoothstep(0.35, 0.75, mac.g)) * (1.0 - lVert * 0.35)
            * (1.0 - fresh * 0.85) * (1.0 - isTal * 0.68);
if (dustW > 0.01) {
  vec3 dust = texture2D(uDirtA, domUV(vWPos, aN) * 0.30).rgb;
  albedo = mix(albedo, dust * 1.05, dustW * 0.62);
}

/* ---- macro tonal variation, kept in chroma ----
   Value variance at macro scale reads as depth, not as material, and has been
   mistaken for a rendering fault twice in this project. Chroma variance does not:
   average an iron-rich panel with a leached one and you get a duller red, which
   is the right answer. */
albedo *= 0.93 + 0.14 * mac.b;
/* The leached-iron patches are held off the pale beds. Coconino and the Fort
   Apache limestone have little iron to leach, and a cool cast laid over an
   already-desaturated cream band is what turned the caprock blue-white in the
   first render — which reads as ice, not as sandstone. */
/* Warm, not cool, and this was measurably the wrong way round. Leached iron
   leaves buff and cream, not blue-grey: what the oxide was staining is quartz
   sand, and quartz sand with the oxide gone is the colour of sand. Multiplying a
   red albedo by (0.92, 0.97, 1.08) raises blue eleven percent relative to green,
   and blue at or above green is precisely the measured hue defect — real Sedona
   rock runs a blue-to-green ratio of 0.32 to 0.90 and this render was running
   0.87 to 1.21, which is the difference between orange and magenta. A leached
   patch should desaturate toward warm grey and lose a little of both. */
albedo = mix(albedo, albedo * vec3(1.03, 1.00, 0.93),
             smoothstep(0.62, 0.88, vr.r) * 0.34 * (1.0 - lPale * 0.85));
albedo = mix(albedo, albedo * vec3(1.10, 0.97, 0.88), smoothstep(0.58, 0.86, mac.a) * 0.30);

diffuseColor.rgb *= albedo;

/* ---- relief ----
   Each term filtered against its own feature size. Nothing here is allowed to
   contribute a normal once a pixel covers several of the features it describes,
   because lighting is non-linear in the normal and the average of the lit facets
   is not the lighting of the average facet — which is the mechanism behind every
   scintillating rock face in a real-time renderer.
   ---- the terminator, and the dotted rules it was really making ----
   The bright dashes along every bench lip and every talus edge were measured, not
   guessed at, and they were neither aliased geometry nor a shadow map: sampled,
   the dark band came back at 31/8/5 and the dots inside it at 220/151/115 — which
   is the *sunlit* wall's own value, pixel-exact. So isolated pixels inside a
   surface facing away from the sun were receiving full direct light, and the only
   thing in the shader that can do that is this line.
   With the sun eight degrees up, a vertical cliff face receives cos 82 = 0.14 of
   the sun's normal irradiance. A facet a few degrees *past* the terminator
   receives none. Perturb both by a normal map with thirty degrees of slope in it
   and the second one does not merely brighten, it overshoots the first: sin 25 is
   0.42, three times the lit face's 0.14. So every surface within a few degrees of
   the terminator dissolves into single pixels at three times the brightness of
   anything around them, and a bedding riser is a band of exactly such a surface
   running the length of the wall. It is the low sun that makes it this violent —
   at forty degrees the same map is a texture, at eight it is a switch.
   The fix is what the map is a model of. Those millimetres of relief occlude each
   other, and at grazing incidence they occlude each other completely; a real
   sandstone face does not sparkle as the terminator crosses it, it goes out. So
   the perturbation is faded down as the *geometric* normal approaches the
   terminator and is nearly gone past it, which is micro-shadowing written as the
   only term this shader has to write it in. The grain is still fully present
   wherever there is enough light for it to matter. */
/* The two readings are combined by *adding the finer one's deviation* to the
   coarser rather than averaging the two normals. Averaging halves both, and
   halving the coarse reading is most of why the wall had no relief in it: the
   6.45 m reading is the one that carries the pits and the laminae, and it is
   present at every distance this scene ever looks at a cliff from, whereas the
   1.61 m reading is inside the mips beyond a few metres and should fade out on
   its own rather than dragging the other down with it. */
/* The terminator floor is 0.32, not 0.05, and that change is most of why the
   weathering pits now read as holes. The fade exists for a good reason — a
   millimetre of relief at grazing incidence occludes itself rather than
   sparkling, and taking it out is how this shader produced dotted rules twice.
   But a floor of 0.05 does not fade a feature, it deletes it, and it deleted the
   *decimetre* features along with the millimetre ones. A tafoni hollow is a
   twenty-centimetre cavity: it has an occluded interior, a shadowed upper lip and
   a lit lower lip whose polarity flips as the sun moves, and every one of those
   is a consequence of its normal. With the normal gone all that survived the
   frame was the pit's pigment, which is a flat dark spot facing nowhere. */
float relW = (0.55 + 0.45 * grainF) * (0.32 + 0.68 * sTerm);
vec3 nDet = normalize(rkN + (rkN2 - gN) * (0.30 + 0.70 * grainF));
vec3 wN = normalize(mix(gN, nDet, relW));
/* And the grit's own normal, which unlike the two above is present at every
   distance because its scale follows the footprint. Faded on the terminator for
   the reason set out below — these are millimetres of relief and at grazing
   incidence they occlude each other completely rather than sparkling. */
vec3 gNrm = domApply((gr.gb - 0.5) * 1.9, gN);
wN = normalize(mix(wN, gNrm, 0.93 * (0.06 + 0.94 * sTerm)));
/* Only the soft contacts, which the mesh deliberately did not step, and only as a
   profile whose derivative is bounded. Everything hard is geometry now: a step
   function put through dFdx is a one-pixel black line beside a one-pixel white
   one, and the piecewise-constant bed tone was doing the same thing at every
   contact, so neither goes anywhere near a bump any more. A raised cosine over
   the bed swells its middle and hollows its contacts, which is how a poorly
   cemented bed weathers, and its gradient never exceeds two pi over the bed
   thickness.
   The window has to *vanish* at the contacts, not peak there, and getting that
   wrong is what left the artefact in place after the step itself was removed:
   cos(2 pi t) is continuous across the bed boundary, but the per-bed amplitude
   multiplying it is piecewise constant, so their product still jumped by the
   whole amplitude at every contact and dFdx still saw a cliff. A raised cosine
   that is zero at t = 0 multiplies that jump by nothing. */
float soft = 1.0 - smoothstep(0.50, 0.66, sbR);
wN = bumpFrom((1.0 - cos(sbT * 6.28318)) * 0.5 * soft * 0.75, wN,
              0.10 * bedF * (0.20 + 0.80 * sTerm));
tNrmW = wN;

/* Varnish is a mineral film and genuinely a little glossier than the sand grain
   around it, which at this sun angle shows as a faint sheen down the streaks —
   one of the few specular cues a dry cliff legitimately has. */
tRough = clamp(lRough * (0.94 + (sbR - 0.5) * 0.10) * mix(1.0, 0.80, varn)
             * (1.0 - 0.10 * ironF), 0.62, 1.0);

/* Cavity from the mesh, the map's own pits, and the undercut below every ledge.
   The undercut is the important one: a bed that stands proud of the one beneath it
   has a band of deep shade under its lip, and that band is what a stair-stepped
   cliff actually looks like from a distance. */
float ledgeShade = (1.0 - smoothstep(0.0, 1.6, y - lBot)) * (1.0 - lVert) * 0.55;
/* And the same thing one order of magnitude down: the shade under a resistant
   sub-bed's lip. The mesh already cuts that riser, but as tone it also survives
   past the distance where the riser is smaller than a pixel, and as tone it is
   filtered — a smooth ramp over the top sixth of a bed has a bounded derivative
   at every distance, which is the whole reason this is here rather than in the
   geometry a second time. */
float sbUp = bedResist(sbI + 1.0, lIdx);
float sbLip = smoothstep(0.80, 1.0, sbT) * smoothstep(0.54, 0.74, sbUp);
/* The bed trace, cut by the joint blocks. A contact is a sharp shaded lip on a
   block that still stands at the face and a rounded, half-buried nothing on the
   block beside it that has retreated a hand's width, so the trace steps in
   strength at every joint it crosses instead of ruling the whole wall at one
   value. This is the term that answers "continuously across the entire face":
   the lines are still there and still level — bedding *is* level, and faking a
   wobble into it is a failure this file has already made once — but they are no
   longer the same line for four hundred metres. Ranges 0.35 to 1.55 of the old
   strength, so the strongest traces are stronger than before and a minority of
   blocks lose theirs altogether.
   One-sided, and that is a correction rather than a preference. The first form
   ranged to 1.55 and so *deepened* the bed shading on half the blocks, which cost
   0.012 of lit saturation — 0.618 out to 0.630, outside a defended band — and
   took wall_shade's min-channel-under-20 share from 66.2 to 68.4 per cent, making
   the very crush the occlusion fix above exists to relieve slightly worse. The
   same discipline System 1 applied to the multi-bounce curve applies here: a term
   added for structure should not be able to darken anything, because then its
   effect on the measured population is a calibration rather than an identity.
   Capped at 1.0, it can only lighten a bed trace, so continuity is still broken —
   a trace that dies on one slab and survives on the next is exactly as legible as
   one that deepens — and no pixel anywhere goes down. */
float bedBlk = clamp(1.0 + blkR * 0.62, 0.35, 1.0);
tAO = clamp(rkAO * (0.72 + 0.34 * (1.0 - cav)) - ledgeShade * 0.5 * bedBlk
            - sbLip * 0.30 * bedBlk
            - joint * 0.42 - ironBase * 0.22, 0.18, 1.0);
/* The grit's crevice occlusion, unfiltered by distance: it is a tone, it is
   scale-locked to the footprint, and it is what keeps the material present at
   the range where every normal in the shader has already faded out. */
/* Weighted up on faces the sun has left, and this is not a fudge — it is the same
   physics the terminator fade is. Grain is visible on a *lit* surface because each
   grain shadows its neighbour, which is a statement about the normal; it is
   visible on a *shaded* surface because each crevice sees less of the sky, which
   is a statement about occlusion. Those are different mechanisms and they do not
   both operate at once. With the sun moved onto the far side of this wall the
   normal term contributes essentially nothing here, so leaving the cavity term at
   its lit-face weight throws away the only channel a shadowed face has. */
tAO *= mix(1.0, gr.a, 0.75 + 0.22 * (1.0 - sTerm));
/* Held on much further than before. The map's occlusion channel is now the
   cavity of a packing — the crevice between two touching grains and the floor of
   a weathering pit — and that is a *tone*, not a normal: it filters correctly
   under mip reduction and it is what keeps the material present at the distance
   where the relief has already faded out. */
tAO = mix(0.88, tAO, 0.55 + 0.45 * grainF);
`;

/* The mean linear luminance of a generated sRGB map, which is what a texture
   fetch of it returns once every mip has been collapsed. The shader divides by
   this to turn the map into a unit-mean multiplier; getting it by measurement
   rather than by guess is what stops mip collapse at geometric edges from
   becoming a visible outline. */
function meanLinearLum(tex) {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const d = tex.image.data;
  let a = 0;
  for (let i = 0; i < d.length; i += 4) {
    a += 0.299 * lut[d[i]] + 0.587 * lut[d[i + 1]] + 0.114 * lut[d[i + 2]];
  }
  return Math.max(1e-3, a / (d.length / 4));
}

/**
 * @param {object} tex   the shared texture set
 * @param {number} detail multiplier on the two fixed world sampling scales. The
 *   walls, the buttes and the talus are all made of the same rock but they are
 *   seen at wildly different sizes, and a map tiled at 6.45 m across a 30 cm
 *   talus block gives that block *one texel's worth* of variation — which is
 *   exactly why the apron read as flat-shaded untextured prisms. The footprint-
 *   locked grit layer fixes the pixel scale for everything, but the decimetre
 *   band still has to be told how big the object is.
 */
export function makeRockMaterial(tex, detail = 1.0) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.0, dithering: true,
  });
  mat.userData.tex = tex;
  mat.userData.uniforms = {
    uRockA: { value: tex.rock.albedo },
    uRockN: { value: tex.rock.normal },
    uRockM: { value: tex.rock.arm },
    uMacro: { value: tex.macro },
    uVar: { value: tex.variance },
    uDirtA: { value: tex.dirt.albedo },
    uGrit: { value: tex.grit },
    uDetail: { value: detail },
    /* Hematite-cemented sandstone. Nearly monochromatic on purpose: the measured
       99th percentile of a real Sedona cliff is 0.85 to 1.00 saturation, and
       nothing with a blue channel above a tenth of its red can reach that. */
    uIron: { value: new THREE.Color(0.475, 0.058, 0.019) },
    /* Desert varnish. Dark, faintly cool, and never black — a real varnish
       measures around eight percent reflectance and still photographs as a colour
       rather than as a hole. */
    uVarnish: { value: new THREE.Color(0.058, 0.042, 0.033) },
    uRockLum: { value: meanLinearLum(tex.rock.albedo) },
    /* Only ever read to find the terminator, never to light anything — the
       lighting is three's and System 4's. */
    uSunDir: { value: SUN_DIR.clone() },
    uJointK: { value: 1.0 },
    uVarnK: { value: 1.0 },
    uWarpK: { value: 1.0 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader =
      'attribute vec4 aRock;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying vec4 vRock;\n' +
      shader.vertexShader;
    /* The talus shares this material as an InstancedMesh, and three applies
       instanceMatrix inside project_vertex — after begin_vertex. So the world
       position and normal have to apply it here themselves or every block in the
       apron samples its texture at the origin. */
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vec4 rkP = vec4(transformed, 1.0);
        vec3 rkN0 = objectNormal;
        #ifdef USE_INSTANCING
          rkP = instanceMatrix * rkP;
          rkN0 = mat3(instanceMatrix) * rkN0;
        #endif
        vWPos = (modelMatrix * rkP).xyz;
        vWNrm = normalize(mat3(modelMatrix) * rkN0);
        vRock = aRock;`);

    shader.fragmentShader = ROCK_PREFIX + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', /* glsl */`
      #include <shadowmap_pars_fragment>
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        float catchShadow(sampler2D sm, vec2 sz, float si, float sb, float sr, vec4 sc) {
          float s = getShadow(sm, sz, si, sb, sr, sc);
          gShadow = min(gShadow, s);
          return s;
        }
        #define getShadow(a, b, c, d, e, f) catchShadow(a, b, c, d, e, f)
      #endif`)
      .replace('#include <lights_physical_fragment>', /* glsl */`
      #include <lights_physical_fragment>
      material.specularColor *= 0.55;
      material.specularF90 *= 0.16;`)
      .replace('#include <map_fragment>', ROCK_SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>',
        'normal = normalize((viewMatrix * vec4(tNrmW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', /* glsl */`
      /* ---- occlusion is not a multiply toward black; System 4 ----
         This was reflectedLight.indirectDiffuse *= tAO, and a geometric occlusion
         term taken as a straight multiply says an occluded crevice receives
         nothing. It receives less *sky*, which is what tAO legitimately models,
         but it also receives light bounced off its own walls, and for red
         sandstone that bounce is warm and it is the only illuminant a deep
         crevice has. Multiplying it away is what took 40.8 per cent of
         wall_shade to a minimum channel under ten code values with 6.0 per cent
         black on every channel: shaded sandstone is hue 4.5 degrees at 0.47
         saturation and needs blue near twenty code values to exist at all, and it
         had six, so the chroma was not wrong — there was nowhere to put it. That
         is the "muddy rather than dark" the critique named, and the floating slab
         in the same frame is the same fault: the ledge is correctly lit and the
         wall around it carries no tone, so a real bedding surface reads as an
         object hanging in a void.

         The curve is Jimenez et al.'s multi-bounce fit (GDC 2016), which solves
         the interreflection inside a closed environment of a given albedo as a
         cubic in the occlusion factor. Two properties earn it its place here over
         anything hand-tuned. It is exactly unity at tAO = 1, so an open sunlit
         face is untouched to the last bit and the defended 0.618 saturation at
         hue 20.9 cannot move. And the max() against tAO makes it one-sided: it
         can only lift, so no pixel anywhere gets darker than it was and nothing
         already in band can be pushed out of it.

         Note what it does not do, because System 4 verifies this and should not
         have to derive it: the lift is albedo-weighted, so at the tAO floor of
         0.18 the red channel rises about 37 per cent and the blue about two. That
         is the correct physics — a red crevice has little blue light to bounce —
         but it means this alone will not carry blue from six code values to
         twenty. What it fixes is the crush and the tint of the crush. If blue is
         still short after it, the remaining lever is the sky-visibility floor in
         tAO rather than the bounce, and that is a separate measured decision.

         No fetch, half a dozen multiplies, on a frame that is fill-bound on
         texture reads. This is deliberately the *same expression*, character for
         character, as the one at terrain.js's matching line — 2548d04 — so the two
         surfaces cannot drift apart under separate tuning. If you change one,
         change both. */
      vec3 aoA = material.diffuseColor;
      vec3 aoC1 =  2.0404 * aoA - 0.3324;
      vec3 aoC2 = -4.7951 * aoA + 0.6417;
      vec3 aoC3 =  2.7552 * aoA + 0.6903;
      /* And the second half of the same correction, which the note above named:
         "if blue is still short after it, the remaining lever is the sky-visibility
         floor in tAO rather than the bounce". It was short - measured 0.638
         saturation on shaded rock against 0.635 predicted, so the illuminant mix and
         not the encoder decides this - and the lever is that one scalar is scaling
         three illuminants of very different colour and very different visibility.
         s4AoTint returns the per-channel correction; the physics, the measurements
         and the #aok= ablation are all in src/sky.js beside it. It is vec3(1) at
         tAO = 1 and it preserves luminance, so neither the 0.618 nor the shadow gate
         can move. Same expression as terrain.js's matching line - change both. */
      reflectedLight.indirectDiffuse *=
        clamp(tAO * (aoC1 * tAO * tAO + aoC2 * tAO + aoC3), vec3(tAO), vec3(1.0))
        * s4AoTint(tNrmW, tAO);
      /* The additive Rayleigh shadow airlight that used to sit here is gone;
         see the long note at the same
         point in terrain.js. Short version: it was sized against a fill with no
         blue in it, the light probe that replaced that fill takes its cool
         directly from the sky, and the term's 1 : 2 : 7 channel ratio was
         pushing measured B/G above 1.0 on every shadowed surface with enough
         blue albedo to show it — which is CONTRACT.md's own signature for the
         magenta cast. Distance airlight is scene.fog's job and scene.fog now has
         the sky's own colour. */`);
  };
  return mat;
}

/** Diagnostic only: what the column costs, so the mesh budget can be checked. */
export const COLUMN_ROWS = COL.n;
