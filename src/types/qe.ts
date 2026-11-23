export type FileFormat = 'AFP' | 'PDF' | 'PCL' | 'RT';

export type OutcomeStatus =
  | 'VERIFIED_PASS'
  | 'CONFIRMED_DEFECT'
  | 'POTENTIAL_VARIANCE'
  | 'BLOCKED'
  | 'NOT_RUN';

export type RunLifecycleState =
  | 'Created'
  | 'Waiting for input'
  | 'Input validated'
  | 'Tokenization completed'
  | 'Outputs collected'
  | 'Compared'
  | 'Human review required'
  | 'Passed'
  | 'Failed'
  | 'Blocked'
  | 'Cancelled';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

export type LineEndingStyle = 'LF' | 'CRLF' | 'MIXED' | 'BINARY' | 'NONE';

export interface ArtifactMetadata {
  filename: string;
  format: FileFormat;
  sizeBytes: number;
  sha256: string;
  compressedFromGzip: boolean;
  encoding: string;
  lineEnding: LineEndingStyle;
  hasBom: boolean;
  pageCount: number;
  recordCount: number;
  dimensionsSummary: string;
  producerOrTool: string;
  parseStatus: 'PARSED' | 'PARTIAL_STRUCTURAL_ONLY' | 'CORRUPT' | 'UNSUPPORTED' | 'MISSING';
  parseNotes: string[];
  redactedPiiMatches: number;
}

export interface PclCommandSummary {
  pageNumber: number;
  paperSize: string;
  orientation: string;
  paperSource: string;
  fontPitchCpi: string;
  fontHeightPt: string;
  escapeCount: number;
  textLineCount: number;
}

export interface AfpStructuredField {
  offset: number;
  length: number;
  sfidHex: string;
  mnemonic: string;
  description: string;
  pageIndex: number;
  textPreview?: string;
}

export interface AfpTleEntry {
  pageGroupIndex: number;
  attributeName: string;
  attributeValue: string;
  encoding: 'EBCDIC' | 'ASCII';
}

export interface AfpResourceRef {
  type: 'FONT (MCF)' | 'OVERLAY (MPO)' | 'PAGE_SEG (MPS)' | 'MEDIUM_MAP (IMM)' | 'BARCODE (BBC)' | 'IMAGE (BIM)';
  name: string;
  pageIndex: number;
}

export interface AfpPtocaRun {
  pageIndex: number;
  x: number;
  y: number;
  fontLocalId: number;
  text: string;
  encoding: 'EBCDIC' | 'ASCII';
}

export interface AfpPageGeometry {
  pageIndex: number;
  widthUnits: number;
  heightUnits: number;
  xdpi: number;
  ydpi: number;
}

export interface AfpTextSpan {
  x: number;
  text: string;
  fontSizePt: number;
  fontFamily: 'sans-serif' | 'serif' | 'monospace';
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
}

export type AfpVisualElement =
  | {
      kind: 'image';
      x: number;
      y: number;
      w: number;
      h: number;
      assetId: string;
      label?: string;
    }
  | {
      kind: 'barcode';
      x: number;
      y: number;
      w: number;
      h: number;
      rotation: number;
      value: string;
      symbology: string;
    }
  | {
      kind: 'rule';
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | {
      kind: 'vector';
      x: number;
      y: number;
      w: number;
      h: number;
      viewW: number;
      viewH: number;
      paths: Array<{ d: string; fill?: string; stroke?: string; strokeWidth?: number }>;
    }
  | {
      kind: 'external_ref';
      x: number;
      y: number;
      w: number;
      h: number;
      resType: 'PAGE_SEG' | 'OVERLAY';
      name: string;
    }
  | {
      kind: 'text_line';
      lineNum: number;
      x: number;
      y: number;
      rotation: number;
      spans: AfpTextSpan[];
      fullText: string;
    };

export interface AfpVisualPage {
  pageIndex: number;
  widthUnits: number;
  heightUnits: number;
  xdpi: number;
  ydpi: number;
  elements: AfpVisualElement[];
}

export interface RtControlCheck {
  label: string;
  baselineValue: string;
  candidateValue: string;
  matched: boolean;
  deltaNote: string;
}

export type DiffCategory =
  | 'EQUAL'
  | 'TEXT_CHANGE'
  | 'ALIGNMENT_SHIFT'
  | 'FONT_STYLE'
  | 'MISSING_CONTENT'
  | 'ADDED_CONTENT'
  | 'CONTROL_METADATA';

export interface InlineToken {
  text: string;
  changed: boolean;
}

export interface PdfLineLayout {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
  text: string;
}

export interface PclPositionedLine {
  pageNumber: number;
  x: number;
  y: number;
  fontPitchCpi: string;
  fontHeightPt: string;
  paperSource: string;
  text: string;
}

export type PageAlignmentStatus =
  | 'MATCHED'
  | 'DIFF_DETECTED'
  | 'INSERTED_IN_CANDIDATE'
  | 'MISSING_IN_CANDIDATE';

export interface AlignedPageSlot {
  slotIndex: number;
  baselinePageNum: number | null;
  candidatePageNum: number | null;
  baselineBlank: boolean;
  candidateBlank: boolean;
  status: PageAlignmentStatus;
  similarityPct: number;
  diffCount: number;
  summary: string;
}

export interface TextDiffLine {
  id: string;
  slotIndex?: number;
  pageOrSection: string;
  baselineLineNum: number | null;
  candidateLineNum: number | null;
  type: 'equal' | 'changed' | 'added' | 'removed';
  diffCategory: DiffCategory;
  secondaryCategories?: DiffCategory[];
  baselineText: string;
  candidateText: string;
  baselineTokens?: InlineToken[];
  candidateTokens?: InlineToken[];
  positionDelta?: string;
  fontDelta?: string;
  controlDelta?: string;
  criticalFieldFlag: boolean;
  criticalReason?: string;
  redacted: boolean;
}

export interface PairingCheck {
  pairingKeyName: string;
  pairingKeyValue: string;
  baselineCount: number;
  candidateCount: number;
  status: 'MATCHED' | 'MISSING_CANDIDATE' | 'MISSING_BASELINE' | 'AMBIGUOUS_DUPLICATE';
  notes: string;
}

export interface FindingRecord {
  id: string;
  runId: string;
  layer: 'Structural' | 'Text' | 'Visual' | 'Format-Specific' | 'Pairing' | 'Security';
  severity: Severity;
  category: string;
  status: OutcomeStatus;
  location: string;
  expected: string;
  actual: string;
  reproductionSteps: string[];
  commonPatternHint: string;
  evidenceHashBaseline: string;
  evidenceHashCandidate: string;
  retestOfFindingId?: string;
  retestStatus?: 'Open' | 'Retest Pending' | 'Verified Fixed' | 'Still Failing';
}

export interface ReviewDecisionRecord {
  id: string;
  timestamp: string;
  reviewerIdentity: string;
  decision: 'APPROVE_PASS' | 'CONFIRM_DEFECT' | 'REQUEST_RETEST' | 'BLOCK_EXECUTION';
  toolUsed?: string;
  toolVersion?: string;
  papyrusChecklistCompleted?: boolean;
  rationale: string;
}

export interface ComparisonLayerSummary {
  layerName: 'Structural & Operational' | 'Text & Content' | 'Visual & Layout' | 'Format-Specific' | 'Human Review';
  status: OutcomeStatus;
  checksPassed: number;
  checksFailed: number;
  checksReview: number;
  summary: string;
}

export interface ComparisonRun {
  id: string;
  createdAt: string;
  isSummary?: boolean;
  mvp: string;
  appCode: string;
  subCode: string;
  environmentMarker: 'DEV' | 'TEST' | 'UAT' | 'PROD_BLOCKED';
  configVersion: string;
  format: FileFormat;
  lifecycleState: RunLifecycleState;
  overallOutcome: OutcomeStatus;
  tokenizationStatus: 'Verified Masked / Synthetic' | 'Pending' | 'Failed / Blocked';
  baseline: ArtifactMetadata;
  candidate: ArtifactMetadata;
  pairingChecks: PairingCheck[];
  layerSummaries: ComparisonLayerSummary[];
  alignedPages: AlignedPageSlot[];
  textDiffs: TextDiffLine[];
  totalDiffCount?: number;
  diffLinesTruncated?: boolean;
  findings: FindingRecord[];
  reviews: ReviewDecisionRecord[];
  verificationLimits: string[];
  humanReviewRequired: boolean;
  humanReviewReason?: string;
  pdfDetails?: {
    baselineLayouts: PdfLineLayout[];
    candidateLayouts: PdfLineLayout[];
    baselinePageDims?: Array<{ width: number; height: number }>;
    candidatePageDims?: Array<{ width: number; height: number }>;
  };
  pclDetails?: {
    baselinePages: PclCommandSummary[];
    candidatePages: PclCommandSummary[];
    baselineLines: PclPositionedLine[];
    candidateLines: PclPositionedLine[];
  };
  afpDetails?: {
    validationMode: 'DIRECT_MODCA_NATIVE';
    encodingDetected: string;
    baselineFields: AfpStructuredField[];
    candidateFields: AfpStructuredField[];
    baselineTotalFieldCount?: number;
    candidateTotalFieldCount?: number;
    baselineTles: AfpTleEntry[];
    candidateTles: AfpTleEntry[];
    baselineResources: AfpResourceRef[];
    candidateResources: AfpResourceRef[];
    baselinePtocaRuns: AfpPtocaRun[];
    candidatePtocaRuns: AfpPtocaRun[];
    baselineGeometry: AfpPageGeometry[];
    candidateGeometry: AfpPageGeometry[];
    baselineVisualPages?: AfpVisualPage[];
    candidateVisualPages?: AfpVisualPage[];
    mediaAssets?: Record<string, string>;
    papyrusExportAttached: boolean;
    papyrusToolVersion?: string;
    conversionDisclaimer?: string;
  };
  rtDetails?: {
    controlChecks: RtControlCheck[];
    bannerBaseline: string;
    bannerCandidate: string;
    footerBaseline: string;
    footerCandidate: string;
  };
  pdfVisualReady?: boolean;
  hasBinaryBaseline?: boolean;
  hasBinaryCandidate?: boolean;
}

export interface AdapterCapability {
  format: FileFormat | 'GZIP';
  displayName: string;
  supportStatus: 'Automated + Visual Diff' | 'Automated Structural + Text' | 'Human-in-the-Loop (Papyrus) + Structural' | 'Container Pre-Processor';
  parserEngine: string;
  canParse: string[];
  checksPerformed: string[];
  cannotVerify: string[];
  humanReviewRequired: boolean;
  humanReviewTrigger: string;
  approvedExternalTool?: string;
}

export interface InventoryConfigRule {
  id: string;
  mvp: string;
  sourceSystem: 'IMDS / OpenText DCP';
  targetSystem: 'DDGS / SmartComm';
  appCode: string;
  subCode: string;
  businessOwner: string;
  technicalOwner: string;
  environment: 'TEST' | 'UAT';
  productionSubmissionAllowed: false;
  inputPattern: string;
  compression: 'NONE' | 'GZIP';
  expectedFormats: FileFormat[];
  pairingKeys: string[];
  piiTokenizationApproved: boolean;
  piiFields: string[];
  visualTolerancePct: number;
  numericToleranceAbs: number;
  allowAutoTrimming: boolean;
  manualChecksRequired: string[];
  version: string;
  effectiveDate: string;
  reviewer: string;
  approvalStatus: 'Approved' | 'Draft' | 'Rejected';
  sourceDocRef: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  blockerReasons: string[];
  warnings: string[];
}

export interface DesignPackData {
  requirementsRegister: Array<{
    id: string;
    category: string;
    requirement: string;
    assumption: string;
    verificationMethod: string;
    status: string;
  }>;
  threatAssessment: Array<{
    id: string;
    threat: string;
    vector: string;
    severity: Severity;
    mitigationControl: string;
    residualRisk: string;
  }>;
  unresolvedQuestions: Array<{
    id: string;
    owner: string;
    topic: string;
    question: string;
    blockingImpact: string;
  }>;
  phasedPlan: Array<{
    phase: string;
    scope: string;
    environment: string;
    exitCriteria: string[];
  }>;
}
