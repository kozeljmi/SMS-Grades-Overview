/**
 * Generates placeholder PNG icons for the extension using raw PNG encoding.
 * No external dependencies required.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "icons");
mkdirSync(iconsDir, { recursive: true });

function createPNG(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;
  const cornerR = size * 0.18;

  // Draw rounded rectangle with #2563eb (blue)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (isInsideRoundedRect(x, y, 0, 0, size, size, cornerR)) {
        pixels[idx] = 37;     // R
        pixels[idx + 1] = 99; // G
        pixels[idx + 2] = 235; // B
        pixels[idx + 3] = 255; // A
      } else {
        pixels[idx + 3] = 0; // transparent
      }
    }
  }

  // Draw "SMS" text as simple block letters (white)
  if (size >= 48) {
    drawText(pixels, size, "SMS", size);
  } else {
    // For 16px, just draw "S"
    drawText(pixels, size, "S", size);
  }

  return encodePNG(pixels, size, size);
}

function isInsideRoundedRect(x, y, rx, ry, rw, rh, cr) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  // Check corners
  const corners = [
    [rx + cr, ry + cr],
    [rx + rw - cr, ry + cr],
    [rx + cr, ry + rh - cr],
    [rx + rw - cr, ry + rh - cr],
  ];
  for (const [ccx, ccy] of corners) {
    if (
      (x < rx + cr || x >= rx + rw - cr) &&
      (y < ry + cr || y >= ry + rh - cr)
    ) {
      const dx = x - ccx;
      const dy = y - ccy;
      if (dx * dx + dy * dy > cr * cr) return false;
    }
  }
  return true;
}

// Simple 5x7 bitmap font for uppercase letters
const FONT = {
  S: [
    " ### ",
    "#    ",
    " ### ",
    "    #",
    " ### ",
  ],
  M: [
    "#   #",
    "## ##",
    "# # #",
    "#   #",
    "#   #",
  ],
};

function drawText(pixels, imgSize, text, size) {
  const charW = 5;
  const charH = 5;
  const gap = 1;
  const totalW = text.length * charW + (text.length - 1) * gap;
  const scale = Math.max(1, Math.floor(size / (totalW + 4)));
  const scaledW = totalW * scale;
  const scaledH = charH * scale;
  const startX = Math.floor((imgSize - scaledW) / 2);
  const startY = Math.floor((imgSize - scaledH) / 2);

  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci];
    const bitmap = FONT[ch];
    if (!bitmap) continue;
    const offsetX = ci * (charW + gap) * scale;

    for (let row = 0; row < charH; row++) {
      for (let col = 0; col < charW; col++) {
        if (bitmap[row][col] !== " ") {
          // Draw scaled pixel
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = startX + offsetX + col * scale + sx;
              const py = startY + row * scale + sy;
              if (px >= 0 && px < imgSize && py >= 0 && py < imgSize) {
                const idx = (py * imgSize + px) * 4;
                pixels[idx] = 255;
                pixels[idx + 1] = 255;
                pixels[idx + 2] = 255;
                pixels[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
  }
}

function encodePNG(pixels, width, height) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: filter byte (0 = None) before each row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter none
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(rawData);

  const chunks = [
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons
for (const size of [16, 48, 128]) {
  const png = createPNG(size);
  const path = join(iconsDir, `icon${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}
