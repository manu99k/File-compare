import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFEmbeddedPage, type RGB } from 'pdf-lib';
import type { StoredRunRecord } from './fixtures.ts';
import type { AfpVisualPage, AlignedPageSlot, ComparisonRun, DiffCategory, PdfLineLayout, TextDiffLine } from '../src/types/qe.ts';
import { encodeCode39Bars } from '../src/lib/barcode.ts';

const MAX_PDF_VISUAL_SHEETS = 120;
const MAX_HTML_VISUAL_CARDS = 200;

function selectVisualSlotsForExport(slots: AlignedPageSlot[], cap: number): { selected: AlignedPageSlot[]; truncated: boolean } {
  if (slots.length <= cap) return { selected: slots, truncated: false };
  const selectedIdx = new Set<number>();
  for (let i = 0; i < slots.length && selectedIdx.size < cap; i++) {
    if (slots[i].status !== 'MATCHED') selectedIdx.add(i);
  }
  for (let i = 0; i < slots.length && selectedIdx.size < cap; i++) {
    selectedIdx.add(i);
  }
  const selected = Array.from(selectedIdx)
    .sort((a, b) => a - b)
    .map((idx) => slots[idx]);
  return { selected, truncated: true };
}

function groupDiffsBySlot(textDiffs: TextDiffLine[]): {
  nonEqualBySlot: Map<number, TextDiffLine[]>;
  allBySlot: Map<number, TextDiffLine[]>;
} {
  const nonEqualBySlot = new Map<number, TextDiffLine[]>();
  const allBySlot = new Map<number, TextDiffLine[]>();
  for (const d of textDiffs) {
    const slotKey = d.slotIndex ?? 1;
    let allArr = allBySlot.get(slotKey);
    if (!allArr) {
      allArr = [];
      allBySlot.set(slotKey, allArr);
    }
    allArr.push(d);
    if (d.diffCategory !== 'EQUAL') {
      let neArr = nonEqualBySlot.get(slotKey);
      if (!neArr) {
        neArr = [];
        nonEqualBySlot.set(slotKey, neArr);
      }
      neArr.push(d);
    }
  }
  return { nonEqualBySlot, allBySlot };
}

function groupLayoutsByPage(layouts: PdfLineLayout[] | undefined): Map<number, PdfLineLayout[]> {
  const map = new Map<number, PdfLineLayout[]>();
  if (!layouts) return map;
  for (const l of layouts) {
    let arr = map.get(l.page);
    if (!arr) {
      arr = [];
      map.set(l.page, arr);
    }
    arr.push(l);
  }
  return map;
}

function indexVisualPages(pages: AfpVisualPage[] | undefined): Map<number, AfpVisualPage> {
  const map = new Map<number, AfpVisualPage>();
  if (!pages) return map;
  for (const p of pages) {
    map.set(p.pageIndex, p);
  }
  return map;
}

function categoryRgb(cat: DiffCategory): { stroke: RGB; fill: RGB; hex: string; bgHex: string; label: string } {
  switch (cat) {
    case 'TEXT_CHANGE':
      return { stroke: rgb(0.86, 0.15, 0.15), fill: rgb(0.99, 0.89, 0.89), hex: '#DC2626', bgHex: '#FEE2E2', label: 'Text Change' };
    case 'ALIGNMENT_SHIFT':
      return { stroke: rgb(0.15, 0.39, 0.92), fill: rgb(0.86, 0.92, 1.0), hex: '#2563EB', bgHex: '#DBEAFE', label: 'Alignment Shift' };
    case 'FONT_STYLE':
      return { stroke: rgb(0.49, 0.23, 0.93), fill: rgb(0.93, 0.90, 0.99), hex: '#7C3AED', bgHex: '#EDE9FE', label: 'Font / Style' };
    case 'MISSING_CONTENT':
      return { stroke: rgb(0.75, 0.07, 0.24), fill: rgb(1.0, 0.89, 0.91), hex: '#BE123C', bgHex: '#FFE4E6', label: 'Missing Content' };
    case 'ADDED_CONTENT':
      return { stroke: rgb(0.05, 0.58, 0.53), fill: rgb(0.80, 0.98, 0.94), hex: '#0D9488', bgHex: '#CCFBF1', label: 'Added / Inserted' };
    case 'CONTROL_METADATA':
      return { stroke: rgb(0.85, 0.47, 0.02), fill: rgb(1.0, 0.95, 0.78), hex: '#D97706', bgHex: '#FEF3C7', label: 'Control / Total' };
    default:
      return { stroke: rgb(0.39, 0.45, 0.55), fill: rgb(0.95, 0.96, 0.98), hex: '#64748B', bgHex: '#F1F5F9', label: 'Matched' };
  }
}

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizePdfText(s: string, maxLen = 150): string {
  return (s || '').replace(/[^\x20-\x7e]/g, ' ').slice(0, maxLen);
}

async function embedMediaAssetsForPdf(
  reportDoc: PDFDocument,
  mediaAssets?: Record<string, string>
): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  if (!mediaAssets) return out;
  for (const [id, uri] of Object.entries(mediaAssets)) {
    try {
      const m = uri.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
      if (!m) continue;
      const bytes = Buffer.from(m[2], 'base64');
      const img = m[1].toLowerCase() === 'png' ? await reportDoc.embedPng(bytes) : await reportDoc.embedJpg(bytes);
      out.set(id, img);
    } catch {
      // skip corrupt/unsupported asset
    }
  }
  return out;
}

function parseHexRgb(hex: string | undefined, fallback = rgb(0.06, 0.09, 0.16)): RGB {
  if (!hex) return fallback;
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return fallback;
  const v = parseInt(m[1], 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function drawAfpVisualPageOnPdf(params: {
  sheet: ReturnType<PDFDocument['addPage']>;
  vp: AfpVisualPage;
  ox: number;
  oy: number; // bottom-left Y in pdf-lib coordinates
  drawW: number;
  drawH: number;
  embeddedAssets: Map<string, PDFImage>;
  fonts: {
    sansReg: PDFFont;
    sansBold: PDFFont;
    sansItal: PDFFont;
    serifReg: PDFFont;
    serifBold: PDFFont;
    monoReg: PDFFont;
    monoBold: PDFFont;
  };
  slotDiffs: TextDiffLine[];
  side: 'baseline' | 'candidate';
}) {
  const { sheet, vp, ox, oy, drawW, drawH, embeddedAssets, fonts, slotDiffs, side } = params;
  const sx = drawW / Math.max(1, vp.widthUnits);
  const sy = drawH / Math.max(1, vp.heightUnits);
  const topY = oy + drawH;

  // Build line -> diff badge map
  const lineDiffMap = new Map<number, { idx: number; cat: DiffCategory }>();
  slotDiffs.forEach((d, i) => {
    const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
    if (ln !== null && !lineDiffMap.has(ln)) {
      lineDiffMap.set(ln, { idx: i + 1, cat: d.diffCategory });
    }
  });

  // 1. Rules & Vectors
  for (const el of vp.elements) {
    if (el.kind === 'rule') {
      const rx = ox + el.x * sx;
      const rw = Math.max(0.5, el.w * sx);
      const rh = Math.max(0.6, el.h * sy);
      const ry = topY - el.y * sy - rh;
      sheet.drawRectangle({ x: rx, y: ry, width: rw, height: rh, color: parseHexRgb(el.color) });
    } else if (el.kind === 'vector') {
      const vx = ox + el.x * sx;
      const vyTop = topY - el.y * sy;
      const vScale = Math.min((el.w * sx) / Math.max(1, el.viewW), (el.h * sy) / Math.max(1, el.viewH));
      for (const p of el.paths) {
        try {
          sheet.drawSvgPath(p.d, {
            x: vx,
            y: vyTop,
            scale: vScale,
            color: p.fill && p.fill !== 'none' ? parseHexRgb(p.fill) : undefined,
            borderColor: p.stroke && p.stroke !== 'none' ? parseHexRgb(p.stroke) : undefined,
            borderWidth: Math.max(0.4, (p.strokeWidth || 1.5) * vScale),
          });
        } catch {
          // fallback skip unsupported svg command
        }
      }
    } else if (el.kind === 'external_ref') {
      const rx = ox + el.x * sx;
      const rw = Math.max(40, el.w * sx);
      const rh = Math.max(18, el.h * sy);
      const ry = topY - el.y * sy - rh;
      sheet.drawRectangle({
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        color: rgb(0.97, 0.98, 1),
        borderColor: rgb(0.58, 0.64, 0.72),
        borderWidth: 0.7,
      });
      sheet.drawText(sanitizePdfText(`[${el.resType}: ${el.name}]`, 32), {
        x: rx + 4,
        y: ry + rh / 2 - 3,
        size: 6.5,
        font: fonts.monoReg,
        color: rgb(0.28, 0.33, 0.41),
      });
    } else if (el.kind === 'image') {
      const img = embeddedAssets.get(el.assetId);
      if (img) {
        const iw = Math.max(8, el.w * sx);
        const ih = Math.max(8, el.h * sy);
        const ix = ox + el.x * sx;
        const iy = topY - el.y * sy - ih;
        sheet.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
      }
    } else if (el.kind === 'barcode') {
      const bars = encodeCode39Bars(el.value);
      const bw = Math.max(28, el.w * sx);
      const bh = Math.max(12, el.h * sy);
      const bx = ox + el.x * sx;
      const byTop = topY - el.y * sy;
      if (el.rotation === 90 || el.rotation === 270) {
        // Vertical left-margin barcode: stacked horizontal bars running vertically along Y
        const totalSpan = Math.max(40, el.w * sx);
        const thickness = Math.max(14, el.h * sy);
        for (const bar of bars) {
          const barLen = Math.max(0.4, bar.w * totalSpan);
          const barOffset = bar.x * totalSpan;
          const drawBarY = el.rotation === 270 ? byTop + barOffset : byTop - barOffset - barLen;
          sheet.drawRectangle({
            x: bx,
            y: drawBarY,
            width: thickness,
            height: barLen,
            color: rgb(0.06, 0.09, 0.14),
          });
        }
        sheet.drawText(sanitizePdfText(el.value, 24), {
          x: bx + thickness + 6,
          y: el.rotation === 270 ? byTop + 4 : byTop - totalSpan + 4,
          size: 5.5,
          font: fonts.monoReg,
          color: rgb(0.2, 0.25, 0.33),
          rotate: degrees(el.rotation === 270 ? 90 : -90),
        });
      } else {
        for (const bar of bars) {
          sheet.drawRectangle({
            x: bx + bar.x * bw,
            y: byTop - bh,
            width: Math.max(0.4, bar.w * bw),
            height: bh,
            color: rgb(0.06, 0.09, 0.14),
          });
        }
        sheet.drawText(sanitizePdfText(el.value, 28), {
          x: bx + 2,
          y: byTop - bh - 7,
          size: 5.5,
          font: fonts.monoReg,
          color: rgb(0.2, 0.25, 0.33),
        });
      }
    }
  }

  // 2. Clean text lines + subtle numbered diff washes
  const pagePtsW = (vp.widthUnits / Math.max(1, vp.xdpi)) * 72;
  const ptScale = drawW / Math.max(1, pagePtsW);

  for (const el of vp.elements) {
    if (el.kind !== 'text_line') continue;
    const diffInfo = lineDiffMap.get(el.lineNum);
    const baseSizePt = Math.max(4.5, Math.min(18, (el.spans[0]?.fontSizePt || 9.5) * ptScale));
    const lineY = topY - el.y * sy;
    const lineX = ox + el.x * sx;

    if (diffInfo) {
      const c = categoryRgb(diffInfo.cat);
      const approxW = Math.min(drawW - (lineX - ox) - 6, Math.max(36, el.fullText.length * baseSizePt * 0.52));
      const boxH = baseSizePt + 4;
      sheet.drawRectangle({
        x: Math.max(ox + 2, lineX - 2),
        y: lineY - 2,
        width: approxW + 4,
        height: boxH,
        color: c.fill,
        opacity: 0.32,
        borderColor: c.stroke,
        borderWidth: 0.75,
      });
      sheet.drawRectangle({
        x: ox + 3,
        y: lineY - 1,
        width: 12,
        height: 9,
        color: c.stroke,
      });
      sheet.drawText(String(diffInfo.idx), {
        x: ox + (diffInfo.idx >= 10 ? 4.5 : 6.5),
        y: lineY + 1,
        size: 6.5,
        font: fonts.sansBold,
        color: rgb(1, 1, 1),
      });
    }

    for (const sp of el.spans) {
      const fSize = Math.max(4.5, Math.min(18, sp.fontSizePt * ptScale));
      const spX = Math.max(ox + 4, Math.min(ox + drawW - 14, ox + sp.x * sx));
      const font =
        sp.fontFamily === 'serif'
          ? sp.fontWeight === 'bold'
            ? fonts.serifBold
            : fonts.serifReg
          : sp.fontFamily === 'monospace'
          ? sp.fontWeight === 'bold'
            ? fonts.monoBold
            : fonts.monoReg
          : sp.fontWeight === 'bold'
          ? fonts.sansBold
          : sp.fontStyle === 'italic'
          ? fonts.sansItal
          : fonts.sansReg;

      const maxChars = Math.max(6, Math.floor((ox + drawW - 8 - spX) / (fSize * 0.52)));
      sheet.drawText(sanitizePdfText(sp.text, maxChars), {
        x: spX,
        y: lineY,
        size: fSize,
        font,
        color: parseHexRgb(sp.color),
      });
    }
  }
}

export async function generateHighlightedPdfDiffReport(rec: StoredRunRecord): Promise<Buffer> {
  const { run, baselineBinary, candidateBinary } = rec;
  if (run.format !== 'PDF' && run.format !== 'AFP') {
    throw new Error('Annotated side-by-side PDF report is available for PDF and AFP comparison runs.');
  }

  const reportDoc = await PDFDocument.create();
  const fontReg = await reportDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await reportDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItal = await reportDoc.embedFont(StandardFonts.HelveticaOblique);
  const serifReg = await reportDoc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await reportDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontMono = await reportDoc.embedFont(StandardFonts.Courier);
  const monoBold = await reportDoc.embedFont(StandardFonts.CourierBold);

  const srcDoc = run.format === 'PDF' ? await PDFDocument.load(baselineBinary, { ignoreEncryption: true }) : null;
  const dstDoc = run.format === 'PDF' ? await PDFDocument.load(candidateBinary, { ignoreEncryption: true }) : null;
  const embeddedAfpAssets =
    run.format === 'AFP' ? await embedMediaAssetsForPdf(reportDoc, run.afpDetails?.mediaAssets) : new Map<string, PDFImage>();

  const slots = run.alignedPages || [];
  const { selected: visualSlots, truncated: visualSheetsCapped } = selectVisualSlotsForExport(slots, MAX_PDF_VISUAL_SHEETS);
  const { nonEqualBySlot } = groupDiffsBySlot(run.textDiffs);
  const baseLayoutsByPage = groupLayoutsByPage(run.pdfDetails?.baselineLayouts);
  const candLayoutsByPage = groupLayoutsByPage(run.pdfDetails?.candidateLayouts);
  const afpBaseVpMap = indexVisualPages(run.afpDetails?.baselineVisualPages);
  const afpCandVpMap = indexVisualPages(run.afpDetails?.candidateVisualPages);

  // Batch-embed source and destination PDF pages ONCE before rendering visual sheets
  const embeddedSrcMap = new Map<number, PDFEmbeddedPage>();
  const embeddedDstMap = new Map<number, PDFEmbeddedPage>();
  if (run.format === 'PDF' && srcDoc && dstDoc) {
    const srcIdxSet = new Set<number>();
    const dstIdxSet = new Set<number>();
    for (const s of visualSlots) {
      if (s.baselinePageNum !== null) {
        const idx = s.baselinePageNum - 1;
        if (idx >= 0 && idx < srcDoc.getPageCount() && srcDoc.getPage(idx).node.normalizedEntries().Contents) {
          srcIdxSet.add(idx);
        }
      }
      if (s.candidatePageNum !== null) {
        const idx = s.candidatePageNum - 1;
        if (idx >= 0 && idx < dstDoc.getPageCount() && dstDoc.getPage(idx).node.normalizedEntries().Contents) {
          dstIdxSet.add(idx);
        }
      }
    }
    if (srcIdxSet.size > 0) {
      try {
        const indices = Array.from(srcIdxSet).sort((a, b) => a - b);
        const embeddedPages = await reportDoc.embedPdf(srcDoc, indices);
        indices.forEach((pIdx, k) => embeddedSrcMap.set(pIdx, embeddedPages[k]));
      } catch {
        // fallback per-page skipped if malformed PDF object
      }
    }
    if (dstIdxSet.size > 0) {
      try {
        const indices = Array.from(dstIdxSet).sort((a, b) => a - b);
        const embeddedPages = await reportDoc.embedPdf(dstDoc, indices);
        indices.forEach((pIdx, k) => embeddedDstMap.set(pIdx, embeddedPages[k]));
      } catch {
        // fallback per-page skipped if malformed PDF object
      }
    }
  }

  const totalMatched = slots.filter((s) => s.status === 'MATCHED').length;
  const totalWithDiff = slots.filter((s) => s.status !== 'MATCHED').length;
  const totalFindings = run.totalDiffCount ?? run.textDiffs.filter((d) => d.diffCategory !== 'EQUAL').length;

  // Paginated Cover & Alignment Matrix (all slots included in matrix)
  let slotCursor = 0;
  let coverPageNum = 0;
  while (slotCursor < slots.length || coverPageNum === 0) {
    coverPageNum++;
    const cover = reportDoc.addPage([1240, 860]);
    cover.drawRectangle({ x: 0, y: 785, width: 1240, height: 75, color: rgb(0.06, 0.12, 0.24) });
    cover.drawText(
      coverPageNum === 1
        ? `DOCVERIFY QE — ENTERPRISE VISUAL DIFFERENCE REPORT (${run.format})`
        : `DOCVERIFY QE — PAGE ALIGNMENT MATRIX (CONTINUED · SHEET ${coverPageNum})`,
      { x: 42, y: 824, size: 15.5, font: fontBold, color: rgb(1, 1, 1) }
    );
    cover.drawText(
      sanitizePdfText(
        `Run: ${run.id}  |  Outcome: ${run.overallOutcome}  |  Source: ${run.baseline.filename} (${run.baseline.pageCount}p)  vs  Dest: ${run.candidate.filename} (${run.candidate.pageCount}p)`
      ),
      { x: 42, y: 800, size: 10, font: fontReg, color: rgb(0.84, 0.9, 0.98) }
    );

    let ty = 740;
    if (coverPageNum === 1) {
      const kpis = [
        { label: 'Aligned Slots', value: String(slots.length) },
        { label: 'Matched Pages', value: String(totalMatched) },
        { label: 'Pages With Differences', value: String(totalWithDiff) },
        { label: 'Total Variances Flagged', value: String(totalFindings) },
      ];
      kpis.forEach((k, idx) => {
        const kx = 42 + idx * 292;
        cover.drawRectangle({
          x: kx,
          y: 702,
          width: 278,
          height: 58,
          color: rgb(0.97, 0.98, 0.99),
          borderColor: rgb(0.86, 0.89, 0.94),
          borderWidth: 1,
        });
        cover.drawText(k.label, { x: kx + 14, y: 742, size: 9, font: fontBold, color: rgb(0.39, 0.45, 0.55) });
        cover.drawText(k.value, { x: kx + 14, y: 714, size: 20, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
      });

      const legendCats: DiffCategory[] = [
        'TEXT_CHANGE',
        'ALIGNMENT_SHIFT',
        'FONT_STYLE',
        'MISSING_CONTENT',
        'ADDED_CONTENT',
        'CONTROL_METADATA',
      ];
      cover.drawText('Difference Color Key:', { x: 42, y: 676, size: 10, font: fontBold, color: rgb(0.1, 0.14, 0.2) });
      legendCats.forEach((cat, idx) => {
        const c = categoryRgb(cat);
        const lx = 175 + idx * 172;
        cover.drawRectangle({ x: lx, y: 672, width: 12, height: 12, color: c.fill, borderColor: c.stroke, borderWidth: 1.3 });
        cover.drawText(c.label, { x: lx + 18, y: 675, size: 9.5, font: fontBold, color: rgb(0.15, 0.2, 0.28) });
      });

      cover.drawText(
        visualSheetsCapped
          ? `Aligned Page-by-Page Map (Complete ${slots.length} slots; visual sheets prioritize all diff slots up to ${MAX_PDF_VISUAL_SHEETS} sheets):`
          : 'Aligned Page-by-Page Map (Blank & Shifted Pages Automatically Aligned):',
        {
          x: 42,
          y: 642,
          size: 11,
          font: fontBold,
          color: rgb(0.1, 0.14, 0.2),
        }
      );
      ty = 616;
    } else {
      ty = 740;
    }

    const rowsPerSheet = coverPageNum === 1 ? 19 : 24;
    const slice = slots.slice(slotCursor, slotCursor + rowsPerSheet);
    slotCursor += slice.length;

    for (const slot of slice) {
      const badgeCol =
        slot.status === 'INSERTED_IN_CANDIDATE'
          ? categoryRgb('ADDED_CONTENT')
          : slot.status === 'MISSING_IN_CANDIDATE'
          ? categoryRgb('MISSING_CONTENT')
          : slot.status === 'DIFF_DETECTED'
          ? categoryRgb('TEXT_CHANGE')
          : { stroke: rgb(0.09, 0.64, 0.29), fill: rgb(0.92, 0.99, 0.95), label: 'Matched' };

      cover.drawRectangle({
        x: 42,
        y: ty - 6,
        width: 1156,
        height: 24,
        color: rgb(0.99, 0.99, 1),
        borderColor: rgb(0.88, 0.91, 0.95),
        borderWidth: 0.75,
      });
      cover.drawText(`Slot ${slot.slotIndex}`, { x: 52, y: ty + 2, size: 9.5, font: fontBold, color: rgb(0.1, 0.14, 0.2) });
      cover.drawText(
        slot.baselinePageNum ? `Source Page ${slot.baselinePageNum}${slot.baselineBlank ? ' (Blank)' : ''}` : 'NO PAGE (Absent in Source)',
        { x: 130, y: ty + 2, size: 9.5, font: fontMono, color: slot.baselinePageNum ? rgb(0.12, 0.16, 0.22) : rgb(0.75, 0.07, 0.24) }
      );
      cover.drawText(
        slot.candidatePageNum ? `Dest Page ${slot.candidatePageNum}${slot.candidateBlank ? ' (White/Blank)' : ''}` : 'NO PAGE (Missing in Dest)',
        { x: 355, y: ty + 2, size: 9.5, font: fontMono, color: slot.candidatePageNum ? rgb(0.12, 0.16, 0.22) : rgb(0.75, 0.07, 0.24) }
      );
      cover.drawRectangle({ x: 585, y: ty - 2, width: 120, height: 16, color: badgeCol.fill, borderColor: badgeCol.stroke, borderWidth: 1 });
      cover.drawText(slot.status.replace(/_/g, ' '), { x: 591, y: ty + 2, size: 8, font: fontBold, color: badgeCol.stroke });
      cover.drawText(sanitizePdfText(slot.summary, 88), { x: 720, y: ty + 2, size: 9, font: fontReg, color: rgb(0.25, 0.3, 0.38) });
      ty -= 28;
    }

    if (slotCursor >= slots.length) break;
  }

  // Render Each Visual Aligned Page Pair Side-by-Side
  const sheetW = 1240;
  const sheetH = 860;
  const frameW = 540;
  const frameH = 665;
  const leftX = 48;
  const rightX = 652;
  const frameY = 122;

  for (const slot of visualSlots) {
    const sheet = reportDoc.addPage([sheetW, sheetH]);
    const slotDiffs = nonEqualBySlot.get(slot.slotIndex) || [];

    sheet.drawRectangle({ x: 0, y: sheetH - 54, width: sheetW, height: 54, color: rgb(0.06, 0.12, 0.24) });
    sheet.drawText(
      sanitizePdfText(
        `Slot ${slot.slotIndex} of ${slots.length}  |  Source: ${
          slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'No White/Blank Page'
        }   vs   Destination: ${
          slot.candidatePageNum ? `Page ${slot.candidatePageNum}${slot.candidateBlank ? ' (Inserted Blank)' : ''}` : 'Missing'
        }`
      ),
      { x: 48, y: sheetH - 30, size: 13, font: fontBold, color: rgb(1, 1, 1) }
    );
    sheet.drawText(sanitizePdfText(slot.summary, 130), {
      x: 48,
      y: sheetH - 46,
      size: 9.5,
      font: fontReg,
      color: rgb(0.82, 0.88, 0.96),
    });

    sheet.drawText(`SOURCE FILE (IMDS Baseline) — ${slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'Absent at this position'}`, {
      x: leftX,
      y: frameY + frameH + 10,
      size: 10.5,
      font: fontBold,
      color: rgb(0.12, 0.16, 0.22),
    });
    sheet.drawText(`DESTINATION FILE (DDGS Candidate) — ${slot.candidatePageNum ? `Page ${slot.candidatePageNum}` : 'Missing'}`, {
      x: rightX,
      y: frameY + frameH + 10,
      size: 10.5,
      font: fontBold,
      color: rgb(0.12, 0.16, 0.22),
    });

    const drawSide = (side: 'baseline' | 'candidate', ox: number) => {
      const pageNum = side === 'baseline' ? slot.baselinePageNum : slot.candidatePageNum;
      const isBlank = side === 'baseline' ? slot.baselineBlank : slot.candidateBlank;

      if (pageNum === null) {
        const c = side === 'baseline' ? categoryRgb('ADDED_CONTENT') : categoryRgb('MISSING_CONTENT');
        sheet.drawRectangle({
          x: ox,
          y: frameY,
          width: frameW,
          height: frameH,
          color: side === 'baseline' ? rgb(0.96, 0.99, 0.99) : rgb(1, 0.97, 0.98),
          borderColor: c.stroke,
          borderWidth: 1.5,
        });
        sheet.drawText(
          side === 'baseline' ? 'NO CORRESPONDING PAGE IN SOURCE FILE' : `PAGE MISSING IN DESTINATION FILE (SOURCE PAGE ${slot.baselinePageNum})`,
          { x: ox + 75, y: frameY + frameH / 2 + 12, size: 12, font: fontBold, color: c.stroke }
        );
        return;
      }

      if (run.format === 'PDF') {
        const pDoc = side === 'baseline' ? srcDoc! : dstDoc!;
        const pIdx = pageNum - 1;
        const pageObj = pDoc.getPage(pIdx);
        const { width: pw, height: ph } = pageObj.getSize();
        const scale = Math.min(frameW / pw, frameH / ph);
        const drawW = pw * scale;
        const drawH = ph * scale;

        sheet.drawRectangle({
          x: ox,
          y: frameY,
          width: drawW,
          height: drawH,
          color: rgb(1, 1, 1),
          borderColor: rgb(0.75, 0.8, 0.88),
          borderWidth: 1,
        });

        const embedded = side === 'baseline' ? embeddedSrcMap.get(pIdx) : embeddedDstMap.get(pIdx);
        if (embedded) {
          sheet.drawPage(embedded, { x: ox, y: frameY, width: drawW, height: drawH });
        }

        if (isBlank) {
          const c = categoryRgb('ADDED_CONTENT');
          sheet.drawRectangle({
            x: ox + 32,
            y: frameY + drawH / 2 - 24,
            width: drawW - 64,
            height: 54,
            color: c.fill,
            opacity: 0.78,
            borderColor: c.stroke,
            borderWidth: 1.5,
          });
          sheet.drawText(`INSERTED WHITE / BLANK PAGE (PAGE ${pageNum})`, {
            x: ox + 70,
            y: frameY + drawH / 2 + 4,
            size: 11,
            font: fontBold,
            color: c.stroke,
          });
        }

        const layouts = (side === 'baseline' ? baseLayoutsByPage.get(pageNum) : candLayoutsByPage.get(pageNum)) || [];
        slotDiffs.forEach((d, idx) => {
          const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
          if (ln !== null && layouts[ln - 1]) {
            const lay = layouts[ln - 1];
            const c = categoryRgb(d.diffCategory);
            const rx = ox + Math.max(2, (lay.x - 3) * scale);
            const ry = frameY + Math.max(2, (lay.y - 2) * scale);
            const rw = Math.min(drawW - (rx - ox) - 6, Math.max(lay.width, 60) * scale + 6);
            const rh = Math.max(lay.fontSize, lay.height, 10) * scale + 4;
            sheet.drawRectangle({
              x: rx,
              y: ry,
              width: rw,
              height: rh,
              color: c.fill,
              opacity: 0.34,
              borderColor: c.stroke,
              borderWidth: 1,
            });
            sheet.drawRectangle({ x: ox + 3, y: ry + rh - 9, width: 12, height: 9, color: c.stroke });
            sheet.drawText(String(idx + 1), {
              x: ox + (idx + 1 >= 10 ? 4.5 : 6.5),
              y: ry + rh - 7,
              size: 6.5,
              font: fontBold,
              color: rgb(1, 1, 1),
            });
          }
        });
      } else if (run.format === 'AFP') {
        const vp = (side === 'baseline' ? afpBaseVpMap.get(pageNum) : afpCandVpMap.get(pageNum)) || {
          pageIndex: pageNum,
          widthUnits: 2040,
          heightUnits: 2640,
          xdpi: 240,
          ydpi: 240,
          elements: [],
        };
        const scale = Math.min(frameW / vp.widthUnits, frameH / vp.heightUnits);
        const drawW = vp.widthUnits * scale;
        const drawH = vp.heightUnits * scale;

        sheet.drawRectangle({
          x: ox,
          y: frameY,
          width: drawW,
          height: drawH,
          color: rgb(1, 1, 1),
          borderColor: rgb(0.75, 0.8, 0.88),
          borderWidth: 1,
        });

        if (isBlank) {
          const c = categoryRgb('ADDED_CONTENT');
          sheet.drawRectangle({
            x: ox + 32,
            y: frameY + drawH / 2 - 24,
            width: drawW - 64,
            height: 54,
            color: c.fill,
            opacity: 0.78,
            borderColor: c.stroke,
            borderWidth: 1.5,
          });
          sheet.drawText(`INSERTED WHITE / BLANK PAGE (PAGE ${pageNum})`, {
            x: ox + 70,
            y: frameY + drawH / 2 + 4,
            size: 11,
            font: fontBold,
            color: c.stroke,
          });
        } else {
          drawAfpVisualPageOnPdf({
            sheet,
            vp,
            ox,
            oy: frameY,
            drawW,
            drawH,
            embeddedAssets: embeddedAfpAssets,
            fonts: { sansReg: fontReg, sansBold: fontBold, sansItal: fontItal, serifReg, serifBold, monoReg: fontMono, monoBold },
            slotDiffs,
            side,
          });
        }
      }
    };

    drawSide('baseline', leftX);
    drawSide('candidate', rightX);

    sheet.drawRectangle({
      x: 48,
      y: 16,
      width: 1144,
      height: 92,
      color: rgb(0.97, 0.98, 0.99),
      borderColor: rgb(0.86, 0.89, 0.94),
      borderWidth: 0.8,
    });
    if (slotDiffs.length === 0) {
      sheet.drawText('No visual or content differences detected in this aligned page pair.', {
        x: 62,
        y: 56,
        size: 10,
        font: fontBold,
        color: rgb(0.09, 0.55, 0.29),
      });
    } else {
      let dy = 90;
      slotDiffs.slice(0, 5).forEach((d, idx) => {
        const c = categoryRgb(d.diffCategory);
        const notes = [d.positionDelta, d.fontDelta, d.controlDelta].filter(Boolean).join(' · ');
        const msg = sanitizePdfText(
          `#${idx + 1} [${c.label}] Src: "${d.baselineText || '(absent)'}"  ->  Dst: "${d.candidateText || '(missing)'}"${notes ? `  (${notes})` : ''}`,
          135
        );
        sheet.drawText(msg, { x: 62, y: dy, size: 8.5, font: fontMono, color: c.stroke });
        dy -= 15;
      });
    }
  }

  const outBytes = await reportDoc.save();
  return Buffer.from(outBytes);
}

function renderHtmlTokenList(d: TextDiffLine, side: 'baseline' | 'candidate'): string {
  const tokens = side === 'baseline' ? d.baselineTokens : d.candidateTokens;
  const fallback = side === 'baseline' ? d.baselineText : d.candidateText;
  const c = categoryRgb(d.diffCategory);

  if (!tokens || tokens.length === 0) {
    return fallback
      ? escapeHtml(fallback)
      : `<span class="muted">${side === 'baseline' ? '(Absent in Source)' : '(Missing in Destination)'}</span>`;
  }

  return tokens
    .map((t) =>
      t.changed
        ? `<mark style="background:${c.bgHex};color:${c.hex};padding:0 3px;border-radius:2px;font-weight:600;border-bottom:1.5px solid ${c.hex};">${escapeHtml(t.text)}</mark>`
        : escapeHtml(t.text)
    )
    .join('');
}

function renderAfpSvgHtml(
  vp: AfpVisualPage,
  mediaAssets: Record<string, string>,
  side: 'baseline' | 'candidate',
  slotDiffs: TextDiffLine[]
): string {
  const lineDiffMap = new Map<number, { idx: number; cat: DiffCategory }>();
  slotDiffs.forEach((d, i) => {
    const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
    if (ln !== null && !lineDiffMap.has(ln)) {
      lineDiffMap.set(ln, { idx: i + 1, cat: d.diffCategory });
    }
  });

  const parts: string[] = [];

  for (const el of vp.elements) {
    if (el.kind === 'rule') {
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${Math.max(2, el.w)}" height="${Math.max(2, el.h)}" fill="${escapeHtml(el.color)}" />`
      );
    } else if (el.kind === 'vector') {
      const pathTags = el.paths
        .map(
          (p) =>
            `<path d="${escapeHtml(p.d)}" fill="${escapeHtml(p.fill || 'none')}" stroke="${escapeHtml(p.stroke || '#0f172a')}" stroke-width="${p.strokeWidth || 2}" />`
        )
        .join('');
      parts.push(
        `<svg x="${el.x}" y="${el.y}" width="${Math.max(1, el.w)}" height="${Math.max(1, el.h)}" viewBox="0 0 ${Math.max(1, el.viewW)} ${Math.max(1, el.viewH)}" overflow="visible">${pathTags}</svg>`
      );
    } else if (el.kind === 'external_ref') {
      parts.push(
        `<g>
          <rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6,4" rx="4" />
          <text x="${el.x + el.w / 2}" y="${el.y + el.h / 2 + 6}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="20" fill="#475569">[${escapeHtml(el.resType)}: ${escapeHtml(el.name)}]</text>
        </g>`
      );
    } else if (el.kind === 'image') {
      const dataUri = mediaAssets[el.assetId];
      if (dataUri) {
        parts.push(
          `<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" href="${dataUri}" preserveAspectRatio="xMinYMin meet" />`
        );
      }
    } else if (el.kind === 'barcode') {
      const bars = encodeCode39Bars(el.value);
      const rects = bars
        .map(
          (b) =>
            `<rect x="${(b.x * el.w).toFixed(1)}" y="0" width="${Math.max(1.5, b.w * el.w).toFixed(1)}" height="${el.h}" fill="#0f172a" />`
        )
        .join('');
      const label = `<text x="${el.w / 2}" y="${el.h + 22}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="18" fill="#334155">${escapeHtml(el.value)}</text>`;
      const rotAttr = el.rotation ? ` transform="rotate(${el.rotation} ${el.x} ${el.y})"` : '';
      parts.push(`<g${rotAttr}><g transform="translate(${el.x},${el.y})">${rects}${label}</g></g>`);
    }
  }

  for (const el of vp.elements) {
    if (el.kind !== 'text_line') continue;
    const diffInfo = lineDiffMap.get(el.lineNum);
    const pt0 = el.spans[0]?.fontSizePt || 9.5;
    const fontUnitPx = Math.max(16, Math.round((pt0 / 72) * vp.xdpi));

    if (diffInfo) {
      const c = categoryRgb(diffInfo.cat);
      const estW = Math.min(vp.widthUnits - el.x - 40, Math.max(120, Math.round(el.fullText.length * fontUnitPx * 0.54)));
      const boxH = Math.round(fontUnitPx * 1.35);
      parts.push(
        `<g class="diff-overlay">
          <rect x="${Math.max(10, el.x - 8)}" y="${Math.max(4, el.y - Math.round(fontUnitPx * 1.05))}" width="${estW + 16}" height="${boxH}" fill="${c.bgHex}" fill-opacity="0.48" stroke="${c.hex}" stroke-width="2" rx="4" />
          <rect x="14" y="${Math.max(4, el.y - Math.round(fontUnitPx * 0.95))}" width="38" height="28" fill="${c.hex}" rx="4" />
          <text x="33" y="${Math.max(24, el.y - Math.round(fontUnitPx * 0.95) + 21)}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="19" fill="#ffffff">#${diffInfo.idx}</text>
        </g>`
      );
    }

    for (const sp of el.spans) {
      const fUnit = Math.max(16, Math.round((sp.fontSizePt / 72) * vp.xdpi));
      const familyCss =
        sp.fontFamily === 'serif'
          ? 'Georgia, Times New Roman, serif'
          : sp.fontFamily === 'monospace'
          ? 'ui-monospace, Consolas, monospace'
          : 'system-ui, -apple-system, Segoe UI, Arial, sans-serif';
      parts.push(
        `<text x="${sp.x}" y="${el.y}" font-family="${familyCss}" font-size="${fUnit}" font-weight="${sp.fontWeight}" font-style="${sp.fontStyle}" fill="${escapeHtml(sp.color)}">${escapeHtml(sp.text)}</text>`
      );
    }
  }

  return `<svg class="afp-svg" viewBox="0 0 ${vp.widthUnits} ${vp.heightUnits}" width="100%" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

interface ExportLookups {
  run: ComparisonRun;
  afpBaseVpMap: Map<number, AfpVisualPage>;
  afpCandVpMap: Map<number, AfpVisualPage>;
  baseLayoutsByPage: Map<number, PdfLineLayout[]>;
  candLayoutsByPage: Map<number, PdfLineLayout[]>;
  allRowsBySlot: Map<number, TextDiffLine[]>;
}

function renderSlotVisualPageHtml(
  lookups: ExportLookups,
  slot: AlignedPageSlot,
  side: 'baseline' | 'candidate',
  slotDiffs: TextDiffLine[]
): string {
  const { run, afpBaseVpMap, afpCandVpMap, baseLayoutsByPage, candLayoutsByPage, allRowsBySlot } = lookups;
  const pageNum = side === 'baseline' ? slot.baselinePageNum : slot.candidatePageNum;
  const isBlank = side === 'baseline' ? slot.baselineBlank : slot.candidateBlank;

  if (pageNum === null) {
    const accent = side === 'baseline' ? '#0D9488' : '#BE123C';
    const bg = side === 'baseline' ? '#F0FDFA' : '#FFF1F2';
    const msg =
      side === 'baseline'
        ? slot.candidateBlank
          ? `No White / Blank Page in Source File<br><small>Destination Page ${slot.candidatePageNum} is an inserted white page. Remaining pages stay aligned.</small>`
          : `No Page in Source File<br><small>Destination Page ${slot.candidatePageNum} inserted here.</small>`
        : `Page ${slot.baselinePageNum} Missing in Destination File`;
    return `<div class="page-sheet empty-slot" style="border-color:${accent};background:${bg};color:${accent};">
      <div class="empty-inner">${msg}</div>
    </div>`;
  }

  if (isBlank) {
    return `<div class="page-sheet blank-slot">
      <div class="blank-banner">INSERTED WHITE / BLANK PAGE (Page ${pageNum})</div>
    </div>`;
  }

  if (run.format === 'AFP' && run.afpDetails) {
    const vp = (side === 'baseline' ? afpBaseVpMap.get(pageNum) : afpCandVpMap.get(pageNum)) || {
      pageIndex: pageNum,
      widthUnits: 2040,
      heightUnits: 2640,
      xdpi: 240,
      ydpi: 240,
      elements: [],
    };
    return `<div class="page-sheet afp-sheet">${renderAfpSvgHtml(vp, run.afpDetails.mediaAssets || {}, side, slotDiffs)}</div>`;
  }

  if (run.format === 'PDF' && run.pdfDetails) {
    const layouts = (side === 'baseline' ? baseLayoutsByPage.get(pageNum) : candLayoutsByPage.get(pageNum)) || [];
    const dims =
      (side === 'baseline' ? run.pdfDetails.baselinePageDims?.[pageNum - 1] : run.pdfDetails.candidatePageDims?.[pageNum - 1]) || {
        width: 612,
        height: 792,
      };
    const lineDiffMap = new Map<number, { idx: number; cat: DiffCategory }>();
    slotDiffs.forEach((d, i) => {
      const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
      if (ln !== null && !lineDiffMap.has(ln)) lineDiffMap.set(ln, { idx: i + 1, cat: d.diffCategory });
    });

    const svgNodes = layouts
      .map((l, i) => {
        const lineNum = i + 1;
        const diffInfo = lineDiffMap.get(lineNum);
        const topY = Math.round(dims.height - l.y);
        const fSize = Math.max(6, Math.round(l.fontSize * 10) / 10);
        const hl = diffInfo
          ? (() => {
              const c = categoryRgb(diffInfo.cat);
              const bw = Math.min(dims.width - l.x - 8, Math.max(48, l.width + 8));
              const bh = Math.round(fSize * 1.35);
              return `<g class="diff-overlay">
                <rect x="${Math.max(2, l.x - 3)}" y="${Math.max(2, topY - fSize - 1)}" width="${bw}" height="${bh}" fill="${c.bgHex}" fill-opacity="0.45" stroke="${c.hex}" stroke-width="0.9" rx="2" />
                <rect x="4" y="${Math.max(2, topY - fSize)}" width="14" height="10" fill="${c.hex}" rx="2" />
                <text x="11" y="${Math.max(10, topY - fSize + 8)}" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="7" fill="#ffffff">#${diffInfo.idx}</text>
              </g>`;
            })()
          : '';
        return `${hl}<text x="${l.x}" y="${topY}" font-family="system-ui, -apple-system, Arial, sans-serif" font-size="${fSize}" fill="#0f172a">${escapeHtml(l.text)}</text>`;
      })
      .join('');

    return `<div class="page-sheet afp-sheet"><svg class="afp-svg" viewBox="0 0 ${dims.width} ${dims.height}" width="100%" xmlns="http://www.w3.org/2000/svg">${svgNodes}</svg></div>`;
  }

  // PCL or RT rendered lines with highlight boxes (bounded slice to keep huge RT sections snappy)
  const slotRows = (allRowsBySlot.get(slot.slotIndex) || []).slice(0, 600);
  const linesHtml = slotRows
    .map((d) => {
      const c = categoryRgb(d.diffCategory);
      const isDiff = d.diffCategory !== 'EQUAL';
      const style = isDiff ? `background:${c.bgHex};border-left:3px solid ${c.hex};` : '';
      return `<div class="text-line" style="${style}">${renderHtmlTokenList(d, side)}</div>`;
    })
    .join('');

  return `<div class="page-sheet lines-sheet">${linesHtml || '<div class="muted">(No lines)</div>'}</div>`;
}

export function generateHighlightedHtmlReport(rec: StoredRunRecord): string {
  const { run } = rec;
  const slots = run.alignedPages || [];
  const matchedSlots = slots.filter((s) => s.status === 'MATCHED').length;
  const diffSlots = slots.length - matchedSlots;
  const totalDiffs = run.totalDiffCount ?? run.textDiffs.filter((d) => d.diffCategory !== 'EQUAL').length;

  const { nonEqualBySlot, allBySlot } = groupDiffsBySlot(run.textDiffs);
  const lookups: ExportLookups = {
    run,
    afpBaseVpMap: indexVisualPages(run.afpDetails?.baselineVisualPages),
    afpCandVpMap: indexVisualPages(run.afpDetails?.candidateVisualPages),
    baseLayoutsByPage: groupLayoutsByPage(run.pdfDetails?.baselineLayouts),
    candLayoutsByPage: groupLayoutsByPage(run.pdfDetails?.candidateLayouts),
    allRowsBySlot: allBySlot,
  };

  const { selected: visualSlots, truncated: htmlCardsCapped } = selectVisualSlotsForExport(slots, MAX_HTML_VISUAL_CARDS);

  const matrixRowsHtml = slots
    .map((slot) => {
      const cls =
        slot.status === 'INSERTED_IN_CANDIDATE'
          ? 'color:#0D9488;background:#F0FDFA;'
          : slot.status === 'MISSING_IN_CANDIDATE'
          ? 'color:#BE123C;background:#FFF1F2;'
          : slot.status === 'DIFF_DETECTED'
          ? 'color:#DC2626;background:#FEF2F2;'
          : 'color:#047857;background:#ECFDF5;';
      return `<tr class="matrix-row" data-has-diff="${slot.status !== 'MATCHED' ? '1' : '0'}" onclick="var el=document.getElementById('slot-${slot.slotIndex}');if(el)el.scrollIntoView({behavior:'smooth'});">
        <td class="mono" style="font-weight:600;">Slot ${slot.slotIndex}</td>
        <td class="mono">${slot.baselinePageNum ? `Page ${slot.baselinePageNum}${slot.baselineBlank ? ' (Blank)' : ''}` : 'Absent'}</td>
        <td class="mono">${slot.candidatePageNum ? `Page ${slot.candidatePageNum}${slot.candidateBlank ? ' (Blank)' : ''}` : 'Missing'}</td>
        <td><span style="padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;${cls}">${escapeHtml(slot.status.replace(/_/g, ' '))}</span></td>
        <td class="mono" style="text-align:right;">${slot.diffCount}</td>
        <td>${escapeHtml(slot.summary)}</td>
      </tr>`;
    })
    .join('');

  const slotsHtml = visualSlots
    .map((slot) => {
      const slotDiffs = nonEqualBySlot.get(slot.slotIndex) || [];
      const statusBadge =
        slot.status === 'INSERTED_IN_CANDIDATE'
          ? '<span class="badge" style="background:#CCFBF1;color:#0D9488;border-color:#5EEAD4;">Inserted Page in Dest</span>'
          : slot.status === 'MISSING_IN_CANDIDATE'
          ? '<span class="badge" style="background:#FFE4E6;color:#BE123C;border-color:#FDA4AF;">Missing Page in Dest</span>'
          : slot.status === 'DIFF_DETECTED'
          ? `<span class="badge" style="background:#FEE2E2;color:#DC2626;border-color:#FCA5A5;">${slot.diffCount} Difference(s)</span>`
          : '<span class="badge" style="background:#ECFDF5;color:#047857;border-color:#A7F3D0;">Matched</span>';

      return `
      <section id="slot-${slot.slotIndex}" class="slot-card" data-has-diff="${slot.status !== 'MATCHED' ? '1' : '0'}">
        <div class="slot-head">
          <div>
            <strong>Slot ${slot.slotIndex} of ${slots.length}</strong> ·
            Source: <code>${slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'None (Absent)'}</code> ↔
            Destination: <code>${slot.candidatePageNum ? `Page ${slot.candidatePageNum}` : 'None (Missing)'}</code>
          </div>
          ${statusBadge}
        </div>
        <div class="slot-summary">${escapeHtml(slot.summary)}</div>
        <div class="two-up">
          <div class="col">
            <div class="col-title">IMDS Source Baseline (${escapeHtml(run.baseline.filename)})</div>
            ${renderSlotVisualPageHtml(lookups, slot, 'baseline', slotDiffs)}
          </div>
          <div class="col">
            <div class="col-title">DDGS Destination Candidate (${escapeHtml(run.candidate.filename)})</div>
            ${renderSlotVisualPageHtml(lookups, slot, 'candidate', slotDiffs)}
          </div>
        </div>
        ${
          slotDiffs.length > 0
            ? `<div class="slot-diffs">
                <table>
                  <thead><tr><th style="width:42px;">#</th><th style="width:128px;">Type</th><th style="width:82px;">Lines</th><th>Source (Baseline)</th><th>Destination (Candidate)</th><th>Layout / Control Delta</th></tr></thead>
                  <tbody>
                    ${slotDiffs
                      .slice(0, 150)
                      .map((d, idx) => {
                        const c = categoryRgb(d.diffCategory);
                        const notes = [d.positionDelta, d.fontDelta, d.controlDelta, d.criticalReason].filter(Boolean).join(' · ');
                        return `<tr>
                          <td class="mono" style="font-weight:700;color:${c.hex};">#${idx + 1}</td>
                          <td><span class="badge" style="background:${c.bgHex};color:${c.hex};border-color:${c.hex};">${c.label}</span></td>
                          <td class="mono">L${d.baselineLineNum ?? '—'} / L${d.candidateLineNum ?? '—'}</td>
                          <td class="mono">${renderHtmlTokenList(d, 'baseline')}</td>
                          <td class="mono">${renderHtmlTokenList(d, 'candidate')}</td>
                          <td>${escapeHtml(notes || '—')}</td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>`
            : ''
        }
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(run.id)} Enterprise Visual Diff Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif; background:#f1f5f9; color:#0f172a; margin:0; padding:24px; font-size:13px; line-height:1.45; }
    .container { max-width: 1240px; margin: 0 auto; }
    .header { background:#0f172a; color:#fff; padding:20px 24px; border-radius:8px 8px 0 0; }
    .header h1 { margin:0 0 6px; font-size:18px; font-weight:700; letter-spacing:-0.01em; }
    .meta { font-size:12px; color:#cbd5e1; }
    .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); background:#fff; border:1px solid #cbd5e1; border-top:none; border-radius:0 0 8px 8px; margin-bottom:16px; overflow:hidden; }
    .kpi-cell { padding:12px 18px; border-right:1px solid #e2e8f0; }
    .kpi-cell:last-child { border-right:none; }
    .kpi-label { font-size:11px; color:#64748b; font-weight:600; }
    .kpi-val { font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; color:#0f172a; }
    .notice-banner { background:#fffbeb; border:1px solid #fcd34d; color:#92400e; padding:10px 14px; border-radius:6px; font-size:12px; margin-bottom:14px; }
    .toolbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; background:#fff; border:1px solid #cbd5e1; border-radius:8px; padding:12px 16px; margin-bottom:16px; position:sticky; top:10px; z-index:20; box-shadow:0 4px 12px rgba(15,23,42,0.06); }
    .btn-group { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .btn { border:1px solid #cbd5e1; background:#fff; color:#334155; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
    .btn.active { background:#0f172a; color:#fff; border-color:#0f172a; }
    .btn:hover:not(.active) { background:#f8fafc; }
    .legend { display:flex; flex-wrap:wrap; gap:10px; align-items:center; font-size:11.5px; }
    .badge { display:inline-block; border:1px solid; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:600; white-space:nowrap; }
    .matrix-card { background:#fff; border:1px solid #cbd5e1; border-radius:8px; margin-bottom:18px; overflow:hidden; }
    .matrix-head { padding:10px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-weight:600; font-size:12.5px; display:flex; justify-content:space-between; }
    .matrix-scroll { max-height:260px; overflow-y:auto; }
    .matrix-row { cursor:pointer; }
    .matrix-row:hover { background:#f8fafc; }
    .slot-card { background:#fff; border:1px solid #cbd5e1; border-radius:8px; margin-bottom:20px; overflow:hidden; page-break-inside:avoid; }
    .slot-head { display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
    .slot-summary { padding:8px 16px; font-size:12px; color:#475569; border-bottom:1px solid #f1f5f9; background:#fff; }
    .two-up { display:grid; grid-template-columns:1fr 1fr; gap:18px; padding:16px; background:#e2e8f0; }
    .col-title { font-size:11.5px; font-weight:600; color:#1e293b; margin-bottom:8px; }
    .page-sheet { background:#fff; border:1px solid #94a3b8; box-shadow:0 2px 6px rgba(15,23,42,0.08); position:relative; overflow:hidden; margin:0 auto; width:100%; }
    .afp-sheet { display:block; }
    .afp-svg { display:block; width:100%; height:auto; background:#ffffff; }
    .lines-sheet { padding:12px; font-family:ui-monospace, Consolas, monospace; font-size:11px; min-height:220px; }
    .text-line { padding:3px 6px; white-space:pre-wrap; word-break:break-word; }
    .empty-slot { aspect-ratio:8.5/11; display:flex; align-items:center; justify-content:center; border:2px dashed; text-align:center; padding:24px; }
    .blank-slot { aspect-ratio:8.5/11; display:flex; align-items:center; justify-content:center; border:2px solid #0D9488; background:#ffffff; }
    .blank-banner { background:#CCFBF1; color:#0D9488; border:1px solid #0D9488; padding:10px 16px; border-radius:6px; font-weight:600; font-size:12px; }
    .slot-diffs { padding:14px 16px; background:#fff; border-top:1px solid #e2e8f0; }
    table { width:100%; border-collapse:collapse; font-size:11.5px; }
    th, td { border-bottom:1px solid #e2e8f0; padding:7px 10px; text-align:left; vertical-align:top; }
    th { background:#f8fafc; color:#475569; font-weight:600; }
    .mono { font-family:ui-monospace, Consolas, monospace; font-variant-numeric:tabular-nums; }
    .muted { color:#94a3b8; font-style:italic; }
    body.hide-highlights .diff-overlay { display:none; }
    @media print { body { padding:0; background:#fff; } .toolbar { display:none; } .slot-card { break-inside:avoid; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>DocVerify QE — Enterprise Side-by-Side Visual Report (${escapeHtml(run.id)})</h1>
      <div class="meta">
        Format: ${escapeHtml(run.format)} · Outcome: ${escapeHtml(run.overallOutcome)} ·
        Source: ${escapeHtml(run.baseline.filename)} (${run.baseline.pageCount} page(s)) ·
        Destination: ${escapeHtml(run.candidate.filename)} (${run.candidate.pageCount} page(s))
      </div>
      <div class="meta" style="margin-top:4px;font-family:ui-monospace,monospace;">
        SHA-256 Source: ${escapeHtml(run.baseline.sha256)} · SHA-256 Dest: ${escapeHtml(run.candidate.sha256)}
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-cell"><div class="kpi-label">Aligned Page Slots</div><div class="kpi-val">${slots.length}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Cleanly Matched Slots</div><div class="kpi-val" style="color:#047857;">${matchedSlots}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Slots With Differences</div><div class="kpi-val" style="color:${diffSlots > 0 ? '#DC2626' : '#047857'};">${diffSlots}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Total Highlighted Findings</div><div class="kpi-val">${totalDiffs}</div></div>
    </div>

    ${
      htmlCardsCapped || run.diffLinesTruncated
        ? `<div class="notice-banner">Large-file export optimization: ${
            htmlCardsCapped
              ? `Alignment Matrix shows all ${slots.length} slots; visual page cards prioritize all ${diffSlots} diff slots and cap rendered cards at ${MAX_HTML_VISUAL_CARDS} to keep browser rendering responsive.`
              : `Line diff table retains 100% of variances (${totalDiffs} diffs) while sampling matched context lines.`
          }</div>`
        : ''
    }

    <div class="toolbar">
      <div class="btn-group">
        <button id="btnAll" class="btn active" onclick="filterSlots('all')">All Slots (${slots.length})</button>
        <button id="btnDiff" class="btn" onclick="filterSlots('diffs')">Differences Only (${diffSlots})</button>
        <label style="margin-left:10px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;font-size:12px;">
          <input type="checkbox" checked onchange="document.body.classList.toggle('hide-highlights', !this.checked)" />
          Show Diff Highlights (#1, #2…)
        </label>
        <button class="btn" onclick="window.print()" style="margin-left:8px;">Print / Save as PDF</button>
      </div>
      <div class="legend">
        ${(['TEXT_CHANGE', 'ALIGNMENT_SHIFT', 'FONT_STYLE', 'MISSING_CONTENT', 'ADDED_CONTENT', 'CONTROL_METADATA'] as DiffCategory[])
          .map((cat) => {
            const c = categoryRgb(cat);
            return `<span class="badge" style="background:${c.bgHex};color:${c.hex};border-color:${c.hex};">${c.label}</span>`;
          })
          .join('')}
      </div>
    </div>

    <div class="matrix-card">
      <div class="matrix-head">
        <span>Aligned Page Navigation Matrix (Click any row to jump directly to visual comparison)</span>
        <span class="mono" style="font-size:11px;color:#64748b;">${slots.length} slots</span>
      </div>
      <div class="matrix-scroll">
        <table>
          <thead><tr><th>Slot</th><th>Source (IMDS)</th><th>Destination (DDGS)</th><th>Status</th><th style="text-align:right;">Diffs</th><th>Summary</th></tr></thead>
          <tbody>${matrixRowsHtml}</tbody>
        </table>
      </div>
    </div>

    ${slotsHtml}
  </div>
  <script>
    function filterSlots(mode) {
      document.getElementById('btnAll').classList.toggle('active', mode === 'all');
      document.getElementById('btnDiff').classList.toggle('active', mode === 'diffs');
      document.querySelectorAll('.slot-card, .matrix-row').forEach(function(el) {
        if (mode === 'diffs' && el.getAttribute('data-has-diff') === '0') {
          el.style.display = 'none';
        } else {
          el.style.display = '';
        }
      });
    }
  </script>
</body>
</html>`;
}
