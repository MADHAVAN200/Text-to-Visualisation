/**
 * charts/EChartsView.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders the "advanced" chart family with Apache ECharts:
 *   gauge · waterfall · heatmap · treemap · sankey · funnel
 *
 * ECharts is imported from `echarts/core` with explicit chart/component
 * registration so Vite can tree-shake the bundle. `useEChartsTheme()` reads the
 * app's CSS variables so ECharts matches Recharts under light/dark + report themes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { GaugeChart, TreemapChart, SankeyChart, FunnelChart, HeatmapChart, BarChart } from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
  VisualMapComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useStore } from '../../../store/useStore';
import type { ChartType, FieldMapping, FormattingConfig } from '../types';

echarts.use([
  GaugeChart,
  TreemapChart,
  SankeyChart,
  FunnelChart,
  HeatmapChart,
  BarChart,
  TooltipComponent,
  GridComponent,
  VisualMapComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

interface EChartsViewProps {
  chartType: ChartType;
  data: any[];
  xKey?: string;
  yKeys: string[];
  rawRows: any[];
  fields?: FieldMapping;
  colors: string[];
  formatting?: FormattingConfig;
  onElementClick?: (value: any) => void;
}

interface EChartsTheme {
  axis: string;
  grid: string;
  text: string;
  bg: string;
  border: string;
}

// Read a hex CSS variable (e.g. --slate-400 → "#8b949e").
function readHex(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Read a "R G B" triplet CSS variable (e.g. --bg-sidebar → "rgb(22 27 34)").
function readRgb(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v})` : fallback;
}

function useEChartsTheme(): EChartsTheme {
  const theme = useStore((s) => s.theme);
  return useMemo<EChartsTheme>(
    () => ({
      axis: readHex('--slate-400', '#8b949e'),
      grid: readHex('--slate-700', '#30363d'),
      text: readHex('--slate-300', '#b1bac4'),
      bg: readRgb('--bg-sidebar', 'rgb(22 27 34)'),
      border: readRgb('--border-color', 'rgb(48 54 61)'),
    }),
    // Recompute whenever the global light/dark theme flips.
    [theme]
  );
}

const num = (v: any): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil((value * 1.15) / mag) * mag;
}

function EmptyMsg({ text }: { text: string }) {
  return <div className="flex items-center justify-center h-full text-slate-500 text-xs px-4 text-center">{text}</div>;
}

export default function EChartsView({
  chartType,
  data,
  xKey,
  yKeys,
  rawRows,
  fields,
  colors,
  formatting,
  onElementClick,
}: EChartsViewProps) {
  const t = useEChartsTheme();

  const tooltip = { backgroundColor: t.bg, borderColor: t.border, textStyle: { color: t.text, fontSize: 11 } };
  const baseText = { color: t.text, fontSize: 10 };

  const option = useMemo<any>(() => {
    const yKey = yKeys[0];

    switch (chartType) {
      case 'gauge': {
        const value = data.length ? num(data[data.length - 1][yKey ?? '']) : 0;
        const max = formatting?.axisMax ?? niceMax(value);
        return {
          tooltip: { ...tooltip, formatter: '{b}: {c}' },
          series: [
            {
              type: 'gauge',
              min: formatting?.axisMin ?? 0,
              max,
              progress: { show: true, width: 14, itemStyle: { color: colors[0] } },
              axisLine: { lineStyle: { width: 14, color: [[1, t.grid]] } },
              axisTick: { show: false },
              splitLine: { length: 10, lineStyle: { color: t.axis } },
              axisLabel: { color: t.axis, fontSize: 9, distance: 14 },
              pointer: { itemStyle: { color: colors[0] } },
              anchor: { show: true, size: 12, itemStyle: { color: colors[0] } },
              detail: { valueAnimation: true, fontSize: 22, color: t.text, offsetCenter: [0, '68%'] },
              title: { color: t.axis, fontSize: 11 },
              data: [{ value: Math.round(value * 100) / 100, name: (yKey || '').replace(/_/g, ' ') }],
            },
          ],
        };
      }

      case 'funnel': {
        if (!data.length || !yKey) return null;
        const items = data
          .map((r) => ({ name: String(r[xKey ?? ''] ?? r[yKey]), value: num(r[yKey]) }))
          .sort((a, b) => b.value - a.value);
        return {
          tooltip: { ...tooltip, trigger: 'item', formatter: '{b}: {c}' },
          color: colors,
          legend: formatting?.showLegend !== false ? { textStyle: baseText, bottom: 0 } : undefined,
          series: [
            {
              type: 'funnel',
              left: '8%',
              right: '8%',
              top: 10,
              bottom: 28,
              minSize: '14%',
              gap: 2,
              label: { show: formatting?.showDataLabels !== false, color: '#fff', fontSize: 10 },
              itemStyle: { borderColor: t.bg, borderWidth: 1 },
              data: items,
            },
          ],
        };
      }

      case 'treemap': {
        if (!data.length || !yKey) return null;
        const items = data.map((r, i) => ({
          name: String(r[xKey ?? ''] ?? `Item ${i + 1}`),
          value: num(r[yKey]),
          itemStyle: { color: colors[i % colors.length] },
        }));
        return {
          tooltip: { ...tooltip, formatter: '{b}: {c}' },
          series: [
            {
              type: 'treemap',
              roam: false,
              nodeClick: false,
              breadcrumb: { show: false },
              label: { show: formatting?.showDataLabels !== false, color: '#fff', fontSize: 11 },
              itemStyle: { borderColor: t.bg, borderWidth: 2, gapWidth: 2 },
              data: items,
            },
          ],
        };
      }

      case 'waterfall': {
        if (!data.length || !yKey) return null;
        const cats = data.map((r) => String(r[xKey ?? ''] ?? ''));
        const deltas = data.map((r) => num(r[yKey]));
        const base: number[] = [];
        const rising: (number | string)[] = [];
        let running = 0;
        for (const d of deltas) {
          if (d >= 0) {
            base.push(running);
            rising.push(d);
          } else {
            base.push(running + d);
            rising.push(-d);
          }
          running += d;
        }
        return {
          tooltip: {
            ...tooltip,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params: any[]) => {
              const idx = params[0].dataIndex;
              return `${cats[idx]}<br/>Δ ${deltas[idx]}`;
            },
          },
          grid: { left: 48, right: 16, top: 20, bottom: 40 },
          xAxis: {
            type: 'category',
            data: cats,
            axisLine: { lineStyle: { color: t.axis } },
            axisLabel: { color: t.axis, fontSize: 9 },
          },
          yAxis: {
            type: 'value',
            splitLine: { show: formatting?.showGrid !== false, lineStyle: { color: t.grid } },
            axisLabel: { color: t.axis, fontSize: 9 },
          },
          series: [
            { type: 'bar', stack: 'wf', itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: base },
            {
              type: 'bar',
              stack: 'wf',
              label: { show: formatting?.showDataLabels === true, position: 'top', color: t.text, fontSize: 9 },
              itemStyle: {
                color: (p: any) => (deltas[p.dataIndex] >= 0 ? colors[1] || '#10b981' : colors[3] || '#ef4444'),
              },
              data: rising,
            },
          ],
        };
      }

      case 'heatmap': {
        // Long-format from raw rows: (x, y, value). Fall back to first columns.
        const rows = rawRows && rawRows.length ? rawRows : data;
        if (!rows.length) return null;
        const cols = Object.keys(rows[0]);
        const xf = fields?.xAxis || xKey || cols[0];
        const yf = fields?.legend || cols.find((c) => c !== xf) || cols[1];
        const vf = fields?.values?.[0]?.field || cols.find((c) => c !== xf && c !== yf) || cols[2];
        if (!xf || !yf || !vf) return null;
        const xCats: string[] = [];
        const yCats: string[] = [];
        const agg: Record<string, number> = {};
        let maxV = 0;
        for (const r of rows) {
          const xv = String(r[xf]);
          const yv = String(r[yf]);
          if (!xCats.includes(xv)) xCats.push(xv);
          if (!yCats.includes(yv)) yCats.push(yv);
          const key = `${xv}||${yv}`;
          agg[key] = (agg[key] || 0) + num(r[vf]);
          if (agg[key] > maxV) maxV = agg[key];
        }
        const points = Object.entries(agg).map(([k, v]) => {
          const [xv, yv] = k.split('||');
          return [xCats.indexOf(xv), yCats.indexOf(yv), Math.round(v * 100) / 100];
        });
        return {
          tooltip: { ...tooltip, position: 'top' },
          grid: { left: 70, right: 16, top: 16, bottom: 60 },
          xAxis: { type: 'category', data: xCats, axisLabel: { color: t.axis, fontSize: 9, rotate: xCats.length > 6 ? 35 : 0 }, splitArea: { show: true } },
          yAxis: { type: 'category', data: yCats, axisLabel: { color: t.axis, fontSize: 9 }, splitArea: { show: true } },
          visualMap: {
            min: 0,
            max: maxV || 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            textStyle: { color: t.axis, fontSize: 9 },
            inRange: { color: [t.bg, colors[0], colors[3] || '#ef4444'] },
          },
          series: [
            {
              type: 'heatmap',
              data: points,
              label: { show: formatting?.showDataLabels === true, fontSize: 9, color: '#fff' },
              emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.4)' } },
            },
          ],
        };
      }

      case 'sankey': {
        // Needs (source, target, value). Fall back to first two string columns.
        const rows = rawRows && rawRows.length ? rawRows : data;
        if (!rows.length) return null;
        const cols = Object.keys(rows[0]);
        const sf = fields?.xAxis || cols[0];
        const tf = fields?.legend || cols.find((c) => c !== sf) || cols[1];
        const vf = fields?.values?.[0]?.field || cols.find((c) => c !== sf && c !== tf);
        if (!sf || !tf || sf === tf) return null;
        const linkAgg: Record<string, number> = {};
        const nodeSet = new Set<string>();
        for (const r of rows) {
          const s = String(r[sf]);
          const tg = String(r[tf]);
          if (s === tg) continue;
          nodeSet.add(s);
          nodeSet.add(tg);
          const key = `${s}||${tg}`;
          linkAgg[key] = (linkAgg[key] || 0) + (vf ? num(r[vf]) : 1);
        }
        const links = Object.entries(linkAgg).map(([k, v]) => {
          const [source, target] = k.split('||');
          return { source, target, value: v };
        });
        if (!links.length) return null;
        return {
          tooltip: { ...tooltip, trigger: 'item' },
          series: [
            {
              type: 'sankey',
              left: 8,
              right: 8,
              top: 10,
              bottom: 10,
              nodeWidth: 14,
              nodeGap: 8,
              data: Array.from(nodeSet).map((n, i) => ({ name: n, itemStyle: { color: colors[i % colors.length] } })),
              links,
              label: { color: t.text, fontSize: 10 },
              lineStyle: { color: 'gradient', opacity: 0.4 },
            },
          ],
        };
      }

      default:
        return null;
    }
  }, [chartType, data, xKey, yKeys, rawRows, fields, colors, formatting, t]);

  const events = useMemo(
    () => ({
      click: (params: any) => {
        if (onElementClick && params && params.name != null) onElementClick(params.name);
      },
    }),
    [onElementClick]
  );

  if (!option) {
    return <EmptyMsg text={`Not enough columns to render a ${chartType} chart. Map fields in the Fields pane.`} />;
  }

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      onEvents={events}
      style={{ height: '100%', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
}
