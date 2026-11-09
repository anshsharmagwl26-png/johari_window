-- pgTAP SQL Test Suite 3: RPC Functions, Atomic Transitions & Security Boundaries
BEGIN;
SELECT plan(25);

-- 1. Verify function existence
SELECT has_function('rpc_owner_create_session', 'Function rpc_owner_create_session exists');
SELECT has_function('rpc_owner_submit_self_assessment_and_open', 'Function rpc_owner_submit_self_assessment_and_open exists');
SELECT has_function('rpc_owner_set_small_sample_opt_in', 'Function rpc_owner_set_small_sample_opt_in exists');
SELECT has_function('rpc_participant_validate_token', 'Function rpc_participant_validate_token exists');
SELECT has_function('rpc_participant_submit_feedback', 'Function rpc_participant_submit_feedback exists');
SELECT has_function('rpc_owner_finalize_session', 'Function rpc_owner_finalize_session exists');
SELECT has_function('rpc_owner_delete_session', 'Function rpc_owner_delete_session exists');
SELECT has_function('rpc_check_and_record_rate_limit', 'Function rpc_check_and_record_rate_limit exists');
SELECT has_function('rpc_owner_reissue_invite', 'Function rpc_owner_reissue_invite exists');
SELECT has_function('rpc_owner_bulk_reissue_unused_invites', 'Function rpc_owner_bulk_reissue_unused_invites exists');

-- 2. Verify security: Unauthenticated caller cannot invoke rpc_owner_create_session
SELECT throws_ok(
  $$ SELECT public.rpc_owner_create_session('Test', 'Subject', 'Desc', 5, false, false, false, null) $$,
  'Unauthorized: Caller must be an authenticated session owner.',
  'Unauthenticated call to rpc_owner_create_session is rejected'
);

-- 3. Verify execution as authenticated owner
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'owner@example.com')
ON CONFLICT (id) DO NOTHING;

-- Create session
SELECT lives_ok(
  $$
    SELECT public.rpc_owner_create_session(
      'Team Workshop',
      'Alex Kumar',
      'Johari Assessment for Team Growth',
      5,
      true,
      false,
      false,
      null
    );
  $$,
  'Authenticated owner can create draft session'
);

-- 4. Atomic self-assessment and open transition
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Team Workshop' LIMIT 1
    )
    SELECT public.rpc_owner_submit_self_assessment_and_open(
      (SELECT id FROM sess),
      ARRAY['able', 'brave', 'calm', 'caring', 'clever'],
      ARRAY['1111111111111111111111111111111111111111111111111111111111111111',
            '2222222222222222222222222222222222222222222222222222222222222222',
            '3333333333333333333333333333333333333333333333333333333333333333',
            '4444444444444444444444444444444444444444444444444444444444444444',
            '5555555555555555555555555555555555555555555555555555555555555555']
    );
  $$,
  'rpc_owner_submit_self_assessment_and_open atomically records self-assessment, creates invites, and transitions to open'
);

-- Verify status changed to open
SELECT is(
  (SELECT status::text FROM public.sessions WHERE title = 'Team Workshop' LIMIT 1),
  'open',
  'Session status transitioned to open'
);

-- 5. Participant read-only validation
SELECT is(
  (SELECT (public.rpc_participant_validate_token('2222222222222222222222222222222222222222222222222222222222222222')->>'valid')::boolean),
  true,
  'rpc_participant_validate_token validates issued invitation successfully'
);

-- Verify validation did NOT consume token
SELECT is(
  (SELECT status::text FROM public.participant_invites WHERE token_hash = '2222222222222222222222222222222222222222222222222222222222222222'),
  'issued',
  'Validation is strictly read-only: token status remains issued'
);

-- 6. Participant feedback submission with Indian-language name (Unicode letters & combining marks)
SELECT lives_ok(
  $$
    SELECT public.rpc_participant_submit_feedback(
      '1111111111111111111111111111111111111111111111111111111111111111',
      ARRAY['able', 'brave', 'calm', 'caring', 'clever'],
      'राहुल शर्मा'
    );
  $$,
  'rpc_participant_submit_feedback accepts valid Indian-language name with Devanagari combining marks'
);

-- 7. Verify consumed token validation returns valid = false
SELECT is(
  (SELECT (public.rpc_participant_validate_token('1111111111111111111111111111111111111111111111111111111111111111')->>'reason')::text),
  'already_submitted',
  'Validation on consumed token reports already_submitted'
);

-- 8. Verify resubmission of consumed token is rejected
SELECT throws_ok(
  $$
    SELECT public.rpc_participant_submit_feedback(
      '1111111111111111111111111111111111111111111111111111111111111111',
      ARRAY['able', 'brave', 'calm', 'caring', 'clever'],
      'Priya Patel'
    );
  $$,
  'Invitation cannot be submitted; current status is submitted.',
  'Single-use invariant enforced: consumed invitation cannot be resubmitted'
);

-- 9. Verify rate limit RPC
SELECT is(
  (SELECT (public.rpc_check_and_record_rate_limit('test-bucket-key', 'unit_test', 5, 60)->>'allowed')::boolean),
  true,
  'rpc_check_and_record_rate_limit allows request within limit'
);

-- 10. Stage 3C: Owner individual invitation reissuance
-- Reissue unused invitation '2222222222222222222222222222222222222222222222222222222222222222'
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Team Workshop' LIMIT 1
    ),
    old_inv AS (
      SELECT id FROM public.participant_invites WHERE token_hash = '2222222222222222222222222222222222222222222222222222222222222222' LIMIT 1
    )
    SELECT public.rpc_owner_reissue_invite(
      (SELECT id FROM sess),
      (SELECT id FROM old_inv),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
  $$,
  'rpc_owner_reissue_invite successfully reissues unused invitation'
);

-- Verify old invite was revoked
SELECT is(
  (SELECT status::text FROM public.participant_invites WHERE token_hash = '2222222222222222222222222222222222222222222222222222222222222222'),
  'revoked',
  'Old invitation was atomically revoked upon reissuance'
);

-- Verify reissuing previously submitted invitation is strictly rejected
SELECT throws_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Team Workshop' LIMIT 1
    ),
    submitted_inv AS (
      SELECT id FROM public.participant_invites WHERE token_hash = '1111111111111111111111111111111111111111111111111111111111111111' LIMIT 1
    )
    SELECT public.rpc_owner_reissue_invite(
      (SELECT id FROM sess),
      (SELECT id FROM submitted_inv),
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
  $$,
  'Previously submitted invitations cannot be reissued.',
  'Reissuance of submitted invitation is rejected with error'
);

-- 11. Stage 3C: Owner bulk reissuance of unused invitations
SELECT lives_ok(
  $$
    WITH sess AS (
      SELECT id FROM public.sessions WHERE title = 'Team Workshop' LIMIT 1
    )
    SELECT public.rpc_owner_bulk_reissue_unused_invites(
      (SELECT id FROM sess),
      ARRAY[
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      ]
    );
  $$,
  'rpc_owner_bulk_reissue_unused_invites reissues all remaining unused invitations'
);

-- Verify bulk reissued count matches (4 unused replaced)
SELECT is(
  (SELECT count(*)::integer FROM public.participant_invites WHERE status = 'issued'),
  4,
  'Bulk reissuance produced exactly 4 active issued replacement invitations'
);

SELECT * FROM finish();
ROLLBACK;
