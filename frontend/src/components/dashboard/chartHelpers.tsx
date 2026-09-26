/**
 * chartHelpers.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared, framework-agnostic helpers for the Dashboard Builder. Extracted from
 * the original monolithic DashboardBuilder so the new modular components
 * (ChartRenderer / RechartsView / EChartsView / panes) and any retained legacy
 * code share a single implementation.
 *
 *   - executeWidgetSql : lazy widget data fetch via the /queries/ask sentinel
 *   - CHART_COLORS     : default categorical palette
 *   - formatKpiValue   : compact number formatting with currency/percent inference
 *   - parseMarkdownToReact : lightweight markdown → React for AI narratives
 *   - aggregate / applyFieldMapping / resolveChartData : the Fields-pane data layer
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { ReactNode } from 'react';
import api from '../../api';
import type { FieldMapping, ValueField, AggregationType, NumberFormat } from './types';

// ── Data fetch ────────────────────────────────────────────────────────────────

export interface WidgetSqlResult {
  success: boolean;
  columns: string[];
  rows: any[];
  error?: string;
}

// Re-run a widget's SQL directly against the backend (5-min server cache via the
// __dashboard_reload__ sentinel in backend/routes/queries.js).
export async function executeWidgetSql(databaseId: number, sql: string): Promise<WidgetSqlResult> {
  try {
    const res = await api.post('/queries/ask', {
      question: '__dashboard_reload__',
      database_id: databaseId,
      sql_query: sql,
    });
    if (res.data && res.data.results) {
      return {
        success: res.data.results.success !== false,
        columns: res.data.results.columns || [],
        rows: res.data.results.rows || [],
      };
    }
    return { success: false, columns: [], rows: [], error: 'Invalid response format' };
  } catch (err: any) {
    return { success: false, columns: [], rows: [], error: err.response?.data?.error || err.message };
  }
}

// ── Palette & formatting ────────────────────────────────────────────────────────

export const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

function compact(num: number): string {
  const abs = Math.abs(num);
  if (abs >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num % 1 === 0 ? num.toString() : num.toFixed(2);
}

export function formatKpiValue(value: any, columnName: string = '', format?: NumberFormat): string {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (isNaN(num)) return String(value);

  const colLower = columnName.toLowerCase();
  const inferredCurrency =
    colLower.includes('sales') || colLower.includes('revenue') || colLower.includes('amount') ||
    colLower.includes('price') || colLower.includes('cost') || colLower.includes('refund');
  const inferredPercent =
    colLower.includes('rate') || colLower.includes('percent') || colLower.includes('share') || colLower.includes('pct');

  // Explicit formatting overrides column-name inference.
  if (format === 'plain') return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (format === 'currency') return '$' + compact(num);
  if (format === 'percent') return compact(num) + '%';
  if (format === 'compact') return compact(num);

  const formatted = compact(num);
  if (inferredCurrency) return '$' + formatted;
  if (inferredPercent) return formatted + '%';
  return formatted;
}

// ── Markdown → React (AI narratives) ─────────────────────────────────────────────

export function parseMarkdownToReact(text: string): ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let currentListItems: ReactNode[] = [];

  const formatBold = (str: string) =>
    str.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-bold">$1</strong>');

  const flushList = (keyPrefix: number) => {
    if (currentListItems.length > 0) {
      elements.push(
        <ul key={`ul-${keyPrefix}`} className="space-y-1.5 pl-4 list-disc my-2">
          {currentListItems}
        </ul>
      );
      currentListItems = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(index);
      return;
    }

    if (trimmed.startsWith('###')) {
      flushList(index);
      const headingText = trimmed.replace(/^###\s*/, '');
      elements.push(
        <h4
          key={`h4-${index}`}
          className="text-emerald-400 font-bold text-xs mt-4 mb-2 flex items-center gap-1 border-b border-darkBorder/30 pb-1"
          dangerouslySetInnerHTML={{ __html: formatBold(headingText) }}
        />
      );
    } else if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
      const cleanLi = trimmed.replace(/^[-*•]\s*/, '');
      currentListItems.push(
        <li
          key={`li-${index}`}
          className="text-slate-300 text-xs leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formatBold(cleanLi) }}
        />
      );
    } else {
      flushList(index);
      elements.push(
        <p
          key={`p-${index}`}
          className="text-slate-300 leading-relaxed text-xs my-2"
          dangerouslySetInnerHTML={{ __html: formatBold(trimmed) }}
        />
      );
    }
  });

  flushList(lines.length);

  return <div className="space-y-1">{elements}</div>;
}

// ── The Fields-pane data layer ───────────────────────────────────────────────────

export interface ResolvedData {
  data: any[];
  xKey?: string;
  yKeys: string[];
}

// Aggregate a list of raw cell values under one aggregation function.
export function aggregate(vals: any[], agg: AggregationType): number {
  const present = vals.filter((v) => v !== null && v !== undefined && v !== '');
  if (agg === 'COUNT') return present.length;
  const nums = present.map(Number).filter((v) => !isNaN(v));
  if (nums.length === 0) return 0;
  switch (agg) {
    case 'AVG':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'MIN':
      return Math.min(...nums);
    case 'MAX':
      return Math.max(...nums);
    case 'NONE':
      return nums[0];
    case 'SUM':
    default:
      return nums.reduce((a, b) => a + b, 0);
  }
}

// Transform raw rows into chart-ready rows according to a FieldMapping.
// Supports: no-dimension single aggregate (KPI), group-by X, and legend pivot.
export function applyFieldMapping(rows: any[], fields: FieldMapping): ResolvedData {
  const values = fields.values || [];
  if (!rows || rows.length === 0 || values.length === 0) {
    return { data: rows || [], xKey: fields.xAxis, yKeys: values.map((v) => v.field) };
  }

  const xAxis = fields.xAxis;
  const legend = fields.legend;

  // Disambiguate duplicate value fields (e.g. SUM(sales) + AVG(sales)).
  const fieldCounts: Record<string, number> = {};
  values.forEach((v) => {
    fieldCounts[v.field] = (fieldCounts[v.field] || 0) + 1;
  });
  const outName = (v: ValueField) => (fieldCounts[v.field] > 1 ? `${v.agg}(${v.field})` : v.field);

  // No grouping dimension → single aggregate row.
  if (!xAxis && !legend) {
    const row: any = {};
    values.forEach((v) => {
      row[outName(v)] = aggregate(rows.map((r) => r[v.field]), v.agg);
    });
    return { data: [row], xKey: undefined, yKeys: values.map(outName) };
  }

  // Legend pivot: pivot the FIRST value field across distinct legend categories.
  if (legend) {
    const primary = values[0];
    const xs: any[] = [];
    const seenX = new Set<string>();
    const legendVals: any[] = [];
    const seenL = new Set<string>();
    for (const r of rows) {
      const xv = xAxis ? r[xAxis] : '';
      const xk = String(xv);
      if (!seenX.has(xk)) {
        seenX.add(xk);
        xs.push(xv);
      }
      const lk = String(r[legend]);
      if (!seenL.has(lk)) {
        seenL.add(lk);
        legendVals.push(r[legend]);
      }
    }
    const buckets: Record<string, Record<string, any[]>> = {};
    for (const r of rows) {
      const xk = String(xAxis ? r[xAxis] : '');
      const lk = String(r[legend]);
      (buckets[xk] ||= {});
      (buckets[xk][lk] ||= []).push(r[primary.field]);
    }
    const data = xs.map((xv) => {
      const xk = String(xv);
      const row: any = {};
      if (xAxis) row[xAxis] = xv;
      legendVals.forEach((lv) => {
        const lk = String(lv);
        const bucket = buckets[xk]?.[lk] || [];
        row[lk] = bucket.length ? aggregate(bucket, primary.agg) : 0;
      });
      return row;
    });
    return { data, xKey: xAxis, yKeys: legendVals.map(String) };
  }

  // Standard group-by on the X axis.
  const groups: Record<string, any[]> = {};
  const order: any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const xv = r[xAxis!];
    const xk = String(xv);
    if (!seen.has(xk)) {
      seen.add(xk);
      order.push(xv);
    }
    (groups[xk] ||= []).push(r);
  }
  const data = order.map((xv) => {
    const grp = groups[String(xv)];
    const row: any = { [xAxis!]: xv };
    values.forEach((v) => {
      row[outName(v)] = aggregate(grp.map((r) => r[v.field]), v.agg);
    });
    return row;
  });
  return { data, xKey: xAxis, yKeys: values.map(outName) };
}

// Detect whether a column reads as numeric across the sampled rows.
function isNumericColumn(rows: any[], col: string): boolean {
  let numeric = 0;
  let total = 0;
  for (const r of rows.slice(0, 25)) {
    const v = r[col];
    if (v === null || v === undefined || v === '') continue;
    total++;
    if (typeof v === 'number' || !isNaN(Number(v))) numeric++;
  }
  return total > 0 && numeric >= total * 0.6;
}

// Resolve final chart data + axes. Uses the FieldMapping when present, otherwise
// auto-detects a dimension + numeric measures from the raw result set (legacy path).
export function resolveChartData(rawRows: any[], fields?: FieldMapping, xAxisFallback?: string): ResolvedData {
  if (fields && fields.values && fields.values.length > 0) {
    return applyFieldMapping(rawRows, fields);
  }
  if (!rawRows || rawRows.length === 0) {
    return { data: [], xKey: fields?.xAxis || xAxisFallback, yKeys: [] };
  }
  const cols = Object.keys(rawRows[0]);
  const xKey = fields?.xAxis || xAxisFallback || cols[0];
  const numericCols = cols.filter((c) => c !== xKey && isNumericColumn(rawRows, c));
  const yKeys = numericCols.length > 0 ? numericCols : cols.filter((c) => c !== xKey).slice(0, 1);
  return { data: rawRows, xKey, yKeys };
}
