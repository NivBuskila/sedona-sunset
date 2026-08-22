/* Which clast class is the pale flat plate in the near field, offline.
 *
 * The playthrough ranks "dozens of flat olive-grey plates strewn across the bed
 * at wrong angles" as the most attention-breaking element in the first hundred
 * metres, and the colour is said not to belong to this rock. Every part of that
 * is decidable without a renderer: `buildScatter` is pure CPU, it runs in about
 * six seconds, and it writes the per-instance albedo with `setColorAt` and the
 * seat and tilt into the instance matrix. So the class, the colour, the dip and
 * the burial can all be read straight out of the built scene.
 *
 * Written because the machine is being played on and a capture would cost the
 * user frames and return nothing - the GPU marker is off, so the page falls back
 * to software rasterisation and does not boot inside the timeout. It is also the
 * better instrument regardless: `_pixowner.mjs` names the mesh that drew a pixel
 * and this names every candidate instance with the numbers that decide which one
 * is the defect, which is the distinction that cost this project a night.
 *
 * For each class near a station: instance count, mean albedo, how far off red the
 * albedo sits, the dip of the plate's own axis, and the seat - the height of the
 * instance origin above the terrain it stands on. A plate reads as floating when
 * that number is positive and as bedded when it is negative.
 *
 *   node tools/_slabwho.mjs 30 15
 */
import * as THREE from 'three';
globalThis.location = { hash: '' };
const { WashPath } = await import('../src/path.js');
const { Terrain } = await import('../src/terrain.js');
const { buildScatter } = await import('../src/scatter.js');

/* Reported over a *run* of the walk rather than a radius about one station,
   because the complaint is "in the first hundred metres" and because the thing
   being looked for is a tail: at a 15 m radius every class's mean albedo comes
   back in the red family at hue 14-20 deg, which is true and useless. A mean
   cannot see the bottom of a distribution - the same reason `_crush.mjs` had to
   exist - and a handful of pale plates among nine thousand red granules is
   exactly a tail. */
const S1 = Number(process.argv[2] ?? 100);     // report over s in [0, S1]
const R = Number(process.argv[3] ?? 14);       // half-width either side of the centreline

/* What the eye is calling "olive-grey" and "cream". The local red family runs
   hue 18-21 deg at saturation 0.60-0.68; every pale entry in `LITH` sits at hue
   28-34 deg and saturation 0.38-0.49, so one threshold separates them cleanly
   and it is the saturation rather than the hue that does the work. */
const PALE_SAT = 0.52;

const path = new WashPath(), terrain = new Terrain(path);
/* Centreline samples every two metres over the reported run, so "near the walk"
   is distance to the path rather than to one eye position. */
const line = [];
for (let s = 0; s <= S1; s += 2) line.push(path.posAt(s).clone());
const nearWalk = (x, z) => {
  let best = 1e9;
  for (const q of line) {
    const dd = Math.hypot(x - q.x, z - q.z);
    if (dd < best) best = dd;
  }
  return best;
};

const oneTexel = { image: { data: new Uint8Array([128, 96, 72, 255]) } };
const tex = {
  rock: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  dirt: { albedo: oneTexel }, clast: { albedo: oneTexel, normal: oneTexel, arm: oneTexel },
  macro: oneTexel, variance: oneTexel, grit: oneTexel,
};
const meshes = buildScatter(terrain, tex);

/* Rock's own near-field instanced geometry, included so that "these are not
   mine" is a measurement rather than an assertion. `buildTalus` places blocks
   against the wall toe and its reach is capped, but the whole lesson of the last
   round was that pixel attribution has to be checked and not reasoned about, and
   the same applies to attribution by memory of one's own code. */
const { buildTalus } = await import('../src/rock.js');
try {
  for (const t of buildTalus(path, terrain, { userData: { tex } })) {
    if (t && (t.isInstancedMesh || t.isMesh)) meshes.push(t);
  }
} catch (e) {
  console.log(`  (talus not built: ${e && e.message})`);
}

/* Hue of the mean albedo, in degrees, on the same convention CONTRACT.md quotes
   for rock: the local red family runs 18-21 deg and anything the eye calls olive
   or cream has either collapsed saturation or climbed toward yellow. */
function hueSat([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  let h = 0;
  if (c > 1e-6) {
    if (mx === r) h = ((g - b) / c) % 6;
    else if (mx === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx > 1e-6 ? c / mx : 0, v: mx };
}

const m = new THREE.Matrix4(), pos = new THREE.Vector3();
const q = new THREE.Quaternion(), sc = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3();
const col = new THREE.Color();
const rows = [];

const plates = [];
const dustOf = (im, i) => {
  const a = im.geometry.getAttribute('aDust');
  return a ? a.getX(i) : 0;
};

for (const im of meshes) {
  if (!im.isInstancedMesh) continue;
  const n = im.count ?? im.instanceMatrix.count;
  let hit = 0, dipS = 0, seatS = 0, flatS = 0, pale = 0, dustS = 0;
  const rgb = [0, 0, 0];
  let seatMax = -1e9;
  for (let i = 0; i < n; i++) {
    im.getMatrixAt(i, m);
    pos.setFromMatrixPosition(m);
    if (nearWalk(pos.x, pos.z) > R) continue;
    hit++;
    m.decompose(pos, q, sc);
    dustS += dustOf(im, i);
    /* The plate's own axis. `angularClast` squashes local Y by `flat`, so local
       +Y is the pole of a platy clast and its dip off vertical is the angle the
       plate lies at. Zero is lying flat, ninety is stood on edge. */
    ax.copy(up).applyQuaternion(q);
    dipS += (Math.acos(Math.min(1, Math.abs(ax.dot(up)))) * 180) / Math.PI;
    /* Seat: instance origin against the ground under it. Positive is a clast
       whose centre is above the surface, which for a thin plate is the floating
       read the playthrough describes. */
    const gy = terrain.heightAt(pos.x, pos.z);
    const seat = pos.y - gy;
    seatS += seat;
    if (seat > seatMax) seatMax = seat;
    /* Aspect of the hull as instanced: the smallest scale over the largest is how
       plate-like the thing actually is once its per-instance scaling is applied. */
    flatS += Math.min(sc.x, sc.y, sc.z) / Math.max(sc.x, sc.y, sc.z);
    if (im.instanceColor) {
      col.fromBufferAttribute(im.instanceColor, i);
      rgb[0] += col.r; rgb[1] += col.g; rgb[2] += col.b;
      const hs = hueSat([col.r, col.g, col.b]);
      /* Value as well as saturation, because saturation alone conflates the two
         opposite ends of the palette: the desert-varnished dark pebble sits at
         hue 22.9 and saturation 0.31 and is the *darkest* thing on the floor,
         while the cream limestone sits at hue 29.5 and saturation 0.43. Both are
         desaturated; only one of them is what anybody means by a pale slab. */
      if (hs.s < PALE_SAT && hs.h > 26 && hs.v > 0.30) {
        pale++;
        /* The two long axes, which is the silhouette the eye stops on. A pale
           granule is invisible and a pale paving stone is the defect, so the
           tail has to be reported with its size attached. */
        const ss = [sc.x, sc.y, sc.z].sort((a, b) => b - a);
        plates.push({ name: im.name, w: ss[0], l: ss[1], t: ss[2],
          dip: (Math.acos(Math.min(1, Math.abs(ax.dot(up)))) * 180) / Math.PI,
          seat: pos.y - terrain.heightAt(pos.x, pos.z),
          dust: dustOf(im, i), s: hs.s, h: hs.h, v: hs.v });
      }
    }
  }
  if (!hit) continue;
  const mean = rgb.map((v) => v / hit);
  const { h, s, v } = hueSat(mean);
  rows.push({ name: im.name, n: hit, of: n, pale, dust: dustS / hit,
    dip: dipS / hit, seat: seatS / hit, seatMax, flat: flatS / hit,
    rgb: mean, h, s, v });
}

rows.sort((a, b) => b.pale - a.pale);
console.log(`s 0..${S1} m, within ${R} m of the centreline    pale = albedo saturation < ${PALE_SAT}`);
console.log('mesh            near  of total   pale   pale%   dip  aspect    seat   dust   mean albedo        hue    sat');
for (const r of rows) {
  console.log(`${r.name.padEnd(14)} ${String(r.n).padStart(5)} ${String(r.of).padStart(8)}  `
    + `${String(r.pale).padStart(5)}  ${(100 * r.pale / r.n).toFixed(1).padStart(5)}%  `
    + `${r.dip.toFixed(1).padStart(5)}  ${r.flat.toFixed(2).padStart(5)}  `
    + `${r.seat.toFixed(3).padStart(6)}  ${r.dust.toFixed(2).padStart(5)}   `
    + `${r.rgb.map((q2) => q2.toFixed(3)).join(' ')}   `
    + `${r.h.toFixed(1).padStart(5)} ${r.s.toFixed(3)}`);
}

/* The individual objects, biggest silhouette first. This is the list the
   playthrough was looking at. */
plates.sort((a, b) => b.w * b.l - a.w * a.l);
console.log(`\n${plates.length} pale instances in that run; the twenty largest by silhouette:`);
console.log('mesh            w x l x t (m)          dip    seat    dust    hue    sat    val');
for (const p of plates.slice(0, 20)) {
  console.log(`${p.name.padEnd(14)} ${p.w.toFixed(2)} x ${p.l.toFixed(2)} x ${p.t.toFixed(2)}   `
    + `${p.dip.toFixed(1).padStart(5)}  ${p.seat.toFixed(3).padStart(6)}  `
    + `${p.dust.toFixed(2).padStart(5)}  ${p.h.toFixed(1).padStart(5)}  `
    + `${p.s.toFixed(3)}  ${p.v.toFixed(3)}`);
}
