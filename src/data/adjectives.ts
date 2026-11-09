export interface AdjectiveItem {
  id: string;
  adjective: string;
  sort_order: number;
}

/**
 * Exactly 55 unique workshop-specific adjectives transcribed from the reference source.
 * Note: The source photograph prints "Lamed", which is preserved exactly as shown.
 * Five repeated print entries (Idealistic, Independent, Ingenious, Logical, Organized)
 * are deduplicated to yield exactly 55 unique entries.
 */
export const CANONICAL_ADJECTIVES: AdjectiveItem[] = [
  { id: 'able', adjective: 'Able', sort_order: 1 },
  { id: 'acceptable', adjective: 'Acceptable', sort_order: 2 },
  { id: 'adaptable', adjective: 'Adaptable', sort_order: 3 },
  { id: 'bold', adjective: 'Bold', sort_order: 4 },
  { id: 'brave', adjective: 'Brave', sort_order: 5 },
  { id: 'calm', adjective: 'Calm', sort_order: 6 },
  { id: 'caring', adjective: 'Caring', sort_order: 7 },
  { id: 'cheerful', adjective: 'Cheerful', sort_order: 8 },
  { id: 'clever', adjective: 'Clever', sort_order: 9 },
  { id: 'complex', adjective: 'Complex', sort_order: 10 },
  { id: 'confident', adjective: 'Confident', sort_order: 11 },
  { id: 'dependable', adjective: 'Dependable', sort_order: 12 },
  { id: 'dignified', adjective: 'Dignified', sort_order: 13 },
  { id: 'energetic', adjective: 'Energetic', sort_order: 14 },
  { id: 'extroverted', adjective: 'Extroverted', sort_order: 15 },
  { id: 'friendly', adjective: 'Friendly', sort_order: 16 },
  { id: 'giving', adjective: 'Giving', sort_order: 17 },
  { id: 'happy', adjective: 'Happy', sort_order: 18 },
  { id: 'helpful', adjective: 'Helpful', sort_order: 19 },
  { id: 'idealistic', adjective: 'Idealistic', sort_order: 20 },
  { id: 'independent', adjective: 'Independent', sort_order: 21 },
  { id: 'ingenious', adjective: 'Ingenious', sort_order: 22 },
  { id: 'intelligent', adjective: 'Intelligent', sort_order: 23 },
  { id: 'introverted', adjective: 'Introverted', sort_order: 24 },
  { id: 'kind', adjective: 'Kind', sort_order: 25 },
  { id: 'knowledgeable', adjective: 'Knowledgeable', sort_order: 26 },
  { id: 'lamed', adjective: 'Lamed', sort_order: 27 },
  { id: 'liberal', adjective: 'Liberal', sort_order: 28 },
  { id: 'lively', adjective: 'Lively', sort_order: 29 },
  { id: 'logical', adjective: 'Logical', sort_order: 30 },
  { id: 'loving', adjective: 'Loving', sort_order: 31 },
  { id: 'mature', adjective: 'Mature', sort_order: 32 },
  { id: 'modest', adjective: 'Modest', sort_order: 33 },
  { id: 'nervous', adjective: 'Nervous', sort_order: 34 },
  { id: 'observant', adjective: 'Observant', sort_order: 35 },
  { id: 'organized', adjective: 'Organized', sort_order: 36 },
  { id: 'patient', adjective: 'Patient', sort_order: 37 },
  { id: 'proud', adjective: 'Proud', sort_order: 38 },
  { id: 'quiet', adjective: 'Quiet', sort_order: 39 },
  { id: 'reflective', adjective: 'Reflective', sort_order: 40 },
  { id: 'religious', adjective: 'Religious', sort_order: 41 },
  { id: 'responsive', adjective: 'Responsive', sort_order: 42 },
  { id: 'searching', adjective: 'Searching', sort_order: 43 },
  { id: 'self-assertive', adjective: 'Self-assertive', sort_order: 44 },
  { id: 'self-conscious', adjective: 'Self-conscious', sort_order: 45 },
  { id: 'sensible', adjective: 'Sensible', sort_order: 46 },
  { id: 'sentimental', adjective: 'Sentimental', sort_order: 47 },
  { id: 'shy', adjective: 'Shy', sort_order: 48 },
  { id: 'smart', adjective: 'Smart', sort_order: 49 },
  { id: 'spontaneous', adjective: 'Spontaneous', sort_order: 50 },
  { id: 'tense', adjective: 'Tense', sort_order: 51 },
  { id: 'trustworthy', adjective: 'Trustworthy', sort_order: 52 },
  { id: 'warm', adjective: 'Warm', sort_order: 53 },
  { id: 'wise', adjective: 'Wise', sort_order: 54 },
  { id: 'witty', adjective: 'Witty', sort_order: 55 },
];
