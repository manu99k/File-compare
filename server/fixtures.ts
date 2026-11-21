import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { runComparisonEngine } from './adapters.ts';
import type {
  ComparisonRun,
  DesignPackData,
  InventoryConfigRule,
} from '../src/types/qe.ts';

export const INVENTORY_CONFIGS: InventoryConfigRule[] = [
  {
    id: 'cfg-chk-stmt-pdf',
    mvp: 'MVP-1 (Retail Deposit Statements)',
    sourceSystem: 'IMDS / OpenText DCP',
    targetSystem: 'DDGS / SmartComm',
    appCode: 'CHK',
    subCode: 'STMT_MTH',
    businessOwner: 'Retail Deposit Operations',
    technicalOwner: 'DocGen Migration Engineering',
    environment: 'TEST',
    productionSubmissionAllowed: false,
    inputPattern: 'IMDS_CHK_STMT_<YYYYMMDD>_*.pdf',
    compression: 'NONE',
    expectedFormats: ['PDF'],
    pairingKeys: ['ACCOUNT_TOKEN', 'STATEMENT_CYCLE_DATE', 'FORM_ID'],
    piiTokenizationApproved: true,
    piiFields: ['ACCOUNT_NUMBER', 'TAX_ID_SSN', 'CUSTOMER_EMAIL', 'MAILING_ADDRESS'],
    visualTolerancePct: 0.5,
    numericToleranceAbs: 0.0,
    allowAutoTrimming: false,
    manualChecksRequired: [
      'Verify regulatory fee table alignment on Page 2',
      'Confirm FDIC member logo geometry',
    ],
    version: 'v2026.11.1',
    effectiveDate: '2026-11-01',
    reviewer: 'M. Vance (QE Lead)',
    approvalStatus: 'Approved',
    sourceDocRef: 'MIG-INV-CHK-001 Rev 4',
  },
  {
    id: 'cfg-escrow-pcl',
    mvp: 'MVP-1 (Mortgage & Escrow Notices)',
    sourceSystem: 'IMDS / OpenText DCP',
    targetSystem: 'DDGS / SmartComm',
    appCode: 'MTG',
    subCode: 'ESCROW_ADJ',
    businessOwner: 'Mortgage Servicing Ops',
    technicalOwner: 'Print Stream Output Team',
    environment: 'TEST',
    productionSubmissionAllowed: false,
    inputPattern: '*_ESCROW_*.pcl',
    compression: 'NONE',
    expectedFormats: ['PCL'],
    pairingKeys: ['LOAN_TOKEN', 'NOTICE_DATE', 'FORM_CODE'],
    piiTokenizationApproved: true,
    piiFields: ['LOAN_NUMBER', 'BORROWER_SSN', 'PROPERTY_ADDRESS'],
    visualTolerancePct: 0.25,
    numericToleranceAbs: 0.0,
    allowAutoTrimming: false,
    manualChecksRequired: [
      'Verify printer tray mapping and font pitch on physical PCL queue',
    ],
    version: 'v2026.11.1',
    effectiveDate: '2026-11-01',
    reviewer: 'R. Patel (Print Ops)',
    approvalStatus: 'Approved',
    sourceDocRef: 'MIG-INV-MTG-014 Rev 2',
  },
  {
    id: 'cfg-daily-recon-rt',
    mvp: 'MVP-1 (Operations Control Reports)',
    sourceSystem: 'IMDS / OpenText DCP',
    targetSystem: 'DDGS / SmartComm',
    appCode: 'OPS',
    subCode: 'DAILY_RECON',
    businessOwner: 'Enterprise Reconciliation',
    technicalOwner: 'Batch Reporting Team',
    environment: 'UAT',
    productionSubmissionAllowed: false,
    inputPattern: '*_DAILY_RECON_*.rt',
    compression: 'NONE',
    expectedFormats: ['RT'],
    pairingKeys: ['BATCH_RUN_ID', 'BUSINESS_DATE', 'REPORT_ID'],
    piiTokenizationApproved: true,
    piiFields: ['OPERATOR_ID', 'BRANCH_ACCOUNT_TOKEN'],
    visualTolerancePct: 0.0,
    numericToleranceAbs: 0.0,
    allowAutoTrimming: false,
    manualChecksRequired: [
      'Confirm trailer control totals reconcile to mainframe ledger',
    ],
    version: 'v2026.11.1',
    effectiveDate: '2026-11-01',
    reviewer: 'K. Chen (Ops Audit)',
    approvalStatus: 'Approved',
    sourceDocRef: 'MIG-INV-OPS-009 Rev 3',
  },
  {
    id: 'cfg-dda-batch-afp',
    mvp: 'MVP-2 (High-Volume DDA Print)',
    sourceSystem: 'IMDS / OpenText DCP',
    targetSystem: 'DDGS / SmartComm',
    appCode: 'DDA',
    subCode: 'CYCLE_PRINT',
    businessOwner: 'Commercial & Retail Print',
    technicalOwner: 'AFP / Papyrus Architecture',
    environment: 'TEST',
    productionSubmissionAllowed: false,
    inputPattern: '*_DDA_BATCH_*.afp',
    compression: 'NONE',
    expectedFormats: ['AFP'],
    pairingKeys: ['CYCLE_BATCH_ID', 'NAMED_PAGE_GROUP_BNG', 'ACCOUNT_TOKEN'],
    piiTokenizationApproved: true,
    piiFields: ['ACCOUNT_NUMBER', 'MICR_ROUTING_ACCT', 'CUSTOMER_NAME'],
    visualTolerancePct: 0.0,
    numericToleranceAbs: 0.0,
    allowAutoTrimming: false,
    manualChecksRequired: [
      'Open baseline and candidate .afp files in ISIS Papyrus Viewer',
      'Inspect barcode/IMB, MICR line, and overlay alignment visually',
    ],
    version: 'v2026.11.1',
    effectiveDate: '2026-11-05',
    reviewer: 'S. Morales (AFP Architect)',
    approvalStatus: 'Approved',
    sourceDocRef: 'MIG-INV-DDA-022 Rev 1',
  },
];

export const DESIGN_PACK: DesignPackData = {
  requirementsRegister: [
    {
      id: 'REQ-01',
      category: 'Outcome Taxonomy',
      requirement: 'Distinguish Verified Pass, Confirmed Defect, Potential Variance (Human Review), Blocked, and Not Run.',
      assumption: 'Missing, empty, corrupt, or unsupported files never pass.',
      verificationMethod: 'Negative test suite + Run-2026-1105 Blocked fixture',
      status: 'Implemented in Engine',
    },
    {
      id: 'REQ-02',
      category: 'Configuration Governance',
      requirement: 'Versioned config model validates patterns, PII rules, pairing keys, tolerances, and disables Production by default.',
      assumption: 'PII rules are supplied by approved inventory, never inferred from file content.',
      verificationMethod: 'Config Validator unit checks + Live Validator UI',
      status: 'Implemented in Engine',
    },
    {
      id: 'REQ-03',
      category: 'Pluggable Format Adapters',
      requirement: 'Explicit capability and verification-limit declarations for AFP (Papyrus), PDF, PCL, RT/RPT, and GZIP.',
      assumption: 'Papyrus has no approved automated rendering CLI in scope; AFP remains human-in-the-loop.',
      verificationMethod: 'Adapter Registry & per-run verification limits list',
      status: 'Implemented in Engine',
    },
    {
      id: 'REQ-04',
      category: 'Deterministic Pairing',
      requirement: 'Pair IMDS baseline and DDGS candidate by configured business keys (Account Token, Cycle Date, Form ID), not filename counts.',
      assumption: '1-to-many splits require explicit inventory split/merge rules.',
      verificationMethod: 'Pairing reconciliation table per run',
      status: 'Implemented in Engine',
    },
    {
      id: 'REQ-05',
      category: 'Multi-Layer Validation',
      requirement: 'Report Structural, Text, Visual/Layout, Format-Specific, and Human Review layers independently.',
      assumption: 'Visual equality cannot be claimed from extracted text alone.',
      verificationMethod: '5-Tab Multi-Layer Run Inspector + PDF Canvas Pixel Diff',
      status: 'Implemented in Engine',
    },
    {
      id: 'REQ-06',
      category: 'Privacy & Security',
      requirement: 'Redact PII in logs/reports, guard GZIP decompression ratio, block path traversal, and compute SHA-256 evidence hashes.',
      assumption: 'All prototype fixtures use strictly synthetic non-customer data.',
      verificationMethod: 'Security guard tests (server/security.ts)',
      status: 'Implemented in Engine',
    },
    {
      id: 'REQ-07',
      category: 'Human Sign-Off & Retest',
      requirement: 'Capture reviewer identity, rationale, tool/Papyrus version, and retest links; never auto-close defects.',
      assumption: 'Final business acceptance rests exclusively with QE / Business owners.',
      verificationMethod: 'Human Sign-Off audit workflow',
      status: 'Implemented in Engine',
    },
  ],
  threatAssessment: [
    {
      id: 'THR-01',
      threat: 'PII / Sensitive Customer Data Exposure in Lower Environments',
      vector: 'Unmasked account numbers, SSNs, or emails leaking into diff snippets, logs, or exported reports.',
      severity: 'Critical',
      mitigationControl: 'Server-side redaction filter masks SSN, email, tokens, and long account numbers before storing or returning findings; production jobs blocked by default.',
      residualRisk: 'Low (provided upstream tokenization service runs before UAT ingestion)',
    },
    {
      id: 'THR-02',
      threat: 'Decompression Bomb / Resource Exhaustion (.gz)',
      vector: 'Malicious or corrupt .gz archive expanding beyond memory limits or containing nested archives.',
      severity: 'High',
      mitigationControl: 'Bounded zlib.gunzipSync (15 MB cap, 50:1 ratio cap) + nested 0x1F 0x8B header rejection.',
      residualRisk: 'Low',
    },
    {
      id: 'THR-03',
      threat: 'Path Traversal via Artifact Filenames',
      vector: 'Crafted filenames containing ../ or directory separators overwriting local files.',
      severity: 'High',
      mitigationControl: 'In-memory multer processing (zero disk writes) + strict filename sanitizer rejecting path separators.',
      residualRisk: 'Negligible',
    },
    {
      id: 'THR-04',
      threat: 'False Pass on Unverified Print Streams (AFP / PCL)',
      vector: 'Automated text match hiding missing glyphs, wrong paper tray, or broken barcodes in AFP/PCL.',
      severity: 'High',
      mitigationControl: 'AFP adapter enforces PARTIAL_STRUCTURAL_ONLY + mandatory Papyrus human review; PCL checks ESC tray/font/orientation commands.',
      residualRisk: 'Low (with Papyrus review discipline)',
    },
  ],
  unresolvedQuestions: [
    {
      id: 'Q-01',
      owner: 'AFP Architecture & Licensing',
      topic: 'Papyrus Automation / Export Interface',
      question: 'Does the organization license Papyrus Batch/API to export AFP to PDF deterministically, or must QE open .afp files manually in Papyrus Viewer?',
      blockingImpact: 'Determines whether AFP remains strictly human-in-the-loop or supports automated visual proxy diffing.',
    },
    {
      id: 'Q-02',
      owner: 'Security & Tokenization Team',
      topic: 'Tokenization Service Interface',
      question: 'What is the approved non-prod API / CLI contract for verifying pre-ingestion tokenization before test execution?',
      blockingImpact: 'Required before Phase 2 non-prod environment integration.',
    },
    {
      id: 'Q-03',
      owner: 'Business & QE Leads',
      topic: 'Visual Pixel Tolerance & Form Splitting Rules',
      question: 'What per-application pixel tolerance (%) and 1-to-many statement split rules are signed off for MVP-1 PDF/PCL runs?',
      blockingImpact: 'Required to finalize Inventory Config v2026.12 before UAT regression.',
    },
    {
      id: 'Q-04',
      owner: 'Print Operations',
      topic: 'PCL Soft-Font & Tray Mapping Equivalence',
      question: 'Are DDGS SmartComm PCL tray codes mapped 1:1 to IMDS logical trays across all regional print vendors?',
      blockingImpact: 'Affects whether tray code differences are defects or approved printer-profile mappings.',
    },
  ],
  phasedPlan: [
    {
      phase: 'Phase 1 — Safe Local Prototype (Current Build)',
      scope: 'Pluggable adapters (AFP/Papyrus, PDF, PCL, RT), local synthetic fixtures, multi-layer diff workbench, PDF visual canvas diff, config validator, and human sign-off audit.',
      environment: 'Local Isolated Sandbox (No Production Access)',
      exitCriteria: [
        'All 4 formats parse and report explicit verification limits',
        'Negative tests (Blocked/Missing/Corrupt GZIP) never pass',
        'QE & Architecture sign off Discovery & Design Pack',
      ],
    },
    {
      phase: 'Phase 2 — Approved Non-Prod Tokenization & Storage Integration',
      scope: 'Connect approved tokenization validator, immutable evidence object store (with retention/encryption), and batch IMDS/DDGS pairing runner.',
      environment: 'DEV / TEST Non-Production',
      exitCriteria: [
        'DLP review completed and zero raw PII in evidence bucket',
        'Deterministic pairing verified on sanitized multi-account batches',
      ],
    },
    {
      phase: 'Phase 3 — UAT Regression & Papyrus / Enterprise Tooling',
      scope: 'Full UAT cycle reporting, retest tracking against defect tracker, and optional licensed Papyrus / Easy Compare integration if approved.',
      environment: 'UAT (Production Submission Remains Disabled)',
      exitCriteria: [
        '100% of MVP-1 inventory rules approved by Business & QE Owners',
        'Zero unresolved Critical/High defects on exit report',
      ],
    },
  ],
};

async function createSyntheticPdfPair(): Promise<{ baseline: Buffer; candidate: Buffer }> {
  const buildPdf = async (isCandidate: boolean) => {
    const doc = await PDFDocument.create();
    doc.setProducer(isCandidate ? 'DDGS SmartComm 16.4 (Synthetic)' : 'IMDS OpenText DCP 11.2 (Synthetic)');
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await doc.embedFont(StandardFonts.Helvetica);

    // Page 1
    const p1 = doc.addPage([612, 792]);
    p1.drawRectangle({ x: 48, y: 716, width: 516, height: 36, color: rgb(0.06, 0.14, 0.28) });
    p1.drawText('MERIDIAN SYNTHETIC BANK — CHECKING STATEMENT', {
      x: 60,
      y: 730,
      size: 12,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    const p1Lines = [
      'Statement Period: 2026-10-01 to 2026-10-31',
      'Account Reference: ****-****-4821 (Primary Checking)',
      'Form Identifier: FORM CHK-104-A',
      'Opening Balance: $4,250.00',
      'Total Deposits & Credits: $2,140.45',
      'Total Withdrawals & Debits: $1,270.00',
      'Ending Balance: $5,120.45',
    ];
    p1Lines.forEach((line, idx) => {
      p1.drawText(line, { x: 52, y: 668 - idx * 24, size: 11, font: fontReg, color: rgb(0.1, 0.12, 0.16) });
    });

    p1.drawLine({ start: { x: 48, y: 470 }, end: { x: 564, y: 470 }, thickness: 1, color: rgb(0.8, 0.84, 0.9) });
    p1.drawText('Posted Transaction Summary (Synthetic Fixture)', {
      x: isCandidate ? 74 : 52, // Pure +22pt horizontal alignment shift with identical text
      y: 446,
      size: 11,
      font: fontBold,
      color: rgb(0.08, 0.12, 0.2),
    });
    const txns = [
      '2026-10-04   ACH Payroll Credit - Employer Demo         +$2,140.45',
      '2026-10-12   Utility Autopay - Metro Water Co.            -$145.00',
      '2026-10-19   Debit Purchase - Market Square Grocer        -$225.00',
      '2026-10-25   Rent Transfer - Oakridge Holdings            -$900.00',
    ];
    txns.forEach((t, idx) => {
      p1.drawText(t, { x: 52, y: 416 - idx * 20, size: 10, font: fontReg, color: rgb(0.15, 0.18, 0.24) });
    });

    // Page 2 (Intentional defect & layout shift in candidate for demonstration)
    const p2 = doc.addPage([612, 792]);
    p2.drawText('FEE SUMMARY & REGULATORY DISCLOSURES (PAGE 2 OF 2)', {
      x: 52,
      y: 734,
      size: 12,
      font: fontBold,
      color: rgb(0.06, 0.14, 0.28),
    });

    const p2Lines = isCandidate
      ? [
          'Monthly Maintenance Fee Assessed: $12.00',
          'Overdraft Protection Transfer Fee: $0.00',
          'Paper Statement Fee: $0.00',
          'FDIC Coverage Notice: Deposits insured up to $250,000 per depositor.',
          'Routing / ABA Reference: 021000021 (Synthetic Test Routing)',
        ]
      : [
          'Monthly Maintenance Fee Assessed: $0.00 (Relationship Waiver)',
          'Overdraft Protection Transfer Fee: $0.00',
          'Paper Statement Fee: $0.00',
          'FDIC Coverage Notice: Deposits insured up to $250,000 per depositor.',
          'Routing / ABA Reference: 021000021 (Synthetic Test Routing)',
        ];

    p2Lines.forEach((line, idx) => {
      // Shift Y slightly in candidate to show real visual layout diff too
      const yOffset = isCandidate && idx === 0 ? 672 : 684 - idx * 26;
      p2.drawText(line, {
        x: 52,
        y: yOffset,
        size: 10.5,
        font: idx === 0 && isCandidate ? fontBold : fontReg,
        color: idx === 0 && isCandidate ? rgb(0.75, 0.1, 0.1) : rgb(0.12, 0.16, 0.22),
      });
    });

    const bytes = await doc.save();
    return Buffer.from(bytes);
  };

  return {
    baseline: await buildPdf(false),
    candidate: await buildPdf(true),
  };
}

async function createSyntheticPdfPageShiftPair(): Promise<{ baseline: Buffer; candidate: Buffer }> {
  const buildPdf = async (isCandidate: boolean) => {
    const doc = await PDFDocument.create();
    doc.setProducer(isCandidate ? 'DDGS SmartComm 16.4 (Synthetic)' : 'IMDS OpenText DCP 11.2 (Synthetic)');
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await doc.embedFont(StandardFonts.Helvetica);

    const addContentPage = (title: string, subtitle: string, rows: Array<{ text: string; shiftX?: number; highlight?: boolean }>) => {
      const p = doc.addPage([612, 792]);
      p.drawRectangle({ x: 44, y: 716, width: 524, height: 34, color: rgb(0.08, 0.16, 0.3) });
      p.drawText(title, { x: 56, y: 728, size: 11.5, font: fontBold, color: rgb(1, 1, 1) });
      p.drawText(subtitle, { x: 48, y: 686, size: 10.5, font: fontBold, color: rgb(0.12, 0.18, 0.28) });
      p.drawLine({ start: { x: 48, y: 676 }, end: { x: 564, y: 676 }, thickness: 0.75, color: rgb(0.82, 0.85, 0.9) });
      rows.forEach((r, idx) => {
        p.drawText(r.text, {
          x: 48 + (r.shiftX || 0),
          y: 644 - idx * 24,
          size: 10,
          font: r.highlight ? fontBold : fontReg,
          color: r.highlight ? rgb(0.75, 0.1, 0.1) : rgb(0.15, 0.18, 0.24),
        });
      });
    };

    // Logical Page 1
    addContentPage('MERIDIAN WEALTH — QUARTERLY PORTFOLIO STATEMENT', 'Section 1: Account Summary & Asset Overview', [
      { text: 'Account Reference: ****-****-7730 (Managed Portfolio)' },
      { text: 'Reporting Quarter: Q4 2026 (2026-10-01 to 2026-12-31)' },
      { text: 'Beginning Market Value: $248,500.00' },
      { text: 'Ending Market Value: $261,940.00' },
    ]);

    // Logical Page 2
    addContentPage('MERIDIAN WEALTH — ASSET ALLOCATION', 'Section 2: Target vs Actual Portfolio Mix', [
      { text: 'US Large Cap Equities: 55.0%  ($144,067.00)' },
      { text: 'Investment Grade Fixed Income: 30.0%  ($78,582.00)' },
      { text: 'International Developed Markets: 10.0%  ($26,194.00)' },
      { text: 'Cash & Money Market Sweep: 5.0%  ($13,097.00)' },
    ]);

    // In Destination (DDGS Candidate), Page 3 is an unintended completely blank white page!
    if (isCandidate) {
      doc.addPage([612, 792]);
    }

    // Logical Page 3 (appears as Page 3 in Source, Page 4 in Destination)
    addContentPage('MERIDIAN WEALTH — EQUITY HOLDINGS DETAIL', 'Section 3: Core Equity Positions (Synthetic)', [
      { text: 'SYN-EQ-101  Vanguard S&P Index Fund    420.00 sh   $102,480.00' },
      { text: 'SYN-EQ-102  Meridian Growth ETF        195.50 sh    $41,587.00' },
      { text: 'SYN-EQ-103  Global Ex-US Index         310.00 sh    $26,194.00' },
    ]);

    // Logical Page 4 (appears as Page 4 in Source, Page 5 in Destination)
    addContentPage('MERIDIAN WEALTH — FIXED INCOME HOLDINGS', 'Section 4: Treasury & Municipal Ladder', [
      { text: 'SYN-FI-201  US Treasury Note 4.25% Due 2029   $45,000.00' },
      { text: 'SYN-FI-202  State Municipal Bond 3.80%        $33,582.00' },
      { text: 'Accrued Bond Interest Earned YTD: $1,940.00' },
    ]);

    // Logical Page 5 (appears as Page 5 in Source, Page 6 in Destination — includes fee + X-shift defect!)
    addContentPage('MERIDIAN WEALTH — FEE SCHEDULE & DISCLOSURES', 'Section 5: Quarterly Advisory & Custody Fees', [
      {
        text: isCandidate
          ? 'Annualized Advisory Fee Rate: 0.45% ($294.68 Billed)'
          : 'Annualized Advisory Fee Rate: 0.35% ($229.20 Billed)',
        highlight: isCandidate,
      },
      {
        text: 'Custody & Trade Settlement Fee: $0.00 (Relationship Waiver)',
        shiftX: isCandidate ? 24 : 0, // Horizontal alignment shift on Page 5/6
      },
      { text: 'SEC Form ADV Part 2A Delivery: Electronic Consent Confirmed' },
    ]);

    // Logical Page 6 (appears as Page 6 in Source, Page 7 in Destination)
    addContentPage('MERIDIAN WEALTH — REGULATORY FOOTNOTES', 'Section 6: SIPC Coverage & Custodian Attestation', [
      { text: 'Securities protected up to $500,000 under SIPC guidelines.' },
      { text: 'Custodian Reference: MERIDIAN-SYN-CUST-07' },
      { text: 'END OF PORTFOLIO STATEMENT (SYNTHETIC MULTI-PAGE FIXTURE)' },
    ]);

    const bytes = await doc.save();
    return Buffer.from(bytes);
  };

  return {
    baseline: await buildPdf(false),
    candidate: await buildPdf(true),
  };
}

function createSyntheticPclPair(): { baseline: Buffer; candidate: Buffer } {
  const baseline = [
    '\x1bE',
    '\x1b&l2A', // Letter
    '\x1b&l0O', // Portrait
    '\x1b&l1H', // Tray 1
    '\x1b(s10H', // 10 CPI
    '\x1b(s12V', // 12 pt
    '\x1b*p100X\x1b*p120YMERIDIAN SYNTHETIC MORTGAGE SERVICING\r\n',
    '\x1b*p100X\x1b*p160YESCROW ANALYSIS & PAYMENT ADJUSTMENT NOTICE\r\n',
    '\x1b*p100X\x1b*p220YLoan Token: LN-SYN-99412  |  Effective Date: 2026-12-01\r\n',
    '\x1b*p100X\x1b*p260YPrior Monthly Escrow: $412.50  |  New Monthly Escrow: $438.00\r\n',
    '\x1b*p100X\x1b*p320YRESPA Disclosure: You may pay the escrow shortage in full within 30 days.\r\n',
    '\x0c',
    '\x1bE',
  ].join('');

  const candidate = [
    '\x1bE',
    '\x1b&l2A', // Letter
    '\x1b&l0O', // Portrait
    '\x1b&l4H', // Tray 2 (Lower) - DRIFT!
    '\x1b(s12H', // 12 CPI - DRIFT!
    '\x1b(s11V', // 11 pt - DRIFT!
    '\x1b*p100X\x1b*p120YMERIDIAN SYNTHETIC MORTGAGE SERVICING\r\n',
    '\x1b*p100X\x1b*p160YESCROW ANALYSIS & PAYMENT ADJUSTMENT NOTICE\r\n',
    '\x1b*p100X\x1b*p220YLoan Token: LN-SYN-99412  |  Effective Date: 2026-12-01\r\n',
    '\x1b*p100X\x1b*p260YPrior Monthly Escrow: $412.50  |  New Monthly Escrow: $438.00\r\n',
    // Trailing RESPA Disclosure line omitted!
    '\x0c',
    '\x1bE',
  ].join('');

  return {
    baseline: Buffer.from(baseline, 'latin1'),
    candidate: Buffer.from(candidate, 'latin1'),
  };
}

function createSyntheticRtPair(): { baseline: Buffer; candidate: Buffer } {
  const lines = [
    'MERIDIAN BANK - DAILY OPERATIONS RECONCILIATION REPORT (RPT-OPS-009)',
    'RUN DATE: 2026-11-19   ENV: UAT   SOURCE: SYNTHETIC BATCH',
    '------------------------------------------------------------------------',
    'ACCT_TOKEN      CYCLE_DATE   FORM_ID        DOCS    AMOUNT',
    'TOK-882101      2026-11-19   CHK-104-A      124     $48,200.00',
    'TOK-882102      2026-11-19   CHK-104-A      210     $62,150.00',
    'TOK-882103      2026-11-19   SAV-201-B       86     $32,500.00',
    '------------------------------------------------------------------------',
    'RECORD COUNT: 3',
    'STATEMENT COUNT: 420',
    'GRAND TOTAL: $142,850.00',
    'END OF REPORT - CONTROL CHECKSUM OK',
  ];
  const content = lines.join('\r\n') + '\r\n';
  return {
    baseline: Buffer.from(content, 'utf8'),
    candidate: Buffer.from(content, 'utf8'),
  };
}

function createSyntheticRtDefectPair(): { baseline: Buffer; candidate: Buffer } {
  const baseLines = [
    'MERIDIAN BANK - WIRE SETTLEMENT CONTROL REPORT (RPT-WIR-410)',
    'BATCH ID: WIRE-20261120-A   ENV: UAT   CURRENCY: USD',
    '------------------------------------------------------------------------',
    'WIRE_TOKEN      SETTLE_DT    ORIGIN_BRANCH  ITEMS   NET_AMOUNT',
    'WIR-901204      2026-11-20   NYC-012        18      $84,500.00',
    'WIR-901205      2026-11-20   CHI-004        24      $61,200.00',
    'WIR-901206      2026-11-20   DAL-009         9      $19,800.00',
    '------------------------------------------------------------------------',
    'RECORD COUNT: 3',
    'GRAND TOTAL: $165,500.00',
    'END OF REPORT - CONTROL CHECKSUM OK',
  ];

  const candLines = [
    'MERIDIAN BANK - WIRE SETTLEMENT CONTROL REPORT (RPT-WIR-410)',
    'BATCH ID: WIRE-20261120-B   ENV: UAT   CURRENCY: USD',
    '------------------------------------------------------------------------',
    'WIRE_TOKEN      SETTLE_DT    ORIGIN_BRANCH  ITEMS   NET_AMOUNT',
    'WIR-901204      2026-11-20   NYC-012          18    $84,500.00', // Column alignment spacing shift only
    'WIR-901205      2026-11-20   CHI-004        24      $61,200.00',
    // WIR-901206 omitted in candidate (Missing Content)
    '------------------------------------------------------------------------',
    'RECORD COUNT: 2',
    'GRAND TOTAL: $145,700.00',
    'END OF REPORT - CONTROL CHECKSUM OK',
  ];

  return {
    baseline: Buffer.from(baseLines.join('\r\n') + '\r\n', 'utf8'),
    candidate: Buffer.from(candLines.join('\n') + '\n', 'utf8'),
  };
}

const ASCII_TO_EBCDIC: Record<string, number> = {
  ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '|': 0x4f,
  '&': 0x50, '!': 0x5a, '$': 0x5b, '*': 0x5c, ')': 0x5d, ';': 0x5e, '^': 0x5f,
  '-': 0x60, '/': 0x61, ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e, '?': 0x6f,
  ':': 0x7a, '#': 0x7b, '@': 0x7c, "'": 0x7d, '=': 0x7e, '"': 0x7f,
  'a': 0x81, 'b': 0x82, 'c': 0x83, 'd': 0x84, 'e': 0x85, 'f': 0x86, 'g': 0x87, 'h': 0x88, 'i': 0x89,
  'j': 0x91, 'k': 0x92, 'l': 0x93, 'm': 0x94, 'n': 0x95, 'o': 0x96, 'p': 0x97, 'q': 0x98, 'r': 0x99,
  's': 0xa2, 't': 0xa3, 'u': 0xa4, 'v': 0xa5, 'w': 0xa6, 'x': 0xa7, 'y': 0xa8, 'z': 0xa9,
  'A': 0xc1, 'B': 0xc2, 'C': 0xc3, 'D': 0xc4, 'E': 0xc5, 'F': 0xc6, 'G': 0xc7, 'H': 0xc8, 'I': 0xc9,
  'J': 0xd1, 'K': 0xd2, 'L': 0xd3, 'M': 0xd4, 'N': 0xd5, 'O': 0xd6, 'P': 0xd7, 'Q': 0xd8, 'R': 0xd9,
  'S': 0xe2, 'T': 0xe3, 'U': 0xe4, 'V': 0xe5, 'W': 0xe6, 'X': 0xe7, 'Y': 0xe8, 'Z': 0xe9,
  '0': 0xf0, '1': 0xf1, '2': 0xf2, '3': 0xf3, '4': 0xf4, '5': 0xf5, '6': 0xf6, '7': 0xf7, '8': 0xf8, '9': 0xf9,
};

function encodeEbcdic(text: string): Buffer {
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = ASCII_TO_EBCDIC[text[i]] ?? 0x40;
  }
  return out;
}

function makeModcaField(sfidHex: string, seq: number, payload?: Buffer | string): Buffer {
  const sfid = Buffer.from(sfidHex, 'hex');
  const data = typeof payload === 'string' ? Buffer.from(payload, 'ascii') : payload || Buffer.alloc(0);
  const length = 8 + data.length;
  const buf = Buffer.alloc(1 + length);
  buf[0] = 0x5a;
  buf.writeUInt16BE(length, 1);
  sfid.copy(buf, 3);
  buf[6] = 0x00;
  buf.writeUInt16BE(seq, 7);
  if (data.length > 0) {
    data.copy(buf, 9);
  }
  return buf;
}

function makeTlePayload(attrName: string, attrVal: string): Buffer {
  const nameBuf = encodeEbcdic(attrName);
  const valBuf = encodeEbcdic(attrVal);
  const t1 = Buffer.concat([Buffer.from([4 + nameBuf.length, 0x02, 0x0b, 0x00]), nameBuf]);
  const t2 = Buffer.concat([Buffer.from([4 + valBuf.length, 0x36, 0x00, 0x00]), valBuf]);
  return Buffer.concat([t1, t2]);
}

function makePgdPayload(widthUnits: number, heightUnits: number, dpi: number): Buffer {
  const buf = Buffer.alloc(12);
  buf[0] = 0x00; // 10 inches base
  buf[1] = 0x00;
  buf.writeUInt16BE(dpi * 10, 2);
  buf.writeUInt16BE(dpi * 10, 4);
  buf[6] = (widthUnits >> 16) & 0xff;
  buf[7] = (widthUnits >> 8) & 0xff;
  buf[8] = widthUnits & 0xff;
  buf[9] = (heightUnits >> 16) & 0xff;
  buf[10] = (heightUnits >> 8) & 0xff;
  buf[11] = heightUnits & 0xff;
  return buf;
}

function makePtocaPayload(runs: Array<{ x: number; y: number; fontId: number; text: string }>): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x2b, 0xd3])];
  for (const r of runs) {
    const ami = Buffer.alloc(4);
    ami[0] = 4;
    ami[1] = 0xc7; // AMI chained
    ami.writeInt16BE(r.x, 2);

    const amb = Buffer.alloc(4);
    amb[0] = 4;
    amb[1] = 0xd3; // AMB chained
    amb.writeInt16BE(r.y, 2);

    const scfl = Buffer.from([3, 0xf1, r.fontId]); // SCFL chained
    const textBuf = encodeEbcdic(r.text);
    const trn = Buffer.concat([Buffer.from([2 + textBuf.length, 0xdb]), textBuf]); // TRN chained
    chunks.push(ami, amb, scfl, trn);
  }
  return Buffer.concat(chunks);
}

function createSyntheticAfpPair(): { baseline: Buffer; candidate: Buffer } {
  const buildAfp = (candidateVariant: boolean) => {
    const seqFields = [
      makeModcaField('D3A8A8', 1, encodeEbcdic('DOC_DDA_SYNTH_004')), // BDT
      makeModcaField('D3ABCC', 2, encodeEbcdic(candidateVariant ? 'SIMPLEX1' : 'DUPLEX01')), // IMM (Duplex vs Simplex drift!)
      makeModcaField('D3A8AD', 3, encodeEbcdic('GRP_TOK_4410_STMT')), // BNG
      makeModcaField('D3A090', 4, makeTlePayload('ACCT_TOKEN', 'TOK-4410-DDA')), // TLE
      makeModcaField('D3A090', 5, makeTlePayload('CYCLE_DATE', '2026-11-19')), // TLE
      makeModcaField('D3A090', 6, makeTlePayload('MAIL_TRAY', candidateVariant ? 'TRAY_02' : 'TRAY_01')), // TLE drift
      makeModcaField('D3A8AF', 7, encodeEbcdic('PAGE_0001')), // BPG
      makeModcaField('D3A8C9', 8), // BAG
      makeModcaField('D3A6AF', 9, makePgdPayload(2040, 2640, 240)), // PGD 8.5x11in @ 240dpi
      makeModcaField('D3AB8A', 10, encodeEbcdic('C0H200B0_HELV10')), // MCF
      makeModcaField('D3ABD8', 11, encodeEbcdic('O1BANKLG_LOGO')), // MPO
      makeModcaField('D3A9C9', 12), // EAG
      makeModcaField('D3A8DF', 13), // BPT
      makeModcaField(
        'D3EE9B',
        14,
        makePtocaPayload([
          { x: 180, y: 240, fontId: 1, text: 'MERIDIAN SYNTHETIC DDA STATEMENT' },
          { x: 180, y: 310, fontId: 1, text: 'ACCOUNT TOKEN: ****-****-4410   CYCLE: 2026-11-19' },
          { x: 180, y: 400, fontId: 2, text: 'OPENING LEDGER BALANCE: $14,200.00' },
          {
            x: 180,
            y: candidateVariant ? 512 : 470, // Y-coordinate drift in DDGS!
            fontId: candidateVariant ? 3 : 2, // Coded font ID drift in DDGS!
            text: 'CLOSING LEDGER BALANCE: $18,450.00   FORM DDA-500',
          },
        ])
      ), // PTX
      makeModcaField('D3A9DF', 15), // EPT
      makeModcaField('D3A8EB', 16, encodeEbcdic('IMB_MAIL_BARCODE_01')), // BBC
      makeModcaField('D3A9EB', 17), // EBC
      makeModcaField('D3A9AF', 18), // EPG
      makeModcaField('D3A9AD', 19), // ENG
      makeModcaField('D3A9A8', 20), // EDT
    ];
    return Buffer.concat(seqFields);
  };

  return {
    baseline: buildAfp(false),
    candidate: buildAfp(true),
  };
}

export interface StoredRunRecord {
  run: ComparisonRun;
  baselineBinary: Buffer;
  candidateBinary: Buffer;
}

export async function initializeSyntheticStore(): Promise<Map<string, StoredRunRecord>> {
  const store = new Map<string, StoredRunRecord>();

  // 1. PDF Defect + Visual Diff
  const pdfPair = await createSyntheticPdfPair();
  const r1 = await runComparisonEngine({
    runId: 'RUN-2026-1101',
    config: INVENTORY_CONFIGS[0],
    format: 'PDF',
    baselineBuffer: pdfPair.baseline,
    baselineFilename: 'IMDS_CHK_STMT_20261119_001.pdf',
    candidateBuffer: pdfPair.candidate,
    candidateFilename: 'DDGS_CHK_STMT_20261119_001.pdf',
  });
  store.set(r1.run.id, r1);

  // 2. PCL Defect + ESC Drift
  const pclPair = createSyntheticPclPair();
  const r2 = await runComparisonEngine({
    runId: 'RUN-2026-1102',
    config: INVENTORY_CONFIGS[1],
    format: 'PCL',
    baselineBuffer: pclPair.baseline,
    baselineFilename: 'IMDS_ESCROW_ADJ_20261119_002.pcl',
    candidateBuffer: pclPair.candidate,
    candidateFilename: 'DDGS_ESCROW_ADJ_20261119_002.pcl',
  });
  store.set(r2.run.id, r2);

  // 3. RT Verified Pass
  const rtPair = createSyntheticRtPair();
  const r3 = await runComparisonEngine({
    runId: 'RUN-2026-1103',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: rtPair.baseline,
    baselineFilename: 'IMDS_DAILY_RECON_20261119_003.rt',
    candidateBuffer: rtPair.candidate,
    candidateFilename: 'DDGS_DAILY_RECON_20261119_003.rt',
  });
  store.set(r3.run.id, r3);

  // 4. AFP Potential Variance (Papyrus Review Required)
  const afpPair = createSyntheticAfpPair();
  const r4 = await runComparisonEngine({
    runId: 'RUN-2026-1104',
    config: INVENTORY_CONFIGS[3],
    format: 'AFP',
    baselineBuffer: afpPair.baseline,
    baselineFilename: 'IMDS_DDA_BATCH_20261119_004.afp',
    candidateBuffer: afpPair.candidate,
    candidateFilename: 'DDGS_DDA_BATCH_20261119_004.afp',
    papyrusExportAttached: false,
    papyrusToolVersion: 'ISIS Papyrus Viewer (Awaiting QE Launch)',
  });
  store.set(r4.run.id, r4);

  // 5. Blocked Negative Test (Zero-byte / Corrupt Output Never Marked Pass)
  const r5 = await runComparisonEngine({
    runId: 'RUN-2026-1105',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: rtPair.baseline,
    baselineFilename: 'IMDS_DAILY_RECON_20261119_005.rt',
    candidateBuffer: Buffer.alloc(0),
    candidateFilename: 'DDGS_DAILY_RECON_20261119_005.rt',
  });
  store.set(r5.run.id, r5);

  // 6. RT / RPT Color-Coded Side-by-Side Defect Fixture (Text + Column Alignment + Missing Row + Control Total + EOL)
  const rtDefectPair = createSyntheticRtDefectPair();
  const r6 = await runComparisonEngine({
    runId: 'RUN-2026-1106',
    config: INVENTORY_CONFIGS[2],
    format: 'RT',
    baselineBuffer: rtDefectPair.baseline,
    baselineFilename: 'IMDS_WIRE_SETTLE_20261120_006.rpt',
    candidateBuffer: rtDefectPair.candidate,
    candidateFilename: 'DDGS_WIRE_SETTLE_20261120_006.rpt',
  });
  store.set(r6.run.id, r6);

  // 7. PDF 6-Page Source vs 7-Page Destination (Inserted White Page at Dest Page 3 + Continues Matching Pages 3-6 <-> 4-7)
  const pdfShiftPair = await createSyntheticPdfPageShiftPair();
  const r7 = await runComparisonEngine({
    runId: 'RUN-2026-1107',
    config: INVENTORY_CONFIGS[0],
    format: 'PDF',
    baselineBuffer: pdfShiftPair.baseline,
    baselineFilename: 'IMDS_PORTFOLIO_STMT_20261120_007.pdf',
    candidateBuffer: pdfShiftPair.candidate,
    candidateFilename: 'DDGS_PORTFOLIO_STMT_20261120_007.pdf',
  });
  store.set(r7.run.id, r7);

  // 8–10. Real Public CIBC Form Sample Pairs (when present in samples/cibc/)
  const cibcDir = path.resolve(process.cwd(), 'samples/cibc');
  const cibcSamples: Array<{
    runId: string;
    srcFile: string;
    dstFile: string;
    cfgIdx: number;
    format: 'PDF' | 'AFP' | 'PCL' | 'RT';
  }> = [
    {
      runId: 'RUN-2026-1108',
      srcFile: 'IMDS_CIBC_PAD_FORM_SRC.pdf',
      dstFile: 'DDGS_CIBC_PAD_FORM_DST_DEFECT.pdf',
      cfgIdx: 0,
      format: 'PDF',
    },
    {
      runId: 'RUN-2026-1109',
      srcFile: 'IMDS_CIBC_12419_ACCT_6P_SRC.pdf',
      dstFile: 'DDGS_CIBC_12419_ACCT_7P_DST_BLANK_SHIFT.pdf',
      cfgIdx: 0,
      format: 'PDF',
    },
    {
      runId: 'RUN-2026-1110',
      srcFile: 'IMDS_CIBC_USA_SMART_4P_SRC.pdf',
      dstFile: 'DDGS_CIBC_USA_SMART_4P_DST_DEFECT.pdf',
      cfgIdx: 0,
      format: 'PDF',
    },
  ];

  for (const s of cibcSamples) {
    const srcPath = path.join(cibcDir, s.srcFile);
    const dstPath = path.join(cibcDir, s.dstFile);
    if (fs.existsSync(srcPath) && fs.existsSync(dstPath)) {
      const res = await runComparisonEngine({
        runId: s.runId,
        config: INVENTORY_CONFIGS[s.cfgIdx],
        format: s.format,
        baselineBuffer: fs.readFileSync(srcPath),
        baselineFilename: s.srcFile,
        candidateBuffer: fs.readFileSync(dstPath),
        candidateFilename: s.dstFile,
      });
      store.set(res.run.id, res);
    }
  }

  return store;
}
