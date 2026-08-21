/* Sedona Sunset — System 2, the far band: receding ridgelines at 2.3 to 5.5 km.
 *
 * Why this exists is an atmosphere problem with a geometric answer. Airlight
 * share goes as 1 - e^(-beta*d), so the contrast between two receding masses is
 * set by the *ratio* of their distances as much as by the density. The deepest
 * sightline in the scene was 550 m of wash and 1450 m of butte, and over that
 * baseline the only way to get a legible ladder of ridgelines was to make the
 * air thick enough to be a dust storm — a 3.56 km meteorological visual range
 * against 60-160 km for a clear Coconino evening, with the contradiction
 * measurable as a blue zenith over brown air. src/aerial.js works the
 * arithmetic and asks for this in GEOMETRY_NEEDED: masses at 2-8 km let the
 * extinction fall by another 2.6x and *gain* contrast at the back.
 *
 * So this file is a depth instrument first and scenery second, and three things
 * follow from that.
 *
 * **Four discrete planes, not a field of hills.** The point of the exercise is
 * that each successive rim sits a measurable step lighter than the one in front,
 * and a continuum of distances is a gradient, which is the veil this is meant to
 * replace. 2.3 / 3.15 / 4.25 / 5.45 km, roughly a 1.3x ratio each, which under
 * the thinner air this makes possible puts about 0.10 of airlight share between
 * neighbours.
 *
 * **The far planes are seen through the near ones, not above them.** A rim of
 * constant height subtends a *smaller* angle the further away it is, so stacking
 * genuinely distant ridges by raising each one is how a render ends up with a
 * cardboard-cutout staircase and formations the size of the Himalayas. Real
 * receding ridgelines interleave: you see the far rim through the saddle between
 * two near spurs, and the same rim disappears behind the next spur along. Every
 * plane here therefore spans nearly the same apparent elevation band — about 2
 * to 9 degrees — and gets its separation from deep, sparse re-entrant canyons
 * that cut each rim down to a quarter of its own relief. Which plane you see at
 * a given azimuth is then a property of the noise rather than of a hand-placed
 * layout.
 *
 * **Silhouette is the entire budget.** At 3 km a formation is a few dozen pixels
 * tall and carries no material at all: what survives is the profile and the
 * tone. A critic measured the old far plane's local RMS contrast at 0.010
 * against 0.529 on the near wall and called it a flat cutout, and named the
 * cure — a real Sedona skyline is *serrated*, with spires, notches and flat mesa
 * shoulders. So the crest is a quantised plateau level (flat treads, steep
 * risers, which is what a bench-and-cliff section looks like from far enough
 * away that the individual beds have gone), cut by canyons, with fins and buttes
 * standing on it.
 *
 * Morphology is Sedona and deliberately not Monument Valley: stair-stepped
 * cliff-and-bench profiles tapering upward with a pale Coconino cap on the ones
 * tall enough to still have theirs, no free-standing hoodoos, and no cap wider
 * than the neck under it. The colour column is imported from rock.js's LAYERS so
 * the far band cannot drift away from the near buttes' palette.
 *
 * ── the sun corridor ───────────────────────────────────────────────────────
 *
 * System 4 is separately trying to get the sun *visible* in the gap up the wash;
 * its skyline currently stands 15-18 degrees along the sun's bearing against a
 * sun at 11, and anything added here in that direction makes a hard problem
 * impossible. So the crest is capped as a function of angular distance from the
 * sun's own bearing, and the cap is evaluated as an apparent elevation from
 * every point the camera can stand at rather than as a height in metres —
 * `SUN_CAP` below. Within six degrees of the bearing the cap is 3 degrees, which
 * is under the *terrain's* own horizon along that line, so this file provably
 * adds nothing there whatever System 4 does to the walls.
 *
 * A note for whoever checks that claim: tools/horizon.mjs marches the height
 * field, and none of this is in the height field. It cannot see these meshes and
 * will report no change — which is true but is not the same as evidence.
 * tools/_farhoriz.mjs walks the actual geometry and is the instrument for this.
 *
 * ── cost ───────────────────────────────────────────────────────────────────
 *
 * Four curtains, 960 columns by 10 rows each: 69 k triangles and four draw
 * calls, all of it in the upper fifth of the frame. Cheap by construction rather
 * than by decimation — there is no detail to decimate, because at this range
 * there is no detail. Lambert rather than the rock shader on purpose: at 2.3 km
 * the airlight is over 90% of the pixel even after the air is thinned, so the
 * twenty-odd texture fetches the wall material makes per fragment would buy
 * nothing, and fragment work is the thing this GPU is actually short of.
 */
import * as THREE from 'three';
import { fbm, ridged, hash1, clamp, smoothstep, mix } from './noise.js';
import { LAYERS } from './rock.js';
import { SUN_DIR } from './sky.js';

/* Distance from the anchor in metres, relief in metres, and the apparent
 * elevation each plane is aimed at where the wash opens.
 *
 * The distances span 3.2x, which is the whole reason for the exercise: airlight
 * share is 1 - e^(-beta*d), so what separates two masses is the ratio of their
 * ranges. Under the 13 km visual range this is built to allow, these four sit
 * at 0.19 / 0.27 / 0.37 / 0.48 of airlight — four clearly distinct tones, where
 * the existing 550-to-1450 m spread gives 0.15 to 0.35 and the back half of it
 * is already saturated at the current density.
 *
 * The reliefs are frankly large: 1650 m at 7.3 km is not a landform the Verde
 * Valley contains. It is a compression, and a deliberate one. What the far
 * plane has to be is *pale and high enough to see over the plane in front*, and
 * both of those are apparent-angle properties; the honest alternative — putting
 * a 700 m rim at 30 km, which is what the tone implies — is outside any camera
 * far plane this project can afford and would need a separate cubemap-style
 * backdrop with its own pass. Compressing the range and keeping the angle gets
 * the ladder the atmosphere asked for at four draw calls. It is recorded here
 * rather than hidden because it is the one non-physical thing in the file.
 *
 * `aim` is the apparent elevation in degrees the crest is phase-fitted to reach
 * where the corridor opens — see pickPhase. The rungs are 1.3 to 1.4 degrees
 * apart, which is 20 to 22 pixels at 900 lines, because the existing distant
 * buttes already stand at 5.0 to 5.9 in that window and the cap keeps the top
 * of the band under 11. That is the vertical budget the composition leaves and
 * these are the widest rungs that fit in it.
 */
const PLANES = [
  { d: 2300, relief: 420, seed: 7301, aim: 6.6 },
  { d: 3400, relief: 700, seed: 7607, aim: 7.9 },
  { d: 5000, relief: 1080, seed: 7919, aim: 9.2 },
  { d: 7300, relief: 1650, seed: 8231, aim: 10.4 },
];

/* World azimuth, degrees, of the middle of the only window in this composition
   through which anything at this range is visible at all. tools/_farhoriz.mjs
   walks the wall curtains from all eight capture viewpoints and the answer is
   the same at every one of them: the walls stand at 12 to 50 degrees everywhere
   except a slot from about -4 to +7, which is the gap up the wash with the sun
   beside it. Outside that slot the profile below is whatever the noise says;
   inside it, it is fitted. */
const GAP_AZ = 4.0;
const GAP_HALF = 3.0;

/* Azimuth span, radians either side of down-wash. The near walls close the view
   past about 35 degrees from the corridor axis at every viewpoint, so this is
   already generous; it is wide rather than tight only because the cost of a
   column is a rounding error and a rim that stops has to stop somewhere the
   camera cannot look. */
const SPAN = 100 * Math.PI / 180;
const NCOL = 960;

/* Rows. Nine on the formation plus a skirt below, which is enough to carry a
   cliff-bench-cliff-bench-cliff-cap section as tone and as a taper. More rows
   would be more triangles buying sub-pixel steps. `t` is the fraction of the
   local relief; `rec` is the cumulative setback in units of the relief, which
   is what makes the profile a staircase that leans back rather than a stack of
   plates — see the same argument in rock.js's butteGrid; `tone` indexes the
   colour column below. */
const ROWS = [
  { t: -0.80, rec: 0.00, tone: 0 },   // skirt: below any horizon, never seen
  { t: 0.00, rec: 0.00, tone: 0 },    // toe of the talus apron
  { t: 0.19, rec: 0.13, tone: 1 },    // debris ramp, wasted back to repose
  { t: 0.37, rec: 0.15, tone: 2 },    // lower cliff
  { t: 0.45, rec: 0.21, tone: 3 },    // bench
  { t: 0.63, rec: 0.23, tone: 4 },    // middle cliff, the thick one
  { t: 0.71, rec: 0.29, tone: 5 },    // bench
  { t: 0.86, rec: 0.31, tone: 6 },    // upper red cliff
  { t: 0.91, rec: 0.36, tone: 7 },    // the pale ledge under the cap
  { t: 1.00, rec: 0.38, tone: 8 },    // Coconino cap
];
/* Setback in metres is rec * relief * this. At 0.38 of a 380 m rim that is
   43 m of taper across a mass a few hundred metres wide, which reads as a
   butte narrowing upward rather than as a cone. */
const TAPER = 0.30;

/* Tone column, linear diffuse albedo, taken from rock.js's LAYERS so the two
   cannot drift. Index is the `tone` field above. The toe is darkened because
   the foot of a distant escarpment is talus in its own shade, not fresh rock. */
const L = LAYERS;
const TONE = [
  L[1].col.map((x) => x * 0.82),      // 0 talus toe
  L[1].col,                           // 1 Hermit slope
  L[2].col,                           // 2 lower Schnebly cliff
  L[3].col,                           // 3 bench
  L[4].col,                           // 4 middle Schnebly cliff
  L[5].col,                           // 5 bench
  L[6].col,                           // 6 upper Schnebly cliff
  L[7].col,                           // 7 Fort Apache limestone ledge
  L[11].col,                          // 8 Coconino cap
];

/* The cap on apparent elevation, in degrees, against angular distance from the
 * sun's bearing in degrees. Piecewise linear, interpolated smoothly.
 *
 * The first entry is the load-bearing one. Three degrees is below the terrain's
 * own horizon along the sun's bearing at every point on the wash centreline
 * (tools/horizon.mjs reads 3.4 to 3.8 degrees at the mid-wash stations), so
 * inside that corridor this file cannot be the thing occluding the disc, and
 * cannot become the thing occluding it when System 4 lowers the wall crests
 * that currently do. Twenty-two degrees out the cap stops mattering because the
 * near walls stand at 25 to 42 there and nothing behind them is visible at all.
 */
const SUN_CAP = [[0, 3.0], [6, 3.2], [9, 6.5], [12, 9.5], [16, 11.8], [24, 13.0], [40, 13.5]];

function capAt(dDeg) {
  const d = Math.abs(dDeg);
  for (let i = 1; i < SUN_CAP.length; i++) {
    if (d <= SUN_CAP[i][0]) {
      const [a, ca] = SUN_CAP[i - 1], [b, cb] = SUN_CAP[i];
      return mix(ca, cb, smoothstep(a, b, d));
    }
  }
  return SUN_CAP[SUN_CAP.length - 1][1];
}

/** Flat treads and steep risers: a plateau level rather than a smooth hump. */
function benchify(h, levels, soft) {
  const q = h * levels;
  const i = Math.floor(q);
  return (i + smoothstep(0.5 - soft, 0.5 + soft, q - i)) / levels;
}

/**
 * The crest, as a fraction of the plane's relief.
 *
 * `u` is arc length along the rim in kilometres, so every wavelength below is a
 * real ground distance and the four planes get the same *morphology* at four
 * different apparent scales rather than four copies of one silhouette.
 */
function crestProfile(u, seed) {
  /* Which stretches of rim stand high. Long, because a massif is kilometres. */
  let h = 0.5 + 0.5 * fbm(u * 0.17, seed * 0.011, 3, seed);
  /* Quantised to five plateau levels. This is the single term that makes the
     silhouette read as sedimentary: mesa shoulders are flat because a resistant
     bed is flat, and the risers between them are cliffs. Smooth noise cannot
     produce a flat top at any octave count. */
  h = benchify(h, 5, 0.15);
  /* Re-entrant canyons. Cubed and quartic so they are sparse and deep — the
     drainages that cut a rim into promontories — rather than a general
     waviness, which the octave above already supplies. These are also what lets
     the plane behind show through, so their depth is the depth of the ladder. */
  h -= 0.64 * Math.pow(ridged(u * 0.60, 11.3, 2, seed + 41), 3);
  h -= 0.30 * Math.pow(ridged(u * 1.85, 3.7, 2, seed + 97), 4);
  /* Buttes and fins standing on the rim: narrow, tall, and rare. */
  h += 0.34 * Math.pow(ridged(u * 3.1, 21.0, 2, seed + 151), 6);
  h += 0.11 * Math.pow(ridged(u * 8.4, 5.5, 2, seed + 211), 4);
  /* Tooth. One or two pixels at this range, and it is the difference between a
     cut edge and a drawn one. */
  h += 0.038 * fbm(u * 23, 7.7, 2, seed + 263);
  return clamp(h, 0.14, 1.06);
}

/** Plan offset in metres: buttresses, spurs and the re-entrants between them. */
function planOffset(u, seed) {
  return 52 * fbm(u * 0.47, 1.7, 3, seed + 11)
       + 19 * fbm(u * 2.30, 9.1, 2, seed + 59)
       + 6.5 * fbm(u * 9.10, 4.3, 2, seed + 83);
}

/**
 * Slide each rim along itself until its crest sits where the ladder wants it.
 *
 * The one thing that cannot be left to the noise is what happens in the eleven
 * degrees of azimuth this composition actually lets you see. The envelope's
 * dominant wavelength is about six kilometres of rim, so a window 300 m wide at
 * 2.3 km contains no variation at all: whatever value the noise happens to hold
 * there is the entire contribution of that plane to the only view that matters.
 * The first build of this file left it to chance and three planes out of four
 * came out under the existing buttes, which is a ladder with one rung.
 *
 * A phase offset is the least invasive fix available. It changes nothing about
 * the morphology, the spectrum or the statistics of the rim — it is the same
 * generated skyline, entered at a different point — so nothing here is
 * hand-drawn and the profile away from the gap is exactly as unplanned as it
 * was. What it buys is that the rungs land where the frame can see them.
 *
 * Fitted against the mean absolute error of apparent elevation across the
 * window rather than at its centre, so a phase that spikes through the target
 * and falls away loses to one that holds it.
 */
function pickPhase(plane, anchor, baseY, eye) {
  const DEG = 180 / Math.PI;
  const AZ = [];
  for (let k = -3; k <= 3; k++) AZ.push((GAP_AZ + (GAP_HALF * k) / 3) / DEG);

  let best = 0, bestErr = Infinity;
  for (let p = 0; p < 600; p++) {
    const phase = (p / 600) * 240;      // kilometres of rim; the envelope is ~6
    let err = 0;
    for (const th of AZ) {
      const dx = Math.sin(th), dz = -Math.cos(th);
      const u = (th * plane.d) / 1000 + phase;
      const r = plane.d + planOffset(u, plane.seed);
      const H = plane.relief * crestProfile(u, plane.seed);
      const gx = anchor.x + dx * r - eye.x, gz = anchor.z + dz * r - eye.z;
      const el = Math.atan2(baseY + H - eye.y, Math.hypot(gx, gz)) * DEG;
      err += Math.abs(el - plane.aim);
    }
    if (err < bestErr) { bestErr = err; best = phase; }
  }
  return { phase: best, err: bestErr / AZ.length };
}

/**
 * Build one curtain.
 *
 * @param {object} plane          entry from PLANES
 * @param {{x:number,z:number}} anchor  centre of the arc
 * @param {number} baseY          datum the formations stand on
 * @param {number} sunAz          world azimuth of the sun, radians
 * @param {Array<{x:number,y:number,z:number}>} eyes  every place the camera stands
 */
function curtain(plane, anchor, baseY, sunAz, eyes, phase) {
  const { d: R, relief, seed } = plane;
  const nv = ROWS.length;
  const pos = new Float32Array(NCOL * nv * 3);
  const col = new Float32Array(NCOL * nv * 3);
  const DEG = 180 / Math.PI;

  for (let i = 0; i < NCOL; i++) {
    const th = -SPAN + (2 * SPAN * i) / (NCOL - 1);
    const ct = Math.cos(th), st = Math.sin(th);
    /* Direction convention matches the rest of the project: theta 0 is -z,
       which is down-wash toward the sun gap. */
    const dx = st, dz = -ct;
    const u = (th * R) / 1000 + phase;

    const rBase = R + planOffset(u, seed);
    const hn = crestProfile(u, seed);
    let H = relief * hn;

    /* The cap, evaluated as an apparent angle from every station the camera can
       occupy rather than as a height. A metre limit would be wrong by a third
       across the walk, and wrong in the direction that matters — walking up the
       wash brings these closer and raises them. */
    let hMax = Infinity;
    for (const e of eyes) {
      const px = anchor.x + dx * rBase, pz = anchor.z + dz * rBase;
      const gx = px - e.x, gz = pz - e.z;
      const g = Math.hypot(gx, gz);
      let az = Math.atan2(gx, -gz) - sunAz;
      while (az > Math.PI) az -= 2 * Math.PI;
      while (az < -Math.PI) az += 2 * Math.PI;
      const lim = e.y + g * Math.tan(capAt(az * DEG) / DEG) - baseY;
      if (lim < hMax) hMax = lim;
    }
    hMax = Math.max(8, hMax);
    /* Soft, and asymptotic rather than clamped. A hard clamp would saw a
       perfectly level lid across every formation that reached it, which is a
       tell of exactly the kind this file exists to remove; this compresses the
       top third of the range into the remaining headroom and never touches the
       limit, so the guarantee above is strict. */
    const knee = 0.7 * hMax;
    if (H > knee) H = knee + (hMax - knee) * (1 - Math.exp(-(H - knee) / (hMax - knee)));

    /* The pale cap survives only on the formations that still have theirs. A
       shoulder that has been stripped to the red beds gets the red beds, and
       that variation along a rim is a large part of what a Sedona skyline looks
       like. */
    const capM = smoothstep(0.52, 0.76, hn);
    /* Per-formation tonal jitter, plus a per-column octave fine enough to put
       energy at the pixel scale, which a nine-row colour ramp on its own cannot
       do. */
    const jit = 1 + 0.10 * (hash1(i >> 3, seed) - 0.5) + 0.055 * (hash1(i, seed + 5) - 0.5);

    for (let j = 0; j < nv; j++) {
      const row = ROWS[j];
      const r = rBase - row.rec * relief * TAPER;
      const y = baseY + row.t * H;
      const k = (j * NCOL + i) * 3;
      pos[k] = anchor.x + dx * r;
      pos[k + 1] = j === 0 ? baseY - 320 : y;
      pos[k + 2] = anchor.z + dz * r;

      let c = TONE[row.tone];
      if (row.tone === 8) c = TONE[8].map((x, q) => mix(TONE[6][q], x, capM));
      if (row.tone === 7) c = TONE[7].map((x, q) => mix(TONE[6][q], x, 0.35 + 0.65 * capM));
      col[k] = c[0] * jit;
      col[k + 1] = c[1] * jit;
      col[k + 2] = c[2] * jit;
    }
  }

  const idx = new Uint32Array((NCOL - 1) * (nv - 1) * 6);
  let p = 0;
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < NCOL - 1; i++) {
      /* Wound so the *inward* face is the front face. The camera stands inside
         this ring, which is the opposite of every other closed surface in the
         project, and getting it the other way round costs nothing visible in a
         diagnostic and everything in the frame: back-face culling removes the
         whole band and the only symptom is that the far distance looks exactly
         as it did before. Checked numerically in tools/_farhoriz.mjs rather
         than by eye, because "no change" is what a working cap looks like too. */
      const a = j * NCOL + i, b = a + 1, c = a + NCOL, dd = c + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = dd; idx[p++] = c;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Where the crest of each plane actually ended up, for tools/_farhoriz.mjs. */
export const FARRIDGE_DIAG = { planes: [] };

/**
 * The far band.
 *
 * @param {Terrain} terrain
 * @param {WashPath} path
 * @returns {THREE.Group} named `farridge`, carrying `setDetail(n)` for perf.js
 */
export function buildFarRidges(terrain, path) {
  /* `#nofar` builds the group empty, so a handoff can be paired with a matched
     control from the same page rather than from a revert. This band exists to
     serve tools/layers.mjs and layers.mjs is a comparison, so the control has
     to be one page load away or nobody will take it — and System 5 needs to
     sweep the extinction against it, which is four loads inside one render-lock
     acquisition. Same argument, and the same mechanism, as aerial.js's dials.
     Absent the hash this costs one constant fold. */
  let off = false;
  try { off = /(?:^|[#,&;])nofar(?:$|[,&;])/.test(location.hash || ''); } catch (e) { off = false; }

  const a = path.posAt(110);
  const anchor = { x: a.x, z: a.z };
  const baseY = terrain.heightAt(anchor.x + 800, anchor.z - 2500);

  const sunAz = Math.atan2(SUN_DIR.x, -SUN_DIR.z);

  /* Every station the camera can stand at, which is the wash centreline. The
     cap has to hold at all of them, and the binding one is not the same station
     for every azimuth — walking up-wash shortens the range to the ridges ahead
     and lengthens it to the ones behind. */
  const eyes = [];
  for (let s = 0; s <= 240; s += 15) {
    const p = path.posAt(s);
    eyes.push({ x: p.x, y: terrain.heightAt(p.x, p.z) + 1.65, z: p.z });
  }

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
  mat.name = 'farridge';

  const group = new THREE.Group();
  group.name = 'farridge';
  FARRIDGE_DIAG.planes.length = 0;
  FARRIDGE_DIAG.anchor = anchor;
  FARRIDGE_DIAG.sunAzDeg = (sunAz * 180) / Math.PI;

  /* The gap is judged from the sun_gap station, which is the deepest sightline
     up the wash and the only viewpoint from which all four planes clear the
     near buttes. */
  const gp = path.posAt(120);
  const gapEye = { x: gp.x, y: terrain.heightAt(gp.x, gp.z) + 1.65, z: gp.z };

  for (let i = 0; i < (off ? 0 : PLANES.length); i++) {
    const fit = pickPhase(PLANES[i], anchor, baseY, gapEye);
    const g = curtain(PLANES[i], anchor, baseY, sunAz, eyes, fit.phase);
    const m = new THREE.Mesh(g, mat);
    /* Two kilometres outside the shadow cascade's box in every direction, so a
       shadow pass over them would rasterise seventeen thousand triangles into
       nothing. Nor do they receive: at this range the direct term is a fraction
       of the airlight and the cascade has no texels out here to sample. */
    m.castShadow = false;
    m.receiveShadow = false;
    /* The arc spans 200 degrees around the walk, so its bounding sphere
       contains the camera and no frustum test can ever reject it. Skipping the
       test is then strictly cheaper than failing it every frame. */
    m.frustumCulled = false;
    m.name = 'farridge' + i;
    group.add(m);
    FARRIDGE_DIAG.planes.push({
      d: PLANES[i].d, relief: PLANES[i].relief, aim: PLANES[i].aim,
      phase: +fit.phase.toFixed(2), fitErrDeg: +fit.err.toFixed(3),
      tris: g.index.count / 3, verts: g.attributes.position.count,
    });
  }

  /* The quality ladder's handle. The far planes are the cheap ones to give up:
     they are the smallest on screen and the most nearly pure airlight, so
     dropping them at the bottom two tiers costs two draw calls' worth of a
     silhouette that was already most of the way to sky. perf.js drives this by
     name; absent that call every plane is on, which is the top tier. */
  group.userData.setDetail = (n) => {
    const k = n == null ? PLANES.length : n;
    for (let i = 0; i < group.children.length; i++) group.children[i].visible = i < k;
  };
  group.setDetail = group.userData.setDetail;

  return group;
}
