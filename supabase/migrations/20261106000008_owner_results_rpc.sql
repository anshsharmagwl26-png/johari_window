-- Migration 8: Owner Results Retrieval RPC
-- Enforces:
-- 1. Authenticated session ownership (auth.uid() = session.owner_id)
-- 2. Strictly rejects access to unfinalized sessions (draft, open)
-- 3. Returns complete finalized snapshot with all 55 classified adjectives and feedback counts

CREATE OR REPLACE FUNCTION public.rpc_owner_get_results(
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
  v_result RECORD;
  v_adjectives JSONB;
  v_open_count INTEGER;
  v_blind_count INTEGER;
  v_hidden_count INTEGER;
  v_unknown_count INTEGER;
BEGIN
  v_owner_id := auth.uid();
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller must be an authenticated session owner.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'finalized' THEN
    RAISE EXCEPTION 'Session results are not yet finalized (current status: %). Results are only accessible once the session is finalized.', v_session.status;
  END IF;

  SELECT * INTO v_result
  FROM public.session_results
  WHERE session_id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finalized results snapshot missing for session.';
  END IF;

  -- Aggregate all 55 adjectives joined with their canonical word labels
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'word', a.adjective,
      'sort_order', a.sort_order,
      'quadrant', sra.quadrant,
      'feedback_count', sra.feedback_count
    ) ORDER BY a.sort_order ASC
  ) INTO v_adjectives
  FROM public.session_result_adjectives sra
  JOIN public.adjectives a ON a.id = sra.adjective_id
  WHERE sra.session_id = p_session_id;

  -- Counts
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

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'title', v_session.title,
    'subject_name', v_session.subject_name,
    'status', v_session.status,
    'participant_count', v_result.participant_count,
    'allow_small_sample_results', v_session.allow_small_sample_results,
    'calculation_version', v_result.calculation_version,
    'generated_at', v_result.generated_at,
    'summary', jsonb_build_object(
      'open_count', v_open_count,
      'blind_count', v_blind_count,
      'hidden_count', v_hidden_count,
      'unknown_count', v_unknown_count,
      'total_classified', (v_open_count + v_blind_count + v_hidden_count + v_unknown_count)
    ),
    'adjectives', v_adjectives
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_owner_get_results FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_owner_get_results TO authenticated, service_role;
