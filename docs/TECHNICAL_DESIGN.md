# DocVerify QE — Technical Design Document (TDD)

**System:** DocVerify QE — Migration Output Diff & Validation Workbench  
**Migration Scope:** IMDS / OpenText DCP (Source Baseline) → DDGS / SmartComm (Destination Candidate)  
**Supported Formats:** AFP (Direct MO:DCA + ISIS Papyrus), PDF, PCL5, RT / RPT, GZIP (`.gz`)  
**Runtime Environment:** Node.js + Express 4 + React 19 + TypeScript + Vite 8 (Local Synthetic Sandbox, Port `3000`)

---

## 1. Executive Architecture Overview

DocVerify QE is a single-service full-stack TypeScript application. In development (`npm run dev`), Express hosts both the `/api/*` REST routes and Vite's dev middleware (`vite.middlewares`) on port `3000`; in production (`npm run start`), Express serves the static `dist/` bundle alongside the REST API.

```text
+-----------------------------------------------------------------------------------+
|                          React 19 + Tailwind CSS v4 SPA                           |
|  App.tsx -> RunInspector -> AllPagesVisualCompare / SideBySideDiffView /          |
|             AfpNativeInspector / PdfVisualDiff / NewComparisonView / ConfigView   |
|  * Browser pdfjs-dist Canvas Renderer + Pixel-by-Pixel Diff Heatmap               |
+-----------------------------------------+-----------------------------------------+
                                          | REST JSON + Multipart + Binary Streams
                                          v
+-----------------------------------------------------------------------------------+
|                     Express 4 + Multer (In-Memory 15MB Cap)                       |
|  server.ts: /api/compare, /api/runs/:id, /api/runs/:id/artifact/:side,            |
|             /api/runs/:id/export?format=diff-pdf|html|json|csv, /review           |
+----+-----------------------+---------------------------+--------------------------+
     |                       |                           |
     v                       v                           v
+----------------+   +------------------------+   +---------------------------------+
| Security Guard |   | Comparison Engine      |   | Report Exporter                 |
| (security.ts)  |   | (adapters.ts)          |   | (reportExport.ts)               |
| - Config rules |   | - Format parsers:      |   | - pdf-lib Side-by-Side          |
| - Sanitize fn  |   |   PDF, AFP, PCL, RT    |   |   Annotated PDF (diff-pdf)      |
| - safeGunzip   |   | - alignDocumentPages() |   | - Self-Contained Visual HTML    |
| - SHA-256      |   | - Needleman-Wunsch     |   |   Report (PDF/AFP/PCL/RT)       |
| - PII Redact   |   |   line + token align   |   | - Redacted JSON / CSV           |
+----------------+   +------------------------+   +---------------------------------+
```

---

## 2. Core Data Contracts (`src/types/qe.ts`)

All frontend components and backend modules share strict TypeScript domain types:

- **`ComparisonRun`**: Master run entity holding `baseline` and `candidate` `ArtifactMetadata`, `layerSummaries` (5 independent layers: *Structural & Operational*, *Text & Content*, *Visual & Layout*, *Format-Specific*, *Human Review*), `pairingChecks`, `alignedPages: AlignedPageSlot[]`, `textDiffs: TextDiffLine[]`, `findings: FindingRecord[]`, `reviews: ReviewDecisionRecord[]`, and format-specific payloads (`pdfDetails`, `pclDetails`, `afpDetails`, `rtDetails`).
- **`AlignedPageSlot`**: Represents one visual comparison row between Source and Destination:
  - `slotIndex` (1-based)
  - `baselinePageNum: number | null` and `candidatePageNum: number | null`
  - `baselineBlank: boolean` and `candidateBlank: boolean`
  - `status: 'MATCHED' | 'DIFF_DETECTED' | 'INSERTED_IN_CANDIDATE' | 'MISSING_IN_CANDIDATE'`
  - `similarityPct`, `diffCount`, `summary`
- **`TextDiffLine`**: Represents an aligned line or PTOCA run tied to `slotIndex`, carrying `diffCategory: DiffCategory`, `secondaryCategories?: DiffCategory[]`, `baselineTokens` / `candidateTokens` (`InlineToken[]` for word-level highlighting), `positionDelta`, `fontDelta`, `controlDelta`, and `criticalFieldFlag`.
- **`StoredRunRecord`** (`server/fixtures.ts`): Keeps `run: ComparisonRun` paired with raw in-memory `baselineBinary: Buffer` and `candidateBinary: Buffer` so PDF canvas rendering and annotated PDF generation operate on exact input bytes without touching disk.

---

## 3. Format Parsing Pipelines (`server/adapters.ts`)

### 3.1 PDF Parser (`parsePdf`)
- **Validation**: Verifies `%PDF-` magic header, loads document via `pdf-lib` (`PDFDocument.load`) for MediaBox dimensions (`baselinePageDims`, `candidatePageDims`), and invokes `pdfjs-dist` (`pdfjs-dist/legacy/build/pdf.mjs`) for text & geometry extraction.
- **Line Grouping & Coordinates**: Groups PDF text items per page by Y-coordinate proximity (`Math.abs(a.y - b.y) <= 2.5`) and sorts left-to-right into `PdfLineLayout` records (`page`, `x`, `y`, `width`, `height`, `fontName`, `fontSize`, `text`).
- **Blank / White Page Detection**: Inspects both extracted text (`lines.length === 0`) and `page.getOperatorList()` graphics operators (`OPS.paintImageXObject`, `OPS.paintInlineImageXObject`, `OPS.stroke`, `OPS.fill`, `OPS.eoFill`, `OPS.showText`). A page with zero text and zero visible graphics/image paint operators is flagged `pagesBlank[i] = true` so empty white pages are never misclassified as content pages.

### 3.2 Direct Native AFP Parser (`parseAfp` — Zero PDF Conversion)
Rather than converting AFP to PDF (which breaks EBCDIC tags, resource bindings, and font mappings), the engine parses raw **MO:DCA (`0x5A`)** structured fields directly:
1. **Introducer & SFID Decoding**: Scans `0x5A` structured field records, reading 2-byte length, 3-byte SFID (`D3A8A8` `BDT`, `D3A9A8` `EDT`, `D3A8AD` `BNG`, `D3A9AD` `ENG`, `D3A8AF` `BPG`, `D3A9AF` `EPG`, `D3ABCC` `IMM`, `D3A090` `TLE`, `D3A6AF` `PGD`, `D3AB8A` `MCF`, `D3ABD8` `MPO`, `D3A8EB` `BBC`, `D3EE9B` `PTX`, etc.), flags, and sequence number.
2. **EBCDIC CP037/CP500 Decoding**: Translates EBCDIC byte streams to ASCII automatically when EBCDIC signatures are detected (`encodingDetected`).
3. **PTOCA (`PTX D3EE9B`) Chained Control Sequence Parser**: Extracts chained presentation text sub-commands (`0xC7` `AMI` absolute X move, `0xD3` `AMB` absolute Y move, `0xF1` `SCFL` coded font ID, `0xDB` `TRN` transparent text data) into `AfpPtocaRun[]`.
4. **Geometry (`PGD D3A6AF`)**: Extracts exact L-units (`widthUnits`, `heightUnits`, `xdpi`, `ydpi`, e.g., `2040x2640` at `240 DPI` = `8.5" x 11"`).
5. **Papyrus Human-in-the-Loop Policy**: Because inline MO:DCA streams may reference external mainframe FOCA/OVL/PSEG libraries or physical MICR/barcode artwork, AFP runs surface `POTENTIAL_VARIANCE` (`humanReviewRequired: true`) and support optional ISIS Papyrus visual proxy PDF attachment (`/api/runs/:id/papyrus-proxy`).

### 3.3 PCL5 Stream Parser (`parsePcl`)
Scans raw PCL escape sequences (`ESC` `0x1B`) and Form Feeds (`0x0C`) per page:
- Extracts page size (`&l#A`), orientation (`&l#O`), paper source/tray (`&l#H`), font pitch CPI (`(s#H` / `&l#H`), point height (`(s#V`), cursor moves (`*p#X`, `*p#Y`), and printable text lines (`PclPositionedLine`).

### 3.4 RT / RPT Report Parser (`parseRt`)
- Detects encoding, UTF-8 BOM (`EF BB BF`), and line-ending consistency (`LF`, `CRLF`, `MIXED`).
- Captures banner header, trailer/footer, record count, and numeric control totals (`KEY: $1,234.56` or `KEY: 42`) into `RtControlCheck[]` with configured `numericToleranceAbs`.

---

## 4. Smart Page & Line Alignment Algorithms

### 4.1 Page Sequence Aligner (`alignDocumentPages`)
When comparing documents with mismatched page counts (e.g., **6 pages in Source vs. 7 pages in Destination** due to an inserted blank white page at Destination Page 3), naive 1:1 indexing breaks every page from Page 3 onward.

`alignDocumentPages()` solves this using **Needleman-Wunsch dynamic programming** over page sequences `B[0..m-1]` and `C[0..n-1]`:

- **Similarity & Scoring Matrix**:
  - **Blank vs. Non-Blank pair**: `-5.0` (strongly forbids pairing a blank page with a content page).
  - **Blank vs. Blank pair**: `+0.95` (two matching blank pages align together).
  - **Content vs. Content pair**: Normalized line-set Jaccard similarity `sim ∈ [0, 1]`; score = `sim >= 0.40 ? (1.0 + sim * 2.0) : (-1.5 + sim)`.
  - **Gap Penalty (Unaligned Page)**:
    - Blank page gap (`INSERTED_IN_CANDIDATE` / `MISSING_IN_CANDIDATE`): **`-0.08`** (near-zero penalty).
    - Non-blank page gap: **`-0.75`**.
- **Resulting Alignment Behavior**:
  In `RUN-2026-1107`, Destination Page 3 (blank) takes the `-0.08` gap instead of misaligning Source Page 3 (`-5.0`), producing:
  - Slot 1: `Src P1 ↔ Dst P1` (`MATCHED`)
  - Slot 2: `Src P2 ↔ Dst P2` (`MATCHED`)
  - Slot 3: `Src null ↔ Dst P3 (Blank)` (`INSERTED_IN_CANDIDATE`)
  - Slot 4: `Src P3 ↔ Dst P4` (`MATCHED`)
  - Slot 5: `Src P4 ↔ Dst P5` (`MATCHED`)
  - Slot 6: `Src P5 ↔ Dst P6` (`DIFF_DETECTED` — catches `0.35% -> 0.45%` + `+24pt` shift)
  - Slot 7: `Src P6 ↔ Dst P7` (`MATCHED`)

### 4.2 Line-Level & Inline Token Diffing (`computePageTextDiffs`)
Inside each aligned page slot:
1. Lines are aligned via Needleman-Wunsch similarity (`normalizeLine` stripping numeric/whitespace variations for structural anchor matching).
2. Each paired row is classified into primary + secondary `DiffCategory` tags (`TEXT_CHANGE`, `ALIGNMENT_SHIFT`, `FONT_STYLE`, `MISSING_CONTENT`, `ADDED_CONTENT`, `CONTROL_METADATA`).
3. Changed pairs are tokenized word-by-word (`computeInlineTokens`) so the UI and HTML report highlight exact modified amounts, dates, or words inside the line.
4. Critical fields (currency amounts, percentages, routing/account tokens, dates, totals) set `criticalFieldFlag: true`.

---

## 5. Dual-File Visual Highlighting & Report Export (`server/reportExport.ts`)

### 5.1 Browser All-Pages Visual Inspector (`AllPagesVisualCompare.tsx`)
- **PDF**: Fetches `/api/runs/:id/artifact/baseline` and `/candidate` into browser memory once, renders each aligned slot's Source and Destination pages onto HTML5 `<canvas>` elements via `pdfjs-dist`, optionally computes a pixel-by-pixel RGB diff canvas (`pixelDiffPct`), and overlays category-colored bounding boxes directly on **both** Source and Destination canvases using `run.pdfDetails.baselineLayouts` / `candidateLayouts`.
- **AFP**: Renders dual coordinate wireframe canvases scaled from `PGD` geometry and plots every `AfpPtocaRun` with colored highlight frames on changed `AMI`/`AMB`/`SCFL`/`TRN` runs.
- **PCL / RT**: Renders side-by-side page/section cards with token-level highlights on both sides and missing/inserted blank-page sheets.

### 5.2 Annotated PDF Diff Export (`generateHighlightedPdfDiffReport`)
- Builds a **1240 × 860 pt Landscape PDF** via `pdf-lib`:
  - **Cover Sheet**: Run metadata, 6-category color legend, and aligned page matrix table.
  - **Per-Slot Side-by-Side Sheets**: Embeds the Source page on the left (`x=48`) and Destination page on the right (`x=652`) using `reportDoc.embedPdf()`, draws translucent category-colored highlight boxes over differing lines on **both** pages, renders callout boxes on unaligned blank/missing pages, and prints a 4-line delta summary footer.
  - **Blank-Page Resilience**: In `pdf-lib`, `embedPdf()` defers stream encoding until `save()` and throws `MissingPageContentsEmbeddingError` if a page has no `/Contents` entry (typical of blank white pages). `reportExport.ts` inspects `pageObj.node.normalizedEntries().Contents` before calling `embedPdf()` so blank pages render cleanly with callout banners instead of failing export.

### 5.3 Visual HTML Export (`generateHighlightedHtmlReport`)
- Produces a standalone, zero-dependency HTML report supporting **all 4 formats** (`PDF`, `AFP`, `PCL`, `RT`) with CSS `@media print` pagination, absolute-positioned page sheets for PDF/AFP, highlighted text sheets for PCL/RT, and a per-slot diff table.

---

## 6. REST API Reference (`server.ts`)

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Sandbox health & `productionSubmissionAllowed: false` attestation |
| `GET` | `/api/runs` | List all comparison runs sorted by `createdAt` desc |
| `GET` | `/api/runs/:id` | Retrieve full `ComparisonRun` payload |
| `GET` | `/api/runs/:id/artifact/:side` | Stream `baseline`, `candidate`, `papyrus-baseline`, or `papyrus-candidate` binary (`?download=1` for attachment) |
| `GET` | `/api/runs/:id/export` | Export report (`?format=diff-pdf`, `html`, `json`, `csv`) |
| `POST` | `/api/compare` | Multipart upload (`baseline`, `candidate`, `configId`, optional `format`) executing full comparison in-memory |
| `POST` | `/api/compare/negative-test` | Execute security test (`corrupt_gzip`, `nested_gzip`, `path_traversal`, `unsupported_format`) |
| `POST` | `/api/runs/:id/papyrus-proxy` | Attach optional Papyrus-exported `baselinePdf` & `candidatePdf` to an AFP run |
| `POST` | `/api/runs/:id/review` | Record immutable human sign-off (`APPROVE_PASS`, `CONFIRM_DEFECT`, `REQUEST_RETEST`, `BLOCK_EXECUTION`) |
| `GET` | `/api/adapters` | Return `ADAPTER_REGISTRY` capabilities & limitations |
| `GET` | `/api/configs` | Return approved `INVENTORY_CONFIGS` |
| `POST` | `/api/configs/validate` | Run `validateInventoryConfig()` against arbitrary JSON rules |
| `GET` | `/api/design-pack` | Return Requirements, Threats, Open Questions, and Phased Plan |

---

## 7. Security, Privacy & Threat Mitigations (`server/security.ts`)

1. **Production Submission Guard (`validateInventoryConfig`)**: Rejects any configuration where `productionSubmissionAllowed !== false`, `approvalStatus !== 'Approved'`, `piiTokenizationApproved !== true`, or `piiFields` / `pairingKeys` are empty.
2. **Automated PII Redaction (`redactSensitiveText`)**: Redacts SSNs (`[REDACTED-SSN]`), bearer/API keys (`[REDACTED-TOKEN]`), email addresses (`[REDACTED-EMAIL]`), and unmasked 12–16 digit account numbers (`****-****-XXXX`) prior to storing text diffs, findings, or exports.
3. **Path Traversal Guard (`sanitizeFilename`)**: Rejects filenames containing `..`, `/`, `\`, or null bytes (`\0`). Uploads never touch the filesystem (`multer.memoryStorage()`).
4. **GZIP Decompression Bomb & Nested Archive Guard (`safeGunzip`)**: Verifies `0x1F 0x8B` magic bytes, enforces `15 MB` decompressed ceiling and `50:1` ratio cap, and blocks nested GZIP headers.
5. **Cryptographic Evidence (`computeSha256`)**: Computes SHA-256 digests on every uploaded baseline and candidate artifact.

---

## 8. Automated Verification (`tests/qe-engine.test.ts`)

Tests use Node's built-in `node:test` runner via `npx tsx --test tests/qe-engine.test.ts`:
1. `redactSensitiveText` masks SSNs, emails, tokens, and card/account numbers.
2. `sanitizeFilename` blocks `../../etc/passwd` traversal.
3. `safeGunzip` rejects corrupt and double-gzipped streams.
4. `validateInventoryConfig` rejects `productionSubmissionAllowed: true` and unapproved PII configs.
5. `runComparisonEngine` blocks zero-byte/corrupt candidate files (never false-passing) and passes identical RT baselines.
6. Direct native AFP engine validates EBCDIC TLEs, IMM duplex/simplex drift, and PTOCA X/Y coordinate drift without PDF conversion.
7. Side-by-side diff engine classifies `TEXT_CHANGE`, `ALIGNMENT_SHIFT`, `FONT_STYLE`, `MISSING_CONTENT`, and `CONTROL_METADATA` across PDF, PCL, AFP, and RT.
8. `alignDocumentPages` handles the **6-vs-7 page** PDF with inserted blank Page 3 (`RUN-2026-1107`), keeps Pages 3–6 aligned with Pages 4–7, and verifies both `generateHighlightedPdfDiffReport` (8-page valid `%PDF-`) and `generateHighlightedHtmlReport` outputs.
