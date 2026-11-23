import zlib from 'node:zlib';
import { computeSha256, redactSensitiveText } from './security.ts';
import type {
  AfpPageGeometry,
  AfpPtocaRun,
  AfpResourceRef,
  AfpStructuredField,
  AfpTextSpan,
  AfpTleEntry,
  AfpVisualElement,
  AfpVisualPage,
  ArtifactMetadata,
} from '../src/types/qe.ts';

export interface AfpParsedResult {
  meta: ArtifactMetadata;
  pagesText: string[][];
  pagesBlank: boolean[];
  pagesDimensions: Array<{ width: number; height: number }>;
  afpFields: AfpStructuredField[];
  afpNative: {
    encodingDetected: string;
    tles: AfpTleEntry[];
    resources: AfpResourceRef[];
    ptocaRuns: AfpPtocaRun[];
    geometry: AfpPageGeometry[];
    visualPages: AfpVisualPage[];
    mediaAssets: Record<string, string>;
    totalBngCount: number;
    totalFieldCount: number;
  };
  rawUncompressedBuffer: Buffer;
}

const MODCA_SFID_MAP: Record<string, { mnemonic: string; description: string }> = {
  D3A8A8: { mnemonic: 'BDT', description: 'Begin Document' },
  D3A9A8: { mnemonic: 'EDT', description: 'End Document' },
  D3A8AD: { mnemonic: 'BNG', description: 'Begin Named Page Group' },
  D3A9AD: { mnemonic: 'ENG', description: 'End Named Page Group' },
  D3A8AF: { mnemonic: 'BPG', description: 'Begin Page' },
  D3A9AF: { mnemonic: 'EPG', description: 'End Page' },
  D3A8C9: { mnemonic: 'BAG', description: 'Begin Active Environment Group' },
  D3A9C9: { mnemonic: 'EAG', description: 'End Active Environment Group' },
  D3A8C6: { mnemonic: 'BRG', description: 'Begin Resource Group' },
  D3A9C6: { mnemonic: 'ERG', description: 'End Resource Group' },
  D3A8CE: { mnemonic: 'BRS', description: 'Begin Resource' },
  D3A9CE: { mnemonic: 'ERS', description: 'End Resource' },
  D3A85F: { mnemonic: 'BPS', description: 'Begin Page Segment' },
  D3A95F: { mnemonic: 'EPS', description: 'End Page Segment' },
  D3AF5F: { mnemonic: 'IPS', description: 'Include Page Segment' },
  D3A8D8: { mnemonic: 'BMO', description: 'Begin Overlay' },
  D3A9D8: { mnemonic: 'EMO', description: 'End Overlay' },
  D3AFD8: { mnemonic: 'IPO', description: 'Include Page Overlay' },
  D3A8DF: { mnemonic: 'BPT', description: 'Begin Presentation Text' },
  D3A9DF: { mnemonic: 'EPT', description: 'End Presentation Text' },
  D3EE9B: { mnemonic: 'PTX', description: 'Presentation Text Data (PTOCA)' },
  D3A6AF: { mnemonic: 'PGD', description: 'Page Descriptor' },
  D3B19B: { mnemonic: 'PTD', description: 'Presentation Text Descriptor' },
  D3A090: { mnemonic: 'TLE', description: 'Tagged Logical Element' },
  D3AB8A: { mnemonic: 'MCF', description: 'Map Coded Font' },
  D3B18A: { mnemonic: 'MCF2', description: 'Map Coded Font (Format 2)' },
  D3ABD8: { mnemonic: 'MPO', description: 'Map Page Overlay' },
  D3ABAF: { mnemonic: 'MPS', description: 'Map Page Segment' },
  D3ABCC: { mnemonic: 'IMM', description: 'Invoke Medium Map' },
  D3B1DF: { mnemonic: 'MMO', description: 'Map Medium Overlay' },
  D3A8EB: { mnemonic: 'BBC', description: 'Begin Bar Code Object' },
  D3A9EB: { mnemonic: 'EBC', description: 'End Bar Code Object' },
  D3A6EB: { mnemonic: 'BDD', description: 'Bar Code Data Descriptor' },
  D3EEEB: { mnemonic: 'BDA', description: 'Bar Code Data' },
  D3A8FB: { mnemonic: 'BIM', description: 'Begin Image Object (IOCA)' },
  D3A9FB: { mnemonic: 'EIM', description: 'End Image Object (IOCA)' },
  D3A6FB: { mnemonic: 'IDD', description: 'Image Data Descriptor' },
  D3EEFB: { mnemonic: 'IPD', description: 'Image Picture Data' },
  D3A87B: { mnemonic: 'BII', description: 'Begin IM Image Object' },
  D3A97B: { mnemonic: 'EII', description: 'End IM Image Object' },
  D3A67B: { mnemonic: 'IID', description: 'IM Image Input Descriptor' },
  D3AC7B: { mnemonic: 'ICP', description: 'IM Image Cell Position' },
  D3EE7B: { mnemonic: 'IRD', description: 'IM Image Raster Data' },
  D3A8BB: { mnemonic: 'BGR', description: 'Begin Graphics Object (GOCA)' },
  D3A9BB: { mnemonic: 'EGR', description: 'End Graphics Object (GOCA)' },
  D3A6BB: { mnemonic: 'GDD', description: 'Graphics Data Descriptor' },
  D3EEBB: { mnemonic: 'GAD', description: 'Graphics Data' },
  D3A892: { mnemonic: 'BOC', description: 'Begin Object Container' },
  D3A992: { mnemonic: 'EOC', description: 'End Object Container' },
  D3EE92: { mnemonic: 'OCD', description: 'Object Container Data' },
  D3A692: { mnemonic: 'CDD', description: 'Container Data Descriptor' },
  D3A8C7: { mnemonic: 'BOG', description: 'Begin Object Environment Group' },
  D3A9C7: { mnemonic: 'EOG', description: 'End Object Environment Group' },
  D3AC6B: { mnemonic: 'OBP', description: 'Object Area Position' },
  D3A66B: { mnemonic: 'OAD', description: 'Object Area Descriptor' },
  D3A887: { mnemonic: 'BCP', description: 'Begin Code Page' },
  D3A987: { mnemonic: 'ECP', description: 'End Code Page' },
  D38C87: { mnemonic: 'CPI', description: 'Code Page Index' },
  D3A889: { mnemonic: 'BFN', description: 'Begin Font' },
  D3A989: { mnemonic: 'EFN', description: 'End Font' },
  D3EEEE: { mnemonic: 'NOP', description: 'No Operation / Comment' },
};

// Extended IBM EBCDIC CP037 / CP500 printable byte-to-ASCII table
const EBCDIC_CP037_MAP: Record<number, string> = {
  0x40: ' ', 0x4a: '[', 0x4b: '.', 0x4c: '<', 0x4d: '(', 0x4e: '+', 0x4f: '|',
  0x50: '&', 0x5a: '!', 0x5b: '$', 0x5c: '*', 0x5d: ')', 0x5e: ';', 0x5f: '^',
  0x60: '-', 0x61: '/', 0x6a: '|', 0x6b: ',', 0x6c: '%', 0x6d: '_', 0x6e: '>', 0x6f: '?',
  0x79: '`', 0x7a: ':', 0x7b: '#', 0x7c: '@', 0x7d: "'", 0x7e: '=', 0x7f: '"',
  0x81: 'a', 0x82: 'b', 0x83: 'c', 0x84: 'd', 0x85: 'e', 0x86: 'f', 0x87: 'g', 0x88: 'h', 0x89: 'i',
  0x91: 'j', 0x92: 'k', 0x93: 'l', 0x94: 'm', 0x95: 'n', 0x96: 'o', 0x97: 'p', 0x98: 'q', 0x99: 'r',
  0xa1: '~', 0xa2: 's', 0xa3: 't', 0xa4: 'u', 0xa5: 'v', 0xa6: 'w', 0xa7: 'x', 0xa8: 'y', 0xa9: 'z',
  0xb0: '^', 0xba: '[', 0xbb: ']', 0xc0: '{',
  0xc1: 'A', 0xc2: 'B', 0xc3: 'C', 0xc4: 'D', 0xc5: 'E', 0xc6: 'F', 0xc7: 'G', 0xc8: 'H', 0xc9: 'I',
  0xd0: '}',
  0xd1: 'J', 0xd2: 'K', 0xd3: 'L', 0xd4: 'M', 0xd5: 'N', 0xd6: 'O', 0xd7: 'P', 0xd8: 'Q', 0xd9: 'R',
  0xe0: '\\',
  0xe2: 'S', 0xe3: 'T', 0xe4: 'U', 0xe5: 'V', 0xe6: 'W', 0xe7: 'X', 0xe8: 'Y', 0xe9: 'Z',
  0xf0: '0', 0xf1: '1', 0xf2: '2', 0xf3: '3', 0xf4: '4', 0xf5: '5', 0xf6: '6', 0xf7: '7', 0xf8: '8', 0xf9: '9',
};

// Subset of IBM GCGIDs from inline AFP Code Page Index (CPI) records
const GCGID_TO_CHAR: Record<string, string> = {
  SP010000: ' ', SP020000: ' ', SA000000: ' ', PD010000: '.', PD030000: '.',
  SP040000: ',', SP050000: ':', SP060000: ';', SP070000: '!', SP080000: '?',
  SP100000: '-', SP110000: '-', SP120000: '/', SP090000: '_', SP190000: "'",
  SP040001: "'", SM010000: '#', SM020000: '%', SM030000: '&', SM040000: '*',
  SM050000: '@', SC030000: '$', SA010000: '+', SA040000: '=', SA050000: '<',
  SA060000: '>', PS010000: '(', PS020000: ')', SM060000: '[', SM080000: ']',
  SD190000: '~', SD150000: '^', SM130000: '|',
  ND010000: '1', ND020000: '2', ND030000: '3', ND040000: '4', ND050000: '5',
  ND060000: '6', ND070000: '7', ND080000: '8', ND090000: '9', ND100000: '0',
};
for (let c = 0; c < 26; c++) {
  const lower = String.fromCharCode(97 + c);
  const upper = String.fromCharCode(65 + c);
  const num = String((c + 1) * 1).padStart(2, '0');
  // IBM GCGID: LA010000='a', LA020000='A', LB010000='b', LB020000='B', ...
  GCGID_TO_CHAR[`L${upper}010000`] = lower;
  GCGID_TO_CHAR[`L${upper}020000`] = upper;
  void num;
}

export function decodeAfpBytes(
  bytes: Buffer,
  customCodePage?: Map<number, string>,
  preserveSpaces = false
): { text: string; encoding: 'EBCDIC' | 'ASCII' } {
  if (bytes.length === 0) return { text: '', encoding: 'ASCII' };

  let ebcdicScore = 0;
  let asciiScore = 0;

  for (const b of bytes) {
    if (b === 0x40 || (b >= 0xc1 && b <= 0xe9) || (b >= 0xf0 && b <= 0xf9) || (b >= 0x81 && b <= 0xa9)) {
      ebcdicScore += b === 0x40 ? 2 : 1;
    }
    if (b === 0x20 || (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) {
      asciiScore += b === 0x20 ? 2 : 1;
    }
    // Control bytes < 0x20 break ASCII
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      asciiScore -= 3;
    }
  }

  const hasAsciiLowerOrSpace = bytes.some((b) => b === 0x20 || (b >= 0x61 && b <= 0x7a));
  const useEbcdic =
    customCodePage && customCodePage.size > 0
      ? ebcdicScore >= asciiScore
      : ebcdicScore > asciiScore || (!hasAsciiLowerOrSpace && bytes.some((b) => b >= 0xc1 && b <= 0xf9));

  if (useEbcdic) {
    let out = '';
    for (const b of bytes) {
      out += customCodePage?.get(b) ?? EBCDIC_CP037_MAP[b] ?? ' ';
    }
    const final = preserveSpaces ? out.replace(/\s+/g, ' ') : out.replace(/\s+/g, ' ').trim();
    return { text: final, encoding: 'EBCDIC' };
  }

  const rawAscii = bytes.toString('latin1').replace(/[^\x20-\x7e]/g, ' ');
  const final = preserveSpaces ? rawAscii.replace(/ +/g, ' ') : rawAscii.replace(/\s+/g, ' ').trim();
  return { text: final, encoding: 'ASCII' };
}

function readInt24BE(buf: Buffer, offset: number): number {
  const b0 = buf[offset];
  const val = (b0 << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
  return (b0 & 0x80) !== 0 ? val | ~0xffffff : val;
}

function readUInt24BE(buf: Buffer, offset: number): number {
  return (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
}

function parseAfpTriplets(payload: Buffer): Array<{ tid: number; data: Buffer }> {
  const triplets: Array<{ tid: number; data: Buffer }> = [];
  let pos = 0;
  while (pos + 2 <= payload.length) {
    const tLen = payload[pos];
    if (tLen < 2 || pos + tLen > payload.length) break;
    const tid = payload[pos + 1];
    triplets.push({ tid, data: payload.subarray(pos + 2, pos + tLen) });
    pos += tLen;
  }
  return triplets;
}

interface CodedFontStyle {
  localId: number;
  name: string;
  fontFamily: 'sans-serif' | 'serif' | 'monospace';
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  fontSizePt: number;
  isBarcode: boolean;
}

function inferFontStyleFromName(localId: number, rawName: string, explicitPt?: number): CodedFontStyle {
  const name = rawName.toUpperCase().trim();
  const isBarcode = /3OF9|C39|BC39|CODE39|C128|CODE128|POSTNET|IMB|BARCD|BC\d/i.test(name);
  const fontFamily: CodedFontStyle['fontFamily'] =
    /CO|CR|COUR|MONO|GT10|GT12|GT15|OCRB/i.test(name)
      ? 'monospace'
      : /T2|TIME|SERIF|CENT|GARM|BOOK|C0N|C0T/i.test(name)
      ? 'serif'
      : 'sans-serif';
  const fontWeight: CodedFontStyle['fontWeight'] =
    /BD|BOLD|HV|BLACK|400|600|700|B0$/i.test(name) || /H4|T4|C0.4/i.test(name) ? 'bold' : 'normal';
  const fontStyle: CodedFontStyle['fontStyle'] = /IT|ITAL|OBL|SL/i.test(name) ? 'italic' : 'normal';

  let fontSizePt = explicitPt && explicitPt >= 4 && explicitPt <= 72 ? explicitPt : 9.5;
  if (!explicitPt) {
    const ptMatch = name.match(/(?:^|[^0-9])(0?[6-9]|1[0-8]|2[0-4])(?:PT|P)?$/);
    if (ptMatch) {
      fontSizePt = Number(ptMatch[1]);
    } else if (/70$/.test(name)) fontSizePt = 7;
    else if (/80$/.test(name)) fontSizePt = 8;
    else if (/90$/.test(name)) fontSizePt = 9;
    else if (/A0$/.test(name)) fontSizePt = 10;
    else if (/B0$/.test(name)) fontSizePt = 11;
    else if (/C0$/.test(name)) fontSizePt = 12;
    else if (/E0$/.test(name)) fontSizePt = 14;
  }

  return { localId, name, fontFamily, fontWeight, fontStyle, fontSizePt, isBarcode };
}

// Minimal CRC32 + PNG writer for crisp lossless embedded raster logos/images
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const MAX_IOCA_DIM = 10000;
const MAX_IOCA_PIXELS = 40_000_000;
const MAX_AFP_FIELDS_PREVIEW = 2500;

function encodeRgbaToPngDataUri(width: number, height: number, rgba: Uint8Array): string {
  const w = Math.max(1, Math.min(width, MAX_IOCA_DIM));
  const h = Math.max(1, Math.min(height, MAX_IOCA_DIM));
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0; // filter None
    const srcOff = y * stride;
    raw.set(rgba.subarray(srcOff, srcOff + stride), rowOff + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 6 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function monoBitsToPngDataUri(width: number, height: number, bytes: Uint8Array, whiteIsOne = false): string {
  if (width <= 0 || height <= 0 || width > MAX_IOCA_DIM || height > MAX_IOCA_DIM || width * height > MAX_IOCA_PIXELS) {
    return '';
  }
  const w = width;
  const h = height;
  const rowBytes = Math.ceil(w / 8);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bIdx = y * rowBytes + (x >> 3);
      const bit = bIdx < bytes.length ? (bytes[bIdx] >> (7 - (x & 7))) & 1 : 0;
      const isBlack = whiteIsOne ? bit === 0 : bit === 1;
      const o = (y * w + x) * 4;
      if (isBlack) {
        rgba[o] = 15;
        rgba[o + 1] = 23;
        rgba[o + 2] = 42;
        rgba[o + 3] = 255;
      } else {
        rgba[o] = 255;
        rgba[o + 1] = 255;
        rgba[o + 2] = 255;
        rgba[o + 3] = 0; // transparent background so logos layer cleanly
      }
    }
  }
  return encodeRgbaToPngDataUri(w, h, rgba);
}

// Pure TS CCITT Group 4 (T.6 / IBM MMR) monochrome raster decoder
const T4_WHITE_TERMS: Array<[number, number, number]> = [
  [0b00110101, 8, 0], [0b000111, 6, 1], [0b0111, 4, 2], [0b1000, 4, 3],
  [0b1011, 4, 4], [0b1100, 4, 5], [0b1110, 4, 6], [0b1111, 4, 7],
  [0b10011, 5, 8], [0b10100, 5, 9], [0b00111, 5, 10], [0b01000, 5, 11],
  [0b001000, 6, 12], [0b000011, 6, 13], [0b110100, 6, 14], [0b110101, 6, 15],
  [0b101010, 6, 16], [0b101011, 6, 17], [0b0100111, 7, 18], [0b0001100, 7, 19],
  [0b0001000, 7, 20], [0b0010111, 7, 21], [0b0000011, 7, 22], [0b0000100, 7, 23],
  [0b0101000, 7, 24], [0b0101011, 7, 25], [0b0010011, 7, 26], [0b0100100, 7, 27],
  [0b0011000, 7, 28], [0b00000010, 8, 29], [0b00000011, 8, 30], [0b00011010, 8, 31],
  [0b00011011, 8, 32], [0b00010010, 8, 33], [0b00010011, 8, 34], [0b00010100, 8, 35],
  [0b00010101, 8, 36], [0b00010110, 8, 37], [0b00010111, 8, 38], [0b00101000, 8, 39],
  [0b00101001, 8, 40], [0b00101010, 8, 41], [0b00101011, 8, 42], [0b00101100, 8, 43],
  [0b00101101, 8, 44], [0b00000100, 8, 45], [0b00000101, 8, 46], [0b00001010, 8, 47],
  [0b00001011, 8, 48], [0b01010010, 8, 49], [0b01010011, 8, 50], [0b01010100, 8, 51],
  [0b01010101, 8, 52], [0b00100100, 8, 53], [0b00100101, 8, 54], [0b01011000, 8, 55],
  [0b01011001, 8, 56], [0b01011010, 8, 57], [0b01011011, 8, 58], [0b01001010, 8, 59],
  [0b01001011, 8, 60], [0b00110010, 8, 61], [0b00110011, 8, 62], [0b00110100, 8, 63],
];
const T4_WHITE_MAKEUPS: Array<[number, number, number]> = [
  [0b11011, 5, 64], [0b10010, 5, 128], [0b010111, 6, 192], [0b0110111, 7, 256],
  [0b00110110, 8, 320], [0b00110111, 8, 384], [0b01100100, 8, 448], [0b01100101, 8, 512],
  [0b01101000, 8, 576], [0b01100111, 8, 640], [0b011001100, 9, 704], [0b011001101, 9, 768],
  [0b011010010, 9, 832], [0b011010011, 9, 896], [0b011010100, 9, 960], [0b011010101, 9, 1024],
  [0b011010110, 9, 1088], [0b011010111, 9, 1152], [0b011011000, 9, 1216], [0b011011001, 9, 1280],
  [0b011011010, 9, 1344], [0b011011011, 9, 1408], [0b010011000, 9, 1472], [0b010011001, 9, 1536],
  [0b010011010, 9, 1600], [0b011000, 6, 1664], [0b010011011, 9, 1728],
];
const T4_BLACK_TERMS: Array<[number, number, number]> = [
  [0b0000110111, 10, 0], [0b010, 3, 1], [0b11, 2, 2], [0b10, 2, 3],
  [0b011, 3, 4], [0b0011, 4, 5], [0b0010, 4, 6], [0b00011, 5, 7],
  [0b000101, 6, 8], [0b000100, 6, 9], [0b0000100, 7, 10], [0b0000101, 7, 11],
  [0b0000111, 7, 12], [0b00000100, 8, 13], [0b00000111, 8, 14], [0b000011000, 9, 15],
  [0b0000010111, 10, 16], [0b0000011000, 10, 17], [0b0000001000, 10, 18], [0b00001100111, 11, 19],
  [0b00001101000, 11, 20], [0b00001101100, 11, 21], [0b00000110111, 11, 22], [0b00000101000, 11, 23],
  [0b00000010111, 11, 24], [0b00000011000, 11, 25], [0b000011001010, 12, 26], [0b000011001011, 12, 27],
  [0b000011001100, 12, 28], [0b000011001101, 12, 29], [0b000001101000, 12, 30], [0b000001101001, 12, 31],
  [0b000001101010, 12, 32], [0b000001101011, 12, 33], [0b000011010010, 12, 34], [0b000011010011, 12, 35],
  [0b000011010100, 12, 36], [0b000011010101, 12, 37], [0b000011010110, 12, 38], [0b000011010111, 12, 39],
  [0b000001101100, 12, 40], [0b000001101101, 12, 41], [0b000011011010, 12, 42], [0b000011011011, 12, 43],
  [0b000001010100, 12, 44], [0b000001010101, 12, 45], [0b000001010110, 12, 46], [0b000001010111, 12, 47],
  [0b000001100100, 12, 48], [0b000001100101, 12, 49], [0b000001010010, 12, 50], [0b000001010011, 12, 51],
  [0b000000100100, 12, 52], [0b000000110111, 12, 53], [0b000000111000, 12, 54], [0b000000100111, 12, 55],
  [0b000000101000, 12, 56], [0b000001011000, 12, 57], [0b000001011001, 12, 58], [0b000000101011, 12, 59],
  [0b000000101100, 12, 60], [0b000001011010, 12, 61], [0b000001100110, 12, 62], [0b000001100111, 12, 63],
];
const T4_BLACK_MAKEUPS: Array<[number, number, number]> = [
  [0b0000001111, 10, 64], [0b000011001000, 12, 128], [0b000011001001, 12, 192], [0b000001011011, 12, 256],
  [0b000000110011, 12, 320], [0b000000110100, 12, 384], [0b000000110101, 12, 448], [0b0000001101100, 13, 512],
  [0b0000001101101, 13, 576], [0b0000001001010, 13, 640], [0b0000001001011, 13, 704], [0b0000001001100, 13, 768],
  [0b0000001001101, 13, 832], [0b0000001110010, 13, 896], [0b0000001110011, 13, 960], [0b0000001110100, 13, 1024],
  [0b0000001110101, 13, 1088], [0b0000001110110, 13, 1152], [0b0000001110111, 13, 1216], [0b0000001010010, 13, 1280],
  [0b0000001010011, 13, 1344], [0b0000001010100, 13, 1408], [0b0000001010101, 13, 1472], [0b0000001011010, 13, 1536],
  [0b0000001011011, 13, 1600], [0b0000001100100, 13, 1664], [0b0000001100101, 13, 1728],
];
const T4_COMMON_MAKEUPS: Array<[number, number, number]> = [
  [0b00000001000, 11, 1792], [0b00000001100, 11, 1856], [0b00000001101, 11, 1920],
  [0b000000010010, 12, 1984], [0b000000010011, 12, 2048], [0b000000010100, 12, 2112],
  [0b000000010101, 12, 2176], [0b000000010110, 12, 2240], [0b000000010111, 12, 2304],
  [0b000000011100, 12, 2368], [0b000000011101, 12, 2432], [0b000000011110, 12, 2496],
  [0b000000011111, 12, 2560],
];

type HuffNode = { val?: number; z?: HuffNode; o?: HuffNode };
function buildHuffTree(entries: Array<[number, number, number]>): HuffNode {
  const root: HuffNode = {};
  for (const [code, len, val] of entries) {
    let cur = root;
    for (let b = len - 1; b >= 0; b--) {
      const bit = (code >> b) & 1;
      if (bit === 0) cur = cur.z || (cur.z = {});
      else cur = cur.o || (cur.o = {});
    }
    cur.val = val;
  }
  return root;
}
const WHITE_TREE = buildHuffTree([...T4_WHITE_TERMS.map(([c, l, v]): [number, number, number] => [c, l, v]), ...T4_WHITE_MAKEUPS.map(([c, l, v]): [number, number, number] => [c, l, v + 10000]), ...T4_COMMON_MAKEUPS.map(([c, l, v]): [number, number, number] => [c, l, v + 10000])]);
const BLACK_TREE = buildHuffTree([...T4_BLACK_TERMS.map(([c, l, v]): [number, number, number] => [c, l, v]), ...T4_BLACK_MAKEUPS.map(([c, l, v]): [number, number, number] => [c, l, v + 10000]), ...T4_COMMON_MAKEUPS.map(([c, l, v]): [number, number, number] => [c, l, v + 10000])]);

function decodeCcittT6(data: Buffer, width: number, height: number): Uint8Array | null {
  if (width <= 0 || height <= 0 || width > MAX_IOCA_DIM || height > MAX_IOCA_DIM || width * height > MAX_IOCA_PIXELS) {
    return null;
  }
  let bitPos = 0;
  const totalBits = data.length * 8;
  const readBit = (): number => {
    if (bitPos >= totalBits) return -1;
    const byte = data[bitPos >> 3];
    const bit = (byte >> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return bit;
  };
  const readRunLen = (isBlack: boolean): number => {
    let total = 0;
    const tree = isBlack ? BLACK_TREE : WHITE_TREE;
    while (true) {
      let cur: HuffNode | undefined = tree;
      while (cur && cur.val === undefined) {
        const b = readBit();
        if (b < 0) return total;
        cur = b === 0 ? cur.z : cur.o;
      }
      if (!cur || cur.val === undefined) return -1;
      if (cur.val >= 10000) {
        total += cur.val - 10000;
      } else {
        total += cur.val;
        return total;
      }
    }
  };

  // Color convention: 0 = white, 1 = black
  let refLine = new Uint8Array(width);
  const out = new Uint8Array(width * height);

  const findNextChange = (line: Uint8Array, start: number, color: number): number => {
    let i = Math.max(0, start);
    while (i < width && line[i] === color) i++;
    while (i < width && line[i] !== color) i++;
    return i;
  };

  const findB1 = (line: Uint8Array, a0: number, a0Color: number): number => {
    if (a0 < 0) {
      let i = 0;
      while (i < width && line[i] === a0Color) i++;
      return i;
    }
    let i = a0;
    // first find change from current or opposite
    while (i < width && line[i] !== a0Color) i++;
    while (i < width && line[i] === a0Color) i++;
    if (i > 0 && i < width && line[i - 1] === line[i]) {
      return findNextChange(line, a0, 1 - a0Color);
    }
    return i;
  };

  for (let y = 0; y < height; y++) {
    const curLine = new Uint8Array(width);
    let a0 = -1;
    let color = 0; // white first
    let guard = 0;

    while (a0 < width && guard++ < width * 3) {
      const b0 = readBit();
      if (b0 < 0) break;

      let delta: number | null = null;
      let mode: 'V' | 'P' | 'H' | 'EOF' = 'V';

      if (b0 === 1) {
        delta = 0; // V(0)
      } else {
        const b1 = readBit();
        if (b1 === 1) {
          const b2 = readBit();
          delta = b2 === 1 ? 1 : -1; // VR(1) / VL(1)
        } else {
          const b2 = readBit();
          if (b2 === 1) {
            mode = 'H';
          } else {
            const b3 = readBit();
            if (b3 === 1) {
              mode = 'P';
            } else {
              const b4 = readBit();
              if (b4 === 1) {
                const b5 = readBit();
                delta = b5 === 1 ? 2 : -2;
              } else {
                const b5 = readBit();
                if (b5 === 1) {
                  const b6 = readBit();
                  delta = b6 === 1 ? 3 : -3;
                } else {
                  mode = 'EOF';
                }
              }
            }
          }
        }
      }

      if (mode === 'EOF') break;

      const startFill = a0 < 0 ? 0 : a0;
      if (mode === 'P') {
        const b1 = findB1(refLine, a0, color);
        let b2 = b1;
        while (b2 < width && refLine[b2] === refLine[b1]) b2++;
        curLine.fill(color, startFill, Math.min(width, b2));
        a0 = b2;
      } else if (mode === 'H') {
        const r1 = readRunLen(color === 1);
        const r2 = readRunLen(color === 0);
        if (r1 < 0 || r2 < 0) break;
        const end1 = Math.min(width, startFill + r1);
        curLine.fill(color, startFill, end1);
        const end2 = Math.min(width, end1 + r2);
        curLine.fill(1 - color, end1, end2);
        a0 = end2;
      } else {
        const b1 = findB1(refLine, a0, color);
        const a1 = Math.max(startFill, Math.min(width, b1 + (delta || 0)));
        curLine.fill(color, startFill, a1);
        a0 = a1;
        color = 1 - color;
      }
    }

    out.set(curLine, y * width);
    refLine = curLine;
  }

  return out;
}

function decodeIocaImage(
  iddBuf: Buffer | null,
  ipdChunks: Buffer[]
): { width: number; height: number; dataUri: string } | null {
  const combined = Buffer.concat(ipdChunks);
  if (combined.length === 0) return null;

  let width = 0;
  let height = 0;
  let comprId = 0x03; // uncompressed default
  let bpp = 1;
  const imgDataParts: Buffer[] = [];

  // Scan MO:DCA IDD header / SDFs (0xF6 Image Size, 0xF7 Ide Size) if present
  if (iddBuf && iddBuf.length >= 9) {
    // MO:DCA IDD starts with unitBase(1), Xres(2), Yres(2) -> followed by IOCA SDFs (e.g. 0xF6)
    let p = 5;
    while (p + 2 <= iddBuf.length) {
      const id = iddBuf[p];
      const len = iddBuf[p + 1];
      if (len === 0 || p + 2 + len > iddBuf.length) break;
      const body = iddBuf.subarray(p + 2, p + 2 + len);
      if (id === 0xf6 && body.length >= 9) {
        width = body.readUInt16BE(5);
        height = body.readUInt16BE(7);
      } else if (id === 0xf7 && body.length >= 1) {
        comprId = body[0];
      }
      p += 2 + len;
    }
    if (width === 0 && iddBuf.length >= 9) {
      const wCand = iddBuf.readUInt16BE(5);
      const hCand = iddBuf.readUInt16BE(7);
      if (wCand > 0 && wCand <= MAX_IOCA_DIM && hCand > 0 && hCand <= MAX_IOCA_DIM) {
        width = wCand;
        height = hCand;
      }
    }
  }

  // Scan IPD IOCA Self-Defining Fields (SDFs)
  const scanIocaSdfs = (buf: Buffer) => {
    let p = 0;
    while (p < buf.length) {
      const id = buf[p];
      if (id === 0xfe && p + 4 <= buf.length) {
        const extId = buf[p + 1];
        const extLen = buf.readUInt16BE(p + 2);
        const dataEnd = Math.min(buf.length, p + 4 + extLen);
        if (extId === 0x92 && dataEnd > p + 4) {
          imgDataParts.push(buf.subarray(p + 4, dataEnd));
        }
        p = dataEnd;
        continue;
      }
      if (p + 2 > buf.length) break;
      const len = buf[p + 1];
      const dataStart = p + 2;
      const dataEnd = Math.min(buf.length, dataStart + len);
      const body = buf.subarray(dataStart, dataEnd);

      if ((id === 0x94 || id === 0xf6) && body.length >= 9) {
        // Image Size SDF: unitBase(1), hRes(2), vRes(2), hSize(2), vSize(2)
        width = body.readUInt16BE(5);
        height = body.readUInt16BE(7);
      } else if (id === 0x95 && body.length >= 1) {
        // Image Encoding SDF
        comprId = body[0];
      } else if (id === 0x96 && body.length >= 1) {
        // IDE Size SDF
        bpp = body[0] || 1;
      } else if (id === 0x70 || id === 0x91) {
        if (len === 0 || (id === 0x70 && len === 0)) {
          p += 2;
          continue;
        }
      }
      p = dataEnd;
    }
  };

  scanIocaSdfs(combined);

  if (width <= 0 || height <= 0 || width > MAX_IOCA_DIM || height > MAX_IOCA_DIM || width * height > MAX_IOCA_PIXELS) return null;
  const rawImg = imgDataParts.length > 0 ? Buffer.concat(imgDataParts) : combined;

  if (comprId === 0x03 || comprId === 0x00) {
    // Uncompressed
    if (bpp === 1) {
      const uri = monoBitsToPngDataUri(width, height, rawImg, false);
      return uri ? { width, height, dataUri: uri } : null;
    }
    if (bpp === 8) {
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height && i < rawImg.length; i++) {
        const g = rawImg[i];
        const o = i * 4;
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      }
      return { width, height, dataUri: encodeRgbaToPngDataUri(width, height, rgba) };
    }
    if (bpp === 24) {
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height && i * 3 + 2 < rawImg.length; i++) {
        const o = i * 4;
        rgba[o] = rawImg[i * 3];
        rgba[o + 1] = rawImg[i * 3 + 1];
        rgba[o + 2] = rawImg[i * 3 + 2];
        rgba[o + 3] = 255;
      }
      return { width, height, dataUri: encodeRgbaToPngDataUri(width, height, rgba) };
    }
    if (bpp === 32) {
      // 4-band CMYK -> RGBA
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < width * height && i * 4 + 3 < rawImg.length; i++) {
        const c = rawImg[i * 4] / 255;
        const m = rawImg[i * 4 + 1] / 255;
        const yk = rawImg[i * 4 + 2] / 255;
        const k = rawImg[i * 4 + 3] / 255;
        const o = i * 4;
        rgba[o] = Math.round(255 * (1 - c) * (1 - k));
        rgba[o + 1] = Math.round(255 * (1 - m) * (1 - k));
        rgba[o + 2] = Math.round(255 * (1 - yk) * (1 - k));
        rgba[o + 3] = 255;
      }
      return { width, height, dataUri: encodeRgbaToPngDataUri(width, height, rgba) };
    }
  } else if (comprId === 0x01 || comprId === 0x82) {
    // IBM MMR (0x01) or CCITT Group 4 (0x82)
    const pixels = decodeCcittT6(rawImg, width, height);
    if (pixels) {
      const rgba = new Uint8Array(width * height * 4);
      for (let i = 0; i < pixels.length; i++) {
        const o = i * 4;
        if (pixels[i] === 1) {
          rgba[o] = 15;
          rgba[o + 1] = 23;
          rgba[o + 2] = 42;
          rgba[o + 3] = 255;
        } else {
          rgba[o] = 255;
          rgba[o + 1] = 255;
          rgba[o + 2] = 255;
          rgba[o + 3] = 0;
        }
      }
      return { width, height, dataUri: encodeRgbaToPngDataUri(width, height, rgba) };
    }
  }

  return null;
}

function ocaColorToHex(cCode: number): string {
  switch (cCode & 0xffff) {
    case 0x0001:
      return '#1d4ed8'; // Blue
    case 0x0002:
      return '#b91c1c'; // Red / Burgundy
    case 0x0003:
      return '#9333ea'; // Magenta
    case 0x0004:
      return '#15803d'; // Green
    case 0x0005:
      return '#0e7490'; // Cyan
    case 0x0006:
      return '#ca8a04'; // Yellow / Amber
    case 0x0007:
      return '#ffffff'; // White / Paper
    case 0x0008:
    case 0xff07:
    case 0xff00:
    default:
      return '#0f172a'; // Default ink black
  }
}

function parseObjectAreaPlacement(obpPayload: Buffer | null, oadPayload: Buffer | null, fallbackX: number, fallbackY: number) {
  let x = fallbackX;
  let y = fallbackY;
  let w = 240;
  let h = 100;
  let rotation = 0;

  if (obpPayload && obpPayload.length >= 10) {
    // OBP: OAPosID(1), RGLength(1), XoaOset(3), YoaOset(3), XoaOrent(2), YoaOrent(2)
    x = readInt24BE(obpPayload, 2);
    y = readInt24BE(obpPayload, 5);
    const orent = obpPayload.readUInt16BE(8);
    if (orent === 0x2d00) rotation = 90;
    else if (orent === 0x5a00) rotation = 180;
    else if (orent === 0x8700) rotation = 270;
  }

  if (oadPayload && oadPayload.length >= 4) {
    for (const startOff of [2, 8, 0]) {
      if (startOff >= oadPayload.length) continue;
      const triplets = parseAfpTriplets(oadPayload.subarray(startOff));
      let found = false;
      for (const t of triplets) {
        if (t.tid === 0x4c && t.data.length >= 7) {
          w = readUInt24BE(t.data, 1) || w;
          h = readUInt24BE(t.data, 4) || h;
          found = true;
        }
      }
      if (found) break;
    }
  }

  return { x, y, w, h, rotation };
}

function parsePtocaPayload(
  payload: Buffer,
  pageIndex: number,
  pageWidthUnits: number,
  pageHeightUnits: number,
  state: {
    i: number;
    b: number;
    sim: number;
    sbi: number;
    iOrient: number;
    bOrient: number;
    fontLocalId: number;
    color: string;
  },
  fonts: Map<number, CodedFontStyle>,
  customCodePage?: Map<number, string>
): {
  runs: Array<AfpPtocaRun & { rotation: number; fontStyle: CodedFontStyle; color: string }>;
  rules: Array<{ x: number; y: number; w: number; h: number; color: string }>;
} {
  const runs: Array<AfpPtocaRun & { rotation: number; fontStyle: CodedFontStyle; color: string }> = [];
  const rules: Array<{ x: number; y: number; w: number; h: number; color: string }> = [];

  const getRotation = (): number => {
    if (state.iOrient === 0x2d00) return 90;
    if (state.iOrient === 0x5a00) return 180;
    if (state.iOrient === 0x8700) return 270;
    return 0;
  };

  const mapCoords = (): { x: number; y: number; rotation: number } => {
    const rot = getRotation();
    if (rot === 90) return { x: Math.max(0, pageWidthUnits - state.b), y: state.i, rotation: 90 };
    if (rot === 180) return { x: Math.max(0, pageWidthUnits - state.i), y: Math.max(0, pageHeightUnits - state.b), rotation: 180 };
    if (rot === 270) return { x: state.b, y: Math.max(0, pageHeightUnits - state.i), rotation: 270 };
    return { x: state.i, y: state.b, rotation: 0 };
  };

  const activeFont = (): CodedFontStyle =>
    fonts.get(state.fontLocalId) || {
      localId: state.fontLocalId,
      name: `F${state.fontLocalId}`,
      fontFamily: 'sans-serif',
      fontWeight: 'normal',
      fontStyle: 'normal',
      fontSizePt: 9.5,
      isBarcode: false,
    };

  if (payload.length >= 4 && payload[0] === 0x2b && payload[1] === 0xd3) {
    let pos = 2;
    while (pos + 2 <= payload.length) {
      if (payload[pos] === 0x2b && payload[pos + 1] === 0xd3) {
        pos += 2;
        continue;
      }
      const csLen = payload[pos];
      const csFn = payload[pos + 1];
      if (csLen < 2 || pos + csLen > payload.length) break;
      const params = payload.subarray(pos + 2, pos + csLen);
      const fnBase = csFn & 0xfe;

      if (fnBase === 0xc0 && params.length >= 2) {
        state.sim = params.readInt16BE(0);
      } else if (fnBase === 0xc6 && params.length >= 2) {
        state.i = params.readInt16BE(0);
      } else if (fnBase === 0xc8 && params.length >= 2) {
        state.i += params.readInt16BE(0);
      } else if (fnBase === 0xd0 && params.length >= 2) {
        state.sbi = params.readInt16BE(0);
      } else if (fnBase === 0xd2 && params.length >= 2) {
        state.b = params.readInt16BE(0);
      } else if (fnBase === 0xd4 && params.length >= 2) {
        state.b += params.readInt16BE(0);
      } else if (fnBase === 0xd8) {
        // BLN - Begin Line
        state.b += state.sbi || 40;
        state.i = state.sim || 120;
      } else if (fnBase === 0xf0 && params.length >= 1) {
        state.fontLocalId = params[0];
      } else if (fnBase === 0xf6 && params.length >= 4) {
        state.iOrient = params.readUInt16BE(0);
        state.bOrient = params.readUInt16BE(2);
      } else if ((fnBase === 0x74 || fnBase === 0x70) && params.length >= 2) {
        // STC - Set Text Color (standard IBM OCA palette)
        state.color = ocaColorToHex(params.readUInt16BE(0));
      } else if (fnBase === 0x80 && params.length >= 5) {
        // SEC - Set Extended Text Color (RGB / CMYK / OCA)
        const colorSpace = params[1];
        if (colorSpace === 0x01 && params.length >= 11) {
          // RGB: last 3 bytes (or bytes 10..12 / 8..10 depending on pad)
          const r = params[params.length - 3];
          const g = params[params.length - 2];
          const b = params[params.length - 1];
          state.color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        } else if (colorSpace === 0x04 && params.length >= 12) {
          const c = params[params.length - 4] / 255;
          const m = params[params.length - 3] / 255;
          const yk = params[params.length - 2] / 255;
          const k = params[params.length - 1] / 255;
          const r = Math.round(255 * (1 - c) * (1 - k));
          const g = Math.round(255 * (1 - m) * (1 - k));
          const b = Math.round(255 * (1 - yk) * (1 - k));
          state.color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        } else if (params.length >= 2) {
          state.color = ocaColorToHex(params.readUInt16BE(params.length - 2));
        }
      } else if (fnBase === 0xe4 && params.length >= 4) {
        // DIR (0xE4 / 0xE5) - Draw I-axis Rule (horizontal rule in 0deg orientation)
        const ruleLen = params.readInt16BE(0);
        const ruleW = Math.max(2, Math.abs(params.readInt16BE(2)));
        const { x, y, rotation } = mapCoords();
        if (rotation === 90 || rotation === 270) {
          rules.push({
            x,
            y: ruleLen >= 0 ? y : y + ruleLen,
            w: ruleW,
            h: Math.abs(ruleLen),
            color: state.color,
          });
        } else {
          rules.push({
            x: ruleLen >= 0 ? x : x + ruleLen,
            y,
            w: Math.abs(ruleLen),
            h: ruleW,
            color: state.color,
          });
        }
      } else if (fnBase === 0xe6 && params.length >= 4) {
        // DBR (0xE6 / 0xE7) - Draw B-axis Rule (vertical rule in 0deg orientation)
        const ruleLen = params.readInt16BE(0);
        const ruleW = Math.max(2, Math.abs(params.readInt16BE(2)));
        const { x, y, rotation } = mapCoords();
        if (rotation === 90 || rotation === 270) {
          rules.push({
            x: ruleLen >= 0 ? x : x + ruleLen,
            y,
            w: Math.abs(ruleLen),
            h: ruleW,
            color: state.color,
          });
        } else {
          rules.push({
            x,
            y: ruleLen >= 0 ? y : y + ruleLen,
            w: ruleW,
            h: Math.abs(ruleLen),
            color: state.color,
          });
        }
      } else if (fnBase === 0xda && params.length > 0) {
        const decoded = decodeAfpBytes(params, customCodePage, false);
        if (decoded.text.length > 0) {
          const { x, y, rotation } = mapCoords();
          const fs = activeFont();
          runs.push({
            pageIndex,
            x,
            y,
            fontLocalId: state.fontLocalId,
            text: decoded.text,
            encoding: decoded.encoding,
            rotation,
            fontStyle: fs,
            color: state.color,
          });
          // Advance inline cursor approximately so back-to-back TRNs don't stack on top of each other
          const approxAdvance = Math.round(decoded.text.length * (fs.fontSizePt * 1.65));
          state.i += approxAdvance;
        }
      }
      pos += csLen;
      if ((csFn & 1) === 0 && pos + 2 <= payload.length && payload[pos] === 0x2b && payload[pos + 1] === 0xd3) {
        pos += 2;
      }
    }
  } else {
    const decoded = decodeAfpBytes(payload, customCodePage, false);
    if (decoded.text.length > 0) {
      state.b += 60;
      const { x, y, rotation } = mapCoords();
      const fs = activeFont();
      runs.push({
        pageIndex,
        x,
        y,
        fontLocalId: state.fontLocalId,
        text: decoded.text,
        encoding: decoded.encoding,
        rotation,
        fontStyle: fs,
        color: state.color,
      });
    }
  }

  return { runs, rules };
}

function looksLikeBarcodeRun(text: string, fontStyle: CodedFontStyle, rotation: number): boolean {
  if (fontStyle.isBarcode) return true;
  if (/^\*[A-Z0-9\-. $/+%]{4,28}\*$/.test(text.trim())) return true;
  if (rotation !== 0 && /^\*?[0-9]{8,24}\*?$/.test(text.trim())) return true;
  return false;
}

function coalescePageVisualLines(
  rawRuns: Array<AfpPtocaRun & { rotation: number; fontStyle: CodedFontStyle; color: string }>,
  xdpi: number
): {
  visualElements: AfpVisualElement[];
  textLines: string[];
  coalescedRuns: AfpPtocaRun[];
  redactions: number;
} {
  const visualElements: AfpVisualElement[] = [];
  const textLines: string[] = [];
  const coalescedRuns: AfpPtocaRun[] = [];
  let redactions = 0;

  const horizontalRuns: typeof rawRuns = [];
  for (const r of rawRuns) {
    if (looksLikeBarcodeRun(r.text, r.fontStyle, r.rotation)) {
      const cleanVal = r.text.trim();
      const wUnits = Math.max(Math.round(xdpi * 0.38), cleanVal.length * 16);
      const hUnits = Math.round(xdpi * 0.28);
      visualElements.push({
        kind: 'barcode',
        x: r.x,
        y: r.y,
        w: wUnits,
        h: hUnits,
        rotation: r.rotation,
        value: cleanVal,
        symbology: 'Code 39',
      });
    } else {
      horizontalRuns.push(r);
    }
  }

  // Group runs sharing same rotation and baseline Y (within 10 L-units) into logical lines
  const rowGroups: Array<{ y: number; rotation: number; items: typeof rawRuns }> = [];
  const sorted = [...horizontalRuns].sort((a, b) => a.rotation - b.rotation || a.y - b.y || a.x - b.x);
  for (const r of sorted) {
    const existing = rowGroups.find((g) => g.rotation === r.rotation && Math.abs(g.y - r.y) <= 10);
    if (existing) {
      existing.items.push(r);
    } else {
      rowGroups.push({ y: r.y, rotation: r.rotation, items: [r] });
    }
  }

  let lineCounter = 0;
  for (const group of rowGroups) {
    group.items.sort((a, b) => a.x - b.x);
    const spans: AfpTextSpan[] = [];
    let combinedRaw = '';
    let prevEndX = -1;

    for (const item of group.items) {
      const red = redactSensitiveText(item.text);
      redactions += red.matchCount;
      const cleanTxt = red.redactedText;
      if (!cleanTxt) continue;

      if (combinedRaw.length > 0) {
        const gap = item.x - prevEndX;
        if (gap > 6) combinedRaw += ' ';
      }
      combinedRaw += cleanTxt;

      const approxCharW = Math.max(8, (item.fontStyle.fontSizePt / 72) * xdpi * 0.52);
      prevEndX = item.x + cleanTxt.length * approxCharW;

      spans.push({
        x: item.x,
        text: cleanTxt,
        fontSizePt: item.fontStyle.fontSizePt,
        fontFamily: item.fontStyle.fontFamily,
        fontWeight: item.fontStyle.fontWeight,
        fontStyle: item.fontStyle.fontStyle,
        color: item.color,
      });
    }

    const fullText = combinedRaw.replace(/\s+/g, ' ').trim();
    if (!fullText) continue;

    lineCounter++;
    const first = group.items[0];
    textLines.push(fullText);
    coalescedRuns.push({
      pageIndex: first.pageIndex,
      x: first.x,
      y: group.y,
      fontLocalId: first.fontLocalId,
      text: fullText,
      encoding: first.encoding,
    });
    visualElements.push({
      kind: 'text_line',
      lineNum: lineCounter,
      x: first.x,
      y: group.y,
      rotation: group.rotation,
      spans,
      fullText,
    });
  }

  return { visualElements, textLines, coalescedRuns, redactions };
}

export function parseAfpDocument(buf: Buffer, filename: string, wasCompressed: boolean): AfpParsedResult {
  const sha256 = computeSha256(buf);
  let initialOffset = -1;
  if (buf.length >= 9) {
    if (buf[0] === 0x5a) {
      initialOffset = 0;
    } else {
      // Allow optional IBM mainframe RDW (2/4 byte) or whitespace prefix before first 0x5A + 0xD3 SFID
      const limit = Math.min(64, buf.length - 9);
      for (let probe = 1; probe <= limit; probe++) {
        if (buf[probe] === 0x5a && buf[probe + 3] === 0xd3) {
          const sfLen = buf.readUInt16BE(probe + 1);
          if (sfLen >= 8 && probe + 1 + sfLen <= buf.length) {
            initialOffset = probe;
            break;
          }
        }
      }
    }
  }

  if (initialOffset < 0) {
    return {
      meta: {
        filename,
        format: 'AFP',
        sizeBytes: buf.length,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Unknown / Non-MO:DCA',
        lineEnding: 'BINARY',
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'Invalid MO:DCA introducer',
        producerOrTool: 'AFP Stream',
        parseStatus: 'CORRUPT',
        parseNotes: ['Missing 0x5A MO:DCA structured-field introducer; open in Papyrus to confirm file integrity.'],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      pagesBlank: [],
      pagesDimensions: [],
      afpFields: [],
      afpNative: {
        encodingDetected: 'Unknown',
        tles: [],
        resources: [],
        ptocaRuns: [],
        geometry: [],
        visualPages: [],
        mediaAssets: {},
        totalBngCount: 0,
        totalFieldCount: 0,
      },
      rawUncompressedBuffer: buf,
    };
  }

  const fields: AfpStructuredField[] = [];
  const tles: AfpTleEntry[] = [];
  const resources: AfpResourceRef[] = [];
  const allCoalescedRuns: AfpPtocaRun[] = [];
  const geometry: AfpPageGeometry[] = [];
  const pagesText: string[][] = [];
  const pagesBlank: boolean[] = [];
  const pagesDimensions: Array<{ width: number; height: number }> = [];
  const visualPages: AfpVisualPage[] = [];
  const mediaAssets: Record<string, string> = {};
  const assetUriToId = new Map<string, string>();
  let assetCounter = 0;

  const registerMediaAsset = (dataUri: string): string => {
    const uriHash = computeSha256(Buffer.from(dataUri, 'utf8'));
    const existing = assetUriToId.get(uriHash);
    if (existing) return existing;
    const assetId = `img_${++assetCounter}`;
    assetUriToId.set(uriHash, assetId);
    mediaAssets[assetId] = dataUri;
    return assetId;
  };

  const fonts = new Map<number, CodedFontStyle>();
  const customCodePage = new Map<number, string>();
  type ResourceContainerData = {
    elements: AfpVisualElement[];
    rawRuns: Array<AfpPtocaRun & { rotation: number; fontStyle: CodedFontStyle; color: string }>;
  };
  const namedPageSegments = new Map<string, ResourceContainerData>();
  const namedOverlays = new Map<string, ResourceContainerData>();

  let offset = initialOffset;
  let pageCount = 0;
  let pageGroupCount = 0;
  let totalFieldCount = 0;
  let totalBngCount = 0;
  let totalRedactions = 0;
  let ebcdicCount = 0;
  let asciiCount = 0;

  const defaultW = 2040;
  const defaultH = 2640;
  let curGeo: AfpPageGeometry = { pageIndex: 1, widthUnits: defaultW, heightUnits: defaultH, xdpi: 240, ydpi: 240 };

  let curRawRuns: Array<AfpPtocaRun & { rotation: number; fontStyle: CodedFontStyle; color: string }> = [];
  let curNonTextElements: AfpVisualElement[] = [];

  let activeResourceContainer: {
    kind: 'PAGE_SEG' | 'OVERLAY';
    name: string;
    elements: AfpVisualElement[];
    rawRuns: Array<AfpPtocaRun & { rotation: number; fontStyle: CodedFontStyle; color: string }>;
  } | null = null;
  let inCodePage = false;

  // Embedded object collectors (BIM, BII, BOC, BGR, BBC)
  let activeObjKind: 'BIM' | 'BII' | 'BOC' | 'BGR' | 'BBC' | null = null;
  let objObp: Buffer | null = null;
  let objOad: Buffer | null = null;
  let objIdd: Buffer | null = null;
  let objChunks: Buffer[] = [];
  let objBiiSize: { w: number; h: number } | null = null;

  const ptocaState = {
    i: 120,
    b: 120,
    sim: 120,
    sbi: 40,
    iOrient: 0x0000,
    bOrient: 0x2d00,
    fontLocalId: 1,
    color: '#0f172a',
  };

  const pushElement = (el: AfpVisualElement) => {
    if (activeResourceContainer) activeResourceContainer.elements.push(el);
    else if (pageCount > 0) curNonTextElements.push(el);
  };

  const flushPage = () => {
    const { visualElements, textLines, coalescedRuns, redactions } = coalescePageVisualLines(curRawRuns, curGeo.xdpi);
    totalRedactions += redactions;
    for (const cr of coalescedRuns) {
      allCoalescedRuns.push(cr);
    }
    pagesText.push(textLines);

    const combinedElements = [...curNonTextElements, ...visualElements];
    const joinedText = textLines.join(' ').trim();
    const isBlank =
      combinedElements.length === 0 ||
      (/^(this\s+page\s+(is\s+)?intentionally\s+left\s+blank|intentionally\s+blank|blank\s+page)$/i.test(joinedText) &&
        curNonTextElements.length === 0);

    pagesBlank.push(isBlank);
    pagesDimensions.push({
      width: Math.round((curGeo.widthUnits / curGeo.xdpi) * 72),
      height: Math.round((curGeo.heightUnits / curGeo.ydpi) * 72),
    });
    visualPages.push({
      pageIndex: curGeo.pageIndex,
      widthUnits: curGeo.widthUnits,
      heightUnits: curGeo.heightUnits,
      xdpi: curGeo.xdpi,
      ydpi: curGeo.ydpi,
      elements: combinedElements,
    });
  };

  while (offset + 9 <= buf.length) {
    if (buf[offset] !== 0x5a) {
      // Skip benign record padding (CR/LF/NUL) or 2/4-byte mainframe RDW prefixes before next 0x5A MO:DCA field
      if (buf[offset] === 0x0d || buf[offset] === 0x0a || buf[offset] === 0x00) {
        offset++;
        continue;
      }
      if (offset + 11 <= buf.length && buf[offset + 2] === 0x5a && buf[offset + 5] === 0xd3) {
        offset += 2;
        continue;
      }
      if (offset + 13 <= buf.length && buf[offset + 4] === 0x5a && buf[offset + 7] === 0xd3) {
        offset += 4;
        continue;
      }
      break;
    }

    const length = buf.readUInt16BE(offset + 1);
    if (length < 8 || offset + 1 + length > buf.length) break;
    const sfidHex = buf.subarray(offset + 3, offset + 6).toString('hex').toUpperCase();
    const sfInfo = MODCA_SFID_MAP[sfidHex] || { mnemonic: 'SF', description: `Structured Field (${sfidHex})` };
    const payload = buf.subarray(offset + 9, offset + 1 + length);

    totalFieldCount++;
    if (sfInfo.mnemonic === 'BNG') {
      pageGroupCount++;
      totalBngCount++;
    }

    if (sfInfo.mnemonic === 'BPS' || sfInfo.mnemonic === 'BMO') {
      const dec = decodeAfpBytes(payload.subarray(0, Math.min(8, payload.length)));
      const name = dec.text || `${sfInfo.mnemonic}_${namedPageSegments.size + namedOverlays.size + 1}`;
      activeResourceContainer = {
        kind: sfInfo.mnemonic === 'BPS' ? 'PAGE_SEG' : 'OVERLAY',
        name,
        elements: [],
        rawRuns: [],
      };
      ptocaState.i = 120;
      ptocaState.b = 120;
      ptocaState.sim = 120;
      ptocaState.iOrient = 0x0000;
      ptocaState.bOrient = 0x2d00;
      ptocaState.fontLocalId = 1;
      ptocaState.color = '#0f172a';
    } else if (sfInfo.mnemonic === 'EPS' || sfInfo.mnemonic === 'EMO') {
      if (activeResourceContainer) {
        const containerData: ResourceContainerData = {
          elements: activeResourceContainer.elements,
          rawRuns: activeResourceContainer.rawRuns,
        };
        if (activeResourceContainer.kind === 'PAGE_SEG') {
          namedPageSegments.set(activeResourceContainer.name, containerData);
        } else {
          namedOverlays.set(activeResourceContainer.name, containerData);
        }
        activeResourceContainer = null;
      }
    } else if (sfInfo.mnemonic === 'BCP') {
      inCodePage = true;
    } else if (sfInfo.mnemonic === 'ECP') {
      inCodePage = false;
    } else if (sfInfo.mnemonic === 'CPI' && inCodePage) {
      // Parse inline CPI entries: each 10 or 11 bytes = GCGID(8), flags(1), codePoint(1 or 2)
      const entryLen = payload.length % 11 === 0 ? 11 : 10;
      for (let p = 0; p + entryLen <= payload.length; p += entryLen) {
        const gcgid = decodeAfpBytes(payload.subarray(p, p + 8)).text;
        const cpByte = payload[p + entryLen - 1];
        const ch = GCGID_TO_CHAR[gcgid];
        if (ch && cpByte !== undefined) {
          customCodePage.set(cpByte, ch);
        }
      }
    } else if (sfInfo.mnemonic === 'BPG') {
      pageCount++;
      curGeo = { pageIndex: pageCount, widthUnits: defaultW, heightUnits: defaultH, xdpi: 240, ydpi: 240 };
      curRawRuns = [];
      curNonTextElements = [];
      ptocaState.i = 120;
      ptocaState.b = 120;
      ptocaState.sim = 120;
      ptocaState.iOrient = 0x0000;
      ptocaState.bOrient = 0x2d00;
      ptocaState.fontLocalId = 1;
      ptocaState.color = '#0f172a';
    }

    const activePage = Math.max(1, pageCount);
    let textPreview: string | undefined;

    if (sfInfo.mnemonic === 'TLE') {
      const triplets = parseAfpTriplets(payload);
      let attrName = 'TLE_KEY';
      let attrVal = '';
      let enc: 'EBCDIC' | 'ASCII' = 'ASCII';

      for (const t of triplets) {
        if (t.tid === 0x02 && t.data.length > 2) {
          const dec = decodeAfpBytes(t.data.subarray(2), customCodePage);
          attrName = dec.text || attrName;
          enc = dec.encoding;
        } else if (t.tid === 0x36 && t.data.length > 2) {
          const dec = decodeAfpBytes(t.data.subarray(2), customCodePage);
          attrVal = dec.text;
          enc = dec.encoding;
        }
      }
      if (!attrVal && triplets.length === 0 && payload.length > 0) {
        const dec = decodeAfpBytes(payload, customCodePage);
        const parts = dec.text.split('=');
        attrName = parts[0]?.trim() || 'TLE';
        attrVal = parts.slice(1).join('=').trim() || dec.text;
        enc = dec.encoding;
      }
      const redVal = redactSensitiveText(attrVal);
      totalRedactions += redVal.matchCount;
      if (enc === 'EBCDIC') ebcdicCount++;
      else asciiCount++;

      tles.push({
        pageGroupIndex: Math.max(1, pageGroupCount),
        attributeName: attrName,
        attributeValue: redVal.redactedText,
        encoding: enc,
      });
      textPreview = `${attrName} = ${redVal.redactedText}`;
    } else if (sfInfo.mnemonic === 'PGD' && payload.length >= 12) {
      const xUnitsPer10In = payload.readUInt16BE(2);
      const yUnitsPer10In = payload.readUInt16BE(4);
      const xSize = readUInt24BE(payload, 6);
      const ySize = readUInt24BE(payload, 9);
      const xdpi = Math.round(xUnitsPer10In / 10) || 240;
      const ydpi = Math.round(yUnitsPer10In / 10) || 240;
      curGeo = { pageIndex: activePage, widthUnits: xSize || defaultW, heightUnits: ySize || defaultH, xdpi, ydpi };
      geometry.push(curGeo);
      textPreview = `${xSize}x${ySize} L-units @ ${xdpi} dpi`;
    } else if (sfInfo.mnemonic === 'MCF2') {
      // MCF2 repeating groups: rgLen(2), then triplets (0x02 FQN, 0x24 ResourceLocalId, 0x1F FontScale)
      let p = 0;
      const names: string[] = [];
      while (p + 2 <= payload.length) {
        const rgLen = payload.readUInt16BE(p);
        if (rgLen < 4 || p + rgLen > payload.length) break;
        const rg = payload.subarray(p + 2, p + rgLen);
        const triplets = parseAfpTriplets(rg);
        let fName = '';
        let fLocalId = fonts.size + 1;
        let ptHint: number | undefined;
        for (const t of triplets) {
          if (t.tid === 0x02 && t.data.length > 2) {
            fName = decodeAfpBytes(t.data.subarray(2), customCodePage).text;
          } else if (t.tid === 0x24 && t.data.length >= 2) {
            fLocalId = t.data[1];
          } else if ((t.tid === 0x1f || t.tid === 0x1d) && t.data.length >= 2) {
            const rawTwips = t.data.readUInt16BE(0);
            if (rawTwips >= 80 && rawTwips <= 1440) ptHint = Math.round((rawTwips / 20) * 10) / 10;
          }
        }
        if (fName) {
          const style = inferFontStyleFromName(fLocalId, fName, ptHint);
          fonts.set(fLocalId, style);
          resources.push({ type: 'FONT (MCF)', name: fName, pageIndex: activePage });
          names.push(`${fLocalId}:${fName}`);
        }
        p += rgLen;
      }
      textPreview = names.join(', ') || 'Coded Font Map';
    } else if (sfInfo.mnemonic === 'MCF') {
      const rgLen = payload[0] || 0;
      const names: string[] = [];
      if (rgLen >= 10) {
        for (let p = 1; p + rgLen <= payload.length; p += rgLen) {
          const localId = payload[p];
          const fName = decodeAfpBytes(payload.subarray(p + 2, Math.min(p + 10, p + rgLen)), customCodePage).text;
          if (fName) {
            fonts.set(localId, inferFontStyleFromName(localId, fName));
            resources.push({ type: 'FONT (MCF)', name: fName, pageIndex: activePage });
            names.push(`${localId}:${fName}`);
          }
        }
      }
      if (names.length === 0) {
        const dec = decodeAfpBytes(payload.subarray(0, Math.min(24, payload.length)), customCodePage);
        if (dec.text) resources.push({ type: 'FONT (MCF)', name: dec.text, pageIndex: activePage });
        textPreview = dec.text;
      } else {
        textPreview = names.join(', ');
      }
    } else if (sfInfo.mnemonic === 'IMM' || sfInfo.mnemonic === 'MPO' || sfInfo.mnemonic === 'MPS') {
      const dec = decodeAfpBytes(payload.subarray(0, Math.min(24, payload.length)), customCodePage);
      const resName = dec.text || `${sfInfo.mnemonic}_OBJ`;
      const typeMap: Record<string, AfpResourceRef['type']> = {
        IMM: 'MEDIUM_MAP (IMM)',
        MPO: 'OVERLAY (MPO)',
        MPS: 'PAGE_SEG (MPS)',
      };
      resources.push({ type: typeMap[sfInfo.mnemonic], name: resName, pageIndex: activePage });
      textPreview = resName;
    } else if (sfInfo.mnemonic === 'IPS' && payload.length >= 14) {
      // IPS: SegName(8), Xorigin(3), Yorigin(3)
      const segName = decodeAfpBytes(payload.subarray(0, 8), customCodePage).text || 'PAGE_SEG';
      const xOrig = readInt24BE(payload, 8);
      const yOrig = readInt24BE(payload, 11);
      const segData = namedPageSegments.get(segName);
      if (segData && (segData.elements.length > 0 || segData.rawRuns.length > 0)) {
        for (const el of segData.elements) {
          if (el.kind === 'image' || el.kind === 'barcode' || el.kind === 'rule' || el.kind === 'vector') {
            pushElement({ ...el, x: el.x + xOrig, y: el.y + yOrig });
          }
        }
        for (const r of segData.rawRuns) {
          curRawRuns.push({ ...r, pageIndex: activePage, x: r.x + xOrig, y: r.y + yOrig });
        }
      } else {
        pushElement({
          kind: 'external_ref',
          resType: 'PAGE_SEG',
          name: segName,
          x: xOrig,
          y: yOrig,
          w: Math.round(curGeo.xdpi * 1.6),
          h: Math.round(curGeo.ydpi * 0.55),
        });
      }
      textPreview = `${segName} @ (${xOrig}, ${yOrig})`;
    } else if (sfInfo.mnemonic === 'IPO' && payload.length >= 14) {
      const ovlName = decodeAfpBytes(payload.subarray(0, 8), customCodePage).text || 'OVERLAY';
      const xOrig = readInt24BE(payload, 8);
      const yOrig = readInt24BE(payload, 11);
      const ovlData = namedOverlays.get(ovlName);
      if (ovlData && (ovlData.elements.length > 0 || ovlData.rawRuns.length > 0)) {
        for (const el of ovlData.elements) {
          if (el.kind === 'image' || el.kind === 'barcode' || el.kind === 'rule' || el.kind === 'vector') {
            pushElement({ ...el, x: el.x + xOrig, y: el.y + yOrig });
          }
        }
        for (const r of ovlData.rawRuns) {
          curRawRuns.push({ ...r, pageIndex: activePage, x: r.x + xOrig, y: r.y + yOrig });
        }
      } else {
        pushElement({
          kind: 'external_ref',
          resType: 'OVERLAY',
          name: ovlName,
          x: xOrig,
          y: yOrig,
          w: Math.round(curGeo.xdpi * 2.0),
          h: Math.round(curGeo.ydpi * 0.55),
        });
      }
      textPreview = `${ovlName} @ (${xOrig}, ${yOrig})`;
    } else if (
      sfInfo.mnemonic === 'BIM' ||
      sfInfo.mnemonic === 'BII' ||
      sfInfo.mnemonic === 'BOC' ||
      sfInfo.mnemonic === 'BGR' ||
      sfInfo.mnemonic === 'BBC'
    ) {
      activeObjKind = sfInfo.mnemonic;
      objObp = null;
      objOad = null;
      objIdd = null;
      objChunks = [];
      objBiiSize = null;
      const objName = decodeAfpBytes(payload.subarray(0, Math.min(8, payload.length)), customCodePage).text || sfInfo.mnemonic;
      if (sfInfo.mnemonic === 'BIM' || sfInfo.mnemonic === 'BII') {
        resources.push({ type: 'IMAGE (BIM)', name: objName, pageIndex: activePage });
      } else if (sfInfo.mnemonic === 'BBC') {
        resources.push({ type: 'BARCODE (BBC)', name: objName, pageIndex: activePage });
      }
      textPreview = objName;
    } else if (sfInfo.mnemonic === 'OBP' && activeObjKind) {
      objObp = payload;
    } else if ((sfInfo.mnemonic === 'OAD' || sfInfo.mnemonic === 'CDD') && activeObjKind) {
      objOad = payload;
    } else if ((sfInfo.mnemonic === 'IDD' || sfInfo.mnemonic === 'BDD' || sfInfo.mnemonic === 'GDD') && activeObjKind) {
      objIdd = payload;
    } else if ((sfInfo.mnemonic === 'IPD' || sfInfo.mnemonic === 'OCD' || sfInfo.mnemonic === 'BDA' || sfInfo.mnemonic === 'GAD') && activeObjKind) {
      objChunks.push(payload);
    } else if (sfInfo.mnemonic === 'IID' && activeObjKind === 'BII' && payload.length >= 16) {
      objBiiSize = { w: payload.readUInt16BE(12), h: payload.readUInt16BE(14) };
    } else if (sfInfo.mnemonic === 'ICP' && activeObjKind === 'BII') {
      objObp = payload;
    } else if (sfInfo.mnemonic === 'IRD' && activeObjKind === 'BII') {
      objChunks.push(payload);
    } else if (sfInfo.mnemonic === 'EIM' && activeObjKind === 'BIM') {
      const decoded = decodeIocaImage(objIdd, objChunks);
      if (decoded) {
        const place = parseObjectAreaPlacement(objObp, objOad, 0, 0);
        const w = objOad ? place.w : Math.max(96, Math.round((decoded.width / 240) * curGeo.xdpi));
        const h = objOad ? place.h : Math.max(96, Math.round((decoded.height / 240) * curGeo.ydpi));
        const assetId = registerMediaAsset(decoded.dataUri);
        pushElement({ kind: 'image', x: place.x, y: place.y, w, h, assetId, label: 'IOCA Image' });
      }
      activeObjKind = null;
    } else if (sfInfo.mnemonic === 'EII' && activeObjKind === 'BII') {
      if (objBiiSize && objChunks.length > 0) {
        const raw = Buffer.concat(objChunks);
        const dataUri = monoBitsToPngDataUri(objBiiSize.w, objBiiSize.h, raw, false);
        if (dataUri) {
          const x = objObp && objObp.length >= 3 ? objObp.readUInt16BE(0) : 140;
          const y = objObp && objObp.length >= 5 ? objObp.readUInt16BE(2) : 110;
          const assetId = registerMediaAsset(dataUri);
          pushElement({ kind: 'image', x, y, w: objBiiSize.w, h: objBiiSize.h, assetId, label: 'IM Image' });
        }
      }
      activeObjKind = null;
    } else if (sfInfo.mnemonic === 'EOC' && activeObjKind === 'BOC') {
      const raw = Buffer.concat(objChunks);
      let mime = '';
      if (raw.length >= 4 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) mime = 'image/png';
      else if (raw.length >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff) mime = 'image/jpeg';
      else if (raw.length >= 3 && raw[0] === 0x47 && raw[1] === 0x49 && raw[2] === 0x46) mime = 'image/gif';
      if (mime) {
        const place = parseObjectAreaPlacement(objObp, objOad, 140, 110);
        const assetId = registerMediaAsset(`data:${mime};base64,${raw.toString('base64')}`);
        pushElement({ kind: 'image', x: place.x, y: place.y, w: place.w, h: place.h, assetId, label: 'Object Container Graphic' });
      }
      activeObjKind = null;
    } else if (sfInfo.mnemonic === 'EBC' && activeObjKind === 'BBC') {
      const raw = Buffer.concat(objChunks);
      // BDA payload: flags(1), Xoffset(2), Yoffset(2), barcodeData(...)
      const bcData = raw.length > 5 ? raw.subarray(5) : raw;
      const dec = decodeAfpBytes(bcData, customCodePage);
      const val = redactSensitiveText(dec.text).redactedText;
      if (val) {
        const place = parseObjectAreaPlacement(objObp, objOad, 110, 1500);
        pushElement({
          kind: 'barcode',
          x: place.x,
          y: place.y,
          w: place.w || 360,
          h: place.h || 72,
          rotation: place.rotation,
          value: val,
          symbology: 'BCOCA',
        });
      }
      activeObjKind = null;
    } else if (sfInfo.mnemonic === 'EGR' && activeObjKind === 'BGR') {
      // Enhanced GOCA vector extraction (Boxes, Polylines, Circles/Full Arcs, Colors, Line Widths, Filled Areas)
      const raw = Buffer.concat(objChunks);
      const place = parseObjectAreaPlacement(objObp, objOad, 0, 0);
      const paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }> = [];
      let p = 0;
      let fillMode = false;
      let curColor = '#0f172a';
      let curStrokeWidth = 2;

      const gocaColorHex = (body: Buffer): string => {
        if (body.length >= 3 && body[0] === 0xff) {
          // Extended RGB triplet marker (custom helper: 0xFF, R, G, B)
          if (body.length >= 4) {
            return `#${body[1].toString(16).padStart(2, '0')}${body[2].toString(16).padStart(2, '0')}${body[3].toString(16).padStart(2, '0')}`;
          }
        }
        return ocaColorToHex(body.length >= 2 ? body.readUInt16BE(0) : body[0]);
      };

      while (p + 2 <= raw.length) {
        const order = raw[p];
        if (order === 0x68) {
          fillMode = true;
          p += 2;
          continue;
        }
        if (order === 0x58 || order === 0x5c) {
          fillMode = false;
          p += 2;
          continue;
        }
        const len = raw[p + 1];
        if (p + 2 + len > raw.length) break;
        const body = raw.subarray(p + 2, p + 2 + len);

        if ((order === 0x0a || order === 0x26) && body.length >= 1) {
          // GOCA Set Color (0x0A) / Extended Color (0x26)
          curColor = gocaColorHex(body);
        } else if ((order === 0x18 || order === 0x19) && body.length >= 1) {
          // GOCA Set Line Width
          curStrokeWidth = Math.max(1, Math.min(12, body[0]));
        } else if ((order === 0x80 || order === 0xc0) && body.length >= 8) {
          // GOCA Box (supports 8-byte (x1,y1,x2,y2) or 10-byte (flags,x1,y1,x2,y2))
          const off = body.length >= 10 ? 2 : 0;
          const x1 = body.readInt16BE(off);
          const y1 = body.readInt16BE(off + 2);
          const x2 = body.readInt16BE(off + 4);
          const y2 = body.readInt16BE(off + 6);
          paths.push({
            d: `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`,
            fill: fillMode ? curColor : undefined,
            stroke: curColor,
            strokeWidth: curStrokeWidth,
          });
        } else if ((order === 0x81 || order === 0xc1 || order === 0x85 || order === 0xc5) && body.length >= 8) {
          // Polyline / Fillet (x1, y1, x2, y2, ...)
          const pts: string[] = [];
          for (let k = 0; k + 4 <= body.length; k += 4) {
            const px = body.readInt16BE(k);
            const py = body.readInt16BE(k + 2);
            pts.push(`${k === 0 ? 'M' : 'L'} ${px} ${py}`);
          }
          if (pts.length > 1) {
            paths.push({
              d: fillMode ? `${pts.join(' ')} Z` : pts.join(' '),
              fill: fillMode ? curColor : undefined,
              stroke: curColor,
              strokeWidth: curStrokeWidth,
            });
          }
        } else if ((order === 0x87 || order === 0xc7) && body.length >= 6) {
          // Full Arc / Circle (cx, cy, radius) emitted as 4 cubic Beziers (supported identically in SVG and pdf-lib)
          const cx = body.readInt16BE(0);
          const cy = body.readInt16BE(2);
          const r = Math.max(2, Math.abs(body.readInt16BE(4)));
          const k = +(r * 0.55228475).toFixed(2);
          paths.push({
            d: `M ${cx} ${cy - r} C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} Z`,
            fill: fillMode ? curColor : undefined,
            stroke: curColor,
            strokeWidth: curStrokeWidth,
          });
        }
        p += 2 + len;
      }

      if (paths.length > 0) {
        let viewW = place.w;
        let viewH = place.h;
        if (objIdd && objIdd.length >= 16) {
          // Basic GDD window bounds check if defined
          const gw = objIdd.readUInt16BE(8);
          const gh = objIdd.readUInt16BE(10);
          if (gw > 10 && gw <= 3000 && gh > 10 && gh <= 3500) {
            viewW = gw;
            viewH = gh;
          }
        }
        pushElement({
          kind: 'vector',
          x: place.x,
          y: place.y,
          w: objOad ? place.w : viewW,
          h: objOad ? place.h : viewH,
          viewW,
          viewH,
          paths,
        });
      }
      activeObjKind = null;
    } else if (sfInfo.mnemonic === 'PTX') {
      const { runs, rules } = parsePtocaPayload(
        payload,
        activePage,
        curGeo.widthUnits,
        curGeo.heightUnits,
        ptocaState,
        fonts,
        customCodePage
      );
      for (const rl of rules) {
        pushElement({ kind: 'rule', ...rl });
      }
      for (const r of runs) {
        if (r.encoding === 'EBCDIC') ebcdicCount++;
        else asciiCount++;
        if (activeResourceContainer) {
          activeResourceContainer.rawRuns.push(r);
        } else {
          curRawRuns.push(r);
        }
      }
      if (runs.length > 0) {
        textPreview = runs.map((r) => `(${r.x},${r.y}) ${redactSensitiveText(r.text).redactedText}`).join(' | ');
      }
    } else if (sfInfo.mnemonic === 'BNG' || sfInfo.mnemonic === 'BDT' || sfInfo.mnemonic === 'NOP') {
      const dec = decodeAfpBytes(payload, customCodePage);
      if (dec.text.length > 0) {
        const red = redactSensitiveText(dec.text);
        totalRedactions += red.matchCount;
        if (dec.encoding === 'EBCDIC') ebcdicCount++;
        else asciiCount++;
        textPreview = red.redactedText;
      }
    }

    if (sfInfo.mnemonic === 'EPG') {
      flushPage();
    }

    if (fields.length < MAX_AFP_FIELDS_PREVIEW) {
      fields.push({
        offset,
        length,
        sfidHex,
        mnemonic: sfInfo.mnemonic,
        description: sfInfo.description,
        pageIndex: activePage,
        textPreview,
      });
    }

    offset += 1 + length;
  }

  // Handle unclosed final page if stream truncated slightly before EPG
  if (pageCount > pagesText.length) {
    flushPage();
  }

  const encodingDetected =
    ebcdicCount > 0 && asciiCount > 0
      ? 'Mixed EBCDIC CP037 + ASCII'
      : ebcdicCount > 0
      ? 'EBCDIC CP037 / CP500'
      : 'ASCII / MO:DCA';

  const firstGeo = geometry[0];
  const geoSummary = firstGeo
    ? `${(firstGeo.widthUnits / firstGeo.xdpi).toFixed(1)}x${(firstGeo.heightUnits / firstGeo.ydpi).toFixed(1)}in (${firstGeo.xdpi}dpi)`
    : `${pageGroupCount} Named Group(s)`;

  const imgCount = Object.keys(mediaAssets).length;
  const parseNotes = [
    `Direct native AFP validation: parsed ${totalFieldCount} MO:DCA fields, ${tles.length} TLE index tags, ${resources.length} resource bindings, ${imgCount} unique decoded image/logo object(s), and ${allCoalescedRuns.length} coalesced PTOCA line(s).`,
  ];
  if (totalFieldCount > MAX_AFP_FIELDS_PREVIEW) {
    parseNotes.push(`MO:DCA structured-field table preview capped at ${MAX_AFP_FIELDS_PREVIEW} of ${totalFieldCount} records (all pages, TLEs, and visuals parsed 100%).`);
  }
  if (visualPages.some((vp) => vp.elements.some((el) => el.kind === 'external_ref'))) {
    parseNotes.push('External OVL/PSEG references detected; attach Papyrus PDF proxy if external mainframe artwork inspection is required.');
  }

  return {
    meta: {
      filename,
      format: 'AFP',
      sizeBytes: buf.length,
      sha256,
      compressedFromGzip: wasCompressed,
      encoding: `MO:DCA Binary (${encodingDetected})`,
      lineEnding: 'BINARY',
      hasBom: false,
      pageCount: Math.max(pageCount, 1),
      recordCount: totalFieldCount,
      dimensionsSummary: `${geoSummary} · ${tles.length} TLE(s) · ${resources.length} Resource(s)`,
      producerOrTool: 'Direct MO:DCA + IOCA/GOCA/BCOCA/PTOCA Engine',
      parseStatus: 'PARSED',
      parseNotes,
      redactedPiiMatches: totalRedactions,
    },
    pagesText,
    pagesBlank,
    pagesDimensions,
    afpFields: fields,
    afpNative: {
      encodingDetected,
      tles,
      resources,
      ptocaRuns: allCoalescedRuns,
      geometry,
      visualPages,
      mediaAssets,
      totalBngCount,
      totalFieldCount,
    },
    rawUncompressedBuffer: buf,
  };
}
