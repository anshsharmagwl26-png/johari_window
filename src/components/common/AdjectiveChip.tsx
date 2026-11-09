import React from 'react';
import { cn } from '../../lib/utils';
import { Check } from 'lucide-react';

export interface AdjectiveChipProps {
  id: string;
  label: string;
  isSelected: boolean;
  disabled?: boolean;
  onToggle: (id: string) => void;
  className?: string;
}

export const AdjectiveChip: React.FC<AdjectiveChipProps> = ({
  id,
  label,
  isSelected,
  disabled = false,
  onToggle,
  className,
}) => {
  return (
    <button
      type="button"
      role="button"
      aria-pressed={isSelected}
      aria-label={`${label}${isSelected ? ', selected' : ''}`}
      disabled={disabled}
      onClick={() => onToggle(id)}
      className={cn(
        'group relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
        isSelected
          ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-600 hover:bg-indigo-700'
          : 'bg-white text-slate-700 border border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80 shadow-xs',
        disabled && !isSelected && 'opacity-40 cursor-not-allowed hover:bg-white hover:border-slate-200',
        disabled && isSelected && 'opacity-80 cursor-not-allowed',
        className
      )}
    >
      <span
        className={cn(
          'w-4 h-4 rounded-full flex items-center justify-center transition-all',
          isSelected
            ? 'bg-white/20 text-white'
            : 'border border-slate-300 text-transparent group-hover:border-slate-400'
        )}
        aria-hidden="true"
      >
        <Check className={cn('w-2.5 h-2.5 stroke-[3]', isSelected ? 'opacity-100' : 'opacity-0')} />
      </span>
      <span>{label}</span>
      {/* Screen reader only announcement of state */}
      <span className="sr-only">{isSelected ? '(Selected)' : '(Unselected)'}</span>
    </button>
  );
};
