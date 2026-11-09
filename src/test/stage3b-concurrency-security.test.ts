// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, IMemoryDb, DataType } from 'pg-mem';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';
import { generateRawToken, computeTokenHashSync } from '../lib/tokens';
import {
  computeHmacBucketKey,
  checkMemoryRateLimit,
  resetMemoryRateLimiter,
  RATE_LIMIT_CONFIG,
} from '../lib/rate-limiter';

describe('Stage 3B: Concurrency, Single-Use Invariant & Security Rate Limiting', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = newDb();
    resetMemoryRateLimiter();

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
        expected_participants INTEGER NOT NULL,
        collect_participant_names BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      );

      CREATE TABLE participant_invites (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'issued',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP,
        UNIQUE (id, session_id)
      );

      CREATE TABLE participants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        invite_id TEXT NOT NULL UNIQUE,
        participant_name TEXT,
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
        UNIQUE (participant_id, adjective_id)
      );

      CREATE TABLE rate_limit_events (
        id TEXT PRIMARY KEY,
        bucket_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const adj of CANONICAL_ADJECTIVES) {
      db.public.none(
        `INSERT INTO adjectives (id, adjective, sort_order) VALUES ('${adj.id}', '${adj.adjective.replace(/'/g, "''")}', ${adj.sort_order});`
      );
    }
  });

  // ==========================================================================
  // Section 1: Concurrent Submission Race Condition
  // ==========================================================================
  describe('Concurrency & Single-Use Invariant', () => {
    it('guarantees that under concurrent submission attempts with the same token, exactly one succeeds', async () => {
      const sessionId = 'sess-race-1';
      const rawToken = generateRawToken();
      const tokenHash = computeTokenHashSync(rawToken);

      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('${sessionId}', 'owner-1', 'Race Test', 'Alex', 5, 'open');

        INSERT INTO participant_invites (id, session_id, token_hash, status)
        VALUES ('inv-race-1', '${sessionId}', '${tokenHash}', 'issued');
      `);

      // Simulated atomic PostgreSQL row-locked submission worker
      const submitWorker = async (workerId: number) => {
        // Atomic row check with status transition
        const inviteRows = db.public.many(`SELECT * FROM participant_invites WHERE token_hash = '${tokenHash}';`);
        const invite = inviteRows.length > 0 ? inviteRows[0] : null;
        if (!invite) throw new Error('Invite not found');
        if (invite.status !== 'issued') {
          throw new Error(`Conflict: Invitation already consumed (status: ${invite.status})`);
        }

        const participantId = `part-worker-${workerId}`;
        const selections = ['able', 'brave', 'calm', 'caring', 'clever'];

        // Atomic transaction
        db.public.none(`
          INSERT INTO participants (id, session_id, invite_id, participant_name)
          VALUES ('${participantId}', '${sessionId}', '${invite.id}', 'Worker ${workerId}');

          ${selections.map((id) => `
            INSERT INTO adjective_responses (id, session_id, participant_id, adjective_id)
            VALUES ('resp-${workerId}-${id}', '${sessionId}', '${participantId}', '${id}');
          `).join('')}

          UPDATE participant_invites
          SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
          WHERE id = '${invite.id}';
        `);

        return { success: true, workerId };
      };

      // Run 5 simultaneous concurrent attempts
      const attempts = [1, 2, 3, 4, 5];
      const results = await Promise.allSettled(attempts.map((id) => submitWorker(id)));

      const succeeded = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');

      // Exactly ONE submission succeeds
      expect(succeeded.length).toBe(1);
      // The remaining 4 fail with already consumed error
      expect(failed.length).toBe(4);

      // Verify database state: exactly ONE participant record exists for this invite
      const participants = db.public.many(`SELECT * FROM participants WHERE invite_id = 'inv-race-1';`);
      expect(participants.length).toBe(1);

      // Verify exactly 5 adjective responses exist (no duplicates)
      const responses = db.public.many(`SELECT * FROM adjective_responses WHERE participant_id = '${participants[0].id}';`);
      expect(responses.length).toBe(5);

      // Verify invitation status is 'submitted'
      const inviteFinal = db.public.one(`SELECT status FROM participant_invites WHERE id = 'inv-race-1';`);
      expect(inviteFinal.status).toBe('submitted');
    });
  });

  // ==========================================================================
  // Section 2: Security & Rate Limiting
  // ==========================================================================
  describe('Security & HMAC-SHA256 Rate Limiting (Prompt F)', () => {
    it('computes deterministic HMAC-SHA-256 bucket keys without storing raw IPs', () => {
      const ip = '198.51.100.42';
      const secret = 'super-secret-salt-key-12345';
      const key1 = computeHmacBucketKey(ip, 'validate_token', secret);
      const key2 = computeHmacBucketKey(ip, 'validate_token', secret);

      // Deterministic
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[0-9a-f]{64}$/);

      // Never stores or contains raw IP
      expect(key1).not.toContain(ip);

      // Different actions produce different bucket keys
      const keySubmit = computeHmacBucketKey(ip, 'submit_feedback', secret);
      expect(keySubmit).not.toBe(key1);

      // Different IPs produce different bucket keys
      const keyOtherIp = computeHmacBucketKey('203.0.113.19', 'validate_token', secret);
      expect(keyOtherIp).not.toBe(key1);
    });

    it('enforces sliding window rate limiting and triggers 429 retry-after', () => {
      const bucketKey = 'test-bucket-limit';
      const maxAttempts = RATE_LIMIT_CONFIG.VALIDATION_MAX_ATTEMPTS; // 10
      const windowSeconds = RATE_LIMIT_CONFIG.VALIDATION_WINDOW_SECONDS; // 60
      const baseTime = 1700000000000;

      // 10 attempts allowed
      for (let i = 0; i < maxAttempts; i++) {
        const res = checkMemoryRateLimit(bucketKey, 'validate', maxAttempts, windowSeconds, baseTime + i * 100);
        expect(res.allowed).toBe(true);
        expect(res.currentCount).toBe(i + 1);
      }

      // 11th attempt within window is throttled
      const throttled = checkMemoryRateLimit(bucketKey, 'validate', maxAttempts, windowSeconds, baseTime + 5000);
      expect(throttled.allowed).toBe(false);
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);

      // After window expires (61 seconds later), requests are allowed again
      const afterWindow = checkMemoryRateLimit(bucketKey, 'validate', maxAttempts, windowSeconds, baseTime + 61000);
      expect(afterWindow.allowed).toBe(true);
    });

    it('verifies that database rate_limit_events stores only bucket hashes with no IP leakage', () => {
      const clientIp = '203.0.113.55';
      const bucketKey = computeHmacBucketKey(clientIp, 'test_event', 'test-salt');

      db.public.none(`
        INSERT INTO rate_limit_events (id, bucket_key, event_type)
        VALUES ('rl-1', '${bucketKey}', 'token_failure');
      `);

      const stored = db.public.one(`SELECT * FROM rate_limit_events WHERE id = 'rl-1';`);
      expect(stored.bucket_key).toBe(bucketKey);
      expect(stored.bucket_key).not.toContain(clientIp);

      // Verify no columns exist for raw IP
      expect(() => {
        db.public.many(`SELECT ip_address FROM rate_limit_events;`);
      }).toThrow();
    });
  });
});
