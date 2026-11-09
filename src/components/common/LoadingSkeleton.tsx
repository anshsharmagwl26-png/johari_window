import React from 'react';
import { cn } from '../../lib/utils';

export interface LoadingSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'rectangular' | 'circular' | 'chip';
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  className,
  variant = 'rectangular',
  ...props
}) => {
  const variantStyles = {
    text: 'h-4 w-full rounded',
    rectangular: 'h-24 w-full rounded-xl',
    circular: 'h-10 w-10 rounded-full',
    chip: 'h-9 w-24 rounded-lg',
  };

  return (
    <div
      className={cn('animate-pulse bg-slate-200/80', variantStyles[variant], className)}
      aria-hidden="true"
      {...props}
    />
  );
};

export const CardSkeleton: React.FC = () => (
  <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-4">
    <div className="flex items-center gap-3">
      <LoadingSkeleton variant="circular" />
      <div className="space-y-2 flex-1">
        <LoadingSkeleton variant="text" className="w-1/3" />
        <LoadingSkeleton variant="text" className="w-1/2" />
      </div>
    </div>
    <LoadingSkeleton variant="rectangular" className="h-16" />
    <div className="flex justify-between pt-2">
      <LoadingSkeleton variant="chip" />
      <LoadingSkeleton variant="chip" />
    </div>
  </div>
);
