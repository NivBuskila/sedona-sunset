/* Clasts: the gravel, cobbles, stones and boulders lying on the wash floor.
 *
 * These are real geometry, not a texture. A dry riverbed reads as a dry
 * riverbed largely because of the silhouettes and contact shadows of loose
 * stone, and neither survives being painted into an albedo map — especially
 * not in the near-grazing light this scene is lit by.
 *
 * Everything is instanced: four size classes, a few deformed base shapes each,
 * one draw call per shape. Placement is in the wash's own (s, u) frame and the
 * elevation comes from `Terrain.heightAt`, so stones sit on the ground rather
 * than near it.
 */
import * as THREE from 'three';
import { rng, fbm, clamp } from './noise.js';

/** An icosahedron pushed around by noise until it reads as a water-worn clast. */
function clastGeometry(detail, seed, flatten) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.copy(v).normalize();
    /* two scales: overall lumpiness, then facets from the last fracture */
    const lump = fbm(n.x * 1.5 + seed, n.z * 1.5 - seed, 3, (seed * 17) | 0);
    const facet = fbm(n.x * 4.2 - seed, n.y * 4.2 + seed, 2, (seed * 29) | 0);
    v.copy(n).multiplyScalar(1 + lump * 0.30 + facet * 0.12);
    v.y *= flatten;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const CLASSES = [
  { name: 'gravel',  detail: 0, variants: 2, count: 10000, rMin: 0.022, rMax: 0.075, flatten: 0.55, maxSlope: 0.60, uMax: 15, shadow: false },
  { name: 'cobble',  detail: 1, variants: 3, count: 3000,  rMin: 0.060, rMax: 0.165, flatten: 0.50, maxSlope: 0.52, uMax: 15, shadow: true },
  { name: 'stone',   detail: 1, variants: 3, count: 380,   rMin: 0.150, rMax: 0.400, flatten: 0.58, maxSlope: 0.45, uMax: 22, shadow: true },
  { name: 'boulder', detail: 2, variants: 2, count: 70,    rMin: 0.420, rMax: 1.500, flatten: 0.70, maxSlope: 0.58, uMax: 32, shadow: true },
];

const S0 = -12, S1 = 264;

export function buildScatter(terrain, tex) {
  const path = terrain.path;
  const mat = new THREE.MeshStandardMaterial({
    map: tex.pebble.albedo,
    normalMap: tex.pebble.normal,
    roughnessMap: tex.pebble.arm,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(1.1, 1.1),
    dithering: true,
  });

  const meshes = [];
  const q = {};
  const obj = new THREE.Object3D();
  const nrm = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();

  CLASSES.forEach((cl, ci) => {
    const geoms = [];
    for (let v = 0; v < cl.variants; v++) geoms.push(clastGeometry(cl.detail, 1.7 + v * 3.1, cl.flatten));

    const buckets = geoms.map(() => []);
    const rand = rng(90210 + ci * 7717);

    let placed = 0, guard = 0;
    while (placed < cl.count && guard++ < cl.count * 60) {
      const s = S0 + rand() * (S1 - S0);
      /* Bias toward the channel: the flow sorted its load, so the middle of
         the wash is stony and the terraces are comparatively bare. */
      const r = rand() * 2 - 1;
      const u = Math.sign(r) * Math.pow(Math.abs(r), 1.7) * cl.uMax;

      path.posAt(s, pos);
      const th = path.headingAt(s);
      const x = pos.x + u * Math.cos(th);
      const z = pos.z + u * Math.sin(th);

      path.atZ(z, q);
      const y = terrain.heightAtQ(x, z, q);

      /* local surface normal by finite difference, so stones bed into slopes */
      const e = Math.max(0.14, cl.rMax * 0.7);
      const hx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
      const hz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
      nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
      if (1 - nrm.y > cl.maxSlope) continue;

      /* Density mask at two scales: broad reaches that are stony versus
         reaches that are swept bare, and metre-scale clumping within them.
         An even sprinkle is the tell that stones were placed by a loop. */
      const dens = (0.5 + 0.5 * fbm(x * 0.045, z * 0.045, 3, 611))
                 * (0.35 + 0.85 * (0.5 + 0.5 * fbm(x * 0.30, z * 0.30, 2, 617)));
      if (rand() > clamp(dens * 1.55 - 0.30, 0.02, 1)) continue;

      const rad = cl.rMin + Math.pow(rand(), 2.1) * (cl.rMax - cl.rMin);
      /* half-buried, so nothing floats and nothing sits on a pedestal */
      const sink = rad * (0.24 + rand() * 0.34);

      quat.setFromUnitVectors(up, nrm);
      spin.setFromAxisAngle(up, rand() * Math.PI * 2);
      quat.multiply(spin);
      euler.set((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5);
      tilt.setFromEuler(euler);
      quat.multiply(tilt);

      buckets[placed % cl.variants].push({
        x, y: y - sink, z,
        qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w,
        sx: rad * (0.82 + rand() * 0.44),
        sy: rad * (0.72 + rand() * 0.40),
        sz: rad * (0.82 + rand() * 0.44),
        tint: 0.60 + rand() * 0.42,
        warm: 0.90 + rand() * 0.20,
      });
      placed++;
    }

    const col = new THREE.Color();
    buckets.forEach((list, vi) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geoms[vi], mat, list.length);
      im.castShadow = cl.shadow;
      im.receiveShadow = true;
      im.name = `${cl.name}_${vi}`;
      list.forEach((o, i) => {
        obj.position.set(o.x, o.y, o.z);
        obj.quaternion.set(o.qx, o.qy, o.qz, o.qw);
        obj.scale.set(o.sx, o.sy, o.sz);
        obj.updateMatrix();
        im.setMatrixAt(i, obj.matrix);
        col.setRGB(o.tint * o.warm, o.tint * (0.94 + (o.warm - 1) * 0.5), o.tint * 0.90);
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      meshes.push(im);
    });
  });

  return meshes;
}
