-- pgTAP SQL Test Suite 1: Database Invariants and Adjective Seed Verification
BEGIN;
SELECT plan(8);

-- Test 1: Check table existence
SELECT has_table('public', 'adjectives', 'Table public.adjectives exists');
SELECT has_table('public', 'sessions', 'Table public.sessions exists');
SELECT has_table('public', 'participant_invites', 'Table public.participant_invites exists');
SELECT has_table('public', 'participants', 'Table public.participants exists');

-- Test 2: Verify exact count of 55 adjectives
SELECT is(
  (SELECT count(*)::INTEGER FROM public.adjectives),
  55,
  'Public.adjectives must contain exactly 55 seeded entries'
);

-- Test 3: Verify "Lamed" is preserved exactly as printed
SELECT is(
  (SELECT adjective FROM public.adjectives WHERE id = 'lamed'),
  'Lamed',
  'Adjective "Lamed" is preserved exactly as printed in reference photograph'
);

-- Test 4: Verify no participant_invites.expires_at column exists
SELECT hasnt_column(
  'public',
  'participant_invites',
  'expires_at',
  'participant_invites must NOT have an expires_at column (all expiry derives from sessions.expires_at)'
);

-- Test 5: Verify contiguous sort orders from 1 to 55
SELECT is(
  (SELECT count(*)::INTEGER FROM public.adjectives WHERE sort_order BETWEEN 1 AND 55),
  55,
  'All 55 adjectives have sort_order contiguous between 1 and 55'
);

SELECT * FROM finish();
ROLLBACK;
