import type { DiffCategory } from '../types/qe';

export interface DiffColorMeta {
  category: DiffCategory;
  label: string;
  shortLabel: string;
  description: string;
  swatchBg: string;
  badgeClass: string;
  gutterBarClass: string;
  rowTintClass: string;
  tokenHighlightClass: string;
  hexStroke: string;
  hexFill: string;
}

export const DIFF_CATEGORY_ORDER: DiffCategory[] = [
  'TEXT_CHANGE',
  'ALIGNMENT_SHIFT',
  'FONT_STYLE',
  'MISSING_CONTENT',
  'ADDED_CONTENT',
  'CONTROL_METADATA',
];

export const DIFF_COLOR_MAP: Record<DiffCategory, DiffColorMeta> = {
  TEXT_CHANGE: {
    category: 'TEXT_CHANGE',
    label: 'Text / Content Change',
    shortLabel: 'Text Change',
    description: 'Word, numeric amount, date, or character mismatch between IMDS and DDGS.',
    swatchBg: 'bg-red-600',
    badgeClass: 'bg-red-50 text-red-800 border-red-300',
    gutterBarClass: 'bg-red-600',
    rowTintClass: 'bg-red-50/45',
    tokenHighlightClass: 'bg-red-200/80 text-red-950 rounded px-0.5 font-semibold underline decoration-red-500 decoration-1 underline-offset-2',
    hexStroke: '#DC2626',
    hexFill: 'rgba(220, 38, 38, 0.14)',
  },
  ALIGNMENT_SHIFT: {
    category: 'ALIGNMENT_SHIFT',
    label: 'Alignment / Coordinate Shift',
    shortLabel: 'Alignment Shift',
    description: 'X/Y position, PTOCA AMI/AMB, or fixed-width column spacing shifted even if text matches.',
    swatchBg: 'bg-blue-600',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-300',
    gutterBarClass: 'bg-blue-600',
    rowTintClass: 'bg-blue-50/45',
    tokenHighlightClass: 'bg-blue-200/80 text-blue-950 rounded px-0.5 font-semibold',
    hexStroke: '#2563EB',
    hexFill: 'rgba(37, 99, 235, 0.14)',
  },
  FONT_STYLE: {
    category: 'FONT_STYLE',
    label: 'Font / Pitch / Style Drift',
    shortLabel: 'Font / Style',
    description: 'Font family, point size, PCL CPI pitch, AFP SCFL coded font ID, or EOL/BOM drift.',
    swatchBg: 'bg-violet-600',
    badgeClass: 'bg-violet-50 text-violet-800 border-violet-300',
    gutterBarClass: 'bg-violet-600',
    rowTintClass: 'bg-violet-50/45',
    tokenHighlightClass: 'bg-violet-200/80 text-violet-950 rounded px-0.5 font-semibold',
    hexStroke: '#7C3AED',
    hexFill: 'rgba(124, 58, 237, 0.14)',
  },
  MISSING_CONTENT: {
    category: 'MISSING_CONTENT',
    label: 'Missing in Candidate',
    shortLabel: 'Missing Content',
    description: 'Line or disclosure present in IMDS baseline but omitted from DDGS candidate.',
    swatchBg: 'bg-rose-700',
    badgeClass: 'bg-rose-50 text-rose-900 border-rose-300',
    gutterBarClass: 'bg-rose-700',
    rowTintClass: 'bg-rose-50/55',
    tokenHighlightClass: 'bg-rose-200/90 text-rose-950 rounded px-0.5 line-through decoration-rose-600',
    hexStroke: '#BE123C',
    hexFill: 'rgba(190, 18, 60, 0.14)',
  },
  ADDED_CONTENT: {
    category: 'ADDED_CONTENT',
    label: 'Added in Candidate',
    shortLabel: 'Added Content',
    description: 'Extra line or field inserted in DDGS candidate that does not appear in IMDS baseline.',
    swatchBg: 'bg-teal-600',
    badgeClass: 'bg-teal-50 text-teal-900 border-teal-300',
    gutterBarClass: 'bg-teal-600',
    rowTintClass: 'bg-teal-50/45',
    tokenHighlightClass: 'bg-teal-200/85 text-teal-950 rounded px-0.5 font-semibold',
    hexStroke: '#0D9488',
    hexFill: 'rgba(13, 148, 136, 0.14)',
  },
  CONTROL_METADATA: {
    category: 'CONTROL_METADATA',
    label: 'Control / Metadata / Total',
    shortLabel: 'Control / Total',
    description: 'Print tray, duplex IMM, mailroom TLE tag, or RT numeric control total mismatch.',
    swatchBg: 'bg-amber-600',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
    gutterBarClass: 'bg-amber-600',
    rowTintClass: 'bg-amber-50/50',
    tokenHighlightClass: 'bg-amber-200/85 text-amber-950 rounded px-0.5 font-semibold',
    hexStroke: '#D97706',
    hexFill: 'rgba(217, 119, 6, 0.15)',
  },
  EQUAL: {
    category: 'EQUAL',
    label: 'Matched',
    shortLabel: 'Matched',
    description: 'Text, layout, and control metadata match baseline.',
    swatchBg: 'bg-slate-300',
    badgeClass: 'bg-slate-50 text-slate-600 border-slate-200',
    gutterBarClass: 'bg-transparent',
    rowTintClass: '',
    tokenHighlightClass: '',
    hexStroke: '#64748B',
    hexFill: 'rgba(100, 116, 139, 0.08)',
  },
};
