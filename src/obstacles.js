/* The obstacle course.
 *
 * A set of stations laid along the wash in the path's own (s, u) frame — arc
 * length up the wash and signed lateral offset — so that every obstacle sits on
 * the route the donkey actually walks and none of it needs world coordinates.
 * Everything here is, like the rest of the scene, generated: bleached deadwood
 * trunks to hop, sandstone boulders to steer between, and stacked-stone cairns
 * marking the slalom.
 *
 * Two kinds of solid, and the height of each is what the course is made of:
 *   · a LOW log (top ≈ 0.27 m) sits under the 0.45 m jump apex — hop it;
 *   · everything else stands above it — go round.
 * The collision therefore reads `player.y`: an airborne body whose feet are
 * above an obstacle's top passes, everything else is pushed back out along the
 * contact normal with its inward velocity removed. Like `confine`, it is
 * identically inert when nothing overlaps, so the loop stays a fixed point at
 * rest and the capture harness is untouched.
 */
import * as THREE from './three.js';
import { rng } from './noise.js';
import { deadTex } from './plantex.js';

/* How wide the donkey is for the purposes of squeezing past a boulder. */
const BODY_R = 0.45;
/* Metres a frame may push the body back out of a solid it has entered. */
const RESTORE = 6.0;

/* ── the course ───────────────────────────────────────────────────────────
 * s      arc length from the start of the walk
 * u      lateral offset, + to the walker's right
 * Kinds:
 *   log     { s, u0, u1, r }           trunk lying across the wash from u0 to u1
 *   rock    { s, u, r }                one boulder
 *   cairn   { s, u }                   stacked stones, a marker post
 *   row     { s, gap, gapW, u0, u1 }   a line of boulders with one gap at `gap`
 *   field   { s0, s1, n, seed }        boulders strewn at random
 *   chute   { s0, s1, w }              boulders lining a lane `w` wide
 */
const COURSE = [
  /* 1. A first fence: one low trunk, the invitation to press Space. */
  { kind: 'log', s: 26, u0: -7.5, u1: 7.5, r: 0.14 },
  /* 2. A gate: two big boulders, squeeze through the middle. */
  { kind: 'rock', s: 48, u: -2.4, r: 1.35 }, { kind: 'rock', s: 48, u: 2.4, r: 1.35 },
  { kind: 'rock', s: 48.5, u: -5.6, r: 1.6 }, { kind: 'rock', s: 47.5, u: 5.6, r: 1.6 },
  { kind: 'rock', s: 49, u: -8.6, r: 1.5 }, { kind: 'rock', s: 48, u: 8.6, r: 1.5 },
  /* 3. Double hop: two trunks a stride apart, past the juniper. */
  { kind: 'log', s: 84, u0: -8, u1: 8, r: 0.14 },
  { kind: 'log', s: 87.5, u0: -8, u1: 8, r: 0.13 },
  /* 4. Slalom: three rows of boulders, the gap swapping sides each time, with
        a cairn marking where to aim. */
  { kind: 'row', s: 112, gap: -3.0, gapW: 2.6, u0: -9, u1: 9 }, { kind: 'cairn', s: 112, u: -3.0 - 1.9 },
  { kind: 'row', s: 121, gap: 3.0, gapW: 2.6, u0: -9, u1: 9 }, { kind: 'cairn', s: 121, u: 3.0 + 1.9 },
  { kind: 'row', s: 130, gap: -3.0, gapW: 2.6, u0: -9, u1: 9 }, { kind: 'cairn', s: 130, u: -3.0 - 1.9 },
  /* 5. A boulder field: pick a line through it. */
  { kind: 'field', s0: 160, s1: 192, n: 22, seed: 7 },
  /* 6. The chute: a lane the width of a donkey and a half, for twelve metres. */
  { kind: 'chute', s0: 222, s1: 234, w: 1.9 },
  /* 7. Last fence before the headwall: a trunk with a hop in it, then home. */
  { kind: 'log', s: 262, u0: -8, u1: 8, r: 0.14 },
  { kind: 'cairn', s: 268, u: -2.2 }, { kind: 'cairn', s: 268, u: 2.2 },
];

/* Expand the compound stations into plain solids. */
function expand(course) {
  const out = [];
  for (const o of course) {
    switch (o.kind) {
      case 'log': case 'rock': case 'cairn': out.push(o); break;
      case 'row': {
        const R = 0.95;
        for (let u = o.u0; u <= o.u1; u += R * 1.75) {
          if (Math.abs(u - o.gap) < o.gapW / 2 + R * 0.6) continue;
          out.push({ kind: 'rock', s: o.s + ((u * 7.3) % 1) * 0.5, u, r: R * (0.85 + ((u * 3.7) % 1) * 0.3) });
        }
        break;
      }
      case 'field': {
        const rand = rng(o.seed);
        for (let i = 0; i < o.n; i++) {
          out.push({ kind: 'rock', s: o.s0 + rand() * (o.s1 - o.s0),
                     u: (rand() * 2 - 1) * 8.5, r: 0.7 + rand() * 0.6 });
        }
        break;
      }
      case 'chute': {
        for (let s = o.s0; s <= o.s1; s += 1.7) {
          const w = ((s * 1.31) % 1) * 0.25;
          out.push({ kind: 'rock', s, u: -(o.w / 2 + 0.9 + w), r: 0.9 });
          out.push({ kind: 'rock', s: s + 0.8, u: o.w / 2 + 0.9 + w, r: 0.9 });
          out.push({ kind: 'rock', s: s + 0.4, u: -(o.w / 2 + 2.6 + w), r: 1.1 });
          out.push({ kind: 'rock', s: s + 1.2, u: o.w / 2 + 2.6 + w, r: 1.1 });
        }
        break;
      }
    }
  }
  return out;
}

/* ── geometry ─────────────────────────────────────────────────────────── */

/* A boulder: an icosphere with its vertices pushed about by a couple of octaves
   of hashed noise, flattened a little so it reads as sitting rather than
   floating. */
function boulderGeometry(r, seed) {
  const g = new THREE.IcosahedronGeometry(r, 3);
  const p = g.attributes.position;
  const rand = rng(seed);
  const a = rand() * 6.28, b = rand() * 6.28, c = rand() * 6.28;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const w = 1 + 0.16 * Math.sin(n.x * 3.1 + a) * Math.cos(n.y * 2.7 + b)
                + 0.09 * Math.sin(n.z * 5.3 + c + n.x * 4.1)
                + 0.04 * Math.sin(n.x * 11 + n.y * 9 + a * 2);
    v.multiplyScalar(w);
    v.y *= 0.82;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function makeRockMaterial(tex) {
  return new THREE.MeshStandardMaterial({
    map: tex.rock.albedo,
    normalMap: tex.rock.normal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: tex.rock.arm,
    aoMap: tex.rock.arm,
    /* Hematite sandstone, a little darker than the cliffs: these have sat in
       the shade of the wash and carry its dust. */
    color: new THREE.Color(0.62, 0.30, 0.20),
    roughness: 1.0, metalness: 0.0, dithering: true,
  });
}

function makeLogMaterial() {
  const dead = deadTex();
  return new THREE.MeshStandardMaterial({
    map: dead.albedo,
    normalMap: dead.normal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    color: new THREE.Color(0.86, 0.80, 0.70),
    roughness: 0.95, metalness: 0.0, dithering: true,
  });
}

/**
 * Build the course. Returns `{ meshes, collide }`.
 * @param {import('./path.js').WashPath} path
 * @param {{heightAt:(x:number,z:number)=>number}} terrain
 */
export function buildObstacles(path, terrain, tex) {
  const solids = expand(COURSE);
  const rockMat = makeRockMaterial(tex);
  const logMat = makeLogMaterial();
  const meshes = [];
  const colliders = [];

  const p = new THREE.Vector3();
  const world = (s, u) => {
    path.posAt(s, p);
    const th = path.headingAt(s);
    return { x: p.x + Math.cos(th) * u, z: p.z + Math.sin(th) * u, th };
  };

  let seed = 11;
  for (const o of solids) {
    if (o.kind === 'rock') {
      const w = world(o.s, o.u);
      const y = terrain.heightAt(w.x, w.z);
      const m = new THREE.Mesh(boulderGeometry(o.r, seed++), rockMat);
      m.position.set(w.x, y + o.r * 0.55, w.z);
      m.rotation.y = (seed * 1.7) % 6.28;
      m.castShadow = m.receiveShadow = true;
      meshes.push(m);
      colliders.push({ type: 'disc', x: w.x, z: w.z, r: o.r * 0.9, top: y + o.r * 1.3 });
    } else if (o.kind === 'cairn') {
      const w = world(o.s, o.u);
      let y = terrain.heightAt(w.x, w.z);
      const g = new THREE.Group();
      const stones = 5;
      for (let i = 0; i < stones; i++) {
        const r = 0.46 - i * 0.065;
        const m = new THREE.Mesh(boulderGeometry(r, seed++), rockMat);
        m.scale.y = 0.55;
        m.position.set((i % 2 ? 0.04 : -0.03), y + r * 0.5, (i % 3 ? 0.03 : -0.04));
        m.rotation.y = i * 1.9;
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        y += r * 0.78;
      }
      g.position.set(w.x, 0, w.z);
      meshes.push(g);
      colliders.push({ type: 'disc', x: w.x, z: w.z, r: 0.45, top: y });
    } else if (o.kind === 'log') {
      const a = world(o.s, o.u0), b = world(o.s, o.u1);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      /* The trunk follows the bed: rest each end on its own ground and let the
         middle sag onto the sand. */
      const ya = terrain.heightAt(a.x, a.z) + o.r, yb = terrain.heightAt(b.x, b.z) + o.r;
      const g = new THREE.CylinderGeometry(o.r * 0.8, o.r * 1.1, len, 14, 1);
      g.rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(g, logMat);
      m.position.set((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2);
      m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      m.rotation.z = Math.atan2(yb - ya, len);
      m.castShadow = m.receiveShadow = true;
      meshes.push(m);
      colliders.push({ type: 'seg', ax: a.x, az: a.z, bx: b.x, bz: b.z, r: o.r,
                       top: Math.max(ya, yb) + o.r * 0.95 });
    }
  }

  /**
   * One frame of collision against the course. Runs after the position
   * integrate and before the ground clamp, on the hooves' position. Mutates
   * `player.x`, `player.z`, `player.vx`, `player.vz`. Returns how many solids
   * engaged, for a probe.
   */
  function collide(player, dt) {
    let hits = 0;
    for (const c of colliders) {
      /* Feet above the top: clearing it. A trunk is also cleared by any hop —
         the body leaves the ground low and rises through the trunk's height
         over the first tenth of a second, and catching it on the way up would
         make every hop from the fence line a stumble. */
      if (player.y >= c.top - 0.02 || (c.type === 'seg' && player.air)) continue;
      let nx, nz, d, reach;
      if (c.type === 'disc') {
        nx = player.x - c.x; nz = player.z - c.z;
        d = Math.hypot(nx, nz); reach = c.r + BODY_R;
        if (d >= reach) continue;
        /* Cheap broadphase for the far ones is not needed at this count. */
      } else {
        const ex = c.bx - c.ax, ez = c.bz - c.az;
        const L2 = ex * ex + ez * ez;
        let t = ((player.x - c.ax) * ex + (player.z - c.az) * ez) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        nx = player.x - (c.ax + ex * t); nz = player.z - (c.az + ez * t);
        /* Tighter than the body radius on purpose: a hop's feet are above the
           trunk for only ~0.4 s, so the strip that has to be cleared airborne
           must be short enough to cross in that time at a walk. */
        d = Math.hypot(nx, nz); reach = c.r + 0.12;
        if (d >= reach) continue;
      }
      if (d < 1e-4) { nx = 1; nz = 0; d = 1; }
      nx /= d; nz /= d;
      const vIn = player.vx * nx + player.vz * nz;
      if (vIn < 0) { player.vx -= vIn * nx; player.vz -= vIn * nz; }
      const back = Math.min(reach - d, RESTORE * dt);
      player.x += nx * back;
      player.z += nz * back;
      hits++;
    }
    return hits;
  }

  return { meshes, collide, count: colliders.length };
}
