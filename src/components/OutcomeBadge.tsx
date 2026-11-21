import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react';
import type { OutcomeStatus } from '../types/qe';

interface OutcomeBadgeProps {
  status: OutcomeStatus;
  compact?: boolean;
}

const OUTCOME_META: Record<
  OutcomeStatus,
  { label: string; colorClass: string; Icon: typeof CheckCircle2 }
> = {
  VERIFIED_PASS: {
    label: 'Verified Pass',
    colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    Icon: CheckCircle2,
  },
  CONFIRMED_DEFECT: {
    label: 'Confirmed Defect',
    colorClass: 'text-red-700 bg-red-50 border-red-200',
    Icon: XCircle,
  },
  POTENTIAL_VARIANCE: {
    label: 'Potential Variance (Review)',
    colorClass: 'text-amber-700 bg-amber-50 border-amber-200',
    Icon: AlertTriangle,
  },
  BLOCKED: {
    label: 'Blocked',
    colorClass: 'text-slate-700 bg-slate-100 border-slate-300',
    Icon: Ban,
  },
  NOT_RUN: {
    label: 'Not Run',
    colorClass: 'text-slate-500 bg-slate-50 border-slate-200',
    Icon: Clock,
  },
};

export function OutcomeBadge({ status, compact = false }: OutcomeBadgeProps) {
  const meta = OUTCOME_META[status];
  const Icon = meta.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${meta.colorClass}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{compact ? meta.label.replace(' (Review)', '') : meta.label}</span>
    </span>
  );
}
