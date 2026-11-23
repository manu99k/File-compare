import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, Columns2, Download, Eye, FileText, Layers } from 'lucide-react';
import type {
  AfpVisualPage,
  AlignedPageSlot,
  ComparisonRun,
  DiffCategory,
  InlineToken,
  PdfLineLayout,
  TextDiffLine,
} from '../types/qe';
import { DIFF_CATEGORY_ORDER, DIFF_COLOR_MAP } from '../lib/diffColors';
import { encodeCode39Bars } from '../lib/barcode';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const SLOTS_PER_PAGE = 10;

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
  baseLayouts?: PdfLineLayout[];
  candLayouts?: PdfLineLayout[];
  highlightBoth: boolean;
  showHeatmap: boolean;
  scaleWidth: number;
}

function PdfSlotVisualRow({
  slot,
  slotDiffs,
  baseDoc,
  candDoc,
  baseLayouts,
  candLayouts,
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
        try {
          const unscaled = page.getViewport({ scale: 1 });
          const scale = scaleWidth / unscaled.width;
          const viewport = page.getViewport({ scale });

          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({ canvasContext: ctx, viewport, canvas }).promise;

          if (isBlank && slot.baselinePageNum === null) {
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
        } finally {
          page.cleanup();
        }
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

      // Draw subtle color-coded semantic bounding boxes + numbered gutter pins directly on BOTH Source & Destination canvases
      if (highlightBoth && (baseLayouts || candLayouts)) {
        const drawOverlayBox = (
          canvas: HTMLCanvasElement | null,
          viewport: pdfjsLib.PageViewport | null,
          scale: number,
          layout: PdfLineLayout,
          cat: DiffCategory,
          pinNum: number
        ) => {
          if (!canvas || !viewport) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const meta = DIFF_COLOR_MAP[cat];
          const [vx, vy] = viewport.convertToViewportPoint(layout.x, layout.y);
          const boxH = Math.max(layout.fontSize * scale, layout.height * scale, 10) + 4;
          const boxW = Math.min(canvas.width - vx - 4, Math.max(layout.width * scale, 48) + 6);
          const bx = Math.max(16, vx - 2);
          const by = vy - boxH + 3;

          ctx.save();
          ctx.fillStyle = meta.hexFill;
          ctx.fillRect(bx, by, boxW, boxH);
          ctx.strokeStyle = meta.hexStroke;
          ctx.lineWidth = 1.15;
          ctx.strokeRect(bx, by, boxW, boxH);

          const pinText = `#${pinNum}`;
          ctx.font = '700 8.5px sans-serif';
          const pinW = Math.max(16, ctx.measureText(pinText).width + 6);
          ctx.fillStyle = meta.hexStroke;
          ctx.fillRect(2, Math.max(2, by), pinW, 12);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(pinText, 5, Math.max(11, by + 9));
          ctx.restore();
        };

        const bLayouts = baseLayouts || [];
        const cLayouts = candLayouts || [];

        slotDiffs.forEach((d, idx) => {
          const pin = idx + 1;
          if (d.baselineLineNum !== null && bLayouts[d.baselineLineNum - 1]) {
            drawOverlayBox(
              srcCanvasRef.current,
              bInfo.viewport,
              bInfo.scale,
              bLayouts[d.baselineLineNum - 1],
              d.diffCategory,
              pin
            );
          }
          if (d.candidateLineNum !== null && cLayouts[d.candidateLineNum - 1]) {
            drawOverlayBox(
              dstCanvasRef.current,
              cInfo.viewport,
              cInfo.scale,
              cLayouts[d.candidateLineNum - 1],
              d.diffCategory,
              pin
            );
          }
        });
      }

      setDimsLabel({ src: bInfo.ptLabel, dst: cInfo.ptLabel, pct: pctStr });
    }

    drawSlot();
    return () => {
      cancelled = true;
    };
  }, [slot, slotDiffs, baseDoc, candDoc, baseLayouts, candLayouts, highlightBoth, showHeatmap, scaleWidth]);

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

export function AfpVisualPageSvg({
  vp,
  mediaAssets,
  slotDiffs,
  side,
  highlightBoth,
  pageNum,
  isBlank,
  otherPageMissing,
  scaleWidth,
}: {
  vp: AfpVisualPage | undefined;
  mediaAssets?: Record<string, string>;
  slotDiffs: TextDiffLine[];
  side: 'baseline' | 'candidate';
  highlightBoth: boolean;
  pageNum: number | null;
  isBlank: boolean;
  otherPageMissing: boolean;
  scaleWidth: number;
}) {
  if (pageNum === null) {
    const isAdded = side === 'baseline';
    return (
      <div
        className={`flex flex-col items-center justify-center rounded border-2 border-dashed p-6 text-center ${
          isAdded ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-rose-500 bg-rose-50 text-rose-800'
        }`}
        style={{ width: scaleWidth, height: Math.round(scaleWidth * 1.294) }}
      >
        <p className="text-xs font-bold">
          {isAdded ? 'NO CORRESPONDING PAGE IN SOURCE AFP' : 'PAGE MISSING IN DESTINATION AFP'}
        </p>
        <p className="mt-1.5 text-[11px] opacity-85">
          {isAdded
            ? 'Destination inserted a page here; subsequent pages remain aligned.'
            : 'Source page was omitted in Destination output.'}
        </p>
      </div>
    );
  }

  if (isBlank) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded border-2 border-teal-500 bg-white p-6 text-center"
        style={{ width: scaleWidth, height: Math.round(scaleWidth * 1.294) }}
      >
        <div className="rounded border border-teal-500 bg-teal-50 px-4 py-3 text-teal-800">
          <p className="text-xs font-bold">
            {otherPageMissing ? `INSERTED WHITE / BLANK PAGE (PAGE ${pageNum})` : `BLANK PAGE (PAGE ${pageNum})`}
          </p>
          <p className="mt-1 text-[11px]">No printable objects or text on this page.</p>
        </div>
      </div>
    );
  }

  const page: AfpVisualPage = vp || {
    pageIndex: pageNum,
    widthUnits: 2040,
    heightUnits: 2640,
    xdpi: 240,
    ydpi: 240,
    elements: [],
  };

  const lineDiffMap = new Map<number, { pin: number; cat: DiffCategory }>();
  slotDiffs.forEach((d, i) => {
    const ln = side === 'baseline' ? d.baselineLineNum : d.candidateLineNum;
    if (ln !== null && !lineDiffMap.has(ln)) {
      lineDiffMap.set(ln, { pin: i + 1, cat: d.diffCategory });
    }
  });

  return (
    <svg
      viewBox={`0 0 ${page.widthUnits} ${page.heightUnits}`}
      style={{ width: scaleWidth, maxWidth: '100%', height: 'auto' }}
      className="bg-white border border-slate-200 shadow-sm block"
    >
      {/* Rules, Vectors, External Resource Boxes, Decoded Logos/Images, Code-39 Barcodes */}
      {page.elements.map((el, idx) => {
        if (el.kind === 'rule') {
          return (
            <rect
              key={`r-${idx}`}
              x={el.x}
              y={el.y}
              width={Math.max(2, el.w)}
              height={Math.max(2, el.h)}
              fill={el.color}
            />
          );
        }
        if (el.kind === 'vector') {
          return (
            <svg
              key={`v-${idx}`}
              x={el.x}
              y={el.y}
              width={Math.max(1, el.w)}
              height={Math.max(1, el.h)}
              viewBox={`0 0 ${Math.max(1, el.viewW)} ${Math.max(1, el.viewH)}`}
              overflow="visible"
            >
              {el.paths.map((p, pIdx) => (
                <path
                  key={pIdx}
                  d={p.d}
                  fill={p.fill || 'none'}
                  stroke={p.stroke || '#0f172a'}
                  strokeWidth={p.strokeWidth || 2}
                />
              ))}
            </svg>
          );
        }
        if (el.kind === 'external_ref') {
          return (
            <g key={`e-${idx}`}>
              <rect
                x={el.x}
                y={el.y}
                width={el.w}
                height={el.h}
                fill="#f8fafc"
                stroke="#94a3b8"
                strokeWidth={2}
                strokeDasharray="6,4"
                rx={4}
              />
              <text
                x={el.x + el.w / 2}
                y={el.y + el.h / 2 + 6}
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
                fontSize={20}
                fill="#475569"
              >
                [{el.resType}: {el.name}]
              </text>
            </g>
          );
        }
        if (el.kind === 'image') {
          const href = mediaAssets?.[el.assetId];
          if (!href) return null;
          return (
            <image
              key={`i-${idx}`}
              x={el.x}
              y={el.y}
              width={el.w}
              height={el.h}
              href={href}
              preserveAspectRatio="xMinYMin meet"
            />
          );
        }
        if (el.kind === 'barcode') {
          const bars = encodeCode39Bars(el.value);
          return (
            <g
              key={`b-${idx}`}
              transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}
            >
              <g transform={`translate(${el.x},${el.y})`}>
                {bars.map((b, bIdx) => (
                  <rect
                    key={bIdx}
                    x={b.x * el.w}
                    y={0}
                    width={Math.max(1.5, b.w * el.w)}
                    height={el.h}
                    fill="#0f172a"
                  />
                ))}
                <text
                  x={el.w / 2}
                  y={el.h + 22}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  fontSize={18}
                  fill="#334155"
                >
                  {el.value}
                </text>
              </g>
            </g>
          );
        }
        return null;
      })}

      {/* Proportional FOCA Text Lines + Clean Numbered Diff Highlights */}
      {page.elements.map((el, idx) => {
        if (el.kind !== 'text_line') return null;
        const diffInfo = highlightBoth ? lineDiffMap.get(el.lineNum) : undefined;
        const meta = diffInfo ? DIFF_COLOR_MAP[diffInfo.cat] : null;
        const pt0 = el.spans[0]?.fontSizePt || 9.5;
        const fontUnitPx = Math.max(16, Math.round((pt0 / 72) * page.xdpi));
        const estW = Math.min(page.widthUnits - el.x - 40, Math.max(120, Math.round(el.fullText.length * fontUnitPx * 0.54)));
        const boxH = Math.round(fontUnitPx * 1.35);

        return (
          <g key={`t-${idx}`}>
            {diffInfo && meta && (
              <g>
                <rect
                  x={Math.max(10, el.x - 8)}
                  y={Math.max(4, el.y - Math.round(fontUnitPx * 1.05))}
                  width={estW + 16}
                  height={boxH}
                  fill={meta.hexFill}
                  stroke={meta.hexStroke}
                  strokeWidth={2}
                  rx={4}
                />
                <rect
                  x={14}
                  y={Math.max(4, el.y - Math.round(fontUnitPx * 0.95))}
                  width={38}
                  height={28}
                  fill={meta.hexStroke}
                  rx={4}
                />
                <text
                  x={33}
                  y={Math.max(24, el.y - Math.round(fontUnitPx * 0.95) + 21)}
                  textAnchor="middle"
                  fontFamily="system-ui, sans-serif"
                  fontWeight="700"
                  fontSize={19}
                  fill="#ffffff"
                >
                  #{diffInfo.pin}
                </text>
              </g>
            )}
            {el.spans.map((sp, sIdx) => {
              const fUnit = Math.max(16, Math.round((sp.fontSizePt / 72) * page.xdpi));
              const familyCss =
                sp.fontFamily === 'serif'
                  ? 'Georgia, Times New Roman, serif'
                  : sp.fontFamily === 'monospace'
                  ? 'ui-monospace, Consolas, monospace'
                  : 'system-ui, -apple-system, Segoe UI, Arial, sans-serif';
              return (
                <text
                  key={sIdx}
                  x={sp.x}
                  y={el.y}
                  fontFamily={familyCss}
                  fontSize={fUnit}
                  fontWeight={sp.fontWeight}
                  fontStyle={sp.fontStyle}
                  fill={sp.color}
                >
                  {sp.text}
                </text>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function AfpSlotVisualRow({
  run,
  slot,
  slotDiffs,
  bVp,
  cVp,
  highlightBoth,
  scaleWidth,
}: {
  run: ComparisonRun;
  slot: AlignedPageSlot;
  slotDiffs: TextDiffLine[];
  bVp: AfpVisualPage | undefined;
  cVp: AfpVisualPage | undefined;
  highlightBoth: boolean;
  scaleWidth: number;
}) {
  const details = run.afpDetails;
  if (!details) return null;

  const bImgCount = bVp?.elements.filter((e) => e.kind === 'image' || e.kind === 'vector').length || 0;
  const cImgCount = cVp?.elements.filter((e) => e.kind === 'image' || e.kind === 'vector').length || 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="font-semibold text-slate-800">
            Source AFP (IMDS) · {slot.baselinePageNum ? `Page ${slot.baselinePageNum}` : 'Absent'}
          </span>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {bVp ? `${Math.round(bVp.widthUnits / bVp.xdpi)}×${Math.round(bVp.heightUnits / bVp.ydpi)}in · ${bImgCount} graphic(s)` : ''}
          </span>
        </div>
        <div className="p-3 bg-slate-100 flex justify-center">
          <AfpVisualPageSvg
            vp={bVp}
            mediaAssets={details.mediaAssets}
            slotDiffs={slotDiffs}
            side="baseline"
            highlightBoth={highlightBoth}
            pageNum={slot.baselinePageNum}
            isBlank={slot.baselineBlank}
            otherPageMissing={slot.candidatePageNum === null}
            scaleWidth={scaleWidth}
          />
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="font-semibold text-slate-800">
            Destination AFP (DDGS) · {slot.candidatePageNum ? `Page ${slot.candidatePageNum}` : 'Missing'}
          </span>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {cVp ? `${Math.round(cVp.widthUnits / cVp.xdpi)}×${Math.round(cVp.heightUnits / cVp.ydpi)}in · ${cImgCount} graphic(s)` : ''}
          </span>
        </div>
        <div className="p-3 bg-slate-100 flex justify-center">
          <AfpVisualPageSvg
            vp={cVp}
            mediaAssets={details.mediaAssets}
            slotDiffs={slotDiffs}
            side="candidate"
            highlightBoth={highlightBoth}
            pageNum={slot.candidatePageNum}
            isBlank={slot.candidateBlank}
            otherPageMissing={slot.baselinePageNum === null}
            scaleWidth={scaleWidth}
          />
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
  const [afpRenderMode, setAfpRenderMode] = useState<'native' | 'papyrus'>('native');
  const [slotPage, setSlotPage] = useState<number>(0);
  const [baseDoc, setBaseDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [candDoc, setCandDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);

  const slotRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    setSlotPage(0);
  }, [run.id, filterMode]);

  const usePapyrusPdf = run.format === 'AFP' && Boolean(run.afpDetails?.papyrusExportAttached) && afpRenderMode === 'papyrus';

  useEffect(() => {
    if (!((run.format === 'PDF' && run.pdfVisualReady) || usePapyrusPdf)) {
      setBaseDoc(null);
      setCandDoc(null);
      return;
    }

    let cancelled = false;
    let loadedBase: pdfjsLib.PDFDocumentProxy | null = null;
    let loadedCand: pdfjsLib.PDFDocumentProxy | null = null;
    setPdfLoadError(null);

    async function loadDocs() {
      try {
        const basePath = usePapyrusPdf ? 'papyrus-baseline' : 'baseline';
        const candPath = usePapyrusPdf ? 'papyrus-candidate' : 'candidate';
        const [bRes, cRes] = await Promise.all([
          fetch(`/api/runs/${encodeURIComponent(run.id)}/artifact/${basePath}`),
          fetch(`/api/runs/${encodeURIComponent(run.id)}/artifact/${candPath}`),
        ]);
        if (!bRes.ok || !cRes.ok) {
          throw new Error('Failed to load PDF binary streams for all-pages visual comparison.');
        }
        const [bBuf, cBuf] = await Promise.all([bRes.arrayBuffer(), cRes.arrayBuffer()]);
        const [bPdf, cPdf] = await Promise.all([
          pdfjsLib.getDocument({ data: new Uint8Array(bBuf) }).promise,
          pdfjsLib.getDocument({ data: new Uint8Array(cBuf) }).promise,
        ]);
        if (cancelled) {
          bPdf.loadingTask.destroy().catch(() => {});
          cPdf.loadingTask.destroy().catch(() => {});
          return;
        }
        loadedBase = bPdf;
        loadedCand = cPdf;
        setBaseDoc(bPdf);
        setCandDoc(cPdf);
      } catch (err) {
        if (!cancelled) {
          setPdfLoadError(err instanceof Error ? err.message : 'Unable to render PDF pages.');
        }
      }
    }

    loadDocs();
    return () => {
      cancelled = true;
      loadedBase?.loadingTask.destroy().catch(() => {});
      loadedCand?.loadingTask.destroy().catch(() => {});
    };
  }, [run.id, run.format, run.pdfVisualReady, usePapyrusPdf]);

  const slots = run.alignedPages || [];
  const diffSlotsCount = useMemo(
    () => slots.filter((s) => s.status !== 'MATCHED').length,
    [slots]
  );

  const visibleSlots = useMemo(
    () => (filterMode === 'diffs' ? slots.filter((s) => s.status !== 'MATCHED') : slots),
    [slots, filterMode]
  );

  const totalSlotPages = Math.max(1, Math.ceil(visibleSlots.length / SLOTS_PER_PAGE));
  const safeSlotPage = Math.min(slotPage, totalSlotPages - 1);
  const pagedSlots = useMemo(() => {
    const start = safeSlotPage * SLOTS_PER_PAGE;
    return visibleSlots.slice(start, start + SLOTS_PER_PAGE);
  }, [visibleSlots, safeSlotPage]);

  const { nonEqualBySlot, allRowsBySlot, baseLayoutsByPage, candLayoutsByPage, afpBaseVpMap, afpCandVpMap } = useMemo(() => {
    const neMap = new Map<number, TextDiffLine[]>();
    const allMap = new Map<number, TextDiffLine[]>();
    for (const d of run.textDiffs) {
      const slotKey = d.slotIndex ?? 1;
      let allArr = allMap.get(slotKey);
      if (!allArr) {
        allArr = [];
        allMap.set(slotKey, allArr);
      }
      allArr.push(d);
      if (d.diffCategory !== 'EQUAL') {
        let neArr = neMap.get(slotKey);
        if (!neArr) {
          neArr = [];
          neMap.set(slotKey, neArr);
        }
        neArr.push(d);
      }
    }

    const bLayMap = new Map<number, PdfLineLayout[]>();
    const cLayMap = new Map<number, PdfLineLayout[]>();
    if (run.format === 'PDF' && run.pdfDetails) {
      for (const l of run.pdfDetails.baselineLayouts) {
        let arr = bLayMap.get(l.page);
        if (!arr) {
          arr = [];
          bLayMap.set(l.page, arr);
        }
        arr.push(l);
      }
      for (const l of run.pdfDetails.candidateLayouts) {
        let arr = cLayMap.get(l.page);
        if (!arr) {
          arr = [];
          cLayMap.set(l.page, arr);
        }
        arr.push(l);
      }
    }

    const bVp = new Map<number, AfpVisualPage>();
    const cVp = new Map<number, AfpVisualPage>();
    if (run.format === 'AFP' && run.afpDetails) {
      for (const p of run.afpDetails.baselineVisualPages || []) bVp.set(p.pageIndex, p);
      for (const p of run.afpDetails.candidateVisualPages || []) cVp.set(p.pageIndex, p);
    }

    return {
      nonEqualBySlot: neMap,
      allRowsBySlot: allMap,
      baseLayoutsByPage: bLayMap,
      candLayoutsByPage: cLayMap,
      afpBaseVpMap: bVp,
      afpCandVpMap: cVp,
    };
  }, [run.textDiffs, run.format, run.pdfDetails, run.afpDetails]);

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
            {((run.format === 'PDF' && run.pdfVisualReady) || run.format === 'AFP') && (
              <a
                href={`/api/runs/${encodeURIComponent(run.id)}/export?format=diff-pdf`}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Download Enterprise PDF Report
              </a>
            )}
            <a
              href={`/api/runs/${encodeURIComponent(run.id)}/export?format=html`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              Download Interactive HTML Report
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

            {(run.format === 'PDF' || run.format === 'AFP') && (
              <>
                {run.format === 'AFP' && run.afpDetails?.papyrusExportAttached && (
                  <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setAfpRenderMode('native')}
                      className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                        afpRenderMode === 'native' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Native MO:DCA Render
                    </button>
                    <button
                      type="button"
                      onClick={() => setAfpRenderMode('papyrus')}
                      className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                        afpRenderMode === 'papyrus' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                      }`}
                    >
                      Papyrus PDF Proxy
                    </button>
                  </div>
                )}

                {(run.format === 'PDF' || usePapyrusPdf) && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showHeatmap}
                      onChange={(e) => setShowHeatmap(e.target.checked)}
                      className="rounded border-slate-300 text-blue-700"
                    />
                    <span>Show Pixel Diff Column</span>
                  </label>
                )}

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
          <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
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
                    const targetList = filterMode === 'diffs' && s.status === 'MATCHED' ? slots : visibleSlots;
                    if (filterMode === 'diffs' && s.status === 'MATCHED') {
                      setFilterMode('all');
                    }
                    const idxInList = targetList.findIndex((x) => x.slotIndex === s.slotIndex);
                    if (idxInList >= 0) {
                      setSlotPage(Math.floor(idxInList / SLOTS_PER_PAGE));
                    }
                    setTimeout(() => {
                      slotRefs.current[s.slotIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 60);
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

      {run.diffLinesTruncated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          Large-file optimization: 100% of variances ({(run.totalDiffCount ?? 0).toLocaleString()} diff lines) are preserved across all slots; matched context lines were sampled.
        </div>
      )}

      {visibleSlots.length > SLOTS_PER_PAGE && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs">
          <span className="font-mono text-slate-600 tabular-nums">
            Showing aligned slots {safeSlotPage * SLOTS_PER_PAGE + 1}–
            {Math.min((safeSlotPage + 1) * SLOTS_PER_PAGE, visibleSlots.length)} of {visibleSlots.length}
          </span>
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeSlotPage === 0}
              onClick={() => setSlotPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev {SLOTS_PER_PAGE}
            </button>
            <span className="font-mono px-2 text-slate-700 tabular-nums">
              Page {safeSlotPage + 1} / {totalSlotPages}
            </span>
            <button
              type="button"
              disabled={safeSlotPage >= totalSlotPages - 1}
              onClick={() => setSlotPage((p) => Math.min(totalSlotPages - 1, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Next {SLOTS_PER_PAGE}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Paginated Aligned Page Slots */}
      <div className="space-y-6">
        {visibleSlots.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            All aligned page slots matched cleanly with zero differences.
          </div>
        ) : (
          pagedSlots.map((slot) => {
            const slotDiffs = nonEqualBySlot.get(slot.slotIndex) || [];
            const bLayouts = slot.baselinePageNum ? baseLayoutsByPage.get(slot.baselinePageNum) : undefined;
            const cLayouts = slot.candidatePageNum ? candLayoutsByPage.get(slot.candidatePageNum) : undefined;
            const bVp = slot.baselinePageNum ? afpBaseVpMap.get(slot.baselinePageNum) : undefined;
            const cVp = slot.candidatePageNum ? afpCandVpMap.get(slot.candidatePageNum) : undefined;

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
                  {(run.format === 'PDF' || usePapyrusPdf) && (
                    <PdfSlotVisualRow
                      slot={slot}
                      slotDiffs={slotDiffs}
                      baseDoc={baseDoc}
                      candDoc={candDoc}
                      baseLayouts={run.format === 'PDF' ? bLayouts : undefined}
                      candLayouts={run.format === 'PDF' ? cLayouts : undefined}
                      highlightBoth={highlightBoth}
                      showHeatmap={showHeatmap}
                      scaleWidth={zoomWidth}
                    />
                  )}

                  {run.format === 'AFP' && !usePapyrusPdf && (
                    <AfpSlotVisualRow
                      run={run}
                      slot={slot}
                      slotDiffs={slotDiffs}
                      bVp={bVp}
                      cVp={cVp}
                      highlightBoth={highlightBoth}
                      scaleWidth={zoomWidth}
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

                        const allSlotRows = allRowsBySlot.get(slot.slotIndex) || [];
                        const slotRows = allSlotRows.slice(0, 400);

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
                        {slotDiffs.map((d, idx) => {
                          const meta = DIFF_COLOR_MAP[d.diffCategory];
                          return (
                            <div key={d.id} className={`px-3 py-2 text-xs grid grid-cols-1 md:grid-cols-12 gap-2 items-start ${meta.rowTintClass}`}>
                              <div className="md:col-span-2 flex flex-wrap items-center gap-1.5">
                                <span
                                  className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums"
                                  style={{ backgroundColor: meta.hexStroke }}
                                >
                                  #{idx + 1}
                                </span>
                                <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${meta.badgeClass}`}>
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
