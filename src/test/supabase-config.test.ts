// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServerSupabaseClient, resolveServerSecretKey } from '../lib/supabase-server';

describe('Supabase Environment & Secret Key Resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SUPABASE_SECRET_KEYS;
    delete process.env.JOHARI_SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('supports modern opaque sb_secret_ keys without expecting legacy JWT format', () => {
    const mockUrl = 'https://example-project.supabase.co';
    const opaqueSecretKey = 'sb_secret_prod_abc1234567890defghijklmnopqrstuvwxyz';

    const client = createServerSupabaseClient(opaqueSecretKey, mockUrl);
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
    expect(typeof client.rpc).toBe('function');
  });

  it('resolves secret from hosted Supabase Edge Function SUPABASE_SECRET_KEYS JSON', () => {
    process.env.SUPABASE_SECRET_KEYS = JSON.stringify({
      default: 'sb_secret_hosted_default_key_777',
      secondary: 'sb_secret_secondary_key_888',
    });

    const key = resolveServerSecretKey();
    expect(key).toBe('sb_secret_hosted_default_key_777');
  });

  it('resolves secret from local Edge Function variable JOHARI_SUPABASE_SECRET_KEY', () => {
    process.env.JOHARI_SUPABASE_SECRET_KEY = 'sb_secret_local_dev_123';

    const key = resolveServerSecretKey();
    expect(key).toBe('sb_secret_local_dev_123');
  });

  it('resolves secret from SUPABASE_SECRET_KEY', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_server_env_456';

    const key = resolveServerSecretKey();
    expect(key).toBe('sb_secret_server_env_456');
  });

  it('falls back to legacy SUPABASE_SERVICE_ROLE_KEY if modern variables are absent', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy';

    const key = resolveServerSecretKey();
    expect(key).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.legacy');
  });

  it('throws descriptive error if server secret key is missing', () => {
    expect(() => createServerSupabaseClient('', 'https://example-project.supabase.co')).toThrow(
      /Missing server Supabase credentials/i
    );
  });
});
