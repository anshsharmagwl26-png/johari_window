-- pgTAP SQL Test Suite 2: RLS Policies, Owner Isolation & Privilege Lockdown
BEGIN;
SELECT plan(30);

-- ============================================================================
-- Section 1: Direct Table Privilege Lockdown
-- ============================================================================

-- 1. Service role retains full access for administrative operations
SELECT table_privs_are(
  'public', 'participant_invites', 'service_role',
  ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
  'Service role retains full access to participant_invites for atomic functions'
);

-- 2. Anon has NO direct privileges on participant_invites
SELECT table_privs_are(
  'public', 'participant_invites', 'anon',
  ARRAY[]::text[],
  'Anon has NO direct privileges on participant_invites'
);

-- 3. Authenticated has NO direct privileges on participant_invites
SELECT table_privs_are(
  'public', 'participant_invites', 'authenticated',
  ARRAY[]::text[],
  'Authenticated role has NO direct privileges on participant_invites'
);

-- 4. Authenticated has NO direct privileges on adjective_responses
SELECT table_privs_are(
  'public', 'adjective_responses', 'authenticated',
  ARRAY[]::text[],
  'Authenticated role has NO direct privileges on adjective_responses'
);

-- 5. Authenticated has NO direct privileges on participants
SELECT table_privs_are(
  'public', 'participants', 'authenticated',
  ARRAY[]::text[],
  'Authenticated role has NO direct privileges on participants'
);

-- 6. Anon can SELECT only from adjectives (public catalog)
SELECT table_privs_are(
  'public', 'adjectives', 'anon',
  ARRAY['SELECT'],
  'Anon can SELECT from adjectives'
);

-- 7. Authenticated role has ONLY SELECT on public.sessions (direct writes revoked)
SELECT table_privs_are(
  'public', 'sessions', 'authenticated',
  ARRAY['SELECT'],
  'Authenticated role has strictly SELECT on public.sessions (NO direct INSERT, UPDATE, DELETE)'
);

-- ============================================================================
-- Section 2: Fixture Setup (Two Independent Owners A & B)
-- ============================================================================

-- Create test owners in auth.users
INSERT INTO auth.users (id, email)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner_a@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'owner_b@example.com')
ON CONFLICT (id) DO NOTHING;

-- Owner A sessions:
-- Session A1 (open)
INSERT INTO public.sessions (
  id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'a0000000-0000-0000-0000-000000000001',
  'Session A1 Open',
  'Owner A Subject',
  5,
  'open',
  timezone('utc'::text, now())
);

INSERT INTO public.self_assessment_responses (session_id, adjective_id)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'able'),
  ('11111111-1111-1111-1111-111111111111', 'brave'),
  ('11111111-1111-1111-1111-111111111111', 'calm'),
  ('11111111-1111-1111-1111-111111111111', 'caring'),
  ('11111111-1111-1111-1111-111111111111', 'clever');

-- Session A2 (finalized)
INSERT INTO public.sessions (
  id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at, finalized_at
) VALUES (
  '11111111-1111-1111-1111-111111111112',
  'a0000000-0000-0000-0000-000000000001',
  'Session A2 Finalized',
  'Owner A Subject',
  2,
  'finalized',
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
);

INSERT INTO public.session_results (session_id, participant_count, calculation_version)
VALUES ('11111111-1111-1111-1111-111111111112', 2, 'v4-traditional');

-- Seed 55 snapshot results for Session A2
INSERT INTO public.session_result_adjectives (session_id, adjective_id, quadrant, feedback_count)
SELECT '11111111-1111-1111-1111-111111111112', id, 'unknown', 0
FROM public.adjectives;

-- Owner B sessions:
-- Session B1 (open)
INSERT INTO public.sessions (
  id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at
) VALUES (
  '22222222-2222-2222-2222-222222222221',
  'b0000000-0000-0000-0000-000000000002',
  'Session B1 Open',
  'Owner B Subject',
  5,
  'open',
  timezone('utc'::text, now())
);

INSERT INTO public.self_assessment_responses (session_id, adjective_id)
VALUES
  ('22222222-2222-2222-2222-222222222221', 'bold'),
  ('22222222-2222-2222-2222-222222222221', 'calm'),
  ('22222222-2222-2222-2222-222222222221', 'clever'),
  ('22222222-2222-2222-2222-222222222221', 'happy'),
  ('22222222-2222-2222-2222-222222222221', 'kind');

-- Session B2 (finalized)
INSERT INTO public.sessions (
  id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at, finalized_at
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  'b0000000-0000-0000-0000-000000000002',
  'Session B2 Finalized',
  'Owner B Subject',
  2,
  'finalized',
  timezone('utc'::text, now()),
  timezone('utc'::text, now())
);

INSERT INTO public.session_results (session_id, participant_count, calculation_version)
VALUES ('22222222-2222-2222-2222-222222222222', 2, 'v4-traditional');

INSERT INTO public.session_result_adjectives (session_id, adjective_id, quadrant, feedback_count)
SELECT '22222222-2222-2222-2222-222222222222', id, 'unknown', 0
FROM public.adjectives;

-- ============================================================================
-- Section 3: Direct Write Restriction (Authenticated User)
-- ============================================================================

SET ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000001';

-- 8. Direct INSERT on sessions is forbidden
SELECT throws_ok(
  $$
    INSERT INTO public.sessions (owner_id, title, subject_name, expected_participants, status)
    VALUES ('a0000000-0000-0000-0000-000000000001', 'Direct Insert', 'Subject', 5, 'draft')
  $$,
  '42501',
  NULL,
  'Authenticated user cannot directly INSERT into public.sessions'
);

-- 9. Direct UPDATE on sessions is forbidden
SELECT throws_ok(
  $$
    UPDATE public.sessions
    SET title = 'Hacked Title'
    WHERE id = '11111111-1111-1111-1111-111111111111'
  $$,
  '42501',
  NULL,
  'Authenticated user cannot directly UPDATE public.sessions'
);

-- 10. Direct DELETE on sessions is forbidden
SELECT throws_ok(
  $$
    DELETE FROM public.sessions
    WHERE id = '11111111-1111-1111-1111-111111111111'
  $$,
  '42501',
  NULL,
  'Authenticated user cannot directly DELETE from public.sessions'
);

-- ============================================================================
-- Section 4: Anonymous User Blocked from All Protected Tables
-- ============================================================================

SET ROLE anon;
SET LOCAL "request.jwt.claim.sub" = '';

-- 11. Anon cannot SELECT from sessions
SELECT throws_ok(
  $$ SELECT * FROM public.sessions $$,
  '42501',
  NULL,
  'Anon cannot SELECT from public.sessions'
);

-- 12. Anon cannot SELECT from self_assessment_responses
SELECT throws_ok(
  $$ SELECT * FROM public.self_assessment_responses $$,
  '42501',
  NULL,
  'Anon cannot SELECT from public.self_assessment_responses'
);

-- 13. Anon cannot SELECT from session_results
SELECT throws_ok(
  $$ SELECT * FROM public.session_results $$,
  '42501',
  NULL,
  'Anon cannot SELECT from public.session_results'
);

-- 14. Anon cannot SELECT from session_result_adjectives
SELECT throws_ok(
  $$ SELECT * FROM public.session_result_adjectives $$,
  '42501',
  NULL,
  'Anon cannot SELECT from public.session_result_adjectives'
);

-- ============================================================================
-- Section 5: Authenticated Owner A Ownership-Isolation Tests
-- ============================================================================

SET ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000001';

-- 15. Owner A sees exactly 2 sessions (Session A1 and Session A2)
SELECT is(
  (SELECT count(*)::INTEGER FROM public.sessions),
  2,
  'Owner A sees only their own sessions (exactly 2)'
);

-- 16. Owner A cannot read Owner B sessions
SELECT is(
  (SELECT count(*)::INTEGER FROM public.sessions WHERE owner_id = 'b0000000-0000-0000-0000-000000000002'),
  0,
  'Owner A cannot read any of Owner B sessions'
);

-- 17. Owner A can read their own self-assessment responses
SELECT is(
  (SELECT count(*)::INTEGER FROM public.self_assessment_responses WHERE session_id = '11111111-1111-1111-1111-111111111111'),
  5,
  'Owner A can read self-assessment responses for their own session'
);

-- 18. Owner A cannot read Owner B self-assessment responses
SELECT is(
  (SELECT count(*)::INTEGER FROM public.self_assessment_responses WHERE session_id = '22222222-2222-2222-2222-222222222221'),
  0,
  'Owner A cannot read self-assessment responses for Owner B session'
);

-- 19. Owner A can read finalized results for Session A2
SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_results WHERE session_id = '11111111-1111-1111-1111-111111111112'),
  1,
  'Owner A can read session_results for their finalized session'
);

-- 20. Owner A can read finalized result adjectives for Session A2
SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_result_adjectives WHERE session_id = '11111111-1111-1111-1111-111111111112'),
  55,
  'Owner A can read 55 session_result_adjectives for their finalized session'
);

-- 21. Owner A cannot read Owner B finalized results
SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_results WHERE session_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Owner A cannot read finalized session_results of Owner B'
);

-- 22. Owner A cannot read Owner B finalized result adjectives
SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_result_adjectives WHERE session_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Owner A cannot read finalized session_result_adjectives of Owner B'
);

-- 23. Unfinalized results remain inaccessible (Session A1 is open, not finalized)
SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_results WHERE session_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Unfinalized session results are inaccessible even to the session owner'
);

-- ============================================================================
-- Section 6: Dynamic JWT Identity Switch to Owner B
-- ============================================================================

SET LOCAL "request.jwt.claim.sub" = 'b0000000-0000-0000-0000-000000000002';

-- 24. Owner B sees exactly 2 sessions (Session B1 and Session B2)
SELECT is(
  (SELECT count(*)::INTEGER FROM public.sessions),
  2,
  'After switching JWT identity to Owner B, caller sees exactly Owner B sessions'
);

-- 25. Owner B cannot see Owner A sessions
SELECT is(
  (SELECT count(*)::INTEGER FROM public.sessions WHERE owner_id = 'a0000000-0000-0000-0000-000000000001'),
  0,
  'Owner B cannot read Owner A sessions'
);

-- 26. Owner B can read Session B2 results but NOT Session A2 results
SELECT is(
  (SELECT count(*)::INTEGER FROM public.session_results WHERE session_id = '11111111-1111-1111-1111-111111111112'),
  0,
  'Owner B cannot read Session A2 finalized results'
);

-- ============================================================================
-- Section 7: SECURITY DEFINER RPC Authorization Boundaries
-- ============================================================================

-- Authenticated as Owner A
SET LOCAL "request.jwt.claim.sub" = 'a0000000-0000-0000-0000-000000000001';

-- 27. Calling rpc_owner_get_dashboard on Owner B session throws Unauthorized
SELECT throws_ok(
  $$ SELECT public.rpc_owner_get_dashboard('22222222-2222-2222-2222-222222222221') $$,
  'Unauthorized: Session not found or caller is not owner.',
  'rpc_owner_get_dashboard rejects caller when session belongs to another owner'
);

-- 28. Calling rpc_owner_finalize_session on Owner B session throws Unauthorized
SELECT throws_ok(
  $$ SELECT public.rpc_owner_finalize_session('22222222-2222-2222-2222-222222222221') $$,
  'Unauthorized: Session not found or caller is not owner.',
  'rpc_owner_finalize_session rejects caller when session belongs to another owner'
);

-- 29. Calling rpc_owner_delete_session on Owner B session throws Unauthorized
SELECT throws_ok(
  $$ SELECT public.rpc_owner_delete_session('22222222-2222-2222-2222-222222222221') $$,
  'Unauthorized: Session not found or caller is not owner.',
  'rpc_owner_delete_session rejects caller when session belongs to another owner'
);

-- 30. Calling rpc_owner_set_small_sample_opt_in on Owner B session throws Unauthorized
SELECT throws_ok(
  $$ SELECT public.rpc_owner_set_small_sample_opt_in('22222222-2222-2222-2222-222222222221', true, true) $$,
  'Unauthorized: Session not found or caller is not owner.',
  'rpc_owner_set_small_sample_opt_in rejects caller when session belongs to another owner'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
