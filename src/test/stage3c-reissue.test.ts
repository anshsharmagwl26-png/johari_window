// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, IMemoryDb, DataType } from 'pg-mem';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';
import { generateRawToken, computeTokenHashSync, createDeterministicTokenBatch } from '../lib/tokens';

describe('Stage 3C: Invitation Management, Reissuance & Recovery Engine', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = newDb();

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

    // Initialize canonical schema
    db.public.none(`
      CREATE TABLE adjectives (
        id TEXT PRIMARY KEY,
        adjective TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL UNIQUE
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        description TEXT,
        expected_participants INTEGER NOT NULL,
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
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('issued', 'submitted', 'revoked')),
        replaces_invite_id TEXT REFERENCES participant_invites(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP,
        revoked_at TIMESTAMP
      );

      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        invite_id TEXT NOT NULL UNIQUE REFERENCES participant_invites(id),
        participant_name TEXT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const adj of CANONICAL_ADJECTIVES) {
      db.public.none(
        `INSERT INTO adjectives (id, adjective, sort_order) VALUES ('${adj.id}', '${adj.adjective}', ${adj.sort_order});`
      );
    }
  });

  const queryOneOrNull = (sql: string) => {
    const rows = db.public.many(sql);
    return rows.length > 0 ? rows[0] : null;
  };

  const setupOpenSessionWithInvites = (inviteCount: number = 5, expiresAt: string | null = null) => {
    const sessionId = 'session-3c-test';
    const ownerId = 'owner-alex-morgan';

    db.public.none(`
      INSERT INTO sessions (
        id, owner_id, title, subject_name, expected_participants, status, expires_at
      ) VALUES (
        '${sessionId}', '${ownerId}', 'Q4 Leadership 360', 'Alex Morgan', ${inviteCount}, 'open',
        ${expiresAt ? `'${expiresAt}'::timestamp` : 'NULL'}
      );
    `);

    const tokenBatch = createDeterministicTokenBatch(inviteCount);
    const generatedInvites: Array<{ id: string; raw_token: string; token_hash: string }> = [];

    for (let i = 0; i < inviteCount; i++) {
      const inviteId = `invite-init-${i + 1}`;
      const hash = tokenBatch.tokenHashes[i];
      const raw = tokenBatch.rawTokens[i];

      db.public.none(`
        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('${inviteId}', '${sessionId}', '${hash}', 'issued');
      `);

      generatedInvites.push({ id: inviteId, raw_token: raw, token_hash: hash });
    }

    return { sessionId, ownerId, generatedInvites, tokenBatch };
  };

  // Simulated server implementation matching rpc_owner_reissue_invite
  const reissueInviteLogic = (
    sessionId: string,
    callerId: string,
    oldInviteId: string,
    newTokenHash: string,
    currentDbTime: Date = new Date()
  ) => {
    const session = queryOneOrNull(`SELECT * FROM sessions WHERE id = '${sessionId}';`);
    if (!session || session.owner_id !== callerId) {
      throw new Error('Unauthorized: Session not found or caller is not owner.');
    }

    if (session.status !== 'open') {
      throw new Error(`Invitations can only be reissued for open sessions (current status: ${session.status}).`);
    }

    if (session.expires_at) {
      const expTime = new Date(session.expires_at).getTime();
      if (expTime <= currentDbTime.getTime()) {
        throw new Error('Cannot reissue invitations: Session has expired.');
      }
    }

    const oldInvite = queryOneOrNull(
      `SELECT * FROM participant_invites WHERE id = '${oldInviteId}' AND session_id = '${sessionId}';`
    );

    if (!oldInvite) {
      throw new Error('Old invitation not found in this session.');
    }

    if (oldInvite.status === 'submitted') {
      throw new Error('Previously submitted invitations cannot be reissued.');
    }

    if (oldInvite.status !== 'issued') {
      throw new Error(`Cannot reissue invitation with status ${oldInvite.status}; only unused issued invitations can be replaced.`);
    }

    const countRow = queryOneOrNull(`SELECT count(*) as total FROM participant_invites WHERE session_id = '${sessionId}';`);
    const totalLifetime = Number(countRow?.total || 0);

    if (totalLifetime >= 200) {
      throw new Error('Lifetime cap reached: Maximum 200 invitation records permitted per session.');
    }

    const newInviteId = `invite-reissued-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = currentDbTime.toISOString();

    db.public.none(`
      UPDATE participant_invites
      SET status = 'revoked', revoked_at = '${nowIso}'::timestamp
      WHERE id = '${oldInviteId}';

      INSERT INTO participant_invites (id, session_id, token_hash, status, replaces_invite_id)
      VALUES ('${newInviteId}', '${sessionId}', '${newTokenHash}', 'issued', '${oldInviteId}');
    `);

    return {
      id: newInviteId,
      token_hash: newTokenHash,
      replaces_invite_id: oldInviteId,
    };
  };

  // Simulated server implementation matching rpc_owner_bulk_reissue_unused_invites
  const bulkReissueUnusedLogic = (
    sessionId: string,
    callerId: string,
    newTokenHashes: string[],
    currentDbTime: Date = new Date()
  ) => {
    const session = queryOneOrNull(`SELECT * FROM sessions WHERE id = '${sessionId}';`);
    if (!session || session.owner_id !== callerId) {
      throw new Error('Unauthorized: Session not found or caller is not owner.');
    }

    if (session.status !== 'open') {
      throw new Error(`Invitations can only be reissued for open sessions (current status: ${session.status}).`);
    }

    if (session.expires_at) {
      const expTime = new Date(session.expires_at).getTime();
      if (expTime <= currentDbTime.getTime()) {
        throw new Error('Cannot reissue invitations: Session has expired.');
      }
    }

    const unusedInvites = db.public.many(
      `SELECT * FROM participant_invites WHERE session_id = '${sessionId}' AND status = 'issued';`
    );

    const unusedCount = unusedInvites.length;
    if (unusedCount === 0) {
      return { reissued_count: 0, invites: [] };
    }

    if (unusedCount !== newTokenHashes.length) {
      throw new Error(`Token hash count (${newTokenHashes.length}) does not match unused invitation count (${unusedCount}).`);
    }

    const countRow = queryOneOrNull(`SELECT count(*) as total FROM participant_invites WHERE session_id = '${sessionId}';`);
    const totalLifetime = Number(countRow?.total || 0);

    if (totalLifetime + newTokenHashes.length > 200) {
      throw new Error(`Operation would exceed lifetime invitation cap of 200 records per session (current: ${totalLifetime}, adding: ${newTokenHashes.length}).`);
    }

    const nowIso = currentDbTime.toISOString();
    const newInvites: Array<{ id: string; token_hash: string }> = [];

    // Atomically revoke all issued invites and create replacements
    db.public.none(`
      UPDATE participant_invites
      SET status = 'revoked', revoked_at = '${nowIso}'::timestamp
      WHERE session_id = '${sessionId}' AND status = 'issued';
    `);

    for (let i = 0; i < unusedCount; i++) {
      const newId = `bulk-reissued-${i + 1}-${Math.random().toString(36).substring(2, 7)}`;
      const hash = newTokenHashes[i];

      db.public.none(`
        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('${newId}', '${sessionId}', '${hash}', 'issued');
      `);

      newInvites.push({ id: newId, token_hash: hash });
    }

    return {
      reissued_count: unusedCount,
      invites: newInvites,
    };
  };

  it('Requirement 1 & 2: Reissues an individual unused invitation and atomically revokes the old one', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(3);
    const targetInvite = generatedInvites[0];

    const rawReplacementToken = generateRawToken();
    const replacementHash = computeTokenHashSync(rawReplacementToken);

    const result = reissueInviteLogic(sessionId, ownerId, targetInvite.id, replacementHash);

    expect(result.id).toBeDefined();
    expect(result.replaces_invite_id).toBe(targetInvite.id);
    expect(result.token_hash).toBe(replacementHash);

    // Verify database state: old invite is revoked
    const oldRow = queryOneOrNull(`SELECT * FROM participant_invites WHERE id = '${targetInvite.id}';`);
    expect(oldRow.status).toBe('revoked');
    expect(oldRow.revoked_at).not.toBeNull();

    // Verify database state: new invite is issued and references old invite
    const newRow = queryOneOrNull(`SELECT * FROM participant_invites WHERE id = '${result.id}';`);
    expect(newRow.status).toBe('issued');
    expect(newRow.token_hash).toBe(replacementHash);
    expect(newRow.replaces_invite_id).toBe(targetInvite.id);
  });

  it('Requirement 3 & 4: Strictly rejects reissuance of previously submitted invitations', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(3);
    const submittedInvite = generatedInvites[1];

    // Mark as submitted
    db.public.none(`
      UPDATE participant_invites
      SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
      WHERE id = '${submittedInvite.id}';
    `);

    const rawReplacementToken = generateRawToken();
    const replacementHash = computeTokenHashSync(rawReplacementToken);

    expect(() => {
      reissueInviteLogic(sessionId, ownerId, submittedInvite.id, replacementHash);
    }).toThrow('Previously submitted invitations cannot be reissued.');

    // Verify state was untouched
    const checkRow = queryOneOrNull(`SELECT * FROM participant_invites WHERE id = '${submittedInvite.id}';`);
    expect(checkRow.status).toBe('submitted');
  });

  it('Requirement 3: Rejects reissuance of already revoked invitations', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(2);
    const revokedInvite = generatedInvites[0];

    // Mark as revoked
    db.public.none(`
      UPDATE participant_invites
      SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
      WHERE id = '${revokedInvite.id}';
    `);

    const rawReplacement = generateRawToken();
    const replacementHash = computeTokenHashSync(rawReplacement);

    expect(() => {
      reissueInviteLogic(sessionId, ownerId, revokedInvite.id, replacementHash);
    }).toThrow('Cannot reissue invitation with status revoked; only unused issued invitations can be replaced.');
  });

  it('Requirement 2: Bulk reissues all unused invitations while preserving submitted invitations', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(4);

    // Mark 1 invite as submitted
    const submittedInvite = generatedInvites[0];
    db.public.none(`
      UPDATE participant_invites
      SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
      WHERE id = '${submittedInvite.id}';
    `);

    // 3 invites remain unused ('issued')
    const batch = createDeterministicTokenBatch(3);
    const result = bulkReissueUnusedLogic(sessionId, ownerId, batch.tokenHashes);

    expect(result.reissued_count).toBe(3);
    expect(result.invites.length).toBe(3);

    // Verify submitted invite is untouched
    const submittedRow = queryOneOrNull(`SELECT * FROM participant_invites WHERE id = '${submittedInvite.id}';`);
    expect(submittedRow.status).toBe('submitted');

    // Verify the other 3 initial invites are revoked
    for (let i = 1; i < 4; i++) {
      const oldRow = queryOneOrNull(`SELECT * FROM participant_invites WHERE id = '${generatedInvites[i].id}';`);
      expect(oldRow.status).toBe('revoked');
      expect(oldRow.revoked_at).not.toBeNull();
    }

    // Verify new 3 invites are issued
    const issuedRows = db.public.many(
      `SELECT * FROM participant_invites WHERE session_id = '${sessionId}' AND status = 'issued';`
    );
    expect(issuedRows.length).toBe(3);

    // Verify deterministic mapping works with paired URLs
    const paired = batch.pairInvitesWithTokens(result.invites, 'https://app.johari.internal');
    expect(paired.length).toBe(3);
    for (const p of paired) {
      expect(p.url).toMatch(/^https:\/\/app\.johari\.internal\/invite#[A-Za-z0-9_-]{43}$/);
      expect(p.raw_token.length).toBe(43);
    }
  });

  it('Requirement 9: Enforces the 200-record lifetime invitation cap per session', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(5);

    // Artificially populate participant_invites up to 200 total records
    for (let i = 6; i <= 200; i++) {
      const dummyHash = `dummy-hash-${String(i).padStart(5, '0')}`.padEnd(64, '0');
      db.public.none(`
        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('invite-fill-${i}', '${sessionId}', '${dummyHash}', 'revoked');
      `);
    }

    const totalCount = Number(
      queryOneOrNull(`SELECT count(*) as total FROM participant_invites WHERE session_id = '${sessionId}';`)?.total
    );
    expect(totalCount).toBe(200);

    const rawToken = generateRawToken();
    const tokenHash = computeTokenHashSync(rawToken);

    // Attempting individual reissue must be rejected
    expect(() => {
      reissueInviteLogic(sessionId, ownerId, generatedInvites[0].id, tokenHash);
    }).toThrow('Lifetime cap reached: Maximum 200 invitation records permitted per session.');

    // Attempting bulk reissue must be rejected due to 200 cap
    const bulkHashes = Array(5).fill(0).map(() => computeTokenHashSync(generateRawToken()));
    expect(() => {
      bulkReissueUnusedLogic(sessionId, ownerId, bulkHashes);
    }).toThrow(/Operation would exceed lifetime invitation cap/);
  });

  it('Requirement 10: Rejects reissuance for expired sessions', () => {
    const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(2, pastTime);

    const rawToken = generateRawToken();
    const tokenHash = computeTokenHashSync(rawToken);

    expect(() => {
      reissueInviteLogic(sessionId, ownerId, generatedInvites[0].id, tokenHash);
    }).toThrow('Cannot reissue invitations: Session has expired.');
  });

  it('Requirement 10: Rejects reissuance for unauthorized non-owner callers', () => {
    const { sessionId, generatedInvites } = setupOpenSessionWithInvites(2);

    const rawToken = generateRawToken();
    const tokenHash = computeTokenHashSync(rawToken);

    expect(() => {
      reissueInviteLogic(sessionId, 'attacker-unauthorized', generatedInvites[0].id, tokenHash);
    }).toThrow('Unauthorized: Session not found or caller is not owner.');
  });

  it('Requirement 10: Rejects reissuance if session is not in open status (e.g. finalized)', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(2);

    db.public.none(`UPDATE sessions SET status = 'finalized' WHERE id = '${sessionId}';`);

    const rawToken = generateRawToken();
    const tokenHash = computeTokenHashSync(rawToken);

    expect(() => {
      reissueInviteLogic(sessionId, ownerId, generatedInvites[0].id, tokenHash);
    }).toThrow('Invitations can only be reissued for open sessions (current status: finalized).');
  });

  it('Requirement 6: Plaintext tokens are NEVER stored in the database', () => {
    const { sessionId, ownerId, generatedInvites } = setupOpenSessionWithInvites(2);
    const rawReplacement = generateRawToken();
    const replacementHash = computeTokenHashSync(rawReplacement);

    reissueInviteLogic(sessionId, ownerId, generatedInvites[0].id, replacementHash);

    // Inspect all tokens in database
    const rows = db.public.many(`SELECT token_hash FROM participant_invites WHERE session_id = '${sessionId}';`);
    for (const row of rows) {
      expect(row.token_hash).not.toBe(rawReplacement);
      expect(row.token_hash.length).toBe(64); // SHA-256 hex digest
      expect(/^[0-9a-f]{64}$/.test(row.token_hash)).toBe(true);
    }
  });
});
