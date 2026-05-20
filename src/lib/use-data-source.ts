'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import parityAggregated from '@/data/aggregated-data.json';
import parityBenchmarks from '@/data/all-benchmarks-data.json';

export type DataSource = 'parity' | 'fluffy';

const FLUFFY_BASE = 'https://fluffylabs.dev/jam-testing/data';

interface DataState {
  aggregatedData: Record<string, any>;
  allBenchmarksData: Record<string, any>;
  history: any | null;
}

interface UseDataSourceReturn extends DataState {
  source: DataSource;
  setSource: (s: DataSource) => void;
  loading: boolean;
  error: string | null;
  compareBenchmarks: Record<string, any> | null;
  compareLoading: boolean;
  loadCompare: () => void;
}

const FLUFFY_BASELINE = 'spacejam';

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function rebaseAggregated(data: Record<string, any>, baselineName: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const version of Object.keys(data)) {
    const vData = { ...data[version] };
    const teams: any[] = vData.teams ?? [];
    const baselineTeam = teams.find((t: any) => t.name === baselineName);
    if (!baselineTeam) {
      result[version] = vData;
      continue;
    }
    const baselineRel = baselineTeam.relativeToBaseline ?? (baselineTeam.score ? baselineTeam.score : null);
    const baselineScore = baselineTeam.score;
    if (!baselineRel && !baselineScore) {
      result[version] = vData;
      continue;
    }
    vData.baseline = baselineName;
    vData.teams = teams.map((t: any) => {
      if (t.name === baselineName) return { ...t, relativeToBaseline: 1.0 };
      if (baselineScore && t.score) return { ...t, relativeToBaseline: t.score / baselineScore };
      if (baselineRel && t.relativeToBaseline != null) return { ...t, relativeToBaseline: t.relativeToBaseline / baselineRel };
      return t;
    });
    result[version] = vData;
  }
  return result;
}

function rebaseBenchmarks(data: Record<string, any>, baselineName: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const version of Object.keys(data)) {
    result[version] = {};
    for (const trace of Object.keys(data[version])) {
      const tData = { ...data[version][trace] };
      const teams: any[] = tData.teams ?? [];
      const baselineTeam = teams.find((t: any) => t.name === baselineName);
      if (!baselineTeam) {
        tData.baseline = baselineName;
        result[version][trace] = tData;
        continue;
      }
      const baselineRel = baselineTeam.relativeToBaseline;
      const baselineScore = baselineTeam.score;
      if (!baselineRel && !baselineScore) {
        tData.baseline = baselineName;
        result[version][trace] = tData;
        continue;
      }
      tData.baseline = baselineName;
      tData.teams = teams.map((t: any) => {
        if (t.name === baselineName) return { ...t, relativeToBaseline: 1.0 };
        if (baselineScore && t.score) return { ...t, relativeToBaseline: t.score / baselineScore };
        if (baselineRel && t.relativeToBaseline != null) return { ...t, relativeToBaseline: t.relativeToBaseline / baselineRel };
        return t;
      });
      result[version][trace] = tData;
    }
  }
  return result;
}

export function useDataSource(): UseDataSourceReturn {
  const [source, setSourceState] = useState<DataSource>('parity');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fluffyCache = useRef<DataState | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareBenchmarks, setCompareBenchmarks] = useState<Record<string, any> | null>(null);

  const [data, setData] = useState<DataState>({
    aggregatedData: parityAggregated as any,
    allBenchmarksData: parityBenchmarks as any,
    history: null,
  });

  const setSource = useCallback((s: DataSource) => {
    if (s === source) return;
    setSourceState(s);
  }, [source]);

  useEffect(() => {
    if (source === 'parity') {
      setData({
        aggregatedData: parityAggregated as any,
        allBenchmarksData: parityBenchmarks as any,
        history: null,
      });
      setError(null);
      setCompareBenchmarks(fluffyCache.current?.allBenchmarksData ?? null);
      return;
    }

    setCompareBenchmarks(parityBenchmarks as any);

    if (fluffyCache.current) {
      setData(fluffyCache.current);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchJson(`${FLUFFY_BASE}/aggregated-data.json`),
      fetchJson(`${FLUFFY_BASE}/all-benchmarks-data.json`),
      fetchJson(`${FLUFFY_BASE}/history.json`),
    ])
      .then(([agg, bench, hist]) => {
        if (cancelled) return;
        const state: DataState = {
          aggregatedData: rebaseAggregated(agg, FLUFFY_BASELINE),
          allBenchmarksData: rebaseBenchmarks(bench, FLUFFY_BASELINE),
          history: hist,
        };
        fluffyCache.current = state;
        setData(state);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [source]);

  const loadCompare = useCallback(() => {
    if (source === 'fluffy') {
      setCompareBenchmarks(parityBenchmarks as any);
      return;
    }
    if (fluffyCache.current) {
      setCompareBenchmarks(fluffyCache.current.allBenchmarksData);
      return;
    }
    setCompareLoading(true);
    fetchJson(`${FLUFFY_BASE}/all-benchmarks-data.json`)
      .then(bench => {
        setCompareBenchmarks(bench);
        if (!fluffyCache.current) {
          Promise.all([
            fetchJson(`${FLUFFY_BASE}/aggregated-data.json`),
            fetchJson(`${FLUFFY_BASE}/history.json`),
          ]).then(([agg, hist]) => {
            fluffyCache.current = { aggregatedData: agg, allBenchmarksData: bench, history: hist };
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setCompareLoading(false));
  }, [source]);

  return { source, setSource, loading, error, compareBenchmarks, compareLoading, loadCompare, ...data };
}
