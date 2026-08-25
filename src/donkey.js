/* The donkey — the one animal in the scene, followed from behind and above.
 *
 * A quadruped is a harder object than a person in exactly one way: a biped's
 * silhouette is dominated by the vertical, so proportion errors read as "odd",
 * whereas a quadruped's is dominated by the horizontal, and there the same error
 * reads as *a different animal*. Get the leg-to-barrel ratio wrong and a donkey
 * becomes a pony; get the head-to-neck ratio wrong and it becomes a goat. So
 * the table below is a real animal — 1.26 m at the withers, which is a standard
 * donkey rather than a miniature — and the shapes that separate the species from
 * a small horse are built deliberately rather than arrived at:
 *
 * **The head is huge and the neck is short and thick.** This is the single
 * strongest cue. A donkey's head is about a third of its withers height, carried
 * on a short upright neck with almost no arch. A horse's is smaller on a longer,
 * curved neck. Nothing else on the animal is as diagnostic.
 *
 * **The ears.** Nearly a quarter of a metre, upright, and they move
 * independently of everything else. They are also most of what the top-down
 * camera sees, so they get a cupped elliptical sweep rather than a flat card.
 *
 * **The back is straight and the belly hangs.** A donkey has no withers to speak
 * of and a level topline over a rounded, dropped belly. A cross-section that is
 * a plain ellipse gives a barrel that is symmetrical top to bottom, which reads
 * as a pig; so the sweep's section takes a separate top and bottom radius and
 * blends between them, which is what lets one profile hold a straight spine over
 * a slack gut.
 *
 * **The legs are thin, and the hind pair zigzags.** Front legs are near-vertical
 * columns; hind legs angle forward at the stifle and back at the hock. Four
 * straight rods reads as a table, and it is the commonest failure in a hand-built
 * quadruped.
 *
 * **The markings.** The dorsal stripe and the shoulder cross, in donkeytex.js.
 *
 * The gait is a lateral-sequence four-beat walk — left hind, left fore, right
 * hind, right fore — which is what a walking donkey actually does and is why the
 * legs here take a phase offset each rather than the biped's simple antiphase.
 * It only genuinely became that sequence once the touchdowns were made audible;
 * see the note on the offsets being the inverse of the order, above `legs`. Each
 * touchdown is reported through the `onHoof` callback, which is what drives the
 * footstep voice in audio.js.
 *
 * What is deliberately *not* here: no foot IK, so a planted hoof slips against
 * the ground rather than being pinned to it. At this camera distance, with the
 * gait phase driven from real speed, the slip is small — but it is a real
 * limitation and it is the next thing worth building.
 *
 * Cost, measured: 29 meshes and 5,628 triangles, against a frame that carries
 * 3.97 M and 55-70 draw calls. The animal is articulated, so the segments cannot
 * be merged into one draw without a skinned mesh. The bounding box comes out
 * 2.15 m long and 0.67 m wide with the ear tips at 1.66 m, and the hooves land
 * on the ground plane to within a millimetre — which is the check that the rest
 * angles in REST still agree with the segment lengths above them.
 */
import * as THREE from 'three';
import { clamp, mix, smoothstep } from './noise.js';
import { hideTex, barrelTex, paleTex, darkTex, hoofTex, maneTex } from './donkeytex.js';
import { installDonkeyFill } from './donkeyfill.js';

const TAU = Math.PI * 2;

/* ── the animal, metres, origin at the hooves ──────────────────────────── */

const M = {
  withers: 1.26,
  axis: 0.98,          // height of the barrel's sweep axis
  barrelZ: -0.55,      // where the chest starts; the sweep runs back from here
  barrelLen: 1.26,
  /* front limb: a near-vertical column */
  foreY: -0.100,       // shoulder joint, relative to the barrel axis
  foreZ: -0.320,
  foreX: 0.150,
  forearm: 0.44,
  foreCannon: 0.30,
  /* hind limb: femur forward, tibia back, cannon down */
  hindY: -0.045,
  hindZ: 0.460,
  hindX: 0.160,
  femur: 0.30,
  tibia: 0.30,
  hindCannon: 0.25,
  hoof: 0.140,
  /* Neck and head. The neck leaves the chest *low* — a neck rooted up at the
     withers reads as a periscope bolted to the back, which is what the first
     pass looked like. And the head hangs at 35° off vertical, not 63°: carried
     any flatter than this the muzzle ends up at withers height and the animal
     reads as a llama. These two constants place the muzzle at 1.11 m and 0.57 m
     ahead of the chest, which is a donkey standing at ease. */
  neckY: 0.080,
  neckZ: -0.480,
  neckLen: 0.56,
  neckTilt: Math.PI - 0.72,   // up and forward
  headLen: 0.46,
  headTilt: 0.62,             // absolute, forward and down
  earLen: 0.245,
  tailLen: 0.42,
};

/* ── swept section ─────────────────────────────────────────────────────────
 *
 * As chartex's figure used, with one addition that the barrel needs: the
 * section has a separate top and bottom radius, blended smoothly around the
 * girth, so one profile can hold a straight back over a hanging belly. Hangs
 * along local −Y from the joint at the origin, so a pivot group's rotation.x is
 * the joint angle directly.
 *
 * `profile(t, out)` fills out[0] = half-width, out[1] = top radius,
 * out[2] = bottom radius.
 */
function sweep(len, profile, along = 12, radial = 14, vRepeat = 1) {
  const pos = [], uv = [], idx = [];
  const r = [0, 0, 0];
  for (let i = 0; i <= along; i++) {
    const t = i / along;
    r[2] = NaN;
    profile(t, r);
    const rTop = r[1], rBot = Number.isNaN(r[2]) ? r[1] : r[2];
    const y = -t * len;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const sa = Math.sin(a);
      /* +z is up once the barrel is laid down, so sin a > 0 is the topline */
      const rz = mix(rBot, rTop, 0.5 + 0.5 * sa);
      pos.push(Math.cos(a) * r[0], y, rz * sa);
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

/** Round-sectioned linear taper with both ends closed off, so nothing in the
    animal terminates in a flat disc. */
/* The dome factor every closer here shares: a circular falloff to zero over
   `cap` of the length, so an end closes as a rounded dome rather than an open
   rim. taper() and the barrel each inlined their own copy of this. */
function dome(t, cap0, cap1) {
  const e0 = cap0 > 0 ? Math.min(1, t / cap0) : 1;
  const e1 = cap1 > 0 ? Math.min(1, (1 - t) / cap1) : 1;
  return Math.sqrt(Math.max(0, 1 - (1 - e0) * (1 - e0))) *
         Math.sqrt(Math.max(0, 1 - (1 - e1) * (1 - e1)));
}

function taper(r0, r1, cap = 0.12) {
  return (t, out) => {
    const r = mix(r0, r1, t) * dome(t, cap, cap);
    out[0] = r; out[1] = r; out[2] = r;
  };
}

/** Closes an existing profile's ends.
 *
 * Every sweep in this file that did not go through taper() was an open tube. The
 * neck, head, forearm, femur, gaskin, hooves, mane and tail tuft all ended in a
 * bare rim, and since three culls back faces you did not see a rim — you saw
 * straight through it into the far inside wall of the tube, which reads as a
 * hard-edged dark crescent sitting in the middle of the animal. The neck's was
 * the worst: its open base stands proud of the closed chest, so the withers had
 * a hole in them, and that hole was mistaken for a shading fault twice.
 *
 * @param {(t: number, out: number[]) => void} profile  the profile to close
 * @param {number} cap0  dome length at t=0, as a fraction of the sweep
 * @param {number} cap1  dome length at t=1; 0 leaves that end open on purpose
 */
function domed(profile, cap0 = 0.10, cap1 = 0.10) {
  return (t, out) => {
    profile(t, out);
    /* NaN in out[2] is how a profile tells sweep() "no separate bottom radius";
       NaN survives the multiply, so that signal still reaches it. */
    const s = dome(t, cap0, cap1);
    out[0] *= s; out[1] *= s; out[2] *= s;
  };
}

function mat(tex, roughness) {
  return new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughness, metalness: 0,
  });
}

/**
 * @param {THREE.DirectionalLight} sun  the beam, for the fill term's direction.
 *   Required rather than optional: the animal is backlit for most of the traverse
 *   and without the fill its camera-facing side reads as a silhouette, so a
 *   caller that forgot it should hear about it instead of getting that quietly.
 */
export function buildDonkey(sun, { onHoof } = {}) {
  if (!sun) throw new Error('buildDonkey(sun): the fill term needs the beam');
  const root = new THREE.Group();

  const hide = mat(hideTex(), 0.88);
  const barrelM = mat(barrelTex(), 0.88);
  const pale = mat(paleTex(), 0.86);
  const dark = mat(darkTex(), 0.84);
  const hoof = mat(hoofTex(), 0.52);
  const mane = mat(maneTex(), 0.90);
  /* See src/donkeyfill.js: a bounce term on this animal and nothing else. */
  const fill = installDonkeyFill([hide, barrelM, pale, dark, hoof, mane], sun);

  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* A joint ball, and it wants to be almost invisible.
   *
   * WHAT IT IS FOR, narrowly. Where two domed segments meet at an *angle* their
   * end caps are not parallel, so the outside of the bend opens a wedge notch.
   * That is a real defect and a ball fills it. It is the only defect a ball
   * fixes.
   *
   * WHAT IT IS NOT FOR, learned by doing it wrong. The first pass put a ball at
   * every joint sized to the segment's *thickest* radius — 134 mm at the hip, 190
   * mm at the neck root — and turned the animal into a balloon animal, which was
   * far worse than the gaps it set out to fix. Two things were wrong. The size
   * came from the wrong place: a ball sits where the segment has already domed to
   * nothing, so what it has to match is the radius *at the joint*, not the belly
   * of the muscle 100 mm away. And a sphere is round in every axis while these
   * limbs are elliptical — the femur's half-width is 0.82 of its depth — so a
   * sphere matched even to the correct radius still bulges sideways by a fifth.
   * Hence `sx`. And hence the sizing rule, which took two wrong tries to land:
   * match the *larger* of the two end radii, then squash across with `sx` to the
   * limb's own half-width. Under-sizing is not the safe direction it looks like —
   * the second pass set every ball to 0.92 of the *thinner* end and traded the
   * lumps for a visible groove and a hard step at every joint down the leg, since
   * a ball narrower than the limb leaves the segment's cap rim standing proud of
   * it. Flush is the target: at a knee that is 40 mm with sx 0.86, giving exactly
   * the forearm's 34 mm half-width, so the rim is covered and nothing bulges.
   *
   * Straight joints get no ball at all. Whether a joint even has a waist is
   * decided by the ratio of its dome's length to its radius: at the hip that is
   * 18 mm over 132 mm = 0.14, a nearly flat cap with no waist to fill. Those
   * caps are also buried — the hip, shoulder and neck root all sit inside the
   * barrel's own radius, so their end discs cannot be seen from outside.
   *
   * @param {number} r   just under the thinner segment radius at the joint
   * @param {number} sx  squash across the limb, to match its elliptical section
   * @param {number} sy  stretch along the limb; the hock is a bony prominence
   */
  const ball = (parent, r, material, sx = 1.0, sy = 1.0) => {
    const s = add(parent, new THREE.SphereGeometry(r, 10, 8), material);
    s.scale.set(sx, sy, 1.0);
    return s;
  };

  /* ── the barrel ───────────────────────────────────────────────────────── */

  const body = new THREE.Group();
  body.position.y = M.axis;
  root.add(body);

  /* t = 0 at the chest, 1 at the tail. The topline is deliberately almost flat
     — a level back is the donkey silhouette — while the bottom radius swells
     through the middle for the hanging gut and tucks up hard at the flank. */
  const barrelGeo = sweep(M.barrelLen, (t, o) => {
    o[0] = mix(0.140, 0.225, smoothstep(0.0, 0.40, t)) *
           mix(1.0, 0.56, smoothstep(0.62, 1.0, t));
    o[1] = mix(0.255, 0.268, smoothstep(0.0, 0.30, t)) *
           mix(1.0, 0.72, smoothstep(0.62, 1.0, t));           // the topline
    o[2] = mix(0.250, 0.300, smoothstep(0.05, 0.45, t)) *
           mix(1.0, 0.46, smoothstep(0.52, 0.95, t));          // belly, then flank tuck
    /* close both ends */
    const s = dome(t, 0.10, 0.07);
    o[0] *= s; o[1] *= s; o[2] *= s;
  }, 20, 22, 1);
  const barrel = add(body, barrelGeo, barrelM, 0, 0, M.barrelZ);
  /* lay the sweep down: local −Y becomes +Z, so it runs chest → tail, and local
     +Z becomes up, which is the axis the section's top/bottom split works on
     and the frame donkeytex's markings are placed in */
  barrel.rotation.x = -Math.PI / 2;

  /* ── neck, head, ears ─────────────────────────────────────────────────── */

  const neck = new THREE.Group();
  neck.position.set(0, M.neckY, M.neckZ);
  neck.rotation.x = M.neckTilt;
  body.add(neck);
  /* Short, thick and barely tapered — a donkey's neck is a wedge, not a curve.
     0.41 m deep at the base, and deeper on the crest side (−Z) than the throat,
     which is where a donkey carries its bulk. A neck any thinner than this reads
     as a plank when the camera is behind it. */
  add(neck, sweep(M.neckLen, domed((t, o) => {
    o[0] = mix(0.150, 0.095, smoothstep(0, 1, t));
    o[1] = mix(0.175, 0.100, smoothstep(0, 1, t));   // throat
    o[2] = mix(0.240, 0.112, smoothstep(0, 1, t));   // crest
  }, 0.09, 0.09), 8, 14, 1), hide);
  /* No ball at the neck root. Closing the neck is what fixed the hole in the
     withers; the 190 mm ball that was briefly here fixed nothing and was the
     single worst lump on the animal. The neck's base sits 0.08 m off the barrel
     axis where the barrel's own radius is 0.225 m, so its end cap is inside the
     chest and cannot be seen. */

  /* The upright mane, along the crest. Short and brush-like, which is a donkey;
     a long falling mane is a horse.
     The neck's local −Z is the crest and its +Z is the throat, so the height goes
     in o[2] (the section's −Z radius). The first pass put it in o[1] and grew the
     mane down the *underside* of the neck as a dewlap. */
  const maneGeo = sweep(M.neckLen * 0.90, domed((t, o) => {
    const h = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.055 + 0.014;
    o[0] = 0.024; o[1] = h * 0.10; o[2] = h;
  }, 0.06, 0.06), 10, 8, 1);
  add(neck, maneGeo, mane, 0, -0.02, -0.010);

  /* The poll, with the neck's tilt cancelled so the head and ears are posed in
     the body's frame rather than in the neck's. Keeps the two tilt constants
     independent — otherwise nodding the neck silently re-aims the ears. */
  const poll = new THREE.Group();
  poll.position.y = -M.neckLen;
  poll.rotation.x = -M.neckTilt;
  neck.add(poll);
  /* The poll does need one: the head is tilted 0.62 rad out of the neck's axis, so
     this is a bent joint and the two caps leave a notch at the throat. Sized under
     the neck's top (112 mm), squashed across so it does not widen the throat. */
  ball(poll, 0.105, hide, 0.88);

  const head = new THREE.Group();
  head.rotation.x = M.headTilt;
  poll.add(head);
  /* Big, and deep through the jaw at the top end where the cheekbone is, then
     long and narrow down the nasal bone to the muzzle. */
  /* Domed at the poll end only. The muzzle sphere below is centred 26 mm short of
     the far end with a 76 mm radius, so it already encloses that rim completely —
     doming it too would pull the nose in behind the sphere and flatten the face. */
  add(head, sweep(M.headLen, domed((t, o) => {
    const jaw = Math.exp(-Math.pow((t - 0.18) / 0.24, 2));
    o[0] = mix(0.108, 0.062, smoothstep(0.05, 0.9, t)) + jaw * 0.020;
    o[1] = mix(0.125, 0.070, smoothstep(0.05, 0.9, t)) + jaw * 0.012;
    o[2] = mix(0.130, 0.078, smoothstep(0.05, 0.9, t)) + jaw * 0.030;
  }, 0.08, 0), 12, 16, 1), hide);
  /* the pale muzzle — half of the dun pattern, and it sits right at the front of
     the silhouette where it does the most work */
  const muzzle = add(head, new THREE.SphereGeometry(0.076, 14, 10), pale, 0, -M.headLen + 0.026, 0);
  muzzle.scale.set(0.90, 0.86, 1.02);

  /* eyes set wide on the sides of the head, with pale rings around them */
  for (const side of [-1, 1]) {
    const ring = add(head, new THREE.SphereGeometry(0.040, 10, 8), pale,
                     side * 0.098, -0.108, -0.012);
    ring.scale.set(0.45, 0.85, 0.95);
    const eye = add(head, new THREE.SphereGeometry(0.024, 10, 8), dark,
                    side * 0.112, -0.108, -0.014);
    eye.scale.set(0.55, 1.0, 1.0);
  }

  /* the ears. Cupped rather than flat: the section is much wider than it is
     deep and the front face is pushed in, which is what catches a rim light
     from behind instead of going uniformly dark. */
  const earGeo = sweep(M.earLen, (t, o) => {
    const w = Math.sin(Math.min(1, 0.12 + t * 0.94) * Math.PI * 0.92);
    o[0] = w * 0.052;
    o[1] = w * 0.030;       // outer back
    o[2] = w * 0.013;       // the cupped inner face
  }, 12, 12, 1);
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.072, 0.030, 0.048);
    poll.add(ear);
    /* No rotation on the mesh: the ear *group* is already turned through π by
       poseRest, which is what stands the sweep up. Turning the mesh through π as
       well — which the first pass did — composes to 2π and lays the ear straight
       back down inside the head, where it is invisible. */
    add(ear, earGeo, hide);
    /* dark tips, the last of the dun points. At −Y, which is the far end of a
       sweep that hangs along −Y. */
    const tip = add(ear, new THREE.SphereGeometry(0.030, 8, 6), dark, 0, -M.earLen * 0.94, 0);
    tip.scale.set(1.0, 0.55, 0.42);
    ears.push({ g: ear, side });
  }

  /* ── the tail ─────────────────────────────────────────────────────────── */

  const tail = new THREE.Group();
  tail.position.set(0, 0.170, M.barrelZ + M.barrelLen - 0.045);
  tail.rotation.x = -0.28;   // carried a little off the rump
  body.add(tail);
  add(tail, sweep(M.tailLen, taper(0.038, 0.016, 0.10), 8, 10, 1), hide);
  /* the tuft — a donkey's tail is a thin switch with a brush on the end, not a
     fall of hair down its whole length */
  /* Longer and much slimmer than the first pass, which peaked at a 58 mm radius —
     116 mm across on a 420 mm tail, and it read as a leaf hanging off the rump
     rather than hair. A donkey's switch is a narrow brush. */
  const tuft = add(tail, sweep(0.22, domed((t, o) => {
    const w = Math.sin(Math.min(1, 0.10 + t * 0.95) * Math.PI) * 0.026 + 0.008;
    o[0] = w; o[1] = w; o[2] = w;
  }, 0.08, 0.08), 8, 10, 1), mane, 0, -M.tailLen + 0.02, 0);
  /* the dock, where the tail leaves the rump; flush with the tail's own 38 mm root,
     and it is load-bearing — the tail root sits 1 mm proud of the barrel there */
  ball(tail, 0.038, hide);

  /* ── the limbs ────────────────────────────────────────────────────────── */

  /* Front: a column. Two joints, because the elbow sits up inside the barrel and
     never visibly articulates on a walk — the carpus does all the work. */
  const foreLeg = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * M.foreX, M.foreY, M.foreZ);
    body.add(shoulder);
    /* thick with muscle at the top, thin and tendinous by the carpus */
    add(shoulder, sweep(M.forearm, domed((t, o) => {
      const r = mix(0.098, 0.040, smoothstep(0.0, 0.85, t));
      o[0] = r * 0.86; o[1] = r; o[2] = r;
    }, 0.07, 0.07), 8, 12, 1), hide);
    /* No ball at the shoulder: it is a straight joint with a flat cap (31 mm of
       dome over 98 mm of radius) and it sits at x=0.150 inside the barrel's
       0.171 m half-width there, so the cap is enclosed already. */

    const carpus = new THREE.Group();
    carpus.position.y = -M.forearm;
    shoulder.add(carpus);
    /* the cannon: the thinnest part of the animal, and dark — the dun points */
    add(carpus, sweep(M.foreCannon, taper(0.038, 0.032, 0.10), 6, 10, 1), dark);
    /* The knee is where a ball earns its place: the forearm's 31 mm dome over a
       40 mm radius is near hemispherical, and the cannon's is too, so without one
       the two round tips meet in an hourglass pinch. Flush with the forearm's end. */
    ball(carpus, 0.040, hide, 0.86);

    const fetlock = new THREE.Group();
    fetlock.position.y = -M.foreCannon;
    carpus.add(fetlock);
    /* Hoof: domed hard at the top, barely at the bottom. The bottom wants to stay
       a flat wall — a hoof is cut off square — but it still has to be closed, or
       a camera below the animal looks up inside the foot. */
    add(fetlock, sweep(M.hoof, domed((t, o) => {
      const r = mix(0.044, 0.052, smoothstep(0, 1, t));   // hooves flare downward
      o[0] = r; o[1] = r; o[2] = r * 1.08;
    }, 0.16, 0.05), 5, 12, 1), hoof);
    /* Flush with the hoof's 44 mm top, not the cannon's 32 mm: the hoof is the
       wider of the two, and it was its rim that read as a separate pale cylinder
       stepped onto the bottom of the leg. */
    ball(fetlock, 0.042, dark, 0.95);

    return { a: shoulder, b: carpus, c: null, fetlock, fore: true };
  };

  /* Hind: the zigzag. Three joints, and the rest angles below are what make it
     read as a hind leg rather than a second front leg. */
  const hindLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * M.hindX, M.hindY, M.hindZ);
    body.add(hip);
    /* the thigh is the heaviest mass on the animal */
    add(hip, sweep(M.femur, domed((t, o) => {
      const r = mix(0.132, 0.062, smoothstep(0.1, 0.95, t));
      o[0] = r * 0.82; o[1] = r; o[2] = r * 1.06;
    }, 0.06, 0.06), 8, 12, 1), hide);
    /* No ball at the hip. Its dome is 18 mm over a 132 mm radius — ratio 0.14, a
       flat cap with no waist — and at x=0.160 it is inside the barrel's 0.182 m
       half-width. The 134 mm sphere that was here read as a hip joint the size of
       the animal's own gut. */

    const stifle = new THREE.Group();
    stifle.position.y = -M.femur;
    hip.add(stifle);
    /* the gaskin: a muscle belly high up, necking hard into the hock */
    add(stifle, sweep(M.tibia, domed((t, o) => {
      const belly = Math.exp(-Math.pow((t - 0.25) / 0.30, 2)) * 0.022;
      const r = mix(0.072, 0.034, smoothstep(0.05, 1.0, t)) + belly;
      o[0] = r * 0.88; o[1] = r; o[2] = r;
    }, 0.06, 0.06), 8, 12, 1), hide);
    /* The stifle stays, because the hind leg zigzags hard here — rest angles swing
       0.55 to −0.85 rad across this joint — and a bend that sharp opens a real
       wedge notch on the outside of it. Flush with the gaskin's 72 mm top. */
    ball(stifle, 0.070, hide, 0.88);

    const hock = new THREE.Group();
    hock.position.y = -M.tibia;
    stifle.add(hock);
    add(hock, sweep(M.hindCannon, taper(0.036, 0.031, 0.10), 6, 10, 1), dark);
    /* the hock, stretched along the limb because the point of it is a bony
       prominence rather than a round knuckle */
    ball(hock, 0.036, dark, 0.90, 1.15);

    const fetlock = new THREE.Group();
    fetlock.position.y = -M.hindCannon;
    hock.add(fetlock);
    add(fetlock, sweep(M.hoof, domed((t, o) => {
      const r = mix(0.042, 0.050, smoothstep(0, 1, t));
      o[0] = r; o[1] = r; o[2] = r * 1.08;
    }, 0.16, 0.05), 5, 12, 1), hoof);
    ball(fetlock, 0.040, dark, 0.95);          // flush with the hind hoof's 42 mm top

    return { a: hip, b: stifle, c: hock, fetlock, fore: false };
  };

  /* Rest angles, and they are the geometry: the chain has to reach the ground.
     Front sums to a 0.740 m drop from a 0.880 m shoulder; hind sums to 0.792 m
     from a 0.935 m hip. Change a length and these have to be re-derived — the
     drops are cosines, so flipping a sign leaves them alone, which is exactly
     how the inverted hind leg below survived its first check.

     **The sign convention, which was wrong here and is the whole bug.** A
     segment hangs along −Y and `rotation.x = θ` sends its far end to
     z = −len·sin θ. Local forward is −Z, so a *positive* θ swings the limb
     FORWARD and a negative one swings it back. The first pass had it backwards
     and built the hind leg as its own mirror image: femur back, tibia forward,
     cannon back, so the hock pointed forward like a bird's. That is what read as
     broken. Hind is femur forward, tibia back, cannon near-vertical. */
  const REST = {
    fore: { a: 0.04, b: -0.06, c: 0 },
    hind: { a: 0.55, b: -0.85, c: 0.35 },
  };

  /* Lateral-sequence walk: left hind, left fore, right hind, right fore.
   *
   * The offsets are the INVERSE of the touchdown order, and that is the trap.
   * Contact is at local phase 0 (see poseLeg), and poseLeg is handed
   * `phase + ph·TAU`, so a leg with offset `ph` touches down when the *global*
   * phase reaches (1 − ph)·TAU — not at ph·TAU. Writing the offsets as though
   * they were the touchdown times put the fore pair at 0.25/0.75 and produced the
   * order left hind, RIGHT fore, right hind, LEFT fore: alternating sides, which
   * is a diagonal-sequence walk, not the lateral one this file's header promises
   * and a donkey actually uses. It went unseen because a silent gait at four
   * metres reads as "legs moving"; it stops being invisible the moment each
   * touchdown makes a sound. The fore pair is swapped to fix it, and `contact` is
   * derived from `ph` rather than written down a second time, so the two can no
   * longer drift apart.
   */
  const legs = [
    { L: hindLeg(-1), ph: 0.00, fore: false, side: -1 },   // left hind,  lands 0/4
    { L: foreLeg(-1), ph: 0.75, fore: true, side: -1 },    // left fore,  lands 1/4
    { L: hindLeg(1), ph: 0.50, fore: false, side: 1 },     // right hind, lands 2/4
    { L: foreLeg(1), ph: 0.25, fore: true, side: 1 },      // right fore, lands 3/4
  ].map(e => ({ ...e, contact: ((1 - e.ph) % 1) * TAU }));

  /* ── the gait ──────────────────────────────────────────────────────────
   *
   * One phase per stride cycle, advanced from real speed rather than from time,
   * so the walk, the jog and the turbo cheat all get a stride rate that matches
   * without anything extra wired up. Stride length grows with speed the way a
   * real animal's does, which is why the divisor is a function of speed.
   *
   * A donkey walks at about 1.1 m/s and its stride is roughly 1.2 m, so the
   * constants below put it at a little under one cycle a second at a walk.
   */
  const STRIDE = (speed) => clamp(1.05 + speed * 0.14, 1.05, 2.10);

  let phase = 0;

  let beats = 0;

  /** Did the advancing phase sweep past `c` this frame? `a`→`b` may wrap TAU. */
  const swept = (a, b, c) => (a <= b) ? (c > a && c <= b) : (c > a || c <= b);

  /** Protraction/retraction plus joint flexion for one limb at a phase.
      Positive rotation.x swings a limb forward (see REST), so protraction takes
      +cos(ph) — the limb is fully forward at ph = 0, which is ground contact —
      and joint flexion, which always folds a limb *backward*, is negative. */
  function poseLeg(L, ph, amp) {
    const rest = L.fore ? REST.fore : REST.hind;
    /* the swing: 0 at ground contact, 1 at mid-swing */
    const swing = (1 - Math.cos(ph)) * 0.5;
    L.a.rotation.x = rest.a + Math.cos(ph) * (L.fore ? 0.30 : 0.26) * amp;
    if (L.fore) {
      /* the carpus folds hard to lift the hoof over the ground, and is straight
         at contact — a front leg that lands bent is the classic wrong walk */
      L.b.rotation.x = rest.b - Math.pow(swing, 1.8) * 1.05 * amp;
      L.fetlock.rotation.x = 0.10 * Math.sin(ph + 0.6) * amp;
    } else {
      /* the hind pair works as a linkage: on the swing the stifle closes (the
         tibia swings further back) and the hock closes with it (the cannon
         swings forward), which together pick the hoof up and carry it through.
         Opposite signs because the two joints bend opposite ways. */
      const flex = Math.pow(swing, 1.6) * amp;
      L.b.rotation.x = rest.b - flex * 0.62;
      L.c.rotation.x = rest.c + flex * 0.46;
      L.fetlock.rotation.x = 0.12 * Math.sin(ph + 0.4) * amp;
    }
  }

  /** Rest pose: a fixed point, exactly like the velocity snap in main.js. A
      decaying swing never arrives, and this project's pixel-identical recapture
      depends on rest being identical frame to frame. */
  function poseRest() {
    for (const { L } of legs) {
      const rest = L.fore ? REST.fore : REST.hind;
      L.a.rotation.x = rest.a;
      L.b.rotation.x = rest.b;
      if (L.c) L.c.rotation.x = rest.c;
      L.fetlock.rotation.x = 0;
    }
    body.position.set(0, M.axis, 0);
    body.rotation.set(0, 0, 0);
    neck.rotation.set(M.neckTilt, 0, 0);
    tail.rotation.set(-0.28, 0, 0);
    for (const e of ears) e.g.rotation.set(Math.PI + 0.20, 0, e.side * 0.34);
  }

  /* Ear flicks. A standing donkey is not a statue and the ears are the only
     thing on it that moves at rest — but "at rest" has to stay a fixed point for
     the capture harness, so this is driven from the *gait phase* and not from a
     clock, and it therefore stops dead when the animal does. Two irrational
     multipliers so the two ears never sync up. */
  function poseEars(amp) {
    for (const e of ears) {
      const k = e.side < 0 ? 0.7321 : 1.2361;
      e.g.rotation.x = Math.PI + 0.20 + Math.sin(phase * k) * 0.10 * amp;
      e.g.rotation.z = e.side * (0.34 + Math.sin(phase * k * 1.7 + 1.1) * 0.07 * amp);
    }
  }

  poseRest();

  return {
    group: root,

    /* The gait phase and the touchdown count, so a probe can ask whether the
       four-beat sequence is actually running instead of inferring it from the
       sound — which cannot be heard in a headless browser, where the audio
       context never leaves `suspended`. */
    _gait: () => ({ phase, beats }),

    /**
     * Place the animal on the ground and drive the gait.
     * @param {number} x,y,z world position of the hooves
     * @param {number} yaw   player yaw; 0 faces −Z, matching main.js
     * @param {number} speed planar speed, m/s
     * @param {number} dt    seconds
     */
    update(x, y, z, yaw, speed, dt) {
      root.position.set(x, y, z);
      root.rotation.y = -yaw;
      /* Before the standing-still return below, because a standing animal is lit
         by the same sun as a walking one. */
      fill.update();

      if (speed <= 0.05) { phase = 0; poseRest(); return; }

      /* amplitude grows with speed and then saturates: past a jog the limbs stop
         opening further and the animal is simply taking the same steps faster */
      const amp = clamp(0.72 + speed * 0.22, 0.72, 1.30);
      const prevPhase = phase;
      phase = (phase + dt * (TAU * speed / STRIDE(speed))) % TAU;

      for (const { L, ph } of legs) poseLeg(L, (phase + ph * TAU) % TAU, amp);

      /* Hoof-fall events, so the sound can be the animal on screen rather than a
         cadence of its own. The gait already knows exactly when each hoof lands,
         which is the whole reason to emit from here: the alternative — audio
         re-deriving a cadence from speed — is what produced two bipedal boots
         under a four-legged animal in the first place. Emitted for the real
         touchdown of a named limb, so the listener gets the side for the pan and
         fore/hind for the weight. */
      if (onHoof) {
        for (const e of legs) {
          if (swept(prevPhase, phase, e.contact)) { beats++; onHoof(e.side, e.fore, speed); }
        }
      }

      /* The trunk. A four-beat walk has two support peaks per cycle, so the rise
         and fall runs at twice the phase; the roll and yaw run at once, because
         they follow which side is carrying. */
      body.position.y = M.axis - 0.014 * amp * (1 + Math.cos(phase * 2)) * 0.5;
      body.rotation.z = Math.sin(phase) * 0.030 * amp;
      body.rotation.y = Math.sin(phase) * 0.026 * amp;

      /* The head nod, which is the thing that makes a walking donkey read as a
         walking donkey. It is a real mechanism, not a flourish: the head and neck
         are a counterweight swung once per cycle to shift the centre of mass
         over the supporting diagonal, so it is locked to the phase and it grows
         with the stride. */
      neck.rotation.x = M.neckTilt + Math.sin(phase) * 0.075 * amp;
      neck.rotation.z = -body.rotation.z * 0.5;

      /* the tail switches at half the leg rate, and lags it */
      tail.rotation.z = Math.sin(phase * 0.5 + 0.8) * 0.16 * amp;
      tail.rotation.x = -0.28 + Math.sin(phase) * 0.05 * amp;

      poseEars(amp);
    },
  };
}
