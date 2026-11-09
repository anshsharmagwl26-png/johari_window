// Supabase Edge Function: submit-self-assessment
// Implements Master Specification Phase B & Phase C Atomic Issuance
// Invoked by the authenticated session owner carrying their user JWT.
// Generates 256-bit unpadded base64url tokens, computes SHA-256 hashes,
// calls rpc_owner_submit_self_assessment_and_open with owner JWT,
// and returns full /invite#<token> URLs once with no-store/no-referrer.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Referrer-Policy': 'no-referrer',
};

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function computeSha256Hex(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header with owner JWT.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { session_id, adjective_ids, app_url } = await req.json();

    if (!session_id || !Array.isArray(adjective_ids)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: session_id and adjective_ids required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplicate and validate adjective count (5-7)
    const uniqueAdjIds = Array.from(new Set(adjective_ids));
    if (uniqueAdjIds.length < 5 || uniqueAdjIds.length > 7) {
      return new Response(
        JSON.stringify({
          error: `Self-assessment requires between 5 and 7 distinct adjectives (provided: ${uniqueAdjIds.length}).`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    // Create user-scoped Supabase client carrying the owner's JWT
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Verify authenticated owner identity via Supabase Auth
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Invalid or expired owner JWT.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Fetch draft session to verify ownership and expected_participants count
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id, owner_id, expected_participants, status')
      .eq('id', session_id)
      .single();

    if (sessionError || !sessionData) {
      return new Response(
        JSON.stringify({ error: 'Session not found or caller does not own this session.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (sessionData.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Caller is not the owner of this session.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (sessionData.status !== 'draft') {
      return new Response(
        JSON.stringify({
          error: `Invalid transition: Session is already in '${sessionData.status}' status. Self-assessment is immutable.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const expectedCount = sessionData.expected_participants;
    if (expectedCount < 1 || expectedCount > 50) {
      return new Response(
        JSON.stringify({ error: 'Expected participants must be between 1 and 50.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Generate initial batch of 256-bit cryptographically secure random tokens
    // Explicit deterministic mapping: Map token_hash -> rawToken
    const tokenMap = new Map<string, string>();
    const tokenHashes: string[] = [];

    for (let i = 0; i < expectedCount; i++) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const rawToken = uint8ArrayToBase64Url(bytes);
      const hash = await computeSha256Hex(rawToken);

      if (tokenMap.has(hash)) {
        throw new Error('Collision detected during token generation.');
      }

      tokenMap.set(hash, rawToken);
      tokenHashes.push(hash);
    }

    // 3. Atomically invoke owner RPC passing token hashes and adjective IDs
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'rpc_owner_submit_self_assessment_and_open',
      {
        p_session_id: session_id,
        p_adjective_ids: uniqueAdjIds,
        p_token_hashes: tokenHashes,
      }
    );

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: rpcError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Explicit deterministic mapping: Associate each returned invitation ID with its exact SHA-256 digest internally
    // Do not rely on PostgreSQL INSERT RETURNING row order matching the input token array
    const cleanBaseUrl = (app_url || '').replace(/\/+$/, '');
    const returnedInvites: Array<{ id: string; token_hash: string }> = rpcResult.invites || [];

    if (returnedInvites.length !== expectedCount) {
      throw new Error(`Mismatched invite count: expected ${expectedCount}, received ${returnedInvites.length}`);
    }

    const inviteUrls = returnedInvites.map((inv) => {
      const rawToken = tokenMap.get(inv.token_hash);
      if (!rawToken) {
        throw new Error(`Integrity error: Stored token digest ${inv.token_hash} not found in generated token map.`);
      }
      return {
        id: inv.id,
        url: `${cleanBaseUrl}/invite#${rawToken}`,
        raw_token: rawToken, // Returned exactly once in memory
        // Note: token_hash is strictly NOT included in the returned object to ensure no token hash is returned to the browser
      };
    });

    // 5. Return success payload with strict security headers
    return new Response(
      JSON.stringify({
        session_id: rpcResult.session_id,
        status: rpcResult.status,
        invites: inviteUrls,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
