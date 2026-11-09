import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

import { getOrInitOwnerSession } from '../lib/session-service';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  ensureAnonymousSession: () => Promise<{ session: Session | null; error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: false,
  isConfigured: isSupabaseConfigured,
  ensureAnonymousSession: async () => ({ session: null, error: new Error('Auth not configured') }),
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Silently ensures an authenticated session exists using Supabase Anonymous Auth
  const ensureAnonymousSession = useCallback(async (): Promise<{ session: Session | null; error: Error | null }> => {
    try {
      await getOrInitOwnerSession();
      if (supabase) {
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        if (existingSession) {
          setSession(existingSession);
          setUser(existingSession.user);
          return { session: existingSession, error: null };
        }
      }
      return { session: null, error: null };
    } catch (err) {
      return { session: null, error: err as Error };
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        await getOrInitOwnerSession();
        if (supabase) {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (isMounted && currentSession) {
            setSession(currentSession);
            setUser(currentSession.user);
          }
        }
      } catch (err) {
        console.warn('Anonymous session could not be established on mount:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    init();

    if (supabase) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, newSession) => {
        if (!isMounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }

    return () => {
      isMounted = false;
    };
  }, []);

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isConfigured: isSupabaseConfigured,
        ensureAnonymousSession,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
