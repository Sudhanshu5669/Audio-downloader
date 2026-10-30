const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal PNG generator without dependencies
function createPng(width, height, pixelFn) {
  const bytesPerPixel = 4;
  const scanlineLength = width * bytesPerPixel;
  const rawBuffer = Buffer.alloc((scanlineLength + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (scanlineLength + 1);
    rawBuffer[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel;
      rawBuffer[pixelOffset] = r;
      rawBuffer[pixelOffset + 1] = g;
      rawBuffer[pixelOffset + 2] = b;
      rawBuffer[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawBuffer);

  // Helper to calculate CRC32
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);

    const typeAndData = Buffer.concat([typeBuf, data]);
    const crcVal = crc32(typeAndData);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);

    return Buffer.concat([lenBuf, typeAndData, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate an attractive modern music note + waveform badge
function renderIcon(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  const cx = 0.5, cy = 0.5;
  const dist = Math.sqrt((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy));

  // Rounded rectangle icon background (radius ~ 0.42)
  const cornerR = 0.22;
  const dx = Math.max(0, Math.abs(nx - 0.5) - (0.5 - cornerR));
  const dy = Math.max(0, Math.abs(ny - 0.5) - (0.5 - cornerR));
  const cornerDist = Math.sqrt(dx * dx + dy * dy);

  if (cornerDist > cornerR) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  // Smooth anti-aliasing edge
  let alpha = 255;
  if (cornerDist > cornerR - 0.04) {
    const edgeT = (cornerR - cornerDist) / 0.04;
    alpha = Math.max(0, Math.min(255, Math.floor(edgeT * 255)));
  }

  // Vibrant purple to violet-blue gradient background
  // #6366f1 (Indigo) to #a855f7 (Purple) to #ec4899 (Pink)
  const gradT = (nx + ny) * 0.5;
  let bgR = Math.floor(99 + (168 - 99) * gradT);
  let bgG = Math.floor(102 + (85 - 102) * gradT);
  let bgB = Math.floor(241 + (247 - 241) * gradT);

  // Foreground: Draw audio soundwave bars + download arrow symbol
  // 5 Vertical soundwave bars
  const bars = [
    { x: 0.24, h: 0.30 },
    { x: 0.37, h: 0.52 },
    { x: 0.50, h: 0.70 },
    { x: 0.63, h: 0.52 },
    { x: 0.76, h: 0.30 }
  ];

  const barWidth = 0.08;
  let isBar = false;
  for (const bar of bars) {
    const halfH = bar.h / 2;
    if (Math.abs(nx - bar.x) <= barWidth / 2 && Math.abs(ny - 0.48) <= halfH) {
      isBar = true;
      break;
    }
  }

  // Small downward arrow / tray at bottom
  const isTray = (ny >= 0.82 && ny <= 0.88 && nx >= 0.30 && nx <= 0.70);

  if (isBar || isTray) {
    // Pure white foreground
    return [255, 255, 255, alpha];
  }

  return [bgR, bgG, bgB, alpha];
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 32, 48, 128].forEach(size => {
  const buf = createPng(size, size, renderIcon);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png (${buf.length} bytes)`);
});
