/* The walker — the one figure in the scene, seen from behind and above.
 *
 * The top-down camera changed what this thing has to be. In the first-person
 * build there was no body at all; now a figure sits in the middle of every
 * frame at about nine metres, which is close enough that it is the only object
 * in the scene the eye reads as *anatomy* rather than as landscape. Landscape
 * forgives a wrong proportion and a figure does not, so this is built from a
 * measured skeleton rather than from primitives stacked to look about right.
 *
 * Four things make a walking figure read, and none of them is polygon count:
 *
 * **Limbs are elliptical in section, and they taper.** Same argument juniper.js
 * makes about the fluted trunk: a capsule is a pipe, and a pipe is recognisable
 * as a pipe from any distance at which the silhouette is more than a few pixels
 * wide. A thigh is roughly 1.35 times as wide as it is deep and loses a third of
 * its girth between hip and knee; a forearm reverses that near the wrist. Every
 * segment here is a swept ellipse with its own profile.
 *
 * **The skeleton is jointed at the knee and the elbow.** A leg that swings from
 * the hip as one rigid rod is the single clearest tell of a cheap walk cycle,
 * because the foot then travels on a circle and visibly scythes through the
 * ground. Two-segment legs with real knee flexion are what let the foot come up
 * and over.
 *
 * **The pelvis and the chest counter-rotate.** Walking is not a leg animation.
 * The pelvis rotates toward the swinging leg, rolls onto the stance hip, rises
 * twice per stride and sways laterally once; the chest turns the other way and
 * the head holds still against both. Bolting the swing onto a rigid torso is why
 * so many walks look like marching.
 *
 * **Proportions are anthropometric.** The table below is a 1.74 m adult with the
 * origin at the soles, in metres, so the figure stands correctly against a
 * 1.65 m eye height and a 45 cm jump and reads at the right scale beside a
 * juniper and a canyon wall.
 *
 * What is deliberately *not* here: there is no foot IK, so the planted foot
 * slips against the ground rather than being pinned to it. At this camera
 * distance and with the gait phase driven from real speed the slip is small, but
 * it is a real limitation and it is the next thing worth building, not something
 * that was overlooked.
 *
 * Cost: fifteen meshes, about 4.6 k triangles, against a frame that carries
 * 3.97 M and 55–70 draw calls. The figure is articulated, so the segments cannot
 * be merged into one draw without a skinned mesh; fifteen calls was measured as
 * the cheaper trade against the bone setup.
 */
import * as THREE from 'three';
import { clamp, mix, smoothstep } from './noise.js';
import { shirtTex, trouserTex, skinTex, leatherTex, feltTex } from './chartex.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* ── anthropometry, metres, origin at the soles ────────────────────────── */

const M = {
  height: 1.74,
  ankle: 0.075,
  knee: 0.475,
  hip: 0.925,
  waist: 1.105,
  shoulder: 1.445,
  neck: 1.500,
  crown: 1.740,
  hipHalf: 0.098,        // hip joint offset from the midline
  shoulderHalf: 0.183,   // shoulder joint offset
  thigh: 0.450,
  shank: 0.400,
  upperArm: 0.295,
  foreArm: 0.275,
};

/* ── swept-ellipse segment ─────────────────────────────────────────────────
 *
 * Builds a limb or a trunk hanging along local −Y from the joint at the origin,
 * so a pivot group's rotation.x is directly the joint angle. `profile(t)` gives
 * the half-width and half-depth at fraction t of the length; returning a radius
 * at or near zero at either end closes that end into a point, which is how the
 * rounded ends are made without a separate cap primitive.
 */
function sweep(len, profile, along = 12, radial = 14, vRepeat = 1) {
  const pos = [], uv = [], idx = [];
  const r = [0, 0];
  for (let i = 0; i <= along; i++) {
    const t = i / along;
    profile(t, r);
    const y = -t * len;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      pos.push(Math.cos(a) * r[0], y, Math.sin(a) * r[1]);
      uv.push(j / radial, t * vRepeat);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = a + ring;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ellipse profile that tapers linearly from (w0,d0) to (w1,d1), with the ends
    rounded off over `cap` of the length so nothing terminates in a flat disc. */
function taper(w0, d0, w1, d1, cap = 0.10) {
  return (t, out) => {
    const w = mix(w0, w1, t);
    const d = mix(d0, d1, t);
    /* round both ends: scale the section down by a quarter-ellipse over `cap` */
    const e0 = cap > 0 ? Math.min(1, t / cap) : 1;
    const e1 = cap > 0 ? Math.min(1, (1 - t) / cap) : 1;
    const s = Math.sqrt(Math.max(0, 1 - (1 - e0) * (1 - e0))) *
              Math.sqrt(Math.max(0, 1 - (1 - e1) * (1 - e1)));
    out[0] = w * s; out[1] = d * s;
  };
}

function mat(tex, roughness) {
  return new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughness, metalness: 0,
  });
}

export function buildCharacter() {
  const root = new THREE.Group();

  const shirt = mat(shirtTex(), 0.86);
  const trouser = mat(trouserTex(), 0.92);
  const skin = mat(skinTex(), 0.74);
  const leather = mat(leatherTex(), 0.78);
  const felt = mat(feltTex(), 0.94);

  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ── pelvis → chest → head, as a chain so the counter-rotations compose ── */

  const pelvis = new THREE.Group();
  pelvis.position.y = M.hip;
  root.add(pelvis);

  /* hips and seat: short, wide, shallow */
  add(pelvis, sweep(0.20, taper(0.148, 0.108, 0.128, 0.098, 0.16), 6, 14, 1),
      trouser, 0, 0.10, 0);

  const chest = new THREE.Group();
  chest.position.y = M.waist - M.hip;
  pelvis.add(chest);

  /* torso: waist → chest → shoulders. Widens and deepens upward, and the
     shoulder end stays square rather than rounding off, because a rounded top
     on a torso reads as a bottle. */
  add(chest, sweep(M.shoulder - M.waist + 0.06,
                   (t, o) => {
                     /* t runs downward from the shoulders in the swept frame */
                     const u = 1 - t;                       // 0 waist → 1 shoulder
                     o[0] = mix(0.132, 0.196, smoothstep(0.05, 0.85, u));
                     o[1] = mix(0.104, 0.132, smoothstep(0.0, 0.9, u));
                     const cap = 1 - Math.pow(clamp((t - 0.90) / 0.10, 0, 1), 2) * 0.55;
                     o[0] *= cap; o[1] *= cap;
                   }, 10, 16, 1.6),
      shirt, 0, M.shoulder - M.waist + 0.06, 0);

  const neck = new THREE.Group();
  neck.position.y = M.shoulder - M.waist + 0.02;
  chest.add(neck);
  add(neck, sweep(0.10, taper(0.050, 0.046, 0.055, 0.050, 0.05), 4, 10), skin, 0, 0.10, 0);

  const head = new THREE.Group();
  head.position.y = M.neck - M.shoulder + 0.045;
  neck.add(head);
  /* cranium: a sphere is right in plan but far too round in profile, so it is
     scaled — narrow, deep, tall — and the jaw is a second smaller mass set
     forward and down. Local forward is −Z. */
  const skull = add(head, new THREE.SphereGeometry(0.098, 16, 12), skin, 0, 0.075, 0);
  skull.scale.set(0.95, 1.06, 1.02);
  const jaw = add(head, new THREE.SphereGeometry(0.062, 12, 10), skin, 0, 0.018, -0.022);
  jaw.scale.set(0.92, 0.80, 1.05);

  /* the hat: a lathe, brim drooping at the edge the way a worn felt brim does.
     It is the figure's silhouette from directly above, which in this camera is
     most of what there is to see, so it gets the profile rather than a disc. */
  const brim = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, r = mix(0.104, 0.212, t);
    brim.push(new THREE.Vector2(r, -0.004 - t * t * 0.030));
  }
  const crown = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    crown.push(new THREE.Vector2(mix(0.104, 0.074, t) * (1 - Math.pow(t, 6) * 0.9),
                                 mix(0.0, 0.108, t)));
  }
  const hat = new THREE.Group();
  hat.position.y = 0.116;
  head.add(hat);
  add(hat, new THREE.LatheGeometry(brim, 20), felt);
  add(hat, new THREE.LatheGeometry(crown, 20), felt);

  /* ── limbs ─────────────────────────────────────────────────────────────
   *
   * Each limb is hip → knee → foot or shoulder → elbow → hand, with the child
   * pivot sitting at the parent segment's far end so flexion happens at the
   * joint and not at the mesh's midpoint. Sides differ only by sign, so one
   * builder makes both.
   */
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * M.hipHalf, 0, 0);
    pelvis.add(hip);
    /* thigh: widest limb in the figure, and markedly flatter than it is wide */
    add(hip, sweep(M.thigh, taper(0.098, 0.088, 0.070, 0.066, 0.12), 8, 14, 1.4),
        trouser);

    const knee = new THREE.Group();
    knee.position.y = -M.thigh;
    hip.add(knee);
    /* calf: the belly of the muscle sits high and behind, so the profile is not
       a simple taper — it bulges at a fifth of the length and necks hard at the
       ankle, which is what makes a lower leg read as a lower leg */
    add(knee, sweep(M.shank - M.ankle, (t, o) => {
      const bulge = Math.exp(-Math.pow((t - 0.22) / 0.26, 2)) * 0.020;
      o[0] = mix(0.068, 0.036, smoothstep(0, 1, t)) + bulge;
      o[1] = mix(0.070, 0.032, smoothstep(0, 1, t)) + bulge * 1.3;
    }, 9, 14, 1.3), trouser);

    const ankle = new THREE.Group();
    ankle.position.y = -(M.shank - M.ankle);
    knee.add(ankle);
    /* boot: a box is wrong at the toe, so it is swept along −Z with the sole
       flat. Built in its own frame then rotated so the sweep axis lies forward. */
    const bootGeo = sweep(0.275, (t, o) => {
      o[0] = mix(0.052, 0.040, smoothstep(0.45, 1, t)) * (1 - Math.pow(clamp((t - 0.88) / 0.12, 0, 1), 2) * 0.5);
      o[1] = mix(0.062, 0.038, smoothstep(0.1, 1, t));
    }, 8, 12, 1);
    const boot = add(ankle, bootGeo, leather, 0, -M.ankle + 0.052, 0);
    boot.rotation.x = -Math.PI / 2;   // sweep axis −Y → −Z, i.e. forward
    /* sole: a thin slab, because the shadow the boot throws on the wash floor
       is read as a footprint and a rounded toe alone does not give it an edge */
    const sole = add(ankle, new THREE.BoxGeometry(0.098, 0.026, 0.268), leather,
                     0, -M.ankle + 0.013, -0.056);
    sole.receiveShadow = true;

    return { hip, knee, ankle };
  };

  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * M.shoulderHalf, M.shoulder - M.waist - 0.020, 0);
    chest.add(shoulder);
    /* sleeve to just below the elbow, then bare forearm — a rolled sleeve is
       what puts the one bright skin note on the swinging limb */
    add(shoulder, sweep(M.upperArm, taper(0.062, 0.058, 0.049, 0.047, 0.14), 7, 12, 1.2),
        shirt);

    const elbow = new THREE.Group();
    elbow.position.y = -M.upperArm;
    shoulder.add(elbow);
    /* forearm: swells at the extensor mass near the elbow, necks at the wrist */
    add(elbow, sweep(M.foreArm, (t, o) => {
      o[0] = mix(0.048, 0.028, smoothstep(0.1, 0.95, t));
      o[1] = mix(0.046, 0.024, smoothstep(0.1, 0.95, t));
    }, 8, 12, 1.2), skin);
    const hand = add(elbow, new THREE.SphereGeometry(0.036, 10, 8), skin, 0, -M.foreArm - 0.024, 0);
    hand.scale.set(0.80, 1.25, 0.62);

    return { shoulder, elbow };
  };

  const legL = leg(-1), legR = leg(1);
  const armL = arm(-1), armR = arm(1);

  /* ── the gait ──────────────────────────────────────────────────────────
   *
   * One phase variable per stride (two steps), advanced from real speed rather
   * than from time, so the stride rate follows the walk, the jog and the turbo
   * cheat with nothing extra wired up. Stride length grows with speed the way a
   * person's does — you lengthen before you quicken — which is why the divisor
   * below is a function of speed and not a constant.
   *
   * Phase convention: 0 is left heel strike, π is right heel strike.
   */
  const STRIDE = (speed) => clamp(0.62 + speed * 0.16, 0.62, 1.45);

  let phase = 0;

  /** One leg's joint angles at a phase. Local forward is −Z, so a forward
      swing is a negative hip rotation and knee flexion is positive. */
  function poseLeg(L, ph, amp) {
    /* hip: forward at heel strike, back at toe-off */
    L.hip.rotation.x = -Math.cos(ph) * 0.40 * amp - 0.03;
    /* knee: the double knee action. Nearly straight at heel strike, a small
       weight-acceptance flex just after it, then the big swing flexion. */
    const swing = (1 - Math.cos(ph)) * 0.5;                 // 0 at strike, 1 mid-swing
    const accept = Math.max(0, Math.sin(ph * 2)) * (ph < Math.PI ? 0 : 1);
    L.knee.rotation.x = (0.06 + 1.05 * Math.pow(swing, 1.7) + 0.16 * accept) * amp + 0.04;
    /* ankle: plantarflexes at toe-off, dorsiflexes to clear the ground */
    L.ankle.rotation.x = (-0.30 * Math.sin(ph + 0.5) + 0.10) * amp;
  }

  /** One arm's angles. Arms oppose the leg on the same side, and the elbow
      carries more flexion on the forward swing than on the back. */
  function poseArm(A, ph, amp) {
    const sw = Math.cos(ph);
    A.shoulder.rotation.x = sw * 0.34 * amp;
    A.shoulder.rotation.z = 0;
    A.elbow.rotation.x = (0.26 + 0.34 * Math.max(0, -sw)) * amp + 0.10;
  }

  /** Rest pose: a fixed point, exactly like the velocity snap in main.js — a
      decaying swing never arrives, and this project's recapture depends on rest
      being identical frame to frame. */
  function poseRest() {
    for (const L of [legL, legR]) {
      L.hip.rotation.x = -0.03; L.knee.rotation.x = 0.05; L.ankle.rotation.x = 0;
    }
    for (const A of [armL, armR]) {
      A.shoulder.rotation.x = 0.04; A.elbow.rotation.x = 0.16;
    }
    /* stance is not symmetrical even at rest — a person waits on one hip */
    legR.hip.rotation.x = 0.06;
    pelvis.position.x = 0; pelvis.position.y = M.hip;
    pelvis.rotation.set(0, 0, 0.012);
    chest.rotation.set(0.035, 0, -0.008);
    head.rotation.set(0, 0, 0);
  }

  return {
    group: root,

    /**
     * Place the figure at the player's feet and drive the gait.
     * @param {number} x,y,z world position of the soles
     * @param {number} yaw   player yaw; 0 faces −Z, matching main.js
     * @param {number} speed planar speed, m/s
     * @param {number} dt    seconds
     */
    update(x, y, z, yaw, speed, dt) {
      root.position.set(x, y, z);
      root.rotation.y = -yaw;

      if (speed <= 0.05) { phase = 0; poseRest(); return; }

      /* amplitude grows with speed then saturates: a jog is not a walk with
         bigger angles, it is a walk with the same angles taken faster, and past
         a jog the limbs stop opening further */
      const amp = clamp(0.70 + speed * 0.20, 0.70, 1.25);
      phase = (phase + dt * (Math.PI * speed / STRIDE(speed))) % TAU;

      poseLeg(legL, phase, amp);
      poseLeg(legR, (phase + Math.PI) % TAU, amp);
      /* contralateral: the left arm swings with the right leg */
      poseArm(armL, (phase + Math.PI) % TAU, amp);
      poseArm(armR, phase, amp);

      /* pelvis: rises twice per stride (once per step), sways laterally once,
         rotates toward the swinging leg and rolls onto the stance hip */
      pelvis.position.y = M.hip - 0.016 * amp * (1 + Math.cos(phase * 2)) * 0.5;
      pelvis.position.x = Math.sin(phase) * 0.020 * amp;
      pelvis.rotation.y = -Math.sin(phase) * 0.10 * amp;
      pelvis.rotation.z = Math.sin(phase) * 0.055 * amp;

      /* chest counters the pelvis and leans into the walk with speed */
      chest.rotation.y = Math.sin(phase) * 0.085 * amp;
      chest.rotation.x = 0.035 + clamp(speed * 0.016, 0, 0.075);
      chest.rotation.z = -pelvis.rotation.z * 0.35;

      /* the head holds still against both, which is what people do — gaze is
         stabilised, not carried along by the trunk */
      head.rotation.y = -(pelvis.rotation.y + chest.rotation.y) * 0.85;
      head.rotation.z = -chest.rotation.z * 0.6;
      head.rotation.x = -chest.rotation.x * 0.5;
    },
  };
}
