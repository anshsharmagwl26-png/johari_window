import React from 'react';
import { cn } from '../../lib/utils';
import { Clock, CheckCircle2, Lock, FileEdit, AlertCircle } from 'lucide-react';

export type BadgeStatus = 'draft' | 'open' | 'finalized' | 'expired' | 'revoked';

export interface StatusBadgeProps {
  status: BadgeStatus;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const configs = {
    draft: {
      label: 'Draft',
      icon: FileEdit,
      styles: 'bg-slate-100 text-slate-800 border-slate-200',
    },
    open: {
      label: 'Collecting Feedback',
      icon: Clock,
      styles: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    finalized: {
      label: 'Finalized',
      icon: CheckCircle2,
      styles: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    },
    expired: {
      label: 'Expired',
      icon: Lock,
      styles: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    revoked: {
      label: 'Revoked',
      icon: AlertCircle,
      styles: 'bg-rose-50 text-rose-800 border-rose-200',
    },
  };

  const config = configs[status] || configs.draft;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border select-none',
        config.styles,
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
};
