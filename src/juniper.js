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
import { barkTex, foliageTex, grassTex } from './plantex.js';

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
   framing instead of foreshortening to nothing. System 5's saltation ribbons and
   System 6's wind bed should agree with this; it is exported for that. */
export const WIND = new THREE.Vector2(0.94, 0.34).normalize();

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

  /* The lobe sum's range, sampled, so the flute amplitude below is a *fraction
     of the radius* rather than an arbitrary number that has to be retuned every
     time the lobe count changes. The first build normalised against the mean
     only, which left the trunk varying by six percent of its radius — a smooth
     pipe. A real juniper bole varies by twenty. */
  let lo = 1e9, hi = -1e9;
  const o = { r: 0, dead: 0 };
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 96; i++) {
      prof.eval(i / 96 * TAU, k * 0.55, o);
      if (o.r < lo) lo = o.r;
      if (o.r > hi) hi = o.r;
    }
  }
  prof.lo = lo;
  prof.span = Math.max(1e-3, hi - lo);
  return prof;
}

/* ── one limb ──────────────────────────────────────────────────────────────
 * A swept fluted tube along a polyline, with a parallel-transported frame so it
 * does not corkscrew where the spine bends. */
function limbGeometry(pts, radii, seg, prof, twistRate, s0, flute, deadBase = 0, shred = 0) {
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
  const vcol = new Float32Array(vcount * 3);
  const uRep = Math.max(1, Math.round(TAU * radii[0] / BARK_TILE));
  const o = { r: 0, dead: 0 };

  for (let i = 0; i < n; i++) {
    const si = s[i];
    for (let j = 0; j < cols; j++) {
      const th = (j % seg) / seg * TAU;
      prof.eval(th + twistRate * (s0 + si), s0 + si, o);
      const shape = (o.r - prof.lo) / prof.span;      // 0 in a groove, 1 on a ridge
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
      const r = radii[i] * (1 - flute * 0.5 + flute * shape + 0.035 * o.dead
                            + shred * bristle);
      const k = i * cols + j;
      const c = Math.cos(th), sn = Math.sin(th);
      pos[k * 3] = pts[i].x + nor[i].x * c * r + bin[i].x * sn * r;
      pos[k * 3 + 1] = pts[i].y + nor[i].y * c * r + bin[i].y * sn * r;
      pos[k * 3 + 2] = pts[i].z + nor[i].z * c * r + bin[i].z * sn * r;
      uv[k * 2] = j / seg * uRep;
      uv[k * 2 + 1] = (s0 + si) / BARK_TILE;
      dead[k] = Math.max(deadBase, o.dead);
      /* Cavity occlusion in the flutes, baked. Without it the trunk is invisible
         whenever it is not in direct sun: the fill in this scene is a broad sky
         dome, a smooth lobed cylinder under a dome shades almost uniformly, and
         the first build's backlit trunk came out as a featureless pale tube. A
         groove four centimetres deep and two wide sees very little of the sky,
         and that is what actually draws the fluting on an overcast or shadow-side
         trunk. */
      const ao = 0.42 + 0.58 * Math.pow(shape, 0.85);
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
  g.setAttribute('color', new THREE.BufferAttribute(vcol, 3));
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

/* Radial segments. The lowest two were 10 and 7, which is a decagon and a
   heptagon — enough to be round at a distance, but these are the branches that
   come nearest the camera and at seven segments a limb has a 51° facet, reads
   as a flat ribbon with a bright top and an abruptly dark underside, and has a
   dead straight silhouette. */
const SEG_BY_DEPTH = [72, 30, 18, 12, 8];
/* Peak-to-trough as a fraction of the mean radius. Twenty percent on the bole
   is measured off photographs of old Utah junipers, not chosen for effect; the
   grooves between the ridges are deep enough to hold shadow all day and that is
   most of what gives the trunk its form at a distance. */
const FLUTE_BY_DEPTH = [0.48, 0.36, 0.24, 0.13, 0.07];
/* Radial amplitude of the bark shredding, as a fraction of radius. Only the
   collar and the stems carry it; on a two-centimetre twig a lifted string would
   be larger than the twig. */
const SHRED_BY_DEPTH = [0.016, 0.011, 0, 0, 0];

export function buildTree(seed) {
  const rand = rng(seed);
  const geoms = [];
  const clumps = [];      // foliage clusters: {p, size, dead}
  const trunkProf = makeProfile(seed + 11, 7, 2);
  const twist = 0.34;     // radians of spiral per metre — about 20 degrees

  const wind = new THREE.Vector3(WIND.x, 0, WIND.y);

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
    const r = Math.hypot(x, z);
    return -0.10 + 0.235 * Math.exp(-Math.pow(r / 0.95, 1.85)) + 0.055;
  }

  /**
   * Grow one limb and recurse. `deadness` in [0,1] is inherited: a limb born in
   * a dead strip is dead, and a dead limb's children are dead too.
   */
  function grow(p0, dir0, len, r0, r1, depth, deadness, s0, prof, twistRate) {
    const nSeg = [16, 11, 8, 6, 5][depth];
    const pts = [p0.clone()];
    const radii = [r0];
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
      const kink = depth >= 2 && deadness > 0.5 ? 2.1 : 1.0;
      d.x += n1 * 0.16 * kink * (1 + depth * 0.35);
      d.z += n2 * 0.16 * kink * (1 + depth * 0.35);
      d.normalize();
      const prev = pts[pts.length - 1];
      const nx = prev.x + d.x * step, ny = prev.y + d.y * step, nz = prev.z + d.z * step;
      const fl = floorAt(nx, nz);
      if (ny < fl) { d.y = Math.max(d.y, 0.02); d.normalize(); }
      pts.push(new THREE.Vector3(nx, Math.max(ny, fl), nz));
      /* Dead limbs taper to a point — a snapped snag, not a rounded stub. */
      const taper = deadness > 0.5 ? Math.pow(1 - t, 0.55) : 1;
      radii.push(mix(r0, r1, Math.pow(t, 0.78)) * mix(1, taper, deadness));
    }

    const seg = SEG_BY_DEPTH[depth];
    geoms.push(limbGeometry(pts, radii, seg, prof, twistRate, s0, FLUTE_BY_DEPTH[depth],
      deadness > 0.5 ? 1 : 0, SHRED_BY_DEPTH[depth]));

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
    /* A snag keeps a fork or two and then stops. Left on the live branching
       rule a dead limb grew a full four-level subtree, which spent triangles on
       twigs nothing hangs from and pushed a bare spike three metres clear of
       the crown instead of the half metre that reads as a snag. */
    const nSide = deadness > 0.5
      ? (depth <= 1 ? 1 : 0)
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
        const pDead = depth === 0 ? (inStrip > 0.45 ? 0.9 : 0.03)
                    : 0.05 + 0.22 * expo + 0.02 * depth;
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
  const COLLAR = 0.30;
  const nT = 8;
  const tp = [], tr = [];
  const lean = new THREE.Vector3(wind.x, 0, wind.z).multiplyScalar(0.05);
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    const y = t * COLLAR;
    tp.push(new THREE.Vector3(lean.x * t * t, y, lean.z * t * t));
    /* Root flare: the collar swells hard at the ground, which is also what
       buries it into the hummock convincingly. */
    const flare = 1 + 0.62 * Math.exp(-y / 0.20) + 0.20 * Math.exp(-y / 0.62);
    tr.push(mix(0.375, 0.330, Math.pow(t, 0.8)) * flare);
  }
  geoms.push(limbGeometry(tp, tr, SEG_BY_DEPTH[0], trunkProf, twist, 0,
                          FLUTE_BY_DEPTH[0], 0, SHRED_BY_DEPTH[0]));

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
  for (let i = 0; i < 2; i++) {
    const az = 1.4 + i * 2.9 + rand() * 0.8;
    const dir = new THREE.Vector3(Math.cos(az), 0.13 + rand() * 0.10, Math.sin(az)).normalize();
    grow(tp[Math.round(nT * 0.55)].clone(), dir, 1.00 + rand() * 0.32,
         0.115, 0.052, 1, 0, 0, makeProfile(seed + 900 + i, 5, 1), twist * 1.5);
  }

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

function foliageGeometry(clumps, seed) {
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

    const L = cl.size * (cl.interior ? 1.5 : 2.5);
    const nCards = Math.round(3 + cl.size * 11 + rand() * 2);
    /* The spray's own centre, for the shading normal: a point inside the fan
       rather than at its foot, so the sphere normal still curves the right way. */
    cen.copy(cl.p).addScaledVector(ax, L * 0.42);

    for (let k = 0; k < nCards; k++) {
      /* Biased toward the base, where a real fan carries most of its mass. */
      const t = Math.pow((k + rand()) / nCards, 0.72);
      /* Cone radius: widest at a third, closing to nothing at the point. */
      const rad = cl.size * 0.80 * Math.sin(Math.PI * Math.pow(t, 0.62)) * (0.55 + 0.45 * rand());
      const roll = rand() * TAU;
      const s = cl.size * (0.92 - 0.52 * t) * (0.78 + rand() * 0.44);
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
      const u0 = cu + 0.004, u1 = cu + 0.496;
      const v0 = cv + 0.004, v1 = cv + 0.496;

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
        const f = clamp(0.46 + 0.54 * amb, 0.44, 1);
        vcol.push(f, f, f);
        vsun.push(clamp(0.04 + 0.96 * sun * (0.35 + 0.65 * amb), 0.03, 1));
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
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughness: 1.0,
    metalness: 0.0,
    vertexColors: true,     // flute cavity occlusion, baked
    dithering: true,
  });
  /*
   * Living bark against bleached deadwood, and the size of the gap between them
   * is the whole point.
   *
   * The first build set the dead colour to 0.300 linear and the live multiplier
   * to 1.00 on a bark map averaging about 0.20 — so the deadwood came out within
   * about fifteen percent of the living bark's value. The mechanism was fully
   * implemented and completely invisible; a reviewer found the strip only by
   * brightening the image three times and counting flutes. Photographs of
   * weathered juniper put the ratio at **three to four times**, not fifteen
   * percent: silver-grey heartwood at 0.70–0.75 linear against dark fibrous bark
   * at 0.18–0.20. That is a value difference you can see from across a wash, and
   * it is the single strongest species cue the tree has.
   *
   * It is also a change of *material*, not just tone, so three channels move
   * together: albedo (below), roughness (deadwood is polished by grit and rain
   * where bark is shaggy), and normal strength (the shredded relief belongs to
   * the bark and must not survive on to the bare wood).
   */
  const u = {
    uLiveCol: { value: new THREE.Color(0.92, 0.82, 0.74) },
    uDeadCol: { value: new THREE.Color(0.760, 0.735, 0.680) },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aDead;\nvarying float vDead;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvDead = aDead;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying float vDead;\nuniform vec3 uLiveCol;\nuniform vec3 uDeadCol;')
      .replace('#include <map_fragment>', /* glsl */`
        vec4 bt = texture2D( map, vMapUv );
        float g = dot( bt.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        /* Deadwood: the fibre detail is gone, the long grain remains, and the
           whole thing is lifted and cooled by two decades of ultraviolet. The
           modulation band is deliberately narrow — 0.82 to 1.14 — because bare
           weathered heartwood is *smooth and sinuous*, and letting the bark
           map's contrast through here is what made the strip read as a tonal
           wash over the same shaggy surface rather than as different stuff.
           Weighted mostly to the map's alpha, which carries the long grain. */
        vec3 deadC = uDeadCol * ( 0.82 + 0.32 * mix( pow( g, 0.55 ), bt.a, 0.80 ) );
        diffuseColor.rgb *= mix( bt.rgb * uLiveCol, deadC, vDead );`)
      /* Shaggy lifted strings against wood polished by grit and rain. */
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = roughness *
          mix( texture2D( normalMap, vNormalMapUv ).a, 0.40, vDead );`)
      /* The shredded relief belongs to the bark, so its normal map has to fall
         away with the dead mask — otherwise the silver strips keep the fibre
         texture of the bark that is no longer on them.
         This one needs the chunk expanded by hand. `onBeforeCompile` hands over
         a shader whose `#include` directives are still unresolved, so replacing
         text that lives *inside* a chunk silently matches nothing and the edit
         appears to do exactly what it did before. Pulling the chunk out of
         `THREE.ShaderChunk`, patching the string, and substituting the whole
         include works, and is checked against the installed three (r180). */
      .replace('#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'mapN.xy *= normalScale;', 'mapN.xy *= normalScale * mix( 1.0, 0.18, vDead );'));
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
    uTrans: { value: new THREE.Color(1.55, 1.22, 0.52) },
    uTransAmt: { value: 1.55 },
    uDirCap: { value: 0.62 },
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
        'uniform float uTransAmt;\nuniform float uDirCap;')
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
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        reflectedLight.directDiffuse *= vSun;
        reflectedLight.directDiffuse =
          uDirCap * ( 1.0 - exp( -reflectedLight.directDiffuse / uDirCap ) );
        reflectedLight.directSpecular *= 0.28 * vSun;`)
      .replace('#include <opaque_fragment>', /* glsl */`
        {
          vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          vec3 V = normalize( vViewPosition );
          float fwd = clamp( -dot( sunV, V ), 0.0, 1.0 );
          float phase = pow( fwd, 4.0 ) * 0.92 + 0.08;
          /* Only the parts of the sheet facing away from the sun transmit;
             the sun-facing side is already lit by the direct term. Added after
             the knee, so the backlit rim is the one thing allowed to be bright. */
          float back = clamp( -dot( normalize( normal ), sunV ) * 0.5 + 0.55, 0.0, 1.0 );
          reflectedLight.directDiffuse +=
            diffuseColor.rgb * uTrans * ( phase * back * uTransAmt );
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'juniper-foliage';
  return mat;
}

/* ── the mound, the litter and the dead grass ──────────────────────────────*/

function hummock(terrain, cx, cz, seed) {
  const rand = rng(seed);
  /* Widened from 2.15 m to reach the drip line of a seven-metre crown. A mound
     that stops well inside the foliage is a mound nobody attributes to the
     tree. */
  const RINGS = 13, SEG = 44, R = 2.85;
  const pos = [], uv = [], idx = [];
  const lobes = [];
  for (let i = 0; i < 5; i++) lobes.push({ a: rand() * TAU, m: 0.5 + rand() * 0.9 });
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    for (let j = 0; j <= SEG; j++) {
      const th = j / SEG * TAU;
      /* An irregular outline: a round mound is a pudding. */
      let sh = 1;
      for (const L of lobes) sh += 0.16 * Math.cos((th - L.a) * L.m * 3.0);
      const r = t * R * sh;
      const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
      const base = terrain.heightAt(x, z);
      /* Trapped sediment: a broad low mound with a steeper shoulder against the
         root flare, plus surface roughness from the litter caught in it. */
      const m = 0.235 * Math.exp(-Math.pow(r / 0.95, 1.85))
              + 0.055 * Math.exp(-Math.pow(r / 2.30, 3.0));
      const grain = 0.026 * fbm(x * 2.6, z * 2.6, 3, 4411) + 0.012 * fbm(x * 7.0, z * 7.0, 2, 4413);
      const edge = 1 - smoothstep(0.80, 1.0, t);
      pos.push(x, base + (m + grain * (0.25 + 0.75 * edge)) * (0.12 + 0.88 * edge) + 0.006, z);
      uv.push(x * 0.85, z * 0.85);
      if (i > 0 && j < SEG) {
        const a = (i - 1) * (SEG + 1) + j, b = a + 1;
        const c = i * (SEG + 1) + j, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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
export function cardTuft(cx, cy, cz, w, h, nCards, rand, arr, cols = 2, rows = 1) {
  const { pos, nrm, uvs, idx } = arr;
  let v = pos.length / 3;
  for (let k = 0; k < nCards; k++) {
    const az = rand() * TAU;
    const lean = (rand() - 0.5) * 0.34;
    const ax = Math.cos(az) * w * 0.5, az2 = Math.sin(az) * w * 0.5;
    const hh = h * (0.7 + rand() * 0.6);
    const ci = (rand() * cols) | 0, ri = (rand() * rows) | 0;
    const u0 = ci / cols + 0.004, u1 = (ci + 1) / cols - 0.004;
    const v0 = ri / rows + 0.004, v1 = (ri + 1) / rows - 0.004;
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
  const y0 = base + 0.10;

  const trunk = new THREE.Mesh(woody, makeBarkMaterial(bark));
  trunk.position.set(JUNIPER_XZ.x, y0, JUNIPER_XZ.z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.name = 'juniper-wood';
  out.push(trunk);

  const fol = new THREE.Mesh(foliageGeometry(clumps, 4242), makeFoliageMaterial(folTex));
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
  for (let i = 0; i < 60; i++) {
    const th = rand() * TAU;
    const dripLine = rand() < 0.45;
    const rr = dripLine ? 1.75 + rand() * 0.95 : 0.40 + rand() * 1.35;
    const bias = 0.5 - 0.5 * (Math.cos(th) * WIND.x + Math.sin(th) * WIND.y);
    /* Duff under the drip line does not care about the wind; wind-piled litter
       cares about nothing else. */
    if (rand() > (dripLine ? 0.72 : 0.26 + 0.74 * bias)) continue;
    const x = JUNIPER_XZ.x + Math.cos(th) * rr, z = JUNIPER_XZ.z + Math.sin(th) * rr;
    const m = 0.235 * Math.exp(-Math.pow(rr / 0.95, 1.85))
            + 0.055 * Math.exp(-Math.pow(rr / 2.30, 3.0));
    const y = terrain.heightAt(x, z) + m - 0.02;
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
