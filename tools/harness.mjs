/* Shared plumbing for every headless probe: a static file server, a Chromium
   launched under tight CPU constraints, and a teardown that actually runs.

   The constraints are not optional politeness. SwiftShader is a software
   rasteriser — there is no GPU involved — so a headless run of this game will
   take every thread it can reach and hold them at 100%. The machine these
   tests run on is usually also being played on, and an unconstrained run makes
   that unplayable. Three separate mechanisms, because each covers a different
   gap:

     · lowprio.cmd sets affinity and priority on the node process before it
       starts, which Chromium children inherit.
     · the launch flags below stop Chromium spawning the sprawl in the first
       place, which is better than throttling it afterwards.
     · pinChildren() catches the workers Chromium spawns late, which inherit
       nothing useful if node was started directly rather than via lowprio.cmd.

   Import `run()` and put the body of the probe inside it. Anything that throws
   still closes the browser, which is the difference between a failed test and
   a headless tab quietly rendering at full tilt until the machine is rebooted. */
import { chromium } from 'playwright';
/* Process-level net under all of the above: signal and uncaught-exception
   handlers, and an unref on every server this process opens. run()'s own
   try/finally covers a throw inside the probe body; this covers the rest,
   including Ctrl-C and anything that fails before run() is reached. */
import './tame.mjs';
import { exec } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* Must agree with tame.mjs, which sets the same two budgets: four of twelve
   logical cores at Idle while the user is at the keyboard, ten of twelve at
   BelowNormal when they have handed the machine over (RENDER_BUDGET=unattended).
   If these two disagree the later writer wins and the cap is whatever it happens
   to be, which is the sort of thing that is only noticed when a game stutters. */
const UNATTENDED = process.env.RENDER_BUDGET === 'unattended' ||
  fs.existsSync(new URL('../.unattended', import.meta.url));
/* The core cap exists to stop a CPU rasteriser eating the machine. On the GPU
   there is nothing to cap — the CPU only feeds draw calls — and pinning to four
   idle cores there just starves the submission thread and hides the speedup. */
const GPU_MODE = process.env.RENDER_GPU === '1' ||
  fs.existsSync(new URL('../.gpu', import.meta.url));
const AFFINITY = GPU_MODE ? 0xFFF : (UNATTENDED ? 0x3FF : 0xF00);
const CORES = GPU_MODE ? 12 : (UNATTENDED ? 10 : 4);
const CHILD_PRIO = GPU_MODE ? 'Normal' : (UNATTENDED ? 'BelowNormal' : 'Idle');

/* Chromium keeps renaming the headless binary between versions, and Playwright
   may use either depending on channel; pin whichever shows up. */
const PIN = 'powershell -NoProfile -Command "' +
  "Get-Process chrome-headless-shell,chrome,headless_shell -ErrorAction SilentlyContinue | " +
  `ForEach-Object { try { $_.PriorityClass = '${CHILD_PRIO}'; $_.ProcessorAffinity = ${AFFINITY} } catch {} }"`;

function pinChildren() {
  const go = () => exec(PIN, () => {});
  go();
  const t = setInterval(go, 2500);
  t.unref();
  return () => clearInterval(t);
}

/* Which rasteriser. SwiftShader is the default because it cannot touch the GPU
   at all, so a capture can never steal frames from a game running on the same
   machine. That safety costs about three orders of magnitude: a frame this scene
   draws in under a millisecond on a discrete GPU takes two to three minutes on a
   CPU rasteriser, and a full eight-view set takes twenty.

   GPU mode exists for when the machine is free. Create a `.gpu` file in the
   project root, or set RENDER_GPU=1. Delete it before gaming — a headless
   capture on the real device is exactly the contention this harness was built to
   avoid.

   Note the two modes do not produce identical images: drivers differ from
   SwiftShader in filtering, precision and dithering. GPU output is the one that
   matches what a player sees, so it is the better reference; just do not compare
   a GPU capture against a SwiftShader one pixel for pixel and read the
   difference as a regression. */
const USE_GPU = process.env.RENDER_GPU === '1' ||
  fs.existsSync(new URL('../.gpu', import.meta.url));

const RASTER_ARGS = USE_GPU
  ? ['--use-angle=d3d11', '--enable-gpu-rasterization', '--enable-zero-copy',
     '--ignore-gpu-blocklist', '--enable-webgl',
     // Headless defaults to a software GL unless the GPU is explicitly allowed
     // through; without these two the run silently falls back and the only
     // symptom is that it is mysteriously still slow.
     '--enable-features=Vulkan,VaapiVideoDecoder', '--use-gl=angle']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
     '--ignore-gpu-blocklist', '--enable-webgl',
     // SwiftShader has no thread-count flag — it sizes its pool from
     // hardware_concurrency — so affinity is the only real cap on it, and that
     // is applied to the processes rather than passed in here.
     '--js-flags=--single-threaded-gc'];

export const LAUNCH_ARGS = [
  ...RASTER_ARGS,
  '--disable-lcd-text',
  /* The scene has a soundscape, and a headless capture is still a browser: with
     autoplay allowed it happily plays it out of the user's speakers while they
     are doing something else. Muting is unconditional because no capture has
     ever needed audible output — the audio system is measured by rendering its
     graph offline through an OfflineAudioContext, not by listening to a render.
     Autoplay stays allowed so the audio code still runs and can still throw a
     page error we want to see. */
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  // One renderer process rather than one per frame/site. Chromium sizes its
  // process and thread pools from the machine's core count, then fights
  // itself over the four cores affinity actually allows it.
  '--renderer-process-limit=1', '--disable-dev-shm-usage',
  '--disable-features=CalculateNativeWinOcclusion,site-per-process',
  '--disable-background-timer-throttling',
];

/* A wrong content-type on a .js file is fatal rather than cosmetic: the browser
   refuses to evaluate an ES module served as octet-stream, so the import graph
   never loads and the page hangs waiting for a __game that is never created. */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm',
};

/** Serve the project directory on an ephemeral port. */
export function serve(root = path.resolve('.')) {
  const srv = http.createServer((rq, rs) => {
    const f = path.join(root, rq.url === '/' ? 'index.html' : decodeURI(rq.url.split('?')[0]));
    fs.readFile(f, (e, d) => e
      ? (rs.writeHead(404), rs.end())
      : (rs.writeHead(200, {
          'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
        }), rs.end(d)));
  });
  return srv;
}

/**
 * Render exactly one frame and save it.
 *
 * page.screenshot() waits for the compositor to produce a fresh frame, which
 * it shares with the game's own render loop. A frame of this scene costs tens
 * of seconds on a software rasteriser, so the two racing for the GL context
 * routinely blows the screenshot timeout. Pausing the loop and reading the
 * canvas back makes capture deterministic and roughly twice as fast.
 *
 * The readback has to happen in the same task as the draw: the renderer has no
 * preserveDrawingBuffer, so the buffer is gone by the next task.
 */
export async function capture(page, file) {
  const png = await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true);
    g.renderOnce();
    const url = g.renderer.domElement.toDataURL('image/png');
    g.setPaused(false);
    return url;
  });
  fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
}

/**
 * Boot server + browser + page, hand them to `body`, and guarantee teardown.
 * `hash` goes on the URL, which is how the game's own switches are set. The one
 * that matters for capture is the tier name — `#medium` pins the quality tier and
 * stops the adaptive system moving it. Without that every headless capture is of
 * the potato tier, because SwiftShader is slow enough that adaptation walks all
 * the way down within a couple of seconds, and a screenshot taken there is not a
 * picture of what anyone with a GPU sees.
 *
 * @param {{width?:number,height?:number,waitReady?:boolean,extraArgs?:string[],hash?:string}} opts
 * @param {(ctx:{page:any,url:string,errs:string[],browser:any}) => Promise<void>} body
 */
/* One capture at a time, enforced rather than requested.
 *
 * Several agents build different systems in parallel and each is told to run a
 * single capture — but nothing stopped them running one each, and five
 * concurrent SwiftShader renders sharing four cores made the machine unusable
 * while making every individual run slower. Politeness in a prompt is not a
 * mutex.
 *
 * `wx` fails if the file exists, which makes creation atomic. The holder's pid
 * goes in the file so a lock left by a hard-killed run can be told from a live
 * one and broken; without that check a single SIGKILL would wedge every future
 * capture. Released in run()'s finally, and tame.mjs's teardown covers the
 * paths finally cannot.
 */
const LOCKDIR = new URL('../.renderlock.d/', import.meta.url);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/* A ticket queue rather than a race.
 *
 * The first version was a single lockfile that every waiter retried for. That is
 * a race, not a queue: with six agents contending, whoever happens to poll in
 * the instant after a release wins, so a two-minute probe can starve behind a
 * succession of twenty-minute captures and never acquire at all. Three separate
 * runs hit the 45-minute timeout that way in one afternoon without ever holding
 * the lock once.
 *
 * Each waiter now drops a ticket named `<timestamp>-<pid>` and holds the lock
 * when it owns the oldest live ticket, so service is first-come-first-served and
 * a waiter's position can only improve. Tickets whose pid is gone are swept, for
 * the same reason the old file carried a pid: a hard-killed run must not wedge
 * every future capture.
 *
 * Ordering ties on identical timestamps break on the string, which includes the
 * pid, so two waiters can never both believe they are first.
 */
async function acquireLock(timeoutMs = 45 * 60 * 1000) {
  fs.mkdirSync(LOCKDIR, { recursive: true });
  const ticket = `${Date.now().toString().padStart(14, '0')}-${process.pid}`;
  const mine = new URL(ticket, LOCKDIR);
  fs.writeFileSync(mine, '');
  const release = () => { try { fs.unlinkSync(mine); } catch {} };

  const started = Date.now();
  let announced = false;
  try {
    for (;;) {
      const live = fs.readdirSync(LOCKDIR).filter(name => {
        const pid = Number(name.split('-')[1]);
        if (pid && alive(pid)) return true;
        if (name !== ticket) { try { fs.unlinkSync(new URL(name, LOCKDIR)); } catch {} }
        return false;
      }).sort();

      if (live[0] === ticket) return release;

      if (!announced) {
        console.log(`… queued for the capture lock behind ${live.indexOf(ticket)}` +
                    ` (holder pid ${live[0].split('-')[1]})`);
        announced = true;
      }
      if (Date.now() - started > timeoutMs) {
        release();
        throw new Error(`waited over ${Math.round(timeoutMs / 60000)} min for the capture lock`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (e) {
    release();
    throw e;
  }
}

export async function run(opts, body) {
  /* The lock serialises *rendering*, because concurrent captures contend for the
     same four cores and make each other slower without making the machine any
     safer. A probe that renders no pixels — the audio probe drives an
     OfflineAudioContext and reads numbers back — is not what the lock protects
     against, and queueing it behind a queue of eight-view captures blocked it
     for over two hours. Such a probe may pass `lock: false`.

     It still boots the page, which is not free, so this is not a general escape
     hatch: use it only when nothing is drawn repeatedly. */
  const releaseLock = opts?.lock === false ? () => {} : await acquireLock();
  const { width = 1280, height = 720, waitReady = true, extraArgs = [], hash = '',
          /* Which HTML to load. Defaults to the server's own `/` → index.html, so
             nothing changes for an ordinary run. `GAME_FILE` exists so a risky
             change can be developed against a copy — `index.physics.html` — while
             the real file is being rendered from by something else. Read from the
             environment rather than passed per-probe so every probe inherits it
             without each one growing an argument it will never otherwise use. */
          file = process.env.GAME_FILE || '' } = opts || {};
  const srv = serve();
  await new Promise(r => srv.listen(0, r));
  const url = `http://localhost:${srv.address().port}/${file}` +
              `${hash ? (hash.startsWith('#') ? hash : '#' + hash) : ''}`;

  const unpin = pinChildren();
  const browser = await chromium.launch({
    headless: true,
    args: [...LAUNCH_ARGS, ...extraArgs],
  });
  const errs = [];
  let code = 0;
  try {
    const page = await browser.newPage({
      viewport: { width, height }, deviceScaleFactor: 1,
    });
    page.on('pageerror', e => errs.push('[pageerror] ' + (e.stack || e.message || e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
    page.on('requestfailed', r => errs.push('[netfail] ' + r.url().slice(0, 110)));
    // A dead renderer is the failure this whole file exists to make visible;
    // without it the probe just hangs until Playwright's timeout.
    page.on('crash', () => errs.push('[crash] renderer process died'));

    console.log(`→ ${url}   ${width}x${height}   ` +
      (GPU_MODE ? `GPU (d3d11), ${CORES} cores`
                : `SwiftShader, ${CORES} cores, ${CHILD_PRIO.toLowerCase()} priority`));
    // 'load' would also wait on the streamed Poly Haven textures, which are
    // optional progressive upgrades; gate on the game object instead.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    if (waitReady) {
      await page.waitForFunction(() => !!window.__game, null, { timeout: 120_000 });
      await page.evaluate(() => window.__game.begin());
    }
    await body({ page, url, errs, browser });
  } catch (err) {
    console.error('\n✗ probe failed:', err && err.message || err);
    code = 1;
  } finally {
    // Order matters: kill the renderer before releasing the port, and never
    // let a teardown error leave the browser running. The lock goes last, so
    // the next waiter does not start while this browser is still shutting down.
    await browser.close().catch(() => {});
    srv.close();
    unpin();
    releaseLock();
  }
  if (errs.length) {
    console.log('\n─── page errors ───');
    errs.slice(0, 12).forEach(e => console.log(' ', e));
  }
  process.exitCode = code;
}
