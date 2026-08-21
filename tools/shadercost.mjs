/* Static cost of the shader source embedded in the JS template literals.
 *
 *   node tools/shadercost.mjs src/*.js
 *   node tools/shadercost.mjs --detail src/terrain.js
 *
 * A GPU cannot be profiled through SwiftShader, so before anything could be
 * optimised here something had to establish where the fragment cost was without
 * running it. This is that: it reads the same template literals
 * tools/glslcheck.mjs validates and counts, per literal, the things that
 * actually set the price of a pixel.
 *
 * What it counts and why each one:
 *
 *   fetch      texture2D / texture / texture2DGradEXT calls. On any modern part
 *              a dependent texture fetch is the unit of fragment cost that
 *              matters; twenty of them per pixel over half the screen is a
 *              different scene from five.
 *   uncond     of those, the ones not inside any `if` or loop — the ones every
 *              pixel pays whatever it is looking at. This is the number to
 *              attack, and the difference between it and `fetch` is the amount
 *              of work already behind a gate.
 *   loop       fetches inside a `for`, multiplied out by the trip count where
 *              it is a literal, because an eight-tap march is eight fetches and
 *              counting it as one hides the whole cost.
 *   deriv      dFdx / dFdy / fwidth. Each forces the quad to stay coherent and
 *              each is a real instruction, but more importantly a *branch*
 *              containing an implicitly-differentiated fetch is undefined, so
 *              this column is where to look when a gate cannot simply be added.
 *   alu        a crude proxy: sin/cos/pow/exp/log/normalize/smoothstep. Not a
 *              cycle count and not pretending to be. Useful only as a ratio
 *              between two versions of the same shader.
 *
 * Helper functions are charged to their call sites. Without that the figures
 * are badly wrong in both directions at once: a triplanar sampler declares
 * three fetches in the block of shared helpers, where nothing pays for them,
 * and the surface block that calls it four times appears to make no fetches at
 * all. So the fetch count of every function defined anywhere in the file is
 * resolved first, transitively, and a call to one costs what its body costs.
 *
 * Deliberately not a compiler. It cannot see the driver's dead-code
 * elimination, it counts a fetch inside a branch as one occurrence regardless
 * of how often that branch is taken, and it has no idea what fraction of the
 * screen each material covers. Every one of those is a judgement the reader has
 * to bring. What it does give is a number that changes when the shader changes,
 * which is what was missing.
 */
import { readFileSync } from 'node:fs';

const BT = String.fromCharCode(96);
const args = process.argv.slice(2);
const DETAIL = args.includes('--detail');
const files = args.filter(a => !a.startsWith('--'));

const FETCH = /\b(?:texture2D|texture2DGradEXT|texture2DLodEXT|textureGrad|textureLod|textureCube)\s*\(/g;
const DERIV = /\b(?:dFdx|dFdy|fwidth)\s*\(/g;
const ALU = /\b(?:sin|cos|tan|pow|exp|exp2|log|log2|sqrt|inversesqrt|normalize|smoothstep|refract|reflect)\s*\(/g;

/** Strip // and /* comments with a character scanner; a line-wise regex cannot
    tell a delimiter from body text. Same approach as glslcheck. */
function strip(g) {
  let out = '', inBlock = false;
  for (let k = 0; k < g.length; k++) {
    if (inBlock) { if (g[k] === '*' && g[k + 1] === '/') { inBlock = false; k++; } out += g[k] === '\n' ? '\n' : ''; continue; }
    if (g[k] === '/' && g[k + 1] === '*') { inBlock = true; k++; continue; }
    if (g[k] === '/' && g[k + 1] === '/') { while (k < g.length && g[k] !== '\n') k++; out += '\n'; continue; }
    out += g[k];
  }
  return out;
}

/* Brace depth is not enough on its own: a function body is depth 1 and is not
   conditional. So track the *kind* of each open brace, and call a fetch
   conditional when any enclosing block is an if/else/for/while. Blocks opened
   without a keyword — a bare scope, or a function body — do not count. */
/* Fetch cost of every function defined in the file, resolved transitively so a
   helper that calls a helper is charged for both. Bodies are located by brace
   matching from the declaration, which is enough for GLSL — it has no lambdas,
   no strings and, by this point, no comments. */
function functionCosts(src) {
  const decl = /^[ \t]*(?:float|vec2|vec3|vec4|mat2|mat3|mat4|void|bool|int)[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
  const bodies = new Map();
  for (let m; (m = decl.exec(src));) {
    let i = src.indexOf('{', m.index);
    if (i < 0) continue;
    let d = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}' && --d === 0) break;
    }
    /* From the declaration keyword, not from the brace: the header line carries
       the function's own name, and a call-site matcher cannot tell it from a
       call, so leaving it in charges every helper for defining itself. */
    if (!bodies.has(m[1])) bodies.set(m[1], src.slice(m.index, j + 1));
  }
  const cost = new Map();
  const resolve = (name, seen) => {
    if (cost.has(name)) return cost.get(name);
    if (seen.has(name)) return 0;             // recursion is not legal GLSL, but be safe
    seen.add(name);
    const body = bodies.get(name);
    if (body == null) return 0;
    let n = (body.match(FETCH) || []).length;
    for (const other of bodies.keys()) {
      if (other === name) continue;
      const calls = (body.match(new RegExp('\\b' + other + '\\s*\\(', 'g')) || []).length;
      if (calls) n += calls * resolve(other, seen);
    }
    cost.set(name, n);
    return n;
  };
  for (const k of bodies.keys()) resolve(k, new Set());
  /* A function's own body must not also be counted as call-site cost when the
     block it is declared in is scanned, so hand back where each body lives. */
  return { cost, bodies };
}

function scan(src, fnCost) {
  let depth = 0;
  const kind = [];          // stack of 'cond' | 'loop' | 'plain'
  let trip = [];            // loop trip counts, parallel to loop entries
  const r = { fetch: 0, uncond: 0, cond: 0, loopFetch: 0, deriv: 0, alu: 0, lines: [] };
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    /* The keyword that opens the block is on the same line as its brace in this
       codebase's style, and where it is not, the brace is on the next line with
       nothing else on it — so look back at the last non-empty line. */
    let pre = raw;
    if (/^\s*\{\s*$/.test(raw)) { for (let j = i - 1; j >= 0 && !pre.trim(); j--) pre = lines[j]; }

    let nFetch = (raw.match(FETCH) || []).length;
    for (const [name, c] of fnCost) {
      if (!c) continue;
      const calls = (raw.match(new RegExp('\\b' + name + '\\s*\\(', 'g')) || []).length;
      nFetch += calls * c;
    }
    const nDeriv = (raw.match(DERIV) || []).length;
    const nAlu = (raw.match(ALU) || []).length;

    const inLoop = kind.filter(k => k === 'loop').length > 0;
    const inCond = kind.some(k => k === 'cond' || k === 'loop');

    if (nFetch) {
      /* Multiply by the innermost literal trip count if there is one. */
      const mult = inLoop ? (trip[trip.length - 1] || 1) : 1;
      r.fetch += nFetch * mult;
      if (inLoop) r.loopFetch += nFetch * mult;
      if (inCond) r.cond += nFetch * mult; else r.uncond += nFetch * mult;
      if (DETAIL) r.lines.push(`      ${String(i + 1).padStart(5)}  ${inCond ? (inLoop ? 'loop x' + mult : 'cond  ') : 'ALWAYS'}  ${raw.trim().slice(0, 76)}`);
    }
    r.deriv += nDeriv;
    r.alu += nAlu;

    /* Now update the brace stack for this line. */
    for (let k = 0; k < raw.length; k++) {
      if (raw[k] === '{') {
        const head = (k === 0 ? pre : raw.slice(0, k));
        const isLoop = /\b(for|while)\s*\(/.test(head);
        const isCond = /\b(if|else)\b/.test(head);
        kind.push(isLoop ? 'loop' : isCond ? 'cond' : 'plain');
        if (isLoop) {
          /* for (int k = 1; k <= 8; k++) → 8. Only literal bounds; anything
             else counts as one so the figure is never invented. */
          const m = head.match(/;\s*\w+\s*[<>]=?\s*(\d+)\s*;/);
          const lo = head.match(/=\s*(\d+)\s*;/);
          trip.push(m ? Math.max(1, (+m[1] - (lo ? +lo[1] : 0)) + (/<=|>=/.test(head) ? 1 : 0)) : 1);
        }
        depth++;
      } else if (raw[k] === '}') {
        const was = kind.pop();
        if (was === 'loop') trip.pop();
        depth--;
      }
    }
  }
  return r;
}

/** Blank out the bodies of functions declared here, keeping the line count, so
    a definition is charged to whoever calls it and not to the block it sits in. */
function hollow(src, bodies) {
  let out = src;
  for (const body of bodies.values()) {
    const at = out.indexOf(body);
    if (at < 0) continue;
    out = out.slice(0, at) + body.replace(/[^\n]/g, ' ') + out.slice(at + body.length);
  }
  return out;
}

let tF = 0, tU = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  /* Every literal in the file, so a helper declared in one and called in
     another is resolved — which is exactly how this codebase is arranged. */
  const lits = [];
  let i = 0;
  while (true) {
    const a = s.indexOf(BT, i);
    if (a < 0) break;
    let b = a + 1;
    while (b < s.length) {
      if (s[b] === '\\') { b += 2; continue; }
      if (s[b] === BT) break;
      b++;
    }
    const g = s.slice(a + 1, b);
    if (g.length > 200) lits.push({ line: s.slice(0, a).split('\n').length, src: strip(g) });
    i = b + 1;
  }
  const { cost, bodies } = functionCosts(lits.map(l => l.src).join('\n'));
  const rows = [];
  for (const { line, src } of lits) {
    const r = scan(hollow(src, bodies), cost);
    if (r.fetch || r.deriv > 3 || r.alu > 40) rows.push({ line, r });
  }
  if (!rows.length) continue;
  console.log(`\n${f}`);
  console.log('   literal@line   fetch  uncond   cond    loop   deriv     alu');
  for (const { line, r } of rows) {
    console.log(`   ${String(line).padStart(12)}  ${String(r.fetch).padStart(6)}` +
                `  ${String(r.uncond).padStart(6)}  ${String(r.cond).padStart(5)}` +
                `  ${String(r.loopFetch).padStart(6)}  ${String(r.deriv).padStart(6)}` +
                `  ${String(r.alu).padStart(6)}`);
    if (DETAIL) r.lines.forEach(l => console.log(l));
    tF += r.fetch; tU += r.uncond;
  }
}
console.log(`\n   total fetches ${tF}, of which ${tU} unconditional\n`);
