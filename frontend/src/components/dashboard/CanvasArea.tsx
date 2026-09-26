/**
 * CanvasArea.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * The free-form report surface. Widgets are absolutely positioned in *virtual
 * design pixels* (report.canvasWidth, default 1280) and the whole surface is
 * scaled to the container width, so a saved report looks identical anywhere.
 *
 * Owns all pointer *sessions*:
 *   - drag    : moves the selection rigidly; snap-to-8px-grid + edge/center guides
 *   - resize  : 8-handle resize with min-size clamp + grid snap
 *   - marquee : rubber-band multi-select on empty canvas (shift = additive)
 *
 * Continuous geometry goes through builderStore.beginTransform / transformWidgets
 * (rAF-throttled, no history) / endTransform (one undo entry + autosave). Discrete
 * ops (delete, nudge, undo/redo) are handled via keyboard here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasWidget } from './types';
import { getActivePage } from './types';
import { useBuilderStore } from './builderStore';
import WidgetCard from './WidgetCard';

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const GRID = 8;
const MIN_W = 120;
const MIN_H = 80;
const GUIDE_SNAP = 6; // design px within which an alignment guide engages
const DRAG_THRESHOLD = 3; // client px before a click becomes a drag

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Session =
  | { kind: 'drag'; primary: string; startX: number; startY: number; orig: Record<string, Geom>; began: boolean }
  | { kind: 'resize'; primary: string; handle: ResizeHandle; startX: number; startY: number; orig: Geom; began: boolean }
  | { kind: 'marquee'; startLocalX: number; startLocalY: number; shift: boolean; prevSel: string[]; began: boolean };

interface Guides {
  v: number[]; // vertical guide x-coords (design px)
  h: number[]; // horizontal guide y-coords (design px)
}

interface CanvasAreaProps {
  themePalette: string[];
}

export default function CanvasArea({ themePalette }: CanvasAreaProps) {
  const reportState = useBuilderStore((s) => s.reportState);
  const selectedWidgetIds = useBuilderStore((s) => s.selectedWidgetIds);
  const activeSelections = useBuilderStore((s) => s.activeSelections);
  const snapEnabled = useBuilderStore((s) => s.snapEnabled);

  const page = getActivePage(reportState);
  const widgets = page.widgets;
  const canvasWidth = reportState.canvasWidth || 1280;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const scale = containerWidth > 0 ? containerWidth / canvasWidth : 1;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;

  // Design-space height grows with content; never shorter than the viewport.
  const canvasHeight = useMemo(() => {
    const maxBottom = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    const viewportDesign = containerWidth > 0 ? (scrollRef.current?.clientHeight ?? 720) / scale : 720;
    return Math.max(maxBottom + 160, viewportDesign);
  }, [widgets, containerWidth, scale]);

  const sessionRef = useRef<Session | null>(null);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const [guides, setGuides] = useState<Guides | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Measure container width ────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const snap = useCallback((v: number) => (snapRef.current ? Math.round(v / GRID) * GRID : v), []);

  // Convert a client point to surface-local design coordinates.
  const clientToDesign = useCallback((clientX: number, clientY: number) => {
    const el = scrollRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const localX = clientX - rect.left + el.scrollLeft;
    const localY = clientY - rect.top + el.scrollTop;
    const s = scaleRef.current || 1;
    return { x: localX / s, y: localY / s };
  }, []);

  // Edge/center alignment against other widgets. Returns snapped x/y + guide lines.
  const computeGuides = useCallback(
    (x: number, y: number, w: number, h: number, excludeId: string) => {
      const others = getActivePage(useBuilderStore.getState().reportState).widgets.filter((o) => o.id !== excludeId);
      const v: number[] = [];
      const hh: number[] = [];
      let nx = x;
      let ny = y;

      const myV = [x, x + w / 2, x + w]; // left, center, right → maps to nx offsets 0, -w/2, -w
      const myVOffset = [0, -w / 2, -w];
      const myH = [y, y + h / 2, y + h];
      const myHOffset = [0, -h / 2, -h];

      let bestV = GUIDE_SNAP + 1;
      let bestH = GUIDE_SNAP + 1;
      for (const o of others) {
        const oV = [o.x, o.x + o.w / 2, o.x + o.w];
        const oH = [o.y, o.y + o.h / 2, o.y + o.h];
        for (let i = 0; i < myV.length; i++) {
          for (const ov of oV) {
            const d = Math.abs(myV[i] - ov);
            if (d < bestV) {
              bestV = d;
              nx = ov + myVOffset[i];
              v.length = 0;
              v.push(ov);
            }
          }
        }
        for (let i = 0; i < myH.length; i++) {
          for (const oh of oH) {
            const d = Math.abs(myH[i] - oh);
            if (d < bestH) {
              bestH = d;
              ny = oh + myHOffset[i];
              hh.length = 0;
              hh.push(oh);
            }
          }
        }
      }
      return { x: nx, y: ny, guides: { v, h: hh } };
    },
    []
  );

  // ── rAF flush: reads session + last pointer, computes + commits geometry ─────
  const flush = useCallback(() => {
    rafRef.current = null;
    const s = sessionRef.current;
    if (!s) return;
    const store = useBuilderStore.getState();
    const sc = scaleRef.current || 1;
    const { x: cx, y: cy } = lastPointer.current;

    if (s.kind === 'drag') {
      const dxC = cx - s.startX;
      const dyC = cy - s.startY;
      if (!s.began) {
        if (Math.abs(dxC) + Math.abs(dyC) < DRAG_THRESHOLD) return;
        s.began = true;
        store.beginTransform();
      }
      const po = s.orig[s.primary];
      if (!po) return;
      let nx = snap(po.x + dxC / sc);
      let ny = snap(po.y + dyC / sc);
      const g = computeGuides(nx, ny, po.w, po.h, s.primary);
      nx = g.x;
      ny = g.y;
      const offX = nx - po.x;
      const offY = ny - po.y;
      const patches: Record<string, Partial<CanvasWidget>> = {};
      for (const id of Object.keys(s.orig)) {
        const o = s.orig[id];
        patches[id] = { x: Math.max(0, o.x + offX), y: Math.max(0, o.y + offY) };
      }
      store.transformWidgets(patches);
      setGuides(g.guides.v.length || g.guides.h.length ? g.guides : null);
      return;
    }

    if (s.kind === 'resize') {
      const dxC = cx - s.startX;
      const dyC = cy - s.startY;
      if (!s.began) {
        if (Math.abs(dxC) + Math.abs(dyC) < DRAG_THRESHOLD) return;
        s.began = true;
        store.beginTransform();
      }
      const ddx = dxC / sc;
      const ddy = dyC / sc;
      const o = s.orig;
      const right = o.x + o.w;
      const bottom = o.y + o.h;
      let x = o.x;
      let y = o.y;
      let w = o.w;
      let h = o.h;
      if (s.handle.includes('e')) w = o.w + ddx;
      if (s.handle.includes('s')) h = o.h + ddy;
      if (s.handle.includes('w')) {
        x = o.x + ddx;
        w = o.w - ddx;
      }
      if (s.handle.includes('n')) {
        y = o.y + ddy;
        h = o.h - ddy;
      }
      // snap + clamp, keeping the anchored (opposite) edge fixed for w/n handles
      w = Math.max(MIN_W, snap(w));
      h = Math.max(MIN_H, snap(h));
      if (s.handle.includes('w')) x = right - w;
      else x = snap(x);
      if (s.handle.includes('n')) y = bottom - h;
      else y = snap(y);
      x = Math.max(0, x);
      y = Math.max(0, y);
      store.transformWidgets({ [s.primary]: { x, y, w, h } });
      return;
    }

    // marquee
    const cur = clientToDesign(cx, cy);
    const x0 = Math.min(s.startLocalX, cur.x);
    const y0 = Math.min(s.startLocalY, cur.y);
    const w0 = Math.abs(cur.x - s.startLocalX);
    const h0 = Math.abs(cur.y - s.startLocalY);
    s.began = w0 + h0 > 4;
    setMarquee({ x: x0 * sc, y: y0 * sc, w: w0 * sc, h: h0 * sc });
  }, [snap, computeGuides, clientToDesign]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  // ── Global pointer listeners (attached once) ────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!sessionRef.current) return;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      scheduleFlush();
    };
    const onUp = () => {
      const s = sessionRef.current;
      sessionRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const store = useBuilderStore.getState();
      if (!s) return;
      if (s.kind === 'marquee') {
        if (s.began) {
          const cur = clientToDesign(lastPointer.current.x, lastPointer.current.y);
          const rx = Math.min(s.startLocalX, cur.x);
          const ry = Math.min(s.startLocalY, cur.y);
          const rw = Math.abs(cur.x - s.startLocalX);
          const rh = Math.abs(cur.y - s.startLocalY);
          const hits = getActivePage(store.reportState)
            .widgets.filter((w) => w.x < rx + rw && w.x + w.w > rx && w.y < ry + rh && w.y + w.h > ry)
            .map((w) => w.id);
          const next = s.shift ? Array.from(new Set([...s.prevSel, ...hits])) : hits;
          store.selectMany(next);
        } else if (!s.shift) {
          store.clearSelection();
        }
        setMarquee(null);
      } else if (s.began) {
        store.endTransform();
      }
      setGuides(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [scheduleFlush, clientToDesign]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const store = useBuilderStore.getState();
      const sel = store.selectedWidgetIds;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if (sel.length === 0) return;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        sel.forEach((id) => store.duplicateWidget(id));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.removeWidgets(sel);
        return;
      }
      if (e.key === 'Escape') {
        store.clearSelection();
        return;
      }
      const nudge = e.shiftKey ? GRID : 1;
      const delta = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge] }[e.key];
      if (delta) {
        e.preventDefault();
        const activePage = getActivePage(store.reportState);
        store.beginTransform();
        const patches: Record<string, Partial<CanvasWidget>> = {};
        sel.forEach((id) => {
          const w = activePage.widgets.find((x) => x.id === id);
          if (w && !w.locked) patches[id] = { x: Math.max(0, w.x + delta[0]), y: Math.max(0, w.y + delta[1]) };
        });
        store.transformWidgets(patches);
        store.endTransform();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Session initiators (passed to WidgetCard / surface) ──────────────────────
  const handleStartDrag = useCallback((e: React.PointerEvent, widgetId: string, drag: boolean) => {
    const store = useBuilderStore.getState();
    const already = store.selectedWidgetIds.includes(widgetId);
    if (e.shiftKey) store.select(widgetId, true);
    else if (!already) store.select(widgetId);

    if (!drag) return;
    const activePage = getActivePage(store.reportState);
    const self = activePage.widgets.find((w) => w.id === widgetId);
    if (!self || self.locked) return;

    const sel = useBuilderStore.getState().selectedWidgetIds;
    const ids = sel.includes(widgetId) ? sel : [widgetId];
    const orig: Record<string, Geom> = {};
    ids.forEach((id) => {
      const w = activePage.widgets.find((x) => x.id === id);
      if (w && !w.locked) orig[id] = { x: w.x, y: w.y, w: w.w, h: w.h };
    });
    if (!orig[widgetId]) orig[widgetId] = { x: self.x, y: self.y, w: self.w, h: self.h };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    sessionRef.current = { kind: 'drag', primary: widgetId, startX: e.clientX, startY: e.clientY, orig, began: false };
  }, []);

  const handleStartResize = useCallback((e: React.PointerEvent, widgetId: string, handle: ResizeHandle) => {
    const store = useBuilderStore.getState();
    if (!store.selectedWidgetIds.includes(widgetId)) store.select(widgetId);
    const w = getActivePage(store.reportState).widgets.find((x) => x.id === widgetId);
    if (!w || w.locked) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    sessionRef.current = {
      kind: 'resize',
      primary: widgetId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: w.x, y: w.y, w: w.w, h: w.h },
      began: false,
    };
  }, []);

  const handleSurfacePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== surfaceRef.current) return;
    const store = useBuilderStore.getState();
    const local = clientToDesign(e.clientX, e.clientY);
    lastPointer.current = { x: e.clientX, y: e.clientY };
    sessionRef.current = {
      kind: 'marquee',
      startLocalX: local.x,
      startLocalY: local.y,
      shift: e.shiftKey,
      prevSel: store.selectedWidgetIds,
      began: false,
    };
  };

  const sorted = useMemo(() => [...widgets].sort((a, b) => a.z - b.z), [widgets]);

  return (
    <div ref={scrollRef} className="relative w-full h-full overflow-auto bg-darkBg">
      <div
        ref={surfaceRef}
        onPointerDown={handleSurfacePointerDown}
        className="relative mx-auto"
        style={{
          width: canvasWidth * scale,
          height: canvasHeight * scale,
          backgroundColor: 'var(--bg-main)',
          backgroundImage: snapEnabled
            ? 'radial-gradient(circle, var(--border-color) 1px, transparent 1px)'
            : undefined,
          backgroundSize: snapEnabled ? `${GRID * 4 * scale}px ${GRID * 4 * scale}px` : undefined,
        }}
      >
        {sorted.map((w) => (
          <WidgetCard
            key={w.id}
            widget={w}
            scale={scale}
            selected={selectedWidgetIds.includes(w.id)}
            themePalette={themePalette}
            activeSelections={activeSelections}
            onStartDrag={handleStartDrag}
            onStartResize={handleStartResize}
          />
        ))}

        {/* Alignment guides */}
        {guides?.v.map((gx, i) => (
          <div key={`gv-${i}`} className="absolute top-0 pointer-events-none z-[60]" style={{ left: gx * scale, width: 1, height: '100%', background: '#3b82f6' }} />
        ))}
        {guides?.h.map((gy, i) => (
          <div key={`gh-${i}`} className="absolute left-0 pointer-events-none z-[60]" style={{ top: gy * scale, height: 1, width: '100%', background: '#3b82f6' }} />
        ))}

        {/* Marquee */}
        {marquee && (
          <div
            className="absolute border border-blue-400 bg-blue-400/10 pointer-events-none z-[70]"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>
    </div>
  );
}
