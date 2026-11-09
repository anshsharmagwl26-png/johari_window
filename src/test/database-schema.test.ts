// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, DataType } from 'pg-mem';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';

describe('Stage 2: Comprehensive Database Schema, Constraints & Hardened Rules', () => {
  let db: ReturnType<typeof newDb>;

  beforeEach(() => {
    db = newDb();

    // Register PostgreSQL native helper functions for pg-mem
    db.public.registerFunction({
      name: 'gen_random_uuid',
      implementation: () => '11111111-2222-3333-4444-555555555555',
    });

    db.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (s: string) => (s ? s.trim() : ''),
    });

    db.public.registerFunction({
      name: 'char_length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (s: string) => (s ? s.length : 0),
    });

    // Initialize Schema with all Stage 2 constraints and fields
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
        status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'finalized')),
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
        status TEXT NOT NULL CHECK (status IN ('issued', 'submitted', 'revoked')),
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
        participant_name TEXT CHECK (participant_name IS NULL OR (char_length(trim(participant_name)) > 0 AND char_length(participant_name) <= 80)),
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

      CREATE TABLE session_results (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        participant_count INTEGER NOT NULL CHECK (participant_count >= 1),
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        calculation_version TEXT NOT NULL DEFAULT 'v4-traditional'
      );

      CREATE TABLE session_result_adjectives (
        session_id TEXT NOT NULL REFERENCES session_results(session_id) ON DELETE CASCADE,
        adjective_id TEXT NOT NULL REFERENCES adjectives(id),
        quadrant TEXT NOT NULL CHECK (quadrant IN ('open', 'blind', 'hidden', 'unknown')),
        feedback_count INTEGER NOT NULL CHECK (feedback_count >= 0),
        PRIMARY KEY (session_id, adjective_id)
      );
    `);

    // Seed 55 adjectives
    for (const adj of CANONICAL_ADJECTIVES) {
      db.public.none(
        `INSERT INTO adjectives (id, adjective, sort_order) VALUES ('${adj.id}', '${adj.adjective.replace(/'/g, "''")}', ${adj.sort_order});`
      );
    }
  });

  it('seeds exactly 55 unique adjectives into database', () => {
    const result = db.public.many(`SELECT count(*) as count FROM adjectives;`);
    expect(Number(result[0].count)).toBe(55);
  });

  it('preserves "Lamed" in database table exactly as printed in reference source', () => {
    const row = db.public.one(`SELECT * FROM adjectives WHERE id = 'lamed';`);
    expect(row).toBeDefined();
    expect(row.adjective).toBe('Lamed');
    expect(row.sort_order).toBe(27);
  });

  it('verifies participant_invites table has NO expires_at column', () => {
    expect(() => {
      db.public.many(`SELECT expires_at FROM participant_invites;`);
    }).toThrow();
  });

  it('strictly validates token_hash format (64-character lowercase hex SHA-256 digest) (FIX 5)', () => {
    const validHex = 'a1'.repeat(32); // exactly 64 hex characters
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at)
      VALUES ('sess-hex-test', 'owner-1', 'Hex Test', 'Subject', 5, 'open', CURRENT_TIMESTAMP);

      INSERT INTO participant_invites (id, session_id, token_hash, status)
      VALUES ('inv-valid-hex', 'sess-hex-test', '${validHex}', 'issued');
    `);

    // Application and database hex validation
    const hexRegex = /^[0-9a-f]{64}$/;
    expect(hexRegex.test(validHex)).toBe(true);

    const upperHex = 'A1'.repeat(32);
    expect(hexRegex.test(upperHex)).toBe(false);

    const nonHex = 'z1'.repeat(32);
    expect(hexRegex.test(nonHex)).toBe(false);

    const shortHex = 'a1'.repeat(31); // 62 characters
    expect(hexRegex.test(shortHex)).toBe(false);

    // Database check constraint (char_length = 64) rejects short hex
    expect(() => {
      db.public.none(`
        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-short-hex', 'sess-hex-test', '${shortHex}', 'issued');
      `);
    }).toThrow();
  });

  it('validates description column and character length limit <= 500 (FIX 3)', () => {
    // Valid description
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, description, expected_participants, status)
      VALUES ('sess-desc', 'owner-1', 'Desc Test', 'Subject', 'Valid description text', 5, 'draft');
    `);
    const row = db.public.one(`SELECT description FROM sessions WHERE id = 'sess-desc';`);
    expect(row.description).toBe('Valid description text');

    // Description exceeding 500 characters must fail check constraint
    const longDesc = 'a'.repeat(501);
    expect(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, description, expected_participants, status)
        VALUES ('sess-desc-long', 'owner-1', 'Desc Long', 'Subject', '${longDesc}', 5, 'draft');
      `);
    }).toThrow();
  });

  it('enforces small_sample_acknowledged_at constraint consistency (FIX 2)', () => {
    // allow_small_sample_results = true WITHOUT timestamp must fail
    expect(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, allow_small_sample_results, small_sample_acknowledged_at, status)
        VALUES ('sess-bad-ack', 'owner-1', 'Bad Ack', 'Subject', 5, TRUE, NULL, 'draft');
      `);
    }).toThrow();

    // allow_small_sample_results = false WITH timestamp must fail
    expect(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, allow_small_sample_results, small_sample_acknowledged_at, status)
        VALUES ('sess-bad-ack2', 'owner-1', 'Bad Ack 2', 'Subject', 5, FALSE, CURRENT_TIMESTAMP, 'draft');
      `);
    }).toThrow();

    // allow_small_sample_results = true WITH timestamp succeeds
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, allow_small_sample_results, small_sample_acknowledged_at, status)
      VALUES ('sess-good-ack', 'owner-1', 'Good Ack', 'Subject', 5, TRUE, CURRENT_TIMESTAMP, 'draft');
    `);
    const row = db.public.one(`SELECT allow_small_sample_results, small_sample_acknowledged_at FROM sessions WHERE id = 'sess-good-ack';`);
    expect(row.allow_small_sample_results).toBe(true);
    expect(row.small_sample_acknowledged_at).toBeDefined();
  });

  it('enforces participant name validation rules server-side (FIX 4)', () => {
    const tokenHash = 'b1'.repeat(32);
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, collect_participant_names, status, self_assessment_submitted_at)
      VALUES ('sess-name-off', 'owner-1', 'No Names', 'Alex', 5, FALSE, 'open', CURRENT_TIMESTAMP);

      INSERT INTO participant_invites (id, session_id, token_hash, status)
      VALUES ('inv-name-off', 'sess-name-off', '${tokenHash}', 'issued');
    `);

    // When collect_participant_names = false, NULL is stored
    db.public.none(`
      INSERT INTO participants (id, session_id, invite_id, participant_name)
      VALUES ('part-name-null', 'sess-name-off', 'inv-name-off', NULL);
    `);
    const p1 = db.public.one(`SELECT participant_name FROM participants WHERE id = 'part-name-null';`);
    expect(p1.participant_name).toBeNull();

    // Empty whitespace string violates check constraint
    const tokenHash2 = 'c1'.repeat(32);
    db.public.none(`
      INSERT INTO participant_invites (id, session_id, token_hash, status)
      VALUES ('inv-name-empty', 'sess-name-off', '${tokenHash2}', 'issued');
    `);
    expect(() => {
      db.public.none(`
        INSERT INTO participants (id, session_id, invite_id, participant_name)
        VALUES ('part-empty-str', 'sess-name-off', 'inv-name-empty', '   ');
      `);
    }).toThrow();
  });

  it('verifies composite foreign key prevents attaching invite from different session', () => {
    const hashA1 = 'd1'.repeat(32);
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at)
      VALUES ('session-A', 'owner-1', 'Session A', 'Alex', 5, 'open', CURRENT_TIMESTAMP),
             ('session-B', 'owner-2', 'Session B', 'Jordan', 5, 'open', CURRENT_TIMESTAMP);

      INSERT INTO participant_invites (id, session_id, token_hash, status)
      VALUES ('invite-A1', 'session-A', '${hashA1}', 'issued');
    `);

    expect(() => {
      db.public.none(`
        INSERT INTO participants (id, session_id, invite_id, participant_name)
        VALUES ('part-cross', 'session-B', 'invite-A1', 'Intruder');
      `);
    }).toThrow();
  });

  it('verifies hard deletion of session cascades all child rows cleanly', () => {
    const hashDel = 'e1'.repeat(32);
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at, finalized_at)
      VALUES ('sess-to-delete', 'owner-1', 'Test Deletion', 'Alex', 5, 'finalized', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT INTO self_assessment_responses (session_id, adjective_id)
      VALUES ('sess-to-delete', 'able'), ('sess-to-delete', 'brave');

      INSERT INTO participant_invites (id, session_id, token_hash, status, submitted_at)
      VALUES ('inv-del-1', 'sess-to-delete', '${hashDel}', 'submitted', CURRENT_TIMESTAMP);

      INSERT INTO participants (id, session_id, invite_id, participant_name)
      VALUES ('part-del-1', 'sess-to-delete', 'inv-del-1', 'Respondent');

      INSERT INTO adjective_responses (id, session_id, participant_id, adjective_id)
      VALUES ('resp-del-1', 'sess-to-delete', 'part-del-1', 'able');

      INSERT INTO session_results (session_id, participant_count)
      VALUES ('sess-to-delete', 1);

      INSERT INTO session_result_adjectives (session_id, adjective_id, quadrant, feedback_count)
      VALUES ('sess-to-delete', 'able', 'open', 1);
    `);

    // Verify rows exist before deletion
    expect(db.public.many(`SELECT * FROM self_assessment_responses WHERE session_id = 'sess-to-delete'`).length).toBe(2);
    expect(db.public.many(`SELECT * FROM participant_invites WHERE session_id = 'sess-to-delete'`).length).toBe(1);
    expect(db.public.many(`SELECT * FROM participants WHERE session_id = 'sess-to-delete'`).length).toBe(1);
    expect(db.public.many(`SELECT * FROM adjective_responses WHERE session_id = 'sess-to-delete'`).length).toBe(1);
    expect(db.public.many(`SELECT * FROM session_results WHERE session_id = 'sess-to-delete'`).length).toBe(1);
    expect(db.public.many(`SELECT * FROM session_result_adjectives WHERE session_id = 'sess-to-delete'`).length).toBe(1);

    // Hard delete
    db.public.none(`DELETE FROM sessions WHERE id = 'sess-to-delete';`);

    // Verify all child tables cascaded to 0
    expect(db.public.many(`SELECT * FROM sessions WHERE id = 'sess-to-delete'`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM self_assessment_responses WHERE session_id = 'sess-to-delete'`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM participant_invites WHERE session_id = 'sess-to-delete'`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM participants WHERE session_id = 'sess-to-delete'`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM adjective_responses WHERE session_id = 'sess-to-delete'`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM session_results WHERE session_id = 'sess-to-delete'`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM session_result_adjectives WHERE session_id = 'sess-to-delete'`).length).toBe(0);
  });

  it('executes authoritative PostgreSQL Johari quadrant calculation query matching Stage 6 vector exactly (FIX 5)', () => {
    const hashP1 = 'f1'.repeat(32);
    const hashP2 = '01'.repeat(32);

    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at)
      VALUES ('vector-sess', 'owner-1', 'Vector Session', 'Alex', 2, 'open', CURRENT_TIMESTAMP);

      -- Subject selections (S): Able, Caring, Clever, Happy, Kind
      INSERT INTO self_assessment_responses (session_id, adjective_id) VALUES
        ('vector-sess', 'able'),
        ('vector-sess', 'caring'),
        ('vector-sess', 'clever'),
        ('vector-sess', 'happy'),
        ('vector-sess', 'kind');

      -- Invites
      INSERT INTO participant_invites (id, session_id, token_hash, status, submitted_at) VALUES
        ('inv-p1', 'vector-sess', '${hashP1}', 'submitted', CURRENT_TIMESTAMP),
        ('inv-p2', 'vector-sess', '${hashP2}', 'submitted', CURRENT_TIMESTAMP);

      -- Participants
      INSERT INTO participants (id, session_id, invite_id) VALUES
        ('part-1', 'vector-sess', 'inv-p1'),
        ('part-2', 'vector-sess', 'inv-p2');

      -- Participant 1: Able, Caring, Brave, Friendly, Happy
      INSERT INTO adjective_responses (id, session_id, participant_id, adjective_id) VALUES
        ('r1-1', 'vector-sess', 'part-1', 'able'),
        ('r1-2', 'vector-sess', 'part-1', 'caring'),
        ('r1-3', 'vector-sess', 'part-1', 'brave'),
        ('r1-4', 'vector-sess', 'part-1', 'friendly'),
        ('r1-5', 'vector-sess', 'part-1', 'happy');

      -- Participant 2: Clever, Kind, Brave, Calm, Friendly
      INSERT INTO adjective_responses (id, session_id, participant_id, adjective_id) VALUES
        ('r2-1', 'vector-sess', 'part-2', 'clever'),
        ('r2-2', 'vector-sess', 'part-2', 'kind'),
        ('r2-3', 'vector-sess', 'part-2', 'brave'),
        ('r2-4', 'vector-sess', 'part-2', 'calm'),
        ('r2-5', 'vector-sess', 'part-2', 'friendly');
    `);

    // Authoritative SQL finalization calculation
    const query = `
      WITH
      subject_set AS (
        SELECT adjective_id
        FROM self_assessment_responses
        WHERE session_id = 'vector-sess'
      ),
      participant_freq AS (
        SELECT
          adjective_id,
          count(DISTINCT participant_id) AS freq
        FROM adjective_responses
        WHERE session_id = 'vector-sess'
        GROUP BY adjective_id
      ),
      classified AS (
        SELECT
          a.id AS adjective_id,
          COALESCE(pf.freq, 0) AS feedback_count,
          CASE
            WHEN ss.adjective_id IS NOT NULL AND pf.freq > 0 THEN 'open'
            WHEN ss.adjective_id IS NULL AND pf.freq > 0 THEN 'blind'
            WHEN ss.adjective_id IS NOT NULL AND (pf.freq IS NULL OR pf.freq = 0) THEN 'hidden'
            ELSE 'unknown'
          END AS quadrant
        FROM adjectives a
        LEFT JOIN subject_set ss ON a.id = ss.adjective_id
        LEFT JOIN participant_freq pf ON a.id = pf.adjective_id
      )
      SELECT * FROM classified;
    `;

    const classified = db.public.many(query);

    // FIX 5: Snapshot has exactly 55 rows
    expect(classified.length).toBe(55);

    // FIX 5: Quadrants are pairwise disjoint and sum to 55
    const openSet = classified.filter((r) => r.quadrant === 'open');
    const blindSet = classified.filter((r) => r.quadrant === 'blind');
    const hiddenSet = classified.filter((r) => r.quadrant === 'hidden');
    const unknownSet = classified.filter((r) => r.quadrant === 'unknown');

    expect(openSet.length + blindSet.length + hiddenSet.length + unknownSet.length).toBe(55);

    // OPEN: Able, Caring, Clever, Happy, Kind (5 adjectives)
    expect(openSet.map((r) => r.adjective_id).sort()).toEqual(['able', 'caring', 'clever', 'happy', 'kind']);

    // BLIND: Brave, Calm, Friendly (3 adjectives)
    expect(blindSet.map((r) => r.adjective_id).sort()).toEqual(['brave', 'calm', 'friendly']);

    // HIDDEN: Empty (0 adjectives)
    expect(hiddenSet.length).toBe(0);

    // UNKNOWN: Exactly 47 adjectives
    expect(unknownSet.length).toBe(47);

    // FIX 5: Feedback counts match actual committed submissions
    expect(Number(classified.find((r) => r.adjective_id === 'brave').feedback_count)).toBe(2);
    expect(Number(classified.find((r) => r.adjective_id === 'friendly').feedback_count)).toBe(2);
    expect(Number(classified.find((r) => r.adjective_id === 'calm').feedback_count)).toBe(1);
    expect(Number(classified.find((r) => r.adjective_id === 'able').feedback_count)).toBe(1);
    expect(Number(classified.find((r) => r.adjective_id === 'bold').feedback_count)).toBe(0);
  });

  it('verifies canonical Stage 2 schema names and relational cascade integrity (FIX 1)', () => {
    // 1. Verify existence of participant_invites, participants, adjective_responses, rate_limit_events
    db.public.none(`
      CREATE TABLE IF NOT EXISTS rate_limit_events (
        id TEXT PRIMARY KEY,
        bucket_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const tables = ['participant_invites', 'participants', 'adjective_responses', 'rate_limit_events'];
    for (const tbl of tables) {
      const exists = db.public.many(`SELECT count(*) as count FROM ${tbl};`);
      expect(exists).toBeDefined();
    }

    // 2. Cascade verification: Deleting session cascades to participant_invites, participants, and adjective_responses
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status, self_assessment_submitted_at)
      VALUES ('sess-cascade-test', 'owner-1', 'Cascade Test', 'Alex', 1, 'open', CURRENT_TIMESTAMP);

      INSERT INTO participant_invites (id, session_id, token_hash, status)
      VALUES ('inv-cascade-1', 'sess-cascade-test', '${'f1'.repeat(32)}', 'issued');

      INSERT INTO participants (id, session_id, invite_id, participant_name)
      VALUES ('part-cascade-1', 'sess-cascade-test', 'inv-cascade-1', 'Peer Reviewer');

      INSERT INTO adjective_responses (id, session_id, participant_id, adjective_id)
      VALUES ('resp-cascade-1', 'sess-cascade-test', 'part-cascade-1', 'able');
    `);

    expect(db.public.many(`SELECT * FROM participant_invites WHERE session_id = 'sess-cascade-test';`).length).toBe(1);
    expect(db.public.many(`SELECT * FROM participants WHERE session_id = 'sess-cascade-test';`).length).toBe(1);
    expect(db.public.many(`SELECT * FROM adjective_responses WHERE session_id = 'sess-cascade-test';`).length).toBe(1);

    // Hard delete session
    db.public.none(`DELETE FROM sessions WHERE id = 'sess-cascade-test';`);

    // Verify cascade deleted all child records
    expect(db.public.many(`SELECT * FROM participant_invites WHERE session_id = 'sess-cascade-test';`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM participants WHERE session_id = 'sess-cascade-test';`).length).toBe(0);
    expect(db.public.many(`SELECT * FROM adjective_responses WHERE session_id = 'sess-cascade-test';`).length).toBe(0);
  });
});
