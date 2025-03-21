"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

const SignIn = () => {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/clips-genie";
  const provider = searchParams.get("provider");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBlueskyLogin = async () => {
    setLoading(true);
    setError(null);

    const response = await signIn("credentials", {
      username: identifier,
      password,
      callbackUrl,
      redirect: true,
    });

    if (response?.error) {
      setError("Invalid Bluesky credentials.");
    }
  };

  return (
    <Suspense fallback={<div className="text-center mt-10">Loading sign-in...</div>}>
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 w-96">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-4">
          Sign in
        </h1>

        {/* Show OAuth buttons if no provider is selected */}
        {!provider && (
          <div className="flex flex-col space-y-3">
            <button
              onClick={() => signIn("google", { callbackUrl })}
              className="bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600 transition"
            >
              Sign in with Google
            </button>
            <button
              onClick={() => signIn("facebook", { callbackUrl })}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition"
            >
              Sign in with Facebook
            </button>
          </div>
        )}

        {/* Bluesky Login Form */}
        {provider === "bluesky" && (
          <div className="mt-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-3">
              Sign in with Bluesky
            </h2>
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Bluesky Identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="block w-80 mx-auto p-2 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <input
                type="password"
                placeholder="App Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-80 mx-auto p-2 border border-gray-300 dark:border-gray-700 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              />
              <button
                onClick={handleBlueskyLogin}
                disabled={loading}
                className="w-80 mx-auto bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition"
              >
                {loading ? "Connecting..." : "Connect with Bluesky"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </Suspense>
  );
};

export default SignIn;
