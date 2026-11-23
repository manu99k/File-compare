import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  ADAPTER_REGISTRY,
  runComparisonEngine,
} from './server/adapters.ts';
import {
  DESIGN_PACK,
  INVENTORY_CONFIGS,
  initializeSyntheticStore,
  type StoredRunRecord,
} from './server/fixtures.ts';
import { MAX_UPLOAD_FILE_BYTES, validateInventoryConfig } from './server/security.ts';
import { generateHighlightedHtmlReport, generateHighlightedPdfDiffReport } from './server/reportExport.ts';
import type { ComparisonRun, FileFormat, InventoryConfigRule, ReviewDecisionRecord } from './src/types/qe.ts';

const PORT = 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_FILE_BYTES,
    fieldSize: 10 * 1024 * 1024,
  },
});

function summarizeRunForList(run: ComparisonRun): ComparisonRun {
  return {
    ...run,
    isSummary: true,
    alignedPages: [],
    textDiffs: [],
    pdfDetails: undefined,
    pclDetails: undefined,
    afpDetails: undefined,
    rtDetails: undefined,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const runsStore: Map<string, StoredRunRecord> = await initializeSyntheticStore();
  const configs: InventoryConfigRule[] = [...INVENTORY_CONFIGS];
  const papyrusProxyBuffers = new Map<string, { baselinePdf?: Buffer; candidatePdf?: Buffer }>();

  // Serve local pdf.worker.min.mjs so browser canvas diffing has zero external CDN dependencies
  app.get('/pdf.worker.min.mjs', (_req, res) => {
    const workerPath = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
    if (fs.existsSync(workerPath)) {
      res.type('application/javascript').sendFile(workerPath);
    } else {
      res.status(404).send('PDF worker not found');
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'local-synthetic-sandbox', productionSubmissionAllowed: false });
  });

  app.get('/api/runs', (_req, res) => {
    const list = Array.from(runsStore.values())
      .map((r) => summarizeRunForList(r.run))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ runs: list });
  });

  app.get('/api/runs/:id', (req, res) => {
    const rec = runsStore.get(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json({ run: rec.run });
  });

  app.get('/api/runs/:id/artifact/:side', (req, res) => {
    const rec = runsStore.get(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const side = req.params.side;
    if (side === 'papyrus-baseline' || side === 'papyrus-candidate') {
      const proxy = papyrusProxyBuffers.get(req.params.id);
      const buf = side === 'papyrus-baseline' ? proxy?.baselinePdf : proxy?.candidatePdf;
      if (!buf) {
        res.status(404).json({ error: 'Papyrus-exported PDF proxy not attached.' });
        return;
      }
      res.type('application/pdf').send(buf);
      return;
    }

    const buf = side === 'baseline' ? rec.baselineBinary : rec.candidateBinary;
    const meta = side === 'baseline' ? rec.run.baseline : rec.run.candidate;
    if (!buf || buf.length === 0) {
      res.status(404).json({ error: 'Artifact binary is empty or unavailable.' });
      return;
    }

    const mimeMap: Record<FileFormat, string> = {
      PDF: 'application/pdf',
      AFP: 'application/octet-stream',
      PCL: 'application/vnd.hp-pcl',
      RT: 'text/plain; charset=utf-8',
    };
    res.setHeader('Content-Type', mimeMap[meta.format] || 'application/octet-stream');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${meta.filename.replace(/"/g, '')}"`);
    }
    res.send(buf);
  });

  app.get('/api/runs/:id/export', async (req, res) => {
    const rec = runsStore.get(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const format = String(req.query.format || 'json');
    const run = rec.run;

    if (format === 'html') {
      const html = generateHighlightedHtmlReport(rec);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${run.id}_visual_diff_report.html"`);
      res.send(html);
      return;
    }

    if (format === 'diff-pdf') {
      const canExportPdf =
        (run.format === 'PDF' && run.pdfVisualReady) ||
        (run.format === 'AFP' && run.baseline.parseStatus === 'PARSED' && run.candidate.parseStatus === 'PARSED');
      if (!canExportPdf) {
        res.status(400).json({ error: 'Annotated PDF diff export is supported for parsed PDF and AFP comparison runs.' });
        return;
      }
      try {
        const pdfBuf = await generateHighlightedPdfDiffReport(rec);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${run.id}_visual_diff_report.pdf"`);
        res.send(pdfBuf);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate PDF diff report.' });
      }
      return;
    }

    if (format === 'csv') {
      const header = ['FindingID', 'RunID', 'Layer', 'Severity', 'Status', 'Category', 'Location', 'Expected(Redacted)', 'Actual(Redacted)'].join(',');
      const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
      const rows = run.findings.map((f) =>
        [f.id, f.runId, f.layer, f.severity, f.status, f.category, f.location, f.expected, f.actual].map(esc).join(',')
      );
      const csv = [header, ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${run.id}_findings_redacted.csv"`);
      res.send(csv);
      return;
    }

    const safeReport = {
      exportedAt: new Date().toISOString(),
      privacyNotice: 'All content snippets are redacted. Raw PII and production credentials are excluded.',
      runSummary: {
        id: run.id,
        mvp: run.mvp,
        appCode: run.appCode,
        subCode: run.subCode,
        configVersion: run.configVersion,
        format: run.format,
        overallOutcome: run.overallOutcome,
        lifecycleState: run.lifecycleState,
        tokenizationStatus: run.tokenizationStatus,
      },
      evidenceHashes: {
        baselineFilename: run.baseline.filename,
        baselineSha256: run.baseline.sha256,
        candidateFilename: run.candidate.filename,
        candidateSha256: run.candidate.sha256,
      },
      layerSummaries: run.layerSummaries,
      pairingChecks: run.pairingChecks,
      verificationLimits: run.verificationLimits,
      findings: run.findings,
      reviews: run.reviews,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${run.id}_report_redacted.json"`);
    res.send(JSON.stringify(safeReport, null, 2));
  });

  app.post(
    '/api/compare',
    upload.fields([
      { name: 'baseline', maxCount: 1 },
      { name: 'candidate', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const baseFile = files?.baseline?.[0];
        const candFile = files?.candidate?.[0];
        const configId = String(req.body.configId || configs[0].id);
        const requestedFormat = req.body.format as FileFormat | undefined;

        const cfg = configs.find((c) => c.id === configId);
        if (!cfg) {
          res.status(400).json({ error: 'Selected inventory configuration not found.' });
          return;
        }

        const cfgValidation = validateInventoryConfig(cfg);
        if (!cfgValidation.valid) {
          res.status(400).json({
            error: `Configuration Blocker: ${cfgValidation.blockerReasons.join(' ')}`,
          });
          return;
        }

        if (!baseFile || !candFile) {
          res.status(400).json({ error: 'Both IMDS baseline and DDGS candidate files are required.' });
          return;
        }

        const format: FileFormat = requestedFormat || cfg.expectedFormats[0];
        const runId = `RUN-${new Date().getFullYear()}-${String(1100 + runsStore.size + 1)}`;

        const result = await runComparisonEngine({
          runId,
          config: cfg,
          format,
          baselineBuffer: baseFile.buffer,
          baselineFilename: baseFile.originalname,
          candidateBuffer: candFile.buffer,
          candidateFilename: candFile.originalname,
        });

        runsStore.set(result.run.id, result);
        res.status(201).json({ run: result.run });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Comparison failed';
        res.status(500).json({ error: msg });
      }
    }
  );

  app.post('/api/compare/negative-test', async (req, res) => {
    const scenario = String(req.body.scenario || 'corrupt_gzip');
    const cfg = configs[2]; // OPS DAILY_RECON
    const runId = `RUN-${new Date().getFullYear()}-${String(1100 + runsStore.size + 1)}`;

    let baselineBuffer = Buffer.from('REPORT HEADER\r\nRECORD COUNT: 1\r\n', 'utf8');
    let baselineFilename = 'IMDS_SYNTH_NEG.rt';
    let candidateBuffer = Buffer.alloc(0);
    let candidateFilename = 'DDGS_SYNTH_NEG.rt';
    let format: FileFormat = 'RT';

    if (scenario === 'corrupt_gzip') {
      baselineFilename = 'IMDS_SYNTH_NEG.rt.gz';
      baselineBuffer = zlib.gzipSync(baselineBuffer);
      candidateFilename = 'DDGS_SYNTH_CORRUPT.rt.gz';
      candidateBuffer = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef]); // truncated corrupt gzip
    } else if (scenario === 'nested_gzip') {
      baselineFilename = 'IMDS_SYNTH_NEG.rt.gz';
      baselineBuffer = zlib.gzipSync(baselineBuffer);
      candidateFilename = 'DDGS_SYNTH_NESTED.rt.gz';
      candidateBuffer = zlib.gzipSync(zlib.gzipSync(Buffer.from('NESTED PAYLOAD', 'utf8')));
    } else if (scenario === 'path_traversal') {
      candidateFilename = '../../etc/passwd.rt';
      candidateBuffer = Buffer.from('MALICIOUS FILENAME TEST', 'utf8');
    } else if (scenario === 'unsupported_format') {
      format = 'PDF';
      baselineFilename = 'IMDS_ARCHIVE.zip';
      baselineBuffer = Buffer.from('PK\x03\x04ZIPPAYLOAD', 'binary');
      candidateFilename = 'DDGS_ARCHIVE.zip';
      candidateBuffer = Buffer.from('PK\x03\x04ZIPPAYLOAD', 'binary');
    }

    const result = await runComparisonEngine({
      runId,
      config: cfg,
      format,
      baselineBuffer,
      baselineFilename,
      candidateBuffer,
      candidateFilename,
    });
    runsStore.set(result.run.id, result);
    res.status(201).json({ run: result.run });
  });

  app.post(
    '/api/runs/:id/papyrus-proxy',
    upload.fields([
      { name: 'baselinePdf', maxCount: 1 },
      { name: 'candidatePdf', maxCount: 1 },
    ]),
    (req, res) => {
      const rec = runsStore.get(req.params.id);
      if (!rec) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      if (rec.run.format !== 'AFP') {
        res.status(400).json({ error: 'Papyrus visual proxy attachment applies only to AFP runs.' });
        return;
      }

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const bPdf = files?.baselinePdf?.[0];
      const cPdf = files?.candidatePdf?.[0];
      const toolVersion = String(req.body.papyrusVersion || 'ISIS Papyrus Viewer 7.8');

      if (!bPdf || !cPdf) {
        res.status(400).json({ error: 'Attach both Papyrus-exported baseline PDF and candidate PDF.' });
        return;
      }

      papyrusProxyBuffers.set(rec.run.id, {
        baselinePdf: bPdf.buffer,
        candidatePdf: cPdf.buffer,
      });

      rec.run.afpDetails = {
        ...rec.run.afpDetails,
        validationMode: rec.run.afpDetails?.validationMode || 'DIRECT_MODCA_NATIVE',
        encodingDetected: rec.run.afpDetails?.encodingDetected || 'MO:DCA Binary',
        baselineFields: rec.run.afpDetails?.baselineFields || [],
        candidateFields: rec.run.afpDetails?.candidateFields || [],
        baselineTles: rec.run.afpDetails?.baselineTles || [],
        candidateTles: rec.run.afpDetails?.candidateTles || [],
        baselineResources: rec.run.afpDetails?.baselineResources || [],
        candidateResources: rec.run.afpDetails?.candidateResources || [],
        baselinePtocaRuns: rec.run.afpDetails?.baselinePtocaRuns || [],
        candidatePtocaRuns: rec.run.afpDetails?.candidatePtocaRuns || [],
        baselineGeometry: rec.run.afpDetails?.baselineGeometry || [],
        candidateGeometry: rec.run.afpDetails?.candidateGeometry || [],
        papyrusExportAttached: true,
        papyrusToolVersion: toolVersion,
        conversionDisclaimer: `Optional visual proxy exported via ${toolVersion}. Primary TLE, IMM, MCF, and PTOCA checks ran directly on native AFP.`,
      };

      res.json({ run: rec.run });
    }
  );

  app.post('/api/runs/:id/review', (req, res) => {
    const rec = runsStore.get(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const { decision, reviewerIdentity, rationale, toolUsed, toolVersion, papyrusChecklistCompleted } = req.body as {
      decision: ReviewDecisionRecord['decision'];
      reviewerIdentity: string;
      rationale: string;
      toolUsed?: string;
      toolVersion?: string;
      papyrusChecklistCompleted?: boolean;
    };

    if (!decision || !reviewerIdentity?.trim() || !rationale?.trim()) {
      res.status(400).json({ error: 'Decision, reviewer identity, and rationale are mandatory for auditability.' });
      return;
    }

    const review: ReviewDecisionRecord = {
      id: `REV-${Date.now().toString(36).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      reviewerIdentity: reviewerIdentity.trim(),
      decision,
      toolUsed: toolUsed?.trim() || undefined,
      toolVersion: toolVersion?.trim() || undefined,
      papyrusChecklistCompleted,
      rationale: rationale.trim(),
    };

    rec.run.reviews.unshift(review);

    if (decision === 'APPROVE_PASS') {
      rec.run.overallOutcome = 'VERIFIED_PASS';
      rec.run.lifecycleState = 'Passed';
      rec.run.humanReviewRequired = false;
    } else if (decision === 'CONFIRM_DEFECT') {
      rec.run.overallOutcome = 'CONFIRMED_DEFECT';
      rec.run.lifecycleState = 'Failed';
      rec.run.humanReviewRequired = false;
    } else if (decision === 'REQUEST_RETEST') {
      rec.run.overallOutcome = 'POTENTIAL_VARIANCE';
      rec.run.lifecycleState = 'Human review required';
      rec.run.humanReviewRequired = true;
    } else if (decision === 'BLOCK_EXECUTION') {
      rec.run.overallOutcome = 'BLOCKED';
      rec.run.lifecycleState = 'Blocked';
      rec.run.humanReviewRequired = true;
    }

    const hrLayer = rec.run.layerSummaries.find((l) => l.layerName === 'Human Review');
    if (hrLayer) {
      hrLayer.status = rec.run.overallOutcome;
      hrLayer.summary = `${decision} signed off by ${review.reviewerIdentity}`;
    }

    res.json({ run: rec.run });
  });

  app.get('/api/adapters', (_req, res) => {
    res.json({ adapters: ADAPTER_REGISTRY });
  });

  app.get('/api/configs', (_req, res) => {
    res.json({ configs });
  });

  app.post('/api/configs/validate', (req, res) => {
    const result = validateInventoryConfig(req.body || {});
    res.json(result);
  });

  app.get('/api/design-pack', (_req, res) => {
    res.json(DESIGN_PACK);
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = Math.round(MAX_UPLOAD_FILE_BYTES / (1024 * 1024));
        res.status(413).json({
          error: `Uploaded file exceeds the ${maxMb} MB per-file limit.`,
        });
        return;
      }
      res.status(400).json({ error: `Upload error (${err.code}): ${err.message}` });
      return;
    }
    if (err && req.path.startsWith('/api/')) {
      const status = typeof (err as { status?: number }).status === 'number' ? (err as { status: number }).status : 500;
      const message = err instanceof Error ? err.message : 'Internal API error';
      res.status(status).json({ error: message });
      return;
    }
    next(err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`DocVerify QE server listening on http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 600_000;
  server.headersTimeout = 605_000;
  server.keepAliveTimeout = 65_000;
}

startServer().catch((err) => {
  console.error('Failed to start DocVerify QE server:', err);
  process.exit(1);
});
