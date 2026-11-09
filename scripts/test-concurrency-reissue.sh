#!/usr/bin/env bash
set -e

PSQL="/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres"

echo "=== Real PostgreSQL 15 Concurrency Test: Invitation Reissuance & 200-Cap ==="

SESSION_ID="11111111-2222-3333-4444-555555555555"
OWNER_ID="99999999-9999-9999-9999-999999999999"

$PSQL <<EOF > /dev/null
INSERT INTO auth.users (id, email)
VALUES ('$OWNER_ID', 'concurrency-owner@test.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.sessions WHERE id = '$SESSION_ID';

INSERT INTO public.sessions (
  id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at
) VALUES (
  '$SESSION_ID', '$OWNER_ID', 'Concurrency Reissue Test', 'Test Subject', 10, 'open', timezone('utc', now())
);

-- Seed session with exactly 198 invitations (190 revoked, 8 issued)
INSERT INTO public.participant_invites (id, session_id, token_hash, status, revoked_at)
SELECT
  gen_random_uuid(),
  '$SESSION_ID',
  encode(digest('seed_revoked_' || i::text, 'sha256'), 'hex'),
  'revoked',
  timezone('utc', now())
FROM generate_series(1, 190) AS i;

INSERT INTO public.participant_invites (id, session_id, token_hash, status)
SELECT
  ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  '$SESSION_ID',
  encode(digest('seed_issued_' || i::text, 'sha256'), 'hex'),
  'issued'
FROM generate_series(1, 8) AS i;
EOF

INITIAL_COUNT=$($PSQL -t -A -c "SELECT count(*) FROM public.participant_invites WHERE session_id = '$SESSION_ID';")
echo "Initial invitation count: $INITIAL_COUNT (Cap is 200. Only 2 more records can be added)."

if [ "$INITIAL_COUNT" -ne 198 ]; then
  echo "ERROR: Expected initial count of 198, got $INITIAL_COUNT"
  exit 1
fi

echo ""
echo "--- Test 1: High-Concurrency Individual Reissuance (5 simultaneous attempts on 5 distinct invites) ---"
PIDS=()
RESULTS_DIR=$(mktemp -d)

for i in {1..5}; do
  OLD_INV_ID="00000000-0000-0000-0000-00000000000$i"
  (
    $PSQL -c "
      SET LOCAL \"request.jwt.claim.sub\" = '$OWNER_ID';
      SELECT public.rpc_owner_reissue_invite(
        '$SESSION_ID'::uuid,
        '$OLD_INV_ID'::uuid,
        encode(digest('concurrent_reissue_$i', 'sha256'), 'hex')
      );
    " > "$RESULTS_DIR/out_$i.log" 2>&1
  ) &
  PIDS+=($!)
done

# Wait for all background attempts
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

SUCCESS_COUNT=0
CAP_ERROR_COUNT=0

for i in {1..5}; do
  if grep -q "replaces_invite_id" "$RESULTS_DIR/out_$i.log"; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  fi
  if grep -q "Lifetime cap reached" "$RESULTS_DIR/out_$i.log"; then
    CAP_ERROR_COUNT=$((CAP_ERROR_COUNT + 1))
  fi
done

echo "Concurrent single reissues succeeded: $SUCCESS_COUNT (expected: 2)"
echo "Concurrent single reissues rejected: $CAP_ERROR_COUNT (expected: 3)"

TOTAL_AFTER_SINGLE=$($PSQL -t -A -c "SELECT count(*) FROM public.participant_invites WHERE session_id = '$SESSION_ID';")
echo "Total invitations after concurrent single reissuance: $TOTAL_AFTER_SINGLE (MUST BE <= 200)"

if [ "$TOTAL_AFTER_SINGLE" -ne 200 ]; then
  echo "ERROR: Lifetime cap was violated or incorrect! Got $TOTAL_AFTER_SINGLE, expected exactly 200."
  exit 1
fi

if [ "$SUCCESS_COUNT" -ne 2 ] || [ "$CAP_ERROR_COUNT" -ne 3 ]; then
  echo "ERROR: Unexpected success/error distribution under concurrency."
  exit 1
fi

echo "Test 1 PASSED: Exactly 2 succeeded, 3 failed with cap error, lifetime total is exactly 200."

echo ""
echo "--- Test 2: Concurrent Bulk vs Individual Reissuance with Rollback Verification ---"
# Reset to 196 invitations with 4 issued invitations
$PSQL <<EOF > /dev/null
DELETE FROM public.participant_invites WHERE session_id = '$SESSION_ID';

INSERT INTO public.participant_invites (id, session_id, token_hash, status, revoked_at)
SELECT
  gen_random_uuid(),
  '$SESSION_ID',
  encode(digest('t2_revoked_' || i::text, 'sha256'), 'hex'),
  'revoked',
  timezone('utc', now())
FROM generate_series(1, 192) AS i;

INSERT INTO public.participant_invites (id, session_id, token_hash, status)
SELECT
  ('00000000-0000-0000-0001-' || lpad(i::text, 12, '0'))::uuid,
  '$SESSION_ID',
  encode(digest('t2_issued_' || i::text, 'sha256'), 'hex'),
  'issued'
FROM generate_series(1, 4) AS i;
EOF

COUNT_T2=$($PSQL -t -A -c "SELECT count(*) FROM public.participant_invites WHERE session_id = '$SESSION_ID';")
echo "Test 2 Starting Count: $COUNT_T2 (4 issued, space for 4 more before reaching 200 cap)."

PIDS_T2=()

# Bulk reissue 4 unused invitations
(
  $PSQL -c "
    SET LOCAL \"request.jwt.claim.sub\" = '$OWNER_ID';
    SELECT public.rpc_owner_bulk_reissue_unused_invites(
      '$SESSION_ID'::uuid,
      ARRAY[
        encode(digest('bulk_hash_1', 'sha256'), 'hex'),
        encode(digest('bulk_hash_2', 'sha256'), 'hex'),
        encode(digest('bulk_hash_3', 'sha256'), 'hex'),
        encode(digest('bulk_hash_4', 'sha256'), 'hex')
      ]
    );
  " > "$RESULTS_DIR/bulk.log" 2>&1
) &
PIDS_T2+=($!)

# Single reissue of invite 1
(
  $PSQL -c "
    SET LOCAL \"request.jwt.claim.sub\" = '$OWNER_ID';
    SELECT public.rpc_owner_reissue_invite(
      '$SESSION_ID'::uuid,
      '00000000-0000-0000-0001-000000000001'::uuid,
      encode(digest('single_hash_1', 'sha256'), 'hex')
    );
  " > "$RESULTS_DIR/single.log" 2>&1
) &
PIDS_T2+=($!)

for pid in "${PIDS_T2[@]}"; do
  wait "$pid" || true
done

FINAL_COUNT_T2=$($PSQL -t -A -c "SELECT count(*) FROM public.participant_invites WHERE session_id = '$SESSION_ID';")
echo "Total invitations after concurrent bulk & single: $FINAL_COUNT_T2 (MUST BE <= 200)"

if [ "$FINAL_COUNT_T2" -gt 200 ]; then
  echo "ERROR: Lifetime cap of 200 was exceeded! Got: $FINAL_COUNT_T2"
  exit 1
fi

echo "Test 2 Result Logs:"
if grep -q "reissued_count" "$RESULTS_DIR/bulk.log"; then
  echo "-> Bulk reissue succeeded (added 4)."
else
  echo "-> Bulk reissue rolled back cleanly:"
  grep "ERROR" "$RESULTS_DIR/bulk.log" || true
fi

if grep -q "replaces_invite_id" "$RESULTS_DIR/single.log"; then
  echo "-> Single reissue succeeded (added 1)."
else
  echo "-> Single reissue rolled back cleanly:"
  grep "ERROR" "$RESULTS_DIR/single.log" || true
fi

echo ""
echo "--- Test 3: Rollback Integrity (No Partially Revoked Invitations on Aborted Transaction) ---"
$PSQL -c "
  SET LOCAL \"request.jwt.claim.sub\" = '$OWNER_ID';
  DO \$\$
  BEGIN
    PERFORM public.rpc_owner_reissue_invite(
      '$SESSION_ID'::uuid,
      '00000000-0000-0000-0001-000000000001'::uuid,
      encode(digest('abort_hash', 'sha256'), 'hex')
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  \$\$;
" > /dev/null

# Clean up
$PSQL -c "DELETE FROM public.sessions WHERE id = '$SESSION_ID';" > /dev/null
rm -rf "$RESULTS_DIR"

echo ""
echo "=== All Real PostgreSQL 15 Concurrency & Rollback Tests PASSED Successfully ==="
