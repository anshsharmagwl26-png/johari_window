// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { calculateJohariWindow } from '../lib/johari-calculation';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';

describe('Stage 4: Authoritative Johari Calculation Engine & Parity Verification', () => {
  const allIds = CANONICAL_ADJECTIVES.map((a) => a.id);

  // Helper to get adjective ID by word
  const getAdjId = (word: string) => {
    const found = CANONICAL_ADJECTIVES.find((a) => a.adjective.toLowerCase() === word.toLowerCase());
    if (!found) throw new Error(`Unknown adjective in test: ${word}`);
    return found.id;
  };

  it('Section 5 Mandatory Test Vector: Produces authoritative quadrants and frequencies', () => {
    // Subject: Able, Caring, Clever, Happy, Kind.
    const subjectAdjectives = ['able', 'caring', 'clever', 'happy', 'kind'].map(getAdjId);

    // Participant 1: Able, Caring, Brave, Friendly, Happy.
    const p1Adjectives = ['able', 'caring', 'brave', 'friendly', 'happy'].map(getAdjId);

    // Participant 2: Clever, Kind, Brave, Calm, Friendly.
    const p2Adjectives = ['clever', 'kind', 'brave', 'calm', 'friendly'].map(getAdjId);

    const result = calculateJohariWindow(subjectAdjectives, [
      { participantId: 'p1', adjectiveIds: p1Adjectives },
      { participantId: 'p2', adjectiveIds: p2Adjectives },
    ]);

    // Expected:
    // OPEN: 5 (Able, Caring, Clever, Happy, Kind)
    // BLIND: 3 (Brave, Friendly, Calm)
    // HIDDEN: 0 (Empty)
    // UNKNOWN: 47 (Remaining 47 adjectives)
    expect(result.summary.openCount).toBe(5);
    expect(result.summary.blindCount).toBe(3);
    expect(result.summary.hiddenCount).toBe(0);
    expect(result.summary.unknownCount).toBe(47);
    expect(result.summary.totalClassified).toBe(55);

    // Verify Open quadrant contains exactly S
    const openSet = new Set(result.quadrantSets.open);
    for (const id of subjectAdjectives) {
      expect(openSet.has(id)).toBe(true);
    }

    // Verify Blind quadrant contains Brave, Friendly, Calm
    const blindSet = new Set(result.quadrantSets.blind);
    expect(blindSet.has(getAdjId('brave'))).toBe(true);
    expect(blindSet.has(getAdjId('friendly'))).toBe(true);
    expect(blindSet.has(getAdjId('calm'))).toBe(true);
    expect(blindSet.size).toBe(3);

    // Verify Hidden is completely empty
    expect(result.quadrantSets.hidden).toEqual([]);

    // Verify Frequency counts:
    // Brave: frequency 2
    // Friendly: frequency 2
    // Calm: frequency 1
    const adjMap = new Map(result.adjectives.map((a) => [a.adjectiveId, a]));
    expect(adjMap.get(getAdjId('brave'))?.participantFrequency).toBe(2);
    expect(adjMap.get(getAdjId('friendly'))?.participantFrequency).toBe(2);
    expect(adjMap.get(getAdjId('calm'))?.participantFrequency).toBe(1);

    // Open adjectives frequency:
    expect(adjMap.get(getAdjId('able'))?.participantFrequency).toBe(1);
    expect(adjMap.get(getAdjId('caring'))?.participantFrequency).toBe(1);
    expect(adjMap.get(getAdjId('happy'))?.participantFrequency).toBe(1);
    expect(adjMap.get(getAdjId('clever'))?.participantFrequency).toBe(1);
    expect(adjMap.get(getAdjId('kind'))?.participantFrequency).toBe(1);

    // Any unknown adjective has frequency 0
    const unknownSample = result.quadrantSets.unknown[0];
    expect(adjMap.get(unknownSample)?.participantFrequency).toBe(0);
  });

  it('Section 6: All four quadrants populated simultaneously', () => {
    // Subject: Able, Caring, Clever, Dependable, Dignified
    const subject = ['able', 'caring', 'clever', 'dependable', 'dignified'].map(getAdjId);

    // P1 selects: Able, Caring (overlap with S) + Brave, Calm, Cheerful (not in S)
    const p1 = ['able', 'caring', 'brave', 'calm', 'cheerful'].map(getAdjId);
    // P2 selects: Able (overlap with S) + Bold, Energetic, Friendly (not in S) + Brave (not in S)
    const p2 = ['able', 'bold', 'energetic', 'friendly', 'brave'].map(getAdjId);

    const result = calculateJohariWindow(subject, [
      { participantId: 'p1', adjectiveIds: p1 },
      { participantId: 'p2', adjectiveIds: p2 },
    ]);

    // Open: S ∩ P = {Able, Caring} (2)
    // Hidden: S - P = {Clever, Dependable, Dignified} (3)
    // Blind: P - S = {Brave, Calm, Cheerful, Bold, Energetic, Friendly} (6)
    // Unknown: 55 - (2 + 3 + 6) = 44
    expect(result.summary.openCount).toBe(2);
    expect(result.summary.hiddenCount).toBe(3);
    expect(result.summary.blindCount).toBe(6);
    expect(result.summary.unknownCount).toBe(44);

    expect(result.summary.openCount + result.summary.hiddenCount + result.summary.blindCount + result.summary.unknownCount).toBe(55);
  });

  it('Section 6: All feedback overlaps with self-assessment (Blind is Empty)', () => {
    // Subject has 5 adjectives
    const subject = ['able', 'acceptable', 'adaptable', 'bold', 'brave'].map(getAdjId);
    // Participants only pick from the subject's 5 adjectives
    const p1 = ['able', 'acceptable', 'adaptable', 'bold', 'brave'].map(getAdjId);

    const result = calculateJohariWindow(subject, [
      { participantId: 'p1', adjectiveIds: p1 },
    ]);

    // All in Open: 5
    // Blind: 0
    // Hidden: 0
    // Unknown: 50
    expect(result.summary.openCount).toBe(5);
    expect(result.summary.blindCount).toBe(0);
    expect(result.summary.hiddenCount).toBe(0);
    expect(result.summary.unknownCount).toBe(50);
  });

  it('Section 6: No overlap between participants and self-assessment (Open is Empty)', () => {
    // Subject has 5 adjectives
    const subject = ['able', 'acceptable', 'adaptable', 'bold', 'brave'].map(getAdjId);
    // Participant picks completely disjoint 5 adjectives
    const p1 = ['calm', 'caring', 'cheerful', 'clever', 'complex'].map(getAdjId);

    const result = calculateJohariWindow(subject, [
      { participantId: 'p1', adjectiveIds: p1 },
    ]);

    // Open: 0
    // Hidden: 5 (all of S)
    // Blind: 5 (all of P)
    // Unknown: 45
    expect(result.summary.openCount).toBe(0);
    expect(result.summary.hiddenCount).toBe(5);
    expect(result.summary.blindCount).toBe(5);
    expect(result.summary.unknownCount).toBe(45);
    expect(result.quadrantSets.open).toEqual([]);
  });

  it('Section 6: Mutually exclusive and collectively exhaustive partition invariant', () => {
    const subject = allIds.slice(0, 6);
    const p1 = allIds.slice(3, 9);
    const p2 = allIds.slice(5, 11);

    const result = calculateJohariWindow(subject, [
      { participantId: 'p1', adjectiveIds: p1 },
      { participantId: 'p2', adjectiveIds: p2 },
    ]);

    const open = new Set(result.quadrantSets.open);
    const blind = new Set(result.quadrantSets.blind);
    const hidden = new Set(result.quadrantSets.hidden);
    const unknown = new Set(result.quadrantSets.unknown);

    // Disjointness
    for (const id of open) {
      expect(blind.has(id)).toBe(false);
      expect(hidden.has(id)).toBe(false);
      expect(unknown.has(id)).toBe(false);
    }
    for (const id of blind) {
      expect(hidden.has(id)).toBe(false);
      expect(unknown.has(id)).toBe(false);
    }
    for (const id of hidden) {
      expect(unknown.has(id)).toBe(false);
    }

    // Exhaustive
    const union = new Set([...open, ...blind, ...hidden, ...unknown]);
    expect(union.size).toBe(55);
    expect(result.summary.totalClassified).toBe(55);
  });

  it('Section 6: Frequency count never influences quadrant assignment', () => {
    // If 10 participants select an adjective not in S, it remains BLIND regardless of frequency 10
    const subject = ['able', 'caring', 'clever', 'happy', 'kind'].map(getAdjId);
    const pIds = ['brave', 'friendly', 'calm', 'energetic', 'helpful'].map(getAdjId);

    const submissions = Array(10).fill(0).map((_, i) => ({
      participantId: `p-${i}`,
      adjectiveIds: pIds,
    }));

    const result = calculateJohariWindow(subject, submissions);

    const braveResult = result.adjectives.find((a) => a.adjectiveId === getAdjId('brave'));
    expect(braveResult?.participantFrequency).toBe(10);
    expect(braveResult?.quadrant).toBe('blind'); // Remains BLIND despite high frequency
  });

  it('Section 6: Rejects invalid or out-of-bounds self-assessment selections', () => {
    // Less than 5 adjectives
    expect(() => {
      calculateJohariWindow(['able', 'caring'], []);
    }).toThrow(/requires between 5 and 7/);

    // More than 7 adjectives
    expect(() => {
      calculateJohariWindow(allIds.slice(0, 8), []);
    }).toThrow(/requires between 5 and 7/);

    // Non-canonical adjective ID
    expect(() => {
      calculateJohariWindow(['fake_adj_1', 'fake_adj_2', 'fake_adj_3', 'fake_adj_4', 'fake_adj_5'], []);
    }).toThrow(/not in the canonical inventory/);
  });

  it('Section 6: Rejects participant submission with invalid adjective count', () => {
    const subject = allIds.slice(0, 5);

    expect(() => {
      calculateJohariWindow(subject, [
        { participantId: 'p1', adjectiveIds: ['able', 'caring'] },
      ]);
    }).toThrow(/exactly 5 to 7 required/);
  });
});
