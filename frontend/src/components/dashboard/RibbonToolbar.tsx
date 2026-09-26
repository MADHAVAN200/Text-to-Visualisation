/**
 * RibbonToolbar.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The editor's top command bar:
 *   - Visuals gallery : add charts (bar/line/area/pie/donut/scatter/kpi/table)
 *     and elements (slicer/text/narrative/image) as blank widgets.
 *   - History         : undo / redo (disabled from the store's history stacks).
 *   - Canvas          : snap-to-grid toggle, report theme switcher.
 *   - Cross-filter    : clear all active selections (shown only when any exist).
 *   - Save            : autosave status + manual save.
 *   - AI Copilot      : opens the AiSuggestionsDrawer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react';
import {
  Plus, ChevronDown, Undo2, Redo2, Magnet, Palette, Save, Sparkles,
  Loader2, Check, AlertCircle, FilterX,
  BarChart3, LineChart, AreaChart, PieChart, CircleDot, ScatterChart, Sigma, Table,
  SlidersHorizontal, Type, FileText, Image as ImageIcon,
} from 'lucide-react';
import { useBuilderStore } from './builderStore';
import { THEMES } from './themes';
import { genId, nextSlot, defaultSize } from './widgetFactory';
import type { ChartType, WidgetType, CanvasWidget } from './types';

interface RibbonToolbarProps {
  onOpenAi: () => void;
}

interface VisualDef {
  type: WidgetType;
  chartType?: ChartType;
  label: string;
  icon: React.ReactNode;
}

const CHART_VISUALS: VisualDef[] = [
  { type: 'chart', chartType: 'bar', label: 'Bar', icon: <BarChart3 className="w-4 h-4" /> },
  { type: 'chart', chartType: 'line', label: 'Line', icon: <LineChart className="w-4 h-4" /> },
  { type: 'chart', chartType: 'area', label: 'Area', icon: <AreaChart className="w-4 h-4" /> },
  { type: 'chart', chartType: 'pie', label: 'Pie', icon: <PieChart className="w-4 h-4" /> },
  { type: 'chart', chartType: 'donut', label: 'Donut', icon: <CircleDot className="w-4 h-4" /> },
  { type: 'chart', chartType: 'scatter', label: 'Scatter', icon: <ScatterChart className="w-4 h-4" /> },
  { type: 'chart', chartType: 'kpi', label: 'KPI', icon: <Sigma className="w-4 h-4" /> },
  { type: 'chart', chartType: 'table', label: 'Table', icon: <Table className="w-4 h-4" /> },
];

const ELEMENT_VISUALS: VisualDef[] = [
  { type: 'slicer', label: 'Slicer', icon: <SlidersHorizontal className="w-4 h-4" /> },
  { type: 'text', label: 'Text', icon: <Type className="w-4 h-4" /> },
  { type: 'narrative', label: 'Narrative', icon: <FileText className="w-4 h-4" /> },
  { type: 'image', label: 'Image', icon: <ImageIcon className="w-4 h-4" /> },
];

export default function RibbonToolbar({ onOpenAi }: RibbonToolbarProps) {
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const canUndo = useBuilderStore((s) => s.history.length > 0);
  const canRedo = useBuilderStore((s) => s.future.length > 0);
  const snapEnabled = useBuilderStore((s) => s.snapEnabled);
  const setSnap = useBuilderStore((s) => s.setSnap);
  const themeId = useBuilderStore((s) => s.reportState.themeId);
  const setThemeId = useBuilderStore((s) => s.setThemeId);
  const saving = useBuilderStore((s) => s.saving);
  const saveNow = useBuilderStore((s) => s.saveNow);
  const addWidget = useBuilderStore((s) => s.addWidget);
  const activeCount = useBuilderStore((s) => s.activeSelections.length);
  const clearCrossFilters = useBuilderStore((s) => s.clearCrossFilters);

  const [menu, setMenu] = useState<'gallery' | 'theme' | null>(null);

  const add = (v: VisualDef) => {
    const size = defaultSize(v.type, v.chartType);
    const slot = nextSlot();
    const widget: CanvasWidget = {
      id: genId(),
      type: v.type,
      chartType: v.type === 'chart' ? v.chartType : undefined,
      title: v.label,
      x: slot.x,
      y: slot.y,
      w: size.w,
      h: size.h,
      z: 0,
    };
    if (v.type === 'chart') {
      widget.formatting = { showLegend: true, showGrid: true };
      widget.emitsCrossFilter = v.chartType !== 'kpi';
    } else if (v.type === 'text' || v.type === 'narrative' || v.type === 'image') {
      widget.content = '';
    }
    addWidget(widget);
    setMenu(null);
  };

  return (
    <div className="relative h-12 flex items-center gap-1 px-3 border-b border-darkBorder bg-darkSidebar shrink-0">
      {/* Add visual */}
      <button
        onClick={() => setMenu(menu === 'gallery' ? null : 'gallery')}
        className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-semibold transition-colors"
      >
        <Plus className="w-4 h-4" /> Add visual <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>

      <Divider />

      <IconBtn icon={<Undo2 className="w-4 h-4" />} label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
      <IconBtn icon={<Redo2 className="w-4 h-4" />} label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo} />

      <Divider />

      <IconBtn
        icon={<Magnet className="w-4 h-4" />}
        label={snapEnabled ? 'Snap to grid: on' : 'Snap to grid: off'}
        onClick={() => setSnap(!snapEnabled)}
        active={snapEnabled}
      />
      <IconBtn
        icon={<Palette className="w-4 h-4" />}
        label="Report theme"
        onClick={() => setMenu(menu === 'theme' ? null : 'theme')}
        active={menu === 'theme'}
      />

      {activeCount > 0 && (
        <>
          <Divider />
          <button
            onClick={clearCrossFilters}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 text-[11px] font-semibold transition-colors"
          >
            <FilterX className="w-3.5 h-3.5" /> Clear filters ({activeCount})
          </button>
        </>
      )}

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-1.5">
        <SaveStatus status={saving} onSave={() => void saveNow()} />
        <button
          onClick={onOpenAi}
          className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 hover:from-blue-400 hover:to-violet-500 text-white text-[12px] font-semibold transition-colors"
        >
          <Sparkles className="w-4 h-4" /> AI Copilot
        </button>
      </div>

      {/* Popover backdrop */}
      {menu && <div className="fixed inset-0 z-[40]" onClick={() => setMenu(null)} />}

      {/* Visuals gallery popover */}
      {menu === 'gallery' && (
        <div className="absolute left-3 top-[52px] z-[50] w-[300px] bg-darkBg border border-darkBorder rounded-xl shadow-2xl p-3 animate-fade-in">
          <GalleryGroup title="Charts">
            {CHART_VISUALS.map((v) => (
              <GalleryItem key={v.chartType} icon={v.icon} label={v.label} onClick={() => add(v)} />
            ))}
          </GalleryGroup>
          <div className="h-px bg-darkBorder my-2.5" />
          <GalleryGroup title="Elements">
            {ELEMENT_VISUALS.map((v) => (
              <GalleryItem key={v.type} icon={v.icon} label={v.label} onClick={() => add(v)} />
            ))}
          </GalleryGroup>
        </div>
      )}

      {/* Theme popover */}
      {menu === 'theme' && (
        <div className="absolute z-[50] w-[220px] bg-darkBg border border-darkBorder rounded-xl shadow-2xl p-2 animate-fade-in" style={{ top: 52, left: 180 }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setThemeId(t.id);
                setMenu(null);
              }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors ${
                themeId === t.id ? 'bg-blue-500/10' : 'hover:bg-darkSidebar'
              }`}
            >
              <span className="flex items-center gap-0.5 shrink-0">
                {t.palette.slice(0, 4).map((c, i) => (
                  <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                ))}
              </span>
              <span className="text-[12px] text-slate-200 flex-1 text-left">{t.name}</span>
              {themeId === t.id && <Check className="w-3.5 h-3.5 text-blue-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Presentational blocks ─────────────────────────────────────────────────────
function Divider() {
  return <div className="w-px h-6 bg-darkBorder mx-1 shrink-0" />;
}

function IconBtn({
  icon, label, onClick, disabled, active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-blue-500/15 text-blue-400' : 'text-slate-300 hover:bg-darkBg hover:text-slate-100'
      }`}
    >
      {icon}
    </button>
  );
}

function SaveStatus({ status, onSave }: { status: 'idle' | 'saving' | 'saved' | 'error'; onSave: () => void }) {
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-emerald-400">
        <Check className="w-3.5 h-3.5" /> Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <button onClick={onSave} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-red-400 hover:bg-red-500/10">
        <AlertCircle className="w-3.5 h-3.5" /> Retry save
      </button>
    );
  }
  return (
    <button onClick={onSave} title="Save" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-300 hover:bg-darkBg hover:text-slate-100 transition-colors">
      <Save className="w-3.5 h-3.5" /> Save
    </button>
  );
}

function GalleryGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">{title}</h4>
      <div className="grid grid-cols-4 gap-1">{children}</div>
    </div>
  );
}

function GalleryItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg text-slate-300 hover:bg-blue-500/10 hover:text-blue-400 transition-colors group"
    >
      <span className="group-hover:scale-110 transition-transform">{icon}</span>
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  );
}
