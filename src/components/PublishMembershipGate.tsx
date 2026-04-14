'use client';

import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PLANS, type PlanId } from '@/lib/plans';

const PLAN_ORDER: PlanId[] = ['free', 'pro', 'business'];

interface PublishMembershipGateProps {
  title?: string;
  description?: string;
  compact?: boolean;
}

export function PublishMembershipGate({
  title = 'Sign in to publish',
  description = 'Publishing is available to members. Pick a tier and continue to connected platform publishing.',
  compact = false,
}: PublishMembershipGateProps) {
  return (
    <div
      className={`space-y-4 rounded-lg border border-border bg-muted/30 ${compact ? 'p-3' : 'p-4'}`}
    >
      <div className="space-y-2">
        <Badge variant="secondary" className="inline-flex items-center gap-1">
          <Lock className="h-3 w-3" />
          Members only
        </Badge>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className={`grid gap-3 ${compact ? 'lg:grid-cols-3' : 'md:grid-cols-3'}`}>
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isPopular = planId === 'pro';
          return (
            <Card
              key={planId}
              className={isPopular ? 'border-blue-500 dark:border-blue-400' : undefined}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="text-2xl font-bold">
                  {plan.monthlyPriceDisplay}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
                </div>
              </CardHeader>
              <CardContent className="pb-3">
                <ul className="space-y-1.5">
                  {plan.features.slice(0, 3).map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-1.5 text-xs text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="pt-0">
                <Button variant={isPopular ? 'default' : 'outline'} className="w-full" asChild>
                  <Link href="/auth/signin">
                    {planId === 'free' ? 'Get Started' : `Choose ${plan.name}`}
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/auth/signin">Sign in to continue</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/pricing">Compare full pricing</Link>
        </Button>
      </div>
    </div>
  );
}
