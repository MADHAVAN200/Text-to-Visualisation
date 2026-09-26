/**
 * charts/RechartsView.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders the "core" chart family with Recharts v3:
 *   kpi · bar · stackedBar · line · area · pie · donut · scatter · combo · table
 *
 * Extends the original DashboardBuilder renderChart switch with stacked bars,
 * donuts, combo (bar+line), data labels, conditional colors, axis bounds, and a
 * least-squares trendline. Tables reuse the existing ExcelGrid component.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie,
  AreaChart, Area,
  Scatter,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend, LabelList,
} from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';
import ExcelGrid from '../../ExcelGrid';
import { formatKpiValue } from '../chartHelpers';
import type { ChartType, FormattingConfig, ConditionalRule } from '../types';

interface RechartsViewProps {
  chartType: ChartType;
  xKey?: string;
  yKeys: string[];
  data: any[];
  colors: string[];
  formatting?: FormattingConfig;
  onElementClick?: (value: any) => void;
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-sidebar)',
  borderColor: 'var(--border-color)',
  color: 'var(--slate-100)',
  fontSize: 10,
};

function matchRule(value: number, rule: ConditionalRule): boolean {
  switch (rule.op) {
    case '>': return value > rule.value;
    case '<': return value < rule.value;
    case '>=': return value >= rule.value;
    case '<=': return value <= rule.value;
    case '==': return value === rule.value;
    case '!=': return value !== rule.value;
    default: return false;
  }
}

function ruleColor(value: any, rules: ConditionalRule[] | undefined, fallback: string): string {
  if (!rules || rules.length === 0) return fallback;
  const n = Number(value);
  if (isNaN(n)) return fallback;
  for (const r of rules) {
    if (matchRule(n, r)) return r.color;
  }
  return fallback;
}

// Least-squares slope/intercept over (index, y) → data augmented with a __trend key.
function withTrend(data: any[], yKey: string): any[] {
  const pts = data.map((d, i) => [i, Number(d[yKey])]).filter((p) => !isNaN(p[1]));
  if (pts.length < 2) return data;
  const n = pts.length;
  const sx = pts.reduce((a, [x]) => a + x, 0);
  const sy = pts.reduce((a, [, y]) => a + y, 0);
  const sxx = pts.reduce((a, [x]) => a + x * x, 0);
  const sxy = pts.reduce((a, [x, y]) => a + x * y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return data;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return data.map((d, i) => ({ ...d, __trend: Math.round((slope * i + intercept) * 100) / 100 }));
}

export default function RechartsView({
  chartType,
  xKey,
  yKeys,
  data,
  colors,
  formatting,
  onElementClick,
}: RechartsViewProps) {
  const fmt = formatting || {};
  const showGrid = fmt.showGrid !== false;
  const showLegend = fmt.showLegend !== false;
  const showLabels = fmt.showDataLabels === true;
  const yDomain: [any, any] = [fmt.axisMin ?? 'auto', fmt.axisMax ?? 'auto'];

  if (!data || data.length === 0) {
    return <div className="flex items-center justify-center h-full text-slate-500 text-xs">No records to display.</div>;
  }

  const cols = Object.keys(data[0]);
  const resolvedX = xKey || cols[0];
  const resolvedY = yKeys && yKeys.length > 0 ? yKeys : [cols.find((k) => typeof data[0][k] === 'number') || cols[1]].filter(Boolean);

  // Single-row core charts read better as a KPI card (mirrors legacy behavior).
  let type: ChartType = chartType;
  if (data.length === 1 && (type === 'bar' || type === 'stackedBar' || type === 'line' || type === 'area' || type === 'pie' || type === 'donut' || type === 'scatter' || type === 'combo')) {
    type = 'kpi';
  }

  const emitX = (index: number) => {
    if (onElementClick && index != null && data[index]) onElementClick(data[index][resolvedX]);
  };

  switch (type) {
    case 'kpi': {
      const kpiKey = resolvedY[0] || '';
      if (!kpiKey) {
        return <div className="flex items-center justify-center h-full text-slate-500 text-xs">Select a metric to view KPI status.</div>;
      }
      const values = data.map((r) => Number(r[kpiKey])).filter((v) => !isNaN(v));
      const latestValue = values[values.length - 1] ?? 0;
      const sum = values.reduce((a, b) => a + b, 0);
      const firstValue = values[0] ?? 0;
      const displayValue = data.length === 1 ? latestValue : sum;
      const displayLabel = data.length === 1 ? 'Value' : 'Total Aggregate';
      let percentageChange = 0;
      if (data.length > 1 && firstValue !== 0) {
        percentageChange = ((latestValue - firstValue) / Math.abs(firstValue)) * 100;
      }
      return (
        <div className="flex flex-col justify-between h-full p-1.5 relative overflow-hidden">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
              {kpiKey.replace(/_/g, ' ')} ({displayLabel})
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white tracking-tight">
                {formatKpiValue(displayValue, kpiKey, fmt.numberFormat)}
              </span>
              {data.length > 1 && percentageChange !== 0 && (
                <span className={`text-[10px] font-bold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${percentageChange > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                  {percentageChange > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {percentageChange > 0 ? '+' : ''}{percentageChange.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          {data.length > 1 && (
            <div className="h-14 w-full mt-3 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="kpiSparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={percentageChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={percentageChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip contentStyle={{ ...TOOLTIP_STYLE, fontSize: 9, padding: '4px' }} labelStyle={{ fontSize: 9 }} />
                  <Area type="monotone" dataKey={kpiKey} stroke={percentageChange >= 0 ? '#10b981' : '#ef4444'} strokeWidth={1.8} fillOpacity={1} fill="url(#kpiSparkGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      );
    }

    case 'bar':
    case 'stackedBar': {
      const stacked = type === 'stackedBar';
      const singleWithRules = resolvedY.length === 1 && (fmt.conditionalRules?.length ?? 0) > 0;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />}
            <XAxis dataKey={resolvedX} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis domain={yDomain} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip cursor={{ fill: 'var(--tooltip-cursor-fill)' }} contentStyle={TOOLTIP_STYLE} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {resolvedY.map((yKey, idx) => (
              <Bar
                key={yKey}
                dataKey={yKey}
                fill={colors[idx % colors.length]}
                stackId={stacked ? 'stack' : undefined}
                radius={stacked ? [0, 0, 0, 0] : [2, 2, 0, 0]}
                onClick={(_: any, index: number) => emitX(index)}
              >
                {singleWithRules && data.map((row, i) => (
                  <Cell key={`c-${i}`} fill={ruleColor(row[yKey], fmt.conditionalRules, colors[idx % colors.length])} />
                ))}
                {showLabels && <LabelList dataKey={yKey} position="top" fontSize={9} fill="var(--slate-300)" />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'line': {
      const chartData = fmt.showTrendline && resolvedY[0] ? withTrend(data, resolvedY[0]) : data;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />}
            <XAxis dataKey={resolvedX} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis domain={yDomain} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {resolvedY.map((yKey, idx) => (
              <Line key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} strokeWidth={2} dot={false}>
                {showLabels && <LabelList dataKey={yKey} position="top" fontSize={9} fill="var(--slate-300)" />}
              </Line>
            ))}
            {fmt.showTrendline && resolvedY[0] && (
              <Line type="linear" dataKey="__trend" stroke="var(--slate-400)" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Trend" />
            )}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    case 'area':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {colors.map((color, idx) => (
                <linearGradient key={`grad-${idx}`} id={`dbGrad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />}
            <XAxis dataKey={resolvedX} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis domain={yDomain} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {resolvedY.map((yKey, idx) => (
              <Area key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} fill={`url(#dbGrad-${idx})`} strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );

    case 'pie':
    case 'donut':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={type === 'donut' ? '45%' : 0}
              outerRadius="70%"
              dataKey={resolvedY[0]}
              nameKey={resolvedX}
              label={showLabels ? ({ name, percent }: any) => `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%` : undefined}
              labelLine={false}
              onClick={(_: any, index: number) => emitX(index)}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      );

    case 'scatter': {
      const chartData = fmt.showTrendline && resolvedY[0] ? withTrend(data, resolvedY[0]) : data;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />}
            <XAxis type="category" dataKey={resolvedX} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis type="number" domain={yDomain} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Scatter dataKey={resolvedY[0]} fill={colors[0]} onClick={(_: any, index: number) => emitX(index)} />
            {fmt.showTrendline && resolvedY[0] && (
              <Line type="linear" dataKey="__trend" stroke="var(--slate-400)" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Trend" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    case 'combo':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />}
            <XAxis dataKey={resolvedX} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis domain={yDomain} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {resolvedY.map((yKey, idx) =>
              idx === 0 ? (
                <Bar key={yKey} dataKey={yKey} fill={colors[0]} radius={[2, 2, 0, 0]} onClick={(_: any, index: number) => emitX(index)} />
              ) : (
                <Line key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} strokeWidth={2} dot={false} />
              )
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );

    case 'table':
    default:
      return (
        <div className="h-full min-h-0">
          <ExcelGrid columns={cols} rows={data} />
        </div>
      );
  }
}
