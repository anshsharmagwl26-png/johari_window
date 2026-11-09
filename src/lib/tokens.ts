/**
 * Cryptographic Token Utilities for Johari Window Invitation Issuance
 * Enforces Master Specification Phase C:
 * - 32 cryptographically secure random bytes
 * - base64url encoded without padding (43 characters)
 * - SHA-256 digest stored as lowercase 64-character hex string
 * - Fragment URL format: /invite#<token>
 */

export interface GeneratedTokenPair {
  rawToken: string;
  tokenHash: string;
  url: string;
}

/**
 * Validates whether a token string is a valid 256-bit unpadded base64url string (43 characters).
 */
export function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  // 32 bytes encoded in base64url without padding is exactly 43 characters
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * Validates whether a token hash is a valid 64-character lowercase hex string.
 */
export function isValidTokenHash(hash: string): boolean {
  if (!hash || typeof hash !== 'string') return false;
  return /^[0-9a-f]{64}$/.test(hash);
}

/**
 * Converts Uint8Array to base64url string without padding.
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }

  // Browser / Web standard fallback
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates 32 cryptographically secure random bytes encoded as base64url without padding.
 */
export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return nodeCrypto.randomBytes(32).toString('base64url');
  }
  return uint8ArrayToBase64Url(bytes);
}

/**
 * Computes SHA-256 digest of a string returning lowercase 64-character hex string.
 */
export async function computeTokenHash(token: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return nodeCrypto.createHash('sha256').update(token).digest('hex').toLowerCase();
  }
}

/**
 * Synchronous hash computation for Node.js environments (test suites / server).
 */
export function computeTokenHashSync(token: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto');
  return nodeCrypto.createHash('sha256').update(token).digest('hex').toLowerCase();
}

/**
 * Generates an initial batch of tokens equal to expectedParticipants.
 * Returns raw tokens, hashes, and complete URLs.
 * NOTE: Plaintext tokens exist only in memory during issuance and must be returned once.
 */
export async function generateInitialInvitationBatch(
  count: number,
  baseUrl: string
): Promise<GeneratedTokenPair[]> {
  if (count < 1 || count > 50) {
    throw new Error('Initial invitation batch count must be between 1 and 50.');
  }

  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const pairs: GeneratedTokenPair[] = [];

  for (let i = 0; i < count; i++) {
    const rawToken = generateRawToken();
    const tokenHash = await computeTokenHash(rawToken);
    const url = `${cleanBaseUrl}/invite#${rawToken}`;

    pairs.push({
      rawToken,
      tokenHash,
      url,
    });
  }

  return pairs;
}

export interface ReturnedInviteRecord {
  id: string;
  token_hash: string;
}

export interface DisclosedInvite {
  id: string;
  url: string;
  raw_token: string;
}

/**
 * Creates a deterministic token batch for atomic issuance.
 * Enforces:
 * 1. Exactly 32 cryptographically secure random bytes per token.
 * 2. Unpadded Base64URL encoding (43 characters).
 * 3. SHA-256 lowercase hex digest (64 characters).
 * 4. Deterministic mapping associating each returned invitation ID with its exact SHA-256 digest internally.
 * 5. Rejects duplicate tokens or collisions.
 * 6. Strips token_hash before disclosure so no hash is returned to the browser.
 */
export function createDeterministicTokenBatch(count: number) {
  if (count < 1 || count > 50) {
    throw new Error('Initial invitation batch count must be between 1 and 50.');
  }

  const tokenMap = new Map<string, string>(); // tokenHash -> rawToken
  const tokenHashes: string[] = [];

  for (let i = 0; i < count; i++) {
    const rawToken = generateRawToken();
    const hash = computeTokenHashSync(rawToken);

    if (tokenMap.has(hash)) {
      throw new Error('Cryptographic collision detected during token generation.');
    }

    tokenMap.set(hash, rawToken);
    tokenHashes.push(hash);
  }

  return {
    tokenHashes,
    rawTokens: Array.from(tokenMap.values()),
    /**
     * Associates each returned database invitation record with its exact SHA-256 digest internally,
     * without relying on PostgreSQL INSERT RETURNING row order.
     */
    pairInvitesWithTokens(
      invites: ReturnedInviteRecord[],
      baseUrl: string
    ): DisclosedInvite[] {
      if (!Array.isArray(invites) || invites.length !== count) {
        throw new Error(
          `Mismatched invitation records returned from database: expected ${count}, received ${invites?.length ?? 0}`
        );
      }

      const cleanBaseUrl = (baseUrl || '').replace(/\/+$/, '');
      const disclosed: DisclosedInvite[] = [];
      const seenHashes = new Set<string>();

      for (const inv of invites) {
        if (!inv.id || !inv.token_hash) {
          throw new Error('Invalid invite record returned from database: missing id or token_hash.');
        }

        if (seenHashes.has(inv.token_hash)) {
          throw new Error(`Duplicate token hash detected in returned records: ${inv.token_hash}`);
        }
        seenHashes.add(inv.token_hash);

        const rawToken = tokenMap.get(inv.token_hash);
        if (!rawToken) {
          throw new Error(
            `Integrity error: Stored token digest ${inv.token_hash} was not found in generated token batch.`
          );
        }

        // Return only id, url (with #<token> fragment), and raw_token (held only in memory).
        // token_hash is strictly NOT included in the returned payload.
        disclosed.push({
          id: inv.id,
          url: `${cleanBaseUrl}/invite#${rawToken}`,
          raw_token: rawToken,
        });
      }

      return disclosed;
    },
  };
}

