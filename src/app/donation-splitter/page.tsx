'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DollarSign, Plus, Trash2, Lock, Unlock, RotateCcw, Users, PieChart } from 'lucide-react';

interface Candidate {
  id: string;
  name: string;
  /** Fixed dollar amount when locked; null means auto-split */
  lockedAmount: number | null;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

/** Distribute the budget among candidates, respecting locked amounts. */
function computeAllocations(budget: number, candidates: Candidate[]): Map<string, number> {
  const allocations = new Map<string, number>();
  if (candidates.length === 0) return allocations;

  let lockedTotal = 0;
  let unlockedCount = 0;

  for (const c of candidates) {
    if (c.lockedAmount !== null) {
      lockedTotal += c.lockedAmount;
    } else {
      unlockedCount++;
    }
  }

  const remaining = Math.max(0, budget - lockedTotal);
  const perUnlocked = unlockedCount > 0 ? Math.floor((remaining * 100) / unlockedCount) / 100 : 0;

  // Distribute rounding remainder to first unlocked candidate
  let rounding =
    unlockedCount > 0 ? Math.round((remaining - perUnlocked * unlockedCount) * 100) / 100 : 0;

  for (const c of candidates) {
    if (c.lockedAmount !== null) {
      allocations.set(c.id, c.lockedAmount);
    } else {
      const amount = Math.round((perUnlocked + rounding) * 100) / 100;
      allocations.set(c.id, amount);
      rounding = 0; // only first unlocked gets the remainder
    }
  }

  return allocations;
}

export default function DonationSplitterPage() {
  const [budget, setBudget] = useState<number>(100);
  const [budgetInput, setBudgetInput] = useState<string>('100');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [newName, setNewName] = useState('');

  const allocations = useMemo(() => computeAllocations(budget, candidates), [budget, candidates]);

  const lockedTotal = useMemo(
    () => candidates.reduce((sum, c) => sum + (c.lockedAmount ?? 0), 0),
    [candidates]
  );

  const totalAllocated = useMemo(
    () => Array.from(allocations.values()).reduce((s, v) => s + v, 0),
    [allocations]
  );

  const handleBudgetChange = useCallback((raw: string) => {
    setBudgetInput(raw);
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0) {
      setBudget(Math.round(parsed * 100) / 100);
    }
  }, []);

  const addCandidate = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCandidates((prev) => [...prev, { id: generateId(), name: trimmed, lockedAmount: null }]);
    setNewName('');
  }, [newName]);

  const removeCandidate = useCallback((id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const toggleLock = useCallback(
    (id: string) => {
      setCandidates((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          if (c.lockedAmount !== null) {
            // Unlock — go back to auto-split
            return { ...c, lockedAmount: null };
          }
          // Lock at current computed allocation
          const currentAmount = allocations.get(c.id) ?? 0;
          return { ...c, lockedAmount: currentAmount };
        })
      );
    },
    [allocations]
  );

  const updateLockedAmount = useCallback(
    (id: string, raw: string) => {
      const parsed = parseFloat(raw);
      if (isNaN(parsed) || parsed < 0) return;
      const clamped = Math.min(Math.round(parsed * 100) / 100, budget);
      setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, lockedAmount: clamped } : c)));
    },
    [budget]
  );

  const resetAll = useCallback(() => {
    setCandidates([]);
    setBudget(100);
    setBudgetInput('100');
    setNewName('');
  }, []);

  const overBudget = lockedTotal > budget;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Donation Splitter</h1>
        <p className="mt-2 text-muted">
          Set a monthly budget and divide it among the candidates you support. Lock any candidate to
          a custom amount — unlocked candidates share the remainder equally.
        </p>
      </div>

      {/* Budget card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-emerald-500" />
            Monthly Budget
          </CardTitle>
          <CardDescription>Total amount you want to donate each month</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">$</span>
            <Input
              type="number"
              min={0}
              step={1}
              value={budgetInput}
              onChange={(e) => handleBudgetChange(e.target.value)}
              className="max-w-[180px] text-lg"
            />
            <span className="text-sm text-muted">/ month</span>
          </div>
        </CardContent>
      </Card>

      {/* Add candidate */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            Candidates
          </CardTitle>
          <CardDescription>Add the people you want to support</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addCandidate();
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Candidate name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!newName.trim()}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Candidate list */}
      {candidates.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-violet-500" />
              Allocation
            </CardTitle>
            <CardDescription>
              {overBudget ? (
                <span className="text-destructive font-medium">
                  Locked amounts exceed your budget by {formatCurrency(lockedTotal - budget)}
                </span>
              ) : (
                <>
                  {formatCurrency(totalAllocated)} of {formatCurrency(budget)} allocated
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidates.map((candidate) => {
              const amount = allocations.get(candidate.id) ?? 0;
              const pct = budget > 0 ? Math.round((amount / budget) * 100) : 0;
              const isLocked = candidate.lockedAmount !== null;

              return (
                <div
                  key={candidate.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  {/* Candidate name */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{candidate.name}</p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Amount display / edit */}
                  <div className="flex items-center gap-1.5">
                    {isLocked ? (
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted">$</span>
                        <Input
                          type="number"
                          min={0}
                          max={budget}
                          step={1}
                          value={candidate.lockedAmount ?? 0}
                          onChange={(e) => updateLockedAmount(candidate.id, e.target.value)}
                          className="h-8 w-24 text-sm"
                        />
                      </div>
                    ) : (
                      <span className="w-24 text-right text-sm font-medium tabular-nums">
                        {formatCurrency(amount)}
                      </span>
                    )}
                    <span className="w-10 text-right text-xs text-muted tabular-nums">{pct}%</span>
                  </div>

                  {/* Lock / unlock */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => toggleLock(candidate.id)}
                    title={isLocked ? 'Unlock (auto-split)' : 'Lock amount'}
                  >
                    {isLocked ? (
                      <Lock className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Unlock className="h-4 w-4 text-muted" />
                    )}
                  </Button>

                  {/* Remove */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeCandidate(candidate.id)}
                    title="Remove candidate"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Summary + reset */}
      {candidates.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">
            {candidates.length} candidate{candidates.length !== 1 && 's'} &middot;{' '}
            {formatCurrency(totalAllocated)} allocated
          </div>
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      )}

      {/* Empty state */}
      {candidates.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-muted">
          <Users className="mx-auto mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">No candidates yet</p>
          <p className="mt-1 text-sm">Add candidates above to start splitting your donation.</p>
        </div>
      )}
    </div>
  );
}
