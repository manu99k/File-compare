import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { ConfigValidationResult, InventoryConfigRule } from '../src/types/qe.ts';

export const MAX_UPLOAD_FILE_BYTES = 500 * 1024 * 1024; // 500 MB per uploaded file
const MAX_DECOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB decompressed payload cap
const MAX_GZIP_RATIO = 120;

export function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sanitizeFilename(rawName: string): { safeName: string; rejected: boolean; reason?: string } {
  const trimmed = (rawName || '').trim();
  if (!trimmed) {
    return { safeName: 'unnamed_artifact', rejected: true, reason: 'Empty filename provided.' };
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return {
      safeName: trimmed.replace(/[^a-zA-Z0-9._-]/g, '_'),
      rejected: true,
      reason: 'Path traversal or directory separator detected in filename.',
    };
  }
  const safeName = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  return { safeName, rejected: false };
}

export function isGzipBuffer(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

export function safeGunzip(
  buf: Buffer,
  filename: string
): {
  ok: boolean;
  buffer: Buffer;
  wasCompressed: boolean;
  nestedCompressionDetected: boolean;
  error?: string;
} {
  if (!isGzipBuffer(buf) && !filename.toLowerCase().endsWith('.gz')) {
    return { ok: true, buffer: buf, wasCompressed: false, nestedCompressionDetected: false };
  }

  if (!isGzipBuffer(buf) && filename.toLowerCase().endsWith('.gz')) {
    return {
      ok: false,
      buffer: Buffer.alloc(0),
      wasCompressed: true,
      nestedCompressionDetected: false,
      error: 'File has .gz extension but lacks valid GZIP magic header (0x1F 0x8B).',
    };
  }

  try {
    const decompressed = zlib.gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    if (buf.length > 0 && decompressed.length / buf.length > MAX_GZIP_RATIO && decompressed.length > 1024 * 1024) {
      return {
        ok: false,
        buffer: Buffer.alloc(0),
        wasCompressed: true,
        nestedCompressionDetected: false,
        error: `Decompression ratio exceeded safety threshold (${MAX_GZIP_RATIO}:1). Blocked as potential compression bomb.`,
      };
    }

    const nested = isGzipBuffer(decompressed);
    if (nested) {
      return {
        ok: false,
        buffer: Buffer.alloc(0),
        wasCompressed: true,
        nestedCompressionDetected: true,
        error: 'Unexpected nested GZIP compression detected inside archive stream.',
      };
    }

    return { ok: true, buffer: decompressed, wasCompressed: true, nestedCompressionDetected: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Corrupt or truncated GZIP stream';
    return {
      ok: false,
      buffer: Buffer.alloc(0),
      wasCompressed: true,
      nestedCompressionDetected: false,
      error: `GZIP integrity failure: ${message}`,
    };
  }
}

export function redactSensitiveText(input: string): { redactedText: string; matchCount: number } {
  let matchCount = 0;
  let text = input;

  // SSN pattern XXX-XX-XXXX
  text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => {
    matchCount++;
    return '[REDACTED-SSN]';
  });

  // Bearer / secret tokens
  text = text.replace(/\b(Bearer\s+[A-Za-z0-9\-._~+/]+=*|sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z\-_]{20,})\b/g, () => {
    matchCount++;
    return '[REDACTED-TOKEN]';
  });

  // Email addresses
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => {
    matchCount++;
    return '[REDACTED-EMAIL]';
  });

  // Long unmasked 12-16 digit account/card numbers (preserve last 4 digits; do not mangle *030101100001* mailroom barcodes)
  text = text.replace(/(?<!\*)\b(\d{8,12})(\d{4})\b(?!\*)/g, (_m, _prefix, last4) => {
    matchCount++;
    return `****-****-${last4}`;
  });

  return { redactedText: text, matchCount };
}

export function validateInventoryConfig(config: Partial<InventoryConfigRule>): ConfigValidationResult {
  const blockerReasons: string[] = [];
  const warnings: string[] = [];

  if (!config.appCode || !config.subCode) {
    blockerReasons.push('Missing required appCode or subCode in inventory configuration.');
  }

  if ((config as { productionSubmissionAllowed?: boolean }).productionSubmissionAllowed !== false) {
    blockerReasons.push('Policy Blocker: Production submission must remain explicitly disabled (productionSubmissionAllowed: false).');
  }

  if (config.approvalStatus !== 'Approved') {
    blockerReasons.push(`Configuration Blocker: Approval status is "${config.approvalStatus ?? 'Missing'}". Only "Approved" configurations may execute.`);
  }

  if (!config.piiTokenizationApproved) {
    blockerReasons.push('PII Governance Blocker: piiTokenizationApproved must be true with explicit approved PII field list.');
  }

  if (!config.piiFields || config.piiFields.length === 0) {
    blockerReasons.push('PII Governance Blocker: Approved PII fields list cannot be empty; never infer PII status from file contents alone.');
  }

  if (!config.pairingKeys || config.pairingKeys.length === 0) {
    blockerReasons.push('Pairing Blocker: Deterministic pairingKeys must be configured (cannot pair by file counts or filenames alone).');
  }

  if (typeof config.visualTolerancePct !== 'number' || config.visualTolerancePct < 0 || config.visualTolerancePct > 5) {
    blockerReasons.push('Tolerance Blocker: visualTolerancePct must be between 0% and 5%.');
  } else if (config.visualTolerancePct > 2) {
    warnings.push('Visual tolerance exceeds 2.0%; confirm business owner sign-off.');
  }

  if (!config.expectedFormats || config.expectedFormats.length === 0) {
    blockerReasons.push('Output Blocker: expectedFormats must declare at least one valid target format (AFP, PDF, PCL, RT).');
  }

  if (!config.sourceDocRef) {
    warnings.push('Missing source document reference for configuration audit trail.');
  }

  return {
    valid: blockerReasons.length === 0,
    blockerReasons,
    warnings,
  };
}
