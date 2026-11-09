import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card';
import { Input, Label } from '../components/common/FormControls';
import { AdjectiveChip } from '../components/common/AdjectiveChip';
import { SelectionCounter } from '../components/common/SelectionCounter';
import { Button } from '../components/common/Button';
import { ConfirmationDialog } from '../components/common/ConfirmationDialog';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';
import { isValidTokenFormat } from '../lib/tokens';
import {
  validateParticipantToken,
  submitParticipantFeedback,
  ParticipantTokenValidation,
} from '../lib/session-service';
import {
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Lock,
  Search,
  Clock,
  UserCheck,
  EyeOff,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

export const InviteEntryPage: React.FC = () => {
  // Plaintext token held strictly in memory for current interaction
  const [tokenInMemory, setTokenInMemory] = useState<string>('');
  const [isValidating, setIsValidating] = useState<boolean>(true);
  const [validationState, setValidationState] = useState<{
    status: 'loading' | 'valid' | 'invalid' | 'already_submitted' | 'expired' | 'revoked' | 'rate_limited';
    message?: string;
    meta?: ParticipantTokenValidation;
  }>({ status: 'loading' });

  // Participant Form State
  const [participantName, setParticipantName] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);

  useEffect(() => {
    // 1. Extract token strictly from URL fragment (#<token>)
    const rawFragment = window.location.hash.replace(/^#/, '').trim();

    if (!rawFragment) {
      setIsValidating(false);
      setValidationState({
        status: 'invalid',
        message: 'No invitation token found in the URL. Please verify your complete invitation link or join via the token entry page.',
      });
      return;
    }

    if (!isValidTokenFormat(rawFragment)) {
      setIsValidating(false);
      setValidationState({
        status: 'invalid',
        message: 'Invalid invitation token format. 256-bit unpadded Base64URL token (43 characters) required.',
      });
      return;
    }

    // 2. Retain token strictly in component state memory
    setTokenInMemory(rawFragment);

    // 3. Immediately remove token fragment from browser address bar & history to prevent leakage
    window.history.replaceState(null, '', window.location.pathname);

    // 4. Perform read-only token validation over HTTPS POST
    async function runValidation(token: string) {
      setIsValidating(true);
      const { data, error } = await validateParticipantToken(token);

      setIsValidating(false);

      if (error || !data) {
        setValidationState({
          status: 'invalid',
          message: error?.message || 'Failed to validate invitation token.',
        });
        return;
      }

      if (!data.valid) {
        if (data.reason === 'already_submitted') {
          setValidationState({
            status: 'already_submitted',
            message: 'This invitation token has already been submitted and cannot be reused. Each invitation is strictly single-use.',
          });
        } else if (data.reason === 'session_expired') {
          setValidationState({
            status: 'expired',
            message: 'This assessment session has expired. Participant submissions are no longer accepted.',
          });
        } else if (data.reason === 'revoked') {
          setValidationState({
            status: 'revoked',
            message: 'This invitation was revoked or reissued by the session owner.',
          });
        } else if (data.reason === 'rate_limited') {
          setValidationState({
            status: 'rate_limited',
            message: 'Too many requests. Please wait a moment before trying again.',
          });
        } else {
          setValidationState({
            status: 'invalid',
            message: data.message || 'This invitation link is invalid or the session is not open for feedback.',
          });
        }
        return;
      }

      setValidationState({
        status: 'valid',
        meta: data,
      });
    }

    runValidation(rawFragment);
  }, []);

  const filteredAdjectives = useMemo(() => {
    if (!searchQuery.trim()) return CANONICAL_ADJECTIVES;
    const q = searchQuery.toLowerCase().trim();
    return CANONICAL_ADJECTIVES.filter((adj) => adj.adjective.toLowerCase().includes(q));
  }, [searchQuery]);

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 7) return prev;
      return [...prev, id];
    });
  };

  const handleValidateName = (): boolean => {
    if (!validationState.meta?.collect_participant_names) return true;
    const clean = participantName.trim();
    if (!clean) {
      setNameError('Please enter your name (required by the session owner).');
      return false;
    }
    if (clean.length > 80) {
      setNameError('Name cannot exceed 80 characters.');
      return false;
    }
    // Indian multilingual characters, letters, spaces, combining marks
    const validRegex = /^[\p{L}\p{M}\s.'(),-]+$/u;
    if (!validRegex.test(clean)) {
      setNameError('Name contains invalid characters.');
      return false;
    }
    setNameError(null);
    return true;
  };

  const handleOpenConfirmModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length < 5 || selectedIds.length > 7) return;
    if (!handleValidateName()) return;
    setShowConfirmModal(true);
  };

  const handleFinalSubmit = async () => {
    if (selectedIds.length < 5 || selectedIds.length > 7) return;
    if (!tokenInMemory) {
      setSubmitError('Missing token in memory. Please reload your invitation link.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const { success, error } = await submitParticipantFeedback({
      token: tokenInMemory,
      adjective_ids: selectedIds,
      participant_name: validationState.meta?.collect_participant_names ? participantName.trim() : undefined,
    });

    setIsSubmitting(false);

    if (error || !success) {
      setSubmitError(error?.message || 'Submission failed. Please check your connection and retry.');
      return;
    }

    setShowConfirmModal(false);
    setIsSubmitted(true);
  };

  // State: Loading & Validation
  if (isValidating) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-12 h-12 rounded-full border-3 border-indigo-600 border-t-transparent animate-spin mx-auto shadow-2xs" />
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Verifying Invitation Credential</h2>
        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
          Checking single-use invitation status securely. Opening or previewing this link does not consume your token.
        </p>
      </div>
    );
  }

  // State: Already Submitted
  if (validationState.status === 'already_submitted') {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-8 rounded-2xl border border-slate-200 bg-white shadow-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Invitation Already Used</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            {validationState.message || 'This invitation token has already been submitted and cannot be reused.'}
          </p>
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={() => (window.location.href = '/join')}>
              Join with Another Token
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // State: Expired Session
  if (validationState.status === 'expired') {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-8 rounded-2xl border border-slate-200 bg-white shadow-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Assessment Expired</h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            {validationState.message || 'The feedback window for this Johari assessment has ended.'}
          </p>
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={() => (window.location.href = '/')}>
              Return Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // State: Invalid / Revoked / Rate-Limited
  if (validationState.status !== 'valid' && !isSubmitted) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="p-8 rounded-2xl border border-rose-200 bg-rose-50/60 shadow-sm text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-rose-950">Invalid Invitation Link</h2>
          <p className="text-xs text-rose-800 leading-relaxed">
            {validationState.message || 'We could not verify this invitation token.'}
          </p>
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
            <Button variant="primary" size="sm" onClick={() => (window.location.href = '/join')}>
              Enter Token on /join
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // State: Submitted Success Screen
  if (isSubmitted) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="p-8 rounded-3xl border border-emerald-200 bg-emerald-50/70 shadow-sm space-y-5">
          <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-2xs">
            <CheckCircle2 className="w-9 h-9 stroke-[2.2]" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-emerald-950 tracking-tight">Feedback Submitted Successfully!</h2>
            <p className="text-xs text-emerald-800 leading-relaxed max-w-md mx-auto">
              Thank you for contributing to <strong>{validationState.meta?.subject_name}</strong>'s Johari Window assessment. Your {selectedIds.length} adjective selections have been recorded securely.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white/80 border border-emerald-200 text-left text-xs space-y-2 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Participation Privacy &amp; Token Invalidation</span>
            </div>
            <p className="text-emerald-800 leading-relaxed text-[11px]">
              • Your single-use invitation credential has been consumed and cannot be reused.<br />
              • Individual responses are never shown to the subject; they are aggregated mathematically into the Johari quadrants during session finalization.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => (window.location.href = '/')}>
              Return to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const meta = validationState.meta!;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      {/* Session Header Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5 bg-indigo-50 px-2.5 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" />
            Verified Single-Use Invitation
          </span>
          <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Anonymous Peer Feedback
          </span>
        </div>

        <div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Johari 360 Feedback</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-0.5">
            Describe <span className="text-indigo-600">{meta.subject_name}</span>
          </h1>
          <p className="text-sm font-medium text-slate-600 mt-1">{meta.title}</p>
          {meta.description && (
            <p className="text-xs text-slate-500 mt-2 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed">
              {meta.description}
            </p>
          )}
        </div>

        <div className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-100/70 text-xs text-indigo-950 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed text-[11px] text-indigo-900">
            Select between <strong>5 and 7 adjectives</strong> that best describe <strong>{meta.subject_name}</strong> in your experience. Your choices are combined with other peer evaluations to reveal blind spots and hidden strengths upon finalization.
          </p>
        </div>
      </div>

      <form onSubmit={handleOpenConfirmModal} className="space-y-6">
        {/* Name Collection Section */}
        {meta.collect_participant_names ? (
          <Card className="border-indigo-100 bg-white">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <CardTitle className="text-base">Your Name</CardTitle>
              </div>
              <CardDescription>
                The assessment owner requested participant names for their alphabetical &quot;Responded&quot; attendance list.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="participantName" required>
                Full Name or Alias
              </Label>
              <Input
                id="participantName"
                value={participantName}
                onChange={(e) => {
                  setParticipantName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g., Jane Doe / Priya Sharma"
                maxLength={80}
                error={nameError || undefined}
                required
              />
              <p className="text-[11px] text-slate-500">
                Privacy guarantee: Your name will never be linked to your adjective selections or displayed in assessment results.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="p-4 rounded-2xl bg-white border border-slate-200 text-xs flex items-center justify-between text-slate-600 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                <EyeOff className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-slate-800">Anonymous Assessment</span>
                <p className="text-[11px] text-slate-500">Name collection is disabled for this session. Your participation is completely anonymous.</p>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Anonymous
            </span>
          </div>
        )}

        {/* Adjective Selector Card */}
        <Card className="shadow-xs overflow-hidden">
          <CardHeader className="pb-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base text-slate-900">
                Select 5 to 7 Adjectives for {meta.subject_name}
              </CardTitle>
              <CardDescription className="text-xs">
                Pick between 5 and 7 adjectives from the canonical 55-adjective inventory.
              </CardDescription>
            </div>
            <SelectionCounter currentCount={selectedIds.length} min={5} max={7} />
          </CardHeader>

          {/* Search Bar */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="relative max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search adjectives (e.g., confident, empathetic)..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>
          </div>

          <CardContent className="pt-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
              {filteredAdjectives.map((adj) => {
                const isSelected = selectedIds.includes(adj.id);
                const isDisabled = selectedIds.length >= 7 && !isSelected;

                return (
                  <AdjectiveChip
                    key={adj.id}
                    id={adj.id}
                    label={adj.adjective}
                    isSelected={isSelected}
                    disabled={isDisabled}
                    onToggle={handleToggle}
                    className="w-full justify-start"
                  />
                );
              })}
            </div>

            {filteredAdjectives.length === 0 && (
              <p className="text-center text-xs text-slate-500 py-8">
                No adjectives match &quot;{searchQuery}&quot;. Clear search to view all 55 adjectives.
              </p>
            )}
          </CardContent>

          <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/60 border-t border-slate-100">
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              Submitting permanently consumes this invitation token.
            </span>

            <Button
              type="submit"
              variant="primary"
              disabled={selectedIds.length < 5 || selectedIds.length > 7}
              className="w-full sm:w-auto gap-2"
            >
              <span>Review &amp; Submit Feedback</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </CardFooter>
        </Card>
      </form>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirmModal}
        onCancel={() => setShowConfirmModal(false)}
        title="Confirm Your Feedback Submission"
        confirmLabel={isSubmitting ? 'Submitting...' : 'Confirm & Submit Feedback'}
        cancelLabel="Review Selections"
        onConfirm={handleFinalSubmit}
        isLoading={isSubmitting}
        description={
          <div className="space-y-4 text-left">
            <p className="text-xs text-slate-600 leading-relaxed">
              You are about to submit feedback for <strong>{meta.subject_name}</strong>. Please confirm your {selectedIds.length} adjective choices below:
            </p>

            <div className="flex flex-wrap gap-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              {selectedIds.map((id) => {
                const adj = CANONICAL_ADJECTIVES.find((a) => a.id === id);
                return (
                  <span
                    key={id}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80"
                  >
                    {adj?.adjective || id}
                  </span>
                );
              })}
            </div>

            {meta.collect_participant_names && (
              <p className="text-xs text-slate-600">
                Submitting as: <strong className="text-slate-900">{participantName.trim()}</strong>
              </p>
            )}

            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-[11px] text-amber-900 leading-relaxed">
              <strong>Single-Use Warning:</strong> Submitting will immediately invalidate and consume your invitation token. You will not be able to edit or resubmit your feedback.
            </div>

            {submitError && (
              <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
                {submitError}
              </div>
            )}
          </div>
        }
      />
    </div>
  );
};
