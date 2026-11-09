-- Migration 4: Authoritative RPC Contracts & Security Boundaries
-- All SECURITY DEFINER functions set search_path = '', fully qualify objects,
-- verify authorization explicitly, and separate owner-JWT from participant-secret paths.

-- ============================================================================
-- 1. OWNER RPC: Create Session (Draft)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_create_session(
  p_title TEXT,
  p_subject_name TEXT,
  p_description TEXT,
  p_expected_participants INTEGER,
  p_collect_names BOOLEAN,
  p_allow_small_sample BOOLEAN,
  p_ack_small_sample BOOLEAN,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id UUID;
  v_active_sessions_count INTEGER;
  v_session_id UUID;
  v_session RECORD;
  v_ack_time TIMESTAMPTZ := NULL;
BEGIN
  -- 1. Verify caller identity
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be an authenticated session owner.';
  END IF;

  -- 2. Input validation
  IF p_expected_participants < 1 OR p_expected_participants > 50 THEN
    RAISE EXCEPTION 'Invalid expected_participants: must be between 1 and 50.';
  END IF;

  IF p_allow_small_sample THEN
    IF NOT p_ack_small_sample THEN
      RAISE EXCEPTION 'Enabling small-sample results requires affirmative privacy acknowledgement.';
    END IF;
    v_ack_time := timezone('utc'::text, now());
  END IF;

  -- 3. Enforce per-owner active (non-finalized) session cap (max 20) under lock
  PERFORM pg_advisory_xact_lock(hashtext('owner_sessions_cap_' || v_owner_id::text));
  SELECT count(*) INTO v_active_sessions_count
  FROM public.sessions
  WHERE owner_id = v_owner_id AND status != 'finalized';

  IF v_active_sessions_count >= 20 THEN
    RAISE EXCEPTION 'Limit exceeded: Maximum 20 non-finalized sessions per owner permitted.';
  END IF;

  -- 4. Insert draft session
  INSERT INTO public.sessions (
    owner_id,
    title,
    subject_name,
    description,
    expected_participants,
    collect_participant_names,
    allow_small_sample_results,
    small_sample_acknowledged_at,
    status,
    expires_at
  )
  VALUES (
    v_owner_id,
    trim(p_title),
    trim(p_subject_name),
    p_description,
    p_expected_participants,
    COALESCE(p_collect_names, FALSE),
    COALESCE(p_allow_small_sample, FALSE),
    v_ack_time,
    'draft',
    p_expires_at
  )
  RETURNING * INTO v_session;

  RETURN to_jsonb(v_session);
END;
$$;

-- ============================================================================
-- 2. OWNER RPC: Submit Self-Assessment & Atomically Open Session
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_submit_self_assessment_and_open(
  p_session_id UUID,
  p_adjective_ids TEXT[],
  p_token_hashes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id UUID;
  v_session RECORD;
  v_adj_count INTEGER;
  v_valid_adj_count INTEGER;
  v_hashes_count INTEGER;
  v_invites JSONB;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be an authenticated session owner.';
  END IF;

  -- Lock session row
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found.';
  END IF;

  IF v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not own this session.';
  END IF;

  IF v_session.status != 'draft' THEN
    RAISE EXCEPTION 'Invalid transition: Self-assessment can only be submitted for draft sessions.';
  END IF;

  -- Validate adjective count (exactly 5 to 7 distinct words)
  SELECT count(DISTINCT id) INTO v_adj_count
  FROM unnest(p_adjective_ids) AS id;

  IF v_adj_count < 5 OR v_adj_count > 7 THEN
    RAISE EXCEPTION 'Self-assessment requires between 5 and 7 distinct adjectives (provided: %).', v_adj_count;
  END IF;

  SELECT count(*) INTO v_valid_adj_count
  FROM public.adjectives
  WHERE id = ANY(p_adjective_ids);

  IF v_valid_adj_count != v_adj_count THEN
    RAISE EXCEPTION 'One or more submitted adjective IDs do not exist in the canonical inventory.';
  END IF;

  -- Validate token hashes strictly match expected_participants
  v_hashes_count := cardinality(p_token_hashes);
  IF v_hashes_count != v_session.expected_participants THEN
    RAISE EXCEPTION 'Initial invitation batch must match expected_participants count (expected: %, provided: %).', v_session.expected_participants, v_hashes_count;
  END IF;

  -- Insert self-assessment responses
  INSERT INTO public.self_assessment_responses (session_id, adjective_id)
  SELECT DISTINCT p_session_id, id
  FROM unnest(p_adjective_ids) AS id;

  -- Insert initial batch of invitation token hashes
  WITH inserted AS (
    INSERT INTO public.participant_invites (session_id, token_hash, status)
    SELECT p_session_id, hash, 'issued'
    FROM unnest(p_token_hashes) AS hash
    RETURNING id, token_hash
  )
  SELECT jsonb_agg(to_jsonb(inserted)) INTO v_invites FROM inserted;

  -- Atomically transition draft -> open
  UPDATE public.sessions
  SET
    status = 'open',
    self_assessment_submitted_at = timezone('utc'::text, now())
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', 'open',
    'invites', v_invites
  );
END;
$$;

-- ============================================================================
-- 3. OWNER RPC: Manage Small-Sample Opt-In While Session is Open
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_set_small_sample_opt_in(
  p_session_id UUID,
  p_enabled BOOLEAN,
  p_acknowledged BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id UUID;
  v_session RECORD;
  v_ack_time TIMESTAMPTZ := NULL;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Small-sample settings can only be modified while the session is open (current status: %).', v_session.status;
  END IF;

  IF p_enabled THEN
    IF NOT p_acknowledged THEN
      RAISE EXCEPTION 'Enabling small-sample results requires affirmative privacy acknowledgement.';
    END IF;
    v_ack_time := timezone('utc'::text, now());
  END IF;

  UPDATE public.sessions
  SET
    allow_small_sample_results = p_enabled,
    small_sample_acknowledged_at = v_ack_time
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN to_jsonb(v_session);
END;
$$;

-- ============================================================================
-- 4. OWNER RPC: Reissue an Unused Invitation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_reissue_invite(
  p_session_id UUID,
  p_old_invite_id UUID,
  p_new_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id UUID;
  v_session RECORD;
  v_old_invite RECORD;
  v_total_lifetime_count INTEGER;
  v_new_invite RECORD;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Invitations can only be reissued for open sessions.';
  END IF;

  -- Lock and verify old invitation is currently issued
  SELECT * INTO v_old_invite
  FROM public.participant_invites
  WHERE id = p_old_invite_id AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old invitation not found.';
  END IF;

  IF v_old_invite.status != 'issued' THEN
    RAISE EXCEPTION 'Cannot reissue invitation with status %; only unused issued invitations can be replaced.', v_old_invite.status;
  END IF;

  -- Enforce lifetime token cap (max 200 per session)
  SELECT count(*) INTO v_total_lifetime_count
  FROM public.participant_invites
  WHERE session_id = p_session_id;

  IF v_total_lifetime_count >= 200 THEN
    RAISE EXCEPTION 'Lifetime cap reached: Maximum 200 invitation records permitted per session.';
  END IF;

  -- Revoke old invitation
  UPDATE public.participant_invites
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE id = p_old_invite_id;

  -- Insert replacement invitation
  INSERT INTO public.participant_invites (
    session_id,
    token_hash,
    status,
    replaces_invite_id
  )
  VALUES (
    p_session_id,
    p_new_token_hash,
    'issued',
    p_old_invite_id
  )
  RETURNING * INTO v_new_invite;

  RETURN to_jsonb(v_new_invite);
END;
$$;

-- ============================================================================
-- 5. OWNER RPC: Bulk Reissue All Unused Invitations
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_bulk_reissue_unused_invites(
  p_session_id UUID,
  p_new_token_hashes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id UUID;
  v_session RECORD;
  v_unused_count INTEGER;
  v_total_lifetime_count INTEGER;
  v_new_count INTEGER;
  v_new_invites JSONB;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Invitations can only be reissued for open sessions.';
  END IF;

  SELECT count(*) INTO v_unused_count
  FROM public.participant_invites
  WHERE session_id = p_session_id AND status = 'issued';

  v_new_count := cardinality(p_new_token_hashes);
  IF v_unused_count != v_new_count THEN
    RAISE EXCEPTION 'Hash array length (%) does not match unused invitation count (%).', v_new_count, v_unused_count;
  END IF;

  -- Check lifetime cap (200)
  SELECT count(*) INTO v_total_lifetime_count
  FROM public.participant_invites
  WHERE session_id = p_session_id;

  IF (v_total_lifetime_count + v_new_count) > 200 THEN
    RAISE EXCEPTION 'Operation would exceed lifetime invitation cap (200 records per session).';
  END IF;

  -- Revoke all unused
  UPDATE public.participant_invites
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE session_id = p_session_id AND status = 'issued';

  -- Insert replacements
  WITH inserted AS (
    INSERT INTO public.participant_invites (session_id, token_hash, status)
    SELECT p_session_id, hash, 'issued'
    FROM unnest(p_new_token_hashes) AS hash
    RETURNING id, token_hash
  )
  SELECT jsonb_agg(to_jsonb(inserted)) INTO v_new_invites FROM inserted;

  RETURN jsonb_build_object(
    'reissued_count', v_new_count,
    'invites', v_new_invites
  );
END;
$$;

-- ============================================================================
-- 6. PARTICIPANT RPC: Read-Only Token Validation
-- Does not consume token, does not require auth.uid()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_participant_validate_token(
  p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite RECORD;
  v_session RECORD;
  v_is_expired BOOLEAN;
BEGIN
  SELECT * INTO v_invite
  FROM public.participant_invites
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'not_found');
  END IF;

  IF v_invite.status = 'submitted' THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'already_submitted');
  END IF;

  IF v_invite.status = 'revoked' THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'revoked');
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = v_invite.session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'session_not_found');
  END IF;

  IF v_session.status = 'draft' THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'session_not_open');
  END IF;

  IF v_session.status = 'finalized' THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'session_finalized');
  END IF;

  -- Check expiry using database time
  v_is_expired := (v_session.expires_at IS NOT NULL AND v_session.expires_at <= timezone('utc'::text, now()));
  IF v_is_expired THEN
    RETURN jsonb_build_object('valid', FALSE, 'reason', 'session_expired');
  END IF;

  -- Return minimal metadata
  RETURN jsonb_build_object(
    'valid', TRUE,
    'session_id', v_session.id,
    'subject_name', v_session.subject_name,
    'title', v_session.title,
    'description', v_session.description,
    'collect_participant_names', v_session.collect_participant_names,
    'expires_at', v_session.expires_at
  );
END;
$$;

-- ============================================================================
-- 7. PARTICIPANT RPC: Atomic Feedback Submission
-- Invoked via server-side Edge Function with service secret key.
-- Must not rely on auth.uid(). Uses row locks for concurrency safety.
-- Strictly validates participant name based on collect_participant_names setting.
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
  v_invite RECORD;
  v_session RECORD;
  v_participant_id UUID;
  v_adj_count INTEGER;
  v_valid_adj_count INTEGER;
  v_clean_name TEXT;
BEGIN
  -- 1. Lock and verify invitation
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

  -- 2. Lock and verify session
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = v_invite.session_id
  FOR UPDATE;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Session is not open for feedback (current status: %).', v_session.status;
  END IF;

  IF v_session.expires_at IS NOT NULL AND v_session.expires_at <= timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'Session has expired.';
  END IF;

  -- 3. Validate adjective selections (5 to 7 distinct words)
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

  -- 4. Enforce participant name policy server-side
  IF v_session.collect_participant_names THEN
    v_clean_name := trim(p_participant_name);
    IF v_clean_name IS NULL OR char_length(v_clean_name) = 0 THEN
      RAISE EXCEPTION 'Participant name is required when name collection is enabled.';
    END IF;
    IF char_length(v_clean_name) > 80 THEN
      RAISE EXCEPTION 'Participant name exceeds maximum length of 80 characters.';
    END IF;
    IF v_clean_name !~ U&'^[[:alnum:][:space:].'',()!0300-!036F!0900-!0DFF!0400-!052F!0600-!06FF!4E00-!9FFF-]+$' UESCAPE '!' THEN
      RAISE EXCEPTION 'Participant name contains invalid characters.';
    END IF;
  ELSE
    -- When disabled, reject any non-empty name string and force stored name to NULL
    IF p_participant_name IS NOT NULL AND char_length(trim(p_participant_name)) > 0 THEN
      RAISE EXCEPTION 'Participant names are disabled for this session; submitting a name is rejected.';
    END IF;
    v_clean_name := NULL;
  END IF;

  -- 5. Insert participant record
  INSERT INTO public.participants (
    session_id,
    invite_id,
    participant_name,
    submitted_at
  )
  VALUES (
    v_session.id,
    v_invite.id,
    v_clean_name,
    timezone('utc'::text, now())
  )
  RETURNING id INTO v_participant_id;

  -- 6. Insert adjective responses
  INSERT INTO public.adjective_responses (
    session_id,
    participant_id,
    adjective_id
  )
  SELECT DISTINCT v_session.id, v_participant_id, id
  FROM unnest(p_adjective_ids) AS id;

  -- 7. Consume invitation atomically
  UPDATE public.participant_invites
  SET
    status = 'submitted',
    submitted_at = timezone('utc'::text, now())
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'session_id', v_session.id,
    'participant_id', v_participant_id
  );
END;
$$;

-- ============================================================================
-- 8. OWNER RPC: Read Dashboard Metrics DTO
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_get_dashboard(
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
  v_issued_count INTEGER;
  v_active_invites INTEGER;
  v_completed_responses INTEGER;
  v_unfilled_target INTEGER;
  v_responded_names JSONB := '[]'::jsonb;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  -- Metric calculations
  SELECT count(*) INTO v_issued_count
  FROM public.participant_invites
  WHERE session_id = p_session_id;

  SELECT count(*) INTO v_active_invites
  FROM public.participant_invites
  WHERE session_id = p_session_id AND status = 'issued';

  SELECT count(*) INTO v_completed_responses
  FROM public.participants
  WHERE session_id = p_session_id;

  v_unfilled_target := GREATEST(v_session.expected_participants - v_completed_responses, 0);

  IF v_session.collect_participant_names THEN
    SELECT COALESCE(jsonb_agg(participant_name ORDER BY participant_name ASC), '[]'::jsonb)
    INTO v_responded_names
    FROM public.participants
    WHERE session_id = p_session_id AND participant_name IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'title', v_session.title,
    'subject_name', v_session.subject_name,
    'description', v_session.description,
    'status', v_session.status,
    'expected_participants', v_session.expected_participants,
    'issued_count', v_issued_count,
    'active_invites', v_active_invites,
    'completed_responses', v_completed_responses,
    'unfilled_target', v_unfilled_target,
    'collect_participant_names', v_session.collect_participant_names,
    'allow_small_sample_results', v_session.allow_small_sample_results,
    'small_sample_acknowledged_at', v_session.small_sample_acknowledged_at,
    'expires_at', v_session.expires_at,
    'responded_names', v_responded_names
  );
END;
$$;

-- ============================================================================
-- 9. OWNER RPC: Authoritative PostgreSQL Finalization & Johari Math
-- U = 55 words, S = Subject, P = Union of participants
-- Open = S ∩ P, Blind = P - S, Hidden = S - P, Unknown = U - (S ∪ P)
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
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  -- Lock session row
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

  -- Count committed feedback responses
  SELECT count(*) INTO v_completed_count
  FROM public.participants
  WHERE session_id = p_session_id;

  IF v_completed_count < 1 THEN
    RAISE EXCEPTION 'Finalization requires at least one feedback submission.';
  END IF;

  IF v_completed_count < 5 AND (NOT v_session.allow_small_sample_results OR v_session.small_sample_acknowledged_at IS NULL) THEN
    RAISE EXCEPTION 'Finalization blocked: Minimum 5 participant responses required unless low-sample override has been acknowledged and enabled.';
  END IF;

  -- Insert snapshot record into session_results
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

  -- Perform authoritative quadrant calculation for all 55 adjectives
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
        -- Open: Known to self (in S) AND Known to others (in P)
        WHEN ss.adjective_id IS NOT NULL AND pf.freq > 0 THEN 'open'::public.johari_quadrant
        -- Blind: Unknown to self (not in S) AND Known to others (in P)
        WHEN ss.adjective_id IS NULL AND pf.freq > 0 THEN 'blind'::public.johari_quadrant
        -- Hidden: Known to self (in S) AND Unknown to others (not in P)
        WHEN ss.adjective_id IS NOT NULL AND (pf.freq IS NULL OR pf.freq = 0) THEN 'hidden'::public.johari_quadrant
        -- Unknown: Unknown to self (not in S) AND Unknown to others (not in P)
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

  -- Assert exactly 55 adjectives were inserted
  SELECT count(*) INTO v_adjective_count
  FROM public.session_result_adjectives
  WHERE session_id = p_session_id;

  IF v_adjective_count != 55 THEN
    RAISE EXCEPTION 'Calculation invariant failure: Expected exactly 55 classified adjectives, inserted %', v_adjective_count;
  END IF;

  -- Revoke any still-issued unused invitations upon finalization
  UPDATE public.participant_invites
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE session_id = p_session_id AND status = 'issued';

  -- Set session status = finalized
  UPDATE public.sessions
  SET
    status = 'finalized',
    finalized_at = timezone('utc'::text, now())
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', 'finalized',
    'participant_count', v_completed_count
  );
END;
$$;

-- ============================================================================
-- 10. OWNER RPC: Hard Delete Session (Cascades all child tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_owner_delete_session(
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
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  -- Hard delete triggers cascading foreign keys
  DELETE FROM public.sessions
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'deleted', TRUE,
    'session_id', p_session_id
  );
END;
$$;

-- Revoke broad EXECUTE grants and grant only to intended roles
REVOKE ALL ON FUNCTION public.rpc_owner_create_session FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_submit_self_assessment_and_open FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_set_small_sample_opt_in FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_reissue_invite FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_bulk_reissue_unused_invites FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_get_dashboard FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_finalize_session FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_owner_delete_session FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_owner_create_session TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_submit_self_assessment_and_open TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_set_small_sample_opt_in TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_reissue_invite TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_bulk_reissue_unused_invites TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_get_dashboard TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_finalize_session TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_owner_delete_session TO authenticated, service_role;

-- Participant validate & submit:
GRANT EXECUTE ON FUNCTION public.rpc_participant_validate_token TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_participant_submit_feedback TO service_role;
