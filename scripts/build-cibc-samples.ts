import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createComplexAfpFormPair } from '../server/complexAfpFixture.ts';

const SAMPLES_DIR = path.resolve(process.cwd(), 'samples/cibc');

function encodeEbcdic(text: string): Buffer {
  // Exact inverse of server/adapters.ts ASCII->EBCDIC CP037 mapping for synthetic AFP MO:DCA fixtures
  const map: Record<string, number> = {
    ' ': 0x40, '.': 0x4b, '<': 0x4c, '(': 0x4d, '+': 0x4e, '|': 0x4f, '&': 0x50,
    '!': 0x5a, '$': 0x5b, '*': 0x5c, ')': 0x5d, ';': 0x5e, '-': 0x60, '/': 0x61,
    ',': 0x6b, '%': 0x6c, '_': 0x6d, '>': 0x6e, '?': 0x6f, ':': 0x7a, '#': 0x7b,
    '@': 0x7c, "'": 0x7d, '=': 0x7e, '"': 0x7f,
  };
  const out = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (ch in map) {
      out[i] = map[ch];
    } else if (code >= 97 && code <= 105) {
      out[i] = 0x81 + (code - 97);
    } else if (code >= 106 && code <= 114) {
      out[i] = 0x91 + (code - 106);
    } else if (code >= 115 && code <= 122) {
      out[i] = 0xa2 + (code - 115);
    } else if (code >= 65 && code <= 73) {
      out[i] = 0xc1 + (code - 65);
    } else if (code >= 74 && code <= 82) {
      out[i] = 0xd1 + (code - 74);
    } else if (code >= 83 && code <= 90) {
      out[i] = 0xe2 + (code - 83);
    } else if (code >= 48 && code <= 57) {
      out[i] = 0xf0 + (code - 48);
    } else {
      out[i] = 0x40;
    }
  }
  return out;
}

function makeModcaField(sfidHex: string, seqNum: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const len = 8 + payload.length;
  const header = Buffer.alloc(9);
  header[0] = 0x5a;
  header.writeUInt16BE(len, 1);
  Buffer.from(sfidHex, 'hex').copy(header, 3);
  header[6] = 0x00;
  header.writeUInt16BE(seqNum, 7);
  return Buffer.concat([header, payload]);
}

function makeTlePayload(name: string, value: string): Buffer {
  const nameBuf = encodeEbcdic(name);
  const valBuf = encodeEbcdic(value);
  return Buffer.concat([
    Buffer.from([2 + nameBuf.length, 0x02]),
    nameBuf,
    Buffer.from([4 + valBuf.length, 0x36, 0x00, 0x00]),
    valBuf,
  ]);
}

function makePgdPayload(widthUnits: number, heightUnits: number, dpi = 240): Buffer {
  const buf = Buffer.alloc(15);
  buf[0] = 0x00;
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

function makeCibcIocaLogoFields(seqStart: number): Buffer[] {
  const w = 24;
  const h = 24;
  const rowBytes = 3;
  const bitmap = Buffer.alloc(rowBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dy = Math.abs(y - 11.5);
      const dx = Math.abs(x - 11.5);
      if (dx + dy >= 5 && dx + dy <= 10.5) {
        bitmap[y * rowBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      }
    }
  }
  const idd = Buffer.alloc(21);
  idd.writeUInt16BE(2400, 1);
  idd.writeUInt16BE(2400, 3);
  idd.writeUInt16BE(w, 5);
  idd.writeUInt16BE(h, 7);
  idd[9] = 0xf6;
  idd[10] = 0x0a;
  idd.writeUInt16BE(2400, 12);
  idd.writeUInt16BE(2400, 14);
  idd.writeUInt16BE(w, 16);
  idd.writeUInt16BE(h, 18);
  const ipd = Buffer.concat([
    Buffer.from([0x70, 0x00, 0x91, 0x01, 0xff, 0x95, 0x02, 0x03, 0x01, 0x96, 0x01, 0x01]),
    Buffer.from([0xfe, 0x92, 0x00, bitmap.length]),
    bitmap,
    Buffer.from([0x93, 0x00, 0x71, 0x00]),
  ]);
  return [
    makeModcaField('D3A85F', seqStart, encodeEbcdic('SEG_CIBC_LOGO')),
    makeModcaField('D3A8FB', seqStart + 1, encodeEbcdic('IMG_CIBC_01')),
    makeModcaField('D3A6FB', seqStart + 2, idd),
    makeModcaField('D3EEFB', seqStart + 3, ipd),
    makeModcaField('D3A9FB', seqStart + 4),
    makeModcaField('D3A95F', seqStart + 5),
  ];
}

function makePtocaPayload(
  runs: Array<{ x: number; y: number; fontId: number; text: string; sto?: number }>
): Buffer {
  const chunks: Buffer[] = [Buffer.from([0x2b, 0xd3])];
  for (const r of runs) {
    if (typeof r.sto === 'number') {
      const sto = Buffer.alloc(6);
      sto[0] = 6;
      sto[1] = 0xf7;
      sto.writeUInt16BE(r.sto, 2);
      sto.writeUInt16BE((r.sto + 0x2d00) & 0xffff, 4);
      chunks.push(sto);
    }
    const ami = Buffer.alloc(4);
    ami[0] = 4;
    ami[1] = 0xc7;
    ami.writeInt16BE(r.x, 2);

    const amb = Buffer.alloc(4);
    amb[0] = 4;
    amb[1] = 0xd3;
    amb.writeInt16BE(r.y, 2);

    const scfl = Buffer.from([3, 0xf1, r.fontId]);
    const textBuf = encodeEbcdic(r.text);
    const trn = Buffer.concat([Buffer.from([2 + textBuf.length, 0xdb]), textBuf]);
    chunks.push(ami, amb, scfl, trn);
    if (typeof r.sto === 'number') {
      chunks.push(Buffer.from([6, 0xf7, 0x00, 0x00, 0x2d, 0x00]));
    }
  }
  const rAmi = Buffer.alloc(4); rAmi[0] = 4; rAmi[1] = 0xc7; rAmi.writeInt16BE(180, 2);
  const rAmb = Buffer.alloc(4); rAmb[0] = 4; rAmb[1] = 0xd3; rAmb.writeInt16BE(355, 2);
  const dir = Buffer.alloc(7); dir[0] = 7; dir[1] = 0xe5; dir.writeInt16BE(1680, 2); dir.writeInt16BE(3, 4);
  chunks.push(rAmi, rAmb, dir);
  return Buffer.concat(chunks);
}

async function buildCibcPdfSamples() {
  // 1. CIBC Pre-Authorized Payment Agreement (1p vs 1p)
  const padRaw = fs.readFileSync(path.join(SAMPLES_DIR, 'cibc_pad_agreement.pdf'));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_PAD_FORM_SRC.pdf'), padRaw);

  const padCandDoc = await PDFDocument.load(padRaw);
  const padFontBold = await padCandDoc.embedFont(StandardFonts.HelveticaBold);
  const padFontReg = await padCandDoc.embedFont(StandardFonts.Helvetica);
  const padPage = padCandDoc.getPage(0);
  const { height: padH } = padPage.getSize();
  // Mask old header phone / NSF note cleanly and render DDGS migrated notice with text + shift + font drift
  padPage.drawRectangle({ x: 36, y: padH - 42, width: 540, height: 22, color: rgb(1, 1, 1) });
  padPage.drawText('CIBC SMARTCOMM MIGRATED PAD FORM — NSF FEE: $48.00 (WAS $45.00)  |  INST: 010', {
    x: 56, // +20pt shifted alignment
    y: padH - 36,
    size: 8.5, // font size drift
    font: padFontBold,
    color: rgb(0.75, 0.08, 0.08),
  });
  padPage.drawRectangle({ x: 36, y: 24, width: 540, height: 18, color: rgb(1, 0.96, 0.96), borderColor: rgb(0.86, 0.15, 0.15), borderWidth: 0.75 });
  padPage.drawText('DDGS Candidate Check: Institution 010 · Transit 00012 · Revised Tel: 1-800-465-2422', {
    x: 42,
    y: 29,
    size: 8.5,
    font: padFontReg,
    color: rgb(0.1, 0.18, 0.35),
  });
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_PAD_FORM_DST_DEFECT.pdf'), await padCandDoc.save());

  // 2. CIBC Personal Deposit Account Terms & Conditions 12419 (6-page Source vs 7-page Destination with Blank Page 3)
  const acctFull = await PDFDocument.load(fs.readFileSync(path.join(SAMPLES_DIR, 'cibc_personal_account_agreement.pdf')));
  const acctSrc6 = await PDFDocument.create();
  const copiedSrc6 = await acctSrc6.copyPages(acctFull, [0, 1, 2, 3, 4, 5]);
  copiedSrc6.forEach((p) => acctSrc6.addPage(p));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_12419_ACCT_6P_SRC.pdf'), await acctSrc6.save());

  const acctDst7 = await PDFDocument.create();
  const acctBold = await acctDst7.embedFont(StandardFonts.HelveticaBold);
  const acctCopied = await acctDst7.copyPages(acctFull, [0, 1, 2, 3, 4, 5]);
  const firstSize = acctCopied[0].getSize();
  acctDst7.addPage(acctCopied[0]); // P1 <-> P1
  acctDst7.addPage(acctCopied[1]); // P2 <-> P2
  acctDst7.addPage([firstSize.width, firstSize.height]); // P3: Inserted White / Blank Page!
  acctDst7.addPage(acctCopied[2]); // P4 <-> Src P3
  acctDst7.addPage(acctCopied[3]); // P5 <-> Src P4
  const modP5 = acctCopied[4]; // P6 <-> Src P5 (apply fee/alignment defect)
  modP5.drawRectangle({ x: 36, y: firstSize.height - 38, width: 540, height: 22, color: rgb(1, 0.97, 0.97), borderColor: rgb(0.86, 0.15, 0.15), borderWidth: 0.75 });
  modP5.drawText('DDGS SmartComm Fee Drift: Monthly Fee $16.95 -> $18.95  |  X-Shift +24pt', {
    x: 60,
    y: firstSize.height - 31,
    size: 9,
    font: acctBold,
    color: rgb(0.75, 0.08, 0.08),
  });
  acctDst7.addPage(modP5);
  acctDst7.addPage(acctCopied[5]); // P7 <-> Src P6
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_12419_ACCT_7P_DST_BLANK_SHIFT.pdf'), await acctDst7.save());

  // 3. CIBC Bank USA Smart Account Disclosures 910126SAA (4p vs 4p Fee & Alignment Drift)
  const usaFull = await PDFDocument.load(fs.readFileSync(path.join(SAMPLES_DIR, 'cibc_usa_smart_account_disclosures.pdf')));
  const usaSrc4 = await PDFDocument.create();
  const copiedUsaSrc = await usaSrc4.copyPages(usaFull, [0, 1, 2, 3]);
  copiedUsaSrc.forEach((p) => usaSrc4.addPage(p));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_USA_SMART_4P_SRC.pdf'), await usaSrc4.save());

  const usaDst4 = await PDFDocument.create();
  const usaBold = await usaDst4.embedFont(StandardFonts.HelveticaBold);
  const copiedUsaDst = await usaDst4.copyPages(usaFull, [0, 1, 2, 3]);
  const uSize = copiedUsaDst[1].getSize();
  copiedUsaDst[1].drawRectangle({ x: 36, y: uSize.height - 36, width: 530, height: 20, color: rgb(1, 0.96, 0.96), borderColor: rgb(0.15, 0.39, 0.92), borderWidth: 0.75 });
  copiedUsaDst[1].drawText('DDGS TEST OVERLAY: DOMESTIC WIRE FEE $25.00 -> $30.00 | FDICS MEMBER ALIGN +18PT', {
    x: 54,
    y: uSize.height - 29,
    size: 8.5,
    font: usaBold,
    color: rgb(0.15, 0.39, 0.92),
  });
  copiedUsaDst.forEach((p) => usaDst4.addPage(p));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_USA_SMART_4P_DST_DEFECT.pdf'), await usaDst4.save());

  // 4. CIBC Mellon Retiree Direct Deposit Request Form (1p vs 1p)
  const mellonRaw = fs.readFileSync(path.join(SAMPLES_DIR, 'cibc_mellon_direct_deposit.pdf'));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_MELLON_DD_SRC.pdf'), mellonRaw);
  const mellonDstDoc = await PDFDocument.load(mellonRaw);
  const mFont = await mellonDstDoc.embedFont(StandardFonts.HelveticaBold);
  const mPage = mellonDstDoc.getPage(0);
  const { height: mH } = mPage.getSize();
  mPage.drawRectangle({ x: 40, y: mH - 36, width: 520, height: 20, color: rgb(1, 0.97, 0.97), borderColor: rgb(0.86, 0.15, 0.15), borderWidth: 0.75 });
  mPage.drawText('DDGS MIGRATION VARIANCE: INSTITUTION 010 TRANSIT BOX SHIFTED +16PT | BANK CODE EDIT', {
    x: 56,
    y: mH - 29,
    size: 8.5,
    font: mFont,
    color: rgb(0.75, 0.08, 0.08),
  });
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_MELLON_DD_DST_DEFECT.pdf'), await mellonDstDoc.save());
}

function buildCibcAfpPclRtSamples() {
  // 5. CIBC Synthetic AFP MO:DCA Binary Pair (Direct Native Validation, Zero PDF Conversion)
  const buildCibcAfp = (candidateVariant: boolean) => {
    const ips = Buffer.concat([encodeEbcdic('SEG_CIBC'), Buffer.from([0, 0, 180, 0, 0, 110])]);
    return Buffer.concat([
      makeModcaField('D3A8A8', 1, encodeEbcdic('DOC_CIBC_DDA_010')), // BDT
      ...makeCibcIocaLogoFields(2),
      makeModcaField('D3ABCC', 10, encodeEbcdic(candidateVariant ? 'SIMPLEX1' : 'DUPLEX01')), // IMM drift
      makeModcaField('D3A8AD', 11, encodeEbcdic('GRP_CIBC_TOK_010')), // BNG
      makeModcaField('D3A090', 12, makeTlePayload('INST_CODE', '010_CIBC_CA')),
      makeModcaField('D3A090', 13, makeTlePayload('FORM_ID', 'CIBC_12419_DDA')),
      makeModcaField('D3A090', 14, makeTlePayload('MAIL_TRAY', candidateVariant ? 'TRAY_02' : 'TRAY_01')),
      makeModcaField('D3A8AF', 15, encodeEbcdic('PAGE_0001')), // BPG
      makeModcaField('D3A8C9', 16), // BAG
      makeModcaField('D3A6AF', 17, makePgdPayload(2040, 2640, 240)), // PGD
      makeModcaField('D3AB8A', 18, encodeEbcdic('C0CIBC01_HELV10')), // MCF
      makeModcaField('D3ABD8', 19, encodeEbcdic('O1CIBCLG_LOGO')), // MPO
      makeModcaField('D3A9C9', 20), // EAG
      makeModcaField('D3AF5F', 21, ips), // IPS CIBC Logo Segment
      makeModcaField('D3A8DF', 22), // BPT
      makeModcaField(
        'D3EE9B',
        23,
        makePtocaPayload([
          { x: 310, y: 155, fontId: 2, text: 'CIBC PERSONAL BANKING - SMART PLUS CHEQUING STATEMENT' },
          { x: 180, y: 260, fontId: 1, text: 'INSTITUTION: 010  TRANSIT: 00012  ACCT: ****-****-4410' },
          { x: 180, y: 310, fontId: 1, text: 'MONTHLY ACCOUNT FEE: $16.95  (WAIVED OVER $4,000.00)' },
          {
            x: 180,
            y: candidateVariant ? 518 : 430,
            fontId: candidateVariant ? 3 : 2,
            text: candidateVariant
              ? 'CLOSING BALANCE: $12,480.00  FORM 12419-DDGS'
              : 'CLOSING BALANCE: $12,480.00  FORM 12419-IMDS',
          },
          { x: 95, y: 1750, fontId: 4, sto: 0x8700, text: '*030101100001*' },
        ])
      ), // PTX
      makeModcaField('D3A9DF', 24), // EPT
      makeModcaField('D3A8EB', 25, encodeEbcdic('CPC_POST_BARCODE_010')), // BBC
      makeModcaField('D3A9EB', 26), // EBC
      makeModcaField('D3A9AF', 27), // EPG
      makeModcaField('D3A9AD', 28), // ENG
      makeModcaField('D3A9A8', 29), // EDT
    ]);
  };

  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_DDA_STMT.afp'), buildCibcAfp(false));
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_DDA_STMT.afp'), buildCibcAfp(true));

  // 5b. Complex 2-Page CIBC Form AFP Pair (Overlay + GOCA + Tables + CCITT G4 / 24-bit RGB / 8-bit Gray Images + Barcodes)
  const complexAfp = createComplexAfpFormPair();
  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_COMPLEX_FORM_2P.afp'), complexAfp.baseline);
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_COMPLEX_FORM_2P.afp'), complexAfp.candidate);

  // 6. CIBC PCL5 Escrow / Pre-Authorized Notice Pair
  const pclBase =
    '\x1bE\x1b&l2A\x1b&l0O\x1b&l1H\x1b(s10H\x1b(s12V' +
    '\x1b*p300X\x1b*p200YCIBC MORTGAGE & ESCROW NOTICE - INSTITUTION 010\r\n' +
    '\x1b*p300X\x1b*p320YLOAN TOKEN: TOK-CIBC-99102  TRANSIT: 00012\r\n' +
    '\x1b*p300X\x1b*p440YMONTHLY ESCROW PAYMENT: $1,842.50 CAD\r\n' +
    '\x1b*p300X\x1b*p560YCDIC & CIBC PRIVACY DISCLOSURE: WWW.CIBC.COM/LEGAL\r\n\x0c';
  const pclCand =
    '\x1bE\x1b&l2A\x1b&l0O\x1b&l4H\x1b(s12H\x1b(s10V' + // Tray 1->4, 10->12 CPI, 12pt->10pt
    '\x1b*p300X\x1b*p200YCIBC MORTGAGE & ESCROW NOTICE - INSTITUTION 010\r\n' +
    '\x1b*p300X\x1b*p320YLOAN TOKEN: TOK-CIBC-99102  TRANSIT: 00012\r\n' +
    '\x1b*p324X\x1b*p440YMONTHLY ESCROW PAYMENT: $1,892.50 CAD\r\n' + // $50 + X-shift
    '\x0c'; // Missing CDIC disclosure line

  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_MTG_ESCROW.pcl'), pclBase, 'utf8');
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_MTG_ESCROW.pcl'), pclCand, 'utf8');

  // 7. CIBC RT / RPT Daily Reconciliation & Settlement Report Pair
  const rtBase = [
    'CIBC ENTERPRISE OPERATIONS - DAILY CLEARING & RECONCILIATION (RPT-010)',
    'RUN DATE: 2026-11-20    INSTITUTION: 010    TRANSIT: 00012',
    '------------------------------------------------------------------------',
    'SEQ  TYPE       ACCT_TOKEN          STATUS      AMOUNT CAD',
    '001  PAD_IN     TOK-CIBC-1001       POSTED       $4,250.00',
    '002  EFT_CR     TOK-CIBC-1002       POSTED       $8,125.50',
    '003  WIRE_OUT   TOK-CIBC-1003       SETTLED      $2,400.00',
    '------------------------------------------------------------------------',
    'RECORD COUNT: 3',
    'GRAND TOTAL: $14,775.50',
    'END OF CIBC CONTROL REPORT',
  ].join('\r\n') + '\r\n';

  const rtCand = [
    'CIBC ENTERPRISE OPERATIONS - DAILY CLEARING & RECONCILIATION (RPT-010)',
    'RUN DATE: 2026-11-20    INSTITUTION: 010    TRANSIT: 00012',
    '------------------------------------------------------------------------',
    'SEQ  TYPE       ACCT_TOKEN          STATUS      AMOUNT CAD',
    '001  PAD_IN     TOK-CIBC-1001       POSTED       $4,250.00',
    '002  EFT_CR       TOK-CIBC-1002     POSTED       $8,195.50', // Spacing shift + amount change
    // Missing row 003
    '------------------------------------------------------------------------',
    'RECORD COUNT: 2',
    'GRAND TOTAL: $12,445.50',
    'END OF CIBC CONTROL REPORT',
  ].join('\n') + '\n'; // LF vs CRLF drift

  fs.writeFileSync(path.join(SAMPLES_DIR, 'IMDS_CIBC_DAILY_RECON.rpt'), rtBase, 'utf8');
  fs.writeFileSync(path.join(SAMPLES_DIR, 'DDGS_CIBC_DAILY_RECON.rpt'), rtCand, 'utf8');
}

async function main() {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  await buildCibcPdfSamples();
  buildCibcAfpPclRtSamples();
  console.log('Successfully generated CIBC migration test sample pairs in samples/cibc/');
}

main().catch((err) => {
  console.error('Failed to build CIBC samples:', err);
  process.exit(1);
});
