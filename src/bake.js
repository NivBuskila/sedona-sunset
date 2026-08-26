/* ── the bake store ────────────────────────────────────────────────────────
 *
 * Cold boot is forty to fifty seconds, and three phases are 77% of it —
 * `Cutting the wash`, `Raising the canyon walls` and `Scattering the stones`.
 * All three are pure arithmetic on the main thread producing typed arrays, and
 * all three produce *the same arrays every time*: generation runs on a seeded
 * xorshift stream (`noise.js`), so the tenth load computes, bit for bit, what
 * the first one did. Recomputing it is the whole of the wait and none of the
 * picture.
 *
 * So this keeps the arrays in IndexedDB and hands them back on the next visit.
 * The first load is unchanged — it generates, then stores — and every load after
 * it reads the bed off the disk and uploads it. Nothing about the geometry
 * changes: the arrays that come back are the arrays that went in, which is a
 * property the caller can and does check (`tools/_bakeid.mjs`).
 *
 * This is the one place the project's "nothing is loaded at runtime" line bends,
 * and it is worth saying exactly how far. No asset enters the repository and
 * nothing is fetched from the network — what a repeat visit loads is a file the
 * visitor's own browser computed and wrote, on their own disk. The generator is
 * still the only source of the scene.
 *
 * ── invalidation
 *
 * The trap in caching generated geometry is a stale bed outliving the code that
 * generated it: edit the noise and the old wash comes back, silently, and the
 * next hour goes on the wrong question. So the key carries a fingerprint of the
 * *source that generates it*, and the fingerprint is taken from the modules the
 * browser actually loaded — `performance.getEntriesByType('resource')` knows
 * every `src/*.js` in the graph by the time this runs, so there is no list here
 * to fall out of date with the directory. Change one character in any module and
 * every entry is orphaned and rebuilt on the next load.
 *
 * ── failure
 *
 * Every path here degrades to plain generation. IndexedDB is absent in some
 * private modes, throws on quota, and a browser may evict mid-session; none of
 * that may cost the visitor anything but the wait they would have had anyway.
 * There is no error path that reaches the caller — `bake()` either returns the
 * cached arrays or returns what `produce()` built.
 */

const DB_NAME = 'sedona-bake';
const STORE = 'arrays';

/* Bump to orphan every entry regardless of source. The source fingerprint below
   catches code changes on its own, so this is for the cases it cannot see — a
   change in how an array is serialised here, or a Three.js version whose
   attributes want different contents from identical source. */
const FORMAT = 1;

/* ── the source fingerprint ───────────────────────────────────────────────── */

let fingerprint = null;

/**
 * A hash of every `src/*.js` the browser has loaded, so a code change orphans
 * the cache without anyone remembering to say so.
 *
 * Reading the list from the resource timeline rather than from an array in this
 * file is deliberate: an explicit list is a footgun that fires months later,
 * when someone adds a module that changes the geometry and the cache does not
 * know it. The refetches are HTTP-cache hits — these are the same URLs the
 * module graph just pulled — and the whole pass is milliseconds against the
 * forty seconds it protects.
 *
 * Returns null if the platform is missing any piece it needs, which sends every
 * caller down the plain-generation path.
 */
async function sourceFingerprint() {
  if (fingerprint !== null) return fingerprint || null;
  try {
    if (!crypto?.subtle || !performance?.getEntriesByType) return (fingerprint = '') && null;
    const urls = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\/src\/[^/]+\.js(\?|$)/.test(n))
      .sort();
    /* No modules in the timeline means the timeline is not telling the truth
       here — a hard reload can drop entries — and a fingerprint over an empty
       set would happily match a different build. Refuse instead. */
    if (!urls.length) { fingerprint = ''; return null; }
    const texts = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text())));
    const buf = new TextEncoder().encode(FORMAT + '\n' + urls.join('\n') + '\n' + texts.join('\n'));
    const digest = await crypto.subtle.digest('SHA-256', buf);
    fingerprint = Array.from(new Uint8Array(digest).slice(0, 12))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return fingerprint;
  } catch {
    fingerprint = '';
    return null;
  }
}

/* ── the database ─────────────────────────────────────────────────────────── */

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      /* A blocked open means another tab holds an older version. Rather than
         wait on a user closing it, give up and generate. */
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

const idbGet = (db, key) => new Promise((resolve) => {
  try {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  } catch { resolve(null); }
});

const idbPut = (db, key, value) => new Promise((resolve) => {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    /* Quota is the expected failure and it is not worth a word to the visitor:
       they got their scene, and the next load will simply be slow again. */
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  } catch { resolve(false); }
});

/**
 * Drop every entry whose key does not carry the current fingerprint.
 *
 * Without this the store grows by a full scene on every code change and the
 * visitor pays disk for every build they ever loaded. Runs once, after the
 * first hit or miss, and its result is nobody's dependency.
 */
async function evictStale(db, live) {
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result) if (!String(k).endsWith(live)) store.delete(k);
    };
  } catch { /* housekeeping only */ }
}

/* ── the public call ──────────────────────────────────────────────────────── */

/* What the store did, for the boot log and for the tools. Counted rather than
   logged per entry: the interesting number is how much of the scene came off
   the disk, and a phase that missed is visible as its own stall anyway. */
export const bakeLog = { hits: 0, misses: 0, stored: 0, bytes: 0, ms: 0, state: 'unknown' };

let evicted = false;

/**
 * Return `id`'s typed arrays, from the cache if they are there and from
 * `produce()` if they are not.
 *
 * `produce` must be a pure function of the source — the same code producing the
 * same arrays — because that is the assumption the fingerprint encodes. It may
 * be async. It must return a flat object of typed arrays; anything else is
 * stored as-is by structured clone and will come back as whatever the browser
 * decided, which for a `BufferAttribute` is not a `BufferAttribute`.
 *
 * Callers must treat a returned array as owned by them and never as shared:
 * these come out of a fresh structured clone on every read, so mutating one is
 * safe, but nothing here reads it back.
 */
export async function bake(id, produce) {
  const t0 = performance.now();
  const fp = await sourceFingerprint();
  const db = fp ? await openDB() : null;
  const key = `${id}@${fp}`;

  if (db) {
    bakeLog.state = 'open';
    const hit = await idbGet(db, key);
    if (hit) {
      bakeLog.hits++;
      bakeLog.ms += performance.now() - t0;
      for (const v of Object.values(hit)) if (v?.byteLength) bakeLog.bytes += v.byteLength;
      if (!evicted) { evicted = true; evictStale(db, `@${fp}`); }
      return hit;
    }
  } else if (bakeLog.state === 'unknown') {
    bakeLog.state = fp ? 'no-idb' : 'no-fingerprint';
  }

  bakeLog.misses++;
  const built = await produce();

  if (db) {
    if (await idbPut(db, key, built)) bakeLog.stored++;
    if (!evicted) { evicted = true; evictStale(db, `@${fp}`); }
  }
  return built;
}

/** Forget everything, for the tools that measure a cold boot on purpose. */
export async function clearBake() {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}
