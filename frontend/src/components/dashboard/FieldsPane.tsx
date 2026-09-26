/**
 * FieldsPane.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Left "Data" rail for the currently-selected widget. Depending on widget type:
 *   - chart   : visual-type picker · data-source binding · field-mapping buckets
 *               (X-Axis, Values w/ aggregation, Legend, Tooltip) sourced from the
 *               widget's own result columns
 *   - slicer  : database → table → column picker + mode; builds a DISTINCT sourceSql
 *   - text    : markdown content editor
 *   - image   : image URL
 *
 * All edits are committed to the selected CanvasWidget via builderStore.updateWidget.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, BarChartHorizontal, LineChart, AreaChart, PieChart, CircleDot,
  ScatterChart, GitCompareArrows, Gauge, Waves, Grid3x3, LayoutGrid, Network,
  Filter, Hash, Plus, X, Type, Sigma,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useBuilderStore } from './builderStore';
import { executeWidgetSql } from './chartHelpers';
import api from '../../api';
import { getActivePage } from './types';
import type { ChartType, AggregationType, FieldMapping, SlicerMode, ValueField } from './types';

type SchemaCol = { column: string; type: string; isPrimary?: boolean; isForeign?: boolean };
type SchemaData = Record<string, SchemaCol[]>;

const VISUALS: { type: ChartType; label: string; icon: any }[] = [
  { type: 'bar', label: 'Bar', icon: BarChart3 },
  { type: 'stackedBar', label: 'Stacked', icon: BarChartHorizontal },
  { type: 'line', label: 'Line', icon: LineChart },
  { type: 'area', label: 'Area', icon: AreaChart },
  { type: 'pie', label: 'Pie', icon: PieChart },
  { type: 'donut', label: 'Donut', icon: CircleDot },
  { type: 'scatter', label: 'Scatter', icon: ScatterChart },
  { type: 'combo', label: 'Combo', icon: GitCompareArrows },
  { type: 'kpi', label: 'KPI', icon: Hash },
  { type: 'table', label: 'Table', icon: LayoutGrid },
  { type: 'gauge', label: 'Gauge', icon: Gauge },
  { type: 'waterfall', label: 'Waterfall', icon: BarChart3 },
  { type: 'heatmap', label: 'Heatmap', icon: Grid3x3 },
  { type: 'treemap', label: 'Treemap', icon: LayoutGrid },
  { type: 'sankey', label: 'Sankey', icon: Network },
  { type: 'funnel', label: 'Funnel', icon: Waves },
];

const AGGS: AggregationType[] = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'NONE'];
const SLICER_MODES: SlicerMode[] = ['dropdown', 'chips', 'search', 'range'];

export default function FieldsPane() {
  const selectedIds = useBuilderStore((s) => s.selectedWidgetIds);
  const report = useBuilderStore((s) => s.reportState);
  const updateWidget = useBuilderStore((s) => s.updateWidget);

  const page = getActivePage(report);
  const widget = selectedIds.length === 1 ? page.widgets.find((w) => w.id === selectedIds[0]) : undefined;

  if (!widget) {
    return (
      <PaneShell>
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-slate-500 px-6">
          <Filter className="w-6 h-6" />
          <p className="text-xs">
            {selectedIds.length > 1 ? 'Select a single widget to edit its data.' : 'Select a widget to configure its data.'}
          </p>
        </div>
      </PaneShell>
    );
  }

  return (
    <PaneShell>
      {/* Title + subtitle (all widget types) */}
      <Section title="General">
        <LabeledInput label="Title" value={widget.title} onChange={(v) => updateWidget(widget.id, { title: v })} />
        <LabeledInput label="Subtitle" value={widget.subtitle || ''} onChange={(v) => updateWidget(widget.id, { subtitle: v || undefined })} />
      </Section>

      {widget.type === 'chart' && <ChartFields widget={widget} updateWidget={updateWidget} />}
      {widget.type === 'slicer' && <SlicerFields widget={widget} updateWidget={updateWidget} />}
      {(widget.type === 'text' || widget.type === 'narrative') && (
        <Section title="Content">
          <textarea
            value={widget.content || ''}
            onChange={(e) => updateWidget(widget.id, { content: e.target.value })}
            rows={8}
            placeholder="Markdown supported: **bold**, ### heading, - bullet"
            className="w-full bg-darkBg border border-darkBorder rounded-lg px-2.5 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
          />
        </Section>
      )}
      {widget.type === 'image' && (
        <Section title="Image">
          <LabeledInput label="Image URL" value={widget.content || ''} onChange={(v) => updateWidget(widget.id, { content: v })} />
        </Section>
      )}
    </PaneShell>
  );
}

// ── Chart: visual type + data source + field buckets ────────────────────────────
function ChartFields({ widget, updateWidget }: { widget: any; updateWidget: (id: string, patch: any) => void }) {
  const connectedDatabases = useStore((s) => s.connectedDatabases);
  const activeDatabase = useStore((s) => s.activeDatabase);

  const [columns, setColumns] = useState<string[]>([]);
  const [loadingCols, setLoadingCols] = useState(false);
  const [rebinding, setRebinding] = useState(false);

  const bound = widget.databaseId != null && !!widget.sql;

  // Fetch the widget's own result columns (server-cached).
  useEffect(() => {
    if (!bound) {
      setColumns([]);
      return;
    }
    let cancelled = false;
    setLoadingCols(true);
    executeWidgetSql(widget.databaseId, widget.sql)
      .then((res) => {
        if (cancelled) return;
        setColumns(res.success ? res.columns : []);
      })
      .finally(() => !cancelled && setLoadingCols(false));
    return () => {
      cancelled = true;
    };
  }, [bound, widget.databaseId, widget.sql]);

  const fields: FieldMapping = widget.fields || { values: [] };
  const setFields = (patch: Partial<FieldMapping>) =>
    updateWidget(widget.id, { fields: { ...fields, ...patch } });

  return (
    <>
      <Section title="Visual type">
        <div className="grid grid-cols-4 gap-1.5">
          {VISUALS.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              onClick={() => updateWidget(widget.id, { chartType: type })}
              title={label}
              className={`flex flex-col items-center gap-1 py-2 rounded-lg border transition-all ${
                widget.chartType === type
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-darkBorder text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[8px] font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Data source">
        {bound && !rebinding ? (
          <div className="space-y-2">
            <div className="text-[10px] text-slate-400">
              <span className="text-slate-500">DB {widget.databaseId}</span>
              <code className="block mt-1 bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[9px] text-slate-300 truncate">{widget.sql}</code>
            </div>
            <button onClick={() => setRebinding(true)} className="text-[10px] text-blue-400 hover:text-blue-300">Change data source</button>
          </div>
        ) : (
          <DataBinder
            databases={connectedDatabases}
            defaultDbId={widget.databaseId ?? activeDatabase?.id ?? null}
            onBind={(databaseId, sql, table) => {
              updateWidget(widget.id, { databaseId, sql, question: widget.question || `All ${table}` });
              setRebinding(false);
            }}
            onCancel={bound ? () => setRebinding(false) : undefined}
          />
        )}
      </Section>

      {bound && (
        <Section title="Fields">
          {loadingCols ? (
            <p className="text-[10px] text-slate-500">Reading columns…</p>
          ) : columns.length === 0 ? (
            <p className="text-[10px] text-slate-500">No columns returned by this query.</p>
          ) : (
            <div className="space-y-3">
              <Bucket label="X-Axis / Category" icon={<Type className="w-3 h-3" />}>
                <SingleFieldSelect value={fields.xAxis} columns={columns} onChange={(v) => setFields({ xAxis: v })} placeholder="(none)" />
              </Bucket>

              <Bucket label="Values" icon={<Sigma className="w-3 h-3" />}>
                <div className="space-y-1.5">
                  {fields.values.map((v: ValueField, i: number) => (
                    <div key={i} className="flex items-center gap-1">
                      <select
                        value={v.agg}
                        onChange={(e) => {
                          const next = [...fields.values];
                          next[i] = { ...next[i], agg: e.target.value as AggregationType };
                          setFields({ values: next });
                        }}
                        className="bg-darkBg border border-darkBorder rounded-md px-1.5 py-1 text-[10px] text-blue-400 font-semibold focus:outline-none focus:border-blue-500"
                      >
                        {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <select
                        value={v.field}
                        onChange={(e) => {
                          const next = [...fields.values];
                          next[i] = { ...next[i], field: e.target.value };
                          setFields({ values: next });
                        }}
                        className="flex-1 bg-darkBg border border-darkBorder rounded-md px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500 min-w-0"
                      >
                        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button onClick={() => setFields({ values: fields.values.filter((_: any, j: number) => j !== i) })} className="text-slate-500 hover:text-red-400 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <AddFieldButton columns={columns} label="Add value" onAdd={(c) => setFields({ values: [...fields.values, { field: c, agg: 'SUM' }] })} />
                </div>
              </Bucket>

              <Bucket label="Legend / Series" icon={<PieChart className="w-3 h-3" />}>
                <SingleFieldSelect value={fields.legend} columns={columns} onChange={(v) => setFields({ legend: v })} placeholder="(none)" />
              </Bucket>

              <Bucket label="Tooltip" icon={<Plus className="w-3 h-3" />}>
                <div className="space-y-1.5">
                  {(fields.tooltip || []).map((tf: string, i: number) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="flex-1 bg-darkBg border border-darkBorder rounded-md px-2 py-1 text-[10px] text-slate-300 truncate">{tf}</span>
                      <button onClick={() => setFields({ tooltip: (fields.tooltip || []).filter((_: any, j: number) => j !== i) })} className="text-slate-500 hover:text-red-400 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <AddFieldButton columns={columns.filter((c) => !(fields.tooltip || []).includes(c))} label="Add tooltip field" onAdd={(c) => setFields({ tooltip: [...(fields.tooltip || []), c] })} />
                </div>
              </Bucket>
            </div>
          )}
        </Section>
      )}
    </>
  );
}

// ── Slicer configuration ─────────────────────────────────────────────────────────
function SlicerFields({ widget, updateWidget }: { widget: any; updateWidget: (id: string, patch: any) => void }) {
  const connectedDatabases = useStore((s) => s.connectedDatabases);
  const activeDatabase = useStore((s) => s.activeDatabase);
  const slicer = widget.slicer || { field: '', mode: 'dropdown' as SlicerMode };

  const [dbId, setDbId] = useState<number | null>(slicer.databaseId ?? activeDatabase?.id ?? null);
  const schema = useSchema(dbId);
  const tables = useMemo(() => Object.keys(schema), [schema]);
  const [table, setTable] = useState('');

  const cols = table ? schema[table] || [] : [];

  const commit = (patch: any) => updateWidget(widget.id, { slicer: { ...slicer, ...patch } });

  return (
    <Section title="Slicer">
      <Field label="Database">
        <select
          value={dbId ?? ''}
          onChange={(e) => setDbId(e.target.value ? Number(e.target.value) : null)}
          className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
        >
          <option value="">Select database…</option>
          {connectedDatabases.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>

      <Field label="Table">
        <select
          value={table}
          onChange={(e) => setTable(e.target.value)}
          disabled={!tables.length}
          className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        >
          <option value="">{tables.length ? 'Select table…' : 'No tables'}</option>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>

      <Field label="Field">
        <select
          value={slicer.field}
          onChange={(e) => {
            const col = e.target.value;
            const sql = `SELECT DISTINCT "${col}" AS "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL ORDER BY 1 LIMIT 1000`;
            commit({ field: col, databaseId: dbId, sourceSql: sql });
          }}
          disabled={!cols.length}
          className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        >
          <option value="">{cols.length ? 'Select field…' : 'Pick a table first'}</option>
          {cols.map((c) => <option key={c.column} value={c.column}>{c.column}</option>)}
        </select>
      </Field>

      <Field label="Mode">
        <div className="grid grid-cols-4 gap-1">
          {SLICER_MODES.map((m) => (
            <button
              key={m}
              onClick={() => commit({ mode: m })}
              className={`py-1.5 rounded-md text-[9px] font-semibold capitalize border transition-all ${
                slicer.mode === m ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-darkBorder text-slate-400 hover:border-slate-500'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </Field>
    </Section>
  );
}

// ── Data binder (database + table → SELECT *) ────────────────────────────────────
function DataBinder({
  databases, defaultDbId, onBind, onCancel,
}: {
  databases: any[];
  defaultDbId: number | null;
  onBind: (dbId: number, sql: string, table: string) => void;
  onCancel?: () => void;
}) {
  const [dbId, setDbId] = useState<number | null>(defaultDbId);
  const schema = useSchema(dbId);
  const tables = useMemo(() => Object.keys(schema), [schema]);
  const [table, setTable] = useState('');

  return (
    <div className="space-y-2">
      <select
        value={dbId ?? ''}
        onChange={(e) => { setDbId(e.target.value ? Number(e.target.value) : null); setTable(''); }}
        className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
      >
        <option value="">Select database…</option>
        {databases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select
        value={table}
        onChange={(e) => setTable(e.target.value)}
        disabled={!tables.length}
        className="w-full bg-darkBg border border-darkBorder rounded-lg px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
      >
        <option value="">{tables.length ? 'Select table…' : 'No tables'}</option>
        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="flex gap-2">
        <button
          disabled={dbId == null || !table}
          onClick={() => dbId != null && table && onBind(dbId, `SELECT * FROM "${table}" LIMIT 500`, table)}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold py-1.5 rounded-lg transition-colors"
        >
          Bind data
        </button>
        {onCancel && (
          <button onClick={onCancel} className="px-3 text-[11px] text-slate-400 hover:text-slate-200">Cancel</button>
        )}
      </div>
    </div>
  );
}

// ── Small schema-fetch hook (per-database, cached in module map) ──────────────────
const schemaCache = new Map<number, SchemaData>();
function useSchema(dbId: number | null): SchemaData {
  const [schema, setSchema] = useState<SchemaData>(dbId != null ? schemaCache.get(dbId) || {} : {});
  useEffect(() => {
    if (dbId == null) {
      setSchema({});
      return;
    }
    if (schemaCache.has(dbId)) {
      setSchema(schemaCache.get(dbId)!);
      return;
    }
    let cancelled = false;
    api
      .get(`/databases/${dbId}/schema`)
      .then((res) => {
        if (cancelled) return;
        const data = (res.data || {}) as SchemaData;
        schemaCache.set(dbId, data);
        setSchema(data);
      })
      .catch(() => !cancelled && setSchema({}));
    return () => {
      cancelled = true;
    };
  }, [dbId]);
  return schema;
}

// ── Presentational building blocks ─────────────────────────────────────────────
function PaneShell({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto p-3 space-y-4">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-darkBg border border-darkBorder rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
      />
    </Field>
  );
}

function Bucket({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-darkBg/40 border border-darkBorder rounded-lg p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-300 mb-1.5">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function SingleFieldSelect({ value, columns, onChange, placeholder }: { value?: string; columns: string[]; onChange: (v: string | undefined) => void; placeholder: string }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="w-full bg-darkBg border border-darkBorder rounded-md px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500"
    >
      <option value="">{placeholder}</option>
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

function AddFieldButton({ columns, label, onAdd }: { columns: string[]; label: string; onAdd: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300">
        <Plus className="w-3 h-3" /> {label}
      </button>
    );
  }
  return (
    <select
      autoFocus
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
        setOpen(false);
      }}
      onBlur={() => setOpen(false)}
      className="w-full bg-darkBg border border-blue-500 rounded-md px-2 py-1 text-[10px] text-slate-200 focus:outline-none"
    >
      <option value="">Choose field…</option>
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
