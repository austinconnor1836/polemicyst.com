'use client';

import Link from 'next/link';
import React from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  Zap,
  Rss,
  Scissors,
  Share2,
  BarChart3,
  Shield,
  ArrowRight,
  LayoutDashboard,
} from 'lucide-react';
import { PLANS, type PlanId } from '@/lib/plans';
import Particles from './_components/particles';

const PLAN_ORDER: PlanId[] = ['free', 'pro', 'business'];

const FEATURES = [
  {
    icon: Rss,
    title: 'Feed Monitoring',
    description:
      'Add YouTube channels, RSS feeds, or manual uploads. New videos are detected and queued automatically.',
  },
  {
    icon: Scissors,
    title: 'AI-Powered Clipping',
    description:
      'Our scoring engine analyzes transcripts, audio, and video frames to find the most viral-worthy moments.',
  },
  {
    icon: Share2,
    title: 'Multi-Platform Export',
    description:
      'Publish clips directly to YouTube Shorts, Instagram Reels, TikTok, Bluesky, and more.',
  },
  {
    icon: Zap,
    title: 'Auto-Generate',
    description:
      'Set it and forget it. Pro users get clips generated automatically whenever new videos appear in their feeds.',
  },
  {
    icon: BarChart3,
    title: 'Smart Scoring',
    description:
      'Council-style LLM scoring evaluates hook strength, context, captionability, and risk — tuned per platform.',
  },
  {
    icon: Shield,
    title: 'Content Safety',
    description:
      'Enable safer-clips mode to flag risky content and apply safety-aware thresholds before publishing.',
  },
];

const STEPS = [
  {
    number: '1',
    title: 'Add your sources',
    description: 'Connect YouTube channels, RSS feeds, or upload videos directly.',
  },
  {
    number: '2',
    title: 'AI finds the moments',
    description: 'Our engine scores every segment for virality, hook strength, and platform fit.',
  },
  {
    number: '3',
    title: 'Export everywhere',
    description: 'Review, trim, and publish clips to every major social platform in one click.',
  },
];

export default function Home() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';

  return (
    <div className="min-h-screen glass:bg-transparent">
      {/* Member dashboard banner */}
      {isAuthenticated && (
        <section className="border-b border-border bg-accent/5 px-4 py-6 glass:bg-white/5">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-3 text-center sm:text-left">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <LayoutDashboard className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-semibold">
                  Welcome back{session.user?.name ? `, ${session.user.name}` : ''}
                </p>
                <p className="text-sm text-muted">Pick up where you left off in your dashboard.</p>
              </div>
            </div>
            <Button size="lg" asChild>
              <Link href="/connected-accounts" className="gap-2">
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* Hero */}
      <section className="relative overflow-hidden px-4 py-24 sm:py-32 lg:py-40">
        <Particles
          className="absolute inset-0 -z-10 opacity-40 dark:opacity-60"
          quantity={60}
          staticity={80}
          ease={80}
        />

        <div className="mx-auto max-w-4xl text-center">
          <Badge variant="secondary" className="mb-6 text-xs tracking-wide uppercase">
            AI-Powered Clip Generation
          </Badge>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Turn long-form video into <span className="text-accent">viral clips</span> —
            automatically
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted sm:text-xl">
            Polemicyst monitors your video sources, finds the most share-worthy moments using AI
            scoring, and exports platform-ready clips in seconds.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {isAuthenticated ? (
              <Button size="lg" asChild>
                <Link href="/connected-accounts" className="gap-2">
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" asChild>
                <Link href="/auth/signin">Get Started Free</Link>
              </Button>
            )}
            <Button variant="outline" size="lg" asChild>
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border px-4 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted">
            Three steps from raw footage to viral-ready clips.
          </p>

          <div className="mt-14 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.number} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white text-lg font-bold">
                  {step.number}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border px-4 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to go viral
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted">
            From ingestion to publishing, the full pipeline is covered.
          </p>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="flex flex-col">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                    <feature.icon className="h-5 w-5 text-accent" />
                  </div>
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex-1">
                  <p className="text-sm text-muted">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing summary */}
      <section className="border-t border-border px-4 py-20 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted">
            Start free. Upgrade when you need more clips, feeds, or AI power.
          </p>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PLAN_ORDER.map((planId) => {
              const plan = PLANS[planId];
              const isPopular = planId === 'pro';

              return (
                <Card
                  key={planId}
                  className={`flex flex-col ${
                    isPopular
                      ? 'border-2 border-blue-500 dark:border-blue-400 relative glass:border-blue-400/40 glass:shadow-[0_0_30px_rgba(59,130,246,0.15)]'
                      : ''
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-blue-500 text-white dark:bg-blue-400">
                        Most Popular
                      </Badge>
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                    <div className="mt-4">
                      <span className="text-4xl font-bold">{plan.monthlyPriceDisplay}</span>
                      <span className="text-muted">/mo</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <ul className="space-y-3">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-500 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button variant={isPopular ? 'default' : 'outline'} className="w-full" asChild>
                      <Link
                        href={
                          isAuthenticated && planId === 'free'
                            ? '/feeds'
                            : planId === 'free'
                              ? '/auth/signin'
                              : '/pricing'
                        }
                      >
                        {isAuthenticated && planId === 'free'
                          ? 'Go to Dashboard'
                          : planId === 'free'
                            ? 'Get Started'
                            : `Choose ${plan.name}`}
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border px-4 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {isAuthenticated ? 'Your clips are waiting' : 'Ready to find your next viral moment?'}
          </h2>
          <p className="mt-4 text-lg text-muted">
            {isAuthenticated
              ? 'Head to your dashboard to manage your accounts and generate clips.'
              : 'Sign up for free and start generating clips in minutes.'}
          </p>
          <div className="mt-8">
            {isAuthenticated ? (
              <Button size="lg" asChild>
                <Link href="/connected-accounts" className="gap-2">
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" asChild>
                <Link href="/auth/signin">Get Started Free</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-muted">
            &copy; {new Date().getFullYear()} Polemicyst. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link
              href="/privacy-policy"
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms-of-service"
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
