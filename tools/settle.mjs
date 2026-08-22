/* Convergence settle for the capture tools.
 *
 * Replaces `await page.waitForTimeout(400)`, which was a settle measured in wall
 * clock and therefore a settle that silently bought fewer and fewer frames as
 * the work per frame went up. Four hundred milliseconds is about a hundred
 * frames at 800x450 and thirteen to twenty-four at 1440p, and fewer again while
 * another agent holds the render lock and the machine is busy — so the settle
 * was weakest exactly at the resolutions used for handoffs and exactly when two
 * runs were most likely to be compared against each other. The failure mode is
 * the bad kind: an under-settled capture is byte-different from a settled one,
 * which is indistinguishable from a real regression, and this project has
 * already spent real time on measurements that turned out to be about something
 * other than what they named.
 *
 * What this does instead: run frames until the frame the harness would capture
 * stops changing. The criterion is the *captured* frame, not an elapsed time and
 * not a frame count, so it is invariant to resolution, to machine load and to
 * how many other agents are rendering.
 *
 * Three things make that safe:
 *
 *   - A floor of `minFrames` before any check, so convergence cannot be declared
 *     on a scene that has not started moving yet. The default is 90, chosen to be
 *     at or above what the old 400 ms bought in its *best* case (about 100 frames
 *     at 800x450), so this is never a weaker settle than the one it replaces.
 *   - `stable` consecutive identical hashes, `gap` frames apart, rather than one
 *     match. A single match can happen across a frame that has not yet begun to
 *     change.
 *   - A wall-clock ceiling, because there are genuinely animated terms in this
 *     scene and some framings may never converge. The ceiling is a backstop, not
 *     the mechanism.
 *
 * And it reports how it exited. A settle that quietly falls back to its ceiling
 * is the same silent under-settle in a new costume, so `exit` is returned,
 * printed on the view's line, and written into the run manifest. If you see
 * `ceiling` on a framing, the captures from it are not established as stable and
 * nobody should read a byte diff on them as a regression.
 *
 * The hash mirrors the capture path exactly — `setPaused(true)`, `renderOnce()`,
 * read, unpause — because that is what tools/harness.mjs `capture` does, and a
 * settle that converges on a frame the harness does not take would be measuring
 * the wrong thing. It reads the whole framebuffer and hashes every `stride`-th
 * pixel: the read is the cost and it is complete, the stride only bounds the
 * JavaScript, and a change large enough to matter cannot miss a stride-2 grid.
 */

const DEFAULTS = { minFrames: 90, stable: 3, gap: 5, maxMs: 15000, stride: 2 };

export async function settle(page, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return await page.evaluate(async (o) => {
    const g = window.__game;
    if (!g || !g.renderer || !g.renderOnce || !g.setPaused) {
      throw new Error('settle: window.__game is not the capture API described in CONTRACT.md');
    }
    const gl = g.renderer.getContext();
    const cv = g.renderer.domElement;
    const t0 = performance.now();
    const tick = () => new Promise(r => requestAnimationFrame(() => r()));
    let frames = 0, buf = null, bw = 0, bh = 0;

    const hash = () => {
      const w = cv.width, h = cv.height;
      if (!buf || bw !== w || bh !== h) { buf = new Uint8Array(w * h * 4); bw = w; bh = h; }
      g.setPaused(true);
      g.renderOnce();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      g.setPaused(false);
      let a = 0x811c9dc5 >>> 0;
      const step = 4 * o.stride;
      for (let i = 0; i < buf.length; i += step) {
        a = Math.imul(a ^ buf[i], 16777619);
        a = Math.imul(a ^ buf[i + 1], 16777619);
        a = Math.imul(a ^ buf[i + 2], 16777619);
      }
      return a >>> 0;
    };

    const over = () => performance.now() - t0 >= o.maxMs;
    for (let i = 0; i < o.minFrames && !over(); i++) { await tick(); frames++; }

    let prev = null, same = 1, checks = 0;
    for (;;) {
      const h = hash();
      checks++;
      same = (prev !== null && h === prev) ? same + 1 : 1;
      prev = h;
      const ms = Math.round(performance.now() - t0);
      /* `hash` is returned so the settle can be shown to be measuring something.
         Two different viewpoints must hash differently; a settle whose hash is
         constant has converged on a readback that is not the frame, and would
         report success on every capture forever. */
      if (same >= o.stable) return { exit: 'converged', frames, checks, ms, hash: h };
      if (over()) return { exit: 'ceiling', frames, checks, ms, same, hash: h };
      for (let i = 0; i < o.gap && !over(); i++) { await tick(); frames++; }
    }
  }, o);
}

/* The boot pass is a different job and wants a different instrument.
 *
 * Its purpose is to get procedural textures and deferred geometry resident, not
 * to establish that the frame has stopped moving — and it *cannot* establish
 * that, because before the first `walkTo` the atmosphere and grain clocks are
 * free-running rather than keyed to the station, so the frame legitimately never
 * converges. Measured: 1605 frames and 30 s without two matching hashes. Running
 * the convergence settle here would burn its whole ceiling on every capture and
 * then report a scary `ceiling` for something working exactly as designed.
 *
 * So this is a frame count with a wall-clock backstop — which is still the fix,
 * because a frame count is what does not shrink when the resolution goes up.
 */
export async function warmup(page, opts = {}) {
  const frames = opts.frames ?? 180;
  const maxMs = opts.maxMs ?? 20000;
  return await page.evaluate(async ({ frames, maxMs }) => {
    const t0 = performance.now();
    const tick = () => new Promise(r => requestAnimationFrame(() => r()));
    let n = 0;
    while (n < frames && performance.now() - t0 < maxMs) { await tick(); n++; }
    const ms = Math.round(performance.now() - t0);
    return { exit: n >= frames ? 'frames' : 'ceiling', frames: n, ms };
  }, { frames, maxMs });
}

/** One-line form for a capture log. Loud when it did not converge. */
export function settleTag(s) {
  const n = `${s.frames}f/${(s.ms / 1000).toFixed(1)}s`;
  if (s.exit === 'converged') return `settle=${n} #${s.hash.toString(16).padStart(8, '0')}`;
  if (s.exit === 'frames') return `warmup=${n}`;
  return `settle=CEILING ${n} NOT STABLE`;
}
