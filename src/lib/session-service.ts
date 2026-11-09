import { supabase, isSupabaseConfigured } from './supabase';
import type { Session, Adjective } from '../types';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';

export interface CreateSessionParams {
  title: string;
  subject_name: string;
  description?: string;
  expected_participants: number;
  collect_participant_names: boolean;
  allow_small_sample_results: boolean;
  ack_small_sample: boolean;
  expires_at?: string | null;
}

export interface IssuedInviteResult {
  id: string;
  url: string;
  raw_token: string;
}

export interface OpenSessionResult {
  session_id: string;
  status: 'open';
  invites: IssuedInviteResult[];
}

/**
 * Ensures an active access token is retrieved, silently creating an anonymous session if needed.
 */
async function getClientAuthHeader(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) return '';
  try {
    let { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      const { data } = await supabase.auth.signInAnonymously();
      session = data?.session ?? null;
    }
    return session?.access_token ? `Bearer ${session.access_token}` : '';
  } catch {
    return '';
  }
}

/**
 * Creates an authenticated draft session.
 * Enforces Master Spec Phase A:
 * - Session starts in 'draft'.
 * - No invitation tokens are issued.
 * - Max 20 active sessions per owner cap enforced transactionally.
 */
export async function createSession(
  params: CreateSessionParams
): Promise<{ session: Session | null; error: Error | null }> {
  try {
    if (!params.title.trim() || !params.subject_name.trim()) {
      return { session: null, error: new Error('Title and Subject Name are required.') };
    }

    if (params.expected_participants < 1 || params.expected_participants > 50) {
      return { session: null, error: new Error('Expected participants must be between 1 and 50.') };
    }

    if (params.allow_small_sample_results && !params.ack_small_sample) {
      return {
        session: null,
        error: new Error('Enabling small-sample results requires affirmative privacy acknowledgement.'),
      };
    }

    if (isSupabaseConfigured && supabase) {
      let {
        data: { session: authSession },
      } = await supabase.auth.getSession();

      if (!authSession) {
        const { data: anonData, error: anonErr } = await supabase.auth.signInAnonymously();
        if (anonErr || !anonData?.session) {
          return { session: null, error: new Error(anonErr?.message || 'Failed to establish anonymous owner session.') };
        }
        authSession = anonData.session;
      }

      const { data, error } = await supabase.rpc('rpc_owner_create_session', {
        p_title: params.title.trim(),
        p_subject_name: params.subject_name.trim(),
        p_description: params.description ? params.description.trim() : null,
        p_expected_participants: params.expected_participants,
        p_collect_names: params.collect_participant_names,
        p_allow_small_sample: params.allow_small_sample_results,
        p_ack_small_sample: params.ack_small_sample,
        p_expires_at: params.expires_at || null,
      });

      if (error) {
        return { session: null, error: new Error(error.message) };
      }

      return { session: data as unknown as Session, error: null };
    }

    const authHeader = await getClientAuthHeader();

    // Server-side proxy call fallback (local / test mode)
    const res = await fetch('/api/sessions/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(params),
    });

    const json = await res.json();
    if (!res.ok) {
      return { session: null, error: new Error(json.error || 'Failed to create session.') };
    }

    return { session: json.session, error: null };
  } catch (err) {
    return { session: null, error: err as Error };
  }
}

/**
 * Loads canonical 55-adjective bank from PostgreSQL database.
 * Falls back to canonical in-memory constant if database is unconfigured.
 */
export async function fetchCanonicalAdjectives(): Promise<{
  adjectives: Adjective[];
  error: Error | null;
}> {
  try {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('adjectives')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) {
        return { adjectives: CANONICAL_ADJECTIVES, error: new Error(error.message) };
      }

      if (data && data.length === 55) {
        return { adjectives: data as Adjective[], error: null };
      }
    }

    return { adjectives: CANONICAL_ADJECTIVES, error: null };
  } catch (err) {
    return { adjectives: CANONICAL_ADJECTIVES, error: err as Error };
  }
}

/**
 * Loads session record by ID for owner review.
 */
export async function fetchSession(
  sessionId: string
): Promise<{ session: Session | null; error: Error | null }> {
  try {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) {
        return { session: null, error: new Error(error.message) };
      }

      return { session: data as Session, error: null };
    }

    // Default mock response when unconfigured for dev inspection
    return {
      session: {
        id: sessionId,
        owner_id: 'sample-owner',
        title: 'Workshop Assessment',
        subject_name: 'Alex Morgan',
        description: 'Team Johari Exercise',
        expected_participants: 5,
        collect_participant_names: false,
        allow_small_sample_results: false,
        status: 'draft',
        created_at: new Date().toISOString(),
        self_assessment_submitted_at: null,
        expires_at: null,
        finalized_at: null,
      },
      error: null,
    };
  } catch (err) {
    return { session: null, error: err as Error };
  }
}

/**
 * Submits self-assessment and atomically opens session.
 * Invokes server-side issuance endpoint where tokens are generated in memory,
 * hashes are passed to the atomic RPC, and plaintext invitation URLs are returned once.
 */
export async function submitSelfAssessmentAndOpen(
  sessionId: string,
  adjectiveIds: string[]
): Promise<{ result: OpenSessionResult | null; error: Error | null }> {
  try {
    const uniqueIds = Array.from(new Set(adjectiveIds));
    if (uniqueIds.length < 5 || uniqueIds.length > 7) {
      return {
        result: null,
        error: new Error(`Self-assessment requires between 5 and 7 distinct adjectives (provided: ${uniqueIds.length}).`),
      };
    }

    const authHeader = await getClientAuthHeader();

    const payload = {
      adjective_ids: uniqueIds,
      app_url: window.location.origin,
    };

    // Try Edge Function first if configured in Supabase
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('submit-self-assessment', {
          body: {
            session_id: sessionId,
            ...payload,
          },
        });

        if (!error && data?.invites) {
          return { result: data as OpenSessionResult, error: null };
        }
      } catch {
        // Fall back to server route
      }
    }

    // Express server route
    const res = await fetch(`/api/sessions/${sessionId}/submit-self-assessment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      return { result: null, error: new Error(json.error || 'Failed to submit self-assessment.') };
    }

    return { result: json as OpenSessionResult, error: null };
  } catch (err) {
    return { result: null, error: err as Error };
  }
}

export interface ParticipantTokenValidation {
  valid: boolean;
  reason?: string;
  message?: string;
  session_id?: string;
  subject_name?: string;
  title?: string;
  description?: string;
  collect_participant_names?: boolean;
  expires_at?: string | null;
  retry_after_seconds?: number;
}

/**
 * Validates participant token over HTTPS POST without consuming it.
 * Entirely read-only; opening or previewing a link NEVER consumes the token.
 */
export async function validateParticipantToken(
  token: string
): Promise<{ data: ParticipantTokenValidation | null; error: Error | null }> {
  try {
    const res = await fetch('/api/participant/validate-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    const json = await res.json();
    return { data: json as ParticipantTokenValidation, error: null };
  } catch (err) {
    return { data: null, error: err as Error };
  }
}

export interface SubmitParticipantFeedbackParams {
  token: string;
  adjective_ids: string[];
  participant_name?: string;
}

/**
 * Submits participant feedback and atomically consumes the single-use invitation token.
 */
export async function submitParticipantFeedback(
  params: SubmitParticipantFeedbackParams
): Promise<{ success: boolean; message?: string; error: Error | null }> {
  try {
    // 1. Try Edge Function if configured in Supabase client
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('submit-participant-feedback', {
          body: params,
        });

        if (!error && data?.success) {
          return { success: true, message: data.message, error: null };
        }
        if (error) {
          return { success: false, error: new Error(error.message) };
        }
      } catch {
        // Fall through to server route
      }
    }

    // 2. Server API route
    const res = await fetch('/api/participant/submit-feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    const json = await res.json();
    if (!res.ok) {
      return { success: false, error: new Error(json.error || 'Failed to submit feedback.') };
    }

    return { success: true, message: json.message, error: null };
  } catch (err) {
    return { success: false, error: err as Error };
  }
}

export interface ReissueInviteResult {
  id: string;
  url: string;
  raw_token: string;
  replaces_invite_id: string;
}

export interface BulkReissueResult {
  reissued_count: number;
  invites: IssuedInviteResult[];
}

/**
 * Reissues an individual unused invitation token.
 * Generates a fresh 256-bit token and atomically revokes the old one.
 */
export async function reissueInvite(
  sessionId: string,
  oldInviteId: string
): Promise<{ invite: ReissueInviteResult | null; error: Error | null }> {
  try {
    const authHeader = await getClientAuthHeader();

    const payload = {
      session_id: sessionId,
      old_invite_id: oldInviteId,
      app_url: window.location.origin,
    };

    // Try Supabase Edge Function first if configured
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('reissue-invite', {
          body: payload,
        });

        if (!error && data?.invite) {
          return { invite: data.invite as ReissueInviteResult, error: null };
        }
      } catch {
        // Fall back to server route
      }
    }

    const res = await fetch(`/api/sessions/${sessionId}/reissue-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      return { invite: null, error: new Error(json.error || 'Failed to reissue invitation.') };
    }

    return { invite: json.invite as ReissueInviteResult, error: null };
  } catch (err) {
    return { invite: null, error: err as Error };
  }
}

/**
 * Bulk reissues all unused invitations for the given session.
 */
export async function bulkReissueUnusedInvites(
  sessionId: string
): Promise<{ result: BulkReissueResult | null; error: Error | null }> {
  try {
    const authHeader = await getClientAuthHeader();

    const payload = {
      session_id: sessionId,
      app_url: window.location.origin,
    };

    // Try Supabase Edge Function first if configured
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('bulk-reissue-unused', {
          body: payload,
        });

        if (!error && data?.invites) {
          return { result: data as BulkReissueResult, error: null };
        }
      } catch {
        // Fall back to server route
      }
    }

    const res = await fetch(`/api/sessions/${sessionId}/bulk-reissue-unused`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok) {
      return { result: null, error: new Error(json.error || 'Failed to bulk reissue invitations.') };
    }

    return { result: json as BulkReissueResult, error: null };
  } catch (err) {
    return { result: null, error: err as Error };
  }
}

export interface FinalizeSessionResult {
  session_id: string;
  status: 'finalized';
  participant_count: number;
  calculation_version: string;
  open_count: number;
  blind_count: number;
  hidden_count: number;
  unknown_count: number;
}

/**
 * Invokes authoritative database finalization and quadrant calculation.
 */
export async function finalizeSession(
  sessionId: string
): Promise<{ result: FinalizeSessionResult | null; error: Error | null }> {
  try {
    const authHeader = await getClientAuthHeader();

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('rpc_owner_finalize_session', {
        p_session_id: sessionId,
      });

      if (error) {
        return { result: null, error: new Error(error.message) };
      }

      return { result: data as FinalizeSessionResult, error: null };
    }

    const res = await fetch(`/api/sessions/${sessionId}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    const json = await res.json();
    if (!res.ok) {
      return { result: null, error: new Error(json.error || 'Failed to finalize session.') };
    }

    return { result: json.result as FinalizeSessionResult, error: null };
  } catch (err) {
    return { result: null, error: err as Error };
  }
}

export interface FinalizedSnapshotAdjective {
  id: string;
  word: string;
  sort_order: number;
  quadrant: 'open' | 'blind' | 'hidden' | 'unknown';
  feedback_count: number;
}

export interface FinalizedResultsSnapshot {
  session_id: string;
  title: string;
  subject_name: string;
  status: 'finalized';
  participant_count: number;
  allow_small_sample_results: boolean;
  calculation_version: string;
  generated_at: string;
  summary: {
    open_count: number;
    blind_count: number;
    hidden_count: number;
    unknown_count: number;
    total_classified: number;
  };
  adjectives: FinalizedSnapshotAdjective[];
}

export interface DashboardMetrics {
  session_id: string;
  title: string;
  subject_name: string;
  description: string | null;
  status: 'draft' | 'open' | 'finalized';
  expected_participants: number;
  issued_count: number;
  active_invites: number;
  completed_responses: number;
  unfilled_target: number;
  collect_participant_names: boolean;
  allow_small_sample_results: boolean;
  small_sample_acknowledged_at: string | null;
  expires_at: string | null;
  responded_names: string[];
}

/**
 * Loads dashboard metrics and status from the authoritative database.
 */
export async function fetchSessionDashboard(
  sessionId: string
): Promise<{ metrics: DashboardMetrics | null; error: Error | null }> {
  try {
    const authHeader = await getClientAuthHeader();

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('rpc_owner_get_dashboard', {
        p_session_id: sessionId,
      });

      if (error) {
        return { metrics: null, error: new Error(error.message) };
      }

      return { metrics: data as DashboardMetrics, error: null };
    }

    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    const json = await res.json();
    if (!res.ok) {
      return { metrics: null, error: new Error(json.error || 'Failed to fetch session dashboard.') };
    }

    return { metrics: json.session as DashboardMetrics, error: null };
  } catch (err) {
    return { metrics: null, error: err as Error };
  }
}

/**
 * Loads authoritative finalized results snapshot from PostgreSQL database.
 * Rejects unfinalized (draft/open) sessions and non-owners.
 */
export async function fetchSessionResults(
  sessionId: string
): Promise<{ snapshot: FinalizedResultsSnapshot | null; error: Error | null }> {
  try {
    const authHeader = await getClientAuthHeader();

    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc('rpc_owner_get_results', {
        p_session_id: sessionId,
      });

      if (error) {
        return { snapshot: null, error: new Error(error.message) };
      }

      return { snapshot: data as FinalizedResultsSnapshot, error: null };
    }

    const res = await fetch(`/api/sessions/${sessionId}/results`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    const json = await res.json();
    if (!res.ok) {
      return { snapshot: null, error: new Error(json.error || 'Failed to fetch session results.') };
    }

    return { snapshot: json.results as FinalizedResultsSnapshot, error: null };
  } catch (err) {
    return { snapshot: null, error: err as Error };
  }
}




