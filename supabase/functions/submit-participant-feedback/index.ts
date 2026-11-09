// Supabase Edge Function: submit-participant-feedback
// Implements Master Specification Phase C & Stage 3B Participant Submission
// Configured with token-based application authentication (no user JWT required).
// Deploy with: supabase functions deploy submit-participant-feedback --no-verify-jwt

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, authorization',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Referrer-Policy': 'no-referrer',
};

async function computeSha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

async function computeHmacSha256(keyStr: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyStr);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const apikeyHeader = req.headers.get('apikey');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';

    // Verify presence of Supabase API key (publishable or secret)
    if (!apikeyHeader || (apikeyHeader !== supabaseAnonKey && apikeyHeader !== supabaseServiceKey)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid Supabase apikey header.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { token, adjective_ids, participant_name } = await req.json();

    // 1. Validate raw token format (exactly 43 base64url characters)
    if (!token || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return new Response(
        JSON.stringify({ error: 'Invalid invitation token format. 256-bit unpadded Base64URL token required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Validate adjective selections count
    if (!Array.isArray(adjective_ids)) {
      return new Response(
        JSON.stringify({ error: 'adjective_ids must be an array of strings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uniqueAdjIds = Array.from(new Set(adjective_ids));
    if (uniqueAdjIds.length < 5 || uniqueAdjIds.length > 7) {
      return new Response(
        JSON.stringify({
          error: `Feedback requires between 5 and 7 distinct adjectives (provided: ${uniqueAdjIds.length}).`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Rate limiting check using HMAC-derived bucket key
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown-client';
    const rateLimitSecret = Deno.env.get('RATE_LIMIT_SECRET') || supabaseServiceKey || 'participant-salt';
    const bucketKey = await computeHmacSha256(rateLimitSecret, `${clientIp}:submit-feedback`);

    // Create service-role client for atomic submission RPC
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

    const { data: rlResult, error: rlError } = await supabaseAdmin.rpc(
      'rpc_check_and_record_rate_limit',
      {
        p_bucket_key: bucketKey,
        p_event_type: 'participant_submit_attempt',
        p_max_attempts: 10,
        p_window_seconds: 60,
      }
    );

    if (!rlError && rlResult && rlResult.allowed === false) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests. Please try again shortly.',
          retry_after_seconds: rlResult.retry_after_seconds || 60,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(rlResult.retry_after_seconds || 60),
          },
        }
      );
    }

    // 4. Compute SHA-256 digest of token (64 lowercase hex)
    const tokenHash = await computeSha256Hex(token);

    // 5. Invoke atomic participant feedback submission RPC
    const { data: submitResult, error: submitError } = await supabaseAdmin.rpc(
      'rpc_participant_submit_feedback',
      {
        p_token_hash: tokenHash,
        p_adjective_ids: uniqueAdjIds,
        p_participant_name: participant_name ?? null,
      }
    );

    if (submitError) {
      return new Response(
        JSON.stringify({ error: submitError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Feedback submitted successfully.',
        participant_id: submitResult.participant_id,
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
