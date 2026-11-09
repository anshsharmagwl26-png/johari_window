// Supabase Edge Function: reissue-invite
// Implements Stage 3C: Owner-authorized individual invitation reissuance
// Replaces an issued, unused invitation with a newly generated cryptographically secure 256-bit token.
// Enforces:
// 1. Owner authorization via JWT
// 2. Open session status & non-expired session check
// 3. Reissue target must be currently 'issued' (cannot reissue submitted or revoked invites)
// 4. Respects 200-record lifetime invitation cap per session
// 5. Returns plaintext replacement link exactly once with no-store/no-referrer

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

    const { session_id, old_invite_id, app_url } = await req.json();

    if (!session_id || !old_invite_id) {
      return new Response(
        JSON.stringify({ error: 'session_id and old_invite_id are required.' }),
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

    // 1. Generate new 256-bit unpadded base64url token in memory
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const rawToken = uint8ArrayToBase64Url(bytes);
    const newTokenHash = await computeSha256Hex(rawToken);

    // 2. Invoke atomic owner RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_owner_reissue_invite', {
      p_session_id: session_id,
      p_old_invite_id: old_invite_id,
      p_new_token_hash: newTokenHash,
    });

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: rpcError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanBaseUrl = (app_url || '').replace(/\/+$/, '');
    const replacementUrl = `${cleanBaseUrl}/invite#${rawToken}`;

    return new Response(
      JSON.stringify({
        success: true,
        invite: {
          id: rpcResult.id,
          url: replacementUrl,
          raw_token: rawToken,
          replaces_invite_id: rpcResult.replaces_invite_id,
        },
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
