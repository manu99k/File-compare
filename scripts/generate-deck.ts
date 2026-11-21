import fs from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';

const C = {
  navy: '0F172A',
  navyMid: '1E293B',
  blue: '1D4ED8',
  blueLight: 'DBEAFE',
  teal: '0D9488',
  tealLight: 'CCFBF1',
  red: 'DC2626',
  redLight: 'FEE2E2',
  violet: '7C3AED',
  violetLight: 'EDE9FE',
  rose: 'BE123C',
  roseLight: 'FFE4E6',
  amber: 'D97706',
  amberLight: 'FEF3C7',
  emerald: '047857',
  emeraldLight: 'D1FAE5',
  bg: 'F8FAFC',
  white: 'FFFFFF',
  border: 'CBD5E1',
  text: '0F172A',
  muted: '475569',
  subtle: '64748B',
};

function addChrome(slide: PptxGenJS.Slide, title: string, subtitle: string, slideNum: number, totalSlides: number) {
  slide.background = { color: C.bg };

  // Top dark accent bar
  slide.addShape('rect', { x: 0, y: 0, w: 13.333, h: 0.08, fill: { color: C.blue } });

  // Header band
  slide.addText(title, {
    x: 0.6,
    y: 0.25,
    w: 10.6,
    h: 0.45,
    fontFace: 'Segoe UI',
    fontSize: 22,
    bold: true,
    color: C.navy,
  });
  slide.addText(subtitle, {
    x: 0.6,
    y: 0.68,
    w: 11.8,
    h: 0.3,
    fontFace: 'Segoe UI',
    fontSize: 11.5,
    color: C.muted,
  });

  // Top-right badge
  slide.addShape('roundRect', {
    x: 11.35,
    y: 0.28,
    w: 1.4,
    h: 0.32,
    fill: { color: C.blueLight },
    line: { color: C.blue, width: 0.75 },
    rectRadius: 0.05,
  });
  slide.addText('DocVerify QE', {
    x: 11.35,
    y: 0.28,
    w: 1.4,
    h: 0.32,
    fontFace: 'Segoe UI',
    fontSize: 9.5,
    bold: true,
    color: C.blue,
    align: 'center',
    valign: 'middle',
  });

  // Divider line
  slide.addShape('line', { x: 0.6, y: 1.05, w: 12.133, h: 0, line: { color: C.border, width: 1 } });

  // Footer
  slide.addText('DocVerify QE · IMDS / OpenText DCP -> DDGS / SmartComm Migration Validation Workbench', {
    x: 0.6,
    y: 7.12,
    w: 9.5,
    h: 0.25,
    fontFace: 'Segoe UI',
    fontSize: 8.5,
    color: C.subtle,
  });
  slide.addText(`Slide ${slideNum} of ${totalSlides}`, {
    x: 11.2,
    y: 7.12,
    w: 1.533,
    h: 0.25,
    fontFace: 'Segoe UI',
    fontSize: 8.5,
    color: C.subtle,
    align: 'right',
  });
}

function addCard(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  heading: string,
  bullets: string[],
  accentHex = C.blue
) {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    fill: { color: C.white },
    line: { color: C.border, width: 1 },
    rectRadius: 0.06,
  });
  slide.addShape('rect', { x, y, w, h: 0.06, fill: { color: accentHex } });
  slide.addText(heading, {
    x: x + 0.18,
    y: y + 0.14,
    w: w - 0.36,
    h: 0.35,
    fontFace: 'Segoe UI',
    fontSize: 13,
    bold: true,
    color: C.navy,
  });
  slide.addText(
    bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } })),
    {
      x: x + 0.18,
      y: y + 0.52,
      w: w - 0.36,
      h: h - 0.64,
      fontFace: 'Segoe UI',
      fontSize: 10.5,
      color: C.muted,
      valign: 'top',
    }
  );
}

type CellInput = string | PptxGenJS.TableCell;
function toTableRows(raw: CellInput[][]): PptxGenJS.TableRow[] {
  return raw.map((row) => row.map((c) => (typeof c === 'string' ? { text: c } : c)));
}

async function buildDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pptx.title = 'DocVerify QE — Migration Output Validation Solution';
  pptx.subject = 'IMDS/OpenText DCP to DDGS/SmartComm Document Diff Workbench';
  pptx.author = 'DocVerify QE Engineering';

  const TOTAL = 12;

  // =========================================================================
  // SLIDE 1: TITLE SLIDE
  // =========================================================================
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    s.addShape('rect', { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: C.teal } });
    s.addShape('rect', { x: 0.18, y: 0, w: 0.08, h: 7.5, fill: { color: C.blue } });

    s.addShape('roundRect', {
      x: 0.85,
      y: 1.05,
      w: 3.1,
      h: 0.36,
      fill: { color: '1E293B' },
      line: { color: C.teal, width: 1 },
      rectRadius: 0.05,
    });
    s.addText('QUALITY ENGINEERING WORKBENCH', {
      x: 0.85,
      y: 1.05,
      w: 3.1,
      h: 0.36,
      fontFace: 'Segoe UI',
      fontSize: 10,
      bold: true,
      color: '5EEAD4',
      align: 'center',
      valign: 'middle',
    });

    s.addText('DocVerify QE', {
      x: 0.85,
      y: 1.7,
      w: 11.4,
      h: 0.85,
      fontFace: 'Segoe UI',
      fontSize: 42,
      bold: true,
      color: C.white,
    });
    s.addText('Automated & Human-in-the-Loop Document Output Validation\nIMDS / OpenText DCP  ->  DDGS / SmartComm Migration', {
      x: 0.85,
      y: 2.65,
      w: 11.2,
      h: 1.1,
      fontFace: 'Segoe UI',
      fontSize: 20,
      color: 'CBD5E1',
    });

    const pills = [
      { label: 'AFP (Direct MO:DCA + Papyrus)', col: C.teal },
      { label: 'PDF (Visual All-Pages & Pixel Diff)', col: C.blue },
      { label: 'PCL5 (ESC Tray / Font Drift)', col: C.violet },
      { label: 'RT / RPT (Control Totals)', col: C.amber },
    ];
    pills.forEach((p, i) => {
      const px = 0.85 + i * 2.95;
      s.addShape('roundRect', {
        x: px,
        y: 4.3,
        w: 2.75,
        h: 0.55,
        fill: { color: '1E293B' },
        line: { color: p.col, width: 1.2 },
        rectRadius: 0.05,
      });
      s.addText(p.label, {
        x: px + 0.08,
        y: 4.3,
        w: 2.59,
        h: 0.55,
        fontFace: 'Segoe UI',
        fontSize: 10.5,
        bold: true,
        color: C.white,
        align: 'center',
        valign: 'middle',
      });
    });

    s.addText('Local Synthetic Sandbox · Color-Coded Dual-File Visual Highlights · Blank/Shifted Page Sequence Alignment · Annotated PDF & HTML Exports', {
      x: 0.85,
      y: 5.55,
      w: 11.5,
      h: 0.6,
      fontFace: 'Segoe UI',
      fontSize: 11.5,
      color: '94A3B8',
    });

    s.addNotes('Title slide introducing DocVerify QE for IMDS/OpenText DCP to DDGS/SmartComm output validation.');
  }

  // =========================================================================
  // SLIDE 2: BUSINESS PROBLEM & QE CHALLENGES
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Migration Validation Challenges',
      'Why generic text diffs or blind AFP-to-PDF conversion fail Quality Engineering teams',
      2,
      TOTAL
    );

    addCard(
      s,
      0.6,
      1.3,
      5.9,
      2.65,
      '1. Lossy AFP-to-PDF Conversion Defects',
      [
        'Converting mainframe/IMDS AFP streams to PDF often masks or distorts EBCDIC TLE index tags, IMM duplex/simplex medium maps, and coded font (SCFL) bindings.',
        'False rendering artifacts waste QE triage time while hiding real print-stream regressions.',
        'QE requires direct binary MO:DCA inspection alongside ISIS Papyrus viewer sign-off.',
      ],
      C.teal
    );

    addCard(
      s,
      6.83,
      1.3,
      5.9,
      2.65,
      '2. Blank Page & Cascading Page-Shift Failures',
      [
        'Real-world migration runs frequently differ in page count (e.g., 6 pages in Source vs. 7 pages in Destination due to an inserted blank/duplex separator page at Page 3).',
        'Naive 1:1 page indexing flags every trailing page (Pages 3–6 vs. 4–7) as completely broken.',
        'QE needs sequence-aware page alignment to isolate the blank page and keep matching subsequent pages.',
      ],
      C.blue
    );

    addCard(
      s,
      0.6,
      4.2,
      5.9,
      2.65,
      '3. Hidden Layout, Font & Print-Control Drift',
      [
        'Text-only comparisons miss X/Y coordinate shifts, clipped fee tables, PCL tray/CPI pitch changes, and CRLF vs. LF line-ending regressions.',
        'Different defect types require distinct visual colors on BOTH Source and Destination documents so analysts immediately separate text edits from coordinate shifts.',
      ],
      C.violet
    );

    addCard(
      s,
      6.83,
      4.2,
      5.9,
      2.65,
      '4. Security, PII & Audit Evidence Risks',
      [
        'Customer statements contain SSNs, account numbers, and emails that must never leak into diff logs or lower-env Jira attachments.',
        'Empty/corrupt files or invalid .gz archives must never register as false passes; every run needs SHA-256 chain-of-custody and human sign-off.',
      ],
      C.red
    );

    s.addNotes('Covers the four primary QE bottlenecks solved by DocVerify QE.');
  }

  // =========================================================================
  // SLIDE 3: SOLUTION OVERVIEW
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'DocVerify QE Solution Overview',
      'Configuration-driven, multi-layer QE workbench built for zero false-passes and visual clarity',
      3,
      TOTAL
    );

    const pillars = [
      {
        title: 'All-Pages Visual Side-by-Side',
        desc: 'Scrollable Source vs. Destination viewer showing every aligned page simultaneously with color highlights drawn directly on BOTH files.',
        col: C.blue,
      },
      {
        title: 'Smart Blank-Page Alignment',
        desc: 'Needleman-Wunsch page sequence aligner detects inserted white pages and continues matching all subsequent pages accurately.',
        col: C.teal,
      },
      {
        title: 'Direct Native AFP Engine',
        desc: 'Parses binary MO:DCA 0x5A, EBCDIC TLEs, IMM maps, and PTOCA X/Y coordinates directly without converting AFP to PDF.',
        col: C.violet,
      },
      {
        title: 'Downloadable Diff Reports',
        desc: 'Exports multi-page annotated PDF diff reports (with highlights on both pages) and self-contained HTML visual reports for all 4 formats.',
        col: C.amber,
      },
      {
        title: 'Strict Policy & PII Guardrails',
        desc: 'Blocks production submission, redacts PII automatically, validates GZIP streams against bombs, and logs SHA-256 evidence hashes.',
        col: C.red,
      },
      {
        title: 'Human-in-the-Loop Sign-Off',
        desc: 'Tracks 5 independent validation layers and records QE / Papyrus reviewer identity, tool version, checklist, and rationale.',
        col: C.emerald,
      },
    ];

    pillars.forEach((p, idx) => {
      const colIdx = idx % 3;
      const rowIdx = Math.floor(idx / 3);
      const px = 0.6 + colIdx * 4.15;
      const py = 1.32 + rowIdx * 2.75;
      addCard(s, px, py, 3.85, 2.45, p.title, [p.desc], p.col);
    });

    s.addNotes('High-level summary of the six core pillars of the solution.');
  }

  // =========================================================================
  // SLIDE 4: ARCHITECTURE & TECH STACK
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'System Architecture & Technology Stack',
      'Full-stack TypeScript application running Express 4 + React 19 + Vite 8 on a unified port 3000 runtime',
      4,
      TOTAL
    );

    // Three horizontal architectural tiers
    const tiers = [
      {
        x: 0.6,
        title: 'Client Layer (React 19 + Tailwind CSS v4)',
        col: C.blue,
        items: [
          'App.tsx workspace & RunInspector (6 tabs)',
          'AllPagesVisualCompare: dual canvas + pixel diff',
          'SideBySideDiffView: inline token diff table',
          'AfpNativeInspector: PTOCA wireframe + Papyrus upload',
          'PdfVisualDiff: single-page slider & heatmap',
          'pdfjs-dist browser worker (/pdf.worker.min.mjs)',
        ],
      },
      {
        x: 4.82,
        title: 'Server API & Engine (Express 4 + Node.js)',
        col: C.teal,
        items: [
          'server.ts: REST APIs + Multer memoryStorage (15MB)',
          'server/adapters.ts: PDF, AFP, PCL5, RT parsers',
          'alignDocumentPages(): Needleman-Wunsch aligner',
          'computePageTextDiffs(): 6-category classifier',
          'server/reportExport.ts: pdf-lib & HTML exporters',
          'server/fixtures.ts: 7 synthetic runs (1101..1107)',
        ],
      },
      {
        x: 9.04,
        title: 'Security, Storage & Libraries',
        col: C.navyMid,
        items: [
          'server/security.ts: PII redaction & SHA-256',
          'safeGunzip(): 15MB & 50:1 ratio bomb guard',
          'sanitizeFilename(): path traversal blocker',
          'pdf-lib ^1.17.1 & pdfjs-dist ^6.5.438',
          'lucide-react ^0.546.0 & motion ^12.23.24',
          'tsx + node:test automated test suite (8 suites)',
        ],
      },
    ];

    tiers.forEach((t) => {
      addCard(s, t.x, 1.32, 3.68, 5.45, t.title, t.items, t.col);
    });

    // Connecting arrows between tiers
    s.addText('REST / Multipart\n& Binary Streams\n-->', {
      x: 4.3,
      y: 3.6,
      w: 0.5,
      h: 0.9,
      fontFace: 'Segoe UI',
      fontSize: 7.5,
      bold: true,
      color: C.blue,
      align: 'center',
    });
    s.addText('In-Memory\nValidation\n-->', {
      x: 8.52,
      y: 3.6,
      w: 0.5,
      h: 0.9,
      fontFace: 'Segoe UI',
      fontSize: 7.5,
      bold: true,
      color: C.teal,
      align: 'center',
    });

    s.addNotes('Explains code structure across src/, server/, and library dependencies from package.json.');
  }

  // =========================================================================
  // SLIDE 5: COLOR-CODED VISUAL COMPARISON
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Color-Coded Difference Taxonomy & Dual-File Highlights',
      'Every difference category gets a consistent color across UI canvases, line diffs, PDF exports, and HTML reports',
      5,
      TOTAL
    );

    const rows = toTableRows([
      [
        { text: 'Color / Code', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Category', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'What It Highlights on Source & Destination', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Examples Across Formats', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      [
        { text: '#DC2626 (Red)', options: { bold: true, fill: { color: C.redLight }, color: C.red } },
        { text: 'TEXT_CHANGE', options: { bold: true } },
        'Word, balance, fee, date, or character mismatch with inline token underline',
        'PDF Fee 0.35% -> 0.45%; RT wire amount mismatch',
      ],
      [
        { text: '#2563EB (Blue)', options: { bold: true, fill: { color: C.blueLight }, color: C.blue } },
        { text: 'ALIGNMENT_SHIFT', options: { bold: true } },
        'X/Y position, PTOCA AMI/AMB, or fixed-width column spacing shift',
        'PDF +24pt X-shift; AFP Y 470 -> 512; RT column pad',
      ],
      [
        { text: '#7C3AED (Violet)', options: { bold: true, fill: { color: C.violetLight }, color: C.violet } },
        { text: 'FONT_STYLE', options: { bold: true } },
        'Font family, point size, PCL CPI pitch, AFP SCFL coded font, or EOL/BOM',
        'PDF 10pt -> 9pt; AFP SCFL 2 -> 3; CRLF -> LF',
      ],
      [
        { text: '#BE123C (Rose)', options: { bold: true, fill: { color: C.roseLight }, color: C.rose } },
        { text: 'MISSING_CONTENT', options: { bold: true } },
        'Line, row, regulatory disclosure, or page present in Source but absent in Dest',
        'Omitted FDIC disclosure; missing RT settlement row',
      ],
      [
        { text: '#0D9488 (Teal)', options: { bold: true, fill: { color: C.tealLight }, color: C.teal } },
        { text: 'ADDED_CONTENT', options: { bold: true } },
        'Extra line or inserted white/blank page present only in Destination',
        'Inserted blank Page 3 in RUN-2026-1107',
      ],
      [
        { text: '#D97706 (Amber)', options: { bold: true, fill: { color: C.amberLight }, color: C.amber } },
        { text: 'CONTROL_METADATA', options: { bold: true } },
        'Printer tray, duplex IMM, mailroom TLE tag, or RT numeric control total',
        'AFP DUPLEX01 -> SIMPLEX1; PCL Tray 1 -> Tray 2',
      ],
    ]);

    s.addTable(rows, {
      x: 0.6,
      y: 1.3,
      w: 12.133,
      colW: [1.85, 2.25, 4.433, 3.6],
      border: { pt: 0.75, color: C.border },
      fontFace: 'Segoe UI',
      fontSize: 10.5,
      rowH: 0.72,
      valign: 'middle',
      margin: [0.06, 0.1, 0.06, 0.1],
    });

    s.addNotes('Unified color taxonomy defined in src/lib/diffColors.ts and mirrored in server/reportExport.ts.');
  }

  // =========================================================================
  // SLIDE 6: SMART 6-vs-7 BLANK PAGE ALIGNMENT
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Smart Blank & Shifted Page Sequence Alignment (RUN-2026-1107)',
      'Needleman-Wunsch dynamic programming prevents off-by-1 cascading errors when white pages are inserted',
      6,
      TOTAL
    );

    const slotRows = toTableRows([
      [
        { text: 'Aligned Slot', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Source (IMDS - 6 Pages)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Destination (DDGS - 7 Pages)', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Slot Status', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Visual & Diff Result', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ['Slot 1', 'Page 1 (Summary)', 'Page 1 (Summary)', { text: 'MATCHED', options: { fill: { color: C.emeraldLight }, color: C.emerald, bold: true } }, '100% content & layout match'],
      ['Slot 2', 'Page 2 (Holdings)', 'Page 2 (Holdings)', { text: 'MATCHED', options: { fill: { color: C.emeraldLight }, color: C.emerald, bold: true } }, '100% content & layout match'],
      [
        { text: 'Slot 3', options: { bold: true, fill: { color: C.tealLight } } },
        { text: 'NO WHITE / BLANK PAGE IN SOURCE', options: { bold: true, fill: { color: C.tealLight }, color: C.teal } },
        { text: 'Page 3 (Inserted White / Blank)', options: { bold: true, fill: { color: C.tealLight }, color: C.teal } },
        { text: 'INSERTED_IN_CANDIDATE', options: { bold: true, fill: { color: C.tealLight }, color: C.teal } },
        { text: 'Isolated as blank gap (-0.08 penalty); no cascade!', options: { fill: { color: C.tealLight } } },
      ],
      ['Slot 4', 'Page 3 (Transactions)', 'Page 4 (Transactions)', { text: 'MATCHED', options: { fill: { color: C.emeraldLight }, color: C.emerald, bold: true } }, 'Auto-realigned Src P3 <-> Dst P4'],
      ['Slot 5', 'Page 4 (Tax Lot)', 'Page 5 (Tax Lot)', { text: 'MATCHED', options: { fill: { color: C.emeraldLight }, color: C.emerald, bold: true } }, 'Auto-realigned Src P4 <-> Dst P5'],
      [
        { text: 'Slot 6', options: { bold: true, fill: { color: C.redLight } } },
        { text: 'Page 5 (Advisory Fee 0.35%)', options: { fill: { color: C.redLight } } },
        { text: 'Page 6 (Advisory Fee 0.45%, +24pt)', options: { fill: { color: C.redLight } } },
        { text: 'DIFF_DETECTED', options: { bold: true, fill: { color: C.redLight }, color: C.red } },
        { text: 'Highlights TEXT_CHANGE (Red) + ALIGNMENT_SHIFT (Blue) on BOTH', options: { fill: { color: C.redLight } } },
      ],
      ['Slot 7', 'Page 6 (Disclosures)', 'Page 7 (Disclosures)', { text: 'MATCHED', options: { fill: { color: C.emeraldLight }, color: C.emerald, bold: true } }, 'Auto-realigned Src P6 <-> Dst P7'],
    ]);

    s.addTable(slotRows, {
      x: 0.6,
      y: 1.25,
      w: 12.133,
      colW: [1.15, 2.7, 2.8, 2.2, 3.283],
      border: { pt: 0.75, color: C.border },
      fontFace: 'Segoe UI',
      fontSize: 10,
      rowH: 0.56,
      valign: 'middle',
      margin: [0.04, 0.08, 0.04, 0.08],
    });

    addCard(
      s,
      0.6,
      5.88,
      12.133,
      1.05,
      'How Blank Page Detection + Scoring Matrix Works',
      [
        'pdfjs-dist inspects both extracted text and page operator lists (paintImageXObject, stroke, fill, showText) to flag true white pages. alignDocumentPages() assigns -5.0 to blank-vs-content pairing and only -0.08 to an unaligned blank gap, guaranteeing clean alignment of all remaining pages.',
      ],
      C.teal
    );

    s.addNotes('Walks through the exact 6-vs-7 page scenario requested by the user and implemented in RUN-2026-1107.');
  }

  // =========================================================================
  // SLIDE 7: DIRECT NATIVE AFP VALIDATION (NO PDF CONVERSION)
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Direct Native AFP Validation (Zero PDF Conversion)',
      'Validates binary MO:DCA 0x5A streams, EBCDIC metadata, and PTOCA coordinates directly alongside ISIS Papyrus',
      7,
      TOTAL
    );

    addCard(
      s,
      0.6,
      1.3,
      6.0,
      2.65,
      'MO:DCA Structured Field & EBCDIC Decoder',
      [
        'Scans 0x5A structured fields (BDT/EDT, BNG/ENG, BPG/EPG, BAG/EAG, NOP) without PDF conversion.',
        'Translates native EBCDIC CP037/CP500 streams to readable ASCII automatically.',
        'Detects IMM (D3ABCC) medium map drift (e.g., DUPLEX01 -> SIMPLEX1) and TLE (D3A090) mail-tray drift (TRAY_01 -> TRAY_02).',
      ],
      C.teal
    );

    addCard(
      s,
      6.8,
      1.3,
      5.93,
      2.65,
      'PTOCA Coordinate Wireframe & Resource Parity',
      [
        'Parses PTX (D3EE9B) chained commands: AMI (X), AMB (Y), SCFL (coded font ID), and TRN (text run).',
        'Plots Source vs. Destination runs on a dual wireframe canvas scaled from PGD (D3A6AF) page geometry (e.g., 2040x2640 @ 240 DPI).',
        'Verifies MCF font, MPO overlay, MPS page segment, and BBC barcode bindings.',
      ],
      C.blue
    );

    addCard(
      s,
      0.6,
      4.2,
      12.133,
      2.6,
      'ISIS Papyrus Human-in-the-Loop Integration (RUN-2026-1104)',
      [
        'Because inline AFP streams may reference external mainframe FOCA/OVL/PSEG libraries or MICR/barcode artwork, AFP runs automatically enforce POTENTIAL_VARIANCE (never silent false-pass).',
        'QE analysts open baseline & candidate .afp files in ISIS Papyrus Viewer, optionally attach Papyrus-exported visual PDF proxies via /api/runs/:id/papyrus-proxy, and record tool version + checklist sign-off.',
      ],
      C.amber
    );

    s.addNotes('Addresses user requirement to validate AFP directly without buggy PDF conversion while keeping Papyrus workflow.');
  }

  // =========================================================================
  // SLIDE 8: MULTI-FORMAT COVERAGE MATRIX
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Pluggable Format Adapter Coverage Matrix',
      'Explicit capabilities, automated checks, and verification boundaries declared per format',
      8,
      TOTAL
    );

    const matrixRows = toTableRows([
      [
        { text: 'Format', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Parser Engine', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Automated Checks Performed', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Declared Limits / Review Trigger', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      [
        { text: 'AFP', options: { bold: true, color: C.teal } },
        'MO:DCA 0x5A + PTOCA + TLE + EBCDIC Parser',
        'Structured field parity, TLE/BNG keys, IMM duplex/tray, MCF/MPO resources, PTOCA X/Y drift',
        'External FOCA/OVL artwork & MICR scanability require ISIS Papyrus sign-off',
      ],
      [
        { text: 'PDF', options: { bold: true, color: C.blue } },
        'pdf-lib + pdfjs-dist Canvas & Operator Engine',
        'MediaBox parity, blank-page sequence alignment, line X/Y/font diffs, browser pixel heatmap',
        'Physical printer finishing outside PDF; human review if pixel diff > tolerance',
      ],
      [
        { text: 'PCL5', options: { bold: true, color: C.violet } },
        'ESC Sequence & Form-Feed Stream Parser',
        'ESC E reset, page size (&l#A), orientation (&l#O), tray (&l#H), CPI pitch, font pt, cursor X/Y',
        'Downloaded soft-font binary glyphs; triggers review on tray/font divergence',
      ],
      [
        { text: 'RT / RPT', options: { bold: true, color: C.amber } },
        'Line, Banner & Control-Total Parser',
        'UTF-8 BOM, CRLF/LF/MIXED EOL, banners/footers, record counts, numeric control totals',
        'Downstream mainframe JCL routing; column & missing-row alignment checks',
      ],
      [
        { text: 'GZIP (.gz)', options: { bold: true, color: C.red } },
        'Bounded zlib Stream Pre-Processor',
        '0x1F 0x8B header check, 15 MB & 50:1 ratio cap, nested archive rejection, payload forwarding',
        'Non-GZIP archives (.zip/.7z) rejected as BLOCKED',
      ],
    ]);

    s.addTable(matrixRows, {
      x: 0.6,
      y: 1.32,
      w: 12.133,
      colW: [1.3, 3.0, 4.3, 3.533],
      border: { pt: 0.75, color: C.border },
      fontFace: 'Segoe UI',
      fontSize: 10,
      rowH: 0.96,
      valign: 'middle',
      margin: [0.06, 0.1, 0.06, 0.1],
    });

    s.addNotes('Matches ADAPTER_REGISTRY in server/adapters.ts.');
  }

  // =========================================================================
  // SLIDE 9: DOWNLOADABLE HIGHLIGHTED REPORTS
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Downloadable Highlighted Difference Reports',
      'Audit-ready artifacts highlighting differences in BOTH Source and Destination files for offline review & Jira',
      9,
      TOTAL
    );

    addCard(
      s,
      0.6,
      1.35,
      5.9,
      3.55,
      'Annotated Side-by-Side Diff PDF (?format=diff-pdf)',
      [
        'Generated server-side via pdf-lib in 1240x860 landscape layout.',
        'Page 1 Cover Sheet: Run metadata, SHA-256 hashes, 6-color legend, and aligned page-by-page matrix.',
        'Pages 2..N: Embeds Source (left) and Destination (right) pages side-by-side.',
        'Draws color-coded translucent highlight rectangles directly on BOTH Source and Destination differing lines.',
        'Resilient to blank/empty PDF streams (checks normalizedEntries().Contents before embedding and draws clear callout banners).',
      ],
      C.blue
    );

    addCard(
      s,
      6.83,
      1.35,
      5.9,
      3.55,
      'Visual HTML Report (?format=html) + JSON / CSV',
      [
        'Self-contained HTML report supporting ALL 4 formats: PDF, AFP, PCL, and RT/RPT.',
        'Renders proportional visual page sheets with color-coded bounding boxes and inline word-level <mark> token highlights.',
        'Print-ready CSS (@media print) with clean slot pagination.',
        'Redacted JSON & CSV exports supply machine-readable findings, layer summaries, and human review trails.',
      ],
      C.teal
    );

    // Visual layout preview strip at bottom
    s.addShape('roundRect', {
      x: 0.6,
      y: 5.15,
      w: 12.133,
      h: 1.65,
      fill: { color: C.navy },
      rectRadius: 0.06,
    });
    s.addText('REPORT SHEET ANATOMY (Per Aligned Slot)', {
      x: 0.85,
      y: 5.26,
      w: 5.0,
      h: 0.28,
      fontFace: 'Segoe UI',
      fontSize: 10.5,
      bold: true,
      color: '5EEAD4',
    });
    const parts = [
      '1. Slot Banner\n(Src P5 <-> Dst P6)',
      '2. Embedded Source\n+ Color Boxes',
      '3. Embedded Dest\n+ Color Boxes / Blank Banner',
      '4. Delta Footer\n(Category + X/Y/Font Notes)',
    ];
    parts.forEach((pt, idx) => {
      const bx = 0.85 + idx * 2.96;
      s.addShape('roundRect', {
        x: bx,
        y: 5.62,
        w: 2.76,
        h: 0.96,
        fill: { color: C.navyMid },
        line: { color: C.blue, width: 1 },
        rectRadius: 0.05,
      });
      s.addText(pt, {
        x: bx + 0.08,
        y: 5.62,
        w: 2.6,
        h: 0.96,
        fontFace: 'Segoe UI',
        fontSize: 9.5,
        color: C.white,
        align: 'center',
        valign: 'middle',
      });
    });

    s.addNotes('Explains server/reportExport.ts outputs and blank-page PDF resilience.');
  }

  // =========================================================================
  // SLIDE 10: SECURITY, PRIVACY & GOVERNANCE
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Security, Privacy & Configuration Governance',
      'Defense-in-depth controls protecting lower environments and preventing silent false-passes',
      10,
      TOTAL
    );

    addCard(
      s,
      0.6,
      1.32,
      3.85,
      2.6,
      'PII Redaction Filter',
      [
        'Automatically masks SSNs, email addresses, bearer/API tokens, and 12–16 digit account numbers before persisting diffs or exporting reports.',
        'Preserves last 4 account digits (****-****-XXXX) for QE traceability.',
      ],
      C.red
    );

    addCard(
      s,
      4.74,
      1.32,
      3.85,
      2.6,
      'Archive & Path Hardening',
      [
        'Zero disk writes: Multer processes uploads strictly in memory (15 MB cap).',
        'sanitizeFilename() blocks ../, /, \\, and null bytes.',
        'safeGunzip() blocks corrupt headers, >50:1 bombs, and nested .gz streams.',
      ],
      C.amber
    );

    addCard(
      s,
      8.88,
      1.32,
      3.85,
      2.6,
      'Policy-Driven Config Gate',
      [
        'productionSubmissionAllowed must be strictly false.',
        'Requires Approved status, explicit piiFields list, and deterministic pairingKeys.',
        'Live validator UI tests custom JSON policies before execution.',
      ],
      C.blue
    );

    addCard(
      s,
      0.6,
      4.2,
      12.133,
      2.55,
      'No-False-Pass Outcome Taxonomy & Cryptographic Chain of Custody',
      [
        'Five distinct outcomes: VERIFIED_PASS | CONFIRMED_DEFECT | POTENTIAL_VARIANCE (Human Review) | BLOCKED | NOT_RUN.',
        'Zero-byte, truncated, or mismatched-magic artifacts (e.g., .zip renamed to .pdf) resolve deterministically to BLOCKED.',
        'Every baseline and candidate artifact is fingerprinted with SHA-256 and paired with immutable Human Sign-Off records.',
      ],
      C.emerald
    );

    s.addNotes('Covers Threat Assessment THR-01..THR-04 and server/security.ts.');
  }

  // =========================================================================
  // SLIDE 11: PRE-LOADED FIXTURES & TEST VERIFICATION
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Pre-Loaded Synthetic Runs & Automated Verification',
      '7 realistic multi-format sandbox runs and 8 automated unit/integration test suites',
      11,
      TOTAL
    );

    const runRows = toTableRows([
      [
        { text: 'Run ID', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Format', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Outcome', options: { bold: true, fill: { color: C.navy }, color: C.white } },
        { text: 'Validated Scenario', options: { bold: true, fill: { color: C.navy }, color: C.white } },
      ],
      ['RUN-2026-1101', 'PDF', 'CONFIRMED_DEFECT', '2-page Checking Statement: Page 1 alignment shift + Page 2 fee & font drift'],
      ['RUN-2026-1102', 'PCL', 'CONFIRMED_DEFECT', 'Escrow Notice: PCL tray/font pitch drift + missing regulatory disclosure'],
      ['RUN-2026-1103', 'RT', 'VERIFIED_PASS', 'Daily Recon: Identical banners, record counts, totals, and CRLF endings'],
      ['RUN-2026-1104', 'AFP', 'POTENTIAL_VARIANCE', 'Native MO:DCA: IMM Duplex->Simplex, TLE tray drift, PTOCA Y/SCFL drift'],
      ['RUN-2026-1105', 'RT', 'BLOCKED', 'Negative test: Zero-byte candidate output blocked from false pass'],
      ['RUN-2026-1106', 'RT', 'CONFIRMED_DEFECT', 'Wire Settlement: Text + column shift + missing row + control total mismatch'],
      ['RUN-2026-1107', 'PDF', 'CONFIRMED_DEFECT', '6-vs-7 Page Shift: Inserted blank Page 3 isolated; Pages 3-6 <-> 4-7 aligned'],
    ]);

    s.addTable(runRows, {
      x: 0.6,
      y: 1.3,
      w: 12.133,
      colW: [1.85, 1.0, 2.35, 6.933],
      border: { pt: 0.75, color: C.border },
      fontFace: 'Segoe UI',
      fontSize: 10,
      rowH: 0.54,
      valign: 'middle',
      margin: [0.04, 0.08, 0.04, 0.08],
    });

    addCard(
      s,
      0.6,
      5.8,
      12.133,
      1.12,
      'Automated Test Coverage (tests/qe-engine.test.ts — 8/8 Passing)',
      [
        'Verifies PII redaction, path-traversal blocking, GZIP bomb rejection, config policy blocking, zero-byte BLOCKED behavior, native AFP MO:DCA/EBCDIC/PTOCA parsing, color-coded diff taxonomy, and 6-vs-7 page alignment + PDF/HTML report generation.',
      ],
      C.blue
    );

    s.addNotes('Summarizes synthetic validation fixtures and automated node:test verification.');
  }

  // =========================================================================
  // SLIDE 12: HOW TO RUN & PHASED ROADMAP
  // =========================================================================
  {
    const s = pptx.addSlide();
    addChrome(
      s,
      'Quick Start & Phased Migration Rollout',
      'Ready to run locally today on synthetic files with a clear path to UAT & CI/CD automation',
      12,
      TOTAL
    );

    addCard(
      s,
      0.6,
      1.32,
      5.9,
      2.75,
      'Developer & QE Quick Start',
      [
        '1. Install dependencies:  npm install',
        '2. Launch full-stack app:  npm run dev  (http://localhost:3000)',
        '3. Type-check codebase:  npm run lint  (tsc --noEmit)',
        '4. Run automated test suite:  npx tsx --test tests/qe-engine.test.ts',
        '5. Production build:  npm run build  &&  npm start',
      ],
      C.navy
    );

    addCard(
      s,
      6.83,
      1.32,
      5.9,
      2.75,
      'Recommended QE Workflow',
      [
        'Inspect pre-loaded runs (especially RUN-2026-1107 & RUN-2026-1104).',
        'Use Visual All-Pages to verify shifted/blank pages and dual highlights.',
        'Download Highlighted PDF Report or Visual HTML Report for defect tickets.',
        'Upload custom synthetic pairs via New Comparison and log Human Sign-Off.',
      ],
      C.teal
    );

    const phases = [
      {
        x: 0.6,
        title: 'Phase 1: Local Synthetic Sandbox (Current)',
        col: C.blue,
        items: ['All 4 formats + GZIP pre-processor', '6-vs-7 blank page alignment + dual highlights', 'Annotated PDF & HTML diff exports'],
      },
      {
        x: 4.74,
        title: 'Phase 2: Non-Prod Tokenized UAT',
        col: C.violet,
        items: ['Pre-ingestion tokenization gate', 'Signed-off per-app visual tolerances', 'Optional Papyrus Batch export integration'],
      },
      {
        x: 8.88,
        title: 'Phase 3: CI/CD Regression Gate',
        col: C.emerald,
        items: ['Headless API execution via /api/compare', 'Automated Jira/qTest evidence publishing', 'Baseline regression tracking across MVPs'],
      },
    ];
    phases.forEach((ph) => addCard(s, ph.x, 4.35, 3.85, 2.4, ph.title, ph.items, ph.col));

    s.addNotes('Closing slide with local startup commands and phased delivery roadmap.');
  }

  const outDir = path.resolve(process.cwd(), 'docs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'DocVerify_QE_Solution_Presentation.pptx');
  await pptx.writeFile({ fileName: outPath });
  console.log(`Generated PowerPoint presentation: ${outPath}`);
}

buildDeck().catch((err) => {
  console.error('Failed to generate PPTX:', err);
  process.exit(1);
});
