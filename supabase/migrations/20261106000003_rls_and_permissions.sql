-- Migration 3: Default-Deny Row Level Security (RLS) & Direct Write Lockdown
-- CRITICAL SECURITY HARDENING:
-- Direct browser writes (INSERT, UPDATE, DELETE) are completely REVOKED on public.sessions
-- and all child tables from both anon and authenticated roles.
-- All session creation, transitions, selections, and deletion must execute through
-- authorized SECURITY DEFINER RPC functions.

-- 1. Enable RLS on all tables
ALTER TABLE public.adjectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.self_assessment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adjective_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_result_adjectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- 2. Revoke ALL privileges from PUBLIC, anon, and authenticated across all tables
REVOKE ALL ON TABLE public.adjectives FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.self_assessment_responses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.participant_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.adjective_responses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.session_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.session_result_adjectives FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.rate_limit_events FROM PUBLIC, anon, authenticated;

-- 3. Grant minimal read-only privileges to browser roles
-- Adjectives: public read-only
GRANT SELECT ON TABLE public.adjectives TO anon, authenticated, service_role;

-- Sessions: authenticated users can ONLY SELECT their own sessions (NO direct INSERT, UPDATE, DELETE)
GRANT SELECT ON TABLE public.sessions TO authenticated, service_role;

-- Self-assessment responses: read-only for session owner
GRANT SELECT ON TABLE public.self_assessment_responses TO authenticated, service_role;

-- Session results & snapshot adjectives: read-only for session owner after finalization
GRANT SELECT ON TABLE public.session_results TO authenticated, service_role;
GRANT SELECT ON TABLE public.session_result_adjectives TO authenticated, service_role;

-- Allow roles to resolve auth.uid() function in auth schema
DO $$ BEGIN
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
EXCEPTION WHEN OTHERS THEN null;
END $$;

-- Privileged service_role retains full access for atomic RPC / Edge Function execution
GRANT ALL ON TABLE public.sessions TO service_role;
GRANT ALL ON TABLE public.participant_invites TO service_role;
GRANT ALL ON TABLE public.participants TO service_role;
GRANT ALL ON TABLE public.adjective_responses TO service_role;
GRANT ALL ON TABLE public.rate_limit_events TO service_role;
GRANT ALL ON TABLE public.self_assessment_responses TO service_role;
GRANT ALL ON TABLE public.session_results TO service_role;
GRANT ALL ON TABLE public.session_result_adjectives TO service_role;

-- 4. RLS Policies

-- Adjectives Policy: Public read
CREATE POLICY "Adjectives are viewable by all users"
  ON public.adjectives FOR SELECT
  USING (true);

-- Sessions Policy: Strict owner read isolation (NO INSERT/UPDATE/DELETE policies exist)
CREATE POLICY "Owners can view own sessions"
  ON public.sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

-- Self-Assessment Responses Policy: Viewable only by owning subject
CREATE POLICY "Owners can view own self assessment responses"
  ON public.self_assessment_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = self_assessment_responses.session_id
        AND s.owner_id = auth.uid()
    )
  );

-- Results Policies: Owner-only, accessible ONLY when session status = finalized
CREATE POLICY "Owners can view results of finalized sessions"
  ON public.session_results FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_results.session_id
        AND s.owner_id = auth.uid()
        AND s.status = 'finalized'
    )
  );

CREATE POLICY "Owners can view result adjectives of finalized sessions"
  ON public.session_result_adjectives FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = session_result_adjectives.session_id
        AND s.owner_id = auth.uid()
        AND s.status = 'finalized'
    )
  );

-- Participant Invites, Participants, Adjective Responses:
-- Default-deny policies for browser roles.
-- Direct PostgREST access is completely blocked.
