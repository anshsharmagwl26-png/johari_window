import { describe, it, expect } from 'vitest';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';

describe('Canonical 55-Adjective Workshop Bank', () => {
  it('contains exactly 55 unique adjectives', () => {
    expect(CANONICAL_ADJECTIVES).toHaveLength(55);
  });

  it('preserves "Lamed" exactly as transcribed from workshop source', () => {
    const lamed = CANONICAL_ADJECTIVES.find((adj) => adj.id === 'lamed');
    expect(lamed).toBeDefined();
    expect(lamed?.adjective).toBe('Lamed');
  });

  it('has unique stable lowercase IDs', () => {
    const ids = CANONICAL_ADJECTIVES.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(55);
  });

  it('has unique display text for all entries', () => {
    const displayNames = CANONICAL_ADJECTIVES.map((a) => a.adjective);
    const uniqueNames = new Set(displayNames);
    expect(uniqueNames.size).toBe(55);
  });

  it('has contiguous sort_order values from 1 to 55', () => {
    const sortOrders = CANONICAL_ADJECTIVES.map((a) => a.sort_order).sort((a, b) => a - b);
    expect(sortOrders[0]).toBe(1);
    expect(sortOrders[54]).toBe(55);
    for (let i = 0; i < 55; i++) {
      expect(sortOrders[i]).toBe(i + 1);
    }
  });

  it('deduplicates the 5 repeated words from the printed reference', () => {
    const repeatedWords = ['Idealistic', 'Independent', 'Ingenious', 'Logical', 'Organized'];
    repeatedWords.forEach((word) => {
      const occurrences = CANONICAL_ADJECTIVES.filter(
        (a) => a.adjective.toLowerCase() === word.toLowerCase()
      );
      expect(occurrences).toHaveLength(1);
    });
  });
});
