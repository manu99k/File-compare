import { useMemo, useState } from 'react';
import { Columns2, Eye, Filter } from 'lucide-react';
import type { ComparisonRun, DiffCategory, InlineToken, TextDiffLine } from '../types/qe';
import { DIFF_CATEGORY_ORDER, DIFF_COLOR_MAP } from '../lib/diffColors';

interface SideBySideDiffViewProps {
  run: ComparisonRun;
  onJumpToVisualPage?: (pageNum: number) => void;
}

function renderTokens(
  tokens: InlineToken[] | undefined,
  fallbackText: string,
  category: DiffCategory,
  showWhitespace: boolean,
  emptyLabel: string
) {
  const meta = DIFF_COLOR_MAP[category];
  const formatText = (val: string) => (showWhitespace ? val.replace(/ /g, '·') : val);

  if (!tokens || tokens.length === 0) {
    if (!fallbackText) {
      return <span className="text-slate-400 italic font-sans">{emptyLabel}</span>;
    }
    return <span>{formatText(fallbackText)}</span>;
  }

  return (
    <>
      {tokens.map((tok, idx) =>
        tok.changed ? (
          <mark key={idx} className={meta.tokenHighlightClass}>
            {formatText(tok.text)}
          </mark>
        ) : (
          <span key={idx}>{formatText(tok.text)}</span>
        )
      )}
    </>
  );
}

function buildColumnRuler(cols = 76): string {
  let tens = '';
  let units = '';
  for (let i = 1; i <= cols; i++) {
    if (i % 10 === 0) {
      const label = String(i);
      tens = tens.slice(0, Math.max(0, i - label.length)) + label;
      units += '|';
    } else if (i % 5 === 0) {
      tens += ' ';
      units += '+';
    } else {
      tens += ' ';
      units += '.';
    }
  }
  return `${tens}\n${units}`;
}

export function SideBySideDiffView({ run, onJumpToVisualPage }: SideBySideDiffViewProps) {
  const [viewMode, setViewMode] = useState<'all' | 'changes'>('all');
  const [selectedCategory, setSelectedCategory] = useState<DiffCategory | 'ALL'>('ALL');
  const [showWhitespace, setShowWhitespace] = useState(run.format === 'RT');

  const categoryCounts = useMemo(() => {
    const counts: Record<DiffCategory, number> = {
      EQUAL: 0,
      TEXT_CHANGE: 0,
      ALIGNMENT_SHIFT: 0,
      FONT_STYLE: 0,
      MISSING_CONTENT: 0,
      ADDED_CONTENT: 0,
      CONTROL_METADATA: 0,
    };
    for (const d of run.textDiffs) {
      counts[d.diffCategory] = (counts[d.diffCategory] || 0) + 1;
      for (const sec of d.secondaryCategories || []) {
        counts[sec] = (counts[sec] || 0) + 1;
      }
    }
    return counts;
  }, [run.textDiffs]);

  const totalDiffLines = useMemo(
    () => run.textDiffs.filter((d) => d.diffCategory !== 'EQUAL').length,
    [run.textDiffs]
  );

  const visibleRows = useMemo(() => {
    return run.textDiffs.filter((d) => {
      if (selectedCategory !== 'ALL') {
        const matchesCat =
          d.diffCategory === selectedCategory ||
          (d.secondaryCategories && d.secondaryCategories.includes(selectedCategory));
        if (!matchesCat) return false;
      }
      if (viewMode === 'changes' && d.diffCategory === 'EQUAL') {
        return false;
      }
      return true;
    });
  }, [run.textDiffs, selectedCategory, viewMode]);

  const eolDrift =
    run.baseline.lineEnding !== run.candidate.lineEnding ||
    run.baseline.hasBom !== run.candidate.hasBom;

  const columnRuler = useMemo(() => buildColumnRuler(76), []);

  const hasPclControlDrift =
    run.format === 'PCL' &&
    run.pclDetails &&
    run.pclDetails.baselinePages.some((bp, i) => {
      const cp = run.pclDetails!.candidatePages[i];
      return (
        !cp ||
        bp.paperSource !== cp.paperSource ||
        bp.fontPitchCpi !== cp.fontPitchCpi ||
        bp.fontHeightPt !== cp.fontHeightPt ||
        bp.orientation !== cp.orientation
      );
    });

  return (
    <div className="space-y-4">
      {/* Top Color-Coded Legend & Filter Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Columns2 className="w-4 h-4 text-blue-700" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Color-Coded Side-by-Side Report Comparison
              </h2>
              <p className="text-xs text-slate-500">
                Synchronized IMDS Baseline vs. DDGS Candidate lines with color-coded difference classification and inline token highlights.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowWhitespace((w) => !w)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                showWhitespace
                  ? 'border-blue-300 bg-blue-50 text-blue-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Visualize space characters as dots to catch fixed-width column shifts"
            >
              <Eye className="w-3.5 h-3.5" />
              {showWhitespace ? 'Spaces: Visible (·)' : 'Show Spaces'}
            </button>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  viewMode === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Full Report ({run.textDiffs.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('changes')}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  viewMode === 'changes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Differences Only ({totalDiffLines})
              </button>
            </div>
          </div>
        </div>

        {/* Interactive Color-Coded Difference Type Legend */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 mr-1">
            <Filter className="w-3 h-3" />
            Difference Legend:
          </span>

          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              selectedCategory === 'ALL'
                ? 'border-slate-800 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            All ({run.textDiffs.length})
          </button>

          {DIFF_CATEGORY_ORDER.map((cat) => {
            const meta = DIFF_COLOR_MAP[cat];
            const count = categoryCounts[cat];
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(active ? 'ALL' : cat)}
                title={meta.description}
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'ring-2 ring-offset-1 ring-slate-700 ' + meta.badgeClass
                    : count > 0
                    ? meta.badgeClass + ' hover:opacity-90'
                    : 'border-slate-200 bg-slate-50/70 text-slate-400 hover:text-slate-600'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${meta.swatchBg}`} />
                <span>{meta.shortLabel}</span>
                <span className="font-mono tabular-nums text-[11px] opacity-85">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Format-Level Control / EOL Strip when applicable */}
      {(eolDrift || hasPclControlDrift || (run.format === 'AFP' && run.afpDetails)) && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-4 text-xs">
          {eolDrift && (
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium ${DIFF_COLOR_MAP.FONT_STYLE.badgeClass}`}>
                <span className={`w-2 h-2 rounded-sm ${DIFF_COLOR_MAP.FONT_STYLE.swatchBg}`} />
                EOL / Encoding Drift
              </span>
              <span className="font-mono text-slate-700">
                IMDS: {run.baseline.lineEnding}
                {run.baseline.hasBom ? '+BOM' : ''} → DDGS: {run.candidate.lineEnding}
                {run.candidate.hasBom ? '+BOM' : ''}
              </span>
            </div>
          )}

          {hasPclControlDrift && run.pclDetails && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium ${DIFF_COLOR_MAP.CONTROL_METADATA.badgeClass}`}>
                <span className={`w-2 h-2 rounded-sm ${DIFF_COLOR_MAP.CONTROL_METADATA.swatchBg}`} />
                PCL ESC Header Drift
              </span>
              <span className="font-mono text-slate-700">
                IMDS: {run.pclDetails.baselinePages[0]?.paperSource} · {run.pclDetails.baselinePages[0]?.fontPitchCpi} / {run.pclDetails.baselinePages[0]?.fontHeightPt}
                {' → '}
                DDGS: {run.pclDetails.candidatePages[0]?.paperSource} · {run.pclDetails.candidatePages[0]?.fontPitchCpi} / {run.pclDetails.candidatePages[0]?.fontHeightPt}
              </span>
            </div>
          )}

          {run.format === 'AFP' && run.afpDetails && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-medium ${DIFF_COLOR_MAP.CONTROL_METADATA.badgeClass}`}>
                <span className={`w-2 h-2 rounded-sm ${DIFF_COLOR_MAP.CONTROL_METADATA.swatchBg}`} />
                MO:DCA Native
              </span>
              <span className="text-slate-600">
                Direct EBCDIC/PTOCA stream comparison (zero PDF conversion). See <span className="font-medium text-slate-800">Visual / Format View</span> for full TLE & IMM tables.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Synchronized Two-Column Side-by-Side Comparison */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        {visibleRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {run.textDiffs.length === 0
              ? 'No comparable lines extracted (run blocked or empty/corrupt artifact).'
              : 'No lines match the selected difference filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="w-1.5 p-0" aria-label="Color Bar" />
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap w-28">Page / Line</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap w-44">Difference Type</th>
                  <th className="px-3 py-2.5 font-medium min-w-[320px]">
                    <div className="flex items-center justify-between gap-2">
                      <span>IMDS Baseline (OpenText DCP)</span>
                      <span className="font-mono text-[11px] font-normal text-slate-400">
                        {run.baseline.filename}
                      </span>
                    </div>
                  </th>
                  <th className="px-3 py-2.5 font-medium min-w-[320px] border-l border-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <span>DDGS Candidate (SmartComm)</span>
                      <span className="font-mono text-[11px] font-normal text-slate-400">
                        {run.candidate.filename}
                      </span>
                    </div>
                  </th>
                </tr>
                {run.format === 'RT' && (
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-mono text-slate-500 select-none">
                    <td className="p-0" />
                    <td className="px-3 py-1" colSpan={2}>
                      Col Ruler (1–76)
                    </td>
                    <td className="px-3 py-1 whitespace-pre leading-tight">{columnRuler}</td>
                    <td className="px-3 py-1 whitespace-pre leading-tight border-l border-slate-200">
                      {columnRuler}
                    </td>
                  </tr>
                )}
              </thead>

              <tbody className="divide-y divide-slate-200/80">
                {visibleRows.map((row: TextDiffLine) => {
                  const meta = DIFF_COLOR_MAP[row.diffCategory];
                  const pageMatch = row.pageOrSection.match(/^Page\s+(\d+)/i);
                  const pageNum = pageMatch ? Number(pageMatch[1]) : null;

                  return (
                    <tr
                      key={row.id}
                      className={`${meta.rowTintClass} transition-colors hover:brightness-[0.98]`}
                    >
                      {/* Solid Color-Coded Left Gutter Bar */}
                      <td className={`w-1.5 p-0 ${meta.gutterBarClass}`} />

                      {/* Location / Line numbers */}
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-medium text-slate-700">
                          <span>{row.pageOrSection}</span>
                          {pageNum && run.format === 'PDF' && onJumpToVisualPage && (
                            <button
                              type="button"
                              onClick={() => onJumpToVisualPage(pageNum)}
                              className="text-[10px] text-blue-700 hover:underline font-normal"
                            >
                              (Canvas)
                            </button>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums mt-0.5">
                          IMDS L{row.baselineLineNum ?? '—'} · DDGS L{row.candidateLineNum ?? '—'}
                        </div>
                      </td>

                      {/* Color-coded Difference Category Badge(s) */}
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${meta.badgeClass}`}
                          >
                            <span className={`w-2 h-2 rounded-sm shrink-0 ${meta.swatchBg}`} />
                            {meta.shortLabel}
                          </span>

                          {(row.secondaryCategories || []).map((sec) => {
                            const secMeta = DIFF_COLOR_MAP[sec];
                            return (
                              <span
                                key={sec}
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${secMeta.badgeClass}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${secMeta.swatchBg}`} />
                                + {secMeta.shortLabel}
                              </span>
                            );
                          })}

                          {row.criticalFieldFlag && (
                            <span className="text-[11px] font-semibold text-red-700">
                              Critical Field
                            </span>
                          )}
                        </div>
                      </td>

                      {/* IMDS Baseline Column */}
                      <td className="px-3 py-2.5 align-top font-mono text-[12px] text-slate-900 whitespace-pre-wrap break-words">
                        {renderTokens(
                          row.baselineTokens,
                          row.baselineText,
                          row.diffCategory === 'EQUAL'
                            ? 'EQUAL'
                            : row.diffCategory === 'ADDED_CONTENT'
                            ? 'ADDED_CONTENT'
                            : row.diffCategory,
                          showWhitespace,
                          '(Absent in IMDS baseline)'
                        )}
                      </td>

                      {/* DDGS Candidate Column */}
                      <td className="px-3 py-2.5 align-top font-mono text-[12px] text-slate-900 whitespace-pre-wrap break-words border-l border-slate-200/80">
                        <div>
                          {renderTokens(
                            row.candidateTokens,
                            row.candidateText,
                            row.diffCategory,
                            showWhitespace,
                            '(Missing in DDGS candidate)'
                          )}
                        </div>

                        {/* Layout / Font / Control / Critical Detail Callouts */}
                        {(row.positionDelta || row.fontDelta || row.controlDelta || row.criticalReason) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-sans text-[11px]">
                            {row.positionDelta && (
                              <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-800 font-mono">
                                {row.positionDelta}
                              </span>
                            )}
                            {row.fontDelta && (
                              <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-800 font-mono">
                                {row.fontDelta}
                              </span>
                            )}
                            {row.controlDelta && (
                              <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-900 font-mono">
                                {row.controlDelta}
                              </span>
                            )}
                            {row.criticalReason && (
                              <span className="text-red-700 font-medium">{row.criticalReason}</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
