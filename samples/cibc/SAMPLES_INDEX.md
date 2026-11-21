# CIBC Official Forms & Migration Test Samples

This folder contains **real publicly available CIBC banking forms and legal disclosure PDFs** retrieved from `cibc.com` and `cibcmellon.com`, paired with deterministic **IMDS Baseline vs. DDGS Candidate** test samples across **PDF, AFP (MO:DCA), PCL5, and RT/RPT** formats.

---

## 1. Official Public CIBC Source PDFs Downloaded Online

| Local File | Pages | Size | Official Source URL |
| :--- | :---: | :---: | :--- |
| `cibc_pad_agreement.pdf` | 1 | 24 KB | `https://www.cibc.com/content/dam/personal_banking/advice_centre/pdfs/student_life/pre-auth-pay-national-en.pdf` |
| `cibc_mellon_direct_deposit.pdf` | 1 | 1.3 MB | `https://www.cibcmellon.com/en/_locale-assets/pdf/pension/retiree-direct-deposit-2025.pdf` |
| `cibc_personal_account_agreement.pdf` | 22 | 856 KB | `https://www.cibc.com/content/dam/personal_banking/bank_accounts/pdfs/12419-personal-deposit-account-terms-and-conditions-en.pdf` |
| `cibc_usa_smart_account_disclosures.pdf` | 29 | 593 KB | `https://us.cibc.com/content/dam/us-public-assets/documents/pdf/cibc-bank-usa-smart-account-agreements-and-disclosures.pdf` |
| `cibc_personal_deposit_brochure.pdf` | 74 | 1.7 MB | `https://www.cibc.com/content/dam/personal_banking/bank_accounts/pdfs/deposits-12997-en.pdf` |

---

## 2. Ready-to-Compare Sample Pairs (Upload via `New Comparison` or Pre-Loaded)

| Format | Baseline (Source) | Candidate (Destination) | Defects & Test Coverage |
| :--- | :--- | :--- | :--- |
| **PDF (1p vs 1p)** | `IMDS_CIBC_PAD_FORM_SRC.pdf` | `DDGS_CIBC_PAD_FORM_DST_DEFECT.pdf` | Real CIBC PAD Form (`RUN-2026-1108`) with NSF fee `TEXT_CHANGE`, `+20pt` `ALIGNMENT_SHIFT`, and font size drift |
| **PDF (6p vs 7p)** | `IMDS_CIBC_12419_ACCT_6P_SRC.pdf` | `DDGS_CIBC_12419_ACCT_7P_DST_BLANK_SHIFT.pdf` | Real CIBC Form 12419 (`RUN-2026-1109`) with **inserted white/blank Page 3** in Destination, continuing to align Source P3–P6 ↔ Dest P4–P7 and flagging fee drift on P6 |
| **PDF (4p vs 4p)** | `IMDS_CIBC_USA_SMART_4P_SRC.pdf` | `DDGS_CIBC_USA_SMART_4P_DST_DEFECT.pdf` | Real CIBC Bank USA Smart Account Disclosures (`910126SAA`) with wire fee & alignment overlay variance |
| **PDF (1p vs 1p)** | `IMDS_CIBC_MELLON_DD_SRC.pdf` | `DDGS_CIBC_MELLON_DD_DST_DEFECT.pdf` | Real CIBC Mellon Direct Deposit Request Form with institution/transit variance |
| **AFP (MO:DCA)** | `IMDS_CIBC_DDA_STMT.afp` | `DDGS_CIBC_DDA_STMT.afp` | Native EBCDIC `0x5A` MO:DCA binary: CIBC Transit `00012` / Inst `010`, `IMM` `DUPLEX01 -> SIMPLEX1`, `TLE` tray drift, `PTOCA` Y & `SCFL` drift |
| **PCL5** | `IMDS_CIBC_MTG_ESCROW.pcl` | `DDGS_CIBC_MTG_ESCROW.pcl` | CIBC Mortgage & Escrow Notice: Tray `1 -> 4`, CPI `10 -> 12`, Font `12pt -> 10pt`, `$50` amount + X-shift, missing CDIC disclosure |
| **RT / RPT** | `IMDS_CIBC_DAILY_RECON.rpt` | `DDGS_CIBC_DAILY_RECON.rpt` | CIBC Daily Clearing & Reconciliation: column spacing shift, amount change, omitted row `003`, record/total mismatch, and `CRLF -> LF` drift |

### Regenerate CIBC Sample Pairs
```bash
npx tsx scripts/build-cibc-samples.ts
```
