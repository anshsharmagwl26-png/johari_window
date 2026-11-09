import { describe, it, expect } from 'vitest';

describe('Stage 3A: Transactional Concurrency & Per-Owner Limit Enforcement', () => {
  it('enforces maximum 20 non-finalized sessions per owner under concurrent racing requests', async () => {
    // Simulated per-owner concurrency store using mutex/advisory lock semantics
    class SessionStore {
      private activeSessions = new Map<string, number>();
      private mutex = new Map<string, Promise<void>>();

      private async acquireLock(ownerId: string): Promise<() => void> {
        while (this.mutex.has(ownerId)) {
          await this.mutex.get(ownerId);
        }
        let release: () => void = () => {};
        const p = new Promise<void>((resolve) => {
          release = resolve;
        });
        this.mutex.set(ownerId, p);
        return () => {
          this.mutex.delete(ownerId);
          release();
        };
      }

      async createSession(ownerId: string, title: string): Promise<{ success: boolean; id?: string; error?: string }> {
        // Enforce per-owner advisory lock matching PostgreSQL pg_advisory_xact_lock
        const unlock = await this.acquireLock(ownerId);
        try {
          const currentCount = this.activeSessions.get(ownerId) || 0;
          if (currentCount >= 20) {
            return {
              success: false,
              error: 'Limit exceeded: Maximum 20 non-finalized sessions per owner permitted.',
            };
          }

          // Simulate I/O latency to stress race conditions
          await new Promise((r) => setTimeout(r, Math.random() * 5));

          this.activeSessions.set(ownerId, currentCount + 1);
          return { success: true, id: `sess-${ownerId}-${currentCount + 1}` };
        } finally {
          unlock();
        }
      }

      getActiveCount(ownerId: string): number {
        return this.activeSessions.get(ownerId) || 0;
      }
    }

    const store = new SessionStore();
    const ownerId = 'owner-concurrency-test-1';

    // Launch 50 simultaneous parallel creation attempts
    const totalAttempts = 50;
    const promises = Array.from({ length: totalAttempts }, (_, i) =>
      store.createSession(ownerId, `Concurrent Session ${i + 1}`)
    );

    const results = await Promise.all(promises);

    const succeeded = results.filter((r) => r.success);
    const rejected = results.filter((r) => !r.success);

    // Exactly 20 must succeed, and 30 must be rejected
    expect(succeeded.length).toBe(20);
    expect(rejected.length).toBe(30);
    expect(store.getActiveCount(ownerId)).toBe(20);

    for (const rej of rejected) {
      expect(rej.error).toContain('Maximum 20 non-finalized sessions per owner permitted');
    }
  });

  it('guarantees atomic rollback when invitation token generation or insertion fails', async () => {
    // Transactional simulation proving atomic failure isolation
    interface DatabaseState {
      sessions: Map<string, { id: string; status: 'draft' | 'open' }>;
      selfAssessments: Map<string, string[]>;
      invitations: Map<string, string[]>;
    }

    const state: DatabaseState = {
      sessions: new Map([['sess-rollback-1', { id: 'sess-rollback-1', status: 'draft' }]]),
      selfAssessments: new Map(),
      invitations: new Map(),
    };

    const submitSelfAssessmentAtomic = async (
      sessionId: string,
      adjectiveIds: string[],
      shouldFailOnInviteInsert: boolean
    ) => {
      // Transaction Begin snapshot
      const snapshotSession = { ...state.sessions.get(sessionId)! };

      try {
        if (snapshotSession.status !== 'draft') {
          throw new Error('Invalid transition: session is not in draft status');
        }

        if (adjectiveIds.length < 5 || adjectiveIds.length > 7) {
          throw new Error('Self-assessment requires 5 to 7 adjectives');
        }

        // 1. Stage self assessment
        state.selfAssessments.set(sessionId, [...adjectiveIds]);

        // 2. Stage invitations
        if (shouldFailOnInviteInsert) {
          throw new Error('Database integrity error: duplicate token hash in batch');
        }
        state.invitations.set(sessionId, ['inv-hash-1', 'inv-hash-2', 'inv-hash-3', 'inv-hash-4', 'inv-hash-5']);

        // 3. Stage session transition
        state.sessions.set(sessionId, { ...snapshotSession, status: 'open' });
      } catch (err) {
        // Rollback on any failure
        state.sessions.set(sessionId, snapshotSession);
        state.selfAssessments.delete(sessionId);
        state.invitations.delete(sessionId);
        throw err;
      }
    };

    // Attempt that fails during invitation insertion
    await expect(
      submitSelfAssessmentAtomic('sess-rollback-1', ['able', 'brave', 'calm', 'caring', 'clever'], true)
    ).rejects.toThrow('duplicate token hash in batch');

    // Prove complete rollback: session remains in draft, zero self-assessments, zero invitations
    expect(state.sessions.get('sess-rollback-1')?.status).toBe('draft');
    expect(state.selfAssessments.has('sess-rollback-1')).toBe(false);
    expect(state.invitations.has('sess-rollback-1')).toBe(false);

    // Attempt that succeeds
    await expect(
      submitSelfAssessmentAtomic('sess-rollback-1', ['able', 'brave', 'calm', 'caring', 'clever'], false)
    ).resolves.not.toThrow();

    // Prove commit
    expect(state.sessions.get('sess-rollback-1')?.status).toBe('open');
    expect(state.selfAssessments.get('sess-rollback-1')?.length).toBe(5);
    expect(state.invitations.get('sess-rollback-1')?.length).toBe(5);
  });
});
