import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { authOptions } from '../../../auth';
import { isAdmin } from '@shared/lib/admin';

/**
 * Gate the living style guide behind admin-only access.
 * The design system is internal reference material — not part of the public app.
 */
export default async function DesignSystemLayout({ children }: { children: ReactNode }) {
  const session = (await getServerSession(authOptions)) as {
    user?: { email?: string | null };
  } | null;

  if (!isAdmin(session?.user?.email)) {
    redirect('/');
  }

  return <>{children}</>;
}
