import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from './Button';
import { LayoutGrid, PlusCircle, KeyRound } from 'lucide-react';

export const Navbar: React.FC = () => {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2.5 font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <LayoutGrid className="w-5 h-5 stroke-[2.2]" aria-hidden="true" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight leading-none text-slate-900">Johari Window</span>
            <span className="text-[10px] text-slate-500 font-medium tracking-wide uppercase mt-0.5">Self &amp; Team Feedback</span>
          </div>
        </Link>

        {/* Navigation Actions */}
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Main Navigation">
          <Link to="/join">
            <Button
              variant="ghost"
              size="sm"
              className={location.pathname === '/join' ? 'bg-slate-100 text-slate-900' : ''}
            >
              <KeyRound className="w-4 h-4 mr-1.5 text-slate-500" aria-hidden="true" />
              Join with Token
            </Button>
          </Link>

          <Link to="/create">
            <Button
              variant="primary"
              size="sm"
              className="gap-1.5 shadow-xs"
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              <span>Create Assessment</span>
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
};
