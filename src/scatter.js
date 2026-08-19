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
import { rng, fbm, clamp } from './noise.js';

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
    const j = t * (0.70 + rand() * 0.40);
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
const LITH = [
  [0.72, 0.205, 0.088], // iron-stained red sandstone — carries the saturated tail
  [0.52, 0.31, 0.235],  // red Schnebly Hill sandstone
  [0.78, 0.40, 0.135],  // orange mud-coated clast
  [0.62, 0.51, 0.41],   // buff sandstone
  [0.76, 0.71, 0.64],   // off-white Coconino
  [0.47, 0.45, 0.42],   // grey Fort Apache limestone
  [0.31, 0.275, 0.255], // desert-varnished dark pebble
  [0.60, 0.50, 0.36],   // buff chert
  [0.72, 0.68, 0.62],   // cream caprock limestone
  [0.78, 0.77, 0.74],   // quartz
];
/* Transported clasts came from anywhere upstream, so they are mixed — and only
   about half of them are the local red family. Talus fell off the wall thirty
   metres above it, so it is nearly all local: an apron of pale blocks reads as
   builders' rubble rather than as a collapsed wall. */
const MIX_TRANSPORTED = [0.17, 0.20, 0.10, 0.13, 0.07, 0.10, 0.11, 0.06, 0.04, 0.02];
const MIX_LOCAL       = [0.22, 0.46, 0.06, 0.14, 0.02, 0.02, 0.04, 0.02, 0.015, 0.005];
/* Blocks and slabs get their own mix with the extremes taken out. The saturated
   iron staining and the mud coating are *coatings on small transported clasts* —
   a film picked up in the bed — and at pebble scale they are what gives the floor
   its saturated tail. On a half-metre bedding slab the same albedo is a solid
   brick-red rectangle, and a scatter of those on the floor read unmistakably as
   shipping containers. A block that spalled off the wall is wall rock: the local
   red sandstone, sometimes buff or grey, never a vivid stain and never near-black. */
const MIX_BLOCK       = [0.02, 0.50, 0.01, 0.24, 0.04, 0.08, 0.03, 0.05, 0.025, 0.005];

function pickLith(mixCdf, r) {
  for (let i = 0; i < mixCdf.length; i++) if (r <= mixCdf[i]) return i;
  return 0;
}
const cdf = (w) => { let a = 0; return w.map(v => (a += v)); };
const CDF_T = cdf(MIX_TRANSPORTED), CDF_L = cdf(MIX_LOCAL), CDF_B = cdf(MIX_BLOCK);

/* ── classes ───────────────────────────────────────────────────────────── */

/* `weight` turns the facies mix at a point into a placement probability. This
   is the whole sorting model, and it is the difference between a flow map and
   a sprinkle. */
const CLASSES = [
  {
    /* Angular, like everything above it. Every clast below cobble size used to be a
       smooth ellipsoid, and a bed of ellipsoids under a hull-faceted cobble layer
       reads as two different worlds in one frame. The faceted shape language works
       and it extends downward: a granule that split off bedded sandstone has the
       same flat faces and sharp arrises a cobble does, only smaller. Fewer bevel
       points than a cobble, because abrasion rounds the small fraction fastest. */
    name: 'gravel', kind: 'angular', variants: 3, count: 13000, uMax: 18,
    flat: 0.50, bevel: 8,
    rMin: 0.024, rMax: 0.090, maxSlope: 0.58, shadow: true, orient: 'surface',
    /* Sunk deeper. A bed where every stone sits fully proud is a bed where objects
       were placed on a surface, and that was still the read. Half of these now go in
       past their shoulders, which also cuts the number of full silhouettes in the
       midground and with it the variance that was hashing. */
    imbricate: 0.28, sink: [0.52, 0.86], deepSink: 0.46, lith: CDF_T, tint: 1.0,
    weight: (fc) => (fc.chan * (0.45 + 0.85 * fc.lag) + fc.bar * 0.85 + fc.terr * 0.22)
                  * (0.30 + 1.30 * fc.string)
                  * (1 - fc.bare * 0.95) * (1 - fc.sheet) * (1 - fc.pan),
  },
  {
    /* Angular, not rounded. A water-worn sandstone cobble is rounded *at its
       edges* but it split off a bedded rock, so it keeps one or two flat parallel
       faces and chipped rectilinear corners, and it comes to rest broad-face
       down. Ellipsoids read as potatoes however they are textured. */
    name: 'cobble', kind: 'angular', variants: 4, count: 3400, uMax: 18,
    rMin: 0.070, rMax: 0.230, flat: 0.42, bevel: 14, maxSlope: 0.50, shadow: true,
    imbricate: 0.62, sink: [0.58, 0.94], deepSink: 0.40, lith: CDF_T, tint: 1.0,
    orient: 'surface', scour: true,
    weight: (fc) => (fc.chan * (0.25 + 1.35 * fc.lag) + fc.bar * 0.55 + fc.terr * 0.10)
                  * (0.12 + 1.75 * fc.string)
                  * (1 - fc.bare * 0.98) * (1 - fc.sheet) * (1 - fc.pan),
  },
  {
    name: 'pavement', kind: 'angular', variants: 3, count: 2400, uMax: 26,
    rMin: 0.055, rMax: 0.190, flat: 0.50, bevel: 9, maxSlope: 0.52, shadow: true,
    imbricate: 0, sink: [0.48, 0.66], lith: CDF_L, tint: 0.82, orient: 'surface',
    /* desert pavement: weathered angular fragments left on the abandoned
       terrace after the fines blew out from between them */
    weight: (fc) => (fc.terr * 0.95 + fc.tal * 0.35) * (1 - fc.bare * 0.5) * (1 - fc.pan),
  },
  {
    name: 'block', kind: 'angular', variants: 4, count: 2600, uMax: 34,
    /* Not equant. At flat 1.0 the hull of a jittered cube is a cube, and a
       half-metre cube sitting on open ground at twenty metres does not read as
       fallen sandstone, it reads as a crate. Bedded rock breaks into slabs. */
    rMin: 0.090, rMax: 0.270, sizeP: 3.0, squat: true,
    flat: 0.62, bevel: 26, maxSlope: 0.62, shadow: true,
    imbricate: 0, sink: [0.74, 1.05], lith: CDF_B, collar: 7, tint: 0.78,
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
    name: 'slab', kind: 'angular', variants: 4, count: 220, uMax: 34,
    rMin: 0.200, rMax: 0.350, sizeP: 2.2, squat: true,
    flat: 0.62, bevel: 34, maxSlope: 0.50, shadow: true,
    imbricate: 0, sink: [0.70, 1.00], lith: CDF_B, collar: 5, tint: 0.78,
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
    name: 'boulder', kind: 'angular', variants: 3, count: 110, uMax: 16,
    rMin: 0.320, rMax: 0.600, flat: 0.86, bevel: 30, maxSlope: 0.40, shadow: true,
    imbricate: 0.55, sink: [0.56, 0.88], deepSink: 0.26, lith: CDF_B, collar: 9,
    tint: 1.0, orient: 'surface', scour: true,
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
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader = ('uniform float uVpH;\nuniform vec3 uFarCol;\n' +
      'varying float vFar;\nvarying vec3 vSeat;\n' + shader.vertexShader)
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
      .replace('#include <uv_vertex>', /* glsl */`
        #include <uv_vertex>
        float uvK = clamp(length(instanceMatrix[0].xyz) * 7.0, 1.0, 7.0);
        #ifdef USE_MAP
          vMapUv *= uvK;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv *= uvK;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv *= uvK;
        #endif
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        /* Instance centre in view space, and the instance's world radius from the
           first column of its matrix. projectionMatrix[1][1] is 1/tan(fov/2), so
           this is a true projected pixel radius, correct under any fov or
           resolution rather than a hand-tuned distance. */
        vec3 iCen = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float iRad = length(instanceMatrix[0].xyz);
        float px = 0.5 * uVpH * projectionMatrix[1][1] * iRad / max(-iCen.z, 0.05);
        vFar = 1.0 - smoothstep(2.6, 9.0, px);
        transformed *= smoothstep(0.60, 1.60, px);
      `)
      .replace('#include <color_vertex>', /* glsl */`
        #include <color_vertex>
        vColor = mix(vColor, uFarCol, vFar);
        vSeat = normalize(normalMatrix * mat3(instanceMatrix) * vec3(0.0, 1.0, 0.0));
      `);

    shader.fragmentShader = ('varying float vFar;\nvarying vec3 vSeat;\n' + shader.fragmentShader)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        normal = normalize(mix(normal, vSeat, vFar * 0.92));
      `);
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
      const w = cl.weight(fc);
      if (w <= 0.004 || rand() > clamp(w, 0, 1)) continue;

      const y = terrain.heightAtQ(x, z, q);
      const e = Math.max(0.14, cl.rMax * 0.7);
      const hx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
      const hz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
      nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      if (1 - nrm.y > cl.maxSlope) continue;

      let rad = cl.rMin + Math.pow(rand(), cl.sizeP || 1.7) * (cl.rMax - cl.rMin);
      if (cl.taper) rad *= 0.40 + 0.60 * (1 - fc.talPos);
      const lith = pickLith(cl.lith, rand());

      emit(cl, buckets[placed % cl.variants], x, y, z, rad, lith, rand, th, nrm);
      placed++;

      if (cl.scour && rad > cl.rMin + (cl.rMax - cl.rMin) * 0.30) {
        /* Upstream is up-wash: the flood came down the wash, so it stalls against
           the face pointing back the way it came. */
        const ux = Math.sin(th), uz = -Math.cos(th);
        wedges.push({
          x: x + ux * rad * 0.80, z: z + uz * rad * 0.80, th,
          sx: rad * (1.30 + rand() * 0.55), sy: rad * (0.34 + rand() * 0.20),
          sz: rad * (0.72 + rand() * 0.34), sink: 0.42,
        });
        wedges.push({
          x: x - ux * rad * 1.75, z: z - uz * rad * 1.75, th,
          sx: rad * (0.55 + rand() * 0.30), sy: rad * (0.20 + rand() * 0.14),
          sz: rad * (1.9 + rand() * 1.5), sink: 0.52,
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

  /* collar clasts, as one extra rounded bucket */
  if (collars.length) {
    const g = roundedClast(0, 4.4, 0.5);
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
      const cfl = Math.max(1, 0.30 / Math.max(1e-4, Math.min(cl0[0], cl0[1], cl0[2]) * t));
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
      const t = 0.88 + rand() * 0.28;
      list.push({
        x: w.x, y: y - w.sy * w.sink, z: w.z,
        q: quat.clone(), sx: w.sx, sy: w.sy, sz: w.sz,
        r: MATRIX_COL[0] * t, g: MATRIX_COL[1] * t, b: MATRIX_COL[2] * t,
      });
    }
    meshes.push(makeMesh(g, mat, list, 'scour', false));
  }

  return meshes;

  /* ── placement of one instance ── */
  function emit(cl, bucket, x, y, z, rad, lith, rand, th, n) {
    if (cl.imbricate > 0 && rand() < cl.imbricate) {
      /* Imbrication: platy clasts stack like roof shingles, their flat faces
         dipping upstream and their long axes across the flow. It is the single
         most recognisable signature of water transport, and it is free. */
      fwd.set(Math.sin(th), 0, -Math.cos(th));            // up-wash = upstream
      right.set(Math.cos(th), 0, Math.sin(th));
      const dip = 0.20 + rand() * 0.24;                    // ~11 to 25 degrees
      by.copy(n).multiplyScalar(Math.cos(dip)).addScaledVector(fwd, Math.sin(dip)).normalize();
      bx.copy(right).addScaledVector(by, -right.dot(by)).normalize();
      bz.crossVectors(bx, by);
      basis.makeBasis(bx, by, bz);
      quat.setFromRotationMatrix(basis);
      spin.setFromAxisAngle(by, (rand() - 0.5) * 0.7);
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
      /* Pulled back from seventy-two degrees. A tabular slab stood on edge on a
         talus slope cantilevers out of the ground however deeply its centre is
         sunk, and a half-metre plate jutting horizontally out of a bank reads as a
         signpost. Blocks in a real apron are wedged against each other at shallow
         angles, not propped on end. */
      const tilt = Math.pow(rand(), 1.6) * 0.68;         // up to ~39 degrees
      const ta = rand() * Math.PI * 2;
      spin.setFromAxisAngle(bx.set(Math.cos(ta), 0, Math.sin(ta)), tilt);
      quat.multiply(spin);
    } else {
      /* Broad face down, with only a few degrees of wobble. A tabular clast that
         split along a bedding plane has a stable face and it lands on it. */
      quat.setFromUnitVectors(up, n);
      spin.setFromAxisAngle(up, rand() * Math.PI * 2);
      quat.multiply(spin);
      spin.setFromAxisAngle(bx.set(1, 0, 0), (rand() - 0.5) * 0.44);
      quat.multiply(spin);
      spin.setFromAxisAngle(bz.set(0, 0, 1), (rand() - 0.5) * 0.44);
      quat.multiply(spin);
    }

    /* Burial. A clast that has sat through one flood is worked down into the bed;
       a bed where every stone sits fully proud is a bed where objects were placed
       on a surface, which is exactly what it looks like. A fraction go right down
       to their shoulders so the bed reads as clast-rich rather than sprinkled. */
    let sink = rad * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
    if (cl.deepSink && rand() < cl.deepSink) sink = rad * (0.88 + rand() * 0.30);
    /* Per-instance value spread, times a per-class factor: talus is dusty and
       sits in the wall's own shadow half the day, and pale blocks at that scale
       read as builders' rubble unless they are knocked back. */
    /* Narrow. A wide per-instance value spread on top of eight lithologies mixes
       them back together — a dark limestone and a bright basalt land on the same
       screen value and the polychrome scatter stops being legible as rock types. */
    const t = (0.86 + rand() * 0.26) * cl.tint;
    const L = LITH[lith];
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
    const fl = Math.max(1, 0.30 / Math.max(1e-4, Math.min(L[0], L[1], L[2]) * t));
    /* Fallen sandstone is bedded, so it breaks squat and tabular rather than
       equant. A block as tall as it is wide, sat on a slope, is a tent — and a
       slope of tents is the exact silhouette of scattered folded card. */
    const yf = cl.squat ? 0.44 + rand() * 0.30
             : (cl.kind === 'angular' ? 0.82 : 0.70) * (1 + rand() * 0.5);
    bucket.push({
      x, y: y - sink, z,
      q: quat.clone(),
      sx: rad * (0.84 + rand() * 0.46),
      sy: rad * yf,
      sz: rad * (0.84 + rand() * 0.46),
      r: L[0] * t * fl, g: L[1] * t * fl, b: L[2] * t * fl,
    });
  }

  function makeMesh(geom, material, list, name, shadow) {
    const im = new THREE.InstancedMesh(geom, material, list.length);
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
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    return im;
  }
}
