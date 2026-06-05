import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { Key, Eye, EyeOff, Shield, User, Info, Database } from 'lucide-react';

export default function Settings() {
  const { user, groqApiKey, setGroqApiKey } = useStore();
  const [key, setKey] = useState(groqApiKey);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setGroqApiKey(key);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
          Settings
        </h1>
        <p className="text-slate-400 text-sm">Manage API connections and profile information</p>
      </div>

      {saved && (
        <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm rounded-xl">
          Settings saved successfully!
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Keys & API Connections */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-darkSidebar/50 border border-darkBorder rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-500" />
              API Settings
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Groq Cloud API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    placeholder="gsk_..."
                    className="w-full bg-darkBg border border-darkBorder rounded-xl py-2.5 pl-3 pr-10 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-3.5 text-slate-500 hover:text-slate-300"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                
                <div className="flex gap-2 mt-3 p-3 bg-blue-950/20 border border-blue-500/10 rounded-xl text-xs text-slate-400">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-300 mb-0.5">Rule-based fallback enabled</p>
                    If no API key is specified, the application automatically falls back to local regex matching for key questions, allowing testing immediately without billing accounts.
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-5 rounded-xl transition-all shadow-md shadow-blue-600/10"
              >
                Save Settings
              </button>
            </form>
          </div>

          {/* Developer Database Info */}
          <div className="bg-darkSidebar/30 border border-darkBorder rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-500" />
              Developer Data Guide
            </h2>
            <p className="text-slate-400 text-xs leading-relaxed mb-4">
              Voice2Viz comes preloaded with a sample SQLite schema (`sample_sales.db`). You can test it by querying topics such as:
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-darkBg/60 border border-darkBorder/40 p-4 rounded-xl text-slate-300">
              <div className="space-y-1">
                <p className="font-bold text-slate-400">📊 Sales Trends</p>
                <p>• "Show monthly revenue"</p>
                <p>• "Show monthly sales for 2025"</p>
              </div>
              <div className="space-y-1">
                <p className="font-bold text-slate-400">🛍️ Product Analytics</p>
                <p>• "Show top 10 products by revenue"</p>
                <p>• "Show product stock counts"</p>
              </div>
              <div className="space-y-1 mt-2">
                <p className="font-bold text-slate-400">👥 Customer Demographics</p>
                <p>• "Show customers by city"</p>
                <p>• "Show customers by country"</p>
              </div>
              <div className="space-y-1 mt-2">
                <p className="font-bold text-slate-400">⚡ Summary metrics</p>
                <p>• "Show revenue summary"</p>
                <p>• "Show customer overview"</p>
              </div>
            </div>
          </div>
        </div>

        {/* User Account Info */}
        <div className="md:col-span-1 bg-darkSidebar/50 border border-darkBorder rounded-2xl p-6 h-fit">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-500" />
            User Profile
          </h2>

          {user ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center font-bold text-emerald-400 text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-slate-200 text-sm">{user.name}</h3>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </div>
              </div>

              <div className="border-t border-darkBorder/60 pt-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">User Role</span>
                  <span className="font-semibold text-slate-300 capitalize flex items-center gap-1">
                    <Shield className="w-3 h-3 text-blue-500" />
                    {user.role}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Platform Level</span>
                  <span className="font-semibold text-slate-300">Read-Only Analyst</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-slate-500 text-xs">Not signed in.</p>
          )}
        </div>
      </div>
    </div>
  );
}
