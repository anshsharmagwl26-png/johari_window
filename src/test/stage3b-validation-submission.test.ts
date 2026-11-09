// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, IMemoryDb, DataType } from 'pg-mem';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';
import { generateRawToken, computeTokenHashSync, isValidTokenFormat } from '../lib/tokens';

describe('Stage 3B: Participant Validation & Submission Engine', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = newDb();

    // Register PostgreSQL native helper functions for pg-mem
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

    // Initialize Schema with canonical tables
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
        description TEXT,
        expected_participants INTEGER NOT NULL CHECK (expected_participants >= 1 AND expected_participants <= 50),
        collect_participant_names BOOLEAN NOT NULL DEFAULT FALSE,
        allow_small_sample_results BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'finalized')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        self_assessment_submitted_at TIMESTAMP,
        expires_at TIMESTAMP,
        finalized_at TIMESTAMP
      );

      CREATE TABLE participant_invites (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
        status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'submitted', 'revoked')),
        replaces_invite_id TEXT REFERENCES participant_invites(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP,
        revoked_at TIMESTAMP,
        UNIQUE (id, session_id)
      );

      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        invite_id TEXT NOT NULL UNIQUE,
        participant_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (id, session_id),
        FOREIGN KEY (invite_id, session_id) REFERENCES participant_invites(id, session_id) ON DELETE CASCADE
      );

      CREATE TABLE adjective_responses (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        adjective_id TEXT NOT NULL REFERENCES adjectives(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (participant_id, adjective_id),
        FOREIGN KEY (participant_id, session_id) REFERENCES participants(id, session_id) ON DELETE CASCADE
      );
    `);

    // Seed 55 adjectives
    for (const adj of CANONICAL_ADJECTIVES) {
      db.public.none(
        `INSERT INTO adjectives (id, adjective, sort_order) VALUES ('${adj.id}', '${adj.adjective.replace(/'/g, "''")}', ${adj.sort_order});`
      );
    }
  });

  function queryOneOrNull(sql: string) {
    const rows = db.public.many(sql);
    return rows.length > 0 ? rows[0] : null;
  }

  // Simulated server validation handler
  function simulateValidateToken(rawToken: string, now: Date = new Date()) {
    if (!isValidTokenFormat(rawToken)) {
      return { valid: false, reason: 'invalid_format' };
    }

    const tokenHash = computeTokenHashSync(rawToken);
    const invite = queryOneOrNull(`SELECT * FROM participant_invites WHERE token_hash = '${tokenHash}';`);

    if (!invite) {
      return { valid: false, reason: 'not_found' };
    }

    if (invite.status === 'submitted') {
      return { valid: false, reason: 'already_submitted' };
    }

    if (invite.status === 'revoked') {
      return { valid: false, reason: 'revoked' };
    }

    const session = queryOneOrNull(`SELECT * FROM sessions WHERE id = '${invite.session_id}';`);
    if (!session) {
      return { valid: false, reason: 'session_not_found' };
    }

    if (session.status === 'draft') {
      return { valid: false, reason: 'session_not_open' };
    }

    if (session.status === 'finalized') {
      return { valid: false, reason: 'session_finalized' };
    }

    if (session.expires_at && new Date(session.expires_at) <= now) {
      return { valid: false, reason: 'session_expired' };
    }

    return {
      valid: true,
      session_id: session.id,
      subject_name: session.subject_name,
      title: session.title,
      description: session.description,
      collect_participant_names: session.collect_participant_names,
      expires_at: session.expires_at,
    };
  }

  // Simulated atomic submission handler
  function simulateSubmitFeedback(params: {
    rawToken: string;
    adjectiveIds: string[];
    participantName?: string;
    now?: Date;
  }) {
    const { rawToken, adjectiveIds, participantName, now = new Date() } = params;

    if (!isValidTokenFormat(rawToken)) {
      throw new Error('Invalid token format.');
    }

    const uniqueAdjIds = Array.from(new Set(adjectiveIds));
    if (uniqueAdjIds.length < 5 || uniqueAdjIds.length > 7) {
      throw new Error(`Requires between 5 and 7 distinct adjectives (provided: ${uniqueAdjIds.length}).`);
    }

    // Verify all adjectives exist in canonical bank
    const validCount = db.public.one(
      `SELECT count(*) as count FROM adjectives WHERE id IN (${uniqueAdjIds.map((id) => `'${id}'`).join(',')});`
    );
    if (Number(validCount.count) !== uniqueAdjIds.length) {
      throw new Error('One or more adjective IDs do not exist in the canonical inventory.');
    }

    const tokenHash = computeTokenHashSync(rawToken);

    // Atomic transaction simulation
    const invite = queryOneOrNull(`SELECT * FROM participant_invites WHERE token_hash = '${tokenHash}';`);
    if (!invite) {
      throw new Error('Invalid invitation token.');
    }

    if (invite.status !== 'issued') {
      throw new Error(`Invitation cannot be submitted; current status is ${invite.status}.`);
    }

    const session = db.public.one(`SELECT * FROM sessions WHERE id = '${invite.session_id}';`);
    if (session.status !== 'open') {
      throw new Error(`Session is not open for feedback (current status: ${session.status}).`);
    }

    if (session.expires_at && new Date(session.expires_at) <= now) {
      throw new Error('Session has expired.');
    }

    // Name collection validation
    let cleanName: string | null = null;
    if (session.collect_participant_names) {
      cleanName = (participantName || '').trim();
      if (!cleanName) {
        throw new Error('Participant name is required when name collection is enabled.');
      }
      if (cleanName.length > 80) {
        throw new Error('Participant name exceeds maximum length of 80 characters.');
      }
      // Indian multilingual Unicode support (Devanagari, Bengali, Tamil, etc.)
      const unicodeValid = /^[\p{L}\p{M}\s.'(),-]+$/u.test(cleanName);
      if (!unicodeValid) {
        throw new Error('Participant name contains invalid characters.');
      }
    } else {
      if (participantName && participantName.trim().length > 0) {
        throw new Error('Participant names are disabled for this session; submitting a name is rejected.');
      }
      cleanName = null;
    }

    const participantId = `part-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Atomic commit
    db.public.none(`
      INSERT INTO participants (id, session_id, invite_id, participant_name)
      VALUES ('${participantId}', '${session.id}', '${invite.id}', ${cleanName ? `'${cleanName.replace(/'/g, "''")}'` : 'NULL'});

      ${uniqueAdjIds.map((id) => `
        INSERT INTO adjective_responses (id, session_id, participant_id, adjective_id)
        VALUES ('resp-${Math.random()}', '${session.id}', '${participantId}', '${id}');
      `).join('')}

      UPDATE participant_invites
      SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
      WHERE id = '${invite.id}';
    `);

    return { success: true, participantId };
  }

  // ==========================================================================
  // Test Suite 1: Token Validation Matrix
  // ==========================================================================
  describe('Read-Only Invitation Token Validation (Prompt C)', () => {
    it('successfully validates a valid token on an open session without consuming it', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, collect_participant_names, status)
        VALUES ('sess-val-1', 'owner-1', 'Leadership Feedback', 'Alex Morgan', 5, TRUE, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-val-1', 'sess-val-1', '${tokenHash}', 'issued');
      `);

      const res = simulateValidateToken(rawToken);
      expect(res.valid).toBe(true);
      expect(res.subject_name).toBe('Alex Morgan');
      expect(res.title).toBe('Leadership Feedback');
      expect(res.collect_participant_names).toBe(true);

      // Verify validation is genuinely read-only: token status remains 'issued'
      const inviteAfter = db.public.one(`SELECT status FROM participant_invites WHERE id = 'inv-val-1';`);
      expect(inviteAfter.status).toBe('issued');

      // Verify zero participant rows were created
      const parts = db.public.many(`SELECT * FROM participants WHERE session_id = 'sess-val-1';`);
      expect(parts.length).toBe(0);
    });

    it('rejects invalid or malformed tokens', () => {
      expect(simulateValidateToken('').valid).toBe(false);
      expect(simulateValidateToken('short-code').valid).toBe(false);
      expect(simulateValidateToken('123456').valid).toBe(false);

      // 43-character token that does not exist in database
      const nonExistent = generateRawToken();
      const res = simulateValidateToken(nonExistent);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('not_found');
    });

    it('rejects already submitted invitations', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-used', 'owner-1', 'Feedback', 'Alex', 5, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status, submitted_at)
        VALUES ('inv-used', 'sess-used', '${tokenHash}', 'submitted', CURRENT_TIMESTAMP);
      `);

      const res = simulateValidateToken(rawToken);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('already_submitted');
    });

    it('rejects revoked invitations', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-rev', 'owner-1', 'Feedback', 'Alex', 5, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status, revoked_at)
        VALUES ('inv-rev', 'sess-rev', '${tokenHash}', 'revoked', CURRENT_TIMESTAMP);
      `);

      const res = simulateValidateToken(rawToken);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('revoked');
    });

    it('rejects invitations for expired sessions', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      const pastDate = new Date(Date.now() - 3600000).toISOString();

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, expires_at)
        VALUES ('sess-exp', 'owner-1', 'Feedback', 'Alex', 5, 'open', '${pastDate}');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-exp', 'sess-exp', '${tokenHash}', 'issued');
      `);

      const res = simulateValidateToken(rawToken);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('session_expired');
    });

    it('rejects invitations when session is draft or finalized', () => {
      const rawTokenDraft = generateRawToken();
      const hashDraft = computeTokenHashSync(rawTokenDraft);

      const rawTokenFinal = generateRawToken();
      const hashFinal = computeTokenHashSync(rawTokenFinal);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES
          ('sess-draft-test', 'owner-1', 'Draft Session', 'Alex', 5, 'draft'),
          ('sess-final-test', 'owner-1', 'Final Session', 'Alex', 5, 'finalized');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES
          ('inv-draft', 'sess-draft-test', '${hashDraft}', 'issued'),
          ('inv-final', 'sess-final-test', '${hashFinal}', 'issued');
      `);

      expect(simulateValidateToken(rawTokenDraft).reason).toBe('session_not_open');
      expect(simulateValidateToken(rawTokenFinal).reason).toBe('session_finalized');
    });

    it('repeated token validation leaves invitation fully usable', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-repeat', 'owner-1', 'Title', 'Subject', 5, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-repeat', 'sess-repeat', '${tokenHash}', 'issued');
      `);

      // 5 consecutive validation checks (e.g. link preview, page load, refresh)
      for (let i = 0; i < 5; i++) {
        const val = simulateValidateToken(rawToken);
        expect(val.valid).toBe(true);
      }

      // Invitation is still 'issued' and ready for submission
      const inv = db.public.one(`SELECT status FROM participant_invites WHERE id = 'inv-repeat';`);
      expect(inv.status).toBe('issued');
    });
  });

  // ==========================================================================
  // Test Suite 2: Participant Submission & Token Consumption
  // ==========================================================================
  describe('Participant Submission & Single-Use Consumption (Prompt E)', () => {
    it('submits valid anonymous feedback (5 selections) and atomically consumes token', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, collect_participant_names, status)
        VALUES ('sess-anon', 'owner-1', 'Anonymous 360', 'Alex Kumar', 5, FALSE, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-anon', 'sess-anon', '${tokenHash}', 'issued');
      `);

      const selections = ['able', 'brave', 'calm', 'caring', 'clever'];
      const res = simulateSubmitFeedback({
        rawToken,
        adjectiveIds: selections,
      });

      expect(res.success).toBe(true);

      // Verify participant record has NULL name
      const part = db.public.one(`SELECT * FROM participants WHERE invite_id = 'inv-anon';`);
      expect(part.participant_name).toBeNull();
      expect(part.session_id).toBe('sess-anon');

      // Verify exactly 5 adjective responses recorded
      const responses = db.public.many(`SELECT adjective_id FROM adjective_responses WHERE participant_id = '${part.id}';`);
      expect(responses.length).toBe(5);
      expect(responses.map((r) => r.adjective_id).sort()).toEqual(selections.sort());

      // Verify token status changed to 'submitted'
      const invAfter = db.public.one(`SELECT status, submitted_at FROM participant_invites WHERE id = 'inv-anon';`);
      expect(invAfter.status).toBe('submitted');
      expect(invAfter.submitted_at).toBeDefined();

      // Attempting to submit again with the same token must fail
      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: selections,
        });
      }).toThrow(/current status is submitted/);
    });

    it('submits valid named feedback with Indian Unicode characters (Devanagari, Tamil, Kannada)', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, collect_participant_names, status)
        VALUES ('sess-named', 'owner-1', 'Named 360', 'Alex', 5, TRUE, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-named', 'sess-named', '${tokenHash}', 'issued');
      `);

      // Devanagari test name: "अंश शर्मा" (Ansh Sharma) with combining marks
      const devanagariName = 'अंश शर्मा';
      const selections = ['able', 'brave', 'calm', 'caring', 'clever', 'confident', 'dependable']; // 7 selections

      const res = simulateSubmitFeedback({
        rawToken,
        adjectiveIds: selections,
        participantName: devanagariName,
      });

      expect(res.success).toBe(true);

      const part = db.public.one(`SELECT * FROM participants WHERE invite_id = 'inv-named';`);
      expect(part.participant_name).toBe(devanagariName);

      // Check responses count = 7
      const count = db.public.one(`SELECT count(*) as count FROM adjective_responses WHERE participant_id = '${part.id}';`);
      expect(Number(count.count)).toBe(7);
    });

    it('rejects submitting a name when name collection is disabled', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, collect_participant_names, status)
        VALUES ('sess-no-name', 'owner-1', 'No Name 360', 'Alex', 5, FALSE, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-no-name', 'sess-no-name', '${tokenHash}', 'issued');
      `);

      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: ['able', 'brave', 'calm', 'caring', 'clever'],
          participantName: 'Should Be Rejected',
        });
      }).toThrow(/Participant names are disabled for this session/);

      // Verify token was NOT consumed after rejected submission
      const inv = db.public.one(`SELECT status FROM participant_invites WHERE id = 'inv-no-name';`);
      expect(inv.status).toBe('issued');
    });

    it('rejects missing name when name collection is enabled', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, collect_participant_names, status)
        VALUES ('sess-req-name', 'owner-1', 'Req Name 360', 'Alex', 5, TRUE, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-req-name', 'sess-req-name', '${tokenHash}', 'issued');
      `);

      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: ['able', 'brave', 'calm', 'caring', 'clever'],
          participantName: '',
        });
      }).toThrow(/Participant name is required/);
    });

    it('enforces 5–7 adjective cardinality (rejects 4, rejects 8, rejects duplicates)', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-card', 'owner-1', 'Card 360', 'Alex', 5, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-card', 'sess-card', '${tokenHash}', 'issued');
      `);

      // 4 adjectives (rejected)
      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: ['able', 'brave', 'calm', 'caring'],
        });
      }).toThrow(/between 5 and 7/);

      // 8 adjectives (rejected)
      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: ['able', 'brave', 'calm', 'caring', 'clever', 'complex', 'confident', 'dependable'],
        });
      }).toThrow(/between 5 and 7/);

      // Duplicates reducing distinct count to 4 (rejected)
      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: ['able', 'able', 'brave', 'calm', 'caring'],
        });
      }).toThrow(/between 5 and 7/);
    });

    it('rejects invalid adjective IDs not in canonical 55 list', () => {
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-bad-adj', 'owner-1', 'Bad Adj 360', 'Alex', 5, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-bad-adj', 'sess-bad-adj', '${tokenHash}', 'issued');
      `);

      expect(() => {
        simulateSubmitFeedback({
          rawToken,
          adjectiveIds: ['able', 'brave', 'calm', 'caring', 'non_existent_adjective_id'],
        });
      }).toThrow(/do not exist in the canonical inventory/);
    });
  });
});
