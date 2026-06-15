import { useEffect, useState } from 'react';
import api from '../api';
import { 
  Database, LayoutGrid, Activity, History, RefreshCw 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

export default function Dashboard() {
  const [stats, setStats] = useState({
    databasesCount: 0,
    queriesCount: 0,
    dashboardsCount: 0,
    history: [] as any[]
  });
  const navigate = useNavigate();
  const [generating, setGenerating] = useState(false);
  const { activeDatabase, groqApiKey } = useStore();

  const handleRecommendDashboard = async () => {
    if (!activeDatabase) return;
    setGenerating(true);
    try {
      const res = await api.post('/dashboards/recommend', {
        database_id: activeDatabase.id,
        api_key: groqApiKey
      });
      if (res.data && res.data.dashboard_id) {
        // Redirect to the builder
        navigate('/builder');
      }
    } catch (err) {
      console.error('Failed to auto-generate recommended dashboard:', err);
      alert('Failed to generate recommended dashboard. Please check that your database contains active table data.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const dbs = await api.get('/databases');
        const history = await api.get('/queries/history');
        const dashboards = await api.get('/dashboards');
        
        setStats({
          databasesCount: dbs.data.length,
          queriesCount: history.data.length,
          dashboardsCount: dashboards.data.length,
          history: history.data.slice(0, 5) // top 5 recent queries
        });
      } catch (err) {
        console.error('Failed to load landing dashboard stats:', err);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      {/* Analytics statistics counters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group hover:border-slate-600 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 text-blue-400">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-slate-100">{stats.databasesCount}</h3>
            <p className="text-xs text-slate-400">Connected Databases</p>
          </div>
        </div>

        <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group hover:border-slate-600 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-slate-100">{stats.queriesCount}</h3>
            <p className="text-xs text-slate-400">Total Queries Executed</p>
          </div>
        </div>

        <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group hover:border-slate-600 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-400">
            <LayoutGrid className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-slate-100">{stats.dashboardsCount}</h3>
            <p className="text-xs text-slate-400">Saved Dashboards</p>
          </div>
        </div>
      </div>

      {/* AI Dashboard Recommender Card */}
      <div className="bg-gradient-to-r from-blue-600/10 via-purple-600/5 to-emerald-500/10 border border-darkBorder rounded-2xl p-6 relative overflow-hidden group hover:border-slate-500 transition-all">
        {/* Glow decoration */}
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-blue-500/10 rounded-full blur-[80px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-purple-500/10 rounded-full blur-[80px] pointer-events-none"></div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold tracking-wider uppercase">
              Power BI Quick-Create
            </div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              AI Smart Dashboard Recommender
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              No time to configure charts? Click below to let the AI analyze your connected database schema and query history, recommending a fully-structured, ready-made analytical dashboard instantly.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <button
              onClick={handleRecommendDashboard}
              disabled={generating || !activeDatabase}
              className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold text-white transition-all shadow-md ${
                !activeDatabase 
                  ? 'bg-slate-800 border border-darkBorder text-slate-500 cursor-not-allowed'
                  : generating
                    ? 'bg-blue-600/50 cursor-wait'
                    : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/10 hover:scale-[1.02]'
              }`}
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generating Dashboard...
                </>
              ) : (
                <>
                  Generate AI Recommended Dashboard
                </>
              )}
            </button>
            {!activeDatabase && (
              <span className="text-[10px] text-amber-400 font-semibold max-w-[120px] leading-tight">
                Select/Connect a database to enable auto-generation.
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Quick Launch Guide */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-darkSidebar/40 border border-darkBorder rounded-2xl p-6">
            <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
              Quick-Start Workspace Guide
            </h2>
            
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center font-bold text-xs text-blue-400 shrink-0">
                  1
                </div>
                <div>
                  <h3 className="font-semibold text-slate-200 text-sm">Add database connections</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Navigate to <span className="text-blue-400 font-semibold cursor-pointer underline" onClick={() => navigate('/connections')}>Connections</span> and link SQLite files or database credentials. Try loading the included <code>sample_sales.db</code> database.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-bold text-xs text-emerald-400 shrink-0">
                  2
                </div>
                <div>
                  <h3 className="font-semibold text-slate-200 text-sm">Inspect schemas</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Open the <span className="text-emerald-400 font-semibold cursor-pointer underline" onClick={() => navigate('/schema')}>Schema Explorer</span> to understand table structures, primary keys, and relations parsed by the system.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center font-bold text-xs text-purple-400 shrink-0">
                  3
                </div>
                <div>
                  <h3 className="font-semibold text-slate-200 text-sm">Ask questions & build dashboards</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Go to the <span className="text-purple-400 font-semibold cursor-pointer underline" onClick={() => navigate('/workspace')}>Workspace</span> and query in plain English or voice. Tweak generated SQL, save charts as widgets, and arrange dashboards in the builder.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent queries log */}
        <div className="lg:col-span-1 bg-darkSidebar/40 border border-darkBorder rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2 border-b border-darkBorder/60 pb-3">
              <History className="w-4 h-4 text-blue-400" />
              Recent System Queries
            </h2>

            {stats.history.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                No queries executed yet.
              </div>
            ) : (
              <div className="space-y-3">
                {stats.history.map((h) => (
                  <div key={h.id} className="p-2.5 bg-darkBg/60 border border-darkBorder/40 rounded-xl space-y-1">
                    <p className="text-xs font-semibold text-slate-200 line-clamp-1">{h.question}</p>
                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                      <span className="font-mono text-emerald-500">{h.database_name}</span>
                      <span>{new Date(h.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <button
            onClick={() => navigate('/workspace')}
            className="w-full mt-4 bg-darkBg hover:bg-slate-800 border border-darkBorder text-xs font-semibold py-2 rounded-xl text-slate-300 transition-colors"
          >
            Open query history workspace
          </button>
        </div>
      </div>
    </div>
  );
}
