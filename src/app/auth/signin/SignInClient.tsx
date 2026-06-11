'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const IS_DEV = process.env.NODE_ENV !== 'production';

const SignIn = () => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/connected-accounts';
  const provider = searchParams.get('provider');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // COPPA defense (W008): user must affirm 13+ before any sign-in path is enabled.
  // We persist consent in a short-lived cookie that the NextAuth signIn callback
  // reads when creating a new User row (existing users are grandfathered via `null`).
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  const stampAgeGateCookie = () => {
    // 10-minute cookie scoped to the sign-in round trip. The NextAuth signIn
    // callback consumes it and writes `acceptedAgeGate=true` for new users.
    document.cookie = `clipfire_age_gate=1; Max-Age=600; Path=/; SameSite=Lax`;
  };

  const handleBlueskyLogin = async () => {
    setLoading(true);
    setError(null);
    stampAgeGateCookie();

    const response = await signIn('credentials', {
      username: identifier,
      password,
      callbackUrl,
      redirect: true,
    });

    if (response?.error) {
      setError('Invalid Bluesky credentials.');
    }
  };

  const handleDevLogin = async () => {
    if (!devEmail.trim()) return;
    setLoading(true);
    setError(null);
    stampAgeGateCookie();

    const response = await signIn('dev', {
      email: devEmail.trim(),
      callbackUrl,
      redirect: true,
    });

    if (response?.error) {
      setError('Dev login failed.');
      setLoading(false);
    }
  };

  const handleOAuthLogin = (oauthProvider: 'google' | 'facebook') => {
    stampAgeGateCookie();
    signIn(oauthProvider, { callbackUrl });
  };

  return (
    <Suspense fallback={<div className="text-center mt-10">Loading sign-in...</div>}>
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 glass:bg-transparent">
        <Card className="w-96 shadow-lg">
          <CardContent className="p-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-4">
              Sign in
            </h1>

            {/* COPPA age gate — must be checked before any sign-in path is enabled. */}
            <label
              htmlFor="age-gate"
              className="mb-4 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <input
                id="age-gate"
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>I am 13 or older and agree to the terms of service.</span>
            </label>

            {/* Dev-only email login */}
            {IS_DEV && !provider && (
              <div className="mb-4 space-y-3">
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  Dev mode — sign in with any email, no OAuth needed
                </div>
                {error && <p className="text-sm text-red-500 text-center">{error}</p>}
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleDevLogin()}
                  />
                </div>
                <Button
                  onClick={handleDevLogin}
                  disabled={loading || !devEmail.trim() || !ageConfirmed}
                  className="w-full"
                >
                  {loading ? 'Signing in…' : 'Dev Sign In'}
                </Button>
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300 dark:border-gray-600" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-white px-2 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      or use a provider
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Show OAuth buttons if no provider is selected */}
            {!provider && (
              <div className="flex flex-col space-y-3">
                <Button
                  onClick={() => handleOAuthLogin('google')}
                  disabled={!ageConfirmed}
                  className="bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white dark:hover:bg-red-600"
                >
                  Sign in with Google
                </Button>
                <Button
                  onClick={() => handleOAuthLogin('facebook')}
                  disabled={!ageConfirmed}
                  className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-700"
                >
                  Sign in with Facebook
                </Button>
              </div>
            )}

            {/* Bluesky Login Form */}
            {provider === 'bluesky' && (
              <div className="mt-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-3">
                  Sign in with Bluesky
                </h2>
                {error && <p className="text-sm text-red-500 text-center">{error}</p>}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>Bluesky Identifier</Label>
                    <Input
                      type="text"
                      placeholder="handle.bsky.social"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>App Password</Label>
                    <Input
                      type="password"
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleBlueskyLogin}
                    disabled={loading || !ageConfirmed}
                    className="w-full"
                  >
                    {loading ? 'Connecting...' : 'Connect with Bluesky'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Suspense>
  );
};

export default SignIn;
