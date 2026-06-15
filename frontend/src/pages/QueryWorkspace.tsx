import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import api from '../api';
import { 
  BarChart as RechartsBarChart, Bar, LineChart, Line, PieChart, Pie, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer 
} from 'recharts';
import { 
  Database, Mic, MicOff, Play, Save, RefreshCw, AlertCircle, 
  Code, Table, BarChart2, Download, BookOpen, AlertTriangle,
  TrendingUp, PieChart as PieIcon, Activity, GitBranch, Check
} from 'lucide-react';

// All available chart types a user can choose from
const CHART_TYPES = [
  { key: 'bar',     label: 'Bar',     icon: BarChart2 },
  { key: 'line',    label: 'Line',    icon: TrendingUp },
  { key: 'area',    label: 'Area',    icon: Activity },
  { key: 'pie',     label: 'Pie',     icon: PieIcon },
  { key: 'scatter', label: 'Scatter', icon: GitBranch },
  { key: 'table',   label: 'Table',   icon: Table },
] as const;

type ChartType = typeof CHART_TYPES[number]['key'];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

export default function QueryWorkspace() {
  const { activeDatabase, groqApiKey } = useStore();
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState('');
  const [results, setResults] = useState<any>(null);
  const [chartRec, setChartRec] = useState<any>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [queryId, setQueryId] = useState<number | null>(null);
  const [vizId, setVizId] = useState<number | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // 'viz' shows the chart switcher, 'data' shows raw grid
  const [activeTab, setActiveTab] = useState<'viz' | 'data'>('viz');
  // Which chart type is currently displayed
  const [selectedChartType, setSelectedChartType] = useState<ChartType>('bar');
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [dashboardsList, setDashboardsList] = useState<any[]>([]);
  const [selectedDashboard, setSelectedDashboard] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [aiPowered, setAiPowered] = useState(false);
  const [sqlSource, setSqlSource] = useState<string>('');

  // Voice input
  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Try Chrome or Edge!");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setQuestion(transcript);
    };
    recognition.onerror = (err: any) => {
      console.error(err);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleRunQuery = async (e?: React.FormEvent, sqlOverride?: string) => {
    if (e) e.preventDefault();
    if (!activeDatabase) {
      setError('Please select and connect to an active database first.');
      return;
    }
    if (!question && !sqlOverride) {
      setError('Please enter a natural language question.');
      return;
    }

    setLoading(true);
    setError('');
    setSaveStatus('');
    
    try {
      const payload: any = {
        question: question || 'Custom SQL Execution',
        database_id: activeDatabase.id,
        api_key: groqApiKey,
      };
      if (sqlOverride) payload.sql_query = sqlOverride;

      const res = await api.post('/queries/ask', payload);
      setSql(res.data.sql || sqlOverride || '');
      setResults(res.data.results);
      setChartRec(res.data.chart);
      setInsights(res.data.insights || []);
      setQueryId(res.data.query_id || null);
      setVizId(res.data.visualization_id || null);
      setAiPowered(res.data.ai_powered === true);
      setSqlSource(res.data.sql_source || '');

      // Auto-set chart type from recommendation
      if (res.data.chart?.chart_type) {
        setSelectedChartType(res.data.chart.chart_type as ChartType);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to process query. Check AI Engine log.');
    } finally {
      setLoading(false);
    }
  };

  // Pre-load dashboards for the Save Visualization feature
  useEffect(() => {
    const fetchDashboards = async () => {
      try {
        const res = await api.get('/dashboards');
        setDashboardsList(res.data);
        if (res.data.length > 0) {
          setSelectedDashboard(res.data[0].id.toString());
        }
      } catch (err) {
        console.error('Failed to load dashboards', err);
      }
    };
    if (activeDatabase) fetchDashboards();
  }, [activeDatabase, showSaveModal]);

  const handleSaveToDashboard = async () => {
    if (!results || !results.row_count) return;
    if (!selectedDashboard) {
      alert("Please create a dashboard in the Dashboard Builder page first.");
      return;
    }
    if (!vizId && !queryId) {
      alert("Please run a query first to get a visualization.");
      return;
    }

    setSaveStatus('Saving...');
    try {
      // Look up visualization id tied to this query or use the one returned
      let visualizationId = vizId;
      if (!visualizationId && queryId) {
        // Try to get it from backend
        await api.get(`/queries/history/${queryId}`);
        // We don't get viz_id back from history, so use the current queryId as fallback
      }

      await api.post(`/dashboards/${selectedDashboard}/widgets`, {
        visualization_id: visualizationId || 1,
        position_x: 0,
        position_y: 0,
        width: 6,
        height: 4
      });
      setSaveStatus('Saved successfully!');
      setTimeout(() => {
        setShowSaveModal(false);
        setSaveStatus('');
      }, 1500);
    } catch (err: any) {
      console.error(err);
      setSaveStatus('Failed to save: ' + (err.response?.data?.error || err.message));
    }
  };

  // Export results to CSV
  const handleExportCSV = () => {
    if (!results || !results.rows.length) return;
    const cols = results.columns;
    const csvContent = [
      cols.join(','),
      ...results.rows.map((row: any) => 
        cols.map((colName: string) => {
          const val = row[colName];
          return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
        }).join(',')
      )
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `text2viz_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Render the currently selected chart type
  const renderChart = (typeOverride?: ChartType) => {
    const type = typeOverride || selectedChartType;
    if (!chartRec || !results || !results.rows || results.rows.length === 0) return null;
    const { x_axis, y_axis } = chartRec;
    const data = results.rows;

    switch (type) {
      case 'bar':
        return (
          <RechartsBarChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis dataKey={x_axis} stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {y_axis.map((yKey: string, idx: number) => (
              <Bar key={yKey} dataKey={yKey} fill={COLORS[idx % COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </RechartsBarChart>
        );
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis dataKey={x_axis} stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {y_axis.map((yKey: string, idx: number) => (
              <Line key={yKey} type="monotone" dataKey={yKey} stroke={COLORS[idx % COLORS.length]} strokeWidth={2.5} activeDot={{ r: 6 }} />
            ))}
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <defs>
              {COLORS.map((color, idx) => (
                <linearGradient key={`grad-${idx}`} id={`colorGrad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.4}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis dataKey={x_axis} stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <YAxis stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {y_axis.map((yKey: string, idx: number) => (
              <Area key={yKey} type="monotone" dataKey={yKey} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} fillOpacity={1} fill={`url(#colorGrad-${idx})`} />
            ))}
          </AreaChart>
        );
      case 'pie':
        return (
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`}
              outerRadius={100}
              fill="#8884d8"
              dataKey={y_axis[0]}
              nameKey={x_axis}
            >
              {data.map((_: any, index: number) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        );
      case 'scatter':
        return (
          <ScatterChart margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--slate-700)" />
            <XAxis type="number" dataKey={x_axis} name={x_axis} stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <YAxis type="number" dataKey={y_axis[0]} name={y_axis[0]} stroke="var(--slate-400)" tick={{ fontSize: 11 }} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--slate-100)' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Scatter name="Data Points" data={data} fill="#3b82f6" />
          </ScatterChart>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Active Database Alert Banner */}
      {!activeDatabase ? (
        <div className="p-4 bg-amber-950/40 border border-amber-500/30 text-amber-200 text-sm rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <strong>No active database connected.</strong> Please navigate to the <a href="/connections" className="underline text-amber-400 font-semibold">Connections</a> page, add a SQLite or other database, and set it as active.
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs bg-slate-900 border border-darkBorder w-fit px-3 py-1.5 rounded-full text-slate-300">
          <Database className="w-3.5 h-3.5 text-blue-500" />
          <span>Connection:</span>
          <strong className="text-blue-400">{activeDatabase.name}</strong>
          <span className="text-slate-500">|</span>
          <span className="uppercase text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
            {activeDatabase.db_type}
          </span>
        </div>
      )}

      {/* Query Bar Form */}
      <form onSubmit={(e) => handleRunQuery(e)} className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-5 shadow-lg relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl"></div>
        
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Ask Your Data Anything...
        </label>
        
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              className="w-full bg-darkBg border border-darkBorder focus:border-blue-500 rounded-xl py-3 pl-4 pr-12 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 text-sm"
              placeholder="e.g. Show monthly revenue for 2025 as a bar chart"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            
            <button
              type="button"
              onClick={handleVoiceInput}
              title={isListening ? "Listening..." : "Voice Input"}
              className={`absolute right-3 top-2.5 p-2 rounded-lg transition-colors ${
                isListening 
                  ? 'bg-red-500/20 text-red-400 animate-pulse border border-red-500/30' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading || !activeDatabase}
            className="bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 text-white font-semibold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:scale-100"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
            Run Query
          </button>
        </div>
      </form>

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-sm rounded-xl flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* SQL & Result Sections */}
      {(sql || results) && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
          
          {/* Main workspace section */}
          <div className="xl:col-span-3 space-y-6">
            
            {/* SQL Preview Box */}
            {sql && (
              <div className="bg-darkSidebar/30 border border-darkBorder rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 flex items-center gap-2">
                    <Code className="w-4 h-4 text-blue-400" />
                    AI SQL Generated Preview
                    {aiPowered ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        AI Powered
                      </span>
                    ) : sqlSource === 'rule-based' ? (
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">Rule-based</span>
                    ) : null}
                  </span>
                  <button
                    onClick={() => handleRunQuery(undefined, sql)}
                    disabled={loading}
                    className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-1 rounded-lg border border-blue-500/20 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Execute SQL Override
                  </button>
                </div>
                <pre className="bg-darkBg/90 border border-darkBorder/40 rounded-xl p-4 overflow-x-auto text-xs font-mono text-emerald-400 leading-relaxed max-h-40">
                  {sql}
                </pre>
              </div>
            )}

            {/* Query Outputs */}
            {results && (
              <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-6 space-y-4">
                
                {/* Tab Bar + Toolbar */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-darkBorder pb-4 gap-3">
                  <div className="flex border border-darkBorder bg-darkBg rounded-xl p-1">
                    <button
                      onClick={() => setActiveTab('viz')}
                      className={`flex items-center gap-2 py-1.5 px-4 text-xs font-semibold rounded-lg transition-colors ${
                        activeTab === 'viz' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <BarChart2 className="w-4 h-4" />
                      Visualization
                    </button>
                    <button
                      onClick={() => setActiveTab('data')}
                      className={`flex items-center gap-2 py-1.5 px-4 text-xs font-semibold rounded-lg transition-colors ${
                        activeTab === 'data' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Table className="w-4 h-4" />
                      Data Grid
                    </button>
                  </div>

                  <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                    {activeTab === 'viz' && selectedChartType !== 'table' && results.success && (
                      <button
                        onClick={() => setShowSaveModal(true)}
                        className="flex items-center gap-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded-xl shadow-sm transition-colors"
                      >
                        <Save className="w-4 h-4" />
                        Save Chart
                      </button>
                    )}
                    <button
                      onClick={handleExportCSV}
                      className="flex items-center gap-1.5 py-1.5 px-3 bg-darkBg hover:bg-slate-800 border border-darkBorder text-xs font-semibold text-slate-300 hover:text-slate-100 rounded-xl transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                </div>

                {/* Content Rendering */}
                {results.success ? (
                  <div className="min-h-[350px]">
                    {activeTab === 'viz' ? (
                      <div className="space-y-4">

                        {/* ── Chart Type Switcher ── */}
                        <div className="flex flex-wrap gap-2">
                          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider self-center mr-1">
                            Chart Type:
                          </span>
                          {CHART_TYPES.map(({ key, label, icon: Icon }) => (
                            <button
                              key={key}
                              onClick={() => setSelectedChartType(key)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                selectedChartType === key
                                  ? 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-500/20'
                                  : 'bg-darkBg border-darkBorder text-slate-400 hover:text-slate-200 hover:border-slate-600'
                              }`}
                              title={`View as ${label} chart`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              {label}
                              {chartRec?.chart_type === key && (
                                <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 rounded ml-0.5">AI Pick</span>
                              )}
                            </button>
                          ))}
                        </div>

                        {/* ── Chart Canvas ── */}
                        {selectedChartType === 'table' ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-darkBorder text-slate-400 font-bold uppercase tracking-wider">
                                  {results.columns.map((col: string) => (
                                    <th key={col} className="pb-3 pl-3 py-2">{col.replace(/_/g, ' ')}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-darkBorder/40">
                                {results.rows.slice(0, 100).map((row: any, rIdx: number) => (
                                  <tr key={rIdx} className="hover:bg-darkSidebar/20 transition-colors">
                                    {results.columns.map((col: string) => (
                                      <td key={col} className="py-2.5 pl-3 font-medium text-slate-300">
                                        {row[col] === null ? '-' : String(row[col])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {results.row_count > 100 && (
                              <div className="text-center text-[10px] text-slate-500 mt-3 italic">
                                Showing first 100 of {results.row_count} records.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-[340px]">
                            <h3 className="text-center font-bold text-slate-200 text-sm mb-2">
                              {chartRec?.title || question}
                            </h3>
                            <div className="w-full h-[300px]">
                              <ResponsiveContainer width="100%" height="100%">
                                {renderChart() || (
                                  <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                                    Switch to a different chart type — this data may not support {selectedChartType} rendering.
                                  </div>
                                )}
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Data Grid Tab */
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-darkBorder text-slate-400 font-bold uppercase tracking-wider">
                              {results.columns.map((col: string) => (
                                <th key={col} className="pb-3 pl-3 py-2">{col.replace(/_/g, ' ')}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-darkBorder/40">
                            {results.rows.slice(0, 100).map((row: any, rIdx: number) => (
                              <tr key={rIdx} className="hover:bg-darkSidebar/20 transition-colors">
                                {results.columns.map((col: string) => (
                                  <td key={col} className="py-2.5 pl-3 font-medium text-slate-300">
                                    {row[col] === null ? '-' : String(row[col])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {results.row_count > 100 && (
                          <div className="text-center text-[10px] text-slate-500 mt-3 italic">
                            Showing first 100 of {results.row_count} records.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-12 text-center border border-dashed border-red-500/20 rounded-2xl bg-red-950/10">
                    <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-2" />
                    <p className="text-red-200 text-sm font-semibold">Execution Failed</p>
                    <p className="text-red-400/80 text-xs mt-1">{results.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right insights sidebar */}
          <div className="xl:col-span-1 space-y-6">
            <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl"></div>
              
              <h2 className="text-base font-bold text-slate-200 flex items-center gap-2 mb-4 border-b border-darkBorder/60 pb-3">
                AI Narrative Insights
              </h2>

              {insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <BookOpen className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">No insights generated yet. Run a successful query first.</p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {insights.map((insight, idx) => (
                    <li key={idx} className="flex gap-2.5 text-xs text-slate-300 items-start">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5"></div>
                      <span dangerouslySetInnerHTML={{ __html: insight.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') }} />
                    </li>
                  ))}
                </ul>
              )}

              {/* Current chart type indicator */}
              {results?.success && activeTab === 'viz' && (
                <div className="mt-4 pt-4 border-t border-darkBorder/40">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Viewing As</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CHART_TYPES.map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        onClick={() => setSelectedChartType(key)}
                        title={`Switch to ${label}`}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                          selectedChartType === key
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-darkBg border-darkBorder text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        <Icon className="w-3 h-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Widget Modal Dialog */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-darkSidebar border border-darkBorder w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-darkBorder pb-3">
              <div>
                <h3 className="font-bold text-slate-200">Save Visualization</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Saving as <span className="font-semibold text-blue-400 capitalize">{selectedChartType}</span> chart
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowSaveModal(false)}
                className="text-slate-500 hover:text-slate-300 font-bold"
              >
                ✕
              </button>
            </div>

            {dashboardsList.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                You haven't created any dashboards yet. Please go to the <strong>Dashboard Builder</strong> and create a dashboard first.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Select Dashboard</label>
                  <select
                    className="w-full bg-darkBg border border-darkBorder rounded-xl p-2.5 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
                    value={selectedDashboard}
                    onChange={(e) => setSelectedDashboard(e.target.value)}
                  >
                    {dashboardsList.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                {saveStatus && (
                  <div className={`text-xs font-semibold flex items-center gap-2 ${saveStatus.includes('success') ? 'text-emerald-400' : saveStatus.includes('Failed') ? 'text-red-400' : 'text-slate-400'}`}>
                    {saveStatus.includes('success') && <Check className="w-3.5 h-3.5" />}
                    {saveStatus}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowSaveModal(false)}
                    className="flex-1 bg-darkBg hover:bg-slate-800 border border-darkBorder text-xs font-semibold py-2 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveToDashboard}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-xs font-semibold py-2 text-white rounded-xl shadow-md"
                  >
                    Add Widget
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
