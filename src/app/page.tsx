'use client';

import { useState, useEffect } from 'react';
import { LeaderboardTable } from '@/components/LeaderboardTable';
import { AuditTimeCalculator } from '@/components/AuditTimeCalculator';
import { PerformanceChartEnhanced } from '@/components/PerformanceChartEnhanced';
import { VersionSelector } from '@/components/VersionSelector';
import { BenchmarkTabs } from '@/components/BenchmarkTabs';
import { BenchmarkHeatmap } from '@/components/BenchmarkHeatmap';
import { BenchmarkInfo } from '@/components/BenchmarkInfo';
import { MethodologyExplainer } from '@/components/MethodologyExplainer';
import { STFRadarChart } from '@/components/STFRadarChart';
import { PerformanceTrend } from '@/components/PerformanceTrend';
import { DataSourceSelector } from '@/components/DataSourceSelector';
import { useDataSource } from '@/lib/use-data-source';
import { Info, Loader2 } from 'lucide-react';
import sourceInfo from '@/data/source-info.json';
import { APP_CONFIG } from '@/config';
import { enrichTeamWithMetadata } from '@/lib/team-utils';

export default function Home() {
  const { source, setSource, loading, error, aggregatedData, allBenchmarksData, history, compareBenchmarks, compareLoading, loadCompare } = useDataSource();

  const versions = Object.keys(aggregatedData).sort().reverse();
  const [currentVersion, setCurrentVersion] = useState(versions[0] || APP_CONFIG.defaultVersion);
  const [currentBenchmark, setCurrentBenchmark] = useState('');

  const basePath = APP_CONFIG.paths.basePath;

  useEffect(() => {
    setCurrentBenchmark('');
  }, [currentVersion, source]);

  useEffect(() => {
    const newVersions = Object.keys(aggregatedData).sort().reverse();
    if (newVersions.length > 0 && !newVersions.includes(currentVersion)) {
      setCurrentVersion(newVersions[0]);
    }
  }, [aggregatedData]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ backgroundImage: `url(${basePath}${APP_CONFIG.paths.backgroundImage})`, backgroundRepeat: 'repeat', backgroundSize: '1024px 1059px', backgroundColor: '#000000' }}>
        <div className="flex flex-col items-center gap-4 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          <p className="text-sm">Loading {source === 'fluffy' ? 'FluffyLabs' : 'Parity'} data...</p>
        </div>
      </main>
    );
  }

  const overviewData = (aggregatedData as any)[currentVersion] || (aggregatedData as any)[APP_CONFIG.defaultVersion];
  if (!overviewData) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#000000' }}>
        <p className="text-slate-400">No data available for version {currentVersion}</p>
      </main>
    );
  }

  const enrichedTeams = overviewData.teams.map((team: any) => enrichTeamWithMetadata(team));
  const hasBenchmarkData = (allBenchmarksData as any)[currentVersion] && Object.keys((allBenchmarksData as any)[currentVersion]).length > 0;
  const hasHistory = !!history && Array.isArray(history) && history.length >= 2;

  return (
    <main className="min-h-screen" style={{ backgroundImage: `url(${basePath}${APP_CONFIG.paths.backgroundImage})`, backgroundRepeat: 'repeat', backgroundSize: '1024px 1059px', backgroundColor: '#000000' }}>
      <div className="relative z-10">
        <div className="container mx-auto px-4 py-12">
          {/* Header */}
          <div className="flex flex-col md:flex-row items-center justify-between mb-12">
            <div className="text-center md:text-left mb-6 md:mb-0">
              <h1 className="text-5xl md:text-6xl font-black text-white mb-2 tracking-tighter">
                JAM
              </h1>
              <p className="text-lg md:text-xl text-slate-400 font-light tracking-wide uppercase">
                Conformance Performance
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <DataSourceSelector source={source} onSourceChange={setSource} loading={loading} />
              <VersionSelector
                versions={versions}
                currentVersion={currentVersion}
                onVersionChange={setCurrentVersion}
              />
            </div>
          </div>

          {error && (
            <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm">
              Failed to load data: {error}
            </div>
          )}

          {hasBenchmarkData && (
            <div className="mb-8">
              <BenchmarkTabs
                currentBenchmark={currentBenchmark}
                onBenchmarkChange={setCurrentBenchmark}
                hasHistory={hasHistory}
              />
            </div>
          )}

          {/* Views */}
          {currentBenchmark === 'radar' && hasBenchmarkData ? (
            <div className="mb-12">
              <STFRadarChart
                benchmarkData={(allBenchmarksData as any)[currentVersion]}
                version={currentVersion}
                compareBenchmarkData={compareBenchmarks?.[currentVersion] ?? null}
                compareSourceLabel={source === 'parity' ? 'FluffyLabs' : 'Parity'}
                currentSourceLabel={source === 'parity' ? 'Parity' : 'FluffyLabs'}
                onRequestCompare={loadCompare}
                compareLoading={compareLoading}
              />
            </div>
          ) : currentBenchmark === 'trend' && hasHistory ? (
            <div className="mb-12">
              <PerformanceTrend
                history={history}
                version={currentVersion}
              />
            </div>
          ) : !currentBenchmark || !hasBenchmarkData ? (
            <>
              <div className="mb-8 p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-slate-300">
                    <p className="font-semibold text-white mb-1">Important Note</p>
                    <p>This leaderboard highlights performance differences between JAM implementations.
                    All implementations are works in progress and none are fully conformant yet.
                    The rankings serve to track relative performance improvements over time.</p>
                  </div>
                </div>
              </div>

              <div className="mb-12">
                <PerformanceChartEnhanced teams={enrichedTeams} baseline={overviewData.baseline} timestamp={overviewData.timestamp} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
                <div className="lg:col-span-2">
                  <LeaderboardTable teams={enrichedTeams} baseline={overviewData.baseline} />
                </div>
                <div className="lg:col-span-1">
                  <AuditTimeCalculator teams={enrichedTeams} baseline={overviewData.baseline} />
                </div>
              </div>

              <div className="w-full">
                <MethodologyExplainer methodology={overviewData.methodology} />
              </div>
            </>
          ) : currentBenchmark === 'heatmap' ? (
            <div className="mb-12">
              <BenchmarkHeatmap
                benchmarkData={(allBenchmarksData as any)[currentVersion]}
                version={currentVersion}
              />
            </div>
          ) : (allBenchmarksData as any)[currentVersion]?.[currentBenchmark] ? (
            <>
              <BenchmarkInfo benchmark={currentBenchmark} />

              <div className="mb-12">
                <PerformanceChartEnhanced
                  teams={(allBenchmarksData as any)[currentVersion][currentBenchmark].teams.map((team: any) => enrichTeamWithMetadata(team))}
                  baseline={(allBenchmarksData as any)[currentVersion][currentBenchmark].baseline}
                  timestamp={(allBenchmarksData as any)[currentVersion][currentBenchmark].timestamp}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2">
                  <LeaderboardTable
                    teams={(allBenchmarksData as any)[currentVersion][currentBenchmark].teams.map((team: any) => enrichTeamWithMetadata(team))}
                    baseline={(allBenchmarksData as any)[currentVersion][currentBenchmark].baseline}
                  />
                </div>
                <div className="lg:col-span-1">
                  <AuditTimeCalculator
                    teams={(allBenchmarksData as any)[currentVersion][currentBenchmark].teams.map((team: any) => enrichTeamWithMetadata(team))}
                    baseline={(allBenchmarksData as any)[currentVersion][currentBenchmark].baseline}
                  />
                </div>
              </div>
            </>
          ) : null}

          {/* Footer */}
          <div className="mt-16 text-center text-sm text-slate-500">
            <p>
              Performance data updated regularly. Version: {currentVersion}
              {' '}| Source: {source === 'parity' ? 'Parity' : 'FluffyLabs'}
              {overviewData.timestamp && (
                <span className="ml-2">
                  | Last updated: {new Date(overviewData.timestamp).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })}
                </span>
              )}
              {source === 'parity' && sourceInfo.source?.commitDate && sourceInfo.source.commitHash !== 'placeholder' && (
                <span className="ml-2">
                  | Source data from: {new Date(sourceInfo.source.commitDate).toLocaleString('en-US', {
                    dateStyle: 'medium'
                  })}
                </span>
              )}
            </p>
            <p className="mt-2">
              Testing protocol conformance at scale. Learn more at{' '}
              <a
                href={APP_CONFIG.externalLinks.jamConformance}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                jam-conformance
              </a>
              {source === 'parity' && (
                <>
                  {' '}|{' '}
                  <a
                    href={sourceInfo.source?.sourceUrl || `${APP_CONFIG.externalLinks.jamConformance}/commits/main`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors"
                    title={sourceInfo.source?.commitMessage || 'View latest commits'}
                  >
                    {sourceInfo.source?.commitHash ? `Commit ${sourceInfo.source.commitHash.slice(0, 7)}` : 'Latest commits'}
                  </a>
                </>
              )}
              {source === 'fluffy' && (
                <>
                  {' '}|{' '}
                  <a
                    href="https://fluffylabs.dev/jam-testing/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    FluffyLabs Testing
                  </a>
                </>
              )}
              {' '}|{' '}
              <a
                href={APP_CONFIG.externalLinks.graypaperClients}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                View all clients
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}