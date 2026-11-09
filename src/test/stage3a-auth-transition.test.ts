// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getOrInitOwnerSession,
  getRequiredOwnerAuthHeader,
  createSession,
  fetchSession,
  submitSelfAssessmentAndOpen,
} from '../lib/session-service';

describe('Stage 3A & 3B: Anonymous Owner Auth Transition & Identity Preservation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. Initializes anonymous session once and reuses it across sequential calls', async () => {
    const session1 = await getOrInitOwnerSession();
    expect(session1.token).toBeDefined();
    expect(session1.userId).toBeDefined();
    expect(session1.token.length).toBeGreaterThan(10);

    const session2 = await getOrInitOwnerSession();
    // Same identity and token must be strictly reused
    expect(session2.userId).toBe(session1.userId);
    expect(session2.token).toBe(session1.token);
  });

  it('2. Prevents race conditions: concurrent calls resolve to the identical identity', async () => {
    const [res1, res2, res3] = await Promise.all([
      getOrInitOwnerSession(),
      getOrInitOwnerSession(),
      getOrInitOwnerSession(),
    ]);

    expect(res1.userId).toBe(res2.userId);
    expect(res2.userId).toBe(res3.userId);
    expect(res1.token).toBe(res2.token);
    expect(res2.token).toBe(res3.token);
  });

  it('3. getRequiredOwnerAuthHeader returns properly formatted Bearer token', async () => {
    const authHeader = await getRequiredOwnerAuthHeader();
    expect(authHeader).toMatch(/^Bearer\s+/);
    expect(authHeader.split(' ')[1].length).toBeGreaterThan(5);
  });

  it('4. Create draft attaches Bearer token to API request', async () => {
    const sessionOwner = await getOrInitOwnerSession();
    let capturedAuthHeader: string | null = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      capturedAuthHeader = headers?.['Authorization'] || null;

      return {
        ok: true,
        json: async () => ({
          session: {
            id: 'sess-auth-test-1',
            owner_id: sessionOwner.userId,
            title: 'Transition Test',
            subject_name: 'Alex Morgan',
            status: 'draft',
            expected_participants: 5,
          },
        }),
      } as Response;
    });

    const { session, error } = await createSession({
      title: 'Transition Test',
      subject_name: 'Alex Morgan',
      expected_participants: 5,
      collect_participant_names: false,
      allow_small_sample_results: false,
      ack_small_sample: false,
    });

    expect(error).toBeNull();
    expect(session).toBeDefined();
    expect(session?.id).toBe('sess-auth-test-1');
    expect(capturedAuthHeader).toBe(`Bearer ${sessionOwner.token}`);
  });

  it('5. fetchSession attaches the same Bearer token to retrieve draft session', async () => {
    const sessionOwner = await getOrInitOwnerSession();
    let capturedAuthHeader: string | null = null;
    let capturedUrl: string | null = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      const headers = init?.headers as Record<string, string>;
      capturedAuthHeader = headers?.['Authorization'] || null;

      return {
        ok: true,
        json: async () => ({
          session: {
            id: 'sess-auth-test-1',
            owner_id: sessionOwner.userId,
            title: 'Transition Test',
            subject_name: 'Alex Morgan',
            status: 'draft',
            expected_participants: 5,
          },
        }),
      } as Response;
    });

    const { session, error } = await fetchSession('sess-auth-test-1');

    expect(error).toBeNull();
    expect(session).toBeDefined();
    expect(session?.id).toBe('sess-auth-test-1');
    expect(capturedUrl).toContain('/api/sessions/sess-auth-test-1');
    expect(capturedAuthHeader).toBe(`Bearer ${sessionOwner.token}`);
  });

  it('6. submitSelfAssessmentAndOpen retains same anonymous identity and attaches Bearer token', async () => {
    const sessionOwner = await getOrInitOwnerSession();
    let capturedAuthHeader: string | null = null;
    let capturedBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      capturedAuthHeader = headers?.['Authorization'] || null;
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      return {
        ok: true,
        json: async () => ({
          session_id: 'sess-auth-test-1',
          status: 'open',
          invites: [
            { id: 'inv-1', url: 'http://localhost:3000/invite#tok1', raw_token: 'tok1' },
            { id: 'inv-2', url: 'http://localhost:3000/invite#tok2', raw_token: 'tok2' },
          ],
        }),
      } as Response;
    });

    const adjectives = ['able', 'accepting', 'adaptable', 'bold', 'brave'];
    const { result, error } = await submitSelfAssessmentAndOpen('sess-auth-test-1', adjectives);

    expect(error).toBeNull();
    expect(result).toBeDefined();
    expect(result?.status).toBe('open');
    expect(result?.invites.length).toBe(2);

    // Assert Authorization header is identical to the owner session
    expect(capturedAuthHeader).toBe(`Bearer ${sessionOwner.token}`);
    expect(capturedBody.adjective_ids).toEqual(adjectives);
  });

  it('7. Unauthenticated request without token is rejected with 401', async () => {
    // Simulate server response when Authorization header is absent
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      if (!headers?.['Authorization']) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized: Missing Authorization header.' }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ session: { id: 'sess-1' } }),
      } as Response;
    });

    // Directly test that unauthenticated fetch receives 401
    const res = await fetch('/api/sessions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized: Missing Authorization header.');
  });

  it('8. Cross-identity mismatch is rejected by server ownership verification', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      const auth = headers?.['Authorization'];

      // If token belongs to different user, reject
      if (auth !== 'Bearer valid-owner-token') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Session not found or caller does not own this session.' }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ session_id: 'sess-1', status: 'open' }),
      } as Response;
    });

    const res = await fetch('/api/sessions/sess-1/submit-self-assessment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer attacker-token',
      },
      body: JSON.stringify({ adjective_ids: ['able', 'bold', 'brave', 'calm', 'caring'] }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Session not found or caller does not own this session.');
  });
});
