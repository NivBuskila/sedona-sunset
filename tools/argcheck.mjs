/* Argument guards for the probes.
 *
 * The rule these enforce, which now has four instances on this project: **a tool
 * that measures nothing must not print a number.** `grad.mjs` turned an
 * unrecognised flag into a NaN crop, selected no pixels and printed a header
 * with no rows — which reads as an empty measurement rather than as a bad
 * argument. `_p7name.mjs` silently measured nothing when given a mode that does
 * not exist. Both have been fixed to name the mistake and exit non-zero.
 *
 * The failure is worse than it sounds, because on this project a measurement
 * that comes back empty or zero is usually *interesting* — it is what an
 * ablation looks like when it works, it is what a byte-identical control looks
 * like, and it is what a defect looks like when it has been fixed. An instrument
 * that produces that same answer in response to a typo is producing the single
 * most misleading output available to it. Refusing costs one line.
 *
 * Use `die` for anything the tool cannot honour, and `nonEmpty` immediately
 * before the first number is printed, so a selection that matched nothing can
 * never be reported as a result.
 */

const NAME = (process.argv[1] || 'tool').split(/[\\/]/).pop().replace(/\.mjs$/, '');

/** Print to stderr and exit non-zero. Never returns. */
export function die(msg) {
  console.error(`${NAME}: ${msg}`);
  process.exit(2);
}

/** A finite number, or refuse. `undefined` yields the default if one is given. */
export function finite(label, v, dflt) {
  if (v === undefined || v === null || v === '') {
    if (dflt !== undefined) return dflt;
    die(`${label} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) die(`${label} wants a number, got "${v}"`);
  return n;
}

/** One of a known set, or refuse — with the set named, since a typo is the case. */
export function oneOf(label, v, allowed, dflt) {
  if (v === undefined || v === null) {
    if (dflt !== undefined) return dflt;
    die(`${label} is required — one of: ${allowed.join(', ')}`);
  }
  if (!allowed.includes(v)) die(`${label} "${v}" is not known. Expected one of: ${allowed.join(', ')}`);
  return v;
}

/** Refuse to report on an empty selection. Call before printing anything. */
export function nonEmpty(label, n, hint = '') {
  if (!n) die(`${label} selected nothing, so there is nothing to report.${hint ? ' ' + hint : ''}`);
  return n;
}
