import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { runComparisonEngine } from '../server/adapters.ts';
import { initializeSyntheticStore } from '../server/fixtures.ts';
import { INVENTORY_CONFIGS } from '../server/fixtures.ts';
import { generateHighlightedHtmlReport, generateHighlightedPdfDiffReport } from '../server/reportExport.ts';
import {
  redactSensitiveText,
  safeGunzip,
  sanitizeFilename,
  validateInventoryConfig,
} from '../server/security.ts';

test('redactSensitiveText masks SSN, email, tokens, and account numbers', () => {
  const raw = 'SSN 123-45-6789 Email qa@example.com Acct 4411223344556677 Bearer abcdef123456';
  const res = redactSensitiveText(raw);
  assert.equal(res.matchCount, 4);
  assert.ok(!res.redactedText.includes('123-45-6789'));
  assert.ok(!res.redactedText.includes('qa@example.com'));
  assert.ok(!res.redactedText.includes('4411223344556677'));
  assert.ok(res.redactedText.includes('****-****-6677'));
});

test('sanitizeFilename blocks path traversal attempts', () => {
  const bad = sanitizeFilename('../../etc/passwd');
  assert.equal(bad.rejected, true);
  const good = sanitizeFilename('IMDS_CHK_STMT_001.pdf');
  assert.equal(good.rejected, false);
});

test('safeGunzip rejects corrupt and nested gzip streams', () => {
  const corrupt = safeGunzip(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad]), 'bad.rt.gz');
  assert.equal(corrupt.ok, false);

  const nestedPayload = zlib.gzipSync(zlib.gzipSync(Buffer.from('hello', 'utf8')));
  const nested = safeGunzip(nestedPayload, 'nested.rt.gz');
  assert.equal(nested.ok, false);
  assert.equal(nested.nestedCompressionDetected, true);
});

test('validateInventoryConfig rejects production submission and unapproved PII', () => {
  const badProd = { ...INVENTORY_CONFIGS[0], productionSubmissionAllowed: true as unknown as false };
  const r1 = validateInventoryConfig(badProd);
  assert.equal(r1.valid, false);
  assert.ok(r1.blockerReasons.some((b) => b.includes('Production submission')));

  const badPii = { ...INVENTORY_CONFIGS[0], piiTokenizationApproved: false };
  const r2 = validateInventoryConfig(badPii);
  assert.equal(r2.valid, false);
});

test('runComparisonEngine never marks empty/corrupt output as pass and enforces AFP Papyrus review', async () => {
  const emptyRes = await runComparisonEngine({
    runId: 'TEST-BLK-1',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: Buffer.from('HEADER\r\nRECORD COUNT: 1\r\n', 'utf8'),
    baselineFilename: 'IMDS_TEST.rt',
    candidateBuffer: Buffer.alloc(0),
    candidateFilename: 'DDGS_TEST.rt',
  });
  assert.equal(emptyRes.run.overallOutcome, 'BLOCKED');

  const rtText = Buffer.from('HEADER\r\nGRAND TOTAL: $100.00\r\n', 'utf8');
  const passRes = await runComparisonEngine({
    runId: 'TEST-PASS-1',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: rtText,
    baselineFilename: 'IMDS_TEST.rt',
    candidateBuffer: rtText,
    candidateFilename: 'DDGS_TEST.rt',
  });
  assert.equal(passRes.run.overallOutcome, 'VERIFIED_PASS');
});

test('direct native AFP engine decodes EBCDIC TLEs, IMM drift, and PTOCA coordinates without PDF conversion', async () => {
  const store = await initializeSyntheticStore();
  const afpRun = store.get('RUN-2026-1104')?.run;
  assert.ok(afpRun);
  assert.equal(afpRun.afpDetails?.validationMode, 'DIRECT_MODCA_NATIVE');
  assert.ok(afpRun.afpDetails!.baselineTles.length >= 3);
  assert.ok(afpRun.afpDetails!.baselinePtocaRuns.length >= 4);
  assert.ok(afpRun.findings.some((f) => f.category.includes('IMM')));
  assert.ok(afpRun.findings.some((f) => f.category.includes('TLE')));
  assert.ok(afpRun.findings.some((f) => f.category.includes('PTOCA')));
});

test('side-by-side diff engine classifies TEXT_CHANGE, ALIGNMENT_SHIFT, FONT_STYLE, MISSING_CONTENT, and CONTROL_METADATA', async () => {
  const store = await initializeSyntheticStore();

  // PDF: Page 1 pure ALIGNMENT_SHIFT + Page 2 TEXT_CHANGE / ALIGNMENT_SHIFT / FONT_STYLE + inline tokens
  const pdfRun = store.get('RUN-2026-1101')?.run;
  assert.ok(pdfRun);
  assert.ok(pdfRun.pdfDetails && pdfRun.pdfDetails.baselineLayouts.length > 0);
  const p1Align = pdfRun.textDiffs.find((d) => d.pageOrSection === 'Page 1' && d.diffCategory === 'ALIGNMENT_SHIFT');
  assert.ok(p1Align, 'Expected pure ALIGNMENT_SHIFT on PDF Page 1');
  const p2Fee = pdfRun.textDiffs.find((d) => d.pageOrSection === 'Page 2' && d.diffCategory === 'TEXT_CHANGE');
  assert.ok(p2Fee && p2Fee.candidateTokens && p2Fee.candidateTokens.some((t) => t.changed));

  // PCL: CONTROL_METADATA / FONT_STYLE / MISSING_CONTENT
  const pclRun = store.get('RUN-2026-1102')?.run;
  assert.ok(pclRun);
  assert.ok(pclRun.textDiffs.some((d) => d.diffCategory === 'CONTROL_METADATA'));
  assert.ok(pclRun.textDiffs.some((d) => d.diffCategory === 'MISSING_CONTENT'));

  // AFP: ALIGNMENT_SHIFT + FONT_STYLE on PTOCA coordinate row
  const afpRun = store.get('RUN-2026-1104')?.run;
  assert.ok(afpRun);
  assert.ok(
    afpRun.textDiffs.some(
      (d) =>
        d.diffCategory === 'ALIGNMENT_SHIFT' &&
        (d.secondaryCategories?.includes('FONT_STYLE') ?? false)
    )
  );

  // RT Defect fixture: TEXT_CHANGE + ALIGNMENT_SHIFT + MISSING_CONTENT + CONTROL_METADATA aligned cleanly
  const rtDefect = store.get('RUN-2026-1106')?.run;
  assert.ok(rtDefect);
  assert.equal(rtDefect.overallOutcome, 'CONFIRMED_DEFECT');
  assert.ok(rtDefect.textDiffs.some((d) => d.diffCategory === 'TEXT_CHANGE'));
  assert.ok(rtDefect.textDiffs.some((d) => d.diffCategory === 'ALIGNMENT_SHIFT'));
  assert.ok(rtDefect.textDiffs.some((d) => d.diffCategory === 'MISSING_CONTENT'));
  assert.ok(rtDefect.textDiffs.some((d) => d.diffCategory === 'CONTROL_METADATA'));
  // Ensure trailing EQUAL footer stays aligned despite omitted row above
  assert.ok(rtDefect.textDiffs.some((d) => d.diffCategory === 'EQUAL' && d.baselineText.includes('END OF REPORT')));
});

test('alignDocumentPages handles 6-vs-7 pages with inserted blank Page 3 and exports highlighted PDF and HTML reports', async () => {
  const store = await initializeSyntheticStore();
  const rec = store.get('RUN-2026-1107');
  assert.ok(rec);
  const { run } = rec;

  assert.equal(run.baseline.pageCount, 6);
  assert.equal(run.candidate.pageCount, 7);
  assert.equal(run.alignedPages.length, 7);

  // Slot 1 & 2 match 1:1
  assert.equal(run.alignedPages[0].baselinePageNum, 1);
  assert.equal(run.alignedPages[0].candidatePageNum, 1);
  assert.equal(run.alignedPages[0].status, 'MATCHED');

  assert.equal(run.alignedPages[1].baselinePageNum, 2);
  assert.equal(run.alignedPages[1].candidatePageNum, 2);
  assert.equal(run.alignedPages[1].status, 'MATCHED');

  // Slot 3 detects inserted white/blank page at Destination Page 3 (no white page in Source)
  const slot3 = run.alignedPages[2];
  assert.equal(slot3.baselinePageNum, null);
  assert.equal(slot3.candidatePageNum, 3);
  assert.equal(slot3.candidateBlank, true);
  assert.equal(slot3.status, 'INSERTED_IN_CANDIDATE');

  // Slot 4..7 continue matching Source Pages 3..6 with Destination Pages 4..7!
  assert.equal(run.alignedPages[3].baselinePageNum, 3);
  assert.equal(run.alignedPages[3].candidatePageNum, 4);
  assert.equal(run.alignedPages[3].status, 'MATCHED');

  assert.equal(run.alignedPages[4].baselinePageNum, 4);
  assert.equal(run.alignedPages[4].candidatePageNum, 5);
  assert.equal(run.alignedPages[4].status, 'MATCHED');

  // Slot 6 aligns Source Page 5 with Dest Page 6 and catches the actual fee + alignment diffs!
  const slot6 = run.alignedPages[5];
  assert.equal(slot6.baselinePageNum, 5);
  assert.equal(slot6.candidatePageNum, 6);
  assert.equal(slot6.status, 'DIFF_DETECTED');
  assert.ok(slot6.diffCount >= 2);

  assert.equal(run.alignedPages[6].baselinePageNum, 6);
  assert.equal(run.alignedPages[6].candidatePageNum, 7);
  assert.equal(run.alignedPages[6].status, 'MATCHED');

  // Verify downloadable Highlighted PDF Report builds cleanly with 1 cover + 7 side-by-side sheets = 8 pages
  const pdfReportBuf = await generateHighlightedPdfDiffReport(rec);
  assert.equal(pdfReportBuf.subarray(0, 5).toString('ascii'), '%PDF-');
  const loadedReport = await PDFDocument.load(pdfReportBuf);
  assert.equal(loadedReport.getPageCount(), 8);

  // Verify downloadable Highlighted HTML Visual Report renders all aligned slots
  const htmlReport = generateHighlightedHtmlReport(rec);
  assert.ok(htmlReport.includes('RUN-2026-1107'));
  assert.ok(htmlReport.includes('No White / Blank Page in Source File'));
  assert.ok(htmlReport.includes('INSERTED WHITE / BLANK PAGE'));
});

test('CIBC real PDF forms and CIBC AFP/PCL/RT samples validate cleanly including 6-vs-7 blank page shift', async () => {
  const store = await initializeSyntheticStore();

  // RUN-2026-1108: Real CIBC PAD Form (1p vs 1p)
  const cibcPad = store.get('RUN-2026-1108');
  assert.ok(cibcPad);
  assert.equal(cibcPad.run.overallOutcome, 'CONFIRMED_DEFECT');
  assert.equal(cibcPad.run.alignedPages.length, 1);
  const padPdfOut = await generateHighlightedPdfDiffReport(cibcPad);
  assert.equal(padPdfOut.subarray(0, 5).toString('ascii'), '%PDF-');

  // RUN-2026-1109: Real CIBC Form 12419 Personal Deposit Account Terms (6p vs 7p with blank Page 3)
  const cibc12419 = store.get('RUN-2026-1109');
  assert.ok(cibc12419);
  assert.equal(cibc12419.run.baseline.pageCount, 6);
  assert.equal(cibc12419.run.candidate.pageCount, 7);
  assert.equal(cibc12419.run.alignedPages.length, 7);
  assert.equal(cibc12419.run.alignedPages[2].status, 'INSERTED_IN_CANDIDATE');
  assert.equal(cibc12419.run.alignedPages[2].candidateBlank, true);
  assert.equal(cibc12419.run.alignedPages[3].baselinePageNum, 3);
  assert.equal(cibc12419.run.alignedPages[3].candidatePageNum, 4);
  assert.equal(cibc12419.run.alignedPages[5].baselinePageNum, 5);
  assert.equal(cibc12419.run.alignedPages[5].candidatePageNum, 6);
  assert.equal(cibc12419.run.alignedPages[5].status, 'DIFF_DETECTED');
  const cibc12419Pdf = await generateHighlightedPdfDiffReport(cibc12419);
  const loadedCibcReport = await PDFDocument.load(cibc12419Pdf);
  assert.equal(loadedCibcReport.getPageCount(), 8);

  // RUN-2026-1110: Real CIBC Bank USA Smart Account Disclosures (4p vs 4p)
  const cibcUsa = store.get('RUN-2026-1110');
  assert.ok(cibcUsa);
  assert.equal(cibcUsa.run.overallOutcome, 'CONFIRMED_DEFECT');
  assert.equal(cibcUsa.run.alignedPages.length, 4);

  // CIBC Mellon + AFP + PCL + RT file-pair samples in samples/cibc/
  const cibcDir = path.resolve(process.cwd(), 'samples/cibc');
  const mellonRes = await runComparisonEngine({
    runId: 'TEST-CIBC-MELLON',
    config: INVENTORY_CONFIGS[0],
    format: 'PDF',
    baselineBuffer: fs.readFileSync(path.join(cibcDir, 'IMDS_CIBC_MELLON_DD_SRC.pdf')),
    baselineFilename: 'IMDS_CIBC_MELLON_DD_SRC.pdf',
    candidateBuffer: fs.readFileSync(path.join(cibcDir, 'DDGS_CIBC_MELLON_DD_DST_DEFECT.pdf')),
    candidateFilename: 'DDGS_CIBC_MELLON_DD_DST_DEFECT.pdf',
  });
  assert.equal(mellonRes.run.overallOutcome, 'CONFIRMED_DEFECT');

  const afpRes = await runComparisonEngine({
    runId: 'TEST-CIBC-AFP',
    config: INVENTORY_CONFIGS[3],
    format: 'AFP',
    baselineBuffer: fs.readFileSync(path.join(cibcDir, 'IMDS_CIBC_DDA_STMT.afp')),
    baselineFilename: 'IMDS_CIBC_DDA_STMT.afp',
    candidateBuffer: fs.readFileSync(path.join(cibcDir, 'DDGS_CIBC_DDA_STMT.afp')),
    candidateFilename: 'DDGS_CIBC_DDA_STMT.afp',
  });
  assert.equal(afpRes.run.afpDetails?.validationMode, 'DIRECT_MODCA_NATIVE');
  assert.ok(afpRes.run.findings.some((f) => f.category.includes('IMM')));

  const pclRes = await runComparisonEngine({
    runId: 'TEST-CIBC-PCL',
    config: INVENTORY_CONFIGS[1],
    format: 'PCL',
    baselineBuffer: fs.readFileSync(path.join(cibcDir, 'IMDS_CIBC_MTG_ESCROW.pcl')),
    baselineFilename: 'IMDS_CIBC_MTG_ESCROW.pcl',
    candidateBuffer: fs.readFileSync(path.join(cibcDir, 'DDGS_CIBC_MTG_ESCROW.pcl')),
    candidateFilename: 'DDGS_CIBC_MTG_ESCROW.pcl',
  });
  assert.equal(pclRes.run.overallOutcome, 'CONFIRMED_DEFECT');

  const rtRes = await runComparisonEngine({
    runId: 'TEST-CIBC-RT',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: fs.readFileSync(path.join(cibcDir, 'IMDS_CIBC_DAILY_RECON.rpt')),
    baselineFilename: 'IMDS_CIBC_DAILY_RECON.rpt',
    candidateBuffer: fs.readFileSync(path.join(cibcDir, 'DDGS_CIBC_DAILY_RECON.rpt')),
    candidateFilename: 'DDGS_CIBC_DAILY_RECON.rpt',
  });
  assert.equal(rtRes.run.overallOutcome, 'CONFIRMED_DEFECT');
  assert.ok(rtRes.run.textDiffs.some((d) => d.diffCategory === 'MISSING_CONTENT'));
});

test('image-scanned PDF pages are never misclassified as blank white pages', async () => {
  const scanPath = path.resolve(process.cwd(), 'public/assets/aistudio/Scan_20261120_105615_0b84c2e5.pdf');
  const scanBuf = fs.readFileSync(scanPath);
  const res = await runComparisonEngine({
    runId: 'TEST-SCAN-IMG',
    config: INVENTORY_CONFIGS[0],
    format: 'PDF',
    baselineBuffer: scanBuf,
    baselineFilename: 'Scan_20261120_105615_0b84c2e5.pdf',
    candidateBuffer: scanBuf,
    candidateFilename: 'Scan_20261120_105615_0b84c2e5.pdf',
  });
  assert.equal(res.run.baseline.pageCount, 8);
  assert.equal(res.run.alignedPages.length, 8);
  assert.equal(
    res.run.alignedPages.filter((s) => s.baselineBlank).length,
    0,
    'Scanned raster pages must not be flagged as blank white pages'
  );
});

test('6-vs-7 CIBC hybrid PDF with leading blank Page 1 and sparse/raster pages 4-5 stays aligned across all 7 slots', async () => {
  const { StandardFonts, rgb } = await import('pdf-lib');

  const makeDoc = async (isDest: boolean) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    if (isDest) {
      // Dest Page 1 is an inserted white/blank page
      doc.addPage([612, 792]);
    }

    const addTextPage = (lines: string[]) => {
      const p = doc.addPage([612, 792]);
      lines.forEach((l, idx) => p.drawText(l, { x: 48, y: 730 - idx * 20, size: 10, font, color: rgb(0.1, 0.1, 0.1) }));
    };

    // Content Page 1 (Src P1, Dst P2) - plus DDGS mailroom barcode & small wrap difference
    addTextPage([
      ...(isDest ? ['*070202000000*'] : []),
      'CIBC BUSINESS BANKING',
      'Restricting Professional Trustee Designation to Accounts',
      'Account Terms and Professional Trustee Rules Section 1',
      'Authorized Signatory Verification and Compliance Details',
    ]);

    // Content Page 2 (Src P2, Dst P3)
    addTextPage([
      'Additional Terms and Conditions for Trustee Accounts',
      'CDIC Disclosure Requirements and Reporting Obligations',
      'Beneficiary Schedule and Notice Provisions',
    ]);

    // Content Page 3 (Src P3, Dst P4)
    addTextPage([
      'CIBC Trust Account Information Form (CDIC)',
      'Account Information and Beneficiary Breakdown',
      'Please return completed form to CIBC Branch Transit',
    ]);

    // Content Page 4 (Src P4, Dst P5) - hybrid/sparse signature page (raster/vector heavy in Dest)
    const p4 = doc.addPage([612, 792]);
    for (let k = 0; k < 12; k++) {
      p4.drawRectangle({ x: 50, y: 300 + k * 10, width: 220, height: 4, color: rgb(0.95, 0.95, 0.95) });
    }
    if (!isDest) {
      p4.drawText('Your Privacy - Account Holder Signature', { x: 48, y: 700, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    }

    // Content Page 5 (Src P5, Dst P6) - CDIC table page (sparse/vector heavy in Dest)
    const p5 = doc.addPage([612, 792]);
    for (let k = 0; k < 12; k++) {
      p5.drawRectangle({ x: 50, y: 280 + k * 12, width: 280, height: 5, color: rgb(0.94, 0.94, 0.94) });
    }
    if (!isDest) {
      p5.drawText('CIBC CDIC Professional Trustee Account Information', { x: 48, y: 720, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
      p5.drawText('Legal Name of Trustee | Account Number | Privacy', { x: 48, y: 690, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    }

    // Content Page 6 (Src P6, Dst P7) - Acknowledgment & Privacy + barcode in Dest
    addTextPage([
      ...(isDest ? ['*070707000000*'] : []),
      'Acknowledgment of Responsibilities',
      'Record Retention and Privacy Obligations',
      'Signature of Authorized Signatory and Date',
    ]);

    return Buffer.from(await doc.save());
  };

  const srcBuf = await makeDoc(false);
  const dstBuf = await makeDoc(true);
  const res = await runComparisonEngine({
    runId: 'TEST-CIBC-HYBRID-6V7',
    config: INVENTORY_CONFIGS[0],
    format: 'PDF',
    baselineBuffer: srcBuf,
    baselineFilename: 'IMDS_CIBC_TRUSTEE_6P.pdf',
    candidateBuffer: dstBuf,
    candidateFilename: 'DDGS_CIBC_TRUSTEE_7P.pdf',
  });

  assert.equal(res.run.baseline.pageCount, 6);
  assert.equal(res.run.candidate.pageCount, 7);
  assert.equal(
    res.run.alignedPages.length,
    7,
    `Expected 7 aligned slots (not 8!), got: ${res.run.alignedPages.map((s) => `${s.baselinePageNum ?? '-'}<->${s.candidatePageNum ?? '-'}`).join(', ')}`
  );
  assert.equal(res.run.alignedPages[0].baselinePageNum, null);
  assert.equal(res.run.alignedPages[0].candidatePageNum, 1);
  assert.equal(res.run.alignedPages[0].status, 'INSERTED_IN_CANDIDATE');
  for (let p = 1; p <= 6; p++) {
    assert.equal(res.run.alignedPages[p].baselinePageNum, p);
    assert.equal(res.run.alignedPages[p].candidatePageNum, p + 1);
  }
});

test('native AFP engine extracts embedded IOCA logos, rotated Code-39 barcodes intact, DIR rules, coalesced TRN lines, and enterprise PDF/HTML reports', async () => {
  const store = await initializeSyntheticStore();
  const rec = store.get('RUN-2026-1104');
  assert.ok(rec);
  const { run } = rec;

  const details = run.afpDetails;
  assert.ok(details);
  assert.ok(details.mediaAssets && Object.keys(details.mediaAssets).length >= 2, 'Expected decoded baseline & candidate IOCA logo PNG data URIs');
  for (const uri of Object.values(details.mediaAssets)) {
    assert.ok(uri.startsWith('data:image/png;base64,'));
  }

  const bVp = details.baselineVisualPages?.[0];
  const cVp = details.candidateVisualPages?.[0];
  assert.ok(bVp && cVp);

  // Embedded IPS Page Segment -> BIM IOCA logo image present at IPS origin (180, 110)
  const bImg = bVp.elements.find((e) => e.kind === 'image');
  assert.ok(bImg && bImg.kind === 'image');
  assert.equal(bImg.x, 180);
  assert.equal(bImg.y, 110);

  // Horizontal PTOCA DIR rule present
  assert.ok(bVp.elements.some((e) => e.kind === 'rule'));

  // Rotated 270deg mailroom barcode preserved intact (NOT PII-redacted into *****_****-0001*)
  const bBarcode = bVp.elements.find((e) => e.kind === 'barcode');
  assert.ok(bBarcode && bBarcode.kind === 'barcode');
  assert.equal(bBarcode.value, '*030101100001*');
  assert.equal(bBarcode.rotation, 270);

  // Multi-TRN fragments on Y=580 coalesced into a single logical line
  const coalescedLine = bVp.elements.find(
    (e) => e.kind === 'text_line' && e.fullText.includes('REMITTANCE NOTICE:') && e.fullText.includes('Electronic statements')
  );
  assert.ok(coalescedLine, 'Expected same-baseline TRN segments to coalesce into one visual line');

  // Redaction helper must preserve *...* barcodes directly too
  assert.equal(redactSensitiveText('*070202000000*').redactedText, '*070202000000*');

  // Enterprise downloadable reports work for AFP runs in both PDF and interactive HTML formats
  const afpPdf = await generateHighlightedPdfDiffReport(rec);
  assert.equal(afpPdf.subarray(0, 5).toString('ascii'), '%PDF-');
  const loadedAfpPdf = await PDFDocument.load(afpPdf);
  assert.equal(loadedAfpPdf.getPageCount(), 2); // 1 cover + 1 aligned AFP page sheet

  const afpHtml = generateHighlightedHtmlReport(rec);
  assert.ok(afpHtml.includes('<svg'));
  assert.ok(afpHtml.includes('data:image/png;base64,'));
  assert.ok(afpHtml.includes('*030101100001*'));
});

test('complex 2-page CIBC AFP form supports BMO/IPO overlays, GOCA circles/boxes/fills, DIR/DBR tables, SEC RGB colors, G4/RGB/gray images, and visual variation diffs', async () => {
  const store = await initializeSyntheticStore();
  const rec = store.get('RUN-2026-1111');
  assert.ok(rec, 'Expected RUN-2026-1111 complex AFP form fixture to exist');
  const { run } = rec;

  assert.equal(run.format, 'AFP');
  assert.equal(run.baseline.pageCount, 2);
  assert.equal(run.candidate.pageCount, 2);
  assert.equal(run.alignedPages.length, 2);

  const details = run.afpDetails;
  assert.ok(details && details.baselineVisualPages && details.candidateVisualPages);
  assert.equal(details.baselineVisualPages.length, 2);
  assert.equal(details.candidateVisualPages.length, 2);

  const bP1 = details.baselineVisualPages[0];
  const cP1 = details.candidateVisualPages[0];
  const bP2 = details.baselineVisualPages[1];

  // BMO/IPO overlay template text merged with filled PTX form fields on Page 1
  assert.ok(
    bP1.elements.some((e) => e.kind === 'text_line' && e.fullText.includes('CIBC COMMERCIAL BANKING')),
    'Expected BMO/IPO overlay header title to render on Page 1'
  );
  assert.ok(
    bP1.elements.some((e) => e.kind === 'text_line' && e.fullText.includes('Northwind Commercial Holdings Ltd.')),
    'Expected filled PTX applicant data on Page 1'
  );

  // Checkboxes & tabular fee row diffs detected
  assert.ok(
    run.textDiffs.some((d) => d.diffCategory === 'TEXT_CHANGE' && d.baselineText.includes('Dual-Custody') && d.candidateText.includes('[ ]')),
    'Expected checkbox state change diff'
  );
  assert.ok(
    run.textDiffs.some((d) => d.diffCategory === 'ALIGNMENT_SHIFT' && d.baselineText.includes('$45.00 / txn')),
    'Expected horizontal column X-shift diff on SWIFT row'
  );

  // GOCA vector primitives (boxes + filled burgundy banner + gold cubic-bezier circle emblem)
  const p1Vecs = bP1.elements.filter((e) => e.kind === 'vector');
  assert.ok(p1Vecs.length >= 1 && p1Vecs[0].kind === 'vector');
  assert.ok(p1Vecs[0].paths.some((p) => p.fill === '#8b0029'), 'Expected GOCA burgundy filled header banner');
  assert.ok(p1Vecs[0].paths.some((p) => p.fill === '#ca8a04' && p.d.includes(' C ')), 'Expected GOCA cubic-bezier emblem circle');

  // Both horizontal DIR (w > h) and vertical DBR (h > w) PTOCA table rules extracted
  const p1Rules = bP1.elements.filter((e) => e.kind === 'rule');
  assert.ok(p1Rules.some((r) => r.kind === 'rule' && r.w > 1000 && r.h <= 10), 'Expected horizontal DIR table rules');
  assert.ok(p1Rules.some((r) => r.kind === 'rule' && r.h > 300 && r.w <= 10), 'Expected vertical DBR column divider rules');

  // SEC RGB extended text color preserved (white header on burgundy banner, burgundy headings)
  assert.ok(
    bP1.elements.some((e) => e.kind === 'text_line' && e.spans.some((s) => s.color.toLowerCase() === '#ffffff')),
    'Expected SEC RGB white header typography'
  );

  // Multiple decoded raster images (CCITT G4 logo + 24-bit RGB stamp + 8-bit grayscale signature)
  assert.ok(Object.keys(details.mediaAssets || {}).length >= 6, 'Expected decoded G4, 24-bit RGB, and 8-bit grayscale assets across both files');
  assert.ok(bP1.elements.filter((e) => e.kind === 'image').length >= 2, 'Expected G4 logo + 24-bit RGB stamp on Page 1');
  assert.ok(bP2.elements.filter((e) => e.kind === 'image').length >= 2, 'Expected G4 logo + 8-bit grayscale signature on Page 2');

  // Both horizontal BCOCA barcode and rotated 270deg mailroom barcode intact
  const barcodes = bP1.elements.filter((e) => e.kind === 'barcode');
  assert.ok(barcodes.some((b) => b.kind === 'barcode' && b.symbology === 'BCOCA' && b.value === 'CIBC12890010'));
  assert.ok(barcodes.some((b) => b.kind === 'barcode' && b.rotation === 270 && b.value === '*070202000000*'));

  // Image / Graphic Variation & Table / Border Geometry Variation findings surfaced!
  assert.ok(run.findings.some((f) => f.category === 'AFP Embedded Image / Graphic Variation'), 'Expected embedded RGB stamp variation finding');
  assert.ok(run.findings.some((f) => f.category === 'AFP Table / Border Geometry Variation'), 'Expected Page 2 border/rule omission finding');

  // Candidate Page 1 & Page 2 Enterprise PDF and HTML exports work cleanly with nested vector SVGs & multi-image PNGs
  assert.ok(cP1.elements.filter((e) => e.kind === 'image').length >= 2);
  const pdfBuf = await generateHighlightedPdfDiffReport(rec);
  assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');
  const loadedPdf = await PDFDocument.load(pdfBuf);
  assert.equal(loadedPdf.getPageCount(), 3); // 1 cover + 2 side-by-side sheets

  const html = generateHighlightedHtmlReport(rec);
  assert.ok(html.includes('<svg x="0" y="0"'));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(html.includes('*070202000000*'));
  assert.ok(html.includes('CIBC12890010'));
});

test('handles >16 MB, 145,000-line RT reports and .gz payloads cleanly without stack overflow or unbounded diff bloat', async () => {
  const rowCount = 145_000;
  const header = [
    'MERIDIAN BANK - LARGE SCALE DAILY RECONCILIATION REPORT',
    'BATCH ID: WIRE-20261122-LG   ENV: UAT   CURRENCY: USD',
    '----------------------------------------------------------------------------------------------------',
  ];
  const baseRows = new Array<string>(rowCount + header.length + 3);
  const candRows = new Array<string>(rowCount + header.length + 3);
  for (let i = 0; i < header.length; i++) {
    baseRows[i] = header[i];
    candRows[i] = header[i];
  }
  for (let i = 0; i < rowCount; i++) {
    const id = String(i + 1).padStart(7, '0');
    const line = `TXN-${id}  ACCT-TOK-${id}  2026-11-22  SETTLED_BATCH_RECON_VERIFIED   BRANCH-0042  CAD   $1,250.00  CONTROL_OK`;
    baseRows[header.length + i] = line;
    candRows[header.length + i] =
      i === 98_765
        ? `TXN-${id}  ACCT-TOK-${id}  2026-11-22  SETTLED_BATCH_RECON_VERIFIED   BRANCH-0042  CAD   $1,299.00  CONTROL_OK`
        : line;
  }
  const trailerOffset = header.length + rowCount;
  baseRows[trailerOffset] = 'RECORD COUNT: 145000';
  baseRows[trailerOffset + 1] = 'GRAND TOTAL: $181,250,000.00';
  baseRows[trailerOffset + 2] = 'END OF REPORT';
  candRows[trailerOffset] = 'RECORD COUNT: 145000';
  candRows[trailerOffset + 1] = 'GRAND TOTAL: $181,250,049.00';
  candRows[trailerOffset + 2] = 'END OF REPORT';

  const baseBuf = Buffer.from(baseRows.join('\n') + '\n', 'utf8');
  const candBuf = Buffer.from(candRows.join('\n') + '\n', 'utf8');
  assert.ok(baseBuf.length > 15 * 1024 * 1024, `Expected >15 MB RT payload, got ${baseBuf.length}`);

  // Verify safeGunzip accepts >16 MB decompressed streams (old 15 MB cap would reject this)
  const padded16Mb = Buffer.concat([baseBuf, Buffer.alloc(3 * 1024 * 1024, 0x20)]);
  const gzBuf = zlib.gzipSync(padded16Mb, { level: 1 });
  const gunzipped = safeGunzip(gzBuf, 'IMDS_LARGE_RECON.rt.gz');
  assert.equal(gunzipped.ok, true, `Expected >16 MB gzip to decompress cleanly: ${gunzipped.error}`);
  assert.ok(gunzipped.buffer.length > 16 * 1024 * 1024);

  const res = await runComparisonEngine({
    runId: 'TEST-LARGE-RT-125K',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: baseBuf,
    baselineFilename: 'IMDS_LARGE_125K.rt',
    candidateBuffer: candBuf,
    candidateFilename: 'DDGS_LARGE_125K.rt',
  });

  assert.equal(res.run.overallOutcome, 'CONFIRMED_DEFECT');
  assert.equal(res.run.diffLinesTruncated, true);
  assert.ok((res.run.totalDiffCount ?? 0) >= 2, 'Expected both the line #98765 amount diff and GRAND TOTAL diff');
  assert.ok(res.run.textDiffs.length <= 15_000, 'Stored textDiffs must stay bounded for UI/JSON safety');
  assert.ok(
    res.run.textDiffs.some((d) => d.diffCategory === 'TEXT_CHANGE' && d.candidateText.includes('$1,299.00')),
    'Exact variance at line 98765 must be preserved even when equal context is sampled'
  );
  assert.ok(
    res.run.textDiffs.some((d) => d.diffCategory === 'CONTROL_METADATA' && d.candidateText.includes('$181,250,049.00')),
    'Control total variance must be preserved'
  );
});

test('handles 110-vs-111 page AFP documents with inserted blank page, SHA-256 IOCA asset deduplication, and PDF/HTML exports', async () => {
  const asc2eb = new Map<string, number>([
    [' ', 0x40], ['.', 0x4b], ['-', 0x60], [':', 0x7a], ['_', 0x6d],
  ]);
  for (let i = 0; i < 26; i++) {
    asc2eb.set(String.fromCharCode(65 + i), [0xc1,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xd1,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9][i]);
    asc2eb.set(String.fromCharCode(97 + i), [0x81,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x91,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9][i]);
  }
  for (let i = 0; i < 10; i++) asc2eb.set(String(i), 0xf0 + i);
  const eb = (s: string) => Buffer.from(Array.from(s, (ch) => asc2eb.get(ch) ?? 0x40));
  const sf = (sfidHex: string, seq: number, payload?: Buffer) => {
    const data = payload || Buffer.alloc(0);
    const len = 8 + data.length;
    const out = Buffer.alloc(1 + len);
    out[0] = 0x5a;
    out.writeUInt16BE(len, 1);
    Buffer.from(sfidHex, 'hex').copy(out, 3);
    out[6] = 0;
    out.writeUInt16BE(seq & 0xffff, 7);
    if (data.length) data.copy(out, 9);
    return out;
  };
  const pgd = Buffer.alloc(12);
  pgd.writeUInt16BE(2400, 2);
  pgd.writeUInt16BE(2400, 4);
  pgd[6] = (2040 >> 16) & 0xff; pgd[7] = (2040 >> 8) & 0xff; pgd[8] = 2040 & 0xff;
  pgd[9] = (2640 >> 16) & 0xff; pgd[10] = (2640 >> 8) & 0xff; pgd[11] = 2640 & 0xff;

  // Build 16x16 inline BIM/IOCA logo payload repeated on every page
  const bmp = Buffer.alloc(32, 0xaa);
  const idd = Buffer.alloc(21);
  idd.writeUInt16BE(2400, 1); idd.writeUInt16BE(2400, 3); idd.writeUInt16BE(16, 5); idd.writeUInt16BE(16, 7);
  idd[9] = 0xf6; idd[10] = 0x0a; idd.writeUInt16BE(2400, 12); idd.writeUInt16BE(2400, 14);
  idd.writeUInt16BE(16, 16); idd.writeUInt16BE(16, 18);
  const ipd = Buffer.concat([
    Buffer.from([0x70, 0x00, 0x91, 0x01, 0xff, 0x95, 0x02, 0x03, 0x01, 0x96, 0x01, 0x01, 0xfe, 0x92, 0x00, 32]),
    bmp,
    Buffer.from([0x93, 0x00, 0x71, 0x00]),
  ]);

  const buildLargeAfp = (insertBlankAtPage: number | null) => {
    const parts: Buffer[] = [sf('D3A8A8', 1, eb('DOC_LARGE_110'))];
    let seq = 2;
    for (let p = 1; p <= 110; p++) {
      if (insertBlankAtPage === p) {
        parts.push(sf('D3A8AF', seq++, eb('PAGE_BLANK')));
        parts.push(sf('D3A6AF', seq++, pgd));
        parts.push(sf('D3A9AF', seq++));
      }
      const line1 = eb(`CIBC STATEMENT CYCLE PAGE ${String(p).padStart(3, '0')}`);
      const line2 = eb(insertBlankAtPage && p === 80 ? 'MONTHLY ACCOUNT FEE: $19.95' : 'MONTHLY ACCOUNT FEE: $14.95');
      const ptx = Buffer.concat([
        Buffer.from([0x2b, 0xd3]),
        Buffer.from([4, 0xc7, 0x00, 0xb4, 4, 0xd3, 0x00, 0xc8, 3, 0xf1, 1, 2 + line1.length, 0xdb]),
        line1,
        Buffer.from([4, 0xc7, 0x00, 0xb4, 4, 0xd3, 0x01, 0x2c, 3, 0xf1, 1, 2 + line2.length, 0xdb]),
        line2,
      ]);
      parts.push(
        sf('D3A8AF', seq++, eb(`PAGE_${String(p).padStart(4, '0')}`)),
        sf('D3A6AF', seq++, pgd),
        sf('D3A8FB', seq++, eb('IMG_LOGO')),
        sf('D3A6FB', seq++, idd),
        sf('D3EEFB', seq++, ipd),
        sf('D3A9FB', seq++),
        sf('D3EE9B', seq++, ptx),
        sf('D3A9AF', seq++)
      );
    }
    parts.push(sf('D3A9A8', seq++));
    return Buffer.concat(parts);
  };

  const baseAfp = buildLargeAfp(null);
  const candAfp = buildLargeAfp(45);

  const res = await runComparisonEngine({
    runId: 'TEST-LARGE-AFP-110V111',
    config: INVENTORY_CONFIGS[3],
    format: 'AFP',
    baselineBuffer: baseAfp,
    baselineFilename: 'IMDS_LARGE_110P.afp',
    candidateBuffer: candAfp,
    candidateFilename: 'DDGS_LARGE_111P.afp',
  });

  assert.equal(res.run.baseline.pageCount, 110);
  assert.equal(res.run.candidate.pageCount, 111);
  assert.equal(res.run.alignedPages.length, 111);
  assert.equal(res.run.alignedPages[44].baselinePageNum, null);
  assert.equal(res.run.alignedPages[44].candidatePageNum, 45);
  assert.equal(res.run.alignedPages[44].candidateBlank, true);
  assert.equal(res.run.alignedPages[44].status, 'INSERTED_IN_CANDIDATE');
  // Page 80 of baseline aligns cleanly with Page 81 of candidate (slot 81 -> index 80) and catches fee diff
  assert.equal(res.run.alignedPages[80].baselinePageNum, 80);
  assert.equal(res.run.alignedPages[80].candidatePageNum, 81);
  assert.equal(res.run.alignedPages[80].status, 'DIFF_DETECTED');

  // Identical inline IOCA logos repeated 220 times across baseline & candidate deduplicated to 1 per stream (2 total vs 220)
  assert.equal(Object.keys(res.run.afpDetails?.mediaAssets || {}).length, 2);
  // Field preview capped safely while preserving exact total field counts
  assert.ok((res.run.afpDetails?.baselineTotalFieldCount ?? 0) > 800);

  const pdfOut = await generateHighlightedPdfDiffReport(res);
  assert.equal(pdfOut.subarray(0, 5).toString('ascii'), '%PDF-');

  const htmlOut = generateHighlightedHtmlReport(res);
  assert.ok(htmlOut.includes('TEST-LARGE-AFP-110V111'));
  assert.ok(htmlOut.includes('Slot 111'));
});






