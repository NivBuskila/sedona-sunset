/* Capture a handoff set twice: once graded, once with System 7's post chain off.
 *
 *   node tools/postpair.mjs sys7b
 *   node tools/postpair.mjs probe --only sun_gap,wall_lit --w 800 --h 450
 *
 * Produces `shots/<tag>_*.png` (the graded set of record) and
 * `shots/<tag>_nopost_*.png` (the ungraded control), plus both manifests.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * A post chain arriving between two of another system's captures looks exactly
 * like a material regression. System 1's builder lost three comparisons that
 * way when this chain first landed mid-session: several systems are judged on
 * `hf/lf`, saturation and hue, all three of which a grade moves, and without an
 * ungraded frame of the same viewpoint there is no way to tell whose change did
 * it. So every handoff from System 7 ships with the control alongside it, and
 * this makes that one command instead of a habit somebody has to remember.
 *
 * ── why it freezes src/ first ───────────────────────────────────────────────
 *
 * Five agents are committing into this tree. The two halves of a pair are eight
 * captures and several minutes apart, so a control rendered from whatever src/
 * happened to contain by the time the first run finished is not a control — it
 * differs from its partner by an unknown number of other people's edits, which
 * is the exact confusion this is supposed to remove.
 *
 * So src/ is byte-copied once, and both runs are pointed at the copy through
 * GAME_FILE, which harness.mjs already supports. The graded half still runs
 * tools/shoot.mjs unmodified and still writes the normal manifest; the only
 * thing that changes is which HTML file names the entry point. The same trick
 * is what made the determinism check meaningful.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = path.join(DIR, 'pairsrc');
const HTML = path.join(DIR, 'index.pair.html');

const args = process.argv.slice(2);
const tagGiven = !!args[0] && !args[0].startsWith('--');
const tag = tagGiven ? args[0] : 'pair';

/* The control half is `#nopost` unless told otherwise. `--ctrl grain=0` or
   `--ctrl fknee=100000` turns the same freeze-and-shoot-twice machinery into a
   single-term ablation, which is the only way to attribute a measured move to
   one term of the chain while the rest of the tree is being edited. */
const ci = args.indexOf('--ctrl');
const ctrl = ci < 0 ? 'nopost' : args[ci + 1];
const suffix = ctrl.replace(/[^a-z0-9]+/gi, '');
const pass = args.filter((a, i) =>
  !(tagGiven && i === 0) && i !== ci && i !== ci + 1);

/* Freeze src/ and give it an entry point. */
function freeze() {
  fs.rmSync(SNAP, { recursive: true, force: true });
  fs.cpSync(path.join(DIR, 'src'), SNAP, { recursive: true });
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
    .replace('/src/main.js', '/pairsrc/main.js');
  if (!html.includes('/pairsrc/main.js')) {
    throw new Error('index.html no longer imports /src/main.js — update postpair.mjs');
  }
  fs.writeFileSync(HTML, html);
  const files = fs.readdirSync(SNAP).filter(f => f.endsWith('.js'));
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(SNAP, f)).size, 0);
  console.log(`frozen ${files.length} modules, ${(bytes / 1024).toFixed(0)} kB → pairsrc/`);
}

function thaw() {
  fs.rmSync(SNAP, { recursive: true, force: true });
  fs.rmSync(HTML, { force: true });
}

function shoot(t, extra) {
  const argv = ['tools/shoot.mjs', t, ...pass, ...extra];
  console.log(`\n$ node ${argv.join(' ')}`);
  const r = spawnSync(process.execPath, argv, {
    cwd: DIR, stdio: 'inherit',
    env: { ...process.env, GAME_FILE: 'index.pair.html' },
  });
  if (r.status !== 0) throw new Error(`shoot ${t} exited ${r.status}`);
}

try {
  freeze();
  /* Graded first, so that if the second run is interrupted the set that exists
     is the one the critic looks at rather than half a control. */
  shoot(tag, []);
  shoot(`${tag}_${suffix}`, ['--hash', ctrl]);
  console.log(`\npair: shots/${tag}_*.png  vs  shots/${tag}_${suffix}_*.png  (#${ctrl})`);
  console.log('both from one frozen src/, so any difference between them is the chain');
} finally {
  thaw();
}
