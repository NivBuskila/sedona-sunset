/* Clasts: everything loose lying on the wash floor and piled at the foot of the
 * walls.
 *
 * Three things about real wash sediment drive the whole design here.
 *
 * It is *sorted*. A flood grades its load by energy, so a wash floor is a map of
 * the last flood: a coarse cobble lag down the thalweg and at the heads of point
 * bars, a fine sand sheet in the slack water on the inside of bends, angular
 * unsorted blocks in the talus, weathered pavement on the abandoned terrace, and
 * scoured patches with nothing on them at all between the lot. Density is never
 * constant. Placement therefore reads `Terrain.facies`, which is derived from
 * the same cross-section the geometry was built from.
 *
 * It is *lithologically mixed*. Sedona washes carry grey Fort Apache limestone,
 * off-white Coconino, dark basalt off the Rim and buff chert alongside the local
 * red sandstone — the off-white boulders sitting on red soil are one of the
 * things people notice first. So the clast texture is deliberately neutral and
 * every scrap of colour comes from a per-instance tint.
 *
 * It is *fractured as well as rounded*. Water-worn cobbles are smooth; talus
 * that fell off a sandstone wall last winter is angular, with flat facets and
 * sharp arêtes. Both are here, from different generators.
 *
 * Everything is instanced — one draw call per (class, shape variant).
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { rng, fbm, clamp, mix } from './noise.js';
import { SUN_DIR } from './sky.js';

/* ── shapes ────────────────────────────────────────────────────────────── */

/**
 * A white per-vertex colour attribute, which sounds pointless and is not.
 *
 * three writes `instanceColor` into `vColor` in the vertex stage under
 * `USE_INSTANCING_COLOR`, but `color_fragment` only multiplies it into the
 * albedo under `USE_COLOR`. So an InstancedMesh with `setColorAt` and no
 * `vertexColors` silently discards every tint — which is how a lithologically
 * mixed clast field renders as one flat cream rock. Turning `vertexColors` on
 * fixes the fragment side, but then the vertex stage also multiplies by the
 * `color` attribute, which would be an undefined attribute reading as black.
 * Hence: an explicit white one.
 */
function addWhite(g) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * Per-face box UVs, because ConvexGeometry ships position and normal only.
 *
 * Not spherical. A spherical wrap sets v from y alone, so on a tabular clast —
 * which is most of them, since bedded rock breaks into slabs — the whole broad
 * face sits at very nearly one v and samples a single row of texels stretched
 * across it. The result is a plate covered in hard parallel stripes, which is
 * where the corrugated-cardboard look on the slabs came from. Projecting each
 * facet along whichever axis it faces keeps the texel density roughly uniform and
 * roughly isotropic on every face.
 *
 * The hull is non-indexed, so each triangle owns its three vertices and can be
 * given its own projection without splitting anything.
 */
function addUV(g) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    e1.subVectors(b, a); e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let s, t;
      if (ay >= ax && ay >= az) { s = v.x; t = v.z; }
      else if (ax >= az) { s = v.z; t = v.y; }
      else { s = v.x; t = v.y; }
      uv[(i + k) * 2] = s * 0.5 + 0.5;
      uv[(i + k) * 2 + 1] = t * 0.5 + 0.5;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A water-worn clast: an icosahedron pushed around by noise. Smooth. */
function roundedClast(detail, seed, flatten) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    const lump = fbm(n.x * 1.5 + seed, n.z * 1.5 - seed, 3, (seed * 17) | 0);
    const facet = fbm(n.x * 4.2 - seed, n.y * 4.2 + seed, 2, (seed * 29) | 0);
    v.copy(n).multiplyScalar(1 + lump * 0.30 + facet * 0.12);
    v.y *= flatten;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return addWhite(g);
}

/**
 * A fractured block: the convex hull of a jittered box plus a few bevel points.
 * The hull is what buys the thing the project has been missing entirely — flat
 * facets, straight arêtes and right-angle corners. Rock is defined by fracture,
 * and no amount of smooth noise will ever produce a fracture.
 */
function angularClast(seed, flat, bevel) {
  const rand = rng(seed);
  const pts = [];
  const ax = 1.0, ay = flat, az = 0.78 + rand() * 0.42;
  /* Corners pulled in hard and unevenly. At ±20 percent the hull of a jittered box
     is still a box — six large near-planar faces meeting at right angles — and any
     box over about half a metre reads as masonry rather than as fallen rock. At
     this spread the corners no longer describe a cuboid and the hull comes out an
     irregular polyhedron: still angular, still faceted, no longer manufactured. */
  for (let i = 0; i < 8; i++) {
    pts.push(new THREE.Vector3(
      ((i & 1) ? 1 : -1) * ax * (0.52 + rand() * 0.58),
      ((i & 2) ? 1 : -1) * ay * (0.52 + rand() * 0.58),
      ((i & 4) ? 1 : -1) * az * (0.52 + rand() * 0.58)));
  }
  /* Extra points sampled on the *surface* of the box with radial jitter. Eight
     corners alone hull into a plain cuboid — six enormous planar faces — and a
     metre of rock shaded as one flat plane reads as folded card however it is
     coloured. These split each face into several facets at slightly different
     angles, which is how a spall surface stepped by the bedding it broke along
     actually catches a low sun. */
  for (let i = 0; i < bevel; i++) {
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1, dz = rand() * 2 - 1;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const t = 1 / Math.max(Math.abs(dx) / ax, Math.abs(dy) / ay, Math.abs(dz) / az);
    /* Pushed out to straddle the box surface rather than sitting inside it. At
       0.70 to 1.10 most of these landed *within* the hull the eight jittered
       corners already describe, so they contributed no vertex and the hull stayed
       six big planes however many were requested — which is why a slab with
       thirty-four bevel points still presented one featureless quadrilateral to
       the camera. A convex hull only takes its extreme points, so a bevel point
       has to be reliably outside its neighbours to become a facet at all. */
    /* Pushed out again, from 0.90-1.16 to 0.99-1.23, and the reason is the same
       one written above only carried further. A convex hull takes its extreme
       points, so a bevel point inside its neighbours contributes nothing; at
       0.90 a good half of them still landed within the hull the eight jittered
       corners already describe, and the loss is worst on the *equant* classes,
       where the corner hull is largest. That is why a boulder with thirty-eight
       bevel points was still presenting four facets the size of a table top two
       metres from the camera, which is the flat-card read the slab class was cut
       down for once already. Starting essentially at the box surface makes
       almost every requested point a facet. */
    const j = t * (0.99 + rand() * 0.24);
    pts.push(new THREE.Vector3(dx * j, dy * j, dz * j));
  }
  const g = new ConvexGeometry(pts);
  addUV(g);
  addWhite(g);
  g.computeBoundingSphere();
  return g;
}

/* ── lithology ─────────────────────────────────────────────────────────── */

/* Target linear albedo divided by the neutral clast texture's mean, so these
   are straight multipliers on it. */
/* Spread wide in *chroma*, and deliberately narrow in value.
 *
 * The two things being traded off here pull in opposite directions and both were
 * got wrong in turn. A wash floor's saturation distribution has a long tail — a
 * real one measures a mean near 0.50 and a 99th percentile near 0.88 — and that
 * tail cannot come from the matrix, because raising the matrix uniformly is just
 * the orange membrane again. It has to come from individual clasts: genuinely
 * iron-stained red ones, orange mud-coated ones, desert-varnished dark ones, pale
 * quartz sand between them.
 *
 * But *value* spread is what destroyed the midground. A near-black basalt pebble
 * beside a near-white quartz one, both two pixels across, is a black-and-white
 * hash however it is filtered — the previous palette ran from 0.11 to 0.94, a
 * nine-to-one luminance range, and that range was the hash. Chroma spread costs
 * nothing in the same way, because saturation differences survive averaging
 * gracefully: average a red stone with a grey one and you get a duller red, which
 * is the right answer.
 *
 * So: value compressed into roughly a three-to-one range, chroma pushed much
 * wider than before, and the extremes of both ends of the value range deleted.
 * The varnished pebbles are dark grey-brown rather than black; a real desert
 * varnish measures around 0.08 reflectance but nothing in a photograph of one
 * reads as a hole. */
/* Every entry also carries a dust film, and that is not a stylistic choice —
 * it is what was wrong with the worst object in the last set.
 *
 * A half-metre clast in the near field drew grey Fort Apache limestone, which was
 * authored at (0.47, 0.45, 0.42): a *neutral* grey, 0.11 saturation. Measured in
 * the frame it came out at 0.169 in a scene otherwise running 0.4 to 0.6, and it
 * read exactly as what it measured — a rectangle of grey paper composited onto a
 * warm photograph. The lithology was defensible and the colour was not, because
 * nothing in a desert is neutral: every exposed surface carries a film of the
 * local dirt, and under a 3500 K key even a genuinely white rock renders warm. A
 * neutral grey is achievable in that scene only by a manufactured object, which is
 * precisely how the eye read it.
 *
 * So the achromatic end of the palette is dusted rather than deleted — the
 * polychrome scatter is one of the most recognisable things about a Sedona wash
 * and flattening it to red would be the opposite mistake. Nothing now sits below
 * about 0.19 saturation, and the pale end has come down in value as well, because
 * a pale *and* neutral clast is the combination that reads as concrete. */
/* ---- and why the pale end came down again ----
 * The pale lithologies were reading as confetti in the talus and on the lower
 * slopes, and it is worth being precise about which of the two obvious causes it
 * actually was, because it was mostly the second.
 *
 * Value contrast: quartz at (0.74, 0.665, 0.545) is 0.672 luminance against the
 * matrix's 0.431 — 1.56x, and up to 1.75x once the per-instance jitter is on top.
 * A clast weathering out of a matrix is the same lithology as the matrix, so it
 * should differ by a shade; 1.75x is a different material.
 *
 * Hue: the pale entries carried a blue-to-green ratio of 0.82 against the
 * matrix's 0.635, so under a violet skylight they were the surfaces with enough
 * blue albedo to actually take the violet — which is why the chips read
 * specifically as grey-*lavender* rather than merely as bright. Nothing in a
 * desert is neutral, and nothing pale in a desert is neutral either: an
 * off-white Coconino pebble in a Sedona wash has been rolling in iron oxide for
 * ten thousand years. So the pale end is dusted with the local oxide, which pulls
 * blue down toward the matrix and takes value with it. 1.2 to 1.3x now.
 */
const LITH = [
  [0.72, 0.205, 0.088], // iron-stained red sandstone — carries the saturated tail
  [0.52, 0.31, 0.225],  // red Schnebly Hill sandstone
  [0.78, 0.40, 0.135],  // orange mud-coated clast
  [0.575, 0.428, 0.295], // buff sandstone
  [0.64, 0.520, 0.372], // off-white Coconino, dust-filmed
  [0.475, 0.378, 0.278], // grey Fort Apache limestone under desert dust
  [0.34, 0.275, 0.235], // desert-varnished dark pebble
  [0.575, 0.450, 0.300], // buff chert
  [0.61, 0.492, 0.352], // cream caprock limestone
  [0.66, 0.552, 0.412], // quartz, dust-filmed
];
/* Transported clasts came from anywhere upstream, so they are mixed — and only
   about half of them are the local red family. Talus fell off the wall thirty
   metres above it, so it is nearly all local: an apron of pale blocks reads as
   builders' rubble rather than as a collapsed wall. */
const MIX_TRANSPORTED = [0.17, 0.20, 0.10, 0.13, 0.07, 0.10, 0.11, 0.06, 0.04, 0.02];
/* Buff sandstone pulled back from an eighth of the local mix to under a tenth.
   It is the palest thing with a large share, and the coarse fraction now draws
   from this mix, so it was supplying most of the large pale plates — two of them
   landed side by side in the near field of one frame and both read as grey card. A
   pale clast is fine; a pale clast the size of a paving stone is what the eye
   stops on. */
const MIX_LOCAL       = [0.24, 0.50, 0.07, 0.09, 0.015, 0.015, 0.04, 0.02, 0.008, 0.002];
/* Blocks and slabs get their own mix with the extremes taken out. The saturated
   iron staining and the mud coating are *coatings on small transported clasts* —
   a film picked up in the bed — and at pebble scale they are what gives the floor
   its saturated tail. On a half-metre bedding slab the same albedo is a solid
   brick-red rectangle, and a scatter of those on the floor read unmistakably as
   shipping containers. A block that spalled off the wall is wall rock: the local
   red sandstone, sometimes buff or grey, never a vivid stain and never near-black. */
/* Pale share cut again, and this time it is about *size* rather than about the
   mix. A metre-scale pale boulder landed two metres from the camera in the
   `ground` framing and read as a poured concrete block — one object, and it took
   that region's mean one-pixel gradient down by nearly half on its own, because a
   large smooth bright facet is the definition of the failure this metric exists
   to catch. The lithology was not indefensible; the *scale* of it was. Buff
   sandstone and the two limestones come down, the local red goes up, and
   `paleCut` below knocks the remaining pale draws back toward the matrix in
   proportion to how large the instance is. */
const MIX_BLOCK       = [0.02, 0.60, 0.01, 0.16, 0.02, 0.06, 0.03, 0.07, 0.025, 0.005];

function pickLith(mixCdf, r) {
  for (let i = 0; i < mixCdf.length; i++) if (r <= mixCdf[i]) return i;
  return 0;
}
const cdf = (w) => { let a = 0; return w.map(v => (a += v)); };
/* Boulders get their own, with the pale end deleted rather than reduced, and the
   argument is the competence one the file already makes for the coarse fraction
   — carried to its conclusion. A flood can roll a granule down from the Rim and
   can barely shift a metre-scale block at all, so a boulder in this wash came off
   this wall: it is the local red sandstone, occasionally a grey siltstone bed, and
   it is never off-white Coconino or quartz. Nothing else in the file removes the
   *value* problem at boulder scale, and four rounds of dusting, tinting and
   size-scaled matrix mixing moved a near-field one from 162 to 152 when the bed
   around it sits near 120. A pale lithology at that size is not a colour to be
   corrected, it is a stone that does not occur. */
const MIX_BOULDER     = [0.16, 0.56, 0.05, 0.06, 0.0, 0.10, 0.07, 0.0, 0.0, 0.0];
const CDF_T = cdf(MIX_TRANSPORTED), CDF_L = cdf(MIX_LOCAL), CDF_B = cdf(MIX_BLOCK);
const CDF_R = cdf(MIX_BOULDER);

/* ── classes ───────────────────────────────────────────────────────────── */

/* `weight` turns the facies mix at a point into a placement probability. This
   is the whole sorting model, and it is the difference between a flow map and
   a sprinkle. */
const CLASSES = [
  {
    /* ---- the matrix, which the bed did not have ----
     * "No fine grit at the smallest scale… there is nothing between the smallest
     * instanced clast and the substrate texture, so the bed has no matrix." That
     * is a gap of more than a decade in grain size: gravel started at 24 mm and
     * the next thing down was the dirt map's grain at a millimetre or two, with
     * nothing in between, so every pebble sat on what looked like poured mortar
     * rather than on the coarse sand a real one is bedded in.
     *
     * Granules and very coarse sand, 6 to 22 mm. They are sub-pixel past about
     * ten metres, which is fine — their job is entirely in the near and middle
     * field, where the eye is close enough to ask what the pebbles are resting
     * on. Held tight to the channel (uMax 12 rather than 18) because spreading
     * the same count over the terraces would halve the density in the one place
     * it is needed, and given no shadow: at this size the shadow they cast is
     * smaller than a shadow-map texel, so it costs a caster pass and buys
     * nothing but acne. */
    name: 'granule', kind: 'angular', variants: 3, count: 26000, uMax: 12,
    flat: 0.54, bevel: 7, aspect: [0.70, 1.52], sizeP: 1.35,
    rMin: 0.006, rMax: 0.022, maxSlope: 0.62, shadow: false, orient: 'surface',
    imbricate: 0.34, sink: [0.50, 0.94], deepSink: 0.30, lith: CDF_T, tint: 1.0,
    scour: false,
    /* Follows the bed rather than the bars. Coarse sand is what the flood drops
       last and it goes everywhere the water slowed, so this is deliberately the
       flattest weight in the file — the sorting field will still gather it,
       since granule sits at the fine end of gRank and is pushed into the
       hollows the cobbles are pulled out of. */
    weight: (fc) => (fc.chan * 0.85 + fc.bar * 0.95 + fc.terr * 0.45)
                  * (1 - fc.bare * 0.55) * (1 - fc.pan) * (1 - fc.sheet * 0.6),
  },
  {
    /* Angular, like everything above it. Every clast below cobble size used to be a
       smooth ellipsoid, and a bed of ellipsoids under a hull-faceted cobble layer
       reads as two different worlds in one frame. The faceted shape language works
       and it extends downward: a granule that split off bedded sandstone has the
       same flat faces and sharp arrises a cobble does, only smaller. Fewer bevel
       points than a cobble, because abrasion rounds the small fraction fastest. */
    /* Five hull variants rather than three. Thirteen thousand instances drawn
       from three shapes is a repeat the eye finds even at gravel scale, and this
       is the class that covers the floor. Two more draw calls. */
    name: 'gravel', kind: 'angular', variants: 5, count: 16500, uMax: 18,
    /* Bevel 8 to 20, and the same move on cobble and pavement. The critique is
       "perfect spheroids and flat crackers… you have faceted shape language in
       the boulder classes, extend it down", and it is literally this number: a
       boulder gets 38 bevel points and a gravel got 8, so the small end of the
       population was a hull of sixteen points, which at any size reads as a
       blob. The points straddle the box surface, so each one is a facet with a
       chipped arête beside it, and that is what angular-to-subrounded looks like.
       Geometry is not this project's constraint — 2.7 M against a 6.6 M
       reference — so the cheapest realism available is being bought here. */
    flat: 0.50, bevel: 20,
    /* Plan aspect spread, per class. Every clast in the scene used to be drawn
       from one narrow band, 0.88 to 1.18 in plan, so the whole population shared
       a shape as well as an orientation — named by a critic as "small clasts are
       ellipsoids sharing aspect ratio". A real gravel is a mixture of blades,
       discs and equant fragments, and which of those a stone is depends on the
       fabric it broke out of, not on its size. */
    aspect: [0.72, 1.55],
    rMin: 0.024, rMax: 0.090, maxSlope: 0.58, shadow: true, orient: 'surface',
    /* Imbrication raised hard, and it is the cheapest realism in the file. Water
       stacks platy clasts like roof shingles, all dipping upstream, and that shared
       orientation is the single most recognisable signature of fluvial transport —
       it is what tells a geologist at a glance that a gravel was laid by a current
       rather than dumped. At 0.28 barely a quarter of the bed was tiled and the
       effect did not survive being averaged with the three quarters that were not:
       reported as absent. */
    /* ---- burial, raised, because it is the defect three critics named ----
       The strongest surviving "objects dropped onto a surface" tell is that a
       stone's whole body is above the bed. It should not be: a clast that has
       sat through one flood is worked down into the fines until only its crown
       and shoulders show, and a bed where the median stone is buried to a
       third looks placed however good the stone is. Median burial goes from
       0.64 of the half-thickness to 0.80, and two fifths of the population is
       taken past its own shoulders, where all that is left is a crown breaking
       the surface. What that costs is the silhouette of the individual stone,
       which is exactly what a real bed does not show either. */
    imbricate: 0.72, sink: [0.52, 0.96], deepSink: 0.34, lith: CDF_T, tint: 1.0,
    /* Above the median size these get a fillet of banked fines against the
       upstream face, like the coarser classes. The tell the last two critics both
       named is that a clast sits on undisturbed ground, and it is a tell at gravel
       scale as much as at cobble scale — this is the size class that covers the
       floor, so it is where the read is won or lost. */
    scour: true, scourFrom: 0.22, scourTail: true, fillet: 0.58,
    /* Density contrast raised hard, which is the other half of the same
       complaint — "uniform clast density, no flow-sorted bars, stringers or
       armoured lag surfaces". The terms were already the right terms; they were
       simply mixed with too much constant. A lag band with a stringer running
       through it now carries several times the density of the swept ground a
       metre away, which is what a flood actually leaves, and the extra 3500
       instances go into those patches rather than being spread over the floor. */
    weight: (fc) => (fc.chan * (0.20 + 1.45 * fc.lag) + fc.bar * 0.80 + fc.terr * 0.18)
                  * (0.14 + 1.90 * fc.string)
                  * (1 - fc.bare * 0.97) * (1 - fc.sheet) * (1 - fc.pan),
  },
  {
    /* Angular, not rounded. A water-worn sandstone cobble is rounded *at its
       edges* but it split off a bedded rock, so it keeps one or two flat parallel
       faces and chipped rectilinear corners, and it comes to rest broad-face
       down. Ellipsoids read as potatoes however they are textured. */
    name: 'cobble', kind: 'angular', variants: 4, count: 3600, uMax: 18,
    rMin: 0.070, rMax: 0.190, flat: 0.42, bevel: 24, maxSlope: 0.50, shadow: true,
    aspect: [0.74, 1.48],
    imbricate: 0.84, sink: [0.54, 0.98], deepSink: 0.32, lith: CDF_T, tint: 1.0,
    orient: 'surface', scour: true, scourFrom: 0.12, scourTail: true, fillet: 0.62,
    weight: (fc) => (fc.chan * (0.12 + 1.55 * fc.lag) + fc.bar * 0.50 + fc.terr * 0.08)
                  * (0.06 + 1.95 * fc.string)
                  * (1 - fc.bare * 0.99) * (1 - fc.sheet) * (1 - fc.pan),
  },
  {
    name: 'pavement', kind: 'angular', variants: 3, count: 2400, uMax: 26,
    /* Bevel raised from nine and the top size cut. A tabular clast with nine
       bevel points is three big planes, and at a third of a metre in the near
       field that is a paving stone — one of them landed in the ground framing
       and took that region's one-pixel gradient down by a quarter on its own.
       Desert pavement is a mosaic of hand-sized fragments, not flagstones. */
    rMin: 0.055, rMax: 0.150, flat: 0.50, bevel: 26, maxSlope: 0.52, shadow: true,
    imbricate: 0, sink: [0.35, 0.62], lith: CDF_L, tint: 0.82, orient: 'surface',
    /* desert pavement: weathered angular fragments left on the abandoned
       terrace after the fines blew out from between them */
    weight: (fc) => (fc.terr * 0.95 + fc.tal * 0.35) * (1 - fc.bare * 0.5) * (1 - fc.pan),
  },
  {
    /* Count cut by a third at the same time as `pile` was sharpened. Those two
       changes have to move together — concentrating the same number of blocks
       into fewer lobes makes the lobes denser, and a dense heap of half-metre
       blocks in the near field is a worse object than an even sprinkle. Fewer
       blocks in tighter heaps is an apron; the same blocks in tighter heaps is a
       builder's yard. */
    name: 'block', kind: 'angular', variants: 4, count: 1700, uMax: 34,
    /* Not equant. At flat 1.0 the hull of a jittered cube is a cube, and a
       half-metre cube sitting on open ground at twenty metres does not read as
       fallen sandstone, it reads as a crate. Bedded rock breaks into slabs. */
    rMin: 0.090, rMax: 0.270, sizeP: 3.0, squat: true,
    flat: 0.62, bevel: 26, maxSlope: 0.62, shadow: true,
    imbricate: 0, sink: [0.52, 0.94], lith: CDF_B, collar: 7, tint: 0.78,
    orient: 'random', taper: true,
    /* Talus only. Allowing these onto the open floor as bank slump put isolated
       half-metre boxes out in the middle of the wash, and a cluster of those at
       twenty metres reads as a pile of dice — a lone rectilinear solid on flat
       ground has nothing around it to explain why it is there. In the apron it is
       one block among hundreds wedged against each other, which is legible.
       `pile` clumps them: rockfall arrives as an event, so an apron is a run of
       heaps below the gullies that fed them with swept ground between, and an
       even sprinkle of same-sized blocks reads as scattered litter. */
    weight: (fc) => fc.tal * fc.pile,
  },
  {
    /* Fewer, smaller, and with many more facets. At nearly a metre of radius and
       a dozen bevel points the hull is six big planar faces, and a two-metre plate
       with six flat faces sitting on open ground reads as a poured concrete pad —
       which is exactly how the near-field ones were coming out. Facet count is
       what makes a metre of rock look like rock: a spall surface stepped by the
       bedding it broke along catches a low sun in a dozen slightly different
       planes, not one. */
    name: 'slab', kind: 'angular', variants: 4, count: 150, uMax: 34,
    rMin: 0.200, rMax: 0.350, sizeP: 2.2, squat: true,
    flat: 0.62, bevel: 34, maxSlope: 0.50, shadow: true,
    imbricate: 0, sink: [0.50, 0.90], lith: CDF_B, collar: 5, tint: 0.78,
    orient: 'random', taper: true,
    /* bedding-plane slabs, which fall off a stratified wall as sheets. Apron only,
       and under half a metre: a two-metre plate with a flat top lying by itself on
       the floor of the wash was reading as a poured concrete pad. */
    weight: (fc) => fc.tal * fc.pile,
  },
  {
    /* Blockier than the cobbles. A metre-scale boulder that is as tabular as a
       cobble reads as a paving slab lying on the ground, and a scatter of them
       reads as a demolished patio. */
    /* rMax pulled from 0.60 to 0.46. At 0.60 the hull is 1.2 m across, and a
       1.2 m solid with thirty bevel points still presents three facets the size
       of a table top to a camera two metres away — the same "one metre of rock
       shaded as one flat plane" the slab class was cut down for. Facet count is
       raised with it, because what makes a metre of rock read as rock is a dozen
       slightly different planes catching a low sun, not one. */
    name: 'boulder', kind: 'angular', variants: 3, count: 130, uMax: 16,
    rMin: 0.300, rMax: 0.460, flat: 0.86, bevel: 38, maxSlope: 0.40, shadow: true,
    imbricate: 0.68, sink: [0.56, 0.94], deepSink: 0.24, lith: CDF_R, collar: 9,
    /* Knocked back to what the block and slab classes already carry. A boulder
       is the one clast large enough that its dust film is a first-order fact
       about how bright it is: it has stood in the same place for decades taking
       a coat of the local oxide, where a pebble is turned over by every flood. A
       boulder at the same value as a fresh pebble is the object that reads as
       poured concrete. */
    tint: 0.80, orient: 'surface', scour: true, scourFrom: 0.0, scourTail: true,
    fillet: 1.0, aspect: [0.78, 1.36],
    /* The one class large enough that its hollow can be cut into the height
       field rather than painted around it — see Terrain.addScour. As a fraction
       of the stone's radius, so a 0.46 m boulder digs 0.19 m, which is about
       what a metre-wide obstacle takes out of a sand-and-gravel bed in one
       flood. */
    excavate: 0.42,
    /* flood-transported, so they sit in the channel and on bar heads */
    weight: (fc) => (fc.chan * 1.0 + fc.bar * 0.5) * fc.lag * (0.2 + 1.6 * fc.string)
                  * (1 - fc.pan),
  },
];

const S0 = -12, S1 = 264;

/* The bed itself, as a multiplier on the neutral clast texture: a banked wedge or a
   depositional tail is made of matrix, not of the stone it formed against, and
   tinting it as stone is what would make it read as another rock rather than as
   sediment. Matched to the dirt map's dominant colour. */
const MATRIX_COL = [0.70, 0.37, 0.235];

/* Mean linear albedo of the transported mix, which is what a pixel covering many
   clasts must converge to. Computed rather than guessed so it tracks the palette. */
const FAR_COL = MIX_TRANSPORTED.reduce((a, w, i) => (
  [a[0] + w * LITH[i][0], a[1] + w * LITH[i][1], a[2] + w * LITH[i][2]]
), [0, 0, 0]);

export function buildScatter(terrain, tex) {
  const path = terrain.path;
  const mat = new THREE.MeshStandardMaterial({
    map: tex.clast.albedo,
    normalMap: tex.clast.normal,
    roughnessMap: tex.clast.arm,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(1.0, 1.0),
    vertexColors: true,   // required for the per-instance lithology tint; see addWhite
    dithering: true,
  });

  /* ── screen-footprint level of detail ──────────────────────────────────────
   *
   * This is the fix for the worst artefact the scene has had: across the whole
   * midground of every frame the gravel disintegrated into a hard-edged hash of
   * one-to-three-pixel near-black and near-white rectangles. It did not read as
   * aliasing, it read as a shader failing.
   *
   * The cause is that a clast is a lit solid. At four metres it covers a hundred
   * pixels and its facets are shading; at thirty metres it covers two, and those
   * two pixels each take a single shading sample of a single facet of a single
   * stone. One pixel catches a sun-facing facet of an off-white Coconino chip and
   * blows out; its neighbour catches the shadowed side of a varnished basalt
   * pebble and goes to near black. Nothing about that is filterable after the
   * fact, and it gets worse as the population's colour and normal variance grow —
   * so every improvement to lithological variety made it louder.
   *
   * What a pixel covering many stones should return is the *average* of the
   * population over its footprint: the mean albedo, lit as though the surface
   * were the ground the stones are lying on. Which is exactly what real gravel
   * receding from a camera looks like — an even fine stipple, converging on the
   * colour of the bed. So the projected pixel radius of each instance is computed
   * in the vertex stage, and as it falls below a few pixels the instance's tint
   * converges on the population mean and its shading normal converges on its own
   * seating normal. Below about a pixel the instance collapses to zero size and
   * stops being drawn at all; by then the terrain's own grain map is carrying
   * that size class anyway, and drawing it twice was the source of half the
   * variance.
   *
   * This costs one varying and no draw calls, and it is applied through the same
   * shared material so the instancing stays intact. */
  mat.userData.uniforms = {
    uVpH: { value: 1440 },
    uFarCol: { value: new THREE.Color(FAR_COL[0], FAR_COL[1], FAR_COL[2]) },
    uSunDir: { value: SUN_DIR.clone() },
    uGrit: { value: tex.grit },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader = ('uniform float uVpH;\nuniform vec3 uFarCol;\n' +
      'varying float vFar;\nvarying float vFarN;\nvarying vec3 vSeat;\n' +
      'varying float vMeso;\nattribute float aDust;\n' +
      'varying float vAO;\nvarying float vUp;\nattribute float aAO;\n' +
      shader.vertexShader)
      /* ---- constant texel density across three orders of size ----
         The hull UVs are per-face box projections normalised into the unit square,
         so every facet gets exactly one tile of the surface map however large the
         instance is. On a two-centimetre granule that is right. On a half-metre
         bedding slab it means the entire broad face carries one stretched copy of a
         map built to describe centimetres, which is why the big talus slabs were
         reading as flat painted card — the thing that makes a metre of rock look
         like rock is grain at the scale of a fingernail, and there was none on them.
         Scaling the UVs by the instance's own radius fixes the density in world
         space instead. The maps repeat, so this only costs a multiply. */
      /* The constant is set from physical size, not by eye. The box projection
         normalises local coordinates into the unit square, so one tile spans the
         instance's full width — 2 × its radius — and the map is authored against
         a six-centimetre tile. Hence 2/0.06 ≈ 34 tiles per metre of clast. The
         previous 7 gave a half-metre slab a 29 cm tile, which put the map's
         coarsest mottle at hand scale and everything finer below the resolution
         the eye was looking at: the slab came out featureless, which was the
         single loudest defect in the set. */
      /* ---- and this is where the level of detail has to be computed ----
       * It used to be in the begin_vertex block below, and that was a real bug
       * rather than a tidiness point: three's vertex main() runs uv_vertex, then
       * color_vertex, then a dozen normal chunks, and only then begin_vertex. So
       * the colour convergence in the color_vertex block was reading vFar a
       * whole chunk before anything assigned it. An unwritten varying is
       * undefined, this driver evidently hands back zero, and the effect is that
       * the distance colour fade — the term the long note below is entirely
       * about — has never once run. The geometry cull and the normal flattening
       * were unaffected, because those happen at or after begin_vertex, which is
       * why the gravel hash still went away and nothing pointed at this.
       * Hoisted to the first chunk in main(), where every consumer is downstream
       * of it. */
      .replace('#include <uv_vertex>', /* glsl */`
        #include <uv_vertex>
        /* Instance centre in view space, and the instance's world radius from the
           first column of its matrix. projectionMatrix[1][1] is 1/tan(fov/2), so
           this is a true projected pixel radius, correct under any fov or
           resolution rather than a hand-tuned distance. */
        vec3 iCen = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float iRad = length(instanceMatrix[0].xyz);
        float px = 0.5 * uVpH * projectionMatrix[1][1] * iRad / max(-iCen.z, 0.05);
        float uvK = clamp(iRad * 34.0, 1.0, 18.0);
        #ifdef USE_MAP
          vMapUv *= uvK;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv *= uvK;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv *= uvK;
        #endif
        vFarN = 1.0 - smoothstep(1.20, 3.50, px);
        vFar  = 1.0 - smoothstep(0.70, 2.20, px);
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        /* Below about a pixel the instance collapses to zero size and stops
           being drawn at all; by then the terrain's own grain map is carrying
           that size class anyway. This is the one part that has to wait for
           begin_vertex, because "transformed" does not exist before it. */
        transformed *= smoothstep(0.60, 1.60, px);
      `)
      /* ---- two fades, not one ----
           These were a single threshold, and sharing it is what emptied the mid
           distance. Worked through at the capture height: a 20 cm cobble at
           thirty metres projects to a 3 px radius, so it is six pixels across and
           an unmistakable object with a readable shadow — and it was arriving 97%
           converged on the population mean colour with its normal 90% flattened.
           The mid-distance band was being deliberately erased at exactly the
           range the eye travels through.

           The two quantities do not filter alike, which is the whole point. A
           perturbed *normal* under a widening footprint is what scintillates,
           because shading is a non-linear function of it and averaging the input
           is not averaging the output. *Colour* averages linearly and correctly,
           so it only has to converge once the instance is genuinely smaller than
           a pixel — and until then it is the only thing still carrying the
           difference between a gravel bar and the sand beside it.

           Even the normal fade was far too early, though, and that is separately
           what emptied the mid distance. It was set to converge between 2.6 and 9
           pixels of radius, which flattens a cobble that is eighteen pixels
           across. Nothing that large aliases; the hash came from instances near
           and below a pixel, where a single sample cannot represent the geometry
           at all. Converging from 1.2 to 3.5 keeps real shading and a real
           silhouette on anything four pixels across or more, which is what a 20 cm
           cobble at thirty metres is, while still averaging out the granules that
           actually were the problem. */
      /* Converging on the population mean is right — a pixel covering ten clasts
         genuinely sees the mean of ten clasts — but converging every distant clast
         on the *same* mean is not, and that is what flattened the mid distance. The
         variance that survives a widening footprint is the variance at scales above
         a pixel: a gravel bar at thirty metres still reads as a different tone from
         the sand beside it, because the patch is metres across. So the mean itself
         varies over tens of metres. Chroma only, at two wavelengths, no value
         change — macro variance in luminance is what came out as pale blobs
         floating over the midground. */
      .replace('#include <color_vertex>', /* glsl */`
        #include <color_vertex>
        vec3 iW = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float pat = 0.5 + 0.25 * sin(iW.x * 0.213 + iW.z * 0.131)
                        + 0.25 * sin(iW.z * 0.087 - iW.x * 0.052 + 2.1);
        vec3 far = uFarCol * mix(vec3(0.90, 0.97, 1.09), vec3(1.11, 1.00, 0.87), pat);
        vColor = mix(vColor, far, vFar);
        /* The seat direction, with the per-instance dust weight smuggled in as its
           length so this costs no second varying. A pebble is turned over by every
           flood and stays the colour of its own lithology; a slab has lain in the
           same attitude for decades and its sky-facing faces carry a film of
           whatever the wash is made of, and Coconino that has lain in a wash
           weathers to a duller browner buff than the fresh rock. The weight is
           computed in emit(), where the lithology index is known exactly — see the
           note there for why deriving it from vColor here did not work. */
        vSeat = normalize(normalMatrix * mat3(instanceMatrix) * vec3(0.0, 1.0, 0.0))
              * (1.0 + aDust);
        /* Size on its own, kept separate from the dust weight above because that
           one deliberately conflates size with paleness and this one must not.
           See the sky-occlusion note in the fragment shader for what it is for. */
        vMeso = smoothstep(0.07, 0.26, iRad);
        vAO = aAO;
        /* Height of this vertex above the instance origin, in units of the
           instance's own plan radius, so a fragment down at the bed can be told
           from one up on the crown. Taken through the instance matrix rather
           than from position.y so that a clast tilted by imbrication reports
           the height it actually has in the world rather than in its own frame. */
        vUp = (mat3(instanceMatrix) * position).y / max(iRad, 1e-4);
      `);

    shader.fragmentShader = ('varying float vFar;\nvarying float vFarN;\n' +
      'varying vec3 vSeat;\nvarying float vMeso;\n' +
      'varying float vAO;\nvarying float vUp;\n' +
      'uniform vec3 uSunDir;\nuniform sampler2D uGrit;\n' +
      'float cTone = 1.0;\nfloat cCav = 1.0;\nfloat cDust = 0.0;\n' + shader.fragmentShader)      /* ---- two different fades, and only one of them existed ----
       * vFarN handles the *instance* shrinking below a pixel, which is the
       * gravel-hash problem. It says nothing about the surface map's own feature
       * size, and that is a separate failure with its own symptom: the clast
       * map's bedding lamination is authored at three millimetres, the UVs are
       * scaled per instance to hold that physical size, and on a half-metre
       * clast two metres from the camera three millimetres is about one pixel.
       * A one-pixel periodic ridge crossed by the per-lamina hardness hash is a
       * moiré, and magnified it reads as woven cloth across every large facet —
       * which is most of what the surviving "1 to 2 px hash" on the clasts and
       * the bank faces actually is. It is not a filtering bug; the feature is
       * genuinely at the screen's Nyquist limit, so the answer is the terrain's:
       * stop perturbing the normal once a pixel covers several laminae and let
       * the albedo mip carry an even stipple.
       * vViewPosition is a rigid transform of world position, so its screen
       * derivative is the world footprint without needing a second varying. */
      /* ---- and the other half: a layer with no scale of its own ----
       * Four rounds were spent on the pale boulders as a *colour* problem and it
       * moved them from rgb(162,132,102) to (152,119,89) against a bed near
       * (120,85,62), and they were still the loudest object in the frame. The
       * reason is not pigment. A 40 cm solid presents facets the size of a table
       * top; the clast maps are pinned to a six-centimetre tile, so at two and a
       * half metres their finest authored feature — 3 mm of bedding lamination —
       * is about a pixel and a half and everything else is far coarser. The bed
       * beside it has the terrain's grain, its micro-shadow tone and its cavity
       * occlusion. The clast had none of the three. It was not a pale rock, it
       * was a *smoother* rock, and the eye reads smooth-and-large as a painted
       * prop however carefully its hue is matched.
       *
       * Measured offline, sampling these maps through a real mip pyramid: the
       * facet's mean one-pixel gradient falls from 0.0201 at 1.5 mm per pixel to
       * 0.0028 at 35 mm per pixel, a sevenfold collapse, with hf/lf 0.55 at the
       * near end and above 1.0 at the far end — which is the signature of a map
       * that has been mipped down to noise around its own mean. That is exactly
       * the failure System 2 diagnosed on the rock walls, so it takes the same
       * cure: the grit layer, which has no content below a fourteenth of its own
       * tile and therefore no scale of its own, sampled at whatever scale the
       * pixel footprint asks for, octave-snapped with the bracketing pair
       * crossfaded. Same probe after: gradient 0.040 to 0.053 and flat across
       * distance, hf/lf 0.68 to 0.78.
       *
       * Three things come out of the one fetch, and all three were named in the
       * critique. R is a tone stipple. A is crevice occlusion, applied to direct
       * and indirect alike because a crevice occludes both, and biased to darken
       * on the mean because a granular surface at a grazing sun shadows a real
       * fraction of itself — the terrain has that term and the clast did not,
       * which is a large part of why the boulder read brighter than its bed. G
       * and B are a tangent-space normal, damped as the instance goes sub-pixel
       * for the same reason the map normal is: a perturbed normal under a
       * widening footprint scintillates.
       *
       * The projection is the dominant world axis of the geometric normal, one
       * fetch rather than a triplanar three, and it therefore has a seam where
       * the dominant axis swaps. That is affordable *here* specifically because
       * the layer has no low frequencies: across the seam the grain pattern
       * changes but its statistics do not, so there is no tonal step to see, only
       * noise meeting different noise. The planar stretch near grazing is largely
       * self-cancelling too — grazing incidence widens the footprint, which
       * coarsens the lock in the same proportion the projection compresses.
       *
       * World position and world normal come out of vViewPosition and the
       * geometric normal by inverse-rotating through viewMatrix, which is rigid,
       * so this costs no extra varyings. The position is wrapped at 256 m before
       * scaling: a highp float has about seven digits, and 200 m of world
       * coordinate multiplied up to texel scale runs out of mantissa. The wrap is
       * seamless because both 256 and the tile size are powers of two. */
      .replace('#include <normal_fragment_maps>', /* glsl */`
        vec3 nGeoC = normal;
        #include <normal_fragment_maps>
        float cfX = length(dFdx(vViewPosition)), cfY = length(dFdy(vViewPosition));
        float cFoot = max(cfX, cfY);
        normal = normalize(mix(nGeoC, normal, 0.14 + 0.86 * (1.0 - smoothstep(0.0011, 0.006, cFoot))));

        /* Locked to the *short* axis of the footprint, not to its geometric
           mean. The terrain locks to the mean because its pixels are grazing
           everywhere and it needed the layer to survive the long axis; a clast
           takes the opposite trade, because the first attempt here used the mean
           and put the grain two to four pixels across, which does not read as
           grain — it reads as polka dots, and it was worse than the flat facet
           it replaced. The short axis puts about one texel per pixel across the
           view, which is the band the eye is judging. The floor is the map's own
           anisotropic filtering: this never asks for a ratio steeper than six,
           against the eight the texture is built with. */
        float cFootG = max(min(cfX, cfY), max(cfX, cfY) / 6.0);
        float gLodC = log2(max(cFootG, 2.5e-4) * 256.0);
        float gFlC = floor(gLodC);
        float gScC = exp2(-gFlC);
        vec3 seatC = normalize(vSeat);
        float dustK = length(vSeat) - 1.0;
        vec3 nWc = normalize((vec4(nGeoC, 0.0) * viewMatrix).xyz);
        vec3 wpC = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
        vec3 aWc = abs(nWc);
        vec2 gUVc = aWc.y > max(aWc.x, aWc.z) ? wpC.xz
                  : (aWc.x > aWc.z ? wpC.zy : wpC.xy);
        gUVc = mod(gUVc + vec2(5.3, 21.7), 256.0);
        vec4 grC = mix(texture2D(uGrit, gUVc * gScC),
                       texture2D(uGrit, gUVc * gScC * 0.5), gLodC - gFlC);
        cTone = 1.0 + (grC.r - 0.427) * 1.30;
        cCav  = clamp(0.93 - (0.934 - grC.a) * 1.70, 0.34, 1.10);

        /* The normal is deliberately the *smallest* of the three terms, which is
           the opposite of how the first attempt was weighted and is the whole
           lesson from it. At eight degrees of sun elevation a tangent slope of
           0.8 — which is what the layer's full authored amplitude comes to — is
           enough to swing a grain from fully lit to fully shadowed, so the grain
           field came out binary: bright dots on black, a pebble-dash render
           rather than stone. The offline probe rewarded that, because a binary
           field has an excellent one-pixel gradient. Amplitude is not structure.
           At 0.25 the grains modulate the shading instead of switching it, and
           tone and cavity carry most of the signal, which is also the right
           division: at this sun angle it is self-shadowing rather than facet
           orientation that a granular surface mostly expresses. */
        vec3 tAx = abs(nWc.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 tT = normalize(cross(tAx, nWc));
        vec3 tB = cross(nWc, tT);
        vec2 g2 = (grC.gb - 0.5) * (0.50 * (1.0 - vFarN));
        vec3 gWc = normalize(nWc + tT * g2.x + tB * g2.y);
        normal = normalize(normal + (viewMatrix * vec4(gWc - nWc, 0.0)).xyz);

        /* ---- dust, on the sky-facing facets only ----
         * The last thing that separates a big clast from the bed it lies in, and
         * the one that is a mechanism rather than a colour choice. A slab that
         * has lain in one attitude for decades collects a film of whatever the
         * wash is made of on every face the sky can see, and keeps its own
         * lithology on the faces it cannot. That is why real desert talus has
         * red tops and pale sides, and it is the reverse of what this material
         * was doing: a uniform per-instance tint, so the sky-facing table top of
         * a buff sandstone block was as clean as its underside.
         * Convergence toward a fixed dust albedo, not a multiply, so it darkens
         * a pale block and lifts a varnished dark one — which is what a film
         * does. Weighted by instance size through vSeat's length, so the gravel
         * keeps the lithological variety that took three rounds to get. */
        /* Capped rather than allowed to run to one. A dust film in a wash is thin
           and patchy — you see the rock through it — so past about two thirds the
           block stops being dusty Coconino and becomes a lump of bed, which
           deletes the lithology instead of weathering it. */
        /* ---- and the orientation gate had to open a long way ----
         * This asked for nWc.y above 0.34 before any film accumulated and did not
         * saturate until 0.90, which is a facet within twenty-five degrees of
         * horizontal. Almost nothing on a talus block is: the plates that read as
         * bright card in the ground framing present faces tilted sixty degrees
         * from vertical, nWc.y near 0.5, so they were collecting a fifth of the
         * weight the class was authored with. The dust weight measured correct at
         * the instance and arrived at the pixel divided by five, which is why
         * three successive increases to it changed almost nothing.
         *
         * Widening the gate then found the rest of the story, and it needed the
         * value of cDust rendered directly to the screen rather than another guess:
         * on the plate that reads worst, cDust measured 0.31, and inverting the
         * tone curve and the gate puts that facet's normal at nWc.y ≈ 0.15. The
         * faces that read as bright card are not sky-facing at all — they are
         * *steeply dipping* faces that happen to point at the sun, which at eight
         * degrees of elevation is very nearly the brightest thing a facet can do.
         * That is why the two previous increases to the dust weight changed the
         * pixel by one part in two hundred: they were both saturating against a
         * cap the orientation term then multiplied down to a third.
         *
         * So there is a floor now as well as a ramp. A near-vertical sandstone
         * face in a wash is not clean either — dust arrives on it by splash and by
         * runoff and stays in the pore space, which is what desert varnish and
         * runoff staining are — but it carries perhaps a third of what a bench
         * face collects, not none. The ramp above that is still the settling term.
         *
         * Capped rather than allowed to run to one. A dust film in a wash is thin
         * and patchy — you see the rock through it — so past about four fifths the
         * block stops being dusty Coconino and becomes a lump of bed, which
         * deletes the lithology instead of weathering it. */
        cDust = (0.34 + 0.66 * smoothstep(-0.12, 0.52, nWc.y))
              * min(0.80, 0.42 * dustK);

        normal = normalize(mix(normal, seatC, vFarN * 0.92));
      `)
      /* Same reasoning as the terrain: a dust-filmed dry stone does not go
         mirror-bright along its edges, and the stock material's specularF90 of 1.0
         says it does. On a clast this was also lighting the near-grazing arris of
         every faceted block as a white hairline, which is where the fireflies on
         the sunlit crests were coming from. */
      .replace('#include <lights_physical_fragment>', /* glsl */`
        #include <lights_physical_fragment>
        material.specularColor *= 0.55;
        material.specularF90 *= 0.16;
        material.diffuseColor *= cTone;
        /* Linear albedo of the wash's own fines, a little above the open bed
           because this is a thin film over rock rather than a bed of it. */
        material.diffuseColor = mix(material.diffuseColor, vec3(0.186, 0.104, 0.071), cDust);
        /* A pit is rougher than the face around it: the cement has gone and what
           is left is loose grain. Small, but it stops the crevices reading as
           specular dimples. */
        material.roughness = clamp(material.roughness * (1.0 + (0.934 - grC.a) * 0.45), 0.30, 1.0);
      `)
      /* Cavity occlusion, on direct and indirect alike. An aoMap-style indirect
         multiply would have been the conventional place for this and it would be
         wrong: at eight degrees of sun elevation the direct term is most of the
         light on an up-facing facet, and a crevice that only darkens the sky
         contribution leaves the sunlit grain as flat as it was. */
      .replace('#include <aomap_fragment>', /* glsl */`
        #include <aomap_fragment>
        reflectedLight.directDiffuse *= cCav;
        reflectedLight.indirectDiffuse *= cCav;
        reflectedLight.directSpecular *= cCav;
        reflectedLight.indirectSpecular *= cCav;

        /* ---- the sky lobe a clast in a pile does not actually see ----
         * This is the term that four rounds of pigment work were substituting
         * for, and finding it took inverting the question: after the dust film
         * had pulled a pale block's albedo to (0.226, 0.141, 0.100) — within a
         * few hundredths of the bed's own — it was *still* rendering at 1.43x the
         * bed's luminance. Albedo cannot explain that, because albedo scales sun
         * and sky together and the ratio survives. What was left was the fill.
         *
         * terrain.js multiplies its indirect diffuse by tAO, which runs 0.34 to
         * 1.0 and sits around 0.8 on open floor. The clast material had no
         * equivalent at all — only cCav, which is grain-scale and averages one.
         * So every clast in the scene was taking the full unoccluded sky dome
         * while the bed one centimetre away took four fifths of it, and at eight
         * degrees of sun elevation the dome is most of the light on an up-facing
         * facet. That is a systematic 25% over-fill on the one class of object
         * that is *more* occluded than the ground, not less: a block in a
         * rockfall lobe is wedged among other blocks, and the ones that are not
         * are still sunk to the shoulders in the bed.
         *
         * Scaled by instance size rather than applied flat, because the physics
         * is about neighbours: a granule lies on open bed and sees the dome a
         * grain of the bed sees, while a half-metre block sees a horizon of other
         * half-metre blocks. Uniform over the facet rather than keyed to its
         * normal, deliberately — the honest model of a pile is that the top
         * facets are open and the low ones are shut, and nothing in the shader
         * knows which is which, so a directional guess would be decoration.
         *
         * It also explains the *hue* complaint, which pigment never could: the
         * dome is the blue-violet part of the light budget, so an over-filled
         * facet is desaturated as well as bright, and a desaturated warm surface
         * beside a saturated red one reads as grey card however dark it is. */
        /* aAO carries burial, bank membership and size together, computed per
           instance on the CPU where all three are known exactly. vMeso is kept
           only as a small extra for the largest blocks, which are wedged among
           neighbours in a way the per-instance terms do not fully capture. */
        float mesoAO = vAO * mix(1.0, 0.86, vMeso);
        /* Contact darkening. A stone sitting in a bed occludes its own base and
           the bed occludes it back, and that dark line where the two meet is
           most of what makes a clast look bedded rather than dropped. The
           critique asked for it as a ring on the ground; done here on the clast
           instead, which costs no extra geometry and cannot misregister. Narrow
           — a third of a radius — because it is a contact, not a shadow. */
        float contact = mix(0.46, 1.0, smoothstep(-0.40, 0.06, vUp));
        /* ---- floored, because three occlusion terms with no floor made holes ----
         * cCav, mesoAO and contact all multiply the indirect term and none of
         * them had a lower bound, so the worst case was 0.34 * 0.224 * 0.46 =
         * 0.035 of the dome. On a sunlit bed that is invisible. On a shaded bank,
         * where the incident fill is already at its lowest, it takes the result
         * below what eight bits can represent: large flat clasts rendered at
         * literal 0,0,0 and were reported as holes punched through the terrain.
         * Verified by ablation — removing the product entirely removes the holes
         * from both bend and far_220, and note that the frame's true-black
         * *count* barely moves, because most of it is vegetation silhouette. The
         * defect had to be looked at, not counted.
         * The floor goes on the product rather than on the terms, which keeps the
         * bedding cue intact everywhere it was not broken. It is also the right
         * shape physically: a crown that is exposed at all sees a good part of the
         * sky, because that is what being exposed means. */
        float occ = max(mesoAO * contact, 0.34);
        reflectedLight.indirectDiffuse *= occ;
        reflectedLight.indirectSpecular *= occ;
      `)
      /* ---- the blue chips were here ----
       * This was an additive Rayleigh-spectrum constant, vec3(0.012, 0.024,
       * 0.090) * 0.85, applied at full strength to every facet turned away from
       * the sun. terrain.js carried the identical term and removed it for the
       * identical reason; the copy on the clasts outlived it by a round and
       * became the frame's loudest defect once the floor was lit.
       *
       * Measured rather than argued. Inverting the tone curve on the chips in
       * `sys4d_wash_mid` — mean rgb(67,62,98) at exposure 1.15 — recovers a
       * linear radiance of (0.063, 0.056, 0.109). The term alone contributes
       * (0.010, 0.020, 0.077): seventy per cent of the blue channel, and
       * subtracting it leaves (0.052, 0.036, 0.033), a warm brown at B/G 0.92,
       * which is what a shaded red clast under a violet sky is supposed to be.
       * So the chips are not a pinned normal and not a billboard — the geometry
       * and the seating are correct, and a magnified crop shows ordinary
       * tabular clasts with a correctly-lit warm sliver on their sunward facet
       * and this constant flooding everything else.
       *
       * Nothing has been lost by deleting it. The reasoning that justified it
       * was written against a light rig with no sky term at all; System 4's SH
       * probe now carries the sky's own irradiance, so an away-from-sun facet
       * receives a blue-dominant fill through its own albedo, which is the
       * physically correct amount of violet for a rock that throws three
       * quarters of the blue away. */;
  };

  const meshes = [];
  const q = {};
  const obj = new THREE.Object3D();
  const nrm = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();

  /* Small clasts clustered around each large one. A boulder in a wash has
     sediment banked against it; a boulder alone on smooth ground floats. These
     go into the existing gravel and cobble buckets, so they cost nothing. */
  const collars = [];

  /* ── scour geometry ──────────────────────────────────────────────────────
   * The strongest surviving tell that these are objects instanced onto a surface
   * is that each one sits on undisturbed ground. A stone that has been through one
   * flood does not: the flow stalls against its upstream face and banks sediment
   * into a wedge there, accelerates around its shoulders and scours a crescent
   * behind it, then drops a long tapered tail of fines downstream in the slack
   * water. That triplet is visible around every cobble in a wash photograph and
   * it is what makes the stone look *set into* the bed.
   *
   * Two extra instances per large clast do the constructive half — a wedge across
   * the flow on the upstream side, and a tail drawn out downstream — both in matrix
   * colour rather than the clast's lithology, because they are made of the bed, not
   * of the stone. The excavated half comes from burial instead: sinking the clast
   * further into the ground gets the same read as scouring around it, and unlike a
   * hollow it costs nothing. One extra bucket, two draw calls. */
  const wedges = [];

  CLASSES.forEach((cl, ci) => {
    const geoms = [];
    for (let v = 0; v < cl.variants; v++) {
      geoms.push(cl.kind === 'round'
        ? roundedClast(cl.detail, 1.7 + v * 3.1, cl.flatten)
        : angularClast(7717 + ci * 131 + v * 17, cl.flat, cl.bevel));
    }

    const buckets = geoms.map(() => []);
    const rand = rng(90210 + ci * 7717);
    let placed = 0, guard = 0;
    /* Where this class sits on the grain-size scale, 0 for granules and 1 for
       the half-metre blocks. Used by the sorting below, which needs to know
       which end of a sorted patch a class belongs at. */
    const gRank = clamp(Math.log(cl.rMax / 0.010) / Math.log(0.50 / 0.010), 0, 1);

    while (placed < cl.count && guard++ < cl.count * 60) {
      const s = S0 + rand() * (S1 - S0);
      const u = (rand() * 2 - 1) * cl.uMax;

      path.posAt(s, pos);
      const th = path.headingAt(s);
      const x = pos.x + u * Math.cos(th);
      const z = pos.z + u * Math.sin(th);
      path.atZ(z, q);

      const fc = terrain.facies(x, z, q);
      /* slumped block zone: just below the lip of a cut bank */
      fc.slump = fc.f.bendOut * Math.max(0, 1 - Math.abs(fc.f.av - fc.f.wt + 0.9) / 1.8);
      /* ---- what the last flood left, as opposed to what a generator leaves ----
       * The facies model above already varies *how many* clasts land here: a lag
       * band carries several times the density of swept ground. What it does not
       * vary is *which* clasts, and that is the surviving half of the critique —
       * "a real wash floor is sorted by the last flood and this one is scattered
       * by a random number generator". Every patch was drawing from the same size
       * distribution, so granules, pebbles and cobbles were interleaved
       * everywhere at their global proportions. Real bedload does not do that.
       * Falling water loses competence as it spreads and slows, so it drops its
       * coarse fraction first and its fine fraction last, and what it leaves is a
       * mosaic of patches each of which is narrow in size and different from its
       * neighbour: an armoured gravel bar with almost no sand showing, a sand lens
       * beside it with almost no gravel in it, a stringer of cobbles down a
       * former thread.
       *
       * The field is built in (s, u) — arclength down the wash and offset across
       * it — which the placement loop already has, so it is in the flow frame for
       * free and needs no rotation. Eighteen metres along by three across, which
       * is the aspect of a real bar and the reason the patches read as deposited
       * by something flowing rather than as blobs.
       *
       * It redistributes rather than thins. The loop runs until `cl.count` is
       * placed, and the gain is mean-one by construction, so a coarse class keeps
       * every instance it had and simply gathers them onto the bars instead of
       * spreading them over the sand. */
      const sortU = clamp(0.5 + 1.55 * (fbm(s * 0.055, u * 0.34, 3, 5501) * 0.70
                                      + fbm(s * 0.145, u * 0.62, 2, 5507) * 0.30),
                          0, 1);
      /* Sharpened, because a bar has a margin. Left as raw fBm the patches shade
         into one another and the result is a slow drift in mean grain size, which
         is not what sorting looks like — sorting looks like a boundary. */
      const patch = sortU * sortU * (3 - 2 * sortU);
      const w = cl.weight(fc) * (1 + 0.92 * (2 * gRank - 1) * (2 * patch - 1));
      if (w <= 0.004 || rand() > clamp(w, 0, 1)) continue;

      const y = terrain.heightAtQ(x, z, q);
      const e = Math.max(0.14, cl.rMax * 0.7);
      const hx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
      const hz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
      nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      if (1 - nrm.y > cl.maxSlope) continue;
      /* Ground gradient under the clast, kept for the seat below. A stone rests
         on the highest ground beneath it, not on the ground under its centre,
         and the difference is the clast's own radius times the slope — which is
         nothing on the wash floor and several centimetres on a bench. Seating
         everything at its centre height is the second reason the benches grew
         shards: half of every clast on a slope was under the surface before
         burial was applied at all. */
      const grad = Math.hypot(hx, hz) / (2 * e);

      /* And the same sorting within the class, at half the strength. Gathering
         the coarse classes onto the bars is most of the effect, but a bar whose
         own gravel still spans the class's full range is only half sorted — the
         local spread has to narrow too, or the patch reads as a denser version of
         the same mixture rather than as a different deposit. */
      const uSz = clamp(rand() + (patch - 0.5) * 0.50, 0, 1);
      let rad = cl.rMin + Math.pow(uSz, cl.sizeP || 1.7) * (cl.rMax - cl.rMin);
      if (cl.taper) rad *= 0.40 + 0.60 * (1 - fc.talPos);

      /* ---- lithology by size, and by what it is sitting in ----
       * Two physical constraints, and between them they remove the large pale
       * neutral faces that were the worst objects in the frame without touching
       * the polychrome scatter at pebble scale, where it belongs.
       *
       * Competence. A flood can roll a granule from the Rim and only shove a
       * half-metre block a few metres, so grain size and travel distance are
       * inversely related: the small fraction is exotic and mixed, the coarse
       * fraction is local. That is why an off-white Coconino *pebble* on red soil
       * is one of the things people notice about these washes and an off-white
       * Coconino *slab* in the middle of the channel is not a thing that happens.
       *
       * Provenance. A clast weathering out of a cut bank came out of that bank,
       * so it is the same material as the matrix around it and the contrast
       * between them is low. Drawing bank clasts from the general mix is what
       * turned the bank faces into near-white ellipsoids on a near-black ground —
       * measured as polka dots, and correctly. */
      const sizeFr = clamp((rad - cl.rMin) / Math.max(1e-6, cl.rMax - cl.rMin), 0, 1);
      /* Onset pulled down from 0.20 to 0.11 — from about eleven degrees of slope
         to six. The pale ovals a critic found on the shaded bank in `wash_low`
         were on a bank *toe*, which is gentler than eleven degrees, so none of
         the provenance logic below was firing on them at all: they were drawing
         from the general mix and skipping the matrix blend, which is precisely
         the polka-dot mechanism on a surface the gate could not see. A bank toe
         is still a bank — the clasts in it weathered out of the same alluvium. */
      const bankF = clamp((1 - nrm.y - 0.11) / 0.30, 0, 1);
      let cdfUse = cl.lith;
      if (cdfUse === CDF_T && (bankF > 0.15 || rand() < Math.pow(sizeFr, 1.2))) cdfUse = CDF_L;
      const lith = pickLith(cdfUse, rand());

      /* ---- where a *pale* coarse clast is allowed to be ----
       * The pale lithologies stay: a scatter of off-white Coconino on red soil is
       * one of the most recognisable things about these washes and it was asked
       * for by name. What was wrong was the distribution — the reference is one or
       * two conspicuous pale blocks in a frame, and this was producing a field of
       * plates spread evenly across the apron.
       *
       * Two constraints, both of them the same physics as the rest of the file.
       * Coconino is the *cap*, so a pale block started its fall from the top of
       * the wall, and how far a block leaves the wall scales with how far it fell:
       * the coarse pale fraction belongs at the apron **toe**, which is talPos 0,
       * not distributed up the ramp. And rockfall is an event, so it arrives in
       * the same lobes `pile` already describes rather than as a sprinkle.
       *
       * The constant started at 0.60 and is 0.22, which is a large move made on
       * evidence rather than taste. At 0.60 the survival rate where the rule says
       * pale blocks *belong* — the toe, inside a lobe — was still 60%, and the
       * fixed ground viewpoint happens to stand on a toe lobe, so concentrating
       * them physically correctly delivered them all into the one framing that was
       * already complaining. Redistribution is not thinning. At 0.22 the density
       * is about one in five where they belong and one in thirty elsewhere.
       *
       * The survivors are then pushed *up* in size. That is the point rather than
       * a side effect: what the eye reads as Sedona is a few big conspicuous pale
       * blocks, and what it reads as builders' rubble is many medium ones. Same
       * total pale area, concentrated. */
      const lithL = 0.2126 * LITH[lith][0] + 0.7152 * LITH[lith][1] + 0.0722 * LITH[lith][2];
      if (lithL > 0.40 && rad > 0.14) {
        /* And the rejection gets harder with size, which is the same competence
           argument the file already makes for boulders, stopped short of deleting
           the lithology. The requested signature is "the big off-white boulders
           sitting incongruously on the red soil" — a *few* of them — and the
           defect is a paving stone at arm's length. Both are satisfied by making
           the largest pale draws the rarest rather than by capping the size: a
           0.15 m pale block survives about three times in ten where it belongs, a
           0.34 m one about once in twenty-five. Rockfall frequency and flood
           competence both fall steeply with block size, so does this. */
        const rk = clamp((rad - 0.14) / 0.20, 0, 1);
        if (rand() > (1 - fc.talPos * 0.85) * Math.min(1, fc.pile)
                   * (0.30 - 0.26 * rk)) continue;
      }
      /* No size push here, and that is a reversal within the round. Pushing the
         surviving pale draws up toward rMax was meant to give "a few big
         conspicuous blocks", and what it gave was a heap of same-sized paving
         stones in the near field of `ground` — worse than what it replaced,
         because uniform *and* large is the shape of a stack of pallets. The
         thinning belongs in the placement gate above; the size distribution was
         already right. */

      emit(cl, buckets[placed % cl.variants], x, y, z, rad, lith, rand, th, nrm, bankF, grad);
      placed++;

      if (cl.scour && sizeFr > cl.scourFrom) {
        /* Upstream is up-wash: the flood came down the wash, so it stalls against
           the face pointing back the way it came. */
        const ux = Math.sin(th), uz = -Math.cos(th);
        /* Genuine excavation, for the classes coarse enough that the grid can
           carry it. Registered *after* this stone is seated, so it sits on its
           own undisturbed footing, and before the rest of the population, so
           the fillet, the tail and the collar stones all follow the dug bed.
           The direction handed over is downstream, which is where the horseshoe
           opens and where the lifted sediment lands. */
        if (cl.excavate && rad >= 0.24 && bankF < 0.35) {
          terrain.addScour(x, z, rad, -ux, -uz, rad * cl.excavate);
        }
        /* ---- the fillet, which is the piece that was missing ----
         * There was an upstream wedge and a downstream tail already, and three
         * critics running still called the burial the strongest tell. Looking at
         * a magnified crop says why: a wedge on one side and a tail on the other
         * leave the stone's *waterline* — the line where it meets the bed all the
         * way round — a clean intersection between a hull and a smooth plane. A
         * real one is not clean. Fines bank against every face, not only the
         * upstream one, in a low collar that dies out within a radius or so.
         * So this is a broad flat lens centred on the stone and mostly below the
         * surface: a couple of centimetres of relief on a cobble, no silhouette
         * of its own, and its job is entirely to break that waterline.
         * It is also a shade darker and damper than the open bed, which is not
         * decoration — the fines at a stone's foot sit in its shadow most of the
         * day and hold moisture longer, and that tone is what actually reads at
         * the distance where the two centimetres of relief have gone. */
        if (cl.fillet && rand() < cl.fillet) wedges.push({
          x, z, th, damp: true,
          sx: rad * (1.55 + rand() * 0.55), sy: rad * (0.26 + rand() * 0.14),
          sz: rad * (1.55 + rand() * 0.55), sink: 0.72,
        });
        wedges.push({
          x: x + ux * rad * 0.80, z: z + uz * rad * 0.80, th,
          sx: rad * (1.30 + rand() * 0.55), sy: rad * (0.34 + rand() * 0.20),
          sz: rad * (0.72 + rand() * 0.34), sink: 0.42,
        });
        /* Shorter and wider than it was, and that is a bug fix rather than a
           taste change. At up to 3.4 radii long by 0.85 wide by 0.34 thick the
           tail was a ten-to-one sliver, and several thousand of those scattered
           across the floor were reported as "matchsticks or splinters — at their
           current aspect ratio they look like litter". A real depositional tail is
           a low tapered swell of fines, closer to twice as long as it is wide, and
           it belongs mostly *below* the surface: it is a change in the shape of
           the bed, not an object lying on it. */
        if (cl.scourTail) wedges.push({
          x: x - ux * rad * 1.35, z: z - uz * rad * 1.35, th,
          sx: rad * (0.80 + rand() * 0.34), sy: rad * (0.22 + rand() * 0.14),
          sz: rad * (1.35 + rand() * 0.75), sink: 0.60,
        });
      }

      if (cl.collar && rad > cl.rMin + (cl.rMax - cl.rMin) * 0.25) {
        const n = 2 + ((rand() * cl.collar) | 0);
        for (let k = 0; k < n; k++) {
          const ang = rand() * Math.PI * 2;
          const d = rad * (0.85 + rand() * 0.9);
          collars.push({
            x: x + Math.cos(ang) * d, z: z + Math.sin(ang) * d,
            rad: rad * (0.06 + rand() * 0.16), lith,
          });
        }
      }
    }

    buckets.forEach((list, vi) => {
      if (!list.length) return;
      meshes.push(makeMesh(geoms[vi], mat, list, cl.name + vi, cl.shadow));
    });
  });

  /* collar clasts, as one extra bucket.
     Angular, like everything else. These were the last smooth ellipsoids in the
     scene and they cluster against the largest clasts and up the bank faces,
     which is exactly where the eye goes — a faceted boulder ringed by eight
     smooth eggs reads as two different materials. */
  if (collars.length) {
    const g = angularClast(5519, 0.58, 7);
    const rand = rng(31337);
    const list = [];
    for (const c of collars) {
      path.atZ(c.z, q);
      const y = terrain.heightAtQ(c.x, c.z, q);
      const e = 0.16;
      const hx = terrain.heightAt(c.x + e, c.z) - terrain.heightAt(c.x - e, c.z);
      const hz = terrain.heightAt(c.x, c.z + e) - terrain.heightAt(c.x, c.z - e);
      nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      quat.setFromUnitVectors(up, nrm);
      spin.setFromAxisAngle(up, rand() * Math.PI * 2);
      quat.multiply(spin);
      const t = 0.82 + rand() * 0.36;
      const cl0 = LITH[c.lith];
      const clum = 0.2126 * cl0[0] + 0.7152 * cl0[1] + 0.0722 * cl0[2];
      const cfl = Math.min(1.5, Math.max(1, 0.26 / Math.max(1e-4, clum * t)));
      list.push({
        x: c.x, y: y - c.rad * 0.45, z: c.z,
        q: quat.clone(),
        sx: c.rad * (0.85 + rand() * 0.4),
        sy: c.rad * (0.7 + rand() * 0.4),
        sz: c.rad * (0.85 + rand() * 0.4),
        r: cl0[0] * t * cfl, g: cl0[1] * t * cfl, b: cl0[2] * t * cfl,
      });
    }
    meshes.push(makeMesh(g, mat, list, 'collar', false));
  }

  /* banked wedges and depositional tails, in matrix colour */
  if (wedges.length) {
    /* Detail zero deliberately: a wedge of banked sand is a few centimetres proud
       and half buried, so twenty faces is all it can show, and at five thousand
       instances the difference is a third of a million triangles. */
    const g = roundedClast(0, 8.9, 0.55);
    const rand = rng(60613);
    const list = [];
    for (const w of wedges) {
      path.atZ(w.z, q);
      const y = terrain.heightAtQ(w.x, w.z, q);
      const e = 0.20;
      const hx = terrain.heightAt(w.x + e, w.z) - terrain.heightAt(w.x - e, w.z);
      const hz = terrain.heightAt(w.x, w.z + e) - terrain.heightAt(w.x, w.z - e);
      nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      /* Long axis down the flow, seated on the surface normal. */
      bz.set(-Math.sin(w.th), 0, Math.cos(w.th));
      by.copy(nrm);
      bz.addScaledVector(by, -bz.dot(by)).normalize();
      bx.crossVectors(by, bz);
      basis.makeBasis(bx, by, bz);
      quat.setFromRotationMatrix(basis);
      const t = (0.88 + rand() * 0.28) * (w.damp ? 0.84 : 1.0);
      /* A damp fillet is not just darker, it is redder: water in the pore space
         deepens the oxide rather than greying it, which is why wet red dirt goes
         maroon and not brown. Same reasoning as uDamp on the terrain. */
      const dr = w.damp ? 1.06 : 1.0, dg = w.damp ? 0.93 : 1.0, db = w.damp ? 0.96 : 1.0;
      list.push({
        x: w.x, y: y - w.sy * w.sink, z: w.z,
        q: quat.clone(), sx: w.sx, sy: w.sy, sz: w.sz,
        r: MATRIX_COL[0] * t * dr, g: MATRIX_COL[1] * t * dg, b: MATRIX_COL[2] * t * db,
      });
    }
    meshes.push(makeMesh(g, mat, list, 'scour', false));
  }

  return meshes;

  /* ── placement of one instance ── */
  function emit(cl, bucket, x, y, z, rad, lith, rand, th, n, bankF = 0, grad = 0) {
    /* ---- discs and blades, which are what imbricate ----
     * "Perfect spheroids", said the critic, and the population was near-equant:
     * yf ran 0.82 to 1.23 against a class flattening of 0.5, so the typical
     * gravel was two thirds as thick as it was wide. A stone that shape has no
     * broad face to lie on, which is why three quarters of the bed was nominally
     * imbricated and the imbrication was reported as absent — a dip of twenty
     * degrees on a near-sphere is not visible on anything.
     * Real gravel is a mixture of blades, discs and equant fragments, and it is
     * the platy fraction that stacks like roof shingles. So flatten that fraction
     * properly and let it carry the fabric, rather than tilting everything a
     * little and hoping. Imbrication is gated on it for the same reason: a disc
     * imbricates, a ball does not, and a ball tilted upstream is just a tilted
     * ball. */
    const platy = rand() < 0.52;
    /* Fallen sandstone is bedded, so it breaks squat and tabular rather than
       equant. A block as tall as it is wide, sat on a slope, is a tent — and a
       slope of tents is the exact silhouette of scattered folded card. */
    const yf = cl.squat ? 0.44 + rand() * 0.30
             : platy ? 0.40 * (1 + rand() * 0.55)
             : (cl.kind === 'angular' ? 0.82 : 0.70) * (1 + rand() * 0.5);

    /* ---- burial, measured against thickness rather than radius ----
     * A clast that has sat through one flood is worked down into the bed, and a
     * bed where every stone sits fully proud is a bed where objects were placed on
     * a surface, which is exactly what it kept reading as.
     *
     * The depth has to be a fraction of the clast's *vertical* half-extent, not of
     * its radius, and getting that wrong produced two opposite failures at once.
     * A tabular slab is only 0.44 to 0.74 radii thick, so sinking it by 0.70 to
     * 1.00 radii buried it past its own top surface — and then, wherever the
     * ground fell away beside it, one corner emerged as a thin blade with no body
     * behind it. Meanwhile the near-equant boulders, sunk by the same fraction of
     * a much larger half-height, barely settled at all. Expressed against
     * thickness, "sunk to the shoulders" means the same thing for both.
     */
    const halfH = rad * yf;
    /* ---- and measured against the thickness the clast actually has ──────────
     * The comment above is right about what burial should be measured against
     * and then measures it against the wrong number, which is how the scene
     * ended up with "dozens of thin flat triangular plates standing straight up
     * out of the bench, like glass shards stuck in dirt".
     *
     * `halfH` is the instance's *y scale*, not its half-height. The geometry it
     * scales has already been flattened by `cl.flat` — `ay = flat` in
     * angularClast, `v.y *= flatten` in roundedClast — so the clast's true
     * vertical half-extent is `halfH * flat`, and flat runs 0.42 to 0.86. Sink
     * fractions of 0.5 to 1.0 were therefore delivering 1.0 to 2.3 in the units
     * that matter:
     *
     *   class      flat   nominal sink   actual, in half-heights
     *   gravel     0.50   0.52 - 0.96    1.04 - 1.92
     *   cobble     0.42   0.54 - 0.98    1.29 - 2.33
     *   block      0.62   0.52 - 0.94    0.84 - 1.52
     *   boulder    0.86   0.56 - 0.94    0.65 - 1.09
     *
     * **Nearly the whole population was seated at or below its own top surface.**
     * What survived into the frame was not the clasts but the places where the
     * ground happened to fall away beside one, which exposes a corner of a
     * convex hull clipped by a sloping plane — a thin triangle with no body
     * behind it. Hence shards, hence "dozens", hence worst on a bench where the
     * ground is doing the most falling away. It also explains why the floor
     * looked as though it had pebbles resting *on* it: a cap emerging from a
     * buried stone is the same shape as a small stone lying on the surface, and
     * there was no contact shadow to tell them apart.
     *
     * The hard cap is the part to keep. Burial is a distribution and a
     * distribution has a tail, but a clast buried past its own top is not a
     * deeply bedded clast — it is an invisible one that bills for a draw call
     * and occasionally emits a shard. */
    const flatY = (cl.kind === 'angular' ? cl.flat : cl.flatten) || 1;
    const hTrue = halfH * flatY;
    /* ---- how far a stone can tilt before an edge lifts clear of the bed ----
     * The large flat clasts came out standing proud with a black void under one
     * edge, and the cause is that the wobble applied to a seated clast is a
     * constant while the thickness that has to absorb it is not. A plate of
     * radius r tilted by a lifts its rim by r*sin(a); if that exceeds the burial
     * the far edge hangs in the air, and at plus or minus eighteen degrees on a
     * 30 cm slab that is nine centimetres of lift against about six of burial.
     * So the tilt a clast is allowed is a property of its own aspect: roughly
     * the angle whose tangent is its thickness over its radius. An equant cobble
     * can sit at any angle it likes and a bedding-split plate essentially cannot,
     * which is also just true of real ones. */
    const tiltCap = Math.atan2(hTrue * 1.7, rad);
    if (cl.imbricate > 0 && rand() < cl.imbricate * (platy ? 1.0 : 0.30)) {
      /* Imbrication: platy clasts stack like roof shingles, their flat faces
         dipping upstream and their long axes across the flow. It is the single
         most recognisable signature of water transport, and it is free. */
      fwd.set(Math.sin(th), 0, -Math.cos(th));            // up-wash = upstream
      right.set(Math.cos(th), 0, Math.sin(th));
      /* Clamped by the same aspect rule: imbrication lifts the downstream edge,
         and in a real bed that edge rests on the next stone. Nothing here
         simulates the next stone, so a dip steeper than the clast is thick
         hangs over open ground and reads as floating rather than as fabric. */
      const dip = Math.min(0.20 + rand() * 0.24, tiltCap);
      by.copy(n).multiplyScalar(Math.cos(dip)).addScaledVector(fwd, Math.sin(dip)).normalize();
      bx.copy(right).addScaledVector(by, -right.dot(by)).normalize();
      bz.crossVectors(bx, by);
      basis.makeBasis(bx, by, bz);
      quat.setFromRotationMatrix(basis);
      /* Widened from +-20 to +-32 degrees about the dip axis. Imbrication is a
         real and strongly preferred orientation and it is staying at three
         quarters of the bed, but a *perfectly* shared long axis is a fabric
         measurement, not a photograph: real imbricated gravel scatters by twenty
         or thirty degrees around the mean, and the scatter is what stops the bed
         reading as a tiled roof. */
      spin.setFromAxisAngle(by, (rand() - 0.5) * 1.12);   // about the dip axis, so it costs no lift
      quat.premultiply(spin);
    } else if (cl.orient === 'random') {
      /* A block that spalled off a wall and bounced down an apron comes to rest
         on whichever facet it happened to land on — usually a broad one, hence
         the bias toward the surface normal, but sometimes propped against its
         neighbours at a steep angle. Fully uniform rotations look tumbled in a
         barrel; seating them all flat leaves every broad face pointing at the
         sky, which is what read as scattered cardboard. This is neither. */
      quat.setFromUnitVectors(up, n);
      spin.setFromAxisAngle(up, rand() * Math.PI * 2);
      quat.multiply(spin);
      /* Pulled back again, and further for the tabular classes. A plate tilted
         even thirty degrees presents its thin edge to the camera as a knife-edged
         sliver wherever the ground falls away under it, and one of those in the
         near field was described as "a paper-thin knife-edged wing floating over
         the sand". The thinner the clast, the less tilt it can carry before its
         silhouette stops being a rock. Blocks in a real apron are wedged against
         each other at shallow angles in any case, not propped on end. */
      const tilt = Math.min(Math.pow(rand(), 1.6) * (cl.squat ? 0.34 : 0.60), tiltCap);
      const ta = rand() * Math.PI * 2;
      spin.setFromAxisAngle(bx.set(Math.cos(ta), 0, Math.sin(ta)), tilt);
      quat.multiply(spin);
    } else {
      /* Broad face down, with only a few degrees of wobble. A tabular clast that
         split along a bedding plane has a stable face and it lands on it. */
      quat.setFromUnitVectors(up, n);
      spin.setFromAxisAngle(up, rand() * Math.PI * 2);
      quat.multiply(spin);
      const wob = Math.min(0.22, tiltCap * 0.75);
      spin.setFromAxisAngle(bx.set(1, 0, 0), (rand() - 0.5) * 2.0 * wob);
      quat.multiply(spin);
      spin.setFromAxisAngle(bz.set(0, 0, 1), (rand() - 0.5) * 2.0 * wob);
      quat.multiply(spin);
    }

    let sink = hTrue * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
    if (cl.deepSink && rand() < cl.deepSink) sink = hTrue * (0.74 + rand() * 0.16);
    sink = Math.min(sink, hTrue * 0.90);
    /* ---- and the slope correction has to be capped, or it undoes the burial ----
     * A stone rests on the highest ground beneath it rather than on the ground
     * under its centre, so seating it on a slope needs raising by roughly its
     * half-width times the gradient. That is right, and uncapped it was a
     * catastrophe, because the two quantities are measured against different
     * lengths: the burial is a fraction of the clast's *thickness* and the
     * correction is a fraction of its *radius*, and a tabular clast is three or
     * four times wider than it is thick.
     *
     * Measured on the floor over the 0.28 m baseline this actually samples —
     * median gradient 0.248, p90 0.831, p99 1.771 — against a median gravel whose
     * whole burial is 1.3 to 2.4 cm:
     *
     *   gradient   correction   as a share of the burial
     *   median      0.68 cm      about a third of it
     *   p90         2.29 cm      all of it
     *   p99         4.87 cm      twice the clast's entire height
     *
     * So a tenth of the floor had gravel sitting completely proud or floating
     * clear of the ground, and everywhere else a third of the burial was gone.
     * That is why "no burial" came back as a critique in the same round the
     * burial was supposedly fixed, and it got worse when the 0.1-1 m band went
     * into the height field, because that raised the gradient at this baseline
     * everywhere. Capped at a third of the thickness, with a floor under the
     * result so that no clast is ever seated on top of the bed.
     *
     * And on reflection the correction had the wrong *sign*, not merely the
     * wrong magnitude. "A stone rests on the highest ground beneath it" is true
     * of a stone dropped on a plane it is not aligned with — but every branch
     * above seats the clast on the local surface normal, so the alignment has
     * already happened and there is nothing left to raise it for. Subtracting
     * again was compensating twice for something done once.
     * What the normal genuinely cannot see is roughness finer than the baseline
     * it is sampled over, 28 to 49 cm depending on class, and that roughness
     * leaves gaps *under* the clast rather than beneath one edge. Burying a
     * little deeper on rough ground closes them, so the residual term is added.
     * Small, and capped, because the failure mode on this side is the shard.
     */
    sink += Math.min(grad * rad * 0.18, hTrue * 0.22);
    sink = Math.min(Math.max(sink, hTrue * 0.34), hTrue * 0.95);
    /* Per-instance value spread, times a per-class factor: talus is dusty and
       sits in the wall's own shadow half the day, and pale blocks at that scale
       read as builders' rubble unless they are knocked back. */
    /* Narrow. A wide per-instance value spread on top of eight lithologies mixes
       them back together — a dark limestone and a bright basalt land on the same
       screen value and the polychrome scatter stops being legible as rock types. */
    const t = (0.84 + rand() * 0.22 * (1 - bankF * 0.7)) * cl.tint;
    let L = LITH[lith];
    /* ---- paleCut: a pale clast is fine, a pale *boulder* is not ----
       The eye forgives a scatter of off-white pebbles on red soil — it is one of
       the things people notice about these washes — and it does not forgive a
       pale object the size of a chair, because at that scale there is nothing in
       a desert that is both large, smooth and light except concrete. The two
       facts are the same fact seen at different subtended angles, so the cure is
       a function of radius rather than a different palette: above about a
       quarter of a metre the pale lithologies are pulled toward the local matrix
       in proportion to how far past that they are. Nothing changes at pebble
       scale, where the polychrome scatter belongs. */
    /* ---- and why this is now weak, having been strengthened twice ----
       This is the pigment lever, and four rounds established that it does not
       work: it moved a near-field boulder from 162 to 152 against a bed at 120
       and it was still the loudest object in the frame. Worse, it was actively
       in the way. Pulling every pale draw two thirds of the way to a dark red
       collapsed the *luminance separation between lithologies*, which is the only
       per-instance signal the shader's dust term has to work with — so the film,
       which is the mechanism that actually looks like a dust film because it acts
       on sky-facing facets only, was firing at almost zero on exactly the clasts
       it was built for. A uniform pull toward red and an oriented film are not
       additive; the first one hides the second. Cut to about a quarter, enough to
       take the top off the extreme pale draws at large size, and the film does
       the rest. */
    const paleL = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
    if (paleL > 0.34 && rad > 0.09) {
      const k = clamp((rad - 0.09) / 0.14, 0, 1) * clamp((paleL - 0.34) / 0.16, 0, 1) * 0.22;
      /* Toward a *darker* dusty local tone, not toward MATRIX_COL. Mixing toward
         the matrix was the obvious thing and it did nothing measurable, for a
         reason worth recording: the matrix and buff sandstone have almost the
         same luminance — 0.431 against 0.449 — so the mix rotated the hue and
         left the value exactly where the problem was. What makes a large pale
         clast read as concrete is that it is *brighter* than the bed, and the
         reason a big one is not, in life, is that it has stood there long enough
         to take a coat of the local dust and a desert varnish in its hollows. */
      const P = [0.470, 0.290, 0.196];
      L = [mix(L[0], P[0], k), mix(L[1], P[1], k), mix(L[2], P[2], k)];
    }
    /* A clast half weathered out of a bank face is still partly coated in the
       matrix it came out of, so it differs from the bank by a shade rather than by
       a colour. This is the difference between a section through alluvium and a
       field of polka dots. */
    /* Raised from 0.55. A clast weathering out of a cut bank is the *same rock*
       as the bank, so the contrast between them is a shade — the polka-dot read
       is what happens when it is a colour. Three quarters of the way to the
       matrix leaves enough difference to see the stone and not enough to make it
       a dot, and the per-instance value jitter is squeezed on those faces for the
       same reason: on a bank it was the jitter, not the lithology, doing most of
       the work. */
    if (bankF > 0.01) {
      const k = bankF * 0.74;
      L = [mix(L[0], MATRIX_COL[0], k), mix(L[1], MATRIX_COL[1], k), mix(L[2], MATRIX_COL[2], k)];
    }
    /* Albedo floor. Three multipliers stack here — lithology, the per-class dust
       factor and the per-instance value jitter — and the product of the low end of
       all three used to land at about 0.02 linear albedo once the clast texture
       was applied. That is darker than any mineral on earth, and it produced the
       single worst read in the last set: a faceted slab sitting in full sun on a
       bright sand floor at essentially zero luminance, a hole cut in the frame.
       Under an open sky dome above a pale reflective bed, no rock face reads below
       about a sixth of the sunlit value, and the fill it picks up from a violet sky
       dome over a warm bed only reads as violet if there is some albedo left for it
       to act on — below this the fill *is* the colour and the stone comes out navy. */
    /* On luminance, and capped — as a multiplier on the darkest *channel* this was
       a bug with visible consequences. The iron-stained red is (0.72, 0.205,
       0.088), so keying the floor off its blue channel asked for a gain of four,
       and the whole tint went up with it: a dump of the instance colours showed
       clasts leaving here at 2.46 linear albedo. Nothing reflects two and a half
       times the light that falls on it. Those instances rendered as blown white
       specks, which is most of what the surviving one-to-two-pixel white chips on
       the shaded banks were — diagnosed twice as an aliasing problem and it was an
       arithmetic one. Luminance is what "no rock reads at zero" was ever about, and
       the cap keeps a saturated pigment from being brightened into a light source. */
    const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
    const fl = Math.min(1.5, Math.max(1, 0.26 / Math.max(1e-4, lum * t)));
    /* ---- plan aspect, widened per class ----
       This was held at 0.88 to 1.18 to stop the tabular classes coming out as
       splinters, and it worked, but it applied the fix to the whole scene: every
       clast in the frame shared one plan shape, which is the "small clasts are
       ellipsoids sharing aspect ratio" a critic named. The two facts are
       reconcilable — what makes a splinter is a high plan aspect *on top of* a
       high flattening, so the long axis is taken out of the short one rather
       than added to the long, which keeps the volume and the minimum dimension
       roughly fixed while the outline goes from equant to bladed. Skewed toward
       the equant end because most of a gravel is. */
    const asp = cl.aspect || [0.88, 1.18];
    const ea = Math.pow(rand(), 1.35);
    const ex = asp[0] + ea * (asp[1] - asp[0]);
    /* ---- the dust weight, computed here rather than in the shader ----
     * It was derived in the vertex shader from the instance colour's luminance,
     * and that was wrong twice over for the same reason: what arrives there is
     * the lithology times the class dust factor times the per-instance jitter
     * times the albedo floor times whatever paleCut did, so the threshold had to
     * be guessed against a distribution nobody had measured. Both guesses missed.
     * The first put the gate entirely above the population and the term did
     * nothing at all; the second landed on its lower shoulder and delivered a
     * third of the intended film to a Coconino block — which is why the plates
     * came back buff after being nominally dusted at three quarters.
     *
     * Here the lithology index is in hand, so the weight is exact and reads as
     * what it is: how pale the *rock* is, times how long it has plausibly lain
     * still, for which instance size is the available proxy. One float per
     * instance, which is cheaper than the varying it replaces was to get wrong. */
    const resid = clamp((rad - 0.075) / 0.16, 0, 1);
    const dustW = resid * (0.30 + 2.85 * clamp((paleL - 0.33) / 0.19, 0, 1));
    /* ---- how much sky this stone can actually see ──────────────────────────
     * The most frequent single tell in the whole set: "the wash floor's pebble
     * layer is lit as if the shadows weren't there", and a shaded bank that
     * reads as salt-and-pepper static rather than as ground. Measured off
     * `sys7e_nopost_wash_low`, a pale clast on the shaded bank stands about 4x
     * its matrix, against 1.6x for the same pair in sun — so the clasts are not
     * ignoring the shadow map, they are taking far more *fill* than the bed they
     * are lying in, and in shade fill is all there is.
     *
     * The previous round found the gap and closed a quarter of it: terrain.js
     * multiplies its indirect by tAO and the clasts had nothing, so a
     * size-keyed factor went in. But it keyed on size alone, which means gravel
     * — 16500 of the 24000 instances and the entire "pebble layer" the critique
     * is talking about — got 1.0 and kept the full unoccluded dome.
     *
     * Size is only one of three reasons a stone sees less sky than open ground,
     * and it is the weakest. A stone worked into the bed is walled by the bed;
     * a stone on a bank has half its horizon filled by the bank; a big one is
     * wedged among its neighbours. All three are known here on the CPU, exactly
     * and per instance, so there is no reason to guess at them in a shader.
     *
     * No tint is applied with it, deliberately. The measurement also says floor
     * shadows carry no sky colour, which is true and is not mine to fix: a
     * hand-rolled blue fill on a clast is precisely the blue-chip defect I spent
     * a round removing, and it will be wrong again the moment the environment
     * changes. Occlude correctly and let System 4 own the colour of the dome. */
    const buried = clamp(sink / Math.max(hTrue, 1e-4), 0, 1);
    /* Coefficients set from a paired capture rather than from first principles,
       because the first set was calibrated against the wrong baseline. At 0.46
       and 0.34 a bank gravel came out at 0.65 of the dome, the shaded bank's
       statistics did not move at all, and the reason is worth recording: the
       burial fix above roughly doubles the clast area on show, so a 35% dimming
       spread over twice the area is invisible to a region mean. Two corrections
       that each work, cancelling. An embedded granule on a bank sees perhaps a
       third of the sky — it is walled by the bed it is set into and the bank
       above fills half of what is left — so these now land near 0.30 there
       while an open-floor stone keeps about 0.55. */
    const aoI = clamp((1 - 0.58 * buried)
                    * (1 - 0.46 * clamp(grad / 0.55, 0, 1))
                    * (1 - 0.24 * clamp((rad - 0.06) / 0.30, 0, 1)), 0.26, 1.0);
    bucket.push({
      ao: aoI,
      dust: dustW,
      x, y: y - sink, z,
      q: quat.clone(),
      sx: rad * ex,
      sy: halfH,
      sz: rad / Math.max(0.55, ex) * (0.86 + rand() * 0.26),
      r: L[0] * t * fl, g: L[1] * t * fl, b: L[2] * t * fl,
    });
  }

  function makeMesh(geom, material, list, name, shadow) {
    const im = new THREE.InstancedMesh(geom, material, list.length);
    const dust = new Float32Array(list.length);
    const aoA = new Float32Array(list.length);
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.name = name;
    list.forEach((o, i) => {
      obj.position.set(o.x, o.y, o.z);
      obj.quaternion.copy(o.q);
      obj.scale.set(o.sx, o.sy, o.sz);
      obj.updateMatrix();
      im.setMatrixAt(i, obj.matrix);
      col.setRGB(o.r, o.g, o.b);
      im.setColorAt(i, col);
      dust[i] = o.dust || 0;
      aoA[i] = o.ao === undefined ? 0.86 : o.ao;
    });
    geom.setAttribute('aDust', new THREE.InstancedBufferAttribute(dust, 1));
    geom.setAttribute('aAO', new THREE.InstancedBufferAttribute(aoA, 1));
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    return im;
  }
}
