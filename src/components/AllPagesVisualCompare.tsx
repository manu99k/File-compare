import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Columns2, Download, Eye, FileText, Layers } from 'lucide-react';
import type {
  AlignedPageSlot,
  ComparisonRun,
  DiffCategory,
  InlineToken,
  PdfLineLayout,
  TextDiffLine,
} from '../types/qe';
import { DIFF_CATEGORY_ORDER, DIFF_COLOR_MAP } from '../lib/diffColors';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface AllPagesVisualCompareProps {
  run: ComparisonRun;
}

function renderTokenPreview(tokens: InlineToken[] | undefined, fallback: string, cat: DiffCategory) {
  const meta = DIFF_COLOR_MAP[cat];
  if (!tokens || tokens.length === 0) {
    return fallback ? <span>{fallback}</span> : <span className="text-slate-400 italic">(absent)</span>;
  }
  return (
    <>
      {tokens.map((t, idx) =>
        t.changed ? (
          <mark key={idx} className={meta.tokenHighlightClass}>
            {t.text}
          </mark>
        ) : (
          <span key={idx}>{t.text}</span>
        )
      )}
    </>
  );
}

interface PdfSlotRowProps {
  slot: AlignedPageSlot;
  slotDiffs: TextDiffLine[];
  baseDoc: pdfjsLib.PDFDocumentProxy | null;
  candDoc: pdfjsLib.PDFDocumentProxy | null;
  pdfDetails?: ComparisonRun['pdfDetails'];
  highlightBoth: boolean;
  showHeatmap: boolean;
  scaleWidth: number;
}

function PdfSlotVisualRow({
  slot,
  slotDiffs,
  baseDoc,
  candDoc,
  pdfDetails,
  highlightBoth,
  showHeatmap,
  scaleWidth,
}: PdfSlotRowProps) {
  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dstCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dimsLabel, setDimsLabel] = useState<{ src: string; dst: string; pct: string | null }>({
    src: slot.baselinePageNum ? 'Rendering...' : 'Absent',
    dst: slot.candidatePageNum ? 'Rendering...' : 'Missing',
    pct: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function drawSlot() {
      const drawPdfPage = async (
        doc: pdfjsLib.PDFDocumentProxy | null,
        pageNum: number | null,
        canvas: HTMLCanvasElement | null,
        isBlank: boolean,
        missingSide: 'source' | 'destination'
      ) => {
        if (!canvas) return { w: scaleWidth, h: Math.round(scaleWidth * 1.29), viewport: null as pdfjsLib.PageViewport | null, scale: 1, ptLabel: 'N/A' };
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return { w: scaleWidth, h: Math.round(scaleWidth * 1.29), viewport: null, scale: 1, ptLabel: 'N/A' };

        if (pageNum === null || !doc || pageNum > doc.numPages) {
          const w = scaleWidth;
          const h = Math.round(scaleWidth * 1.294);
          canvas.width = w;
          canvas.height = h;

          const isAdded = missingSide === 'source';
          const stroke = isAdded ? DIFF_COLOR_MAP.ADDED_CONTENT.hexStroke : DIFF_COLOR_MAP.MISSING_CONTENT.hexStroke;
          const bg = isAdded ? '#F0FDFA' : '#FFF1F2';

          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2;
          ctx.strokeRect(10, 10, w - 20, h - 20);
          ctx.restore();

          ctx.fillStyle = stroke;
          ctx.font = '700 13px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            isAdded ? 'NO CORRESPONDING PAGE IN SOURCE FILE' : 'PAGE MISSING IN DESTINATION FILE',
            w / 2,
            h / 2 - 14
          );

          ctx.fillStyle = '#334155';
          ctx.font = '400 11px sans-serif';
          const detailLine = isAdded
            ? slot.candidateBlank
              ? `Dest Page ${slot.candidatePageNum} is an inserted white/blank page.`
              : `Dest Page ${slot.candidatePageNum} was inserted at this slot.`
            : `Source Page ${slot.baselinePageNum} was omitted here.`;
          ctx.fillText(detailLine, w / 2, h / 2 + 8);
          ctx.fillStyle = '#64748B';
          ctx.font = '400 10.5px sans-serif';
          ctx.fillText('Subsequent pages remain aligned side-by-side.', w / 2, h / 2 + 28);
          ctx.textAlign = 'left';

          return { w, h, viewport: null, scale: 1, ptLabel: isAdded ? 'No page in Source' : 'Missing in Dest' };
        }

        const page = await doc.getPage(pageNum);
        const unscaled = page.getViewport({ scale: 1 });
        const scale = scaleWidth / unscaled.width;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        if (isBlank && slot.baselinePageNum === null) {
          // Highlight the inserted blank white page clearly on Destination canvas
          ctx.save();
          ctx.strokeStyle = DIFF_COLOR_MAP.ADDED_CONTENT.hexStroke;
          ctx.lineWidth = 3;
          ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);

          ctx.fillStyle = 'rgba(204, 251, 241, 0.9)';
          ctx.fillRect(28, canvas.height / 2 - 34, canvas.width - 56, 68);
          ctx.strokeStyle = DIFF_COLOR_MAP.ADDED_CONTENT.hexStroke;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(28, canvas.height / 2 - 34, canvas.width - 56, 68);

          ctx.fillStyle = '#0F766E';
          ctx.font = '700 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`INSERTED WHITE / BLANK PAGE (DEST PAGE ${pageNum})`, canvas.width / 2, canvas.height / 2 - 6);
          ctx.fillStyle = '#1E293B';
          ctx.font = '400 10.5px sans-serif';
          ctx.fillText('No matching white page exists in Source File.', canvas.width / 2, canvas.height / 2 + 14);
          ctx.textAlign = 'left';
          ctx.restore();
        }

        return {
          w: canvas.width,
          h: canvas.height,
          viewport,
          scale,
          ptLabel: `${Math.round(unscaled.width)}×${Math.round(unscaled.height)} pt`,
        };
      };

      const [bInfo, cInfo] = await Promise.all([
        drawPdfPage(baseDoc, slot.baselinePageNum, srcCanvasRef.current, slot.baselineBlank, 'source'),
        drawPdfPage(candDoc, slot.candidatePageNum, dstCanvasRef.current, slot.candidateBlank, 'destination'),
      ]);

      if (cancelled) return;

      let pctStr: string | null = null;

      // Pixel heatmap computation when both pages exist
      if (showHeatmap && diffCanvasRef.current && srcCanvasRef.current && dstCanvasRef.current) {
        const dCanvas = diffCanvasRef.current;
        const w = Math.max(bInfo.w, cInfo.w);
        const h = Math.max(bInfo.h, cInfo.h);
        dCanvas.width = w;
        dCanvas.height = h;
        const dCtx = dCanvas.getContext('2d', { willReadFrequently: true });

        if (dCtx && slot.baselinePageNum !== null && slot.candidatePageNum !== null) {
          const bCtx = srcCanvasRef.current.getContext('2d', { willReadFrequently: true })!;
          const cCtx = dstCanvasRef.current.getContext('2d', { willReadFrequently: true })!;
          const bData = bCtx.getImageData(0, 0, bInfo.w, bInfo.h);
          const cData = cCtx.getImageData(0, 0, cInfo.w, cInfo.h);
          const outImg = dCtx.createImageData(w, h);
          let changedPx = 0;

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const outIdx = (y * w + x) * 4;
              const inB = x < bInfo.w && y < bInfo.h;
              const inC = x < cInfo.w && y < cInfo.h;
              const bIdx = (y * bInfo.w + x) * 4;
              const cIdx = (y * cInfo.w + x) * 4;

              const r1 = inB ? bData.data[bIdx] : 255;
              const g1 = inB ? bData.data[bIdx + 1] : 255;
              const b1 = inB ? bData.data[bIdx + 2] : 255;
              const r2 = inC ? cData.data[cIdx] : 255;
              const g2 = inC ? cData.data[cIdx + 1] : 255;
              const b2 = inC ? cData.data[cIdx + 2] : 255;

              const delta = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
              if (delta > 28) {
                changedPx++;
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
          pctStr = `${((changedPx / (w * h)) * 100).toFixed(2)}%`;
        } else if (dCtx) {
          dCtx.fillStyle = '#F8FAFC';
          dCtx.fillRect(0, 0, w, h);
          dCtx.fillStyle = '#475569';
          dCtx.font = '600 11px sans-serif';
          dCtx.textAlign = 'center';
          dCtx.fillText('Page Count Offset Slot', w / 2, h / 2 - 6);
          dCtx.font = '400 10px sans-serif';
          dCtx.fillText(slot.status.replace(/_/g, ' '), w / 2, h / 2 + 12);
          dCtx.textAlign = 'left';
        }
      }

      // Draw color-coded semantic bounding boxes directly on BOTH Source & Destination canvases
      if (highlightBoth && pdfDetails) {
        const drawOverlayBox = (
          canvas: HTMLCanvasElement | null,
          viewport: pdfjsLib.PageViewport | null,
          scale: number,
          layout: PdfLineLayout,
          cat: DiffCategory
        ) => {
          if (!canvas || !viewport) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const meta = DIFF_COLOR_MAP[cat];
          const [vx, vy] = viewport.convertToViewportPoint(layout.x, layout.y);
          const boxH = Math.max(layout.fontSize * scale, layout.height * scale, 10) + 4;
          const boxW = Math.max(layout.width * scale, 48) + 6;
          const bx = vx - 3;
          const by = vy - boxH + 3;

          ctx.save();
          ctx.fillStyle = meta.hexFill;
          ctx.fillRect(bx, by, boxW, boxH);
          ctx.strokeStyle = meta.hexStroke;
          ctx.lineWidth = 1.6;
          ctx.strokeRect(bx, by, boxW, boxH);

          const tagText = meta.shortLabel;
          ctx.font = '600 8.5px sans-serif';
          const tagW = ctx.measureText(tagText).width + 8;
          ctx.fillStyle = meta.hexStroke;
          ctx.fillRect(bx, Math.max(0, by - 12), tagW, 12);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(tagText, bx + 4, Math.max(9, by - 3));
          ctx.restore();
        };

        const bLayouts = slot.baselinePageNum
          ? pdfDetails.baselineLayouts.filter((l) => l.page === slot.baselinePageNum)
          : [];
        const cLayouts = slot.candidatePageNum
          ? pdfDetails.candidateLayouts.filter((l) => l.page === slot.candidatePageNum)
          : [];

        for (const d of slotDiffs) {
          if (d.baselineLineNum !== null && bLayouts[d.baselineLineNum - 1]) {
            drawOverlayBox(
              srcCanvasRef.current,
              bInfo.viewport,
              bInfo.scale,
              bLayouts[d.baselineLineNum - 1],
              d.diffCategory
            );
          }
          if (d.candidateLineNum !== null && cLayouts[d.candidateLineNum - 1]) {
            drawOverlayBox(
              dstCanvasRef.current,
              cInfo.viewport,
              cInfo.scale,
              cLayouts[d.candidateLineNum - 1],
              d.diffCategory
            );
          }
        }
      }

      setDimsLabel({ src: bInfo.ptLabel, dst: cInfo.ptLabel, pct: pctStr });
    }

    drawSlot();
    return () => {
      cancelled = true;
    };
  }, [slot, slotDiffs, baseDoc, candDoc, pdfDetails, highlightBoth, showHeatmap, scaleWidth]);

  return (
    <div className="space-y-3">
      <div className={`grid gap-4 ${showHeatmap ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2'}`}>
        <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-800">
              Source (IMDS) · {slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'No Page Here'}
            </span>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">{dimsLabel.src}</span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center">
            <canvas ref={srcCanvasRef} className="max-w-full h-auto shadow-sm border border-slate-200 bg-white" />
          </div>
        </div>

        <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-800">
              Destination (DDGS) · {slot.candidatePageNum ? `Page ${slot.candidatePageNum}` : 'Missing Page'}
            </span>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">{dimsLabel.dst}</span>
          </div>
          <div className="p-3 bg-slate-100 flex justify-center">
            <canvas ref={dstCanvasRef} className="max-w-full h-auto shadow-sm border border-slate-200 bg-white" />
          </div>
        </div>

        {showHeatmap && (
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                <Layers className="w-3.5 h-3.5 text-red-600" />
                Pixel Diff Overlay
              </span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {dimsLabel.pct ? `${dimsLabel.pct} px delta` : 'Page offset'}
              </span>
            </div>
            <div className="p-3 bg-slate-100 flex justify-center">
              <canvas ref={diffCanvasRef} className="max-w-full h-auto shadow-sm border border-slate-200 bg-white" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AfpSlotVisualRow({
  run,
  slot,
  slotDiffs,
  highlightBoth,
}: {
  run: ComparisonRun;
  slot: AlignedPageSlot;
  slotDiffs: TextDiffLine[];
  highlightBoth: boolean;
}) {
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const dstRef = useRef<HTMLCanvasElement | null>(null);
  const details = run.afpDetails;

  useEffect(() => {
    if (!details) return;

    const drawSide = (
      canvas: HTMLCanvasElement | null,
      pageNum: number | null,
      isBlank: boolean,
      side: 'baseline' | 'candidate'
    ) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const geo =
        (side === 'baseline' ? details.baselineGeometry[0] : details.candidateGeometry[0]) || {
          widthUnits: 2040,
          heightUnits: 2640,
          xdpi: 240,
          ydpi: 240,
        };
      const w = 460;
      const h = Math.round((geo.heightUnits / geo.widthUnits) * w);
      canvas.width = w;
      canvas.height = h;

      if (pageNum === null) {
        ctx.fillStyle = side === 'baseline' ? '#F0FDFA' : '#FFF1F2';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = side === 'baseline' ? '#0D9488' : '#BE123C';
        ctx.lineWidth = 2;
        ctx.strokeRect(8, 8, w - 16, h - 16);
        ctx.fillStyle = side === 'baseline' ? '#0F766E' : '#BE123C';
        ctx.font = '700 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          side === 'baseline' ? 'NO PAGE IN SOURCE AFP' : 'PAGE MISSING IN DEST AFP',
          w / 2,
          h / 2
        );
        ctx.textAlign = 'left';
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);

      if (isBlank) {
        ctx.fillStyle = '#0F766E';
        ctx.font = '700 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`INSERTED BLANK PAGE (PAGE ${pageNum})`, w / 2, h / 2);
        ctx.textAlign = 'left';
        return;
      }

      const runs = (side === 'baseline' ? details.baselinePtocaRuns : details.candidatePtocaRuns).filter(
        (r) => r.pageIndex === pageNum
      );

      const lineCatMap = new Map<number, DiffCategory>();
      for (const d of slotDiffs) {
        const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
        if (ln !== null) lineCatMap.set(ln, d.diffCategory);
      }

      runs.forEach((r, idx) => {
        const px = Math.max(8, Math.min(w - 20, (r.x / geo.widthUnits) * w));
        const py = Math.max(18, Math.min(h - 12, (r.y / geo.heightUnits) * h));
        const cat = lineCatMap.get(idx + 1);

        if (highlightBoth && cat && cat !== 'EQUAL') {
          const meta = DIFF_COLOR_MAP[cat];
          ctx.fillStyle = meta.hexFill;
          ctx.fillRect(px - 4, py - 12, w - px - 12, 18);
          ctx.strokeStyle = meta.hexStroke;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(px - 4, py - 12, w - px - 12, 18);
        }

        ctx.fillStyle = highlightBoth && cat ? DIFF_COLOR_MAP[cat].hexStroke : '#1d4ed8';
        ctx.fillRect(px - 2, py - 2, 4, 4);

        ctx.fillStyle = '#0f172a';
        ctx.font = r.fontLocalId >= 2 ? '600 10px monospace' : '400 10px monospace';
        ctx.fillText(r.text, px + 6, py + 3);
      });
    };

    drawSide(srcRef.current, slot.baselinePageNum, slot.baselineBlank, 'baseline');
    drawSide(dstRef.current, slot.candidatePageNum, slot.candidateBlank, 'candidate');
  }, [details, slot, slotDiffs, highlightBoth]);

  if (!details) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">
          Source AFP (Native PTOCA) · {slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'Absent'}
        </div>
        <div className="p-3 bg-slate-100 flex justify-center">
          <canvas ref={srcRef} className="max-w-full h-auto border border-slate-200 bg-white shadow-sm" />
        </div>
      </div>
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">
          Destination AFP (Native PTOCA) · {slot.candidatePageNum ? `Page ${slot.candidatePageNum}` : 'Missing'}
        </div>
        <div className="p-3 bg-slate-100 flex justify-center">
          <canvas ref={dstRef} className="max-w-full h-auto border border-slate-200 bg-white shadow-sm" />
        </div>
      </div>
    </div>
  );
}

export function AllPagesVisualCompare({ run }: AllPagesVisualCompareProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'diffs'>('all');
  const [highlightBoth, setHighlightBoth] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [zoomWidth, setZoomWidth] = useState<number>(440);
  const [baseDoc, setBaseDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [candDoc, setCandDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);

  const slotRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (run.format !== 'PDF' || !run.pdfVisualReady) {
      setBaseDoc(null);
      setCandDoc(null);
      return;
    }

    let cancelled = false;
    setPdfLoadError(null);

    async function loadDocs() {
      try {
        const [bRes, cRes] = await Promise.all([
          fetch(`/api/runs/${encodeURIComponent(run.id)}/artifact/baseline`),
          fetch(`/api/runs/${encodeURIComponent(run.id)}/artifact/candidate`),
        ]);
        if (!bRes.ok || !cRes.ok) {
          throw new Error('Failed to load PDF binary streams for all-pages visual comparison.');
        }
        const [bBuf, cBuf] = await Promise.all([bRes.arrayBuffer(), cRes.arrayBuffer()]);
        const [bPdf, cPdf] = await Promise.all([
          pdfjsLib.getDocument({ data: new Uint8Array(bBuf) }).promise,
          pdfjsLib.getDocument({ data: new Uint8Array(cBuf) }).promise,
        ]);
        if (!cancelled) {
          setBaseDoc(bPdf);
          setCandDoc(cPdf);
        }
      } catch (err) {
        if (!cancelled) {
          setPdfLoadError(err instanceof Error ? err.message : 'Unable to render PDF pages.');
        }
      }
    }

    loadDocs();
    return () => {
      cancelled = true;
    };
  }, [run.id, run.format, run.pdfVisualReady]);

  const slots = run.alignedPages || [];
  const diffSlotsCount = useMemo(
    () => slots.filter((s) => s.status !== 'MATCHED').length,
    [slots]
  );

  const visibleSlots = useMemo(
    () => (filterMode === 'diffs' ? slots.filter((s) => s.status !== 'MATCHED') : slots),
    [slots, filterMode]
  );

  if (run.overallOutcome === 'BLOCKED' || slots.length === 0) {
    return (
      <div className="rounded-lg border border-slate-300 bg-slate-100 p-6 text-sm text-slate-800">
        Visual all-pages comparison skipped because this run is <strong>Blocked</strong> or contains empty/corrupt artifacts.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Toolbar: Controls + Downloadable Visual Reports */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Columns2 className="w-4 h-4 text-blue-700 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">
                All-Pages Visual Side-by-Side Comparison ({run.baseline.pageCount} Source Pages vs{' '}
                {run.candidate.pageCount} Destination Pages · {slots.length} Aligned Slots)
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Automatically aligns inserted or blank pages (such as an extra white page in Destination) while keeping all matching pages aligned side-by-side and highlighted in both files.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {run.format === 'PDF' && run.pdfVisualReady && (
              <a
                href={`/api/runs/${encodeURIComponent(run.id)}/export?format=diff-pdf`}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Download Highlighted PDF Report
              </a>
            )}
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/export?format=html`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              Download Visual HTML Report
            </a>
          </div>
        </div>

        {/* Visual Controls & Legend */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  filterMode === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                All Aligned Pages ({slots.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('diffs')}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  filterMode === 'diffs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Pages With Differences ({diffSlotsCount})
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={highlightBoth}
                onChange={(e) => setHighlightBoth(e.target.checked)}
                className="rounded border-slate-300 text-blue-700"
              />
              <span>Highlight Both Files</span>
            </label>

            {run.format === 'PDF' && (
              <>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={showHeatmap}
                    onChange={(e) => setShowHeatmap(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Show Pixel Diff Column</span>
                </label>

                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
                  <span>Page Size:</span>
                  <select
                    value={zoomWidth}
                    onChange={(e) => setZoomWidth(Number(e.target.value))}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                  >
                    <option value={360}>Compact</option>
                    <option value={440}>Standard</option>
                    <option value={540}>Large</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <Eye className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            {DIFF_CATEGORY_ORDER.map((cat) => {
              const meta = DIFF_COLOR_MAP[cat];
              return (
                <span key={cat} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className={`w-2.5 h-2.5 rounded-sm ${meta.swatchBg}`} />
                  <span>{meta.shortLabel}</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Clickable Page-by-Page Alignment Map Strip */}
        <div className="pt-3 border-t border-slate-100">
          <div className="text-[11px] font-medium text-slate-500 mb-2">
            Page Alignment Map (click any slot to jump directly to that visual page pair):
          </div>
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => {
              const isInserted = s.status === 'INSERTED_IN_CANDIDATE';
              const isMissing = s.status === 'MISSING_IN_CANDIDATE';
              const isDiff = s.status === 'DIFF_DETECTED';
              const cardStyle = isInserted
                ? 'border-teal-300 bg-teal-50 text-teal-900'
                : isMissing
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : isDiff
                ? 'border-red-300 bg-red-50 text-red-900'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100';

              return (
                <button
                  key={s.slotIndex}
                  type="button"
                  onClick={() => {
                    if (filterMode === 'diffs' && s.status === 'MATCHED') {
                      setFilterMode('all');
                    }
                    setTimeout(() => {
                      slotRefs.current[s.slotIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 30);
                  }}
                  className={`rounded border px-2.5 py-1.5 text-left text-[11px] transition-colors ${cardStyle}`}
                >
                  <div className="font-mono font-semibold tabular-nums">
                    Slot {s.slotIndex}: {s.baselinePageNum ? `S${s.baselinePageNum}` : '—'} ↔{' '}
                    {s.candidatePageNum ? `D${s.candidatePageNum}` : '—'}
                  </div>
                  <div className="text-[10px] opacity-85">
                    {isInserted
                      ? s.candidateBlank
                        ? 'Inserted White Page'
                        : 'Inserted Page'
                      : isMissing
                      ? 'Missing in Dest'
                      : isDiff
                      ? `${s.diffCount} Diff(s)`
                      : 'Matched'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {pdfLoadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {pdfLoadError}
        </div>
      )}

      {/* All Aligned Page Slots Stacked Vertically */}
      <div className="space-y-6">
        {visibleSlots.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            All aligned page slots matched cleanly with zero differences.
          </div>
        ) : (
          visibleSlots.map((slot) => {
            const slotDiffs = run.textDiffs.filter(
              (d) => d.slotIndex === slot.slotIndex && d.diffCategory !== 'EQUAL'
            );

            const statusBadge =
              slot.status === 'INSERTED_IN_CANDIDATE'
                ? { label: slot.candidateBlank ? 'Inserted White / Blank Page in Dest' : 'Inserted Page in Dest', cls: DIFF_COLOR_MAP.ADDED_CONTENT.badgeClass }
                : slot.status === 'MISSING_IN_CANDIDATE'
                ? { label: 'Page Missing in Dest', cls: DIFF_COLOR_MAP.MISSING_CONTENT.badgeClass }
                : slot.status === 'DIFF_DETECTED'
                ? { label: `${slot.diffCount} Difference(s) Highlighted`, cls: DIFF_COLOR_MAP.TEXT_CHANGE.badgeClass }
                : { label: 'Matched Page Pair', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' };

            return (
              <div
                key={slot.slotIndex}
                ref={(el) => {
                  slotRefs.current[slot.slotIndex] = el;
                }}
                className="rounded-lg border border-slate-200 bg-white overflow-hidden"
              >
                {/* Slot Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-slate-900">
                        Aligned Slot {slot.slotIndex} of {slots.length}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="font-mono text-slate-700">
                        Source: {slot.baselinePageNum ? `Page ${slot.baselinePageNum}${slot.baselineBlank ? ' (Blank)' : ''}` : 'No Page (Absent)'}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">↔</span>
                      <span className="font-mono text-slate-700">
                        Destination: {slot.candidatePageNum ? `Page ${slot.candidatePageNum}${slot.candidateBlank ? ' (White / Blank)' : ''}` : 'Missing'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{slot.summary}</p>
                  </div>

                  <span className={`rounded border px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${statusBadge.cls}`}>
                    {statusBadge.label}
                  </span>
                </div>

                {/* Format-Appropriate Side-by-Side Visual Body */}
                <div className="p-4 bg-slate-50/50 space-y-4">
                  {run.format === 'PDF' && (
                    <PdfSlotVisualRow
                      slot={slot}
                      slotDiffs={slotDiffs}
                      baseDoc={baseDoc}
                      candDoc={candDoc}
                      pdfDetails={run.pdfDetails}
                      highlightBoth={highlightBoth}
                      showHeatmap={showHeatmap}
                      scaleWidth={zoomWidth}
                    />
                  )}

                  {run.format === 'AFP' && (
                    <AfpSlotVisualRow
                      run={run}
                      slot={slot}
                      slotDiffs={slotDiffs}
                      highlightBoth={highlightBoth}
                    />
                  )}

                  {(run.format === 'PCL' || run.format === 'RT') && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {(['baseline', 'candidate'] as const).map((side) => {
                        const pageNum = side === 'baseline' ? slot.baselinePageNum : slot.candidatePageNum;
                        const pclPage =
                          run.format === 'PCL' && run.pclDetails && pageNum
                            ? (side === 'baseline'
                                ? run.pclDetails.baselinePages[pageNum - 1]
                                : run.pclDetails.candidatePages[pageNum - 1])
                            : undefined;

                        const slotRows = run.textDiffs.filter((d) => d.slotIndex === slot.slotIndex);

                        return (
                          <div key={side} className="rounded-md border border-slate-200 bg-white overflow-hidden">
                            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                              <span className="font-semibold text-slate-800">
                                {side === 'baseline' ? 'Source (IMDS)' : 'Destination (DDGS)'} ·{' '}
                                {pageNum ? `Page ${pageNum}` : 'Absent'}
                              </span>
                              {pclPage && (
                                <span className="font-mono text-[11px] text-slate-500">
                                  {pclPage.paperSource} · {pclPage.fontPitchCpi} · {pclPage.fontHeightPt}
                                </span>
                              )}
                            </div>

                            {pageNum === null ? (
                              <div className="p-8 text-center text-xs text-slate-600 bg-slate-50 min-h-[180px] flex items-center justify-center">
                                {side === 'baseline'
                                  ? `No corresponding page in Source File (Dest Page ${slot.candidatePageNum} inserted).`
                                  : `Source Page ${slot.baselinePageNum} is missing in Destination File.`}
                              </div>
                            ) : (
                              <div className="p-3 font-mono text-[11.5px] space-y-1 bg-white overflow-x-auto">
                                {slotRows.map((row) => {
                                  const isDiff = row.diffCategory !== 'EQUAL';
                                  const meta = DIFF_COLOR_MAP[row.diffCategory];
                                  return (
                                    <div
                                      key={row.id}
                                      className={`px-2 py-1 rounded ${
                                        highlightBoth && isDiff ? meta.rowTintClass : ''
                                      } whitespace-pre-wrap break-words`}
                                    >
                                      {highlightBoth && isDiff
                                        ? renderTokenPreview(
                                            side === 'baseline' ? row.baselineTokens : row.candidateTokens,
                                            side === 'baseline' ? row.baselineText : row.candidateText,
                                            row.diffCategory
                                          )
                                        : (side === 'baseline' ? row.baselineText : row.candidateText) || (
                                            <span className="text-slate-400 italic">(absent)</span>
                                          )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Per-Slot Detailed Highlighted Difference Strip */}
                  {slotDiffs.length > 0 && (
                    <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
                      <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                        Highlighted Differences in Slot {slot.slotIndex}
                      </div>
                      <div className="divide-y divide-slate-100">
                        {slotDiffs.map((d) => {
                          const meta = DIFF_COLOR_MAP[d.diffCategory];
                          return (
                            <div key={d.id} className={`px-3 py-2 text-xs grid grid-cols-1 md:grid-cols-12 gap-2 items-start ${meta.rowTintClass}`}>
                              <div className="md:col-span-2 flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${meta.badgeClass}`}>
                                  <span className={`w-2 h-2 rounded-sm ${meta.swatchBg}`} />
                                  {meta.shortLabel}
                                </span>
                                <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                                  L{d.baselineLineNum ?? '—'}/L{d.candidateLineNum ?? '—'}
                                </span>
                              </div>
                              <div className="md:col-span-5 font-mono text-[11px] text-slate-900 break-words">
                                <span className="font-sans text-[10px] font-semibold text-slate-500 mr-1">SRC:</span>
                                {renderTokenPreview(d.baselineTokens, d.baselineText, d.diffCategory)}
                              </div>
                              <div className="md:col-span-5 font-mono text-[11px] text-slate-900 break-words">
                                <span className="font-sans text-[10px] font-semibold text-slate-500 mr-1">DST:</span>
                                {renderTokenPreview(d.candidateTokens, d.candidateText, d.diffCategory)}
                                {(d.positionDelta || d.fontDelta || d.controlDelta) && (
                                  <span className="ml-2 font-sans text-[10px] text-slate-600">
                                    ({[d.positionDelta, d.fontDelta, d.controlDelta].filter(Boolean).join(' · ')})
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
