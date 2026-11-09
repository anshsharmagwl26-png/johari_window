import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

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
    if (!isSupabaseConfigured || !supabase) {
      return { session: null, error: new Error('Supabase client is not configured. Please check environment variables.') };
    }

    try {
      // 1. Check existing session in storage/memory
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession?.user) {
        setSession(existingSession);
        setUser(existingSession.user);
        return { session: existingSession, error: null };
      }

      // 2. Sign in anonymously
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        return { session: null, error: new Error(error.message) };
      }

      if (data?.session) {
        setSession(data.session);
        setUser(data.session.user);
        return { session: data.session, error: null };
      }

      return { session: null, error: new Error('Failed to obtain anonymous session.') };
    } catch (err) {
      return { session: null, error: err as Error };
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    // 1. Inspect existing session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (currentSession?.user) {
        setSession(currentSession);
        setUser(currentSession.user);
        setLoading(false);
      } else {
        const client = supabase;
        if (client) {
          client.auth.signInAnonymously().then(({ data, error }) => {
            if (data?.session) {
              setSession(data.session);
              setUser(data.session.user);
            }
            if (error) {
              console.warn('Anonymous sign-in could not be established on mount:', error.message);
            }
            setLoading(false);
          }).catch(() => {
            setLoading(false);
          });
        } else {
          setLoading(false);
        }
      }
    });

    // 2. Listen to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
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
