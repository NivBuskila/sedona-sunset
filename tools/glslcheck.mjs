/* Cheap static check on the shader source embedded in the JS template literals.
   A render costs twenty-five minutes on the software rasteriser, and two of them
   have now been spent discovering that a block comment was left open or that a
   backtick inside a comment terminated the literal early. Neither failure is
   visible to node, because the file still parses — the damage only appears when
   the driver compiles the assembled string. Both are trivially detectable here. */
import { readFileSync } from 'node:fs';

const BT = String.fromCharCode(96);
let bad = 0;

for (const f of process.argv.slice(2)) {
  const s = readFileSync(f, 'utf8');
  let i = 0, n = 0;
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
    const line = s.slice(0, a).split('\n').length;
    if (g.length > 200) {
      n++;
      let d = 0, stray = 0;
      for (let k = 0; k < g.length - 1; k++) {
        if (g[k] === '/' && g[k + 1] === '*') { d++; k++; }
        else if (g[k] === '*' && g[k + 1] === '/') { d--; if (d < 0) { stray++; d = 0; } k++; }
      }
      if (d !== 0 || stray !== 0) {
        console.log(`${f}:${line} unclosed=${d} stray=${stray}`);
        bad++;
      }
      /* Prose left outside a comment, which is what the last render died on: a
         paragraph was appended after a block had already been closed, so the
         driver tried to compile English. The test that actually separates the two
         is that a line of GLSL essentially always carries one of ; { } ( ) = —
         declarations, calls, assignments and blocks all do — and a sentence
         carries none of them. Checking for a trailing full stop, which was the
         first attempt here, misses it: the offending line ended mid-sentence. */
      /* Comments stripped with a character scanner rather than per-line regexes.
         A line-at-a-time pass cannot tell an opening delimiter from body text and
         flags every multi-line comment in the file as prose, which is useless. */
      const lines = g.split('\n').map(() => '');
      let ln = 0, inBlock = false;
      for (let k = 0; k < g.length; k++) {
        if (g[k] === '\n') { ln++; continue; }
        if (inBlock) {
          if (g[k] === '*' && g[k + 1] === '/') { inBlock = false; k++; }
          continue;
        }
        if (g[k] === '/' && g[k + 1] === '*') { inBlock = true; k++; continue; }
        if (g[k] === '/' && g[k + 1] === '/') { while (k < g.length && g[k] !== '\n') k++; ln++; continue; }
        lines[ln] += g[k];
      }
      lines.forEach((t0, k) => {
        const t = t0.trim();
        if (!t || t.startsWith('#')) return;
        if (/[;{}()=]/.test(t)) return;
        if (!/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(t)) return;
        console.log(`${f}:${line + k} prose outside comment: ${t.slice(0, 62)}`);
        bad++;
      });

      /* Use before declaration. GLSL has no forward declarations, so calling a
         function defined further down the same literal is a compile error — and a
         shader that fails to compile does not fail loudly, it silently falls back,
         so the whole capture comes back rendered with three's default material and
         the sixteen minutes are gone. Cheap to catch: record where each function
         is defined and where each is first called, in the comment-stripped source,
         and complain if the call comes first. Only names defined in this literal
         are considered, so three's own library and the builtins are ignored. */
      const body = lines.join('\n');
      const defAt = new Map();
      const defRe = /^\s*(?:float|vec2|vec3|vec4|mat2|mat3|mat4|void|bool|int)\s+([A-Za-z_]\w*)\s*\(/gm;
      for (let m; (m = defRe.exec(body));) {
        if (!defAt.has(m[1])) defAt.set(m[1], body.slice(0, m.index).split('\n').length - 1);
      }
      const callRe = /([A-Za-z_]\w*)\s*\(/g;
      for (let m; (m = callRe.exec(body));) {
        const name = m[1];
        if (!defAt.has(name)) continue;
        const at = body.slice(0, m.index).split('\n').length - 1;
        /* The definition line itself is a match for its own name. */
        if (at <= defAt.get(name)) {
          if (at === defAt.get(name)) continue;
          console.log(`${f}:${line + at} calls ${name}(), declared below at ` +
                      `${f}:${line + defAt.get(name)}`);
          bad++;
        }
      }
    }
    i = b + 1;
  }
  console.log(`${f}  ${n} shader literals checked`);
}
process.exit(bad ? 1 : 0);
