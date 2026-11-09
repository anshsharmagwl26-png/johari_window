import express, { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { createDeterministicTokenBatch, isValidTokenFormat, computeTokenHashSync, generateRawToken } from './src/lib/tokens';
import { computeHmacBucketKey, checkMemoryRateLimit, RATE_LIMIT_CONFIG } from './src/lib/rate-limiter';

dotenv.config();

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// Security headers middleware
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Helper to get Supabase client with forwarded user JWT
function getAuthenticatedSupabase(req: Request) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54322';
  const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_dummy';
  const authHeader = req.headers.authorization;

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
}

// Helper to get service-role Supabase client for anonymous participant workflows
function getServiceSupabase() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54322';
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_dummy';
  return createClient(supabaseUrl, serviceKey);
}

// ============================================================================
// API Route 1: Create Session (Phase A)
// ============================================================================
app.post('/api/sessions/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const {
      title,
      subject_name,
      description,
      expected_participants,
      collect_participant_names,
      allow_small_sample_results,
      ack_small_sample,
      expires_at,
    } = req.body;

    if (!title || !subject_name) {
      res.status(400).json({ error: 'Title and subject name are required.' });
      return;
    }

    const expectedCount = parseInt(expected_participants, 10);
    if (isNaN(expectedCount) || expectedCount < 1 || expectedCount > 50) {
      res.status(400).json({ error: 'Expected participants must be an integer between 1 and 50.' });
      return;
    }

    if (allow_small_sample_results && !ack_small_sample) {
      res.status(400).json({
        error: 'Enabling small-sample results requires affirmative privacy acknowledgement.',
      });
      return;
    }

    const supabase = getAuthenticatedSupabase(req);

    const { data, error } = await supabase.rpc('rpc_owner_create_session', {
      p_title: title.trim(),
      p_subject_name: subject_name.trim(),
      p_description: description ? description.trim() : null,
      p_expected_participants: expectedCount,
      p_collect_names: Boolean(collect_participant_names),
      p_allow_small_sample: Boolean(allow_small_sample_results),
      p_ack_small_sample: Boolean(ack_small_sample),
      p_expires_at: expires_at ? new Date(expires_at).toISOString() : null,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(201).json({ session: data });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 2: Submit Self-Assessment & Atomically Open Session (Phase B & C)
// ============================================================================
app.post('/api/sessions/:sessionId/submit-self-assessment', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const sessionId = req.params.sessionId;
    const { adjective_ids, app_url } = req.body;

    if (!sessionId || !Array.isArray(adjective_ids)) {
      res.status(400).json({ error: 'Invalid payload: sessionId and adjective_ids required.' });
      return;
    }

    // Deduplicate and validate 5-7 distinct adjectives
    const uniqueAdjIds = Array.from(new Set(adjective_ids));
    if (uniqueAdjIds.length < 5 || uniqueAdjIds.length > 7) {
      res.status(400).json({
        error: `Self-assessment requires between 5 and 7 distinct adjectives (provided: ${uniqueAdjIds.length}).`,
      });
      return;
    }

    const supabase = getAuthenticatedSupabase(req);

    // 1. Fetch session to verify ownership, draft status, and expected_participants count
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('id, owner_id, expected_participants, status')
      .eq('id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      res.status(404).json({ error: 'Session not found or caller does not own this session.' });
      return;
    }

    if (sessionData.status !== 'draft') {
      res.status(400).json({
        error: `Invalid transition: Session is already in '${sessionData.status}' status. Self-assessment is immutable.`,
      });
      return;
    }

    const expectedCount = sessionData.expected_participants;

    // 2. Generate initial batch of 256-bit cryptographically secure random tokens
    // Explicit deterministic mapping associating each returned invitation ID with its exact SHA-256 digest internally
    const tokenBatch = createDeterministicTokenBatch(expectedCount);

    // 3. Atomically invoke owner RPC passing token hashes and adjective IDs
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'rpc_owner_submit_self_assessment_and_open',
      {
        p_session_id: sessionId,
        p_adjective_ids: uniqueAdjIds,
        p_token_hashes: tokenBatch.tokenHashes,
      }
    );

    if (rpcError) {
      res.status(400).json({ error: rpcError.message });
      return;
    }

    // 4. Explicit deterministic mapping: pair returned database records with generated raw tokens via SHA-256 digest
    const baseUrl = (app_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const returnedInvites = rpcResult.invites || [];

    // Strips token_hash so no token hash is returned to the browser; plaintext tokens exist only in memory
    const inviteUrls = tokenBatch.pairInvitesWithTokens(returnedInvites, baseUrl);

    // 5. Strict security headers: no-referrer, no-store
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    res.status(200).json({
      session_id: rpcResult.session_id,
      status: rpcResult.status,
      invites: inviteUrls,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 3: Participant Read-Only Token Validation (Stage 3B)
// Entirely read-only; NEVER consumes token on preview, GET, or validation.
// ============================================================================
app.post('/api/participant/validate-token', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  try {
    const { token } = req.body;

    // 1. Validate raw token format (43-char base64url)
    if (!token || !isValidTokenFormat(token)) {
      res.status(400).json({
        valid: false,
        reason: 'invalid_format',
        message: 'Invalid invitation token format. 256-bit unpadded Base64URL token required.',
      });
      return;
    }

    // 2. HMAC-keyed rate limiting
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const bucketKey = computeHmacBucketKey(clientIp, 'validate_token');
    const rl = checkMemoryRateLimit(
      bucketKey,
      'validate_token_attempt',
      RATE_LIMIT_CONFIG.VALIDATION_MAX_ATTEMPTS,
      RATE_LIMIT_CONFIG.VALIDATION_WINDOW_SECONDS
    );

    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      res.status(429).json({
        valid: false,
        reason: 'rate_limited',
        message: 'Too many validation attempts. Please try again later.',
        retry_after_seconds: rl.retryAfterSeconds,
      });
      return;
    }

    // 3. Compute SHA-256 digest of token (64 lowercase hex)
    const tokenHash = computeTokenHashSync(token);

    // 4. Invoke read-only participant validation RPC
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc('rpc_participant_validate_token', {
      p_token_hash: tokenHash,
    });

    if (error) {
      res.status(500).json({ valid: false, reason: 'server_error', message: error.message });
      return;
    }

    // Return strictly minimal participant-facing metadata (NO token hash, NO response rows)
    if (!data || !data.valid) {
      res.status(200).json({
        valid: false,
        reason: data?.reason || 'invalid_invitation',
        message: 'This invitation is invalid, expired, or has already been submitted.',
      });
      return;
    }

    res.status(200).json({
      valid: true,
      session_id: data.session_id,
      subject_name: data.subject_name,
      title: data.title,
      description: data.description,
      collect_participant_names: data.collect_participant_names,
      expires_at: data.expires_at,
    });
  } catch (err) {
    res.status(500).json({ valid: false, reason: 'server_error', message: (err as Error).message });
  }
});

// ============================================================================
// API Route 4: Participant Atomic Feedback Submission (Stage 3B)
// Single-use token consumption; atomic commit of participant + responses + invite update.
// ============================================================================
app.post('/api/participant/submit-feedback', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  try {
    const { token, adjective_ids, participant_name } = req.body;

    // 1. Validate raw token format
    if (!token || !isValidTokenFormat(token)) {
      res.status(400).json({
        error: 'Invalid invitation token format. 256-bit unpadded Base64URL token required.',
      });
      return;
    }

    // 2. Validate adjective selections (5 to 7 distinct words)
    if (!Array.isArray(adjective_ids)) {
      res.status(400).json({ error: 'adjective_ids must be an array of strings.' });
      return;
    }

    const uniqueAdjIds = Array.from(new Set(adjective_ids));
    if (uniqueAdjIds.length < 5 || uniqueAdjIds.length > 7) {
      res.status(400).json({
        error: `Feedback submission requires between 5 and 7 distinct adjectives (provided: ${uniqueAdjIds.length}).`,
      });
      return;
    }

    // 3. HMAC-keyed rate limiting
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const bucketKey = computeHmacBucketKey(clientIp, 'submit_feedback');
    const rl = checkMemoryRateLimit(
      bucketKey,
      'submit_feedback_attempt',
      RATE_LIMIT_CONFIG.SUBMISSION_MAX_ATTEMPTS,
      RATE_LIMIT_CONFIG.SUBMISSION_WINDOW_SECONDS
    );

    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      res.status(429).json({
        error: 'Too many submission attempts. Please try again later.',
        retry_after_seconds: rl.retryAfterSeconds,
      });
      return;
    }

    // 4. Compute SHA-256 digest
    const tokenHash = computeTokenHashSync(token);

    // 5. Invoke atomic participant feedback submission RPC
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc('rpc_participant_submit_feedback', {
      p_token_hash: tokenHash,
      p_adjective_ids: uniqueAdjIds,
      p_participant_name: participant_name ?? null,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Feedback submitted successfully.',
      participant_id: data?.participant_id,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 5: Owner Reissue Single Invitation (Stage 3C)
// Replaces an unused issued invitation with a fresh 256-bit token atomically.
// ============================================================================
app.post('/api/sessions/:sessionId/reissue-invite', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const sessionId = req.params.sessionId;
    const { old_invite_id, app_url } = req.body;

    if (!sessionId || !old_invite_id) {
      res.status(400).json({ error: 'sessionId and old_invite_id are required.' });
      return;
    }

    // Generate fresh 256-bit cryptographically secure raw token in memory
    const rawToken = generateRawToken();
    const tokenHash = computeTokenHashSync(rawToken);

    const supabase = getAuthenticatedSupabase(req);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_owner_reissue_invite', {
      p_session_id: sessionId,
      p_old_invite_id: old_invite_id,
      p_new_token_hash: tokenHash,
    });

    if (rpcError) {
      res.status(400).json({ error: rpcError.message });
      return;
    }

    const baseUrl = (app_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const replacementUrl = `${baseUrl}/invite#${rawToken}`;

    res.status(200).json({
      success: true,
      invite: {
        id: rpcResult.id,
        url: replacementUrl,
        raw_token: rawToken, // Returned exactly once in memory
        replaces_invite_id: rpcResult.replaces_invite_id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 6: Owner Bulk Reissue All Unused Invitations (Stage 3C)
// Atomically revokes all unused invitations and returns fresh replacement links.
// ============================================================================
app.post('/api/sessions/:sessionId/bulk-reissue-unused', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const sessionId = req.params.sessionId;
    const { app_url } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required.' });
      return;
    }

    const supabase = getAuthenticatedSupabase(req);

    // 1. Query count of currently unused invitations
    const { count, error: countError } = await supabase
      .from('participant_invites')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('status', 'issued');

    if (countError) {
      res.status(400).json({ error: countError.message });
      return;
    }

    const unusedCount = count || 0;
    if (unusedCount === 0) {
      res.status(200).json({
        reissued_count: 0,
        invites: [],
        message: 'No unused invitations to reissue.',
      });
      return;
    }

    // 2. Generate deterministic batch of tokens
    const tokenBatch = createDeterministicTokenBatch(unusedCount);

    // 3. Atomically invoke bulk reissue RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'rpc_owner_bulk_reissue_unused_invites',
      {
        p_session_id: sessionId,
        p_new_token_hashes: tokenBatch.tokenHashes,
      }
    );

    if (rpcError) {
      res.status(400).json({ error: rpcError.message });
      return;
    }

    const baseUrl = (app_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const returnedInvites = rpcResult.invites || [];

    // Pair returned database records with generated raw tokens via SHA-256 digest
    const inviteUrls = tokenBatch.pairInvitesWithTokens(returnedInvites, baseUrl);

    res.status(200).json({
      reissued_count: rpcResult.reissued_count,
      invites: inviteUrls,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 7: Owner Finalize Session & Trigger Authoritative Johari Math (Stage 4)
// ============================================================================
app.post('/api/sessions/:sessionId/finalize', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const sessionId = req.params.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required.' });
      return;
    }

    const supabase = getAuthenticatedSupabase(req);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_owner_finalize_session', {
      p_session_id: sessionId,
    });

    if (rpcError) {
      res.status(400).json({ error: rpcError.message });
      return;
    }

    res.status(200).json({
      success: true,
      result: rpcResult,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 8: Owner Fetch Dashboard Session Details (Stage 5)
// ============================================================================
app.get('/api/sessions/:sessionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const sessionId = req.params.sessionId;
    const supabase = getAuthenticatedSupabase(req);
    const { data, error } = await supabase.rpc('rpc_owner_get_dashboard', {
      p_session_id: sessionId,
    });

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(200).json({ session: data });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// API Route 9: Owner Fetch Finalized Results Snapshot (Stage 5)
// Rejects unfinalized (draft/open) sessions and non-owners.
// ============================================================================
app.get('/api/sessions/:sessionId/results', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
      return;
    }

    const sessionId = req.params.sessionId;
    const supabase = getAuthenticatedSupabase(req);
    const { data, error } = await supabase.rpc('rpc_owner_get_results', {
      p_session_id: sessionId,
    });

    if (error) {
      const isUnfinalized = error.message.includes('not yet finalized');
      res.status(isUnfinalized ? 409 : 400).json({ error: error.message });
      return;
    }

    res.status(200).json({ results: data });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// ============================================================================
// Server Initialization & Vite Middleware Integration
// ============================================================================
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  // Export app for test suites and Vercel serverless functions; start listening in standalone server mode
  if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Server listening on port ${port} (mode: ${isProduction ? 'production' : 'development'})`);
    });
  }
}

startServer();

export default app;
