/* A simple procedural walker figure for the top-down view. Built from
 * primitives in code — no models, no textures — so it keeps the project's
 * zero-asset claim intact. A dusty-clothed hiker: boots, trousers, shirt,
 * head and a hat brim, about 1.72 m tall, origin at the soles.
 *
 * The limbs swing from pivot groups so the walk can be animated with two
 * sine phases; update() takes the player's planar speed and advances the
 * gait phase from it, so the stride rate follows walking, jogging and the
 * turbo cheat without any extra wiring.
 */
import * as THREE from 'three';

export function buildCharacter() {
  const group = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xb08a6a, roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x6d7b8a, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.95 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.95 });
  const hat = new THREE.MeshStandardMaterial({ color: 0x8a7358, roughness: 0.9 });

  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* torso: 0.86 → 1.42 m */
  add(group, new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), shirt, 0, 1.14, 0);
  /* head + hat: crown at ~1.72 m */
  add(group, new THREE.SphereGeometry(0.115, 12, 10), skin, 0, 1.56, 0);
  add(group, new THREE.CylinderGeometry(0.2, 0.2, 0.025, 12), hat, 0, 1.63, 0);
  add(group, new THREE.CylinderGeometry(0.1, 0.115, 0.1, 12), hat, 0, 1.68, 0);

  /* legs pivot at the hip (0.9 m), arms at the shoulder (1.4 m) */
  const limb = (mat, px, py, r, len, footMat) => {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    add(pivot, new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, -(len / 2 + r), 0);
    if (footMat) add(pivot, new THREE.BoxGeometry(0.11, 0.09, 0.24), footMat, 0, -(len + 2 * r), 0.05);
    group.add(pivot);
    return pivot;
  };
  const legL = limb(pants, -0.095, 0.9, 0.075, 0.62, boot);
  const legR = limb(pants, 0.095, 0.9, 0.075, 0.62, boot);
  const armL = limb(shirt, -0.235, 1.38, 0.055, 0.52);
  const armR = limb(shirt, 0.235, 1.38, 0.055, 0.52);

  let phase = 0;

  return {
    group,
    /** Place at the player's feet, face the yaw, swing the gait by speed. */
    update(x, y, z, yaw, speed, dt) {
      group.position.set(x, y, z);
      group.rotation.y = -yaw;
      if (speed > 0.05) {
        phase += dt * speed * 4.4;
        const s = Math.sin(phase) * Math.min(0.6, 0.25 + speed * 0.1);
        legL.rotation.x = s; legR.rotation.x = -s;
        armL.rotation.x = -s * 0.7; armR.rotation.x = s * 0.7;
      } else {
        /* snap to rest — a decaying swing never arrives, and determinism
           elsewhere in this project depends on rest being a fixed point */
        phase = 0;
        legL.rotation.x = legR.rotation.x = 0;
        armL.rotation.x = armR.rotation.x = 0;
      }
    },
  };
}
