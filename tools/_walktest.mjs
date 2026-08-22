/* Walks the wash, in Node, against the real path and the real height field.
 *
 * The question the corridor has to answer is not "does it stop you" — that is
 * easy and a hard clamp would do it — but "can you feel it while walking the
 * walk". That is a question about a trajectory, so it needs one driven, and
 * driving it in the page costs a six-minute SwiftShader boot per attempt.
 *
 * `src/corridor.js` is pure JavaScript over the height field and the velocity
 * model in `src/main.js`'s `step` is eight lines, so the whole thing runs here
 * in a second. The model below is copied from `step` deliberately rather than
 * imported: `main.js` owns the canvas and cannot be loaded without a document.
 * If the two ever drift the walk test is measuring a game nobody is playing, so
 * keep them together.
 *
 *   node tools/_walktest.mjs
 */
import { WashPath } from '../src/path.js';
import { Terrain } from '../src/terrain.js';
import { buildCorridor, confine, corridorAt, BAND } from '../src/corridor.js';

const path = new WashPath();
const terrain = new Terrain(path);
const corridor = buildCorridor(path, terrain);

const DT = 1 / 120;
const _q = {};
const groundAt = (x, z) => terrain.heightAtQ(x, z, path.atZ(z, _q));

/* Jump constants, mirroring src/main.js. */
const G = 9.81, JUMP_H = 0.45, JUMP_V = Math.sqrt(2 * G * JUMP_H);

function spawn(d) {
  const p = path.posAt(d);
  return { x: p.x, y: groundAt(p.x, p.z), z: p.z, vx: 0, vz: 0,
           vy: 0, air: false,
           yaw: path.headingAt(d), pitch: 0, bob: 0 };
}

/** One frame of src/main.js's `step`, with the keys given as f/r in [-1, 1].
 *  `sp` is the Space key: it jumps only from the ground, as in the page. */
function step(pl, f, r, speed, sp) {
  let ax = 0, az = 0;
  if (f || r) {
    const s = Math.sin(pl.yaw), c = Math.cos(pl.yaw);
    ax = s * f + c * r;
    az = -c * f + s * r;
    const l = Math.hypot(ax, az) || 1;
    ax = ax / l * speed; az = az / l * speed;
  }
  if (!pl.air) {
    const k = 1 - Math.exp(-12 * DT);
    pl.vx += (ax - pl.vx) * k;
    pl.vz += (az - pl.vz) * k;
    if (!f && !r && Math.hypot(pl.vx, pl.vz) < 0.004) { pl.vx = 0; pl.vz = 0; }
  }

  /* The jump, after the ground acceleration, with the same push-off as the page. */
  if (sp && !pl.air) {
    pl.air = true; pl.vy = JUMP_V;
    const l = Math.hypot(ax, az);
    if (l) {
      const v = Math.max(Math.hypot(pl.vx, pl.vz), 1.55);
      pl.vx = ax / l * v; pl.vz = az / l * v;
    }
  }

  /* Confinement runs airborne too, which is the reason a jump cannot be used to
     cross the corridor: the limit is on lateral velocity and the arc has no
     steering of its own to spend. */
  const hit = confine(corridor, path, pl, path.atZ(pl.z, _q), DT);

  pl.x += pl.vx * DT;
  pl.z += pl.vz * DT;

  const g0 = groundAt(pl.x, pl.z);
  if (pl.air) {
    pl.vy -= G * DT;
    pl.y += pl.vy * DT;
    if (pl.y <= g0) { pl.y = g0; pl.vy = 0; pl.air = false; }
  } else {
    pl.y = g0;
  }
  return hit;
}

function state(pl) {
  const q = path.atZ(pl.z, _q);
  const u = (pl.x - q.x) * Math.cos(q.th);
  return { s: q.s, u, lim: corridorAt(corridor, q.s, u >= 0 ? 1 : -1) };
}

let fails = 0;
const check = (ok, name, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
};

console.log('\nwalk test — the corridor, driven\n');

/* ── 1. the walk itself ────────────────────────────────────────────────────
 * A walker who follows the wash but does not follow it perfectly. The steer
 * holds a wandering lateral target rather than the centreline, because nobody
 * walks a line: this one drifts up to about four metres either side, which is
 * more than a person following a channel actually does. */
{
  const pl = spawn(0);
  let side = 0, ends = 0, endFrom = Infinity, maxU = 0, minHead = Infinity;
  let t = 0, worstS = 0, far = -Infinity;
  for (let n = 0; n < 120 * 400; n++) {
    t += DT;
    const st = state(pl);
    if (st.s > far) far = st.s;
    if (st.s > corridor.sMax - 0.05) break;
    const want = 4.0 * Math.sin(t * 0.11) + 2.0 * Math.sin(t * 0.037 + 1.3);
    /* Steer toward the wandering target: heading, plus a correction bounded at
       thirty degrees so it is a walk and not a slalom. */
    const corr = Math.max(-0.52, Math.min(0.52, (want - st.u) * 0.25));
    pl.yaw = path.headingAt(st.s) + corr;
    const hit = step(pl, 1, 0, 1.55);
    if (hit & 1) side++;
    if (hit & 2) { ends++; endFrom = Math.min(endFrom, corridor.sMax - st.s); }
    const au = Math.abs(st.u);
    if (au > maxU) maxU = au;
    if (st.lim - au < minHead) { minHead = st.lim - au; worstS = st.s; }
  }
  check(far > corridor.sMax - 0.5, 'the whole route is walkable',
        `reached s=${far.toFixed(1)} of ${corridor.sMax.toFixed(1)} in ${(t / 60).toFixed(1)} min`);
  check(side === 0, 'never nudged sideways while walking the walk',
        `${side} frames touched, |u| peaked at ${maxU.toFixed(2)} m`);
  check(minHead > BAND, 'never even entered the lateral soft band',
        `closest approach ${minHead.toFixed(2)} m of clearance at s=${worstS.toFixed(0)}`);
  /* The other limit is *supposed* to be felt, once, at the head of the walk —
     that is what arriving somewhere is. What must not happen is meeting it
     early, so what is checked is where it first engages and not whether. */
  check(!ends || endFrom <= BAND + 0.05, 'the head of the wash is the only stop',
        ends ? `first felt ${endFrom.toFixed(2)} m short of the head` : 'never reached');
}

/* ── 2. walking straight at a wall ───────────────────────────────────────── */
for (const d of [8, 46, 120, 220, 300]) {
  for (const r of [1, -1]) {
    const pl = spawn(d);
    /* Turbo, which is the 12 m/s cheat and the fastest anything can arrive at
       the limit. Sixty seconds of it is 720 m of shoving. */
    let over = 0, maxOver = 0;
    for (let n = 0; n < 120 * 60; n++) {
      step(pl, 0, r, 12);
      const st = state(pl);
      const x = Math.abs(st.u) - st.lim;
      if (x > 1e-3) { over++; if (x > maxOver) maxOver = x; }
    }
    const st = state(pl);
    check(Math.abs(st.u) <= st.lim + 0.01,
          `held at d=${d} strafing ${r > 0 ? 'right' : 'left '}`,
          `|u|=${Math.abs(st.u).toFixed(2)} against a limit of ${st.lim.toFixed(2)}` +
          (over ? `  (${over} frames up to ${maxOver.toFixed(3)} m outside)` : ''));
  }
}

/* ── 3. the two ends of the walk ─────────────────────────────────────────── */
{
  const pl = spawn(0);
  pl.yaw = path.headingAt(0) + Math.PI;      // turned round at the start
  for (let n = 0; n < 120 * 60; n++) step(pl, 1, 0, 12);
  const st = state(pl);
  check(st.s >= corridor.sMin - 0.01 && pl.z < 30, 'turned round and walked back',
        `s=${st.s.toFixed(2)} against a floor of ${corridor.sMin}, z=${pl.z.toFixed(1)}`);
}
{
  const pl = spawn(300);
  for (let n = 0; n < 120 * 60; n++) step(pl, 1, 0, 12);
  const st = state(pl);
  check(st.s <= corridor.sMax + 0.01, 'ran at the head of the wash',
        `s=${st.s.toFixed(2)} against a ceiling of ${corridor.sMax.toFixed(2)}`);
}

/* ── 4. the fixed point ──────────────────────────────────────────────────── */
{
  const pl = spawn(46);
  for (let n = 0; n < 600; n++) step(pl, 0, 0, 1.55);
  const p = path.posAt(46);
  check(pl.x === p.x && pl.z === p.z && pl.vx === 0 && pl.vz === 0,
        'standing still is still a fixed point',
        `dx=${(pl.x - p.x).toExponential(1)} dz=${(pl.z - p.z).toExponential(1)}`);
}

/* ── 5. the height field, everywhere the player can now reach ────────────── */
{
  let bad = 0, lo = Infinity, hi = -Infinity;
  for (let s = corridor.sMin; s <= corridor.sMax; s += 0.5) {
    const p = path.posAt(s);
    const th = path.headingAt(s);
    for (const side of [1, -1]) {
      const lim = corridorAt(corridor, s, side);
      for (let a = 0; a <= lim; a += 0.5) {
        const x = p.x + Math.cos(th) * side * a, z = p.z + Math.sin(th) * side * a;
        const h = terrain.heightAt(x, z);
        if (!Number.isFinite(h)) bad++;
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
    }
  }
  check(bad === 0, 'ground is finite over the whole reachable set',
        `y ${lo.toFixed(1)} .. ${hi.toFixed(1)} m`);
}

/* ── 6. jumping ──────────────────────────────────────────────────────────── */

/* The whole walk again, jumping the entire way — the key held down would only
   jump once, so this presses it fresh the instant it lands, which is the most a
   player can do and considerably more than one would. The corridor must be no
   more felt than it was on foot. */
{
  const pl = spawn(0);
  let side = 0, jumps = 0, maxU = 0, minHead = Infinity, worstS = 0;
  let bodyHead = Infinity, bodyS = 0;
  let t = 0, far = -Infinity, maxAir = 0, airFrom = 0;
  for (let n = 0; n < 120 * 400; n++) {
    t += DT;
    const st = state(pl);
    if (st.s > far) far = st.s;
    if (st.s > corridor.sMax - 0.05) break;
    const want = 4.0 * Math.sin(t * 0.11) + 2.0 * Math.sin(t * 0.037 + 1.3);
    const corr = Math.max(-0.52, Math.min(0.52, (want - st.u) * 0.25));
    if (!pl.air) pl.yaw = path.headingAt(st.s) + corr;   // no steering in the air
    const wasAir = pl.air;
    const hit = step(pl, 1, 0, 1.55, !pl.air);
    if (!wasAir && pl.air) { jumps++; airFrom = pl.y; }
    if (wasAir && !pl.air) maxAir = Math.max(maxAir, 0);
    if (hit & 1) side++;
    const au = Math.abs(st.u);
    if (au > maxU) maxU = au;
    if (st.lim - au < minHead) { minHead = st.lim - au; worstS = st.s; }
    /* The body of the wash, on the six-metre inset rock.js uses for the same
       reason. The head is where the walk ends and where the corridor is already
       sanctioned to be felt — the longitudinal check below has always exempted
       it — so a margin measured across the head is measuring the exception. */
    if (st.s < corridor.sMax - 6 && st.lim - au < bodyHead) {
      bodyHead = st.lim - au; bodyS = st.s;
    }
  }
  check(far > corridor.sMax - 0.5 && jumps > 100, 'the whole route is jumpable',
        `reached s=${far.toFixed(1)} in ${(t / 60).toFixed(1)} min over ${jumps} jumps`);
  check(side === 0, 'jumping the whole way never touches the corridor',
        `${side} frames touched, |u| peaked at ${maxU.toFixed(2)} m`);
  /* Two claims, deliberately separated. In the body of the wash the requirement
     is a real margin and it is asserted at three band widths. At the head the
     requirement is only that the band is not actually entered, because arriving
     somewhere is allowed to be felt — and reporting the head figure keeps it
     visible rather than hidden inside a pass. */
  check(bodyHead > 3 * BAND, 'jumping keeps a real margin through the wash',
        `closest approach ${bodyHead.toFixed(2)} m at s=${bodyS.toFixed(0)}, ` +
        `against a band of ${BAND}`);
  check(minHead > BAND, 'and never enters the band even at the head',
        `closest approach ${minHead.toFixed(2)} m at s=${worstS.toFixed(0)}`);
}

/* Jumping *at* the limit, at turbo, from both sides and at five stations. The
   question is whether the arc buys any ground the walk could not reach: it must
   not, because confinement runs airborne and the arc carries no steering. */
for (const d of [8, 46, 120, 220, 300]) {
  for (const r of [1, -1]) {
    const pl = spawn(d);
    let over = 0, maxOver = 0;
    for (let n = 0; n < 120 * 60; n++) {
      step(pl, 0, r, 12, !pl.air);
      const st = state(pl);
      const x = Math.abs(st.u) - st.lim;
      if (x > 1e-3) { over++; if (x > maxOver) maxOver = x; }
    }
    const st = state(pl);
    /* The reached-the-limit clause is not decoration. The first version of this
       test passed at |u| = 0.00 because the walker never left the spot, which is
       a check reporting success about a thing it never did. Requiring that the
       walker actually arrive at the wall is what makes the bound mean anything. */
    check(Math.abs(st.u) <= st.lim + 0.01 && Math.abs(st.u) > st.lim - 0.5,
          `jumped at the wall, d=${d} ${r > 0 ? 'right' : 'left '}`,
          `|u|=${Math.abs(st.u).toFixed(2)} against a limit of ${st.lim.toFixed(2)}` +
          (over ? `  (${over} frames up to ${maxOver.toFixed(3)} m outside)` : ''));
  }
}

/* Landing has to reseat on the field at any slope, so jump from every half metre
   of the route and from the full width of the corridor either side — the talus,
   the cut banks and the steep flanks at the head included — and require that the
   walker is back on the ground, exactly on it, within a second and a half. */
{
  let bad = 0, stuck = 0, worst = 0, deepest = 0, tested = 0;
  for (let s = corridor.sMin; s <= corridor.sMax; s += 2) {
    for (const side of [1, -1]) {
      const lim = corridorAt(corridor, s, side);
      for (let a = 0; a <= lim; a += Math.max(1, lim / 6)) {
        const p = path.posAt(s), th = path.headingAt(s);
        const pl = spawn(s);
        pl.x = p.x + Math.cos(th) * side * a;
        pl.z = p.z + Math.sin(th) * side * a;
        pl.y = groundAt(pl.x, pl.z);
        if (!Number.isFinite(pl.y)) { bad++; continue; }
        tested++;
        step(pl, 1, 0, 4.2, true);           // jog, jumping
        let air = 0;
        while (pl.air && air < 120 * 1.5) { step(pl, 1, 0, 4.2, false); air++; }
        if (pl.air) stuck++;
        worst = Math.max(worst, air / 120);
        const g = groundAt(pl.x, pl.z);
        if (!Number.isFinite(pl.y) || Math.abs(pl.y - g) > 1e-9) deepest++;
      }
    }
  }
  check(bad === 0 && stuck === 0, 'every landing reseats on the height field',
        `${tested} jumps from the whole corridor, longest airtime ${worst.toFixed(2)} s`);
  check(deepest === 0, 'and lands exactly on it, never in it or above it',
        `${deepest} of ${tested} off the surface`);
}

/* And the fixed point again, because the jump added a branch to the integrator
   and a capture is a still frame of a player who is not pressing anything. */
{
  const pl = spawn(46);
  for (let n = 0; n < 600; n++) step(pl, 0, 0, 1.55, false);
  const p = path.posAt(46);
  check(pl.x === p.x && pl.z === p.z && pl.vx === 0 && pl.vz === 0 &&
        pl.vy === 0 && pl.air === false,
        'standing still is a fixed point with jump in the loop',
        `dx=${(pl.x - p.x).toExponential(1)} vy=${pl.vy} air=${pl.air}`);
}

console.log(`\n  ${fails ? `${fails} FAILED` : 'all ok'}\n`);
process.exit(fails ? 1 : 0);
