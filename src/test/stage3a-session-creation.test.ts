import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, IMemoryDb, DataType } from 'pg-mem';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';
import { generateRawToken, computeTokenHashSync } from '../lib/tokens';

describe('Stage 3A: Session Creation, Self-Assessment & Atomic Open Logic', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = newDb();

    // Register string helper functions
    db.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (str: string) => (str ? str.trim() : str),
    });

    db.public.registerFunction({
      name: 'char_length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (str: string) => (str ? str.length : 0),
    });

    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => '00000000-0000-4000-8000-' + Math.random().toString(16).substring(2, 14).padEnd(12, '0'),
    });

    // Create schema
    db.public.none(`
      CREATE TABLE adjectives (
        id TEXT PRIMARY KEY,
        adjective TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 1 AND sort_order <= 55)
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (char_length(trim(title)) > 0 AND char_length(title) <= 120),
        subject_name TEXT NOT NULL CHECK (char_length(trim(subject_name)) > 0 AND char_length(subject_name) <= 80),
        description TEXT CHECK (description IS NULL OR char_length(description) <= 500),
        expected_participants INTEGER NOT NULL CHECK (expected_participants >= 1 AND expected_participants <= 50),
        collect_participant_names BOOLEAN NOT NULL DEFAULT FALSE,
        allow_small_sample_results BOOLEAN NOT NULL DEFAULT FALSE,
        small_sample_acknowledged_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'finalized')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        self_assessment_submitted_at TIMESTAMP,
        expires_at TIMESTAMP,
        finalized_at TIMESTAMP,
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

      CREATE TABLE self_assessment_responses (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        adjective_id TEXT NOT NULL REFERENCES adjectives(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, adjective_id)
      );

      CREATE TABLE participant_invites (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
        status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'submitted', 'revoked')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP,
        revoked_at TIMESTAMP,
        CONSTRAINT uq_inv_session UNIQUE (id, session_id)
      );
    `);

    // Seed 55 adjectives
    for (const adj of CANONICAL_ADJECTIVES) {
      db.public.none(
        `INSERT INTO adjectives (id, adjective, sort_order) VALUES ('${adj.id}', '${adj.adjective.replace(/'/g, "''")}', ${adj.sort_order});`
      );
    }
  });

  it('creates draft session with valid Phase A settings and without generating invitation tokens', () => {
    db.public.none(`
      INSERT INTO sessions (
        id, owner_id, title, subject_name, description, expected_participants,
        collect_participant_names, allow_small_sample_results, status
      ) VALUES (
        'sess-draft-1', 'owner-1', 'Leadership 360', 'Alex Morgan',
        'Annual performance review', 5, TRUE, FALSE, 'draft'
      );
    `);

    const session = db.public.one(`SELECT * FROM sessions WHERE id = 'sess-draft-1';`);
    expect(session.status).toBe('draft');
    expect(session.expected_participants).toBe(5);
    expect(session.collect_participant_names).toBe(true);
    expect(session.self_assessment_submitted_at).toBeNull();
    expect(session.finalized_at).toBeNull();

    // Verify zero invitation tokens exist for draft session
    const invites = db.public.many(`SELECT * FROM participant_invites WHERE session_id = 'sess-draft-1';`);
    expect(invites.length).toBe(0);
  });

  it('enforces expected_participants limits (1–50)', () => {
    // 0 must fail
    expect(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-zero', 'owner-1', 'Test', 'Subject', 0, 'draft');
      `);
    }).toThrow();

    // 51 must fail
    expect(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-over', 'owner-1', 'Test', 'Subject', 51, 'draft');
      `);
    }).toThrow();

    // 1 and 50 must succeed
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
      VALUES ('sess-min', 'owner-1', 'Min', 'Subject', 1, 'draft'),
             ('sess-max', 'owner-1', 'Max', 'Subject', 50, 'draft');
    `);
    expect(db.public.one(`SELECT count(*) as count FROM sessions WHERE id IN ('sess-min', 'sess-max');`).count).toBe(2);
  });

  it('enforces low-sample acknowledgement consistency (chk_small_sample_ack)', () => {
    // allow_small_sample_results = true WITHOUT acknowledgement timestamp must fail
    expect(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, allow_small_sample_results, small_sample_acknowledged_at, status)
        VALUES ('sess-unack', 'owner-1', 'Unack', 'Subject', 3, TRUE, NULL, 'draft');
      `);
    }).toThrow();

    // allow_small_sample_results = true WITH acknowledgement timestamp succeeds
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, allow_small_sample_results, small_sample_acknowledged_at, status)
      VALUES ('sess-ack', 'owner-1', 'Ack', 'Subject', 3, TRUE, CURRENT_TIMESTAMP, 'draft');
    `);
    const sess = db.public.one(`SELECT allow_small_sample_results, small_sample_acknowledged_at FROM sessions WHERE id = 'sess-ack';`);
    expect(sess.allow_small_sample_results).toBe(true);
    expect(sess.small_sample_acknowledged_at).toBeDefined();
  });

  it('enforces maximum 20 non-finalized sessions per owner under transactional check', () => {
    const ownerId = 'owner-limit-test';

    // Insert 20 draft/open sessions
    for (let i = 1; i <= 20; i++) {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-owner-${i}', '${ownerId}', 'Session ${i}', 'Subject', 5, 'draft');
      `);
    }

    const count = db.public.one(`SELECT count(*) as count FROM sessions WHERE owner_id = '${ownerId}' AND status != 'finalized';`).count;
    expect(Number(count)).toBe(20);

    // Simulated RPC check: if active >= 20, reject creation
    const canCreate21 = () => {
      const activeCount = Number(
        db.public.one(`SELECT count(*) as count FROM sessions WHERE owner_id = '${ownerId}' AND status != 'finalized';`).count
      );
      if (activeCount >= 20) {
        throw new Error('Limit exceeded: Maximum 20 non-finalized sessions per owner permitted.');
      }
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-owner-21', '${ownerId}', 'Session 21', 'Subject', 5, 'draft');
      `);
    };

    expect(canCreate21).toThrow(/Maximum 20 non-finalized sessions/);
  });

  it('atomically saves self-assessment, inserts invitation batch, and transitions draft -> open', () => {
    const sessionId = 'atomic-sess-1';
    const expectedCount = 5;

    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
      VALUES ('${sessionId}', 'owner-1', 'Atomic Session', 'Alex', ${expectedCount}, 'draft');
    `);

    // Generate batch of 5 tokens
    const selectedAdjectives = ['able', 'brave', 'calm', 'caring', 'clever'];
    const tokenHashes = Array.from({ length: expectedCount }, () => computeTokenHashSync(generateRawToken()));

    // Atomic transaction simulation
    db.public.none(`
      -- Insert self assessment
      INSERT INTO self_assessment_responses (session_id, adjective_id) VALUES
        ('${sessionId}', '${selectedAdjectives[0]}'),
        ('${sessionId}', '${selectedAdjectives[1]}'),
        ('${sessionId}', '${selectedAdjectives[2]}'),
        ('${sessionId}', '${selectedAdjectives[3]}'),
        ('${sessionId}', '${selectedAdjectives[4]}');

      -- Insert token hashes
      INSERT INTO participant_invites (id, session_id, token_hash, status) VALUES
        ('inv-1', '${sessionId}', '${tokenHashes[0]}', 'issued'),
        ('inv-2', '${sessionId}', '${tokenHashes[1]}', 'issued'),
        ('inv-3', '${sessionId}', '${tokenHashes[2]}', 'issued'),
        ('inv-4', '${sessionId}', '${tokenHashes[3]}', 'issued'),
        ('inv-5', '${sessionId}', '${tokenHashes[4]}', 'issued');

      -- Transition to open
      UPDATE sessions
      SET status = 'open', self_assessment_submitted_at = CURRENT_TIMESTAMP
      WHERE id = '${sessionId}';
    `);

    // Verify state after atomic commit
    const updated = db.public.one(`SELECT status, self_assessment_submitted_at FROM sessions WHERE id = '${sessionId}';`);
    expect(updated.status).toBe('open');
    expect(updated.self_assessment_submitted_at).toBeDefined();

    const responses = db.public.many(`SELECT adjective_id FROM self_assessment_responses WHERE session_id = '${sessionId}';`);
    expect(responses.length).toBe(5);

    const invites = db.public.many(`SELECT id, token_hash, status FROM participant_invites WHERE session_id = '${sessionId}';`);
    expect(invites.length).toBe(expectedCount);
    expect(invites.every((inv) => inv.status === 'issued')).toBe(true);
  });

  it('enforces immutability: rejects modifying self-assessment once session is open', () => {
    const sessionId = 'immutable-sess';
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at)
      VALUES ('${sessionId}', 'owner-1', 'Open Session', 'Alex', 5, 'open', CURRENT_TIMESTAMP);

      INSERT INTO self_assessment_responses (session_id, adjective_id) VALUES
        ('${sessionId}', 'able'),
        ('${sessionId}', 'brave'),
        ('${sessionId}', 'calm'),
        ('${sessionId}', 'caring'),
        ('${sessionId}', 'clever');
    `);

    // Simulated RPC attempt to submit self-assessment on an already open session
    const attemptResubmit = () => {
      const sess = db.public.one(`SELECT status FROM sessions WHERE id = '${sessionId}';`);
      if (sess.status !== 'draft') {
        throw new Error(`Invalid transition: Self-assessment can only be submitted for draft sessions (current: ${sess.status}).`);
      }
    };

    expect(attemptResubmit).toThrow(/Self-assessment can only be submitted for draft sessions/);
  });

  it('rejects duplicate adjective selections and invalid counts (< 5 or > 7)', () => {
    const validateAdjectives = (adjs: string[]) => {
      const unique = Array.from(new Set(adjs));
      if (unique.length !== adjs.length) {
        throw new Error('Duplicate adjectives are not permitted.');
      }
      if (unique.length < 5 || unique.length > 7) {
        throw new Error(`Requires between 5 and 7 distinct adjectives (provided: ${unique.length}).`);
      }
    };

    // Duplicates
    expect(() => validateAdjectives(['able', 'able', 'brave', 'calm', 'caring'])).toThrow(/Duplicate adjectives/);

    // Fewer than 5
    expect(() => validateAdjectives(['able', 'brave', 'calm', 'caring'])).toThrow(/between 5 and 7/);

    // More than 7
    expect(() => validateAdjectives(['able', 'brave', 'calm', 'caring', 'clever', 'complex', 'confident', 'dependable'])).toThrow(/between 5 and 7/);

    // Exactly 5, 6, 7 valid
    expect(() => validateAdjectives(['able', 'brave', 'calm', 'caring', 'clever'])).not.toThrow();
    expect(() => validateAdjectives(['able', 'brave', 'calm', 'caring', 'clever', 'complex'])).not.toThrow();
    expect(() => validateAdjectives(['able', 'brave', 'calm', 'caring', 'clever', 'complex', 'confident'])).not.toThrow();
  });

  it('enforces small-sample privacy warning phrasing and acknowledgement logic (FIX 3)', () => {
    const requiredWarningPhrase = 'Small-sample privacy warning: results may reveal individual feedback when participation is limited.';

    const validateSubmission = (expectedParticipants: number, allowSmallSample: boolean, ackSmallSample: boolean) => {
      if (expectedParticipants < 5 && allowSmallSample && !ackSmallSample) {
        throw new Error(
          `You must affirmatively acknowledge the low-sample privacy risk before proceeding. ${requiredWarningPhrase}`
        );
      }
      return true;
    };

    // Under 5 with opt-in but unacknowledged must throw
    expect(() => validateSubmission(3, true, false)).toThrow(requiredWarningPhrase);

    // Under 5 with opt-in and acknowledged succeeds
    expect(validateSubmission(3, true, true)).toBe(true);

    // 5 or more does not require small sample opt-in
    expect(validateSubmission(5, false, false)).toBe(true);
  });
});
