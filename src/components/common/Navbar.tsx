import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from './Button';
import { LayoutGrid, PlusCircle, LogIn, LogOut, KeyRound, AlertCircle, ShieldAlert } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, signOut, isConfigured } = useAuth();
  const location = useLocation();
  const [showAuthModal, setShowAuthModal] = useState(false);

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
              variant="outline"
              size="sm"
              className={location.pathname === '/create' ? 'border-indigo-200 text-indigo-700 bg-indigo-50/50' : ''}
            >
              <PlusCircle className="w-4 h-4 mr-1.5" aria-hidden="true" />
              New Assessment
            </Button>
          </Link>

          {/* Auth State Button */}
          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <span className="text-xs text-slate-600 font-medium hidden md:inline-block max-w-[140px] truncate">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => signOut()} title="Sign Out">
                <LogOut className="w-4 h-4 text-slate-500" />
                <span className="sr-only">Sign out</span>
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAuthModal(true)}
              className="gap-1.5"
            >
              <LogIn className="w-4 h-4" aria-hidden="true" />
              <span>Owner Sign In</span>
            </Button>
          )}
        </nav>
      </div>

      {/* Auth Modal / UX */}
      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} isConfigured={isConfigured} />
      )}
    </header>
  );
};

interface AuthModalProps {
  onClose: () => void;
  isConfigured: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, isConfigured }) => {
  const { signInWithMagicLink, verifyOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const res = await signInWithMagicLink(email);
    setIsLoading(false);

    if (res.error) {
      setErrorMessage(res.error.message);
    } else {
      setOtpSent(true);
      setStatusMessage(res.message || 'Check your email for the magic link or 6-digit OTP code.');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return;

    setIsLoading(true);
    setErrorMessage(null);

    const res = await verifyOtp(email, otp);
    setIsLoading(false);

    if (res.error) {
      setErrorMessage(res.error.message);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 id="auth-modal-title" className="text-lg font-bold text-slate-900">
                Owner Authentication
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Passwordless sign in with Email Magic Link / OTP</p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>

          {!isConfigured && (
            <div className="mt-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900 text-xs">
              <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">[Stage 1 Stub] Supabase Not Yet Configured</p>
                <p className="text-amber-800 leading-relaxed">
                  Supabase backend credentials will be connected in Stage 2. This auth modal represents the real owner sign-in UX (email magic link / OTP) but operations are stubbed until Stage 2 database setup.
                </p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {statusMessage && (
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
              {statusMessage}
            </div>
          )}

          {!otpSent ? (
            <form onSubmit={handleSendMagicLink} className="mt-5 space-y-4">
              <div>
                <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Email Address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@example.com"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
                Send Magic Link / OTP
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
              <div>
                <label htmlFor="auth-otp" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Enter 6-Digit Email Code
                </label>
                <input
                  id="auth-otp"
                  type="text"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-center tracking-widest font-mono text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setOtpSent(false)} className="w-1/2">
                  Back
                </Button>
                <Button type="submit" variant="primary" size="sm" className="w-1/2" isLoading={isLoading}>
                  Verify &amp; Sign In
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
