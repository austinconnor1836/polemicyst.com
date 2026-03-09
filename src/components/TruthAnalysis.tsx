'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type Assertion = {
  id: number;
  text: string;
  category: 'claim' | 'assumption' | 'opinion' | 'factual';
  confidence: number;
  factCheckNeeded: boolean;
  factCheckReason?: string;
};

type Fallacy = {
  id: number;
  name: string;
  description: string;
  assertionIds: number[];
  severity: 'minor' | 'moderate' | 'major';
  confidence: number;
};

type Bias = {
  id: number;
  type: string;
  description: string;
  direction?: string;
  evidence: string;
  confidence: number;
};

type AnalysisResult = {
  summary: string;
  assertions: Assertion[];
  fallacies: Fallacy[];
  biases: Bias[];
  overallCredibility: number;
  overallBiasLevel: 'low' | 'moderate' | 'high';
  keyAssumptions: string[];
  recommendedFactChecks: string[];
};

interface TruthAnalysisProps {
  feedVideoId: string;
  clipId?: string;
}

const CATEGORY_STYLES: Record<string, string> = {
  factual: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  opinion: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  assumption: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  claim: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
};

const SEVERITY_STYLES: Record<string, string> = {
  minor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  moderate: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  major: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

const BIAS_LEVEL_STYLES: Record<string, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  moderate: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  high: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-md border">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {title} <span className="text-muted-foreground">({count})</span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && <div className="border-t px-3 py-2">{children}</div>}
    </div>
  );
}

const ANALYSIS_STEPS = [
  'Sending transcript to AI…',
  'Extracting assertions and claims…',
  'Checking for logical fallacies…',
  'Analyzing bias indicators…',
  'Evaluating overall credibility…',
  'Compiling results…',
];

function AnalysisLoadingCard() {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, ANALYSIS_STEPS.length - 1)), 8000);
    return () => clearInterval(id);
  }, []);

  const timeLabel =
    elapsed < 10
      ? 'This usually takes 30–60 seconds'
      : `Elapsed: ${elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ` : ''}${elapsed % 60}s — still working`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Verify with AI</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="transition-opacity duration-300">{ANALYSIS_STEPS[step]}</span>
        </div>
        <div className="flex gap-1">
          {ANALYSIS_STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                i <= step ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{timeLabel}</p>
      </CardContent>
    </Card>
  );
}

export default function TruthAnalysis({ feedVideoId, clipId }: TruthAnalysisProps) {
  const router = useRouter();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<'gemini' | 'ollama'>('gemini');

  // Try to load existing analysis on mount
  useEffect(() => {
    let cancelled = false;
    const fetchExisting = async () => {
      try {
        const qs = clipId ? `?clipId=${clipId}` : '';
        const res = await fetch(`/api/feedVideos/${feedVideoId}/truth-analysis${qs}`);
        if (res.ok) {
          const data = await res.json();
          const analysisResult = data.result ?? data;
          if (!cancelled && analysisResult?.summary) {
            setResult(analysisResult);
            setStatus('done');
          }
        }
      } catch {
        // No existing analysis — that's fine
      }
    };
    fetchExisting();
    return () => {
      cancelled = true;
    };
  }, [feedVideoId, clipId]);

  const runAnalysis = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/truth-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }
      setResult(data.result);
      setStatus('done');
    } catch (err: any) {
      setError(err.message || 'Failed to run analysis');
      setStatus('error');
    }
  }, [feedVideoId, clipId, provider]);

  const handleRerun = useCallback(() => {
    setResult(null);
    setStatus('idle');
    setError(null);
  }, []);

  // Empty state — show analyze button
  if (status === 'idle' || status === 'error') {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Verify with AI</CardTitle>
          </div>
          <CardDescription>
            Analyze the transcript for assertions, logical fallacies, bias, and fact-checking needs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Select value={provider} onValueChange={(v) => setProvider(v as 'gemini' | 'ollama')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={runAnalysis} size="sm">
              <Sparkles className="mr-2 h-4 w-4" />
              Analyze
            </Button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (status === 'loading') {
    return <AnalysisLoadingCard />;
  }

  // Results state
  if (!result) return null;

  const credColor =
    result.overallCredibility >= 7
      ? 'text-green-600 dark:text-green-400'
      : result.overallCredibility >= 4
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Verify with AI</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={BIAS_LEVEL_STYLES[result.overallBiasLevel] || ''}>
              Bias: {result.overallBiasLevel}
            </Badge>
            <Badge variant="outline" className={credColor}>
              Credibility: {result.overallCredibility}/10
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary */}
        <p className="text-sm leading-relaxed text-muted-foreground">{result.summary}</p>

        {/* Assertions */}
        {result.assertions.length > 0 && (
          <CollapsibleSection title="Assertions" count={result.assertions.length} defaultOpen>
            <div className="space-y-2">
              {result.assertions.map((a) => (
                <div key={a.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-start gap-2">
                    <Badge
                      className={cn('mt-0.5 shrink-0 text-xs', CATEGORY_STYLES[a.category] || '')}
                    >
                      {a.category}
                    </Badge>
                    <span className="leading-relaxed">{a.text}</span>
                  </div>
                  {a.factCheckNeeded && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {a.factCheckReason || 'Needs fact-checking'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Key Assumptions */}
        {result.keyAssumptions.length > 0 && (
          <CollapsibleSection title="Key Assumptions" count={result.keyAssumptions.length}>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              {result.keyAssumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </CollapsibleSection>
        )}

        {/* Logical Fallacies */}
        {result.fallacies.length > 0 && (
          <CollapsibleSection title="Logical Fallacies" count={result.fallacies.length}>
            <div className="space-y-2">
              {result.fallacies.map((f) => (
                <div key={f.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className={cn('text-xs', SEVERITY_STYLES[f.severity] || '')}>
                      {f.severity}
                    </Badge>
                    <span className="font-medium">{f.name}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{f.description}</p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Bias Indicators */}
        {result.biases.length > 0 && (
          <CollapsibleSection title="Bias Indicators" count={result.biases.length}>
            <div className="space-y-2">
              {result.biases.map((b) => (
                <div key={b.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.type}</span>
                    {b.direction && (
                      <Badge variant="outline" className="text-xs">
                        {b.direction}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-muted-foreground">{b.description}</p>
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    Evidence: {b.evidence}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Recommended Fact Checks */}
        {result.recommendedFactChecks.length > 0 && (
          <CollapsibleSection
            title="Recommended Fact Checks"
            count={result.recommendedFactChecks.length}
          >
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              {result.recommendedFactChecks.map((fc, i) => (
                <li key={i}>{fc}</li>
              ))}
            </ol>
          </CollapsibleSection>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={handleRerun} className="text-xs">
            <RefreshCw className="mr-1 h-3 w-3" />
            Re-run analysis
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/details/${feedVideoId}/chat`)}
            className="text-xs"
          >
            <MessageSquare className="mr-1 h-3 w-3" />
            Chat about this
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
