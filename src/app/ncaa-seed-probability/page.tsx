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
  const [selectedUpsetRound, setSelectedUpsetRound] = useState<'r64' | 'r32' | 'later'>('r64');

  const seedFocus = useMemo(() => dataset.seeds[selectedSeed], [selectedSeed]);
  const { allSeedsComparison, sources } = dataset;

  const upsetData = useMemo(() => {
    const seeds = dataset.seeds;
    const TOURNAMENTS = 39;

    const r64Pairs: [number, number][] = [
      [1, 16],
      [2, 15],
      [3, 14],
      [4, 13],
      [5, 12],
      [6, 11],
      [7, 10],
      [8, 9],
    ];

    const r64Matchups = r64Pairs.map(([higher, lower]) => {
      const r64Round = seeds[String(higher)].rounds.find(
        (r: RoundData) => r.round === 'Round of 64'
      )!;
      const upsets = r64Round.losses;
      return {
        higherSeed: higher,
        lowerSeed: lower,
        totalGames: r64Round.total_games,
        upsets,
        upsetPct: Number(((upsets / r64Round.total_games) * 100).toFixed(1)),
        avgPerTournament: Number((upsets / TOURNAMENTS).toFixed(2)),
      };
    });

    const r64TotalUpsets = r64Matchups.reduce((sum, m) => sum + m.upsets, 0);

    const r32Sections = [
      {
        topSeed: 1,
        bottomSeed: 16,
        opSeeds: '8/9',
        label: '1/16 vs 8/9',
        involvedSeeds: [1, 16, 8, 9],
        possibleMatchups: ['1 vs 8', '1 vs 9', '16 vs 8', '16 vs 9'],
      },
      {
        topSeed: 2,
        bottomSeed: 15,
        opSeeds: '7/10',
        label: '2/15 vs 7/10',
        involvedSeeds: [2, 15, 7, 10],
        possibleMatchups: ['2 vs 7', '2 vs 10', '15 vs 7', '15 vs 10'],
      },
      {
        topSeed: 3,
        bottomSeed: 14,
        opSeeds: '6/11',
        label: '3/14 vs 6/11',
        involvedSeeds: [3, 14, 6, 11],
        possibleMatchups: ['3 vs 6', '3 vs 11', '14 vs 6', '14 vs 11'],
      },
      {
        topSeed: 4,
        bottomSeed: 13,
        opSeeds: '5/12',
        label: '4/13 vs 5/12',
        involvedSeeds: [4, 13, 5, 12],
        possibleMatchups: ['4 vs 5', '4 vs 12', '13 vs 5', '13 vs 12'],
      },
    ].map((section) => {
      const topR32 = seeds[String(section.topSeed)].rounds.find(
        (r: RoundData) => r.round === 'Round of 32'
      )!;
      const bottomR32 = seeds[String(section.bottomSeed)].rounds.find(
        (r: RoundData) => r.round === 'Round of 32'
      )!;
      const upsets = topR32.losses + bottomR32.wins;
      const totalGames = 4 * TOURNAMENTS;
      return {
        ...section,
        totalGames,
        upsets,
        upsetPct: Number(((upsets / totalGames) * 100).toFixed(1)),
        avgPerTournament: Number((upsets / TOURNAMENTS).toFixed(2)),
      };
    });

    const r32TotalUpsets = r32Sections.reduce((sum, s) => sum + s.upsets, 0);

    const laterRounds = ['Sweet 16', 'Elite 8', 'Final Four', 'Championship'].flatMap(
      (roundName) => {
        return [1, 2]
          .map((seed) => {
            const roundData = seeds[String(seed)].rounds.find(
              (r: RoundData) => r.round === roundName
            );
            if (!roundData || roundData.total_games === 0) return null;
            return {
              round: roundName,
              seed,
              wins: roundData.wins,
              losses: roundData.losses,
              totalGames: roundData.total_games,
              lossRate: Number(((roundData.losses / roundData.total_games) * 100).toFixed(1)),
              avgLossesPerTournament: Number((roundData.losses / TOURNAMENTS).toFixed(2)),
            };
          })
          .filter(Boolean) as {
          round: string;
          seed: number;
          wins: number;
          losses: number;
          totalGames: number;
          lossRate: number;
          avgLossesPerTournament: number;
        }[];
      }
    );

    return {
      tournaments: TOURNAMENTS,
      r64: {
        matchups: r64Matchups,
        totalUpsets: r64TotalUpsets,
        avgPerTournament: Number((r64TotalUpsets / TOURNAMENTS).toFixed(1)),
      },
      r32: {
        sections: r32Sections,
        totalUpsets: r32TotalUpsets,
        avgPerTournament: Number((r32TotalUpsets / TOURNAMENTS).toFixed(1)),
      },
      later: laterRounds,
    };
  }, []);

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

      {/* Upset Averages by Round */}
      <div className="mb-10">
        <h2 className="text-2xl font-bold dark:text-zinc-100 text-zinc-900 mb-2">
          Upset Averages by Round
        </h2>
        <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-6">
          How often the lower seed wins each matchup across {upsetData.tournaments} tournaments
          (1985–2024). An &ldquo;upset&rdquo; = the higher-numbered seed wins.
        </p>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg dark:bg-zinc-800 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
            <div className="text-2xl font-bold dark:text-red-400 text-red-600">
              {upsetData.r64.avgPerTournament}
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
              R64 upsets / tournament
            </div>
            <div className="text-xs dark:text-zinc-500 text-zinc-400 mt-0.5">
              {upsetData.r64.totalUpsets} total
            </div>
          </div>
          <div className="p-4 rounded-lg dark:bg-zinc-800 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
            <div className="text-2xl font-bold dark:text-red-400 text-red-600">
              {upsetData.r32.avgPerTournament}
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
              R32 upsets / tournament
            </div>
            <div className="text-xs dark:text-zinc-500 text-zinc-400 mt-0.5">
              {upsetData.r32.totalUpsets} total
            </div>
          </div>
          <div className="p-4 rounded-lg dark:bg-zinc-800 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
            <div className="text-2xl font-bold dark:text-red-400 text-red-600">
              {(upsetData.r64.avgPerTournament + upsetData.r32.avgPerTournament).toFixed(1)}
            </div>
            <div className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">First weekend total</div>
            <div className="text-xs dark:text-zinc-500 text-zinc-400 mt-0.5">
              {upsetData.r64.totalUpsets + upsetData.r32.totalUpsets} total
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(
            [
              ['r64', 'Round of 64'],
              ['r32', 'Round of 32'],
              ['later', 'Sweet 16+'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSelectedUpsetRound(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedUpsetRound === key
                  ? 'bg-orange-500 text-white'
                  : 'dark:bg-zinc-700 bg-zinc-200 dark:text-zinc-300 text-zinc-700 hover:dark:bg-zinc-600 hover:bg-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Round of 64 */}
        {selectedUpsetRound === 'r64' && (
          <div className="p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
            <h3 className="text-lg font-semibold mb-1 dark:text-zinc-200 text-zinc-800">
              Round of 64 — Matchup Upset Rates
            </h3>
            <p className="text-xs dark:text-zinc-500 text-zinc-400 mb-4">
              Each matchup occurs 4× per tournament (once per region).{' '}
              {upsetData.r64.matchups[0].totalGames} total games each.
            </p>
            <div className="space-y-3">
              {upsetData.r64.matchups.map((m) => {
                const isSelected =
                  Number(selectedSeed) === m.higherSeed || Number(selectedSeed) === m.lowerSeed;
                return (
                  <div
                    key={`${m.higherSeed}-${m.lowerSeed}`}
                    className={`flex items-center gap-3 ${isSelected ? 'bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2 -mx-2' : ''}`}
                  >
                    <span className="w-20 text-sm text-right dark:text-zinc-300 text-zinc-700 shrink-0 font-medium">
                      #{m.higherSeed} vs #{m.lowerSeed}
                    </span>
                    <div className="flex-1 h-8 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                      <div
                        className="h-full rounded transition-all duration-700 ease-out"
                        style={{
                          width: `${m.upsetPct}%`,
                          backgroundColor: '#ef4444',
                        }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-sm font-medium dark:text-zinc-100 text-zinc-800">
                        {m.upsetPct}% ({m.upsets}/{m.totalGames})
                      </span>
                    </div>
                    <span className="w-28 text-sm text-right dark:text-zinc-400 text-zinc-500 shrink-0">
                      {m.avgPerTournament}/tourn
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t dark:border-zinc-700 border-zinc-200 text-sm dark:text-zinc-400 text-zinc-600">
              Total: {upsetData.r64.totalUpsets} upsets in{' '}
              {upsetData.r64.matchups.reduce((s, m) => s + m.totalGames, 0).toLocaleString()} R64
              games (
              {(
                (upsetData.r64.totalUpsets /
                  upsetData.r64.matchups.reduce((s, m) => s + m.totalGames, 0)) *
                100
              ).toFixed(1)}
              %)
            </div>
          </div>
        )}

        {/* Round of 32 */}
        {selectedUpsetRound === 'r32' && (
          <div>
            <div className="space-y-4">
              {upsetData.r32.sections.map((section) => {
                const isSelected = section.involvedSeeds.includes(Number(selectedSeed));
                return (
                  <div
                    key={section.label}
                    className={`p-5 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200 ${
                      isSelected ? 'ring-2 ring-orange-500/50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-semibold dark:text-zinc-200 text-zinc-800">
                        {section.label}
                      </h4>
                      <span className="text-sm font-medium dark:text-red-400 text-red-600">
                        {section.avgPerTournament} upsets/tourn
                      </span>
                    </div>
                    <p className="text-xs dark:text-zinc-500 text-zinc-400 mb-3">
                      Possible matchups: {section.possibleMatchups.join(', ')}
                    </p>
                    <div className="h-7 bg-zinc-200 dark:bg-zinc-700 rounded overflow-hidden relative">
                      <div
                        className="h-full rounded transition-all duration-700 ease-out"
                        style={{
                          width: `${section.upsetPct}%`,
                          backgroundColor: '#ef4444',
                        }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-medium dark:text-zinc-100 text-zinc-800">
                        {section.upsetPct}% upset rate ({section.upsets}/{section.totalGames})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-sm dark:text-zinc-400 text-zinc-600">
              Total: {upsetData.r32.totalUpsets} upsets in{' '}
              {upsetData.r32.sections.reduce((s, sec) => s + sec.totalGames, 0)} R32 games (
              {(
                (upsetData.r32.totalUpsets /
                  upsetData.r32.sections.reduce((s, sec) => s + sec.totalGames, 0)) *
                100
              ).toFixed(1)}
              %). Upsets counted as top-seed losses + bottom-seed wins per bracket section.
            </div>
          </div>
        )}

        {/* Sweet 16+ */}
        {selectedUpsetRound === 'later' && (
          <div className="p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
            <h3 className="text-lg font-semibold mb-1 dark:text-zinc-200 text-zinc-800">
              Sweet 16 & Beyond — Top Seed Performance
            </h3>
            <p className="text-xs dark:text-zinc-500 text-zinc-400 mb-4">
              In later rounds, matchups vary based on earlier results. This shows how often #1 and
              #2 seeds are eliminated in each round — their loss rate approximates the upset rate.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-zinc-700 border-zinc-300">
                    <th className="py-2 px-3 text-left dark:text-zinc-300 text-zinc-700">Round</th>
                    <th className="py-2 px-3 text-center dark:text-zinc-300 text-zinc-700">Seed</th>
                    <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                      Record
                    </th>
                    <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                      Loss Rate
                    </th>
                    <th className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                      Avg Losses / Tourn
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {upsetData.later.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b dark:border-zinc-800 border-zinc-200 ${
                        row.seed === Number(selectedSeed)
                          ? 'bg-orange-100 dark:bg-orange-900/30'
                          : ''
                      }`}
                    >
                      <td className="py-2 px-3 dark:text-zinc-300 text-zinc-700">{row.round}</td>
                      <td className="py-2 px-3 text-center dark:text-zinc-300 text-zinc-700">
                        #{row.seed}
                      </td>
                      <td className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                        {row.wins}-{row.losses}
                      </td>
                      <td className="py-2 px-3 text-right dark:text-red-400 text-red-600 font-medium">
                        {row.lossRate}%
                      </td>
                      <td className="py-2 px-3 text-right dark:text-zinc-300 text-zinc-700">
                        {row.avgLossesPerTournament}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
