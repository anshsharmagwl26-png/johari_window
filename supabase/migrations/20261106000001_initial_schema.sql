-- Migration 1: Initial Schema Definition for Johari Window Application
-- Authoritative schema enforcing relational integrity, session-scoped composite foreign keys,
-- token hash regex (exactly 64 lowercase hex characters), and cascade hard deletion.

-- Enable pgcrypto extension for UUIDs and SHA-256 digests
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom Domain Enums
DO $$ BEGIN
  CREATE TYPE public.session_status AS ENUM ('draft', 'open', 'finalized');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.invite_status AS ENUM ('issued', 'submitted', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.johari_quadrant AS ENUM ('open', 'blind', 'hidden', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. Canonical Adjectives Table
CREATE TABLE IF NOT EXISTS public.adjectives (
  id TEXT PRIMARY KEY,
  adjective TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 1 AND sort_order <= 55)
);

-- 2. Sessions Table
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 120),
  subject_name TEXT NOT NULL CHECK (char_length(trim(subject_name)) > 0 AND char_length(subject_name) <= 80),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
  expected_participants INTEGER NOT NULL CHECK (expected_participants >= 1 AND expected_participants <= 50),
  collect_participant_names BOOLEAN NOT NULL DEFAULT FALSE,
  allow_small_sample_results BOOLEAN NOT NULL DEFAULT FALSE,
  small_sample_acknowledged_at TIMESTAMPTZ,
  status public.session_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  self_assessment_submitted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  CONSTRAINT chk_status_flow CHECK (
    (status = 'draft' AND self_assessment_submitted_at IS NULL AND finalized_at IS NULL) OR
    (status = 'open' AND self_assessment_submitted_at IS NOT NULL AND finalized_at IS NULL) OR
    (status = 'finalized' AND self_assessment_submitted_at IS NOT NULL AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT chk_small_sample_ack CHECK (
    (NOT allow_small_sample_results AND small_sample_acknowledged_at IS NULL) OR
    (allow_small_sample_results AND small_sample_acknowledged_at IS NOT NULL)
  )
);

-- 3. Self-Assessment Responses (Subject selections)
CREATE TABLE IF NOT EXISTS public.self_assessment_responses (
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  adjective_id TEXT NOT NULL REFERENCES public.adjectives(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (session_id, adjective_id)
);

-- 4. Participant Invitations
-- Note: NO expires_at column exists here. All expiry calculations derive from sessions.expires_at using database time.
-- Token hash is strictly 64 lowercase hexadecimal characters (SHA-256 digest).
CREATE TABLE IF NOT EXISTS public.participant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status public.invite_status NOT NULL DEFAULT 'issued',
  replaces_invite_id UUID REFERENCES public.participant_invites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  submitted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT uq_participant_invites_id_session UNIQUE (id, session_id),
  CONSTRAINT chk_invite_status_timestamps CHECK (
    (status = 'issued' AND submitted_at IS NULL AND revoked_at IS NULL) OR
    (status = 'submitted' AND submitted_at IS NOT NULL AND revoked_at IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

-- 5. Participants
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  invite_id UUID NOT NULL UNIQUE,
  participant_name TEXT CHECK (participant_name IS NULL OR (char_length(trim(participant_name)) > 0 AND char_length(participant_name) <= 80)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_participants_id_session UNIQUE (id, session_id),
  CONSTRAINT fk_participant_invite_session FOREIGN KEY (invite_id, session_id)
    REFERENCES public.participant_invites(id, session_id) ON DELETE CASCADE
);

-- 6. Adjective Responses (Participant selections)
CREATE TABLE IF NOT EXISTS public.adjective_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL,
  adjective_id TEXT NOT NULL REFERENCES public.adjectives(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_participant_adjective UNIQUE (participant_id, adjective_id),
  CONSTRAINT fk_adjective_response_participant_session FOREIGN KEY (participant_id, session_id)
    REFERENCES public.participants(id, session_id) ON DELETE CASCADE
);

-- 7. Session Results (Snapshot metadata)
CREATE TABLE IF NOT EXISTS public.session_results (
  session_id UUID PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_count INTEGER NOT NULL CHECK (participant_count >= 1),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  calculation_version TEXT NOT NULL DEFAULT 'v4-traditional'
);

-- 8. Normalized Session Result Adjectives (Exactly 55 rows per finalized session)
CREATE TABLE IF NOT EXISTS public.session_result_adjectives (
  session_id UUID NOT NULL REFERENCES public.session_results(session_id) ON DELETE CASCADE,
  adjective_id TEXT NOT NULL REFERENCES public.adjectives(id) ON DELETE RESTRICT,
  quadrant public.johari_quadrant NOT NULL,
  feedback_count INTEGER NOT NULL CHECK (feedback_count >= 0),
  PRIMARY KEY (session_id, adjective_id)
);

-- 9. Rate Limit Storage (HMAC-keyed buckets with short TTL)
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for performance, security, and lookup integrity
CREATE INDEX IF NOT EXISTS idx_sessions_owner_id ON public.sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_participant_invites_session_id ON public.participant_invites(session_id);
CREATE INDEX IF NOT EXISTS idx_participant_invites_token_hash ON public.participant_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_participant_invites_status ON public.participant_invites(status);

CREATE INDEX IF NOT EXISTS idx_participants_session_id ON public.participants(session_id);
CREATE INDEX IF NOT EXISTS idx_participants_invite_id ON public.participants(invite_id);

CREATE INDEX IF NOT EXISTS idx_adjective_responses_session_id ON public.adjective_responses(session_id);
CREATE INDEX IF NOT EXISTS idx_adjective_responses_participant_id ON public.adjective_responses(participant_id);
CREATE INDEX IF NOT EXISTS idx_adjective_responses_adjective_id ON public.adjective_responses(adjective_id);

CREATE INDEX IF NOT EXISTS idx_session_result_adjectives_session ON public.session_result_adjectives(session_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket ON public.rate_limit_events(bucket_key, created_at);
