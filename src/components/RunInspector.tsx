import { useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileCheck2,
  FileCode2,
} from 'lucide-react';
import type { ComparisonRun, ReviewDecisionRecord } from '../types/qe';
import { DIFF_COLOR_MAP } from '../lib/diffColors';
import { OutcomeBadge } from './OutcomeBadge';
import { PdfVisualDiff } from './PdfVisualDiff';
import { AfpNativeInspector } from './AfpNativeInspector';
import { SideBySideDiffView } from './SideBySideDiffView';
import { AllPagesVisualCompare } from './AllPagesVisualCompare';

interface RunInspectorProps {
  run: ComparisonRun;
  onBack: () => void;
  onRunUpdated: (updated: ComparisonRun) => void;
}

type InspectorTab = 'visualCompare' | 'sideBySide' | 'visual' | 'structural' | 'findings' | 'review';

export function RunInspector({ run, onBack, onRunUpdated }: RunInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('visualCompare');
  const [visualInitialPage, setVisualInitialPage] = useState<number>(1);

  // Human review form state
  const [decision, setDecision] = useState<ReviewDecisionRecord['decision']>(
    run.overallOutcome === 'CONFIRMED_DEFECT' ? 'CONFIRM_DEFECT' : 'APPROVE_PASS'
  );
  const [reviewerIdentity, setReviewerIdentity] = useState('QE Analyst (Local Sandbox)');
  const [toolUsed, setToolUsed] = useState(run.format === 'AFP' ? 'ISIS Papyrus Viewer' : 'DocVerify QE');
  const [toolVersion, setToolVersion] = useState(run.format === 'AFP' ? '7.8' : '1.0');
  const [papyrusChecklist, setPapyrusChecklist] = useState(false);
  const [rationale, setRationale] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setReviewError(null);
    if (!reviewerIdentity.trim() || !rationale.trim()) {
      setReviewError('Reviewer identity and rationale are mandatory.');
      return;
    }
    setSubmittingReview(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reviewerIdentity,
          rationale,
          toolUsed,
          toolVersion,
          papyrusChecklistCompleted: run.format === 'AFP' ? papyrusChecklist : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record sign-off');
      onRunUpdated(data.run);
      setRationale('');
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Sign-off submission failed');
    } finally {
      setSubmittingReview(false);
    }
  };

  const diffLineCount = run.textDiffs.filter((d) => d.diffCategory !== 'EQUAL').length;

  return (
    <div className="space-y-6">
      {/* Top Run Header */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Comparison Runs
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-900 font-mono tabular-nums">
                {run.id}
              </h1>
              <OutcomeBadge status={run.overallOutcome} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{run.mvp}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700">
                {run.appCode} / {run.subCode}
              </span>
              <span aria-hidden="true">·</span>
              <span>Format: {run.format}</span>
              <span aria-hidden="true">·</span>
              <span>Env: {run.environmentMarker}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Config {run.configVersion}</span>
              <span aria-hidden="true">·</span>
              <span>{run.tokenizationStatus}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {run.format === 'PDF' && run.pdfVisualReady && (
              <a
                href={`/api/runs/${encodeURIComponent(run.id)}/export?format=diff-pdf`}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Highlighted PDF Report
              </a>
            )}
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/export?format=html`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Visual HTML Report
            </a>
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/export?format=json`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </a>
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/export?format=csv`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </a>
          </div>
        </div>

        {/* Independent Validation Layer Summaries */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-4 border-t border-slate-100">
          {run.layerSummaries.map((layer) => (
            <div key={layer.layerName} className="rounded-md border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
              <div className="text-xs font-medium text-slate-600">{layer.layerName}</div>
              <div>
                <OutcomeBadge status={layer.status} compact />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{layer.summary}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {(
          [
            {
              id: 'visualCompare',
              label: `Visual All-Pages (${run.alignedPages?.length || 0} slots)`,
            },
            {
              id: 'sideBySide',
              label: `Line-by-Line Diff (${diffLineCount})`,
            },
            {
              id: 'visual',
              label:
                run.format === 'AFP'
                  ? 'Direct Native AFP (No PDF)'
                  : run.format === 'PDF'
                  ? 'Single-Page Canvas Inspector'
                  : run.format === 'PCL'
                  ? 'PCL ESC & Layout'
                  : 'RT Banners & Control Totals',
            },
            { id: 'structural', label: 'Structural & Pairing' },
            { id: 'findings', label: `Findings & Evidence (${run.findings.length})` },
            { id: 'review', label: `Human Sign-Off (${run.reviews.length})` },
          ] as Array<{ id: InspectorTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 0: ALL-PAGES VISUAL SIDE-BY-SIDE COMPARE */}
      {activeTab === 'visualCompare' && <AllPagesVisualCompare run={run} />}

      {/* TAB 1: STRUCTURAL & PAIRING */}
      {activeTab === 'structural' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { title: 'IMDS Baseline (OpenText DCP)', meta: run.baseline, side: 'baseline' as const },
              { title: 'DDGS Candidate (SmartComm)', meta: run.candidate, side: 'candidate' as const },
            ].map((item) => (
              <div key={item.side} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                  {((item.side === 'baseline' && run.hasBinaryBaseline) ||
                    (item.side === 'candidate' && run.hasBinaryCandidate)) && (
                    <a
                      href={`/api/runs/${encodeURIComponent(run.id)}/artifact/${item.side}?download=1`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download File
                    </a>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <dt className="text-slate-500">Filename</dt>
                  <dd className="font-mono text-slate-900 break-all">{item.meta.filename}</dd>

                  <dt className="text-slate-500">Parse Status</dt>
                  <dd className="font-mono text-slate-900">{item.meta.parseStatus}</dd>

                  <dt className="text-slate-500">Size (Bytes)</dt>
                  <dd className="font-mono tabular-nums text-slate-900">{item.meta.sizeBytes.toLocaleString()}</dd>

                  <dt className="text-slate-500">Encoding / EOL</dt>
                  <dd className="font-mono text-slate-900">
                    {item.meta.encoding} · {item.meta.lineEnding}
                    {item.meta.hasBom ? ' · BOM' : ''}
                  </dd>

                  <dt className="text-slate-500">Pages / Records</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {item.meta.pageCount} page(s) · {item.meta.recordCount} record(s)
                  </dd>

                  <dt className="text-slate-500">Dimensions / Scope</dt>
                  <dd className="font-mono text-slate-900">{item.meta.dimensionsSummary}</dd>

                  <dt className="text-slate-500">Producer / Tool</dt>
                  <dd className="text-slate-900">{item.meta.producerOrTool}</dd>

                  <dt className="text-slate-500">PII Redactions Applied</dt>
                  <dd className="font-mono tabular-nums text-slate-900">{item.meta.redactedPiiMatches}</dd>

                  <dt className="text-slate-500">SHA-256 Evidence</dt>
                  <dd className="font-mono text-[11px] text-slate-700 break-all col-span-1">
                    {item.meta.sha256}
                  </dd>
                </dl>

                {item.meta.parseNotes.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-600 space-y-1">
                    {item.meta.parseNotes.map((n, i) => (
                      <div key={i}>• {n}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pairing & Reconciliation */}
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Deterministic IMDS / DDGS Pairing & Reconciliation
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Pairing Key</th>
                    <th className="px-4 py-2.5 font-medium">Key Value</th>
                    <th className="px-4 py-2.5 font-medium text-right">IMDS Count</th>
                    <th className="px-4 py-2.5 font-medium text-right">DDGS Count</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {run.pairingChecks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-slate-500">
                        Pairing skipped because run was blocked during ingestion/integrity validation.
                      </td>
                    </tr>
                  ) : (
                    run.pairingChecks.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-slate-900">{p.pairingKeyName}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-700">{p.pairingKeyValue}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-right text-slate-900">
                          {p.baselineCount}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-right text-slate-900">
                          {p.candidateCount}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-emerald-700">{p.status}</td>
                        <td className="px-4 py-2.5 text-slate-600">{p.notes}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Explicit Adapter Verification Limits */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Declared Adapter Verification Limits ({run.format})
            </h2>
            <p className="text-xs text-slate-500">
              Checks listed below cannot be asserted automatically by the {run.format} parser and must never be reported as verified passes:
            </p>
            <ul className="space-y-1 text-xs text-slate-700 list-disc pl-5">
              {run.verificationLimits.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* TAB 1: COLOR-CODED SIDE-BY-SIDE COMPARISON */}
      {activeTab === 'sideBySide' && (
        <SideBySideDiffView
          run={run}
          onJumpToVisualPage={(pageNum) => {
            setVisualInitialPage(pageNum);
            setActiveTab('visual');
          }}
        />
      )}

      {/* TAB 2: VISUAL & FORMAT-SPECIFIC VIEW */}
      {activeTab === 'visual' && (
        <div className="space-y-6">
          {/* PDF LIVE CANVAS DIFF */}
          {run.format === 'PDF' && run.pdfVisualReady && (
            <PdfVisualDiff
              baselineUrl={`/api/runs/${encodeURIComponent(run.id)}/artifact/baseline`}
              candidateUrl={`/api/runs/${encodeURIComponent(run.id)}/artifact/candidate`}
              tolerancePct={0.5}
              pdfDetails={run.pdfDetails}
              textDiffs={run.textDiffs}
              initialPage={visualInitialPage}
            />
          )}

          {/* PCL ESCAPE COMMAND MATRIX */}
          {run.format === 'PCL' && run.pclDetails && (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    PCL5 Print-Stream Escape Properties Comparison
                  </h2>
                  <p className="text-xs text-slate-500">
                    Compares parsed ESC sequences per page (Page Size, Orientation, Paper Tray, Font Pitch/Height).
                  </p>
                </div>
                <FileCode2 className="w-4 h-4 text-slate-400" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Page</th>
                      <th className="px-4 py-2.5 font-medium">Property</th>
                      <th className="px-4 py-2.5 font-medium">IMDS Baseline (OpenText DCP)</th>
                      <th className="px-4 py-2.5 font-medium">DDGS Candidate (SmartComm)</th>
                      <th className="px-4 py-2.5 font-medium">Parity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {run.pclDetails.baselinePages.map((bp, idx) => {
                      const cp = run.pclDetails!.candidatePages[idx];
                      const props = [
                        { name: 'Paper Size (&l#A)', b: bp.paperSize, c: cp?.paperSize || 'Missing', cat: 'CONTROL_METADATA' as const },
                        { name: 'Orientation (&l#O)', b: bp.orientation, c: cp?.orientation || 'Missing', cat: 'ALIGNMENT_SHIFT' as const },
                        { name: 'Paper Source / Tray (&l#H)', b: bp.paperSource, c: cp?.paperSource || 'Missing', cat: 'CONTROL_METADATA' as const },
                        { name: 'Font Pitch ((s#H)', b: bp.fontPitchCpi, c: cp?.fontPitchCpi || 'Missing', cat: 'FONT_STYLE' as const },
                        { name: 'Font Height ((s#V)', b: bp.fontHeightPt, c: cp?.fontHeightPt || 'Missing', cat: 'FONT_STYLE' as const },
                      ];
                      return props.map((pr, pIdx) => {
                        const match = pr.b === pr.c;
                        const meta = DIFF_COLOR_MAP[pr.cat];
                        return (
                          <tr key={`${idx}-${pIdx}`} className={match ? '' : meta.rowTintClass}>
                            <td className="px-4 py-2 font-mono tabular-nums text-slate-600">
                              Page {bp.pageNumber}
                            </td>
                            <td className="px-4 py-2 font-medium text-slate-800">{pr.name}</td>
                            <td className="px-4 py-2 font-mono text-slate-800">{pr.b}</td>
                            <td className="px-4 py-2 font-mono text-slate-800">{pr.c}</td>
                            <td className="px-4 py-2">
                              {match ? (
                                <span className="font-medium text-emerald-700">Matched</span>
                              ) : (
                                <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}>
                                  <span className={`w-2 h-2 rounded-sm ${meta.swatchBg}`} />
                                  {meta.shortLabel}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* DIRECT NATIVE AFP VALIDATION (NO PDF CONVERSION) */}
          {run.format === 'AFP' && run.afpDetails && (
            <AfpNativeInspector run={run} onRunUpdated={onRunUpdated} />
          )}

          {/* RT / RPT CONTROL TOTALS & BANNERS */}
          {run.format === 'RT' && run.rtDetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-800">Header Banner Parity</div>
                  <div className="text-xs text-slate-500">IMDS: <span className="font-mono text-slate-900">{run.rtDetails.bannerBaseline}</span></div>
                  <div className="text-xs text-slate-500">DDGS: <span className="font-mono text-slate-900">{run.rtDetails.bannerCandidate}</span></div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-800">Trailer / Footer Parity</div>
                  <div className="text-xs text-slate-500">IMDS: <span className="font-mono text-slate-900">{run.rtDetails.footerBaseline}</span></div>
                  <div className="text-xs text-slate-500">DDGS: <span className="font-mono text-slate-900">{run.rtDetails.footerCandidate}</span></div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">
                  Numeric Control Total Reconciliation
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Control Metric</th>
                      <th className="px-4 py-2.5 font-medium text-right">IMDS Value</th>
                      <th className="px-4 py-2.5 font-medium text-right">DDGS Value</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {run.rtDetails.controlChecks.map((chk, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{chk.label}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-right text-slate-900">
                          {chk.baselineValue}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums text-right text-slate-900">
                          {chk.candidateValue}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={chk.matched ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                            {chk.matched ? 'Reconciled' : chk.deltaNote}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {run.overallOutcome === 'BLOCKED' && (
            <div className="rounded-lg border border-slate-300 bg-slate-100 p-6 text-sm text-slate-800">
              Visual/Format rendering skipped because this run is <strong>Blocked</strong> due to missing, empty, or corrupt artifacts.
            </div>
          )}
        </div>
      )}

      {/* TAB 4: FINDINGS & EVIDENCE */}
      {activeTab === 'findings' && (
        <div className="space-y-4">
          {run.findings.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Zero automated defects recorded for this run.
            </div>
          ) : (
            run.findings.map((f) => (
              <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono text-xs font-semibold text-slate-900">{f.id}</span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-sm font-semibold text-slate-900">{f.category}</span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-600">
                      {f.layer} Layer · Severity: {f.severity}
                    </span>
                  </div>
                  <OutcomeBadge status={f.status} compact />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50 rounded-md p-3 border border-slate-200/80">
                  <div>
                    <div className="font-medium text-slate-500 mb-1">Expected (IMDS Baseline)</div>
                    <div className="font-mono text-slate-900 break-words">{f.expected}</div>
                  </div>
                  <div>
                    <div className="font-medium text-slate-500 mb-1">Actual (DDGS Candidate)</div>
                    <div className="font-mono text-slate-900 break-words">{f.actual}</div>
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-1">
                  <div>
                    <span className="font-medium text-slate-700">Location: </span>
                    <span className="font-mono">{f.location}</span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">Pattern Hint: </span>
                    {f.commonPatternHint}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">Evidence Hashes: </span>
                    <span className="font-mono text-[11px]">
                      IMDS {f.evidenceHashBaseline.slice(0, 16)}… / DDGS {f.evidenceHashCandidate.slice(0, 16)}…
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 5: HUMAN REVIEW & SIGN-OFF */}
      {activeTab === 'review' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={handleSubmitReview} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Record Human QE / Business Sign-Off
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automated tooling never makes final business acceptance decisions. Decisions are appended to the immutable audit trail.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Decision</label>
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as ReviewDecisionRecord['decision'])}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="APPROVE_PASS">Approve as Verified Pass</option>
                  <option value="CONFIRM_DEFECT">Confirm Defect (Fail)</option>
                  <option value="REQUEST_RETEST">Hold / Request Retest</option>
                  <option value="BLOCK_EXECUTION">Block Execution</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reviewer Identity</label>
                <input
                  type="text"
                  value={reviewerIdentity}
                  onChange={(e) => setReviewerIdentity(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Inspection Tool Used</label>
                <input
                  type="text"
                  value={toolUsed}
                  onChange={(e) => setToolUsed(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tool Version</label>
                <input
                  type="text"
                  value={toolVersion}
                  onChange={(e) => setToolVersion(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>
            </div>

            {run.format === 'AFP' && (
              <label className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={papyrusChecklist}
                  onChange={(e) => setPapyrusChecklist(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-700"
                />
                <span>
                  I opened both IMDS and DDGS <code className="font-mono">.afp</code> files in ISIS Papyrus and verified page alignment, fonts, overlays, barcodes, and envelope address window placement.
                </span>
              </label>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Sign-Off Rationale (Privacy-Safe, No Raw PII)
              </label>
              <textarea
                rows={3}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Document specific page/region observations, Papyrus findings, or defect ticket link..."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900"
                required
              />
            </div>

            {reviewError && <div className="text-xs text-red-700 font-medium">{reviewError}</div>}

            <button
              type="submit"
              disabled={submittingReview}
              className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <FileCheck2 className="w-4 h-4" />
              {submittingReview ? 'Recording Sign-Off...' : 'Record Sign-Off Decision'}
            </button>
          </form>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Review & Sign-Off Audit Trail</h2>
            {run.reviews.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                No human sign-off decisions recorded yet for this run.
              </div>
            ) : (
              <div className="space-y-3">
                {run.reviews.map((rev) => (
                  <div key={rev.id} className="rounded-md border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{rev.decision}</span>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {new Date(rev.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-slate-600">
                      Reviewer: <span className="font-medium text-slate-800">{rev.reviewerIdentity}</span>
                      {rev.toolUsed && ` · ${rev.toolUsed} ${rev.toolVersion || ''}`}
                    </div>
                    <p className="text-slate-700 leading-relaxed">{rev.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
