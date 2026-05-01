import { Trophy } from "lucide-react";
import type { LeaderboardEntry } from "../types";
import { formatPct } from "../utils";

export function LeaderboardPanel({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section className="panel min-w-0">
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <Trophy className="h-5 w-5 text-amber-300" />
        <div className="min-w-0">
          <p className="label">Leaderboard</p>
          <h2 className="truncate text-lg font-semibold text-zinc-50">Ranked Agents</h2>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Rank</th>
              <th className="px-4 py-3 font-semibold">Agent</th>
              <th className="px-4 py-3 font-semibold">Rating</th>
              <th className="px-4 py-3 font-semibold">Record</th>
              <th className="px-4 py-3 font-semibold">Avg PnL</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  Complete a match to populate rankings.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={`${entry.rank}-${entry.strategy}`} className="border-b border-white/5">
                  <td className="px-4 py-3 font-mono text-zinc-300">#{entry.rank}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-100">{entry.strategy}</td>
                  <td className="px-4 py-3 font-mono text-teal-200">{entry.rating}</td>
                  <td className="px-4 py-3 font-mono text-zinc-400">
                    {entry.wins}-{entry.losses}-{entry.draws}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-300">{formatPct(entry.avgPnlPct)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
