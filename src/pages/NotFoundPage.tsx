import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/common/Button';
import { HelpCircle, Home } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
      <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
        <HelpCircle className="w-8 h-8 stroke-[1.5]" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Page Not Found</h1>
      <p className="text-sm text-slate-600">
        The route you requested does not exist or may have been moved.
      </p>
      <Link to="/" className="inline-block pt-2">
        <Button variant="primary" size="md" className="gap-2">
          <Home className="w-4 h-4" />
          <span>Return Home</span>
        </Button>
      </Link>
    </div>
  );
};
