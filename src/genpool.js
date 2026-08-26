/* Running a boot stage off the main thread, when that is possible.
 *
 * The cold boot is about seventy seconds and almost all of it is arithmetic on
 * the main thread, which is why the tab does not answer a click while it works:
 * not because the work is heavy in itself, but because the one thread that could
 * repaint is the thread doing it. This module is the seam through which a stage
 * moves to another thread. `bake.js` already established that these stages are
 * pure — it caches their output, byte for byte, across visits — and this uses
 * exactly that property for a different purpose.
 *
 * ── what this does and does not promise
 *
 * It does not make the arithmetic faster. A stage moved here costs the same
 * milliseconds of CPU; what changes is *which* thread spends them, so the loading
 * screen animates and the tab stays alive.
 *
 * The wall-clock win is a separate property, and it comes from running
 * independent stages at the same time: each call is its own worker and callers
 * may hold several promises at once, so the boot groups the stages that share
 * nothing — the two wall curtains, the terrain mesh, the stone placement, the
 * eight surface maps — and waits once instead of in turn. What that cannot do is
 * reorder anything a later stage reads: see startScatterPlan in scatter.js for
 * the one case where the computation moves and the application does not.
 *
 * ── every path degrades
 *
 * Same discipline as the bake store: there is no error path that reaches the
 * caller. No `Worker`, a worker that fails to construct, a module that will not
 * load inside one, a thrown stage, a browser with `hardwareConcurrency` of 1 —
 * every one of them returns null, and `run`'s caller computes the stage on the
 * main thread the way it always did. The feature is an optimisation, and an
 * optimisation that can break the boot is not one.
 */

/* One core is the main thread's. On a single-core machine there is no thread to
   move work *to*: a worker there would contend with the thread it is trying to
   keep responsive, which is worse than not bothering. */
const available = (() => {
  if (typeof Worker === 'undefined') return false;
  const n = navigator.hardwareConcurrency;
  return !(n > 0 && n < 2);
})();

/* What happened, for the boot report — the same reason `bakeLog` exists. A stage
   that quietly ran on the main thread all along is the failure mode here, and it
   is invisible without this. */
export const genLog = { worker: 0, local: 0, ms: 0, why: available ? null : 'no-worker' };

/* ── the pool ──────────────────────────────────────────────────────────────
 *
 * This was a worker per call, terminated when it answered, on the reasoning that
 * the stages are seconds long and a pool would be machinery guarding nothing.
 * That reasoning held while the stages *were* all seconds long. It stopped
 * holding when the eight surface maps moved here: the smallest is a 256 map, and
 * spawning a worker for it means loading and parsing Three.js to do a few hundred
 * milliseconds of arithmetic. Measured, the eight maps were 6.4 s of work and
 * moving them saved 2.1 s of boot — the rest went to spawning.
 *
 * So workers are reused. Two things follow, and both are the point:
 *   - the module graph is loaded once per worker instead of once per stage;
 *   - the generator graph inside a worker is built once and reused, which is why
 *     genworker.js keeps it as a singleton and why the scatter stage there is
 *     careful to mutate a terrain of its own.
 *
 * Sized to the core count, not to one less. Leaving a core for the main thread is
 * the usual rule and it is wrong here: during these phases the main thread is
 * *waiting* on the promises, not computing, so a core held back for it is a core
 * not spent on the boot. Held back, the four-stage burst — mesh, two curtains,
 * stones — would have to run three-wide and finish on the slowest pair in series
 * rather than on the slowest single stage.
 *
 * Capped at four regardless. Each worker holds its own analytic fields, and past
 * that point the memory is real while the throughput is not; over-subscribing
 * cannot deadlock, the OS would timeslice, it just stops helping. Floor of two so
 * a burst still overlaps on a two-core machine — `available` has already ruled out
 * the single-core case, where there is no thread to move work to at all.
 *
 * Workers are reaped once the queue drains rather than parked for the rest of the
 * boot. A parked worker holds the generator graph it built, tens of megabytes the
 * later phases have better uses for, and the boot's calls arrive in bursts —
 * eight maps, then the mesh and the walls and the stones — so a reaped pool costs
 * one extra round of spawns per burst and hands the memory back in between.
 */
const SIZE = Math.min(4, Math.max(2, navigator.hardwareConcurrency || 2));

/* Read by callers that split one stage into pieces, so the number of pieces
   matches the number of threads that can hold them: more pieces than workers just
   queues, fewer leaves a worker idle. Exported as the pool's width, not as a core
   count — the cap and the floor above are part of the answer. */
export const poolWidth = SIZE;

let seq = 0;
const queue = [];   /* jobs waiting for a worker */
const pool = [];    /* every worker that exists right now */

/* Set when a worker fails at the *worker* level — the module graph would not load
   inside one, the bare-specifier case. That is a property of the page, not of the
   stage, so retrying it once per remaining stage would spawn a series of workers
   that are all going to fail the same way. Everything goes local from then on.
   A stage that *throws* is a different thing and does not set this: that job falls
   back alone and the pool stays up. */
let broken = false;

function spawn() {
  let w = null;
  try {
    w = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    broken = true;
    genLog.why = 'construct';
    return null;
  }
  const h = { w, job: null };
  w.onmessage = (e) => {
    if (!h.job || e.data.id !== h.job.id) return;
    finish(h, e.data.error ? null : e.data.out, e.data.error || null);
  };
  /* Fires for a worker that could not load its modules, and for anything thrown
     outside the message handler. Either way this worker is not usable again. */
  w.onerror = (e) => {
    broken = true;
    genLog.why = e.message || 'worker error';
    retire(h);
    if (h.job) finish(h, null, genLog.why, true);
    drainLocal();
  };
  /* A reply that would not structured-clone. The job has to settle or the boot
     waits on it forever. */
  w.onmessageerror = () => {
    if (h.job) finish(h, null, 'worker message error');
  };
  pool.push(h);
  return h;
}

function retire(h) {
  const i = pool.indexOf(h);
  if (i >= 0) pool.splice(i, 1);
  try { h.w.terminate(); } catch { /* already gone */ }
}

/* Hand every waiting job back to its caller to compute locally. Only for `broken`
   — there is no worker coming for them. */
function drainLocal() {
  while (queue.length) {
    genLog.local++;
    queue.shift().resolve(null);
  }
}

function finish(h, out, err, gone = false) {
  const job = h.job;
  h.job = null;
  if (out) {
    genLog.worker++;
    genLog.ms += performance.now() - job.t0;
  } else {
    genLog.local++;
    if (err) genLog.why = err;
  }
  job.resolve(out);
  if (!gone) pump();
}

function pump() {
  if (broken) { drainLocal(); return; }
  for (const h of pool) {
    if (!queue.length) break;
    if (!h.job) dispatch(h, queue.shift());
  }
  while (queue.length && pool.length < SIZE) {
    const h = spawn();
    if (!h) { drainLocal(); return; }
    dispatch(h, queue.shift());
  }
  /* Drained: nothing waiting and nothing running. Hand the memory back. */
  if (!queue.length && !pool.some((p) => p.job)) {
    for (const h of [...pool]) retire(h);
  }
}

function dispatch(h, job) {
  job.id = ++seq;
  job.t0 = performance.now();
  h.job = job;
  h.w.postMessage({ id: job.id, stage: job.stage, arg: job.arg });
}

/**
 * Compute one named stage in a worker.
 *
 * @param {string} stage a key in genworker.js's STAGES
 * @param {object|null} arg structured-cloneable parameters for the stage, for the
 *   stages that come in pieces — a band of terrain rows, say. Most take none.
 * @returns {Promise<object|null>} the stage's typed arrays, or null if it could
 *   not run off-thread for any reason at all, in which case the caller computes
 *   it locally. Callers may hold many of these at once; that is how the boot gets
 *   its wall-clock win.
 */
export async function runStage(stage, arg = null) {
  if (!available || broken) { genLog.local++; return null; }
  return new Promise((resolve) => {
    queue.push({ stage, arg, resolve });
    pump();
  });
}
