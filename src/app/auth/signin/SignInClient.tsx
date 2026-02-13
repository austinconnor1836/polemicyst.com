'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SignIn = () => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/clips-genie';
  const provider = searchParams.get('provider');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBlueskyLogin = async () => {
    setLoading(true);
    setError(null);

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

  return (
    <Suspense fallback={<div className="text-center mt-10">Loading sign-in...</div>}>
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 glass:bg-transparent">
        <Card className="w-96 shadow-lg">
          <CardContent className="p-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-4">
              Sign in
            </h1>

            {/* Show OAuth buttons if no provider is selected */}
            {!provider && (
              <div className="flex flex-col space-y-3">
                <Button
                  onClick={() => signIn('google', { callbackUrl })}
                  className="bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white dark:hover:bg-red-600"
                >
                  Sign in with Google
                </Button>
                <Button
                  onClick={() => signIn('facebook', { callbackUrl })}
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
                  <Button onClick={handleBlueskyLogin} disabled={loading} className="w-full">
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
