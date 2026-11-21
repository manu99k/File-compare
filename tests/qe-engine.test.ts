import assert from 'node:assert/strict';
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


