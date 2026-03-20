'use client';

import React, { useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ncaaData from './data.json';

interface RoundData {
  round: string;
  wins: number;
  losses: number;
  total_games: number;
  win_percentage: number;
  reach_percentage: number;
}

interface UpsetData {
  year: number;
  winner: string;
  winner_seed: number;
  loser: string;
  score: string;
  round: string;
}

interface ChampionData {
  year: number;
  team: string;
}

interface SourceData {
  name: string;
  url: string;
  description: string;
}

interface SeedComparison {
  seed: number;
  r64_win_pct: number;
  sweet16_reach_pct: number;
  final4_reach_pct: number;
  championships: number;
}

interface UpsetMatchup {
  matchup: string;
  favoredSeed: number;
  underdogSeed: number;
  totalUpsets: number;
  totalGames: number;
  upsetPct: number;
  avgPerYear: number;
}

interface UpsetByRound {
  round: string;
  totalUpsets: number;
  avgPerYear: number;
  gamesPerYear: number;
  upsetRate: number;
}

interface UpsetAverages {
  totalTournaments: number;
  dataRange: string;
  firstRoundByMatchup: UpsetMatchup[];
  byRound: UpsetByRound[];
  totalAllRounds: number;
  avgAllRoundsPerYear: number;
}

interface SeedFocus {
  seed: number;
  total_tournaments: number;
  total_teams: number;
  rounds: RoundData[];
  notable_upsets: UpsetData[];
  upset_context: 'wins' | 'losses';
  championships: ChampionData[];
  opponent_seed: number;
  data_range: string;
  note: string;
}

interface NcaaDataset {
  seeds: Record<string, SeedFocus>;
  allSeedsComparison: SeedComparison[];
  upsetAverages: UpsetAverages;
  sources: SourceData[];
}

const dataset = ncaaData as NcaaDataset;

function BarChart({
  data,
  valueKey,
  label,
  color,
}: {
  data: RoundData[];
  valueKey: 'win_percentage' | 'reach_percentage';
  label: string;
  color: string;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">{label}</h3>
      <div className="space-y-3">
        {data.map((round) => {
          const value = round[valueKey];
          return (
            <div key={`${valueKey}-${round.round}`} className="flex items-center gap-3">
              <span className="w-28 text-sm text-right dark:text-zinc-400 text-zinc-600 shrink-0">
                {round.round}
              </span>
              <div className="flex-1 h-8 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                <div
                  className="h-full rounded transition-all duration-700 ease-out"
                  style={{
                    width: `${value}%`,
                    backgroundColor: color,
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-medium dark:text-zinc-100 text-zinc-800">
                  {value}%{valueKey === 'win_percentage' && ` (${round.wins}-${round.losses})`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeedComparisonTable({ data, focusSeed }: { data: SeedComparison[]; focusSeed: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b dark:border-zinc-700 border-zinc-300">
            <th className="py-2 px-3 text-left dark:text-zinc-300 text-zinc-700">Seed</th>
            <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">R64 Win %</th>
            <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">Sweet 16 %</th>
            <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">Final Four %</th>
            <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">Titles</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={row.seed}
              className={`border-b dark:border-zinc-800 border-zinc-200 ${
                row.seed === focusSeed ? 'bg-orange-100 dark:bg-orange-900/30 font-semibold' : ''
              }`}
            >
              <td className="py-2 px-3 dark:text-zinc-300 text-zinc-700">#{row.seed}</td>
              <td className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                {row.r64_win_pct}%
              </td>
              <td className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                {row.sweet16_reach_pct}%
              </td>
              <td className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                {row.final4_reach_pct}%
              </td>
              <td className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                {row.championships}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function NcaaSeedProbabilityPage() {
  const [selectedSeed, setSelectedSeed] = useState<string>('1');

  const seedFocus = useMemo(() => dataset.seeds[selectedSeed], [selectedSeed]);
  const { allSeedsComparison, upsetAverages, sources } = dataset;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
        <h1 className="text-3xl md:text-4xl font-bold dark:text-zinc-100 text-zinc-900">
          NCAA Tournament Seed Analysis
        </h1>
        <div className="w-48 shrink-0">
          <Select value={selectedSeed} onValueChange={setSelectedSeed}>
            <SelectTrigger>
              <SelectValue placeholder="Select seed" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 16 }, (_, i) => i + 1).map((seed) => (
                <SelectItem key={seed} value={String(seed)}>
                  #{seed} Seed
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-8">
        Historical data from {seedFocus.data_range} &middot; {seedFocus.total_tournaments}{' '}
        tournaments &middot; {seedFocus.total_teams} total {seedFocus.seed}-seeds
      </p>

      {/* Key Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {seedFocus.rounds.slice(0, 4).map((round) => (
          <div
            key={round.round}
            className="p-4 rounded-lg dark:bg-zinc-800 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200"
          >
            <div className="text-2xl font-bold dark:text-orange-400 text-orange-600">
              {round.win_percentage}%
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
              {round.round} win rate
            </div>
            <div className="text-xs dark:text-zinc-500 text-zinc-400 mt-0.5">
              {round.wins}-{round.losses}
            </div>
          </div>
        ))}
      </div>

      {/* Win Percentage by Round */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <BarChart
          data={seedFocus.rounds}
          valueKey="win_percentage"
          label="Win Percentage by Round"
          color="#f97316"
        />
      </div>

      {/* Probability of Reaching Each Round */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <BarChart
          data={seedFocus.rounds}
          valueKey="reach_percentage"
          label="Probability of Reaching Each Round"
          color="#3b82f6"
        />
      </div>

      {/* National Champions */}
      {seedFocus.championships.length > 0 && (
        <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
          <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">
            {getOrdinalSuffix(seedFocus.seed)} Seed National Champions
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {seedFocus.championships.map((champ: ChampionData) => (
              <div
                key={champ.year}
                className="flex items-center gap-2 p-3 rounded dark:bg-zinc-700/50 bg-zinc-100"
              >
                <span className="font-bold dark:text-orange-400 text-orange-600">{champ.year}</span>
                <span className="dark:text-zinc-300 text-zinc-700">{champ.team}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notable Upsets */}
      {seedFocus.notable_upsets.length > 0 && (
        <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
          <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">
            {seedFocus.upset_context === 'wins'
              ? `Notable ${seedFocus.seed}-over-${seedFocus.opponent_seed} Upset Wins`
              : `Notable ${seedFocus.opponent_seed}-over-${seedFocus.seed} Upsets`}
          </h3>
          <div className="space-y-2">
            {seedFocus.notable_upsets.map((upset: UpsetData, i: number) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded dark:bg-zinc-700/50 bg-zinc-100 text-sm"
              >
                <span className="font-bold dark:text-zinc-300 text-zinc-700">{upset.year}</span>
                <span className="dark:text-zinc-300 text-zinc-700">
                  #{upset.winner_seed} {upset.winner} def. #
                  {seedFocus.upset_context === 'wins' ? seedFocus.opponent_seed : seedFocus.seed}{' '}
                  {upset.loser}
                </span>
                <span className="dark:text-zinc-500 text-zinc-400">{upset.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upset Averages Per Tournament */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <h3 className="text-lg font-semibold mb-2 dark:text-zinc-200 text-zinc-800">
          Average Upsets Per Tournament
        </h3>
        <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-6">
          An upset = lower-seeded team defeating the higher-seeded team. Round of 64 uses fixed
          bracket matchups. Later rounds count wins by seeds 9–16.
        </p>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="p-4 rounded-lg dark:bg-zinc-700/50 bg-zinc-100 text-center">
            <div className="text-2xl font-bold dark:text-orange-400 text-orange-600">
              {upsetAverages.byRound[0].avgPerYear}
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">Avg R64 upsets/year</div>
          </div>
          <div className="p-4 rounded-lg dark:bg-zinc-700/50 bg-zinc-100 text-center">
            <div className="text-2xl font-bold dark:text-blue-400 text-blue-600">
              {upsetAverages.avgAllRoundsPerYear}
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
              Avg total upsets/year
            </div>
          </div>
          <div className="p-4 rounded-lg dark:bg-zinc-700/50 bg-zinc-100 text-center">
            <div className="text-2xl font-bold dark:text-emerald-400 text-emerald-600">
              {upsetAverages.totalAllRounds}
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
              Total upsets ({upsetAverages.dataRange})
            </div>
          </div>
        </div>

        {/* Upsets by Round */}
        <div className="mb-8">
          <h4 className="text-sm font-semibold mb-3 dark:text-zinc-300 text-zinc-700">
            Upsets by Round
          </h4>
          <div className="space-y-3">
            {upsetAverages.byRound.map((round) => {
              const maxAvg = upsetAverages.byRound[0].avgPerYear;
              const barWidth = maxAvg > 0 ? (round.avgPerYear / maxAvg) * 100 : 0;
              return (
                <div key={round.round} className="flex items-center gap-3">
                  <span className="w-28 text-sm text-right dark:text-zinc-400 text-zinc-600 shrink-0">
                    {round.round}
                  </span>
                  <div className="flex-1 h-8 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                    <div
                      className="h-full rounded transition-all duration-700 ease-out"
                      style={{
                        width: `${Math.max(barWidth, 2)}%`,
                        backgroundColor: '#ef4444',
                      }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-medium dark:text-zinc-100 text-zinc-800">
                      {round.avgPerYear}/yr ({round.totalUpsets} total &middot; {round.upsetRate}%
                      upset rate)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* First Round Breakdown by Matchup */}
        <div>
          <h4 className="text-sm font-semibold mb-3 dark:text-zinc-300 text-zinc-700">
            Round of 64 — Upset Rate by Matchup
          </h4>
          <div className="space-y-2">
            {upsetAverages.firstRoundByMatchup.map((m) => (
              <div key={m.matchup} className="flex items-center gap-3">
                <span className="w-28 text-sm text-right dark:text-zinc-400 text-zinc-600 shrink-0">
                  {m.matchup}
                </span>
                <div className="flex-1 h-7 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                  <div
                    className="h-full rounded transition-all duration-700 ease-out"
                    style={{
                      width: `${Math.max(m.upsetPct, 1)}%`,
                      backgroundColor: m.upsetPct >= 30 ? '#f97316' : '#ef4444',
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium dark:text-zinc-100 text-zinc-800">
                    {m.upsetPct}% &middot; {m.totalUpsets} upsets &middot; {m.avgPerYear}/yr
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs dark:text-zinc-500 text-zinc-400 mt-3">
            Each matchup has {upsetAverages.firstRoundByMatchup[0]?.totalGames} total games across{' '}
            {upsetAverages.totalTournaments} tournaments. 8 vs 9 games are near-coinflip matchups.
          </p>
        </div>
      </div>

      {/* All Seeds Comparison */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">
          All Seeds Comparison
        </h3>
        <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-4">
          {seedFocus.seed}-seed row highlighted. &quot;Sweet 16 %&quot; and &quot;Final Four %&quot;
          show the probability of reaching that round.
        </p>
        <SeedComparisonTable data={allSeedsComparison} focusSeed={seedFocus.seed} />
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="mb-6 p-4 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
          <h4 className="text-sm font-semibold mb-2 dark:text-zinc-300 text-zinc-700">
            Data Sources
          </h4>
          <ul className="space-y-1">
            {sources.map((source: SourceData) => (
              <li key={source.name} className="text-xs dark:text-zinc-400 text-zinc-500">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dark:text-blue-400 text-blue-600 hover:underline"
                >
                  {source.name}
                </a>
                {' — '}
                {source.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Data Note */}
      <p className="text-xs dark:text-zinc-500 text-zinc-400 text-center">{seedFocus.note}</p>
    </div>
  );
}
