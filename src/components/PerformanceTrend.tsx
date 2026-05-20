'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { getTeamMetadata } from '@/lib/team-utils';
import { PERFORMANCE_CONFIG } from '@/config/performance';

interface HistoryEntry {
  timestamp: string;
  commit: string;
  versions: Record<string, {
    baseline: string;
    teams: Array<{
      name: string;
      score: number;
      rank: number;
      metrics: Record<string, number>;
      relativeToBaseline: number;
    }>;
  }>;
}

interface PerformanceTrendProps {
  history: HistoryEntry[];
  version: string;
  initialTeam?: string;
}

const TEAM_COLORS = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
  '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#a855f7',
  '#22d3ee', '#84cc16', '#e879f9', '#fb923c', '#2dd4bf',
  '#facc15', '#818cf8', '#4ade80', '#f87171', '#c084fc',
];

const TIME_RANGES = [
  { id: '1d', label: '24h', days: 1 },
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: 'all', label: 'All', days: 0 },
] as const;

export function PerformanceTrend({ history, version, initialTeam }: PerformanceTrendProps) {
  const [activeTeams, setActiveTeams] = useState<Set<string>>(
    initialTeam ? new Set([initialTeam]) : new Set()
  );
  const [timeRange, setTimeRange] = useState<string>('all');

  useEffect(() => {
    if (initialTeam) setActiveTeams(new Set([initialTeam]));
  }, [initialTeam]);

  const fullHistory = useMemo(() => {
    const all = history
      .filter(e => e.versions[version])
      .map(e => ({
        date: e.timestamp,
        commit: e.commit,
        baseline: e.versions[version].baseline,
        teams: e.versions[version].teams,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const byDay = new Map<string, typeof all[0]>();
    for (const entry of all) {
      byDay.set(entry.date.slice(0, 10), entry);
    }
    return [...byDay.values()];
  }, [history, version]);

  const versionHistory = useMemo(() => {
    const range = TIME_RANGES.find(r => r.id === timeRange);
    if (!range || range.days === 0) return fullHistory;
    const cutoff = Date.now() - range.days * 86400_000;
    return fullHistory.filter(e => new Date(e.date).getTime() >= cutoff);
  }, [fullHistory, timeRange]);

  const allTeams = useMemo(() => {
    const names = new Set<string>();
    for (const entry of versionHistory) {
      for (const t of entry.teams) names.add(t.name);
    }
    const last = versionHistory[versionHistory.length - 1];
    if (!last) return [...names].sort();
    const scoreMap = new Map(last.teams.map(t => [t.name, t.score]));
    return [...names].sort((a, b) => (scoreMap.get(a) ?? Infinity) - (scoreMap.get(b) ?? Infinity));
  }, [versionHistory]);

  const toggleTeam = (name: string) => {
    setActiveTeams(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (versionHistory.length < 2) {
    return <div className="text-center text-slate-400 py-12">Not enough history for version {version}</div>;
  }

  // Chart dimensions
  const W = 800, H = 300, PAD = { t: 20, r: 20, b: 40, l: 50 };
  const cw = W - PAD.l - PAD.r;
  const ch = H - PAD.t - PAD.b;

  const dates = versionHistory.map(e => new Date(e.date).getTime());
  const xMin = dates[0], xRange = dates[dates.length - 1] - xMin || 1;
  const toX = (ts: number) => PAD.l + ((ts - xMin) / xRange) * cw;

  // Score range from active teams only
  let yMin = Infinity, yMax = -Infinity;
  const activeList = allTeams.filter(n => activeTeams.has(n));
  for (const entry of versionHistory) {
    for (const t of entry.teams) {
      if (activeList.length === 0 || activeTeams.has(t.name)) {
        if (t.score > 0) {
          yMin = Math.min(yMin, t.score);
          yMax = Math.max(yMax, t.score);
        }
      }
    }
  }
  if (!isFinite(yMin)) { yMin = 0; yMax = 10; }
  const yPad = (yMax - yMin) * 0.1 || 1;
  yMin = Math.max(0, yMin - yPad);
  yMax = yMax + yPad;
  const yRange = yMax - yMin || 1;
  const toY = (score: number) => PAD.t + ch - ((score - yMin) / yRange) * ch;

  // Build team lines
  const teamLines = activeList.map((name, idx) => {
    const color = TEAM_COLORS[allTeams.indexOf(name) % TEAM_COLORS.length];
    const points: { x: number; y: number; score: number; date: string }[] = [];
    for (const entry of versionHistory) {
      const t = entry.teams.find(tm => tm.name === name);
      if (t && t.score > 0) {
        points.push({
          x: toX(new Date(entry.date).getTime()),
          y: toY(t.score),
          score: t.score,
          date: entry.date,
        });
      }
    }
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    return { name, color, points, d };
  });

  // Y-axis grid
  const yTicks: number[] = [];
  const step = Math.pow(10, Math.floor(Math.log10(yRange))) / 2 || 1;
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    yTicks.push(v);
  }

  // X-axis labels — adapt granularity to selected range
  const xLabels: { x: number; label: string }[] = [];
  const range = TIME_RANGES.find(r => r.id === timeRange);
  const rangeDays = range?.days || Infinity;
  const seen = new Set<string>();
  for (const entry of versionHistory) {
    const d = new Date(entry.date);
    let key: string;
    let label: string;
    if (rangeDays <= 1) {
      key = entry.date.slice(0, 13);
      label = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (rangeDays <= 7) {
      key = entry.date.slice(0, 10);
      label = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    } else if (rangeDays <= 30) {
      const weekNum = `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7)}`;
      key = weekNum;
      label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    if (!seen.has(key)) {
      seen.add(key);
      xLabels.push({ x: toX(d.getTime()), label });
    }
  }

  // Baseline score from latest entry for threshold lines
  const lastEntry = versionHistory[versionHistory.length - 1];
  const baselineScore = lastEntry
    ? lastEntry.teams.find(t => t.name === lastEntry.baseline)?.score ?? null
    : null;
  const fullSpeedY = baselineScore != null ? toY(baselineScore * PERFORMANCE_CONFIG.speed.full) : null;
  const halfSpeedY = baselineScore != null ? toY(baselineScore * PERFORMANCE_CONFIG.speed.half) : null;

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl bg-neutral-900/50 backdrop-blur-xl border border-neutral-800 shadow-2xl"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-800/20 via-transparent to-neutral-800/20" />

      <div className="relative p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-white">Performance Trend</h3>
            <p className="text-sm text-slate-400 mt-1">Weighted score over time</p>
          </div>
          <div className="flex gap-1 bg-black/30 rounded-lg p-1 border border-white/5">
            {TIME_RANGES.map(r => (
              <button
                key={r.id}
                onClick={() => setTimeRange(r.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all
                  ${timeRange === r.id
                    ? 'bg-white/10 text-white border border-white/20'
                    : 'text-slate-500 hover:text-white hover:bg-white/5'
                  }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Chart */}
          <div className="lg:col-span-3">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
              {/* Y grid */}
              {yTicks.map(v => (
                <g key={v}>
                  <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)} stroke="rgba(255,255,255,0.06)" />
                  <text x={PAD.l - 6} y={toY(v)} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end" dominantBaseline="middle">
                    {v < 10 ? v.toFixed(1) : v.toFixed(0)}
                  </text>
                </g>
              ))}

              {/* X labels */}
              {xLabels.map((xl, i) => (
                <text key={i} x={xl.x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="middle">
                  {xl.label}
                </text>
              ))}

              {/* Full speed threshold (gold) */}
              {fullSpeedY != null && fullSpeedY >= PAD.t && fullSpeedY <= H - PAD.b && (
                <g>
                  <line x1={PAD.l} y1={fullSpeedY} x2={W - PAD.r} y2={fullSpeedY} stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
                  <text x={W - PAD.r + 4} y={fullSpeedY} fill="#fbbf24" fontSize="8" fontWeight="600" dominantBaseline="middle" opacity="0.8">
                    ★ Full
                  </text>
                </g>
              )}

              {/* Half speed threshold (silver) */}
              {halfSpeedY != null && halfSpeedY >= PAD.t && halfSpeedY <= H - PAD.b && (
                <g>
                  <line x1={PAD.l} y1={halfSpeedY} x2={W - PAD.r} y2={halfSpeedY} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
                  <text x={W - PAD.r + 4} y={halfSpeedY} fill="#94a3b8" fontSize="8" fontWeight="600" dominantBaseline="middle" opacity="0.8">
                    ½ Half
                  </text>
                </g>
              )}

              {/* Team lines */}
              {teamLines.map(tl => (
                <g key={tl.name}>
                  <path d={tl.d} fill="none" stroke={tl.color} strokeWidth="2" strokeLinejoin="round" />
                  {tl.points.filter((_, i) => i === 0 || i === tl.points.length - 1 || tl.points.length < 20 || i % Math.ceil(tl.points.length / 20) === 0).map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={tl.color}>
                      <title>{`${tl.name}: ${p.score.toFixed(2)} (${formatDate(p.date)})`}</title>
                    </circle>
                  ))}
                </g>
              ))}

              {/* Axes */}
              <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="rgba(255,255,255,0.1)" />
              <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="rgba(255,255,255,0.1)" />

              {/* Y axis label */}
              <text x={12} y={H / 2} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle" transform={`rotate(-90,12,${H / 2})`}>
                Score (lower = faster)
              </text>
            </svg>

            {/* Legend */}
            {teamLines.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-3 justify-center">
                {teamLines.map(tl => {
                  const last = tl.points[tl.points.length - 1];
                  return (
                    <div key={tl.name} className="flex items-center gap-1.5 text-xs">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tl.color }} />
                      <span className="text-slate-300">{tl.name}</span>
                      {last && <span className="text-slate-500 font-mono">{last.score.toFixed(1)}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Team selector */}
          <div className="lg:col-span-1">
            <div className="flex gap-1.5 mb-3">
              <button
                onClick={() => {
                  const last = versionHistory[versionHistory.length - 1];
                  if (!last) return;
                  const names = last.teams.filter(t => t.relativeToBaseline <= PERFORMANCE_CONFIG.speed.full).map(t => t.name);
                  setActiveTeams(new Set(names));
                }}
                className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all bg-white/5 border-amber-400/30 text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
              >
                ★ Full speed
              </button>
              <button
                onClick={() => {
                  const last = versionHistory[versionHistory.length - 1];
                  if (!last) return;
                  const names = last.teams.filter(t => t.relativeToBaseline <= PERFORMANCE_CONFIG.speed.half).map(t => t.name);
                  setActiveTeams(new Set(names));
                }}
                className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all bg-white/5 border-slate-400/30 text-slate-300 hover:bg-slate-400/10 hover:text-slate-200"
              >
                ½ Half speed
              </button>
              <button
                onClick={() => setActiveTeams(new Set())}
                className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                Clear
              </button>
            </div>
            <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
              {allTeams.map((name, idx) => {
                const meta = getTeamMetadata(name);
                const isActive = activeTeams.has(name);
                const color = TEAM_COLORS[allTeams.indexOf(name) % TEAM_COLORS.length];
                const lastEntry = versionHistory[versionHistory.length - 1];
                const lastScore = lastEntry?.teams.find(t => t.name === name)?.score;
                return (
                  <button
                    key={name}
                    onClick={() => toggleTeam(name)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-sm transition-all
                      ${isActive ? 'bg-white/10 border border-white/20' : 'hover:bg-white/5 border border-transparent'}`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color, opacity: isActive ? 1 : 0.3 }} />
                    <span className={`flex-1 truncate ${isActive ? 'text-white font-medium' : 'text-slate-400'}`}>{name}</span>
                    {lastScore != null && <span className="text-[10px] text-slate-600 font-mono">{lastScore.toFixed(1)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-slate-500">
          Lower score = faster &bull; Select implementations to compare
        </div>
      </div>
    </motion.div>
  );
}
