import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import api from '../api';
import { Database, Plus, Trash2, RefreshCw, CheckCircle, HardDrive, Info } from 'lucide-react';

export default function Connections() {
  const { connectedDatabases, setConnectedDatabases, activeDatabase, setActiveDatabase } = useStore();
  
  const [dbType, setDbType] = useState<'sqlite' | 'postgresql' | 'mysql'>('sqlite');
  const [name, setName] = useState('');
  const [databaseName, setDatabaseName] = useState('ai-engine/sample_sales.db'); // default to sample database
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5432);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [sandboxLoading, setSandboxLoading] = useState(false);

  const handleLoadSandbox = async () => {
    setSandboxLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/databases/seed-sandbox');
      if (res.data.warning) {
        setSuccess('Sandbox database connected, but schema sync was postponed. You can trigger sync manually.');
      } else {
        setSuccess('Walkthrough Sandbox database successfully seeded and loaded with 10 tables and 5,700+ records!');
      }
      
      // Fetch connections to update list
      await fetchConnections();
      
      // Auto-activate the sandbox database in the UI/store
      const loadedDb = res.data;
      if (loadedDb && loadedDb.id) {
        setActiveDatabase({
          id: loadedDb.id,
          name: loadedDb.name,
          db_type: loadedDb.db_type,
          database_name: loadedDb.database_name,
          created_at: loadedDb.created_at
        });
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to seed and load the sandbox database.');
    } finally {
      setSandboxLoading(false);
    }
  };

  // Fetch connections on load
  const fetchConnections = async () => {
    try {
      const res = await api.get('/databases');
      setConnectedDatabases(res.data);
      
      // Auto-activate first database if none is active
      if (res.data.length > 0 && !activeDatabase) {
        setActiveDatabase(res.data[0]);
      }
    } catch (err: any) {
      console.error('Failed to load database connections:', err);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const payload: any = {
        name,
        db_type: dbType,
        database_name: databaseName,
      };

      if (dbType !== 'sqlite') {
        payload.host = host;
        payload.port = port;
        payload.username = username;
        payload.password = password;
      }

      const res = await api.post('/databases/connect', payload);
      
      if (res.data.warning) {
        setSuccess('Database added, but schema synchronization was postponed. Check engine log.');
      } else {
        setSuccess('Successfully connected to database and synchronized schema!');
      }

      setName('');
      if (dbType !== 'sqlite') {
        setDatabaseName('');
        setUsername('');
        setPassword('');
      }

      fetchConnections();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to connect to the database. Verify connection settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (id: number) => {
    setError('');
    setSuccess('');
    setActionLoading(id);
    try {
      await api.post(`/databases/${id}/sync`);
      setSuccess('Schema synchronized successfully!');
      fetchConnections();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to parse schema. Make sure AI Engine is running.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this database connection? All schema details and history will be lost.')) return;
    setError('');
    setSuccess('');
    setActionLoading(id);
    try {
      await api.delete(`/databases/${id}`);
      setSuccess('Database connection removed.');
      if (activeDatabase?.id === id) {
        setActiveDatabase(null);
      }
      fetchConnections();
    } catch (err: any) {
      setError('Failed to delete connection.');
    } finally {
      setActionLoading(null);
    }
  };

  const selectActive = (db: any) => {
    setActiveDatabase(db);
    setSuccess(`Activated database: ${db.name}`);
  };

  return (
    <div className="space-y-6">

      {/* Walkthrough Sandbox Option Banner */}
      <div className="bg-gradient-to-r from-blue-950/20 via-slate-900/40 to-emerald-950/10 border border-darkBorder rounded-2xl p-6 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="absolute right-0 top-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="space-y-1 relative z-10 max-w-2xl">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Try the text2Viz AI Sandbox
          </h2>
          <p className="text-slate-400 text-xs leading-relaxed">
            Don't have database credentials ready? Load our pre-populated enterprise sandbox database with <strong>10 tables</strong> and <strong>5,700+ diverse records</strong> (including Products, Suppliers, Sales, Payments, Inventory, Employees, and Customer Reviews) to instantly explore and test SQL parsing, chart building, and AI insights.
          </p>
        </div>
        
        <button
          onClick={handleLoadSandbox}
          disabled={sandboxLoading}
          className="mt-2 md:mt-0 bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 text-white text-xs font-semibold py-2.5 px-5 rounded-xl transition-all shadow-md shadow-blue-600/10 flex items-center gap-1.5 active:scale-95 shrink-0 disabled:opacity-50"
        >
          {sandboxLoading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Seeding Sandbox...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Launch Walkthrough Sandbox
            </>
          )}
        </button>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connection Form */}
        <div className="lg:col-span-1 bg-darkSidebar/50 border border-darkBorder rounded-2xl p-6 h-fit">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-blue-500" />
            Add Connection
          </h2>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Database Type</label>
              <div className="grid grid-cols-3 gap-2">
                {(['sqlite', 'postgresql', 'mysql'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setDbType(type);
                      setPort(type === 'postgresql' ? 5432 : type === 'mysql' ? 3306 : 0);
                    }}
                    className={`py-2 px-3 text-xs font-semibold uppercase rounded-xl border transition-colors ${
                      dbType === type
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-darkBorder bg-darkBg text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Display Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Sales Production"
                className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {dbType === 'sqlite' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Database Path (relative/absolute)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ai-engine/sample_sales.db"
                  className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100 placeholder-slate-600"
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value)}
                />
                <div className="flex gap-1.5 mt-2 text-[10px] text-slate-400 items-start">
                  <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <span>Use <strong>ai-engine/sample_sales.db</strong> to access the preloaded dummy data.</span>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Host</label>
                    <input
                      type="text"
                      required
                      className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Port</label>
                    <input
                      type="number"
                      required
                      className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100"
                      value={port}
                      onChange={(e) => setPort(parseInt(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Database Name</label>
                  <input
                    type="text"
                    required
                    className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100"
                    value={databaseName}
                    onChange={(e) => setDatabaseName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Username</label>
                    <input
                      type="text"
                      required
                      className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Password</label>
                    <input
                      type="password"
                      className="w-full bg-darkBg border border-darkBorder rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-blue-500 text-slate-100"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 text-white font-semibold py-2.5 px-4 rounded-xl transition-all shadow-md shadow-blue-600/10 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect Database'}
            </button>
          </form>
        </div>

        {/* Connections List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-emerald-500" />
            Configured Connections
          </h2>

          {connectedDatabases.length === 0 ? (
            <div className="bg-darkSidebar/30 border border-darkBorder border-dashed rounded-2xl p-12 text-center">
              <Database className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="font-semibold text-slate-300 mb-1">No database connections configured</h3>
              <p className="text-slate-500 text-sm max-w-sm mx-auto">
                Add an SQLite database or credentials for MySQL/PostgreSQL using the form on the left.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {connectedDatabases.map((db) => {
                const isActive = activeDatabase?.id === db.id;
                const isWorking = actionLoading === db.id;
                
                return (
                  <div
                    key={db.id}
                    className={`bg-darkSidebar/40 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:border-slate-600 ${
                      isActive ? 'border-blue-500/60 ring-2 ring-blue-500/10 bg-blue-950/10' : 'border-darkBorder'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          db.db_type === 'sqlite' 
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' 
                            : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        }`}>
                          {db.db_type}
                        </span>
                        
                        {isActive && (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                            <CheckCircle className="w-3.5 h-3.5 fill-emerald-500/10" />
                            Active
                          </span>
                        )}
                      </div>

                      <h3 className="font-bold text-slate-200 text-base truncate mb-1">{db.name}</h3>
                      <p className="text-xs text-slate-400 font-mono break-all mb-4" title={db.database_name}>
                        {db.db_type === 'sqlite' ? db.database_name : `${db.host}:${db.port}/${db.database_name}`}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-darkBorder pt-3">
                      <button
                        onClick={() => selectActive(db)}
                        disabled={isActive || isWorking}
                        className={`text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${
                          isActive 
                            ? 'bg-slate-800 text-slate-500 cursor-default' 
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                        }`}
                      >
                        Set Active
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleSync(db.id)}
                          disabled={isWorking}
                          title="Resync Schema columns"
                          className="p-1.5 bg-darkBg hover:bg-slate-800 border border-darkBorder text-slate-400 hover:text-slate-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-4 h-4 ${isWorking ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleDelete(db.id)}
                          disabled={isWorking}
                          title="Delete Connection"
                          className="p-1.5 bg-darkBg hover:bg-red-950/30 border border-darkBorder hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
