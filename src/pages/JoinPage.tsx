import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/common/Card';
import { Input, Label } from '../components/common/FormControls';
import { Button } from '../components/common/Button';
import { KeyRound, ArrowRight, ShieldCheck, AlertCircle, Info } from 'lucide-react';

export const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const input = tokenInput.trim();
    if (!input) {
      setError('Please paste your full invitation URL or 256-bit token.');
      return;
    }

    let extractedToken = '';

    // Check if input is a URL
    if (input.startsWith('http://') || input.startsWith('https://') || input.includes('/invite#')) {
      // Reject if token is passed in query string or path
      if (input.includes('?') && (input.includes('token=') || input.includes('code='))) {
        setError('Security error: Invitation tokens are never accepted in query parameters. The token must be in the URL fragment (#<token>).');
        return;
      }

      try {
        // Find fragment
        const hashIndex = input.indexOf('#');
        if (hashIndex === -1) {
          setError('Invalid invitation link: No URL fragment (#<token>) found. Please check your invitation link.');
          return;
        }

        const candidateHash = input.substring(hashIndex + 1).trim();
        if (!/^[A-Za-z0-9_-]{43}$/.test(candidateHash)) {
          setError('Invalid token format in invitation link. 256-bit Base64URL token (exactly 43 characters) required.');
          return;
        }

        extractedToken = candidateHash;
      } catch {
        setError('Failed to parse the invitation URL. Please check the link and try again.');
        return;
      }
    } else {
      // Raw token entered
      // Explicitly reject short numeric/alphanumeric codes
      if (/^\d+$/.test(input) || input.length < 40) {
        setError('Short invitation codes are not supported for security reasons. Please enter a valid 256-bit Base64URL token (exactly 43 characters) or paste your complete invitation URL.');
        return;
      }

      if (!/^[A-Za-z0-9_-]{43}$/.test(input)) {
        setError('Invalid token format. 256-bit Base64URL token must be exactly 43 characters (A-Z, a-z, 0-9, _, -) without padding.');
        return;
      }

      extractedToken = input;
    }

    // Navigate to /invite with token in URL fragment
    window.location.href = `/invite#${extractedToken}`;
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-16 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-2xs">
          <KeyRound className="w-6 h-6 stroke-[2]" aria-hidden="true" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Join Johari Assessment
        </h1>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Paste your complete invitation link or your 256-bit participant token to access the assessment.
        </p>
      </div>

      <Card className="shadow-sm">
        <form onSubmit={handleJoin}>
          <CardHeader>
            <CardTitle className="text-base">Enter Participant Invitation</CardTitle>
            <CardDescription className="text-xs">
              No login required. Your token serves as your single-use participation credential.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="tokenInput" required>
                Invitation Link or Raw Token
              </Label>
              <Input
                id="tokenInput"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="https://.../invite#token or 43-character base64url token"
                className="font-mono text-xs"
                error={error || undefined}
                required
              />
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 text-xs text-slate-600 space-y-2">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Info className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                <span>Security &amp; Entropy Notice</span>
              </div>
              <p className="leading-relaxed">
                This application intentionally does not support short numeric codes. All invitations use 256-bit cryptographic tokens to guarantee link confidentiality and prevent unauthorized guessing.
              </p>
            </div>
          </CardContent>

          <CardFooter className="bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Direct fragment validation
            </span>
            <Button type="submit" variant="primary" size="md" className="gap-2">
              <span>Open Assessment</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
