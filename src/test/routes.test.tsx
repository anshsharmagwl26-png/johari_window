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

  it('visibly labels OwnerAuthGuard as a non-functional stub pending Stage 2 when Supabase is not configured', () => {
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

    // Verify explicit Stage 1 stub banner is visible
    expect(screen.getByRole('alert', { name: /Owner Auth Guard Stub Notice/i })).toBeDefined();
    expect(screen.getByText(/\[Stage 1 Non-Functional Stub\]/i)).toBeDefined();
    expect(
      screen.getByText(/Owner Authentication Pending Stage 2 Configuration/i)
    ).toBeDefined();

    // Verify that the page shell itself is accessible for structural layout verification
    expect(screen.getByText(/Create New Assessment/i)).toBeDefined();
    expect(screen.getByLabelText(/Subject Name \(You\)/i)).toBeDefined();
  });
});
