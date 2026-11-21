# DocVerify QE — Migration Output Diff & Validation Workbench

**DocVerify QE** is a full-stack Quality Engineering (QE) validation, visual diffing, and human-review workbench built to verify document migration outputs from **IMDS / OpenText DCP** (Source / Baseline) to **DDGS / SmartComm** (Destination / Candidate).

It validates high-volume regulated output across **AFP (MO:DCA + ISIS Papyrus)**, **PDF**, **PCL5**, **RT / RPT**, and **GZIP (`.gz`)** containers inside a strict local synthetic sandbox with automated PII redaction, smart blank-page sequence alignment, color-coded dual-file visual highlights, and downloadable annotated reports.

---

## Documentation Index

| Document | Purpose |
| :--- | :--- |
| **[`README.md`](README.md)** | Project overview, feature list, tech stack/libraries, directory structure, and quick start |
| **[`docs/HOW_TO_USE.md`](docs/HOW_TO_USE.md)** | Step-by-step QE user guide covering all tabs, workflows, Papyrus review, negative tests, and report exports |
| **[`docs/TECHNICAL_DESIGN.md`](docs/TECHNICAL_DESIGN.md)** | Detailed technical design document: architecture, algorithms (Needleman-Wunsch page aligner, MO:DCA/PTOCA native parser, diff classifier), API contract, security, and tests |
| **[`docs/DocVerify_QE_Solution_Presentation.pptx`](docs/DocVerify_QE_Solution_Presentation.pptx)** | 12-slide widescreen PowerPoint deck explaining the business problem, solution architecture, visual workflows, and rollout roadmap |

---

## Key Features

### 1. All-Pages Visual Side-by-Side Comparison
- Renders **IMDS Source (left)** and **DDGS Destination (right)** across **all aligned page slots** in a single scrollable inspection window (`Visual All-Pages` tab).
- Draws **color-coded bounding boxes directly on BOTH Source and Destination files** (`Highlight Both Files` toggle), with an optional **Pixel Diff** canvas column for PDFs and coordinate wireframes for AFP/PCL/RT.
- Includes a clickable **Page Alignment Map** strip, view filters (`All Aligned Pages` vs. `Pages With Differences`), and zoom presets (`Compact`, `Standard`, `Large`).

### 2. Smart Blank & Shifted Page Sequence Alignment (`alignDocumentPages`)
- Uses a Needleman-Wunsch dynamic programming sequence aligner across document pages paired with blank-page detection (`pdfjs-dist` operator list + text inspection).
- Prevents **off-by-1 cascading mismatches** when a blank/white page is inserted or removed (e.g., **6 pages in Source vs. 7 pages in Destination** where Page 3 in Destination is a white page).
- Explicitly marks the unaligned slot (`No White / Blank Page in Source File` vs. `Inserted White / Blank Page`) and continues matching Source Pages 3–6 with Destination Pages 4–7 accurately.

### 3. Color-Coded Difference Taxonomy
Every line, coordinate, font, and control mismatch is categorized and color-coded consistently across the UI, PDF exports, and HTML reports:

| Category | Color | Hex | Meaning |
| :--- | :--- | :--- | :--- |
| `TEXT_CHANGE` | Crimson Red | `#DC2626` | Word, numeric amount, date, or character mismatch |
| `ALIGNMENT_SHIFT` | Cobalt Blue | `#2563EB` | X/Y coordinate shift, AFP PTOCA `AMI`/`AMB` shift, or column spacing drift |
| `FONT_STYLE` | Violet | `#7C3AED` | Font family, point size, PCL CPI pitch, AFP `SCFL` coded font ID, or EOL/BOM drift |
| `MISSING_CONTENT` | Rose | `#BE123C` | Line, row, or page present in IMDS baseline but omitted from DDGS candidate |
| `ADDED_CONTENT` | Teal | `#0D9488` | Extra line, row, or inserted white/blank page present only in DDGS candidate |
| `CONTROL_METADATA` | Amber | `#D97706` | Printer tray, duplex `IMM`, mailroom `TLE` tag, or RT numeric control total mismatch |

### 4. Direct Native AFP Validation (Zero PDF Conversion)
- Parses raw binary **AFP MO:DCA (`0x5A`)** structured fields directly in Node.js without lossy AFP-to-PDF conversion.
- Decodes native **EBCDIC (CP037/CP500)** and ASCII payloads for:
  - **TLE (`D3A090`)** Tagged Logical Elements & **BNG/ENG** Page Groups
  - **IMM (`D3ABCC`)** Medium Map (Duplex vs. Simplex, tray routing)
  - **MCF (`D3AB8A`)**, **MPO (`D3ABD8`)**, **MPS**, **BBC (`D3A8EB`)**, **BIM** resource bindings
  - **PGD (`D3A6AF`)** exact page geometry (`widthUnits`, `heightUnits`, DPI)
  - **PTOCA (`PTX D3EE9B`)** chained text runs (`AMI`, `AMB`, `SCFL`, `TRN`) plotted on a native coordinate wireframe
- Supports **Human-in-the-Loop ISIS Papyrus** sign-off and optional Papyrus-exported PDF proxy attachment.

### 5. Downloadable Visual & Audit Reports
- **Highlighted PDF Report** (`?format=diff-pdf`, PDF runs): Landscape multi-page annotated PDF containing a cover page, color legend, page alignment matrix, and side-by-side embedded Source and Destination sheets with color-coded highlights drawn onto both pages.
- **Visual HTML Report** (`?format=html`, all 4 formats: PDF, AFP, PCL, RT): Self-contained print-ready HTML file showing visual side-by-side highlighted page sheets and line-level diff tables.
- **Redacted Audit Exports** (`?format=json` & `?format=csv`): PII-masked machine-readable findings, SHA-256 evidence hashes, and human sign-off records.

### 6. Configuration Governance & Security Controls
- **Local Synthetic Sandbox Policy**: `productionSubmissionAllowed` is strictly enforced to `false`; unapproved configs or empty PII lists are blocked before execution.
- **Automated PII Redaction**: Masks SSNs, emails, bearer/API tokens, and 12–16 digit account numbers (preserving only last 4 digits) before storing or exporting findings.
- **File & Archive Hardening**: In-memory upload processing via `multer` (zero disk writes), path-traversal filename rejection (`sanitizeFilename`), and GZIP decompression-bomb + nested-archive guards (`safeGunzip`, 15 MB / 50:1 caps).
- **No False Passes**: Empty, corrupt, truncated, or unparseable artifacts automatically resolve to `BLOCKED`.

---

## Libraries & Tech Stack

### Runtime & Core Framework
| Library | Version | Role in Application |
| :--- | :--- | :--- |
| **React** | `^19.0.1` | Component UI (`src/App.tsx`, `RunInspector`, `AllPagesVisualCompare`, etc.) |
| **React DOM** | `^19.0.1` | Browser DOM rendering |
| **TypeScript** | `^7.0.2` | End-to-end static typing across client, shared `src/types/qe.ts`, and Express server |
| **Vite** | `^8.3.0` | Frontend bundling and dev middleware (`createViteServer`) |
| **@vitejs/plugin-react** | `^6.1.1` | React JSX transform in Vite |
| **Tailwind CSS** | `^4.3.3` | Utility-first styling (`@tailwindcss/vite` + `src/index.css`) |

### Backend & Document Processing
| Library | Version | Role in Application |
| :--- | :--- | :--- |
| **Express** | `^4.21.2` | REST API server on port `3000` hosting `/api/*` and Vite/static SPA |
| **Multer** | `^2.5.0` | In-memory multipart file uploads (`memoryStorage`, 15 MB limit) |
| **pdfjs-dist** | `^6.5.438` | Server-side PDF text/coordinate/operator extraction (`legacy/build/pdf.mjs`) and client-side canvas raster rendering & pixel diffing (`/pdf.worker.min.mjs`) |
| **pdf-lib** | `^1.17.1` | Synthetic multi-page PDF fixture creation, metadata inspection, and annotated side-by-side PDF diff report generation (`generateHighlightedPdfDiffReport`) |
| **dotenv** | `^17.2.3` | Environment variable loading |
| **Node.js Built-ins** | `node:crypto`, `node:zlib`, `node:fs`, `node:path` | SHA-256 artifact hashing, bounded `gunzipSync`, local worker serving |

### UI Icons, Motion & Tooling
| Library | Version | Role in Application |
| :--- | :--- | :--- |
| **lucide-react** | `^0.546.0` | UI iconography across workspace navigation, inspector controls, and badges |
| **motion** | `^12.23.24` | Smooth UI transitions |
| **tsx** | `^4.21.0` | TypeScript execution for dev server (`tsx server.ts`), deck generator, and `node:test` suite |
| **pptxgenjs** *(dev)* | latest | Programmatic generation of `docs/DocVerify_QE_Solution_Presentation.pptx` |

---

## Code & Directory Structure

```text
.
├── README.md                          # Project documentation & entry point
├── package.json                       # Scripts and dependencies
├── metadata.json                      # App identity & capability manifest
├── tsconfig.json                      # TypeScript compiler config
├── vite.config.ts                     # Vite build & React/Tailwind plugin setup
├── server.ts                          # Express 4 API server + Vite dev middleware (port 3000)
│
├── server/                            # Backend comparison, alignment, export & security engine
│   ├── adapters.ts                    # Format parsers (AFP MO:DCA, PDF, PCL, RT), Needleman-Wunsch page & line aligners, diff classifier
│   ├── fixtures.ts                    # Approved inventory configs, Design Pack data, and 7 synthetic runs (RUN-2026-1101..1107)
│   ├── reportExport.ts                # Highlighted PDF report (pdf-lib) and Visual HTML report generators
│   └── security.ts                    # PII redaction, path traversal sanitizer, GZIP bomb guard, config validator, SHA-256
│
├── src/                               # React 19 frontend workspace
│   ├── main.tsx                       # React root mount
│   ├── index.css                      # Tailwind CSS v4 import & typography tokens
│   ├── App.tsx                        # Workspace shell, sidebar nav, KPI strip, run filters & table
│   ├── types/
│   │   └── qe.ts                      # Shared TypeScript domain contracts (ComparisonRun, AlignedPageSlot, TextDiffLine, etc.)
│   ├── lib/
│   │   └── diffColors.ts              # Unified 6-category color-coded difference palette & token styling
│   └── components/
│       ├── AllPagesVisualCompare.tsx  # Scrollable all-pages side-by-side visual viewer with dual-file highlights & pixel diff
│       ├── SideBySideDiffView.tsx     # Inline token-level color-coded line diff table
│       ├── RunInspector.tsx           # 6-tab run inspection shell + report exports + Human Sign-Off form
│       ├── AfpNativeInspector.tsx     # Direct MO:DCA structured field, EBCDIC TLE, PTOCA canvas, & Papyrus proxy uploader
│       ├── PdfVisualDiff.tsx          # Single-page high-zoom PDF canvas overlay, slider, & pixel-diff heatmap
│       ├── NewComparisonView.tsx      # File upload comparison runner & negative security test launcher
│       ├── AdaptersView.tsx           # Format adapter capabilities & verification boundaries matrix
│       ├── ConfigView.tsx             # Inventory configuration rules & live JSON policy validator
│       ├── DesignPackView.tsx         # Requirements register, threat assessment, & phased rollout plan
│       └── OutcomeBadge.tsx           # Consistent status badge component
│
├── tests/
│   └── qe-engine.test.ts              # Automated unit & integration tests (node:test)
│
├── scripts/
│   └── generate-deck.ts               # Script to build docs/DocVerify_QE_Solution_Presentation.pptx
│
└── docs/
    ├── HOW_TO_USE.md                  # Detailed QE operator guide
    ├── TECHNICAL_DESIGN.md            # In-depth Technical Design Document (TDD)
    └── DocVerify_QE_Solution_Presentation.pptx  # Solution overview slide deck
```

---

## Quick Start

### Prerequisites
- **Node.js 20+** (tested on Node 22)
- **npm**

### Install & Run Locally
```bash
# 1. Install dependencies
npm install

# 2. Start the full-stack Express + Vite server on http://localhost:3000
npm run dev
```

### Verification & Build Commands
```bash
# Type-check with TypeScript
npm run lint

# Run automated QE engine, security, AFP native, & 6-vs-7 page alignment tests
npx tsx --test tests/qe-engine.test.ts

# Production frontend build
npm run build

# Regenerate the PowerPoint presentation deck
npx tsx scripts/generate-deck.ts
```

---

## Pre-Loaded Synthetic Validation Runs

When the server starts, `initializeSyntheticStore()` seeds **7 deterministic synthetic runs** covering every format and edge case:

| Run ID | Format | Outcome | What It Demonstrates |
| :--- | :--- | :--- | :--- |
| `RUN-2026-1101` | `PDF` | `CONFIRMED_DEFECT` | 2-page Checking Statement with Page 1 pure `ALIGNMENT_SHIFT` and Page 2 `TEXT_CHANGE` + `FONT_STYLE` |
| `RUN-2026-1102` | `PCL` | `CONFIRMED_DEFECT` | Mortgage Escrow Notice with `CONTROL_METADATA` (tray/pitch drift) and `MISSING_CONTENT` disclosure |
| `RUN-2026-1103` | `RT` | `VERIFIED_PASS` | Daily Reconciliation report with identical banners, control totals, and CRLF line endings |
| `RUN-2026-1104` | `AFP` | `POTENTIAL_VARIANCE` | Direct native MO:DCA binary comparison (`IMM` Duplex→Simplex drift, `TLE` tray drift, `PTOCA` Y-coordinate & `SCFL` font drift) awaiting ISIS Papyrus human review |
| `RUN-2026-1105` | `RT` | `BLOCKED` | Zero-byte candidate output demonstrating the **no-false-pass** policy |
| `RUN-2026-1106` | `RT` | `CONFIRMED_DEFECT` | Wire Settlement report combining `TEXT_CHANGE`, `ALIGNMENT_SHIFT`, `MISSING_CONTENT`, `CONTROL_METADATA`, and aligned trailing footer |
| `RUN-2026-1107` | `PDF` | `CONFIRMED_DEFECT` | **6-page Source vs. 7-page Destination** where Destination Page 3 is an inserted white/blank page; Slot 3 flags the missing source blank page while Slots 4–7 keep Source Pages 3–6 aligned to Destination Pages 4–7 |
