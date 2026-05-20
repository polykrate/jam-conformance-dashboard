'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { getTeamMetadata } from '@/lib/team-utils';
import { PERFORMANCE_CONFIG } from '@/config/performance';

const TRACES = ['fallback', 'safrole', 'storage_light', 'storage'] as const;

const TRACE_LABELS: Record<string, string> = {
  fallback: 'Fallback',
  safrole: 'Safrole',
  storage_light: 'Stor. Light',
  storage: 'Storage',
};

const TRACE_FULL_LABELS: Record<string, string> = {
  fallback: 'Fallback',
  safrole: 'Safrole',
  storage_light: 'Storage Light',
  storage: 'Storage',
};

const METRICS = [
  { key: 'p50',  label: 'Typical',    weight: 35 },
  { key: 'p90',  label: 'Under Load', weight: 25 },
  { key: 'mean', label: 'Average',    weight: 20 },
  { key: 'p99',  label: 'Worst Case', weight: 10 },
] as const;

type Axis = { id: string; trace: string; metric: string; shortLabel: string; fullLabel: string; weight: number };

const AXES: Axis[] = TRACES.flatMap(trace =>
  METRICS.map(m => ({
    id: `${trace}_${m.key}`,
    trace,
    metric: m.key,
    shortLabel: `${TRACE_LABELS[trace]}\n${m.label}`,
    fullLabel: `${TRACE_FULL_LABELS[trace]}: ${m.label} (${m.weight}%)`,
    weight: m.weight,
  }))
);

interface BenchmarkTeam {
  name: string;
  originalName?: string;
  metrics: Record<string, number>;
  relativeToBaseline: number;
  rank: number;
}

interface BenchmarkEntry {
  teams: BenchmarkTeam[];
  baseline: string;
}

interface BenchmarkData {
  [benchmark: string]: BenchmarkEntry;
}

interface STFRadarChartProps {
  benchmarkData: BenchmarkData;
  version: string;
  compareBenchmarkData?: BenchmarkData | null;
  compareSourceLabel?: string;
  currentSourceLabel?: string;
  onRequestCompare?: () => void;
  compareLoading?: boolean;
}

const TEAM_COLORS = [
  '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444',
  '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#a855f7',
  '#22d3ee', '#84cc16', '#e879f9', '#fb923c', '#2dd4bf',
  '#facc15', '#818cf8', '#4ade80', '#f87171', '#c084fc',
  '#34d399', '#fbbf24',
];

const ZONE_COLORS = [
  { threshold: 1.2,  fill: 'rgba(16,185,129,0.30)',  label: '<1.2x' },
  { threshold: 2.0,  fill: 'rgba(6,182,212,0.25)',   label: '<2x'   },
  { threshold: 5.0,  fill: 'rgba(59,130,246,0.20)',   label: '<5x'   },
  { threshold: 10.0, fill: 'rgba(139,92,246,0.18)',   label: '<10x'  },
  { threshold: 20.0, fill: 'rgba(245,158,11,0.16)',   label: '<20x'  },
  { threshold: 50.0, fill: 'rgba(249,115,22,0.14)',   label: '<50x'  },
  { threshold: 100.0,fill: 'rgba(239,68,68,0.12)',    label: '>50x'  },
];

const ZONE_RGBS = [
  { threshold: 1.2,  r: 16,  g: 185, b: 129 },
  { threshold: 2.0,  r: 6,   g: 182, b: 212 },
  { threshold: 5.0,  r: 59,  g: 130, b: 246 },
  { threshold: 10.0, r: 139, g: 92,  b: 246 },
  { threshold: 20.0, r: 245, g: 158, b: 11  },
  { threshold: 50.0, r: 249, g: 115, b: 22  },
  { threshold: 100.0,r: 239, g: 68,  b: 68  },
];

const TEAM_NAME_ALIASES: Record<string, string[]> = {
  'typeberry':       ['@typeberry/jam', 'typeberry'],
  'jamduna':         ['duna', 'jamduna'],
  'jam4s':           ['jam-scala', 'jam4s'],
  'graymatter':      ['GrayMatter', 'graymatter'],
  'jamixir':         ['Jamixir', 'jamixir'],
  'javajam':         ['JavaJAM', 'javajam'],
  'new-jamneration': ['new_jamneration', 'new-jamneration'],
  'pyjamaz':         ['PyJAMaz', 'pyjamaz'],
  'fastroll':        ['FastRoll', 'fastroll'],
  'gossamer':        ['gossamer-jam', 'gossamer'],
  'polkajam':        ['polkajam'],
  'strawberry':      ['strawberry'],
  'turbojam':        ['turbojam'],
};

function normalizeTeamName(name: string): string {
  const lower = name.toLowerCase().replace(/_/g, '-').replace(/@/g, '').replace(/\//g, '');
  for (const [canonical, aliases] of Object.entries(TEAM_NAME_ALIASES)) {
    if (aliases.some(a => a === name || a.toLowerCase() === lower)) return canonical;
  }
  return lower;
}

function findCompareTeam(
  name: string,
  compareLookup: Record<string, Record<string, Record<string, number>>>
): string | null {
  if (compareLookup[name]) return name;
  const norm = normalizeTeamName(name);
  for (const cName of Object.keys(compareLookup)) {
    if (normalizeTeamName(cName) === norm) return cName;
  }
  return null;
}

function logScale(value: number, max: number): number {
  if (max <= 0) return 0;
  const clamped = Math.max(1, Math.min(value, max));
  return Math.log2(1 + clamped) / Math.log2(1 + max);
}

function adaptiveScale(value: number, max: number, useLinear: boolean): number {
  if (useLinear) {
    if (max <= 1) return 0;
    return Math.max(0, Math.min(1, (value - 1) / (max - 1)));
  }
  return logScale(value, max);
}

function polarToXY(angle: number, radius: number, cx: number, cy: number): [number, number] {
  const rad = (angle - 90) * (Math.PI / 180);
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

function SVGRadarChart({
  axes,
  teamPolygons,
  maxRelative,
  size = 560,
  useLinearScale = false,
}: {
  axes: Axis[];
  teamPolygons: { name: string; color: string; values: number[]; dashed?: boolean }[];
  maxRelative: number;
  size?: number;
  useLinearScale?: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const chartRadius = size / 2 - 85;
  const angleStep = 360 / axes.length;

  const cappedMax = Math.min(Math.max(maxRelative, 2), 100);
  const visibleZones = ZONE_COLORS.filter(z => z.threshold <= cappedMax * 1.2);
  const visibleRGBs = ZONE_RGBS.filter(z => z.threshold <= cappedMax * 1.2);
  const scaleVal = (v: number) => adaptiveScale(v, cappedMax, useLinearScale);
  const ringToRadius = (ringVal: number) => scaleVal(ringVal) * chartRadius;

  const traceGroupAngles = [0, 4, 8, 12].map(i => i * angleStep);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-2xl mx-auto">
      {/* Zone background rings */}
      {visibleRGBs.map((rgb, zi) => {
        const outerR = ringToRadius(rgb.threshold);
        const innerR = zi > 0 ? ringToRadius(visibleRGBs[zi - 1].threshold) : 0;
        const outerPts = axes.map((_, i) => polarToXY(i * angleStep, outerR, cx, cy));
        const outerD = outerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
        if (innerR <= 0) {
          return <path key={zi} d={outerD} fill={`rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`} stroke="none" />;
        }
        const innerPts = axes.map((_, i) => polarToXY(i * angleStep, innerR, cx, cy)).reverse();
        const innerD = innerPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
        return <path key={zi} d={`${outerD} ${innerD}`} fill={`rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`} fillRule="evenodd" stroke="none" />;
      })}

      {/* Zone boundary rings */}
      {visibleZones.map((zone, zi) => {
        const r = ringToRadius(zone.threshold);
        const rgb = visibleRGBs[zi];
        const pts = axes.map((_, i) => polarToXY(i * angleStep, r, cx, cy));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
        return <path key={`ring-${zi}`} d={d} fill="none" stroke={`rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`} strokeWidth="0.75" strokeDasharray="3,3" />;
      })}

      {/* Full speed circle (gold) — 1x baseline */}
      {(() => {
        const r = ringToRadius(PERFORMANCE_CONFIG.speed.full);
        const pts = axes.map((_, i) => polarToXY(i * angleStep, r, cx, cy));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
        const [lx, ly] = polarToXY(0.5 * angleStep, r + 6, cx, cy);
        return (
          <g>
            <path d={d} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
            <text x={lx} y={ly} fill="#fbbf24" fontSize="7" fontWeight="600" textAnchor="middle" opacity="0.8">★ Full</text>
          </g>
        );
      })()}

      {/* Half speed circle (silver) — 2x baseline */}
      {(() => {
        const r = ringToRadius(PERFORMANCE_CONFIG.speed.half);
        const pts = axes.map((_, i) => polarToXY(i * angleStep, r, cx, cy));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
        const [lx, ly] = polarToXY(0.5 * angleStep, r + 6, cx, cy);
        return (
          <g>
            <path d={d} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.7" />
            <text x={lx} y={ly} fill="#94a3b8" fontSize="7" fontWeight="600" textAnchor="middle" opacity="0.8">½ Half</text>
          </g>
        );
      })()}

      {/* Ring labels */}
      {visibleZones.map((zone, zi) => {
        const r = ringToRadius(zone.threshold);
        const rgb = visibleRGBs[zi];
        return (
          <text key={zone.threshold} x={cx + 4} y={cy - r + 2} fill={`rgba(${rgb.r},${rgb.g},${rgb.b},0.7)`} fontSize="8" fontWeight="500" dominantBaseline="auto">
            {zone.threshold < 100 ? `${zone.threshold}x` : ''}
          </text>
        );
      })}

      {/* Trace group separators */}
      {traceGroupAngles.map((startAngle, gi) => {
        const [ex, ey] = polarToXY(startAngle, chartRadius + 2, cx, cy);
        return (
          <line key={gi} x1={cx} y1={cy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.20)" strokeWidth="2" />
        );
      })}

      {/* Trace group labels */}
      {TRACES.map((trace, gi) => {
        const groupCenterAngle = (gi * 4 + 1.5) * angleStep;
        const [tx, ty] = polarToXY(groupCenterAngle, chartRadius + 50, cx, cy);
        const isTop = ty < cy;
        const isLeft = tx < cx - 10;
        const isRight = tx > cx + 10;
        const anchor = isLeft ? 'end' : isRight ? 'start' : 'middle';
        return (
          <text
            key={trace}
            x={tx} y={ty}
            fill="rgba(255,255,255,0.75)"
            fontSize="10"
            fontWeight="600"
            textAnchor={anchor}
            dominantBaseline={isTop ? 'auto' : 'hanging'}
          >
            {TRACE_FULL_LABELS[trace]}
          </text>
        );
      })}

      {/* Axis lines + metric labels */}
      {axes.map((axis, i) => {
        const angle = i * angleStep;
        const [ex, ey] = polarToXY(angle, chartRadius, cx, cy);
        const [lx, ly] = polarToXY(angle, chartRadius + 12, cx, cy);
        const isTop = ly < cy;
        const isLeft = lx < cx - 10;
        const isRight = lx > cx + 10;
        const anchor = isLeft ? 'end' : isRight ? 'start' : 'middle';

        return (
          <g key={axis.id}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text
              x={lx} y={ly}
              fill="rgba(255,255,255,0.35)"
              fontSize="6.5"
              fontWeight="400"
              textAnchor={anchor}
              dominantBaseline={isTop ? 'auto' : 'hanging'}
            >
              {METRICS.find(m => m.key === axis.metric)?.label} {axis.weight}%
            </text>
          </g>
        );
      })}

      {/* Team polygons */}
      {teamPolygons.map(team => {
        const pts = team.values.map((val, i) => {
          const r = scaleVal(val) * chartRadius;
          return polarToXY(i * angleStep, r, cx, cy);
        });
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
        return (
          <g key={team.name}>
            <path
              d={d}
              fill={team.dashed ? 'none' : team.color}
              fillOpacity={team.dashed ? 0 : 0.08}
              stroke={team.color}
              strokeWidth={team.dashed ? 1.2 : 1.5}
              strokeOpacity={team.dashed ? 0.6 : 0.8}
              strokeDasharray={team.dashed ? '4,3' : undefined}
            />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={team.dashed ? 2 : 2.5} fill={team.color} fillOpacity={team.dashed ? 0.5 : 0.9} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function STFRadarChart({
  benchmarkData,
  version,
  compareBenchmarkData,
  compareSourceLabel,
  currentSourceLabel,
  onRequestCompare,
  compareLoading,
}: STFRadarChartProps) {
  const [activeTeams, setActiveTeams] = useState<Set<string>>(new Set());
  const [showInfo, setShowInfo] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  if (!benchmarkData) {
    return <div className="text-center text-slate-400 py-12">No benchmark data for version {version}</div>;
  }

  const teamSets = TRACES.map(t => new Set(benchmarkData[t]?.teams?.map((tm: BenchmarkTeam) => tm.name) || []));
  const completeTeams = [...teamSets[0]].filter(name => teamSets.every(s => s.has(name))).sort();

  const teamLookup = useMemo(() => {
    const lookup: Record<string, Record<string, Record<string, number>>> = {};
    for (const name of completeTeams) {
      lookup[name] = {};
      for (const trace of TRACES) {
        const team = benchmarkData[trace]?.teams?.find((t: BenchmarkTeam) => t.name === name);
        if (team) lookup[name][trace] = team.metrics;
      }
    }
    return lookup;
  }, [benchmarkData, completeTeams.join(',')]);

  // Average relativeToBaseline across 4 traces (uses the baseline from the data, not per-axis fastest)
  const teamBaselineRelative = useMemo(() => {
    const rel: Record<string, number> = {};
    for (const name of completeTeams) {
      let sum = 0, count = 0;
      for (const trace of TRACES) {
        const team = benchmarkData[trace]?.teams?.find((t: BenchmarkTeam) => t.name === name);
        if (team?.relativeToBaseline != null) { sum += team.relativeToBaseline; count++; }
      }
      rel[name] = count > 0 ? sum / count : Infinity;
    }
    return rel;
  }, [benchmarkData, completeTeams.join(',')]);

  const axisMin = useMemo(() => {
    const mins: Record<string, number> = {};
    for (const axis of AXES) {
      let min = Infinity;
      for (const name of completeTeams) {
        const val = teamLookup[name]?.[axis.trace]?.[axis.metric];
        if (val != null && val > 0 && val < min) min = val;
      }
      mins[axis.id] = min === Infinity ? 1 : min;
    }
    return mins;
  }, [teamLookup, completeTeams.join(',')]);

  const getRelative = (name: string, axis: Axis): number => {
    const val = teamLookup[name]?.[axis.trace]?.[axis.metric];
    if (val == null || val <= 0) return 1;
    return val / axisMin[axis.id];
  };

  const rankedTeams = useMemo(() => {
    return [...completeTeams].sort((a, b) => {
      const avgA = AXES.reduce((s, ax) => s + getRelative(a, ax), 0) / AXES.length;
      const avgB = AXES.reduce((s, ax) => s + getRelative(b, ax), 0) / AXES.length;
      return avgA - avgB;
    });
  }, [completeTeams.join(','), axisMin]);

  const toggleTeam = (name: string) => {
    setActiveTeams(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const activeList = rankedTeams.filter(t => activeTeams.has(t));
  const teamPolygons: { name: string; color: string; values: number[]; dashed?: boolean }[] = activeList.map(name => ({
    name,
    color: TEAM_COLORS[rankedTeams.indexOf(name) % TEAM_COLORS.length],
    values: AXES.map(axis => getRelative(name, axis)),
  }));

  const compareLookup = useMemo(() => {
    if (!compareMode || !compareBenchmarkData) return null;
    const vData = compareBenchmarkData;
    if (!vData) return null;
    const lookup: Record<string, Record<string, Record<string, number>>> = {};
    for (const trace of TRACES) {
      for (const team of (vData[trace]?.teams ?? []) as BenchmarkTeam[]) {
        if (!lookup[team.name]) lookup[team.name] = {};
        lookup[team.name][trace] = team.metrics;
      }
    }
    return lookup;
  }, [compareMode, compareBenchmarkData]);

  if (compareMode && compareLookup) {
    for (const name of activeList) {
      const matchedName = findCompareTeam(name, compareLookup);
      if (!matchedName) continue;
      const hasAllTraces = TRACES.every(t => compareLookup[matchedName]?.[t]);
      if (!hasAllTraces) continue;
      const color = TEAM_COLORS[rankedTeams.indexOf(name) % TEAM_COLORS.length];
      const currentMetrics = teamLookup[name];
      teamPolygons.push({
        name: `${name} (${compareSourceLabel || 'compare'})`,
        color,
        values: AXES.map(axis => {
          const compareVal = compareLookup[matchedName]?.[axis.trace]?.[axis.metric];
          const currentVal = currentMetrics?.[axis.trace]?.[axis.metric];
          if (!compareVal || compareVal <= 0 || !currentVal || currentVal <= 0) {
            return getRelative(name, axis);
          }
          const ratio = compareVal / currentVal;
          return getRelative(name, axis) * ratio;
        }),
        dashed: true,
      });
    }
  }

  let maxRelative = 1;
  for (const tp of teamPolygons) {
    for (const v of tp.values) {
      if (v > maxRelative) maxRelative = v;
    }
  }

  const autoLinear = maxRelative < 5;

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
            <h3 className="text-2xl font-bold text-white">Performance Radar</h3>
            <p className="text-sm text-slate-400 mt-1">
              4 traces &times; 4 weighted metrics &mdash; {rankedTeams.length} implementations with full coverage
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onRequestCompare && (
              <button
                onClick={() => {
                  if (!compareBenchmarkData && !compareLoading) onRequestCompare();
                  setCompareMode(prev => !prev);
                }}
                disabled={compareLoading}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all border
                  ${compareMode
                    ? 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border-transparent'
                  }
                  ${compareLoading ? 'opacity-50 cursor-wait' : ''}
                `}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 3h5v5M8 3H3v5M3 16v5h5M21 16v5h-5M21 3l-9 9M3 21l9-9" />
                </svg>
                <span>{compareLoading ? 'Loading...' : compareMode ? 'Comparing' : 'Compare sources'}</span>
              </button>
            )}
            <button
              onClick={() => setShowInfo(!showInfo)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              <Info className="w-4 h-4" />
              <span>{showInfo ? 'Hide' : 'Show'} methodology</span>
            </button>
          </div>
        </div>

        {showInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-300"
          >
            <p className="font-semibold text-white mb-2">Weighted Scoring Methodology</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              {METRICS.map(m => (
                <div key={m.key} className="p-2 bg-white/5 rounded">
                  <div className="text-white font-medium">{m.label}</div>
                  <div className="text-slate-500 text-xs">{m.weight}% weight</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Each of the 4 benchmark traces (Fallback, Safrole, Storage Light, Storage) is measured
              across these 4 metrics. Values are relative to the fastest implementation per axis (1x = best).
              Scale is logarithmic.
            </p>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <div className="lg:col-span-3">
            <SVGRadarChart axes={AXES} teamPolygons={teamPolygons} maxRelative={maxRelative} useLinearScale={autoLinear} />

            {teamPolygons.length > 0 && (
              <div className="flex flex-wrap gap-3 justify-center mt-4">
                {teamPolygons.map(tp => (
                  <div key={tp.name} className="flex items-center gap-1.5 text-xs">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: tp.dashed ? 'transparent' : tp.color,
                        border: tp.dashed ? `2px dashed ${tp.color}` : 'none',
                      }}
                    />
                    <span className="text-slate-300">{tp.name}</span>
                  </div>
                ))}
              </div>
            )}
            {compareMode && (
              <div className="flex justify-center gap-6 mt-2 text-[10px] text-slate-500">
                <div className="flex items-center gap-1">
                  <div className="w-6 h-0.5 bg-slate-400" />
                  <span>{currentSourceLabel || 'Current'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-6 h-0.5 border-t-2 border-dashed border-slate-400" />
                  <span>{compareSourceLabel || 'Compare'}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 justify-center mt-3">
              {[
                { label: '<1.2x', gradient: 'from-emerald-500 to-emerald-400' },
                { label: '<2x',   gradient: 'from-cyan-500 to-cyan-400' },
                { label: '<5x',   gradient: 'from-blue-500 to-blue-400' },
                { label: '<10x',  gradient: 'from-purple-500 to-purple-400' },
                { label: '<20x',  gradient: 'from-amber-500 to-amber-400' },
                { label: '<50x',  gradient: 'from-orange-500 to-orange-400' },
                { label: '>50x',  gradient: 'from-red-500 to-red-400' },
              ].map(z => (
                <div key={z.label} className="flex items-center gap-1.5 text-[10px]">
                  <div className={`w-4 h-3 rounded bg-gradient-to-r ${z.gradient}`} />
                  <span className="text-slate-400">{z.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="flex gap-1.5 mb-3">
              <button
                onClick={() => {
                  const names = rankedTeams.filter(name => teamBaselineRelative[name] <= PERFORMANCE_CONFIG.speed.full);
                  setActiveTeams(new Set(names));
                }}
                className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all bg-white/5 border-amber-400/30 text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
              >
                ★ Full speed
              </button>
              <button
                onClick={() => {
                  const names = rankedTeams.filter(name => teamBaselineRelative[name] <= PERFORMANCE_CONFIG.speed.half);
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
            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
              {rankedTeams.map((name, idx) => {
                const meta = getTeamMetadata(name);
                const isActive = activeTeams.has(name);
                const color = TEAM_COLORS[idx % TEAM_COLORS.length];
                return (
                  <button
                    key={name}
                    onClick={() => toggleTeam(name)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-all
                      ${isActive ? 'bg-white/10 border border-white/20' : 'hover:bg-white/5 border border-transparent'}`}
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color, opacity: isActive ? 1 : 0.3 }} />
                    <span className={isActive ? 'text-white font-medium' : 'text-slate-400'}>{name}</span>
                    {meta?.language && <span className="text-[10px] text-slate-600 ml-auto">{meta.language}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-2 px-1">
          <span className="text-[11px] text-slate-500">
            {completeTeams.length} implementations with all 4 traces | Lower is better | {autoLinear ? 'Linear scale (zoomed)' : 'Log scale'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
