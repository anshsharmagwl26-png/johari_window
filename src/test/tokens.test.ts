import { describe, it, expect } from 'vitest';
import {
  generateRawToken,
  computeTokenHash,
  computeTokenHashSync,
  isValidTokenFormat,
  isValidTokenHash,
  generateInitialInvitationBatch,
  createDeterministicTokenBatch,
} from '../lib/tokens';

describe('Stage 3A: Cryptographic Token Generation & Hashing', () => {
  it('generates 256-bit unpadded base64url tokens of exactly 43 characters', () => {
    const token = generateRawToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(43);
    // Base64url without padding: [A-Za-z0-9_-]
    expect(isValidTokenFormat(token)).toBe(true);
    // Must NOT contain padding characters (=)
    expect(token).not.toContain('=');
    // Must NOT contain standard base64 symbols (+ or /)
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
  });

  it('guarantees cryptographic randomness and entropy across consecutive tokens', () => {
    const tokens = new Set<string>();
    const count = 1000;
    for (let i = 0; i < count; i++) {
      tokens.add(generateRawToken());
    }
    // All 1000 tokens must be completely distinct
    expect(tokens.size).toBe(count);
  });

  it('computes deterministic SHA-256 digest matching 64 lowercase hex characters', async () => {
    const token = generateRawToken();
    const hashAsync = await computeTokenHash(token);
    const hashSync = computeTokenHashSync(token);

    expect(hashAsync).toBe(hashSync);
    expect(hashAsync.length).toBe(64);
    expect(isValidTokenHash(hashAsync)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(hashAsync)).toBe(true);

    // Verify known SHA-256 test vector
    const knownInput = 'test-token-fixed-value';
    const knownHash = computeTokenHashSync(knownInput);
    // echo -n "test-token-fixed-value" | sha256sum
    // f0646d274a212eb805c919b486e71b151582e6f8d800f21d5776c40946ed767d
    expect(knownHash).toBe('f0646d274a212eb805c919b486e71b151582e6f8d800f21d5776c40946ed767d');
  });

  it('generates an initial batch matching expected_participants with URL fragment format', async () => {
    const baseUrl = 'https://example.com/app';
    const count = 5;
    const batch = await generateInitialInvitationBatch(count, baseUrl);

    expect(batch.length).toBe(count);

    const rawSet = new Set<string>();
    const hashSet = new Set<string>();

    for (const item of batch) {
      expect(isValidTokenFormat(item.rawToken)).toBe(true);
      expect(isValidTokenHash(item.tokenHash)).toBe(true);

      // Verify SHA-256 link
      expect(computeTokenHashSync(item.rawToken)).toBe(item.tokenHash);

      // Verify URL format: https://domain/invite#<token>
      expect(item.url).toBe(`https://example.com/app/invite#${item.rawToken}`);
      expect(item.url).not.toContain('?'); // Never in query string
      expect(item.url.split('#')[1]).toBe(item.rawToken); // Strictly in fragment

      rawSet.add(item.rawToken);
      hashSet.add(item.tokenHash);
    }

    expect(rawSet.size).toBe(count);
    expect(hashSet.size).toBe(count);
  });

  it('rejects invalid token formats and hashes', () => {
    expect(isValidTokenFormat('')).toBe(false);
    expect(isValidTokenFormat('short')).toBe(false);
    expect(isValidTokenFormat('a'.repeat(42))).toBe(false);
    expect(isValidTokenFormat('a'.repeat(44))).toBe(false);
    expect(isValidTokenFormat('invalid+base64/symbols==withpadding12345678')).toBe(false);

    expect(isValidTokenHash('')).toBe(false);
    expect(isValidTokenHash('NOT-HEX')).toBe(false);
    expect(isValidTokenHash('a'.repeat(63))).toBe(false);
    expect(isValidTokenHash('a'.repeat(65))).toBe(false);
    expect(isValidTokenHash('A'.repeat(64))).toBe(false); // must be lowercase
  });

  describe('Deterministic Invitation Token Mapping (FIX 4)', () => {
    it('associates each returned invitation ID with its exact SHA-256 digest internally', () => {
      const count = 10;
      const baseUrl = 'https://assessment.example.com';
      const batch = createDeterministicTokenBatch(count);

      expect(batch.tokenHashes.length).toBe(count);

      // Verify no duplicate tokens or hashes
      const uniqueHashes = new Set(batch.tokenHashes);
      expect(uniqueHashes.size).toBe(count);

      // Simulate PostgreSQL returning rows in reverse or scrambled order
      // (Proves we do not rely on INSERT RETURNING row order matching input array)
      const simulatedDbRecords = batch.tokenHashes.map((hash, i) => ({
        id: `invite-uuid-${i + 1}`,
        token_hash: hash,
      })).reverse(); // Scramble order

      const disclosed = batch.pairInvitesWithTokens(simulatedDbRecords, baseUrl);

      expect(disclosed.length).toBe(count);

      const seenTokens = new Set<string>();

      for (const item of disclosed) {
        // 1. Every generated invitation URL corresponds to the correct stored digest
        expect(item.url).toMatch(/^https:\/\/assessment\.example\.com\/invite#[A-Za-z0-9_-]{43}$/);
        const extractedRawToken = item.url.split('#')[1];
        expect(extractedRawToken).toBe(item.raw_token);

        // Compute SHA-256 of extracted raw token and find matching simulated DB record
        const computedHash = computeTokenHashSync(extractedRawToken);
        const matchingRecord = simulatedDbRecords.find((r) => r.id === item.id);
        expect(matchingRecord).toBeDefined();
        expect(matchingRecord!.token_hash).toBe(computedHash);

        // 2. No two invitations receive the same token
        expect(seenTokens.has(item.raw_token)).toBe(false);
        seenTokens.add(item.raw_token);

        // 3. No token hash is returned to the browser
        expect((item as unknown as Record<string, unknown>).token_hash).toBeUndefined();
      }

      expect(seenTokens.size).toBe(count);
    });

    it('throws when returned database records do not match generated batch', () => {
      const batch = createDeterministicTokenBatch(3);

      // Mismatched count
      expect(() => {
        batch.pairInvitesWithTokens(
          [{ id: '1', token_hash: batch.tokenHashes[0] }],
          'https://example.com'
        );
      }).toThrow(/Mismatched invitation records returned from database/);

      // Unknown token hash (not in generated map)
      expect(() => {
        batch.pairInvitesWithTokens(
          [
            { id: '1', token_hash: '0000000000000000000000000000000000000000000000000000000000000000' },
            { id: '2', token_hash: batch.tokenHashes[1] },
            { id: '3', token_hash: batch.tokenHashes[2] },
          ],
          'https://example.com'
        );
      }).toThrow(/Stored token digest .* was not found in generated token batch/);
    });
  });
});
