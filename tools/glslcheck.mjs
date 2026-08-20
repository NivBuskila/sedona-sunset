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
    }
    i = b + 1;
  }
  console.log(`${f}  ${n} shader literals checked`);
}
process.exit(bad ? 1 : 0);
