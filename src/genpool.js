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
 * screen animates and the tab stays alive. The wall-clock win comes later and
 * separately, when independent stages run at the same time — the interface is
 * built for that (each call is its own worker, and callers may hold several
 * promises at once) but the boot still awaits them one at a time, and saying so
 * plainly is better than implying a speed-up that has not been measured.
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

let seq = 0;

/**
 * Compute one named stage in a worker.
 *
 * A worker per call, terminated when it answers. Pooling and reuse would matter
 * if stages were small and frequent; these are seconds long and there are a
 * handful in the whole life of the page, so a pool would be machinery guarding
 * nothing. The worker is torn down rather than parked because it holds the
 * generator graph it rebuilt — tens of megabytes of analytic fields — and the
 * boot has better uses for that memory.
 *
 * @param {string} stage a key in genworker.js's STAGES
 * @returns {Promise<object|null>} the stage's typed arrays, or null if it could
 *   not run off-thread for any reason at all, in which case the caller computes
 *   it locally.
 */
export async function runStage(stage) {
  if (!available) { genLog.local++; return null; }
  const t0 = performance.now();
  let worker = null;
  try {
    worker = new Worker(new URL('./genworker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    genLog.local++;
    genLog.why = 'construct';
    return null;
  }
  const id = ++seq;
  try {
    const out = await new Promise((resolve, reject) => {
      /* `error` fires for a worker that could not load its modules — the bare
         specifier case — and `messageerror` for a reply that would not clone.
         Both have to reject, or a boot on an engine that cannot run the worker
         waits on a promise nobody will ever settle. */
      worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
      worker.onmessageerror = () => reject(new Error('worker message error'));
      worker.onmessage = (e) => {
        if (e.data.id !== id) return;
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.out);
      };
      worker.postMessage({ id, stage });
    });
    genLog.worker++;
    genLog.ms += performance.now() - t0;
    return out;
  } catch (err) {
    genLog.local++;
    genLog.why = err.message;
    return null;
  } finally {
    worker.terminate();
  }
}
