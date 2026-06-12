'use client';
import { useEffect, useRef } from 'react';
import { Provider } from 'react-redux';
import { useSession } from 'next-auth/react';
import { makeStore, AppStore } from '../lib/store';
import { identifyClientPostHog, initClientPostHog } from '../lib/posthog-client';

// PostHog bootstrap: gated on cookie consent + NEXT_PUBLIC_POSTHOG_KEY env var.
// Both checks live inside `initClientPostHog`/`identifyClientPostHog` so this
// hook is a no-op in dev/test or before the user accepts cookies.
function PostHogBootstrap() {
  // `StoreProvider` mounts ABOVE `SessionProviderWrapper`, so during the
  // static `_not-found` prerender (which doesn't include the SessionProvider
  // in its tree) `useSession` returns undefined. Default to a safe shape so
  // we don't crash the build.
  const sessionResult = useSession() as
    | { data: { user?: { id?: string } } | null; status: string }
    | undefined;
  const session = sessionResult?.data ?? null;
  const status = sessionResult?.status ?? 'unauthenticated';
  const lastIdentifiedRef = useRef<string | null>(null);

  // Try to initialize on mount and whenever the consent state may have
  // changed (storage event from the cookie banner click in another tab, or a
  // window focus after dismissing the banner in the same tab).
  useEffect(() => {
    void initClientPostHog();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'clipfire-cookie-consent') void initClientPostHog();
    };
    const onFocus = () => void initClientPostHog();
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Identify the user once we know who they are.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId || lastIdentifiedRef.current === userId) return;
    lastIdentifiedRef.current = userId;
    void identifyClientPostHog(userId);
  }, [session, status]);

  return null;
}

export default function StoreProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<AppStore>();
  if (!storeRef.current) {
    // Create the store instance the first time this renders
    storeRef.current = makeStore();
  }

  return (
    <Provider store={storeRef.current}>
      <PostHogBootstrap />
      {children}
    </Provider>
  );
}
