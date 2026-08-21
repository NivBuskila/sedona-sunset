/* What the alpha mip chain actually does to a sparse cutout.
 *
 * Three variants of the downsample-and-rescale rule, run on a synthetic spray
 * that matches the real foliage atlas's statistics (thin strokes on a mostly
 * transparent field, ~10% coverage). Reports, per level: the fraction of texels
 * that clear the alpha test — which should stay near level zero's — and the
 * fraction that are fully opaque, which is what "flat opaque quad with no alpha
 * cut" looks like from the outside. */

const W = 256, H = 256, AT = 0.42 * 255;

function spray() {
  const px = new Uint8Array(W * H * 4);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 80; k++) {
    let x = W * 0.5 + (rnd() - 0.5) * 20, y = H * 0.97, a = -Math.PI / 2 + (rnd() - 0.5) * 1.4;
    const len = H * (0.3 + rnd() * 0.5), st = len / 60;
    for (let i = 0; i < 60; i++) {
      x += Math.cos(a) * st; y += Math.sin(a) * st; a += (rnd() - 0.5) * 0.1;
      const xi = x | 0, yi = y | 0;
      if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) break;
      for (let d = 0; d < 2; d++) {
        const j = (yi * W + xi + d) * 4;
        px[j] = 110; px[j + 1] = 120; px[j + 2] = 48; px[j + 3] = 255;
      }
    }
  }
  return px;
}

const cov = (b) => { let n = 0; for (let i = 3; i < b.length; i += 4) if (b[i] >= AT) n++; return n / (b.length / 4); };
const solid = (b) => { let n = 0; for (let i = 3; i < b.length; i += 4) if (b[i] >= 250) n++; return n / (b.length / 4); };

/** mode: 'avg' | 'max'  — how alpha is combined. cap: gain ceiling.
    shrink: whether a gain below one is allowed to be applied. */
function chain(base, { mode, cap, shrink }) {
  const target = cov(base);
  const out = [{ data: base, width: W }];
  let cur = base, cw = W, ch = H;
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const nd = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let a = 0, amax = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const j = (Math.min(ch - 1, y * 2 + dy) * cw + Math.min(cw - 1, x * 2 + dx)) * 4;
            a += cur[j + 3];
            if (cur[j + 3] > amax) amax = cur[j + 3];
          }
        }
        nd[(y * nw + x) * 4 + 3] = mode === 'avg' ? a / 4
          : Math.min(255, a / 4 * 0.55 + amax * 0.45);
      }
    }
    let lo = shrink ? 0.08 : 0.25, hi = cap;
    for (let it = 0; it < 24; it++) {
      const s = (lo + hi) * 0.5;
      let n = 0;
      for (let i = 3; i < nd.length; i += 4) if (nd[i] * s >= AT) n++;
      if (n / (nd.length / 4) > target) hi = s; else lo = s;
    }
    const s = Math.min(cap, (lo + hi) * 0.5);
    if (shrink ? Math.abs(s - 1) > 0.001 : s > 1.001) {
      for (let i = 3; i < nd.length; i += 4) nd[i] = Math.min(255, nd[i] * s);
    }
    out.push({ data: nd, width: nw, gain: s });
    cur = nd; cw = nw; ch = nh;
  }
  return out;
}

const base = spray();
console.log(`level 0: coverage ${cov(base).toFixed(3)}  (this is the target)\n`);
const variants = [
  ['A  shipped:   avg, cap 12,  grow only', { mode: 'avg', cap: 12, shrink: false }],
  ['B  candidate: max, cap 2.4, grow only', { mode: 'max', cap: 2.4, shrink: false }],
  ['C  candidate: max, cap 2.4, grow+shrink', { mode: 'max', cap: 2.4, shrink: true }],
  ['D  candidate: avg, cap 12,  grow+shrink', { mode: 'avg', cap: 12, shrink: true }],
];
for (const [name, opt] of variants) {
  console.log(name);
  for (const m of chain(base.slice(), opt)) {
    if (m.gain === undefined) continue;
    console.log(`   ${String(m.width).padStart(3)}px  gain=${m.gain.toFixed(2)}` +
      `  cover=${cov(m.data).toFixed(3)}  solid=${solid(m.data).toFixed(3)}`);
  }
  console.log('');
}
