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
  return addSun(addWhite(
    cardGeometry((arr) => cardTuft(0, 0, 0, 0.62, 1.0, 4, rand, arr, 4, 1))));
}

/* Four bench silhouettes instead of one.
 *
 * A critic counted "the same shrub outline at the same size roughly fifteen
 * times at near-regular intervals" along the right bench in `far_170`, and the
 * same repeat along the terrace in `bend`. The interval is a placement problem,
 * dealt with in `planVegetation`; the identical *outline* is this. The tier is
 * one instanced geometry, so every plant on every bench in the scene was
 * literally the same nine cards, and rotating a radially symmetric arrangement
 * about its own axis does not change what the eye sees.
 *
 * The atlas is fixed and no new art is affordable, so the variation has to come
 * from arrangement. These four differ in the axis ratio and in where the mass
 * sits, which is what a silhouette is: an upright column, a broad dome, a low
 * sprawling mat, and a two-lobed shrub with a notch in its crown instead of a
 * single apex. Between them they also answer part of the "one species
 * everywhere" note — a mat and a column read as different plants at fifty
 * metres far more than any amount of detail on one of them would.
 *
 * Every one of them keeps the skirt invariant: the first `skirt` cards start at
 * negative y, so the tier has geometry below its own origin and buries into
 * whatever it stands on. That is not decoration — cards that start at positive y
 * is exactly the bug that shipped as junipers with severed trunks.
 */
export const MID_SHAPES = [
  { skirt: 4, n: 9, rad: [0.21, 0.32], up: [0.03, 0.43], w: 0.70, h: 0.60 },
  { skirt: 3, n: 7, rad: [0.09, 0.17], up: [0.06, 0.88], w: 0.54, h: 0.78 },
  { skirt: 6, n: 11, rad: [0.32, 0.56], up: [0.00, 0.14], w: 0.86, h: 0.40 },
  { skirt: 4, n: 10, rad: [0.14, 0.30], up: [0.02, 0.60], w: 0.62, h: 0.66,
    lobe: 0.26 },
];

export function midTuftGeo(seed, s) {
  const r = rng(seed);
  return addSun(addWhite(cardGeometry((arr) => {
    for (let i = 0; i < s.n; i++) {
      const a = i / s.n * TAU + r() * 0.42;
      const skirt = i < s.skirt;
      const rad = s.rad[0] + r() * (s.rad[1] - s.rad[0]);
      /* Two lobes rather than one mass, so the crown carries a notch. */
      const lob = s.lobe ? (i % 2 ? s.lobe : -s.lobe) : 0;
      cardTuft(Math.cos(a) * rad + lob,
               skirt ? -0.20 - r() * 0.12 : s.up[0] + r() * (s.up[1] - s.up[0]),
               Math.sin(a) * rad,
               skirt ? s.w * 1.20 : s.w,
               skirt ? s.h * 1.27 : s.h,
               1, r, arr, 2, 2);
    }
  })));
}

/* The near shrub, three ways, for the same reason and on the same principle:
   the one in the foreground of `wash_low` and `wash_mid` is the most magnified
   plant in the set after the hero, so a repeat there is the most visible. */
const SHRUB_SHAPES = [
  { lo: [0.95, 1.00, 5], hi: [0.70, 0.78, 3], lift: 0.09 },
  { lo: [1.34, 0.54, 7], hi: [0.92, 0.40, 3], lift: 0.04 },
  { lo: [0.66, 1.34, 4], hi: [0.48, 1.02, 3], lift: 0.22 },
];

/** A low grey-green shrub. Same trick: cards with near-vertical normals. */
function shrubGeo(seed, s = SHRUB_SHAPES[0]) {
  const rand = rng(seed);
  return addSun(addWhite(cardGeometry((arr) => {
    /* Two tiers, so it has a silhouette rather than being one slab — but eight
       cards, not five, and the upper tier lifted 0.09 rather than 0.18.
       At five cards each is offset by up to 35% of its own width and the second
       tier started above the first one's midpoint, so a card could and did end up
       with clear air between it and everything else: "several cards floating
       detached" in the nearest shot of this shrub. Overlap is cheap here — this
       geometry is instanced once and drawn a few hundred times. */
    cardTuft(0, 0, 0, s.lo[0], s.lo[1], s.lo[2], rand, arr);
    cardTuft(0, s.lift, 0, s.hi[0], s.hi[1], s.hi[2], rand, arr);
  })));
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
      /* Species mix, and why these four numbers moved.
         A critic's last note was "one species everywhere", against real Sedona
         benches that mix manzanita, agave, prickly pear, banana yucca and
         juniper. The cause was not the habitat model: it was that prickly pear
         was capped at four instances and agave at two, scene-wide. Those caps
         were put in when both rendered badly — pear as "standing stones", agave
         as broken geometry — and they were the right call then. Both were rebuilt
         two rounds ago and given a real texture, and nobody went back for the
         caps, so the scene has been carrying five succulents in total across
         three hundred metres of wash. The windows widen too, because lifting a
         cap does nothing when the probability slice behind it is 1.5% wide.
         The caps stay, an order of magnitude up, as rails rather than as limits:
         this loop's habitat term depends on `Terrain.facies`, which System 1 owns
         and has changed twice, and a flood of cactus is a worse failure than a
         shortage. */
      if (roll < p * 0.60) {
        grass.push({
          x, y: y - 0.03, z, rot: rand() * TAU,
          sx: 0.38 + rand() * 0.32, sy: 0.32 + rand() * 0.34, sz: 0.38 + rand() * 0.32,
          r: 0.86 + rand() * 0.22, g: 0.82 + rand() * 0.20, b: 0.72 + rand() * 0.18,
        });
      } else if (roll < p * 0.88) {
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
      } else if (roll < p * 0.94 && pear.length < 60 && f.terr > 0.55) {
        pear.push({
          x, y: y - 0.05, z, rot: rand() * TAU,
          sx: 0.62 + rand() * 0.30, sy: 0.60 + rand() * 0.32, sz: 0.62 + rand() * 0.30,
          /* Was 0.95-1.09 on all three, i.e. no tint at all on an albedo that was
             already too pale. */
          r: 0.70 + rand() * 0.12, g: 0.84 + rand() * 0.10, b: 0.68 + rand() * 0.12,
        });
      } else if (roll < p * 1.00 && agave.length < 110) {
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
      /* `cl * cl` against a 0.06 floor, from `0.18 + 0.82 * cl`. The old floor
         meant a sixth of the full rate fell everywhere the cluster field said
         nothing, which is what filled the gaps in and left an even scatter along
         every bench — and evenness is what a critic read as "placement rather
         than plants". Squaring sharpens the field's own contrast, so growth
         concentrates in the gullies where water collects and thins to nothing on
         the interfluves, which is how pinyon-juniper actually distributes. The
         rate rises to hold the count; see the note below on why a rate here is
         not a stable thing to tune. */
      const pAcc = shelf * (0.06 + 0.94 * cl * cl) * (0.25 + 0.75 * alt) * 0.120;
      if (rr() > pAcc) continue;
      const sz = 0.8 + rr() * 1.9;
      const dark = 0.72 + rr() * 0.5;
      const target = du < CARD_RANGE ? mid : far;
      /* Break the lattice.
         These candidates are mesh vertices, so they inherit the rock's
         tessellation: marching a structured grid at a fixed stride returns points
         at near-constant intervals along any one bench, and that periodicity
         survives into the accepted set. It is the other half of "the same shrub
         at near-regular intervals" — the first half being that they were all the
         same shrub.
         Displacing inside the local tangent plane decorrelates spacing from the
         mesh without needing a surface query I do not have out here. The basis is
         built against x-hat, which is safe because the slope gate has already
         guaranteed `n.y >= 0.36`, so the normal is never near horizontal and the
         cross product never degenerates. Scaled by flatness squared: the tangent
         plane leaves the surface fastest on a steep face, so that is where the
         displacement is smallest, and what error remains is inside the 0.35 to
         1.40 m the skirt reaches below the seat. */
      /* 1.4 m, down from 2.4. At 2.4 the seating probe found 3.4% of the bench
         tier with its lowest vertex clear of the ground against 0% before, and
         the mechanism is obvious once seen: a displacement of that size near a
         bench edge walks the plant off it, and a juniper hanging over a drop is
         the defect this tier was last fixed for. 1.4 m still decorrelates the
         spacing — the repeat a critic counted was at intervals of a few metres —
         and it is inside what the skirt absorbs. */
      const jr = 1.4 * shelf * shelf;
      const jd = Math.sqrt(rr()) * jr, ja = rr() * TAU;
      let t1x = 0, t1y = -n3.z, t1z = n3.y;   // n x (1,0,0)
      const t1l = Math.hypot(t1y, t1z) || 1;
      t1y /= t1l; t1z /= t1l;
      const t2x = n3.y * t1z - n3.z * t1y,    // n x t1
        t2y = n3.z * t1x - n3.x * t1z,
        t2z = n3.x * t1y - n3.y * t1x;
      const jc = Math.cos(ja) * jd, js = Math.sin(ja) * jd;
      p3.x += t1x * jc + t2x * js;
      p3.y += t1y * jc + t2y * js;
      p3.z += t1z * jc + t2z * js;
      /* Sink with the instance rather than by a fixed 0.12 m. A constant sink is
         a *shrinking* one in the geometry's own units — 0.12 of a unit-height
         tuft but 0.03 of a four-metre one — so the biggest and most visible
         plants were the least firmly seated. Proportional keeps the ground line
         at the same place up the tuft whatever the scale. */
      target.push({
        x: p3.x, y: p3.y - 0.10 * sz, z: p3.z, rot: rr() * TAU,
        sx: sz * (0.8 + rr() * 0.4), sy: sz * (0.9 + rr() * 0.7), sz: sz * (0.8 + rr() * 0.4),
        r: dark, g: dark, b: dark,
      });
    }
  }

  /* ── the rim ─────────────────────────────────────────────────────────────
     Plants on the wall crest, for one reason: `shade_far`'s left skyline is
     geometrically straight, a critic measured it straight to within a pixel and
     a half over hundreds of pixels and called it the most conspicuous single
     object in the set, and no change to the rock can break it.
     Why the rock cannot. That skyline is not a mesa, it is wallL seen end-on.
     Square-on, a screen column is one station and the crest profile *is* the
     skyline; end-on, a column spans tens of metres and the skyline is the upper
     *envelope* of the crest over every station in it. An envelope is set by the
     un-notched stations, so a notch narrower than a bearing bin is invisible at
     any depth and one wider than the frame is constant across it. System 2
     landed a crest generator that steps ten times in 200 m and the frame barely
     moved. `tools/_skyenv.mjs` measures why: over the run from one degree left of
     the axis to five and a half right, the crest sits at y 66.5 to 67.1 — eleven
     bins, six and a half degrees — while the range closes from 118 m to 106 m.
     Every bit of that line's apparent rise is perspective on a constant height.
     Something standing *above* the envelope is the only thing that breaks it,
     which is what the critic asked for by name: "no vegetation breaking it".
     And there has never been any, for a reason that took one grep: the harvest
     above rejects `p3.y > 58`, and the crest along that run is at 67. Not sparse
     up there — excluded. So this is a separate pass rather than a relaxed gate,
     because the gate is doing a real job everywhere else and the rim wants
     different plants anyway: taller, sparser, and chosen for a silhouette rather
     than for ground cover, which is what a wind-flagged rim juniper is.
     General rather than aimed at the one frame. `bend`, `far_170` and `far_220`
     all look along a wall and all have the same straight skylines for the same
     reason, and a crest pass fixes the class. */
  {
    /* Walls *and* buttes. The first version of this pass took only `/^wall/`,
       on System 2's attribution that the offending skyline is wallL end-on, and
       it put seventy plants along the wall crests without touching the ruler at
       all: `tools/_skyline.mjs` measured the edge at columns 120-319 of
       `shade_far` at 0.50 px worst residual over 200 columns, unchanged. The
       attribution was for the *frame*, not for that edge. Cropping it shows a
       pale flat-topped sandstone cap at long range, which is a butte, and buttes
       were being skipped here for the same reason they are skipped by the main
       harvest above — that one caps at y 58 and a butte top is well over it.
       Hence the generalisation: any rock mesh, and the top rather than the
       along-z crest.
       Why the *cap* rather than the lip. A butte's skyline is its cap edge, so
       anything standing on the cap is above the silhouette wherever on the cap it
       stands — there is no need to find the lip, and looking for one on a mesh
       that is not a corridor needs a normal query this pass does not have. Taking
       the vertices within `CAP` of each mesh's own maximum picks out exactly the
       flat top that draws the ruler, and nothing lower down the flanks. */
    /* A height field over the whole rock mass, then the lips in it.
       Two earlier versions of this pass aimed at named meshes and missed. The
       first took wall crests, on System 2's attribution that the skyline is wallL
       end-on: seventy plants, and `tools/_skyline.mjs` measured the offending edge
       at 0.50 px worst residual over 200 columns, byte-identical. The second added
       butte caps, on the reasoning that a flat pale top at long range is a butte:
       ninety more plants, same 0.50 px, byte-identical again.
       What both missed is that the edge is a *shoulder*. Taking one maximum per
       mesh per z-slice puts the plant wherever that mesh is tallest at that
       station, and the tall part is behind and to the right of the pale bed that
       actually draws the skyline — so every candidate was consumed by a summit
       that is not on the horizon, and the shoulder never got one. A cap test has
       the same blind spot from the other side: a shoulder is nowhere near its
       mesh's summit and gets excluded by definition.
       So stop looking for summits and look for what a rim actually is: ground with
       a drop beside it. Bin every vertex of every wall and butte into one shared
       8 m grid — shared, so a rim that two meshes contribute to is not split in
       half and then failed by both — and keep a cell when its neighbourhood falls
       away by more than `DROP`. That finds summits, cap edges, bench lips and
       shoulders under one criterion, needs no mesh names and no surface normal,
       and cannot be defeated by something taller standing behind it. */
    const CELL = 8;      // metres
    const DROP = 6;      // metres a neighbour must fall for this cell to be a lip
    const grid = new Map();
    const gk = (ix, iz) => ix + ':' + iz;
    for (const m of rocks) {
      if (!/^wall|^butte/.test(m.name)) continue;
      const g = m.geometry;
      if (!g || !g.attributes.position) continue;
      m.updateMatrixWorld(true);
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        p3.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
        if (p3.z > 30 || p3.z < -700) continue;
        const ix = Math.round(p3.x / CELL), iz = Math.round(p3.z / CELL);
        const k = gk(ix, iz);
        const cur = grid.get(k);
        if (!cur || p3.y > cur.y) grid.set(k, { x: p3.x, y: p3.y, z: p3.z, ix, iz });
      }
    }
    /* Candidate positions from inside triangles, not from vertices — and this is
       the fourth and last thing that was wrong with this pass.
       Vertices are not where the rock is. `tools/_rimwhere.mjs` raycast the ruler
       edge in `shade_far` and got wallL at world (-6, 46.8, 8.2); the highest wall
       vertex within twelve metres of that point is at y -0.8. Both figures come
       off the same buffers, so they can only both be true if the surface there is
       the interior of one very large triangle whose corners are tens of metres
       away — which is exactly what a wall looks like where it is coarse, and
       exactly why it draws a ruler in the first place. Its corners sit around x
       -32 to -48, where this pass had already been happily planting: at 164 m,
       thirty-four metres of lateral offset is about twelve degrees, so those
       plants land two hundred pixels to the left of the edge they were meant to
       break. Three rounds of raising the acceptance rate moved plants around on
       the parts of the mesh that have vertices and never put one on the part that
       does not.
       So sample the surface rather than its corners: walk the triangles, keep the
       upward-facing ones, and scatter candidates across them by area. On finely
       tessellated rock this returns roughly what the vertex scan did; on a coarse
       face it returns the middle of it, which is the only place a plant can stand
       to break that skyline. */
    const CAND_AREA = 90;      // m^2 of upward-facing rock per candidate
    const cands = [];
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
    const rrt = rng(818283);
    for (const m of rocks) {
      if (!/^wall|^butte/.test(m.name)) continue;
      const g = m.geometry;
      if (!g || !g.attributes.position) continue;
      m.updateMatrixWorld(true);
      const pa = g.attributes.position, idx = g.index;
      const tris = idx ? idx.count / 3 : pa.count / 3;
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        va.fromBufferAttribute(pa, i0).applyMatrix4(m.matrixWorld);
        vb.fromBufferAttribute(pa, i1).applyMatrix4(m.matrixWorld);
        vc.fromBufferAttribute(pa, i2).applyMatrix4(m.matrixWorld);
        const cy = (va.y + vb.y + vc.y) / 3;
        if (cy < 20) continue;
        const cz = (va.z + vb.z + vc.z) / 3;
        if (cz > 30 || cz < -700) continue;
        e1.subVectors(vb, va); e2.subVectors(vc, va);
        fn.crossVectors(e1, e2);
        const area2 = fn.length();
        if (area2 < 1e-6) continue;
        /* Upward-facing, by the triangle's own geometric normal rather than by an
           interpolated vertex normal — a vertex on an arris carries an average of
           two faces and would let a plant onto a wall. Winding is not consistent
           between the two walls here, so take the absolute value. */
        if (Math.abs(fn.y) / area2 < 0.55) continue;
        const area = area2 * 0.5;
        /* Fractional counts, or every triangle under 90 m^2 is silently barren. */
        let n = area / CAND_AREA;
        n = Math.floor(n) + (rrt() < n - Math.floor(n) ? 1 : 0);
        for (let s = 0; s < n; s++) {
          let u = rrt(), w = rrt();
          if (u + w > 1) { u = 1 - u; w = 1 - w; }
          cands.push({
            x: va.x + e1.x * u + e2.x * w,
            y: va.y + e1.y * u + e2.y * w,
            z: va.z + e1.z * u + e2.z * w,
          });
        }
      }
    }

    const crest = [];
    for (const c of cands) {
      c.ix = Math.round(c.x / CELL);
      c.iz = Math.round(c.z / CELL);
      /* Measured two and three cells out, not one, and this is the whole reason
         the pass took three attempts to bite.
         A rim is a near-vertical face, and the cell immediately outboard of a
         vertical face contains that face — whose highest vertex is the lip
         itself. So the drop to the adjacent cell is about zero exactly where the
         cliff is sheerest, and an adjacent-neighbour test rejects every true rim
         while accepting rubbly slopes. `tools/_pixowner.mjs` settled it by
         ablation: the ruler edge in `shade_far` is owned by `wallL`, a mesh this
         pass was already reading, so the miss was never about which object.
         Sixteen to twenty-four metres out, a wall of any real height has fallen
         away and the test reads what a human would call a rim. */
      let drop = 0;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          const cheb = Math.max(Math.abs(dx), Math.abs(dz));
          if (cheb < 2) continue;
          const n = grid.get(gk(c.ix + dx, c.iz + dz));
          /* A missing cell out there is open air off the edge of the rock mass,
             which is the strongest evidence of a lip there is. */
          drop = Math.max(drop, n ? c.y - n.y : DROP);
        }
      }
      if (drop < DROP) continue;
      crest.push(c);
    }
    /* Sparse and clumped, not a hedge. A continuous line of plants along a rim
       would replace one straight silhouette with another, slightly furrier one:
       what breaks a straight line is a few things standing well clear of it with
       gaps between, so the acceptance is low and the cluster field is allowed to
       decide where they group. */
    const rr3 = rng(515253);
    for (const c of crest) {
      const cl = clusterField(c.x, c.z);
      /* Squared, and with a low floor. Taking half of everything the lip test
         accepts is a hedge, and a hedge replaces one straight silhouette with a
         furrier straight silhouette. Squaring the cluster term concentrates what
         is left into groups with real gaps between them, which is both what breaks
         a line and what a rim actually looks like: junipers take the pockets where
         water sits and leave the rest bare. */
      if (rr3() > 0.09 + 0.34 * cl * cl) continue;
      const sz = 1.5 + rr3() * 1.5;
      mid.push({
        /* No lateral jitter here, and that is deliberate. `c.y` is a height
           measured at `c.x, c.z`, and a lip is by definition where that height
           falls away within a few metres, so any displacement that keeps the
           harvested height is a coin flip on whether the plant ends up hanging
           over the drop — the exact defect this tier was last fixed for. The cell
           maximum already lands at an arbitrary point inside its 8 m square, which
           is all the irregularity the spacing needs. */
        x: c.x, y: c.y - 0.10 * sz, z: c.z, rot: rr3() * TAU,
        sx: sz * (0.62 + rr3() * 0.30),
        /* Taller than wide by construction. A rim juniper is wind-flagged and
           leggy, and in silhouette against bright sky the height is the whole
           signal. */
        sy: sz * (1.15 + rr3() * 0.75),
        sz: sz * (0.62 + rr3() * 0.30),
        r: 0.66 + rr3() * 0.34, g: 0.66 + rr3() * 0.34, b: 0.66 + rr3() * 0.34,
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

  /* Spread one placement list across several geometries, so a tier can hold more
     than one outline.
     Each variant becomes its own `InstancedMesh` and so its own draw call. That
     is the whole cost, and on a frame the governor measures as fill-bound at 122
     fps with all vegetation at 0.58 ms, three extra draw calls to stop a bench
     reading as a row of stamps is not a trade that needs thinking about.
     Names are suffixed `-a`, `-b` and so on. Anything looking for a tier has to
     match the `veg-mid` *prefix* rather than the whole name — `tools/vegval.mjs`
     and `tools/_seat.mjs` both do. */
  const instanceVaried = (geos, mat, list, name, shadow) => {
    const buckets = geos.map(() => []);
    const pick = rng(90210);
    for (const o of list) buckets[(pick() * geos.length) | 0].push(o);
    buckets.forEach((b, i) =>
      instance(geos[i], mat, b, `${name}-${String.fromCharCode(97 + i)}`, shadow));
  };

  /* Grass and scrub move onto the hero crown's BRDF, and the reason is the same
     defect that was diagnosed on the crown two rounds ago and never carried
     across to the near field.
     A critic measured these shrubs as the brightest objects in `wash_low` and
     `wash_mid` — "clipped to pure white against a dark cliff" — and separately as
     "flat two-tone cutout blades ... with no midtone between". Those are one
     cause. Both materials were plain `MeshStandardMaterial`: a Lambertian sheet
     with an alpha cutout, no transmission, and no bound on the direct term. So a
     card whose normal happens to point at the sun returns full irradiance, and
     with the key at 15 degrees that is about 3.9x what the grazing-lit wash floor
     beside it receives — while the leaf albedo is roughly half the sand's. Net
     four to eight times too bright, which is the level claim. And a sheet with no
     transmission has exactly two states, full key or ambient alone, which is the
     distribution claim. `makeFoliageMaterial`'s own comment describes this
     arriving on the crown as "cream popcorn measuring (240, 227, 211)", and it
     was diagnosed twice as an alpha-cutout artefact before turning out to be a
     BRDF one. Same mistake, one object later.
     What that path brings: the saturating knee on direct diffuse, so a card
     standing in for a volume of leaves cannot out-run the ground it grows on; a
     forward-scatter and isotropic transmission term, which is what puts a
     midtone between the lit and shaded faces of something two leaves thick; and
     specular cut to 0.28, because a dielectric F0 at this grazing an angle is a
     white veil on a surface with no coherent facet. It also carries the same
     analytic coverage ramp `coverageEdge` was providing, so nothing is lost. */
  const grassMat = makeFoliageMaterial(grassTex());
  grassMat.alphaTest = 0.40;
  grassMat.roughness = 0.95;
  grassMat.color = new THREE.Color(0.90, 0.85, 0.78);
  {
    const u = grassMat.userData.uniforms;
    u.uDirCap.value = 0.22;
    u.uAmbScale.value = 0.52;
    /* Dry grass transmits straw rather than the crown's dead-scale amber, and a
       dead blade is thinner and leakier than a live leaf. */
    u.uTrans.value = new THREE.Color(1.40, 1.16, 0.62);
    u.uTransAmt.value = 0.34;
    u.uTransIso.value = 0.30;
  }
  const scrubMat = makeFoliageMaterial(scrubTex());
  scrubMat.alphaTest = 0.40;
  scrubMat.roughness = 0.92;
  scrubMat.color = new THREE.Color(0.80, 0.84, 0.72);
  {
    const u = scrubMat.userData.uniforms;
    /* The three levers, and which defect each one answers.
       `uDirCap` and `uAmbScale` are the level: a card presenting a full-facing
       normal to a 15-degree key takes about 3.9x what the grazing-lit floor
       beside it takes, and with no baked occlusion it also sees the whole sky.
       Both are wrong for something standing in for a volume of leaves, and
       together they are why a critic measured these as the brightest objects in
       two frames. The knee alone could not fix it — swept over 7.5x it moved the
       level 14%, because with direct clamped the remaining energy is ambient.
       The transmission pair is the midtone. `uTransIso` is the one that matters
       here: an isotropic leak lifts the back-facing cards, which is exactly the
       population that measured 45% of plant pixels inside the bottom tenth of
       their own range and read as "black silhouette leaves ... with no midtone
       between". `uTransAmt` is kept modest on purpose — forward scatter brightens
       the backlit rim, which is the part that was already too bright.
       Greener and less amber than the crown's, which is tuned for dead scale.
       Light through a live grey-green desert leaf comes out yellow-green. */
    u.uDirCap.value = 0.18;
    u.uAmbScale.value = 0.46;
    u.uTrans.value = new THREE.Color(1.22, 1.14, 0.64);
    u.uTransAmt.value = 0.30;
    u.uTransIso.value = 0.40;
  }
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
  /* The same level fix as the foliage tiers, and it became necessary *because* of
     the count change above: at two agaves scene-wide this material was never
     large in a frame, and at seventy-three it is the brightest thing in the
     foreground of `wash_mid` — pale mint paddles reading as cut paper. Lifting a
     population is not a neutral act; it promotes whatever that population's
     material gets wrong.
     A knee and a sky-visibility term, and deliberately not the transmission:
     an agave blade is a centimetre of water-filled tissue and does not glow when
     backlit, which is one of the few things that distinguishes it from the scrub
     beside it. Kept as its own small injection rather than by borrowing
     `makeFoliageMaterial`, because that path has no normal map and the normal map
     is what stops these being flat sheets — which is the other half of what they
     were criticised for. */
  {
    const u = { uSuccCap: { value: 0.30 }, uSuccAmb: { value: 0.62 } };
    succMat.userData.uniforms = u;
    succMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform float uSuccCap;\nuniform float uSuccAmb;')
        .replace('#include <lights_fragment_end>', /* glsl */`
          #include <lights_fragment_end>
          reflectedLight.directDiffuse =
            uSuccCap * ( 1.0 - exp( -reflectedLight.directDiffuse / uSuccCap ) );
          reflectedLight.indirectDiffuse *= uSuccAmb;
          reflectedLight.indirectSpecular *= uSuccAmb;`);
    };
    succMat.customProgramCacheKey = () => 'veg-succulent';
  }

  instance(grassTuftGeo(1001), grassMat, grass, 'veg-grass', true);
  instanceVaried(SHRUB_SHAPES.map((s, i) => shrubGeo(1002 + i * 71, s)),
                 scrubMat, shrub, 'veg-shrub', true);
  instance(pricklyPearGeo(1003), succMat, pear, 'veg-pear', true);
  instance(agaveGeo(1004), succMat, agave, 'veg-agave', true);

  /* ── mid-distance junipers on the terraces and lower slopes ──────────────
     Close enough that a blob would read as a blob, far enough that a real tree
     is not affordable: a handful of foliage cards on the same texture as the
     hero, in four different arrangements. See `MID_SHAPES` for why four, and for
     the skirt invariant every one of them has to keep.
     `cardTuft` grows each card *upward* from the `cy` it is given — `py = cy +
     hh * sy` with `sy` in {0, 1} — so `cy` is the card's foot and not its centre.
     This tier once passed `cy = 0.06 + r() * 0.46`, which put its lowest vertex
     at local y 0.074 and left it with no geometry at or below its own origin: at
     the wall foot, over shaded rock, that shipped as foliage floating over a
     black gap and was reported as junipers with severed trunks. */
  const midGeos = MID_SHAPES.map((s, i) => midTuftGeo(2002 + i * 97, s));
  const midMat = makeFoliageMaterial(foliageTex());
  midMat.vertexColors = true;
  /* Much darker than the hero's foliage, and deliberately so. These stand in
     for whole trees, and a whole tree seen from forty metres is a shadowed mass
     with a lit fringe — it never averages anywhere near the albedo of the
     sunlit sprays on its own outside. Left at full albedo they came out as
     white-speckled clumps that read as patches of snow on the cliff. */
  midMat.color = new THREE.Color(0.40, 0.42, 0.30);
  midMat.alphaToCoverage = true;
  /* Transmission off, and now genuinely off rather than nominally.
     This tier carried 0.12 and 0.04 — cut hard from 0.30 on the reasoning that
     the term is a rim effect on a spray two millimetres thick, and at forty
     metres and beyond there is no rim to resolve, so all it added was a warm
     pedestal on a yellow-green albedo: the chartreuse shards a reviewer picked
     out in `sun_gap`. That reasoning holds and is why these are zero now.
     But the values were never doing anything either way — the term was injected
     at a hook that runs after the shading is summed, see `makeFoliageMaterial` —
     so "cut hard" described a change that could not have had an effect, and the
     shards must have gone for another reason. With the hook fixed, leaving 0.12
     here would switch a warm pedestal *on* in the tier a critic has just called
     out for reading as pale repeated stamps along a bench. Explicitly zero, so
     the frames this tier appears in are unchanged by the hook fix. */
  midMat.userData.uniforms.uTransAmt.value = 0.0;
  midMat.userData.uniforms.uTransIso.value = 0.0;

  /* Dark, desaturated, slightly blue-shifted green. A distant juniper is nearly
     black against sunlit rock; the haze does the rest of the work. */
  const farMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.052, 0.062, 0.043),
    roughness: 0.95, metalness: 0, vertexColors: true, dithering: true,
    flatShading: false,
  });

  instanceVaried(midGeos, midMat, mid, 'veg-mid', false);
  instance(blobGeo(3003), farMat, far, 'veg-far', false);

  return out;
}
