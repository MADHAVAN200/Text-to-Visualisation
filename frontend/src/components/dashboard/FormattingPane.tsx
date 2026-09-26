/**
 * FormattingPane.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Right "Format" rail for the selected widget. Writes to widget.formatting:
 *   - palette (per-widget override of the report theme)
 *   - data labels / legend / grid / header visibility toggles
 *   - axis min/max, trendline, number format
 *   - conditional color rules (value thresholds → color)
 *   - card styling: background, corner radius, header/subtitle color
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Palette, Plus, X } from 'lucide-react';
import { useBuilderStore } from './builderStore';
import { getActivePage } from './types';
import { getTheme, THEMES } from './themes';
import type { FormattingConfig, ConditionalOp, ConditionalRule, NumberFormat } from './types';

const OPS: ConditionalOp[] = ['>', '<', '>=', '<=', '==', '!='];
const NUMBER_FORMATS: NumberFormat[] = ['plain', 'compact', 'currency', 'percent'];

export default function FormattingPane() {
  const selectedIds = useBuilderStore((s) => s.selectedWidgetIds);
  const report = useBuilderStore((s) => s.reportState);
  const updateWidget = useBuilderStore((s) => s.updateWidget);

  const page = getActivePage(report);
  const widget = selectedIds.length === 1 ? page.widgets.find((w) => w.id === selectedIds[0]) : undefined;

  if (!widget) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-slate-500 px-6">
          <Palette className="w-6 h-6" />
          <p className="text-xs">Select a widget to format it.</p>
        </div>
      </div>
    );
  }

  const fmt: FormattingConfig = widget.formatting || {};
  const setFmt = (patch: Partial<FormattingConfig>) => updateWidget(widget.id, { formatting: { ...fmt, ...patch } });

  const theme = getTheme(report.themeId);
  const effectivePalette = fmt.palette && fmt.palette.length ? fmt.palette : theme.palette;
  const isChart = widget.type === 'chart';
  const rules = fmt.conditionalRules || [];

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      {isChart && (
        <>
          <Section title="Palette">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {effectivePalette.map((c, i) => (
                <label key={i} className="relative cursor-pointer" title="Click to edit">
                  <span className="block w-6 h-6 rounded-md border border-darkBorder" style={{ background: c }} />
                  <input
                    type="color"
                    value={c}
                    onChange={(e) => {
                      const next = [...effectivePalette];
                      next[i] = e.target.value;
                      setFmt({ palette: next });
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
              ))}
              <button
                onClick={() => setFmt({ palette: [...effectivePalette, '#64748b'] })}
                className="w-6 h-6 rounded-md border border-dashed border-slate-600 text-slate-500 hover:text-slate-300 hover:border-slate-400 flex items-center justify-center"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFmt({ palette: [...t.palette] })}
                  title={`Apply ${t.name} palette`}
                  className="flex items-center gap-0.5 px-1.5 py-1 rounded-md border border-darkBorder hover:border-slate-500"
                >
                  {t.palette.slice(0, 4).map((c, i) => (
                    <span key={i} className="w-2 h-2 rounded-full" style={{ background: c }} />
                  ))}
                </button>
              ))}
              {fmt.palette && (
                <button onClick={() => setFmt({ palette: undefined })} className="text-[10px] text-blue-400 hover:text-blue-300 ml-auto">
                  Reset to theme
                </button>
              )}
            </div>
          </Section>

          <Section title="Display">
            <Toggle label="Data labels" checked={fmt.showDataLabels === true} onChange={(v) => setFmt({ showDataLabels: v })} />
            <Toggle label="Legend" checked={fmt.showLegend !== false} onChange={(v) => setFmt({ showLegend: v })} />
            <Toggle label="Gridlines" checked={fmt.showGrid !== false} onChange={(v) => setFmt({ showGrid: v })} />
            <Toggle label="Trendline" checked={fmt.showTrendline === true} onChange={(v) => setFmt({ showTrendline: v })} />
          </Section>

          <Section title="Axis & values">
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Axis min"
                value={fmt.axisMin ?? null}
                onChange={(v) => setFmt({ axisMin: v })}
              />
              <NumberField
                label="Axis max"
                value={fmt.axisMax ?? null}
                onChange={(v) => setFmt({ axisMax: v })}
              />
            </div>
            <Field label="Number format">
              <div className="grid grid-cols-4 gap-1">
                {NUMBER_FORMATS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setFmt({ numberFormat: n })}
                    className={`py-1.5 rounded-md text-[9px] font-semibold capitalize border transition-all ${
                      (fmt.numberFormat || 'compact') === n
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-darkBorder text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          <Section title="Conditional colors">
            <div className="space-y-1.5">
              {rules.map((r, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-400">value</span>
                  <select
                    value={r.op}
                    onChange={(e) => updateRule(rules, i, { op: e.target.value as ConditionalOp }, setFmt)}
                    className="bg-darkBg border border-darkBorder rounded-md px-1 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500"
                  >
                    {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input
                    type="number"
                    value={r.value}
                    onChange={(e) => updateRule(rules, i, { value: Number(e.target.value) }, setFmt)}
                    className="w-14 bg-darkBg border border-darkBorder rounded-md px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="color"
                    value={r.color}
                    onChange={(e) => updateRule(rules, i, { color: e.target.value }, setFmt)}
                    className="w-7 h-7 rounded-md bg-transparent border border-darkBorder cursor-pointer"
                  />
                  <button onClick={() => setFmt({ conditionalRules: rules.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-400 shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setFmt({ conditionalRules: [...rules, { field: '', op: '>', value: 0, color: '#ef4444' }] })}
                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
              >
                <Plus className="w-3 h-3" /> Add rule
              </button>
              <p className="text-[9px] text-slate-600 leading-snug">Applies to single-measure bar charts (colors each bar by its value).</p>
            </div>
          </Section>
        </>
      )}

      <Section title="Card">
        <Toggle label="Show header" checked={fmt.showHeader !== false} onChange={(v) => setFmt({ showHeader: v })} />
        <div className="grid grid-cols-2 gap-2 mt-1">
          <Field label="Background">
            <ColorOrAuto value={fmt.backgroundColor} onChange={(v) => setFmt({ backgroundColor: v })} />
          </Field>
          <NumberField label="Corner radius" value={fmt.borderRadius ?? null} onChange={(v) => setFmt({ borderRadius: v ?? undefined })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Title color">
            <ColorOrAuto value={fmt.headerColor} onChange={(v) => setFmt({ headerColor: v })} />
          </Field>
          <Field label="Subtitle color">
            <ColorOrAuto value={fmt.subtitleColor} onChange={(v) => setFmt({ subtitleColor: v })} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function updateRule(rules: ConditionalRule[], i: number, patch: Partial<ConditionalRule>, setFmt: (p: Partial<FormattingConfig>) => void) {
  const next = rules.map((r, j) => (j === i ? { ...r, ...patch } : r));
  setFmt({ conditionalRules: next });
}

// ── Presentational blocks ─────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center justify-between w-full py-1.5 group">
      <span className="text-[11px] text-slate-300">{label}</span>
      <span className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value ?? ''}
        placeholder="auto"
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full bg-darkBg border border-darkBorder rounded-md px-2 py-1.5 text-[10px] text-slate-200 focus:outline-none focus:border-blue-500"
      />
    </Field>
  );
}

function ColorOrAuto({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value || '#0d1117'}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-7 rounded-md bg-transparent border border-darkBorder cursor-pointer shrink-0"
      />
      {value ? (
        <button onClick={() => onChange(undefined)} className="text-[9px] text-blue-400 hover:text-blue-300">auto</button>
      ) : (
        <span className="text-[9px] text-slate-500">auto</span>
      )}
    </div>
  );
}
