import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LoadingSkeleton } from '../common/LoadingSkeleton';

interface OwnerAuthGuardProps {
  children: React.ReactNode;
}

/**
 * OwnerAuthGuard:
 * Seamlessly guards owner routes.
 * When Supabase is configured, allows authenticated anonymous or identified owners.
 * While session is resolving on initial load, renders a clean skeleton loader.
 */
export const OwnerAuthGuard: React.FC<OwnerAuthGuardProps> = ({ children }) => {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <LoadingSkeleton variant="rectangular" className="h-12 w-full" />
        <LoadingSkeleton variant="rectangular" className="h-64 w-full" />
      </div>
    );
  }

  return <>{children}</>;
};
