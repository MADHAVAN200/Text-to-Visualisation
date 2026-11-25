/**
 * DashboardBuilder.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Two views:
 *   VIEW 1 — the dashboards portal: list existing dashboards, create a new one,
 *            or let the AI recommend a full dashboard. Selecting one opens it.
 *   VIEW 2 — the Power BI-grade free-form editor (DashboardEditor), driven by
 *            the builder store. All canvas/panes/AI logic lives in
 *            components/dashboard/*; this page just mounts the editor for the
 *            active dashboard id.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useEffect } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { Plus, RefreshCw, Grid, FileText, Trash2 } from 'lucide-react';
import api from '../api';
import { useStore } from '../store/useStore';
import DashboardEditor from '../components/dashboard/DashboardEditor';

export default function DashboardBuilder() {
  const { dashboards, setDashboards, activeDatabase, groqApiKey } = useStore();
  const [activeDashboardId, setActiveDashboardId] = useState<number | null>(null);

  const [newDashName, setNewDashName] = useState('');
  const [newDashDesc, setNewDashDesc] = useState('');

  const [objective, setObjective] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchDashboards = async () => {
    try {
      const res = await api.get('/dashboards');
      setDashboards(res.data);
      // Keep activeDashboardId as null on initial load to display portal list.
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDashboards();
  }, []);

  const [clarification, setClarification] = useState<{key:string; options:string[]} | null>(null);
  const [choices,setChoices] = useState<Record<string,string>>({});
  const handleRecommendDashboard = async (answers:Record<string,string> = {}) => {
    setChoices(answers);
    setClarification(null);
    if (!activeDatabase) return;
    setGenerating(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/dashboards/recommend', {
        database_id: activeDatabase.id,
        api_key: groqApiKey,
        objective: objective.trim(),
        choices: answers,
      });
      if (res.data && res.data.dashboard_id) {
        setSuccess('AI recommended dashboard generated successfully!');
        await fetchDashboards();
        setActiveDashboardId(res.data.dashboard_id);
      }
    } catch (err: any) {
      setClarification(err.response?.data?.clarification || null);
      setError(err.response?.data?.error || 'Failed to auto-generate recommended dashboard.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateDashboard = async (e: FormEvent) => {
    e.preventDefault();
    if (!newDashName.trim()) return;

    setError('');
    setSuccess('');
    try {
      const res = await api.post('/dashboards', {
        name: newDashName,
        description: newDashDesc,
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

  const handleDeleteDashboard = async (e: MouseEvent, id: number) => {
    e.stopPropagation(); // Don't trigger the card's open handler
    if (!confirm('Are you sure you want to delete this entire dashboard? All widgets inside will be lost.')) return;
    setError('');
    setSuccess('');
    try {
      await api.delete(`/dashboards/${id}`);
      setSuccess('Dashboard deleted.');
      if (activeDashboardId === id) setActiveDashboardId(null);
      fetchDashboards();
    } catch (err) {
      setError('Failed to delete.');
    }
  };

  // ── VIEW 2: free-form editor ────────────────────────────────────────────────
  if (activeDashboardId !== null) {
    return <DashboardEditor dashboardId={activeDashboardId} onBack={() => setActiveDashboardId(null)} />;
  }

  // ── VIEW 1: dashboards portal (listing + create) ─────────────────────────────
  return (
    <div className="space-y-6 w-full py-4">

      <section className="request-panel">
        <h2>What would you like to understand?</h2>
        <p>Ask in your own words. We use your connected schema to build the charts and check the query results.</p>
        <div className="request-controls">
          <textarea aria-label="Dashboard request" value={objective}
            onChange={e => { setObjective(e.target.value); setClarification(null); setChoices({}); setError(''); }}
            placeholder="Compare performance across countries, find the top performers, or explore what changed between two years..." />
          <button onClick={() => handleRecommendDashboard()} disabled={generating || !activeDatabase}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-5 py-3 text-xs font-semibold flex items-center gap-2">
            {generating && <RefreshCw className="w-4 h-4 animate-spin" />}
            {generating ? 'Building your dashboard...' : 'Generate dashboard'}
          </button>
        </div>
        {!activeDatabase && <p role="status">Connect and select a database in Data to get started.</p>}
      </section>
      <div className="flex items-center justify-between"><h3 className="font-semibold text-sm">Saved dashboards</h3>
        <button onClick={() => setShowCreateModal(true)} className="text-xs text-slate-400 flex items-center gap-1"><Plus size={14}/>Start from a blank canvas</button>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-xs rounded-xl">
          {error}
        </div>
      )}

      {clarification && <div className="flex flex-wrap gap-2">{clarification.options.map(option =>
        <button key={option} className="bg-darkSidebar border border-darkBorder rounded px-3 py-2 text-sm"
          onClick={() => handleRecommendDashboard({...choices,[clarification.key]:option})}>{option}</button>
      )}</div>}
      {success && (
        <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs rounded-xl">
          {success}
        </div>
      )}

      {/* Dashboards list cards grid (full width) */}
      {dashboards.length === 0 ? (
        <div className="border border-dashed border-darkBorder rounded-2xl py-24 text-center bg-darkSidebar/5 space-y-3">
          <Grid className="w-12 h-12 text-slate-700 mx-auto" />
          <div>
            <h4 className="font-bold text-slate-400 text-sm">No dashboards created yet</h4>
            <p className="text-slate-500 text-xs mt-1">Ask a question above to create your first dashboard.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {dashboards.map((d) => (
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
                <p className="text-[10px] line-clamp-2 leading-relaxed mt-1 text-slate-500">
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

      {/* Create new dashboard modal */}
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
