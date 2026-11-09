-- pgTAP SQL Test Suite 4: Authoritative Johari Calculation Engine & Parity Verification
BEGIN;
SELECT plan(19);

-- 1. Setup Test Owner and Users
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'owner_alex@example.com')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Section 5: Mandatory Test Vector (Authoritative Database Verification)
-- Subject: Able, Caring, Clever, Happy, Kind
-- Participant 1: Able, Caring, Brave, Friendly, Happy
-- Participant 2: Clever, Kind, Brave, Calm, Friendly
-- Expected:
--   OPEN: 5
--   BLIND: Brave, Friendly, Calm (3)
--   HIDDEN: Empty (0)
--   UNKNOWN: Remaining 47 adjectives
--   Brave frequency: 2, Friendly frequency: 2, Calm frequency: 1
-- ============================================================================

-- Create session with low-sample opt-in enabled and acknowledged
SELECT lives_ok(
  $$
    SELECT public.rpc_owner_create_session(
      'Mandatory Test Vector Session',
      'Alex Morgan',
      'Johari Assessment Vector',
      2,
      false,
      true,  -- allow_small_sample_results
      true,  -- ack_small_sample
      null
    );
  $$,
  'Owner creates session with small-sample override enabled'
);

-- Open session with self-assessment: Able, Caring, Clever, Happy, Kind
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Mandatory Test Vector Session' LIMIT 1
    )
    SELECT public.rpc_owner_submit_self_assessment_and_open(
      (SELECT id FROM sess),
      ARRAY['able', 'caring', 'clever', 'happy', 'kind'],
      ARRAY[
        '1000000000000000000000000000000000000000000000000000000000000001',
        '1000000000000000000000000000000000000000000000000000000000000002'
      ]
    );
  $$,
  'Owner submits self-assessment and opens session'
);

-- Participant 1 submits: Able, Caring, Brave, Friendly, Happy
SELECT lives_ok(
  $$
    SELECT public.rpc_participant_submit_feedback(
      '1000000000000000000000000000000000000000000000000000000000000001',
      ARRAY['able', 'caring', 'brave', 'friendly', 'happy'],
      null
    );
  $$,
  'Participant 1 submits feedback'
);

-- Participant 2 submits: Clever, Kind, Brave, Calm, Friendly
SELECT lives_ok(
  $$
    SELECT public.rpc_participant_submit_feedback(
      '1000000000000000000000000000000000000000000000000000000000000002',
      ARRAY['clever', 'kind', 'brave', 'calm', 'friendly'],
      null
    );
  $$,
  'Participant 2 submits feedback'
);

-- Authoritative Finalization
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Mandatory Test Vector Session' LIMIT 1
    )
    SELECT public.rpc_owner_finalize_session((SELECT id FROM sess));
  $$,
  'Owner finalizes session and triggers authoritative calculation'
);

-- Verification: exactly 55 rows in session_result_adjectives
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session'
  ),
  55,
  'Snapshot contains exactly 55 classified adjectives'
);

-- Verification: OPEN quadrant count = 5
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.quadrant = 'open'
  ),
  5,
  'Mandatory Vector: OPEN quadrant contains exactly 5 adjectives'
);

-- Verification: BLIND quadrant count = 3 (Brave, Friendly, Calm)
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.quadrant = 'blind'
  ),
  3,
  'Mandatory Vector: BLIND quadrant contains exactly 3 adjectives'
);

-- Verification: HIDDEN quadrant count = 0
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.quadrant = 'hidden'
  ),
  0,
  'Mandatory Vector: HIDDEN quadrant is empty (0)'
);

-- Verification: UNKNOWN quadrant count = 47
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.quadrant = 'unknown'
  ),
  47,
  'Mandatory Vector: UNKNOWN quadrant contains exactly 47 adjectives'
);

-- Verification: Frequencies for Brave (2), Friendly (2), Calm (1)
SELECT is(
  (
    SELECT sra.feedback_count
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.adjective_id = 'brave'
  ),
  2,
  'Mandatory Vector: Brave feedback frequency is exactly 2'
);

SELECT is(
  (
    SELECT sra.feedback_count
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.adjective_id = 'friendly'
  ),
  2,
  'Mandatory Vector: Friendly feedback frequency is exactly 2'
);

SELECT is(
  (
    SELECT sra.feedback_count
    FROM public.session_result_adjectives sra
    JOIN public.sessions s ON s.id = sra.session_id
    WHERE s.title = 'Mandatory Test Vector Session' AND sra.adjective_id = 'calm'
  ),
  1,
  'Mandatory Vector: Calm feedback frequency is exactly 1'
);

-- ============================================================================
-- Section 6: Additional Invariant & Security Tests
-- ============================================================================

-- 1. Repeated finalization is rejected
SELECT throws_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Mandatory Test Vector Session' LIMIT 1
    )
    SELECT public.rpc_owner_finalize_session((SELECT id FROM sess));
  $$,
  'Session is not open (status: finalized). Only open sessions can be finalized.',
  'Repeated finalization on finalized session is rejected'
);

-- 2. Insufficient response count without small-sample override is rejected
SELECT lives_ok(
  $$
    SELECT public.rpc_owner_create_session(
      'Standard Session No Override',
      'Alex Morgan',
      'Test 5-response rule',
      5,
      false,
      false,  -- allow_small_sample = false
      false,
      null
    );
  $$,
  'Create standard session without small sample override'
);

SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Standard Session No Override' LIMIT 1
    )
    SELECT public.rpc_owner_submit_self_assessment_and_open(
      (SELECT id FROM sess),
      ARRAY['able', 'caring', 'clever', 'happy', 'kind'],
      ARRAY[
        '2000000000000000000000000000000000000000000000000000000000000001',
        '2000000000000000000000000000000000000000000000000000000000000002',
        '2000000000000000000000000000000000000000000000000000000000000003',
        '2000000000000000000000000000000000000000000000000000000000000004',
        '2000000000000000000000000000000000000000000000000000000000000005'
      ]
    );
  $$,
  'Open standard session'
);

-- Submit only 1 response
SELECT lives_ok(
  $$
    SELECT public.rpc_participant_submit_feedback(
      '2000000000000000000000000000000000000000000000000000000000000001',
      ARRAY['able', 'caring', 'brave', 'friendly', 'happy'],
      null
    );
  $$,
  'Submit only 1 response for standard session'
);

-- Attempting finalization must fail because completed count < 5 and override is false
SELECT throws_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Standard Session No Override' LIMIT 1
    )
    SELECT public.rpc_owner_finalize_session((SELECT id FROM sess));
  $$,
  'Finalization blocked: Minimum 5 participant responses required unless low-sample override has been acknowledged and enabled.',
  'Finalization blocked when less than 5 responses and no small-sample override'
);

-- 3. Expired session CAN be finalized using committed responses
-- Expire the session in database
UPDATE public.sessions
SET
  expires_at = timezone('utc'::text, now()) - interval '1 hour',
  allow_small_sample_results = true,
  small_sample_acknowledged_at = timezone('utc'::text, now())
WHERE title = 'Standard Session No Override';

SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Standard Session No Override' LIMIT 1
    )
    SELECT public.rpc_owner_finalize_session((SELECT id FROM sess));
  $$,
  'Owner can finalize an expired session using committed responses'
);

SELECT * FROM finish();
ROLLBACK;
