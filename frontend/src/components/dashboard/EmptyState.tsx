/**
 * EmptyState.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Quick-Start shown centered over an empty canvas. Offers three fast paths:
 * ask the AI copilot, generate a full dashboard from a template, or drop in a
 * first chart to configure by hand. Non-blocking: the container ignores pointer
 * events so the surrounding canvas stays interactive; only the cards are live.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Sparkles, LayoutTemplate, BarChart3, Wand2 } from 'lucide-react';
import { useBuilderStore } from './builderStore';
import { genId, nextSlot, defaultSize } from './widgetFactory';

interface EmptyStateProps {
  onOpenAi: () => void;
}

export default function EmptyState({ onOpenAi }: EmptyStateProps) {
  const addWidget = useBuilderStore((s) => s.addWidget);

  const addStarterChart = () => {
    const size = defaultSize('chart', 'bar');
    const slot = nextSlot();
    addWidget({
      id: genId(),
      type: 'chart',
      chartType: 'bar',
      title: 'New chart',
      x: slot.x,
      y: slot.y,
      w: size.w,
      h: size.h,
      z: 0,
      formatting: { showLegend: true, showGrid: true },
      emitsCrossFilter: true,
    });
  };

  return (
    <div className="absolute inset-0 z-[30] flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto max-w-2xl w-full px-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
          <Sparkles className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-xl font-bold text-slate-100">Build your report</h2>
        <p className="text-sm text-slate-500 mt-1.5 mb-6 max-w-md mx-auto leading-relaxed">
          Start with AI, generate a ready-made dashboard, or add a visual and shape it yourself.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickCard
            icon={<Wand2 className="w-5 h-5" />}
            title="Ask Copilot"
            desc="Describe a chart in plain English."
            onClick={onOpenAi}
            accent
          />
          <QuickCard
            icon={<LayoutTemplate className="w-5 h-5" />}
            title="Use a template"
            desc="Generate a full dashboard in one click."
            onClick={onOpenAi}
          />
          <QuickCard
            icon={<BarChart3 className="w-5 h-5" />}
            title="Add a chart"
            desc="Drop a blank visual and bind data."
            onClick={addStarterChart}
          />
        </div>
      </div>
    </div>
  );
}

function QuickCard({
  icon, title, desc, onClick, accent,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group text-left p-4 rounded-xl border transition-all hover:-translate-y-0.5 ${
        accent
          ? 'border-blue-500/40 bg-blue-500/10 hover:border-blue-500 hover:bg-blue-500/15'
          : 'border-darkBorder bg-darkSidebar hover:border-slate-600'
      }`}
    >
      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg mb-2.5 ${accent ? 'bg-blue-500/20 text-blue-400' : 'bg-darkBg text-slate-400 group-hover:text-slate-200'}`}>
        {icon}
      </span>
      <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{desc}</p>
    </button>
  );
}
