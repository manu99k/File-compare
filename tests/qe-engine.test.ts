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




