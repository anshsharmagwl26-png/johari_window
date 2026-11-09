import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/common/Navbar';
import { Footer } from './components/common/Footer';
import { OwnerAuthGuard } from './components/auth/OwnerAuthGuard';

import { HomePage } from './pages/HomePage';
import { CreateSessionPage } from './pages/CreateSessionPage';
import { SelfAssessmentPage } from './pages/SelfAssessmentPage';
import { InviteEntryPage } from './pages/InviteEntryPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResultsPage } from './pages/ResultsPage';
import { JoinPage } from './pages/JoinPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-slate-50/40 text-slate-900 font-sans antialiased selection:bg-indigo-500 selection:text-white">
          <Navbar />
          <main className="flex-1">
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<HomePage />} />
              <Route path="/invite" element={<InviteEntryPage />} />
              <Route path="/join" element={<JoinPage />} />

              {/* Protected Owner Routes */}
              <Route
                path="/create"
                element={
                  <OwnerAuthGuard>
                    <CreateSessionPage />
                  </OwnerAuthGuard>
                }
              />
              <Route
                path="/assessment/:sessionId"
                element={
                  <OwnerAuthGuard>
                    <SelfAssessmentPage />
                  </OwnerAuthGuard>
                }
              />
              <Route
                path="/dashboard/:sessionId"
                element={
                  <OwnerAuthGuard>
                    <DashboardPage />
                  </OwnerAuthGuard>
                }
              />
              <Route
                path="/results/:sessionId"
                element={
                  <OwnerAuthGuard>
                    <ResultsPage />
                  </OwnerAuthGuard>
                }
              />

              {/* 404 Route */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
