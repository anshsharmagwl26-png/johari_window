-- pgTAP SQL Test Suite 5: Results Presentation & rpc_owner_get_results Verification
BEGIN;
SELECT plan(10);

-- 1. Setup Test Owners
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
INSERT INTO auth.users (id, email)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'owner_alex@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'other_user@example.com')
ON CONFLICT (id) DO NOTHING;

-- 2. Create and finalize a session for owner 1
SELECT lives_ok(
  $$
    SELECT public.rpc_owner_create_session(
      'Results Test Session',
      'Jordan Reed',
      'Test for Results Page',
      1,
      false,
      true,  -- allow small sample
      true,  -- ack small sample
      null
    );
  $$,
  'Owner creates results test session'
);

SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT public.rpc_owner_submit_self_assessment_and_open(
      (SELECT id FROM sess),
      ARRAY['able', 'caring', 'clever', 'happy', 'kind'],
      ARRAY['5000000000000000000000000000000000000000000000000000000000000001']
    );
  $$,
  'Owner opens session with self assessment'
);

-- Try to call rpc_owner_get_results on unfinalized 'open' session -> MUST throw error
SELECT throws_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT public.rpc_owner_get_results((SELECT id FROM sess));
  $$,
  'Session results are not yet finalized (current status: open). Results are only accessible once the session is finalized.',
  'Calling rpc_owner_get_results on unfinalized open session throws unfinalized error'
);

-- Submit participant feedback
SELECT lives_ok(
  $$
    SELECT public.rpc_participant_submit_feedback(
      '5000000000000000000000000000000000000000000000000000000000000001',
      ARRAY['able', 'caring', 'brave', 'friendly', 'happy'],
      null
    );
  $$,
  'Participant submits feedback'
);

-- Finalize session
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT public.rpc_owner_finalize_session((SELECT id FROM sess));
  $$,
  'Owner finalizes session'
);

-- Now call rpc_owner_get_results as owner -> MUST succeed
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT public.rpc_owner_get_results((SELECT id FROM sess));
  $$,
  'Owner fetches results snapshot successfully'
);

-- Check snapshot structure: exactly 55 adjectives returned
SELECT is(
  (
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT jsonb_array_length(public.rpc_owner_get_results((SELECT id FROM sess))->'adjectives')
  ),
  55,
  'Snapshot contains exactly 55 classified canonical adjectives'
);

-- Check status in snapshot is 'finalized'
SELECT is(
  (
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT (public.rpc_owner_get_results((SELECT id FROM sess))->>'status')::text
  ),
  'finalized',
  'Snapshot status is finalized'
);

-- Check summary total is 55
SELECT is(
  (
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT ((public.rpc_owner_get_results((SELECT id FROM sess))->'summary'->>'total_classified')::int)
  ),
  55,
  'Snapshot summary total_classified is exactly 55'
);

-- Unauthorized caller (user 2) tries to access results -> MUST throw unauthorized error
SELECT throws_ok(
  $$
    SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Results Test Session' LIMIT 1
    )
    SELECT public.rpc_owner_get_results((SELECT id FROM sess));
  $$,
  'Unauthorized: Session not found or caller is not owner.',
  'Non-owner caller is rejected with Unauthorized error'
);

ROLLBACK;
