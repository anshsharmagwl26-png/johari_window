import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/common/Button';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/common/Card';
import {
  LayoutGrid,
  Users,
  Shield,
  Eye,
  EyeOff,
  HelpCircle,
  Sparkles,
  ArrowRight,
  KeyRound,
  CheckCircle2,
} from 'lucide-react';

export const HomePage: React.FC = () => {
  return (
    <div className="space-y-16 pb-16">
      {/* Hero Section */}
      <section className="relative pt-12 md:pt-20 text-center max-w-4xl mx-auto px-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold uppercase tracking-wider mb-6">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Interpersonal Discovery Framework</span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.15]">
          Discover your strengths and{' '}
          <span className="text-indigo-600 underline decoration-indigo-200 decoration-wavy decoration-2">
            blind spots
          </span>{' '}
          together.
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
          A collaborative Johari Window assessment. Choose adjectives describing yourself, invite teammates with private single-use tokens, and reveal your 4-quadrant window.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/create" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto gap-2 shadow-md">
              <span>Create Assessment</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </Link>

          <Link to="/join" className="w-full sm:w-auto">
            <Button variant="outline" size="lg" className="w-full sm:w-auto gap-2">
              <KeyRound className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <span>Join with Token</span>
            </Button>
          </Link>
        </div>

        {/* Core Principles Pill Grid */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3 text-left">
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white/70 flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-700">256-Bit One-Time Tokens</span>
          </div>
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white/70 flex items-center gap-2.5">
            <Users className="w-4 h-4 text-indigo-600 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-700">5–7 Adjectives per Person</span>
          </div>
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white/70 flex items-center gap-2.5">
            <LayoutGrid className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-700">Exact 55-Word Canonical Bank</span>
          </div>
          <div className="p-3.5 rounded-xl border border-slate-200 bg-white/70 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="text-xs font-semibold text-slate-700">Database Set Math Parity</span>
          </div>
        </div>
      </section>

      {/* The 4 Quadrants Explanation */}
      <section className="max-w-6xl mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            The Traditional Four Quadrants
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Formulated by Joseph Luft and Harrington Ingham (1955) to map self-awareness and team perception.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-indigo-100 bg-indigo-50/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-indigo-700 mb-1">
                <Eye className="w-5 h-5 stroke-[2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Top Left • Open Area</span>
              </div>
              <CardTitle className="text-base text-slate-900">Known to Self &amp; Known to Others</CardTitle>
              <CardDescription>
                Adjectives chosen by both you and your peers. Represents public knowledge, open strengths, and shared awareness.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-amber-100 bg-amber-50/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-amber-700 mb-1">
                <HelpCircle className="w-5 h-5 stroke-[2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Top Right • Blind Area</span>
              </div>
              <CardTitle className="text-base text-slate-900">Unknown to Self &amp; Known to Others</CardTitle>
              <CardDescription>
                Traits teammates observe in you that you did not select for yourself. High-value insights for personal development.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-teal-100 bg-teal-50/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-teal-700 mb-1">
                <EyeOff className="w-5 h-5 stroke-[2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Bottom Left • Hidden Area</span>
              </div>
              <CardTitle className="text-base text-slate-900">Known to Self &amp; Unknown to Others</CardTitle>
              <CardDescription>
                Adjectives you selected that none of your invited peers selected. Represents private feelings or qualities kept concealed.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-slate-200 bg-slate-50/50">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 text-slate-700 mb-1">
                <LayoutGrid className="w-5 h-5 stroke-[2]" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider">Bottom Right • Unknown Area</span>
              </div>
              <CardTitle className="text-base text-slate-900">Unknown to Self &amp; Unknown to Others</CardTitle>
              <CardDescription>
                Adjectives from the 55-word bank chosen by neither you nor your peers. Latent capacities or unexplored attributes.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>
    </div>
  );
};
