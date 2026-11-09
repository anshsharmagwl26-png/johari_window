/**
 * Server-side Supabase privileged client helper.
 *
 * IMPORTANT SECURITY RULES:
 * - This module must ONLY be executed in server environments (Node.js / Express / Supabase Edge Functions).
 * - Never import this file into client-side components or browser bundles.
 * - In hosted Supabase Edge Functions, the platform provides `SUPABASE_SECRET_KEYS` as a JSON string.
 *   This helper parses that JSON and selects `default` (or the primary configured secret key).
 * - For local Edge Function development, configure `JOHARI_SUPABASE_SECRET_KEY` or `SUPABASE_SECRET_KEY`.
 * - Supports modern Supabase opaque secret keys (sb_secret_...) as well as legacy service_role keys.
 *   Do NOT attempt to parse or decode sb_secret_ keys as JWTs; they are opaque API keys.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function resolveServerSecretKey(overrideKey?: string): string | undefined {
  if (overrideKey) return overrideKey;

  // Support Node.js process.env and Edge Function Deno.env
  const getEnv = (name: string): string | undefined => {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[name];
    }
    const globalDeno = (globalThis as unknown as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno;
    if (typeof globalDeno !== 'undefined') {
      return globalDeno.env.get(name);
    }
    return undefined;
  };

  // 1. Hosted Supabase Edge Functions provide SUPABASE_SECRET_KEYS as a JSON object string
  const secretKeysJson = getEnv('SUPABASE_SECRET_KEYS');
  if (secretKeysJson) {
    try {
      const parsed = JSON.parse(secretKeysJson) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const firstVal = Object.values(parsed)[0];
      if (firstVal) return firstVal;
    } catch {
      // In case SUPABASE_SECRET_KEYS was set as a raw key string rather than JSON
      return secretKeysJson;
    }
  }

  // 2. Local-only secret variable for Edge Function development
  const localSecret = getEnv('JOHARI_SUPABASE_SECRET_KEY');
  if (localSecret) return localSecret;

  // 3. Standard server environment variable
  const serverSecret = getEnv('SUPABASE_SECRET_KEY');
  if (serverSecret) return serverSecret;

  // 4. Legacy fallback
  return getEnv('SUPABASE_SERVICE_ROLE_KEY');
}

export function createServerSupabaseClient(
  overrideSecretKey?: string,
  overrideUrl?: string
): SupabaseClient {
  // Ensure we do not run in a browser window (unless simulated in node test runner)
  if (typeof window !== 'undefined' && typeof process === 'undefined') {
    throw new Error('SECURITY VIOLATION: createServerSupabaseClient cannot be invoked in browser environments.');
  }

  const getEnv = (name: string): string | undefined => {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[name];
    }
    const globalDeno = (globalThis as unknown as { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno;
    if (typeof globalDeno !== 'undefined') {
      return globalDeno.env.get(name);
    }
    return undefined;
  };

  const supabaseUrl = overrideUrl || getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL');
  const secretKey = resolveServerSecretKey(overrideSecretKey);

  if (!supabaseUrl || !secretKey) {
    throw new Error(
      'Missing server Supabase credentials. Ensure SUPABASE_URL and SUPABASE_SECRET_KEYS / JOHARI_SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEY are configured in server environment/secrets.'
    );
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
