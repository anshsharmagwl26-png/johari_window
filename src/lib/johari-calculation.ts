/**
 * Authoritative Johari Window Calculation Engine (TypeScript Reference Implementation)
 * Enforces Master Specification V4:
 *
 * Mathematical Definitions:
 * - U = all 55 canonical adjectives
 * - S = subject's self-assessment selections (5 to 7 distinct adjectives)
 * - P = union of all unique adjectives selected by submitted participants
 *
 * Four Canonical Quadrants:
 * - OPEN    = S ∩ P
 * - BLIND   = P − S
 * - HIDDEN  = S − P
 * - UNKNOWN = U − (S ∪ P)
 *
 * Frequency:
 * For every adjective in U, participant_frequency = number of distinct submitted participants
 * who selected it. Frequency MUST NEVER influence quadrant classification.
 *
 * Invariants:
 * 1. Mutually exclusive & collectively exhaustive:
 *    |OPEN| + |BLIND| + |HIDDEN| + |UNKNOWN| = 55
 * 2. Exactly 55 adjectives classified in every finalized snapshot.
 */

import { CANONICAL_ADJECTIVES } from '../data/adjectives';
import { JohariQuadrant } from '../types';

export interface ParticipantFeedbackInput {
  participantId: string;
  adjectiveIds: string[];
}

export interface ClassifiedAdjectiveResult {
  adjectiveId: string;
  quadrant: JohariQuadrant;
  participantFrequency: number;
}

export interface JohariCalculationResult {
  participantCount: number;
  adjectives: ClassifiedAdjectiveResult[];
  summary: {
    openCount: number;
    blindCount: number;
    hiddenCount: number;
    unknownCount: number;
    totalClassified: number;
  };
  quadrantSets: {
    open: string[];
    blind: string[];
    hidden: string[];
    unknown: string[];
  };
}

export function calculateJohariWindow(
  selfAssessmentIds: string[],
  participantSubmissions: ParticipantFeedbackInput[],
  canonicalAdjectiveList: string[] = CANONICAL_ADJECTIVES.map((a) => a.id)
): JohariCalculationResult {
  const U = new Set(canonicalAdjectiveList);
  if (U.size !== 55) {
    throw new Error(`Canonical adjective bank must contain exactly 55 unique adjectives (received: ${U.size}).`);
  }

  // Validate self-assessment
  if (!Array.isArray(selfAssessmentIds)) {
    throw new Error('Self-assessment adjective IDs must be an array.');
  }
  const S = new Set(selfAssessmentIds);
  if (S.size < 5 || S.size > 7) {
    throw new Error(`Self-assessment requires between 5 and 7 distinct adjectives (provided: ${S.size}).`);
  }
  for (const id of S) {
    if (!U.has(id)) {
      throw new Error(`Self-assessment adjective ID '${id}' is not in the canonical inventory.`);
    }
  }

  // Validate and collect participant submissions
  if (!Array.isArray(participantSubmissions)) {
    throw new Error('Participant submissions must be an array.');
  }

  const participantCount = participantSubmissions.length;
  const frequencyMap = new Map<string, number>();
  for (const id of U) {
    frequencyMap.set(id, 0);
  }

  const P = new Set<string>();

  for (const sub of participantSubmissions) {
    const distinctParticipantAdjs = new Set(sub.adjectiveIds);
    if (distinctParticipantAdjs.size < 5 || distinctParticipantAdjs.size > 7) {
      throw new Error(
        `Participant '${sub.participantId}' submitted ${distinctParticipantAdjs.size} adjectives; exactly 5 to 7 required.`
      );
    }

    for (const adjId of distinctParticipantAdjs) {
      if (!U.has(adjId)) {
        throw new Error(`Participant '${sub.participantId}' selected non-canonical adjective ID '${adjId}'.`);
      }
      P.add(adjId);
      frequencyMap.set(adjId, (frequencyMap.get(adjId) || 0) + 1);
    }
  }

  // Authoritative Set Operations
  const openSet: string[] = [];
  const blindSet: string[] = [];
  const hiddenSet: string[] = [];
  const unknownSet: string[] = [];

  const classifiedAdjectives: ClassifiedAdjectiveResult[] = [];

  for (const adjId of canonicalAdjectiveList) {
    const inS = S.has(adjId);
    const inP = P.has(adjId);
    const freq = frequencyMap.get(adjId) || 0;

    let quadrant: JohariQuadrant;

    if (inS && inP) {
      // OPEN = S ∩ P
      quadrant = 'open';
      openSet.push(adjId);
    } else if (!inS && inP) {
      // BLIND = P - S
      quadrant = 'blind';
      blindSet.push(adjId);
    } else if (inS && !inP) {
      // HIDDEN = S - P
      quadrant = 'hidden';
      hiddenSet.push(adjId);
    } else {
      // UNKNOWN = U - (S ∪ P)
      quadrant = 'unknown';
      unknownSet.push(adjId);
    }

    classifiedAdjectives.push({
      adjectiveId: adjId,
      quadrant,
      participantFrequency: freq,
    });
  }

  // Invariant assertions
  const totalClassified = classifiedAdjectives.length;
  if (totalClassified !== 55) {
    throw new Error(`Integrity invariant violated: Expected exactly 55 classified adjectives, got ${totalClassified}.`);
  }

  const sumQuadrants = openSet.length + blindSet.length + hiddenSet.length + unknownSet.length;
  if (sumQuadrants !== 55) {
    throw new Error(`Disjoint partition invariant violated: sum of quadrants (${sumQuadrants}) does not equal 55.`);
  }

  return {
    participantCount,
    adjectives: classifiedAdjectives,
    summary: {
      openCount: openSet.length,
      blindCount: blindSet.length,
      hiddenCount: hiddenSet.length,
      unknownCount: unknownSet.length,
      totalClassified,
    },
    quadrantSets: {
      open: openSet,
      blind: blindSet,
      hidden: hiddenSet,
      unknown: unknownSet,
    },
  };
}
