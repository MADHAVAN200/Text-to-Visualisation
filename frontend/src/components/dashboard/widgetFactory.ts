/**
 * widgetFactory.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Small shared helpers for creating and placing new CanvasWidgets. Used by both
 * the RibbonToolbar (blank widgets from the Visuals gallery) and the
 * AiSuggestionsDrawer (chart widgets from suggestions / NL prompts) so widget
 * ids, default sizes, and canvas placement stay consistent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useBuilderStore } from './builderStore';
import { getActivePage } from './types';
import type { ChartType, WidgetType } from './types';

export const genId = () => `w-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

// Sensible default footprint on the 1280px design surface, by widget/chart type.
export function defaultSize(type: WidgetType, chartType?: ChartType): { w: number; h: number } {
  if (type === 'slicer') return { w: 260, h: 140 };
  if (type === 'text' || type === 'narrative') return { w: 380, h: 180 };
  if (type === 'image') return { w: 360, h: 260 };
  if (chartType === 'kpi') return { w: 300, h: 150 };
  if (chartType === 'table') return { w: 620, h: 340 };
  return { w: 560, h: 320 };
}

// Stack a new widget below existing content (reads live store state).
export function nextSlot(): { x: number; y: number } {
  const page = getActivePage(useBuilderStore.getState().reportState);
  const maxBottom = page.widgets.reduce((m, x) => Math.max(m, x.y + x.h), 0);
  return { x: 24, y: page.widgets.length ? maxBottom + 24 : 24 };
}
