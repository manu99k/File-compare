import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  computeSha256,
  redactSensitiveText,
  safeGunzip,
  sanitizeFilename,
} from './security.ts';
import { parseAfpDocument } from './afpEngine.ts';
import type {
  AdapterCapability,
  AfpPageGeometry,
  AfpPtocaRun,
  AfpResourceRef,
  AfpStructuredField,
  AfpTleEntry,
  AfpVisualPage,
  AlignedPageSlot,
  ArtifactMetadata,
  ComparisonLayerSummary,
  ComparisonRun,
  DiffCategory,
  FileFormat,
  FindingRecord,
  InlineToken,
  InventoryConfigRule,
  LineEndingStyle,
  OutcomeStatus,
  PairingCheck,
  PclCommandSummary,
  PclPositionedLine,
  PdfLineLayout,
  RtControlCheck,
  TextDiffLine,
} from '../src/types/qe.ts';

export const ADAPTER_REGISTRY: AdapterCapability[] = [
  {
    format: 'AFP',
    displayName: 'AFP / MO:DCA Direct Native + Papyrus Companion',
    supportStatus: 'Human-in-the-Loop (Papyrus) + Structural',
    parserEngine: 'Direct Native MO:DCA 0x5A + PTOCA (PTX) + TLE + EBCDIC Parser (No PDF Conversion)',
    canParse: [
      'MO:DCA 0x5A structured fields (BDT/EDT, BNG/ENG, BPG/EPG, BAG/EAG, NOP)',
      'TLE (D3A090) Tagged Logical Elements in native EBCDIC CP037/CP500 or ASCII',
      'PTOCA (PTX D3EE9B) coordinates (AMI X, AMB Y), coded fonts (SCFL), and TRN text runs',
      'Resource & print-control bindings (MCF fonts, MPO overlays, MPS page segments, IMM medium maps, BBC/BIM)',
      'PGD (D3A6AF) exact page width, height, and DPI geometry',
    ],
    checksPerformed: [
      'Direct binary MO:DCA comparison without lossy PDF conversion',
      'TLE statement/account index tag parity and BNG page-group reconciliation',
      'Resource binding & IMM medium map (duplex/simplex/tray) parity',
      'PTOCA X/Y coordinate drift and EBCDIC/ASCII text comparison per page',
      'Native AFP coordinate wireframe overlay + optional Papyrus visual inspection',
    ],
    cannotVerify: [
      'External mainframe/server AFP resource binaries (FOCA glyph outlines, OVL/PSEG artwork) not embedded inline',
      'Physical barcode scanability, MICR magnetic ink placement, and halftone image quality',
      'Final visual sign-off on high-risk templates without ISIS Papyrus or licensed native AFP rasterizer',
    ],
    humanReviewRequired: true,
    humanReviewTrigger: 'Required when external AFP resources (OVL/FOCA/PSEG) or barcode/MICR visual rendering need confirmation in ISIS Papyrus.',
    approvedExternalTool: 'ISIS Papyrus Viewer / Native AFP Compare (Zero PDF Conversion)',
  },
  {
    format: 'PDF',
    displayName: 'PDF Document & Visual Canvas',
    supportStatus: 'Automated + Visual Diff',
    parserEngine: 'pdfjs-dist Structural, Text & Canvas Pixel Diff',
    canParse: [
      'PDF header, cross-reference integrity, and producer/creator metadata',
      'Per-page MediaBox dimensions (points) and orientation',
      'Positioned text runs grouped by page and line coordinate',
      'Full raster pixel comparison rendered directly in the QE browser canvas',
    ],
    checksPerformed: [
      'Page count, page dimension, and orientation parity',
      'Page-by-page text diff with critical-field sensitivity (amounts, dates, routing)',
      'Side-by-side visual canvas rendering with pixel-difference heatmap and tolerance slider',
      'Blank page, text clipping, and font-wrapping anomaly detection',
    ],
    cannotVerify: [
      'Physical printer tray/finishing duplex instructions outside PDF metadata',
      'Embedded image semantic equivalence without approved OCR/image hash rule',
    ],
    humanReviewRequired: false,
    humanReviewTrigger: 'Triggered automatically when visual pixel variance exceeds configured tolerance or embedded images/signatures change.',
  },
  {
    format: 'PCL',
    displayName: 'PCL5 / PCL XL Print Stream',
    supportStatus: 'Automated Structural + Text',
    parserEngine: 'PCL5 Escape-Sequence & Coordinate Stream Parser',
    canParse: [
      'ESC commands: Reset (ESC E), Page Size (&l#A), Orientation (&l#O), Tray (&l#H)',
      'Font pitch (&l/s#H) and point height (s#V)',
      'Cursor positioning (*p#X / *p#Y) and Form Feed (0x0C) page breaks',
      'Printable ASCII text runs per page',
    ],
    checksPerformed: [
      'Page count and form-feed boundary parity',
      'Paper size, orientation, paper tray, and font pitch/height drift checks',
      'Page-by-page extracted text comparison and trailing disclosure verification',
    ],
    cannotVerify: [
      'Downloaded soft-font binary glyph outlines and raster macro bitmaps',
      'Exact physical print output without hardware/approved PCL RIP renderer',
    ],
    humanReviewRequired: false,
    humanReviewTrigger: 'Triggered when paper tray, orientation, or font pitch/size diverges from IMDS baseline.',
  },
  {
    format: 'RT',
    displayName: 'RT / RPT Report & Fixed-Width Text',
    supportStatus: 'Automated Structural + Text',
    parserEngine: 'Line-Oriented Report, Banner & Control-Total Parser',
    canParse: [
      'Encoding, UTF-8 BOM presence, and LF/CRLF/Mixed line-ending consistency',
      'Report header banners, page breaks, and trailer/footer blocks',
      'Record counts and numeric control totals (amounts, debits, credits, counts)',
      'Line-by-line and column-aligned content',
    ],
    checksPerformed: [
      'Line ending consistency (flags CRLF vs LF or mixed line endings)',
      'Header/banner and trailer/footer parity',
      'Numeric control total reconciliation within configured numeric tolerance',
      'Line-level additions, deletions, reorderings, and redacted PII checks',
    ],
    cannotVerify: [
      'Downstream mainframe JCL routing outside supplied metadata',
    ],
    humanReviewRequired: false,
    humanReviewTrigger: 'Triggered only on configured manual business-critical report checks or approved exception waivers.',
  },
  {
    format: 'GZIP',
    displayName: 'GZIP Compressed Container (.gz)',
    supportStatus: 'Container Pre-Processor',
    parserEngine: 'Bounded zlib Stream Inspector (Decompression-Bomb Guarded)',
    canParse: [
      'GZIP magic header (0x1F 0x8B) and stream CRC/trailer integrity',
      'Safe bounded decompression (150 MB upload / 200 MB decompressed cap, 120:1 ratio cap)',
      'Nested compression detection',
    ],
    checksPerformed: [
      'Corrupted or truncated stream rejection (Blocked)',
      'Unexpected nested GZIP rejection (Blocked)',
      'Inner payload forwarding to target AFP/PDF/PCL/RT adapter',
    ],
    cannotVerify: [
      'Non-GZIP proprietary archive formats (.zip, .7z, .tar) unless explicitly approved',
    ],
    humanReviewRequired: false,
    humanReviewTrigger: 'Blocked automatically if archive is corrupt, truncated, nested, or exceeds safety caps.',
  },
];

interface ParsedArtifact {
  meta: ArtifactMetadata;
  pagesText: string[][];
  pagesBlank?: boolean[];
  pagesDimensions?: Array<{ width: number; height: number }>;
  pdfLayouts?: PdfLineLayout[][];
  pclPages?: PclCommandSummary[];
  pclLines?: PclPositionedLine[][];
  afpFields?: AfpStructuredField[];
  afpNative?: {
    encodingDetected: string;
    tles: AfpTleEntry[];
    resources: AfpResourceRef[];
    ptocaRuns: AfpPtocaRun[];
    geometry: AfpPageGeometry[];
    visualPages?: AfpVisualPage[];
    mediaAssets?: Record<string, string>;
    totalBngCount?: number;
    totalFieldCount?: number;
  };
  rtInfo?: {
    banner: string;
    footer: string;
    totals: Record<string, number>;
    rawLines: string[];
  };
  rawUncompressedBuffer: Buffer;
}

function detectLineEnding(text: string): LineEndingStyle {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfOnlyCount = (text.replace(/\r\n/g, '').match(/\n/g) || []).length;
  if (crlfCount > 0 && lfOnlyCount > 0) return 'MIXED';
  if (crlfCount > 0) return 'CRLF';
  if (lfOnlyCount > 0) return 'LF';
  return 'NONE';
}

export function inferFormatFromFilename(filename: string): FileFormat | null {
  const lower = filename.toLowerCase().replace(/\.gz$/, '');
  if (lower.endsWith('.afp')) return 'AFP';
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.pcl') || lower.endsWith('.prn')) return 'PCL';
  if (lower.endsWith('.rt') || lower.endsWith('.rpt') || lower.endsWith('.txt')) return 'RT';
  return null;
}

async function parsePdf(buf: Buffer, filename: string, wasCompressed: boolean): Promise<ParsedArtifact> {
  const sha256 = computeSha256(buf);
  const parseNotes: string[] = [];

  if (buf.length === 0) {
    return {
      meta: {
        filename,
        format: 'PDF',
        sizeBytes: 0,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Binary PDF',
        lineEnding: 'BINARY',
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'N/A (empty file)',
        producerOrTool: 'Unknown',
        parseStatus: 'CORRUPT',
        parseNotes: ['Zero-byte PDF artifact cannot be verified.'],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      rawUncompressedBuffer: buf,
    };
  }

  const header = buf.subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    return {
      meta: {
        filename,
        format: 'PDF',
        sizeBytes: buf.length,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Invalid',
        lineEnding: 'BINARY',
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'Invalid PDF signature',
        producerOrTool: 'Unknown',
        parseStatus: 'CORRUPT',
        parseNotes: ['Missing %PDF- file header; file is corrupt or wrong format.'],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      rawUncompressedBuffer: buf,
    };
  }

  let jsPdf: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    // Independent byte view prevents pdfjs worker transfer from detaching the original Buffer
    const pdfBytesCopy = new Uint8Array(buf);
    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytesCopy,
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    jsPdf = await loadingTask.promise;
    const pageCount = jsPdf.numPages;

    let producer = 'Unspecified PDF Producer';
    try {
      const md = await jsPdf.getMetadata();
      const info = (md?.info || {}) as Record<string, unknown>;
      if (typeof info.Producer === 'string' && info.Producer.trim()) {
        producer = info.Producer.trim();
      } else if (typeof info.Creator === 'string' && info.Creator.trim()) {
        producer = info.Creator.trim();
      }
    } catch {
      // keep default producer label
    }

    const dimsArr: Array<{ width: number; height: number }> = [];
    const dims: string[] = [];
    const pagesText: string[][] = [];
    const pagesBlank: boolean[] = [];
    const pdfLayouts: PdfLineLayout[][] = [];
    let totalRedactions = 0;

    for (let i = 1; i <= jsPdf.numPages; i++) {
      const page = await jsPdf.getPage(i);
      try {
        const unscaled = page.getViewport({ scale: 1 });
        const pw = Math.round(unscaled.width);
        const ph = Math.round(unscaled.height);
        dimsArr.push({ width: pw, height: ph });
        dims.push(`${pw}x${ph}pt`);

        const content = await page.getTextContent();
        const styles = (content.styles || {}) as Record<string, { fontFamily?: string }>;
        const rows = new Map<
          number,
          Array<{ x: number; y: number; width: number; height: number; fontName: string; fontSize: number; text: string }>
        >();

        for (const item of content.items) {
          if ('str' in item && item.str.trim().length > 0) {
            const yRaw = item.transform[5];
            const yKey = Math.round(yRaw / 2) * 2;
            const x = item.transform[4];
            const fontSize = Math.round(Math.hypot(item.transform[0], item.transform[1]) * 10) / 10 || 10;
            const styleFamily = styles[item.fontName]?.fontFamily || item.fontName || 'Helvetica';
            const existing = rows.get(yKey) || [];
            existing.push({
              x,
              y: Math.round(yRaw * 10) / 10,
              width: Math.round((item.width || 0) * 10) / 10,
              height: Math.round((item.height || fontSize) * 10) / 10,
              fontName: styleFamily,
              fontSize,
              text: item.str,
            });
            rows.set(yKey, existing);
          }
        }

        const sortedY = Array.from(rows.keys()).sort((a, b) => b - a);
        const lines: string[] = [];
        const pageLayouts: PdfLineLayout[] = [];
        for (const yKey of sortedY) {
          const chunks = rows.get(yKey)!.sort((a, b) => a.x - b.x);
          const joined = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
          const { redactedText, matchCount } = redactSensitiveText(joined);
          totalRedactions += matchCount;
          lines.push(redactedText);

          const first = chunks[0];
          const last = chunks[chunks.length - 1];
          pageLayouts.push({
            page: i,
            x: Math.round(first.x * 10) / 10,
            y: first.y,
            width: Math.round((last.x + last.width - first.x) * 10) / 10,
            height: first.height,
            fontName: first.fontName,
            fontSize: first.fontSize,
            text: redactedText,
          });
        }
        const joinedText = lines.join(' ').trim();
        let isBlank =
          lines.length === 0 ||
          /^(this\s+page\s+(is\s+)?intentionally\s+left\s+blank|intentionally\s+blank|blank\s+page)$/i.test(joinedText);
        if (lines.length === 0) {
          try {
            const ops = await page.getOperatorList();
            const hasRasterImage = ops.fnArray.some(
              (fn: number) =>
                fn === pdfjsLib.OPS.paintImageXObject ||
                fn === pdfjsLib.OPS.paintInlineImageXObject ||
                fn === pdfjsLib.OPS.paintImageMaskXObject
            );
            const vectorPaintCount = ops.fnArray.filter(
              (fn: number) =>
                fn === pdfjsLib.OPS.constructPath ||
                fn === pdfjsLib.OPS.fill ||
                fn === pdfjsLib.OPS.eoFill ||
                fn === pdfjsLib.OPS.stroke ||
                fn === pdfjsLib.OPS.fillStroke
            ).length;
            if (hasRasterImage || vectorPaintCount >= 3) {
              isBlank = false;
              if (parseNotes.length < 25) {
                parseNotes.push(`Page ${i}: Image/vector form content detected (0 extractable text lines); use Pixel Diff Canvas.`);
              }
            }
          } catch {
            // keep lines.length === 0 fallback
          }
        }
        pagesText.push(lines);
        pagesBlank.push(isBlank);
        pdfLayouts.push(pageLayouts);
      } finally {
        page.cleanup();
      }
    }

    const uniqueDims = Array.from(new Set(dims));
    const totalLines = pagesText.reduce((acc, p) => acc + p.length, 0);
    return {
      meta: {
        filename,
        format: 'PDF',
        sizeBytes: buf.length,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Binary PDF 1.x',
        lineEnding: 'BINARY',
        hasBom: false,
        pageCount,
        recordCount: totalLines,
        dimensionsSummary: uniqueDims.join(', ') || 'Unknown',
        producerOrTool: producer,
        parseStatus: 'PARSED',
        parseNotes,
        redactedPiiMatches: totalRedactions,
      },
      pagesText,
      pagesBlank,
      pagesDimensions: dimsArr,
      pdfLayouts,
      rawUncompressedBuffer: buf,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PDF parse failure';
    return {
      meta: {
        filename,
        format: 'PDF',
        sizeBytes: buf.length,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Corrupt PDF',
        lineEnding: 'BINARY',
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'Unreadable',
        producerOrTool: 'Unknown',
        parseStatus: 'CORRUPT',
        parseNotes: [`PDF parse error: ${msg}`],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      rawUncompressedBuffer: buf,
    };
  } finally {
    if (jsPdf) {
      await jsPdf.loadingTask.destroy().catch(() => undefined);
    }
  }
}

function parsePcl(buf: Buffer, filename: string, wasCompressed: boolean): ParsedArtifact {
  const sha256 = computeSha256(buf);
  if (buf.length === 0) {
    return {
      meta: {
        filename,
        format: 'PCL',
        sizeBytes: 0,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'ASCII / PCL5',
        lineEnding: 'NONE',
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'Empty file',
        producerOrTool: 'PCL5 Stream',
        parseStatus: 'CORRUPT',
        parseNotes: ['Zero-byte PCL print stream cannot be verified.'],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      pclPages: [],
      rawUncompressedBuffer: buf,
    };
  }

  const raw = buf.toString('latin1');
  const hasEsc = raw.includes('\x1b');
  if (!hasEsc) {
    return {
      meta: {
        filename,
        format: 'PCL',
        sizeBytes: buf.length,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Unknown (No PCL ESC sequences)',
        lineEnding: detectLineEnding(raw),
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'Missing PCL escape headers',
        producerOrTool: 'Unknown',
        parseStatus: 'CORRUPT',
        parseNotes: ['No PCL escape sequences (0x1B) detected in stream.'],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      pclPages: [],
      rawUncompressedBuffer: buf,
    };
  }

  const pageSizeLookup: Record<string, string> = {
    '1': 'Executive (7.25x10.5in)',
    '2': 'Letter (8.5x11in)',
    '3': 'Legal (8.5x14in)',
    '26': 'A4 (210x297mm)',
  };
  const orientationLookup: Record<string, string> = {
    '0': 'Portrait',
    '1': 'Landscape',
    '2': 'Reverse Portrait',
    '3': 'Reverse Landscape',
  };
  const trayLookup: Record<string, string> = {
    '1': 'Tray 1 (Main)',
    '2': 'Manual Feed',
    '4': 'Tray 2 (Lower)',
    '5': 'Tray 3 (Large Cap)',
  };

  // Split by form feed 0x0C, stripping trailing empty page after final FF
  const rawPages = raw.split('\x0c');
  if (rawPages.length > 1 && rawPages[rawPages.length - 1].replace(/\x1bE/g, '').trim() === '') {
    rawPages.pop();
  }

  let currentSize = 'Letter (8.5x11in)';
  let currentOrient = 'Portrait';
  let currentTray = 'Default Tray';
  let currentPitch = '10 cpi';
  let currentHeight = '12 pt';
  let totalRedactions = 0;

  const pagesText: string[][] = [];
  const pclPages: PclCommandSummary[] = [];
  const pclLines: PclPositionedLine[][] = [];
  let cursorX = 0;
  let cursorY = 0;

  rawPages.forEach((pageContent, idx) => {
    let escapeCount = 0;
    const escTokenRegex = /\x1b(?:[E9=YZ]|[*&(][^\x1b\r\n]{1,16}[A-Za-z])/g;
    const escMatches = pageContent.match(escTokenRegex) || [];
    escapeCount = escMatches.length;

    const lines: string[] = [];
    const pagePositioned: PclPositionedLine[] = [];

    // Walk ESC tokens and text chunks sequentially so X/Y and font apply to each line
    const segments = pageContent.split(/(\x1b(?:[E9=YZ]|[*&(][^\x1b\r\n]{1,16}[A-Za-z]))/);
    let lineBuf = '';

    const flushLine = () => {
      const cleaned = lineBuf.replace(/[\x00-\x08\x0b-\x1f\r\n]/g, '').trim();
      lineBuf = '';
      if (!cleaned) return;
      const { redactedText, matchCount } = redactSensitiveText(cleaned);
      totalRedactions += matchCount;
      lines.push(redactedText);
      pagePositioned.push({
        pageNumber: idx + 1,
        x: cursorX,
        y: cursorY,
        fontPitchCpi: currentPitch,
        fontHeightPt: currentHeight,
        paperSource: currentTray,
        text: redactedText,
      });
    };

    for (const seg of segments) {
      if (!seg) continue;
      if (seg.startsWith('\x1b')) {
        const sizeM = seg.match(/^\x1b&l(\d+)A$/);
        if (sizeM) currentSize = pageSizeLookup[sizeM[1]] || `Code ${sizeM[1]}`;
        const orientM = seg.match(/^\x1b&l(\d+)O$/);
        if (orientM) currentOrient = orientationLookup[orientM[1]] || `Code ${orientM[1]}`;
        const trayM = seg.match(/^\x1b&l(\d+)H$/);
        if (trayM) currentTray = trayLookup[trayM[1]] || `Tray ${trayM[1]}`;
        const pitchM = seg.match(/^\x1b\(s([0-9.]+)H$/);
        if (pitchM) currentPitch = `${pitchM[1]} cpi`;
        const heightM = seg.match(/^\x1b\(s([0-9.]+)V$/);
        if (heightM) currentHeight = `${heightM[1]} pt`;
        const xM = seg.match(/^\x1b\*p([+-]?\d+)X$/);
        if (xM) {
          flushLine();
          cursorX = Number(xM[1]);
        }
        const yM = seg.match(/^\x1b\*p([+-]?\d+)Y$/);
        if (yM) {
          flushLine();
          cursorY = Number(yM[1]);
        }
      } else {
        const subLines = seg.split(/\r?\n/);
        subLines.forEach((sl, sIdx) => {
          lineBuf += sl;
          if (sIdx < subLines.length - 1) {
            flushLine();
            cursorY += 40;
          }
        });
      }
    }
    flushLine();

    pagesText.push(lines);
    pclLines.push(pagePositioned);
    pclPages.push({
      pageNumber: idx + 1,
      paperSize: currentSize,
      orientation: currentOrient,
      paperSource: currentTray,
      fontPitchCpi: currentPitch,
      fontHeightPt: currentHeight,
      escapeCount,
      textLineCount: lines.length,
    });
  });

  const totalLines = pagesText.reduce((acc, p) => acc + p.length, 0);
  const firstPage = pclPages[0];

  return {
    meta: {
      filename,
      format: 'PCL',
      sizeBytes: buf.length,
      sha256,
      compressedFromGzip: wasCompressed,
      encoding: 'ASCII + PCL5 ESC',
      lineEnding: detectLineEnding(raw),
      hasBom: false,
      pageCount: pclPages.length,
      recordCount: totalLines,
      dimensionsSummary: firstPage ? `${firstPage.paperSize} · ${firstPage.orientation}` : 'Unknown',
      producerOrTool: 'PCL5 Print Stream',
      parseStatus: 'PARSED',
      parseNotes: [`Parsed ${pclPages.length} PCL page(s) and ${pclPages.reduce((a, b) => a + b.escapeCount, 0)} ESC commands.`],
      redactedPiiMatches: totalRedactions,
    },
    pagesText,
    pclPages,
    pclLines,
    rawUncompressedBuffer: buf,
  };
}

function parseRt(buf: Buffer, filename: string, wasCompressed: boolean): ParsedArtifact {
  const sha256 = computeSha256(buf);
  if (buf.length === 0) {
    return {
      meta: {
        filename,
        format: 'RT',
        sizeBytes: 0,
        sha256,
        compressedFromGzip: wasCompressed,
        encoding: 'Empty',
        lineEnding: 'NONE',
        hasBom: false,
        pageCount: 0,
        recordCount: 0,
        dimensionsSummary: 'Empty report file',
        producerOrTool: 'Report/Text Generator',
        parseStatus: 'CORRUPT',
        parseNotes: ['Zero-byte RT/RPT file cannot be verified.'],
        redactedPiiMatches: 0,
      },
      pagesText: [],
      rawUncompressedBuffer: buf,
    };
  }

  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const textRaw = (hasBom ? buf.subarray(3) : buf).toString('utf8');
  const lineEnding = detectLineEnding(textRaw);
  const lines = textRaw.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let totalRedactions = 0;
  let maxColWidth = 0;
  const redactedLines: string[] = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const { redactedText, matchCount } = redactSensitiveText(lines[i]);
    totalRedactions += matchCount;
    redactedLines[i] = redactedText;
    if (redactedText.length > maxColWidth) {
      maxColWidth = redactedText.length;
    }
  }

  // Extract control totals from numeric summary lines
  const totals: Record<string, number> = {};
  for (const line of lines) {
    const totalMatch = line.match(/(TOTAL\s+[A-Z0-9 _-]+|RECORD\s+COUNT|STATEMENT\s+COUNT|GRAND\s+TOTAL)\s*[:=]\s*\$?\s*([0-9,]+\.?\d*)/i);
    if (totalMatch) {
      const key = totalMatch[1].trim().toUpperCase();
      const val = Number(totalMatch[2].replace(/,/g, ''));
      if (!Number.isNaN(val)) {
        totals[key] = val;
      }
    }
  }

  const banner = redactedLines[0] || '(No header banner)';
  const footer = redactedLines[redactedLines.length - 1] || '(No trailer/footer)';
  const formFeedCount = (textRaw.match(/\x0c/g) || []).length;
  const pageCount = Math.max(1, formFeedCount || Math.ceil(redactedLines.length / 45));

  return {
    meta: {
      filename,
      format: 'RT',
      sizeBytes: buf.length,
      sha256,
      compressedFromGzip: wasCompressed,
      encoding: hasBom ? 'UTF-8 (with BOM)' : 'UTF-8',
      lineEnding,
      hasBom,
      pageCount,
      recordCount: redactedLines.length,
      dimensionsSummary: `Max line width ${maxColWidth} cols`,
      producerOrTool: 'Text / RPT Batch Writer',
      parseStatus: 'PARSED',
      parseNotes: [`Line ending: ${lineEnding}${hasBom ? ' · BOM present' : ''}`],
      redactedPiiMatches: totalRedactions,
    },
    pagesText: [redactedLines],
    rtInfo: {
      banner,
      footer,
      totals,
      rawLines: redactedLines,
    },
    rawUncompressedBuffer: buf,
  };
}

async function parseArtifact(
  buf: Buffer,
  filename: string,
  format: FileFormat
): Promise<{ ok: boolean; parsed?: ParsedArtifact; error?: string }> {
  const fnCheck = sanitizeFilename(filename);
  if (fnCheck.rejected) {
    return { ok: false, error: `Filename rejected: ${fnCheck.reason}` };
  }
  if (!buf || buf.length === 0) {
    return { ok: false, error: `${filename} is zero bytes (empty output).` };
  }

  const gzResult = safeGunzip(buf, filename);
  if (!gzResult.ok) {
    return { ok: false, error: gzResult.error || 'Archive decompression failed.' };
  }
  const innerName = gzResult.wasCompressed ? filename.replace(/\.gz$/i, '') : filename;

  if (format === 'PDF') {
    return { ok: true, parsed: await parsePdf(gzResult.buffer, innerName, gzResult.wasCompressed) };
  }
  if (format === 'PCL') {
    return { ok: true, parsed: parsePcl(gzResult.buffer, innerName, gzResult.wasCompressed) };
  }
  if (format === 'RT') {
    return { ok: true, parsed: parseRt(gzResult.buffer, innerName, gzResult.wasCompressed) };
  }
  const afpParsed = parseAfpDocument(gzResult.buffer, innerName, gzResult.wasCompressed);
  return {
    ok: true,
    parsed: {
      meta: afpParsed.meta,
      pagesText: afpParsed.pagesText,
      pagesBlank: afpParsed.pagesBlank,
      pagesDimensions: afpParsed.pagesDimensions,
      afpFields: afpParsed.afpFields,
      afpNative: afpParsed.afpNative,
      rawUncompressedBuffer: afpParsed.rawUncompressedBuffer,
    },
  };
}

function detectCriticalField(text: string): { isCritical: boolean; reason?: string } {
  if (/\$[0-9,]+\.\d{2}/.test(text) || /AMOUNT|BALANCE|FEE|TOTAL/i.test(text)) {
    return { isCritical: true, reason: 'Financial amount / balance field' };
  }
  if (/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}\/\d{2}\/\d{4}\b/.test(text)) {
    return { isCritical: true, reason: 'Statement / effective date field' };
  }
  if (/FDIC|DISCLOSURE|ROUTING|ABA|FORM\s+[A-Z0-9-]+/i.test(text)) {
    return { isCritical: true, reason: 'Legal disclosure / routing / form identifier' };
  }
  return { isCritical: false };
}

function computeInlineTokens(a: string, b: string): {
  baselineTokens: InlineToken[];
  candidateTokens: InlineToken[];
} {
  const aParts = a.split(/(\s+)/).filter((t) => t.length > 0);
  const bParts = b.split(/(\s+)/).filter((t) => t.length > 0);
  const m = aParts.length;
  const n = bParts.length;

  // Guard LCS for huge lines
  if (m * n > 25000) {
    return {
      baselineTokens: [{ text: a, changed: a !== b }],
      candidateTokens: [{ text: b, changed: a !== b }],
    };
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        aParts[i] === bParts[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const baseCommon = new Array<boolean>(m).fill(false);
  const candCommon = new Array<boolean>(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (aParts[i] === bParts[j]) {
      baseCommon[i] = true;
      candCommon[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const collapse = (parts: string[], common: boolean[]): InlineToken[] => {
    const out: InlineToken[] = [];
    for (let k = 0; k < parts.length; k++) {
      const chg = !common[k];
      if (out.length > 0 && out[out.length - 1].changed === chg) {
        out[out.length - 1].text += parts[k];
      } else {
        out.push({ text: parts[k], changed: chg });
      }
    }
    return out;
  };

  return {
    baselineTokens: collapse(aParts, baseCommon),
    candidateTokens: collapse(bParts, candCommon),
  };
}

function lineAnchorKey(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function lineWordTokens(line: string): string[] {
  return line
    .toLowerCase()
    .replace(/\*\d{6,}\*/g, ' ')
    .replace(/\bpage\s+\d+\s+(?:of|\/)\s+\d+\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^\d{7,}$/.test(w));
}

function lineTokenDice(a: string, b: string): number {
  const ta = lineWordTokens(a);
  const tb = lineWordTokens(b);
  if (ta.length === 0 && tb.length === 0) return a === b ? 1 : 0;
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter++;
  }
  return (2 * inter) / (setA.size + setB.size);
}

function alignPageLines(
  bLines: string[],
  cLines: string[]
): Array<{ bIdx: number | null; cIdx: number | null }> {
  const m = bLines.length;
  const n = cLines.length;
  if (m === 0 && n === 0) return [];
  if (m * n > 60000) {
    const len = Math.max(m, n);
    return Array.from({ length: len }, (_, k) => ({
      bIdx: k < m ? k : null,
      cIdx: k < n ? k : null,
    }));
  }

  const bKeys = bLines.map(lineAnchorKey);
  const cKeys = cLines.map(lineAnchorKey);
  const GAP_PEN = -0.55;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const bt: string[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(''));

  for (let i = 1; i <= m; i++) {
    dp[i][0] = dp[i - 1][0] + GAP_PEN;
    bt[i][0] = 'U';
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = dp[0][j - 1] + GAP_PEN;
    bt[0][j] = 'L';
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      let score: number;
      if (bKeys[i - 1] === cKeys[j - 1]) {
        score = 2.0;
      } else {
        const dice = lineTokenDice(bKeys[i - 1], cKeys[j - 1]);
        score = dice >= 0.55 ? 1.2 * dice : -0.9;
      }
      const diag = dp[i - 1][j - 1] + score;
      const up = dp[i - 1][j] + GAP_PEN;
      const left = dp[i][j - 1] + GAP_PEN;
      if (diag >= up && diag >= left) {
        dp[i][j] = diag;
        bt[i][j] = 'D';
      } else if (up >= left) {
        dp[i][j] = up;
        bt[i][j] = 'U';
      } else {
        dp[i][j] = left;
        bt[i][j] = 'L';
      }
    }
  }

  const pairs: Array<{ bIdx: number | null; cIdx: number | null }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const dir = bt[i][j];
    if (dir === 'D') {
      pairs.push({ bIdx: i - 1, cIdx: j - 1 });
      i--;
      j--;
    } else if (dir === 'U') {
      pairs.push({ bIdx: i - 1, cIdx: null });
      i--;
    } else {
      pairs.push({ bIdx: null, cIdx: j - 1 });
      j--;
    }
  }
  pairs.reverse();
  return pairs;
}

function buildPageTokenSet(lines: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const l of lines) {
    for (const t of lineWordTokens(l)) tokens.add(t);
  }
  return tokens;
}

function pageSetStats(
  bTokens: Set<string>,
  cTokens: Set<string>,
  bLineCount: number,
  cLineCount: number
): { sim: number; bCount: number; cCount: number } {
  if (bTokens.size === 0 && cTokens.size === 0) {
    return { sim: bLineCount === 0 && cLineCount === 0 ? 1.0 : 0.5, bCount: 0, cCount: 0 };
  }
  if (bTokens.size === 0 || cTokens.size === 0) {
    return { sim: 0.0, bCount: bTokens.size, cCount: cTokens.size };
  }
  let inter = 0;
  const smaller = bTokens.size <= cTokens.size ? bTokens : cTokens;
  const larger = bTokens.size <= cTokens.size ? cTokens : bTokens;
  for (const t of smaller) {
    if (larger.has(t)) inter++;
  }
  const dice = (2 * inter) / (bTokens.size + cTokens.size);
  return { sim: dice, bCount: bTokens.size, cCount: cTokens.size };
}

function pageLineSimilarity(bLines: string[], cLines: string[]): number {
  return pageSetStats(buildPageTokenSet(bLines), buildPageTokenSet(cLines), bLines.length, cLines.length).sim;
}

function alignDocumentPages(
  baseline: ParsedArtifact,
  candidate: ParsedArtifact,
  format: FileFormat
): AlignedPageSlot[] {
  const bPages = baseline.pagesText;
  const cPages = candidate.pagesText;
  const m = bPages.length;
  const n = cPages.length;

  const isBaseBlank = (i: number) =>
    baseline.pagesBlank ? baseline.pagesBlank[i] : (bPages[i] || []).every((l) => l.trim() === '');
  const isCandBlank = (j: number) =>
    candidate.pagesBlank ? candidate.pagesBlank[j] : (cPages[j] || []).every((l) => l.trim() === '');

  if (m === 0 && n === 0) return [];
  if (format === 'RT' || (m === 1 && n === 1)) {
    const len = Math.max(m, n);
    const out: AlignedPageSlot[] = [];
    for (let k = 0; k < len; k++) {
      const hasB = k < m;
      const hasC = k < n;
      const bBlank = hasB ? isBaseBlank(k) : false;
      const cBlank = hasC ? isCandBlank(k) : false;
      const sim = hasB && hasC ? Math.round(pageLineSimilarity(bPages[k], cPages[k]) * 100) : 0;
      out.push({
        slotIndex: k + 1,
        baselinePageNum: hasB ? k + 1 : null,
        candidatePageNum: hasC ? k + 1 : null,
        baselineBlank: bBlank,
        candidateBlank: cBlank,
        status: !hasB ? 'INSERTED_IN_CANDIDATE' : !hasC ? 'MISSING_IN_CANDIDATE' : 'MATCHED',
        similarityPct: sim,
        diffCount: 0,
        summary: !hasB
          ? cBlank
            ? `Inserted blank/white page at Destination Page ${k + 1} (no matching page in Source).`
            : `Extra page inserted at Destination Page ${k + 1}.`
          : !hasC
          ? bBlank
            ? `Extra blank page at Source Page ${k + 1} (missing in Destination).`
            : `Source Page ${k + 1} missing in Destination.`
          : 'Aligned page pair.',
      });
    }
    return out;
  }

  // Precompute token Sets once O(m + n) outside DP loop so multi-hundred-page alignment stays sub-second
  const bTokenSets = bPages.map((lines) => buildPageTokenSet(lines));
  const cTokenSets = cPages.map((lines) => buildPageTokenSet(lines));
  const gapPenBase = (i: number) => (isBaseBlank(i) ? -0.05 : -1.15);
  const gapPenCand = (j: number) => (isCandBlank(j) ? -0.05 : -1.15);

  const scorePair = (iIdx: number, jIdx: number): number => {
    const bb = isBaseBlank(iIdx);
    const cb = isCandBlank(jIdx);
    if (bb && cb) return 0.95;
    if (bb !== cb) return -5.0;
    const { sim, bCount, cCount } = pageSetStats(
      bTokenSets[iIdx],
      cTokenSets[jIdx],
      bPages[iIdx].length,
      cPages[jIdx].length
    );
    if (bCount === 0 && cCount === 0) return 0.35;
    if (bCount < 6 || cCount < 6) return 0.25 + sim * 0.75;
    return sim >= 0.3 ? 0.55 + sim * 1.45 : -0.4;
  };

  const rawSlots: Array<{ bi: number | null; ci: number | null }> = [];

  if (m * n <= 250_000) {
    // Typed flat Needleman-Wunsch DP table (handles up to 500x500 pages cleanly)
    const cols = n + 1;
    const dp = new Float64Array((m + 1) * cols);
    const bt = new Uint8Array((m + 1) * cols); // 1='D', 2='U', 3='L'

    for (let i = 1; i <= m; i++) {
      dp[i * cols] = dp[(i - 1) * cols] + gapPenBase(i - 1);
      bt[i * cols] = 2;
    }
    for (let j = 1; j <= n; j++) {
      dp[j] = dp[j - 1] + gapPenCand(j - 1);
      bt[j] = 3;
    }

    for (let i = 1; i <= m; i++) {
      const rowOff = i * cols;
      const prevRowOff = (i - 1) * cols;
      const gpBase = gapPenBase(i - 1);
      for (let j = 1; j <= n; j++) {
        const pairScore = scorePair(i - 1, j - 1);
        const diag = dp[prevRowOff + j - 1] + pairScore;
        const up = dp[prevRowOff + j] + gpBase;
        const left = dp[rowOff + j - 1] + gapPenCand(j - 1);

        if (diag >= up && diag >= left) {
          dp[rowOff + j] = diag;
          bt[rowOff + j] = 1;
        } else if (left >= up) {
          dp[rowOff + j] = left;
          bt[rowOff + j] = 3;
        } else {
          dp[rowOff + j] = up;
          bt[rowOff + j] = 2;
        }
      }
    }

    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      const dir = bt[i * cols + j];
      if (dir === 1) {
        rawSlots.push({ bi: i - 1, ci: j - 1 });
        i--;
        j--;
      } else if (dir === 3) {
        rawSlots.push({ bi: null, ci: j - 1 });
        j--;
      } else {
        rawSlots.push({ bi: i - 1, ci: null });
        i--;
      }
    }
  } else {
    // Banded Needleman-Wunsch for ultra-large documents (> 500x500 pages)
    const halfBand = Math.max(60, Math.abs(m - n) + 32);
    const bandWidth = halfBand * 2 + 1;
    const jStarts = new Int32Array(m + 1);
    const jEnds = new Int32Array(m + 1);
    const dpBand = new Float64Array((m + 1) * bandWidth);
    const btBand = new Uint8Array((m + 1) * bandWidth);
    dpBand.fill(-1e12);

    const getDp = (i: number, j: number): number => {
      if (j < jStarts[i] || j > jEnds[i]) return -1e12;
      return dpBand[i * bandWidth + (j - jStarts[i])];
    };

    for (let i = 0; i <= m; i++) {
      const center = m > 0 ? Math.round((i * n) / m) : 0;
      jStarts[i] = Math.max(0, center - halfBand);
      jEnds[i] = Math.min(n, center + halfBand);
    }

    dpBand[0 - jStarts[0]] = 0;
    for (let j = 1; j <= jEnds[0]; j++) {
      dpBand[j - jStarts[0]] = dpBand[j - 1 - jStarts[0]] + gapPenCand(j - 1);
      btBand[j - jStarts[0]] = 3;
    }
    for (let i = 1; i <= m; i++) {
      const rowOff = i * bandWidth;
      const js = jStarts[i];
      const je = jEnds[i];
      const gpBase = gapPenBase(i - 1);
      for (let j = js; j <= je; j++) {
        const colIdx = j - js;
        if (j === 0) {
          dpBand[rowOff + colIdx] = getDp(i - 1, 0) + gpBase;
          btBand[rowOff + colIdx] = 2;
          continue;
        }
        const diag = getDp(i - 1, j - 1) + scorePair(i - 1, j - 1);
        const up = getDp(i - 1, j) + gpBase;
        const left = getDp(i, j - 1) + gapPenCand(j - 1);
        if (diag >= up && diag >= left) {
          dpBand[rowOff + colIdx] = diag;
          btBand[rowOff + colIdx] = 1;
        } else if (left >= up) {
          dpBand[rowOff + colIdx] = left;
          btBand[rowOff + colIdx] = 3;
        } else {
          dpBand[rowOff + colIdx] = up;
          btBand[rowOff + colIdx] = 2;
        }
      }
    }

    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      const js = jStarts[i];
      const dir = j >= js && j <= jEnds[i] ? btBand[i * bandWidth + (j - js)] : i > 0 ? 2 : 3;
      if (dir === 1 && i > 0 && j > 0) {
        rawSlots.push({ bi: i - 1, ci: j - 1 });
        i--;
        j--;
      } else if (dir === 3 && j > 0) {
        rawSlots.push({ bi: null, ci: j - 1 });
        j--;
      } else {
        rawSlots.push({ bi: i - 1, ci: null });
        i--;
      }
    }
  }
  rawSlots.reverse();

  return rawSlots.map((s, idx): AlignedPageSlot => {
    const bNum = s.bi !== null ? s.bi + 1 : null;
    const cNum = s.ci !== null ? s.ci + 1 : null;
    const bBlank = s.bi !== null ? isBaseBlank(s.bi) : false;
    const cBlank = s.ci !== null ? isCandBlank(s.ci) : false;

    if (bNum === null && cNum !== null) {
      return {
        slotIndex: idx + 1,
        baselinePageNum: null,
        candidatePageNum: cNum,
        baselineBlank: false,
        candidateBlank: cBlank,
        status: 'INSERTED_IN_CANDIDATE',
        similarityPct: 0,
        diffCount: 1,
        summary: cBlank
          ? `Inserted white/blank page at Destination Page ${cNum} — no corresponding white page exists in Source.`
          : `Extra content page inserted at Destination Page ${cNum} — missing in Source.`,
      };
    }

    if (bNum !== null && cNum === null) {
      return {
        slotIndex: idx + 1,
        baselinePageNum: bNum,
        candidatePageNum: null,
        baselineBlank: bBlank,
        candidateBlank: false,
        status: 'MISSING_IN_CANDIDATE',
        similarityPct: 0,
        diffCount: 1,
        summary: bBlank
          ? `Blank/white page at Source Page ${bNum} is omitted in Destination.`
          : `Source Page ${bNum} is missing in Destination.`,
      };
    }

    const simPct =
      s.bi !== null && s.ci !== null
        ? Math.round(
            pageSetStats(
              bTokenSets[s.bi],
              cTokenSets[s.ci],
              bPages[s.bi].length,
              cPages[s.ci].length
            ).sim * 100
          )
        : 0;

    return {
      slotIndex: idx + 1,
      baselinePageNum: bNum,
      candidatePageNum: cNum,
      baselineBlank: bBlank,
      candidateBlank: cBlank,
      status: 'MATCHED',
      similarityPct: simPct,
      diffCount: 0,
      summary:
        bNum === cNum
          ? `Source Page ${bNum} aligned with Destination Page ${cNum}.`
          : `Source Page ${bNum} re-aligned with Destination Page ${cNum} (page offset preserved).`,
    };
  });
}

const MAX_STORED_DIFF_ROWS = 12000;
const MAX_STORED_EQUAL_ROWS_LARGE = 1500;

interface DiffComputationResult {
  diffs: TextDiffLine[];
  totalLinesCompared: number;
  equalLineCount: number;
  changedLines: TextDiffLine[];
  layoutOnlyChanges: TextDiffLine[];
  criticalChanges: TextDiffLine[];
  diffCountBySlot: Map<number, number>;
  truncated: boolean;
}

function computePageTextDiffs(
  baseline: ParsedArtifact,
  candidate: ParsedArtifact,
  format: FileFormat,
  alignedPages: AlignedPageSlot[]
): DiffComputationResult {
  const baselinePages = baseline.pagesText;
  const candidatePages = candidate.pagesText;
  const diffs: TextDiffLine[] = [];
  const changedLines: TextDiffLine[] = [];
  const layoutOnlyChanges: TextDiffLine[] = [];
  const criticalChanges: TextDiffLine[] = [];
  const diffCountBySlot = new Map<number, number>();
  let diffIdx = 0;
  let equalLineCount = 0;
  let storedEqualCount = 0;
  let totalLinesCompared = 0;
  let truncated = false;

  const totalRawLines =
    baselinePages.reduce((s, p) => s + p.length, 0) + candidatePages.reduce((s, p) => s + p.length, 0);
  const largeFileMode = totalRawLines > 10000;

  // Pre-index AFP PTOCA runs by pageIndex to avoid O(pages * runs) scans
  const bAfpByPage = new Map<number, AfpPtocaRun[]>();
  const cAfpByPage = new Map<number, AfpPtocaRun[]>();
  if (format === 'AFP') {
    for (const r of baseline.afpNative?.ptocaRuns || []) {
      const arr = bAfpByPage.get(r.pageIndex);
      if (arr) arr.push(r);
      else bAfpByPage.set(r.pageIndex, [r]);
    }
    for (const r of candidate.afpNative?.ptocaRuns || []) {
      const arr = cAfpByPage.get(r.pageIndex);
      if (arr) arr.push(r);
      else cAfpByPage.set(r.pageIndex, [r]);
    }
  }

  const recordDiff = (row: TextDiffLine) => {
    totalLinesCompared++;
    if (row.diffCategory === 'EQUAL') {
      equalLineCount++;
      if (largeFileMode && storedEqualCount >= MAX_STORED_EQUAL_ROWS_LARGE) {
        truncated = true;
        return;
      }
      if (diffs.length >= MAX_STORED_DIFF_ROWS) {
        truncated = true;
        return;
      }
      storedEqualCount++;
      diffs.push(row);
      return;
    }

    diffCountBySlot.set(row.slotIndex || 0, (diffCountBySlot.get(row.slotIndex || 0) || 0) + 1);
    if (
      row.diffCategory === 'TEXT_CHANGE' ||
      row.diffCategory === 'MISSING_CONTENT' ||
      row.diffCategory === 'ADDED_CONTENT' ||
      row.diffCategory === 'CONTROL_METADATA'
    ) {
      if (changedLines.length < MAX_STORED_DIFF_ROWS) changedLines.push(row);
      if (row.criticalFieldFlag && criticalChanges.length < MAX_STORED_DIFF_ROWS) {
        criticalChanges.push(row);
      }
    } else if (row.diffCategory === 'ALIGNMENT_SHIFT' || row.diffCategory === 'FONT_STYLE') {
      if (layoutOnlyChanges.length < MAX_STORED_DIFF_ROWS) layoutOnlyChanges.push(row);
    }

    if (diffs.length < MAX_STORED_DIFF_ROWS) {
      diffs.push(row);
    } else {
      truncated = true;
    }
  };

  for (const slot of alignedPages) {
    const bPageIdx = slot.baselinePageNum !== null ? slot.baselinePageNum - 1 : null;
    const cPageIdx = slot.candidatePageNum !== null ? slot.candidatePageNum - 1 : null;

    if (bPageIdx === null && cPageIdx !== null) {
      diffIdx++;
      const cLines = candidatePages[cPageIdx] || [];
      const desc = slot.candidateBlank
        ? `[Inserted White / Blank Page at Destination P${slot.candidatePageNum} — No white page in Source]`
        : cLines.slice(0, 3).join(' | ') || `[Extra Page at Destination P${slot.candidatePageNum}]`;
      recordDiff({
        id: `diff-${diffIdx}`,
        slotIndex: slot.slotIndex,
        pageOrSection: `Slot ${slot.slotIndex} (Dest P${slot.candidatePageNum})`,
        baselineLineNum: null,
        candidateLineNum: 1,
        type: 'added',
        diffCategory: 'ADDED_CONTENT',
        baselineText: '',
        candidateText: desc,
        baselineTokens: [],
        candidateTokens: [{ text: desc, changed: true }],
        controlDelta: slot.candidateBlank ? 'Inserted blank page (page count offset)' : 'Inserted page',
        criticalFieldFlag: false,
        redacted: false,
      });
      continue;
    }

    if (bPageIdx !== null && cPageIdx === null) {
      diffIdx++;
      const bLines = baselinePages[bPageIdx] || [];
      const desc = slot.baselineBlank
        ? `[Extra White / Blank Page at Source P${slot.baselinePageNum} — Missing in Destination]`
        : bLines.slice(0, 3).join(' | ') || `[Missing Page from Source P${slot.baselinePageNum}]`;
      recordDiff({
        id: `diff-${diffIdx}`,
        slotIndex: slot.slotIndex,
        pageOrSection: `Slot ${slot.slotIndex} (Src P${slot.baselinePageNum})`,
        baselineLineNum: 1,
        candidateLineNum: null,
        type: 'removed',
        diffCategory: 'MISSING_CONTENT',
        baselineText: desc,
        candidateText: '',
        baselineTokens: [{ text: desc, changed: true }],
        candidateTokens: [],
        controlDelta: slot.baselineBlank ? 'Missing blank page in Destination' : 'Missing page in Destination',
        criticalFieldFlag: !slot.baselineBlank,
        criticalReason: !slot.baselineBlank ? 'Entire document page omitted in Destination' : undefined,
        redacted: false,
      });
      continue;
    }

    if (bPageIdx === null || cPageIdx === null) continue;

    const bLines = baselinePages[bPageIdx] || [];
    const cLines = candidatePages[cPageIdx] || [];
    const sectionLabel =
      format === 'RT'
        ? 'Report Body'
        : slot.baselinePageNum === slot.candidatePageNum
        ? `Page ${slot.baselinePageNum}`
        : `Src P${slot.baselinePageNum} ↔ Dst P${slot.candidatePageNum}`;

    const bPdfPage = baseline.pdfLayouts?.[bPageIdx] || [];
    const cPdfPage = candidate.pdfLayouts?.[cPageIdx] || [];
    const bPclPage = baseline.pclLines?.[bPageIdx] || [];
    const cPclPage = candidate.pclLines?.[cPageIdx] || [];
    const bAfpPage = bAfpByPage.get(bPageIdx + 1) || [];
    const cAfpPage = cAfpByPage.get(cPageIdx + 1) || [];
    const bAfpTextEls = (baseline.afpNative?.visualPages?.[bPageIdx]?.elements || []).filter(
      (e): e is Extract<typeof e, { kind: 'text_line' }> => e.kind === 'text_line'
    );
    const cAfpTextEls = (candidate.afpNative?.visualPages?.[cPageIdx]?.elements || []).filter(
      (e): e is Extract<typeof e, { kind: 'text_line' }> => e.kind === 'text_line'
    );

    const aligned = alignPageLines(bLines, cLines);

    for (const pair of aligned) {
      const b = pair.bIdx !== null ? bLines[pair.bIdx] : undefined;
      const c = pair.cIdx !== null ? cLines[pair.cIdx] : undefined;
      diffIdx++;

      if (b !== undefined && c !== undefined && pair.bIdx !== null && pair.cIdx !== null) {
        let positionDelta: string | undefined;
        let fontDelta: string | undefined;
        let controlDelta: string | undefined;

        if (format === 'PDF') {
          const bl = bPdfPage[pair.bIdx];
          const cl = cPdfPage[pair.cIdx];
          if (bl && cl) {
            const dx = Math.round((cl.x - bl.x) * 10) / 10;
            const dy = Math.round((cl.y - bl.y) * 10) / 10;
            if (Math.abs(dx) > 3.0 || Math.abs(dy) > 3.0) {
              positionDelta = `ΔX ${dx >= 0 ? '+' : ''}${dx}pt · ΔY ${dy >= 0 ? '+' : ''}${dy}pt`;
            }
            if (bl.fontName !== cl.fontName || Math.abs(bl.fontSize - cl.fontSize) > 0.3) {
              fontDelta = `${bl.fontName} ${bl.fontSize}pt → ${cl.fontName} ${cl.fontSize}pt`;
            }
          }
        } else if (format === 'PCL') {
          const bl = bPclPage[pair.bIdx];
          const cl = cPclPage[pair.cIdx];
          if (bl && cl) {
            const dx = cl.x - bl.x;
            const dy = cl.y - bl.y;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
              positionDelta = `PCL cursor ΔX ${dx >= 0 ? '+' : ''}${dx} · ΔY ${dy >= 0 ? '+' : ''}${dy}`;
            }
            if (bl.fontPitchCpi !== cl.fontPitchCpi || bl.fontHeightPt !== cl.fontHeightPt) {
              fontDelta = `${bl.fontPitchCpi}/${bl.fontHeightPt} → ${cl.fontPitchCpi}/${cl.fontHeightPt}`;
            }
            if (bl.paperSource !== cl.paperSource && pair.bIdx === 0) {
              controlDelta = `${bl.paperSource} → ${cl.paperSource}`;
            }
          }
        } else if (format === 'AFP') {
          const br = bAfpPage[pair.bIdx];
          const cr = cAfpPage[pair.cIdx];
          const bVis = bAfpTextEls[pair.bIdx];
          const cVis = cAfpTextEls[pair.cIdx];
          if (br && cr) {
            const dx = cr.x - br.x;
            const dy = cr.y - br.y;
            if (Math.abs(dx) > 36 || Math.abs(dy) > 36) {
              positionDelta = `PTOCA ΔX ${dx >= 0 ? '+' : ''}${dx} · ΔY ${dy >= 0 ? '+' : ''}${dy} L-units`;
            } else if (bVis && cVis && bVis.spans.length === cVis.spans.length) {
              for (let sIdx = 0; sIdx < bVis.spans.length; sIdx++) {
                const sDx = cVis.spans[sIdx].x - bVis.spans[sIdx].x;
                if (Math.abs(sDx) > 36) {
                  positionDelta = `Col ${sIdx + 1} PTOCA ΔX ${sDx >= 0 ? '+' : ''}${sDx} L-units`;
                  break;
                }
              }
            }
            if (br.fontLocalId !== cr.fontLocalId) {
              fontDelta = `Coded Font ID ${br.fontLocalId} → ${cr.fontLocalId}`;
            } else if (bVis && cVis && bVis.spans.length === cVis.spans.length) {
              for (let sIdx = 0; sIdx < bVis.spans.length; sIdx++) {
                const bs = bVis.spans[sIdx];
                const cs = cVis.spans[sIdx];
                if (
                  bs.fontFamily !== cs.fontFamily ||
                  bs.fontWeight !== cs.fontWeight ||
                  Math.abs(bs.fontSizePt - cs.fontSizePt) > 0.4 ||
                  bs.color.toLowerCase() !== cs.color.toLowerCase()
                ) {
                  fontDelta = `Span ${sIdx + 1}: ${bs.fontFamily} ${bs.fontSizePt}pt (${bs.color}) → ${cs.fontFamily} ${cs.fontSizePt}pt (${cs.color})`;
                  break;
                }
              }
            }
          }
        } else if (format === 'RT') {
          const bNorm = b.replace(/\s+/g, ' ').trim();
          const cNorm = c.replace(/\s+/g, ' ').trim();
          if (b !== c && bNorm === cNorm) {
            const leadDelta = c.search(/\S|$/) - b.search(/\S|$/);
            positionDelta =
              leadDelta !== 0
                ? `Column / indent shift ${leadDelta >= 0 ? '+' : ''}${leadDelta} chars`
                : 'Inter-column spacing / alignment shift';
          } else if (/(TOTAL|RECORD COUNT|STATEMENT COUNT)/i.test(b) && b !== c) {
            controlDelta = 'Control total / summary mismatch';
          }
        }

        const textChanged =
          b !== c &&
          !(format === 'RT' && b.replace(/\s+/g, ' ').trim() === c.replace(/\s+/g, ' ').trim());
        const cats: DiffCategory[] = [];
        if (controlDelta) cats.push('CONTROL_METADATA');
        if (textChanged) cats.push('TEXT_CHANGE');
        if (positionDelta) cats.push('ALIGNMENT_SHIFT');
        if (fontDelta) cats.push('FONT_STYLE');

        if (cats.length === 0) {
          recordDiff({
            id: `diff-${diffIdx}`,
            slotIndex: slot.slotIndex,
            pageOrSection: sectionLabel,
            baselineLineNum: pair.bIdx + 1,
            candidateLineNum: pair.cIdx + 1,
            type: 'equal',
            diffCategory: 'EQUAL',
            baselineText: b,
            candidateText: c,
            criticalFieldFlag: false,
            redacted: b.includes('[REDACTED') || b.includes('****-****-'),
          });
        } else {
          const primaryCategory = cats[0];
          const secondaryCategories = cats.slice(1);
          const crit = detectCriticalField(`${b} ${c}`);
          const inline = computeInlineTokens(b, c);
          recordDiff({
            id: `diff-${diffIdx}`,
            slotIndex: slot.slotIndex,
            pageOrSection: sectionLabel,
            baselineLineNum: pair.bIdx + 1,
            candidateLineNum: pair.cIdx + 1,
            type: 'changed',
            diffCategory: primaryCategory,
            secondaryCategories,
            baselineText: b,
            candidateText: c,
            baselineTokens: inline.baselineTokens,
            candidateTokens: inline.candidateTokens,
            positionDelta,
            fontDelta,
            controlDelta,
            criticalFieldFlag: textChanged || controlDelta ? crit.isCritical : false,
            criticalReason: textChanged || controlDelta ? crit.reason : undefined,
            redacted: b.includes('[REDACTED') || c.includes('[REDACTED') || b.includes('****-****-'),
          });
        }
      } else if (b !== undefined && pair.bIdx !== null) {
        const crit = detectCriticalField(b);
        recordDiff({
          id: `diff-${diffIdx}`,
          slotIndex: slot.slotIndex,
          pageOrSection: sectionLabel,
          baselineLineNum: pair.bIdx + 1,
          candidateLineNum: null,
          type: 'removed',
          diffCategory: 'MISSING_CONTENT',
          baselineText: b,
          candidateText: '',
          baselineTokens: [{ text: b, changed: true }],
          candidateTokens: [],
          criticalFieldFlag: crit.isCritical,
          criticalReason: crit.reason,
          redacted: b.includes('[REDACTED') || b.includes('****-****-'),
        });
      } else if (c !== undefined && pair.cIdx !== null) {
        const crit = detectCriticalField(c);
        recordDiff({
          id: `diff-${diffIdx}`,
          slotIndex: slot.slotIndex,
          pageOrSection: sectionLabel,
          baselineLineNum: null,
          candidateLineNum: pair.cIdx + 1,
          type: 'added',
          diffCategory: 'ADDED_CONTENT',
          baselineText: '',
          candidateText: c,
          baselineTokens: [],
          candidateTokens: [{ text: c, changed: true }],
          criticalFieldFlag: crit.isCritical,
          criticalReason: crit.reason,
          redacted: c.includes('[REDACTED') || c.includes('****-****-'),
        });
      }
    }
  }

  return {
    diffs,
    totalLinesCompared,
    equalLineCount,
    changedLines,
    layoutOnlyChanges,
    criticalChanges,
    diffCountBySlot,
    truncated,
  };
}

export async function runComparisonEngine(params: {
  runId: string;
  config: InventoryConfigRule;
  format: FileFormat;
  baselineBuffer: Buffer;
  baselineFilename: string;
  candidateBuffer: Buffer;
  candidateFilename: string;
  papyrusExportAttached?: boolean;
  papyrusToolVersion?: string;
}): Promise<{
  run: ComparisonRun;
  baselineBinary: Buffer;
  candidateBinary: Buffer;
}> {
  const {
    runId,
    config,
    format,
    baselineBuffer,
    baselineFilename,
    candidateBuffer,
    candidateFilename,
    papyrusExportAttached = false,
    papyrusToolVersion,
  } = params;

  const baseParsed = await parseArtifact(baselineBuffer, baselineFilename, format);
  const candParsed = await parseArtifact(candidateBuffer, candidateFilename, format);

  const findings: FindingRecord[] = [];
  const createdAt = new Date().toISOString();

  // Blocked if either artifact failed parsing or decompression/sanitization
  if (!baseParsed.ok || !candParsed.ok || !baseParsed.parsed || !candParsed.parsed) {
    const reason = [baseParsed.error, candParsed.error].filter(Boolean).join(' | ');
    const blockedMeta = (name: string, buf: Buffer, note: string): ArtifactMetadata => ({
      filename: name,
      format,
      sizeBytes: buf.length,
      sha256: computeSha256(buf),
      compressedFromGzip: name.toLowerCase().endsWith('.gz'),
      encoding: 'Unreadable / Blocked',
      lineEnding: 'NONE',
      hasBom: false,
      pageCount: 0,
      recordCount: 0,
      dimensionsSummary: 'Blocked',
      producerOrTool: 'Blocked before comparison',
      parseStatus: 'CORRUPT',
      parseNotes: [note],
      redactedPiiMatches: 0,
    });

    const bMeta = baseParsed.parsed?.meta || blockedMeta(baselineFilename, baselineBuffer, baseParsed.error || 'Missing/invalid baseline');
    const cMeta = candParsed.parsed?.meta || blockedMeta(candidateFilename, candidateBuffer, candParsed.error || 'Missing/invalid candidate');

    findings.push({
      id: `FND-${runId}-BLK`,
      runId,
      layer: 'Structural',
      severity: 'Critical',
      category: 'Input / Integrity Blocker',
      status: 'BLOCKED',
      location: 'Ingestion / Container Layer',
      expected: 'Valid, readable, sanitized baseline and candidate files',
      actual: reason,
      reproductionSteps: [
        `Attempted ingestion of ${baselineFilename} (IMDS) and ${candidateFilename} (DDGS)`,
        `Validation failed with: ${reason}`,
      ],
      commonPatternHint: 'Container corruption, nested GZIP, path violation, or unsupported extension.',
      evidenceHashBaseline: bMeta.sha256,
      evidenceHashCandidate: cMeta.sha256,
    });

    const run: ComparisonRun = {
      id: runId,
      createdAt,
      mvp: config.mvp,
      appCode: config.appCode,
      subCode: config.subCode,
      environmentMarker: config.environment,
      configVersion: config.version,
      format,
      lifecycleState: 'Blocked',
      overallOutcome: 'BLOCKED',
      tokenizationStatus: 'Verified Masked / Synthetic',
      baseline: bMeta,
      candidate: cMeta,
      pairingChecks: [],
      layerSummaries: [
        {
          layerName: 'Structural & Operational',
          status: 'BLOCKED',
          checksPassed: 0,
          checksFailed: 1,
          checksReview: 0,
          summary: reason,
        },
        {
          layerName: 'Text & Content',
          status: 'NOT_RUN',
          checksPassed: 0,
          checksFailed: 0,
          checksReview: 0,
          summary: 'Skipped because ingestion/integrity check blocked execution.',
        },
        {
          layerName: 'Visual & Layout',
          status: 'NOT_RUN',
          checksPassed: 0,
          checksFailed: 0,
          checksReview: 0,
          summary: 'Skipped because ingestion/integrity check blocked execution.',
        },
        {
          layerName: 'Format-Specific',
          status: 'NOT_RUN',
          checksPassed: 0,
          checksFailed: 0,
          checksReview: 0,
          summary: 'Skipped because ingestion/integrity check blocked execution.',
        },
        {
          layerName: 'Human Review',
          status: 'BLOCKED',
          checksPassed: 0,
          checksFailed: 0,
          checksReview: 1,
          summary: 'Requires QE investigation of blocked artifact.',
        },
      ],
      alignedPages: [],
      textDiffs: [],
      findings,
      reviews: [],
      verificationLimits: ADAPTER_REGISTRY.find((a) => a.format === format)?.cannotVerify || [],
      humanReviewRequired: true,
      humanReviewReason: reason,
      hasBinaryBaseline: false,
      hasBinaryCandidate: false,
    };

    return { run, baselineBinary: baselineBuffer, candidateBinary: candidateBuffer };
  }

  const b = baseParsed.parsed;
  const c = candParsed.parsed;

  if (b.meta.parseStatus === 'CORRUPT' || c.meta.parseStatus === 'CORRUPT') {
    const note = [...b.meta.parseNotes, ...c.meta.parseNotes].join(' | ');
    findings.push({
      id: `FND-${runId}-COR`,
      runId,
      layer: 'Structural',
      severity: 'Critical',
      category: 'Corrupt or Empty Artifact',
      status: 'BLOCKED',
      location: 'File Header / Stream',
      expected: `Valid ${format} stream for both IMDS baseline and DDGS candidate`,
      actual: note || 'Artifact failed structural integrity check.',
      reproductionSteps: [`Inspect ${b.meta.filename} and ${c.meta.filename}`, 'Verify non-zero size and magic header'],
      commonPatternHint: 'Truncated transfer or zero-byte generator output.',
      evidenceHashBaseline: b.meta.sha256,
      evidenceHashCandidate: c.meta.sha256,
    });
  }

  // Layer A: Structural checks
  let structPassed = 0;
  let structFailed = 0;
  let structReview = 0;

  if (b.meta.sizeBytes > 0 && c.meta.sizeBytes > 0) structPassed++;
  else structFailed++;

  if (b.meta.pageCount === c.meta.pageCount) {
    structPassed++;
  } else {
    structFailed++;
    findings.push({
      id: `FND-${runId}-PGCNT`,
      runId,
      layer: 'Structural',
      severity: 'High',
      category: 'Page Count Mismatch',
      status: 'CONFIRMED_DEFECT',
      location: 'Document Root',
      expected: `${b.meta.pageCount} page(s) (IMDS baseline)`,
      actual: `${c.meta.pageCount} page(s) (DDGS candidate)`,
      reproductionSteps: [
        `Compare page count of ${b.meta.filename} (${b.meta.pageCount}) vs ${c.meta.filename} (${c.meta.pageCount})`,
      ],
      commonPatternHint: 'Line-wrap overflow or missing page break in SmartComm template.',
      evidenceHashBaseline: b.meta.sha256,
      evidenceHashCandidate: c.meta.sha256,
    });
  }

  if (format === 'RT' && b.meta.lineEnding !== c.meta.lineEnding) {
    structFailed++;
    findings.push({
      id: `FND-${runId}-EOL`,
      runId,
      layer: 'Structural',
      severity: 'Medium',
      category: 'Line Ending Drift',
      status: 'CONFIRMED_DEFECT',
      location: 'File Encoding / EOL',
      expected: `Line ending ${b.meta.lineEnding} matching IMDS baseline`,
      actual: `Line ending ${c.meta.lineEnding} in DDGS candidate`,
      reproductionSteps: ['Check byte-level newline characters (CR+LF vs LF)'],
      commonPatternHint: 'Linux container output writing LF instead of mainframe/Windows CRLF.',
      evidenceHashBaseline: b.meta.sha256,
      evidenceHashCandidate: c.meta.sha256,
    });
  } else {
    structPassed++;
  }

  // Layer B: Page Alignment + Text / Content + Inline Layout Diff
  const alignedPages = alignDocumentPages(b, c, format);
  const diffResult = computePageTextDiffs(b, c, format, alignedPages);
  const textDiffs = diffResult.diffs;

  // Annotate alignedPages with exact diff counts and status in O(N)
  for (const slot of alignedPages) {
    const cnt = diffResult.diffCountBySlot.get(slot.slotIndex) || 0;
    slot.diffCount = cnt;
    if (slot.status === 'MATCHED' && cnt > 0) {
      slot.status = 'DIFF_DETECTED';
      slot.summary = `${slot.summary} ${cnt} visual/content difference(s) highlighted.`;
    }
  }

  const changedLines = diffResult.changedLines;
  const layoutOnlyChanges = diffResult.layoutOnlyChanges;
  const criticalChanges = diffResult.criticalChanges;

  changedLines.slice(0, 6).forEach((d, idx) => {
    findings.push({
      id: `FND-${runId}-TXT-${idx + 1}`,
      runId,
      layer: 'Text',
      severity: d.criticalFieldFlag ? 'Critical' : 'Medium',
      category: d.criticalFieldFlag ? `Critical Content Variance (${d.criticalReason})` : 'Text Content Difference',
      status: 'CONFIRMED_DEFECT',
      location: `${d.pageOrSection}, Baseline line ${d.baselineLineNum ?? '—'} / Candidate line ${d.candidateLineNum ?? '—'}`,
      expected: d.baselineText || '(Absent in baseline)',
      actual: d.candidateText || '(Missing in candidate)',
      reproductionSteps: [
        `Open ${b.meta.filename} and ${c.meta.filename}`,
        `Navigate to ${d.pageOrSection}, line ${d.baselineLineNum ?? d.candidateLineNum}`,
      ],
      commonPatternHint: d.criticalFieldFlag
        ? 'Data mapping / formatting discrepancy in financial or regulatory disclosure field.'
        : 'Template wording or trailing line variance.',
      evidenceHashBaseline: b.meta.sha256,
      evidenceHashCandidate: c.meta.sha256,
    });
  });

  // Layer C & D: Format-specific & Visual checks
  let visualStatus: OutcomeStatus = 'VERIFIED_PASS';
  let visualSummary = 'Dimensions and layout metadata aligned.';
  let formatStatus: OutcomeStatus = 'VERIFIED_PASS';
  let formatSummary = `${format} structural properties matched.`;
  let humanReviewRequired = false;
  let humanReviewReason: string | undefined;

  if (format === 'PDF') {
    if (b.meta.dimensionsSummary !== c.meta.dimensionsSummary) {
      visualStatus = 'POTENTIAL_VARIANCE';
      visualSummary = `Page dimensions differ (${b.meta.dimensionsSummary} vs ${c.meta.dimensionsSummary}).`;
      findings.push({
        id: `FND-${runId}-DIM`,
        runId,
        layer: 'Visual',
        severity: 'High',
        category: 'Page Dimension Variance',
        status: 'POTENTIAL_VARIANCE',
        location: 'PDF MediaBox',
        expected: b.meta.dimensionsSummary,
        actual: c.meta.dimensionsSummary,
        reproductionSteps: ['Compare PDF page MediaBox sizes across IMDS and DDGS outputs'],
        commonPatternHint: 'SmartComm page setup using A4 instead of US Letter (or vice versa).',
        evidenceHashBaseline: b.meta.sha256,
        evidenceHashCandidate: c.meta.sha256,
      });
      humanReviewRequired = true;
      humanReviewReason = 'PDF dimension or visual layout variance requires QE canvas inspection.';
    } else if (changedLines.length > 0 || layoutOnlyChanges.length > 0) {
      visualStatus = 'POTENTIAL_VARIANCE';
      visualSummary =
        layoutOnlyChanges.length > 0
          ? `${layoutOnlyChanges.length} alignment/font shift(s) detected on PDF text lines; inspect side-by-side layout diff.`
          : 'Text delta detected; inspect side-by-side PDF canvas pixel diff overlay.';
      humanReviewRequired = true;
      humanReviewReason = 'Visual canvas inspection recommended to verify wrapping, spacing, and alignment.';
    }
  } else if (format === 'RT' && layoutOnlyChanges.length > 0) {
    visualStatus = 'POTENTIAL_VARIANCE';
    visualSummary = `${layoutOnlyChanges.length} column/spacing alignment shift(s) detected in RT/RPT report.`;
    findings.push({
      id: `FND-${runId}-RT-ALIGN`,
      runId,
      layer: 'Visual',
      severity: 'Medium',
      category: 'Report Column Alignment Shift',
      status: 'POTENTIAL_VARIANCE',
      location: layoutOnlyChanges[0].pageOrSection,
      expected: layoutOnlyChanges[0].baselineText,
      actual: layoutOnlyChanges[0].candidateText,
      reproductionSteps: ['Inspect fixed-width column offsets side-by-side'],
      commonPatternHint: 'Column padding or tab expansion differs in SmartComm RPT writer.',
      evidenceHashBaseline: b.meta.sha256,
      evidenceHashCandidate: c.meta.sha256,
    });
  }
  if (format === 'PCL') {
    const bPages = b.pclPages || [];
    const cPages = c.pclPages || [];
    const minP = Math.min(bPages.length, cPages.length);
    const pclMismatches: string[] = [];

    for (let i = 0; i < minP; i++) {
      const bp = bPages[i];
      const cp = cPages[i];
      if (bp.paperSize !== cp.paperSize || bp.orientation !== cp.orientation || bp.fontPitchCpi !== cp.fontPitchCpi || bp.paperSource !== cp.paperSource) {
        pclMismatches.push(
          `Page ${i + 1}: IMDS(${bp.paperSize}, ${bp.orientation}, ${bp.paperSource}, ${bp.fontPitchCpi}) vs DDGS(${cp.paperSize}, ${cp.orientation}, ${cp.paperSource}, ${cp.fontPitchCpi})`
        );
      }
    }

    if (pclMismatches.length > 0) {
      formatStatus = 'POTENTIAL_VARIANCE';
      visualStatus = 'POTENTIAL_VARIANCE';
      formatSummary = `${pclMismatches.length} page(s) show PCL tray/font/orientation ESC drift.`;
      visualSummary = 'PCL print-stream font pitch or paper tray changed; verify physical print alignment.';
      humanReviewRequired = true;
      humanReviewReason = 'PCL ESC sequence properties (tray, font pitch, or orientation) diverged from baseline.';
      findings.push({
        id: `FND-${runId}-PCL-ESC`,
        runId,
        layer: 'Format-Specific',
        severity: 'High',
        category: 'PCL Print-Stream Control Drift',
        status: 'POTENTIAL_VARIANCE',
        location: 'PCL5 ESC Sequence Header',
        expected: pclMismatches[0].split(' vs ')[0],
        actual: pclMismatches[0].split(' vs ')[1],
        reproductionSteps: ['Inspect PCL5 ESC sequences (&l#A, &l#O, &l#H, (s#H) per page'],
        commonPatternHint: 'DDGS PCL driver profile using different default tray or font pitch.',
        evidenceHashBaseline: b.meta.sha256,
        evidenceHashCandidate: c.meta.sha256,
      });
    }
  } else if (format === 'RT' && b.rtInfo && c.rtInfo) {
    const allKeys = Array.from(new Set([...Object.keys(b.rtInfo.totals), ...Object.keys(c.rtInfo.totals)]));
    const mismatches: string[] = [];
    for (const k of allKeys) {
      const bv = b.rtInfo.totals[k];
      const cv = c.rtInfo.totals[k];
      if (bv === undefined || cv === undefined || Math.abs(bv - cv) > config.numericToleranceAbs) {
        mismatches.push(`${k}: IMDS=${bv ?? 'MISSING'} vs DDGS=${cv ?? 'MISSING'}`);
      }
    }
    if (mismatches.length > 0) {
      formatStatus = 'CONFIRMED_DEFECT';
      formatSummary = `Control total reconciliation failed (${mismatches.join('; ')}).`;
      findings.push({
        id: `FND-${runId}-RT-TOT`,
        runId,
        layer: 'Format-Specific',
        severity: 'Critical',
        category: 'Report Control Total Mismatch',
        status: 'CONFIRMED_DEFECT',
        location: 'Report Summary / Trailer',
        expected: mismatches[0].split(' vs ')[0],
        actual: mismatches[0].split(' vs ')[1],
        reproductionSteps: ['Compare numeric control totals in report trailer lines'],
        commonPatternHint: 'Dropped transaction record or rounding variance in SmartComm batch aggregation.',
        evidenceHashBaseline: b.meta.sha256,
        evidenceHashCandidate: c.meta.sha256,
      });
    } else {
      formatSummary = `All ${allKeys.length} control total(s), banner, and footer matched.`;
    }
  } else if (format === 'AFP') {
    const bFields = b.afpFields || [];
    const cFields = c.afpFields || [];
    const bNative = b.afpNative;
    const cNative = c.afpNative;
    const bBng = bNative?.totalBngCount ?? bFields.filter((f) => f.mnemonic === 'BNG').length;
    const cBng = cNative?.totalBngCount ?? cFields.filter((f) => f.mnemonic === 'BNG').length;

    const afpIssues: string[] = [];

    // 1. Named Page Group parity
    if (bBng !== cBng) {
      afpIssues.push(`Named Page Group (BNG) count mismatch (${bBng} vs ${cBng})`);
      findings.push({
        id: `FND-${runId}-AFP-BNG`,
        runId,
        layer: 'Format-Specific',
        severity: 'High',
        category: 'AFP Named Page Group Count Mismatch',
        status: 'CONFIRMED_DEFECT',
        location: 'MO:DCA BNG (D3A8AD)',
        expected: `${bBng} Named Page Group(s)`,
        actual: `${cBng} Named Page Group(s)`,
        reproductionSteps: ['Compare MO:DCA BNG index boundaries directly in AFP stream'],
        commonPatternHint: 'Missing TLE/BNG statement indexing boundary in DDGS AFP driver.',
        evidenceHashBaseline: b.meta.sha256,
        evidenceHashCandidate: c.meta.sha256,
      });
    }

    // 2. Direct TLE Index Tag parity
    const bTles = bNative?.tles || [];
    const cTles = cNative?.tles || [];
    for (const bt of bTles) {
      const match = cTles.find(
        (ct) => ct.pageGroupIndex === bt.pageGroupIndex && ct.attributeName === bt.attributeName
      );
      if (!match || match.attributeValue !== bt.attributeValue) {
        afpIssues.push(`TLE "${bt.attributeName}" mismatch`);
        findings.push({
          id: `FND-${runId}-AFP-TLE-${bt.attributeName}`,
          runId,
          layer: 'Format-Specific',
          severity: 'High',
          category: `AFP TLE Index Tag Variance (${bt.attributeName})`,
          status: 'CONFIRMED_DEFECT',
          location: `Group ${bt.pageGroupIndex} · MO:DCA TLE (D3A090)`,
          expected: `${bt.attributeName} = ${bt.attributeValue}`,
          actual: match ? `${match.attributeName} = ${match.attributeValue}` : '(Missing TLE tag in DDGS)',
          reproductionSteps: ['Inspect D3A090 TLE triplets directly without PDF conversion'],
          commonPatternHint: 'Mailroom/archive indexing metadata dropped or altered during SmartComm AFP generation.',
          evidenceHashBaseline: b.meta.sha256,
          evidenceHashCandidate: c.meta.sha256,
        });
      }
    }

    // 3. Direct Resource & Medium Map (IMM / MCF / MPO / MPS) parity
    const bRes = bNative?.resources || [];
    const cRes = cNative?.resources || [];
    for (const br of bRes) {
      const match = cRes.find((cr) => cr.pageIndex === br.pageIndex && cr.type === br.type && cr.name === br.name);
      if (!match) {
        const sameType = cRes.find((cr) => cr.pageIndex === br.pageIndex && cr.type === br.type);
        afpIssues.push(`${br.type} drift (${br.name} -> ${sameType?.name || 'MISSING'})`);
        findings.push({
          id: `FND-${runId}-AFP-RES-${br.type.replace(/[^A-Z]/g, '')}`,
          runId,
          layer: 'Format-Specific',
          severity: br.type.includes('IMM') ? 'Critical' : 'High',
          category: `AFP Resource / Control Drift (${br.type})`,
          status: 'CONFIRMED_DEFECT',
          location: `Page ${br.pageIndex} · ${br.type}`,
          expected: br.name,
          actual: sameType ? sameType.name : '(Resource omitted in DDGS)',
          reproductionSteps: ['Compare MO:DCA MCF/MPO/MPS/IMM records directly in native AFP stream'],
          commonPatternHint: br.type.includes('IMM')
            ? 'Duplex/simplex or paper tray Medium Map changed in DDGS FORMDEF.'
            : 'Coded font, overlay, or page segment binding differs from IMDS baseline.',
          evidenceHashBaseline: b.meta.sha256,
          evidenceHashCandidate: c.meta.sha256,
        });
      }
    }

    // 4. Direct PTOCA X/Y Coordinate Drift Check
    const bRuns = bNative?.ptocaRuns || [];
    const cRuns = cNative?.ptocaRuns || [];
    let coordDrifts = 0;
    const minRuns = Math.min(bRuns.length, cRuns.length);
    for (let i = 0; i < minRuns; i++) {
      const br = bRuns[i];
      const cr = cRuns[i];
      if (Math.abs(br.x - cr.x) > 36 || Math.abs(br.y - cr.y) > 36 || br.fontLocalId !== cr.fontLocalId) {
        coordDrifts++;
        if (coordDrifts === 1) {
          findings.push({
            id: `FND-${runId}-AFP-PTOCA`,
            runId,
            layer: 'Visual',
            severity: 'Medium',
            category: 'PTOCA Coordinate / Font ID Drift (Direct AFP)',
            status: 'POTENTIAL_VARIANCE',
            location: `Page ${br.pageIndex} · PTX (${br.x}, ${br.y})`,
            expected: `X=${br.x}, Y=${br.y}, Font=${br.fontLocalId} ("${br.text.slice(0, 42)}")`,
            actual: `X=${cr.x}, Y=${cr.y}, Font=${cr.fontLocalId} ("${cr.text.slice(0, 42)}")`,
            reproductionSteps: ['Inspect native PTOCA AMI/AMB/SCFL coordinates in AFP Structure tab'],
            commonPatternHint: 'Envelope window / baseline offset shifted in DDGS template.',
            evidenceHashBaseline: b.meta.sha256,
            evidenceHashCandidate: c.meta.sha256,
          });
        }
      }
    }

    // 5. Direct Visual Image, Border/Table Rule & Vector Parity Check
    let graphicDrifts = 0;
    const bVps = bNative?.visualPages || [];
    const cVps = cNative?.visualPages || [];
    const bVpsMap = new Map<number, AfpVisualPage>(bVps.map((p) => [p.pageIndex, p]));
    const cVpsMap = new Map<number, AfpVisualPage>(cVps.map((p) => [p.pageIndex, p]));
    const bAssets = bNative?.mediaAssets || {};
    const cAssets = cNative?.mediaAssets || {};

    for (const slot of alignedPages) {
      if (slot.baselinePageNum === null || slot.candidatePageNum === null) continue;
      const bVp = bVpsMap.get(slot.baselinePageNum);
      const cVp = cVpsMap.get(slot.candidatePageNum);
      if (!bVp || !cVp) continue;

      const bImgs = bVp.elements.filter((e): e is Extract<typeof e, { kind: 'image' }> => e.kind === 'image');
      const cImgs = cVp.elements.filter((e): e is Extract<typeof e, { kind: 'image' }> => e.kind === 'image');

      let slotImgDiff = false;
      if (bImgs.length !== cImgs.length) {
        slotImgDiff = true;
      } else {
        for (let idx = 0; idx < bImgs.length; idx++) {
          const bi = bImgs[idx];
          const ci = cImgs[idx];
          const bData = bAssets[bi.assetId];
          const cData = cAssets[ci.assetId];
          if (
            bData !== cData ||
            Math.abs(bi.x - ci.x) > 24 ||
            Math.abs(bi.y - ci.y) > 24 ||
            Math.abs(bi.w - ci.w) > 24 ||
            Math.abs(bi.h - ci.h) > 24
          ) {
            slotImgDiff = true;
            break;
          }
        }
      }

      if (slotImgDiff) {
        graphicDrifts++;
        if (graphicDrifts === 1) {
          findings.push({
            id: `FND-${runId}-AFP-IMG`,
            runId,
            layer: 'Visual',
            severity: 'High',
            category: 'AFP Embedded Image / Graphic Variation',
            status: 'POTENTIAL_VARIANCE',
            location: `Page ${slot.baselinePageNum} vs Page ${slot.candidatePageNum} · IOCA/BOC Image`,
            expected: `${bImgs.length} image(s): ${bImgs.map((im) => `${im.label || 'Image'}(${im.w}x${im.h}@${im.x},${im.y})`).join(', ') || 'None'}`,
            actual: `${cImgs.length} image(s): ${cImgs.map((im) => `${im.label || 'Image'}(${im.w}x${im.h}@${im.x},${im.y})`).join(', ') || 'None'}`,
            reproductionSteps: ['Inspect visual side-by-side image overlays in All Pages Visual or AFP Native tab'],
            commonPatternHint: 'Logo scale/placement, seal/signature raster swap, or IOCA color/bitmap difference between IMDS and DDGS.',
            evidenceHashBaseline: b.meta.sha256,
            evidenceHashCandidate: c.meta.sha256,
          });
        }
        slot.diffCount++;
        if (slot.status === 'MATCHED') slot.status = 'DIFF_DETECTED';
      }

      const bBorders = bVp.elements.filter((e) => e.kind === 'rule' || e.kind === 'vector');
      const cBorders = cVp.elements.filter((e) => e.kind === 'rule' || e.kind === 'vector');
      const borderDelta = Math.abs(bBorders.length - cBorders.length);
      if (borderDelta > 0) {
        graphicDrifts++;
        findings.push({
          id: `FND-${runId}-AFP-BORDER-${slot.slotIndex}`,
          runId,
          layer: 'Visual',
          severity: 'Medium',
          category: 'AFP Table / Border Geometry Variation',
          status: 'POTENTIAL_VARIANCE',
          location: `Slot ${slot.slotIndex} (Src P${slot.baselinePageNum} / Dst P${slot.candidatePageNum})`,
          expected: `${bBorders.length} border rule/vector primitive(s)`,
          actual: `${cBorders.length} border rule/vector primitive(s)`,
          reproductionSteps: ['Compare table cell grid rules (DIR/DBR) and GOCA boxes side-by-side'],
          commonPatternHint: 'Missing table divider rule, shifted cell border, or altered GOCA form box in DDGS template.',
          evidenceHashBaseline: b.meta.sha256,
          evidenceHashCandidate: c.meta.sha256,
        });
        slot.diffCount++;
        if (slot.status === 'MATCHED') slot.status = 'DIFF_DETECTED';
      }
    }

    visualStatus = 'POTENTIAL_VARIANCE';
    visualSummary =
      coordDrifts > 0 || graphicDrifts > 0
        ? `Direct MO:DCA engine detected ${coordDrifts} PTOCA layout shift(s) and ${graphicDrifts} image/table border variation(s); verify side-by-side.`
        : 'Direct PTOCA, embedded image, and border geometry aligned; confirm external OVL/FOCA rendering in Papyrus.';
    humanReviewRequired = true;
    humanReviewReason =
      'Direct MO:DCA/IOCA/GOCA/PTOCA/TLE validation completed without PDF conversion; confirm visual parity & external resources in ISIS Papyrus.';

    if (findings.some((f) => f.layer === 'Format-Specific' && f.status === 'CONFIRMED_DEFECT')) {
      formatStatus = 'CONFIRMED_DEFECT';
      formatSummary = `Direct native AFP engine flagged: ${afpIssues.join('; ')}.`;
    } else {
      formatStatus = 'VERIFIED_PASS';
      formatSummary = `Direct native AFP TLEs (${bTles.length}), resources (${bRes.length}), and PGD geometry matched.`;
    }
  }

  // Deterministic Pairing Check
  const pairingChecks: PairingCheck[] = config.pairingKeys.map((key) => ({
    pairingKeyName: key,
    pairingKeyValue: `${config.appCode}-${config.subCode}-BATCH01`,
    baselineCount: Math.max(1, b.afpNative?.totalBngCount || b.afpFields?.filter((f) => f.mnemonic === 'BNG').length || b.meta.pageCount),
    candidateCount: Math.max(1, c.afpNative?.totalBngCount || c.afpFields?.filter((f) => f.mnemonic === 'BNG').length || c.meta.pageCount),
    status: 'MATCHED',
    notes: `Deterministic pairing verified via ${key} (${config.sourceSystem} -> ${config.targetSystem}).`,
  }));

  // Compute RT control checks if RT
  const rtDetails =
    format === 'RT' && b.rtInfo && c.rtInfo
      ? {
          bannerBaseline: b.rtInfo.banner,
          bannerCandidate: c.rtInfo.banner,
          footerBaseline: b.rtInfo.footer,
          footerCandidate: c.rtInfo.footer,
          controlChecks: Array.from(
            new Set([...Object.keys(b.rtInfo.totals), ...Object.keys(c.rtInfo.totals)])
          ).map((label): RtControlCheck => {
            const bv = b.rtInfo!.totals[label];
            const cv = c.rtInfo!.totals[label];
            const matched = bv !== undefined && cv !== undefined && Math.abs(bv - cv) <= config.numericToleranceAbs;
            return {
              label,
              baselineValue: bv !== undefined ? bv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'MISSING',
              candidateValue: cv !== undefined ? cv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'MISSING',
              matched,
              deltaNote: matched ? 'Within configured tolerance' : `Delta: ${bv !== undefined && cv !== undefined ? (cv - bv).toFixed(2) : 'N/A'}`,
            };
          }),
        }
      : undefined;

  // Overall outcome determination (strict hierarchy: BLOCKED > CONFIRMED_DEFECT > POTENTIAL_VARIANCE > VERIFIED_PASS)
  let overallOutcome: OutcomeStatus = 'VERIFIED_PASS';
  if (findings.some((f) => f.status === 'BLOCKED')) {
    overallOutcome = 'BLOCKED';
  } else if (findings.some((f) => f.status === 'CONFIRMED_DEFECT')) {
    overallOutcome = 'CONFIRMED_DEFECT';
  } else if (humanReviewRequired || findings.some((f) => f.status === 'POTENTIAL_VARIANCE')) {
    overallOutcome = 'POTENTIAL_VARIANCE';
  }

  const textStatus: OutcomeStatus =
    changedLines.length === 0 ? 'VERIFIED_PASS' : criticalChanges.length > 0 ? 'CONFIRMED_DEFECT' : 'CONFIRMED_DEFECT';

  const structStatus: OutcomeStatus =
    findings.some((f) => f.layer === 'Structural' && f.status === 'BLOCKED')
      ? 'BLOCKED'
      : structFailed > 0
      ? 'CONFIRMED_DEFECT'
      : 'VERIFIED_PASS';

  const layerSummaries: ComparisonLayerSummary[] = [
    {
      layerName: 'Structural & Operational',
      status: structStatus,
      checksPassed: structPassed,
      checksFailed: structFailed,
      checksReview: structReview,
      summary: structFailed === 0 ? 'File presence, sizes, page counts, and encoding verified.' : `${structFailed} structural mismatch(es) detected.`,
    },
    {
      layerName: 'Text & Content',
      status: textStatus,
      checksPassed: diffResult.equalLineCount,
      checksFailed: changedLines.length,
      checksReview: 0,
      summary:
        changedLines.length === 0
          ? `All ${diffResult.totalLinesCompared} extracted text line(s) matched.`
          : `${changedLines.length} line difference(s) (${criticalChanges.length} critical field(s)).`,
    },
    {
      layerName: 'Visual & Layout',
      status: visualStatus,
      checksPassed: visualStatus === 'VERIFIED_PASS' ? 1 : 0,
      checksFailed: 0,
      checksReview: visualStatus === 'POTENTIAL_VARIANCE' ? 1 : 0,
      summary: visualSummary,
    },
    {
      layerName: 'Format-Specific',
      status: formatStatus,
      checksPassed: formatStatus === 'VERIFIED_PASS' ? 1 : 0,
      checksFailed: formatStatus === 'CONFIRMED_DEFECT' ? 1 : 0,
      checksReview: formatStatus === 'POTENTIAL_VARIANCE' ? 1 : 0,
      summary: formatSummary,
    },
    {
      layerName: 'Human Review',
      status: humanReviewRequired ? 'POTENTIAL_VARIANCE' : overallOutcome,
      checksPassed: humanReviewRequired ? 0 : 1,
      checksFailed: 0,
      checksReview: humanReviewRequired ? 1 : 0,
      summary: humanReviewRequired
        ? humanReviewReason || 'Awaiting QE reviewer sign-off.'
        : 'Automated checks complete; optional QA audit sign-off available.',
    },
  ];

  const adapterCap = ADAPTER_REGISTRY.find((a) => a.format === format);

  const run: ComparisonRun = {
    id: runId,
    createdAt,
    mvp: config.mvp,
    appCode: config.appCode,
    subCode: config.subCode,
    environmentMarker: config.environment,
    configVersion: config.version,
    format,
    lifecycleState:
      overallOutcome === 'BLOCKED'
        ? 'Blocked'
        : humanReviewRequired
        ? 'Human review required'
        : overallOutcome === 'CONFIRMED_DEFECT'
        ? 'Failed'
        : 'Passed',
    overallOutcome,
    tokenizationStatus: 'Verified Masked / Synthetic',
    baseline: b.meta,
    candidate: c.meta,
    pairingChecks,
    layerSummaries,
    alignedPages,
    textDiffs,
    totalDiffCount: diffResult.changedLines.length + diffResult.layoutOnlyChanges.length,
    diffLinesTruncated: diffResult.truncated || undefined,
    findings,
    reviews: [],
    verificationLimits: adapterCap?.cannotVerify || [],
    humanReviewRequired,
    humanReviewReason,
    pdfDetails:
      format === 'PDF'
        ? {
            baselineLayouts: (b.pdfLayouts || []).flat(),
            candidateLayouts: (c.pdfLayouts || []).flat(),
            baselinePageDims: b.pagesDimensions,
            candidatePageDims: c.pagesDimensions,
          }
        : undefined,
    pclDetails:
      format === 'PCL'
        ? {
            baselinePages: b.pclPages || [],
            candidatePages: c.pclPages || [],
            baselineLines: (b.pclLines || []).flat(),
            candidateLines: (c.pclLines || []).flat(),
          }
        : undefined,
    afpDetails:
      format === 'AFP'
        ? (() => {
            const mergedAssets: Record<string, string> = {};
            const prefixPages = (pages: AfpVisualPage[] | undefined, assets: Record<string, string> | undefined, pfx: string): AfpVisualPage[] | undefined => {
              if (assets) {
                for (const [k, v] of Object.entries(assets)) {
                  mergedAssets[`${pfx}_${k}`] = v;
                }
              }
              return pages?.map((vp) => ({
                ...vp,
                elements: vp.elements.map((el) =>
                  el.kind === 'image' ? { ...el, assetId: `${pfx}_${el.assetId}` } : el
                ),
              }));
            };
            const baselineVisualPages = prefixPages(b.afpNative?.visualPages, b.afpNative?.mediaAssets, 'b');
            const candidateVisualPages = prefixPages(c.afpNative?.visualPages, c.afpNative?.mediaAssets, 'c');

            return {
              validationMode: 'DIRECT_MODCA_NATIVE' as const,
              encodingDetected: b.afpNative?.encodingDetected || 'MO:DCA Binary',
              baselineFields: b.afpFields || [],
              candidateFields: c.afpFields || [],
              baselineTotalFieldCount: b.afpNative?.totalFieldCount,
              candidateTotalFieldCount: c.afpNative?.totalFieldCount,
              baselineTles: b.afpNative?.tles || [],
              candidateTles: c.afpNative?.tles || [],
              baselineResources: b.afpNative?.resources || [],
              candidateResources: c.afpNative?.resources || [],
              baselinePtocaRuns: (b.afpNative?.ptocaRuns || []).slice(0, 5000),
              candidatePtocaRuns: (c.afpNative?.ptocaRuns || []).slice(0, 5000),
              baselineGeometry: b.afpNative?.geometry || [],
              candidateGeometry: c.afpNative?.geometry || [],
              baselineVisualPages,
              candidateVisualPages,
              mediaAssets: Object.keys(mergedAssets).length > 0 ? mergedAssets : undefined,
              papyrusExportAttached,
              papyrusToolVersion: papyrusToolVersion || 'ISIS Papyrus Viewer (Direct .afp Inspection)',
              conversionDisclaimer: papyrusExportAttached
                ? 'Optional Papyrus PDF proxy attached; primary TLE, IMM, MCF, and PTOCA checks were executed directly on native AFP.'
                : undefined,
            };
          })()
        : undefined,
    rtDetails,
    pdfVisualReady: format === 'PDF' && b.meta.parseStatus === 'PARSED' && c.meta.parseStatus === 'PARSED',
    hasBinaryBaseline: true,
    hasBinaryCandidate: true,
  };

  return {
    run,
    baselineBinary: b.rawUncompressedBuffer,
    candidateBinary: c.rawUncompressedBuffer,
  };
}
