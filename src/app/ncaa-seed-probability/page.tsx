'use client';

import React, { useEffect, useState } from 'react';

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
  loser: string;
  score: string;
  round: string;
}

interface ChampionData {
  year: number;
  team: string;
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
  championships: ChampionData[];
  data_range: string;
  note: string;
}

interface ApiResponse {
  seed_focus: SeedFocus;
  all_seeds_comparison: SeedComparison[];
}

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

export default function NcaaSeedProbabilityPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ncaa-seed-probability')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch data');
        return res.json();
      })
      .then((json: ApiResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-zinc-500 dark:text-zinc-400 text-lg">Loading tournament data...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-red-500 text-lg">Error: {error || 'Unknown error'}</div>
      </div>
    );
  }

  const { seed_focus, all_seeds_comparison } = data;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-3xl md:text-4xl font-bold mb-2 dark:text-zinc-100 text-zinc-900">
        NCAA Tournament: 2-Seed Win Probability
      </h1>
      <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-8">
        Historical data from {seed_focus.data_range} &middot; {seed_focus.total_tournaments}{' '}
        tournaments &middot; {seed_focus.total_teams} total 2-seeds
      </p>

      {/* Key Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {seed_focus.rounds.slice(0, 4).map((round) => (
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
          data={seed_focus.rounds}
          valueKey="win_percentage"
          label="Win Percentage by Round"
          color="#f97316"
        />
      </div>

      {/* Probability of Reaching Each Round */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <BarChart
          data={seed_focus.rounds}
          valueKey="reach_percentage"
          label="Probability of Reaching Each Round"
          color="#3b82f6"
        />
      </div>

      {/* 2-Seed Champions */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">
          2-Seed National Champions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {seed_focus.championships.map((champ) => (
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

      {/* Notable Upsets */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">
          Notable 15-over-2 Upsets
        </h3>
        <div className="space-y-2">
          {seed_focus.notable_upsets.map((upset, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded dark:bg-zinc-700/50 bg-zinc-100 text-sm"
            >
              <span className="font-bold dark:text-zinc-300 text-zinc-700">{upset.year}</span>
              <span className="dark:text-zinc-300 text-zinc-700">
                #{15} {upset.winner} def. #{2} {upset.loser}
              </span>
              <span className="dark:text-zinc-500 text-zinc-400">{upset.score}</span>
            </div>
          ))}
        </div>
      </div>

      {/* All Seeds Comparison */}
      <div className="mb-10 p-6 rounded-lg dark:bg-zinc-800/50 bg-white shadow-sm border dark:border-zinc-700 border-zinc-200">
        <h3 className="text-lg font-semibold mb-4 dark:text-zinc-200 text-zinc-800">
          All Seeds Comparison
        </h3>
        <p className="text-sm dark:text-zinc-400 text-zinc-600 mb-4">
          2-seed row highlighted. &quot;Sweet 16 %&quot; and &quot;Final Four %&quot; show the
          probability of reaching that round.
        </p>
        <SeedComparisonTable data={all_seeds_comparison} focusSeed={seed_focus.seed} />
      </div>

      {/* Data Note */}
      <p className="text-xs dark:text-zinc-500 text-zinc-400 text-center">{seed_focus.note}</p>
    </div>
  );
}
