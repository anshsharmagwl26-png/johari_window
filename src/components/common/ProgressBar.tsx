import React from 'react';
import { cn } from '../../lib/utils';

export interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  showPercentage?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max,
  label,
  showPercentage = true,
  className,
}) => {
  const percentage = max > 0 ? Math.min(Math.round((value / max) * 100), 100) : 0;

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      {(label || showPercentage) && (
        <div className="flex justify-between items-center text-xs text-slate-600 font-medium">
          {label && <span>{label}</span>}
          {showPercentage && <span>{percentage}% ({value}/{max})</span>}
        </div>
      )}
      <div
        className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/50"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label || 'Progress'}
      >
        <div
          className="h-full bg-indigo-600 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
