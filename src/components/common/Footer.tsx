import React from 'react';
import { ShieldCheck, Info } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-slate-200 bg-slate-50/70 text-slate-500 py-6 px-4 sm:px-6 mt-auto">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 text-xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-600">
            <ShieldCheck className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            <span className="font-semibold text-slate-800">Johari Window Assessment</span>
            <span>•</span>
            <span>Canonical 55-Adjective Workshop Model</span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-500 text-center md:text-right max-w-lg">
            <Info className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" aria-hidden="true" />
            <span>
              Reflective communication and feedback framework. This tool is intended for interpersonal self-awareness and team dynamics, not clinical or diagnostic personality evaluation.
            </span>
          </div>
        </div>

        {/* Developer Attribution */}
        <div className="pt-3 border-t border-slate-200/60 flex items-center justify-center text-center">
          <p className="text-[11px] font-medium text-slate-500 tracking-wide select-none">
            Made with <span className="text-rose-500 font-sans" aria-label="love">♥</span> by Ansh Sharma
          </p>
        </div>
      </div>
    </footer>
  );
};
