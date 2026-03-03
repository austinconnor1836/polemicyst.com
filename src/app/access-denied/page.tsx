'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ShieldX } from 'lucide-react';

export default function AccessDeniedPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="p-8 text-center space-y-4">
          <ShieldX className="mx-auto h-16 w-16 text-destructive" />
          <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
          <p className="text-muted">
            You do not have access to this site. This application is restricted to authorized users
            only.
          </p>
          <Button
            variant="outline"
            onClick={() => signOut({ callbackUrl: '/auth/signin' })}
            className="w-full"
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
