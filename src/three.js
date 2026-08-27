/* The Three.js specifier, in one place, so a worker can resolve it too.
 *
 * `index.html` carries an import map that resolves the bare specifier `three` to
 * an absolute CDN URL. That map governs the *document*, and only the document:
 * import maps are not inherited by workers, and there is no way to give a worker
 * one. So a module that says `import * as THREE from 'three'` loads fine on the
 * main thread and fails outright inside a worker — which is the single reason the
 * heavy generation phases could not be moved off the main thread, and it looked
 * like a much bigger problem than it is.
 *
 * Re-exporting from the absolute URL fixes it for both contexts at once, because
 * an absolute URL needs no resolution anywhere. Importing `./three.js` works on
 * the main thread and in a worker, and it is the same module either way:
 * the import map points `three` at *this exact URL*, so a module graph that mixes
 * `'three'` and `'./three.js'` still gets one instance of the library, one set of
 * classes, and one `instanceof` that behaves. That is what lets the migration be
 * incremental — a file only needs changing when a worker has to import it — and
 * it is why the files still saying `'three'` are correct rather than pending.
 *
 * The version lives here and in the import map, and the two have to agree. The
 * map cannot be dropped in favour of this file: `three/addons/` is resolved by
 * prefix for anything that imports an example module, and a bare specifier in a
 * dependency's own internals has nothing else to resolve against.
 */
export * from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
