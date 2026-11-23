import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Layers, Upload } from 'lucide-react';
import type { AfpVisualPage, ComparisonRun, DiffCategory } from '../types/qe';
import { DIFF_COLOR_MAP } from '../lib/diffColors';
import { AfpVisualPageSvg } from './AllPagesVisualCompare';
import { PdfVisualDiff } from './PdfVisualDiff';

interface AfpNativeInspectorProps {
  run: ComparisonRun;
  onRunUpdated: (updated: ComparisonRun) => void;
}

const AFP_TABLE_PAGE_SIZE = 200;

export function AfpNativeInspector({ run, onRunUpdated }: AfpNativeInspectorProps) {
  const details = run.afpDetails;
  const [slotIdx, setSlotIdx] = useState(0);
  const [showDiffOverlay, setShowDiffOverlay] = useState(true);
  const [showPapyrusProxyUpload, setShowPapyrusProxyUpload] = useState(false);
  const [tlePage, setTlePage] = useState(0);
  const [resPage, setResPage] = useState(0);
  const [fieldPage, setFieldPage] = useState(0);

  const [papyrusBaseFile, setPapyrusBaseFile] = useState<File | null>(null);
  const [papyrusCandFile, setPapyrusCandFile] = useState<File | null>(null);
  const [papyrusVerInput, setPapyrusVerInput] = useState('ISIS Papyrus Viewer 7.8');
  const [uploadingProxy, setUploadingProxy] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);

  useEffect(() => {
    setSlotIdx(0);
    setTlePage(0);
    setResPage(0);
    setFieldPage(0);
  }, [run.id]);

  const { bVpMap, cVpMap, nonEqualBySlot, candTleMap, candResMap } = useMemo(() => {
    const bMap = new Map<number, AfpVisualPage>();
    const cMap = new Map<number, AfpVisualPage>();
    const dMap = new Map<number, typeof run.textDiffs>();
    const tMap = new Map<string, string>();
    const rMap = new Map<string, string>();

    if (details) {
      for (const p of details.baselineVisualPages || []) bMap.set(p.pageIndex, p);
      for (const p of details.candidateVisualPages || []) cMap.set(p.pageIndex, p);
      for (const ct of details.candidateTles) {
        tMap.set(`${ct.pageGroupIndex}:${ct.attributeName}`, ct.attributeValue);
      }
      for (const cr of details.candidateResources) {
        const key = `${cr.pageIndex}:${cr.type}`;
        if (!rMap.has(key)) rMap.set(key, cr.name);
      }
    }
    for (const d of run.textDiffs) {
      if (d.diffCategory === 'EQUAL') continue;
      const slotKey = d.slotIndex ?? 1;
      let arr = dMap.get(slotKey);
      if (!arr) {
        arr = [];
        dMap.set(slotKey, arr);
      }
      arr.push(d);
    }
    return { bVpMap: bMap, cVpMap: cMap, nonEqualBySlot: dMap, candTleMap: tMap, candResMap: rMap };
  }, [details, run.textDiffs]);

  if (!details) return null;

  const slots = run.alignedPages && run.alignedPages.length > 0
    ? run.alignedPages
    : [{
        slotIndex: 1,
        baselinePageNum: 1,
        candidatePageNum: 1,
        baselineBlank: false,
        candidateBlank: false,
        status: 'DIFF_DETECTED' as const,
        similarityScore: 1,
        diffCount: 0,
        summary: 'Page 1',
      }];
  const safeIdx = Math.min(slotIdx, slots.length - 1);
  const activeSlot = slots[safeIdx];
  const slotDiffs = nonEqualBySlot.get(activeSlot.slotIndex) || [];
  const bVp = activeSlot.baselinePageNum ? bVpMap.get(activeSlot.baselinePageNum) : undefined;
  const cVp = activeSlot.candidatePageNum ? cVpMap.get(activeSlot.candidatePageNum) : undefined;

  const totalTlePages = Math.max(1, Math.ceil(details.baselineTles.length / AFP_TABLE_PAGE_SIZE));
  const safeTlePage = Math.min(tlePage, totalTlePages - 1);
  const pagedTles = details.baselineTles.slice(safeTlePage * AFP_TABLE_PAGE_SIZE, (safeTlePage + 1) * AFP_TABLE_PAGE_SIZE);

  const totalResPages = Math.max(1, Math.ceil(details.baselineResources.length / AFP_TABLE_PAGE_SIZE));
  const safeResPage = Math.min(resPage, totalResPages - 1);
  const pagedResources = details.baselineResources.slice(safeResPage * AFP_TABLE_PAGE_SIZE, (safeResPage + 1) * AFP_TABLE_PAGE_SIZE);

  const maxFieldLen = Math.max(details.baselineFields.length, details.candidateFields.length);
  const totalFieldPages = Math.max(1, Math.ceil(maxFieldLen / AFP_TABLE_PAGE_SIZE));
  const safeFieldPage = Math.min(fieldPage, totalFieldPages - 1);

  const handleUploadPapyrusProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!papyrusBaseFile || !papyrusCandFile) {
      setProxyError('Select both Papyrus-exported IMDS PDF and DDGS PDF.');
      return;
    }
    setProxyError(null);
    setUploadingProxy(true);
    try {
      const fd = new FormData();
      fd.append('baselinePdf', papyrusBaseFile);
      fd.append('candidatePdf', papyrusCandFile);
      fd.append('papyrusVersion', papyrusVerInput);
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/papyrus-proxy`, {
        method: 'POST',
        body: fd,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onRunUpdated(data.run);
    } catch (err) {
      setProxyError(err instanceof Error ? err.message : 'Failed to attach Papyrus proxy');
    } finally {
      setUploadingProxy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Direct Native AFP Header Banner */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
              <Layers className="w-3.5 h-3.5" />
              <span>Direct Native AFP Validation · Zero PDF Conversion</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-600">{details.encodingDetected}</span>
            </div>
            <h2 className="text-sm font-semibold text-slate-900">
              MO:DCA Native Render (IOCA Logos, Code-39 Barcodes, Rules), EBCDIC TLEs, Medium Maps & PTOCA
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Rendered and validated directly on the native <code className="font-mono">.afp</code> byte stream—decoding inline IOCA/IM/Object-Container logos,
              rotated PTOCA/BCOCA barcodes, page segments (<code className="font-mono">IPS</code>), coded fonts (<code className="font-mono">MCF/MCF2</code>),
              and EBCDIC TLE mailroom index tags without lossy PDF conversion.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/artifact/baseline?download=1`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Open IMDS .afp in Papyrus
            </a>
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/artifact/candidate?download=1`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Open DDGS .afp in Papyrus
            </a>
          </div>
        </div>
      </div>

      {/* 1. Native MO:DCA Visual Render (No PDF Conversion) */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">
              Slot {activeSlot.slotIndex} of {slots.length}
            </span>
            <span className="text-slate-400">·</span>
            <span className="font-mono text-slate-600">
              IMDS {activeSlot.baselinePageNum ? `P${activeSlot.baselinePageNum}` : 'Absent'} ↔ DDGS {activeSlot.candidatePageNum ? `P${activeSlot.candidatePageNum}` : 'Missing'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showDiffOverlay}
                onChange={(e) => setShowDiffOverlay(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Show Diff Highlights (#1, #2…)</span>
            </label>

            {slots.length > 1 && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={safeIdx === 0}
                  onClick={() => setSlotIdx((v) => Math.max(0, v - 1))}
                  className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[11px] px-1.5 tabular-nums">
                  {safeIdx + 1}/{slots.length}
                </span>
                <button
                  type="button"
                  disabled={safeIdx >= slots.length - 1}
                  onClick={() => setSlotIdx((v) => Math.min(slots.length - 1, v + 1))}
                  className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 bg-slate-100">
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="font-semibold text-slate-800">IMDS Native MO:DCA Page Render</span>
              <span className="font-mono text-slate-500 tabular-nums">
                {bVp ? `${bVp.elements.length} visual element(s)` : `${details.baselinePtocaRuns.length} run(s)`}
              </span>
            </div>
            <div className="p-3 bg-slate-100 flex justify-center">
              <AfpVisualPageSvg
                vp={bVp}
                mediaAssets={details.mediaAssets}
                slotDiffs={slotDiffs}
                side="baseline"
                highlightBoth={showDiffOverlay}
                pageNum={activeSlot.baselinePageNum}
                isBlank={activeSlot.baselineBlank}
                otherPageMissing={activeSlot.candidatePageNum === null}
                scaleWidth={440}
              />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="font-semibold text-slate-800">DDGS Native MO:DCA Page Render</span>
              <span className="font-mono text-slate-500 tabular-nums">
                {cVp ? `${cVp.elements.length} visual element(s)` : `${details.candidatePtocaRuns.length} run(s)`}
              </span>
            </div>
            <div className="p-3 bg-slate-100 flex justify-center">
              <AfpVisualPageSvg
                vp={cVp}
                mediaAssets={details.mediaAssets}
                slotDiffs={slotDiffs}
                side="candidate"
                highlightBoth={showDiffOverlay}
                pageNum={activeSlot.candidatePageNum}
                isBlank={activeSlot.candidateBlank}
                otherPageMissing={activeSlot.baselinePageNum === null}
                scaleWidth={440}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
        <span className="font-medium text-slate-700">Native Highlight Legend (36 L-unit alignment tolerance):</span>
        {(['TEXT_CHANGE', 'ALIGNMENT_SHIFT', 'FONT_STYLE', 'MISSING_CONTENT', 'ADDED_CONTENT', 'CONTROL_METADATA'] as DiffCategory[]).map((cat) => {
          const meta = DIFF_COLOR_MAP[cat];
          return (
            <span key={cat} className="inline-flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${meta.swatchBg}`} />
              <span>{meta.shortLabel}</span>
            </span>
          );
        })}
      </div>

      {/* 2. TLE Index Tags & Resource/Medium Map Bindings Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* TLE Table */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-900">
            <span>Tagged Logical Elements — TLE (D3A090) Direct Comparison</span>
            {totalTlePages > 1 && (
              <div className="inline-flex items-center gap-1 font-normal">
                <button
                  type="button"
                  disabled={safeTlePage === 0}
                  onClick={() => setTlePage((p) => Math.max(0, p - 1))}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="font-mono text-[11px] tabular-nums">{safeTlePage + 1}/{totalTlePages}</span>
                <button
                  type="button"
                  disabled={safeTlePage >= totalTlePages - 1}
                  onClick={() => setTlePage((p) => Math.min(totalTlePages - 1, p + 1))}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 font-medium">Attribute</th>
                  <th className="px-3 py-2 font-medium">IMDS Baseline</th>
                  <th className="px-3 py-2 font-medium">DDGS Candidate</th>
                  <th className="px-3 py-2 font-medium">Parity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {details.baselineTles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 font-sans text-slate-500">
                      No TLE index records found in this AFP stream.
                    </td>
                  </tr>
                ) : (
                  pagedTles.map((bt, idx) => {
                    const candVal = candTleMap.get(`${bt.pageGroupIndex}:${bt.attributeName}`);
                    const matched = candVal !== undefined && candVal === bt.attributeValue;
                    const meta = DIFF_COLOR_MAP.CONTROL_METADATA;
                    return (
                      <tr key={idx} className={matched ? '' : meta.rowTintClass}>
                        <td className="px-3 py-2 text-slate-900 font-semibold">{bt.attributeName}</td>
                        <td className="px-3 py-2 text-slate-700">{bt.attributeValue}</td>
                        <td className="px-3 py-2 text-slate-700">{candVal || '(missing)'}</td>
                        <td className="px-3 py-2 font-sans">
                          <span className={matched ? 'text-emerald-700 font-medium' : 'text-amber-800 font-medium'}>
                            {matched ? 'Matched' : 'Control / TLE Drift'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resource & Print Control Bindings */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-900">
            <span>AFP Resource & Medium Map Bindings (IMM / MCF / MPO / BBC)</span>
            {totalResPages > 1 && (
              <div className="inline-flex items-center gap-1 font-normal">
                <button
                  type="button"
                  disabled={safeResPage === 0}
                  onClick={() => setResPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="font-mono text-[11px] tabular-nums">{safeResPage + 1}/{totalResPages}</span>
                <button
                  type="button"
                  disabled={safeResPage >= totalResPages - 1}
                  onClick={() => setResPage((p) => Math.min(totalResPages - 1, p + 1))}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 font-medium">Resource Type</th>
                  <th className="px-3 py-2 font-medium">IMDS Value</th>
                  <th className="px-3 py-2 font-medium">DDGS Value</th>
                  <th className="px-3 py-2 font-medium">Parity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {details.baselineResources.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 font-sans text-slate-500">
                      No resource binding records found.
                    </td>
                  </tr>
                ) : (
                  pagedResources.map((br, idx) => {
                    const candName = candResMap.get(`${br.pageIndex}:${br.type}`);
                    const matched = candName !== undefined && candName === br.name;
                    const meta = br.type.startsWith('FONT')
                      ? DIFF_COLOR_MAP.FONT_STYLE
                      : DIFF_COLOR_MAP.CONTROL_METADATA;
                    return (
                      <tr key={idx} className={matched ? '' : meta.rowTintClass}>
                        <td className="px-3 py-2 text-slate-900 font-semibold">{br.type}</td>
                        <td className="px-3 py-2 text-slate-700">{br.name}</td>
                        <td className="px-3 py-2 text-slate-700">{candName || '(omitted)'}</td>
                        <td className="px-3 py-2 font-sans">
                          <span className={matched ? 'text-emerald-700 font-medium' : 'text-amber-800 font-medium'}>
                            {matched ? 'Matched' : 'Drift'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 3. MO:DCA Structured Field Stream */}
      <div className="space-y-2">
        {totalFieldPages > 1 && (
          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2 text-xs">
            <span className="font-mono text-slate-600 tabular-nums">
              Structured field window {(safeFieldPage * AFP_TABLE_PAGE_SIZE + 1).toLocaleString()}–
              {((safeFieldPage + 1) * AFP_TABLE_PAGE_SIZE).toLocaleString()}
            </span>
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                disabled={safeFieldPage === 0}
                onClick={() => setFieldPage((p) => Math.max(0, p - 1))}
                className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                Prev
              </button>
              <span className="font-mono text-[11px] tabular-nums">{safeFieldPage + 1}/{totalFieldPages}</span>
              <button
                type="button"
                disabled={safeFieldPage >= totalFieldPages - 1}
                onClick={() => setFieldPage((p) => Math.min(totalFieldPages - 1, p + 1))}
                className="rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[
            {
              title: 'IMDS MO:DCA Structured Fields',
              fields: details.baselineFields,
              totalCount: details.baselineTotalFieldCount ?? details.baselineFields.length,
            },
            {
              title: 'DDGS MO:DCA Structured Fields',
              fields: details.candidateFields,
              totalCount: details.candidateTotalFieldCount ?? details.candidateFields.length,
            },
          ].map((side, sIdx) => {
            const slice = side.fields.slice(
              safeFieldPage * AFP_TABLE_PAGE_SIZE,
              (safeFieldPage + 1) * AFP_TABLE_PAGE_SIZE
            );
            return (
              <div key={sIdx} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800">
                  {side.title} ({side.totalCount.toLocaleString()} records
                  {side.totalCount > side.fields.length ? `, first ${side.fields.length.toLocaleString()} shown` : ''})
                </div>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-medium">Offset</th>
                        <th className="px-3 py-2 font-medium">SFID</th>
                        <th className="px-3 py-2 font-medium">Mnemonic</th>
                        <th className="px-3 py-2 font-medium">Decoded Payload</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {slice.map((f, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-1.5 text-slate-500 tabular-nums">
                            0x{f.offset.toString(16).padStart(4, '0')}
                          </td>
                          <td className="px-3 py-1.5 text-slate-600">{f.sfidHex}</td>
                          <td className="px-3 py-1.5 font-semibold text-slate-900">
                            {f.mnemonic}
                            <span className="font-sans font-normal text-slate-500 ml-1.5">
                              ({f.description})
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-700 break-all">
                            {f.textPreview || <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional Papyrus PDF Proxy Fallback (Collapsed by default) */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Optional Papyrus Visual Proxy: </span>
            Direct native AFP checks above avoid PDF conversion issues. Only attach Papyrus-exported PDFs if you need pixel-heatmap verification of external raster overlays.
          </div>
          <button
            type="button"
            onClick={() => setShowPapyrusProxyUpload((v) => !v)}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 ml-4"
          >
            {showPapyrusProxyUpload ? 'Hide Proxy Upload' : 'Attach Papyrus PDF Proxy'}
          </button>
        </div>

        {showPapyrusProxyUpload && (
          <form
            onSubmit={handleUploadPapyrusProxy}
            className="pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Papyrus Exported IMDS PDF
              </label>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setPapyrusBaseFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:px-2.5 file:py-1 file:text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Papyrus Exported DDGS PDF
              </label>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setPapyrusCandFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:px-2.5 file:py-1 file:text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Papyrus Version
              </label>
              <input
                type="text"
                value={papyrusVerInput}
                onChange={(e) => setPapyrusVerInput(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={uploadingProxy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {uploadingProxy ? 'Attaching...' : 'Attach Proxy'}
              </button>
            </div>
            {proxyError && <p className="text-xs text-red-700 md:col-span-4">{proxyError}</p>}
          </form>
        )}

        {details.papyrusExportAttached && (
          <PdfVisualDiff
            baselineUrl={`/api/runs/${encodeURIComponent(run.id)}/artifact/papyrus-baseline`}
            candidateUrl={`/api/runs/${encodeURIComponent(run.id)}/artifact/papyrus-candidate`}
            tolerancePct={0.5}
            disclaimer={details.conversionDisclaimer}
          />
        )}
      </div>
    </div>
  );
}
