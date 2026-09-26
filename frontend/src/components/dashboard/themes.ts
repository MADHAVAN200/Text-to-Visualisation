/**
 * themes.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Report-level visual themes for the Dashboard Builder. A theme supplies the
 * default categorical palette and an accent used by charts that have no explicit
 * per-widget palette. Backgrounds intentionally reference the app's CSS variables
 * so every theme still inverts correctly under the global light/dark toggle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ReportTheme {
  id: string;
  name: string;
  palette: string[];
  accent: string;
  // CSS color tokens (kept as app vars so light/dark still applies).
  canvasBg: string;
  widgetBg: string;
}

export const THEMES: ReportTheme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    palette: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'],
    accent: '#3b82f6',
    canvasBg: 'var(--bg-main)',
    widgetBg: 'var(--bg-sidebar)',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    palette: ['#f97316', '#ef4444', '#f59e0b', '#ec4899', '#8b5cf6', '#eab308', '#fb7185'],
    accent: '#f97316',
    canvasBg: 'var(--bg-main)',
    widgetBg: 'var(--bg-sidebar)',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    palette: ['#06b6d4', '#3b82f6', '#14b8a6', '#0ea5e9', '#6366f1', '#22d3ee', '#2dd4bf'],
    accent: '#06b6d4',
    canvasBg: 'var(--bg-main)',
    widgetBg: 'var(--bg-sidebar)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    palette: ['#64748b', '#94a3b8', '#38bdf8', '#0ea5e9', '#475569', '#cbd5e1', '#0284c7'],
    accent: '#0ea5e9',
    canvasBg: 'var(--bg-main)',
    widgetBg: 'var(--bg-sidebar)',
  },
];

export function getTheme(id?: string): ReportTheme {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}
