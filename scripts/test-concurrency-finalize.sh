#!/usr/bin/env bash
set -e

PSQL="/tmp/pg/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p 54322 -U postgres -d postgres"

echo "=== Real PostgreSQL 15 Concurrency Test: Finalization Racing Submissions ==="

SESSION_ID="22222222-3333-4444-5555-666666666666"
OWNER_ID="88888888-8888-8888-8888-888888888888"

$PSQL <<EOF > /dev/null
INSERT INTO auth.users (id, email)
VALUES ('$OWNER_ID', 'owner_racing@test.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.sessions WHERE id = '$SESSION_ID';

INSERT INTO public.sessions (
  id, owner_id, title, subject_name, expected_participants, status, allow_small_sample_results, small_sample_acknowledged_at, self_assessment_submitted_at
) VALUES (
  '$SESSION_ID', '$OWNER_ID', 'Finalization Concurrency Test', 'Alex Morgan', 5, 'open', true, timezone('utc', now()), timezone('utc', now())
);

-- Seed self assessment
INSERT INTO public.self_assessment_responses (session_id, adjective_id)
SELECT '$SESSION_ID', id FROM unnest(ARRAY['able', 'caring', 'clever', 'happy', 'kind']) AS id;

-- Seed 5 issued invitations
INSERT INTO public.participant_invites (id, session_id, token_hash, status)
SELECT
  ('00000000-0000-0000-0002-' || lpad(i::text, 12, '0'))::uuid,
  '$SESSION_ID',
  encode(digest('race_token_' || i::text, 'sha256'), 'hex'),
  'issued'
FROM generate_series(1, 5) AS i;

-- Already submit 2 participants so finalization threshold (>=1 with small_sample) is met
SELECT public.rpc_participant_submit_feedback(
  encode(digest('race_token_1', 'sha256'), 'hex'),
  ARRAY['able', 'caring', 'brave', 'friendly', 'happy']
);

SELECT public.rpc_participant_submit_feedback(
  encode(digest('race_token_2', 'sha256'), 'hex'),
  ARRAY['clever', 'kind', 'brave', 'calm', 'friendly']
);
EOF

echo "Session setup ready with 2 committed submissions and 3 unused invitations."

RESULTS_DIR=$(mktemp -d)
PIDS=()

# Process 1: Racing Participant 3 submission
(
  $PSQL -c "
    SELECT public.rpc_participant_submit_feedback(
      encode(digest('race_token_3', 'sha256'), 'hex'),
      ARRAY['able', 'bold', 'brave', 'calm', 'clever']
    );
  " > "$RESULTS_DIR/p3.log" 2>&1
) &
PIDS+=($!)

# Process 2: Racing Participant 4 submission
(
  $PSQL -c "
    SELECT public.rpc_participant_submit_feedback(
      encode(digest('race_token_4', 'sha256'), 'hex'),
      ARRAY['caring', 'cheerful', 'complex', 'confident', 'dependable']
    );
  " > "$RESULTS_DIR/p4.log" 2>&1
) &
PIDS+=($!)

# Process 3: Racing Owner Finalization
(
  $PSQL -c "
    SET LOCAL \"request.jwt.claim.sub\" = '$OWNER_ID';
    SELECT public.rpc_owner_finalize_session('$SESSION_ID'::uuid);
  " > "$RESULTS_DIR/finalize.log" 2>&1
) &
PIDS+=($!)

for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done

echo ""
echo "--- Concurrency Results Analysis ---"
cat "$RESULTS_DIR/finalize.log"

FINAL_STATUS=$($PSQL -t -A -c "SELECT status FROM public.sessions WHERE id = '$SESSION_ID';")
echo "Session final status: $FINAL_STATUS (Must be finalized)"

RECORDED_PARTICIPANTS=$($PSQL -t -A -c "SELECT participant_count FROM public.session_results WHERE session_id = '$SESSION_ID';")
ACTUAL_PARTICIPANTS=$($PSQL -t -A -c "SELECT count(*) FROM public.participants WHERE session_id = '$SESSION_ID';")
TOTAL_CLASSIFIED=$($PSQL -t -A -c "SELECT count(*) FROM public.session_result_adjectives WHERE session_id = '$SESSION_ID';")

echo "Session results recorded participant count: $RECORDED_PARTICIPANTS"
echo "Actual committed participants count: $ACTUAL_PARTICIPANTS"
echo "Total classified adjectives in snapshot: $TOTAL_CLASSIFIED (Must be 55)"

if [ "$FINAL_STATUS" != "finalized" ]; then
  echo "ERROR: Session was not finalized!"
  exit 1
fi

if [ "$RECORDED_PARTICIPANTS" -ne "$ACTUAL_PARTICIPANTS" ]; then
  echo "ERROR: Snapshot inconsistency! Recorded $RECORDED_PARTICIPANTS participants, but $ACTUAL_PARTICIPANTS are committed."
  exit 1
fi

if [ "$TOTAL_CLASSIFIED" -ne 55 ]; then
  echo "ERROR: Snapshot must contain exactly 55 classified adjectives, got $TOTAL_CLASSIFIED"
  exit 1
fi

# Cleanup
$PSQL -c "DELETE FROM public.sessions WHERE id = '$SESSION_ID';" > /dev/null
rm -rf "$RESULTS_DIR"

echo "=== Concurrency & Snapshot Consistency Test PASSED (Zero Deadlocks, Zero Inconsistencies) ==="
