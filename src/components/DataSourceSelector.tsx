'use client';

import { type DataSource } from '@/lib/use-data-source';

interface DataSourceSelectorProps {
  source: DataSource;
  onSourceChange: (source: DataSource) => void;
  loading?: boolean;
}

const sources: { id: DataSource; label: string }[] = [
  { id: 'parity', label: 'Parity' },
  { id: 'fluffy', label: 'FluffyLabs' },
];

export function DataSourceSelector({ source, onSourceChange, loading }: DataSourceSelectorProps) {
  return (
    <div className="flex items-center gap-1 bg-black/30 border border-white/10 rounded-lg p-0.5">
      {sources.map(s => (
        <button
          key={s.id}
          onClick={() => onSourceChange(s.id)}
          disabled={loading}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
            ${source === s.id
              ? 'bg-white/10 text-white border border-white/20'
              : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            }
            ${loading ? 'opacity-50 cursor-wait' : ''}
          `}
        >
          {s.label}
          {loading && source !== s.id && s.id === 'fluffy' ? '' : ''}
        </button>
      ))}
    </div>
  );
}
