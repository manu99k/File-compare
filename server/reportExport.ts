import { PDFDocument, StandardFonts, rgb, type RGB } from 'pdf-lib';
import type { StoredRunRecord } from './fixtures.ts';
import type { AlignedPageSlot, DiffCategory, TextDiffLine } from '../src/types/qe.ts';

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

function sanitizePdfText(s: string): string {
  // Standard Helvetica WinAnsi safe ASCII replacement
  return (s || '').replace(/[^\x20-\x7e]/g, ' ').slice(0, 140);
}

export async function generateHighlightedPdfDiffReport(rec: StoredRunRecord): Promise<Buffer> {
  const { run, baselineBinary, candidateBinary } = rec;
  if (run.format !== 'PDF') {
    throw new Error('Annotated side-by-side PDF report is available only for PDF comparison runs. Use format=html for AFP/PCL/RT.');
  }

  const reportDoc = await PDFDocument.create();
  const fontReg = await reportDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await reportDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await reportDoc.embedFont(StandardFonts.Courier);

  const srcDoc = await PDFDocument.load(baselineBinary, { ignoreEncryption: true });
  const dstDoc = await PDFDocument.load(candidateBinary, { ignoreEncryption: true });

  // Cover & Page Alignment Matrix Sheet (Landscape 1240 x 860)
  const cover = reportDoc.addPage([1240, 860]);
  cover.drawRectangle({ x: 0, y: 785, width: 1240, height: 75, color: rgb(0.06, 0.14, 0.28) });
  cover.drawText('DOCVERIFY QE - VISUAL SIDE-BY-SIDE DIFFERENCE REPORT (PDF)', {
    x: 42,
    y: 822,
    size: 16,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  cover.drawText(
    sanitizePdfText(`Run ID: ${run.id}  |  Outcome: ${run.overallOutcome}  |  Source: ${run.baseline.filename} (${run.baseline.pageCount}p)  vs  Dest: ${run.candidate.filename} (${run.candidate.pageCount}p)`),
    { x: 42, y: 798, size: 10.5, font: fontReg, color: rgb(0.84, 0.9, 0.98) }
  );

  // Legend Strip
  const legendCats: DiffCategory[] = [
    'TEXT_CHANGE',
    'ALIGNMENT_SHIFT',
    'FONT_STYLE',
    'MISSING_CONTENT',
    'ADDED_CONTENT',
    'CONTROL_METADATA',
  ];
  cover.drawText('Color-Coded Difference Legend:', { x: 42, y: 745, size: 11, font: fontBold, color: rgb(0.1, 0.14, 0.2) });
  legendCats.forEach((cat, idx) => {
    const c = categoryRgb(cat);
    const lx = 42 + idx * 195;
    cover.drawRectangle({ x: lx, y: 716, width: 14, height: 14, color: c.fill, borderColor: c.stroke, borderWidth: 1.5 });
    cover.drawText(c.label, { x: lx + 20, y: 719, size: 10, font: fontBold, color: rgb(0.15, 0.2, 0.28) });
  });

  // Page Alignment Matrix Table
  cover.drawText('Aligned Page-by-Page Map (Blank & Shifted Pages Automatically Aligned):', {
    x: 42,
    y: 678,
    size: 11.5,
    font: fontBold,
    color: rgb(0.1, 0.14, 0.2),
  });

  let ty = 650;
  const slots = run.alignedPages || [];
  for (const slot of slots.slice(0, 18)) {
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
      color: rgb(0.98, 0.99, 1),
      borderColor: rgb(0.88, 0.91, 0.95),
      borderWidth: 0.75,
    });
    cover.drawText(`Slot ${slot.slotIndex}`, { x: 52, y: ty + 2, size: 9.5, font: fontBold, color: rgb(0.1, 0.14, 0.2) });
    cover.drawText(
      slot.baselinePageNum ? `Source Page ${slot.baselinePageNum}${slot.baselineBlank ? ' (Blank)' : ''}` : 'NO PAGE (Missing in Source)',
      { x: 130, y: ty + 2, size: 9.5, font: fontMono, color: slot.baselinePageNum ? rgb(0.12, 0.16, 0.22) : rgb(0.75, 0.07, 0.24) }
    );
    cover.drawText(
      slot.candidatePageNum ? `Dest Page ${slot.candidatePageNum}${slot.candidateBlank ? ' (White/Blank)' : ''}` : 'NO PAGE (Missing in Dest)',
      { x: 355, y: ty + 2, size: 9.5, font: fontMono, color: slot.candidatePageNum ? rgb(0.12, 0.16, 0.22) : rgb(0.75, 0.07, 0.24) }
    );
    cover.drawRectangle({ x: 585, y: ty - 2, width: 120, height: 16, color: badgeCol.fill, borderColor: badgeCol.stroke, borderWidth: 1 });
    cover.drawText(slot.status.replace(/_/g, ' '), { x: 591, y: ty + 2, size: 8, font: fontBold, color: badgeCol.stroke });
    cover.drawText(sanitizePdfText(slot.summary), { x: 720, y: ty + 2, size: 9, font: fontReg, color: rgb(0.25, 0.3, 0.38) });
    ty -= 28;
  }

  // Render Each Aligned Page Pair Side-by-Side
  const sheetW = 1240;
  const sheetH = 860;
  const frameW = 540;
  const frameH = 680;
  const leftX = 48;
  const rightX = 652;
  const frameY = 105;

  for (const slot of slots) {
    const sheet = reportDoc.addPage([sheetW, sheetH]);
    const slotDiffs = run.textDiffs.filter((d) => d.slotIndex === slot.slotIndex && d.diffCategory !== 'EQUAL');

    // Top Header Banner
    sheet.drawRectangle({ x: 0, y: sheetH - 54, width: sheetW, height: 54, color: rgb(0.08, 0.15, 0.28) });
    sheet.drawText(
      sanitizePdfText(
        `Slot ${slot.slotIndex} of ${slots.length}  |  Source: ${
          slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'No White/Blank Page'
        }   vs   Destination: ${
          slot.candidatePageNum ? `Page ${slot.candidatePageNum}${slot.candidateBlank ? ' (Inserted Blank)' : ''}` : 'Missing'
        }`
      ),
      { x: 48, y: sheetH - 32, size: 13, font: fontBold, color: rgb(1, 1, 1) }
    );
    sheet.drawText(sanitizePdfText(slot.summary), {
      x: 48,
      y: sheetH - 47,
      size: 9.5,
      font: fontReg,
      color: rgb(0.82, 0.88, 0.96),
    });

    // Left / Right Frame Titles
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

    // Draw Left (Source) Side
    if (slot.baselinePageNum !== null) {
      const bPageIdx = slot.baselinePageNum - 1;
      const srcPageObj = srcDoc.getPage(bPageIdx);
      const { width: pw, height: ph } = srcPageObj.getSize();
      const scale = Math.min(frameW / pw, frameH / ph);
      const drawW = pw * scale;
      const drawH = ph * scale;

      sheet.drawRectangle({
        x: leftX,
        y: frameY,
        width: drawW,
        height: drawH,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.75, 0.8, 0.88),
        borderWidth: 1,
      });

      const hasSrcContents = Boolean(srcPageObj.node.normalizedEntries().Contents);
      if (hasSrcContents) {
        try {
          const [embedded] = await reportDoc.embedPdf(srcDoc, [bPageIdx]);
          sheet.drawPage(embedded, { x: leftX, y: frameY, width: drawW, height: drawH });
        } catch {
          sheet.drawText(slot.baselineBlank ? '(Blank / White Page in Source)' : '(Page content embedded)', {
            x: leftX + 24,
            y: frameY + drawH / 2,
            size: 11,
            font: fontReg,
            color: rgb(0.45, 0.5, 0.58),
          });
        }
      } else {
        sheet.drawText('(Blank / White Page in Source)', {
          x: leftX + 24,
          y: frameY + drawH / 2,
          size: 11,
          font: fontReg,
          color: rgb(0.45, 0.5, 0.58),
        });
      }

      // Highlight diffs directly on Source page
      const bLayouts = (run.pdfDetails?.baselineLayouts || []).filter((l) => l.page === slot.baselinePageNum);
      for (const d of slotDiffs) {
        if (d.baselineLineNum !== null) {
          const lay = bLayouts[d.baselineLineNum - 1];
          if (lay) {
            const c = categoryRgb(d.diffCategory);
            const rx = leftX + Math.max(0, (lay.x - 4) * scale);
            const ry = frameY + Math.max(0, (lay.y - 3) * scale);
            const rw = Math.min(drawW - (rx - leftX) - 6, Math.max(lay.width, 80) * scale + 8);
            const rh = Math.max(lay.fontSize, lay.height, 10) * scale + 6;
            sheet.drawRectangle({
              x: rx,
              y: ry,
              width: rw,
              height: rh,
              color: c.fill,
              opacity: 0.45,
              borderColor: c.stroke,
              borderWidth: 1.4,
            });
          }
        }
      }
    } else {
      // Missing in Source placeholder box (e.g., Dest Page 3 is inserted white page)
      const c = categoryRgb('ADDED_CONTENT');
      sheet.drawRectangle({
        x: leftX,
        y: frameY,
        width: frameW,
        height: frameH,
        color: rgb(0.98, 0.98, 0.99),
        borderColor: c.stroke,
        borderWidth: 1.5,
      });
      sheet.drawText('NO CORRESPONDING PAGE IN SOURCE FILE', {
        x: leftX + 115,
        y: frameY + frameH / 2 + 16,
        size: 13,
        font: fontBold,
        color: c.stroke,
      });
      sheet.drawText(
        slot.candidateBlank
          ? `Destination Page ${slot.candidatePageNum} is an inserted white/blank page.`
          : `Destination Page ${slot.candidatePageNum} was inserted here.`,
        {
          x: leftX + 95,
          y: frameY + frameH / 2 - 8,
          size: 10.5,
          font: fontReg,
          color: rgb(0.3, 0.36, 0.44),
        }
      );
      sheet.drawText('Subsequent pages remain aligned side-by-side.', {
        x: leftX + 135,
        y: frameY + frameH / 2 - 26,
        size: 10,
        font: fontReg,
        color: rgb(0.42, 0.48, 0.56),
      });
    }

    // Draw Right (Destination) Side
    if (slot.candidatePageNum !== null) {
      const cPageIdx = slot.candidatePageNum - 1;
      const dstPageObj = dstDoc.getPage(cPageIdx);
      const { width: pw, height: ph } = dstPageObj.getSize();
      const scale = Math.min(frameW / pw, frameH / ph);
      const drawW = pw * scale;
      const drawH = ph * scale;

      const isInsertedBlank = slot.baselinePageNum === null && slot.candidateBlank;
      sheet.drawRectangle({
        x: rightX,
        y: frameY,
        width: drawW,
        height: drawH,
        color: rgb(1, 1, 1),
        borderColor: isInsertedBlank ? categoryRgb('ADDED_CONTENT').stroke : rgb(0.75, 0.8, 0.88),
        borderWidth: isInsertedBlank ? 2 : 1,
      });

      const hasDstContents = Boolean(dstPageObj.node.normalizedEntries().Contents);
      if (hasDstContents) {
        try {
          const [embedded] = await reportDoc.embedPdf(dstDoc, [cPageIdx]);
          sheet.drawPage(embedded, { x: rightX, y: frameY, width: drawW, height: drawH });
        } catch {
          // empty PDF content stream (blank white page)
        }
      }

      if (slot.candidateBlank) {
        const c = categoryRgb('ADDED_CONTENT');
        sheet.drawRectangle({
          x: rightX + 32,
          y: frameY + drawH / 2 - 24,
          width: drawW - 64,
          height: 54,
          color: c.fill,
          opacity: 0.75,
          borderColor: c.stroke,
          borderWidth: 1.5,
        });
        sheet.drawText(`INSERTED WHITE / BLANK PAGE (DEST PAGE ${slot.candidatePageNum})`, {
          x: rightX + 68,
          y: frameY + drawH / 2 + 4,
          size: 11,
          font: fontBold,
          color: c.stroke,
        });
        sheet.drawText('No corresponding white page exists at this position in Source File.', {
          x: rightX + 74,
          y: frameY + drawH / 2 - 14,
          size: 9.5,
          font: fontReg,
          color: rgb(0.15, 0.2, 0.28),
        });
      }

      // Highlight diffs directly on Destination page
      const cLayouts = (run.pdfDetails?.candidateLayouts || []).filter((l) => l.page === slot.candidatePageNum);
      for (const d of slotDiffs) {
        if (d.candidateLineNum !== null) {
          const lay = cLayouts[d.candidateLineNum - 1];
          if (lay) {
            const c = categoryRgb(d.diffCategory);
            const rx = rightX + Math.max(0, (lay.x - 4) * scale);
            const ry = frameY + Math.max(0, (lay.y - 3) * scale);
            const rw = Math.min(drawW - (rx - rightX) - 6, Math.max(lay.width, 80) * scale + 8);
            const rh = Math.max(lay.fontSize, lay.height, 10) * scale + 6;
            sheet.drawRectangle({
              x: rx,
              y: ry,
              width: rw,
              height: rh,
              color: c.fill,
              opacity: 0.45,
              borderColor: c.stroke,
              borderWidth: 1.4,
            });
          }
        }
      }
    } else {
      const c = categoryRgb('MISSING_CONTENT');
      sheet.drawRectangle({
        x: rightX,
        y: frameY,
        width: frameW,
        height: frameH,
        color: rgb(1, 0.97, 0.98),
        borderColor: c.stroke,
        borderWidth: 1.5,
      });
      sheet.drawText(`PAGE MISSING IN DESTINATION FILE (SOURCE PAGE ${slot.baselinePageNum})`, {
        x: rightX + 65,
        y: frameY + frameH / 2 + 8,
        size: 12,
        font: fontBold,
        color: c.stroke,
      });
    }

    // Bottom Diff Summary Bar on each sheet
    sheet.drawRectangle({ x: 48, y: 18, width: 1144, height: 74, color: rgb(0.97, 0.98, 0.99), borderColor: rgb(0.86, 0.89, 0.94), borderWidth: 0.8 });
    if (slotDiffs.length === 0) {
      sheet.drawText('No visual or text differences detected in this aligned page pair.', {
        x: 62,
        y: 50,
        size: 10,
        font: fontBold,
        color: rgb(0.09, 0.55, 0.29),
      });
    } else {
      let dy = 74;
      for (const d of slotDiffs.slice(0, 4)) {
        const c = categoryRgb(d.diffCategory);
        const notes = [d.positionDelta, d.fontDelta, d.controlDelta].filter(Boolean).join(' · ');
        const msg = sanitizePdfText(
          `[${c.label}] Src: "${d.baselineText || '(absent)'}"  |  Dst: "${d.candidateText || '(missing)'}"${notes ? `  (${notes})` : ''}`
        );
        sheet.drawText(msg, { x: 62, y: dy, size: 8.5, font: fontMono, color: c.stroke });
        dy -= 15;
      }
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

function renderSlotVisualPageHtml(
  rec: StoredRunRecord,
  slot: AlignedPageSlot,
  side: 'baseline' | 'candidate',
  slotDiffs: TextDiffLine[]
): string {
  const { run } = rec;
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

  if (run.format === 'PDF' && run.pdfDetails) {
    const layouts = (side === 'baseline' ? run.pdfDetails.baselineLayouts : run.pdfDetails.candidateLayouts).filter(
      (l) => l.page === pageNum
    );
    const dims =
      (side === 'baseline' ? run.pdfDetails.baselinePageDims?.[pageNum - 1] : run.pdfDetails.candidatePageDims?.[pageNum - 1]) || {
        width: 612,
        height: 792,
      };
    const scale = 420 / dims.width;
    const hPx = Math.round(dims.height * scale);

    const diffMap = new Map<number, DiffCategory>();
    for (const d of slotDiffs) {
      const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
      if (ln !== null) diffMap.set(ln, d.diffCategory);
    }

    const itemsHtml = layouts
      .map((l, i) => {
        const lineNum = i + 1;
        const cat = diffMap.get(lineNum);
        const topPx = Math.round((dims.height - l.y - l.fontSize) * scale);
        const leftPx = Math.round(l.x * scale);
        const fontPx = Math.max(7, Math.round(l.fontSize * scale));
        const hlStyle = cat
          ? (() => {
              const c = categoryRgb(cat);
              return `background:${c.bgHex};outline:1.5px solid ${c.hex};padding:1px 3px;border-radius:2px;`;
            })()
          : '';
        return `<div style="position:absolute;left:${leftPx}px;top:${topPx}px;font-size:${fontPx}px;line-height:1.15;white-space:nowrap;${hlStyle}">${escapeHtml(
          l.text
        )}</div>`;
      })
      .join('');

    return `<div class="page-sheet canvas-sheet" style="width:420px;height:${hPx}px;">${itemsHtml}</div>`;
  }

  if (run.format === 'AFP' && run.afpDetails) {
    const runs = (side === 'baseline' ? run.afpDetails.baselinePtocaRuns : run.afpDetails.candidatePtocaRuns).filter(
      (r) => r.pageIndex === pageNum
    );
    const geo =
      (side === 'baseline' ? run.afpDetails.baselineGeometry[0] : run.afpDetails.candidateGeometry[0]) || {
        widthUnits: 2040,
        heightUnits: 2640,
      };
    const wPx = 420;
    const hPx = Math.round((geo.heightUnits / geo.widthUnits) * wPx);

    const diffMap = new Map<number, DiffCategory>();
    for (const d of slotDiffs) {
      const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
      if (ln !== null) diffMap.set(ln, d.diffCategory);
    }

    const itemsHtml = runs
      .map((r, i) => {
        const cat = diffMap.get(i + 1);
        const lx = Math.round((r.x / geo.widthUnits) * wPx);
        const ly = Math.round((r.y / geo.heightUnits) * hPx);
        const hlStyle = cat
          ? (() => {
              const c = categoryRgb(cat);
              return `background:${c.bgHex};outline:1.5px solid ${c.hex};padding:1px 3px;border-radius:2px;`;
            })()
          : '';
        return `<div style="position:absolute;left:${lx}px;top:${ly}px;font-family:monospace;font-size:9.5px;white-space:nowrap;${hlStyle}">${escapeHtml(
          r.text
        )}</div>`;
      })
      .join('');

    return `<div class="page-sheet canvas-sheet" style="width:${wPx}px;height:${hPx}px;">${itemsHtml}</div>`;
  }

  // PCL or RT rendered lines with highlight boxes
  const linesHtml = run.textDiffs
    .filter((d) => d.slotIndex === slot.slotIndex)
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

  const slotsHtml = slots
    .map((slot) => {
      const slotDiffs = run.textDiffs.filter((d) => d.slotIndex === slot.slotIndex && d.diffCategory !== 'EQUAL');
      const statusBadge =
        slot.status === 'INSERTED_IN_CANDIDATE'
          ? '<span class="badge" style="background:#CCFBF1;color:#0D9488;border-color:#5EEAD4;">Inserted Page in Dest</span>'
          : slot.status === 'MISSING_IN_CANDIDATE'
          ? '<span class="badge" style="background:#FFE4E6;color:#BE123C;border-color:#FDA4AF;">Missing Page in Dest</span>'
          : slot.status === 'DIFF_DETECTED'
          ? `<span class="badge" style="background:#FEE2E2;color:#DC2626;border-color:#FCA5A5;">${slot.diffCount} Difference(s)</span>`
          : '<span class="badge" style="background:#ECFDF5;color:#047857;border-color:#A7F3D0;">Matched</span>';

      return `
      <section class="slot-card">
        <div class="slot-head">
          <div>
            <strong>Slot ${slot.slotIndex}</strong> ·
            Source: <code>${slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'None (Absent)'}</code> ↔
            Destination: <code>${slot.candidatePageNum ? `Page ${slot.candidatePageNum}` : 'None (Missing)'}</code>
          </div>
          ${statusBadge}
        </div>
        <div class="slot-summary">${escapeHtml(slot.summary)}</div>
        <div class="two-up">
          <div class="col">
            <div class="col-title">IMDS Source Baseline (${escapeHtml(run.baseline.filename)})</div>
            ${renderSlotVisualPageHtml(rec, slot, 'baseline', slotDiffs)}
          </div>
          <div class="col">
            <div class="col-title">DDGS Destination Candidate (${escapeHtml(run.candidate.filename)})</div>
            ${renderSlotVisualPageHtml(rec, slot, 'candidate', slotDiffs)}
          </div>
        </div>
        ${
          slotDiffs.length > 0
            ? `<div class="slot-diffs">
                <table>
                  <thead><tr><th>Type</th><th>Line</th><th>Source (Baseline)</th><th>Destination (Candidate)</th><th>Layout / Control Delta</th></tr></thead>
                  <tbody>
                    ${slotDiffs
                      .map((d) => {
                        const c = categoryRgb(d.diffCategory);
                        const notes = [d.positionDelta, d.fontDelta, d.controlDelta, d.criticalReason].filter(Boolean).join(' · ');
                        return `<tr style="background:${c.bgHex}55;">
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
  <title>${escapeHtml(run.id)} Visual Side-by-Side Diff Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px; font-size:13px; }
    .container { max-width: 1120px; margin: 0 auto; }
    .header { background:#0f172a; color:#fff; padding:20px 24px; border-radius:8px; margin-bottom:18px; }
    .header h1 { margin:0 0 6px; font-size:18px; }
    .meta { font-size:12px; color:#cbd5e1; }
    .legend { display:flex; flex-wrap:wrap; gap:10px; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; margin-bottom:18px; align-items:center; }
    .badge { display:inline-block; border:1px solid; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:600; }
    .slot-card { background:#fff; border:1px solid #cbd5e1; border-radius:8px; margin-bottom:20px; overflow:hidden; page-break-inside:avoid; }
    .slot-head { display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; }
    .slot-summary { padding:8px 16px; font-size:12px; color:#475569; border-bottom:1px solid #f1f5f9; }
    .two-up { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px; background:#f8fafc; }
    .col-title { font-size:11px; font-weight:600; color:#334155; margin-bottom:8px; }
    .page-sheet { background:#fff; border:1px solid #cbd5e1; box-shadow:0 1px 3px rgba(0,0,0,0.06); position:relative; overflow:hidden; margin:0 auto; }
    .lines-sheet { padding:10px; font-family:monospace; font-size:11px; min-height:220px; width:100%; box-sizing:border-box; }
    .text-line { padding:2px 6px; white-space:pre-wrap; word-break:break-word; }
    .empty-slot { width:420px; height:420px; display:flex; align-items:center; justify-content:center; border:2px dashed; text-align:center; padding:24px; box-sizing:border-box; }
    .blank-slot { width:420px; height:420px; display:flex; align-items:center; justify-content:center; border:2px solid #0D9488; background:#ffffff; }
    .blank-banner { background:#CCFBF1; color:#0D9488; border:1px solid #0D9488; padding:10px 16px; border-radius:6px; font-weight:600; font-size:12px; }
    .slot-diffs { padding:0 16px 16px; }
    table { width:100%; border-collapse:collapse; font-size:11.5px; }
    th, td { border:1px solid #e2e8f0; padding:6px 8px; text-align:left; vertical-align:top; }
    th { background:#f8fafc; color:#475569; }
    .mono { font-family:monospace; }
    .muted { color:#94a3b8; font-style:italic; }
    @media print { body { padding:0; background:#fff; } .slot-card { break-inside:avoid; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>DocVerify QE — Side-by-Side Visual Difference Report (${escapeHtml(run.id)})</h1>
      <div class="meta">
        Format: ${escapeHtml(run.format)} · Outcome: ${escapeHtml(run.overallOutcome)} ·
        Source: ${escapeHtml(run.baseline.filename)} (${run.baseline.pageCount} page(s)) ·
        Destination: ${escapeHtml(run.candidate.filename)} (${run.candidate.pageCount} page(s)) ·
        Aligned Slots: ${slots.length}
      </div>
      <div class="meta" style="margin-top:4px;">
        SHA-256 Source: ${escapeHtml(run.baseline.sha256)} · SHA-256 Dest: ${escapeHtml(run.candidate.sha256)}
      </div>
    </div>

    <div class="legend">
      <strong>Difference Color Legend:</strong>
      ${(['TEXT_CHANGE', 'ALIGNMENT_SHIFT', 'FONT_STYLE', 'MISSING_CONTENT', 'ADDED_CONTENT', 'CONTROL_METADATA'] as DiffCategory[])
        .map((cat) => {
          const c = categoryRgb(cat);
          return `<span class="badge" style="background:${c.bgHex};color:${c.hex};border-color:${c.hex};">${c.label}</span>`;
        })
        .join('')}
    </div>

    ${slotsHtml}
  </div>
</body>
</html>`;
}
