-- Migration 7: Authoritative Johari Calculation Engine & Lock Hierarchy Hardening
-- Enforces:
-- 1. Consistent parent-session-first lock ordering across submission & finalization to prevent deadlocks.
-- 2. Authoritative set math on committed database responses:
--    OPEN = S ∩ P
--    BLIND = P - S
--    HIDDEN = S - P
--    UNKNOWN = U - (S ∪ P)
-- 3. Feedback frequency calculated per adjective (count of distinct submitted participants). Frequency never influences quadrant assignment.
-- 4. Minimum 5 participants required unless allow_small_sample_results & ack_small_sample are true.
-- 5. Expired sessions CAN be finalized by the owner using already committed submissions.
-- 6. Atomically revokes remaining unused invitations.
-- 7. Snapshot contains exactly 55 classified adjectives in session_result_adjectives.
-- 8. Transitions session to finalized in the same transaction.

-- ============================================================================
-- 1. Hardened Participant Submission with Parent-First Lock Ordering
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_participant_submit_feedback(
  p_token_hash TEXT,
  p_adjective_ids TEXT[],
  p_participant_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite_session_id UUID;
  v_invite RECORD;
  v_session RECORD;
  v_participant_id UUID;
  v_adj_count INTEGER;
  v_valid_adj_count INTEGER;
  v_clean_name TEXT;
BEGIN
  -- 1. Index read to determine session_id without holding locks yet
  SELECT session_id INTO v_invite_session_id
  FROM public.participant_invites
  WHERE token_hash = p_token_hash;

  IF NOT FOUND OR v_invite_session_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invitation token.';
  END IF;

  -- 2. Consistently lock PARENT session row FIRST (Level 1 in lock hierarchy)
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = v_invite_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated session not found.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Session is not open for feedback (current status: %).', v_session.status;
  END IF;

  IF v_session.expires_at IS NOT NULL AND v_session.expires_at <= timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'Session has expired.';
  END IF;

  -- 3. Lock invitation row SECOND (Level 2 in lock hierarchy)
  SELECT * INTO v_invite
  FROM public.participant_invites
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation token.';
  END IF;

  IF v_invite.status != 'issued' THEN
    RAISE EXCEPTION 'Invitation cannot be submitted; current status is %.', v_invite.status;
  END IF;

  -- 4. Validate adjective selections (5 to 7 distinct words)
  SELECT count(DISTINCT id) INTO v_adj_count
  FROM unnest(p_adjective_ids) AS id;

  IF v_adj_count < 5 OR v_adj_count > 7 THEN
    RAISE EXCEPTION 'Feedback submission requires between 5 and 7 distinct adjectives (provided: %).', v_adj_count;
  END IF;

  SELECT count(*) INTO v_valid_adj_count
  FROM public.adjectives
  WHERE id = ANY(p_adjective_ids);

  IF v_valid_adj_count != v_adj_count THEN
    RAISE EXCEPTION 'One or more adjective IDs do not exist in the canonical inventory.';
  END IF;

  -- 5. Enforce participant name policy server-side
  IF v_session.collect_participant_names THEN
    v_clean_name := trim(p_participant_name);
    IF v_clean_name IS NULL OR char_length(v_clean_name) < 1 OR char_length(v_clean_name) > 80 THEN
      RAISE EXCEPTION 'Participant name is required by the session configuration (1-80 characters).';
    END IF;
  ELSE
    v_clean_name := NULL;
  END IF;

  -- 6. Atomically insert participant record
  INSERT INTO public.participants (
    session_id,
    invite_id,
    participant_name,
    submitted_at
  )
  VALUES (
    v_invite.session_id,
    v_invite.id,
    v_clean_name,
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_participant_id;

  -- 7. Atomically insert adjective feedback responses
  INSERT INTO public.adjective_responses (
    session_id,
    participant_id,
    adjective_id
  )
  SELECT DISTINCT
    v_invite.session_id,
    v_participant_id,
    id
  FROM unnest(p_adjective_ids) AS id;

  -- 8. Mark invitation token consumed (single-use invariant)
  UPDATE public.participant_invites
  SET
    status = 'submitted',
    submitted_at = timezone('utc'::text, now())
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'participant_id', v_participant_id,
    'session_id', v_invite.session_id,
    'status', 'submitted'
  );
END;
$$;

-- ============================================================================
-- 2. Authoritative Johari Calculation & Session Finalization RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_finalize_session(
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id UUID;
  v_session RECORD;
  v_completed_count INTEGER;
  v_adjective_count INTEGER;
  v_open_count INTEGER;
  v_blind_count INTEGER;
  v_hidden_count INTEGER;
  v_unknown_count INTEGER;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be an authenticated session owner.';
  END IF;

  -- 1. Lock parent session row FIRST (Level 1 in lock hierarchy)
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Session is not open (status: %). Only open sessions can be finalized.', v_session.status;
  END IF;

  -- Note: Expired sessions CAN be finalized by the owner using already committed submissions!
  -- No check blocking expiration here.

  -- 2. Count distinct committed feedback submissions
  SELECT count(*) INTO v_completed_count
  FROM public.participants
  WHERE session_id = p_session_id;

  IF v_completed_count < 1 THEN
    RAISE EXCEPTION 'Finalization requires at least one feedback submission.';
  END IF;

  IF v_completed_count < 5 AND (NOT v_session.allow_small_sample_results OR v_session.small_sample_acknowledged_at IS NULL) THEN
    RAISE EXCEPTION 'Finalization blocked: Minimum 5 participant responses required unless low-sample override has been acknowledged and enabled.';
  END IF;

  -- 3. Insert snapshot record into session_results
  INSERT INTO public.session_results (
    session_id,
    participant_count,
    generated_at,
    calculation_version
  )
  VALUES (
    p_session_id,
    v_completed_count,
    timezone('utc'::text, now()),
    'v4-traditional'
  );

  -- 4. Authoritative quadrant calculation & frequency aggregation
  -- U = all 55 canonical adjectives
  -- S = subject selections in self_assessment_responses
  -- P = participant selections in adjective_responses
  -- OPEN = S ∩ P
  -- BLIND = P - S
  -- HIDDEN = S - P
  -- UNKNOWN = U - (S ∪ P)
  WITH
  subject_set AS (
    SELECT adjective_id
    FROM public.self_assessment_responses
    WHERE session_id = p_session_id
  ),
  participant_freq AS (
    SELECT
      adjective_id,
      count(DISTINCT participant_id)::INTEGER AS freq
    FROM public.adjective_responses
    WHERE session_id = p_session_id
    GROUP BY adjective_id
  ),
  classified AS (
    SELECT
      a.id AS adjective_id,
      COALESCE(pf.freq, 0) AS feedback_count,
      CASE
        -- OPEN: S ∩ P (in S AND in P)
        WHEN ss.adjective_id IS NOT NULL AND COALESCE(pf.freq, 0) > 0 THEN 'open'::public.johari_quadrant
        -- BLIND: P - S (not in S AND in P)
        WHEN ss.adjective_id IS NULL AND COALESCE(pf.freq, 0) > 0 THEN 'blind'::public.johari_quadrant
        -- HIDDEN: S - P (in S AND not in P)
        WHEN ss.adjective_id IS NOT NULL AND COALESCE(pf.freq, 0) = 0 THEN 'hidden'::public.johari_quadrant
        -- UNKNOWN: U - (S ∪ P) (not in S AND not in P)
        ELSE 'unknown'::public.johari_quadrant
      END AS quadrant
    FROM public.adjectives a
    LEFT JOIN subject_set ss ON a.id = ss.adjective_id
    LEFT JOIN participant_freq pf ON a.id = pf.adjective_id
  )
  INSERT INTO public.session_result_adjectives (
    session_id,
    adjective_id,
    quadrant,
    feedback_count
  )
  SELECT
    p_session_id,
    adjective_id,
    quadrant,
    feedback_count
  FROM classified;

  -- 5. Invariant check: Exactly 55 adjectives must be stored
  SELECT count(*) INTO v_adjective_count
  FROM public.session_result_adjectives
  WHERE session_id = p_session_id;

  IF v_adjective_count != 55 THEN
    RAISE EXCEPTION 'Calculation invariant failure: Expected exactly 55 classified adjectives, inserted %', v_adjective_count;
  END IF;

  -- Calculate summary quadrant counts
  SELECT
    count(*) FILTER (WHERE quadrant = 'open'),
    count(*) FILTER (WHERE quadrant = 'blind'),
    count(*) FILTER (WHERE quadrant = 'hidden'),
    count(*) FILTER (WHERE quadrant = 'unknown')
  INTO
    v_open_count,
    v_blind_count,
    v_hidden_count,
    v_unknown_count
  FROM public.session_result_adjectives
  WHERE session_id = p_session_id;

  -- 6. Atomically revoke any remaining unused invitations upon finalization
  UPDATE public.participant_invites
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE session_id = p_session_id AND status = 'issued';

  -- 7. Transition session status to finalized in the same transaction
  UPDATE public.sessions
  SET
    status = 'finalized',
    finalized_at = timezone('utc'::text, now())
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', 'finalized',
    'participant_count', v_completed_count,
    'calculation_version', 'v4-traditional',
    'open_count', v_open_count,
    'blind_count', v_blind_count,
    'hidden_count', v_hidden_count,
    'unknown_count', v_unknown_count
  );
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.rpc_owner_finalize_session FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_owner_finalize_session TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rpc_participant_submit_feedback FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_participant_submit_feedback TO service_role;
