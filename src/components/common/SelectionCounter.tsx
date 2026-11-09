import React from 'react';
import { cn } from '../../lib/utils';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export interface SelectionCounterProps {
  currentCount: number;
  min?: number;
  max?: number;
  className?: string;
}

export const SelectionCounter: React.FC<SelectionCounterProps> = ({
  currentCount,
  min = 5,
  max = 7,
  className,
}) => {
  const isBelowMin = currentCount < min;
  const isValid = currentCount >= min && currentCount <= max;
  const isAtMax = currentCount === max;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
        isBelowMin && 'bg-amber-50 text-amber-800 border-amber-200',
        isValid && !isAtMax && 'bg-emerald-50 text-emerald-800 border-emerald-200',
        isAtMax && 'bg-indigo-50 text-indigo-800 border-indigo-200',
        className
      )}
    >
      {isBelowMin && <Info className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />}
      {isValid && !isAtMax && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />}
      {isAtMax && <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />}

      <span>
        {currentCount} of {min}–{max} selected
      </span>

      <span className="text-slate-400 font-normal">|</span>

      <span className="font-normal">
        {isBelowMin && `Need ${min - currentCount} more`}
        {isValid && !isAtMax && `Can select ${max - currentCount} more`}
        {isAtMax && `Maximum reached`}
      </span>
    </div>
  );
};
