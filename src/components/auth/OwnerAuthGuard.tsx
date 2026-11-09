import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, LogIn } from 'lucide-react';
import { Button } from '../common/Button';
import { LoadingSkeleton } from '../common/LoadingSkeleton';

interface OwnerAuthGuardProps {
  children: React.ReactNode;
}

export const OwnerAuthGuard: React.FC<OwnerAuthGuardProps> = ({ children }) => {
  const { user, loading, isConfigured } = useAuth();

  // If Supabase is configured and actively checking authentication
  if (isConfigured) {
    if (loading) {
      return (
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          <LoadingSkeleton variant="rectangular" className="h-12 w-full" />
          <LoadingSkeleton variant="rectangular" className="h-64 w-full" />
        </div>
      );
    }

    if (!user) {
      return (
        <div className="max-w-md mx-auto my-12 p-8 bg-white border border-slate-200 rounded-2xl shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
            <LogIn className="w-6 h-6" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Owner Authentication Required</h2>
          <p className="text-sm text-slate-600 mb-6">
            This route is protected. Please sign in with your email magic link or OTP to manage your assessment session.
          </p>
          <Button variant="primary" className="w-full" onClick={() => window.location.href = '/'}>
            Return to Home
          </Button>
        </div>
      );
    }

    return <>{children}</>;
  }

  // When Supabase is NOT configured (Stage 1 stub mode)
  return (
    <div className="relative">
      {/* Prominent visual banner identifying non-functional stub state */}
      <div
        role="alert"
        aria-label="Owner Auth Guard Stub Notice"
        className="bg-amber-500/10 border-b border-amber-300 px-4 py-3 text-xs text-amber-900"
      >
        <div className="max-w-6xl mx-auto flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <span className="font-bold uppercase tracking-wider text-amber-800 mr-2">
              [Stage 1 Non-Functional Stub]
            </span>
            <span>
              Owner Authentication Pending Stage 2 Configuration. Real auth enforcement via Supabase Auth (email magic link / OTP) will be connected when database &amp; credentials are configured in Stage 2. This route shell is accessible for layout verification only and does not provide security enforcement.
            </span>
          </div>
        </div>
      </div>

      <div>{children}</div>
    </div>
  );
};
