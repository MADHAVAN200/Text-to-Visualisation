import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import api from '../api';
import { Table, Key, Info, HelpCircle, AlertCircle, RefreshCw, Eye, FileText, Search, Network } from 'lucide-react';
import ExcelGrid from '../components/ExcelGrid';

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

  const [activeMainTab, setActiveMainTab] = useState<'data' | 'schema'>('data');
  const [visualizerMode, setVisualizerMode] = useState<'diagram' | 'list'>('diagram');
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);

  const [previewData, setPreviewData] = useState<{ rows: any[]; columns: string[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [tableSearch, setTableSearch] = useState('');

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

  const fetchPreview = async (tableName: string) => {
    if (!activeDatabase) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await api.get(`/databases/${activeDatabase.id}/preview/${tableName}`);
      setPreviewData(res.data);
    } catch (err: any) {
      console.error('Failed to load table preview:', err);
      setPreviewError(err.response?.data?.error || 'Could not retrieve data preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    fetchSchema();
    setPreviewData(null);
    setTableSearch('');
  }, [activeDatabase]);

  useEffect(() => {
    if (selectedTable && activeMainTab === 'data') {
      fetchPreview(selectedTable);
    }
  }, [selectedTable, activeMainTab]);

  const tableNames = Object.keys(schema);

  // Search filter for tables list in sidebar
  const filteredTables = useMemo(() => {
    if (!tableSearch.trim()) return tableNames;
    return tableNames.filter(tbl => tbl.toLowerCase().includes(tableSearch.toLowerCase()));
  }, [tableNames, tableSearch]);

  // Topological sorting for the visual diagram layout layers
  const tableLayoutInfo = useMemo(() => {
    if (tableNames.length === 0) return { depths: {}, groups: {}, maxRows: 0, relationships: [] };

    // 1. Initialize table depths to 0
    const depths: Record<string, number> = {};
    tableNames.forEach(t => depths[t] = 0);

    // 2. Build foreign key relationships list
    const relationships: Array<{ from: string; to: string; fromCol: string; toCol: string }> = [];
    tableNames.forEach(src => {
      const cols = schema[src] || [];
      cols.forEach(c => {
        if (c.isForeign && c.foreignTable) {
          relationships.push({
            from: src,
            to: c.foreignTable,
            fromCol: c.column,
            toCol: c.foreignColumn || 'id'
          });
        }
      });
    });

    // 3. Resolve depths iteratively to find layered columns (lookup vs transactional)
    for (let pass = 0; pass < 5; pass++) {
      tableNames.forEach(tbl => {
        const cols = schema[tbl] || [];
        let maxParentDepth = -1;
        cols.forEach(c => {
          if (c.isForeign && c.foreignTable && depths[c.foreignTable] !== undefined) {
            maxParentDepth = Math.max(maxParentDepth, depths[c.foreignTable]);
          }
        });
        if (maxParentDepth >= 0) {
          depths[tbl] = Math.max(depths[tbl], maxParentDepth + 1);
        }
      });
    }

    // 4. Group tables by resolved depth levels
    const groups: Record<number, string[]> = {};
    tableNames.forEach(tbl => {
      const d = depths[tbl];
      if (!groups[d]) groups[d] = [];
      groups[d].push(tbl);
    });

    const maxRows = Math.max(...Object.values(groups).map(g => g.length), 0);

    return { depths, groups, maxRows, relationships };
  }, [schema, tableNames]);

  // Render the SVGs and absolute entity cards for the ERD visualizer
  const renderERDiagram = () => {
    const { groups, relationships } = tableLayoutInfo;
    const colKeys = Object.keys(groups).map(Number).sort((a, b) => a - b);
    
    const colCount = colKeys.length;
    if (colCount === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-slate-500 font-semibold border border-dashed border-slate-700 rounded-xl bg-slate-900/5 select-none">
          <Network className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-sm">No tables in database to visualize.</p>
        </div>
      );
    }

    // Spacing coordinates configuration
    const CARD_WIDTH = 230;
    const CARD_HEIGHT = 160;
    const COL_GAP = 120;
    const ROW_GAP = 60;
    
    const colWidth = CARD_WIDTH + COL_GAP;
    const rowHeight = CARD_HEIGHT + ROW_GAP;
    
    // Find absolute coordinates of a card
    const getCardCoords = (tbl: string) => {
      let colIdx = 0;
      let rowIdx = 0;
      for (const colKey of colKeys) {
        const idx = groups[colKey].indexOf(tbl);
        if (idx >= 0) {
          colIdx = colKey;
          rowIdx = idx;
          break;
        }
      }
      return {
        x: colIdx * colWidth + 40,
        y: rowIdx * rowHeight + 40
      };
    };

    const maxRows = Math.max(...Object.values(groups).map(g => g.length), 0);
    const canvasWidth = colCount * colWidth + 40;
    const canvasHeight = maxRows * rowHeight + 40;

    return (
      <div className="relative w-full h-[calc(100vh-170px)] overflow-auto bg-slate-950/40 border border-slate-700 rounded-xl p-6 shadow-inner select-none">
        <div style={{ width: canvasWidth, height: canvasHeight }} className="relative min-w-full min-h-full">
          {/* SVG Connector Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="currentColor" />
              </marker>
            </defs>
            {relationships.map((rel, rIdx) => {
              const startCoords = getCardCoords(rel.to); // Parent table (Target)
              const endCoords = getCardCoords(rel.from);  // Child table (Source)
              
              if (!startCoords || !endCoords) return null;

              const parentIsLeft = startCoords.x < endCoords.x;
              
              // Curve anchor points
              const x1 = parentIsLeft ? startCoords.x + CARD_WIDTH : startCoords.x;
              const y1 = startCoords.y + (CARD_HEIGHT / 2);
              
              const x2 = parentIsLeft ? endCoords.x : endCoords.x + CARD_WIDTH;
              const y2 = endCoords.y + (CARD_HEIGHT / 2);

              const midX = (x1 + x2) / 2;
              const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

              // Interactive highlighting triggers
              const isHovered = hoveredTable === rel.from || hoveredTable === rel.to;
              const noHover = hoveredTable === null;
              
              const strokeColor = isHovered 
                ? 'text-blue-500 dark:text-blue-400' 
                : 'text-slate-600/30 dark:text-slate-700/50';
                
              const strokeWidth = isHovered ? 2.5 : 1.2;
              const opacity = noHover ? 0.6 : isHovered ? 1.0 : 0.15;

              return (
                <path
                  key={`rel-${rIdx}`}
                  d={d}
                  fill="none"
                  className={`${strokeColor} transition-all duration-300`}
                  stroke="currentColor"
                  strokeWidth={strokeWidth}
                  style={{ opacity }}
                  markerEnd="url(#arrow)"
                />
              );
            })}
          </svg>

          {/* Table Entity Cards */}
          {colKeys.map((colKey) => (
            <div key={`col-${colKey}`} className="absolute top-0" style={{ left: colKey * colWidth + 40 }}>
              {groups[colKey].map((tbl, tblIdx) => {
                const isSelected = selectedTable === tbl;
                const isHovered = hoveredTable === tbl;
                const columnsList = schema[tbl] || [];
                
                return (
                  <div
                    key={`card-${tbl}`}
                    onMouseEnter={() => setHoveredTable(tbl)}
                    onMouseLeave={() => setHoveredTable(null)}
                    onClick={() => setSelectedTable(tbl)}
                    className={`absolute w-[230px] h-[160px] rounded-xl border flex flex-col overflow-hidden transition-all duration-200 cursor-pointer shadow-md select-none ${
                      isSelected
                        ? 'bg-slate-900 border-blue-500 ring-2 ring-blue-500/10 shadow-blue-500/5'
                        : isHovered
                        ? 'bg-slate-800/90 border-slate-500 shadow-lg translate-y-[-2px]'
                        : 'bg-slate-900/80 border-slate-700/90 hover:border-slate-600'
                    }`}
                    style={{ top: tblIdx * rowHeight + 40 }}
                  >
                    {/* Header */}
                    <div className={`px-3 py-2.5 border-b flex items-center justify-between shrink-0 select-none ${
                      isSelected 
                        ? 'bg-blue-600/10 border-blue-500/20 text-blue-500 dark:text-blue-400' 
                        : 'bg-slate-800/50 border-slate-700 text-slate-200'
                    }`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Table className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-bold text-xs truncate" title={tbl}>
                          {tbl}
                        </span>
                      </div>
                      <span className="text-[8px] bg-slate-800 border border-slate-700 px-1 rounded text-slate-400 font-bold tracking-wider shrink-0 select-none">
                        {columnsList.length} COL
                      </span>
                    </div>

                    {/* Columns Scrollable list */}
                    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 font-mono text-[9px] text-slate-300 bg-slate-950/20">
                      {columnsList.map(c => (
                        <div key={c.column} className="flex items-center justify-between gap-1">
                          <span className={`truncate ${c.isPrimary ? 'text-amber-500 font-bold' : c.isForeign ? 'text-purple-400 font-bold' : ''}`}>
                            {c.column}
                          </span>
                          <div className="flex gap-0.5 items-center shrink-0">
                            {c.isPrimary && (
                              <Key className="w-2.5 h-2.5 text-amber-500" />
                            )}
                            {c.isForeign && (
                              <Info className="w-2.5 h-2.5 text-purple-500" />
                            )}
                            <span className="text-[7.5px] text-slate-500 font-bold uppercase">{c.type || 'TEXT'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

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

  return (
    <div className="space-y-4 flex flex-col h-full">
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-sm rounded-xl shrink-0">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 flex-1">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Retrieving database catalog...</p>
        </div>
      ) : tableNames.length === 0 ? (
        <div className="bg-slate-900/20 border border-slate-700 border-dashed rounded-2xl p-12 text-center flex-1 flex flex-col items-center justify-center">
          <Table className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="font-semibold text-slate-300 mb-1">No tables found</h3>
          <p className="text-slate-500 text-sm max-w-sm mx-auto">
            This database appears to be empty or sync failed. Click "Refresh Catalog" or check database tables.
          </p>
          <button
            onClick={fetchSchema}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 rounded-xl"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Catalog
          </button>
        </div>
      ) : (
        <div className="space-y-4 flex flex-col flex-1 min-h-0">
          {/* Main Tabs Header (with Refresh button on the right) */}
          <div className="flex items-center justify-between border-b border-slate-700 shrink-0">
            <div className="flex">
              <button
                onClick={() => setActiveMainTab('data')}
                className={`flex items-center gap-2.5 py-2.5 px-5 text-xs font-bold border-b-2 transition-all ${
                  activeMainTab === 'data'
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="w-4 h-4" />
                Data Grid Explorer
              </button>
              <button
                onClick={() => setActiveMainTab('schema')}
                className={`flex items-center gap-2.5 py-2.5 px-5 text-xs font-bold border-b-2 transition-all ${
                  activeMainTab === 'schema'
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-4 h-4" />
                Schema Catalog Visualizer
              </button>
            </div>

            <button
              onClick={fetchSchema}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-slate-300 hover:text-slate-100 rounded-lg shadow-sm transition-all disabled:opacity-50 mb-1"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Sync Catalog
            </button>
          </div>

          {/* Tab Contents */}
          <div className="flex-1 min-h-0">
            {activeMainTab === 'data' ? (
              /* TAB 1: Only Data grid view with horizontal select filters */
              <div className="flex flex-col space-y-4 h-full">
                {/* Horizontal Filter Pill buttons */}
                <div className="flex items-center gap-2 py-1.5 overflow-x-auto scroll-smooth pb-3.5 shrink-0 select-none">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1.5">
                    Choose Table:
                  </span>
                  {tableNames.map((tbl) => (
                    <button
                      key={tbl}
                      onClick={() => setSelectedTable(tbl)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl border transition-all shrink-0 ${
                        selectedTable === tbl
                          ? 'bg-blue-600/15 border-blue-500 text-blue-500 dark:text-blue-400 shadow-sm'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Table className="w-3.5 h-3.5 text-slate-500" />
                      {tbl}
                    </button>
                  ))}
                </div>

                {/* Spreadsheet layout expanded to full parent space */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  {previewLoading ? (
                    <div className="flex flex-col items-center justify-center h-full">
                      <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                      <p className="text-slate-400 text-xs font-mono">Loading data grid preview...</p>
                    </div>
                  ) : previewError ? (
                    <div className="p-4 bg-red-950/40 border border-red-500/30 text-red-200 text-xs rounded-xl">
                      {previewError}
                    </div>
                  ) : previewData ? (
                    <div className="h-[calc(100vh-170px)]">
                      <ExcelGrid columns={previewData.columns} rows={previewData.rows} />
                    </div>
                  ) : (
                    <div className="text-center text-slate-500 py-12 text-xs italic bg-slate-900/5 border border-slate-700/60 border-dashed rounded-xl">
                      Select a table filter from the row above to load data.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* TAB 2: Tables sidebar (left) & schema visualizer details (right) */
              <div className="h-full flex flex-col space-y-4">
                {/* Visualizer sub-mode toggle */}
                <div className="flex justify-between items-center shrink-0">
                  <div className="text-slate-400 text-xs font-semibold select-none">
                    Viewing Table: <strong className="text-slate-200">{selectedTable}</strong>
                  </div>
                  <div className="flex border border-slate-700 bg-slate-800/40 rounded-xl p-1 shrink-0 select-none">
                    <button
                      onClick={() => setVisualizerMode('diagram')}
                      className={`flex items-center gap-1.5 py-1 px-3.5 text-xs font-bold rounded-lg transition-all ${
                        visualizerMode === 'diagram'
                          ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Architecture Diagram
                    </button>
                    <button
                      onClick={() => setVisualizerMode('list')}
                      className={`flex items-center gap-1.5 py-1 px-3.5 text-xs font-bold rounded-lg transition-all ${
                        visualizerMode === 'list'
                          ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Columns List
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0">
                  {visualizerMode === 'diagram' ? (
                    /* ER DIAGRAM ARCHITECTURE */
                    renderERDiagram()
                  ) : (
                    /* SIDEBAR & COLUMNS LIST VIEW */
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-full">
                      {/* Tables Sidebar */}
                      <div className="md:col-span-1 bg-slate-900/25 border border-slate-700 rounded-2xl p-4 flex flex-col h-[calc(100vh-220px)] min-h-[350px]">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1 mb-2.5 select-none">
                          Tables ({tableNames.length})
                        </span>
                        
                        {/* Table Search filter */}
                        <div className="relative mb-3 shrink-0">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-slate-400" />
                          </span>
                          <input
                            type="text"
                            placeholder="Search tables..."
                            value={tableSearch}
                            onChange={(e) => setTableSearch(e.target.value)}
                            className="w-full pl-9 pr-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                          />
                        </div>

                        {/* Scrollable list */}
                        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                          {filteredTables.length === 0 ? (
                            <div className="text-center py-8 text-xs text-slate-500 italic select-none">No tables match search.</div>
                          ) : (
                            filteredTables.map((tbl) => (
                              <button
                                key={tbl}
                                onClick={() => setSelectedTable(tbl)}
                                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold rounded-xl text-left border transition-all ${
                                  selectedTable === tbl
                                    ? 'bg-blue-600/15 text-blue-500 dark:text-blue-400 border-blue-500/30 font-bold shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent'
                                }`}
                              >
                                <Table className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                                <span className="truncate">{tbl}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Schema Column Info Visualizer */}
                      <div className="md:col-span-3 bg-slate-900/10 border border-slate-700 rounded-2xl p-6 h-[calc(100vh-220px)] min-h-[350px] overflow-hidden flex flex-col">
                        {selectedTable && schema[selectedTable] ? (
                          <div className="flex flex-col h-full space-y-4">
                            <div className="flex items-center justify-between border-b border-slate-700 pb-3 shrink-0">
                              <div>
                                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                                  <Table className="w-4.5 h-4.5 text-emerald-500" />
                                  {selectedTable}
                                </h2>
                                <p className="text-slate-400 text-xs mt-0.5 select-none">
                                  Contains {schema[selectedTable].length} columns
                                </p>
                              </div>
                            </div>

                            <div className="flex-1 overflow-y-auto border border-slate-700 rounded-xl bg-slate-900/20">
                              <table className="w-full text-left border-collapse text-xs select-text">
                                <thead>
                                  <tr className="border-b border-slate-700 bg-slate-800/40 text-slate-400 font-bold uppercase tracking-wider select-none sticky top-0">
                                    <th className="py-2.5 pl-4 bg-slate-800/80">Column Name</th>
                                    <th className="py-2.5 pl-2 bg-slate-800/80">Data Type</th>
                                    <th className="py-2.5 pl-2 bg-slate-800/80">Nullable</th>
                                    <th className="py-2.5 text-right pr-4 bg-slate-800/80">Keys & Constraints</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/60 text-slate-100">
                                  {schema[selectedTable].map((col) => (
                                    <tr key={col.column} className="hover:bg-slate-800/20 transition-colors">
                                      <td className="py-3 pl-4 font-bold text-slate-200">{col.column}</td>
                                      <td className="py-3 pl-2 font-mono text-xs text-blue-500 dark:text-blue-400">{col.type || 'TEXT'}</td>
                                      <td className="py-3 pl-2 text-slate-400">
                                        {col.nullable ? 'Yes' : 'No'}
                                      </td>
                                      <td className="py-3 text-right pr-4">
                                        <div className="flex items-center justify-end gap-1.5">
                                          {col.isPrimary && (
                                            <span className="flex items-center gap-1 text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full select-none">
                                              <Key className="w-2.5 h-2.5 text-amber-500" />
                                              PK
                                            </span>
                                          )}
                                          {col.isForeign && (
                                            <span
                                              className="flex items-center gap-1 text-[9px] font-bold text-purple-500 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full cursor-help select-none"
                                              title={`References ${col.foreignTable}(${col.foreignColumn})`}
                                            >
                                              <Info className="w-2.5 h-2.5 text-purple-500" />
                                              FK → {col.foreignTable}
                                            </span>
                                          )}
                                          {!col.isPrimary && !col.isForeign && (
                                            <span className="text-slate-600 text-xs select-none">-</span>
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
                          <div className="flex-1 flex flex-col items-center justify-center text-center">
                            <HelpCircle className="w-12 h-12 text-slate-600 mb-3 opacity-60" />
                            <p className="text-slate-400 text-sm">Select a table from the sidebar list to view its columns</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
