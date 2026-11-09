import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { OwnerAuthGuard } from '../components/auth/OwnerAuthGuard';

import { HomePage } from '../pages/HomePage';
import { CreateSessionPage } from '../pages/CreateSessionPage';
import { InviteEntryPage } from '../pages/InviteEntryPage';
import { JoinPage } from '../pages/JoinPage';

describe('Route Skeletons & Auth Guard Behavior', () => {
  it('renders HomePage on public root route without requiring authentication', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(screen.getByText(/Discover your strengths/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Create Assessment/i })).toBeDefined();
  });

  it('renders JoinPage for token entry without requiring authentication', () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/join']}>
          <Routes>
            <Route path="/join" element={<JoinPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(screen.getByText(/Join Johari Assessment/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/43-character base64url token/i)).toBeDefined();
  });

  it('allows seamless access to CreateSessionPage via OwnerAuthGuard without login modal or stub banner', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/create']}>
          <Routes>
            <Route
              path="/create"
              element={
                <OwnerAuthGuard>
                  <CreateSessionPage />
                </OwnerAuthGuard>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    // Verify stub banner is NOT rendered
    expect(screen.queryByRole('alert', { name: /Owner Auth Guard Stub Notice/i })).toBeNull();
    expect(screen.queryByText(/\[Stage 1 Non-Functional Stub\]/i)).toBeNull();

    // Verify CreateSessionPage is rendered once anonymous session initializes
    const heading = await screen.findByText(/Create New Assessment/i);
    expect(heading).toBeDefined();
    expect(await screen.findByLabelText(/Subject Name \(You\)/i)).toBeDefined();
  });
});
