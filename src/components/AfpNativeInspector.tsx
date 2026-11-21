import { useEffect, useRef, useState } from 'react';
import { Download, Layers, Upload } from 'lucide-react';
import type { ComparisonRun, DiffCategory } from '../types/qe';
import { DIFF_COLOR_MAP } from '../lib/diffColors';
import { PdfVisualDiff } from './PdfVisualDiff';

interface AfpNativeInspectorProps {
  run: ComparisonRun;
  onRunUpdated: (updated: ComparisonRun) => void;
}

export function AfpNativeInspector({ run, onRunUpdated }: AfpNativeInspectorProps) {
  const details = run.afpDetails;
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const candCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showPapyrusProxyUpload, setShowPapyrusProxyUpload] = useState(false);

  const [papyrusBaseFile, setPapyrusBaseFile] = useState<File | null>(null);
  const [papyrusCandFile, setPapyrusCandFile] = useState<File | null>(null);
  const [papyrusVerInput, setPapyrusVerInput] = useState('ISIS Papyrus Viewer 7.8');
  const [uploadingProxy, setUploadingProxy] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);

  useEffect(() => {
    if (!details) return;

    const drawPtocaWireframe = (
      canvas: HTMLCanvasElement | null,
      runs: typeof details.baselinePtocaRuns,
      compareAgainst: typeof details.baselinePtocaRuns,
      geo: typeof details.baselineGeometry[0] | undefined,
      isCandidate: boolean
    ) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const pageW = geo?.widthUnits || 2040;
      const pageH = geo?.heightUnits || 2640;
      const w = 440;
      const h = Math.round((pageH / pageW) * w);
      canvas.width = w;
      canvas.height = h;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      // Subtle 1-inch coordinate grid (240 L-units)
      const dpi = geo?.xdpi || 240;
      const stepX = (dpi / pageW) * w;
      const stepY = (dpi / pageH) * h;
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = 1;
      for (let gx = stepX; gx < w; gx += stepX) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = stepY; gy < h; gy += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Draw PTOCA text runs directly at native AMI/AMB coordinates with color-coded diff categories
      runs.forEach((r, idx) => {
        const px = Math.max(8, Math.min(w - 20, (r.x / pageW) * w));
        const py = Math.max(18, Math.min(h - 12, (r.y / pageH) * h));
        const partner = compareAgainst[idx];
        const textDiff = !partner || r.text !== partner.text;
        const posDiff = partner && (Math.abs(r.x - partner.x) > 15 || Math.abs(r.y - partner.y) > 15);
        const fontDiff = partner && r.fontLocalId !== partner.fontLocalId;

        let diffCat: DiffCategory = 'EQUAL';
        if (!partner) diffCat = isCandidate ? 'ADDED_CONTENT' : 'MISSING_CONTENT';
        else if (textDiff) diffCat = 'TEXT_CHANGE';
        else if (posDiff) diffCat = 'ALIGNMENT_SHIFT';
        else if (fontDiff) diffCat = 'FONT_STYLE';

        const meta = DIFF_COLOR_MAP[diffCat];

        if (diffCat !== 'EQUAL' && isCandidate) {
          ctx.fillStyle = meta.hexFill;
          ctx.fillRect(px - 4, py - 12, w - px - 12, 18);
          ctx.strokeStyle = meta.hexStroke;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(px - 4, py - 12, w - px - 12, 18);

          // Category tag
          const tagParts: string[] = [];
          if (textDiff) tagParts.push('Text');
          if (posDiff) tagParts.push('Y/X Shift');
          if (fontDiff) tagParts.push('Font');
          const tagLabel = tagParts.join(' + ') || meta.shortLabel;
          ctx.font = '600 8px sans-serif';
          const tagW = ctx.measureText(tagLabel).width + 6;
          ctx.fillStyle = meta.hexStroke;
          ctx.fillRect(w - 16 - tagW, py - 12, tagW, 12);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(tagLabel, w - 13 - tagW, py - 3);
        }

        // Coordinate crosshair marker
        ctx.fillStyle = diffCat !== 'EQUAL' && isCandidate ? meta.hexStroke : '#1d4ed8';
        ctx.fillRect(px - 2, py - 2, 4, 4);

        ctx.fillStyle = '#0f172a';
        ctx.font = r.fontLocalId >= 2 ? '600 10px monospace' : '400 10px monospace';
        ctx.fillText(r.text, px + 6, py + 3);
      });
    };

    drawPtocaWireframe(
      baseCanvasRef.current,
      details.baselinePtocaRuns,
      details.candidatePtocaRuns,
      details.baselineGeometry[0],
      false
    );
    drawPtocaWireframe(
      candCanvasRef.current,
      details.candidatePtocaRuns,
      details.baselinePtocaRuns,
      details.candidateGeometry[0],
      true
    );
  }, [details]);

  if (!details) return null;

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
      const data = await res.json();
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
              MO:DCA Binary, EBCDIC TLEs, Medium Maps (IMM), Resources & PTOCA Coordinates
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Validated directly on the native <code className="font-mono">.afp</code> byte stream without PDF conversion—preserving
              mailroom TLE index tags, duplex/tray Medium Maps (<code className="font-mono">IMM</code>), coded fonts (<code className="font-mono">MCF</code>),
              overlays (<code className="font-mono">MPO</code>), and PTOCA X/Y positioning (<code className="font-mono">AMI/AMB</code>). Open source <code className="font-mono">.afp</code> files in <strong>ISIS Papyrus</strong> only for external FOCA/OVL artwork confirmation.
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

      {/* 1. Direct PTOCA X/Y Coordinate Spatial Wireframe (No PDF Conversion) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
            <span className="font-semibold text-slate-800">IMDS Native PTOCA Coordinate Plot</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {details.baselinePtocaRuns.length} text run(s)
            </span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center">
            <canvas ref={baseCanvasRef} className="max-w-full h-auto border border-slate-200 bg-white shadow-sm" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
            <span className="font-semibold text-slate-800">DDGS Native PTOCA Coordinate Plot (Deltas Highlighted)</span>
            <span className="font-mono text-slate-500 tabular-nums">
              {details.candidatePtocaRuns.length} text run(s)
            </span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center">
            <canvas ref={candCanvasRef} className="max-w-full h-auto border border-slate-200 bg-white shadow-sm" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
        <span className="font-medium text-slate-700">PTOCA Plot Color Legend:</span>
        {(['TEXT_CHANGE', 'ALIGNMENT_SHIFT', 'FONT_STYLE', 'CONTROL_METADATA'] as DiffCategory[]).map((cat) => {
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
          <div className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-900">
            Tagged Logical Elements — TLE (D3A090) Direct Comparison
          </div>
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
                details.baselineTles.map((bt, idx) => {
                  const ct = details.candidateTles.find(
                    (c) => c.pageGroupIndex === bt.pageGroupIndex && c.attributeName === bt.attributeName
                  );
                  const matched = ct && ct.attributeValue === bt.attributeValue;
                  const meta = DIFF_COLOR_MAP.CONTROL_METADATA;
                  return (
                    <tr key={idx} className={matched ? '' : meta.rowTintClass}>
                      <td className="px-3 py-2 text-slate-900 font-semibold">{bt.attributeName}</td>
                      <td className="px-3 py-2 text-slate-700">{bt.attributeValue}</td>
                      <td className="px-3 py-2 text-slate-700">{ct?.attributeValue || '(missing)'}</td>
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

        {/* Resource & Print Control Bindings */}
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-900">
            AFP Resource & Medium Map Bindings (IMM / MCF / MPO / BBC)
          </div>
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
                details.baselineResources.map((br, idx) => {
                  const cr = details.candidateResources.find(
                    (c) => c.pageIndex === br.pageIndex && c.type === br.type
                  );
                  const matched = cr && cr.name === br.name;
                  const meta = br.type.startsWith('FONT')
                    ? DIFF_COLOR_MAP.FONT_STYLE
                    : DIFF_COLOR_MAP.CONTROL_METADATA;
                  return (
                    <tr key={idx} className={matched ? '' : meta.rowTintClass}>
                      <td className="px-3 py-2 text-slate-900 font-semibold">{br.type}</td>
                      <td className="px-3 py-2 text-slate-700">{br.name}</td>
                      <td className="px-3 py-2 text-slate-700">{cr?.name || '(omitted)'}</td>
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

      {/* 3. MO:DCA Structured Field Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: 'IMDS MO:DCA Structured Fields', fields: details.baselineFields },
          { title: 'DDGS MO:DCA Structured Fields', fields: details.candidateFields },
        ].map((side, sIdx) => (
          <div key={sIdx} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800">
              {side.title} ({side.fields.length} records)
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
                  {side.fields.map((f, idx) => (
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
        ))}
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
