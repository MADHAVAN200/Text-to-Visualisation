/**
 * builderStore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zustand store driving the free-form Dashboard Builder editor (VIEW 2).
 *
 *   - reportState        : the authoritative, serializable report (→ layout_json)
 *   - selectedWidgetIds  : current canvas selection (drives Fields/Formatting panes)
 *   - history / future   : undo/redo snapshot stacks
 *   - snapEnabled        : snap-to-grid toggle
 *   - activeSelections   : cross-filter selections emitted by chart clicks
 *   - saving / dirty     : autosave status (debounced localStorage + server PUT)
 *
 * Discrete mutations push an undo snapshot and schedule an autosave. Continuous
 * pointer transforms (drag/resize) call beginTransform() once, mutate live via
 * transformWidgets() with no per-frame history, then endTransform() to persist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { create } from 'zustand';
import api from '../../api';
import type { CanvasWidget, ReportState, CrossFilterSelection, Page } from './types';
import { getActivePage, createEmptyReport } from './types';

const HISTORY_LIMIT = 60;
const AUTOSAVE_DELAY = 900;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function cloneReport(r: ReportState): ReportState {
  return structuredClone(r);
}

function lsKey(id: number | null): string {
  return `v2v_report_${id ?? 'draft'}`;
}

// ── Module-level debounced persistence ───────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(get: () => BuilderState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persist(get());
  }, AUTOSAVE_DELAY);
}

async function persist(state: BuilderState) {
  const { dashboardId, reportState } = state;
  const json = JSON.stringify(reportState);
  try {
    localStorage.setItem(lsKey(dashboardId), json);
  } catch {
    /* localStorage may be full/unavailable — non-fatal */
  }
  if (dashboardId == null) {
    state._set({ dirty: false, saving: 'saved' });
    return;
  }
  state._set({ saving: 'saving' });
  try {
    // layout_json is authoritative. Legacy dashboard_widgets sync is handled
    // best-effort server-side; we intentionally send only the report state here
    // to avoid duplicating/mutating shared visualization rows from the client.
    await api.put(`/dashboards/${dashboardId}/report`, { layout_json: json });
    state._set({ dirty: false, saving: 'saved' });
  } catch {
    state._set({ saving: 'error' });
  }
}

// ── Store shape ──────────────────────────────────────────────────────────────────
interface BuilderState {
  dashboardId: number | null;
  reportState: ReportState;
  selectedWidgetIds: string[];
  history: ReportState[];
  future: ReportState[];
  snapEnabled: boolean;
  activeSelections: CrossFilterSelection[];
  dirty: boolean;
  saving: SaveStatus;

  // internal escape hatch used by the module-level persist()
  _set: (partial: Partial<BuilderState>) => void;

  // lifecycle
  loadReport: (dashboardId: number | null, report: ReportState) => void;

  // discrete mutations (history + autosave)
  addWidget: (widget: CanvasWidget) => void;
  updateWidget: (id: string, patch: Partial<CanvasWidget>, pushHistory?: boolean) => void;
  removeWidgets: (ids: string[]) => void;
  duplicateWidget: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  toggleLock: (id: string) => void;
  setThemeId: (themeId: string) => void;

  // continuous pointer transforms
  beginTransform: () => void;
  transformWidgets: (patches: Record<string, Partial<CanvasWidget>>) => void;
  endTransform: () => void;

  // selection
  select: (id: string | null, additive?: boolean) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;

  // undo / redo / snap
  undo: () => void;
  redo: () => void;
  setSnap: (v: boolean) => void;

  // cross-filter
  setCrossFilter: (sel: CrossFilterSelection) => void;
  clearCrossFilters: () => void;

  // manual save
  saveNow: () => Promise<void>;
}

export const useBuilderStore = create<BuilderState>((set, get) => {
  // Commit a producer against a cloned report, pushing an undo snapshot.
  const apply = (producer: (r: ReportState) => void, pushHistory = true) => {
    const prev = get().reportState;
    const next = cloneReport(prev);
    producer(next);
    set((s) => ({
      reportState: next,
      history: pushHistory ? [...s.history, prev].slice(-HISTORY_LIMIT) : s.history,
      future: pushHistory ? [] : s.future,
      dirty: true,
      saving: 'idle',
    }));
    schedulePersist(get);
  };

  const mutateActivePage = (r: ReportState, fn: (p: Page) => void) => {
    const page = getActivePage(r);
    fn(page);
  };

  return {
    dashboardId: null,
    reportState: createEmptyReport(),
    selectedWidgetIds: [],
    history: [],
    future: [],
    snapEnabled: true,
    activeSelections: [],
    dirty: false,
    saving: 'idle',

    _set: (partial) => set(partial as BuilderState),

    loadReport: (dashboardId, report) =>
      set({
        dashboardId,
        reportState: report,
        selectedWidgetIds: [],
        history: [],
        future: [],
        activeSelections: [],
        dirty: false,
        saving: 'idle',
      }),

    addWidget: (widget) => {
      apply((r) =>
        mutateActivePage(r, (p) => {
          const maxZ = p.widgets.reduce((m, w) => Math.max(m, w.z), 0);
          p.widgets.push({ ...widget, z: maxZ + 1 });
        })
      );
      set({ selectedWidgetIds: [widget.id] });
    },

    updateWidget: (id, patch, pushHistory = true) => {
      apply((r) =>
        mutateActivePage(r, (p) => {
          const w = p.widgets.find((x) => x.id === id);
          if (w) Object.assign(w, patch);
        }),
        pushHistory
      );
    },

    removeWidgets: (ids) => {
      apply((r) =>
        mutateActivePage(r, (p) => {
          p.widgets = p.widgets.filter((w) => !ids.includes(w.id));
        })
      );
      set((s) => ({ selectedWidgetIds: s.selectedWidgetIds.filter((id) => !ids.includes(id)) }));
    },

    duplicateWidget: (id) => {
      const newId = `w-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
      apply((r) =>
        mutateActivePage(r, (p) => {
          const w = p.widgets.find((x) => x.id === id);
          if (!w) return;
          const maxZ = p.widgets.reduce((m, x) => Math.max(m, x.z), 0);
          p.widgets.push({ ...cloneWidget(w), id: newId, x: w.x + 24, y: w.y + 24, z: maxZ + 1 });
        })
      );
      set({ selectedWidgetIds: [newId] });
    },

    bringToFront: (id) => {
      apply((r) =>
        mutateActivePage(r, (p) => {
          const maxZ = p.widgets.reduce((m, w) => Math.max(m, w.z), 0);
          const w = p.widgets.find((x) => x.id === id);
          if (w) w.z = maxZ + 1;
        })
      );
    },

    sendToBack: (id) => {
      apply((r) =>
        mutateActivePage(r, (p) => {
          const minZ = p.widgets.reduce((m, w) => Math.min(m, w.z), 0);
          const w = p.widgets.find((x) => x.id === id);
          if (w) w.z = minZ - 1;
        })
      );
    },

    toggleLock: (id) => {
      apply((r) =>
        mutateActivePage(r, (p) => {
          const w = p.widgets.find((x) => x.id === id);
          if (w) w.locked = !w.locked;
        })
      );
    },

    setThemeId: (themeId) => {
      apply((r) => {
        r.themeId = themeId;
      });
    },

    beginTransform: () => {
      const prev = get().reportState;
      set((s) => ({ history: [...s.history, prev].slice(-HISTORY_LIMIT), future: [] }));
    },

    transformWidgets: (patches) => {
      // Live geometry update — no history push, no immediate autosave.
      const next = cloneReport(get().reportState);
      mutateActivePage(next, (p) => {
        p.widgets.forEach((w) => {
          const patch = patches[w.id];
          if (patch) Object.assign(w, patch);
        });
      });
      set({ reportState: next, dirty: true });
    },

    endTransform: () => {
      set({ saving: 'idle' });
      schedulePersist(get);
    },

    select: (id, additive = false) => {
      if (id == null) {
        set({ selectedWidgetIds: [] });
        return;
      }
      set((s) => {
        if (!additive) return { selectedWidgetIds: [id] };
        return s.selectedWidgetIds.includes(id)
          ? { selectedWidgetIds: s.selectedWidgetIds.filter((x) => x !== id) }
          : { selectedWidgetIds: [...s.selectedWidgetIds, id] };
      });
    },

    selectMany: (ids) => set({ selectedWidgetIds: ids }),

    clearSelection: () => set({ selectedWidgetIds: [] }),

    undo: () => {
      const { history, reportState } = get();
      if (history.length === 0) return;
      const prev = history[history.length - 1];
      set((s) => ({
        reportState: prev,
        history: s.history.slice(0, -1),
        future: [reportState, ...s.future].slice(0, HISTORY_LIMIT),
        dirty: true,
        saving: 'idle',
      }));
      schedulePersist(get);
    },

    redo: () => {
      const { future, reportState } = get();
      if (future.length === 0) return;
      const next = future[0];
      set((s) => ({
        reportState: next,
        future: s.future.slice(1),
        history: [...s.history, reportState].slice(-HISTORY_LIMIT),
        dirty: true,
        saving: 'idle',
      }));
      schedulePersist(get);
    },

    setSnap: (v) => set({ snapEnabled: v }),

    setCrossFilter: (sel) => {
      set((s) => {
        // Empty value clears this widget's selection (e.g. slicer reset to "All").
        if (sel.value === null || sel.value === undefined || sel.value === '') {
          return { activeSelections: s.activeSelections.filter((x) => x.widgetId !== sel.widgetId) };
        }
        const existing = s.activeSelections.find((x) => x.widgetId === sel.widgetId);
        // Toggle off if the exact same value is clicked again.
        if (existing && existing.field === sel.field && String(existing.value) === String(sel.value)) {
          return { activeSelections: s.activeSelections.filter((x) => x.widgetId !== sel.widgetId) };
        }
        return {
          activeSelections: [...s.activeSelections.filter((x) => x.widgetId !== sel.widgetId), sel],
        };
      });
    },

    clearCrossFilters: () => set({ activeSelections: [] }),

    saveNow: async () => {
      if (saveTimer) clearTimeout(saveTimer);
      await persist(get());
    },
  };
});

function cloneWidget(w: CanvasWidget): CanvasWidget {
  return structuredClone(w);
}
