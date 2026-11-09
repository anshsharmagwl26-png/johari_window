import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/StatusBadge';
import { fetchSessionResults, FinalizedResultsSnapshot, FinalizedSnapshotAdjective } from '../lib/session-service';
import { generateJohariResultsPdf } from '../lib/pdf-export';
import {
  Download,
  Eye,
  EyeOff,
  HelpCircle,
  LayoutGrid,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Lock,
  Info,
} from 'lucide-react';

export const ResultsPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();

  const [snapshot, setSnapshot] = useState<FinalizedResultsSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<{ message: string; isUnfinalized: boolean; isUnauthorized: boolean } | null>(null);
  const [showAllUnknown, setShowAllUnknown] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function loadResults() {
      if (!sessionId) {
        setError({ message: 'No session ID provided.', isUnfinalized: false, isUnauthorized: false });
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const { snapshot: data, error: err } = await fetchSessionResults(sessionId);
      if (!isMounted) return;

      if (err) {
        const msg = err.message || 'Failed to load results.';
        const isUnfinalized = msg.includes('not yet finalized');
        const isUnauthorized = msg.includes('Unauthorized') || msg.includes('401') || msg.includes('403');
        setError({ message: msg, isUnfinalized, isUnauthorized });
        setLoading(false);
        return;
      }

      setSnapshot(data);
      setLoading(false);
    }

    loadResults();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  // Loading state
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-600" aria-label="Loading results..." />
        <h2 className="text-xl font-bold text-slate-800">Loading Authoritative Results...</h2>
        <p className="text-sm text-slate-500">Retrieving calculated Johari Window snapshot from database.</p>
      </div>
    );
  }

  // Error / Unfinalized / Unauthorized state
  if (error || !snapshot) {
    const isUnfinalized = error?.isUnfinalized;
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <Card className="p-8 text-center border-amber-200 bg-amber-50/40">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4">
            {isUnfinalized ? <Lock className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {isUnfinalized ? 'Session Results Not Yet Finalized' : 'Unable to Access Results'}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto mb-6">
            {isUnfinalized
              ? 'Results are only accessible once the session is finalized by the session owner. While the session remains in draft or open status, results cannot be computed or viewed.'
              : error?.message || 'The requested session results could not be found or you do not have permission to view them.'}
          </p>
          <div className="flex justify-center gap-3">
            <Link to={`/dashboard/${sessionId || ''}`}>
              <Button variant="primary" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Owner Dashboard</span>
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Group adjectives into quadrants strictly from the snapshot
  const openAdjectives = snapshot.adjectives.filter((a) => a.quadrant === 'open');
  const blindAdjectives = snapshot.adjectives.filter((a) => a.quadrant === 'blind');
  const hiddenAdjectives = snapshot.adjectives.filter((a) => a.quadrant === 'hidden');
  const unknownAdjectives = snapshot.adjectives.filter((a) => a.quadrant === 'unknown');

  const participantCount = snapshot.participant_count;
  const isLowSample = participantCount < 5;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status="finalized" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Authoritative Johari Window • Snapshot v{snapshot.calculation_version}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Assessment Results: {snapshot.subject_name}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Calculated from {participantCount} valid feedback participant submission{participantCount === 1 ? '' : 's'} across all 55 canonical adjectives.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link to={`/dashboard/${sessionId}`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Button>
          </Link>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (snapshot) {
                generateJohariResultsPdf(snapshot);
              }
            }}
            className="gap-2 shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>Export PDF</span>
          </Button>
        </div>
      </div>

      {/* Low-Sample Warning (Required when participant_count < 5) */}
      {isLowSample && (
        <div
          role="alert"
          aria-live="polite"
          className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-3 shadow-xs"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-bold text-amber-900">
              Small-sample privacy warning: results may reveal individual feedback when participation is limited.
            </p>
            <p className="text-amber-800 leading-relaxed">
              These results were finalized with fewer than 5 feedback responses ({participantCount} response{participantCount === 1 ? '' : 's'}) under an explicit owner opt-in. Because the sample size is small, individual answers may be deduced through social inference and context. These results are not guaranteed to be anonymous.
            </p>
          </div>
        </div>
      )}

      {/* Self-Awareness & Communication Disclaimer */}
      <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center gap-2.5">
        <Info className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
        <span>
          <strong>Disclaimer:</strong> This is a communication and self-awareness exercise, not a clinical personality assessment.
        </span>
      </div>

      {/* Equal-Sized 2x2 Johari Window Grid */}
      <section aria-label="Johari Window Grid" className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* TOP LEFT: OPEN AREA */}
        <Card className="border-indigo-200 bg-indigo-50/20 flex flex-col min-h-[320px]">
          <CardHeader className="pb-3 border-b border-indigo-100/70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-700">
                <Eye className="w-5 h-5 stroke-[2.2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Top Left • Open Area (Arena)</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                {openAdjectives.length} words
              </span>
            </div>
            <CardTitle className="text-base text-slate-900 mt-1">Known to Self &amp; Known to Others</CardTitle>
            <CardDescription className="text-xs">
              Adjectives selected by both you in self-assessment and your peers.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4 flex-1">
            {openAdjectives.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {openAdjectives.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-indigo-200 text-indigo-900 shadow-2xs"
                  >
                    <span>{item.word}</span>
                    <span
                      title={`${item.feedback_count} feedback participant(s) selected this trait`}
                      className="px-1.5 py-0.2 rounded bg-indigo-100 text-[10px] text-indigo-700 font-mono font-bold"
                    >
                      {item.feedback_count}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-indigo-100/40 text-indigo-900 text-xs">
                <p className="font-semibold mb-0.5">Empty Quadrant</p>
                <p className="text-[11px] text-indigo-800">
                  No traits were shared between self-assessment and peer feedback.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TOP RIGHT: BLIND AREA */}
        <Card className="border-amber-200 bg-amber-50/20 flex flex-col min-h-[320px]">
          <CardHeader className="pb-3 border-b border-amber-100/70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-700">
                <HelpCircle className="w-5 h-5 stroke-[2.2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Top Right • Blind Area (Blind Spot)</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                {blindAdjectives.length} words
              </span>
            </div>
            <CardTitle className="text-base text-slate-900 mt-1">Unknown to Self &amp; Known to Others</CardTitle>
            <CardDescription className="text-xs">
              Traits seen by peers that you did not identify in self-assessment.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4 flex-1">
            {blindAdjectives.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {blindAdjectives.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-amber-200 text-amber-900 shadow-2xs"
                  >
                    <span>{item.word}</span>
                    <span
                      title={`${item.feedback_count} feedback participant(s) selected this trait`}
                      className="px-1.5 py-0.2 rounded bg-amber-100 text-[10px] text-amber-700 font-mono font-bold"
                    >
                      {item.feedback_count}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-amber-100/40 text-amber-900 text-xs">
                <p className="font-semibold mb-0.5">Empty Quadrant</p>
                <p className="text-[11px] text-amber-800">
                  No traits were selected exclusively by peers.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BOTTOM LEFT: HIDDEN AREA */}
        <Card className="border-teal-200 bg-teal-50/20 flex flex-col min-h-[320px]">
          <CardHeader className="pb-3 border-b border-teal-100/70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-teal-700">
                <EyeOff className="w-5 h-5 stroke-[2.2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Bottom Left • Hidden Area (Façade)</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                {hiddenAdjectives.length} words
              </span>
            </div>
            <CardTitle className="text-base text-slate-900 mt-1">Known to Self &amp; Unknown to Others</CardTitle>
            <CardDescription className="text-xs">
              Self-selected adjectives that no peers selected for you.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4 flex-1">
            {hiddenAdjectives.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {hiddenAdjectives.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-teal-200 text-teal-900 shadow-2xs"
                  >
                    <span>{item.word}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-teal-100/40 text-teal-900 text-xs">
                <p className="font-semibold mb-0.5">Empty Quadrant</p>
                <p className="text-[11px] text-teal-800">
                  All of your self-selected adjectives were also recognized by at least one feedback participant.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* BOTTOM RIGHT: UNKNOWN AREA */}
        <Card className="border-slate-200 bg-slate-50/50 flex flex-col min-h-[320px]">
          <CardHeader className="pb-3 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-700">
                <LayoutGrid className="w-5 h-5 stroke-[2.2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Bottom Right • Unknown Area</span>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                {unknownAdjectives.length} words
              </span>
            </div>
            <CardTitle className="text-base text-slate-900 mt-1">Unknown to Self &amp; Unknown to Others</CardTitle>
            <CardDescription className="text-xs">
              Adjectives from the 55-word bank chosen by neither party.
            </CardDescription>
          </CardHeader>

          {/* Internally scrollable/collapsible container preserving 2x2 grid geometry */}
          <CardContent className="pt-4 flex-1 flex flex-col">
            <div
              className={`flex flex-wrap gap-1.5 overflow-y-auto pr-1 transition-all ${
                showAllUnknown ? 'max-h-56' : 'max-h-36'
              }`}
            >
              {(showAllUnknown ? unknownAdjectives : unknownAdjectives.slice(0, 16)).map((item) => (
                <span
                  key={item.id}
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-600"
                >
                  {item.word}
                </span>
              ))}
            </div>

            <div className="mt-auto pt-3 border-t border-slate-200/80 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Showing {showAllUnknown ? unknownAdjectives.length : Math.min(16, unknownAdjectives.length)} of {unknownAdjectives.length}
              </span>
              {unknownAdjectives.length > 16 && (
                <button
                  type="button"
                  onClick={() => setShowAllUnknown((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none"
                >
                  <span>{showAllUnknown ? 'Show Less' : 'Show All Unknown'}</span>
                  {showAllUnknown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Aggregate Statistics and Parity Verification */}
      <Card className="p-6 bg-white">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Johari Invariant Verification</h3>
        <p className="text-xs text-slate-600 leading-relaxed mb-4">
          All four quadrants are strictly pairwise disjoint and their union is exactly the 55 canonical adjectives:
          Open ({openAdjectives.length}) + Blind ({blindAdjectives.length}) + Hidden ({hiddenAdjectives.length}) + Unknown ({unknownAdjectives.length}) = <strong>{openAdjectives.length + blindAdjectives.length + hiddenAdjectives.length + unknownAdjectives.length} total</strong>.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-3 rounded-lg bg-indigo-50/50 border border-indigo-100">
            <div className="text-xl font-bold text-indigo-700">{openAdjectives.length}</div>
            <div className="text-[10px] font-semibold text-indigo-900 uppercase tracking-wider">Open Area</div>
          </div>
          <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-100">
            <div className="text-xl font-bold text-amber-700">{blindAdjectives.length}</div>
            <div className="text-[10px] font-semibold text-amber-900 uppercase tracking-wider">Blind Area</div>
          </div>
          <div className="p-3 rounded-lg bg-teal-50/50 border border-teal-100">
            <div className="text-xl font-bold text-teal-700">{hiddenAdjectives.length}</div>
            <div className="text-[10px] font-semibold text-teal-900 uppercase tracking-wider">Hidden Area</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-100 border border-slate-200">
            <div className="text-xl font-bold text-slate-700">{unknownAdjectives.length}</div>
            <div className="text-[10px] font-semibold text-slate-900 uppercase tracking-wider">Unknown Area</div>
          </div>
        </div>
      </Card>
    </div>
  );
};
