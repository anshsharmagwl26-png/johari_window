import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card';
import { Input, Textarea, Label, Checkbox } from '../components/common/FormControls';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/StatusBadge';
import { createSession } from '../lib/session-service';
import { useAuth } from '../context/AuthContext';
import { Info, ArrowRight, AlertTriangle, AlertCircle, Sparkles } from 'lucide-react';

export const CreateSessionPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [subjectName, setSubjectName] = useState(user?.user_metadata?.full_name || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedParticipants, setExpectedParticipants] = useState<number>(5);
  const [collectNames, setCollectNames] = useState(false);
  const [allowSmallSample, setAllowSmallSample] = useState(false);
  const [ackSmallSample, setAckSmallSample] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLowTargetWithoutOptIn = expectedParticipants < 5 && !allowSmallSample;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanSubject = subjectName.trim();
    const cleanTitle = title.trim();

    if (!cleanSubject) {
      setErrorMessage('Subject Name is required.');
      return;
    }
    if (!cleanTitle) {
      setErrorMessage('Assessment Title is required.');
      return;
    }
    if (expectedParticipants < 1 || expectedParticipants > 50) {
      setErrorMessage('Expected participants must be between 1 and 50.');
      return;
    }
    if (allowSmallSample && !ackSmallSample) {
      setErrorMessage('You must affirmatively acknowledge the low-sample privacy risk before proceeding.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { session, error } = await createSession({
        subject_name: cleanSubject,
        title: cleanTitle,
        description: description.trim() || undefined,
        expected_participants: expectedParticipants,
        collect_participant_names: collectNames,
        allow_small_sample_results: allowSmallSample,
        ack_small_sample: ackSmallSample,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });

      if (error || !session) {
        setErrorMessage(error?.message || 'Failed to create session. Please check your connection and limits.');
        setIsSubmitting(false);
        return;
      }

      // Successful creation: New session starts in draft; navigate to Phase B Self-Assessment
      navigate(`/assessment/${session.id}`);
    } catch (err) {
      setErrorMessage((err as Error).message || 'An unexpected error occurred.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      {/* Page Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusBadge status="draft" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Phase A • Initial Setup
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Create New Assessment
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Configure assessment parameters. The session will be created in <strong className="text-slate-800">Draft</strong> mode. No invitation tokens will be issued until you complete your 5–7 self-assessment selections in Phase B.
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-rose-300 bg-rose-50 text-rose-900 text-xs flex items-start gap-3 shadow-xs"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-900">Session Creation Failed</p>
            <p className="text-rose-800 leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      <Card className="shadow-sm">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Session Details</CardTitle>
            <CardDescription>Enter subject and workshop feedback parameters.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Subject Name */}
            <div>
              <Label htmlFor="subjectName" required>Subject Name (You)</Label>
              <Input
                id="subjectName"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="e.g., Alex Morgan"
                maxLength={80}
                required
              />
              <p className="text-xs text-slate-500 mt-1">The person this Johari assessment describes.</p>
            </div>

            {/* Assessment Title */}
            <div>
              <Label htmlFor="title" required>Assessment Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Annual Team Dynamics &amp; Leadership 360"
                maxLength={120}
                required
              />
            </div>

            {/* Expected Participants */}
            <div>
              <Label htmlFor="expectedParticipants" required>Expected Participants (1–50)</Label>
              <Input
                id="expectedParticipants"
                type="number"
                min={1}
                max={50}
                value={expectedParticipants}
                onChange={(e) => setExpectedParticipants(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Target used for progress tracking and initial invitation batch generation upon opening (1–50).
              </p>
            </div>

            {/* Low Target Warning */}
            {isLowTargetWithoutOptIn && (
              <div
                role="alert"
                className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs space-y-2"
              >
                <div className="flex items-center gap-2 font-bold text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  <span>Small-sample privacy warning: results may reveal individual feedback when participation is limited.</span>
                </div>
                <p className="text-amber-800 leading-relaxed">
                  Finalization requires at least 5 valid participant responses by default to reduce individual response inference. Because your expected target is {expectedParticipants}, finalization will be blocked unless you explicitly enable the low-sample results override below.
                </p>
              </div>
            )}

            {/* Description */}
            <div>
              <Label htmlFor="description">Optional Context or Instructions</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Reflective exercise for the product engineering offsite."
                maxLength={500}
                rows={3}
              />
              <p className="text-xs text-slate-400 mt-1">{description.length}/500 characters</p>
            </div>

            {/* Optional Expiration */}
            <div>
              <Label htmlFor="expiresAt">Optional Session Expiry Date &amp; Time (UTC)</Label>
              <Input
                id="expiresAt"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-slate-500 mt-1">
                Participant submissions are blocked when expired according to server/database time.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Privacy &amp; Identity Settings</h4>

              {/* Collect Participant Names */}
              <Checkbox
                id="collectNames"
                checked={collectNames}
                onChange={(e) => setCollectNames(e.target.checked)}
                label="Collect participant names (Off by default)"
                description="When enabled, respondents enter their name for an owner-only alphabetical 'Responded' list. Names are never linked to specific adjective choices, tokens, timestamps, or results."
              />

              {/* Allow Small Sample */}
              <div className="space-y-3 pt-2">
                <Checkbox
                  id="allowSmallSample"
                  checked={allowSmallSample}
                  onChange={(e) => {
                    setAllowSmallSample(e.target.checked);
                    if (!e.target.checked) setAckSmallSample(false);
                  }}
                  label="Allow results with fewer than 5 feedback responses"
                  description="By default, results require at least 5 responses to protect participant privacy. Checking this permits finalization with 1–4 responses."
                />

                {allowSmallSample && (
                  <div className="ml-7 p-3.5 rounded-lg border border-rose-200 bg-rose-50/70 space-y-2">
                    <p className="text-xs text-rose-900 font-semibold">
                      Required Low-Sample Acknowledgement:
                    </p>
                    <Checkbox
                      id="ackSmallSample"
                      checked={ackSmallSample}
                      onChange={(e) => setAckSmallSample(e.target.checked)}
                      label={
                        <span className="text-xs text-rose-900 font-medium">
                          Small-sample privacy warning: results may reveal individual feedback when participation is limited. I understand that results from fewer than 5 respondents can reveal or strongly imply an individual's answers, and I acknowledge that these results will display a persistent privacy warning.
                        </span>
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50 border-t border-slate-100">
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-400" />
              Next step: Self-Assessment (Phase B)
            </span>
            <Button
              type="submit"
              variant="primary"
              disabled={allowSmallSample && !ackSmallSample}
              isLoading={isSubmitting}
              className="w-full sm:w-auto"
            >
              <span>Continue to Self-Assessment</span>
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
