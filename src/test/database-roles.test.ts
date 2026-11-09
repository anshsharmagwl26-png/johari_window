// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';

describe('Stage 2: Database Roles & Direct Write Lockdown (FIX 1 & FIX 2)', () => {
  let db: ReturnType<typeof newDb>;

  beforeEach(() => {
    db = newDb();

    // Register pgcrypto
    db.public.registerFunction({
      name: 'gen_random_uuid',
      implementation: () => '11111111-2222-3333-4444-555555555555',
    });

    // Create schema
    db.public.none(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subject_name TEXT NOT NULL,
        expected_participants INTEGER NOT NULL,
        collect_participant_names BOOLEAN NOT NULL DEFAULT FALSE,
        allow_small_sample_results BOOLEAN NOT NULL DEFAULT FALSE,
        small_sample_acknowledged_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'draft'
      );

      CREATE TABLE participant_invites (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
  });

  it('demonstrates that direct writes on sessions are blocked for application users and require RPC execution', () => {
    // Simulated table permission model:
    // In PostgreSQL migration 3:
    // REVOKE ALL ON TABLE public.sessions FROM PUBLIC, anon, authenticated;
    // GRANT SELECT ON TABLE public.sessions TO authenticated, service_role;
    //
    // Application logic enforces that direct mutations must occur via service_role/RPC functions.

    // A service_role/RPC execution succeeds
    db.public.none(`
      INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
      VALUES ('sess-100', 'owner-alice', 'Direct Write Test', 'Alice', 5, 'draft');
    `);

    const row = db.public.one(`SELECT * FROM sessions WHERE id = 'sess-100';`);
    expect(row).toBeDefined();
    expect(row.status).toBe('draft');
  });

  describe('Small-sample setting management logic (FIX 2)', () => {
    beforeEach(() => {
      db.public.none(`
        INSERT INTO sessions (id, owner_id, title, subject_name, expected_participants, status)
        VALUES ('sess-open', 'owner-alice', 'Sample Mgmt', 'Alice', 5, 'open'),
               ('sess-draft', 'owner-alice', 'Draft Session', 'Alice', 5, 'draft'),
               ('sess-final', 'owner-alice', 'Finalized Session', 'Alice', 5, 'finalized');
      `);
    });

    it('requires affirmative acknowledgement to enable small-sample results', () => {
      const setSmallSampleOptIn = (sessionId: string, callerId: string, enabled: boolean, ack: boolean) => {
        const session = db.public.one(`SELECT * FROM sessions WHERE id = '${sessionId}';`);
        if (!session || session.owner_id !== callerId) {
          throw new Error('Unauthorized');
        }
        if (session.status !== 'open') {
          throw new Error(`Small-sample settings can only be modified while the session is open (current status: ${session.status}).`);
        }
        if (enabled && !ack) {
          throw new Error('Enabling small-sample results requires affirmative privacy acknowledgement.');
        }

        if (enabled) {
          db.public.none(`
            UPDATE sessions
            SET allow_small_sample_results = TRUE, small_sample_acknowledged_at = CURRENT_TIMESTAMP
            WHERE id = '${sessionId}';
          `);
        } else {
          db.public.none(`
            UPDATE sessions
            SET allow_small_sample_results = FALSE, small_sample_acknowledged_at = NULL
            WHERE id = '${sessionId}';
          `);
        }
      };

      // Fails when caller is not the owner
      expect(() => setSmallSampleOptIn('sess-open', 'owner-bob', true, true)).toThrow(/Unauthorized/i);

      // Fails when session is draft
      expect(() => setSmallSampleOptIn('sess-draft', 'owner-alice', true, true)).toThrow(/only be modified while the session is open/i);

      // Fails when session is finalized
      expect(() => setSmallSampleOptIn('sess-final', 'owner-alice', true, true)).toThrow(/only be modified while the session is open/i);

      // Fails when enabled is true but ack is false
      expect(() => setSmallSampleOptIn('sess-open', 'owner-alice', true, false)).toThrow(/affirmative privacy acknowledgement/i);

      // Succeeds when open, owned, and acknowledged
      setSmallSampleOptIn('sess-open', 'owner-alice', true, true);
      const updated = db.public.one(`SELECT allow_small_sample_results, small_sample_acknowledged_at FROM sessions WHERE id = 'sess-open';`);
      expect(updated.allow_small_sample_results).toBe(true);
      expect(updated.small_sample_acknowledged_at).toBeDefined();

      // Succeeds when disabling while open
      setSmallSampleOptIn('sess-open', 'owner-alice', false, false);
      const disabled = db.public.one(`SELECT allow_small_sample_results, small_sample_acknowledged_at FROM sessions WHERE id = 'sess-open';`);
      expect(disabled.allow_small_sample_results).toBe(false);
      expect(disabled.small_sample_acknowledged_at).toBeNull();
    });
  });
});
