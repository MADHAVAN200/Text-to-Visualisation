/**
 * WidgetCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The positioned container for a single CanvasWidget. Owns:
 *   - lazy data fetch for chart widgets (executeWidgetSql, module-level cache)
 *   - content dispatch: chart → ChartRenderer, text/narrative → markdown,
 *     slicer → SlicerControl, image → <img>
 *   - chrome: header/subtitle, 8 resize handles, context menu, lock, states
 *
 * Pointer *sessions* (drag/resize/marquee) are owned by CanvasArea; this card only
 * reports the initiating pointer event upward via onStartDrag / onStartResize.
 * Geometry (x/y/w/h) is read from the store and multiplied by `scale`, so live
 * drag updates (transformWidgets) re-render the card in place.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import {
  GripVertical, Lock, MoreVertical, Copy, Trash2, ArrowUp, ArrowDown,
  Settings2, AlertCircle, Loader2, Image as ImageIcon, Sparkles, Database,
} from 'lucide-react';
import type { CanvasWidget, CrossFilterSelection } from './types';
import { useBuilderStore } from './builderStore';
import { executeWidgetSql, parseMarkdownToReact } from './chartHelpers';
import ChartRenderer from './ChartRenderer';
import SlicerControl from './SlicerBar';

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface WidgetCardProps {
  widget: CanvasWidget;
  scale: number;
  selected: boolean;
  themePalette: string[];
  activeSelections: CrossFilterSelection[];
  // `drag` = begin a drag session (true) vs select-only (false). Selection always happens.
  onStartDrag: (e: React.PointerEvent, widgetId: string, drag: boolean) => void;
  onStartResize: (e: React.PointerEvent, widgetId: string, handle: ResizeHandle) => void;
}

// ── Module-level widget data cache (keyed by db + sql) ──────────────────────────
interface CacheEntry {
  rows: any[];
  columns: string[];
  error?: string;
}
const dataCache = new Map<string, CacheEntry>();
const cacheKey = (dbId: number, sql: string) => `${dbId}::${sql}`;

const HANDLES: { h: ResizeHandle; style: React.CSSProperties; cursor: string }[] = [
  { h: 'nw', style: { top: -5, left: -5 }, cursor: 'nwse-resize' },
  { h: 'n', style: { top: -5, left: '50%', marginLeft: -5 }, cursor: 'ns-resize' },
  { h: 'ne', style: { top: -5, right: -5 }, cursor: 'nesw-resize' },
  { h: 'e', style: { top: '50%', right: -5, marginTop: -5 }, cursor: 'ew-resize' },
  { h: 'se', style: { bottom: -5, right: -5 }, cursor: 'nwse-resize' },
  { h: 's', style: { bottom: -5, left: '50%', marginLeft: -5 }, cursor: 'ns-resize' },
  { h: 'sw', style: { bottom: -5, left: -5 }, cursor: 'nesw-resize' },
  { h: 'w', style: { top: '50%', left: -5, marginTop: -5 }, cursor: 'ew-resize' },
];

export default function WidgetCard({
  widget,
  scale,
  selected,
  themePalette,
  activeSelections,
  onStartDrag,
  onStartResize,
}: WidgetCardProps) {
  const setCrossFilter = useBuilderStore((s) => s.setCrossFilter);
  const bringToFront = useBuilderStore((s) => s.bringToFront);
  const sendToBack = useBuilderStore((s) => s.sendToBack);
  const toggleLock = useBuilderStore((s) => s.toggleLock);
  const duplicateWidget = useBuilderStore((s) => s.duplicateWidget);
  const removeWidgets = useBuilderStore((s) => s.removeWidgets);
  const updateWidget = useBuilderStore((s) => s.updateWidget);

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fmt = widget.formatting || {};
  const isChart = widget.type === 'chart';

  // ── Lazy data fetch (chart widgets only) ────────────────────────────────────
  useEffect(() => {
    if (!isChart || widget.databaseId == null || !widget.sql) {
      setRows([]);
      setFetchError(null);
      return;
    }
    const key = cacheKey(widget.databaseId, widget.sql);
    const cached = dataCache.get(key);
    if (cached) {
      setRows(cached.rows);
      setFetchError(cached.error || null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    executeWidgetSql(widget.databaseId, widget.sql)
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          dataCache.set(key, { rows: res.rows, columns: res.columns });
          setRows(res.rows);
        } else {
          dataCache.set(key, { rows: [], columns: [], error: res.error });
          setFetchError(res.error || 'Query failed');
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isChart, widget.databaseId, widget.sql]);

  // Close context menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  // Non-interactive widgets can be dragged by their body; interactive ones
  // (slicers, cross-filter-emitting charts, tables) drag by the header only.
  const interactiveBody =
    widget.type === 'slicer' ||
    (isChart && (widget.chartType === 'table' || widget.emitsCrossFilter !== false));
  const bodyDraggable = !widget.locked && !editingText && !interactiveBody;

  const showHeader = fmt.showHeader !== false;
  const radius = fmt.borderRadius ?? 12;

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    left: widget.x * scale,
    top: widget.y * scale,
    width: widget.w * scale,
    height: widget.h * scale,
    zIndex: widget.z,
    background: fmt.backgroundColor || 'var(--bg-sidebar)',
    borderRadius: radius,
  };

  const emit = (field: string, value: any) => setCrossFilter({ widgetId: widget.id, field, value });

  const menuAction = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
    setMenuOpen(false);
  };

  return (
    <div
      style={wrapperStyle}
      onPointerDown={(e) => {
        // Body pointerdown: select always; begin a drag only when the body is draggable.
        if (e.button !== 0) return;
        onStartDrag(e, widget.id, bodyDraggable);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={`group border transition-shadow overflow-hidden flex flex-col ${
        selected ? 'border-blue-500 shadow-lg shadow-blue-500/10' : 'border-darkBorder hover:border-slate-600'
      }`}
    >
      {/* Header / drag handle */}
      {showHeader && (
        <div
          onPointerDown={(e) => {
            if (e.button !== 0 || widget.locked) return;
            e.stopPropagation();
            onStartDrag(e, widget.id, true);
          }}
          className={`flex items-start justify-between gap-2 px-3 pt-2 pb-1 shrink-0 ${
            widget.locked ? '' : 'cursor-move'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {!widget.locked && <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />}
              <h3
                className="text-[13px] font-bold truncate"
                style={{ color: fmt.headerColor || 'var(--slate-100)' }}
                title={widget.title}
              >
                {widget.title || 'Untitled'}
              </h3>
              {widget.locked && <Lock className="w-3 h-3 text-slate-500 shrink-0" />}
            </div>
            {widget.subtitle && (
              <p className="text-[10px] truncate mt-0.5" style={{ color: fmt.subtitleColor || 'var(--slate-500)' }}>
                {widget.subtitle}
              </p>
            )}
          </div>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="p-1 rounded-md hover:bg-darkBg text-slate-500 hover:text-slate-200 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 px-3 pb-2.5 pt-0.5 relative">
        <WidgetBody
          widget={widget}
          rows={rows}
          loading={loading}
          fetchError={fetchError}
          themePalette={themePalette}
          activeSelections={activeSelections}
          onEmit={emit}
          editingText={editingText}
          setEditingText={setEditingText}
          commitText={(content) => updateWidget(widget.id, { content })}
        />
      </div>

      {/* Context menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-9 z-50 w-44 bg-darkBg border border-darkBorder rounded-xl shadow-2xl py-1.5 animate-fade-in"
        >
          <MenuItem icon={<ArrowUp className="w-3.5 h-3.5" />} label="Bring to front" onClick={menuAction(() => bringToFront(widget.id))} />
          <MenuItem icon={<ArrowDown className="w-3.5 h-3.5" />} label="Send to back" onClick={menuAction(() => sendToBack(widget.id))} />
          <MenuItem icon={<Lock className="w-3.5 h-3.5" />} label={widget.locked ? 'Unlock' : 'Lock'} onClick={menuAction(() => toggleLock(widget.id))} />
          <MenuItem icon={<Copy className="w-3.5 h-3.5" />} label="Duplicate" onClick={menuAction(() => duplicateWidget(widget.id))} />
          {widget.type === 'text' && (
            <MenuItem icon={<Settings2 className="w-3.5 h-3.5" />} label="Edit text" onClick={menuAction(() => setEditingText(true))} />
          )}
          <div className="h-px bg-darkBorder my-1" />
          <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Delete" danger onClick={menuAction(() => removeWidgets([widget.id]))} />
        </div>
      )}

      {/* Resize handles */}
      {selected && !widget.locked && (
        <>
          {HANDLES.map(({ h, style, cursor }) => (
            <div
              key={h}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onStartResize(e, widget.id, h);
              }}
              className="absolute w-2.5 h-2.5 bg-blue-500 border border-white/70 rounded-sm z-40"
              style={{ ...style, cursor }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ── Content dispatch by widget type ─────────────────────────────────────────────
interface WidgetBodyProps {
  widget: CanvasWidget;
  rows: any[];
  loading: boolean;
  fetchError: string | null;
  themePalette: string[];
  activeSelections: CrossFilterSelection[];
  onEmit: (field: string, value: any) => void;
  editingText: boolean;
  setEditingText: (v: boolean) => void;
  commitText: (content: string) => void;
}

function WidgetBody({
  widget, rows, loading, fetchError, themePalette, activeSelections, onEmit, editingText, setEditingText, commitText,
}: WidgetBodyProps) {
  if (widget.type === 'slicer') {
    if (!widget.slicer) return <Placeholder icon={<Sparkles className="w-5 h-5" />} text="Configure this slicer in the Fields pane." />;
    return <SlicerControl widgetId={widget.id} slicer={widget.slicer} />;
  }

  if (widget.type === 'text' || widget.type === 'narrative') {
    if (editingText) {
      return (
        <textarea
          autoFocus
          defaultValue={widget.content || ''}
          onBlur={(e) => {
            commitText(e.target.value);
            setEditingText(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-full bg-transparent text-slate-200 text-xs resize-none focus:outline-none leading-relaxed"
          placeholder="Type markdown… **bold**, ### heading, - bullet"
        />
      );
    }
    return (
      <div
        className="h-full overflow-y-auto"
        onDoubleClick={() => widget.type === 'text' && setEditingText(true)}
      >
        {widget.content ? (
          parseMarkdownToReact(widget.content)
        ) : (
          <Placeholder
            icon={<Sparkles className="w-5 h-5" />}
            text={widget.type === 'narrative' ? 'Generate a Smart Narrative from the AI panel.' : 'Double-click to add text.'}
          />
        )}
      </div>
    );
  }

  if (widget.type === 'image') {
    return widget.content ? (
      <img src={widget.content} alt={widget.title} className="w-full h-full object-contain" />
    ) : (
      <Placeholder icon={<ImageIcon className="w-5 h-5" />} text="Set an image URL in the Fields pane." />
    );
  }

  // ── chart ──
  if (widget.databaseId == null || !widget.sql) {
    return <Placeholder icon={<Database className="w-5 h-5" />} text="Bind a data source with Ask Copilot or the Fields pane." />;
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-red-400 px-4">
        <AlertCircle className="w-5 h-5" />
        <p className="text-[11px]">{fetchError}</p>
      </div>
    );
  }
  return (
    <ChartRenderer
      widget={widget}
      rows={rows}
      themePalette={themePalette}
      activeSelections={activeSelections}
      onEmit={onEmit}
    />
  );
}

function Placeholder({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-slate-500 px-4 select-none">
      {icon}
      <p className="text-[11px] leading-snug">{text}</p>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: (e: React.MouseEvent) => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'text-slate-300 hover:bg-darkSidebar'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
