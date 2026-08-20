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
    col: [0.235, 0.105, 0.072], iron: 0.30, pale: 0.00, rough: 0.94 },
  /* Hermit-like slope-former, mostly under the talus; where the apron is thin it
     emerges as the red debris ramp the cliff stands on. */
  { y0:  -6.0, kind: SLOPE, rec: 1.55, proud: 0.00, bedT: 2.0,
    col: [0.255, 0.112, 0.076], iron: 0.45, pale: 0.00, rough: 0.95 },
  /* Schnebly Hill, lower cliff. */
  { y0:   3.0, kind: CLIFF, rec: 0.07, proud: -1.15, bedT: 1.75,
    col: [0.395, 0.163, 0.096], iron: 1.00, pale: 0.00, rough: 0.88 },
  { y0:  12.2, kind: BENCH, rec: 1.62, proud:  0.75, bedT: 1.30,
    col: [0.290, 0.132, 0.090], iron: 0.55, pale: 0.00, rough: 0.94 },
  /* Schnebly Hill, middle cliff — the thickest single face in the corridor. */
  { y0:  16.4, kind: CLIFF, rec: 0.05, proud: -1.45, bedT: 2.15,
    col: [0.368, 0.140, 0.081], iron: 1.00, pale: 0.00, rough: 0.87 },
  { y0:  25.8, kind: BENCH, rec: 1.45, proud:  0.62, bedT: 1.15,
    col: [0.305, 0.143, 0.097], iron: 0.55, pale: 0.00, rough: 0.94 },
  /* Schnebly Hill, upper cliff — the vivid one: iron-cemented and freshly spalled. */
  { y0:  29.6, kind: CLIFF, rec: 0.04, proud: -1.65, bedT: 1.55,
    col: [0.455, 0.183, 0.103], iron: 1.35, pale: 0.00, rough: 0.86 },
  /* Fort Apache Member: grey limestone, hard, standing proud as a ledge with an
     undercut beneath it. The one achromatic band in the red, and after the
     Coconino cap the most recognisable thing in a Sedona section. */
  { y0:  38.2, kind: LEDGE, rec: 0.00, proud: -2.55, bedT: 0.85,
    col: [0.345, 0.318, 0.281], iron: 0.10, pale: 0.85, rough: 0.78 },
  { y0:  41.0, kind: BENCH, rec: 0.95, proud:  1.00, bedT: 1.05,
    col: [0.288, 0.134, 0.094], iron: 0.60, pale: 0.00, rough: 0.94 },
  { y0:  46.0, kind: CLIFF, rec: 0.06, proud: -0.70, bedT: 1.60,
    col: [0.382, 0.155, 0.092], iron: 1.10, pale: 0.00, rough: 0.88 },
  { y0:  51.2, kind: BENCH, rec: 1.25, proud:  1.30, bedT: 1.20,
    col: [0.330, 0.170, 0.120], iron: 0.50, pale: 0.10, rough: 0.94 },
  /* Coconino Sandstone: buff-white cross-bedded aeolian sand, the pale cap. The
     contrast against the red below is Sedona's other signature. */
  { y0:  55.0, kind: CLIFF, rec: 0.03, proud: -1.50, bedT: 3.20,
    col: [0.610, 0.535, 0.428], iron: 0.06, pale: 1.00, rough: 0.80 },
  { y0:  67.0, kind: CAP,   rec: 1.80, proud:  1.40, bedT: 2.60,
    col: [0.300, 0.188, 0.128], iron: 0.35, pale: 0.15, rough: 0.96 },
];
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
  return d / L.bedT + 0.30 * Math.sin(d * 0.31 + li * 2.117)
                    + 0.17 * Math.sin(d * 0.77 + li * 3.733 + 1.4);
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
 */
function buildColumn() {
  const ys = [];
  const put = (y) => { if (!ys.length || y > ys[ys.length - 1] + 1e-4) ys.push(y); };

  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li], y1 = layTop(li);
    put(L.y0 - 0.075);
    put(L.y0 + 0.075);
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
    let ci = 0;
    for (let y = L.y0 + 0.075; y < y1 - 0.075; y += step) {
      while (ci < contacts.length && contacts[ci] < y) {
        put(contacts[ci] - 0.065); put(contacts[ci] + 0.065); ci++;
      }
      put(y);
    }
    while (ci < contacts.length) { put(contacts[ci] - 0.065); put(contacts[ci] + 0.065); ci++; }
  }
  put(Y_TOP);

  const n = ys.length;
  const Y = Float32Array.from(ys);
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
  return { Y, R, P, n };
}

const COL = buildColumn();

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
function jointOffset(a, seed, amp) {
  const i = Math.floor(a), t = a - i;
  const v0 = hash1(i, seed), v1 = hash1(i + 1, seed);
  return mix(v0 * v0, v1 * v1, t) * amp;
}

/* ── the wall curtain ──────────────────────────────────────────────────────── */

const S0 = -34, S1 = 356;
const DS = 0.62;
const NBACK = 7;

/** Wash floor datum. Both walls read the same function of s, so the Fort Apache
 *  band traces across the canyon at one height, which a real one does. */
function datumAt(s) {
  return 0.0125 * Math.max(0, s) + 2.4 * fbm(s * 0.0052, 11.5, 2, 331);
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
  const nu = Math.round((S1 - S0) / DS) + 1;
  const nv = COL.n + NBACK;

  const pos = new Float32Array(nu * nv * 3);
  const att = new Float32Array(nu * nv * 4);   // column y, along-wall s, freshness, cavity
  const uu = new Float32Array(nu * nv);        // lateral offset, kept for the cavity pass

  const cS = new Float32Array(nu), cDat = new Float32Array(nu);
  const cToe = new Float32Array(nu), cCrest = new Float32Array(nu);
  const cRet = new Float32Array(nu), cPrd = new Float32Array(nu);
  const cX = new Float32Array(nu), cZ = new Float32Array(nu);
  const cNx = new Float32Array(nu), cNz = new Float32Array(nu);

  const p = new THREE.Vector3();

  for (let i = 0; i < nu; i++) {
    const s = S0 + i * DS;
    cS[i] = s;
    path.posAt(s, p);
    const th = path.headingAt(s);
    cNx[i] = Math.cos(th) * side;
    cNz[i] = Math.sin(th) * side;
    cX[i] = p.x; cZ[i] = p.z;
    cDat[i] = datumAt(s);
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
    raw *= 1 - open;
    let best = CREST_LEVELS[0], bd = 1e9;
    for (const lv of CREST_LEVELS) { const d = Math.abs(lv - raw); if (d < bd) { bd = d; best = lv; } }
    /* Pulled most of the way onto the bed top but not all of it, and then
       roughened. A skyline that is exactly level is a table edge; a skyline level
       to within a metre and notched by the joints is a mesa. */
    cCrest[i] = Math.max(6.0, mix(raw, best, 0.82)
              + 1.3 * fbm(s * 0.09, side > 0 ? 3 : 8, 2, 373)
              + 0.7 * fbm(s * 0.32, 21, 2, 379));
  }

  for (let i = 0; i < nu; i++) {
    const s = cS[i];
    const dat = cDat[i], toe = cToe[i], ret = cRet[i], prd = cPrd[i], crest = cCrest[i];
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
      u += jointOffset(a1, 101, 3.1) * (0.45 + 0.55 * vert);
      u += jointOffset(a2, 107, 4.6) * 0.7;
      u += jointOffset(a1 * 1.7 + li * 0.37, 200 + li, 0.85);
      u += jointOffset(a3, 300 + li * 7, 1.15) * vert;

      /* Alcoves and spall scars. An alcove undercuts a soft bed beneath a hard
         one, so it goes on benches and its rim is the cliff above; a spall scar is
         a shallow flat-bottomed dish where a slab let go, so it goes on cliffs.
         Both are cut with a hard edge on purpose — a soft-edged dent is a dune. */
      let fresh = 0;
      if (vert) {
        const scar = smoothstep(0.66, 0.80,
          ridged(s * 0.055 + li * 4.1, yc * 0.075, 2, 383 + li * 31));
        u += scar * 1.5;
        fresh = scar;
      } else {
        u += 2.2 * smoothstep(0.60, 0.86, ridged(s * 0.028, yc * 0.055, 2, 389));
      }

      /* Fine relief, and deliberately little of it. Everything the eye reads as
         rock at this range is already above — the beds, the joints, the scars —
         and any more smooth noise is the surface language this file replaces. */
      u += 0.42 * fbm(s * 0.21, yc * 0.20, 3, 397 + li)
         + 0.20 * fbm(s * 0.62, yc * 0.55, 2, 401);

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
    const backRun = 26 + 16 * (0.5 + 0.5 * fbm(s * 0.014, side > 0 ? 9 : 15, 2, 409));
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
      att[k * 4] = pos[k * 3 + 1] - cDat[i];
      att[k * 4 + 1] = s;
      att[k * 4 + 2] = 0;
      uu[k] = u;
    }
  }

  cavityPass(att, uu, nu, nv);
  return { pos, att, nu, nv };
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
 */
function creasedMesh(grid, cosT, flip) {
  const { pos, att, nu, nv } = grid;
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
        acc.copy(own);
        for (let dj = -1; dj <= 0; dj++) {
          for (let di = -1; di <= 0; di++) {
            const qx = gi + di, qy = gj + dj;
            if (qx < 0 || qy < 0 || qx >= qu || qy >= qv) continue;
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

export function buildWalls(path, terrain, material) {
  const out = [];
  for (const side of [1, -1]) {
    /* The left wall's grid runs the same way round its own normal as the right
       one's does, which means its faces come out inside-out; the winding and the
       normals are both flipped rather than the grid being reversed, because the
       joint azimuths have to stay in world space. */
    const g = creasedMesh(wallGrid(path, terrain, side), Math.cos(0.62), side < 0);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.name = 'wall' + (side > 0 ? 'R' : 'L');
    out.push(m);
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
   scale. Every one of these is placed clear of the corridor axis by more than its
   own radius: the gap straight up the wash with the sun sitting in it is the one
   thing about this composition every critic has praised, and a butte across it
   would be the single worst thing this system could do. The distances are chosen
   against the fog: at 300, 470, 620 and 830 metres the haze passes 72, 45, 25 and
   8 percent, which is four legibly separated steps rather than one veil. */
const BUTTES = [
  [-330,  300, 130, 0.85], [ 285,  340, 120, 0.72],
  [-360,  470, 170, 1.20], [ 330,  520, 150, 1.00],
  [ 640,  430, 165, 0.80], [-640,  620, 210, 1.10],
  [-300,  780, 190, 1.45], [ 420,  830, 230, 1.30],
  [ 760,  900, 240, 1.15], [-880,  380, 150, 0.70],
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
      let r = r0 - (R * ret + P * 2.4) * hs;
      r -= jointOffset(a1, seed + li * 13, 9.0);
      r -= jointOffset(a2, seed + li * 7 + 5, 14.0);
      r -= 2.4 * fbm(ct * 9 + li, st * 9, 2, seed + 51);
      r = Math.max(r, rad * 0.12);
      const k = jj * nu + i;
      pos[k * 3] = cx + ct * r;
      pos[k * 3 + 1] = base + yq * hs - 7;
      pos[k * 3 + 2] = cz + st * r;
      att[k * 4] = yq;
      att[k * 4 + 1] = th * 90;
      att[k * 4 + 2] = 0;
      att[k * 4 + 3] = 0.5;
      rTop = r;
    }
    /* Close the top with a low dome rather than a flat lid. */
    for (let b = 0; b < 3; b++) {
      const t = (b + 1) / 3;
      const r = rTop * (1 - t * t) * 0.99;
      const k = (ny + b) * nu + i;
      pos[k * 3] = cx + ct * r;
      pos[k * 3 + 1] = base + cap * hs - 7 + t * 2.5 * hs;
      pos[k * 3 + 2] = cz + st * r;
      att[k * 4] = cap;
      att[k * 4 + 1] = th * 90;
      att[k * 4 + 2] = 0;
      att[k * 4 + 3] = 0.5;
    }
  }
  return { pos, att, nu, nv };
}

/** `creasedMesh` with the u axis wrapped, for the radial buttes. */
function creasedRing(grid, cosT) {
  const { pos, att, nu, nv } = grid;
  const nu2 = nu + 1;
  const p2 = new Float32Array(nu2 * nv * 3), a2 = new Float32Array(nu2 * nv * 4);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu2; i++) {
      const src = j * nu + (i % nu), dst = j * nu2 + i;
      for (let c = 0; c < 3; c++) p2[dst * 3 + c] = pos[src * 3 + c];
      for (let c = 0; c < 4; c++) a2[dst * 4 + c] = att[src * 4 + c];
    }
  }
  return creasedMesh({ pos: p2, att: a2, nu: nu2, nv }, cosT, false);
}

export function buildDistantButtes(terrain, material) {
  const out = [];
  let i = 0;
  for (const [lat, dist, rad, hs] of BUTTES) {
    const g = creasedRing(butteGrid(lat, -dist, rad, hs, terrain, 601 + i * 97), Math.cos(0.72));
    const m = new THREE.Mesh(g, material);
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
    aR[i * 4] = 18.0 + p.getY(i) * 4.5;
    aR[i * 4 + 1] = p.getX(i) * 9.0 + p.getZ(i) * 4.0;
    aR[i * 4 + 2] = 0.40;
    aR[i * 4 + 3] = 0.55;
  }
  g.setAttribute('aRock', new THREE.BufferAttribute(aR, 4));
  g.computeBoundingSphere();
  return g;
}

export function buildTalus(path, terrain, material) {
  const VAR = 4, N = 9000;
  const geos = [];
  for (let v = 0; v < VAR; v++) geos.push(talusBlock(3100 + v * 11, 0.46 + v * 0.12));
  const lists = geos.map(() => []);
  const rand = rng(4477);
  const p = new THREE.Vector3();
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler();
  const sc = new THREE.Vector3(), tr = new THREE.Vector3();

  for (let n = 0; n < N; n++) {
    const s = S0 + 6 + rand() * (S1 - S0 - 12);
    const side = rand() < 0.5 ? 1 : -1;
    path.posAt(s, p);
    const th = path.headingAt(s);
    const nx = Math.cos(th) * side, nz = Math.sin(th) * side;
    const dat = datumAt(s);
    const toe = toeAt(terrain, p.x, p.z, nx, nz, dat);

    /* Sorted along the apron: a block that bounced to the toe is the big one. */
    const t = Math.pow(rand(), 0.65);
    const av = toe - t * (4 + 10 * rand());
    if (av < 4) continue;
    /* Rockfall is episodic and arrives down the chutes, so an apron is a run of
       heaps with swept ground between them rather than an even sprinkle. */
    const chute = smoothstep(0.40, 0.78, 0.5 + 0.5 * fbm(s * 0.075, side * 3.1, 3, 421));
    if (rand() > chute * (0.35 + 0.75 * t)) continue;

    const x = p.x + nx * av, z = p.z + nz * av;
    const r = (0.16 + 0.52 * Math.pow(rand(), 2.3)) * (1 + t * 2.4);
    tr.set(x, terrain.heightAt(x, z) - r * (0.20 + 0.34 * rand()), z);
    e.set(rand() * 6.283, rand() * 6.283, rand() * 6.283);
    qt.setFromEuler(e);
    sc.set(r * (0.8 + rand() * 0.5), r * (0.55 + rand() * 0.5), r * (0.8 + rand() * 0.5));
    lists[(rand() * VAR) | 0].push(m.compose(tr, qt, sc).clone());
  }

  const out = [];
  for (let v = 0; v < VAR; v++) {
    const arr = lists[v];
    if (!arr.length) continue;
    const im = new THREE.InstancedMesh(geos[v], material, arr.length);
    for (let i = 0; i < arr.length; i++) im.setMatrixAt(i, arr[i]);
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
uniform vec3 uIron;
uniform vec3 uVarnish;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vRock;

float tRough; float tAO; vec3 tNrmW; float gShadow = 1.0;

vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

/* A contact that is hard when it can be resolved and smooth when it cannot.
   Sedona's bed boundaries are knife-sharp, and that hardness is half of what
   makes the bands read as strata rather than as a gradient — but a knife-sharp
   step sampled once per pixel on a cliff two hundred metres away is a crawling
   line of aliasing. Widening the step to one pixel of the driving coordinate is
   the correct filter and costs one fwidth. */
float hardstep(float e, float x, float w) { return smoothstep(e - w, e + w, x); }

/* Matched exactly by subResist() on the CPU, which is why it is two low-frequency
   sines rather than the usual large-argument hash. */
float bedResist(float id, float li) {
  return 0.5 + 0.34 * sin(id * 2.399 + li * 1.113 + 1.7)
             + 0.16 * sin(id * 5.211 + li * 0.770);
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
float fresh = vRock.z;        // spall scars: rock exposed since the last frost
float cav = vRock.w;          // how far this point sits back from its neighbourhood

float foot = max(length(dFdx(vWPos)), length(dFdy(vWPos)));
float grainF = 1.0 - smoothstep(0.020, 0.13, foot);   // sandstone grain, 1-6 cm
float bedF   = 1.0 - smoothstep(0.09, 0.55, foot);    // sub-bed relief, 10-50 cm

/* One pixel of the stratigraphic coordinate, which every contact below is
   filtered against. */
float hw = clamp(fwidth(y) * 0.62, 0.012, 0.85);

${layerGLSL()}

/* ---- sub-bedding ----
   The same monotone coordinate the mesh rows were placed on, so the tone step and
   the ledge the geometry cut are one bed. Contacts are hard; the tone difference
   between beds is not large, because stratification you cannot avoid reads as
   corrugated iron, and what carries a bed at distance is the shadow line under
   its lip rather than its colour. */
float sbY = y - lBot;
float sb = sbY / lBedT + 0.30 * sin(sbY * 0.31 + lIdx * 2.117)
                       + 0.17 * sin(sbY * 0.77 + lIdx * 3.733 + 1.4);
float sbI = floor(sb);
float sbT = sb - sbI;
float sbR = bedResist(sbI, lIdx);

/* ---- surface grain, triplanar ----
   Two scales, an octave and a half apart: the coarse one carries the metre-scale
   mottle of a weathered face, the fine one the sand grain that a face filling the
   frame has to have and that no amount of geometry can supply. */
vec3 triW = pow(abs(gN), vec3(4.0));
triW /= max(triW.x + triW.y + triW.z, 1e-4);
vec3 rkA = triSample(uRockA, vWPos, triW, 0.155);
vec3 rkA2 = triSample(uRockA, vWPos + vec3(37.1, 11.3, 5.7), triW, 0.62);
vec3 rkM = triSample(uRockM, vWPos, triW, 0.155);
vec3 rkN = triNormal(uRockN, vWPos, triW, 0.155, gN);
vec3 rkN2 = triNormal(uRockN, vWPos + vec3(37.1, 11.3, 5.7), triW, 0.62, gN);

/* The rock map's pigment is discarded and only its luminance kept. Its bands were
   authored for a wall that had no stratigraphy of its own; here the strata are
   geometry, so letting its colour through would lay a second, contradictory set
   of bands over the first. */
float lum = mix(1.0, dot(rkA, vec3(0.299, 0.587, 0.114)) / 0.185, 0.70)
          * mix(1.0, dot(rkA2, vec3(0.299, 0.587, 0.114)) / 0.185, 0.12 + 0.32 * grainF);

vec3 albedo = lCol * lum;

/* ---- cross-bedding ----
   Coconino is a fossil dune field, so its laminae are not level: they sweep in
   inclined sets a metre or two thick, truncated flat at the top of each set. It
   is the most recognisable thing about the cap after its colour, and it is what
   stops a pale band reading as a stripe of paint. */
float xbSet = floor(y / 2.3 + 0.21 * sin(aS * 0.031));
float xbDir = sin(xbSet * 2.7 + 1.1) > 0.0 ? 1.0 : -1.0;
float xb = sin((y + aS * (0.42 + 0.12 * sin(aS * 0.06)) * xbDir) * 2.9 + xbSet * 5.1);
albedo *= 1.0 + xb * 0.085 * lPale * lVert * (1.0 - smoothstep(0.12, 0.45, foot));

/* ---- iron-oxide lenses ----
   This is where the saturated end of the distribution comes from, and the reason
   it has to be lenses rather than a stronger base colour. Hematite cement is not
   spread evenly through a sandstone; it concentrates along former groundwater
   fronts, in lenses metres across that follow bedding. Those lenses are the parts
   of a Sedona cliff that go genuinely vivid in the last light — a mean pushed up
   instead just makes an orange membrane over everything, which is the failure
   this scene has already had twice. Narrow threshold, strong effect. */
vec4 mac = texture2D(uMacro, rot2(vWPos.xz, 0.61) * 0.021 + vec2(y * 0.014, 0.0));
vec4 vr  = texture2D(uVar, vec2(aS * 0.037, y * 0.055));
float ironF = smoothstep(0.54, 0.80, mac.r * 0.62 + vr.g * 0.52 + (sbR - 0.5) * 0.30) * lIron;
/* Fresh spall faces are unweathered rock: no varnish film, no dust, and the
   pigment at full strength. A cliff with no fresh faces is a cliff nothing has
   fallen off, which is not a cliff. */
albedo = mix(albedo, uIron * lum, clamp(ironF * 0.85 + fresh * 0.40 * lIron, 0.0, 0.92));

/* A resistant bed is better cemented, so it is a little paler and a little
   smoother, and the soft bed under it is recessed and holds shadow. */
float sbTone = (sbR - 0.5) * 0.16;
albedo *= 1.0 + sbTone;

/* ---- desert varnish ----
   Manganese and iron oxides washed out of the rock above and plated onto the face
   below every point where water sheds over a lip. Near-black, faintly cool, and
   *vertical* — it is the one thing on a desert cliff that runs down rather than
   along, and its absence is part of why the walls read as one material. Strongest
   just under the lip of the bed that sheds it, tapering downward, and only on
   faces steep enough for water to run rather than soak. */
float vStreak = smoothstep(0.50, 0.86,
    texture2D(uVar, vec2(aS * 0.62, y * 0.010)).b * 0.68
  + texture2D(uVar, vec2(aS * 1.95 + 0.37, y * 0.004)).r * 0.52);
float varn = clamp(vStreak * exp2(-(lTop - y) * 0.30) * lVert * (1.0 - lPale * 0.55)
           * smoothstep(0.55, 0.20, abs(gN.y)) * (1.0 - fresh) * 1.5, 0.0, 0.80);
albedo = mix(albedo, uVarnish * (0.55 + 0.45 * lum), varn);

/* ---- dust and weathered fines on the up-facing surfaces ----
   Every ledge, bench top and joint-block shelf in a desert collects the same pale
   silt the wash floor is made of, and that is most of what makes a stair-stepped
   cliff read as stepped: the treads are a different material from the risers. */
vec3 dust = triSample(uDirtA, vWPos, triW, 0.30);
float dustW = smoothstep(0.34, 0.86, gN.y)
            * (0.40 + 0.45 * smoothstep(0.35, 0.75, mac.g)) * (1.0 - lVert * 0.35);
albedo = mix(albedo, dust * 1.05, dustW * 0.62);

/* ---- macro tonal variation, kept in chroma ----
   Value variance at macro scale reads as depth, not as material, and has been
   mistaken for a rendering fault twice in this project. Chroma variance does not:
   average an iron-rich panel with a leached one and you get a duller red, which
   is the right answer. */
albedo *= 0.93 + 0.14 * mac.b;
albedo = mix(albedo, albedo * vec3(0.92, 0.97, 1.08), smoothstep(0.62, 0.88, vr.r) * 0.34);
albedo = mix(albedo, albedo * vec3(1.10, 0.97, 0.88), smoothstep(0.58, 0.86, mac.a) * 0.30);

diffuseColor.rgb *= albedo;

/* ---- relief ----
   Each term filtered against its own feature size. Nothing here is allowed to
   contribute a normal once a pixel covers several of the features it describes,
   because lighting is non-linear in the normal and the average of the lit facets
   is not the lighting of the average facet — which is the mechanism behind every
   scintillating rock face in a real-time renderer. */
float sbStep = (1.0 - smoothstep(0.0, 0.09, sbT)) - smoothstep(0.91, 1.0, sbT);
vec3 wN = normalize(mix(gN, mix(rkN, rkN2, 0.5), 0.20 + 0.72 * grainF));
/* Only the beds the mesh did not already step: the strong ones have real geometry
   and adding a bump to them doubles the riser. */
wN = bumpFrom(sbStep * (1.0 - smoothstep(0.60, 0.68, sbR)) * 0.9 + sbTone * 2.0,
              wN, 0.10 * bedF);
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
tAO = clamp(rkM.r * (0.72 + 0.34 * (1.0 - cav)) - ledgeShade * 0.5, 0.22, 1.0);
tAO = mix(0.84, tAO, 0.35 + 0.65 * grainF);
`;

export function makeRockMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.0, dithering: true,
  });
  mat.userData.uniforms = {
    uRockA: { value: tex.rock.albedo },
    uRockN: { value: tex.rock.normal },
    uRockM: { value: tex.rock.arm },
    uMacro: { value: tex.macro },
    uVar: { value: tex.variance },
    uDirtA: { value: tex.dirt.albedo },
    /* Hematite-cemented sandstone. Nearly monochromatic on purpose: the measured
       99th percentile of a real Sedona cliff is 0.85 to 1.00 saturation, and
       nothing with a blue channel above a tenth of its red can reach that. */
    uIron: { value: new THREE.Color(0.475, 0.058, 0.019) },
    /* Desert varnish. Dark, faintly cool, and never black — a real varnish
       measures around eight percent reflectance and still photographs as a colour
       rather than as a hole. */
    uVarnish: { value: new THREE.Color(0.058, 0.045, 0.048) },
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
      reflectedLight.indirectDiffuse *= tAO;
      /* Rayleigh airlight in shadow, added outside the albedo product for the
         reason terrain.js records: a shadowed red surface cannot reflect a blue it
         has no blue albedo to reflect, and the violet in a photograph of one is
         scattered light in the air between the rock and the lens. On a wall this
         matters more than on the floor, because a canyon wall in shade is the
         largest single area of shadow in the frame. */
      float airM = 1.0 - gShadow;
      float airD = smoothstep(2.0, 120.0, length(vWPos - cameraPosition));
      reflectedLight.indirectDiffuse +=
        vec3(0.014, 0.028, 0.100) * airM * (0.28 + 0.72 * airD) * tAO;`);
  };
  return mat;
}

/** Diagnostic only: what the column costs, so the mesh budget can be checked. */
export const COLUMN_ROWS = COL.n;
