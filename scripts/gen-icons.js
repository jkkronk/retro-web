// Generates the extension icons (16/32/48/128) from scratch — a navy globe
// with lime wireframe meridians, the "information superhighway" in a 16px box.
// Zero dependencies: a tiny hand-rolled PNG encoder (Node's zlib does the
// compression). Re-run after tweaking the design:  node scripts/gen-icons.js
//
// Output: icons/icon{16,32,48,128}.png  (RGBA, transparent background).

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// ---- minimal PNG encoder (color type 6 = RGBA, 8-bit) ----------------------
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- the design ------------------------------------------------------------
function draw(size) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  const c = (size - 1) / 2;
  const r = size * 0.46;
  const lineW = Math.max(1, size / 16);
  const set = (x, y, col) => {
    const i = (y * size + x) * 4;
    buf[i] = col[0];
    buf[i + 1] = col[1];
    buf[i + 2] = col[2];
    buf[i + 3] = 255;
  };
  const navy = [0, 0, 128];
  const lime = [51, 255, 51];
  const black = [0, 0, 0];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      let col = navy;
      if (d > r - lineW) {
        col = black; // outline ring
      } else {
        const lat = Math.abs(dy);
        const meridian = (dx / (r * 0.55)) ** 2 + (dy / r) ** 2; // tilted great circle
        if (lat < lineW * 0.75 || Math.abs(lat - r * 0.5) < lineW * 0.6) col = lime; // equator + tropics
        else if (Math.abs(dx) < lineW * 0.75) col = lime; // central meridian
        else if (Math.abs(meridian - 1) < 0.14) col = lime; // side meridian
      }
      set(x, y, col);
    }
  }
  return buf;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), encodePNG(size, draw(size)));
  console.log(`wrote icons/icon${size}.png`);
}
