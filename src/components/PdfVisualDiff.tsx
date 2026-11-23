import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Eye, Layers } from 'lucide-react';
import type { DiffCategory, PdfLineLayout, TextDiffLine } from '../types/qe';
import { DIFF_COLOR_MAP } from '../lib/diffColors';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PdfVisualDiffProps {
  baselineUrl: string;
  candidateUrl: string;
  tolerancePct: number;
  disclaimer?: string;
  pdfDetails?: {
    baselineLayouts: PdfLineLayout[];
    candidateLayouts: PdfLineLayout[];
  };
  textDiffs?: TextDiffLine[];
  initialPage?: number;
}

export function PdfVisualDiff({
  baselineUrl,
  candidateUrl,
  tolerancePct,
  disclaimer,
  pdfDetails,
  textDiffs,
  initialPage = 1,
}: PdfVisualDiffProps) {
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const [sensitivity, setSensitivity] = useState(28);
  const [showSemanticBoxes, setShowSemanticBoxes] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [renderingPage, setRenderingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<{
    baseDoc: pdfjsLib.PDFDocumentProxy | null;
    candDoc: pdfjsLib.PDFDocumentProxy | null;
  }>({ baseDoc: null, candDoc: null });
  const [diffStats, setDiffStats] = useState<{
    changedPixels: number;
    totalPixels: number;
    pct: number;
    baseDims: string;
    candDims: string;
  } | null>(null);

  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const candCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setPageNumber(initialPage);
  }, [initialPage]);

  useEffect(() => {
    let cancelled = false;
    let loadedBase: pdfjsLib.PDFDocumentProxy | null = null;
    let loadedCand: pdfjsLib.PDFDocumentProxy | null = null;

    async function loadDocuments() {
      setLoadingDocs(true);
      setError(null);
      try {
        const [baseRes, candRes] = await Promise.all([
          fetch(baselineUrl),
          fetch(candidateUrl),
        ]);
        if (!baseRes.ok || !candRes.ok) {
          throw new Error('Unable to load PDF binary streams for visual canvas rendering.');
        }

        const [baseBuf, candBuf] = await Promise.all([
          baseRes.arrayBuffer(),
          candRes.arrayBuffer(),
        ]);

        const [bPdf, cPdf] = await Promise.all([
          pdfjsLib.getDocument({ data: new Uint8Array(baseBuf) }).promise,
          pdfjsLib.getDocument({ data: new Uint8Array(candBuf) }).promise,
        ]);

        if (cancelled) {
          bPdf.loadingTask.destroy().catch(() => {});
          cPdf.loadingTask.destroy().catch(() => {});
          return;
        }
        loadedBase = bPdf;
        loadedCand = cPdf;
        const maxP = Math.max(bPdf.numPages, cPdf.numPages);
        setTotalPages(maxP);
        setDocs({ baseDoc: bPdf, candDoc: cPdf });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load PDF documents.');
        }
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    }

    loadDocuments();
    return () => {
      cancelled = true;
      loadedBase?.loadingTask.destroy().catch(() => {});
      loadedCand?.loadingTask.destroy().catch(() => {});
    };
  }, [baselineUrl, candidateUrl]);

  useEffect(() => {
    const { baseDoc, candDoc } = docs;
    if (!baseDoc || !candDoc) return;

    let cancelled = false;

    async function renderAndDiff() {
      setRenderingPage(true);

      try {
        const maxP = Math.max(baseDoc!.numPages, candDoc!.numPages);
        const safePage = Math.min(pageNumber, maxP);

        const renderPage = async (
          doc: pdfjsLib.PDFDocumentProxy,
          pNum: number,
          canvas: HTMLCanvasElement
        ) => {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return { width: 0, height: 0, ptDims: 'N/A', viewport: null as pdfjsLib.PageViewport | null, scale: 1 };

          if (pNum > doc.numPages) {
            canvas.width = 450;
            canvas.height = 580;
            ctx.fillStyle = '#fef2f2';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#991b1b';
            ctx.font = '14px sans-serif';
            ctx.fillText(`Page ${pNum} missing in this document`, 24, 48);
            return { width: canvas.width, height: canvas.height, ptDims: 'Missing page', viewport: null, scale: 1 };
          }

          const page = await doc.getPage(pNum);
          try {
            const unscaled = page.getViewport({ scale: 1 });
            const targetWidth = 420;
            const scale = targetWidth / unscaled.width;
            const viewport = page.getViewport({ scale });

            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport, canvas }).promise;
            return {
              width: canvas.width,
              height: canvas.height,
              ptDims: `${Math.round(unscaled.width)} x ${Math.round(unscaled.height)} pt`,
              viewport,
              scale,
            };
          } finally {
            page.cleanup();
          }
        };

        const baseCanvas = baseCanvasRef.current;
        const candCanvas = candCanvasRef.current;
        const diffCanvas = diffCanvasRef.current;
        if (!baseCanvas || !candCanvas || !diffCanvas) return;

        const [bInfo, cInfo] = await Promise.all([
          renderPage(baseDoc!, safePage, baseCanvas),
          renderPage(candDoc!, safePage, candCanvas),
        ]);

        if (cancelled) return;

        const w = Math.max(bInfo.width, cInfo.width);
        const h = Math.max(bInfo.height, cInfo.height);
        diffCanvas.width = w;
        diffCanvas.height = h;

        const bCtx = baseCanvas.getContext('2d', { willReadFrequently: true })!;
        const cCtx = candCanvas.getContext('2d', { willReadFrequently: true })!;
        const dCtx = diffCanvas.getContext('2d', { willReadFrequently: true })!;

        const bData = bCtx.getImageData(0, 0, bInfo.width, bInfo.height);
        const cData = cCtx.getImageData(0, 0, cInfo.width, cInfo.height);
        const outImg = dCtx.createImageData(w, h);

        let changedPixels = 0;
        const totalPixels = w * h;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const outIdx = (y * w + x) * 4;
            const inB = x < bInfo.width && y < bInfo.height;
            const inC = x < cInfo.width && y < cInfo.height;

            const bIdx = (y * bInfo.width + x) * 4;
            const cIdx = (y * cInfo.width + x) * 4;

            const r1 = inB ? bData.data[bIdx] : 255;
            const g1 = inB ? bData.data[bIdx + 1] : 255;
            const b1 = inB ? bData.data[bIdx + 2] : 255;

            const r2 = inC ? cData.data[cIdx] : 255;
            const g2 = inC ? cData.data[cIdx + 1] : 255;
            const b2 = inC ? cData.data[cIdx + 2] : 255;

            const delta = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            if (delta > sensitivity) {
              changedPixels++;
              outImg.data[outIdx] = 220;
              outImg.data[outIdx + 1] = 38;
              outImg.data[outIdx + 2] = 38;
              outImg.data[outIdx + 3] = 235;
            } else {
              const lum = Math.round(0.299 * r1 + 0.587 * g1 + 0.114 * b1);
              const faded = Math.min(255, Math.round(lum * 0.25 + 190));
              outImg.data[outIdx] = faded;
              outImg.data[outIdx + 1] = faded;
              outImg.data[outIdx + 2] = faded;
              outImg.data[outIdx + 3] = 255;
            }
          }
        }

        dCtx.putImageData(outImg, 0, 0);

        // Draw semantic color-coded bounding boxes AFTER pixel diff calculation so stats stay pure
        if (showSemanticBoxes && pdfDetails && textDiffs && cInfo.viewport) {
          const pageDiffs = textDiffs.filter(
            (d) =>
              d.diffCategory !== 'EQUAL' &&
              d.pageOrSection === `Page ${safePage}`
          );
          const candLayouts = pdfDetails.candidateLayouts.filter((l) => l.page === safePage);
          const baseLayouts = pdfDetails.baselineLayouts.filter((l) => l.page === safePage);

          const drawBox = (
            ctx: CanvasRenderingContext2D,
            viewport: pdfjsLib.PageViewport,
            scale: number,
            layout: PdfLineLayout,
            category: DiffCategory
          ) => {
            const meta = DIFF_COLOR_MAP[category];
            const [vx, vy] = viewport.convertToViewportPoint(layout.x, layout.y);
            const boxH = Math.max(layout.fontSize * scale, layout.height * scale, 10) + 4;
            const boxW = Math.max(layout.width * scale, 40) + 6;
            const bx = vx - 3;
            const by = vy - boxH + 3;

            ctx.save();
            ctx.fillStyle = meta.hexFill;
            ctx.fillRect(bx, by, boxW, boxH);
            ctx.strokeStyle = meta.hexStroke;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(bx, by, boxW, boxH);

            // Small category tag at top-right of box
            const tagText = meta.shortLabel;
            ctx.font = '600 9px sans-serif';
            const tagW = ctx.measureText(tagText).width + 8;
            ctx.fillStyle = meta.hexStroke;
            ctx.fillRect(bx, Math.max(0, by - 13), tagW, 13);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tagText, bx + 4, Math.max(10, by - 3));
            ctx.restore();
          };

          for (const d of pageDiffs) {
            if (d.candidateLineNum !== null) {
              const layout = candLayouts[d.candidateLineNum - 1];
              if (layout) {
                drawBox(cCtx, cInfo.viewport, cInfo.scale, layout, d.diffCategory);
                drawBox(dCtx, cInfo.viewport, cInfo.scale, layout, d.diffCategory);
              }
            } else if (d.baselineLineNum !== null && bInfo.viewport) {
              const layout = baseLayouts[d.baselineLineNum - 1];
              if (layout) {
                drawBox(bCtx, bInfo.viewport, bInfo.scale, layout, d.diffCategory);
              }
            }
          }
        }

        setDiffStats({
          changedPixels,
          totalPixels,
          pct: totalPixels > 0 ? (changedPixels / totalPixels) * 100 : 0,
          baseDims: bInfo.ptDims,
          candDims: cInfo.ptDims,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF rendering failed.');
        }
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    }

    renderAndDiff();
    return () => {
      cancelled = true;
    };
  }, [docs, pageNumber, sensitivity, showSemanticBoxes, pdfDetails, textDiffs]);

  const loading = loadingDocs || renderingPage;

  const exceedsTolerance = diffStats ? diffStats.pct > tolerancePct : false;

  return (
    <div className="space-y-4">
      {disclaimer && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <span className="font-semibold">Provenance Notice: </span>
          {disclaimer}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev Page
          </button>
          <span className="text-xs font-mono tabular-nums text-slate-700">
            Page {pageNumber} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPageNumber((p) => Math.min(totalPages, p + 1))}
            disabled={pageNumber >= totalPages}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            Next Page
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600">
          {pdfDetails && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showSemanticBoxes}
                onChange={(e) => setShowSemanticBoxes(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Color-Coded Bounding Boxes</span>
            </label>
          )}

          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap">Pixel Delta Sensitivity</span>
            <input
              type="range"
              min={8}
              max={90}
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value))}
              className="w-24 accent-blue-700"
            />
            <span className="font-mono tabular-nums w-8 text-right">{sensitivity}</span>
          </label>

          {diffStats && (
            <div className="flex items-center gap-2 font-mono tabular-nums">
              <span className="text-slate-500">Visual Variance:</span>
              <span className={exceedsTolerance ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>
                {diffStats.pct.toFixed(3)}%
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">Tolerance {tolerancePct.toFixed(2)}%</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-800">IMDS Baseline (OpenText DCP)</span>
            <span className="font-mono text-slate-500 tabular-nums">{diffStats?.baseDims || 'Loading...'}</span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center min-h-[380px]">
            <canvas ref={baseCanvasRef} className="max-w-full h-auto shadow-sm border border-slate-200 bg-white" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-800">DDGS Candidate (SmartComm)</span>
            <span className="font-mono text-slate-500 tabular-nums">{diffStats?.candDims || 'Loading...'}</span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center min-h-[380px]">
            <canvas ref={candCanvasRef} className="max-w-full h-auto shadow-sm border border-slate-200 bg-white" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
              <Layers className="w-3.5 h-3.5 text-red-600" />
              Pixel Diff + Category Overlay
            </span>
            <span className="font-mono text-slate-500 tabular-nums">
              {loading ? 'Rendering...' : `${diffStats?.changedPixels.toLocaleString() ?? 0} px delta`}
            </span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center min-h-[380px]">
            <canvas ref={diffCanvasRef} className="max-w-full h-auto shadow-sm border border-slate-200 bg-white" />
          </div>
        </div>
      </div>

      {/* Color Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 rounded-md border border-slate-200 bg-white px-4 py-2.5">
        <Eye className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <span className="font-medium text-slate-700">Overlay Color Legend:</span>
        {(['TEXT_CHANGE', 'ALIGNMENT_SHIFT', 'FONT_STYLE', 'MISSING_CONTENT', 'ADDED_CONTENT'] as DiffCategory[]).map(
          (cat) => {
            const meta = DIFF_COLOR_MAP[cat];
            return (
              <span key={cat} className="inline-flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-sm ${meta.swatchBg}`} />
                <span>{meta.shortLabel}</span>
              </span>
            );
          }
        )}
      </div>
    </div>
  );
}

