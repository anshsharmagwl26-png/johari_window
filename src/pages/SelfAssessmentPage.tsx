import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card';
import { AdjectiveChip } from '../components/common/AdjectiveChip';
import { SelectionCounter } from '../components/common/SelectionCounter';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/StatusBadge';
import { ConfirmationDialog } from '../components/common/ConfirmationDialog';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import {
  fetchCanonicalAdjectives,
  fetchSession,
  submitSelfAssessmentAndOpen,
  IssuedInviteResult,
} from '../lib/session-service';
import type { Session, Adjective } from '../types';
import {
  Sparkles,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  Lock,
} from 'lucide-react';

export const SelfAssessmentPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [adjectives, setAdjectives] = useState<Adjective[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // One-time newly minted invitation links result
  const [issuedInvites, setIssuedInvites] = useState<IssuedInviteResult[] | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!sessionId) {
        setErrorMessage('Invalid session ID.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      const [sessionRes, adjRes] = await Promise.all([
        fetchSession(sessionId),
        fetchCanonicalAdjectives(),
      ]);

      if (!isMounted) return;

      if (sessionRes.error || !sessionRes.session) {
        setErrorMessage(sessionRes.error?.message || 'Failed to load session details.');
      } else {
        setSession(sessionRes.session);
      }

      if (adjRes.adjectives && adjRes.adjectives.length > 0) {
        setAdjectives(adjRes.adjectives);
      }

      setIsLoading(false);
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  const isValidSelection = selectedIds.length >= 5 && selectedIds.length <= 7;

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= 7) {
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleConfirmSubmit = async () => {
    if (!sessionId || !isValidSelection) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { result, error } = await submitSelfAssessmentAndOpen(sessionId, selectedIds);

      if (error || !result) {
        setErrorMessage(error?.message || 'Failed to commit self-assessment and open session.');
        setIsSubmitting(false);
        setShowConfirm(false);
        return;
      }

      // Success: Save one-time issued invitation URLs
      setIssuedInvites(result.invites);
      setShowConfirm(false);
      setIsSubmitting(false);

      if (session) {
        setSession({
          ...session,
          status: 'open',
          self_assessment_submitted_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setErrorMessage((err as Error).message || 'An unexpected error occurred during submission.');
      setIsSubmitting(false);
      setShowConfirm(false);
    }
  };

  const handleCopyLink = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyAll = async () => {
    if (!issuedInvites) return;
    try {
      const allText = issuedInvites.map((inv, i) => `Participant ${i + 1}: ${inv.url}`).join('\n');
      await navigator.clipboard.writeText(allText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2500);
    } catch {
      // Fallback
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        <LoadingSkeleton variant="rectangular" className="h-10 w-64" />
        <LoadingSkeleton variant="rectangular" className="h-24 w-full" />
        <LoadingSkeleton variant="rectangular" className="h-96 w-full" />
      </div>
    );
  }

  if (!session && errorMessage) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6 text-rose-600" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Unable to Load Assessment
          </h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
            {errorMessage}
          </p>
        </div>
        <div className="pt-4 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            <span>Retry Connection</span>
          </Button>
          <Button variant="primary" onClick={() => navigate('/create')}>
            <span>Create New Assessment</span>
          </Button>
        </div>
      </div>
    );
  }

  // If session is already open or finalized, self-assessment is immutable
  if (session && session.status !== 'draft') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6 text-slate-600" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <StatusBadge status={session.status} />
            <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Immutable Assessment</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Self-Assessment Already Committed
          </h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
            This Johari Window assessment is currently in <strong className="text-slate-800">{session.status}</strong> status. To preserve evaluation integrity, self-assessments become strictly immutable once the session opens.
          </p>
        </div>
        <div className="pt-4 flex justify-center">
          <Button variant="primary" onClick={() => navigate(`/dashboard/${sessionId}`)}>
            <span>View Session Dashboard</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  // Once submitted, display one-time issued invitation URLs
  if (issuedInvites && issuedInvites.length > 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusBadge status="open" />
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Session Successfully Opened
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Your Initial Invitation Links ({issuedInvites.length})
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your self-assessment has been permanently committed. The initial batch of {issuedInvites.length} participant invitation links has been generated.
          </p>
        </div>

        {/* Security / One-Time Plaintext Notice */}
        <div
          role="alert"
          className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-2 font-bold text-amber-800">
            <ShieldAlert className="w-4 h-4 text-amber-600" aria-hidden="true" />
            <span>One-Time Plaintext Link Disclosure Notice</span>
          </div>
          <p className="text-amber-800 leading-relaxed">
            To protect respondent confidentiality, raw 256-bit tokens are never stored in the database and are returned <strong>only once</strong> in this response. Copy or distribute these individual links now. If any links are lost, you can revoke and reissue them from the dashboard.
          </p>
        </div>

        {/* Invitation Links List */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <CardTitle className="text-base">Initial Participant Invitations</CardTitle>
              <CardDescription>Each link grants single-submission access to one respondent.</CardDescription>
            </div>
            <Button variant="secondary" size="sm" onClick={handleCopyAll} className="whitespace-nowrap">
              {copiedAll ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
                  <span>All Links Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  <span>Copy All ({issuedInvites.length})</span>
                </>
              )}
            </Button>
          </CardHeader>

          <CardContent className="pt-4 divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {issuedInvites.map((inv, idx) => (
              <div key={inv.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <span>Participant {idx + 1}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500 font-mono text-[11px] truncate">ID: {inv.id.slice(0, 8)}...</span>
                  </div>
                  <p className="text-xs font-mono text-slate-600 truncate bg-slate-50 px-2 py-1 rounded border border-slate-200/60 select-all">
                    {inv.url}
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCopyLink(inv.url, idx)}
                    className="text-xs"
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600 mr-1" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        <span>Copy Link</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>

          <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 border-t border-slate-100">
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-slate-400" />
              Links use secure URL fragments (#token) with no-referrer policy.
            </span>
            <Button
              variant="primary"
              onClick={() => navigate(`/dashboard/${sessionId}`)}
              className="w-full sm:w-auto"
            >
              <span>Go to Session Dashboard</span>
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <StatusBadge status="draft" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Phase B • Self-Assessment
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Select Your Adjectives
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-xl">
            Choose between 5 and 7 adjectives from the canonical workshop inventory that you believe best describe you.
          </p>
        </div>

        <SelectionCounter currentCount={selectedIds.length} min={5} max={7} />
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 text-xs flex items-start gap-3 shadow-xs"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-900">Submission Error</p>
            <p className="text-rose-800 leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Immutability Callout */}
      <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/60 text-xs text-indigo-900 flex items-start gap-3 shadow-xs">
        <Sparkles className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold mb-0.5">Strict Evaluation Integrity Notice</p>
          <p className="text-indigo-800 leading-relaxed">
            Once submitted, your self-assessment becomes completely immutable. The session will atomically transition from <strong className="font-semibold">Draft</strong> to <strong className="font-semibold">Open</strong>, generating your initial batch of {session?.expected_participants || 5} participant invitation tokens.
          </p>
        </div>
      </div>

      {/* Adjective Grid (All 55 Canonical Adjectives from Database Bank) */}
      <Card className="shadow-sm">
        <CardHeader className="pb-4 border-b border-slate-100">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Canonical 55-Adjective Inventory</span>
            <span className="text-xs font-normal text-slate-500">
              Sorted alphabetically (1–55)
            </span>
          </CardTitle>
          <CardDescription>
            Click or use keyboard space/enter to toggle selections. Choose exactly 5 to 7 words.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {adjectives.map((adj) => {
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
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50 border-t border-slate-100">
          <div className="text-xs text-slate-600">
            {isValidSelection ? (
              <span className="text-emerald-700 font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Valid selection ready for submission ({selectedIds.length} chosen).
              </span>
            ) : (
              <span>Please select at least 5 and at most 7 adjectives to proceed.</span>
            )}
          </div>

          <Button
            variant="primary"
            disabled={!isValidSelection}
            onClick={() => setShowConfirm(true)}
            className="w-full sm:w-auto"
          >
            <span>Lock &amp; Open Session</span>
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </CardFooter>
      </Card>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirm}
        title="Submit Self-Assessment &amp; Open Session?"
        description={
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              You have selected {selectedIds.length} adjectives:
            </p>
            <div className="flex flex-wrap gap-1.5 p-3 rounded-lg bg-slate-100 text-xs font-medium text-slate-800">
              {selectedIds.map((id) => {
                const match = adjectives.find((a) => a.id === id);
                return (
                  <span key={id} className="bg-white px-2 py-0.5 rounded shadow-2xs border border-slate-200">
                    {match?.adjective || id}
                  </span>
                );
              })}
            </div>
            <p className="text-amber-800 text-xs font-semibold">
              Warning: This action is permanent. You will not be able to modify your self-assessment after opening the session.
            </p>
          </div>
        }
        confirmLabel="Confirm &amp; Open Session"
        cancelLabel="Review Selections"
        isLoading={isSubmitting}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
};
