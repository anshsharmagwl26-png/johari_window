-- Migration 5: Rate Limiting Atomic Function and Indexes
-- Enforces Stage 3B requirement F: Protection against brute-force token validation and submission failures.
-- Uses short-lived HMAC-keyed bucket hashes with configurable windows and limits.
-- Raw IPs and plaintext tokens are never persisted.

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_bucket_window
ON public.rate_limit_events (bucket_key, event_type, created_at);

-- Atomic check and record rate limit event
CREATE OR REPLACE FUNCTION public.rpc_check_and_record_rate_limit(
  p_bucket_key TEXT,
  p_event_type TEXT,
  p_max_attempts INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_current_count INTEGER;
BEGIN
  v_cutoff := timezone('utc'::text, now()) - (p_window_seconds || ' seconds')::INTERVAL;

  -- Delete expired events for this bucket to keep table small
  DELETE FROM public.rate_limit_events
  WHERE bucket_key = p_bucket_key AND created_at < v_cutoff;

  -- Count recent events within the sliding window
  SELECT count(*) INTO v_current_count
  FROM public.rate_limit_events
  WHERE bucket_key = p_bucket_key
    AND event_type = p_event_type
    AND created_at >= v_cutoff;

  -- If threshold is reached, deny request
  IF v_current_count >= p_max_attempts THEN
    RETURN jsonb_build_object(
      'allowed', FALSE,
      'current_count', v_current_count,
      'retry_after_seconds', p_window_seconds
    );
  END IF;

  -- Record event attempt
  INSERT INTO public.rate_limit_events (bucket_key, event_type, created_at)
  VALUES (p_bucket_key, p_event_type, timezone('utc'::text, now()));

  RETURN jsonb_build_object(
    'allowed', TRUE,
    'current_count', v_current_count + 1,
    'retry_after_seconds', 0
  );
END;
$$;

-- Grant execution privileges
GRANT EXECUTE ON FUNCTION public.rpc_check_and_record_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_check_and_record_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_check_and_record_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
