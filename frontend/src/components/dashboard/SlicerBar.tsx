/**
 * SlicerBar.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Slicer controls (dropdown · chips · search · range). A slicer is modeled as a
 * cross-filter *emitter*: its selection is written to builderStore.activeSelections
 * under the slicer widget's own id, so ChartRenderer filters receiver widgets with
 * the exact same client-side path used for click-to-cross-filter.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useBuilderStore } from './builderStore';
import { executeWidgetSql } from './chartHelpers';
import type { SlicerConfig } from './types';

interface SlicerControlProps {
  widgetId: string;
  slicer: SlicerConfig;
}

export default function SlicerControl({ widgetId, slicer }: SlicerControlProps) {
  const activeSelections = useBuilderStore((s) => s.activeSelections);
  const setCrossFilter = useBuilderStore((s) => s.setCrossFilter);

  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const current = activeSelections.find((s) => s.widgetId === widgetId);
  const field = slicer.field;

  // Fetch distinct values for the slicer's field from its source query.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!field || !slicer.sourceSql || slicer.databaseId == null) {
        setOptions([]);
        return;
      }
      setLoading(true);
      const res = await executeWidgetSql(slicer.databaseId, slicer.sourceSql);
      if (cancelled) return;
      if (res.success && res.rows.length) {
        const seen = new Set<string>();
        const vals: any[] = [];
        for (const r of res.rows) {
          const v = r[field];
          if (v === null || v === undefined) continue;
          const k = String(v);
          if (!seen.has(k)) {
            seen.add(k);
            vals.push(v);
          }
        }
        setOptions(vals);
      } else {
        setOptions([]);
      }
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [field, slicer.sourceSql, slicer.databaseId]);

  const numericRange = useMemo(() => {
    const nums = options.map(Number).filter((n) => !isNaN(n));
    if (nums.length === 0) return { min: 0, max: 100 };
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }, [options]);

  const emit = (value: any) => setCrossFilter({ widgetId, field, value });

  if (!field) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-slate-500 px-4">
        <SlidersHorizontal className="w-5 h-5" />
        <p className="text-[11px]">Select this slicer and choose a field in the Fields pane.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-slate-500 text-[11px]">Loading values…</div>;
  }

  const selectedScalar = current && typeof current.value !== 'object' ? String(current.value) : '';

  // ── Range ──────────────────────────────────────────────────────────────────
  if (slicer.mode === 'range') {
    const val = (current?.value && typeof current.value === 'object' ? current.value : {}) as { min?: number; max?: number };
    return (
      <div className="flex flex-col gap-3 h-full justify-center px-1">
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder={String(numericRange.min)}
            value={val.min ?? ''}
            onChange={(e) => emit({ min: e.target.value === '' ? undefined : Number(e.target.value), max: val.max })}
            className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <span className="text-slate-500 text-[10px]">to</span>
          <input
            type="number"
            placeholder={String(numericRange.max)}
            value={val.max ?? ''}
            onChange={(e) => emit({ min: val.min, max: e.target.value === '' ? undefined : Number(e.target.value) })}
            className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <button onClick={() => emit('')} className="text-[10px] text-slate-400 hover:text-slate-200 self-start">
          Clear
        </button>
      </div>
    );
  }

  // ── Dropdown ─────────────────────────────────────────────────────────────────
  if (slicer.mode === 'dropdown') {
    return (
      <div className="flex flex-col gap-2 h-full justify-center">
        <select
          value={selectedScalar}
          onChange={(e) => emit(e.target.value)}
          className="w-full bg-darkBg border border-darkBorder rounded-lg px-2.5 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
        >
          <option value="">All ({field.replace(/_/g, ' ')})</option>
          {options.map((o, i) => (
            <option key={i} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // ── Search + list ──────────────────────────────────────────────────────────
  if (slicer.mode === 'search') {
    const filtered = options.filter((o) => String(o).toLowerCase().includes(search.toLowerCase()));
    return (
      <div className="flex flex-col gap-2 h-full min-h-0">
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${field.replace(/_/g, ' ')}…`}
            className="w-full bg-darkBg border border-darkBorder rounded-lg pl-8 pr-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
          {filtered.slice(0, 100).map((o, i) => {
            const active = selectedScalar === String(o);
            return (
              <button
                key={i}
                onClick={() => emit(active ? '' : o)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-darkBg'}`}
              >
                {String(o)}
              </button>
            );
          })}
          {filtered.length === 0 && <p className="text-slate-500 text-[11px] px-2 py-3">No matches.</p>}
        </div>
      </div>
    );
  }

  // ── Chips (default) ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-wrap gap-1.5 content-start overflow-y-auto h-full">
      {options.slice(0, 60).map((o, i) => {
        const active = selectedScalar === String(o);
        return (
          <button
            key={i}
            onClick={() => emit(active ? '' : o)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
              active
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-darkBg border-darkBorder text-slate-300 hover:border-slate-500'
            }`}
          >
            {String(o)}
          </button>
        );
      })}
      {options.length === 0 && <p className="text-slate-500 text-[11px]">No values.</p>}
    </div>
  );
}
