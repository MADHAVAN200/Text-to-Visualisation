/**
 * ChartRenderer.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Single entry point for rendering a chart widget's data. Applies incoming
 * cross-filter selections (client-side), resolves the FieldMapping into chart
 * data + axes, picks the palette, then dispatches to Recharts (core types) or
 * ECharts (advanced types).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useMemo } from 'react';
import type { CanvasWidget, CrossFilterSelection } from './types';
import { isEchartsType } from './types';
import { resolveChartData } from './chartHelpers';
import RechartsView from './charts/RechartsView';
import EChartsView from './charts/EChartsView';

interface ChartRendererProps {
  widget: CanvasWidget;
  rows: any[];
  themePalette: string[];
  activeSelections?: CrossFilterSelection[];
  onEmit?: (field: string, value: any) => void;
}

export default function ChartRenderer({ widget, rows, themePalette, activeSelections, onEmit }: ChartRendererProps) {
  const chartType = widget.chartType || 'bar';

  // Apply cross-filter selections emitted by OTHER widgets, client-side.
  const filteredRows = useMemo(() => {
    if (!activeSelections || activeSelections.length === 0 || !rows || rows.length === 0) return rows;
    const cols = Object.keys(rows[0]);
    const applicable = activeSelections.filter((s) => s.widgetId !== widget.id && cols.includes(s.field));
    if (applicable.length === 0) return rows;
    return rows.filter((r) =>
      applicable.every((s) => {
        const cell = r[s.field];
        // Range selection (from a range slicer): { min?, max? }.
        if (s.value && typeof s.value === 'object' && ('min' in s.value || 'max' in s.value)) {
          const n = Number(cell);
          if (isNaN(n)) return false;
          if (s.value.min != null && n < s.value.min) return false;
          if (s.value.max != null && n > s.value.max) return false;
          return true;
        }
        return String(cell) === String(s.value);
      })
    );
  }, [rows, activeSelections, widget.id]);

  const { data, xKey, yKeys } = useMemo(
    () => resolveChartData(filteredRows, widget.fields, widget.fields?.xAxis),
    [filteredRows, widget.fields]
  );

  const palette = widget.formatting?.palette && widget.formatting.palette.length > 0 ? widget.formatting.palette : themePalette;

  const emit = widget.emitsCrossFilter === false || !onEmit
    ? undefined
    : (value: any) => {
        if (xKey) onEmit(xKey, value);
      };

  if (isEchartsType(chartType)) {
    return (
      <EChartsView
        chartType={chartType}
        data={data}
        xKey={xKey}
        yKeys={yKeys}
        rawRows={filteredRows}
        fields={widget.fields}
        colors={palette}
        formatting={widget.formatting}
        onElementClick={emit}
      />
    );
  }

  return (
    <RechartsView
      chartType={chartType}
      xKey={xKey}
      yKeys={yKeys}
      data={data}
      colors={palette}
      formatting={widget.formatting}
      onElementClick={emit}
    />
  );
}
