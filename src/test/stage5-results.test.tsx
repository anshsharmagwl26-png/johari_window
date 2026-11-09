import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResultsPage } from '../pages/ResultsPage';
import * as sessionService from '../lib/session-service';
import { CANONICAL_ADJECTIVES } from '../data/adjectives';

vi.mock('../lib/session-service', async () => {
  const actual = await vi.importActual('../lib/session-service');
  return {
    ...actual,
    fetchSessionResults: vi.fn(),
  };
});

describe('Stage 5 — Results Presentation & Johari Matrix Visualization', () => {
  const sessionId = '77777777-7777-7777-7777-777777777777';

  // Build a realistic finalized snapshot according to the Stage 4 mandatory test vector:
  // Subject: able, caring, clever, happy, kind (5)
  // Participant 1: able, caring, brave, friendly, happy
  // Participant 2: clever, kind, brave, calm, friendly
  // Open: able, caring, clever, happy, kind (5)
  // Blind: brave (freq 2), friendly (freq 2), calm (freq 1) (3)
  // Hidden: (0)
  // Unknown: 47 words
  const mockSnapshot: sessionService.FinalizedResultsSnapshot = {
    session_id: sessionId,
    title: 'Leadership 360 Assessment',
    subject_name: 'Alex Morgan',
    status: 'finalized',
    participant_count: 2,
    allow_small_sample_results: true,
    calculation_version: '1.0.0',
    generated_at: new Date().toISOString(),
    summary: {
      open_count: 5,
      blind_count: 3,
      hidden_count: 0,
      unknown_count: 47,
      total_classified: 55,
    },
    adjectives: CANONICAL_ADJECTIVES.map((a) => {
      if (['able', 'caring', 'clever', 'happy', 'kind'].includes(a.id)) {
        return {
          id: a.id,
          word: a.adjective,
          sort_order: a.sort_order,
          quadrant: 'open' as const,
          feedback_count: 1,
        };
      }
      if (['brave', 'friendly'].includes(a.id)) {
        return {
          id: a.id,
          word: a.adjective,
          sort_order: a.sort_order,
          quadrant: 'blind' as const,
          feedback_count: 2,
        };
      }
      if (a.id === 'calm') {
        return {
          id: a.id,
          word: a.adjective,
          sort_order: a.sort_order,
          quadrant: 'blind' as const,
          feedback_count: 1,
        };
      }
      return {
        id: a.id,
        word: a.adjective,
        sort_order: a.sort_order,
        quadrant: 'unknown' as const,
        feedback_count: 0,
      };
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially then renders live finalized snapshot', async () => {
    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: mockSnapshot,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Initial loading indicator
    expect(screen.getByText(/Loading Authoritative Results/i)).toBeDefined();

    // After resolution
    await waitFor(() => {
      expect(screen.getByText(/Assessment Results: Alex Morgan/i)).toBeDefined();
    });

    // Check all 4 quadrants exist in the 2x2 grid
    expect(screen.getByText(/Top Left • Open Area/i)).toBeDefined();
    expect(screen.getByText(/Top Right • Blind Area/i)).toBeDefined();
    expect(screen.getByText(/Bottom Left • Hidden Area/i)).toBeDefined();
    expect(screen.getByText(/Bottom Right • Unknown Area/i)).toBeDefined();
  });

  it('displays accurate trait counts and frequency badges for peer feedback', async () => {
    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: mockSnapshot,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/5 words/i)).toBeDefined(); // Open
      expect(screen.getByText(/3 words/i)).toBeDefined(); // Blind
      expect(screen.getByText(/0 words/i)).toBeDefined(); // Hidden
      expect(screen.getByText(/47 words/i)).toBeDefined(); // Unknown
    });

    // Open quadrant traits
    expect(screen.getByText('Able')).toBeDefined();
    expect(screen.getByText('Caring')).toBeDefined();
    expect(screen.getByText('Clever')).toBeDefined();

    // Blind quadrant traits
    expect(screen.getByText('Brave')).toBeDefined();
    expect(screen.getByText('Friendly')).toBeDefined();
    expect(screen.getByText('Calm')).toBeDefined();

    // Empty quadrant state for Hidden
    expect(screen.getByText(/All of your self-selected adjectives were also recognized/i)).toBeDefined();
  });

  it('displays small-sample privacy warning when participant_count < 5', async () => {
    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: mockSnapshot, // participant_count is 2
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(
        screen.getByText(/Small-sample privacy warning: results may reveal individual feedback when participation is limited/i)
      ).toBeDefined();
    });
  });

  it('omits small-sample privacy warning when participant_count >= 5', async () => {
    const standardSnapshot = {
      ...mockSnapshot,
      participant_count: 6,
    };

    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: standardSnapshot,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Assessment Results: Alex Morgan/i)).toBeDefined();
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('displays communication and self-awareness disclaimer banner', async () => {
    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: mockSnapshot,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/This is a communication and self-awareness exercise, not a clinical personality assessment/i)
      ).toBeDefined();
    });
  });

  it('rejects access and displays prompt with return link when session is unfinalized', async () => {
    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: null,
      error: new Error('Session results are not yet finalized (current status: open). Results are only accessible once the session is finalized.'),
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Session Results Not Yet Finalized/i)).toBeDefined();
      expect(
        screen.getByText(/Results are only accessible once the session is finalized by the session owner/i)
      ).toBeDefined();
      expect(screen.getByText(/Return to Owner Dashboard/i)).toBeDefined();
    });
  });

  it('verifies Johari invariant in footer (sum of 4 quadrants = 55)', async () => {
    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: mockSnapshot,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Johari Invariant Verification/i)).toBeDefined();
      expect(screen.getByText(/55 total/i)).toBeDefined();
    });
  });

  it('triggers PDF export utility when Export PDF button is clicked', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfExport = await import('../lib/pdf-export');
    const spy = vi.spyOn(pdfExport, 'generateJohariResultsPdf').mockImplementation(() => {});

    vi.mocked(sessionService.fetchSessionResults).mockResolvedValueOnce({
      snapshot: mockSnapshot,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={[`/results/${sessionId}`]}>
        <Routes>
          <Route path="/results/:sessionId" element={<ResultsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Export PDF/i)).toBeDefined();
    });

    const exportBtn = screen.getByRole('button', { name: /Export PDF/i });
    exportBtn.click();

    expect(spy).toHaveBeenCalledWith(mockSnapshot);
    spy.mockRestore();
  });
});
