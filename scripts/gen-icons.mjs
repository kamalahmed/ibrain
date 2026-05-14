/*
 * Generates the PWA PNG icons into public/ — no image dependencies, just a
 * tiny hand-rolled PNG encoder (Node's zlib does the compression).
 *
 * Run with:  node scripts/gen-icons.mjs
 * The output PNGs are committed; this only needs re-running if the icon art
 * changes.
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public"
);

/* ---------- PNG encoding ---------- */

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- drawing ---------- */

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const C1 = hex("#7e4dff"); // brand purple
const C2 = hex("#2dd4bf"); // accent teal

// Brain = union of circles in unit coords (centred on 0.5, 0.5). Bumpy oval.
const LOBES = [
  [0.5, 0.52, 0.27],
  [0.34, 0.44, 0.15],
  [0.66, 0.44, 0.15],
  [0.5, 0.33, 0.15],
  [0.4, 0.37, 0.12],
  [0.6, 0.37, 0.12],
  [0.38, 0.66, 0.14],
  [0.62, 0.66, 0.14],
];

function drawIcon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const feather = size * 0.004 + 0.8;
  const radius = maskable ? 0 : size * 0.22;
  const bScale = maskable ? 0.66 : 0.84;
  const hw = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      // diagonal gradient background
      const g = (px / size + py / size) / 2;
      let r = lerp(C1[0], C2[0], g);
      let gr = lerp(C1[1], C2[1], g);
      let b = lerp(C1[2], C2[2], g);
      let a = 255;

      // rounded-rect alpha mask (full-bleed for maskable)
      if (!maskable) {
        const qx = Math.abs(px - hw) - (hw - radius);
        const qy = Math.abs(py - hw) - (hw - radius);
        const d =
          Math.min(Math.max(qx, qy), 0) +
          Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
          radius;
        a = Math.round(255 * (1 - smoothstep(-feather, feather, d)));
      }

      // brain: nearest signed distance across the lobe circles (neg = inside)
      let sdf = Infinity;
      for (const [cx, cy, cr] of LOBES) {
        const ux = (0.5 + (cx - 0.5) * bScale) * size;
        const uy = (0.5 + (cy - 0.5) * bScale) * size;
        const dist = Math.hypot(px - ux, py - uy) - cr * bScale * size;
        if (dist < sdf) sdf = dist;
      }
      const brain = 1 - smoothstep(-feather, feather, sdf);
      if (brain > 0) {
        // white brain with a soft central fissure for the two-hemisphere look
        let wr = 255;
        let wg = 255;
        let wb = 255;
        if (sdf < -feather) {
          const line =
            1 - smoothstep(size * 0.006, size * 0.024, Math.abs(px - hw));
          const band =
            smoothstep(size * 0.3, size * 0.35, py) *
            (1 - smoothstep(size * 0.66, size * 0.71, py));
          const f = line * band * 0.5;
          wr = lerp(255, C1[0], f);
          wg = lerp(255, C1[1], f);
          wb = lerp(255, C1[2], f);
        }
        r = lerp(r, wr, brain);
        gr = lerp(gr, wg, brain);
        b = lerp(b, wb, brain);
      }

      const o = (y * size + x) * 4;
      rgba[o] = Math.round(r);
      rgba[o + 1] = Math.round(gr);
      rgba[o + 2] = Math.round(b);
      rgba[o + 3] = a;
    }
  }
  return rgba;
}

/* ---------- write ---------- */

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const t of targets) {
  const rgba = drawIcon(t.size, { maskable: t.maskable });
  const png = encodePNG(t.size, rgba);
  const out = path.join(publicDir, t.file);
  fs.writeFileSync(out, png);
  // sanity check: valid signature + the image actually has content
  const back = fs.readFileSync(out);
  const sigOk = back.subarray(0, 8).equals(PNG_SIG);
  let varied = false;
  for (let i = 4; i < rgba.length; i += 4096) {
    if (rgba[i] !== rgba[0]) varied = true;
  }
  console.log(
    `${t.file}  ${t.size}x${t.size}  ${png.length} bytes  ` +
      `sig=${sigOk ? "ok" : "BAD"}  content=${varied ? "ok" : "FLAT"}`
  );
  if (!sigOk || !varied) process.exitCode = 1;
}
