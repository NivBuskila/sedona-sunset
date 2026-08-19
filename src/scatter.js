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

/** Spherical UVs, because ConvexGeometry ships position and normal only. */
function addUV(g) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    uv[i * 2] = Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = v.y * 0.5 + 0.5;
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
  for (let i = 0; i < 8; i++) {
    pts.push(new THREE.Vector3(
      ((i & 1) ? 1 : -1) * ax * (0.74 + rand() * 0.40),
      ((i & 2) ? 1 : -1) * ay * (0.74 + rand() * 0.40),
      ((i & 4) ? 1 : -1) * az * (0.74 + rand() * 0.40)));
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
    const j = t * (0.94 + rand() * 0.22);
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
const LITH = [
  [0.66, 0.32, 0.21],   // red Schnebly Hill sandstone
  [0.74, 0.55, 0.39],   // buff sandstone
  /* The pale and neutral lithologies are pushed warm, not because the rock is
     warm but because everything in a wash carries a film of red silt, and a
     truly neutral grey under a blue-violet sky fill renders mint green. */
  [0.84, 0.73, 0.58],   // off-white Coconino, dusted with red silt
  [0.52, 0.47, 0.40],   // grey Fort Apache limestone
  [0.17, 0.155, 0.15],  // dark basalt off the Rim
  [0.70, 0.57, 0.39],   // buff chert
];
/* Transported clasts came from anywhere upstream, so they are mixed. Talus fell
   off the wall thirty metres above it, so it is nearly all local — a talus
   apron of pale blocks reads as builders' rubble, not as a collapsed wall. */
const MIX_TRANSPORTED = [0.56, 0.22, 0.035, 0.055, 0.055, 0.075];
const MIX_LOCAL = [0.80, 0.15, 0.03, 0.01, 0.00, 0.01];

function pickLith(mixCdf, r) {
  for (let i = 0; i < mixCdf.length; i++) if (r <= mixCdf[i]) return i;
  return 0;
}
const cdf = (w) => { let a = 0; return w.map(v => (a += v)); };
const CDF_T = cdf(MIX_TRANSPORTED), CDF_L = cdf(MIX_LOCAL);

/* ── classes ───────────────────────────────────────────────────────────── */

/* `weight` turns the facies mix at a point into a placement probability. This
   is the whole sorting model, and it is the difference between a flow map and
   a sprinkle. */
const CLASSES = [
  {
    name: 'gravel', kind: 'round', detail: 0, variants: 2, count: 13000, uMax: 18,
    rMin: 0.024, rMax: 0.090, flatten: 0.68, maxSlope: 0.58, shadow: true,
    imbricate: 0.28, sink: [0.24, 0.38], lith: CDF_T, tint: 1.0,
    weight: (fc) => (fc.chan * (0.45 + 0.85 * fc.lag) + fc.bar * 0.85 + fc.terr * 0.22)
                  * (1 - fc.bare * 0.95) * (1 - fc.sheet) * (1 - fc.pan),
  },
  {
    name: 'cobble', kind: 'round', detail: 1, variants: 3, count: 3400, uMax: 18,
    rMin: 0.070, rMax: 0.230, flatten: 0.62, maxSlope: 0.50, shadow: true,
    imbricate: 0.55, sink: [0.36, 0.52], lith: CDF_T, tint: 1.0,
    weight: (fc) => (fc.chan * (0.25 + 1.35 * fc.lag) + fc.bar * 0.55 + fc.terr * 0.10)
                  * (1 - fc.bare * 0.98) * (1 - fc.sheet) * (1 - fc.pan),
  },
  {
    name: 'pavement', kind: 'angular', variants: 3, count: 2400, uMax: 26,
    rMin: 0.055, rMax: 0.190, flat: 0.50, bevel: 5, maxSlope: 0.52, shadow: true,
    imbricate: 0, sink: [0.40, 0.56], lith: CDF_L, tint: 0.82, orient: 'surface',
    /* desert pavement: weathered angular fragments left on the abandoned
       terrace after the fines blew out from between them */
    weight: (fc) => (fc.terr * 0.95 + fc.tal * 0.35) * (1 - fc.bare * 0.5) * (1 - fc.pan),
  },
  {
    name: 'block', kind: 'angular', variants: 4, count: 2600, uMax: 34,
    rMin: 0.100, rMax: 0.640, sizeP: 3.0, squat: true,
    flat: 1.00, bevel: 14, maxSlope: 0.62, shadow: true,
    imbricate: 0, sink: [0.52, 0.80], lith: CDF_L, collar: 7, tint: 0.62,
    orient: 'random',
    /* the talus apron, plus slumped blocks at the foot of a cut bank.
       `pile` clumps them: rockfall arrives as an event, so an apron is a run of
       heaps below the gullies that fed them with swept ground between, and an
       even sprinkle of same-sized blocks reads as scattered litter. */
    weight: (fc) => (fc.tal * 1.0 + fc.slump * 0.7) * fc.pile,
  },
  {
    name: 'slab', kind: 'angular', variants: 3, count: 340, uMax: 34,
    rMin: 0.300, rMax: 0.900, sizeP: 2.2, squat: true,
    flat: 0.55, bevel: 12, maxSlope: 0.50, shadow: true,
    imbricate: 0, sink: [0.46, 0.72], lith: CDF_L, collar: 5, tint: 0.62,
    orient: 'random',
    /* bedding-plane slabs, which fall off a stratified wall as sheets */
    weight: (fc) => (fc.tal * 0.8 + fc.slump * 0.5) * fc.pile,
  },
  {
    name: 'boulder', kind: 'round', detail: 2, variants: 2, count: 90, uMax: 16,
    rMin: 0.380, rMax: 0.950, flatten: 0.74, maxSlope: 0.40, shadow: true,
    imbricate: 0.4, sink: [0.34, 0.50], lith: CDF_T, collar: 9, tint: 1.0,
    /* flood-transported, so they sit in the channel and on bar heads */
    weight: (fc) => (fc.chan * 1.0 + fc.bar * 0.5) * fc.lag * (1 - fc.pan),
  },
];

const S0 = -12, S1 = 264;

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

      const rad = cl.rMin + Math.pow(rand(), cl.sizeP || 1.7) * (cl.rMax - cl.rMin);
      const lith = pickLith(cl.lith, rand());

      emit(cl, buckets[placed % cl.variants], x, y, z, rad, lith, rand, th, nrm);
      placed++;

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
      list.push({
        x: c.x, y: y - c.rad * 0.45, z: c.z,
        q: quat.clone(),
        sx: c.rad * (0.85 + rand() * 0.4),
        sy: c.rad * (0.7 + rand() * 0.4),
        sz: c.rad * (0.85 + rand() * 0.4),
        r: LITH[c.lith][0] * t, g: LITH[c.lith][1] * t, b: LITH[c.lith][2] * t,
      });
    }
    meshes.push(makeMesh(g, mat, list, 'collar', true));
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
      const tilt = Math.pow(rand(), 1.6) * 1.25;         // up to ~72 degrees
      const ta = rand() * Math.PI * 2;
      spin.setFromAxisAngle(bx.set(Math.cos(ta), 0, Math.sin(ta)), tilt);
      quat.multiply(spin);
    } else {
      quat.setFromUnitVectors(up, n);
      spin.setFromAxisAngle(up, rand() * Math.PI * 2);
      quat.multiply(spin);
      spin.setFromAxisAngle(bx.set(1, 0, 0), (rand() - 0.5) * 0.9);
      quat.multiply(spin);
      spin.setFromAxisAngle(bz.set(0, 0, 1), (rand() - 0.5) * 0.9);
      quat.multiply(spin);
    }

    const sink = rad * (cl.sink[0] + rand() * (cl.sink[1] - cl.sink[0]));
    /* Per-instance value spread, times a per-class factor: talus is dusty and
       sits in the wall's own shadow half the day, and pale blocks at that scale
       read as builders' rubble unless they are knocked back. */
    const t = (0.68 + rand() * 0.62) * cl.tint;
    const L = LITH[lith];
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
      r: L[0] * t, g: L[1] * t, b: L[2] * t,
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
