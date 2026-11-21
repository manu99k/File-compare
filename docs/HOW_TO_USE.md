# DocVerify QE — How-to-Use Guide

This guide walks Quality Engineers (QE), Print Operations analysts, and migration leads through every workflow in **DocVerify QE** — from inspecting pre-loaded runs and handling shifted/blank pages to running native AFP checks, executing negative security tests, and exporting annotated difference reports.

---

## 1. Navigating the Workspace

The left sidebar organizes the workbench into five areas:

1. **Comparison Runs** — Master dashboard displaying KPI counters (`Total Runs`, `Verified Pass`, `Confirmed Defect`, `Human Review / Papyrus`, `Blocked`), format filters (`All Formats`, `AFP`, `PDF`, `PCL`, `RT / RPT`), outcome filters, free-text search, and the run table. Click any row to open the **Run Inspector**.
2. **New Comparison** — Upload a baseline (**IMDS / OpenText DCP**) file and candidate (**DDGS / SmartComm**) file against an approved Inventory Configuration, or launch one-click **Negative Security Tests**.
3. **Adapters & Coverage** — Reference matrix showing each format adapter (`AFP`, `PDF`, `PCL`, `RT`, `GZIP`), parser engine, supported checks, explicit verification blind spots, and human-review triggers.
4. **Inventory & Config** — Read-only view of approved application configurations (`CHK/STMT_MTH`, `MTG/ESCROW_ADJ`, `OPS/DAILY_RECON`, `DDA/CYCLE_PRINT`) plus an interactive **Live Config Policy Validator** to test JSON rules.
5. **Design & Risk Pack** — Built-in traceability matrix covering Requirements (`REQ-01`..`REQ-07`), Threat Assessment (`THR-01`..`THR-04`), Unresolved Architecture Questions, and the Phased Rollout Plan.

---

## 2. Inspecting a Run: All-Pages Visual Side-by-Side Comparison

Click any run in **Comparison Runs** (for example, **`RUN-2026-1107`** or **`RUN-2026-1101`**). The inspector opens on the default **`Visual All-Pages (N slots)`** tab.

### Controls in the Visual All-Pages Window
- **Filter Slots**: Switch between `All Aligned Pages (N)` and `Pages With Differences (M)` to focus immediately on defects.
- **Highlight Both Files** *(Checkbox)*: Draws color-coded bounding boxes directly on **both** the Source (left) and Destination (right) rendered pages so you can see where text changed, shifted coordinates, changed fonts, or went missing.
- **Show Pixel Diff Column** *(PDF only)*: Adds a third middle/right canvas column highlighting exact pixel-level rendering differences between the aligned Source and Destination PDF pages.
- **Page Size**: Adjust canvas scale between `Compact`, `Standard`, and `Large`.
- **Page Alignment Map Strip**: Click any slot chip (`Slot 1`, `Slot 2`, ...) at the top to scroll directly to that aligned page pair.

### Example: Inspecting a 6-vs-7 Page Mismatch (`RUN-2026-1107`)
1. Open **`RUN-2026-1107`** from the runs table.
2. Observe the **Page Alignment Map** across 7 slots (`6` Source pages vs. `7` Destination pages):
   - **Slot 1 & Slot 2**: `Src P1 ↔ Dst P1` and `Src P2 ↔ Dst P2` (`MATCHED`).
   - **Slot 3**: Destination Page 3 is an inserted white/blank page (`INSERTED_IN_CANDIDATE`). The left Source pane clearly displays **"No White / Blank Page in Source File"**, while the right Destination pane frames **Page 3** with a teal **"Inserted White / Blank Page"** badge.
   - **Slots 4–7**: Alignment automatically resumes (`Src P3 ↔ Dst P4`, `Src P4 ↔ Dst P5`, `Src P5 ↔ Dst P6`, `Src P6 ↔ Dst P7`).
   - **Slot 6 (`Src P5 ↔ Dst P6`)**: Both Source and Destination PDFs show color-coded highlights for the advisory fee **`TEXT_CHANGE` (`0.35% -> 0.45%`)** in red and **`ALIGNMENT_SHIFT` (`+24pt`)** in blue, with a line-level delta summary bar underneath the pair.

---

## 3. Understanding the Color-Coded Difference Legend

| Color | Category | What to Look For |
| :--- | :--- | :--- |
| **Red** (`#DC2626`) | `TEXT_CHANGE` | Numbers, balances, fees, dates, or words differ between IMDS and DDGS |
| **Blue** (`#2563EB`) | `ALIGNMENT_SHIFT` | Text matches, but X/Y coordinates, PTOCA `AMI`/`AMB` offsets, or columns shifted |
| **Violet** (`#7C3AED`) | `FONT_STYLE` | Font family, point size, PCL CPI pitch, AFP `SCFL` coded font ID, or line-ending/BOM changed |
| **Rose** (`#BE123C`) | `MISSING_CONTENT` | Line, regulatory disclosure, or whole page present in Source is absent in Destination |
| **Teal** (`#0D9488`) | `ADDED_CONTENT` | Extra line or inserted white/blank page exists only in Destination |
| **Amber** (`#D97706`) | `CONTROL_METADATA` | Printer tray (`TRAY_01` → `TRAY_02`), `DUPLEX` vs. `SIMPLEX`, `TLE` tag, or RT control total mismatch |

Switch to the **`Line-by-Line Diff`** tab to filter by diff category, view inline word/token highlights, or inspect delta tags (`X/Y`, `Font`, `Control`, `Critical`).

---

## 4. Format-Specific Deep Inspection (Tab 3)

The 3rd tab in the Run Inspector adapts automatically to the run's file format:

- **PDF — `Single-Page Canvas Inspector`**:
  - Step through individual pages with pixel-level tolerance slider (`0%–5%`), overlay opacity slider, or side-by-side / pixel-diff heatmap mode.
- **AFP — `Direct Native AFP (No PDF)`** *(try `RUN-2026-1104`)*:
  - Inspects binary **MO:DCA (`0x5A`)** structured fields without converting AFP to PDF.
  - Compares **EBCDIC-decoded `TLE` index tags**, **Resource & Medium Map bindings (`MCF`, `MPO`, `IMM`, `BBC`)**, and **PTOCA (`AMI`/`AMB`/`SCFL`)** coordinates rendered on a dual wireframe canvas.
  - **Optional ISIS Papyrus Visual Proxy**: If your team exports PDFs from ISIS Papyrus Viewer, upload both Papyrus PDFs inside the AFP inspector panel (`POST /api/runs/:id/papyrus-proxy`) to overlay Papyrus visual proof alongside native MO:DCA checks.
- **PCL — `PCL ESC & Layout`** *(try `RUN-2026-1102`)*:
  - Compares per-page printer control sequences: paper size (`&l#A`), orientation (`&l#O`), tray (`&l#H`), font pitch (`CPI`), point height, and escape command counts.
- **RT / RPT — `RT Banners & Control Totals`** *(try `RUN-2026-1103` or `RUN-2026-1106`)*:
  - Compares header banners, footer trailers, record counts, and parsed numeric control totals (`Total Debits`, `Total Credits`, `Net Settlement`, etc.).

---

## 5. Downloading Annotated Difference Reports

From either the **Run Inspector header** or the **Visual All-Pages toolbar**, export reports for Jira tickets, audit archives, or business sign-off:

1. **`Highlighted PDF Report`** *(Available for valid PDF runs)*:
   - Downloads `<RUN_ID>_visual_diff_report.pdf`.
   - **Page 1**: Executive cover, color legend, and aligned page-by-page status matrix.
   - **Pages 2..N**: One landscape sheet per aligned slot with Source and Destination pages side-by-side, color-coded highlight rectangles drawn directly onto both pages, blank/missing-page callouts, and a footer summary of differences.
2. **`Visual HTML Report`** *(Available for PDF, AFP, PCL, and RT runs)*:
   - Downloads `<RUN_ID>_visual_diff_report.html` — a self-contained, offline/print-ready visual report with highlighted page sheets and line diff tables.
3. **`JSON`** & **`CSV`**:
   - Downloads PII-redacted structured findings, SHA-256 baseline/candidate hashes, layer summaries, and review audit logs.

---

## 6. Uploading Your Own Synthetic Files & Running Negative Tests

1. Click **`New Comparison`** in the top bar or left sidebar.
2. Select an **Approved Inventory Configuration** (e.g., `CHK/STMT_MTH · PDF`).
3. Leave **Target Format Adapter** on `Auto-detect from file extension` (or select `AFP`, `PDF`, `PCL`, or `RT` explicitly).
4. Attach your **IMDS Baseline (Source)** file and **DDGS Candidate (Destination)** file (`.gz` compressed inputs are automatically decompressed within safety limits).
5. Click **`Run Comparison`**. The server computes SHA-256 hashes, runs all layers in memory, redacts any detected PII, and opens the new Run Inspector.

### Negative Security Tests
On the right panel of **New Comparison**, you can trigger four built-in negative verification scenarios:
- **Corrupt GZIP Stream** — Verifies truncated/invalid `.gz` files fail safely as `BLOCKED`.
- **Nested GZIP Bomb** — Verifies double-compressed `.gz` payloads are rejected.
- **Path Traversal Filename** (`../../etc/passwd.rt`) — Verifies directory separators are blocked and flagged.
- **Unsupported Archive** (`.zip` disguised as `.pdf`) — Verifies magic-byte validation rejects non-PDF binaries.

---

## 7. Recording Human Sign-Off (`Human Sign-Off` Tab)

For `POTENTIAL_VARIANCE` runs (such as **AFP** runs requiring ISIS Papyrus verification) or defect confirmation:
1. Open the **`Human Sign-Off`** tab.
2. Choose a decision: `Approve Pass`, `Confirm Defect`, `Request Retest`, or `Block Execution`.
3. Enter **Reviewer Identity**, **Tool Used & Version** (e.g., `ISIS Papyrus Viewer 7.8`), check the Papyrus visual checklist (for AFP), and provide a **Rationale**.
4. Submit to append an immutable timestamped `ReviewDecisionRecord` to the run and update the **Human Review** layer status.
