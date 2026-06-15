import React, { useState, useEffect } from 'react';
import api from '../api';
import { useStore } from '../store/useStore';
import { 
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend
} from 'recharts';
import { 
  Plus, Trash2, ArrowUp, ArrowDown, Grid, HardDrive, RefreshCw, AlertTriangle,
  Settings, Eye, Edit3, Search, TrendingUp, TrendingDown, ArrowLeft,
  FileText, X
} from 'lucide-react';

interface WidgetDataProps {
  widget: any;
  onDelete: (widgetId: number) => void;
  onCustomize: (widget: any) => void;
  isEditMode: boolean;
}

// Re-run the widget's SQL directly against the backend
async function executeWidgetSql(databaseId: number, sql: string): Promise<{ success: boolean; columns: string[]; rows: any[]; error?: string }> {
  try {
    const res = await api.post('/queries/ask', {
      question: '__dashboard_reload__',
      database_id: databaseId,
      sql_query: sql,
    });
    if (res.data && res.data.results) {
      return {
        success: res.data.results.success !== false,
        columns: res.data.results.columns || [],
        rows: res.data.results.rows || [],
      };
    }
    return { success: false, columns: [], rows: [], error: 'Invalid response format' };
  } catch (err: any) {
    return { success: false, columns: [], rows: [], error: err.response?.data?.error || err.message };
  }
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

function formatKpiValue(value: any, columnName: string = '') {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (isNaN(num)) return String(value);

  const colLower = columnName.toLowerCase();
  const isCurrency = colLower.includes('sales') || colLower.includes('revenue') || colLower.includes('amount') || colLower.includes('price') || colLower.includes('cost') || colLower.includes('refund');
  const isPercent = colLower.includes('rate') || colLower.includes('percent') || colLower.includes('share') || colLower.includes('pct');

  let formatted = '';
  if (num >= 1e9) {
    formatted = (num / 1e9).toFixed(1) + 'B';
  } else if (num >= 1e6) {
    formatted = (num / 1e6).toFixed(1) + 'M';
  } else if (num >= 1e3) {
    formatted = (num / 1e3).toFixed(1) + 'K';
  } else {
    formatted = num % 1 === 0 ? num.toString() : num.toFixed(2);
  }

  if (isCurrency) {
    return '$' + formatted;
  }
  if (isPercent) {
    return formatted + '%';
  }
  return formatted;
}

function renderChart(chartType: string, xAxis: string, yAxis: string[], data: any[], customColors?: string[]) {
  const colors = customColors && customColors.length > 0 ? customColors : CHART_COLORS;

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs">
        No records to display.
      </div>
    );
  }

  // Fallbacks for chart variables if undefined
  const xKey = xAxis || Object.keys(data[0])[0];
  const yKeys = yAxis && yAxis.length > 0 ? yAxis : [Object.keys(data[0]).find(k => typeof data[0][k] === 'number') || Object.keys(data[0])[1]];

  switch (chartType) {
    case 'kpi': {
      const kpiKey = yKeys[0] || '';
      if (!kpiKey) {
        return (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs">
            Select a metric to view KPI status.
          </div>
        );
      }

      const values = data.map(r => Number(r[kpiKey])).filter(v => !isNaN(v));
      const latestValue = values[values.length - 1] ?? 0;
      const sum = values.reduce((a, b) => a + b, 0);
      const firstValue = values[0] ?? 0;

      const displayValue = data.length === 1 ? latestValue : sum;
      const displayLabel = data.length === 1 ? 'Value' : 'Total Aggregate';

      let percentageChange = 0;
      if (data.length > 1 && firstValue !== 0) {
        percentageChange = ((latestValue - firstValue) / Math.abs(firstValue)) * 100;
      }

      return (
        <div className="flex flex-col justify-between h-full p-1.5 relative overflow-hidden">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
              {kpiKey.replace(/_/g, ' ')} ({displayLabel})
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white tracking-tight">
                {formatKpiValue(displayValue, kpiKey)}
              </span>
              {data.length > 1 && percentageChange !== 0 && (
                <span className={`text-[10px] font-bold flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${
                  percentageChange > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                }`}>
                  {percentageChange > 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {percentageChange > 0 ? '+' : ''}{percentageChange.toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {data.length > 1 && (
            <div className="h-14 w-full mt-3 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="kpiSparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={percentageChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={percentageChange >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)', fontSize: 9, padding: '4px' }}
                    labelStyle={{ fontSize: 9 }}
                  />
                  <Area
                    type="monotone"
                    dataKey={kpiKey}
                    stroke={percentageChange >= 0 ? '#10b981' : '#ef4444'}
                    strokeWidth={1.8}
                    fillOpacity={1}
                    fill="url(#kpiSparkGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      );
    }
    case 'bar':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis dataKey={xKey} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)', fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {yKeys.map((yKey, idx) => (
              <Bar key={yKey} dataKey={yKey} fill={colors[idx % colors.length]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    case 'line':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis dataKey={xKey} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)', fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {yKeys.map((yKey, idx) => (
              <Line key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    case 'area':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {colors.map((color, idx) => (
                <linearGradient key={`grad-${idx}`} id={`dbGrad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis dataKey={xKey} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)', fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {yKeys.map((yKey, idx) => (
              <Area key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} fill={`url(#dbGrad-${idx})`} strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    case 'pie':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius="55%"
              dataKey={yKeys[0]}
              nameKey={xKey}
              label={({ name, percent }) => `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`}
              labelLine={false}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)', fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      );
    case 'scatter':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis type="number" dataKey={xKey} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <YAxis type="number" dataKey={yKeys[0]} stroke="var(--slate-400)" tick={{ fontSize: 9 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)', fontSize: 10 }} />
            <Scatter data={data} fill={colors[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    default:
      return (
        <div className="overflow-auto h-full">
          <table className="w-full text-left text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-darkBorder text-slate-400">
                {Object.keys(data[0] || {}).map(col => (
                  <th key={col} className="pb-2 px-2">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-darkBorder/30">
              {data.slice(0, 30).map((row, ri) => (
                <tr key={ri} className="hover:bg-darkSidebar/20">
                  {Object.keys(data[0]).map(col => (
                    <td key={col} className="py-1.5 px-2 text-slate-300">{row[col] === null ? '-' : String(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// Sub-component to fetch data and render a chart for a specific widget
function DashboardWidget({ widget, onDelete, onCustomize, isEditMode }: WidgetDataProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Extract config with fallbacks
  const config = widget.visualization.chart_config || {};
  const chart_type = config.chart_type || widget.visualization.chart_type || 'bar';
  const x_axis = config.x_axis || '';
  const y_axis = Array.isArray(config.y_axis) ? config.y_axis : (config.y_axis ? [config.y_axis] : []);
  const customColors = config.colors || [];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      const result = await executeWidgetSql(widget.query.database_id, widget.query.generated_sql);
      if (result.success) {
        setData(result.rows);
      } else {
        setError(result.error || 'Query failed');
      }
      setLoading(false);
    };
    load();
  }, [widget.query.generated_sql, widget.query.database_id]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-start mb-2 shrink-0">
        <div className="min-w-0 pr-2">
          <h4 className="font-bold text-slate-200 text-xs truncate" title={widget.query.question}>
            {widget.query.question === '__dashboard_reload__' ? 'Dashboard Chart' : widget.query.question}
          </h4>
          <p className="text-[10px] text-slate-500 italic mt-0.5 capitalize">
            {chart_type} chart
          </p>
        </div>
        {isEditMode && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onCustomize(widget)}
              className="text-slate-500 hover:text-blue-400 p-1 hover:bg-blue-500/10 rounded-lg transition-colors"
              title="Customize settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(widget.id)}
              className="text-slate-500 hover:text-red-400 p-1 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Remove widget"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 bg-darkBg/30 border border-darkBorder/40 rounded-xl p-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading data...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center text-xs text-red-400 gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <p>{error}</p>
          </div>
        ) : (
          renderChart(chart_type, x_axis, y_axis, data, customColors)
        )}
      </div>
    </div>
  );
}

export default function DashboardBuilder() {
  const { dashboards, setDashboards, activeDatabase, groqApiKey } = useStore();
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);
  const [dashboardDetails, setDashboardDetails] = useState<any>(null);
  
  const [newDashName, setNewDashName] = useState('');
  const [newDashDesc, setNewDashDesc] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Sider drawer options (Right drawer sliding panel inside canvas editor)
  const [drawerTab, setDrawerTab] = useState<'import' | 'ai'>('import');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [isEditMode, setIsEditMode] = useState<boolean>(true);
  const [historyQueries, setHistoryQueries] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // AI Assistant Box
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiCreating, setAiCreating] = useState(false);

  // AI Dashboard Summary State
  const [aiNarrative, setAiNarrative] = useState('');
  const [loadingNarrative, setLoadingNarrative] = useState(false);
  const [narrativeOpen, setNarrativeOpen] = useState(false);

  // Widget Customizer modal state
  const [editingWidget, setEditingWidget] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editChartType, setEditChartType] = useState('bar');
  const [editXAxis, setEditXAxis] = useState('');
  const [editYAxis, setEditYAxis] = useState<string[]>([]);
  const [editColorTheme, setEditColorTheme] = useState('blue');
  const [editColumns, setEditColumns] = useState<string[]>([]);
  const [loadingModalCols, setLoadingModalCols] = useState(false);

  const fetchDashboards = async () => {
    try {
      const res = await api.get('/dashboards');
      setDashboards(res.data);
      // Keep activeDashboardId as null on initial load to display portal list!
    } catch (err) {
      console.error(err);
    }
  };

  const fetchQueryHistory = async () => {
    try {
      const res = await api.get('/queries/history');
      const successful = res.data.filter((q: any) => q.status === 'success');
      setHistoryQueries(successful);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDashboards();
    fetchQueryHistory();
  }, []);

  const loadDashboardDetails = async (id: number) => {
    setLoading(true);
    setError('');
    setAiNarrative(''); 
    setNarrativeOpen(false);
    setIsDrawerOpen(false); // Reset drawer
    try {
      const res = await api.get(`/dashboards/${id}`);
      setDashboardDetails(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch dashboard layout detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeDashboardId) {
      loadDashboardDetails(activeDashboardId);
    } else {
      setDashboardDetails(null);
    }
  }, [activeDashboardId]);

  const handleRecommendDashboard = async () => {
    if (!activeDatabase) return;
    setGenerating(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/dashboards/recommend', {
        database_id: activeDatabase.id,
        api_key: groqApiKey
      });
      if (res.data && res.data.dashboard_id) {
        setSuccess('AI recommended dashboard generated successfully!');
        await fetchDashboards();
        setActiveDashboardId(res.data.dashboard_id);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to auto-generate recommended dashboard.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDashName.trim()) return;

    setError('');
    setSuccess('');
    try {
      const res = await api.post('/dashboards', {
        name: newDashName,
        description: newDashDesc
      });
      setSuccess('Dashboard created!');
      setNewDashName('');
      setNewDashDesc('');
      await fetchDashboards();
      setActiveDashboardId(res.data.id); // Open it immediately
    } catch (err) {
      setError('Failed to create dashboard.');
    }
  };

  const handleDeleteDashboard = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation(); // Stop clicking card
    if (!confirm('Are you sure you want to delete this entire dashboard? All widgets inside will be lost.')) return;
    setError('');
    setSuccess('');
    try {
      await api.delete(`/dashboards/${id}`);
      setSuccess('Dashboard deleted.');
      if (activeDashboardId === id) {
        setActiveDashboardId(null);
        setDashboardDetails(null);
      }
      fetchDashboards();
    } catch (err) {
      setError('Failed to delete.');
    }
  };

  const handleRemoveWidget = async (widgetId: number) => {
    try {
      await api.delete(`/dashboards/widgets/${widgetId}`);
      if (activeDashboardId) {
        loadDashboardDetails(activeDashboardId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWidgetWidth = async (widgetId: number, increase: boolean) => {
    if (!dashboardDetails) return;
    const layout = dashboardDetails.widgets.map((w: any) => {
      let width = w.width;
      if (w.id === widgetId) {
        width = increase ? Math.min(12, width + 2) : Math.max(4, width - 2);
      }
      return { widget_id: w.id, position_x: w.position_x, position_y: w.position_y, width, height: w.height };
    });
    try {
      await api.put(`/dashboards/${activeDashboardId}/widgets/layout`, { layout });
      if (activeDashboardId) loadDashboardDetails(activeDashboardId);
    } catch (err) { console.error(err); }
  };

  const handleUpdateWidgetHeight = async (widgetId: number, increase: boolean) => {
    if (!dashboardDetails) return;
    const layout = dashboardDetails.widgets.map((w: any) => {
      let height = w.height;
      if (w.id === widgetId) {
        height = increase ? Math.min(8, height + 1) : Math.max(3, height - 1);
      }
      return { widget_id: w.id, position_x: w.position_x, position_y: w.position_y, width: w.width, height };
    });
    try {
      await api.put(`/dashboards/${activeDashboardId}/widgets/layout`, { layout });
      if (activeDashboardId) loadDashboardDetails(activeDashboardId);
    } catch (err) { console.error(err); }
  };

  const handleMoveWidgetOrder = async (widgetId: number, direction: 'up' | 'down') => {
    if (!dashboardDetails) return;
    const widgets = [...dashboardDetails.widgets];
    const index = widgets.findIndex(w => w.id === widgetId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= widgets.length) return;
    const temp = widgets[index];
    widgets[index] = widgets[targetIndex];
    widgets[targetIndex] = temp;
    const layout = widgets.map((w: any, idx: number) => ({
      widget_id: w.id,
      position_x: idx,
      position_y: 0,
      width: w.width,
      height: w.height
    }));
    try {
      await api.put(`/dashboards/${activeDashboardId}/widgets/layout`, { layout });
      if (activeDashboardId) loadDashboardDetails(activeDashboardId);
    } catch (err) { console.error(err); }
  };

  // Import specific saved query to dashboard
  const handleImportQuery = async (queryId: number) => {
    if (!activeDashboardId) return;
    setError('');
    setSuccess('');
    try {
      await api.post(`/dashboards/${activeDashboardId}/widgets/import-query`, {
        query_id: queryId,
        chart_type: 'bar' // default type
      });
      setSuccess('Query successfully imported to dashboard!');
      loadDashboardDetails(activeDashboardId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to import query.');
    }
  };

  // AI Widget builder form
  const handleCreateAiWidget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDashboardId || !activeDatabase || !aiQuestion.trim()) return;

    setAiCreating(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/queries/ask', {
        question: aiQuestion,
        database_id: activeDatabase.id,
        api_key: groqApiKey
      });

      if (res.data && res.data.visualization_id) {
        // Add visual widget
        await api.post(`/dashboards/${activeDashboardId}/widgets`, {
          visualization_id: res.data.visualization_id,
          position_x: 0,
          position_y: 0,
          width: 6,
          height: 4
        });
        setSuccess(`AI successfully added chart: "${aiQuestion}"`);
        setAiQuestion('');
        loadDashboardDetails(activeDashboardId);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to construct AI chart.');
    } finally {
      setAiCreating(false);
    }
  };

  // AI executive narrative builder
  const handleGenerateAiNarrative = async () => {
    if (!activeDashboardId) return;
    setLoadingNarrative(true);
    setNarrativeOpen(true);
    try {
      const res = await api.get(`/dashboards/${activeDashboardId}/ai-insights?api_key=${groqApiKey}`);
      setAiNarrative(res.data.insights);
    } catch (err) {
      console.error(err);
      setAiNarrative('Failed to fetch dashboard executive narrative summary.');
    } finally {
      setLoadingNarrative(false);
    }
  };

  // Widget customizer modal controllers
  const handleOpenCustomize = async (widget: any) => {
    setEditingWidget(widget);
    setEditTitle(widget.query.question || '');
    const config = widget.visualization.chart_config || {};
    setEditChartType(config.chart_type || widget.visualization.chart_type || 'bar');
    setEditXAxis(config.x_axis || '');
    setEditYAxis(Array.isArray(config.y_axis) ? config.y_axis : (config.y_axis ? [config.y_axis] : []));
    setEditColorTheme(config.colorTheme || 'blue');

    // Load available data columns from query
    setLoadingModalCols(true);
    setEditColumns([]);
    const result = await executeWidgetSql(widget.query.database_id, widget.query.generated_sql);
    if (result.success) {
      setEditColumns(result.columns);
    }
    setLoadingModalCols(false);
  };

  const handleSaveCustomization = async () => {
    if (!editingWidget || !activeDashboardId) return;

    // Pick colors based on palette selection
    let colors = CHART_COLORS;
    if (editColorTheme === 'emerald') colors = ['#10b981', '#059669', '#34d399', '#6ee7b7'];
    else if (editColorTheme === 'amber') colors = ['#f59e0b', '#d97706', '#fbbf24', '#fcd34d'];
    else if (editColorTheme === 'violet') colors = ['#8b5cf6', '#7c3aed', '#a78bfa', '#c4b5fd'];
    else if (editColorTheme === 'rose') colors = ['#f43f5e', '#e11d48', '#fda4af', '#fecdd3'];
    else if (editColorTheme === 'coolGray') colors = ['#64748b', '#475569', '#94a3b8', '#cbd5e1'];
    else if (editColorTheme === 'rainbow') colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

    const payload = {
      question: editTitle,
      chart_type: editChartType,
      chart_config: {
        chart_type: editChartType,
        x_axis: editXAxis,
        y_axis: editYAxis,
        colors,
        colorTheme: editColorTheme
      }
    };

    try {
      await api.put(`/dashboards/widgets/${editingWidget.id}`, payload);
      setSuccess('Visual customized successfully!');
      setEditingWidget(null);
      loadDashboardDetails(activeDashboardId);
    } catch (err) {
      console.error(err);
      alert('Failed to save customization details.');
    }
  };

  const filteredHistory = historyQueries.filter(q => 
    q.question.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // VIEW 1: Dashboards Portal (Listing + Create Panel)
  if (activeDashboardId === null) {
    return (
      <div className="space-y-6 w-full py-4">
        
        {/* Portal top actions bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-darkBorder/60 pb-4 gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-200">My Dashboards</h1>
            <p className="text-xs text-slate-505 mt-1 text-slate-500">Select an existing workspace or build a new visual dashboard layout</p>
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex-1 sm:flex-initial bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 hover:shadow-blue-600/15"
            >
              <Plus className="w-4 h-4" />
              Create Dashboard
            </button>
            
            <button
              onClick={handleRecommendDashboard}
              disabled={generating || !activeDatabase}
              className={`flex-1 sm:flex-initial py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 border ${
                !activeDatabase 
                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' 
                  : generating 
                    ? 'bg-blue-600/50 cursor-wait'
                    : 'bg-blue-600/10 border-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white'
              }`}
            >
              {generating && (
                <RefreshCw className="w-4 h-4 animate-spin" />
              )}
              AI Quick Dashboard
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-xs rounded-xl">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs rounded-xl">
            {success}
          </div>
        )}

        {/* Dashboards List Cards Grid (Full width) */}
        {dashboards.length === 0 ? (
          <div className="border border-dashed border-darkBorder rounded-2xl py-24 text-center bg-darkSidebar/5 space-y-3">
            <Grid className="w-12 h-12 text-slate-700 mx-auto" />
            <div>
              <h4 className="font-bold text-slate-400 text-sm">No dashboards created yet</h4>
              <p className="text-slate-500 text-xs mt-1">Click the "Create Dashboard" button to start designing your analytics workspace.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {dashboards.map(d => (
              <div
                key={d.id}
                onClick={() => setActiveDashboardId(d.id)}
                className="bg-darkSidebar/20 hover:bg-darkSidebar/30 border border-darkBorder hover:border-slate-600 rounded-2xl p-5 cursor-pointer transition-all hover:scale-[1.01] hover:shadow-lg flex flex-col justify-between h-[160px] group relative"
              >
                <div className="space-y-1">
                  <div className="flex justify-between items-start">
                    <span className="p-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl">
                      <FileText className="w-4 h-4" />
                    </span>
                    
                    <button
                      onClick={(e) => handleDeleteDashboard(e, d.id)}
                      className="text-slate-600 hover:text-red-400 p-1.5 hover:bg-red-500/10 rounded-lg transition-colors absolute top-4 right-4"
                      title="Delete dashboard"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h3 className="font-bold text-slate-200 text-xs pr-6 truncate pt-2">{d.name}</h3>
                  <p className="text-[10px] text-slate-505 line-clamp-2 leading-relaxed mt-1 text-slate-500">
                    {d.description || 'No description provided.'}
                  </p>
                </div>

                <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 border-t border-darkBorder/40 pt-2 shrink-0">
                  <span>{new Date(d.created_at).toLocaleDateString()}</span>
                  <span className="text-blue-500 group-hover:underline flex items-center gap-0.5">
                    Open Canvas →
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CREATE NEW DASHBOARD POPUP MODAL */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-darkSidebar border border-darkBorder w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
              
              <div className="flex justify-between items-center border-b border-darkBorder pb-3">
                <div>
                  <h3 className="font-bold text-slate-200 text-sm">Create New Dashboard</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Define name and description to initialize canvas workspace</p>
                </div>
                <button 
                  onClick={() => { setShowCreateModal(false); setNewDashName(''); setNewDashDesc(''); }}
                  className="text-slate-500 hover:text-slate-300 font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={(e) => { handleCreateDashboard(e); setShowCreateModal(false); }} className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <label className="text-slate-400 font-semibold uppercase tracking-wider block">Dashboard Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sales Metrics 2026"
                    className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-blue-500 font-medium"
                    value={newDashName}
                    onChange={(e) => setNewDashName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400 font-semibold uppercase tracking-wider block">Description (Optional)</label>
                  <textarea
                    placeholder="Summarize the core KPIs and metrics analyzed in this layout"
                    className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-blue-500 h-24 resize-none leading-relaxed"
                    value={newDashDesc}
                    onChange={(e) => setNewDashDesc(e.target.value)}
                  />
                </div>

                <div className="flex gap-3 pt-3 border-t border-darkBorder/40">
                  <button
                    type="button"
                    onClick={() => { setShowCreateModal(false); setNewDashName(''); setNewDashDesc(''); }}
                    className="flex-1 bg-darkBg hover:bg-slate-800 border border-darkBorder text-slate-300 font-semibold py-2 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-xl transition-all shadow-md"
                  >
                    Create & Open
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // VIEW 2: Dashboard Editor View (Canvas + Slide-out Right Drawer)
  return (
    <div className="space-y-6 flex flex-col h-full min-h-[500px]">

      {/* Editor top navigation and action bar */}
      <div className="bg-slate-900 border border-darkBorder rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveDashboardId(null)}
            className="p-2 bg-darkBg border border-darkBorder hover:border-slate-600 hover:text-white rounded-xl transition-all"
            title="Back to portal list"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-200 leading-none">{dashboardDetails?.name}</h2>
              <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">Editor</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">{dashboardDetails?.description || 'No description provided.'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap md:flex-nowrap justify-end">
          
          {/* Mode toggle */}
          <div className="flex border border-darkBorder bg-darkBg rounded-xl p-1 shrink-0">
            <button
              onClick={() => { setIsEditMode(false); setIsDrawerOpen(false); }}
              className={`flex items-center gap-1.5 py-1 px-3 text-[10px] font-bold rounded-lg transition-colors ${
                !isEditMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              View
            </button>
            <button
              onClick={() => setIsEditMode(true)}
              className={`flex items-center gap-1.5 py-1 px-3 text-[10px] font-bold rounded-lg transition-colors ${
                isEditMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Edit3 className="w-3 h-3" />
              Edit
            </button>
          </div>

          {/* Right drawer toggler (Add visual button) */}
          {isEditMode && (
            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              className={`py-1.5 px-3 rounded-xl text-[10px] font-bold border transition-all flex items-center gap-1.5 ${
                isDrawerOpen 
                  ? 'bg-blue-600/10 border-blue-500/30 text-blue-400' 
                  : 'bg-blue-600 border-blue-600 hover:bg-blue-500 text-white shadow-sm'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Visuals / AI Suggestions
            </button>
          )}

          {/* Generate narrative summaries */}
          {dashboardDetails?.widgets.length > 0 && (
            <button
              onClick={handleGenerateAiNarrative}
              className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white text-[10px] font-bold py-1.5 px-3 rounded-xl flex items-center gap-1.5 transition-all shadow-md active:scale-95"
            >
              Smart Narrative
            </button>
          )}

          {!activeDatabase && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full shrink-0">
              <HardDrive className="w-3 h-3" />
              DB Offline
            </span>
          )}

        </div>
      </div>

      {/* Editor main layout workspace */}
      <div className="flex flex-1 gap-6 relative min-h-0">
        
        {/* Left canvas board (takes up remaining space) */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 bg-darkSidebar/20 border border-darkBorder rounded-2xl h-[400px]">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
            <p className="text-slate-400 text-sm font-medium animate-pulse">Assembling widgets layout...</p>
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto pr-1 pb-6 min-w-0">

          {/* AI Smart Narrative Executive Panel */}
          {narrativeOpen && (
            <div className="bg-slate-900 border border-darkBorder rounded-2xl p-5 space-y-4 shadow-xl relative overflow-hidden transition-all duration-300 border-l-4 border-l-emerald-500 shrink-0">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl"></div>
              
              <div className="flex justify-between items-center border-b border-darkBorder/60 pb-3">
                <h3 className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                  AI Smart Narrative Executive Summary
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateAiNarrative}
                    disabled={loadingNarrative}
                    className="text-[9px] font-bold text-slate-400 hover:text-slate-200 bg-darkBg border border-darkBorder px-2.5 py-1 rounded-lg flex items-center gap-1"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${loadingNarrative ? 'animate-spin' : ''}`} />
                    Regenerate
                  </button>
                  <button
                    onClick={() => setNarrativeOpen(false)}
                    className="text-slate-500 hover:text-slate-300 text-[10px] font-bold px-2 py-1"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {loadingNarrative ? (
                <div className="flex flex-col items-center justify-center py-6 text-slate-400 text-xs gap-3">
                  <RefreshCw className="w-5 h-5 text-emerald-500 animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="font-semibold animate-pulse text-emerald-400">Consulting AI Analyst...</p>
                    <p className="text-[9px] text-slate-500">Executing SQL queries, compiling chart models, drafting brief...</p>
                  </div>
                </div>
              ) : (
                <div className="prose prose-invert max-w-none text-slate-300 leading-relaxed text-xs">
                  {aiNarrative ? (
                    <div className="space-y-3.5">
                      {aiNarrative.split('\n\n').map((block, idx) => {
                        if (block.startsWith('###')) {
                          return (
                            <h4 key={idx} className="text-emerald-400 font-bold text-xs mt-3 flex items-center gap-1 border-b border-darkBorder/30 pb-1">
                              {block.replace('###', '').trim()}
                            </h4>
                          );
                        }
                        if (block.trim().startsWith('-')) {
                          return (
                            <ul key={idx} className="space-y-1.5 pl-4 list-disc">
                              {block.split('\n').map((li, lIdx) => {
                                const cleanedLi = li.replace(/^-\s*/, '');
                                return (
                                  <li key={lIdx} dangerouslySetInnerHTML={{ 
                                    __html: cleanedLi.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') 
                                  }} />
                                );
                              })}
                            </ul>
                          );
                        }
                        return (
                          <p key={idx} dangerouslySetInnerHTML={{ 
                            __html: block.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') 
                          }} />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-slate-500 italic">No summary generated.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Widgets Canvas Board */}
          {dashboardDetails?.widgets.length === 0 ? (
            <div className="border border-dashed border-darkBorder rounded-2xl p-16 text-center bg-darkSidebar/10">
              <Grid className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-300 mb-1">No widgets on this dashboard</h3>
              <p className="text-slate-500 text-xs max-w-xs mx-auto">
                Click the <strong>➕ Add Visuals</strong> button in the top right to import charts or get AI recommendations.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {dashboardDetails?.widgets.map((widget: any, idx: number) => {
                const widthClasses = {
                  4: 'md:col-span-4',
                  6: 'md:col-span-6',
                  8: 'md:col-span-8',
                  10: 'md:col-span-10',
                  12: 'md:col-span-12'
                }[widget.width as 4|6|8|10|12] || 'md:col-span-6';

                const heightStyle = {
                  3: 'h-[250px]',
                  4: 'h-[300px]',
                  5: 'h-[350px]',
                  6: 'h-[400px]',
                  7: 'h-[450px]',
                  8: 'h-[500px]'
                }[widget.height as 3|4|5|6|7|8] || 'h-[320px]';

                return (
                  <div
                    key={widget.id}
                    className={`bg-darkSidebar/40 border ${isEditMode ? 'border-darkBorder hover:border-slate-500' : 'border-darkBorder/40'} rounded-2xl p-5 flex flex-col group transition-all duration-300 ${widthClasses} ${heightStyle}`}
                  >
                    <div className="flex-1 min-h-0">
                      <DashboardWidget 
                        widget={widget} 
                        onDelete={handleRemoveWidget} 
                        onCustomize={handleOpenCustomize}
                        isEditMode={isEditMode}
                      />
                    </div>

                    {/* Widget control bar - only display in edit mode */}
                    {isEditMode && (
                      <div className="flex items-center justify-between border-t border-darkBorder/60 pt-3 mt-3 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                          <span>Sizing:</span>
                          <button onClick={() => handleUpdateWidgetWidth(widget.id, true)} className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded" title="Make wider">+ W</button>
                          <button onClick={() => handleUpdateWidgetWidth(widget.id, false)} className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded" title="Make narrower">- W</button>
                          <span className="text-slate-600">|</span>
                          <button onClick={() => handleUpdateWidgetHeight(widget.id, true)} className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded" title="Make taller">+ H</button>
                          <button onClick={() => handleUpdateWidgetHeight(widget.id, false)} className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded" title="Make shorter">- H</button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMoveWidgetOrder(widget.id, 'up')}
                            disabled={idx === 0}
                            className="p-1 bg-darkBg border border-darkBorder hover:text-slate-200 rounded disabled:opacity-40"
                            title="Move left"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleMoveWidgetOrder(widget.id, 'down')}
                            disabled={idx === dashboardDetails.widgets.length - 1}
                            className="p-1 bg-darkBg border border-darkBorder hover:text-slate-200 rounded disabled:opacity-40"
                            title="Move right"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Right drawer - slides out to import queries or use the AI visualizer */}
        {isEditMode && isDrawerOpen && (
          <div className="w-80 shrink-0 border-l border-darkBorder/80 bg-slate-900/95 backdrop-blur rounded-2xl flex flex-col h-full shadow-2xl relative z-20 overflow-hidden">
            
            {/* Drawer Header */}
            <div className="p-4 border-b border-darkBorder flex items-center justify-between shrink-0">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-blue-500" /> Add Visual Options
              </span>
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="text-slate-500 hover:text-slate-300 p-1 hover:bg-darkBg rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab switchers */}
            <div className="flex border-b border-darkBorder bg-darkSidebar/35 p-2 shrink-0 gap-2">
              <button
                onClick={() => { setDrawerTab('import'); fetchQueryHistory(); }}
                className={`flex-1 text-[10px] font-bold py-1.5 px-2 text-center rounded-lg transition-colors ${
                  drawerTab === 'import' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Import Saved
              </button>
              <button
                onClick={() => setDrawerTab('ai')}
                className={`flex-1 text-[10px] font-bold py-1.5 px-2 text-center rounded-lg transition-colors ${
                  drawerTab === 'ai' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AI Assistant
              </button>
            </div>

            {/* Drawer Panel Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* TAB 1: Import from history */}
              {drawerTab === 'import' && (
                <div className="space-y-4">
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Quickly add queries you have already run in the workspace onto this dashboard layout.
                  </p>

                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search saved history..."
                      className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 pl-9 pr-3 text-[11px] focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                    {filteredHistory.length === 0 ? (
                      <p className="text-slate-500 text-xs text-center py-6">No matching queries found</p>
                    ) : (
                      filteredHistory.map(q => (
                        <div 
                          key={q.id}
                          className="bg-darkBg border border-darkBorder hover:border-slate-700 rounded-xl p-3 space-y-2 transition-all relative group"
                        >
                          <div>
                            <p className="text-[11px] text-slate-200 font-semibold leading-normal pr-4">
                              {q.question}
                            </p>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-1 block">
                              DB: {q.database_name || 'Sandbox'}
                            </span>
                          </div>
                          <button
                            onClick={() => handleImportQuery(q.id)}
                            className="w-full py-1 px-2.5 bg-blue-600/15 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-500/20 hover:border-blue-500 text-[10px] font-semibold rounded-lg transition-all"
                          >
                            + Import Widget
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: AI builder suggest */}
              {drawerTab === 'ai' && (
                <div className="space-y-5">
                  <div className="bg-gradient-to-tr from-blue-950/20 to-purple-950/20 border border-darkBorder rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center gap-1.5 text-blue-400 font-bold text-[11px]">
                      <span>Natural Language Visualizer</span>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-relaxed">
                      Enter any visualization request. We will auto-execute SQL and map the metrics.
                    </p>

                    <form onSubmit={handleCreateAiWidget} className="space-y-2.5">
                      <textarea
                        required
                        placeholder="e.g. Show sum of sales by product category as a bar chart"
                        className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-[11px] focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600 h-16 resize-none leading-normal"
                        value={aiQuestion}
                        onChange={(e) => setAiQuestion(e.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={aiCreating || !activeDatabase}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-1.5 px-3 rounded-lg text-[10px] transition-colors flex items-center justify-center gap-1.5"
                      >
                        {aiCreating ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" />
                            Add Chart
                          </>
                        )}
                      </button>
                    </form>
                  </div>

                  <div className="space-y-2">
                    <span className="block text-[9px] font-extrabold text-slate-500 uppercase tracking-widest px-1">
                      Quick Suggestions
                    </span>
                    
                    <div className="space-y-1.5">
                      {[
                        "Total sales by category",
                        "Monthly sales trend line",
                        "Top 5 products by revenue",
                        "Customer counts by segment",
                        "Table of inventory stock levels"
                      ].map((rec, i) => (
                        <button
                          key={i}
                          onClick={() => setAiQuestion(rec)}
                          className="w-full text-left p-2 bg-darkBg hover:bg-darkBg/80 border border-darkBorder/60 hover:border-slate-700 rounded-xl text-[10px] text-slate-300 hover:text-slate-100 transition-all truncate block"
                        >
                          {rec}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      {/* WIDGET CUSTOMIZATION CONFIG MODAL */}
      {editingWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-darkSidebar border border-darkBorder w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
            
            <div className="flex justify-between items-center border-b border-darkBorder pb-3">
              <div>
                <h3 className="font-bold text-slate-200 text-sm">Visual Widget Settings</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Customize visualization maps, fields, type, and layout colors</p>
              </div>
              <button 
                onClick={() => setEditingWidget(null)}
                className="text-slate-500 hover:text-slate-300 font-bold"
              >
                ✕
              </button>
            </div>

            {loadingModalCols ? (
              <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                Reading dataset columns...
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                
                {/* Visual Title */}
                <div className="space-y-1.5">
                  <label className="text-slate-400 font-semibold uppercase tracking-wider block">Widget Header / Title</label>
                  <input
                    type="text"
                    className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-blue-500 font-medium"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Chart type */}
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-semibold uppercase tracking-wider block">Visualization Type</label>
                    <select
                      className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                      value={editChartType}
                      onChange={(e) => setEditChartType(e.target.value)}
                    >
                      <option value="bar">Bar Chart</option>
                      <option value="line">Line Chart</option>
                      <option value="area">Area Chart</option>
                      <option value="pie">Pie Chart</option>
                      <option value="scatter">Scatter Plot</option>
                      <option value="kpi">KPI Stat Card</option>
                      <option value="table">Data Grid Table</option>
                    </select>
                  </div>

                  {/* Colors Theme */}
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-semibold uppercase tracking-wider block">Color Palette</label>
                    <select
                      className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                      value={editColorTheme}
                      onChange={(e) => setEditColorTheme(e.target.value)}
                    >
                      <option value="blue">Vibrant Blue (Default)</option>
                      <option value="emerald">Eco Emerald</option>
                      <option value="amber">Warm Amber</option>
                      <option value="violet">Mystic Violet</option>
                      <option value="rose">Sunset Rose</option>
                      <option value="coolGray">Industrial Steel</option>
                      <option value="rainbow">Rainbow Accent</option>
                    </select>
                  </div>
                </div>

                {editChartType !== 'table' && (
                  <div className="grid grid-cols-2 gap-4 border-t border-darkBorder/40 pt-3">
                    
                    {/* X-Axis Column mapping */}
                    <div className="space-y-1.5">
                      <label className="text-slate-400 font-semibold uppercase tracking-wider block">
                        {editChartType === 'kpi' ? 'Dimension Label' : 'X-Axis Column'}
                      </label>
                      <select
                        className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                        value={editXAxis}
                        onChange={(e) => setEditXAxis(e.target.value)}
                      >
                        <option value="">-- Choose Field --</option>
                        {editColumns.map(col => (
                          <option key={col} value={col}>{col.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </div>

                    {/* Y-Axis Column mapping */}
                    <div className="space-y-1.5">
                      <label className="text-slate-400 font-semibold uppercase tracking-wider block">
                        {editChartType === 'kpi' ? 'KPI Value Metric' : 'Y-Axis Metric(s)'}
                      </label>
                      
                      {editChartType === 'kpi' ? (
                        <select
                          className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                          value={editYAxis[0] || ''}
                          onChange={(e) => setEditYAxis(e.target.value ? [e.target.value] : [])}
                        >
                          <option value="">-- Choose Metric --</option>
                          {editColumns.map(col => (
                            <option key={col} value={col}>{col.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="bg-darkBg border border-darkBorder rounded-xl p-2.5 max-h-[120px] overflow-y-auto space-y-1.5">
                          {editColumns.map(col => {
                            const checked = editYAxis.includes(col);
                            return (
                              <label key={col} className="flex items-center gap-2 text-slate-300 font-medium hover:text-white cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    if (checked) {
                                      setEditYAxis(editYAxis.filter(k => k !== col));
                                    } else {
                                      setEditYAxis([...editYAxis, col]);
                                    }
                                  }}
                                  className="rounded text-blue-600 focus:ring-0 focus:ring-offset-0 bg-darkBg border-darkBorder"
                                />
                                {col.replace(/_/g, ' ')}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-3 border-t border-darkBorder/40">
                  <button
                    onClick={() => setEditingWidget(null)}
                    className="flex-1 bg-darkBg hover:bg-slate-800 border border-darkBorder text-slate-300 font-semibold py-2 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCustomization}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-xl transition-all shadow-md"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
