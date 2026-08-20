/* System 3b — sparse supporting vegetation.
 *
 * Sedona at 4,500 ft is pinyon-juniper woodland, not Sonoran desert and not
 * Mars. The single strongest and cheapest cue for that is the *distribution* of
 * dark green specks on the red slopes: they cluster in the drainages and along
 * the bench tops where water collects and soil accumulates, they thin out to
 * nothing on the vertical faces, and they are individually tiny. A frame with
 * bare red rock from the wash floor to the skyline reads as somewhere else on
 * earth, or off it.
 *
 * The hard constraint is that this must stay lonely. Nothing here competes with
 * the hero juniper: near the wash there are a couple of dozen small shrubs and
 * bunch grasses over a hundred metres of corridor, and everything else is at
 * least forty metres away and no more than a few pixels tall.
 *
 * Three placement mechanisms, all deterministic:
 *
 * · **Terrace and talus scatter** from `Terrain.facies`, so the near scrub obeys
 *   the same geomorphology the clast field does — nothing grows in the active
 *   channel, which floods, and little grows on the raw cut bank, which collapses.
 * · **Rock surface scatter**, harvested from the vertices of the wall and butte
 *   meshes rather than by raycasting. Upward-facing vertices are benches and
 *   ledges; steeply-facing ones are cliffs. Filtering on the vertex normal gives
 *   exactly the right density falloff for free, and costs one linear pass over
 *   geometry that is already in memory.
 * · **Far slope scatter** on the distant height field, for the specks on the
 *   mesas that the aerial perspective then greys out.
 *
 * Everything is instanced. Total cost is four to six draw calls.
 */
import * as THREE from 'three';
import { rng, fbm, ridged, clamp, smoothstep } from './noise.js';
import { foliageTex, grassTex, scrubTex } from './plantex.js';
import { cardTuft, makeFoliageMaterial, JUNIPER_XZ } from './juniper.js';

const TAU = Math.PI * 2;

/* ── small helpers ─────────────────────────────────────────────────────────*/

function cardGeometry(build) {
  const arr = { pos: [], nrm: [], uvs: [], idx: [] };
  build(arr);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uvs, 2));
  g.setIndex(arr.idx);
  g.computeBoundingSphere();
  return g;
}

/** White vertex colours, so per-instance tints survive; see scatter.js. */
function addWhite(g) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

/** The hero's foliage shader reads a baked sun-visibility attribute. A distant
    bush has no crown to occlude itself with, so it supplies a constant one —
    without which the attribute reads as zero and every bush loses its key. */
function addSun(g) {
  const n = g.attributes.position.count;
  g.setAttribute('aSun', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return g;
}

/* ── near-field plant shapes ───────────────────────────────────────────────*/

/** A tuft of dry bunch grass — crossed cards, unit height. */
function grassTuftGeo(seed) {
  const rand = rng(seed);
  return addWhite(cardGeometry((arr) => cardTuft(0, 0, 0, 0.62, 1.0, 3, rand, arr)));
}

/** A low grey-green shrub. Same trick: cards with near-vertical normals. */
function shrubGeo(seed) {
  const rand = rng(seed);
  return addWhite(cardGeometry((arr) => {
    /* Two tiers, so it has a silhouette rather than being one slab. */
    cardTuft(0, 0, 0, 0.95, 1.0, 3, rand, arr);
    cardTuft(0, 0.18, 0, 0.62, 0.72, 2, rand, arr);
  }));
}

/**
 * Prickly pear. A chain of flattened pads, each budding off the rim of its
 * parent at a random angle in the parent's plane, which is exactly how the
 * plant actually grows and is why a real one looks like a stack of paddles
 * pointing in slightly different directions rather than a bush.
 */
function pricklyPearGeo(seed) {
  const rand = rng(seed);
  const parts = [];
  const pads = [];
  pads.push({ p: new THREE.Vector3(0, 0.16, 0), az: rand() * TAU, tilt: 0.08, s: 0.30, gen: 0 });
  for (let i = 0; i < 7; i++) {
    const parent = pads[(rand() * pads.length) | 0];
    if (parent.gen > 2) continue;
    const az = parent.az + (rand() - 0.5) * 1.5;
    const up = 0.55 + rand() * 0.75;
    const s = parent.s * (0.72 + rand() * 0.25);
    pads.push({
      p: parent.p.clone().add(new THREE.Vector3(
        Math.cos(parent.az + 1.57) * parent.s * 0.35 * (rand() - 0.5),
        parent.s * up * 1.6,
        Math.sin(parent.az + 1.57) * parent.s * 0.35 * (rand() - 0.5))),
      az, tilt: (rand() - 0.5) * 0.55, s, gen: parent.gen + 1,
    });
  }
  for (const pad of pads) {
    const g = new THREE.SphereGeometry(1, 12, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      /* Pads are ovals, thin, with a slightly lumpy surface. */
      const lump = 1 + 0.09 * Math.sin(y * 7.1 + x * 5.3) * (1 - Math.abs(y));
      p.setXYZ(i, x * pad.s * 0.92 * lump, (y * 0.5 + 0.5) * pad.s * 2.5 * lump, z * pad.s * 0.15);
    }
    g.computeVertexNormals();
    g.rotateZ(pad.tilt);
    g.rotateY(pad.az);
    g.translate(pad.p.x, pad.p.y, pad.p.z);
    parts.push(g);
  }
  const merged = mergeAll(parts);
  return addWhite(merged);
}

/** An agave rosette: stiff tapered blades radiating from a point. */
function agaveGeo(seed) {
  const rand = rng(seed);
  const pos = [], nrm = [], uvs = [], idx = [];
  const n = 17;
  for (let i = 0; i < n; i++) {
    const az = i / n * TAU + (rand() - 0.5) * 0.22;
    const pitch = 0.30 + rand() * 0.85;      // radians above horizontal
    const len = 0.62 + rand() * 0.40;
    const wid = 0.11 + rand() * 0.05;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch),
                                  Math.sin(az) * Math.cos(pitch));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    const K = 4;
    const base = pos.length / 3;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      /* A blade is a folded gutter, not a flat strap: the fold is what gives it
         a highlight down the middle and a real silhouette edge-on. */
      const w = wid * (1 - t * t * 0.92);
      const droop = -0.42 * t * t * len;
      const c = new THREE.Vector3()
        .copy(dir).multiplyScalar(len * t)
        .add(new THREE.Vector3(0, droop, 0));
      const fold = 0.35 * w * (1 - t);
      for (let e = -1; e <= 1; e++) {
        const v = c.clone().addScaledVector(side, w * e).add(
          new THREE.Vector3(0, e === 0 ? fold : 0, 0));
        pos.push(v.x, v.y + 0.05, v.z);
        const nv = new THREE.Vector3(side.x * e * 0.5, 1, side.z * e * 0.5).normalize();
        nrm.push(nv.x, nv.y, nv.z);
        uvs.push((e + 1) * 0.5, t);
      }
      if (k > 0) {
        const a = base + (k - 1) * 3, b = base + k * 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
        idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return addWhite(g);
}

function mergeAll(list) {
  let total = 0, itotal = 0;
  for (const g of list) { total += g.attributes.position.count; itotal += g.index.count; }
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const idx = new Uint32Array(itotal);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position.array, nn = g.attributes.normal.array;
    const u = g.attributes.uv ? g.attributes.uv.array : null;
    pos.set(p, vo * 3); nrm.set(nn, vo * 3);
    if (u) uv.set(u, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * A distant juniper or pinyon, as cheaply as it can be done and still read.
 * A squat irregular blob whose origin is at its foot, twenty triangles. At the
 * ranges these are used, forty metres and out, the whole plant is at most a
 * dozen pixels tall and all that survives is its aspect ratio, its raggedness
 * and its tone — so the budget goes into having *many* of them, correctly
 * distributed, rather than into any one being right.
 */
function blobGeo(seed) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  const rand = rng(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 0.72 + 0.56 * fbm(v.x * 3.1 + seed, v.z * 3.1 - seed, 2, seed | 0);
    v.multiplyScalar(n);
    v.y = v.y * 0.92 + 0.5;
    p.setXYZ(i, v.x, Math.max(0, v.y), v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return addWhite(g);
}

/* ── placement ─────────────────────────────────────────────────────────────*/

/**
 * Clustering field. Real pinyon-juniper is not a Poisson scatter: it follows
 * water, so it runs in lines down the gullies and pools along the bench backs.
 * `ridged` inverted gives channel-like lows; the fBm term breaks up the
 * regularity so the lines do not all read as parallel.
 */
function clusterField(x, z) {
  const gully = 1 - ridged(x * 0.017, z * 0.017, 3, 5501);
  const patch = 0.5 + 0.5 * fbm(x * 0.026, z * 0.026, 3, 5503);
  return clamp(smoothstep(0.30, 0.78, gully) * 0.62 + smoothstep(0.36, 0.80, patch) * 0.55, 0, 1);
}

export function buildVegetation(path, terrain, rocks) {
  const out = [];
  const folMap = foliageTex();
  const grassMap = grassTex();
  const scrubMap = scrubTex();

  const obj = new THREE.Object3D();
  const col = new THREE.Color();

  function instance(geom, mat, list, name, shadow) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geom, mat, list.length);
    im.castShadow = !!shadow;
    im.receiveShadow = true;
    im.name = name;
    list.forEach((o, i) => {
      obj.position.set(o.x, o.y, o.z);
      obj.rotation.set(0, o.rot || 0, 0);
      obj.scale.set(o.sx, o.sy, o.sz);
      obj.updateMatrix();
      im.setMatrixAt(i, obj.matrix);
      col.setRGB(o.r, o.g, o.b);
      im.setColorAt(i, col);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    out.push(im);
    return im;
  }

  /* ── near the wash ───────────────────────────────────────────────────────
     Sparse by construction: a candidate grid at two-metre spacing over a
     hundred and eighty metres of corridor, with acceptance rates in the low
     single percent. */
  const rand = rng(606061);
  const grass = [], shrub = [], pear = [], agave = [];
  const q = {}, q2 = {};

  for (let s = -12; s < 180; s += 1.6) {
    const c = path.posAt(s);
    const qq = path.atZ(c.z, q);
    const th = qq.th;
    for (let u = -26; u <= 26; u += 1.6) {
      const jx = (rand() - 0.5) * 1.5, jz = (rand() - 0.5) * 1.5;
      const x = c.x + Math.cos(th) * u + jx, z = c.z + Math.sin(th) * u + jz;
      const f = terrain.facies(x, z, path.atZ(z, q2));
      /* Nothing in the active channel and nothing on bare scoured bar. */
      const habitat = clamp(f.terr * 1.0 + f.tal * 0.55 + f.bar * 0.12, 0, 1)
                    * (1 - f.pan * 0.9);
      if (habitat < 0.12) continue;
      const cl = clusterField(x, z);
      const p = habitat * (0.10 + 0.90 * cl);
      const y = terrain.heightAt(x, z);
      const dh = Math.hypot(x - JUNIPER_XZ.x, z - JUNIPER_XZ.z);
      /* Keep a clear apron round the hero so nothing crowds its silhouette. */
      if (dh < 5.5) continue;

      const roll = rand();
      if (roll < p * 0.085) {
        grass.push({
          x, y: y - 0.03, z, rot: rand() * TAU,
          sx: 0.30 + rand() * 0.26, sy: 0.26 + rand() * 0.26, sz: 0.30 + rand() * 0.26,
          r: 0.86 + rand() * 0.22, g: 0.82 + rand() * 0.20, b: 0.72 + rand() * 0.18,
        });
      } else if (roll < p * 0.105) {
        shrub.push({
          x, y: y - 0.04, z, rot: rand() * TAU,
          sx: 0.42 + rand() * 0.40, sy: 0.36 + rand() * 0.36, sz: 0.42 + rand() * 0.40,
          r: 0.84 + rand() * 0.26, g: 0.88 + rand() * 0.20, b: 0.78 + rand() * 0.22,
        });
      } else if (roll < p * 0.112 && pear.length < 5) {
        pear.push({
          x, y: y - 0.05, z, rot: rand() * TAU,
          sx: 0.85 + rand() * 0.40, sy: 0.85 + rand() * 0.45, sz: 0.85 + rand() * 0.40,
          r: 0.95 + rand() * 0.14, g: 1.0, b: 0.90 + rand() * 0.14,
        });
      } else if (roll < p * 0.116 && agave.length < 3) {
        agave.push({
          x, y: y - 0.03, z, rot: rand() * TAU,
          sx: 0.70 + rand() * 0.30, sy: 0.70 + rand() * 0.34, sz: 0.70 + rand() * 0.30,
          r: 0.94, g: 1.0, b: 0.92,
        });
      }
    }
  }

  const grassMat = new THREE.MeshStandardMaterial({
    map: grassMap, alphaTest: 0.40, side: THREE.DoubleSide,
    roughness: 0.95, metalness: 0, vertexColors: true,
    color: new THREE.Color(0.90, 0.85, 0.78), dithering: true,
  });
  const scrubMat = new THREE.MeshStandardMaterial({
    map: scrubMap, alphaTest: 0.40, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0, vertexColors: true,
    color: new THREE.Color(0.80, 0.84, 0.72), dithering: true,
  });
  /* Cactus and agave are succulent: waxy, so a touch glossier than anything
     else in the frame, and a blue-cast desaturated green. */
  const succMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.118, 0.145, 0.098),
    roughness: 0.62, metalness: 0, vertexColors: true, dithering: true,
  });

  instance(grassTuftGeo(1001), grassMat, grass, 'veg-grass', true);
  instance(shrubGeo(1002), scrubMat, shrub, 'veg-shrub', true);
  instance(pricklyPearGeo(1003), succMat, pear, 'veg-pear', true);
  instance(agaveGeo(1004), succMat, agave, 'veg-agave', true);

  /* ── mid-distance junipers on the terraces and lower slopes ──────────────
     Close enough that a blob would read as a blob, far enough that a real tree
     is not affordable: eight foliage cards on the same texture as the hero. */
  const midGeo = addSun(addWhite(cardGeometry((arr) => {
    const r = rng(2002);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU;
      cardTuft(Math.cos(a) * 0.17, 0.06 + r() * 0.46, Math.sin(a) * 0.17,
               0.70, 0.60, 1, r, arr, 2, 2);
    }
  })));
  const midMat = makeFoliageMaterial(folMap);
  midMat.vertexColors = true;
  /* Much darker than the hero's foliage, and deliberately so. These stand in
     for whole trees, and a whole tree seen from forty metres is a shadowed mass
     with a lit fringe — it never averages anywhere near the albedo of the
     sunlit sprays on its own outside. Left at full albedo they came out as
     white-speckled clumps that read as patches of snow on the cliff. */
  midMat.color = new THREE.Color(0.38, 0.42, 0.34);
  midMat.userData.uniforms.uTransAmt.value = 0.30;

  /* ── the slopes ──────────────────────────────────────────────────────────*/
  const far = [];
  const mid = [];
  const rr = rng(717273);

  /* Harvest upward-facing points off the rock meshes. */
  const p3 = new THREE.Vector3(), n3 = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const qtmp = q2;
  for (const m of rocks) {
    const g = m.geometry;
    if (!g || !g.attributes.position || !g.attributes.normal) continue;
    m.updateMatrixWorld(true);
    nm.getNormalMatrix(m.matrixWorld);
    const pa = g.attributes.position, na = g.attributes.normal;
    const stride = Math.max(1, Math.floor(pa.count / 26000));
    for (let i = 0; i < pa.count; i += stride) {
      p3.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
      n3.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      if (p3.y < 2.0 || p3.y > 58) continue;
      if (p3.z > 30 || p3.z < -330) continue;
      const qz = path.atZ(p3.z, qtmp);
      const du = Math.abs((p3.x - qz.x) * Math.cos(qz.th));
      if (du < 15 || du > 210) continue;
      /* Slope gate. A bench is a bench; a wall face keeps nothing. */
      const up = n3.y;
      if (up < 0.36) continue;
      const shelf = smoothstep(0.36, 0.80, up);
      /* Higher is drier and more exposed. */
      const alt = 1 - smoothstep(14, 48, p3.y);
      const cl = clusterField(p3.x, p3.z);
      const pAcc = shelf * (0.10 + 0.90 * cl) * (0.25 + 0.75 * alt) * 0.040;
      if (rr() > pAcc) continue;
      const sz = 0.8 + rr() * 1.9;
      const dark = 0.72 + rr() * 0.5;
      /* Anything on the near walls is close enough that a twenty-triangle blob
         would read as a blob, so it gets cards instead. */
      const target = du < 42 ? mid : far;
      target.push({
        x: p3.x, y: p3.y - 0.12, z: p3.z, rot: rr() * TAU,
        sx: sz * (0.8 + rr() * 0.4), sy: sz * (0.9 + rr() * 0.7), sz: sz * (0.8 + rr() * 0.4),
        r: dark, g: dark, b: dark,
      });
    }
  }

  /* And on the far height field, which the buttes do not cover. */
  for (let i = 0; i < 30000; i++) {
    const a = rr() * TAU;
    const rad = 60 + Math.pow(rr(), 0.7) * 520;
    const x = Math.sin(a) * rad;
    const z = -130 + Math.cos(a) * rad;
    if (z > 20 || z < -700) continue;
    const qz = path.atZ(z, qtmp);
    const du = Math.abs((x - qz.x) * Math.cos(qz.th));
    if (du < 22) continue;
    /* Cluster and dice first: the height field is by far the most expensive
       thing in this loop and ninety-odd percent of candidates are rejected
       without it. */
    const cl = clusterField(x, z);
    if (rr() > (0.06 + 0.94 * cl) * 0.10) continue;
    const y = terrain.heightAt(x, z);
    if (y > 60) continue;
    const e = 1.4;
    const gx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
    const gz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    if (Math.hypot(gx, gz) > 1.15) continue;
    const alt = 1 - smoothstep(16, 50, y);
    if (rr() > 0.2 + 0.8 * alt) continue;
    const sz = 1.1 + rr() * 2.6;
    const dark = 0.72 + rr() * 0.5;
    far.push({
      x, y: y - 0.1, z, rot: rr() * TAU,
      sx: sz * (0.8 + rr() * 0.4), sy: sz * (0.9 + rr() * 0.7), sz: sz * (0.8 + rr() * 0.4),
      r: dark, g: dark, b: dark,
    });
  }

  /* Dark, desaturated, slightly blue-shifted green. A distant juniper is nearly
     black against sunlit rock; the haze does the rest of the work. */
  const farMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.052, 0.062, 0.043),
    roughness: 0.95, metalness: 0, vertexColors: true, dithering: true,
    flatShading: false,
  });

  instance(midGeo, midMat, mid, 'veg-mid', false);
  instance(blobGeo(3003), farMat, far, 'veg-far', false);

  return out;
}
