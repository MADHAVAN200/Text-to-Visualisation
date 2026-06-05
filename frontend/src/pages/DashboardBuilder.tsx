import React, { useState, useEffect } from 'react';
import api from '../api';
import { useStore } from '../store/useStore';
import { 
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area, 
  XAxis, YAxis, CartesianGrid, Tooltip, Cell 
} from 'recharts';
import { 
  Plus, Trash2, ArrowUp, ArrowDown, Grid, HardDrive, LayoutGrid
} from 'lucide-react';

interface WidgetDataProps {
  widget: any;
  onDelete: (widgetId: number) => void;
}

// Sub-component to fetch data and render a chart for a specific widget
function DashboardWidget({ widget, onDelete }: WidgetDataProps) {
  const { activeDatabase } = useStore();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchWidgetData = async () => {
      if (!activeDatabase) return;
      try {
        const res = await api.post('/queries/execute-query', {
          database_id: widget.query.database_id,
          sql_query: widget.query.generated_sql,
          question: widget.query.question
        });
        if (res.data.success) {
          setData(res.data.rows);
        } else {
          setError(res.data.error || 'Execution failed');
        }
      } catch (err: any) {
        setError(err.message || 'Failed to query');
      } finally {
        setLoading(false);
      }
    };
    fetchWidgetData();
  }, [activeDatabase, widget]);

  const renderWidgetChart = () => {
    const { chart_type, x_axis, y_axis, config } = widget.visualization.chart_config;
    const colors = config.colors || ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center text-xs text-red-400">
          <HardDrive className="w-6 h-6 text-red-500 mb-1" />
          <p>Query Failed: database unlinked or modified</p>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-slate-500 text-xs">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading chart...
        </div>
      );
    }

    if (data.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-slate-500 text-xs">
          No records found.
        </div>
      );
    }

    switch (chart_type) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey={x_axis} stroke="#64748b" tick={{ fontSize: 9 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', fontSize: 10 }} />
              {y_axis.map((yKey: string, idx: number) => (
                <Bar key={yKey} dataKey={yKey} fill={colors[idx % colors.length]} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );
      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey={x_axis} stroke="#64748b" tick={{ fontSize: 9 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', fontSize: 10 }} />
              {y_axis.map((yKey: string, idx: number) => (
                <Line key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );
      case 'area':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey={x_axis} stroke="#64748b" tick={{ fontSize: 9 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', fontSize: 10 }} />
              {y_axis.map((yKey: string, idx: number) => (
                <Area key={yKey} type="monotone" dataKey={yKey} stroke={colors[idx % colors.length]} fill={colors[idx % colors.length]} fillOpacity={0.1} />
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
                outerRadius={50}
                dataKey={y_axis[0]}
                nameKey={x_axis}
              >
                {data.map((_: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc', fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        );
      default:
        return <div className="text-xs text-slate-500">Unsupported preview</div>;
    }
  };

  return (
    <div className="w-full h-full flex flex-col justify-between">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h4 className="font-bold text-slate-200 text-xs truncate" title={widget.query.question}>
            {widget.query.question}
          </h4>
          <p className="text-[10px] text-slate-500 italic mt-0.5">
            SQL: {widget.visualization.chart_config.chart_type} chart
          </p>
        </div>
        <button
          onClick={() => onDelete(widget.id)}
          className="text-slate-500 hover:text-red-400 p-1 hover:bg-red-500/10 rounded-lg transition-colors"
          title="Remove widget"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-darkBg/30 border border-darkBorder/40 rounded-xl p-2">
        {renderWidgetChart()}
      </div>
    </div>
  );
}

// Loading helper icon
import { RefreshCw } from 'lucide-react';

export default function DashboardBuilder() {
  const { dashboards, setDashboards, activeDatabase } = useStore();
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);
  const [dashboardDetails, setDashboardDetails] = useState<any>(null);
  
  const [newDashName, setNewDashName] = useState('');
  const [newDashDesc, setNewDashDesc] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchDashboards = async () => {
    try {
      const res = await api.get('/dashboards');
      setDashboards(res.data);
      if (res.data.length > 0 && !activeDashboardId) {
        setActiveDashboardId(res.data[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDashboards();
  }, []);

  const loadDashboardDetails = async (id: number) => {
    setLoading(true);
    setError('');
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
      fetchDashboards();
      setActiveDashboardId(res.data.id);
    } catch (err) {
      setError('Failed to create dashboard.');
    }
  };

  const handleDeleteDashboard = async (id: number) => {
    if (!confirm('Are you sure you want to delete this entire dashboard? All widgets inside will be lost.')) return;
    setError('');
    setSuccess('');
    try {
      await api.delete(`/dashboards/${id}`);
      setSuccess('Dashboard deleted.');
      setActiveDashboardId(null);
      setDashboardDetails(null);
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

  // Layout adjustment triggers
  const handleUpdateWidgetWidth = async (widgetId: number, increase: boolean) => {
    if (!dashboardDetails) return;
    const layout = dashboardDetails.widgets.map((w: any) => {
      let width = w.width;
      if (w.id === widgetId) {
        width = increase ? Math.min(12, width + 2) : Math.max(4, width - 2);
      }
      return {
        widget_id: w.id,
        position_x: w.position_x,
        position_y: w.position_y,
        width,
        height: w.height
      };
    });
    
    try {
      await api.put(`/dashboards/${activeDashboardId}/widgets/layout`, { layout });
      if (activeDashboardId) loadDashboardDetails(activeDashboardId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWidgetHeight = async (widgetId: number, increase: boolean) => {
    if (!dashboardDetails) return;
    const layout = dashboardDetails.widgets.map((w: any) => {
      let height = w.height;
      if (w.id === widgetId) {
        height = increase ? Math.min(8, height + 1) : Math.max(3, height - 1);
      }
      return {
        widget_id: w.id,
        position_x: w.position_x,
        position_y: w.position_y,
        width: w.width,
        height
      };
    });
    
    try {
      await api.put(`/dashboards/${activeDashboardId}/widgets/layout`, { layout });
      if (activeDashboardId) loadDashboardDetails(activeDashboardId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleMoveWidgetOrder = async (widgetId: number, direction: 'up' | 'down') => {
    if (!dashboardDetails) return;
    const widgets = [...dashboardDetails.widgets];
    const index = widgets.findIndex(w => w.id === widgetId);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= widgets.length) return;

    // Swap indexes
    const temp = widgets[index];
    widgets[index] = widgets[targetIndex];
    widgets[targetIndex] = temp;

    const layout = widgets.map((w: any, idx: number) => ({
      widget_id: w.id,
      position_x: idx, // Use incremental index for horizontal layout ordering
      position_y: 0,
      width: w.width,
      height: w.height
    }));

    try {
      await api.put(`/dashboards/${activeDashboardId}/widgets/layout`, { layout });
      if (activeDashboardId) loadDashboardDetails(activeDashboardId);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-blue-500" />
            Dashboard Builder
          </h1>
          <p className="text-slate-400 text-sm">Assemble, resize, and order visual reports</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-sm rounded-xl">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm rounded-xl">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Dashboards Sidebar */}
        <div className="xl:col-span-1 space-y-6">
          
          {/* New Dashboard Form */}
          <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-5">
            <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-500" />
              New Dashboard
            </h3>
            
            <form onSubmit={handleCreateDashboard} className="space-y-3">
              <input
                type="text"
                required
                placeholder="Dashboard Name"
                className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600"
                value={newDashName}
                onChange={(e) => setNewDashName(e.target.value)}
              />
              <textarea
                placeholder="Description (Optional)"
                className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600 h-16 resize-none"
                value={newDashDesc}
                onChange={(e) => setNewDashDesc(e.target.value)}
              />
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-3 rounded-xl text-xs transition-colors shadow-sm"
              >
                Create
              </button>
            </form>
          </div>

          {/* Dashboards selector list */}
          <div className="bg-darkSidebar/30 border border-darkBorder rounded-2xl p-4">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-3">
              Available Dashboards ({dashboards.length})
            </span>

            {dashboards.length === 0 ? (
              <p className="text-slate-500 text-xs text-center py-6">No dashboards created</p>
            ) : (
              <div className="space-y-2">
                {dashboards.map(d => (
                  <div
                    key={d.id}
                    className={`flex items-center justify-between p-2 rounded-xl transition-all ${
                      activeDashboardId === d.id ? 'bg-blue-600/10 border border-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-slate-200 hover:bg-darkSidebar/40 border border-transparent'
                    }`}
                  >
                    <button
                      onClick={() => setActiveDashboardId(d.id)}
                      className="flex-1 text-xs font-semibold text-left truncate pr-2 py-1"
                    >
                      {d.name}
                    </button>
                    <button
                      onClick={() => handleDeleteDashboard(d.id)}
                      className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors"
                      title="Delete dashboard"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Grid Workspace */}
        <div className="xl:col-span-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 bg-darkSidebar/20 border border-darkBorder rounded-2xl h-[400px]">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
              <p className="text-slate-400 text-sm">Assembling widgets layout...</p>
            </div>
          ) : dashboardDetails ? (
            <div className="space-y-4">
              <div className="bg-slate-900 border border-darkBorder rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-200">{dashboardDetails.name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{dashboardDetails.description || 'No description provided.'}</p>
                </div>
                
                {!activeDatabase && (
                  <span className="text-xs text-amber-400 flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full">
                    <Grid className="w-3.5 h-3.5" />
                    Active DB required to load charts
                  </span>
                )}
              </div>

              {dashboardDetails.widgets.length === 0 ? (
                <div className="border border-dashed border-darkBorder rounded-2xl p-16 text-center bg-darkSidebar/10">
                  <Grid className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-slate-300 mb-1">No widgets on this dashboard</h3>
                  <p className="text-slate-500 text-xs max-w-xs mx-auto">
                    Go to the <strong>Query Workspace</strong>, run a query, and click <strong>"Save Chart"</strong> to populate this dashboard.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                  {dashboardDetails.widgets.map((widget: any, idx: number) => {
                    // Sizing classes mapping to 12-column grid
                    const widthClasses = {
                      4: 'md:col-span-4',
                      6: 'md:col-span-6',
                      8: 'md:col-span-8',
                      10: 'md:col-span-10',
                      12: 'md:col-span-12'
                    }[widget.width as 4|6|8|10|12] || 'md:col-span-6';

                    // Height values
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
                        className={`bg-darkSidebar/40 border border-darkBorder rounded-2xl p-5 flex flex-col justify-between group hover:border-slate-600 transition-colors ${widthClasses} ${heightStyle}`}
                      >
                        <div className="flex-1 min-h-0">
                          <DashboardWidget widget={widget} onDelete={handleRemoveWidget} />
                        </div>

                        {/* Widget control bar */}
                        <div className="flex items-center justify-between border-t border-darkBorder/60 pt-3 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Layout alignment triggers */}
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                            <span>Sizing:</span>
                            <button
                              onClick={() => handleUpdateWidgetWidth(widget.id, true)}
                              className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded"
                              title="Make wider"
                            >
                              + W
                            </button>
                            <button
                              onClick={() => handleUpdateWidgetWidth(widget.id, false)}
                              className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded"
                              title="Make narrower"
                            >
                              - W
                            </button>
                            <span className="text-slate-600">|</span>
                            <button
                              onClick={() => handleUpdateWidgetHeight(widget.id, true)}
                              className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded"
                              title="Make taller"
                            >
                              + H
                            </button>
                            <button
                              onClick={() => handleUpdateWidgetHeight(widget.id, false)}
                              className="px-1.5 py-0.5 bg-darkBg border border-darkBorder hover:text-slate-200 rounded"
                              title="Make shorter"
                            >
                              - H
                            </button>
                          </div>

                          {/* Move Ordering */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleMoveWidgetOrder(widget.id, 'up')}
                              disabled={idx === 0}
                              className="p-1 bg-darkBg border border-darkBorder hover:text-slate-200 rounded disabled:opacity-40"
                              title="Move left/up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleMoveWidgetOrder(widget.id, 'down')}
                              disabled={idx === dashboardDetails.widgets.length - 1}
                              className="p-1 bg-darkBg border border-darkBorder hover:text-slate-200 rounded disabled:opacity-40"
                              title="Move right/down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-darkSidebar/20 border border-darkBorder rounded-2xl h-[400px] text-center">
              <Grid className="w-12 h-12 text-slate-700 mb-3" />
              <h3 className="font-bold text-slate-400 mb-1">Select a dashboard</h3>
              <p className="text-slate-500 text-xs max-w-xs">
                Pick a dashboard from the list on the left or create a new one to start structuring widgets.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
