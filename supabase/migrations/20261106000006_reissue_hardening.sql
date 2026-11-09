-- Migration 6: Hardened Invitation Reissuance with Session Expiry Check
-- Enforces Stage 3C Requirements:
-- 1. Owner authorization (auth.uid() = session.owner_id)
-- 2. Open session status (sessions.status = 'open')
-- 3. Expiry check against database time (sessions.expires_at > now())
-- 4. Only issued, unused invitations can be replaced
-- 5. Previously submitted invitations can NEVER be reissued
-- 6. Enforces 200-record lifetime cap per session
-- 7. Atomic revocation and replacement

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
    RAISE EXCEPTION 'Unauthorized: Caller must be an authenticated session owner.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Invitations can only be reissued for open sessions (current status: %).', v_session.status;
  END IF;

  -- Check session expiry against database time
  IF v_session.expires_at IS NOT NULL AND v_session.expires_at <= timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'Cannot reissue invitations: Session has expired.';
  END IF;

  -- Lock and verify old invitation is currently 'issued'
  SELECT * INTO v_old_invite
  FROM public.participant_invites
  WHERE id = p_old_invite_id AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Old invitation not found in this session.';
  END IF;

  IF v_old_invite.status = 'submitted' THEN
    RAISE EXCEPTION 'Previously submitted invitations cannot be reissued.';
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

  -- Atomically revoke old invitation
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
  RETURNING id, session_id, token_hash, status, replaces_invite_id, created_at INTO v_new_invite;

  RETURN jsonb_build_object(
    'id', v_new_invite.id,
    'token_hash', v_new_invite.token_hash,
    'replaces_invite_id', v_new_invite.replaces_invite_id
  );
END;
$$;

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
    RAISE EXCEPTION 'Unauthorized: Caller must be an authenticated session owner.';
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.owner_id != v_owner_id THEN
    RAISE EXCEPTION 'Unauthorized: Session not found or caller is not owner.';
  END IF;

  IF v_session.status != 'open' THEN
    RAISE EXCEPTION 'Invitations can only be reissued for open sessions (current status: %).', v_session.status;
  END IF;

  -- Check session expiry against database time
  IF v_session.expires_at IS NOT NULL AND v_session.expires_at <= timezone('utc'::text, now()) THEN
    RAISE EXCEPTION 'Cannot reissue invitations: Session has expired.';
  END IF;

  -- Lock all unused invitations in this session
  PERFORM * FROM public.participant_invites
  WHERE session_id = p_session_id AND status = 'issued'
  FOR UPDATE;

  SELECT count(*) INTO v_unused_count
  FROM public.participant_invites
  WHERE session_id = p_session_id AND status = 'issued';

  IF v_unused_count = 0 THEN
    RETURN jsonb_build_object('reissued_count', 0, 'invites', '[]'::jsonb);
  END IF;

  v_new_count := cardinality(p_new_token_hashes);
  IF v_unused_count != v_new_count THEN
    RAISE EXCEPTION 'Token hash count (%) does not match unused invitation count (%).', v_new_count, v_unused_count;
  END IF;

  -- Check lifetime cap (200 records)
  SELECT count(*) INTO v_total_lifetime_count
  FROM public.participant_invites
  WHERE session_id = p_session_id;

  IF (v_total_lifetime_count + v_new_count) > 200 THEN
    RAISE EXCEPTION 'Operation would exceed lifetime invitation cap of 200 records per session (current: %, adding: %).', v_total_lifetime_count, v_new_count;
  END IF;

  -- Revoke all currently issued invitations
  UPDATE public.participant_invites
  SET
    status = 'revoked',
    revoked_at = timezone('utc'::text, now())
  WHERE session_id = p_session_id AND status = 'issued';

  -- Atomically insert replacement invitations
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
