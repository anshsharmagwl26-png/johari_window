import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/StatusBadge';
import { ProgressBar } from '../components/common/ProgressBar';
import { ConfirmationDialog } from '../components/common/ConfirmationDialog';
import { Checkbox, Input } from '../components/common/FormControls';
import { SessionStatus } from '../types';
import { reissueInvite, bulkReissueUnusedInvites, finalizeSession, fetchSessionDashboard } from '../lib/session-service';
import {
  Users,
  Send,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Copy,
  RefreshCw,
  Plus,
  Trash2,
  Lock,
  ArrowUpRight,
  ShieldAlert,
  Check,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();

  // Mock initial dashboard state for Stage 1 layout verification
  const [metrics, setMetrics] = useState<{
    subjectName: string;
    title: string;
    status: SessionStatus;
    expectedParticipants: number;
    issuedCount: number;
    activeInvites: number;
    completedResponses: number;
    unfilledTarget: number;
    expiresAt: string | null;
    collectNames: boolean;
    allowSmallSample: boolean;
    respondedNames: string[];
  }>({
    subjectName: 'Alex Morgan',
    title: 'Annual Team Dynamics & Leadership 360',
    status: 'open',
    expectedParticipants: 6,
    issuedCount: 6,
    activeInvites: 4,
    completedResponses: 2,
    unfilledTarget: 4,
    expiresAt: null,
    collectNames: true,
    allowSmallSample: false,
    respondedNames: ['David Chen', 'Elena Rostova'],
  });
  const [newlyIssuedTokens, setNewlyIssuedTokens] = useState<string[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState<boolean>(true);

  React.useEffect(() => {
    let isMounted = true;
    async function loadDashboard() {
      if (!sessionId) {
        setIsLoadingDashboard(false);
        return;
      }
      const { metrics: data, error } = await fetchSessionDashboard(sessionId);
      if (!isMounted) return;
      setIsLoadingDashboard(false);
      if (data) {
        setMetrics({
          subjectName: data.subject_name,
          title: data.title,
          status: data.status,
          expectedParticipants: data.expected_participants,
          issuedCount: data.issued_count,
          activeInvites: data.active_invites,
          completedResponses: data.completed_responses,
          unfilledTarget: data.unfilled_target,
          expiresAt: data.expires_at,
          collectNames: data.collect_participant_names,
          allowSmallSample: data.allow_small_sample_results,
          respondedNames: data.responded_names || [],
        });
      }
    }
    loadDashboard();
    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [allCopied, setAllCopied] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showOptInModal, setShowOptInModal] = useState(false);
  const [optInAck, setOptInAck] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  // Stage 3C Reissuance States
  const [showBulkReissueModal, setShowBulkReissueModal] = useState(false);
  const [showSingleReissueModal, setShowSingleReissueModal] = useState(false);
  const [singleInviteIdInput, setSingleInviteIdInput] = useState('');
  const [isReissuing, setIsReissuing] = useState(false);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [reissueSuccessMsg, setReissueSuccessMsg] = useState<string | null>(null);

  const canFinalize =
    metrics.completedResponses >= 5 || (metrics.allowSmallSample && metrics.completedResponses >= 1);

  const handleCopyLink = (url: string, index: number) => {
    navigator.clipboard.writeText(url);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyAll = () => {
    if (newlyIssuedTokens.length === 0) return;
    navigator.clipboard.writeText(newlyIssuedTokens.join('\n'));
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const handleFinalize = async () => {
    if (!sessionId) return;
    setIsFinalizing(true);
    const { result, error } = await finalizeSession(sessionId);
    setIsFinalizing(false);
    setShowFinalizeModal(false);
    if (error) {
      alert(`Finalization failed: ${error.message}`);
      return;
    }
    setMetrics((prev) => ({ ...prev, status: 'finalized' }));
    window.location.href = `/results/${sessionId}`;
  };

  const handleEnableOptIn = () => {
    if (!optInAck) return;
    setMetrics((prev) => ({ ...prev, allowSmallSample: true }));
    setShowOptInModal(false);
  };

  const handleBulkReissue = async () => {
    if (!sessionId) return;
    setIsReissuing(true);
    setReissueError(null);
    setReissueSuccessMsg(null);

    const { result, error } = await bulkReissueUnusedInvites(sessionId);
    setIsReissuing(false);
    setShowBulkReissueModal(false);

    if (error) {
      setReissueError(error.message);
      return;
    }

    if (result && result.invites.length > 0) {
      const urls = result.invites.map((inv) => inv.url);
      setNewlyIssuedTokens(urls);
      setReissueSuccessMsg(`Successfully revoked and reissued ${result.reissued_count} unused invitation(s).`);
      setMetrics((prev) => ({
        ...prev,
        issuedCount: prev.issuedCount + result.reissued_count,
      }));
    } else {
      setReissueSuccessMsg('No unused invitations to reissue.');
    }
  };

  const handleSingleReissue = async () => {
    if (!sessionId || !singleInviteIdInput.trim()) return;
    setIsReissuing(true);
    setReissueError(null);
    setReissueSuccessMsg(null);

    const { invite, error } = await reissueInvite(sessionId, singleInviteIdInput.trim());
    setIsReissuing(false);

    if (error) {
      setReissueError(error.message);
      return;
    }

    if (invite) {
      setShowSingleReissueModal(false);
      setSingleInviteIdInput('');
      setNewlyIssuedTokens([invite.url]);
      setReissueSuccessMsg('Successfully revoked old link and generated fresh one-time replacement link.');
      setMetrics((prev) => ({
        ...prev,
        issuedCount: prev.issuedCount + 1,
      }));
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={metrics.status} />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Session ID: {sessionId || 'sample-session-123'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {metrics.title}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Subject: <strong className="text-slate-800">{metrics.subjectName}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {metrics.status === 'finalized' ? (
            <Link to={`/results/${sessionId || 'sample-session-123'}`}>
              <Button variant="primary" className="gap-2 shadow-xs">
                <span>View Final Johari Window</span>
                <ArrowUpRight className="w-4 h-4" />
              </Button>
            </Link>
          ) : (
            <Button
              variant="primary"
              disabled={!canFinalize}
              onClick={() => setShowFinalizeModal(true)}
              className="gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Finalize Session</span>
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDeleteModal(true)}
            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            title="Permanently Delete Session"
          >
            <Trash2 className="w-4 h-4" />
            <span className="sr-only">Delete Session</span>
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Target Target</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900">
            {metrics.expectedParticipants}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Expected feedback goal</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Completed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600">
            {metrics.completedResponses}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Submitted responses</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Links</span>
            <Send className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-indigo-600">
            {metrics.activeInvites}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Unused invitation tokens</p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Unfilled Goal</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-700">
            {metrics.unfilledTarget}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Responses still needed</p>
        </Card>
      </div>

      {/* Progress Bar */}
      <Card className="p-6">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Feedback Collection Progress</h3>
        <ProgressBar
          value={metrics.completedResponses}
          max={metrics.expectedParticipants}
          label="Progress toward target"
        />

        {metrics.completedResponses < 5 && !metrics.allowSmallSample && (
          <div className="mt-4 p-3.5 rounded-xl border border-amber-200 bg-amber-50/70 text-xs text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>
                <strong>Privacy Threshold:</strong> Finalization is blocked until 5 responses are collected ({5 - metrics.completedResponses} more needed).
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOptInModal(true)}
              className="bg-white border-amber-300 text-amber-900 hover:bg-amber-100 flex-shrink-0"
            >
              Opt In to Low-Sample Results
            </Button>
          </div>
        )}
      </Card>

      {/* Invitation Links & Management (Stage 3C) */}
      <Card className="border-indigo-200 bg-indigo-50/20">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base text-indigo-950 flex items-center gap-2">
                <span>Active Invitation Links & Recovery</span>
                {newlyIssuedTokens.length > 0 && (
                  <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-semibold">
                    {newlyIssuedTokens.length} Disclosed
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-xs text-indigo-800 mt-1">
                Share these individual links with participants. Each link contains a single-use token in its URL fragment.
              </CardDescription>
            </div>
            {newlyIssuedTokens.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyAll}
                className="gap-1.5 h-8 text-xs bg-white border-indigo-200 text-indigo-900 hover:bg-indigo-50 self-start sm:self-auto"
              >
                {allCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{allCopied ? 'All Copied!' : 'Copy All Links'}</span>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Recovery & Security Notice */}
          <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-lg text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Security & Recovery Policy:</p>
              <p>
                <strong>Lost plaintext invitation links cannot be recovered.</strong> Plaintext tokens exist only in memory upon issuance and are never stored in the database (only SHA-256 digests are stored). If a participant misplaces their link, you must revoke and replace their unused invitation below. Previously submitted invitations can never be reissued.
              </p>
            </div>
          </div>

          {/* Feedback & status notices */}
          {reissueSuccessMsg && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{reissueSuccessMsg}</span>
            </div>
          )}

          {reissueError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{reissueError}</span>
            </div>
          )}

          {/* Newly Disclosed Plaintext Links */}
          {newlyIssuedTokens.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">One-Time Plaintext Link Disclosure:</p>
              {newlyIssuedTokens.map((url, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-700 overflow-hidden"
                >
                  <span className="truncate flex-1">{url}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyLink(url, idx)}
                    className="flex-shrink-0 gap-1.5 h-8 text-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedIndex === idx ? 'Copied!' : 'Copy Link'}</span>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic py-2">
              Plaintext links have been cleared from memory. Use the reissuance actions below if replacement links are needed.
            </p>
          )}
        </CardContent>

        <CardFooter className="text-xs text-slate-500 border-t border-indigo-100 bg-white/50 pt-3 flex flex-wrap gap-2 justify-between items-center">
          <div className="flex items-center gap-2">
            <span>
              Lifetime invitations: <strong>{metrics.issuedCount}</strong> / 200 (cap)
            </span>
            {metrics.issuedCount >= 180 && (
              <span className="text-amber-600 font-semibold text-[11px]">
                (Approaching 200 limit)
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSingleReissueModal(true)}
              disabled={isReissuing || metrics.status !== 'open'}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reissue Individual Link</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowBulkReissueModal(true)}
              disabled={isReissuing || metrics.status !== 'open' || metrics.activeInvites === 0}
              className="h-8 text-xs gap-1.5 bg-indigo-50/50 text-indigo-900 border-indigo-200 hover:bg-indigo-100"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Bulk Reissue All Unused ({metrics.activeInvites})</span>
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Responded List (Only when collect_participant_names = true) */}
      {metrics.collectNames && (
        <Card>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base">Responded Participants ({metrics.respondedNames.length})</CardTitle>
            <CardDescription className="text-xs">
              Alphabetical list of respondents who submitted feedback. Individual adjective selections, tokens, and timestamps are never shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {metrics.respondedNames.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {metrics.respondedNames.sort().map((name, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-100 bg-slate-50/60 text-xs font-medium text-slate-800"
                  >
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No responses received yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Opt-In Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showOptInModal}
        title="Opt In to Low-Sample Results (< 5 Responses)"
        description={
          <div className="space-y-3 text-xs">
            <p>
              By default, finalization is blocked until 5 valid participant responses are collected to preserve feedback privacy.
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
              <p className="text-amber-900 font-semibold">Affirmative Acknowledgement Required:</p>
              <Checkbox
                id="optInAck"
                checked={optInAck}
                onChange={(e) => setOptInAck(e.target.checked)}
                label="I understand that results from fewer than 5 respondents can reveal or strongly imply an individual's answers, and I acknowledge that these results will display a persistent privacy warning."
              />
            </div>
          </div>
        }
        confirmLabel="Enable Low-Sample Override"
        cancelLabel="Keep Standard 5-Response Rule"
        onConfirm={handleEnableOptIn}
        onCancel={() => setShowOptInModal(false)}
      />

      {/* Bulk Reissue Confirmation Dialog (Stage 3C) */}
      <ConfirmationDialog
        isOpen={showBulkReissueModal}
        title={`Bulk Reissue All Unused Invitations (${metrics.activeInvites})?`}
        description={
          <div className="space-y-2 text-xs">
            <p>
              This atomic operation will permanently revoke all <strong>{metrics.activeInvites}</strong> unused invitation links for this session and immediately generate fresh 256-bit cryptographically secure replacement links.
            </p>
            <p className="text-amber-800 bg-amber-50 p-2.5 rounded border border-amber-200">
              <strong>Notice:</strong> Anyone possessing an old, unused invitation link will be rejected. Previously submitted participant responses are permanent and cannot be affected.
            </p>
          </div>
        }
        confirmLabel="Revoke & Bulk Reissue"
        isLoading={isReissuing}
        onConfirm={handleBulkReissue}
        onCancel={() => setShowBulkReissueModal(false)}
      />

      {/* Single Reissue Dialog (Stage 3C) */}
      <ConfirmationDialog
        isOpen={showSingleReissueModal}
        title="Reissue Individual Invitation"
        description={
          <div className="space-y-3 text-xs">
            <p>
              Revoke an individual lost or expired unused invitation and generate a fresh one-time replacement link.
            </p>
            <div className="space-y-1">
              <label className="text-slate-700 font-semibold text-xs block">
                Old Invitation UUID:
              </label>
              <Input
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                value={singleInviteIdInput}
                onChange={(e) => setSingleInviteIdInput(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <p className="text-slate-500 text-[11px]">
              Note: Only unused ('issued') invitations can be replaced. If the invitation has already been submitted, reissuance will be rejected by the database.
            </p>
          </div>
        }
        confirmLabel="Revoke & Replace"
        isLoading={isReissuing}
        disabled={!singleInviteIdInput.trim()}
        onConfirm={handleSingleReissue}
        onCancel={() => {
          setShowSingleReissueModal(false);
          setSingleInviteIdInput('');
        }}
      />

      <ConfirmationDialog
        isOpen={showFinalizeModal}
        title="Finalize Session & Compute Johari Window?"
        description={
          <div className="space-y-2 text-xs">
            <p>
              This atomic transaction will lock the session, revoke all remaining unused invitation links, and run the authoritative quadrant set math across all {metrics.completedResponses} committed responses.
            </p>
            <p className="font-semibold text-slate-800">
              This action cannot be undone. No further responses will be accepted.
            </p>
          </div>
        }
        confirmLabel="Finalize & Lock"
        isLoading={isFinalizing}
        onConfirm={handleFinalize}
        onCancel={() => setShowFinalizeModal(false)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteModal}
        title="Permanently Delete Assessment Session?"
        description="This will execute a hard cascade deletion of the session, all invitation hashes, participant rows, self-assessment entries, and responses. This action is irreversible."
        confirmLabel="Delete Permanently"
        isDestructive={true}
        onConfirm={() => {
          setShowDeleteModal(false);
          window.location.href = '/';
        }}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
};
