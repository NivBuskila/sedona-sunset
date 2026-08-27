/* What the donkey is paying attention to.
 *
 * Split out of donkey.js deliberately, and the split is the point: that file is
 * anatomy and gait — how the animal is *built* and how it *moves* — and this one
 * is the only thing in the project that models what it *notices*. Keeping them
 * apart is what stops the second from being written as more flourishes on the
 * first.
 *
 * ── why this is the first step toward a character ────────────────────────────
 *
 * The donkey is currently an avatar, not a companion: `main.js` calls
 * `donkey.update(player.x, …, player.yaw, …)`, so it stands exactly where the
 * player stands and faces exactly where the player faces. Every joint on it is a
 * function of the player's own movement, which means that however good the walk
 * looks, nothing on the animal is evidence of an animal. A viewer reads interiority
 * from one thing before any other: attention. Something that looks at the tree as
 * it passes the tree has an inside; something whose head only ever points where
 * you steer does not.
 *
 * So this adds a will that costs no control. The feet still obey the player
 * completely — the head does not. That is the cheapest honest increment available,
 * and it is also the one that has to come first: a companion that wanders before
 * it can look reads as a broken avatar rather than as a second mind.
 *
 * ── the clock is distance, not time ─────────────────────────────────────────
 *
 * `poseEars` in donkey.js drives the ear flicks from the *gait phase* rather than
 * from a clock, with a comment explaining why: "at rest" has to stay a fixed point
 * for the capture harness, so a standing animal has to be frozen. Attention obeys
 * the same rule and for the same reason — it eases on the phase increment, so a
 * standing donkey holds its look instead of drifting through it, and the harness's
 * 400 ms wait between `walkTo` and a capture cannot move a single vertex.
 *
 * It is also better design than a clock would have been, which is the pleasant
 * part. Attention keyed to *where the player is* rather than to *when they got
 * there* makes the glance at the juniper a property of the place: it happens on
 * every walk, at the same forty metres, for every player, and it is reproducible
 * in a screenshot. A timer would have made it a coin toss that a critic could not
 * re-observe.
 */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/* To (−π, π]. Bearings are subtracted before they are clamped, so without this a
   target crossing behind the animal asks for a 350° head turn. */
const wrapPi = (a) => a - TAU * Math.round(a / TAU);

/* A donkey can carry its head maybe 35° off the line of travel at a walk and turn
   it further only by turning its body with it. The clamp is what keeps a look from
   becoming an owl's, and it is the difference between "noticing" and "possessed". */
const YAW_LIMIT = 0.62;
const PITCH_LIMIT = 0.30;

/* Eye height above the hooves, for the pitch. Withers are 1.26 m and the head is
   carried ahead of and a little below them. */
const EYE_H = 1.30;

/**
 * @param {Array<{x:number, z:number, y?:number, r?:number, hold?:number,
 *                label?:string}>} points
 *   Things worth looking at, in world coordinates. `r` is the radius inside which
 *   the animal notices it at all; `hold` the radius it keeps watching out to once
 *   it has, which is larger — attention has hysteresis, and without it an object
 *   sitting on the boundary makes the head stutter between two candidates. `y` is
 *   a height above the hooves' plane, for the pitch.
 */
export function createMind(points = []) {
  /* The look, in the animal's own frame, eased rather than snapped. */
  let curYaw = 0, curPitch = 0, curAlert = 0;
  /* Held across frames: attention is sticky, and which thing it is stuck to is
     the whole of this object's state. */
  let target = null;

  return {
    /* For a probe, and for the same reason `_gait` exists on the donkey: a
       screenshot cannot tell you *what* the animal decided it was looking at, and
       a behaviour nobody can assert is a behaviour that rots. */
    _look: () => ({
      target: target ? (target.label || 'point') : null,
      yaw: curYaw, pitch: curPitch, alert: curAlert,
    }),

    /**
     * @param {number} x,z  the hooves, in world space
     * @param {number} yaw  player yaw; 0 faces −Z, matching main.js
     * @param {number} phase the gait phase, for the idle sway
     * @param {number} dPhase how far the gait advanced this frame — the easing
     *   rate, and zero when the animal is standing, which is what freezes the look
     * @returns {{yaw:number, pitch:number, alert:number}} head pose in the
     *   animal's frame, and how alert it is (0..1) for the ears
     */
    aim(x, z, yaw, phase, dPhase) {
      /* ── choose ─────────────────────────────────────────────────────────── */
      /* Keep the current target while it is still worth keeping; otherwise take
         the nearest candidate. Nearest rather than most interesting, because with
         a handful of landmarks in a corridor the two are the same thing and
         "interesting" would be a weight nobody could measure. */
      if (target) {
        const d = Math.hypot(target.x - x, target.z - z);
        if (d > (target.hold || (target.r || 20) * 1.6)) target = null;
      }
      if (!target) {
        let best = null, bestD = Infinity;
        for (const p of points) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d > (p.r || 20) || d >= bestD) continue;
          best = p; bestD = d;
        }
        target = best;
      }

      /* ── aim ────────────────────────────────────────────────────────────── */
      let wantYaw = 0, wantPitch = 0, wantAlert = 0;
      if (target) {
        const dx = target.x - x, dz = target.z - z;
        /* The frame conversion, derived rather than guessed, because a sign error
           here is an animal staring fixedly away from the only interesting thing
           in the valley — which is worse than no attention at all.
           `main.js` sets `root.rotation.y = -yaw`, so a local +Y turn of `a` from
           the model's −Z axis lands in the world along (sin(yaw − a), −cos(yaw − a)).
           Setting that equal to the direction of the target gives
           yaw − a = atan2(dx, −dz), hence a below. At a = 0 the head points along
           (sin yaw, −cos yaw), which is the player's own forward — so a zero look
           is a head carried straight, exactly as it should be. */
        const a = wrapPi(yaw - Math.atan2(dx, -dz));
        /* Past the clamp the animal cannot see it without turning its body, and it
           will not turn its body: the body is the player's. So it lets it go
           rather than straining at the limit, which is what a real one does. */
        if (Math.abs(a) > YAW_LIMIT * 1.45) {
          target = null;
        } else {
          wantYaw = clamp(a, -YAW_LIMIT, YAW_LIMIT);
          const d = Math.max(0.5, Math.hypot(dx, dz));
          wantPitch = clamp(Math.atan2((target.y || 0) - EYE_H, d), -PITCH_LIMIT, PITCH_LIMIT);
          /* Alertness falls off with distance: a thing forty metres off gets a
             glance, a thing five metres off gets the ears. */
          wantAlert = clamp(1 - d / (target.r || 20), 0, 1);
        }
      }
      if (!target) {
        /* Nothing worth watching. Not dead ahead, though — a head locked on the
           centreline is the tell of a puppet, so it drifts on the gait the way the
           ears do, at an irrational multiple so the two never fall into step. */
        wantYaw = Math.sin(phase * 0.2181) * 0.10;
        wantPitch = -0.05 + Math.sin(phase * 0.1373 + 2.1) * 0.04;
      }

      /* ── ease ───────────────────────────────────────────────────────────── */
      /* Per metre of gait, not per second; see the note at the top. An animal
         turns its head faster than it gives it up, so a look and a release get
         different rates — the same asymmetry an attack and a release have in the
         audio, and it is what keeps a glance from reading as a scan. */
      const k = clamp(dPhase * (target ? 2.6 : 1.4), 0, 1);
      curYaw += (wantYaw - curYaw) * k;
      curPitch += (wantPitch - curPitch) * k;
      curAlert += (wantAlert - curAlert) * clamp(dPhase * 1.8, 0, 1);
      return { yaw: curYaw, pitch: curPitch, alert: curAlert };
    },
  };
}
