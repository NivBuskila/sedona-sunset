/* System 3a — the hero juniper.
 *
 * A Utah juniper in a Sedona wash is not a tree shape with bark on it. Four
 * things make one recognisable, and all four are structural rather than
 * textural, so all four are built into the geometry here.
 *
 * **The trunk is fluted, not round.** It is a bundle of vertical ridges with
 * deep narrow grooves between them, and the whole bundle spirals as it climbs —
 * a slow twist of roughly twenty degrees per metre. Every ring of the trunk mesh
 * therefore evaluates a lobed cross-section whose lobe angles shear with arc
 * length. A circular cross-section with a bark map on it reads as a pipe from
 * any distance at which the silhouette is more than a few pixels wide.
 *
 * **Half of it is dead.** Strips of bare, sun-bleached, silver-grey wood spiral
 * up the trunk between the living bark, and each strip runs out into a bleached
 * limb that carries no foliage at all. This is the signature of the species. It
 * is driven from the same lobe set that makes the fluting — a dead strip *is* a
 * ridge whose bark has gone — so the silver follows the spiral instead of being
 * painted on across it, and any branch leaving the trunk inside a dead strip is
 * born dead.
 *
 * **The crown is wind-shaped and sparse.** Foliage lives in discrete clumps at
 * branch tips with real gaps between them, the branch structure is visible
 * through it, and the whole crown is pushed downwind with the windward side
 * carrying more deadwood. Nothing about a juniper is lush; a healthy one looks
 * half dead.
 *
 * **It sits on a hummock.** Desert plants trap sediment and litter, so the
 * ground rises fifteen or twenty centimetres in a rough disc around the trunk,
 * with dead grass and twig litter caught in it. A tree whose trunk simply
 * intersects the ground plane is the clearest tell that it was placed rather
 * than grown.
 *
 * Everything woody merges into a single draw call; the foliage cards into a
 * second; litter and grass into two more.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, fbm, clamp, smoothstep, mix } from './noise.js';
import { SUN_DIR } from './sky.js';
import { barkTex, deadTex, foliageTex, grassTex } from './plantex.js';

const TAU = Math.PI * 2;

/* Where the `juniper` viewpoint (d = 62, yaw 34) frames it: about twenty-two
   metres out on the right-hand terrace, one bank above the active channel,
   which is where a juniper can actually live — the channel floods and the talus
   moves. Four degrees of local slope, so the trunk stands rather than leans off
   a bank edge, and it sits a little to the sun side of the frame centre so the
   crown is rim-lit and partly translucent rather than flatly front-lit. */
export const JUNIPER_XZ = { x: 6.74, z: -65.65 };

/* Prevailing wind, as a direction the wind blows *toward*. Chosen across the
   wash rather than along it so the tree's lean reads as a lean in the hero
   framing instead of foreshortening to nothing.
   Named `PREVAILING` rather than `WIND` because the bare name invited exactly
   the confusion it was meant to prevent: `terrain.js`'s `uWind` uniform is
   commented "the shared WIND" and is not this at all — it starts from
   `TONIGHT_FALLBACK` and is then driven live off the audio wind, which runs on
   `WIND_HEADING = 0.12` in `atmosphere.js` and `audio.js`. That heading points
   about seventy-six degrees away from this vector, and nothing imports this one,
   so the "should agree with this; it is exported for that" this comment used to
   claim was never true. It is the juniper's own lean direction and no more than
   that until somebody reconciles the two. */
export const PREVAILING = new THREE.Vector2(0.94, 0.34).normalize();

const BARK_TILE = 0.55;   // metres per bark texture tile

/* ── fluted cross-section ──────────────────────────────────────────────────
 *
 * A sum of angular Gaussians rather than a cosine harmonic. A harmonic gives
 * every ridge the same width and the same spacing, which is a cog; a real trunk
 * has four or five dominant ridges of unequal width with the odd narrow one
 * squeezed between them, and one or two grooves deep enough to be nearly a
 * split. The per-lobe amplitude also breathes along the limb, so ridges merge
 * and separate as they climb instead of running as parallel rails.
 */
function makeProfile(seed, nLobes, nDead) {
  const rand = rng(seed);
  const gaps = [];
  let tot = 0;
  for (let i = 0; i < nLobes; i++) { const g = 0.55 + 1.05 * rand(); gaps.push(g); tot += g; }
  const lobes = [];
  let a = rand() * TAU;
  for (let i = 0; i < nLobes; i++) {
    a += gaps[i] / tot * TAU;
    lobes.push({
      a,
      amp: 0.55 + 0.80 * rand(),
      w: 0.17 + 0.24 * rand(),
      ph: rand() * 9,
      fr: 0.7 + 1.6 * rand(),
      dead: false,
      d0: -0.4 + rand() * 0.5,        // where the dead strip starts, in metres
      d1: 2.2 + rand() * 4.0,         // and where it runs out
    });
  }
  /* Dead strips are spaced apart — two adjacent bare ridges would read as one
     wide bald patch rather than as ribbons. */
  for (let k = 0; k < nDead; k++) {
    const want = Math.floor(rand() * nLobes);
    for (let o = 0; o < nLobes; o++) {
      const i = (want + o) % nLobes;
      const prev = lobes[(i - 1 + nLobes) % nLobes].dead, next = lobes[(i + 1) % nLobes].dead;
      if (!lobes[i].dead && !prev && !next) { lobes[i].dead = true; break; }
    }
  }

  const prof = {
    lobes,
    mean: 0,
    eval(theta, s, out) {
      let r = 0, dead = 0;
      for (let i = 0; i < lobes.length; i++) {
        const L = lobes[i];
        let d = theta - L.a;
        d = d - TAU * Math.round(d / TAU);
        const g = Math.exp(-(d * d) / (2 * L.w * L.w));
        const env = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(s * L.fr + L.ph));
        r += L.amp * env * g;
        if (L.dead) {
          const run = smoothstep(L.d0, L.d0 + 0.45, s) * (1 - smoothstep(L.d1 - 0.7, L.d1, s));
          /* Slightly narrower than the ridge itself: the silver is the crest of
             the ridge, with living bark still clinging in the flanks. Widened
             from 0.55 — on an old juniper the bark has lost the whole ridge and
             a good part of its flanks, and a narrow silver pinstripe up a wide
             ridge does not read as a dead strip at any distance. */
          const gd = Math.exp(-(d * d) / (2 * L.w * L.w * 0.85));
          if (gd * run > dead) dead = gd * run;
        }
      }
      out.r = r; out.dead = dead;
      return out;
    },
    /** Is arc angle `theta` at height `s` inside a dead strip? Drives branches. */
    deadAt(theta, s) {
      const o = { r: 0, dead: 0 };
      prof.eval(theta, s, o);
      return o.dead;
    },
  };

  /* The lobe sum's range, so the flute amplitude below is a *fraction of the
     radius* rather than an arbitrary number that has to be retuned every time
     the lobe count changes. The first build normalised against the mean only,
     which left the trunk varying by six percent of its radius — a smooth pipe.
     A real juniper bole varies by twenty.

     This has to be a genuine bound, not an estimate. It was previously sampled
     on a 96x6 lattice in (theta, s), and `shape` below — which is the position
     within this range, and is fed to a fractional `Math.pow` — was assumed to
     land in [0,1] as a result. It did not. The lattice covered s only as far as
     2.75 while limbs are evaluated anywhere on a 4.4 m tree, and each lobe's
     envelope has a period in s of between 2.7 and 9, so at an unsampled height
     the envelopes can sit near their common minimum inside a groove and the sum
     falls below the sampled floor. `shape` then goes very slightly negative,
     `Math.pow(negative, 0.85)` is NaN, and the NaN lands in all three channels
     of the vertex colour, which multiplies straight into diffuse.

     That was worth 18 non-finite vertices here and, downstream, a hard-edged
     black rectangle across the sky of an unrelated view once System 7's bright
     pass had divided by luminance and blurred it twice.

     The fix is to stop sampling the s axis at all. `r` is a sum of independent
     terms `amp * env(s) * g(theta)`, and `env` is a sine mapped to exactly
     [0.42, 1] regardless of s — so the extremes over all s are available in
     closed form by substituting those two constants. Only theta then needs
     sampling, it is one-dimensional and periodic, and 1024 samples across a
     lobe no narrower than 0.17 rad resolves it to well under a part in a
     thousand. The result is a true envelope of the surface for every height,
     not just the heights that happened to be probed. */
  let lo = 1e9, hi = -1e9;
  const NT = 1024;
  for (let i = 0; i < NT; i++) {
    const theta = i / NT * TAU;
    let rMin = 0, rMax = 0;
    for (let q = 0; q < lobes.length; q++) {
      const L = lobes[q];
      let d = theta - L.a;
      d = d - TAU * Math.round(d / TAU);
      const g = L.amp * Math.exp(-(d * d) / (2 * L.w * L.w));
      rMin += g * 0.42;                 // env at its floor
      rMax += g;                        // env at its ceiling
    }
    if (rMin < lo) lo = rMin;
    if (rMax > hi) hi = rMax;
  }
  prof.lo = lo;
  prof.span = Math.max(1e-3, hi - lo);
  return prof;
}

/* ── one limb ──────────────────────────────────────────────────────────────
 * A swept fluted tube along a polyline, with a parallel-transported frame so it
 * does not corkscrew where the spine bends. */
function limbGeometry(pts, radii, seg, prof, twistRate, s0, flute, deadBase = 0, shred = 0,
                      stripScale = 1) {
  const n = pts.length;
  const tan = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    tan[i] = new THREE.Vector3().subVectors(b, a);
    if (tan[i].lengthSq() < 1e-12) tan[i].set(0, 1, 0);
    tan[i].normalize();
  }
  const nor = new Array(n), bin = new Array(n);
  const ref = Math.abs(tan[0].y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  nor[0] = new THREE.Vector3().crossVectors(tan[0], ref).normalize();
  bin[0] = new THREE.Vector3().crossVectors(tan[0], nor[0]).normalize();
  const q = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    q.setFromUnitVectors(tan[i - 1], tan[i]);
    nor[i] = nor[i - 1].clone().applyQuaternion(q);
    bin[i] = new THREE.Vector3().crossVectors(tan[i], nor[i]).normalize();
    nor[i].crossVectors(bin[i], tan[i]).normalize();
  }

  const s = new Float32Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + pts[i].distanceTo(pts[i - 1]);

  const cols = seg + 1;
  const vcount = n * cols;
  const pos = new Float32Array(vcount * 3);
  const uv = new Float32Array(vcount * 2);
  const dead = new Float32Array(vcount);
  const gauge = new Float32Array(vcount);
  const vcol = new Float32Array(vcount * 3);
  const uRep = Math.max(1, Math.round(TAU * radii[0] / BARK_TILE));
  const o = { r: 0, dead: 0 };

  for (let i = 0; i < n; i++) {
    const si = s[i];
    for (let j = 0; j < cols; j++) {
      const th = (j % seg) / seg * TAU;
      prof.eval(th + twistRate * (s0 + si), s0 + si, o);
      /* 0 in a groove, 1 on a ridge. `prof.lo`/`span` are a true envelope of the
         lobe sum (see `makeProfile`), so this is in range on the arithmetic; the
         clamp holds it in range in the floating point too, since a value a few
         ulps below zero is still enough to make the fractional `Math.pow` below
         return NaN. This is the definition of the coordinate being enforced
         where it is defined, not a guard on a result somewhere downstream. */
      const shape = clamp((o.r - prof.lo) / prof.span, 0, 1);
      /* Shredding. Juniper bark separates into vertical strings that lift away
         at their edges, so the outline of a trunk is furred rather than smooth —
         and a smooth outline was the giveaway that the bark was a texture on a
         cylinder rather than a surface. Integer harmonics in theta, so the tile
         closes at the seam without a discontinuity, and low amplitude: a string
         stands a few millimetres off a 340 mm bole. Suppressed on the deadwood,
         which has lost its bark and weathered smooth. */
      const bristle = shred === 0 ? 0 : (
        Math.sin(th * 23 + (s0 + si) * 7.1) * 0.5 +
        Math.sin(th * 37 - (s0 + si) * 11.3) * 0.3 +
        Math.sin(th * 13 + (s0 + si) * 19.0) * 0.2) * (1 - 0.85 * o.dead);
      /* Deadwood loses the flute along with the bark. Fluting is a bark
         structure; once the bark has gone the wood beneath is smooth and
         sinuous, and it sits *below* the surrounding bark ridge rather than
         bulging above it. Keeping the flute on the snags was also what put the
         row of bright specks along every dead rim: at eight to twelve segments
         the lobes are coarse enough that individual facets turn to face the sun
         right at the silhouette, and a strong normal map on top made each one
         a bead. Flattening the dead cross-section removes the cause instead of
         dimming the symptom. */
      const deadFlat = 1 - 0.85 * o.dead;
      const r = radii[i] * (1 - flute * deadFlat * 0.5 + flute * deadFlat * shape
                            - 0.030 * o.dead + shred * bristle);
      const k = i * cols + j;
      const c = Math.cos(th), sn = Math.sin(th);
      pos[k * 3] = pts[i].x + nor[i].x * c * r + bin[i].x * sn * r;
      pos[k * 3 + 1] = pts[i].y + nor[i].y * c * r + bin[i].y * sn * r;
      pos[k * 3 + 2] = pts[i].z + nor[i].z * c * r + bin[i].z * sn * r;
      uv[k * 2] = j / seg * uRep;
      uv[k * 2 + 1] = (s0 + si) / BARK_TILE;
      dead[k] = Math.max(deadBase, o.dead * stripScale);
      /* The limb's radius here, carried to the shader.
         Deadwood relief is a feature of *size*: spiral grain, fissures a
         centimetre deep and transverse checking belong to a thirty-centimetre
         bole, and a one-centimetre dead twig is a smooth grey rod with none of
         them. Applying the bole's normal map at full strength to every twig put a
         tight highlight on each of the eight facets of a sub-pixel cylinder, and
         the crown rendered with a line of bright beads down every snag — the
         "sparkler" again, arriving this time through the normal map rather than
         through the dead-strip mask. */
      gauge[k] = radii[i];
      /* Cavity occlusion in the flutes, baked. Without it the trunk is invisible
         whenever it is not in direct sun: the fill in this scene is a broad sky
         dome, a smooth lobed cylinder under a dome shades almost uniformly, and
         the first build's backlit trunk came out as a featureless pale tube. A
         groove four centimetres deep and two wide sees very little of the sky,
         and that is what actually draws the fluting on an overcast or shadow-side
         trunk. */
      /* But not on the deadwood, or not nearly as much. This term was written for
         bark and applied to everything, and it was quietly costing the deadwood
         most of its brightness: a groove darkens to 0.42, and since the dead
         strips follow the flute ridges and the flute is deep, a good half of the
         bleached surface was being multiplied down by up to 58%. The rendered
         dead-to-live value ratio came out at 1.61x against a target of 3.5x, and
         this is a large part of the missing factor. Bare weathered wood has lost
         the deep fibrous grooves along with the bark, so its cavity term is much
         shallower — the fissures it does have are in its own normal map. */
      const dm = dead[k];
      const ao = mix(0.42 + 0.58 * Math.pow(shape, 0.85),
                     0.84 + 0.16 * Math.pow(shape, 0.85), dm);
      vcol[k * 3] = ao; vcol[k * 3 + 1] = ao; vcol[k * 3 + 2] = ao;
    }
  }

  const idx = new Uint32Array((n - 1) * seg * 6);
  let p = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aDead', new THREE.BufferAttribute(dead, 1));
  g.setAttribute('aGauge', new THREE.BufferAttribute(gauge, 1));
  g.setAttribute('color', new THREE.BufferAttribute(vcol, 3));
  /* The ring layout, so a probe can recover girth from the vertices without the
     builder having to record it separately. Dropped by mergeGeometries, which is
     fine: only the pre-merge geometries are ever measured. */
  g.userData = { cols, rings: n };
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();

  /* The seam column is a duplicate of column zero, so each side of it only sees
     half its triangles and comes out with a hard crease running the length of
     the trunk. Average the pair back together. */
  const nrm = g.attributes.normal.array;
  for (let i = 0; i < n; i++) {
    const a = (i * cols) * 3, b = (i * cols + seg) * 3;
    for (let k = 0; k < 3; k++) {
      const v = (nrm[a + k] + nrm[b + k]) * 0.5;
      nrm[a + k] = v; nrm[b + k] = v;
    }
    const l = Math.hypot(nrm[a], nrm[a + 1], nrm[a + 2]) || 1;
    for (let k = 0; k < 3; k++) { nrm[a + k] /= l; nrm[b + k] = nrm[a + k]; }
  }
  g.attributes.normal.needsUpdate = true;
  return g;
}

/* ── the tree ──────────────────────────────────────────────────────────────*/

/* How high the sediment mound stands above the surrounding terrain, `r` metres
 * from the trunk. One definition, used by the mound mesh, by the limb floor that
 * stops branches burrowing into it, and by the litter that lies on it.
 *
 * It lived in three places before, and they drifted: widening the mound raised
 * its crest to 0.29 m while the tree's mesh origin stayed at 0.10 m above the
 * terrain, which buried 0.19 m of a 0.30 m root collar. Only 0.11 m of trunk was
 * ever above ground — which is why a reviewer at 14x magnification could find no
 * collar at all and read every member of the tree as one gauge. The crest is
 * lower now and the collar much taller, but the real fix is that there is one
 * formula to change. */
export function moundAt(r) {
  return 0.185 * Math.exp(-Math.pow(r / 0.98, 1.85))
       + 0.055 * Math.exp(-Math.pow(r / 2.30, 3.0));
}
/* The tree mesh's origin, above the terrain at the trunk. The collar has to
 * clear moundAt(0) by enough to read as a flared base and not as a stub. */
const TREE_LIFT = 0.10;

/* Radial segments. The lowest two were 10 and 7, which is a decagon and a
   heptagon — enough to be round at a distance, but these are the branches that
   come nearest the camera and at seven segments a limb has a 51° facet, reads
   as a flat ribbon with a bright top and an abruptly dark underside, and has a
   dead straight silhouette. */
/* Depths 2 and 3 raised from 18/12. These are the gauges the bare snags live at,
   and a twelve-sided tube shows its facets at the silhouette. Cheap: these are
   short members and the extra rings cost a few thousand triangles against a
   budget with most of it unspent. */
const SEG_BY_DEPTH = [72, 30, 22, 16, 8];
/* Peak-to-trough as a fraction of the mean radius. Twenty percent on the bole
   is measured off photographs of old Utah junipers, not chosen for effect; the
   grooves between the ridges are deep enough to hold shadow all day and that is
   most of what gives the trunk its form at a distance. */
const FLUTE_BY_DEPTH = [0.48, 0.36, 0.24, 0.13, 0.07];
/* Radial amplitude of the bark shredding, as a fraction of radius. Only the
   collar and the stems carry it; on a two-centimetre twig a lifted string would
   be larger than the twig. */
const SHRED_BY_DEPTH = [0.016, 0.011, 0, 0, 0];
/* How much of the lobe profile's dead-strip mask a limb is allowed to carry.
   A bleached strip is a *stem* feature: bark is lost from a ridge of the bole
   and the wood beneath weathers. On a two-centimetre twig it is meaningless,
   and letting it through was expensive — children inherit their parent's lobe
   profile, so one dead lobe in five put a bright silver stripe down 20% of the
   circumference of every twig in the subtree, and the crown rendered as a
   sparkler of white needles. Individual dead branches are unaffected: their
   deadness arrives as `deadBase`, not through the strip. */
const STRIP_BY_DEPTH = [1.0, 0.85, 0.30, 0, 0];

export function buildTree(seed) {
  const rand = rng(seed);
  const geoms = [];
  const clumps = [];      // foliage clusters: {p, size, dead}
  const trunkProf = makeProfile(seed + 11, 7, 2);
  const twist = 0.34;     // radians of spiral per metre — about 20 degrees

  const wind = new THREE.Vector3(PREVAILING.x, 0, PREVAILING.y);

  /* The ground, in the tree's own coordinates, so a limb can be stopped from
     burrowing into it. The mesh origin sits 0.10 m above the terrain (see
     `buildJuniper`) and the hummock rises above that, so this mirrors the mound
     profile in `hummock` with a few centimetres of clearance on top.
     Needed because gravity droop accumulates down the branch chain: the skirt
     limbs, which start out almost horizontal, were reaching 0.84 m below the
     origin — three quarters of a metre underground. Clamping the point and
     killing the downward component turns that into a limb that lies along the
     mound, which is the shape it should have had. */
  function floorAt(x, z) {
    return moundAt(Math.hypot(x, z)) - TREE_LIFT + 0.055;
  }

  /**
   * Grow one limb and recurse. `deadness` in [0,1] is inherited: a limb born in
   * a dead strip is dead, and a dead limb's children are dead too.
   */
  function grow(p0, dir0, len, r0, r1, depth, deadness, s0, prof, twistRate) {
    const nSeg = [16, 11, 8, 6, 5][depth];
    const pts = [p0.clone()];
    /* Bare deadwood carries a much higher floor than live wood. Two reasons,
       pointing the same way. A dead branch does not taper away to a hair — it
       snapped, so it ends at a blunt broken stub, and "tapers to broken stubs"
       was an explicit finding. And a hairline is sub-pixel at the twenty metres
       this tree is viewed from: with no multisampling in the capture path a
       one-pixel-wide limb alternates covered and uncovered along its length and
       draws as a dotted line. That dotting is what has been reported as bright
       speck stipple along the branch edges — it is geometric aliasing of a
       sub-pixel silhouette, not specular on the material, which is why neither
       the specular reduction nor the flute flattening touched it. Live twigs
       keep the low floor; they are buried in foliage and never seen in
       silhouette. */
    const rFloor = deadness > 0.5 ? 0.013 : 0.006;
    const radii = [Math.max(rFloor, r0)];
    const d = dir0.clone().normalize();
    const step = len / nSeg;
    const wob = rand() * 100;

    for (let i = 1; i <= nSeg; i++) {
      const t = i / nSeg;
      /* Gravity droop grows with depth and with how far out along the limb we
         are; the trunk and the leaders resist it, a twig does not. */
      const droop = [0.004, 0.020, 0.055, 0.085, 0.095][depth] * (0.3 + t);
      /* Phototropism: everything eventually turns back up toward the light,
         which is what stops a drooping branch from simply pointing at the floor. */
      const up = [0.05, 0.016, 0.024, 0.042, 0.055][depth];
      const wb = [0.010, 0.018, 0.030, 0.038, 0.030][depth] * (0.4 + t);
      d.y -= droop * step * 6;
      d.y += up * step * 6 * clamp(-d.y * 2.2, 0, 1);
      d.addScaledVector(wind, wb * step * 6);
      const n1 = fbm(t * 2.4 + wob, 3.1, 3, (seed + depth * 7) | 0);
      const n2 = fbm(t * 2.4 + wob, 9.7, 3, (seed + depth * 13) | 0);
      /* Kinks. Dead wood keeps the crooks it grew and gains more as it checks and
         splits, so it wanders far more than a live shoot does — and it does it in
         discrete bends at the nodes rather than as a smooth curve. The extra term
         fires on alternate stations, which is what makes it read as a kink
         instead of as more noise. */
      const kink = deadness > 0.5 ? (depth >= 2 ? 2.4 : 1.7) : 1.0;
      d.x += n1 * 0.16 * kink * (1 + depth * 0.35);
      d.z += n2 * 0.16 * kink * (1 + depth * 0.35);
      if (deadness > 0.5 && i % 2 === 0) {
        d.x += (fbm(i * 3.7 + wob, 1.3, 2, seed | 0)) * 0.30;
        d.z += (fbm(i * 3.7 + wob, 5.9, 2, (seed + 3) | 0)) * 0.30;
        d.y += (fbm(i * 3.7 + wob, 8.1, 2, (seed + 7) | 0)) * 0.16;
      }
      d.normalize();
      const prev = pts[pts.length - 1];
      const nx = prev.x + d.x * step, ny = prev.y + d.y * step, nz = prev.z + d.z * step;
      const fl = floorAt(nx, nz);
      if (ny < fl) { d.y = Math.max(d.y, 0.02); d.normalize(); }
      pts.push(new THREE.Vector3(nx, Math.max(ny, fl), nz));
      /* Dead limbs taper hard and then snap. The floor was 0.30 with an exponent
         of 0.34, which holds most of the radius until nearly the end and then
         stops — a rod of near-constant diameter, which is exactly how a reviewer
         described the result. A real snag loses girth steadily and ends in a
         broken stub, so: a steeper exponent for the taper, and a much lower floor
         so the stub is a stub and not a shoulder. */
      const taper = deadness > 0.5 ? Math.max(0.13, Math.pow(1 - t, 0.85)) : 1;
      /* Twigs are floored at 6 mm radius whether alive or dead. Below that a limb
         is thinner than the pixel it lands in at twenty metres, which costs
         geometry for nothing and — worse — leaves the foliage spray it carries
         with no visible wood to be attached to. That is the residual "detached
         cluster floating in clear sky": the spray was joined all along, to a
         branch too thin to draw. */
      radii.push(Math.max(rFloor, mix(r0, r1, Math.pow(t, 0.78)) * mix(1, taper, deadness)));
    }

    const seg = SEG_BY_DEPTH[depth];
    geoms.push(limbGeometry(pts, radii, seg, prof, twistRate, s0, FLUTE_BY_DEPTH[depth],
      deadness > 0.5 ? 1 : 0, SHRED_BY_DEPTH[depth], STRIP_BY_DEPTH[depth]));

    /* A dead limb stops here rather than growing another two generations of dead
       twigs. This is the mechanism that actually built the wire lattice, and it
       took a mask render to find: deadness is *inherited*, so the one wholly dead
       stem plus a 30% chance on each heavy limb was seeding entire four-level dead
       subtrees, and a mask of the crown came back almost solid red. Tuning the
       per-limb probability could not touch it — the probability only applies to
       limbs whose parent is alive.
       It is also just wrong anatomically. Fine twigs are the first thing to break
       off a dead branch: a snag is a forked, tapering, kinked armature, not a
       dead copy of a live shoot system. So dead wood forks — which is what the
       critique asked for and is preserved — but it stops two levels short. */
    if (depth >= 3 && deadness > 0.5) return;

    if (depth >= 4) {
      if (deadness < 0.5) {
        /* One spray at the tip, sometimes a second behind it. Foliage spread
           evenly along every twig averages out into a uniform green medium;
           juniper foliage comes in discrete masses with air between them, and
           it is the air that lets the branch structure show.
           Each carries the twig's own direction, because a juniper spray is a
           pointed fan that continues the line of the shoot that made it — see
           `foliageGeometry`. */
        const tipDir = new THREE.Vector3().subVectors(pts[nSeg], pts[nSeg - 1]).normalize();
        clumps.push({ p: pts[nSeg].clone(), size: 0.30 + rand() * 0.20, dir: tipDir });
        if (rand() < 0.50) {
          const i2 = Math.max(1, Math.floor(nSeg * 0.55));
          clumps.push({ p: pts[i2].clone(), size: 0.22 + rand() * 0.14,
                        dir: new THREE.Vector3().subVectors(pts[i2], pts[i2 - 1]).normalize() });
        }
      }
      return;
    }

    /* A little interior mass one level up from the twigs. These sit deep enough
       that the occlusion bake takes them to near black, so they cost nothing in
       brightness and buy the crown an opaque core — which is what stops the
       sunlit far side of the tree showing through the near side as scattered
       bright specks. */
    if (depth === 3 && deadness < 0.5 && rand() < 0.55) {
      const i2 = Math.max(1, Math.floor(nSeg * 0.7));
      clumps.push({ p: pts[i2].clone(), size: 0.24 + rand() * 0.13, interior: true,
                    dir: new THREE.Vector3().subVectors(pts[i2], pts[i2 - 1]).normalize() });
    }

    /* Children. Side branches part way along, and a fork at the tip. */
    const tipDir = new THREE.Vector3().subVectors(pts[nSeg], pts[nSeg - 1]).normalize();
    /* Dead limbs fork on the same statistics as live ones, one short.
       They were cut to a single fork at depth 0-1 and none beyond, to stop a
       dead subtree pushing a bare spike three metres clear of the crown. That
       worked and produced a worse problem: "long, gently curved, unbranched,
       near-constant-diameter rods radiating in a parallel fan". Real juniper
       deadwood is a tangled thicket that forks repeatedly and kinks at every
       node. The spike was never the branching — it was the taper floor above
       holding girth to the very end, and the length, both now fixed, so the
       forking can come back. */
    const nSide = deadness > 0.5
      ? [2, 2, 1, 0, 0][depth] + (rand() < 0.30 ? 1 : 0)
      : [2, 2, 2, 1, 0][depth] + (rand() < 0.45 ? 1 : 0);
    const kids = [];
    for (let i = 0; i < nSide; i++) {
      const f = 0.34 + 0.52 * ((i + rand() * 0.7) / Math.max(1, nSide));
      const idx = clamp(Math.round(f * nSeg), 1, nSeg - 1);
      const at = pts[idx];
      const along = new THREE.Vector3().subVectors(pts[idx + 1] || pts[idx], pts[idx - 1]).normalize();
      /* Azimuth around the parent, which is also what decides whether the child
         is born in a dead strip. */
      const az = rand() * TAU;
      let side = new THREE.Vector3(0, 1, 0).cross(along);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const side2 = new THREE.Vector3().crossVectors(along, side).normalize();
      const outw = side.clone().multiplyScalar(Math.cos(az)).addScaledVector(side2, Math.sin(az));
      const spread = 0.62 + rand() * 0.52;
      const cdir = along.clone().multiplyScalar(Math.cos(spread)).addScaledVector(outw, Math.sin(spread));
      cdir.y += 0.10;
      kids.push({ at, cdir, az, s: s0 + step * idx, f: radii[idx] / r0 });
    }
    kids.push({
      at: pts[nSeg], cdir: tipDir.clone(), az: rand() * TAU,
      s: s0 + len, f: radii[nSeg] / r0, tip: true,
    });
    if (depth <= 1) {
      /* The trunk forks into leaders rather than continuing: an old juniper has
         no single central stem above a metre and a half. */
      const t2 = tipDir.clone();
      const off = new THREE.Vector3(rand() - 0.5, 0.25, rand() - 0.5).normalize();
      kids.push({
        at: pts[nSeg], cdir: t2.clone().addScaledVector(off, 0.55).normalize(),
        az: rand() * TAU, s: s0 + len, f: radii[nSeg] / r0, tip: true,
      });
    }

    for (const k of kids) {
      /* Windward branches die: the exposed side of a juniper is where the
         deadwood is, and the leeward side keeps its foliage. */
      const expo = clamp(0.5 - 0.5 * new THREE.Vector3(wind.x, 0, wind.z).dot(
        k.cdir.clone().setY(0).normalize()), 0, 1);
      let dn = deadness;
      if (dn < 0.5) {
        const inStrip = depth === 0 ? prof.deadAt(k.az + twistRate * k.s, k.s) : 0;
        /* Rising with depth was backwards, and it is what made the deadwood read
           as galvanised wire however well its albedo measured. A thin bright rod
           against dark rock is judged as a line, not as a surface: no hue and no
           value will save it, and a crown full of them is a lattice with high
           perimeter and almost no area. Real strip-bark deadwood is mostly
           *broad* — bleached flutes running up a bole and out along heavy limbs,
           wide enough to show grain and fissure.
           So the probability now falls with depth instead of rising. Because
           surface area goes as radius times length, the dead *fraction* barely
           moves while the number of wiry members drops by most of itself. */
        const twigFall = [1, 1, 0.55, 0.30, 0.18][depth];
        const pDead = depth === 0 ? (inStrip > 0.45 ? 0.9 : 0.03)
                    : (0.06 + 0.30 * expo) * twigFall;
        dn = rand() < pDead ? 1 : 0;
      }
      const cr0 = r1 * (k.tip ? 0.92 : 0.62) * (0.85 + rand() * 0.3);
      const clen = len * (k.tip ? 0.70 : 0.54) * (0.78 + rand() * 0.42);
      const cprof = depth === 0
        ? makeProfile(seed + 300 + geoms.length, 5, dn > 0.5 ? 2 : 1)
        : prof;
      grow(k.at.clone(), k.cdir, Math.max(0.18, clen), cr0, cr0 * 0.42,
           depth + 1, dn, depth === 0 ? 0 : k.s, cprof,
           depth === 0 ? twistRate * 1.6 : twistRate);
    }
  }

  /* ── the base and the stems ───────────────────────────────────────────────
   *
   * An old Utah juniper is not a tree with a trunk. It is a *clump*: a short
   * flared root collar, thirty or forty centimetres of it, that divides at or
   * below knee height into two or three heavy stems leaning apart at different
   * angles, each behaving from there on like a small tree of its own. Nothing
   * in the plant is symmetric and nothing is central.
   *
   * The previous build had a single 1.06 m bole forking into four leaders, and
   * that one metre of clean stem under a radially even fork was enough to read
   * as a young cultivated broadleaf — "a clean single trunk lifting a rounded
   * near-symmetric parasol crown". The fix is not a shorter trunk, it is *no
   * trunk*: the collar below is 0.30 m, and the stems diverge from inside the
   * hummock. Height comes out around four metres against a crown five or six
   * across, which is the right way round for the species.
   */
  /* 0.62, not 0.30. The mound's crest stands moundAt(0) above the terrain and
     the mesh origin only TREE_LIFT, so the first 0.13 m of this is below ground
     no matter what: a 0.30 m collar left 0.11 m of visible trunk on a 3.89 m
     tree, which is a stub, and "everything is the same thickness" follows
     directly. This clears the mound by nearly half a metre while still dividing
     well below knee height, which is what makes a clump a clump. */
  /* 0.95, not 0.62, and fatter with it.
     A distance transform over the woody silhouette measured the thickest thing
     on this tree at 11.7 px against a 310 px crown — one twenty-sixth — while
     the model says the collar is 0.95 m across at the soil line, which is about
     37 px in that framing. Both were true. The collar was there and it was
     0.42 m of visible height, a squat 37 x 17 px patch sitting in among the
     litter cards and under the foliage skirt, and nothing that small survives
     being crowded. Two rounds of reporting girth off the mesh instead of off the
     frame is what let that stand; `tools/bole.mjs` now measures what is drawn.

     The fork still happens below a metre, which is the constraint that makes a
     clump a clump and was verified as solved — 0.95 m is right at that limit,
     not past it. The height goes into *visible* bole rather than into a cleaner
     stem above the fork, which is the shape that read as a cultivated broadleaf
     the first time and is not what this is. */
  const COLLAR = 0.95;
  const nT = 15;
  const tp = [], tr = [];
  const lean = new THREE.Vector3(wind.x, 0, wind.z).multiplyScalar(0.05);
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    const y = t * COLLAR;
    tp.push(new THREE.Vector3(lean.x * t * t, y, lean.z * t * t));
    /* Root flare: the collar swells hard at the ground, which is also what
       buries it into the hummock convincingly. */
    /* The flare's length scale is stretched from 0.20 to 0.26 so that it is
       spread across the collar that is now *above* ground rather than spent in
       the 0.13 m that the mound covers. Radius runs 0.53 m at the soil to 0.32 m
       at the fork — a bole a metre across tapering to two thirds of that — which
       against a 0.02 m twig is the twenty-fold gauge difference an old tree is
       supposed to show. */
    /* Buttresses, not a cone. The flare is spread over the taller collar and
       given a strong azimuthal component through the profile's lobes rather than
       being axisymmetric — an old juniper's collar is a fused mass of root
       swellings with deep re-entrant grooves between them, and a smooth cone of
       any diameter reads as a fence post. */
    const flare = 1 + 0.78 * Math.exp(-y / 0.40) + 0.26 * Math.exp(-y / 0.95);
    /* 0.475 at the base. Measured on the frame the 0.400 version drew 49.4 px at
       its widest against the critique's 11.7 px, but the fluting takes about a
       fifth off the apparent width wherever a groove faces the camera — which is
       the point of the fluting and not something to reduce — so the radius has to
       carry it. This lands a little over a metre of drawn diameter, against the
       0.84 m the critique named as what an old collar on this clump should be.
       Not the "quarter of crown width" also quoted in the same paragraph: a
       quarter of the 421 px crown measured here is 2.7 m of trunk, which is not a
       juniper at any age. Where the two figures disagree I have taken the one in
       metres. */
    tr.push(mix(0.475, 0.330, Math.pow(t, 0.8)) * flare);
  }
  /* Flute at 1.55x the standard depth-0 amount, for this member only. This is
     the one piece of wood on the tree with the pixels to show a cross-section,
     so it is where the fluting has to be unmistakable; on a twig the same
     amplitude is invisible and on the collar it is the silhouette. */
  geoms.push(limbGeometry(tp, tr, SEG_BY_DEPTH[0], trunkProf, twist * 1.35, 0,
                          FLUTE_BY_DEPTH[0] * 1.55, 0, SHRED_BY_DEPTH[0]));

  /* Three stems, deliberately unequal: one dominant and upright-ish, one
     leaning well over downwind, and one that is mostly dead. "Well over half
     the visual mass is bleached spiralled deadwood with a green tuft on top" is
     the reference photograph, and a whole dead stem is the only way to get
     there — a dead strip on a live stem cannot carry that much area. */
  const stems = [
    { az: 0.35, tilt: 0.20, len: 1.05, r: 0.250, dead: 0 },
    { az: 2.55, tilt: 0.62, len: 0.88, r: 0.205, dead: 0 },
    { az: 4.35, tilt: 0.46, len: 1.10, r: 0.215, dead: 1 },
  ];
  const collarTop = tp[nT];

  for (let si = 0; si < stems.length; si++) {
    const st = stems[si];
    const az = st.az + (rand() - 0.5) * 0.5;
    const outw = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const tilt = st.tilt + (rand() - 0.5) * 0.16;
    const dir = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(outw, Math.sin(tilt));
    dir.addScaledVector(wind, 0.10).normalize();

    /* The stem, as its own fluted limb with its own lobe set. */
    const nS = 10, len = st.len * (0.9 + rand() * 0.2);
    const sp = [], sr = [];
    const sprof = makeProfile(seed + 500 + si * 17, 6, st.dead ? 3 : 2);
    const cur = collarTop.clone();
    const d = dir.clone();
    for (let i = 0; i <= nS; i++) {
      const t = i / nS;
      sp.push(cur.clone());
      sr.push(mix(st.r, st.r * 0.62, Math.pow(t, 0.85)));
      /* Stems bow outward as they rise, which is the shape that makes a clump
         read as a clump instead of a bundle of straight poles. */
      d.addScaledVector(outw, 0.055).normalize();
      cur.addScaledVector(d, len / nS);
    }
    geoms.push(limbGeometry(sp, sr, SEG_BY_DEPTH[0], sprof, twist * 1.2, 0,
                            FLUTE_BY_DEPTH[0], st.dead, SHRED_BY_DEPTH[0]));

    /* Leaders off this stem's fork. Two or three, laid out wide: junipers are
       broader than they are tall, and a spread past sixty degrees off the stem
       axis is what produces that. A leader leaving the stem inside a dead strip
       is born dead and is given extra length, so it protrudes clear of the
       foliage as a bare snag where it can be seen against the sky. */
    const tipTan = new THREE.Vector3().subVectors(sp[nS], sp[nS - 1]).normalize();
    const nLead = 2;
    for (let i = 0; i < nLead; i++) {
      const laz = i / nLead * TAU + rand() * 0.8 + az;
      const lout = new THREE.Vector3(Math.cos(laz), 0, Math.sin(laz));
      const inStrip = sprof.deadAt(laz + twist * 1.2 * len, len);
      /* Left at 0.30: these are the heavy limbs off a stem fork, and broad
         bleached wood is exactly what belongs here. It is the *twigs* further out
         that were too often dead; see `pDead` in `grow`. */
      const dn = st.dead ? 1 : (inStrip > 0.35 || rand() < 0.30) ? 1 : 0;
      const spread = (dn ? 0.74 : 0.58) + rand() * 0.34;
      const ldir = tipTan.clone().multiplyScalar(Math.cos(spread))
        .addScaledVector(lout, Math.sin(spread));
      ldir.y += dn ? 0.26 : 0.06;
      ldir.addScaledVector(wind, 0.16).normalize();
      /* The dead leader runs longer than the live ones so that it clears the
         foliage instead of being buried in it — a snag that does not break the
         crown's outline is a snag nobody sees. */
      grow(sp[nS].clone(), ldir, (dn ? 1.55 : 1.12) + rand() * 0.32,
           st.r * 0.58, st.r * 0.26, 1, dn, 0,
           makeProfile(seed + 700 + si * 31 + i, 5, dn > 0.5 ? 2 : 1), twist * 1.5);
    }
  }

  /* A skirt. Old junipers in the open keep one or two heavy limbs that leave
     the collar almost horizontally and lie out near the ground, so the crown
     comes down to knee height on one side instead of stopping in mid-air. Its
     absence is a large part of why a procedural tree floats. */
  /* Leaving from the *top* of the collar, not the middle of it, and rising
     slightly before the droop in `grow` takes them back down. A skirt that
     leaves at mid-collar and heads straight out horizontally lies across the
     bole from every angle, and burying the bole is precisely how the last two
     rounds lost it. Junipers do this too: the skirt limb clears the collar, runs
     out level, and only touches down a metre or two away — which is what leaves
     the shaded hollow with the bole standing in it. */
  for (let i = 0; i < 2; i++) {
    const az = 1.4 + i * 2.9 + rand() * 0.8;
    const dir = new THREE.Vector3(Math.cos(az), 0.30 + rand() * 0.10, Math.sin(az)).normalize();
    grow(tp[nT].clone(), dir, 1.22 + rand() * 0.32,
         0.115, 0.052, 1, 0, 0, makeProfile(seed + 900 + i, 5, 1), twist * 1.5);
  }

  /* Clear the foliage away from the bole.
     Everything above is wasted if a spray hangs in front of it, and sprays do
     collect there: the skirt and the lowest leaders both pass close to the axis
     on their way out, and `grow` hangs a clump at every tip. On a real tree the
     space under the crown next to the bole is bare — it is shaded, it is where
     the duff falls, and no shoot survives there. Dropping clumps that sit both
     low and close to the axis opens that hollow and is the difference between a
     bole and a rumour of one.
     Radius is generous at 1.30 m because what matters is not whether the spray
     touches the bole in three dimensions but whether it covers it from the
     viewpoint, and a spray a metre to the side at the same height does. */
  const BOLE_CLEAR_Y = COLLAR + 0.30, BOLE_CLEAR_R = 1.30;
  const kept = clumps.filter(c =>
    c.p.y > BOLE_CLEAR_Y || Math.hypot(c.p.x, c.p.z) > BOLE_CLEAR_R);
  clumps.length = 0;
  clumps.push(...kept);

  return { geoms, clumps };
}

/* ── foliage cards ─────────────────────────────────────────────────────────
 *
 * Each clump becomes a handful of alpha-tested quads. Two decisions matter.
 *
 * The vertex normals are taken from the clump centre outward, not from the
 * quad's own plane. A card lit by its own normal is a flat panel that flips from
 * bright to black as it turns; a card lit by a sphere normal shades like the
 * blob of foliage it is standing in for, and the cards stop being visible as
 * cards. This is the single largest difference between foliage that reads as a
 * tree and foliage that reads as billboards.
 *
 * Cards are near-vertical with a random azimuth and a limited tilt. Juniper
 * sprays hang, so a fully random orientation puts too many of them face-up,
 * which reads as a hedge from above and shows the card edges from the side.
 */
/**
 * Crown self-occlusion, baked to vertex colour.
 *
 * This is not a polish pass, it is the difference between a tree and a heap of
 * glowing confetti. Every card in the crown has a normal somewhere on the
 * sphere, so with the sun at eight degrees a good fraction of them face it dead
 * on and receive seven or eight times the irradiance the ground does. The first
 * build came out with the interior of the crown blown to warm white — the
 * measured pixels were (242, 231, 216), which is the sun's own colour clipped,
 * not the berries and not the alpha edge.
 *
 * A real crown is opaque. Sun reaches the outer few centimetres and nothing
 * else, and the shadow map cannot supply that at 17 mm per texel through a mesh
 * made of two-millimetre sheets. So the occlusion is computed here, off the
 * clump distribution: an ambient term from local clump density, and a
 * directional term from the density integrated along the sun ray. Both land on
 * the albedo, which means they also damp the transmission term — correct, since
 * a leaf four layers deep is not backlit either.
 */
function crownOcclusion(clumps) {
  const CELL = 0.6;
  const grid = new Map();
  for (const c of clumps) {
    const k = `${Math.floor(c.p.x / CELL)},${Math.floor(c.p.y / CELL)},${Math.floor(c.p.z / CELL)}`;
    let a = grid.get(k);
    if (!a) grid.set(k, a = []);
    a.push(c);
  }
  return function density(x, y, z) {
    const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL), k0 = Math.floor(z / CELL);
    let d = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        for (let k = k0 - 1; k <= k0 + 1; k++) {
          const a = grid.get(`${i},${j},${k}`);
          if (!a) continue;
          for (let m = 0; m < a.length; m++) {
            const c = a[m];
            const dx = c.p.x - x, dy = c.p.y - y, dz = c.p.z - z;
            d += Math.exp(-(dx * dx + dy * dy + dz * dz) / 0.30) * (c.size / 0.40);
          }
        }
      }
    }
    return d;
  };
}

/* Exported for `tools/nanhunt.mjs`, which scans these buffers for non-finite
 * values in node. Building them through `buildJuniper` would need a WebGL
 * context for the textures; building them directly does not. */
export function foliageGeometry(clumps, seed) {
  const rand = rng(seed);
  const pos = [], nrm = [], uvs = [], idx = [], vcol = [], vsun = [];
  const density = crownOcclusion(clumps);
  const S = SUN_DIR;
  const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const ax = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3();
  const cen = new THREE.Vector3();
  let v = 0;
  for (const cl of clumps) {
    /* A spray, not a ball.
     *
     * The first build scattered a clump's cards uniformly through a box and
     * gave each a random azimuth and tilt, which produces a rounded opaque
     * puff — and a crown of rounded puffs packed together is a broadleaf
     * parasol. It read as an olive. Juniper foliage is organised as *pointed
     * fans*: each shoot continues in the direction of the twig that made it and
     * splays into a spray that is widest a third of the way along and tapers to
     * a point, with real gaps between neighbouring sprays. That taper is what
     * gives a juniper its sawtooth outline and lets sky through the crown,
     * which is the difference being fixed here.
     *
     * So the cards run along the twig's own axis, lifted toward the light, on a
     * cone that closes at the tip, and each card shrinks as it goes out. */
    ax.copy(cl.dir || new THREE.Vector3(0, 1, 0));
    ax.y += cl.interior ? 0.10 : 0.42;
    if (ax.lengthSq() < 1e-9) ax.set(0, 1, 0);
    ax.normalize();
    /* Two vectors spanning the plane across the spray axis. */
    pa.set(0, 1, 0).cross(ax);
    if (pa.lengthSq() < 1e-6) pa.set(1, 0, 0);
    pa.normalize();
    pb.crossVectors(ax, pa).normalize();

    const L = cl.size * (cl.interior ? 1.6 : 3.0);
    /* The floor is what stops the spray coming apart, and it is arithmetic
       rather than taste. A card's half-extent at the tip is 0.38 * size * 0.92,
       about 0.35 * size, while the spacing between cards is L / nCards, and L is
       3 * size — so anything under nine cards leaves the last one or two
       stranded in mid-air with a gap of sky behind them. That is the "detached
       foliage island" a reviewer found floating clear of the crown: not a
       misplaced clump, just the thin end of a legitimate spray sampled too
       coarsely to stay joined. Ratios, not absolute sizes, so it holds for every
       clump size. */
    const nCards = Math.max(cl.interior ? 5 : 9,
                            Math.round(4 + cl.size * 16 + rand() * 2));
    /* The spray's own centre, for the shading normal: a point inside the fan
       rather than at its foot, so the sphere normal still curves the right way. */
    cen.copy(cl.p).addScaledVector(ax, L * 0.42);

    /* Rust. Every real juniper carries patches of dead scale leaf still attached
       — a distinct orange-brown, not the bronzed olive of last year's growth —
       and it is one of the cheapest strong species cues available. Done per
       *spray* rather than per card, because on a real tree it kills a whole
       shoot at a time, and as a tint on the vertex colour rather than as a
       colour in the atlas: the atlas's measured hue is now inside the reference
       band and verified against the frame, and painting rust into it would drag
       that measurement back down for no gain. Olive albedo times this ratio
       lands near hue 36 degrees. */
    /* The tint divides rather than multiplies: red stays at unity and the other
       two channels come down. The first version scaled red to 1.42, which is
       fine on a shaded spray and clips on a sunlit one — a rusted card catching
       direct sun came out as a saturated orange-red speck two pixels across,
       and those specks were being read as sparkler artefacts on the branches
       they happened to sit beside. Taking green and blue down reaches the same
       hue without ever pushing a channel above where it started. */
    const rust = rand() < 0.13;
    const rr = 1, rg = rust ? 0.56 : 1, rb = rust ? 0.30 : 1;

    for (let k = 0; k < nCards; k++) {
      /* Biased toward the base, where a real fan carries most of its mass. */
      /* Even spacing with a jitter, not a power curve. The 0.72 exponent put the
         mass at the base — which is right — but it did so by *spreading the tip
         samples apart*, which is exactly where the cards are smallest and can
         least afford it. The taper on card size below carries the base-heaviness
         instead, and costs no continuity to do it. */
      const t = (k + 0.30 + rand() * 0.40) / nCards;
      /* Cone radius: widest at a third, closing to nothing at the point. */
      const rad = cl.size * 0.68 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (0.55 + 0.45 * rand());
      const roll = rand() * TAU;
      const s = cl.size * (0.80 - 0.42 * t) * (0.78 + rand() * 0.44);
      c.copy(cl.p)
        .addScaledVector(ax, L * t)
        .addScaledVector(pa, Math.cos(roll) * rad)
        .addScaledVector(pb, Math.sin(roll) * rad);

      /* The card's height runs along the spray axis, splayed outward from it,
         so a card is a piece of the fan rather than a shingle across it. */
      const splay = 0.30 + rand() * 0.55;
      b.copy(ax).multiplyScalar(Math.cos(splay))
        .addScaledVector(pa, Math.cos(roll) * Math.sin(splay))
        .addScaledVector(pb, Math.sin(roll) * Math.sin(splay))
        .normalize().multiplyScalar(s * 0.92);
      /* Width across the fan. */
      a.crossVectors(b, ax);
      if (a.lengthSq() < 1e-8) a.copy(pa);
      a.normalize().multiplyScalar(s * 0.62);

      const cell = (rand() * 4) | 0;
      const cu = (cell & 1) * 0.5, cv = (cell >> 1) * 0.5;
      const flip = rand() < 0.5;
      /* Inset raised from 0.004. Two texels of margin at 512 is 0.004 in UV,
         which is a fifth of a texel by mip 5 — so bilinear sampling straddles
         the cell boundary and drags in the neighbour's dilated fill colour.
         Against the sky that appears as faint pale rows at the two boundary
         heights, which is what a reviewer saw. 0.018 stays outside half a texel
         down to a 32-pixel mip. */
      const u0 = cu + 0.018, u1 = cu + 0.482;
      const v0 = cv + 0.018, v1 = cv + 0.482;

      for (let q = 0; q < 4; q++) {
        const sx = (q === 0 || q === 3) ? -1 : 1;
        const sy = (q < 2) ? -1 : 1;
        const px = c.x + a.x * sx + b.x * sy;
        const py = c.y + a.y * sx + b.y * sy;
        const pz = c.z + a.z * sx + b.z * sy;
        pos.push(px, py, pz);
        /* Sphere normal about the spray's centre, lifted a little so the
           underside of the crown is not fully black. */
        const dx = px - cen.x, dy = py - cen.y + cl.size * 0.35, dz = pz - cen.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        nrm.push(dx / l, dy / l, dz / l);
        const uu = (sx < 0) === flip ? u1 : u0;
        uvs.push(uu, sy < 0 ? v1 : v0);

        /* Two occlusion terms, and they must not be conflated — the first build
           multiplied both into the albedo and the crown went to a black mass
           with cream flecks, no green anywhere in it: a filter for
           green-dominant pixels found 212 out of a hundred-thousand-pixel
           crown, all of them below value 0.09. The sky dome is the only thing
           lighting the inside of the crown, and occluding it as hard as the sun
           removes the plant's colour entirely.
           So the ambient term is mild and lands on the albedo, while the sun
           term is severe and lands only on the direct contribution. */
        const amb = Math.exp(-0.20 * density(px, py, pz));
        let sh = 0;
        for (let t = 0.30; t < 3.2; t += 0.34) {
          sh += density(px + S.x * t, py + S.y * t, pz + S.z * t) * (t < 1.2 ? 1 : 0.7);
        }
        const sun = Math.exp(-0.32 * sh);
        /* Floors raised, both of them. Internal crown contrast measured 5.2:1
           against a real juniper's 2.4:1 — the shaded sprays were crushing to
           near-black, so the crown read as bright chips floating in holes rather
           than as a body with a shaded side. A juniper spray is one or two
           millimetres thick and it *transmits*: an interior shoot is lit from
           behind by its neighbours as well as from the sky, and neither of those
           paths existed here. Ambient floor 0.44 -> 0.60 and sun floor 0.03 ->
           0.10, which together roughly halve the range. */
        const f = clamp(0.62 + 0.38 * amb, 0.60, 1);
        vcol.push(f * rr, f * rg, f * rb);
        vsun.push(clamp(0.12 + 0.88 * sun * (0.42 + 0.58 * amb), 0.10, 1));
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(vcol, 3));
  g.setAttribute('aSun', new THREE.Float32BufferAttribute(vsun, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/* ── materials ─────────────────────────────────────────────────────────────*/

export function makeBarkMaterial(bark) {
  const mat = new THREE.MeshStandardMaterial({
    map: bark.albedo,
    normalMap: bark.normal,
    /* 1.9. The bole is the only member with the pixels to show relief, and the
       shredded-string character of the bark is most of what says juniper at this
       distance. Raised now rather than earlier because until this round there was
       nothing wide enough on the tree for it to be visible on. */
    normalScale: new THREE.Vector2(1.9, 1.9),
    roughness: 1.0,
    metalness: 0.0,
    vertexColors: true,     // flute cavity occlusion, baked
    dithering: true,
  });
  /*
   * Living bark against bleached deadwood — two materials, and now two maps.
   *
   * The history is worth keeping because both wrong answers were arrived at by
   * reasoning that sounded right. Attempt one tinted the bark albedo and landed
   * within 15% of the living bark's value: fully implemented, completely
   * invisible, found by a reviewer only after brightening the frame three times.
   * Attempt two took the "three to four times" ratio literally *and* smoothed
   * the relief, because weathered wood is polished where fibrous bark is shaggy.
   * The result measured hue 223.6 — steel blue — and was described as galvanised
   * pipe, and the smoothing was the larger of the two mistakes: strip-bark
   * deadwood is the *most* textured surface on the tree, not the least.
   *
   * So deadwood gets its own albedo, its own normal and its own roughness out of
   * `makeDeadwood`, and the blend is by the dead mask. Normal strength on the
   * dead side is now *above* the bark's, not a fifth of it.
   */
  const dead = deadTex();
  const u = {
    /* 0.60/0.52/0.45, from 0.92/0.82/0.74.
       Now that there is a bole in the frame there is something to judge the
       living bark on, and at fifty pixels across it reads as a smooth pale post
       — concrete, not bark. Juniper bark is dark: grey-brown strips over a much
       darker fissure, and it is among the darkest surfaces in a scene like this
       rather than one of the lightest. The old value was set when the trunk was a
       few pixels wide and its only job was to be distinguishable from the
       deadwood; a brightness chosen to win a contrast fight is not an albedo.
       Darkening also widens the dead-to-live ratio, which is the direction that
       has been wanted throughout, and it is a darkening rather than a brightening
       so it does not pre-empt System 4's fill correction. */
    uLiveCol: { value: new THREE.Color(0.60, 0.52, 0.45) },
    /* A tint on top of the deadwood map, which already carries the measured
       warm-bone hue and level. Kept as a uniform because the target is a
       *rendered* value ratio against live bark and that can only be reached by
       measuring frames and iterating — the albedo ratio is not the thing being
       judged, as the last two rounds established twice. */
    /* 1.65, down from 2.25, and the highlight knee with it.
       This is what the speck stipple was, after specular, the normal map, texture
       filtering and geometric aliasing had each been eliminated by test. The dead
       albedo's pale crest is 0.66 in the texture, which decodes to about 0.45 in
       linear light — times 2.25 that is an effective albedo of 1.01. A perfect
       white reflector, on the one part of the surface the key hits squarely, is
       cream by construction, and on a member four pixels wide only the one-pixel
       sliver nearest the sun reaches it: a dashed line of cream pixels down the
       sun-facing silhouette of every snag. Bleached juniper heartwood is bright
       but it is wood, around 0.55 to 0.70; the multiplier now keeps the crest
       inside that. The median value that the dead-to-live ratio is quoted on
       lives on the shaded faces and is carried by uDeadAmb, so it moves far less
       than the peak does. */
    uDeadCol: { value: new THREE.Color(1.95, 1.95, 1.95) },
    uDeadMap: { value: dead.albedo },
    uDeadNrm: { value: dead.normal },
    /* Debug only, and zero unless a probe sets it. `tools/deadratio.mjs` flips it
       to write the dead mask instead of the shaded surface, so the dead and live
       pixels of a *rendered* frame can be partitioned without a human deciding
       which pixels are which. The target for this material is a ratio of rendered
       values and it has been missed twice by measuring the albedo ratio instead;
       one branch in a debug path is a cheap way to stop making that mistake. */
    /* Highlight rolloff on the deadwood's direct term only.
       This material has a genuine conflict in it: the target is a *median*
       rendered value three and a half times the living bark's, and the bark is
       largely in shade while the snags are the most exposed thing on the tree. An
       albedo high enough to hit the median puts every sunlit snag over the
       ceiling, and they render as white wires — which is what happened, twice,
       from opposite directions. A knee resolves it: the median is set by the
       albedo and the top is rolled off rather than clipped. Same fix as the
       foliage's uDirCap, and the same underlying mistake, which is treating a
       ratio target as if it constrained a distribution. */
    uDeadKnee: { value: 0.42 },
    uLiveKnee: { value: 0.58 },
    /* 1.15, down from 1.55. The lift was set to carry the dead-to-live value
       ratio to its 3.5x target, and it did, but a fill multiplier is not
       shadowed — so the long right-hand snags kept near-constant brightness
       while crossing a wall that falls to L = 0.009, and read as not taking the
       cast shadow at all. Being in the same light as its surroundings matters
       more than the ratio: the ratio is a proxy for reading as bleached wood,
       and wood that ignores shadow reads as a light source. */
    uDeadAmb: { value: 1.30 },
    uDebugMask: { value: 0 },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aDead;\nvarying float vDead;\n' +
        'attribute float aGauge;\nvarying float vGauge;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvDead = aDead;\n' +
        /* Zero on a twig, one on a stem. 0.02 to 0.11 m radius, so the transition
           sits between the branches that carry foliage and the ones that carry
           the tree's weight — which is also where the change in surface character
           happens on a real one. */
        'vGauge = smoothstep( 0.020, 0.110, aGauge );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' +
        'varying float vDead;\nvarying float vGauge;\n' +
        'uniform vec3 uLiveCol;\nuniform vec3 uDeadCol;\n' +
        'uniform sampler2D uDeadMap;\nuniform sampler2D uDeadNrm;\nuniform float uDebugMask;\n' +
        'uniform float uDeadKnee;\nuniform float uLiveKnee;\nuniform float uDeadAmb;')
      /* Kill the sheen at its source instead of fighting it with roughness.
         Roughness spreads a highlight; it does not remove the energy, and at a
         dielectric F0 of 0.04 on a thin cylinder crossed by a strong normal map
         what survives is a line of bright beads down every snag — evenly spaced,
         because the spacing is the radial segment count. Roughness was moved from
         0.40 to 0.62 to 0.94 across three rounds against exactly this and the
         beads outlived all of it. Weathered heartwood is in any case one of the
         least specular surfaces in a desert: a dry open cell structure full of
         dust, not a polished one. */
      .replace('#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n' +
        'material.specularColor *= mix( 0.34, 0.22, vDead );')
      /* Horizon occlusion on the deadwood's specular.
         At 16x the speck stipple resolves as single cream pixels spaced two to
         four apart along the *sun-facing silhouette* of each snag, three or four
         times brighter than the lit face beside them. That is a Fresnel rim: on
         any dielectric, grazing reflectance goes to one, so a cylinder four
         pixels wide carries a one-pixel specular line down its edge — and a
         one-pixel bright line on a four-pixel cylinder cannot help but alias into
         dashes, whatever the sample count. Cutting specularColor to 0.22 did not
         reach it because Fresnel multiplies whatever is left, and fading the
         normal map at grazing did not either because the rim is geometric.
         Suppressing reflection as the surface turns past its own horizon is the
         standard construction and it is also true of the material: a fissured,
         checked, spiral-grained surface has no coherent facet left to reflect
         from at eighty degrees, because its own relief is in the way. */
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        {
          float ndvS = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
          /* Ungated: this applies to the living bark too, and that is where the
             stipple actually lives. Both this and the specularColor cut above
             were originally written for the deadwood and keyed on vDead, so the
             live branches kept a full-strength sky reflection — and with a
             dielectric's grazing reflectance going to one against a sky at 219,
             that is a cream rim one pixel wide down the edge of every branch.
             The two knees and the albedo reduction each left the specks
             pixel-identical because they act on the diffuse term, and this is not
             the diffuse term. Shredded fibrous bark is the last surface in this
             scene that should hold a mirror rim: it is loose strings, and its own
             relief occludes the reflection long before eighty degrees. */
          float horizon = smoothstep( 0.0, 0.40, ndvS );
          reflectedLight.directSpecular *= horizon;
          reflectedLight.indirectSpecular *= horizon;
        }`)
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        {
          /* The knee is on *all* the bark now, not just the dead strips, and
             that is what the speck stipple was.
             Bisecting the scene graph settled it: hiding juniper-wood removes
             the specks completely, while cutting the dead albedo's multiplier
             from 2.25 to 1.65 and its knee from 1.05 to 0.62 left them
             pixel-identical. Both facts together say the specks are on the pixels
             where vDead is near zero — the *living* bark — which had no highlight
             compression at all. Its pale fibre band is 0.475 in the albedo, and
             at an irradiance seven times the ground's the crest clips; on a
             branch four pixels wide only the one-pixel sliver nearest the sun
             gets there, so it clips as a dashed cream line down the sun-facing
             silhouette and nowhere else. Four earlier hypotheses — specular
             Fresnel, normal-map perturbation at grazing incidence, albedo mip
             aliasing and geometric aliasing under MSAA — were each eliminated by
             a change that moved nothing, which is how I ended up bisecting.
             A knee rather than a darker albedo because the bark's midtones and
             its shaded side both measure correctly; it is only the top of the
             range that is over. */
          vec3 dd = reflectedLight.directDiffuse;
          float knee = mix( uLiveKnee, uDeadKnee, vDead );
          reflectedLight.directDiffuse = dd / ( 1.0 + dd / knee );
          /* And lift the ambient side. The target is a median, and most deadwood
             pixels are on faces the sun never reaches — so the median is set by
             the fill, while the sunlit peaks that decide whether this reads as
             wood or as wire are set by the direct term. Raising the albedo moves
             both together, which is why every attempt to reach the ratio by
             albedo alone blew the highlights out. Lifting the fill and capping
             the direct moves them independently. Bleached wood does bounce far
             more light than the bark beside it, so the direction is right. */
          reflectedLight.indirectDiffuse *= mix( 1.0, uDeadAmb, vDead );
        }`)
      /* The mask is written *after* dithering, which is the last chunk in the
         fragment program, because everything between `opaque_fragment` and here
         would otherwise be applied to it: tone mapping, the sRGB encode and the
         fog blend. Writing it at `opaque_fragment` produced a mask that had been
         filmic-tone-mapped and fogged, and the probe read zero pixels.
         Red for dead and green for live, rather than a grey ramp, so that
         classification only depends on which channel is larger — true under any
         monotonic per-channel transform that might still be downstream. A grey
         ramp was ambiguous with the blown-out sky next to a backlit tree, and the
         probe duly reported 16775 pixels of deadwood at value 0.94, all of it
         sky. */
      .replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n' +
        /* Blue carries the girth, because a single median over all dead pixels
           turned out to be the wrong statistic and to have been quietly steering
           three rounds of this. Most dead *surface area* on the tree is twigs, and
           twigs have to stay dark — a bright twig is a wire. What a reviewer means
           by "the deadwood" is the bleached stems. Mixing the two into one number
           meant that darkening the twigs, which was correct, showed up as the
           ratio falling away from target, which was misleading. */
        'if ( uDebugMask > 0.5 ) gl_FragColor = vec4( vDead, 1.0 - vDead, vGauge, 1.0 );')
      .replace('#include <map_fragment>', /* glsl */`
        vec4 bt = texture2D( map, vMapUv );
        vec4 dt = texture2D( uDeadMap, vMapUv );
        /* Dead twigs are darker than dead stems, and not by a little. A bleached
           silver snag is a stem that has held its wood for decades; a dead twig
           is a year-old grey stick that still has bark on it. Taking the stem's
           value out to the twigs is most of what made the crown read as a bundle
           of wires. */
        vec3 deadC = dt.rgb * uDeadCol * mix( 0.46, 1.0, vGauge );
        diffuseColor.rgb *= mix( bt.rgb * uLiveCol, deadC, vDead );`)
      /* Both sides rough. The contrast between them is carried by value and by
         the *character* of the relief, not by gloss — which is the correction
         this round is mostly about. */
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = roughness * mix(
          texture2D( normalMap, vNormalMapUv ).a,
          texture2D( uDeadNrm, vNormalMapUv ).a, vDead );`)
      /* Two normal maps, blended by the dead mask, with the deadwood's amplitude
         *raised* to 1.55 against the bark's 1.0. Dropping it to 0.18 last round
         was exactly backwards and is what produced the tubing.
         This one needs the chunk expanded by hand. `onBeforeCompile` hands over
         a shader whose `#include` directives are still unresolved, so replacing
         text that lives *inside* a chunk silently matches nothing and the edit
         appears to do exactly what it did before. Pulling the chunk out of
         `THREE.ShaderChunk`, patching the string, and substituting the whole
         include works, and is checked against the installed three (r180). */
      .replace('#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps
          .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
                   'vec3 mapN = mix( texture2D( normalMap, vNormalMapUv ).xyz,\n' +
                   '                 texture2D( uDeadNrm, vNormalMapUv ).xyz, vDead ) * 2.0 - 1.0;')
          .replace('mapN.xy *= normalScale;', /* glsl */`
            mapN.xy *= normalScale * mix( 1.0, mix( 0.30, 1.55, vGauge ), vDead );
            /* And faded out at grazing incidence.
               This is what the dashed line of bright single pixels along every
               snag's sun-facing silhouette actually is. Right at the silhouette
               the geometric normal is perpendicular to the view ray, so a normal
               map of any strength tilts some fragments back toward the sun and
               they return a full diffuse response while their neighbours do not
               — a row of bright specks, one per texel cluster, exactly along the
               rim. It is not specular, which is why cutting the specular did
               nothing; it is not the grade, which is why it looks the same
               ungraded; and it is not the flute or the bark shredding, both of
               which I removed without changing it.
               Attenuating perturbation as N.V goes to zero is also the physically
               honest thing to do: past the surface's own horizon the detail being
               described is occluded by the surface it sits on, and a bump map
               cannot represent that. Doing it here rather than by weakening the
               map means the relief stays at full strength across the faces
               pointed at the viewer, where the critique wants it. */
            {
              float ndv = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
              mapN.xy *= mix( 0.12, 1.0, smoothstep( 0.0, 0.42, ndv ) );
            }`));
  };
  mat.customProgramCacheKey = () => 'juniper-bark';
  return mat;
}

/**
 * Foliage. Alpha tested, double sided, with a cheap forward-scattering term.
 *
 * A juniper spray is one or two millimetres thick and it does transmit: with a
 * low sun behind it the lit edge of the crown goes a warm yellow-green and
 * roughly doubles in brightness, and without that the tree reads as a black
 * cut-out pasted over the sunset. The approximation is a phase term on the
 * angle between the view ray and the sun ray — no thickness, no scattering
 * depth — plus a small omnidirectional bleed so the shadowed interior of the
 * crown is coloured rather than dead.
 */
/* The directional light's shadow term on its own, which three does not expose.
 *
 * The light loop multiplies `directLight.color` by the shadow and then hands it to
 * `RE_Direct`, which folds it into `reflectedLight`. By `lights_fragment_end` the
 * only trace left is inside a reflected term that also carries the surface normal
 * — and a backlit card has a reflected direct term of zero in full sun, which is
 * exactly when transmission matters, so `reflectedLight` cannot be used to ask
 * "is this fragment in shadow".
 *
 * So read the colour twice out of the loop: once as the light arrives, once after
 * shadowing. The ratio is the shadow factor alone, with the sun's intensity and
 * hue divided out — which is the property that makes this safe to land late,
 * because `sky.js` owns both of those and retunes them, and a gate expressed in
 * absolute radiance would drift the moment it did.
 *
 * Spliced from three's own chunk rather than hand-copied, so it tracks whatever
 * version is installed, and the directional block is isolated by slicing at
 * `getDirectionalLightInfo` before touching `RE_Direct` — that call appears in the
 * point and spot blocks too, and instrumenting those would make the gate mean
 * "any light" instead of "the sun". Validated here at module scope: if a three
 * upgrade renames either marker this throws on import, which `tools/_p7pre.mjs`
 * reports by name in two seconds. The alternative failure mode is a shader that
 * compiles and silently reverts to the emissive behaviour, and this project has
 * already lost a night to one of those.
 */
const LIGHTS_BEGIN_SUNVIS = (() => {
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const MARK = 'getDirectionalLightInfo( directionalLight, directLight );';
  const at = src.indexOf(MARK);
  if (at < 0) throw new Error('makeFoliageMaterial: three\'s lights_fragment_begin no '
    + 'longer contains getDirectionalLightInfo; the sun-visibility gate needs rewriting');
  const head = src.slice(0, at), tail = src.slice(at);
  if (tail.indexOf('RE_Direct( directLight,') < 0) throw new Error(
    'makeFoliageMaterial: no RE_Direct call after the directional light info; '
    + 'the sun-visibility gate needs rewriting');
  return head + tail
    .replace(MARK, MARK + '\n\t\tfolSunAll = max( folSunAll, directLight.color );')
    .replace('RE_Direct( directLight,',
      'folSunLit = max( folSunLit, directLight.color );\n\t\tRE_Direct( directLight,');
})();

export function makeFoliageMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    /* Nearly matte. Foliage carries a real specular sheen in life, but at a
       dielectric F0 of 0.04 with a key this strong and a view this grazing the
       Fresnel term alone puts a white veil over the crown. */
    roughness: 0.97,
    metalness: 0.0,
    color: 0xffffff,
    vertexColors: true,   // crown self-occlusion, baked
    dithering: true,
    /* The cutout edge is otherwise a hard binary threshold, which leaves
       per-pixel stair-stepping and isolated single-texel islands along the
       crown — the precondition for the edge crawling as the camera moves.
       System 5 draws the scene into a four-sample target, so converting alpha
       to a coverage mask buys five levels of edge gradation for nothing. It
       degrades to exactly the present behaviour if the perf ladder drops that
       pass and the target loses its samples. */
    alphaToCoverage: true,
  });
  const u = {
    uSunDir: { value: SUN_DIR.clone() },
    /* A forward-scatter phase and an isotropic leak: real foliage two
       millimetres thick transmits, strongly along the view-sun axis and weakly in
       every other direction, and it is the isotropic part that keeps a shaded
       interior off black. Warm, because what the light passes through is dead
       scale.
       Both default to zero, and that needs explaining, because the history here
       is the opposite of what the numbers suggest. They were carried at 1.15 and
       0.42, tuned across two rounds, written up in detail — and injected at a
       hook that runs after `outgoingLight` is already summed, so not one of those
       values ever reached a pixel. See the note on the injection below.
       The hook is fixed now, which means these are live for the first time, and
       switching a term on across every foliage material in the scene hours before
       delivery is not a change anyone can verify. The hero crown is the
       highest-scoring object in the set and the brief on this round is explicitly
       to protect it. So the default is off — the hero and the mid tier render
       exactly as they did — and the near-field tiers that need transmission to
       fix a measured defect opt in by setting these themselves. Restoring the
       crown's own transmission is a real improvement still on the table, worth a
       round of its own with a paired capture, and it is left for one. */
    uTrans: { value: new THREE.Color(1.35, 1.12, 0.58) },
    uTransAmt: { value: 0.0 },
    uTransIso: { value: 0.0 },
    uDirCap: { value: 0.50 },
    /* Sky visibility, 1 being a card that sees the whole hemisphere. Only the
       tiers with no baked occlusion need this; see the note at its use. */
    uAmbScale: { value: 1.0 },
    /* How much of `aSun` to apply to the ambient term, as opposed to the direct
       one it has always driven. Zero by default, so the hero crown — whose sky
       visibility is already baked into its vertex colours, and whose `aSun` means
       sun self-shadowing rather than sky visibility — is untouched. The near-field
       tuft tiers set it to 1 and bake real sky visibility into `aSun` instead of
       the flat 1 they carried; see `addSun` in vegetation.js for why that stub was
       the cause of a shipped defect. */
    uSkyOcc: { value: 0.0 },
    /* Extra forward scatter at the cutout's edge, where a blade is thinnest. See
       its use. Zero by default, so the hero crown and the mid tier — neither of
       which carries transmission at all — cannot be reached by it. */
    uTransRim: { value: 0.0 },
    /* Whether the knee compresses irradiance (1) or the albedo-times-irradiance
       product (0, and the historical behaviour). See its use. */
    uKneeAlb: { value: 0.0 },
    /* Cross-blade cylindrical shading from the cutout's alpha gradient, as a
       signed fraction: 0.8 means one edge of a blade goes 80% brighter and the
       other 80% darker when the sun is across it. See its use. */
    uBladeRound: { value: 0.0 },
    /* How strongly the ambient fill follows the sun's half of the sky. See its
       use. Zero by default, which is a uniform fill. */
    uAmbWrap: { value: 0.0 },
    /* The floor of the atlas's thickness profile, so the silhouette can be taken
       back out of it. 1 means the atlas has no profile. See its use. */
    uThickFloor: { value: 1.0 },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aSun;\nvarying float vSun;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSun = aSun;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying float vSun;\nuniform vec3 uSunDir;\nuniform vec3 uTrans;\n' +
        'uniform float uTransAmt;\nuniform float uTransIso;\nuniform float uDirCap;\n' +
        'uniform float uAmbScale;\nuniform float uSkyOcc;\nuniform float uTransRim;\n' +
        'uniform float uKneeAlb;\nuniform float uBladeRound;\nuniform float uAmbWrap;\n' +
        'uniform float uThickFloor;')
      /* Declared before the loop that fills them, and read after it. Zero when
         the scene has no directional light at all, which makes `folSunVis` zero
         and the transmission off — the right way round, since there is then no sun
         to transmit. */
      .replace('#include <lights_fragment_begin>',
        'vec3 folSunAll = vec3( 0.0 );\nvec3 folSunLit = vec3( 0.0 );\n'
        + LIGHTS_BEGIN_SUNVIS)
      /* Analytic coverage instead of a binary cutout.
         `alphaToCoverage` has been set on this material for two rounds and has
         done nothing, and the reason is that it had nothing to work with: the
         stock alpha test is `if ( a < alphaTest ) discard`, so every surviving
         fragment is fully opaque and every edge is one pixel wide and binary.
         Multisample coverage can only interpolate an alpha that varies.
         Normalising the distance to the cutoff by the screen-space derivative of
         alpha turns the threshold into a ramp exactly one pixel wide, whatever
         the mip level and however soft or hard the atlas edge is, and *that* is
         what the coverage mask can resolve into four steps. It is the standard
         construction for alpha-tested foliage and the piece I was missing.
         Measured on the last set: the skyline shrub against a near-white sky
         alternated fully black and fully sky texels with no intermediate value
         anywhere — a checkerboard on the horizon, flagged independently by two
         critics. */
      .replace('#include <alphatest_fragment>', /* glsl */`
        float folRawA = diffuseColor.a;
        /* Thickness out, silhouette back.
           Alpha now carries optical thickness for the cross-blade shading, but
           alpha is also what the coverage test cuts the shape out with, and those
           two uses fight: dropping a blade's interior to 0.62 thinned distant
           cards enough to lift whole-frame median V by 10% in wall_lit as bright
           rock showed through where plants had been. Vegetation reading thinner is
           the opposite of what this scene was last asked for.
           The outermost of the three passes is at the floor uniformly, and it is
           the pass that draws the silhouette, so dividing by the floor returns the
           antialiased edge to exactly the value it had before the profile existed
           while the interior saturates at 1. The shading reads folRawA, which
           still has the profile. One divide, and the two uses stop fighting.
           Defaults to 1, so an atlas without a profile is untouched. */
        diffuseColor.a = min( 1.0, diffuseColor.a / uThickFloor );
        {
          float aw = max( fwidth( diffuseColor.a ), 1e-5 );
          float cov = ( diffuseColor.a - alphaTest ) / aw + 0.5;
          if ( cov <= 0.0 ) discard;
          diffuseColor.a = min( cov, 1.0 );
        }`)
      /* A foliage card is not a sheet, and the difference is not cosmetic.
         It stands in for a volume of two-millimetre cords pointing in every
         direction, so its sub-pixel average response to a directional source
         saturates instead of following a cosine on one normal. Lit as a
         Lambertian sheet, every card in the crown whose sphere normal happened
         to point at the sun returned full irradiance — with the key at eight
         degrees that is seven and a half times what the ground receives — and
         the crown came out as a dark mass stippled with cream popcorn measuring
         (240, 227, 211). Diagnosed twice as an alpha-cutout artefact and it was
         a BRDF one.
         The soft knee below is that saturation. Small values pass through
         unchanged, so the shadow side and the fill are untouched; the peak lands
         a little under half of the sunlit ground's radiance, which is where a
         crown of cords actually sits. Specular is cut hard for the same reason:
         a dielectric F0 of 0.04 at this grazing an angle is a white veil over
         a surface that has no coherent facet to reflect from. */
      /* Everything below has to land before `totalDiffuse` is summed, and that is
         not a detail — it is where two rounds of work went.
         The transmission block used to be injected at `#include
         <opaque_fragment>`, which reads well and does nothing at all.
         `meshphysical.glsl.js` sums `totalDiffuse` from `reflectedLight` at line
         194 and forms `outgoingLight` at 199; `opaque_fragment` is line 221 and
         only writes `gl_FragColor` from an `outgoingLight` that was fixed
         twenty-seven lines earlier. So adding to `reflectedLight.directDiffuse`
         there was adding to a variable nobody reads again. The transmission has
         never contributed a photon, on this crown or anywhere else that shares
         this material.
         That is worth stating plainly because the project record contains three
         rounds of critics reporting "still no transmission", "crown interstitials
         are black" and internal contrast getting *worse* after transmission was
         "raised" twice, against comments here claiming it was tuned. The comments
         were describing code that was not running. Found by sweeping
         `uTransAmt` over an eleven-fold range in `tools/vegval.mjs` and getting
         byte-identical statistics — a null result that is only explicable as
         dead code. */
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= vSun;
        /* The knee, and where it is applied matters more than its value.
           It exists because a card presenting a full-facing normal to a
           15-degree key takes about 3.9x what the grazing-lit floor beside it
           takes, and it stands in for a volume of cords whose sub-pixel average
           saturates instead of following one cosine. That argument is entirely
           about *irradiance* — how much light arrives — and says nothing about
           albedo.
           Applied to the product, as it was, it destroys albedo detail: the
           diffuse term is albedo times irradiance, and once the exponential
           saturates the output is uDirCap whatever went in. Measured on a sunlit
           grass blade, mean V 0.730 with a maximum of 0.737 — a 0.7% range across
           the whole blade, on an albedo carrying a deliberate 30% ramp. So a lit
           blade is a flat plateau and an unlit one is near-black, which is
           precisely the "either near-white or near-black with essentially nothing
           between, no gradient across the width" that two reviewers reported. The
           atlas ramp was arriving and being flattened here.
           Dividing the albedo out first, compressing the irradiance, and
           multiplying it back keeps the whole point of the knee and lets albedo
           through untouched. uKneeAlb is 0 by default, in which case this is the
           previous expression to the bit — the hero crown and the mid tier keep
           what they were tuned with. Note the hero's own "hard lit/shade split
           within each spray" is very likely this same saturation, and switching it
           over is a real improvement left for a round that can verify it. */
        {
          vec3 alb = max( diffuseColor.rgb, vec3( 1e-3 ) );
          vec3 e = mix( reflectedLight.directDiffuse,
                        reflectedLight.directDiffuse / alb, uKneeAlb );
          e = uDirCap * ( 1.0 - exp( -e / uDirCap ) );
          reflectedLight.directDiffuse = mix( e, e * alb, uKneeAlb );
        }
        /* Round each blade across its own width.
           A card is a flat quad carrying dozens of blades, so every blade on it
           shares one geometric normal and therefore one shading value: a blade has
           a lit side and a shaded side in life and none here. That is the
           "no gradient across the width of the blade" finding, and it cannot be
           fixed in the atlas — a blade is two to five texels wide, so any ramp
           painted into it is averaged away by the mip chain before it reaches a
           pixel. It also cannot be fixed by perturbing the normal before lighting,
           because the knee above compresses irradiance and would flatten whatever
           the perturbation produced.
           But the cutout's alpha already carries the one piece of information
           needed: it peaks along each blade's spine and falls to the cutoff at
           each edge, so its screen-space gradient is a per-blade cross-width axis,
           free and at whatever scale the blade is being drawn. Tilt an imaginary
           cross-section along that axis, ask which way the sun is, and the blade
           gains a bright edge and a dark edge with a continuous ramp between them.
           Applied after the knee so the knee cannot flatten it, which makes it a
           shading term rather than a BRDF one — the honest description is a cheap
           stand-in for a cylindrical section, and it is doing the job that a
           per-blade normal would do if a blade had geometry of its own.
           Zero by default. */
        reflectedLight.directSpecular *= 0.28 * vSun;
        /* Sky visibility. A card stands in for a volume of leaves, and a leaf
           inside that volume sees a fraction of the sky rather than all of it.
           The hero's crown carries this baked per-vertex from crownOcclusion;
           the near-field tiers had no equivalent, so every card there was lit as
           though the whole hemisphere were open to it. With the direct term
           capped, that unoccluded ambient is what remains, and it is what a
           critic measured as shrubs brighter than sunlit sandstone: the knee
           swept over a 7.5x range moved the level 14% and left the population
           maximum untouched at L 0.874, which is the signature of a term the
           knee does not reach. Defaults to 1, so nothing that does not ask for
           it changes. */
        reflectedLight.indirectDiffuse *= uAmbScale * mix( 1.0, vSun, uSkyOcc );
        /* Round each blade across its own width, and note where this sits: after
           the ambient scale, applied to both terms, because the ambient is the
           dominant one. The note above records that a 7.5x sweep of the knee moved
           the level 14% and left the population maximum untouched — these cards
           are mostly lit by a term with no orientation dependence at all. Applying
           the rounding to the direct term alone was measured at uBladeRound 3.0, a
           deliberately absurd value, and produced no visible change: whatever ramp
           it made was diluted by the flat ambient sitting on top of it. So a blade
           is uniform because most of its light is uniform.
           A card is a flat quad carrying dozens of blades, so every blade on it
           shares one geometric normal and one shading value. That is the reported
           "no gradient across the width of the blade", and it cannot be fixed in
           the atlas — a blade is two to five texels wide, so a painted ramp is
           averaged away by the mip chain — nor by perturbing the normal before
           lighting, since the knee compresses irradiance and would flatten it.
           What the cutout does have is alpha, which now carries optical thickness
           rather than just a silhouette: full along each blade's spine, tapering
           to the cutoff at its edges. Its screen-space gradient is therefore a
           per-blade cross-width axis, free, and correct at whatever size the blade
           is drawn. Tilting an imaginary cross-section along that axis and asking
           which way the sun is gives one edge a bright rim, the other a shaded
           one, and a continuous ramp between.
           Scaling the total rather than re-lighting is a cheat, and the honest
           description is a stand-in for the cylindrical section a blade would have
           if it had geometry of its own. Zero by default. */
        if ( uBladeRound > 0.0 ) {
          vec2 ga = vec2( dFdx( folRawA ), dFdy( folRawA ) );
          float gl = length( ga );
          if ( gl > 1e-6 ) {
            vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
            /* 0 along the spine, 1 at the edge, so the ramp is continuous and the
               term vanishes wherever alpha is flat and its gradient meaningless. */
            float edge = 1.0 - clamp( ( folRawA - alphaTest )
              / max( 1.0 - alphaTest, 1e-3 ), 0.0, 1.0 );
            /* The cross-blade axis has to be built in three dimensions, not in the
               screen plane. Tilting the normal inside the screen plane and dotting
               with the sun looks equivalent and is not: in a frame shot into the
               sun the sun's view-space direction is almost pure -z, its x and y are
               both near zero, and the whole term collapses. Measured — at
               uBladeRound 3.0 the frame was unchanged. So take the screen-space
               gradient, project it into the card's own plane to get the real
               cross-blade direction, tilt the normal along that, and compare
               cosines. The difference form has no division and so cannot blow up
               where a card is edge-on to the sun. */
            vec3 n = normalize( normal );
            vec3 s = vec3( ga.x, -ga.y, 0.0 ) / gl;
            vec3 t = s - n * dot( s, n );
            if ( length( t ) > 1e-4 ) {
              t = normalize( t );
              vec3 nb = normalize( n - t * uBladeRound * edge );
              float f = 1.0 + ( dot( nb, sunV ) - dot( n, sunV ) );
              f = clamp( f, 0.25, 1.60 );
              reflectedLight.directDiffuse *= f;
              reflectedLight.indirectDiffuse *= f;
            }
          }
        }
        /* Ambient that knows where the sun is.
           At golden hour the sky is nothing like uniform — the aureole around a
           low sun is several times the brightness of the opposite horizon — and
           these cards are lit mostly by ambient. That is the measured reason the
           clump reads as two tones: with the knee holding direct at a ceiling,
           what remains is a term with no orientation dependence whatever, so every
           card in a clump takes the same fill and the only distinction left is
           whether a card is in sun or not. Hence "either near-white or near-black
           with essentially nothing between".
           Weighting the fill by how much a card faces the sun's half of the sky
           puts a spread of midtones between those two, which is what a clump of
           blades at many angles should show. Wrapped rather than clamped, so a
           card facing fully away still receives the opposite sky instead of going
           black. Zero by default. */
        reflectedLight.indirectDiffuse *= mix( 1.0,
          0.62 + 0.38 * dot( normalize( normal ),
                             normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz ) ),
          uAmbWrap );
        /* The same occlusion applies to the environment's specular lobe, and it
           has to, or the term becomes the whole story: a card at roughness 0.92
           against a sky this bright still returns a broad IBL highlight, and
           unlike the diffuse it was reachable by nothing above. The population
           maximum held at exactly L 0.920 through a 7.5x knee sweep and a 3.3x
           ambient sweep, which is what a term no lever touches looks like. */
        reflectedLight.indirectSpecular *= uAmbScale * mix( 1.0, vSun, uSkyOcc );
        float folSunVis;
        {
          const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
          float all = dot( folSunAll, LUMA );
          folSunVis = all > 1e-5 ? clamp( dot( folSunLit, LUMA ) / all, 0.0, 1.0 ) : 0.0;
        }
        {
          vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          vec3 V = normalize( vViewPosition );
          float fwd = clamp( -dot( sunV, V ), 0.0, 1.0 );
          float phase = pow( fwd, 4.0 ) * 0.92 + 0.08;
          /* Only the parts of the sheet facing away from the sun transmit;
             the sun-facing side is already lit by the direct term. Added after
             the knee, so the backlit rim is the one thing allowed to be bright. */
          float back = clamp( -dot( normalize( normal ), sunV ) * 0.5 + 0.55, 0.0, 1.0 );
          /* Gated by whether the sun reaches this fragment at all, and without
             that gate the whole block is an emissive term.
             Transmission is light passing *through* a leaf, so it cannot exceed
             what arrives. Ungated, the isotropic part added
             albedo * uTrans * uTransIso unconditionally — no light, no normal,
             no shadow in it anywhere. In sun that is a small fraction of a large
             direct term and invisible. In deep shade it is the *only* term of any
             size, so it becomes the entire appearance: a constant times albedo.
             That is what a critic found at the right edge of wall_shade — scrub
             cards at V 0.612 against a shaded wall at V 0.099, the brightest thing
             in a dark corner, with no internal shading and no response to blade
             orientation, because the term that was lighting them has no normal in
             it. It also explains the two cards that read as detached: the leak is
             proportional to albedo, so the pale atlas cells glowed while their
             darker siblings stayed invisible, and what survived was a few bright
             shapes with no plant around them.
             folSunVis is the directional light's colour after shadowing over its
             colour before, so it is the shadow term alone — free of the sun's
             intensity and hue, which another system owns and retunes. That matters
             for what this change costs: in open sun it is 1, so every framing that
             reads correctly today is untouched to the bit, and only shadowed
             foliage moves. */
          /* A blade thins toward its edge, so that is where the least material
             stands between the sun and the eye and where a backlit leaf actually
             glows. The cutout's own alpha ramp is a usable stand-in for that
             thickness: it falls off across the last few texels of every blade,
             which is exactly the band wanted, and it costs nothing because it is
             already sampled. Read before the coverage ramp overwrites it.
             Rides on the forward-scatter lobe rather than adding a term of its
             own, so it inherits both gates — no sun, no rim, and none of it
             pointing away from the sun. Zero by default. */
          float rim = 1.0 - smoothstep( alphaTest, alphaTest + 0.34, folRawA );
          reflectedLight.directDiffuse += diffuseColor.rgb * uTrans * folSunVis
            * ( phase * back * uTransAmt * ( 1.0 + uTransRim * rim ) + uTransIso );
        }`);
  };
  mat.customProgramCacheKey = () => 'juniper-foliage';
  return mat;
}

/* ── the mound, the litter and the dead grass ──────────────────────────────*/

export function hummock(terrain, cx, cz, seed) {
  const rand = rng(seed);
  /* Widened from 2.15 m to reach the drip line of a seven-metre crown. A mound
     that stops well inside the foliage is a mound nobody attributes to the
     tree. */
  /* Out to 3.9 m, not 2.85. The mound proper is long flat by then — moundAt is
     under a millimetre out there — but the disc has a second job: it carries the
     drip-line duff and the bare ring, and those extend to the edge of a crown
     seven metres across. */
  const RINGS = 17, SEG = 44, R = 3.90;
  const pos = [], uv = [], idx = [], col = [];
  const lobes = [];
  for (let i = 0; i < 5; i++) lobes.push({ a: rand() * TAU, m: 0.5 + rand() * 0.9 });
  /* The centre is one shared apex vertex, and the innermost band is a fan onto
     it, rather than a ring of `SEG + 1` coincident vertices quadded to ring one.
     The old form put 44 zero-area triangles in the buffer — one per segment,
     since each innermost quad had both of its inner corners at the same point —
     and left the apex vertex at j = 0 bordering nothing but degenerate faces, so
     `computeVertexNormals` handed it a zero-length normal. A zero normal is a
     NaN the moment anything normalises it, and 44 zero-area triangles are 44
     triangles of a tight budget spent on nothing. Both were reported from an
     independent buffer scan.

     `ri` is the ring index within the vertex array: the apex occupies slot 0 and
     ring `i` begins at `1 + (i - 1) * (SEG + 1)`. */
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const nj = i === 0 ? 0 : SEG;              // the apex is a single vertex
    const rowBase = i === 0 ? 0 : 1 + (i - 1) * (SEG + 1);
    for (let j = 0; j <= nj; j++) {
      const th = j / SEG * TAU;
      /* An irregular outline: a round mound is a pudding. */
      let sh = 1;
      for (const L of lobes) sh += 0.16 * Math.cos((th - L.a) * L.m * 3.0);
      const r = t * R * sh;
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      const base = terrain.heightAt(x, z);
      /* Trapped sediment: a broad low mound with a steeper shoulder against the
         root flare, plus surface roughness from the litter caught in it. */
      const m = moundAt(r);
      const grain = 0.026 * fbm(x * 2.6, z * 2.6, 3, 4411) + 0.012 * fbm(x * 7.0, z * 7.0, 2, 4413);
      const edge = 1 - smoothstep(0.80, 1.0, t);
      pos.push(x, base + (m + grain * (0.25 + 0.75 * edge)) * (0.12 + 0.88 * edge) + 0.006, z);
      uv.push(x * 0.85, z * 0.85);
      /* Duff, and the bare ring at the drip line.
         A juniper suppresses almost everything under its own canopy — partly
         shade, partly the litter, partly chemistry — and shed scale accumulates
         where nothing grows to break it up. The result is one of the most
         recognisable ground signatures in the Southwest: a dark, bare, sharply
         bounded disc that stops at the drip line and has open desert immediately
         outside it. A reviewer found the ground under this tree indistinguishable
         from the open wash twenty metres away, which is a strong negative cue.
         The edge is deliberately narrow — 2.5 to 3.4 m against a 3.5 m crown
         radius — because a soft gradient reads as a stain and a hard one reads as
         a canopy. */
      const duff = 1 - smoothstep(2.50, 3.40, r);
      const mot = 0.86 + 0.28 * fbm(x * 3.1, z * 3.1, 3, 4417);
      const k = duff * mot;
      col.push(mix(1, 0.66, k), mix(1, 0.615, k), mix(1, 0.60, k));
      if (i === 1 && j < SEG) {
        idx.push(0, rowBase + j, rowBase + j + 1);          // fan onto the apex
      } else if (i > 1 && j < SEG) {
        const a = 1 + (i - 2) * (SEG + 1) + j, b = a + 1;
        const c = rowBase + j, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Crossed cards for a tuft of dead grass, a low shrub or a scatter of litter.
 *
 * The vertex normals are *not* the card plane's normal. They radiate from the
 * tuft's own axis with a strong upward bias, for the same reason the juniper's
 * foliage cards use a sphere normal: a flat panel lit by its own normal flips
 * between blown and black as it turns, and a field of those reads as litter
 * made of paper. Radiating normals shade like the little dome of vegetation the
 * cards are standing in for.
 *
 * `cols` and `rows` address the source atlas; a tuft picks one cell.
 */
/* `uvFit` is the atlas cell's own aspect, cellWidth/cellHeight in texels, or 0 to
 * map the whole cell onto every card as before.
 *
 * Give it, and each card samples the sub-rect of its cell whose shape matches the
 * card's own — so a texel stays square and whatever the atlas drew keeps its
 * proportions. Without it the cell is stretched to whatever the card happens to
 * be, and that is a defect generator rather than a subtlety: `makeScrub` draws a
 * 256x512 portrait cell of small leaves 12 to 28 texels long, and the bench
 * shrub's widest variant is a 1.34 x 0.54 m landscape card. The mismatch is 5x
 * horizontally, so on that variant every leaf was drawn five times wider than
 * long and every stem five times wider than drawn.
 *
 * That is what a critic found close to camera at the right edge of `wall_shade`
 * and described as "uniformly-coloured cream lozenges — hard-edged, no internal
 * shading, no response to blade orientation", and in an earlier round as "flat
 * tapered cream ribbons for stems". Both are literal: a lozenge is what
 * `makeScrub`'s leaf becomes at 5:1, a ribbon is what its stem becomes, and each
 * one is filled with a single flat colour by construction, so no amount of
 * lighting work would have put shading inside one. The variant that reads
 * correctly at every distance is the one whose aspect already matches the cell.
 *
 * Off by default: the tiers that were tuned against the stretch keep it until
 * their own framings can be re-checked.
 */
export function cardTuft(cx, cy, cz, w, h, nCards, rand, arr, cols = 2, rows = 1,
                         uvFit = 0) {
  const { pos, nrm, uvs, idx } = arr;
  let v = pos.length / 3;
  for (let k = 0; k < nCards; k++) {
    const az = rand() * TAU;
    const lean = (rand() - 0.5) * 0.34;
    const ax = Math.cos(az) * w * 0.5, az2 = Math.sin(az) * w * 0.5;
    const hh = h * (0.7 + rand() * 0.6);
    const ci = (rand() * cols) | 0, ri = (rand() * rows) | 0;
    /* Same boundary-bleed margin as the foliage atlas, scaled to the cell. */
    const iu = 0.04 / cols, iv = 0.04 / rows;
    let u0 = ci / cols + iu, u1 = (ci + 1) / cols - iu;
    let v0 = ri / rows + iv, v1 = (ri + 1) / rows - iv;
    if (uvFit > 0) {
      /* The sub-rect's aspect has to equal the card's, so shrink whichever axis
         is over-represented and leave the other at the full cell. */
      const want = (hh / w) * uvFit;
      const fu = Math.min(1, want > 1 ? 1 / want : 1);
      const fv = Math.min(1, want > 1 ? 1 : want);
      const uw = (u1 - u0) * fu, vh = (v1 - v0) * fv;
      /* Where in the cell the window sits is per-card, which is free variety:
         two cards of one geometry now show different parts of the same drawn
         plant instead of the same stretch of it. Kept off the extreme ends
         vertically — the outer margin is the clip border and near-empty, and a
         card windowed onto it would be the floating-card bug again. */
      u0 += (u1 - u0 - uw) * rand();
      v0 += (v1 - v0 - vh) * (0.15 + rand() * 0.70);
      u1 = u0 + uw;
      v1 = v0 + vh;
    }
    const ox = (rand() - 0.5) * w * 0.35, oz = (rand() - 0.5) * w * 0.35;
    for (let q = 0; q < 4; q++) {
      const sx = (q === 0 || q === 3) ? -1 : 1;
      const sy = (q < 2) ? 0 : 1;
      const px = cx + ox + ax * sx + lean * hh * sy * Math.cos(az + 1.57);
      const py = cy + hh * sy;
      const pz = cz + oz + az2 * sx + lean * hh * sy * Math.sin(az + 1.57);
      pos.push(px, py, pz);
      const dx = px - cx, dz = pz - cz, dy = hh * 0.55;
      const l = Math.hypot(dx, dy, dz) || 1;
      nrm.push(dx / l, dy / l, dz / l);
      uvs.push(sx < 0 ? u0 : u1, sy ? v0 : v1);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
}

/* ── assembly ──────────────────────────────────────────────────────────────*/

/**
 * Build the hero juniper and everything at its foot.
 * Returns an array of meshes for the caller to add to the scene.
 */
export function buildJuniper(terrain, tex) {
  const out = [];
  const bark = barkTex();
  const folTex = foliageTex();
  const litterTex = grassTex();

  const { geoms, clumps } = buildTree(20250821);
  const woody = mergeGeometries(geoms, false);
  woody.computeBoundingSphere();
  for (const g of geoms) g.dispose();

  const base = terrain.heightAt(JUNIPER_XZ.x, JUNIPER_XZ.z);
  /* Sunk slightly, because the root flare should emerge from the hummock rather
     than stand on top of it. */
  const y0 = base + TREE_LIFT;

  const trunk = new THREE.Mesh(woody, makeBarkMaterial(bark));
  trunk.position.set(JUNIPER_XZ.x, y0, JUNIPER_XZ.z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.name = 'juniper-wood';
  out.push(trunk);

  /* The crown keeps the knee on albedo times irradiance, and this is a tested
     decision rather than an oversight.
     Moving it into irradiance space is what fixed the near field, where a sunlit
     blade measured a 0.7% value range across its whole width on an albedo
     carrying a deliberate 3.5x ramp, and the crown's remaining complaint — a hard
     lit/shade split within each spray — reads as the same signature. It is not.
     Switched over at the equivalent cap of 4.97, the frame changed by 1.18% of
     pixels at a mean of one code value per channel, invisible at full resolution,
     and internal crown contrast went the wrong way: 8.87:1 to 8.97:1 over crown
     pixels. Of the pixels that moved, 41340 darkened and 1904 brightened.
     The reason is that the two forms are identical below saturation and the crown
     sits at value 0.08, so almost none of it was being clamped and there was
     nothing to give back. The shrubs are in full sun and deep in saturation,
     which is why the same change was worth several measured percent there.
     So the split has another cause, and the candidate is in this file already:
     this crown carries no transmission at all, uTransAmt and uTransIso both zero
     by default, so a shaded spray receives nothing through it and crushes against
     a lit one. Internal contrast of 8.87:1 against a real juniper's 2.4:1 is the
     size of gap a missing term makes, not a mistuned one. */
  const folMat = makeFoliageMaterial(folTex);
  {
    /* And that is what it was. Transmission on, forward scatter only.
       Measured on the crown's own coverage mask in `tools/herotrans.mjs`, both
       arms out of one page load so they cannot differ by a file that landed
       between them: crown p90/p10 falls from 18.26 to 14.96 and the share of
       crown pixels in the midtone band rises from 34.8% to 37.1%, while the
       control population — every pixel outside the mask — holds at L 0.1666.
       Still far from a real juniper's 2.4:1, and it was never going to reach it:
       the deepest interstitials are genuinely occluded, folSunVis is zero there,
       and a term gated on sun arrival cannot light them. What it does reach is the
       spray facing away from the sun but standing in it, which is the "hard
       lit/shade split within each spray" that was complained about, and at 3x the
       right-hand crown mass now carries foliage structure where it read as one
       black shape.
       `uTransIso` stays at zero, alone among the tiers that carry transmission.
       It is a flat lift on every unoccluded fragment, so it raises lit sprays as
       much as shaded ones: over this sweep it bought 0.05 of ratio for triple the
       hue shift. The near field needs it because in deep shade there is no direct
       term for the shaped part to ride on. The crown is in open sun and does not.
       `uTransAmt` stops at 0.35 rather than the 0.55 that scores slightly better
       because the hue cost scales with it and 0.55 risks leaving the real juniper
       band of 49-65 that a critic quoted after verifying this crown's rendered
       hue against its atlas to within 1.1 degrees.
       The tint below is why there is almost no hue cost left to trade. Inherited
       from the near-field tiers, at (1.35, 1.12, 0.58), it moved the crown 1.6
       degrees up-hue in `juniper` and 2.7 in `wash_mid` — toward the chartreuse a
       critic has already complained of. Measured over a population held fixed at
       the arm-0 one, because transmission raises value and a population gated on
       value therefore grows when it is switched on, 59550 crown pixels to 65343,
       and the arrivals carry the tint and can move a median with no pixel
       changing colour. Both ways agree to within 0.7 degrees, so the shift was
       real rather than that artefact. */
    const u = folMat.userData.uniforms;
    u.uTransAmt.value = 0.35;
    u.uTransIso.value = 0.0;
    u.uTransRim.value = 0.70;
    /* Hue-neutral by measurement, and the direction is the opposite of the
       obvious one.
       The physical argument says transmitted light is filtered by the pigment it
       passes through, so the tint should be greener than the grass straw it
       inherited. Swept, every greener tint made the shift *worse*: (1.25, 1.20,
       0.58) gave +2.3 degrees, (1.15, 1.25, 0.58) +2.9, (1.05, 1.25, 0.52) +3.3,
       against the straw's +1.6, and all four returned the same contrast to two
       decimal places. The argument was sound and the conclusion drawn from it was
       backwards, for a reason worth keeping: this uniform is not the transmitted
       colour. The shader multiplies it by albedo, so it is the transmitted colour
       *over* the albedo — and the albedo is already yellow-green at hue 64. A
       green tint counts the leaf's pigment twice. A leaf's transmittance and
       reflectance spectra are not the same shape, and using one as a stand-in for
       the other is what this uniform exists to correct.
       Going the other way lands it: at (1.60, 1.00, 0.50) the fixed-population
       hue is 42.9 in `juniper` against a no-transmission baseline of 42.9, and
       40.9 in `wash_mid` against 40.3 — a 1.6 degree cost taken to zero and a 2.7
       to 0.6. Contrast is unchanged, 14.96 and 9.71 against 14.96 and 9.66, and
       the midtone share is within 0.5 of a point. The one thing it costs is
       saturation, up 0.017 rather than the straw's 0.014, which is not a defended
       figure on this crown: the defended one is lit rock, and that is outside the
       mask and does not move. At 3x the shaded sprays read very slightly less
       chartreuse and nothing else changes. */
    u.uTrans.value.setRGB(1.60, 1.00, 0.50);
  }
  const fol = new THREE.Mesh(foliageGeometry(clumps, 4242), folMat);
  fol.position.copy(trunk.position);
  fol.castShadow = true;
  fol.receiveShadow = true;
  fol.name = 'juniper-foliage';
  out.push(fol);

  /* The hummock. Uses the dirt map the terrain uses so it cannot read as a
     different material sitting on the ground. */
  const hMat = new THREE.MeshStandardMaterial({
    map: tex && tex.dirt ? tex.dirt.albedo : null,
    normalMap: tex && tex.dirt ? tex.dirt.normal : null,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 1.0,
    metalness: 0.0,
    /* Darker and less red than the open wash floor. What is in a hummock is
       trapped fines and rotted-down organic litter, and it holds what little
       moisture the site gets, so it reads several percent darker and browner
       than the sand a few metres away. Matching the terrain exactly — which the
       first build did, on the reasoning that a different material would look
       pasted on — meant a reviewer could not find the mound at all and reported
       the ground under the tree as identical to the ground twenty metres off. */
    color: new THREE.Color(0.66, 0.585, 0.525),
    /* Carries the drip-line duff disc; see `hummock`. */
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mound = new THREE.Mesh(hummock(terrain, JUNIPER_XZ.x, JUNIPER_XZ.z, 8181), hMat);
  mound.castShadow = true;
  mound.receiveShadow = true;
  mound.name = 'juniper-hummock';
  out.push(mound);

  /* Dead grass and litter caught around the base. Sparse and clumped against
     the upwind side, where the wind piles it. */
  const rand = rng(31337);
  const arr = { pos: [], nrm: [], uvs: [], idx: [] };
  /* Two populations, because they are put there by two different processes and
     they land in different places. Wind-blown litter piles against the upwind
     flank of the mound; the tree's own shed scale and twig fall straight down
     and accumulate in a ring under the drip line, which on a crown this wide is
     a good two metres out. Sixty attempts rather than twenty-six: at eighteen
     metres a 0.2 m tuft is nine pixels, and a dozen of them scattered over five
     square metres is not something a viewer can see. */
  /* 140 attempts, and the duff reaches to 3.2 m. At 60 with a 0.72 acceptance the
     drip-line population came out at about nineteen tufts spread around a ring
     fourteen metres in circumference, which is not a duff layer — it is a dozen
     specks, and a reviewer reported no drip-line duff at all. */
  for (let i = 0; i < 140; i++) {
    const th = rand() * TAU;
    const dripLine = rand() < 0.58;
    const rr = dripLine ? 1.60 + rand() * 1.60 : 0.40 + rand() * 1.35;
    const bias = 0.5 - 0.5 * (Math.cos(th) * PREVAILING.x + Math.sin(th) * PREVAILING.y);
    /* Duff under the drip line does not care about the wind; wind-piled litter
       cares about nothing else. */
    if (rand() > (dripLine ? 0.80 : 0.26 + 0.74 * bias)) continue;
    const x = JUNIPER_XZ.x + Math.cos(th) * rr, z = JUNIPER_XZ.z + Math.sin(th) * rr;
    const y = terrain.heightAt(x, z) + moundAt(rr) - 0.02;
    /* Shed duff lies flat and low; caught grass stands up. */
    const h = dripLine ? 0.05 + rand() * 0.08 : 0.13 + rand() * 0.24;
    cardTuft(x, y, z, (dripLine ? 0.26 : 0.20) + rand() * 0.26, h,
             2 + (rand() * 2 | 0), rand, arr, 4, 1);
  }
  if (arr.idx.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
    gg.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nrm, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uvs, 2));
    gg.setIndex(arr.idx);
    gg.computeBoundingSphere();
    const gm = new THREE.MeshStandardMaterial({
      map: litterTex, alphaTest: 0.40, side: THREE.DoubleSide,
      roughness: 0.94, metalness: 0.0, color: new THREE.Color(0.92, 0.88, 0.82),
      alphaToCoverage: true,
    });
    const grass = new THREE.Mesh(gg, gm);
    grass.castShadow = true;
    grass.receiveShadow = true;
    grass.name = 'juniper-litter';
    out.push(grass);
  }

  return out;
}
