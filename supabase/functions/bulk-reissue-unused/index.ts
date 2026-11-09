// Supabase Edge Function: bulk-reissue-unused
// Implements Stage 3C: Owner-authorized bulk reissuance of all unused invitations
// Enforces:
// 1. Owner authorization via JWT
// 2. Open session status & non-expired session check
// 3. Atomically revokes all 'issued' (unused) invitations and generates fresh 256-bit tokens
// 4. Never revokes or reissues 'submitted' invitations
// 5. Enforces 200-record lifetime cap per session
// 6. Explicit deterministic mapping: pairs generated raw tokens with returned invite IDs via SHA-256 digest
// 7. Returns plaintext replacement links exactly once with no-store/no-referrer

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

    const { session_id, app_url } = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: 'session_id is required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // 1. Query count of currently unused invitations
    const { count, error: countError } = await supabase
      .from('participant_invites')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session_id)
      .eq('status', 'issued');

    if (countError) {
      return new Response(
        JSON.stringify({ error: countError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const unusedCount = count || 0;
    if (unusedCount === 0) {
      return new Response(
        JSON.stringify({
          reissued_count: 0,
          invites: [],
          message: 'No unused invitations to reissue.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Generate batch of 256-bit cryptographically secure random tokens
    const tokenMap = new Map<string, string>();
    const tokenHashes: string[] = [];

    for (let i = 0; i < unusedCount; i++) {
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

    // 3. Atomically invoke bulk reissue RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'rpc_owner_bulk_reissue_unused_invites',
      {
        p_session_id: session_id,
        p_new_token_hashes: tokenHashes,
      }
    );

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: rpcError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Explicit deterministic mapping: pair returned records with generated raw tokens via SHA-256 digest
    const cleanBaseUrl = (app_url || '').replace(/\/+$/, '');
    const returnedInvites: Array<{ id: string; token_hash: string }> = rpcResult.invites || [];

    const inviteUrls = returnedInvites.map((inv) => {
      const rawToken = tokenMap.get(inv.token_hash);
      if (!rawToken) {
        throw new Error(`Integrity error: Stored token digest ${inv.token_hash} not found in token map.`);
      }
      return {
        id: inv.id,
        url: `${cleanBaseUrl}/invite#${rawToken}`,
        raw_token: rawToken,
      };
    });

    return new Response(
      JSON.stringify({
        reissued_count: rpcResult.reissued_count,
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
