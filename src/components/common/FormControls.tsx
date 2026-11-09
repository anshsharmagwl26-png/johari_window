import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Check } from 'lucide-react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, ...props }, ref) => (
  <div className="w-full">
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
        error && 'border-rose-500 focus-visible:ring-rose-500',
        className
      )}
      {...props}
    />
    {error && <p className="mt-1.5 text-xs text-rose-600 font-medium">{error}</p>}
  </div>
));
Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, error, ...props }, ref) => (
  <div className="w-full">
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-colors resize-y',
        error && 'border-rose-500 focus-visible:ring-rose-500',
        className
      )}
      {...props}
    />
    {error && <p className="mt-1.5 text-xs text-rose-600 font-medium">{error}</p>}
  </div>
));
Textarea.displayName = 'Textarea';

export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }> = ({
  className,
  children,
  required,
  ...props
}) => (
  <label className={cn('block text-sm font-medium text-slate-700 mb-1.5 select-none', className)} {...props}>
    {children}
    {required && <span className="text-rose-500 ml-1" aria-hidden="true">*</span>}
  </label>
);

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, id, label, description, checked, disabled, onChange, ...props }, ref) => {
    const inputId = id || `checkbox-${Math.random().toString(36).substring(2, 9)}`;

    return (
      <div className="flex items-start space-x-3">
        <div className="relative flex items-center pt-0.5">
          <input
            type="checkbox"
            id={inputId}
            ref={ref}
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            className="peer sr-only"
            {...props}
          />
          <label
            htmlFor={inputId}
            className={cn(
              'h-5 w-5 rounded-md border border-slate-300 bg-white flex items-center justify-center cursor-pointer transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 peer-checked:bg-indigo-600 peer-checked:border-indigo-600 text-white',
              disabled && 'opacity-50 cursor-not-allowed bg-slate-100'
            )}
          >
            {checked && <Check className="w-3.5 h-3.5 stroke-[3]" aria-hidden="true" />}
          </label>
        </div>
        {(label || description) && (
          <div className="text-sm">
            {label && (
              <label
                htmlFor={inputId}
                className={cn('font-medium text-slate-800 cursor-pointer block', disabled && 'opacity-50 cursor-not-allowed')}
              >
                {label}
              </label>
            )}
            {description && <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{description}</p>}
          </div>
        )}
      </div>
    );
  }
);
Checkbox.displayName = 'Checkbox';
