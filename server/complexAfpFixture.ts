// Shared generator for complex 2-page CIBC AFP MO:DCA test streams with:
// - Reusable Form Overlay (BMO/EMO + IPO) combining GOCA boxes/circles/fills, PTOCA DIR/DBR table grids, SEC RGB colors & template labels
// - Embedded IOCA images: 1-bit CCITT Group 4 (0x82) logo, 24-bit RGB branch verification stamp (with variation), 8-bit grayscale scanned signature
// - BCOCA horizontal barcode + rotated 270deg Code-39 mailroom barcode + MCF2 coded fonts
// - Filled form fields, checkboxes, tabular currency & alignment drifts, and Page 2 missing border rule variation

const ASCII_TO_EBCDIC: Record<string, number> = {
  ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '|': 0x4f,
  '&': 0x50, '!': 0x5a, '$': 0x5b, '*': 0x5c, ')': 0x5d, ';': 0x5e, '^': 0x5f,
  '-': 0x60, '/': 0x61, ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e, '?': 0x6f,
  ':': 0x7a, '#': 0x7b, '@': 0x7c, "'": 0x7d, '=': 0x7e, '"': 0x7f,
  '[': 0xba, ']': 0xbb,
  a: 0x81, b: 0x82, c: 0x83, d: 0x84, e: 0x85, f: 0x86, g: 0x87, h: 0x88, i: 0x89,
  j: 0x91, k: 0x92, l: 0x93, m: 0x94, n: 0x95, o: 0x96, p: 0x97, q: 0x98, r: 0x99,
  s: 0xa2, t: 0xa3, u: 0xa4, v: 0xa5, w: 0xa6, x: 0xa7, y: 0xa8, z: 0xa9,
  A: 0xc1, B: 0xc2, C: 0xc3, D: 0xc4, E: 0xc5, F: 0xc6, G: 0xc7, H: 0xc8, I: 0xc9,
  J: 0xd1, K: 0xd2, L: 0xd3, M: 0xd4, N: 0xd5, O: 0xd6, P: 0xd7, Q: 0xd8, R: 0xd9,
  S: 0xe2, T: 0xe3, U: 0xe4, V: 0xe5, W: 0xe6, X: 0xe7, Y: 0xe8, Z: 0xe9,
  '0': 0xf0, '1': 0xf1, '2': 0xf2, '3': 0xf3, '4': 0xf4, '5': 0xf5, '6': 0xf6, '7': 0xf7, '8': 0xf8, '9': 0xf9,
};

function encodeEbcdic(text: string): Buffer {
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = ASCII_TO_EBCDIC[text[i]] ?? 0x40;
  }
  return out;
}

function sf(sfidHex: string, seq: number, payload?: Buffer | string): Buffer {
  const sfid = Buffer.from(sfidHex, 'hex');
  const data = typeof payload === 'string' ? Buffer.from(payload, 'ascii') : payload || Buffer.alloc(0);
  const length = 8 + data.length;
  const buf = Buffer.alloc(1 + length);
  buf[0] = 0x5a;
  buf.writeUInt16BE(length, 1);
  sfid.copy(buf, 3);
  buf[6] = 0x00;
  buf.writeUInt16BE(seq & 0xffff, 7);
  if (data.length > 0) data.copy(buf, 9);
  return buf;
}

function makeTle(name: string, val: string): Buffer {
  const n = encodeEbcdic(name);
  const v = encodeEbcdic(val);
  return Buffer.concat([
    Buffer.from([4 + n.length, 0x02, 0x0b, 0x00]),
    n,
    Buffer.from([4 + v.length, 0x36, 0x00, 0x00]),
    v,
  ]);
}

function makePgd(widthUnits: number, heightUnits: number, dpi = 240): Buffer {
  const b = Buffer.alloc(12);
  b[0] = 0x00;
  b[1] = 0x00;
  b.writeUInt16BE(dpi * 10, 2);
  b.writeUInt16BE(dpi * 10, 4);
  b[6] = (widthUnits >> 16) & 0xff;
  b[7] = (widthUnits >> 8) & 0xff;
  b[8] = widthUnits & 0xff;
  b[9] = (heightUnits >> 16) & 0xff;
  b[10] = (heightUnits >> 8) & 0xff;
  b[11] = heightUnits & 0xff;
  return b;
}

function makeMcf2(entries: Array<{ localId: number; name: string; sizePt?: number }>): Buffer {
  const groups: Buffer[] = [];
  for (const e of entries) {
    const fName = encodeEbcdic(e.name.padEnd(8, ' ').slice(0, 8));
    const tFqn = Buffer.concat([Buffer.from([4 + fName.length, 0x02, 0x84, 0x00]), fName]);
    const tLid = Buffer.from([4, 0x24, 0x05, e.localId]);
    const twips = Math.round((e.sizePt || 9.5) * 20);
    const tScale = Buffer.alloc(4);
    tScale[0] = 4;
    tScale[1] = 0x1f;
    tScale.writeUInt16BE(twips, 2);
    const body = Buffer.concat([tFqn, tLid, tScale]);
    const hdr = Buffer.alloc(2);
    hdr.writeUInt16BE(2 + body.length, 0);
    groups.push(hdr, body);
  }
  return Buffer.concat(groups);
}

function makeObp(x: number, y: number, orient = 0): Buffer {
  const b = Buffer.alloc(12);
  b[0] = 0x01; // OAPosID
  b[1] = 0x0a;
  b[2] = (x >> 16) & 0xff;
  b[3] = (x >> 8) & 0xff;
  b[4] = x & 0xff;
  b[5] = (y >> 16) & 0xff;
  b[6] = (y >> 8) & 0xff;
  b[7] = y & 0xff;
  b.writeUInt16BE(orient, 8);
  b.writeUInt16BE((orient + 0x2d00) & 0xffff, 10);
  return b;
}

function makeOad(w: number, h: number): Buffer {
  // DesPosID(1), Reserved(1), followed by Triplet 0x4C (Object Area Size)
  const b = Buffer.alloc(11);
  b[0] = 0x01;
  b[1] = 0x00;
  b[2] = 9; // triplet length
  b[3] = 0x4c; // Object Area Size triplet
  b[4] = 0x02; // SizeType
  b[5] = (w >> 16) & 0xff;
  b[6] = (w >> 8) & 0xff;
  b[7] = w & 0xff;
  b[8] = (h >> 16) & 0xff;
  b[9] = (h >> 8) & 0xff;
  b[10] = h & 0xff;
  return b;
}

function makeResPos(name: string, x: number, y: number): Buffer {
  const n = encodeEbcdic(name.padEnd(8, ' ').slice(0, 8));
  const c = Buffer.alloc(6);
  c[0] = (x >> 16) & 0xff;
  c[1] = (x >> 8) & 0xff;
  c[2] = x & 0xff;
  c[3] = (y >> 16) & 0xff;
  c[4] = (y >> 8) & 0xff;
  c[5] = y & 0xff;
  return Buffer.concat([n, c]);
}

// CCITT T.4 1D White/Black Run Terminating codes (0..63) for encoding lossless T.6 (Group 4) Horizontal mode rows
const T4_WHITE_TERMS: Array<[number, number]> = [
  [0b00110101, 8], [0b000111, 6], [0b0111, 4], [0b1000, 4], [0b1011, 4], [0b1100, 4], [0b1110, 4], [0b1111, 4],
  [0b10011, 5], [0b10100, 5], [0b00111, 5], [0b01000, 5], [0b001000, 6], [0b000011, 6], [0b110100, 6], [0b110101, 6],
  [0b101010, 6], [0b101011, 6], [0b0100111, 7], [0b0001100, 7], [0b0001000, 7], [0b0010111, 7], [0b0000011, 7], [0b0000100, 7],
  [0b0101000, 7], [0b0101011, 7], [0b0010011, 7], [0b0100100, 7], [0b0011000, 7], [0b00000010, 8], [0b00000011, 8], [0b00011010, 8],
  [0b00011011, 8], [0b00010010, 8], [0b00010011, 8], [0b00010100, 8], [0b00010101, 8], [0b00010110, 8], [0b00010111, 8], [0b00101000, 8],
  [0b00101001, 8], [0b00101010, 8], [0b00101011, 8], [0b00101100, 8], [0b00101101, 8], [0b00000100, 8], [0b00000101, 8], [0b00001010, 8],
  [0b00001011, 8], [0b01010010, 8], [0b01010011, 8], [0b01010100, 8], [0b01010101, 8], [0b00100100, 8], [0b00100101, 8], [0b01011000, 8],
  [0b01011001, 8], [0b01011010, 8], [0b01011011, 8], [0b01001010, 8], [0b01001011, 8], [0b00110010, 8], [0b00110011, 8], [0b00110100, 8],
];
const T4_BLACK_TERMS: Array<[number, number]> = [
  [0b0000110111, 10], [0b010, 3], [0b11, 2], [0b10, 2], [0b011, 3], [0b0011, 4], [0b0010, 4], [0b00011, 5],
  [0b000101, 6], [0b000100, 6], [0b0000100, 7], [0b0000101, 7], [0b0000111, 7], [0b00000100, 8], [0b00000111, 8], [0b000011000, 9],
  [0b0000010111, 10], [0b0000011000, 10], [0b0000001000, 10], [0b00001100111, 11], [0b00001101000, 11], [0b00001101100, 11], [0b00000110111, 11], [0b00000101000, 11],
  [0b00000010111, 11], [0b00000011000, 11], [0b000011001010, 12], [0b000011001011, 12], [0b000011001100, 12], [0b000011001101, 12], [0b000001101000, 12], [0b000001101001, 12],
  [0b000001101010, 12], [0b000001101011, 12], [0b000011010010, 12], [0b000011010011, 12], [0b000011010100, 12], [0b000011010101, 12], [0b000011010110, 12], [0b000011010111, 12],
  [0b000001101100, 12], [0b000001101101, 12], [0b000011011010, 12], [0b000011011011, 12], [0b000001010100, 12], [0b000001010101, 12], [0b000001010110, 12], [0b000001010111, 12],
  [0b000001100100, 12], [0b000001100101, 12], [0b000001010010, 12], [0b000001010011, 12], [0b000000100100, 12], [0b000000110111, 12], [0b000000111000, 12], [0b000000100111, 12],
  [0b000000101000, 12], [0b000001011000, 12], [0b000001011001, 12], [0b000000101011, 12], [0b000000101100, 12], [0b000001011010, 12], [0b000001100110, 12], [0b000001100111, 12],
];

function encodeCcittT6Small(width: number, height: number, pixels: Uint8Array): Buffer {
  const bytes: number[] = [];
  let curByte = 0;
  let bitCount = 0;
  const writeBits = (code: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      curByte = (curByte << 1) | ((code >> i) & 1);
      bitCount++;
      if (bitCount === 8) {
        bytes.push(curByte & 0xff);
        curByte = 0;
        bitCount = 0;
      }
    }
  };

  for (let y = 0; y < height; y++) {
    let x = 0;
    const rowOff = y * width;
    while (x < width) {
      let wRun = 0;
      while (x < width && pixels[rowOff + x] === 0 && wRun < 63) {
        wRun++;
        x++;
      }
      let bRun = 0;
      while (x < width && pixels[rowOff + x] === 1 && bRun < 63) {
        bRun++;
        x++;
      }
      writeBits(0b001, 3); // Horizontal mode
      writeBits(T4_WHITE_TERMS[wRun][0], T4_WHITE_TERMS[wRun][1]);
      writeBits(T4_BLACK_TERMS[bRun][0], T4_BLACK_TERMS[bRun][1]);
    }
  }
  // EOFB
  writeBits(0b000000000001, 12);
  writeBits(0b000000000001, 12);
  if (bitCount > 0) {
    bytes.push((curByte << (8 - bitCount)) & 0xff);
  }
  return Buffer.from(bytes);
}

function makeIocaCcittG4LogoSegment(segName: string, seqStart: number): Buffer[] {
  const w = 32;
  const h = 32;
  const pix = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - 15.5);
      const dy = Math.abs(y - 15.5);
      const d = dx + dy;
      if ((d >= 6 && d <= 13.5) || (x <= 4 && dy <= 6.5)) {
        pix[y * w + x] = 1;
      }
    }
  }
  const encoded = encodeCcittT6Small(w, h, pix);
  const idd = Buffer.alloc(21);
  idd.writeUInt16BE(2400, 1);
  idd.writeUInt16BE(2400, 3);
  idd.writeUInt16BE(w, 5);
  idd.writeUInt16BE(h, 7);
  idd[9] = 0xf6;
  idd[10] = 0x0a;
  idd.writeUInt16BE(2400, 12);
  idd.writeUInt16BE(2400, 14);
  idd.writeUInt16BE(w, 16);
  idd.writeUInt16BE(h, 18);

  const ipd = Buffer.concat([
    Buffer.from([0x70, 0x00, 0x91, 0x01, 0xff]),
    Buffer.from([0x95, 0x02, 0x82, 0x01]), // 0x82 = CCITT Group 4 (T.6)
    Buffer.from([0x96, 0x01, 0x01]), // 1-bit
    Buffer.from([0xfe, 0x92, (encoded.length >> 8) & 0xff, encoded.length & 0xff]),
    encoded,
    Buffer.from([0x93, 0x00, 0x71, 0x00]),
  ]);

  return [
    sf('D3A85F', seqStart, encodeEbcdic(segName.padEnd(8, ' ').slice(0, 8))), // BPS
    sf('D3A8FB', seqStart + 1, encodeEbcdic('IMG_CIBC_G4')), // BIM
    sf('D3A66B', seqStart + 2, makeOad(115, 115)), // OAD
    sf('D3A6FB', seqStart + 3, idd), // IDD
    sf('D3EEFB', seqStart + 4, ipd), // IPD
    sf('D3A9FB', seqStart + 5), // EIM
    sf('D3A95F', seqStart + 6), // EPS
  ];
}

function makeRgbStampIoca(
  seqStart: number,
  x: number,
  y: number,
  sizeUnits: number,
  outerRgb: [number, number, number],
  innerRgb: [number, number, number]
): Buffer[] {
  const w = 36;
  const h = 36;
  const rgbBuf = Buffer.alloc(w * h * 3);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 3;
      const dx = px - 17.5;
      const dy = py - 17.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= 12.5 && dist <= 16.5) {
        rgbBuf[idx] = outerRgb[0];
        rgbBuf[idx + 1] = outerRgb[1];
        rgbBuf[idx + 2] = outerRgb[2];
      } else if (Math.abs(dx) + Math.abs(dy) <= 8.5) {
        rgbBuf[idx] = innerRgb[0];
        rgbBuf[idx + 1] = innerRgb[1];
        rgbBuf[idx + 2] = innerRgb[2];
      } else if (dist < 12.5) {
        rgbBuf[idx] = 248;
        rgbBuf[idx + 1] = 250;
        rgbBuf[idx + 2] = 252;
      } else {
        rgbBuf[idx] = 255;
        rgbBuf[idx + 1] = 255;
        rgbBuf[idx + 2] = 255;
      }
    }
  }

  const idd = Buffer.alloc(21);
  idd.writeUInt16BE(2400, 1);
  idd.writeUInt16BE(2400, 3);
  idd.writeUInt16BE(w, 5);
  idd.writeUInt16BE(h, 7);
  idd[9] = 0xf6;
  idd[10] = 0x0a;
  idd.writeUInt16BE(2400, 12);
  idd.writeUInt16BE(2400, 14);
  idd.writeUInt16BE(w, 16);
  idd.writeUInt16BE(h, 18);

  const ipd = Buffer.concat([
    Buffer.from([0x70, 0x00, 0x91, 0x01, 0xff]),
    Buffer.from([0x95, 0x02, 0x03, 0x01]), // uncompressed
    Buffer.from([0x96, 0x01, 24]), // 24-bit RGB
    Buffer.from([0xfe, 0x92, (rgbBuf.length >> 8) & 0xff, rgbBuf.length & 0xff]),
    rgbBuf,
    Buffer.from([0x93, 0x00, 0x71, 0x00]),
  ]);

  return [
    sf('D3A8FB', seqStart, encodeEbcdic('STAMP_RGB')), // BIM
    sf('D3AC6B', seqStart + 1, makeObp(x, y)), // OBP
    sf('D3A66B', seqStart + 2, makeOad(sizeUnits, sizeUnits)), // OAD
    sf('D3A6FB', seqStart + 3, idd), // IDD
    sf('D3EEFB', seqStart + 4, ipd), // IPD
    sf('D3A9FB', seqStart + 5), // EIM
  ];
}

function makeGrayscaleSignatureIoca(seqStart: number, x: number, y: number): Buffer[] {
  const w = 120;
  const h = 36;
  const gray = Buffer.alloc(w * h, 255);
  // Synthesize smooth cursive signature waveform using anti-aliased distance shading
  for (let px = 6; px < w - 6; px++) {
    const t = (px - 6) / (w - 12);
    const cy = 18 - Math.sin(t * Math.PI * 5.5) * 9 * (1 - t * 0.35) - Math.cos(t * Math.PI * 2.2) * 3;
    for (let py = 2; py < h - 2; py++) {
      const dist = Math.abs(py - cy);
      if (dist < 1.9) {
        const shade = Math.min(255, Math.max(15, Math.round(dist * 115)));
        gray[py * w + px] = Math.min(gray[py * w + px], shade);
      }
    }
  }

  const idd = Buffer.alloc(21);
  idd.writeUInt16BE(2400, 1);
  idd.writeUInt16BE(2400, 3);
  idd.writeUInt16BE(w, 5);
  idd.writeUInt16BE(h, 7);
  idd[9] = 0xf6;
  idd[10] = 0x0a;
  idd.writeUInt16BE(2400, 12);
  idd.writeUInt16BE(2400, 14);
  idd.writeUInt16BE(w, 16);
  idd.writeUInt16BE(h, 18);

  const ipd = Buffer.concat([
    Buffer.from([0x70, 0x00, 0x91, 0x01, 0xff]),
    Buffer.from([0x95, 0x02, 0x03, 0x01]),
    Buffer.from([0x96, 0x01, 8]), // 8-bit grayscale
    Buffer.from([0xfe, 0x92, (gray.length >> 8) & 0xff, gray.length & 0xff]),
    gray,
    Buffer.from([0x93, 0x00, 0x71, 0x00]),
  ]);

  return [
    sf('D3A8FB', seqStart, encodeEbcdic('SIGN_G8')), // BIM
    sf('D3AC6B', seqStart + 1, makeObp(x, y)), // OBP
    sf('D3A66B', seqStart + 2, makeOad(580, 175)), // OAD
    sf('D3A6FB', seqStart + 3, idd), // IDD
    sf('D3EEFB', seqStart + 4, ipd), // IPD
    sf('D3A9FB', seqStart + 5), // EIM
  ];
}

// GOCA drawing helpers
function gocaColorRgb(r: number, g: number, b: number): Buffer {
  return Buffer.from([0x26, 4, 0xff, r, g, b]);
}
function gocaLineWidth(w: number): Buffer {
  return Buffer.from([0x18, 1, w]);
}
function gocaBeginArea(): Buffer {
  return Buffer.from([0x68, 0]);
}
function gocaEndArea(): Buffer {
  return Buffer.from([0x58, 0]);
}
function gocaBox(x1: number, y1: number, x2: number, y2: number): Buffer {
  const b = Buffer.alloc(10);
  b[0] = 0xc0;
  b[1] = 8;
  b.writeInt16BE(x1, 2);
  b.writeInt16BE(y1, 4);
  b.writeInt16BE(x2, 6);
  b.writeInt16BE(y2, 8);
  return b;
}
function gocaCircle(cx: number, cy: number, r: number): Buffer {
  const b = Buffer.alloc(8);
  b[0] = 0xc7;
  b[1] = 6;
  b.writeInt16BE(cx, 2);
  b.writeInt16BE(cy, 4);
  b.writeInt16BE(r, 6);
  return b;
}
function gocaPolyline(pts: Array<[number, number]>): Buffer {
  const b = Buffer.alloc(2 + pts.length * 4);
  b[0] = 0x81;
  b[1] = pts.length * 4;
  pts.forEach(([px, py], i) => {
    b.writeInt16BE(px, 2 + i * 4);
    b.writeInt16BE(py, 4 + i * 4);
  });
  return b;
}

function makeGocaObject(
  seqStart: number,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  orders: Buffer[]
): Buffer[] {
  const gdd = Buffer.alloc(16);
  gdd.writeUInt16BE(w, 8);
  gdd.writeUInt16BE(h, 10);
  return [
    sf('D3A8BB', seqStart, encodeEbcdic(name.padEnd(8, ' ').slice(0, 8))), // BGR
    sf('D3AC6B', seqStart + 1, makeObp(x, y)), // OBP
    sf('D3A66B', seqStart + 2, makeOad(w, h)), // OAD
    sf('D3A6BB', seqStart + 3, gdd), // GDD
    sf('D3EEBB', seqStart + 4, Buffer.concat(orders)), // GAD
    sf('D3A9BB', seqStart + 5), // EGR
  ];
}

// PTOCA construction helper with SEC RGB colors, fonts, DIR/DBR rules, and STO rotation
type PtocaItem =
  | { kind: 'text'; x: number; y: number; fontId: number; text: string; rgb?: [number, number, number]; sto?: number }
  | { kind: 'dir'; x: number; y: number; len: number; width: number; rgb?: [number, number, number] }
  | { kind: 'dbr'; x: number; y: number; len: number; width: number; rgb?: [number, number, number] };

function makePtocaBlock(items: PtocaItem[]): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x2b, 0xd3])];
  const pushColor = (rgbColor?: [number, number, number]) => {
    const [r, g, b] = rgbColor ?? [15, 23, 42];
    // SEC (0x81 chained) RGB: len=13, fn=0x81, pad(0x00), colorSpace(0x01=RGB), pad(0x00*7), R, G, B
    chunks.push(Buffer.from([13, 0x81, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, r, g, b]));
  };

  for (const it of items) {
    pushColor(it.rgb);
    if (it.kind === 'text') {
      if (typeof it.sto === 'number') {
        const sto = Buffer.alloc(6);
        sto[0] = 6;
        sto[1] = 0xf7;
        sto.writeUInt16BE(it.sto, 2);
        sto.writeUInt16BE((it.sto + 0x2d00) & 0xffff, 4);
        chunks.push(sto);
      }
      const ami = Buffer.alloc(4);
      ami[0] = 4;
      ami[1] = 0xc7;
      ami.writeInt16BE(it.x, 2);

      const amb = Buffer.alloc(4);
      amb[0] = 4;
      amb[1] = 0xd3;
      amb.writeInt16BE(it.y, 2);

      const scfl = Buffer.from([3, 0xf1, it.fontId]);
      const tBuf = encodeEbcdic(it.text);
      const trn = Buffer.concat([Buffer.from([2 + tBuf.length, 0xdb]), tBuf]);
      chunks.push(ami, amb, scfl, trn);

      if (typeof it.sto === 'number') {
        chunks.push(Buffer.from([6, 0xf7, 0x00, 0x00, 0x2d, 0x00]));
      }
    } else {
      const ami = Buffer.alloc(4);
      ami[0] = 4;
      ami[1] = 0xc7;
      ami.writeInt16BE(it.x, 2);

      const amb = Buffer.alloc(4);
      amb[0] = 4;
      amb[1] = 0xd3;
      amb.writeInt16BE(it.y, 2);

      const rule = Buffer.alloc(7);
      rule[0] = 7;
      rule[1] = it.kind === 'dir' ? 0xe5 : 0xe7; // DIR (0xE5) horizontal vs DBR (0xE7) vertical
      rule.writeInt16BE(it.len, 2);
      rule.writeInt16BE(it.width, 4);
      rule[6] = 0x00;
      chunks.push(ami, amb, rule);
    }
  }
  return Buffer.concat(chunks);
}

function makeBcoca(seqStart: number, name: string, x: number, y: number, w: number, h: number, value: string): Buffer[] {
  const bdaHeader = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
  const bdaData = Buffer.concat([bdaHeader, encodeEbcdic(value)]);
  return [
    sf('D3A8EB', seqStart, encodeEbcdic(name.padEnd(8, ' ').slice(0, 8))), // BBC
    sf('D3AC6B', seqStart + 1, makeObp(x, y)), // OBP
    sf('D3A66B', seqStart + 2, makeOad(w, h)), // OAD
    sf('D3A6EB', seqStart + 3, Buffer.from([0x00, 0x09, 0x60, 0x09, 0x60, 0x01, 0x00])), // BDD
    sf('D3EEEB', seqStart + 4, bdaData), // BDA
    sf('D3A9EB', seqStart + 5), // EBC
  ];
}

export function createComplexAfpFormPair(): { baseline: Buffer; candidate: Buffer } {
  const buildStream = (isCandidate: boolean): Buffer => {
    const out: Buffer[] = [];
    let seq = 1;
    const nextSeq = (step = 1) => {
      const s = seq;
      seq += step;
      return s;
    };

    out.push(sf('D3A8A8', nextSeq(), encodeEbcdic('DOC_CIBC_COMPLEX_12890'))); // BDT

    // Shared 1-bit CCITT Group 4 CIBC geometric logo Page Segment
    out.push(...makeIocaCcittG4LogoSegment('SEG_CLG1', nextSeq(8)));

    // Shared MCF2 Fonts (applied globally prior to BMO overlay so BMO & pages share fonts)
    const mcf2Payload = makeMcf2([
      { localId: 1, name: 'T100H090', sizePt: 9 },
      { localId: 2, name: 'C0H400B0', sizePt: 11 },
      { localId: 3, name: 'C0T20080', sizePt: 8.5 },
      { localId: 4, name: '3OF9BC00', sizePt: 10 },
      { localId: 5, name: 'C0CR1090', sizePt: 9 },
      { localId: 6, name: 'C0H20070', sizePt: 7.5 },
      { localId: 7, name: 'C0H400E0', sizePt: 13.5 },
    ]);
    out.push(sf('D3B18A', nextSeq(), mcf2Payload)); // MCF2

    // Reusable Form Template Overlay ('OVL_CIBC') containing GOCA frame/borders/emblem + PTOCA table grid + labels
    const burgundy: [number, number, number] = [139, 0, 41];
    const navy: [number, number, number] = [15, 41, 74];
    const gold: [number, number, number] = [202, 138, 4];
    const slateFill: [number, number, number] = [232, 238, 245];
    const creamFill: [number, number, number] = [248, 250, 252];
    const borderInk: [number, number, number] = [71, 85, 105];

    out.push(sf('D3A8D8', nextSeq(), encodeEbcdic('OVL_CIBC'))); // BMO
    out.push(
      ...makeGocaObject(nextSeq(6), 'GOC_FRM1', 0, 0, 2040, 2640, [
        // Outer form border
        gocaColorRgb(...navy),
        gocaLineWidth(4),
        gocaBox(110, 95, 1930, 2530),
        // Top CIBC burgundy header banner + gold emblem circle
        gocaColorRgb(...burgundy),
        gocaBeginArea(),
        gocaBox(122, 107, 1918, 268),
        gocaEndArea(),
        gocaColorRgb(...gold),
        gocaBeginArea(),
        gocaCircle(1815, 187, 44),
        gocaEndArea(),
        // Section 1 header bar + outer box
        gocaColorRgb(...creamFill),
        gocaBeginArea(),
        gocaBox(140, 325, 1900, 695),
        gocaEndArea(),
        gocaColorRgb(...borderInk),
        gocaLineWidth(2),
        gocaBox(140, 325, 1900, 695),
        // Section 2 header bar + checkbox boxes
        gocaColorRgb(...borderInk),
        gocaLineWidth(2),
        gocaBox(140, 745, 1900, 1110),
        gocaBox(175, 845, 212, 882),
        gocaBox(175, 920, 212, 957),
        gocaBox(175, 995, 212, 1032),
        // Section 3 Table shaded header row
        gocaColorRgb(...slateFill),
        gocaBeginArea(),
        gocaBox(140, 1215, 1900, 1300),
        gocaEndArea(),
      ])
    );

    // Table Grid (DIR horizontal + DBR vertical rules) and template labels inside BMO Overlay
    out.push(sf('D3A8DF', nextSeq())); // BPT
    out.push(
      sf(
        'D3EE9B',
        nextSeq(),
        makePtocaBlock([
          {
            kind: 'text',
            x: 310,
            y: 175,
            fontId: 7,
            text: 'CIBC COMMERCIAL BANKING — TRUST & WIRE AUTHORIZATION',
            rgb: [255, 255, 255],
          },
          {
            kind: 'text',
            x: 310,
            y: 230,
            fontId: 1,
            text: 'FORM 12890-COM  |  INSTITUTION: 010  |  CDIC REGISTERED CUSTODIAL SCHEDULE',
            rgb: [254, 242, 242],
          },
          // Section 1 Labels
          { kind: 'text', x: 165, y: 375, fontId: 2, text: '1. APPLICANT & DESIGNATED SETTLEMENT ACCOUNT', rgb: burgundy },
          { kind: 'dir', x: 140, y: 398, len: 1760, width: 3, rgb: burgundy },
          { kind: 'text', x: 170, y: 458, fontId: 1, text: 'Legal Business Name:', rgb: borderInk },
          { kind: 'text', x: 170, y: 525, fontId: 1, text: 'CRA Business Number:', rgb: borderInk },
          { kind: 'text', x: 170, y: 592, fontId: 1, text: 'Institution / Transit / Acct:', rgb: borderInk },
          { kind: 'text', x: 170, y: 658, fontId: 1, text: 'Authorization Reference:', rgb: borderInk },
          // Section 2 Labels
          { kind: 'text', x: 165, y: 795, fontId: 2, text: '2. WIRE & EFT EXECUTION CONTROLS (CHECK ALL THAT APPLY)', rgb: navy },
          { kind: 'dir', x: 140, y: 816, len: 1760, width: 3, rgb: navy },
          // Section 3 Table Title & Column Headers
          { kind: 'text', x: 165, y: 1185, fontId: 2, text: '3. FEE SCHEDULE, WAIVER THRESHOLDS & AUTHORIZED LIMITS', rgb: navy },
          { kind: 'text', x: 165, y: 1272, fontId: 2, text: 'SERVICE / PRODUCT TIER', rgb: navy },
          { kind: 'text', x: 765, y: 1272, fontId: 2, text: 'STANDARD FEE', rgb: navy },
          { kind: 'text', x: 1145, y: 1272, fontId: 2, text: 'WAIVER THRESHOLD', rgb: navy },
          { kind: 'text', x: 1555, y: 1272, fontId: 2, text: 'ENFORCEMENT STATUS', rgb: navy },
          // 4-column table grid borders (DIR horizontal + DBR vertical)
          { kind: 'dir', x: 140, y: 1215, len: 1760, width: 3, rgb: navy },
          { kind: 'dir', x: 140, y: 1300, len: 1760, width: 3, rgb: navy },
          { kind: 'dir', x: 140, y: 1400, len: 1760, width: 2, rgb: borderInk },
          { kind: 'dir', x: 140, y: 1500, len: 1760, width: 2, rgb: borderInk },
          { kind: 'dir', x: 140, y: 1600, len: 1760, width: 2, rgb: borderInk },
          { kind: 'dir', x: 140, y: 1700, len: 1760, width: 3, rgb: navy },
          { kind: 'dbr', x: 140, y: 1215, len: 485, width: 3, rgb: navy },
          { kind: 'dbr', x: 740, y: 1215, len: 485, width: 2, rgb: borderInk },
          { kind: 'dbr', x: 1120, y: 1215, len: 485, width: 2, rgb: borderInk },
          { kind: 'dbr', x: 1525, y: 1215, len: 485, width: 2, rgb: borderInk },
          { kind: 'dbr', x: 1900, y: 1215, len: 485, width: 3, rgb: navy },
        ])
      )
    );
    out.push(sf('D3A9DF', nextSeq())); // EPT
    out.push(sf('D3A9D8', nextSeq())); // EMO

    // IMM Duplex Control + Named Page Group + TLE Tags
    out.push(sf('D3ABCC', nextSeq(), encodeEbcdic('DUPLEX02'))); // IMM
    out.push(sf('D3A8AD', nextSeq(), encodeEbcdic('GRP_CIBC_12890_001'))); // BNG
    out.push(sf('D3A090', nextSeq(), makeTle('INST_CODE', '010_CIBC_COM')));
    out.push(sf('D3A090', nextSeq(), makeTle('FORM_ID', 'CIBC_12890_WIRE')));
    out.push(sf('D3A090', nextSeq(), makeTle('MAIL_TRAY', isCandidate ? 'TRAY_02' : 'TRAY_01')));

    // =================== PAGE 1 ===================
    out.push(sf('D3A8AF', nextSeq(), encodeEbcdic('PAGE_0001'))); // BPG
    out.push(sf('D3A8C9', nextSeq())); // BAG
    out.push(sf('D3A6AF', nextSeq(), makePgd(2040, 2640, 240))); // PGD
    out.push(sf('D3B18A', nextSeq(), mcf2Payload)); // MCF2
    out.push(sf('D3ABD8', nextSeq(), encodeEbcdic('OVL_CIBC'))); // MPO
    out.push(sf('D3A9C9', nextSeq())); // EAG

    // Include Form Overlay + CCITT G4 CIBC Logo Segment
    out.push(sf('D3AFD8', nextSeq(), makeResPos('OVL_CIBC', 0, 0))); // IPO
    out.push(sf('D3AF5F', nextSeq(), makeResPos('SEG_CLG1', 150, 128))); // IPS

    // Filled Form Data on Page 1
    out.push(sf('D3A8DF', nextSeq())); // BPT
    out.push(
      sf(
        'D3EE9B',
        nextSeq(),
        makePtocaBlock([
          { kind: 'text', x: 650, y: 458, fontId: 2, text: 'Northwind Commercial Holdings Ltd.', rgb: navy },
          { kind: 'text', x: 650, y: 525, fontId: 5, text: '84920-1142-RC0001', rgb: navy },
          { kind: 'text', x: 650, y: 592, fontId: 5, text: '010  /  00012  /  ****-****-4821', rgb: navy },
          { kind: 'text', x: 650, y: 658, fontId: 5, text: 'AUTH-SYN-2026-1121-01', rgb: navy },

          // Filled Checkboxes in Section 2
          { kind: 'text', x: 185, y: 874, fontId: 2, text: 'X', rgb: burgundy },
          { kind: 'text', x: 238, y: 874, fontId: 1, text: 'Domestic & Cross-Border Automated EFT / Wire Settlement Enabled', rgb: navy },
          {
            kind: 'text',
            x: 185,
            y: 949,
            fontId: 2,
            text: isCandidate ? ' ' : 'X', // Intentionally unchecked in DDGS!
            rgb: burgundy,
          },
          {
            kind: 'text',
            x: 238,
            y: 949,
            fontId: 1,
            text: isCandidate
              ? '[ ] Dual-Custody Treasury Approval Overridden (Review)'
              : 'Dual-Custody Treasury Approval Required >= $25,000.00',
            rgb: isCandidate ? burgundy : navy,
          },
          { kind: 'text', x: 185, y: 1024, fontId: 2, text: 'X', rgb: burgundy },
          { kind: 'text', x: 238, y: 1024, fontId: 1, text: 'CDIC Nominee Beneficial Ownership Reporting Attached (Page 2)', rgb: navy },

          // Filled Table Row 1 (Text fee variance in DDGS)
          { kind: 'text', x: 165, y: 1365, fontId: 1, text: 'Smart Plus Business Account', rgb: navy },
          { kind: 'text', x: 765, y: 1365, fontId: isCandidate ? 3 : 5, text: isCandidate ? '$19.95 / mo' : '$16.95 / mo', rgb: isCandidate ? burgundy : navy },
          { kind: 'text', x: 1145, y: 1365, fontId: 5, text: '$4,000.00 min bal', rgb: navy },
          { kind: 'text', x: 1555, y: 1365, fontId: 2, text: 'ACTIVE', rgb: [21, 128, 61] },

          // Filled Table Row 2 (Wire fee variance in DDGS)
          { kind: 'text', x: 165, y: 1465, fontId: 1, text: 'Domestic Wire Transfer (CAD)', rgb: navy },
          { kind: 'text', x: 765, y: 1465, fontId: 5, text: isCandidate ? '$30.00 / txn' : '$25.00 / txn', rgb: isCandidate ? burgundy : navy },
          { kind: 'text', x: 1145, y: 1465, fontId: 5, text: '$50,000.00 daily', rgb: navy },
          { kind: 'text', x: 1555, y: 1465, fontId: 2, text: 'ENABLED', rgb: [21, 128, 61] },

          // Filled Table Row 3 (Pure Horizontal X-Coordinate Alignment Shift >36 L-units in DDGS!)
          { kind: 'text', x: 165, y: 1565, fontId: 1, text: 'SWIFT International Outbound', rgb: navy },
          { kind: 'text', x: isCandidate ? 825 : 765, y: 1565, fontId: 5, text: '$45.00 / txn', rgb: navy },
          { kind: 'text', x: 1145, y: 1565, fontId: 5, text: 'Treasury FX Tier', rgb: navy },
          { kind: 'text', x: 1555, y: 1565, fontId: 2, text: 'VERIFIED', rgb: [21, 128, 61] },

          // Filled Table Row 4
          { kind: 'text', x: 165, y: 1665, fontId: 1, text: 'Paper Compliance Audit Trail', rgb: navy },
          { kind: 'text', x: 765, y: 1665, fontId: 5, text: '$0.00 (Waived)', rgb: navy },
          { kind: 'text', x: 1145, y: 1665, fontId: 5, text: 'E-Consent On File', rgb: navy },
          { kind: 'text', x: 1555, y: 1665, fontId: 2, text: 'WAIVED', rgb: [21, 128, 61] },

          // Compliance note & rotated 270deg mailroom barcode
          {
            kind: 'text',
            x: 165,
            y: 1840,
            fontId: 6,
            text: 'NOTICE: Authorized wire limits execute under CIBC Commercial Treasury Master Agreement v2026.4 (Page 1 of 2).',
            rgb: borderInk,
          },
          { kind: 'text', x: 82, y: 2150, fontId: 4, sto: 0x8700, text: '*070202000000*' },
        ])
      )
    );
    out.push(sf('D3A9DF', nextSeq())); // EPT

    // Page 1 Horizontal BCOCA Postal Barcode
    out.push(...makeBcoca(nextSeq(6), 'BC_POST1', 165, 2240, 560, 88, 'CIBC12890010'));

    // Page 1 Embedded 24-bit RGB Branch Stamp Image (Color & Size Variation between IMDS and DDGS!)
    out.push(
      ...makeRgbStampIoca(
        nextSeq(6),
        isCandidate ? 1580 : 1615,
        isCandidate ? 2095 : 2120,
        isCandidate ? 255 : 215,
        isCandidate ? [29, 78, 216] : [139, 0, 41], // Blue in DDGS vs Burgundy in IMDS
        isCandidate ? [21, 128, 61] : [202, 138, 4]
      )
    );
    out.push(sf('D3A9AF', nextSeq())); // EPG Page 1

    // =================== PAGE 2 ===================
    out.push(sf('D3A8AF', nextSeq(), encodeEbcdic('PAGE_0002'))); // BPG
    out.push(sf('D3A8C9', nextSeq())); // BAG
    out.push(sf('D3A6AF', nextSeq(), makePgd(2040, 2640, 240))); // PGD
    out.push(sf('D3B18A', nextSeq(), mcf2Payload)); // MCF2
    out.push(sf('D3A9C9', nextSeq())); // EAG

    // Page 2 CIBC G4 Logo
    out.push(sf('D3AF5F', nextSeq(), makeResPos('SEG_CLG1', 150, 125))); // IPS

    // Page 2 GOCA Multi-Border Layout + Beneficial Owner Schedule + Signature Box
    const page2GocaOrders: Buffer[] = [
      gocaColorRgb(...navy),
      gocaLineWidth(4),
      gocaBox(110, 95, 1930, 2530),
      // Compliance top accent bar
      gocaColorRgb(...slateFill),
      gocaBeginArea(),
      gocaBox(130, 310, 1910, 390),
      gocaEndArea(),
      // Beneficial Owners 3-Column Table outer box
      gocaColorRgb(...borderInk),
      gocaLineWidth(2),
      gocaBox(140, 520, 1900, 1080),
      // Signature Block Frame (omits inner countersign box in DDGS -> Vector/Border Variation!)
      gocaColorRgb(...creamFill),
      gocaBeginArea(),
      gocaBox(140, 1740, 1900, 2240),
      gocaEndArea(),
      gocaColorRgb(...navy),
      gocaLineWidth(3),
      gocaBox(140, 1740, 1900, 2240),
    ];
    if (!isCandidate) {
      // IMDS includes countersign divider box inside Signature Frame
      page2GocaOrders.push(gocaColorRgb(...borderInk), gocaLineWidth(2), gocaPolyline([[1020, 1765], [1020, 2215]]));
    }
    out.push(...makeGocaObject(nextSeq(6), 'GOC_P2', 0, 0, 2040, 2640, page2GocaOrders));

    // Page 2 Text & Table Rules (DDGS omits bottom table DIR divider at y=1080/960)
    const p2PtocaItems: PtocaItem[] = [
      { kind: 'text', x: 310, y: 175, fontId: 7, text: 'CIBC BENEFICIAL OWNERSHIP & AUTHORIZED SIGNATORY', rgb: burgundy },
      { kind: 'text', x: 310, y: 225, fontId: 1, text: 'SCHEDULE B — FORM 12890-COM  |  PAGE 2 OF 2  |  PRIVACY & ATTESTATION', rgb: borderInk },
      { kind: 'dir', x: 130, y: 265, len: 1780, width: 4, rgb: burgundy },
      { kind: 'text', x: 165, y: 360, fontId: 2, text: '4. BENEFICIAL OWNERS (>= 25% EQUITY CONTROL)', rgb: navy },
      // Table Headers
      { kind: 'text', x: 165, y: 585, fontId: 2, text: 'SIGNATORY LEGAL NAME', rgb: navy },
      { kind: 'text', x: 860, y: 585, fontId: 2, text: 'CORPORATE ROLE', rgb: navy },
      { kind: 'text', x: 1460, y: 585, fontId: 2, text: 'EQUITY / SIGNING CAP', rgb: navy },
      { kind: 'dir', x: 140, y: 615, len: 1760, width: 3, rgb: navy },
      // Table Rows
      { kind: 'text', x: 165, y: 695, fontId: 1, text: 'Eleanor Vance', rgb: navy },
      { kind: 'text', x: 860, y: 695, fontId: 1, text: 'Chief Financial Officer', rgb: navy },
      { kind: 'text', x: 1460, y: 695, fontId: 5, text: '42.0%  /  UNLIMITED', rgb: navy },
      { kind: 'dir', x: 140, y: 740, len: 1760, width: 2, rgb: borderInk },
      { kind: 'text', x: 165, y: 825, fontId: 1, text: 'Marcus Sterling', rgb: navy },
      { kind: 'text', x: 860, y: 825, fontId: 1, text: 'VP Commercial Treasury', rgb: navy },
      { kind: 'text', x: 1460, y: 825, fontId: 5, text: '33.0%  /  $250,000', rgb: navy },
      { kind: 'dir', x: 140, y: 870, len: 1760, width: 2, rgb: borderInk },
      { kind: 'text', x: 165, y: 955, fontId: 1, text: 'Priya Nair', rgb: navy },
      { kind: 'text', x: 860, y: 955, fontId: 1, text: 'Corporate Secretary', rgb: navy },
      { kind: 'text', x: 1460, y: 955, fontId: 5, text: '25.0%  /  $100,000', rgb: navy },
      // Table Vertical column dividers
      { kind: 'dbr', x: 830, y: 520, len: 560, width: 2, rgb: borderInk },
      { kind: 'dbr', x: 1430, y: 520, len: 560, width: 2, rgb: borderInk },
      // Regulatory Text & Signature Captions
      { kind: 'text', x: 155, y: 1250, fontId: 3, text: 'CDIC Attestation: Under the Canada Deposit Insurance Corporation Act, trustee disclosures must be updated annually.', rgb: borderInk },
      { kind: 'text', x: 155, y: 1320, fontId: 3, text: 'Privacy Consent: CIBC retains encrypted signatory specimens solely for wire authentication and fraud prevention.', rgb: borderInk },
      { kind: 'text', x: 170, y: 1805, fontId: 2, text: 'AUTHORIZED SIGNATORY SPECIMEN (SCANNED 8-BIT GRAYSCALE)', rgb: navy },
      { kind: 'dir', x: 185, y: 2135, len: 680, width: 2, rgb: navy },
      { kind: 'text', x: 185, y: 2180, fontId: 6, text: 'Authorized Signature: E. Vance  |  Date Signed: 2026-11-21', rgb: borderInk },
      { kind: 'text', x: 1055, y: 1805, fontId: 2, text: 'BANK OFFICER COUNTERSIGNATURE & TRANSIT STAMP', rgb: navy },
      { kind: 'text', x: 1055, y: 1920, fontId: 5, text: 'Transit: 00012   Verified By: OPS_SUPV_04', rgb: borderInk },
    ];
    if (!isCandidate) {
      // IMDS draws extra bottom sub-table rule at y=1015 omitted in DDGS
      p2PtocaItems.push({ kind: 'dir', x: 140, y: 1015, len: 1760, width: 2, rgb: borderInk });
    }
    out.push(sf('D3A8DF', nextSeq())); // BPT
    out.push(sf('D3EE9B', nextSeq(), makePtocaBlock(p2PtocaItems)));
    out.push(sf('D3A9DF', nextSeq())); // EPT

    // 8-bit Grayscale Scanned Signature Bitmap inside Signature Box
    out.push(...makeGrayscaleSignatureIoca(nextSeq(6), 210, 1925));

    out.push(sf('D3A9AF', nextSeq())); // EPG Page 2
    out.push(sf('D3A9AD', nextSeq())); // ENG
    out.push(sf('D3A9A8', nextSeq())); // EDT
    return Buffer.concat(out);
  };

  return {
    baseline: buildStream(false),
    candidate: buildStream(true),
  };
}
