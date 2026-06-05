import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import api from '../api';
import { Database, Table, Key, Info, HelpCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface ColumnInfo {
  column: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  isForeign: boolean;
  foreignTable: string | null;
  foreignColumn: string | null;
}

interface SchemaData {
  [tableName: string]: ColumnInfo[];
}

export default function SchemaExplorer() {
  const { activeDatabase } = useStore();
  const [schema, setSchema] = useState<SchemaData>({});
  const [loading, setLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchSchema = async () => {
    if (!activeDatabase) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/databases/${activeDatabase.id}/schema`);
      setSchema(res.data);
      const tables = Object.keys(res.data);
      if (tables.length > 0) {
        setSelectedTable(tables[0]);
      } else {
        setSelectedTable(null);
      }
    } catch (err) {
      console.error('Failed to load schema:', err);
      setError('Could not retrieve schema information. Please check database connectivity.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchema();
  }, [activeDatabase]);

  if (!activeDatabase) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4 border border-amber-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-200 mb-2">No Active Database Selected</h3>
        <p className="text-slate-400 text-sm mb-6">
          To browse table schemas and column structures, connect a database and mark it as active first.
        </p>
        <a
          href="/connections"
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-6 rounded-xl transition-all shadow-md shadow-blue-600/10 hover:shadow-blue-600/20"
        >
          Manage Connections
        </a>
      </div>
    );
  }

  const tableNames = Object.keys(schema);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-500" />
            Schema Explorer
          </h1>
          <p className="text-slate-400 text-sm">
            Active Database: <strong className="text-blue-400">{activeDatabase.name}</strong> ({activeDatabase.db_type})
          </p>
        </div>
        
        <button
          onClick={fetchSchema}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-darkSidebar hover:bg-slate-800 border border-darkBorder text-xs font-semibold text-slate-300 hover:text-slate-100 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Schema
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-sm rounded-xl">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Retrieving database catalog...</p>
        </div>
      ) : tableNames.length === 0 ? (
        <div className="bg-darkSidebar/30 border border-darkBorder border-dashed rounded-2xl p-12 text-center">
          <Table className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-300 mb-1">No tables found</h3>
          <p className="text-slate-500 text-sm max-w-sm mx-auto">
            This database appears to be empty or sync failed. Click "Refresh Schema" or check database tables.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Tables Sidebar */}
          <div className="md:col-span-1 bg-darkSidebar/50 border border-darkBorder rounded-2xl p-4 space-y-2 h-[calc(100vh-220px)] overflow-y-auto">
            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-3">
              Tables ({tableNames.length})
            </span>
            {tableNames.map((tbl) => (
              <button
                key={tbl}
                onClick={() => setSelectedTable(tbl)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-semibold rounded-xl text-left transition-colors ${
                  selectedTable === tbl
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-darkBg/50'
                }`}
              >
                <Table className="w-4 h-4 shrink-0" />
                <span className="truncate">{tbl}</span>
              </button>
            ))}
          </div>

          {/* Table Columns Detail */}
          <div className="md:col-span-3 bg-darkSidebar/30 border border-darkBorder rounded-2xl p-6 h-[calc(100vh-220px)] overflow-y-auto">
            {selectedTable && schema[selectedTable] ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-darkBorder pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
                      <Table className="w-5 h-5 text-emerald-500" />
                      {selectedTable}
                    </h2>
                    <p className="text-slate-400 text-xs mt-1">
                      Contains {schema[selectedTable].length} columns
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-darkBorder text-slate-400 text-xs uppercase font-bold tracking-wider">
                        <th className="pb-3 pl-3">Column Name</th>
                        <th className="pb-3">Data Type</th>
                        <th className="pb-3">Nullable</th>
                        <th className="pb-3 text-right pr-3">Keys & Constraints</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-darkBorder/40">
                      {schema[selectedTable].map((col) => (
                        <tr key={col.column} className="hover:bg-darkSidebar/20 transition-colors">
                          <td className="py-3.5 pl-3 font-semibold text-slate-200">{col.column}</td>
                          <td className="py-3.5 font-mono text-xs text-blue-400">{col.type || 'TEXT'}</td>
                          <td className="py-3.5 text-xs text-slate-400">
                            {col.nullable ? 'Yes' : 'No'}
                          </td>
                          <td className="py-3.5 text-right pr-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {col.isPrimary && (
                                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                                  <Key className="w-3 h-3 text-amber-500" />
                                  PK
                                </span>
                              )}
                              {col.isForeign && (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full cursor-help"
                                  title={`References ${col.foreignTable}(${col.foreignColumn})`}
                                >
                                  <Info className="w-3 h-3 text-purple-500" />
                                  FK → {col.foreignTable}
                                </span>
                              )}
                              {!col.isPrimary && !col.isForeign && (
                                <span className="text-slate-600 text-xs">-</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <HelpCircle className="w-12 h-12 text-slate-600 mb-2" />
                <p className="text-slate-400 text-sm">Select a table from the list to view its columns</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
