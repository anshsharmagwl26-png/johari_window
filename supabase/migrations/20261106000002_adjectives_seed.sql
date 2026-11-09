-- Migration 2: Canonical 55-Adjective Workshop Bank Seed
-- Exactly 55 unique entries. Deduplicates the 5 repeated print entries.
-- Preserves "Lamed" exactly as transcribed from the workshop photograph.

INSERT INTO public.adjectives (id, adjective, sort_order) VALUES
  ('able', 'Able', 1),
  ('acceptable', 'Acceptable', 2),
  ('adaptable', 'Adaptable', 3),
  ('bold', 'Bold', 4),
  ('brave', 'Brave', 5),
  ('calm', 'Calm', 6),
  ('caring', 'Caring', 7),
  ('cheerful', 'Cheerful', 8),
  ('clever', 'Clever', 9),
  ('complex', 'Complex', 10),
  ('confident', 'Confident', 11),
  ('dependable', 'Dependable', 12),
  ('dignified', 'Dignified', 13),
  ('energetic', 'Energetic', 14),
  ('extroverted', 'Extroverted', 15),
  ('friendly', 'Friendly', 16),
  ('giving', 'Giving', 17),
  ('happy', 'Happy', 18),
  ('helpful', 'Helpful', 19),
  ('idealistic', 'Idealistic', 20),
  ('independent', 'Independent', 21),
  ('ingenious', 'Ingenious', 22),
  ('intelligent', 'Intelligent', 23),
  ('introverted', 'Introverted', 24),
  ('kind', 'Kind', 25),
  ('knowledgeable', 'Knowledgeable', 26),
  ('lamed', 'Lamed', 27),
  ('liberal', 'Liberal', 28),
  ('lively', 'Lively', 29),
  ('logical', 'Logical', 30),
  ('loving', 'Loving', 31),
  ('mature', 'Mature', 32),
  ('modest', 'Modest', 33),
  ('nervous', 'Nervous', 34),
  ('observant', 'Observant', 35),
  ('organized', 'Organized', 36),
  ('patient', 'Patient', 37),
  ('proud', 'Proud', 38),
  ('quiet', 'Quiet', 39),
  ('reflective', 'Reflective', 40),
  ('religious', 'Religious', 41),
  ('responsive', 'Responsive', 42),
  ('searching', 'Searching', 43),
  ('self-assertive', 'Self-assertive', 44),
  ('self-conscious', 'Self-conscious', 45),
  ('sensible', 'Sensible', 46),
  ('sentimental', 'Sentimental', 47),
  ('shy', 'Shy', 48),
  ('smart', 'Smart', 49),
  ('spontaneous', 'Spontaneous', 50),
  ('tense', 'Tense', 51),
  ('trustworthy', 'Trustworthy', 52),
  ('warm', 'Warm', 53),
  ('wise', 'Wise', 54),
  ('witty', 'Witty', 55)
ON CONFLICT (id) DO UPDATE SET
  adjective = EXCLUDED.adjective,
  sort_order = EXCLUDED.sort_order;

-- Assert exactly 55 unique adjective records exist
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.adjectives;
  IF v_count <> 55 THEN
    RAISE EXCEPTION 'Invariant violation: Expected exactly 55 adjective rows, found %', v_count;
  END IF;
END $$;
