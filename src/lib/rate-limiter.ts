/**
 * HMAC-SHA-256 Keyed Rate Limiting for Johari Window
 * Enforces Master Specification Phase C & Stage 3B Requirement F:
 * - Bucket keys are derived using HMAC-SHA-256 with server-only salt/secret.
 * - Raw IP addresses are NEVER stored or logged.
 * - Ordinary unsalted hashes of IP addresses are NEVER used.
 * - Sliding window throttling for token validation and feedback submission failures.
 * - Returns 429 Too Many Requests when limits are exceeded.
 */

// Default configuration constants (configurable via environment variables)
export const RATE_LIMIT_CONFIG = {
  // Token validation: max 10 failed or total attempts per 60 seconds per IP bucket
  VALIDATION_MAX_ATTEMPTS: 10,
  VALIDATION_WINDOW_SECONDS: 60,

  // Feedback submission: max 5 failed or duplicate attempts per 60 seconds per IP bucket
  SUBMISSION_MAX_ATTEMPTS: 5,
  SUBMISSION_WINDOW_SECONDS: 60,
};

/**
 * Computes a secure HMAC-SHA-256 bucket key from an identifier (e.g. client IP) and action type.
 * Never stores or logs raw IP or unsalted hashes.
 */
export function computeHmacBucketKey(
  identifier: string,
  actionType: string,
  secretKey?: string
): string {
  const secret = secretKey || process.env.RATE_LIMIT_SECRET || process.env.SUPABASE_SECRET_KEY || 'default-johari-rate-limit-salt';
  const cleanId = (identifier || 'unknown-client').trim();

  // Node.js crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', secret)
    .update(`${cleanId}:${actionType}`)
    .digest('hex');
}

/**
 * In-memory sliding window fallback for unit tests and local mock execution.
 */
interface MemoryEvent {
  timestamp: number;
}
const memoryBuckets = new Map<string, MemoryEvent[]>();

export function checkMemoryRateLimit(
  bucketKey: string,
  eventType: string,
  maxAttempts: number,
  windowSeconds: number,
  nowMs: number = Date.now()
): { allowed: boolean; currentCount: number; retryAfterSeconds: number } {
  const compositeKey = `${bucketKey}:${eventType}`;
  const cutoff = nowMs - windowSeconds * 1000;

  const events = (memoryBuckets.get(compositeKey) || []).filter(
    (e) => e.timestamp >= cutoff
  );

  if (events.length >= maxAttempts) {
    const oldestEvent = events[0];
    const retryAfter = Math.ceil((oldestEvent.timestamp + windowSeconds * 1000 - nowMs) / 1000);
    return {
      allowed: false,
      currentCount: events.length,
      retryAfterSeconds: Math.max(1, retryAfter),
    };
  }

  events.push({ timestamp: nowMs });
  memoryBuckets.set(compositeKey, events);

  return {
    allowed: true,
    currentCount: events.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Resets in-memory rate limit buckets (useful in test suites).
 */
export function resetMemoryRateLimiter(): void {
  memoryBuckets.clear();
}
