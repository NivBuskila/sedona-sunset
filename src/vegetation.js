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
import { foliageTex, grassTex, scrubTex, succTex } from './plantex.js';
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

/** A tuft of dead bunch grass — crossed cards, unit height, drawing from the
    four-cell atlas so neighbouring tufts are not the same silhouette. */
function grassTuftGeo(seed) {
  const rand = rng(seed);
  return addWhite(cardGeometry((arr) => cardTuft(0, 0, 0, 0.62, 1.0, 4, rand, arr, 4, 1)));
}

/** A low grey-green shrub. Same trick: cards with near-vertical normals. */
function shrubGeo(seed) {
  const rand = rng(seed);
  return addWhite(cardGeometry((arr) => {
    /* Two tiers, so it has a silhouette rather than being one slab — but eight
       cards, not five, and the upper tier lifted 0.09 rather than 0.18.
       At five cards each is offset by up to 35% of its own width and the second
       tier started above the first one's midpoint, so a card could and did end up
       with clear air between it and everything else: "several cards floating
       detached" in the nearest shot of this shrub. Overlap is cheap here — this
       geometry is instanced once and drawn a few hundred times. */
    cardTuft(0, 0, 0, 0.95, 1.0, 5, rand, arr);
    cardTuft(0, 0.09, 0, 0.70, 0.78, 3, rand, arr);
  }));
}

/**
 * Prickly pear. A chain of flattened pads, each budding off the rim of its
 * parent at a random angle in the parent's plane, which is exactly how the
 * plant actually grows and is why a real one looks like a stack of paddles
 * pointing in slightly different directions rather than a bush.
 */
export function pricklyPearGeo(seed) {
  const rand = rng(seed);
  const parts = [];

  /** One pad: an oval disc with a domed section, built explicitly rather than
      by squashing a sphere. Squashing a sphere on one axis gives a lens whose
      rim is a knife edge and whose silhouette is an ellipse — the first attempt
      produced upright blue-grey lozenges a metre and a half tall that read as
      standing stones. A pad is a rounded slab about as tall as it is wide, two
      centimetres thick, with a blunt rim. */
  function pad(r, thick, seedp) {
    const N = 18, RINGS = 4;
    const pos = [], nrm = [], uv = [], idx = [];
    const rr = rng(seedp);
    const wob = [];
    for (let i = 0; i < N; i++) wob.push(0.90 + rr() * 0.18);
    /* front and back shells */
    for (let side = 0; side < 2; side++) {
      const sgn = side ? -1 : 1;
      const base = pos.length / 3;
      for (let k = 0; k <= RINGS; k++) {
        const t = k / RINGS;
        for (let i = 0; i < N; i++) {
          const a = i / N * TAU;
          const w = wob[i] * (0.92 + 0.10 * Math.sin(a * 2));
          const rx = Math.cos(a) * r * t * w;
          const ry = Math.sin(a) * r * 1.24 * t * w;
          /* Section: full thickness in the middle, tapering to the rim. */
          const z = sgn * thick * Math.sqrt(Math.max(0, 1 - t * t)) *
                    (0.85 + 0.15 * Math.cos(a * 3));
          pos.push(rx, ry + r * 1.24, z);
          const n = new THREE.Vector3(rx * 0.30, ry * 0.30, sgn * r).normalize();
          nrm.push(n.x, n.y, n.z);
          uv.push(t, a / TAU);
          if (k > 0) {
            const p0 = base + (k - 1) * N + i, p1 = base + (k - 1) * N + (i + 1) % N;
            const p2 = base + k * N + i, p3 = base + k * N + (i + 1) % N;
            if (side) idx.push(p0, p1, p2, p1, p3, p2);
            else idx.push(p0, p2, p1, p1, p2, p3);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /* A clump: a couple of ground pads with two or three budding off their upper
     rims. Total height about half a metre — these are supporting cast, and a
     prickly pear that competes with the juniper for attention is a failure
     whatever it looks like. */
  const nodes = [{ p: new THREE.Vector3(0, 0, 0), az: rand() * TAU, r: 0.135, gen: 0 }];
  for (let i = 0; i < 6; i++) {
    const parent = nodes[(rand() * Math.min(nodes.length, 3)) | 0];
    if (parent.gen > 2) continue;
    const az = parent.az + (rand() - 0.5) * 1.9;
    nodes.push({
      p: parent.p.clone().add(new THREE.Vector3(
        Math.cos(az) * parent.r * (0.7 + rand() * 1.1),
        parent.r * (0.95 + rand() * 0.75),
        Math.sin(az) * parent.r * (0.7 + rand() * 1.1))),
      az, r: parent.r * (0.78 + rand() * 0.22), gen: parent.gen + 1,
    });
  }
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const g = pad(nd.r, nd.r * 0.135, seed + i * 97);
    g.rotateZ((rand() - 0.5) * 0.5);
    g.rotateX((rand() - 0.5) * 0.35);
    g.rotateY(nd.az);
    g.translate(nd.p.x, nd.p.y, nd.p.z);
    parts.push(g);
  }
  return addWhite(mergeAll(parts));
}

/** An agave rosette: stiff tapered blades radiating from a point. */
export function agaveGeo(seed) {
  const rand = rng(seed);
  const pos = [], nrm = [], uvs = [], idx = [];
  const n = 17;
  for (let i = 0; i < n; i++) {
    const az = i / n * TAU + (rand() - 0.5) * 0.22;
    const pitch = 0.58 + rand() * 0.72;      // radians above horizontal
    const len = 0.40 + rand() * 0.26;
    const wid = 0.075 + rand() * 0.035;
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
      const droop = -0.24 * t * t * len;
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

/**
 * How far a point is from anywhere the camera can stand, which is the only
 * distance that decides how much detail a plant needs.
 *
 * Lateral offset from the centreline alone is not that distance, and the
 * difference is what put a twenty-triangle untextured blob twenty-four metres
 * from three of the eight viewpoints: the far-field scatter is an annulus
 * centred up-wash, the corridor runs through the middle of it, and its only
 * proximity test was `|u| > 22`. Twenty-two metres is point-blank. Past the
 * ends of the walk the lateral offset is meaningless too — a point directly
 * up-wash at z = -600 has u ≈ 0 and is three hundred metres away — so the
 * along-track overrun is folded in.
 */
function corridorDist(path, x, z, q) {
  const qq = path.atZ(z, q);
  const u = (x - qq.x) * Math.cos(qq.th);
  const over = qq.s < 0 ? -qq.s : (qq.s > path.length ? qq.s - path.length : 0);
  return Math.hypot(u, over);
}

/* Where the blob stops being defensible. A far blob is a faceted hull with no
   texture; its silhouette has six or eight straight segments, so it only passes
   as a tree while the whole plant is around twenty pixels tall — at 900 lines
   and a 58° field that is about a hundred and fifty metres for a four-metre
   tree. Inside that, a plant gets the seven-card treatment instead, and the
   cards are the cheaper of the two anyway: fourteen triangles against twenty. */
const CARD_RANGE = 150;
/* Nothing on the slopes inside this radius of the hero. The `juniper` framing
   is meant to be one tree alone, and a bench specimen at a third of the hero's
   apparent height softens that read into "two trees, one nearer". The near-wash
   scrub keeps its own tighter apron; this is for the slope vegetation, which is
   what was landing in frame beside it. */
const HERO_CLEAR = 24;
/* The near walls stand up to about 77 m off the centreline (measured with
   tools/vegprobe.mjs). Inside that footprint the bare height field is buried
   under rock, so anything the far-field scatter plants there is embedded in a
   cliff — which is what "floating in front of the cliff" was. The rock-surface
   harvest owns that band; it plants on the actual rock. */
const WALL_REACH = 86;

/**
 * Where everything goes. Split out from `buildVegetation` because it is pure
 * arithmetic over the path, the height field and the rock meshes — no textures,
 * no materials, no canvas — which means it can be run and audited under plain
 * node in a second rather than by waiting six minutes for a render. The stray
 * near-camera blob was found this way after three critics found it by eye.
 */
export function planVegetation(path, terrain, rocks) {
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
      const habitat = clamp(f.terr * 1.0 + f.tal * 0.55 + f.bar * 0.34, 0, 1)
                    * (1 - f.pan * 0.9);
      if (habitat < 0.12) continue;
      const cl = clusterField(x, z);
      /* Floor raised from 0.10 to 0.22 and the acceptance rates below roughly
         doubled. The sparseness discipline was correct when this was one tree on
         bare ground and a critic could say the supporting planting was the
         strongest thing in the scene; it has since been called across the line
         into absent, with four of the eight framings carrying essentially no
         plants between them and the whole set reading as Wadi Rum. Sedona is
         pinyon-juniper woodland at 4,500 ft — the ground between the trees is not
         bare, it is bunch grass and low scrub. The hero stays dominant because
         it is four metres tall next to knee-high scrub, not because the scrub is
         missing. */
      const p = habitat * (0.22 + 0.78 * cl);
      const y = terrain.heightAt(x, z);
      const dh = Math.hypot(x - JUNIPER_XZ.x, z - JUNIPER_XZ.z);
      /* Keep a clear apron round the hero so nothing crowds its silhouette. */
      if (dh < 5.5) continue;

      const roll = rand();
      if (roll < p * 0.62) {
        grass.push({
          x, y: y - 0.03, z, rot: rand() * TAU,
          sx: 0.38 + rand() * 0.32, sy: 0.32 + rand() * 0.34, sz: 0.38 + rand() * 0.32,
          r: 0.86 + rand() * 0.22, g: 0.82 + rand() * 0.20, b: 0.72 + rand() * 0.18,
        });
      } else if (roll < p * 0.94) {
        shrub.push({
          x, y: y - 0.04, z, rot: rand() * TAU,
          sx: 0.55 + rand() * 0.48, sy: 0.46 + rand() * 0.44, sz: 0.55 + rand() * 0.48,
          r: 0.84 + rand() * 0.26, g: 0.88 + rand() * 0.20, b: 0.78 + rand() * 0.22,
        });
        /* Terrace only, and a well-developed one. A prickly pear needs a soil
           pocket — it roots shallow and wide in fines, and on scoured bar or bare
           slickrock there is nothing to root in. The habitat test above admits
           bar at 0.34 and talus at 0.55 weight, which is right for a bunch grass
           and wrong for this, and it put several pads on bare rock. */
      } else if (roll < p * 0.955 && pear.length < 4 && f.terr > 0.55) {
        pear.push({
          x, y: y - 0.05, z, rot: rand() * TAU,
          sx: 0.62 + rand() * 0.30, sy: 0.60 + rand() * 0.32, sz: 0.62 + rand() * 0.30,
          /* Was 0.95-1.09 on all three, i.e. no tint at all on an albedo that was
             already too pale. */
          r: 0.70 + rand() * 0.12, g: 0.84 + rand() * 0.10, b: 0.68 + rand() * 0.12,
        });
      } else if (roll < p * 0.975 && agave.length < 2) {
        agave.push({
          x, y: y - 0.03, z, rot: rand() * TAU,
          sx: 0.78 + rand() * 0.30, sy: 0.78 + rand() * 0.34, sz: 0.78 + rand() * 0.30,
          r: 0.94, g: 1.0, b: 0.92,
        });
      }
    }
  }

  /* ── the thalweg line ────────────────────────────────────────────────────
   *
   * A desert wash carries a line of noticeably larger woody growth along its
   * banks — rabbitbrush, catclaw, the odd young juniper — because that is where
   * the water goes and where the fines are deep enough to hold it. It stops
   * abruptly at the active channel, which is scoured, and it is one of the most
   * legible plan-view signatures a wash has: two ragged green-grey lines with
   * bare gravel between them.
   *
   * Placed as a separate pass rather than by loosening the grid above, because
   * the defining feature is the *banding* — a band four to eleven metres off the
   * centreline on each side, nothing inside it — and that is a statement about
   * where plants are, not about how many. Emitted into `shrub` at a larger scale
   * so it needs no new geometry, material or draw call.
   */
  for (let s = -12; s < 180; s += 1.15) {
    const c = path.posAt(s);
    const qq = path.atZ(c.z, q);
    for (let side = 0; side < 2; side++) {
      /* Inner edge at 2.6 m rather than 4.2. `wash_low` looks down at three or
         four metres of channel floor and came back with one grass tuft in the
         whole frame: correct geomorphology, since the active channel is scoured
         annually and holds nothing, but it reads as sterile because the band that
         does hold plants was placed outside the frame. Real washes carry the line
         right up to the cut bank, which is a metre or two out, not four. */
      const u = (side ? -1 : 1) * (2.6 + rand() * 8.2);
      const x = c.x + Math.cos(qq.th) * u + (rand() - 0.5) * 1.8;
      const z = c.z + Math.sin(qq.th) * u + (rand() - 0.5) * 1.8;
      const f = terrain.facies(x, z, path.atZ(z, q2));
      /* Off the scoured channel and out of the active pan. Relaxed from 0.30:
         the pan field grades rather than steps, so a hard cut at 0.30 was pushing
         the whole line back to where the terrace begins and leaving the cut bank
         itself — the wettest ground in the section — bare. */
      if (f.pan > 0.48) continue;
      const bank = clamp(f.terr * 0.85 + f.bar * 0.55, 0, 1) * (1 - f.pan);
      if (bank < 0.20) continue;
      if (rand() > bank * 0.42) continue;
      if (Math.hypot(x - JUNIPER_XZ.x, z - JUNIPER_XZ.z) < 7.0) continue;
      const y = terrain.heightAt(x, z);
      const sz = 1.35 + rand() * 1.15;
      shrub.push({
        x, y: y - 0.05, z, rot: rand() * TAU,
        sx: sz * (0.82 + rand() * 0.36), sy: sz * (0.80 + rand() * 0.46),
        sz: sz * (0.82 + rand() * 0.36),
        r: 0.80 + rand() * 0.26, g: 0.86 + rand() * 0.22, b: 0.74 + rand() * 0.22,
      });
    }
  }

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
      const du = corridorDist(path, p3.x, p3.z, qtmp);
      /* Inner limit down from 15 m to 7. The benches that actually read in
         `wall_lit` and `wall_shade` are the near ones, and excluding everything
         inside fifteen metres is what left a bench "the size of the one in
         wall_lit" bare — on a formation that in Sedona would carry junipers
         along every ledge. */
      if (du < 7 || du > 210) continue;
      if (Math.hypot(p3.x - JUNIPER_XZ.x, p3.z - JUNIPER_XZ.z) < HERO_CLEAR) continue;
      /* Slope gate. A bench is a bench; a wall face keeps nothing. */
      const up = n3.y;
      if (up < 0.36) continue;
      const shelf = smoothstep(0.36, 0.80, up);
      /* Higher is drier and more exposed. */
      const alt = 1 - smoothstep(14, 48, p3.y);
      const cl = clusterField(p3.x, p3.z);
      /* 0.075 rather than the 0.125 this round started with. The count is not
         stable against other systems' work: the same rate returned 647 bench
         plants against System 2's rock at the start of the round and 1525 after
         its terrace change landed, because this harvests candidate points off
         their meshes. A rate is the wrong thing to tune blind, so this is set to
         land near a thousand — comfortably more than the 438 the critique called
         absent, and short of the closed woodland that 1525 would read as. */
      const pAcc = shelf * (0.18 + 0.82 * cl) * (0.25 + 0.75 * alt) * 0.075;
      if (rr() > pAcc) continue;
      const sz = 0.8 + rr() * 1.9;
      const dark = 0.72 + rr() * 0.5;
      const target = du < CARD_RANGE ? mid : far;
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
    const du = corridorDist(path, x, z, qtmp);
    /* Alongside the walked corridor the walls own the ground; this scatter is
       only for the open height field beyond them and up-wash past their end. */
    if (du < (z > -340 ? WALL_REACH : 22)) continue;
    if (Math.hypot(x - JUNIPER_XZ.x, z - JUNIPER_XZ.z) < HERO_CLEAR) continue;
    /* Cluster and dice first: the height field is by far the most expensive
       thing in this loop and ninety-odd percent of candidates are rejected
       without it. */
    const cl = clusterField(x, z);
    if (rr() > (0.06 + 0.94 * cl) * 0.18) continue;
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
    (du < CARD_RANGE ? mid : far).push({
      x, y: y - 0.1, z, rot: rr() * TAU,
      sx: sz * (0.8 + rr() * 0.4), sy: sz * (0.9 + rr() * 0.7), sz: sz * (0.8 + rr() * 0.4),
      r: dark, g: dark, b: dark,
    });
  }

  return { grass, shrub, pear, agave, mid, far };
}

export function buildVegetation(path, terrain, rocks) {
  const out = [];
  const { grass, shrub, pear, agave, mid, far } = planVegetation(path, terrain, rocks);

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

  /* Analytic coverage in place of the binary cutout. `alphaToCoverage` alone did
     nothing on these for two rounds because the stock alpha test discards and
     leaves every surviving fragment fully opaque, so the multisample mask had a
     constant to interpolate. Dividing the distance to the cutoff by alpha's
     screen-space derivative gives a ramp one pixel wide at any mip level, which
     the mask can resolve. See the longer note in `makeFoliageMaterial`. */
  const coverageEdge = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <alphatest_fragment>', /* glsl */`
          {
            float aw = max( fwidth( diffuseColor.a ), 1e-5 );
            float cov = ( diffuseColor.a - alphaTest ) / aw + 0.5;
            if ( cov <= 0.0 ) discard;
            diffuseColor.a = min( cov, 1.0 );
          }`);
    };
    mat.customProgramCacheKey = () => 'veg-coverage-edge';
    return mat;
  };

  const grassMat = coverageEdge(new THREE.MeshStandardMaterial({
    map: grassTex(), alphaTest: 0.40, side: THREE.DoubleSide,
    roughness: 0.95, metalness: 0, vertexColors: true,
    color: new THREE.Color(0.90, 0.85, 0.78), dithering: true,
    alphaToCoverage: true,
  }));
  const scrubMat = coverageEdge(new THREE.MeshStandardMaterial({
    map: scrubTex(), alphaTest: 0.40, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0, vertexColors: true,
    color: new THREE.Color(0.80, 0.84, 0.72), dithering: true,
    alphaToCoverage: true,
  }));
  /* Cactus and agave are succulent: waxy, so a touch glossier than anything
     else in the frame, and a pale glaucous blue-green — much lighter and bluer
     than juniper, which is most of what distinguishes them at a distance where
     neither has any resolvable structure.
     Now mapped. These were the only geometry in the system with no texture at
     all, which is precisely how they read. Double sided because an agave blade
     is a single sheet and back-face culling turned the rosette into a black
     wedge. */
  const succ = succTex();
  const succMat = new THREE.MeshStandardMaterial({
    map: succ.albedo,
    normalMap: succ.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.74, metalness: 0, vertexColors: true, dithering: true,
    side: THREE.DoubleSide,
  });

  instance(grassTuftGeo(1001), grassMat, grass, 'veg-grass', true);
  instance(shrubGeo(1002), scrubMat, shrub, 'veg-shrub', true);
  instance(pricklyPearGeo(1003), succMat, pear, 'veg-pear', true);
  instance(agaveGeo(1004), succMat, agave, 'veg-agave', true);

  /* ── mid-distance junipers on the terraces and lower slopes ──────────────
     Close enough that a blob would read as a blob, far enough that a real tree
     is not affordable: seven foliage cards on the same texture as the hero. */
  const midGeo = addSun(addWhite(cardGeometry((arr) => {
    const r = rng(2002);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU;
      cardTuft(Math.cos(a) * 0.17, 0.06 + r() * 0.46, Math.sin(a) * 0.17,
               0.70, 0.60, 1, r, arr, 2, 2);
    }
  })));
  const midMat = makeFoliageMaterial(foliageTex());
  midMat.vertexColors = true;
  /* Much darker than the hero's foliage, and deliberately so. These stand in
     for whole trees, and a whole tree seen from forty metres is a shadowed mass
     with a lit fringe — it never averages anywhere near the albedo of the
     sunlit sprays on its own outside. Left at full albedo they came out as
     white-speckled clumps that read as patches of snow on the cliff. */
  midMat.color = new THREE.Color(0.40, 0.42, 0.30);
  midMat.alphaToCoverage = true;
  /* Cut hard, from 0.30. The transmission term is a rim effect on a spray a
     couple of millimetres thick; at forty metres and beyond there is no rim to
     resolve, and all it was doing was adding a warm yellow pedestal to a
     yellow-green albedo. Backlit on a distant bench that lands as the
     chartreuse shards a reviewer picked out in `sun_gap`. */
  midMat.userData.uniforms.uTransAmt.value = 0.12;
  /* And the isotropic share cut with it, for the same reason. That term exists to
     stop the *hero's* crown interior going black at three metres across; on a
     card standing in for a whole tree at forty metres there is no interior to
     light, and left at the hero's value it is simply a warm pedestal on a
     yellow-green albedo. */
  midMat.userData.uniforms.uTransIso.value = 0.04;

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
