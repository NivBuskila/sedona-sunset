/* Crop-and-magnify a shot, so a suspect artefact can be identified without
 * spending another render on the software rasteriser. Reads and writes PNG with
 * nothing but zlib.
 *
 *   node tools/crop.mjs shots/probe13_wash_low.png 0.02 0.44 0.34 0.30 4
 *                       file                        x    y    w    h   zoom
 * where x,y,w,h are fractions of the source image.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

function chunks(buf) {
  const out = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

function decode(buf) {
  const cs = chunks(buf);
  const ihdr = cs.find(c => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const depth = ihdr[8], type = ihdr[9];
  if (depth !== 8 || (type !== 6 && type !== 2)) {
    throw new Error(`unsupported PNG: depth ${depth} type ${type}`);
  }
  const ch = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(cs.filter(c => c.type === 'IDAT').map(c => c.data)));
  const px = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 255;
    }
    line.copy(px, y * stride);
    prev = line;
  }
  return { w, h, ch, px };
}

function encode(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const [file, fx, fy, fw, fh, fz] = process.argv.slice(2);
const src = decode(readFileSync(file));
const x0 = Math.round(+fx * src.w), y0 = Math.round(+fy * src.h);
const cw = Math.round(+fw * src.w), chh = Math.round(+fh * src.h);
const z = Math.max(1, Math.round(+(fz || 3)));
const ow = cw * z, oh = chh * z;
const out = Buffer.alloc(ow * oh * 3);
for (let y = 0; y < oh; y++) {
  const sy = Math.min(src.h - 1, y0 + Math.floor(y / z));
  for (let x = 0; x < ow; x++) {
    const sx = Math.min(src.w - 1, x0 + Math.floor(x / z));
    const s = (sy * src.w + sx) * src.ch, d = (y * ow + x) * 3;
    out[d] = src.px[s]; out[d + 1] = src.px[s + 1]; out[d + 2] = src.px[s + 2];
  }
}
const dst = file.replace(/\.png$/, '_crop.png');
writeFileSync(dst, encode(ow, oh, out));
console.log(`${dst}  ${ow}x${oh}  from ${cw}x${chh} at ${x0},${y0}`);
