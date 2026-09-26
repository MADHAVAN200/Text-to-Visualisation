/**
 * DashboardEditor.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * VIEW 2 of the Dashboard Builder — the Power BI-grade free-form editor shell.
 *
 * On mount it loads the dashboard from GET /dashboards/:id and builds a
 * ReportState for the builder store:
 *   - if `layout_json` is present, it is the source of truth (parsed → ReportState);
 *   - otherwise the legacy normalized `dashboard_widgets` rows are reconstructed
 *     into positioned CanvasWidgets (12-col width + height buckets → design px),
 *     so every pre-existing dashboard keeps rendering with zero migration.
 *
 * Layout: RibbonToolbar (top) · FieldsPane ‖ CanvasArea ‖ FormattingPane (body) ·
 * AiSuggestionsDrawer (right slide-in) · EmptyState (overlay on an empty canvas).
 * All state lives in useBuilderStore; this component only orchestrates load + chrome.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../api';
import { useBuilderStore } from './builderStore';
import {
  createEmptyReport, getActivePage, DESIGN_WIDTH, REPORT_VERSION,
} from './types';
import type {
  ReportState, CanvasWidget, ChartType, FieldMapping, AggregationType,
} from './types';
import { getTheme } from './themes';
import { genId } from './widgetFactory';
import RibbonToolbar from './RibbonToolbar';
import FieldsPane from './FieldsPane';
import FormattingPane from './FormattingPane';
import CanvasArea from './CanvasArea';
import EmptyState from './EmptyState';
import AiSuggestionsDrawer from './AiSuggestionsDrawer';

interface DashboardEditorProps {
  dashboardId: number;
  onBack: () => void;
}

const VALID_CHART_TYPES: ChartType[] = [
  'bar', 'stackedBar', 'line', 'area', 'pie', 'donut', 'scatter', 'combo', 'kpi', 'table',
  'gauge', 'waterfall', 'heatmap', 'treemap', 'sankey', 'funnel',
];

// Legacy-grid → design-pixel reconstruction constants.
const GUTTER = 16;
const ROW_UNIT = 92; // px per legacy height unit

function coerceChartType(t?: string | null): ChartType {
  return t && (VALID_CHART_TYPES as string[]).includes(t) ? (t as ChartType) : 'bar';
}

// Honor a legacy widget's stored axes when present; otherwise leave undefined so
// ChartRenderer auto-detects a dimension + numeric measures (the original default).
function legacyFields(cfg: any): FieldMapping | undefined {
  const x = typeof cfg?.x_axis === 'string' && cfg.x_axis ? cfg.x_axis : undefined;
  const rawY = cfg?.y_axis;
  const ys: string[] = Array.isArray(rawY) ? rawY.filter(Boolean) : typeof rawY === 'string' && rawY ? [rawY] : [];
  if (!x && ys.length === 0) return undefined;
  // Legacy queries are already aggregated → NONE keeps each row's value as-is.
  return { xAxis: x, values: ys.map((f) => ({ field: f, agg: 'NONE' as AggregationType })) };
}

// Parse a stored layout_json blob into a ReportState, normalizing forward-compat
// defaults. Returns null on anything unusable (falls back to legacy reconstruction).
function parseLayoutJson(raw: unknown): ReportState | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.pages) && obj.pages.length > 0) {
      return {
        version: typeof obj.version === 'number' ? obj.version : REPORT_VERSION,
        themeId: obj.themeId || 'midnight',
        pages: obj.pages,
        activePageId: obj.activePageId || obj.pages[0].id,
        canvasWidth: obj.canvasWidth || DESIGN_WIDTH,
        globalFilters: Array.isArray(obj.globalFilters) ? obj.globalFilters : [],
      };
    }
  } catch {
    /* malformed layout_json — reconstruct from legacy tables instead */
  }
  return null;
}

// Reconstruct a canvas from legacy normalized widgets. Widgets are flowed
// left-to-right (wrapping at canvasWidth) in their stored order, since legacy
// position_x/y were grid/order indices rather than reliable pixel coordinates.
function legacyToReportState(dash: any): ReportState {
  const report = createEmptyReport();
  const page = report.pages[0];
  const canvasWidth = report.canvasWidth;
  const colUnit = canvasWidth / 12;

  const src: any[] = Array.isArray(dash?.widgets) ? [...dash.widgets] : [];
  src.sort((a, b) => (a.position_y - b.position_y) || (a.position_x - b.position_x));

  const widgets: CanvasWidget[] = [];
  let cursorX = GUTTER;
  let cursorY = GUTTER;
  let rowMaxH = 0;
  let z = 1;

  for (const w of src) {
    const cfg = w?.visualization?.chart_config || {};
    const chartType = coerceChartType(cfg.chart_type || w?.visualization?.chart_type);
    const widthUnits = Math.min(12, Math.max(3, Number(w.width) || 6));
    const heightUnits = Math.min(10, Math.max(3, Number(w.height) || 4));
    const wpx = Math.max(160, Math.round(widthUnits * colUnit) - GUTTER);
    const hpx = Math.max(120, Math.round(heightUnits * ROW_UNIT));

    if (cursorX + wpx + GUTTER > canvasWidth) {
      cursorX = GUTTER;
      cursorY += rowMaxH + GUTTER;
      rowMaxH = 0;
    }

    const palette = Array.isArray(cfg.colors) && cfg.colors.length ? cfg.colors : undefined;
    widgets.push({
      id: genId(),
      type: 'chart',
      chartType,
      title: w?.query?.question || 'Chart',
      x: cursorX,
      y: cursorY,
      w: wpx,
      h: hpx,
      z: z++,
      databaseId: w?.query?.database_id ?? null,
      sql: w?.query?.generated_sql || '',
      question: w?.query?.question || '',
      fields: legacyFields(cfg),
      formatting: { showLegend: true, showGrid: true, palette },
      emitsCrossFilter: chartType !== 'kpi',
      visualizationId: w?.visualization?.id ?? null,
    });

    cursorX += wpx + GUTTER;
    rowMaxH = Math.max(rowMaxH, hpx);
  }

  page.widgets = widgets;
  return report;
}

export default function DashboardEditor({ dashboardId, onBack }: DashboardEditorProps) {
  const loadReport = useBuilderStore((s) => s.loadReport);
  const themeId = useBuilderStore((s) => s.reportState.themeId);
  const widgetCount = useBuilderStore((s) => getActivePage(s.reportState).widgets.length);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [meta, setMeta] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [aiOpen, setAiOpen] = useState(false);

  const palette = useMemo(() => getTheme(themeId).palette, [themeId]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    (async () => {
      try {
        const res = await api.get(`/dashboards/${dashboardId}`);
        if (cancelled) return;
        const dash = res.data || {};
        setMeta({ name: dash.name || 'Untitled dashboard', description: dash.description || '' });
        const report = parseLayoutJson(dash.layout_json) || legacyToReportState(dash);
        loadReport(dashboardId, report);
        setStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err?.response?.data?.error || 'Failed to load this dashboard.');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardId, loadReport]);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[600px] gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs">Loading report…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[600px] gap-3 text-center px-6">
        <AlertTriangle className="w-7 h-7 text-red-400" />
        <p className="text-sm text-slate-300">{errorMsg}</p>
        <button
          onClick={onBack}
          className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-darkSidebar border border-darkBorder text-slate-300 hover:text-white hover:border-slate-600 text-xs font-semibold transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboards
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[600px] rounded-2xl overflow-hidden border border-darkBorder bg-darkBg shadow-lg">
      {/* Editor header: back + title */}
      <header className="h-14 flex items-center gap-3 px-4 border-b border-darkBorder bg-slate-900 shrink-0">
        <button
          onClick={onBack}
          title="Back to dashboards"
          className="p-2 bg-darkBg border border-darkBorder hover:border-slate-600 hover:text-white text-slate-300 rounded-xl transition-all shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-100 leading-none truncate">{meta.name}</h2>
            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
              Editor
            </span>
          </div>
          {meta.description && <p className="text-[10px] text-slate-500 mt-1 truncate">{meta.description}</p>}
        </div>
      </header>

      {/* Command ribbon */}
      <RibbonToolbar onOpenAi={() => setAiOpen(true)} />

      {/* Body: Fields ‖ Canvas ‖ Formatting */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-[280px] shrink-0 border-r border-darkBorder bg-darkSidebar overflow-hidden">
          <FieldsPane />
        </aside>

        <main className="flex-1 relative min-w-0 bg-darkBg">
          <CanvasArea themePalette={palette} />
          {widgetCount === 0 && <EmptyState onOpenAi={() => setAiOpen(true)} />}
        </main>

        <aside className="w-[280px] shrink-0 border-l border-darkBorder bg-darkSidebar overflow-hidden">
          <FormattingPane />
        </aside>
      </div>

      {/* Proactive AI Copilot */}
      <AiSuggestionsDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
