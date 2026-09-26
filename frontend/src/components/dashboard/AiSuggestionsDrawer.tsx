/**
 * AiSuggestionsDrawer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The Proactive AI Copilot — a right-side slide-in drawer wired to /api/ai:
 *
 *   - Ask Copilot   : NL prompt → POST /queries/ask → places the returned
 *                     sql + chart spec as a CanvasWidget.
 *   - Suggestions   : POST /ai/suggest-charts → ranked chart chips; one click
 *                     adds that chart to the canvas.
 *   - Templates     : POST /ai/generate-dashboard → a ready ReportState loaded
 *                     onto the canvas (executive · ecommerce · activity).
 *   - Smart Narrative: POST /ai/explain-data on the selected widget's rows →
 *                     anomaly cards + a narrative that can be dropped in as a
 *                     narrative widget.
 *
 * Every feature degrades gracefully with no Groq key (the backend falls back to
 * heuristics / templated text); a "Zap" badge marks AI-powered responses.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, X, Send, Wand2, Lightbulb, AlertTriangle, LayoutTemplate,
  Loader2, Database, Plus, TrendingUp, FileText, RefreshCw, Zap, Check,
} from 'lucide-react';
import api from '../../api';
import { useStore } from '../../store/useStore';
import { useBuilderStore } from './builderStore';
import { executeWidgetSql, parseMarkdownToReact } from './chartHelpers';
import { getActivePage } from './types';
import { genId, nextSlot, defaultSize } from './widgetFactory';
import type { ChartType, AggregationType, CanvasWidget, ReportState } from './types';

interface AiSuggestionsDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface Suggestion {
  title: string;
  reason: string;
  chartType: ChartType;
  sql: string;
  fields: { xAxis?: string; values: { field: string; agg: AggregationType }[] };
  score: number;
}

interface Anomaly {
  severity: 'high' | 'medium' | 'low';
  metric: string;
  message: string;
}

const VALID_CHART_TYPES: ChartType[] = [
  'bar', 'stackedBar', 'line', 'area', 'pie', 'donut', 'scatter', 'combo', 'kpi', 'table',
  'gauge', 'waterfall', 'heatmap', 'treemap', 'sankey', 'funnel',
];

const TEMPLATES: { key: string; name: string; description: string; icon: React.ReactNode }[] = [
  { key: 'executive', name: 'Executive Overview', description: 'Headline KPIs, revenue trend, category mix.', icon: <TrendingUp className="w-4 h-4" /> },
  { key: 'ecommerce', name: 'E-commerce Performance', description: 'Revenue, products, customers, returns.', icon: <LayoutTemplate className="w-4 h-4" /> },
  { key: 'activity', name: 'Operations & Activity', description: 'Volume trends, status, recent activity.', icon: <Zap className="w-4 h-4" /> },
];

function coerceChartType(t?: string): ChartType {
  return t && (VALID_CHART_TYPES as string[]).includes(t) ? (t as ChartType) : 'bar';
}

export default function AiSuggestionsDrawer({ open, onClose }: AiSuggestionsDrawerProps) {
  const connectedDatabases = useStore((s) => s.connectedDatabases);
  const activeDatabase = useStore((s) => s.activeDatabase);
  const groqApiKey = useStore((s) => s.groqApiKey);

  const addWidget = useBuilderStore((s) => s.addWidget);
  const selectedWidgetIds = useBuilderStore((s) => s.selectedWidgetIds);
  const reportState = useBuilderStore((s) => s.reportState);

  const [dbId, setDbId] = useState<number | null>(activeDatabase?.id ?? null);

  // Ask Copilot
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestAiPowered, setSuggestAiPowered] = useState(false);
  const [addedTitles, setAddedTitles] = useState<Set<string>>(new Set());

  // Templates
  const [templateBusy, setTemplateBusy] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<string | null>(null);

  // Smart Narrative
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ anomalies: Anomaly[]; narrative: string; aiPowered: boolean } | null>(null);

  const hasDb = connectedDatabases.length > 0;

  // Default the target DB once databases arrive.
  useEffect(() => {
    if (dbId == null && (activeDatabase?.id != null || connectedDatabases[0]?.id != null)) {
      setDbId(activeDatabase?.id ?? connectedDatabases[0]?.id ?? null);
    }
  }, [activeDatabase, connectedDatabases, dbId]);

  const apiKey = groqApiKey || undefined;

  const selectedWidget = useMemo(() => {
    if (selectedWidgetIds.length !== 1) return undefined;
    return getActivePage(reportState).widgets.find((w) => w.id === selectedWidgetIds[0]);
  }, [selectedWidgetIds, reportState]);

  // ── Suggestions ─────────────────────────────────────────────────────────────
  const loadSuggestions = async (targetDb: number) => {
    setLoadingSuggestions(true);
    setSuggestError(null);
    try {
      const { data } = await api.post('/ai/suggest-charts', { database_id: targetDb, api_key: apiKey });
      const list: Suggestion[] = (data.suggestions || []).map((s: any) => ({
        title: String(s.title || 'Untitled'),
        reason: String(s.reason || ''),
        chartType: coerceChartType(s.chartType),
        sql: String(s.sql || ''),
        fields: {
          xAxis: s.fields?.xAxis || undefined,
          values: (s.fields?.values || []).map((v: any) => ({ field: String(v.field), agg: (v.agg || 'SUM') as AggregationType })),
        },
        score: Number(s.score || 0),
      }));
      setSuggestions(list);
      setSuggestAiPowered(!!data.ai_powered);
    } catch (err: any) {
      setSuggestError(err?.response?.data?.error || err?.message || 'Could not load suggestions.');
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Auto-load suggestions when the drawer opens or the target DB changes.
  useEffect(() => {
    if (open && dbId != null) void loadSuggestions(dbId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dbId]);

  const addSuggestion = (s: Suggestion) => {
    if (dbId == null) return;
    const size = defaultSize('chart', s.chartType);
    const slot = nextSlot();
    const widget: CanvasWidget = {
      id: genId(),
      type: 'chart',
      chartType: s.chartType,
      title: s.title,
      databaseId: dbId,
      sql: s.sql,
      fields: { xAxis: s.fields.xAxis, values: s.fields.values },
      formatting: { showLegend: true, showGrid: true },
      emitsCrossFilter: s.chartType !== 'kpi',
      x: slot.x,
      y: slot.y,
      w: size.w,
      h: size.h,
      z: 0,
    };
    addWidget(widget);
    setAddedTitles((prev) => new Set(prev).add(s.title));
  };

  // ── Ask Copilot (NL → widget) ─────────────────────────────────────────────────
  const askCopilot = async () => {
    const q = question.trim();
    if (!q || dbId == null) return;
    setAsking(true);
    setAskError(null);
    setLastAdded(null);
    try {
      const { data } = await api.post('/queries/ask', { question: q, database_id: dbId, api_key: apiKey });
      const sql: string = data.sql || data.sql_query || '';
      if (!sql) throw new Error('The copilot could not generate SQL for that question.');
      const chart = data.chart || {};
      const chartType = coerceChartType(chart.chart_type);
      const yAxis: string[] = Array.isArray(chart.y_axis) ? chart.y_axis : chart.y_axis ? [chart.y_axis] : [];
      const size = defaultSize('chart', chartType);
      const slot = nextSlot();
      const widget: CanvasWidget = {
        id: genId(),
        type: 'chart',
        chartType,
        title: q,
        question: q,
        databaseId: dbId,
        sql,
        fields: {
          xAxis: chart.x_axis || undefined,
          values: yAxis.map((f) => ({ field: String(f), agg: 'SUM' as AggregationType })),
        },
        formatting: { showLegend: true, showGrid: true },
        emitsCrossFilter: chartType !== 'kpi',
        x: slot.x,
        y: slot.y,
        w: size.w,
        h: size.h,
        z: 0,
      };
      addWidget(widget);
      setLastAdded(q);
      setQuestion('');
    } catch (err: any) {
      setAskError(err?.response?.data?.error || err?.message || 'The copilot request failed.');
    } finally {
      setAsking(false);
    }
  };

  // ── Templates (full-canvas generation) ────────────────────────────────────────
  const applyTemplate = async (key: string) => {
    if (dbId == null) return;
    const hasWidgets = getActivePage(useBuilderStore.getState().reportState).widgets.length > 0;
    if (hasWidgets && confirmTemplate !== key) {
      setConfirmTemplate(key);
      return;
    }
    setConfirmTemplate(null);
    setTemplateBusy(key);
    setTemplateError(null);
    try {
      const { data } = await api.post('/ai/generate-dashboard', { database_id: dbId, template: key, api_key: apiKey });
      const report = data.report_state as ReportState | undefined;
      if (!report || !report.pages) throw new Error('The template returned no report.');
      const store = useBuilderStore.getState();
      store.loadReport(store.dashboardId, report);
      await store.saveNow();
      onClose();
    } catch (err: any) {
      setTemplateError(err?.response?.data?.error || err?.message || 'Template generation failed.');
    } finally {
      setTemplateBusy(null);
    }
  };

  // ── Smart Narrative / anomalies ───────────────────────────────────────────────
  const explainSelected = async () => {
    if (!selectedWidget || selectedWidget.databaseId == null || !selectedWidget.sql) return;
    setExplaining(true);
    setExplainError(null);
    setExplain(null);
    try {
      const res = await executeWidgetSql(selectedWidget.databaseId, selectedWidget.sql);
      if (!res.success) throw new Error(res.error || 'The widget query failed.');
      const { data } = await api.post('/ai/explain-data', {
        columns: res.columns,
        rows: res.rows,
        question: selectedWidget.question || selectedWidget.title,
        api_key: apiKey,
      });
      setExplain({ anomalies: data.anomalies || [], narrative: data.narrative || '', aiPowered: !!data.ai_powered });
    } catch (err: any) {
      setExplainError(err?.response?.data?.error || err?.message || 'Analysis failed.');
    } finally {
      setExplaining(false);
    }
  };

  const insertNarrative = () => {
    if (!explain) return;
    const slot = nextSlot();
    addWidget({
      id: genId(),
      type: 'narrative',
      title: 'Smart Narrative',
      content: explain.narrative,
      x: slot.x,
      y: slot.y,
      w: 560,
      h: 220,
      z: 0,
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[75] bg-black/40" onClick={onClose} />

      {/* Panel */}
      <aside className="fixed top-0 right-0 bottom-0 z-[80] w-[384px] max-w-[92vw] bg-darkSidebar border-l border-darkBorder shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-darkBorder shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 leading-tight">AI Copilot</h2>
              <p className="text-[10px] text-slate-500 leading-tight">Proactive insights & generation</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-darkBg text-slate-400 hover:text-slate-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!hasDb ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-8 text-slate-500">
            <Database className="w-8 h-8" />
            <p className="text-xs leading-relaxed">Connect a database from the Connections page to unlock AI suggestions, templates, and narratives.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Target database */}
            <div>
              <Label>Analyze database</Label>
              <select
                value={dbId ?? ''}
                onChange={(e) => setDbId(e.target.value === '' ? null : Number(e.target.value))}
                className="w-full bg-darkBg border border-darkBorder rounded-lg px-2.5 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {connectedDatabases.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Ask Copilot */}
            <Section icon={<Wand2 className="w-3.5 h-3.5" />} title="Ask Copilot">
              <div className="flex items-end gap-2">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void askCopilot();
                    }
                  }}
                  rows={2}
                  placeholder="e.g. Monthly revenue by category"
                  className="flex-1 bg-darkBg border border-darkBorder rounded-lg px-2.5 py-2 text-[11px] text-slate-200 resize-none focus:outline-none focus:border-blue-500 leading-snug"
                />
                <button
                  onClick={() => void askCopilot()}
                  disabled={asking || !question.trim()}
                  className="h-9 w-9 shrink-0 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
                >
                  {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
              {lastAdded && (
                <p className="text-[10px] text-emerald-400 mt-1.5 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Added "{lastAdded}" to the canvas.
                </p>
              )}
              {askError && <p className="text-[10px] text-red-400 mt-1.5">{askError}</p>}
            </Section>

            {/* Templates */}
            <Section icon={<LayoutTemplate className="w-3.5 h-3.5" />} title="One-click dashboards">
              <div className="space-y-2">
                {TEMPLATES.map((t) => {
                  const busy = templateBusy === t.key;
                  const confirming = confirmTemplate === t.key;
                  return (
                    <div key={t.key} className="rounded-lg border border-darkBorder bg-darkBg overflow-hidden">
                      <button
                        onClick={() => void applyTemplate(t.key)}
                        disabled={!!templateBusy}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-darkSidebar disabled:opacity-50 transition-colors"
                      >
                        <span className="text-blue-400 shrink-0">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12px] font-semibold text-slate-200 truncate">{t.name}</span>
                          <span className="block text-[10px] text-slate-500 truncate">{t.description}</span>
                        </span>
                      </button>
                      {confirming && (
                        <div className="px-3 py-2 bg-amber-500/10 border-t border-amber-500/20 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-amber-300">Replace the current canvas?</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => void applyTemplate(t.key)} className="px-2 py-1 rounded-md bg-amber-500 text-black text-[10px] font-semibold hover:bg-amber-400">Replace</button>
                            <button onClick={() => setConfirmTemplate(null)} className="px-2 py-1 rounded-md border border-darkBorder text-slate-400 text-[10px] hover:text-slate-200">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {templateError && <p className="text-[10px] text-red-400 mt-1.5">{templateError}</p>}
            </Section>

            {/* Suggestions */}
            <Section
              icon={<Lightbulb className="w-3.5 h-3.5" />}
              title="Suggested visuals"
              aiBadge={suggestAiPowered}
              action={
                <button
                  onClick={() => dbId != null && void loadSuggestions(dbId)}
                  disabled={loadingSuggestions}
                  className="p-1 rounded-md hover:bg-darkBg text-slate-500 hover:text-slate-200 disabled:opacity-40"
                  title="Refresh suggestions"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingSuggestions ? 'animate-spin' : ''}`} />
                </button>
              }
            >
              {loadingSuggestions ? (
                <div className="flex items-center gap-2 text-slate-500 text-[11px] py-3">
                  <Loader2 className="w-4 h-4 animate-spin" /> Profiling the schema…
                </div>
              ) : suggestError ? (
                <p className="text-[10px] text-red-400 py-2">{suggestError}</p>
              ) : suggestions.length === 0 ? (
                <p className="text-[10px] text-slate-500 py-2">No suggestions — try syncing the database schema.</p>
              ) : (
                <div className="space-y-2">
                  {suggestions.map((s, i) => {
                    const added = addedTitles.has(s.title);
                    return (
                      <div key={i} className="rounded-lg border border-darkBorder bg-darkBg p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-bold uppercase tracking-wide text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{s.chartType}</span>
                              <h4 className="text-[11px] font-semibold text-slate-200 truncate">{s.title}</h4>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1 leading-snug">{s.reason}</p>
                          </div>
                          <button
                            onClick={() => addSuggestion(s)}
                            disabled={added}
                            className={`shrink-0 h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                              added ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-600 hover:bg-blue-500 text-white'
                            }`}
                            title={added ? 'Added' : 'Add to canvas'}
                          >
                            {added ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Smart Narrative */}
            <Section icon={<FileText className="w-3.5 h-3.5" />} title="Smart narrative" aiBadge={explain?.aiPowered}>
              {!selectedWidget || selectedWidget.type !== 'chart' || !selectedWidget.sql ? (
                <p className="text-[10px] text-slate-500 py-1">Select a data-bound chart on the canvas to analyze its results.</p>
              ) : (
                <button
                  onClick={() => void explainSelected()}
                  disabled={explaining}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-darkBorder text-[11px] font-semibold text-slate-200 hover:border-blue-500 hover:text-blue-400 disabled:opacity-50 transition-colors"
                >
                  {explaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Analyze "{selectedWidget.title}"
                </button>
              )}
              {explainError && <p className="text-[10px] text-red-400 mt-1.5">{explainError}</p>}

              {explain && (
                <div className="mt-3 space-y-2">
                  {explain.anomalies.length > 0 && (
                    <div className="space-y-1.5">
                      {explain.anomalies.map((a, i) => (
                        <div key={i} className={`flex items-start gap-2 p-2 rounded-lg border ${severityClass(a.severity)}`}>
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <p className="text-[10px] leading-snug">{a.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {explain.narrative && (
                    <div className="rounded-lg border border-darkBorder bg-darkBg p-3">
                      <div className="text-[11px] text-slate-300 leading-relaxed [&_h3]:text-slate-100 [&_strong]:text-slate-100">
                        {parseMarkdownToReact(explain.narrative)}
                      </div>
                      <button
                        onClick={insertNarrative}
                        className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-blue-400 hover:text-blue-300"
                      >
                        <Plus className="w-3 h-3" /> Add as narrative card
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Section>
          </div>
        )}
      </aside>
    </>
  );
}

function severityClass(sev: Anomaly['severity']): string {
  if (sev === 'high') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (sev === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-slate-600/40 bg-slate-500/10 text-slate-400';
}

// ── Presentational blocks ─────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">{children}</label>;
}

function Section({
  icon, title, children, action, aiBadge,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  aiBadge?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-slate-400">
          {icon}
          <h3 className="text-[11px] font-bold uppercase tracking-wider">{title}</h3>
          {aiBadge && (
            <span className="flex items-center gap-0.5 text-[8px] font-bold text-violet-300 bg-violet-500/15 px-1.5 py-0.5 rounded-full">
              <Zap className="w-2.5 h-2.5" /> AI
            </span>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
