/**
 * types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared type model for the Power BI-grade free-form Dashboard Builder.
 *
 * The full editor state (`ReportState`) is serialized to `dashboards.layout_json`
 * on the backend and is the source of truth when present. Legacy dashboards with
 * no `layout_json` are reconstructed from the normalized `dashboard_widgets` rows.
 *
 * Geometry is stored in *virtual design pixels* on a fixed-width design surface
 * (`ReportState.canvasWidth`, default 1280). The canvas scales that surface to the
 * container at render time, so a saved report looks identical on any viewport.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Core chart types rendered by Recharts; advanced types rendered by ECharts.
export type ChartType =
  // ── Recharts (core) ──
  | 'bar'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'combo'
  | 'kpi'
  | 'table'
  // ── ECharts (advanced) ──
  | 'gauge'
  | 'waterfall'
  | 'heatmap'
  | 'treemap'
  | 'sankey'
  | 'funnel';

// Chart types that must be dispatched to the ECharts renderer.
export const ECHARTS_TYPES: ChartType[] = [
  'gauge',
  'waterfall',
  'heatmap',
  'treemap',
  'sankey',
  'funnel',
];

export function isEchartsType(t?: ChartType | string | null): boolean {
  return !!t && (ECHARTS_TYPES as string[]).includes(t);
}

export type WidgetType = 'chart' | 'text' | 'narrative' | 'slicer' | 'image';

export type AggregationType = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'NONE';

export interface ValueField {
  field: string;
  agg: AggregationType;
}

// Data-mapping buckets edited in the Fields pane.
export interface FieldMapping {
  xAxis?: string;
  values: ValueField[];
  legend?: string; // series / color split
  tooltip?: string[];
}

export type ConditionalOp = '>' | '<' | '>=' | '<=' | '==' | '!=';

export interface ConditionalRule {
  field: string;
  op: ConditionalOp;
  value: number;
  color: string;
}

export type NumberFormat = 'plain' | 'compact' | 'currency' | 'percent';

// Visual formatting edited in the Formatting pane.
export interface FormattingConfig {
  palette?: string[];
  showDataLabels?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  axisMin?: number | null;
  axisMax?: number | null;
  showTrendline?: boolean;
  conditionalRules?: ConditionalRule[];
  headerColor?: string;
  subtitleColor?: string;
  numberFormat?: NumberFormat;
  backgroundColor?: string;
  borderRadius?: number;
  showHeader?: boolean;
}

export type SlicerMode = 'dropdown' | 'range' | 'search' | 'chips';

export interface SlicerConfig {
  field: string;
  mode: SlicerMode;
  databaseId?: number | null;
  sourceSql?: string; // query that yields distinct values
  selected?: any[];
  min?: number;
  max?: number;
}

// A single positioned item on the canvas.
export interface CanvasWidget {
  id: string;
  type: WidgetType;
  chartType?: ChartType; // when type === 'chart'
  title: string;
  subtitle?: string;

  // Geometry on the virtual design surface (px).
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  locked?: boolean;

  // Data binding (chart widgets).
  databaseId?: number | null;
  sql?: string; // query behind this widget
  question?: string; // NL provenance / display question
  fields?: FieldMapping;
  formatting?: FormattingConfig;

  // Text / narrative widgets.
  content?: string;

  // Slicer widgets.
  slicer?: SlicerConfig;

  // Drill-down column stack (client-side re-aggregation when present).
  drillPath?: string[];

  // Cross-filter role: does clicking an element here broadcast a selection?
  emitsCrossFilter?: boolean;

  // Backward-compat linkage to the legacy visualizations row (best-effort sync).
  visualizationId?: number | null;
}

export interface Page {
  id: string;
  name: string;
  widgets: CanvasWidget[];
  background?: string;
}

// A globally-applied filter (written by slicers, applied client-side).
export interface GlobalFilter {
  field: string;
  value: any;
  op?: ConditionalOp;
}

export interface ReportState {
  version: number;
  themeId: string;
  pages: Page[]; // forward-compatible multi-page; MVP uses pages[0]
  activePageId: string;
  canvasWidth: number; // virtual design width (px), default 1280
  globalFilters: GlobalFilter[];
}

// Cross-filter selection emitted by a chart element click.
export interface CrossFilterSelection {
  widgetId: string;
  field: string;
  value: any;
}

// ── Report state factory / helpers ────────────────────────────────────────────

export const DESIGN_WIDTH = 1280;
export const REPORT_VERSION = 1;

export function createEmptyReport(themeId = 'midnight'): ReportState {
  const pageId = 'page-1';
  return {
    version: REPORT_VERSION,
    themeId,
    pages: [{ id: pageId, name: 'Page 1', widgets: [] }],
    activePageId: pageId,
    canvasWidth: DESIGN_WIDTH,
    globalFilters: [],
  };
}

export function getActivePage(report: ReportState): Page {
  return report.pages.find((p) => p.id === report.activePageId) || report.pages[0];
}
