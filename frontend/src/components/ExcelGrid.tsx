import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Layers, ChevronDown, Check } from 'lucide-react';

interface ExcelGridProps {
  columns: string[];
  rows: any[];
}

type ColorGradeMode = 'none' | 'blue' | 'green' | 'red' | 'diverging';

// Helper to generate Excel column letters (A, B, C... Z, AA, AB...)
const getExcelColumnLabel = (index: number): string => {
  let label = '';
  let temp = index;
  while (temp >= 0) {
    label = String.fromCharCode((temp % 26) + 65) + label;
    temp = Math.floor(temp / 26) - 1;
  }
  return label;
};

export default function ExcelGrid({ columns, rows }: ExcelGridProps) {
  const { theme } = useStore();
  const [filterText, setFilterText] = useState('');
  const [colorGradeMode, setColorGradeMode] = useState<ColorGradeMode>('blue');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [focusedColumn, setFocusedColumn] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const colorGradeOptions: { value: ColorGradeMode; label: string }[] = [
    { value: 'none', label: 'None (Plain Grid)' },
    { value: 'blue', label: 'Soft Blue Heat Map' },
    { value: 'green', label: 'Soft Green Heat Map' },
    { value: 'red', label: 'Soft Red Heat Map' },
    { value: 'diverging', label: 'Red-to-Green Diverging' }
  ];

  // 1. Column Sorting Trigger
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // 2. Filter Rows by Search Text
  const filteredRows = useMemo(() => {
    if (!filterText.trim()) return rows;
    const lowerFilter = filterText.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const val = row[col];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(lowerFilter);
      })
    );
  }, [rows, columns, filterText]);

  // 3. Sort Filtered Rows
  const sortedRows = useMemo(() => {
    const sortableRows = [...filteredRows];
    if (sortConfig !== null) {
      sortableRows.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const aNum = Number(aVal);
        const bNum = Number(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        if (aStr < bStr) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aStr > bStr) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableRows;
  }, [filteredRows, sortConfig]);

  // 4. Calculate Column Statistics (min/max range & summary info)
  const columnRangesAndStats = useMemo(() => {
    const data: Record<
      string,
      {
        min: number;
        max: number;
        isNumeric: boolean;
        sum: number;
        avg: number;
        count: number;
        numericCount: number;
      }
    > = {};

    columns.forEach((col) => {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let numericCount = 0;
      let count = 0;

      rows.forEach((row) => {
        const val = row[col];
        count++;
        if (val !== null && val !== undefined && val !== '') {
          const num = Number(val);
          if (!isNaN(num)) {
            numericCount++;
            sum += num;
            if (num < min) min = num;
            if (num > max) max = num;
          }
        }
      });

      const isNumeric = numericCount > 0 && numericCount >= count * 0.5;

      data[col] = {
        min: min === Infinity ? 0 : min,
        max: max === -Infinity ? 0 : max,
        isNumeric,
        sum,
        avg: numericCount > 0 ? sum / numericCount : 0,
        count,
        numericCount,
      };
    });

    return data;
  }, [columns, rows]);

  // 5. Get Background Styles for Cell based on color grade mode
  const getCellStyles = (val: any, colName: string) => {
    const stats = columnRangesAndStats[colName];
    if (
      !stats ||
      !stats.isNumeric ||
      colorGradeMode === 'none' ||
      val === null ||
      val === undefined ||
      val === ''
    ) {
      return {};
    }

    const num = Number(val);
    if (isNaN(num)) return {};

    const min = stats.min;
    const max = stats.max;
    if (max === min) return {};

    const pct = (num - min) / (max - min);
    const isDark = theme !== 'light';

    if (isDark) {
      switch (colorGradeMode) {
        case 'blue':
          return { backgroundColor: `rgba(59, 130, 246, ${0.12 + pct * 0.45})`, color: '#ffffff' };
        case 'green':
          return { backgroundColor: `rgba(16, 185, 129, ${0.12 + pct * 0.45})`, color: '#ffffff' };
        case 'red':
          return { backgroundColor: `rgba(239, 68, 68, ${0.12 + pct * 0.45})`, color: '#ffffff' };
        case 'diverging':
          if (pct < 0.5) {
            const intensity = (0.5 - pct) * 2;
            return { backgroundColor: `rgba(239, 68, 68, ${intensity * 0.4})`, color: '#ffffff' };
          } else {
            const intensity = (pct - 0.5) * 2;
            return { backgroundColor: `rgba(16, 185, 129, ${intensity * 0.4})`, color: '#ffffff' };
          }
      }
    } else {
      // Light Mode colors (richer opacities for better contrast against white/off-white)
      switch (colorGradeMode) {
        case 'blue':
          return { backgroundColor: `rgba(59, 130, 246, ${0.1 + pct * 0.35})`, color: 'var(--slate-50)' };
        case 'green':
          return { backgroundColor: `rgba(16, 185, 129, ${0.1 + pct * 0.35})`, color: 'var(--slate-50)' };
        case 'red':
          return { backgroundColor: `rgba(239, 68, 68, ${0.1 + pct * 0.35})`, color: 'var(--slate-50)' };
        case 'diverging':
          if (pct < 0.5) {
            const intensity = (0.5 - pct) * 2;
            return { backgroundColor: `rgba(239, 68, 68, ${intensity * 0.3})`, color: 'var(--slate-50)' };
          } else {
            const intensity = (pct - 0.5) * 2;
            return { backgroundColor: `rgba(16, 185, 129, ${intensity * 0.3})`, color: 'var(--slate-50)' };
          }
      }
    }

    return {};
  };

  // 6. Selected Column Stats for bottom status bar
  const focusedStats = useMemo(() => {
    if (!focusedColumn) return null;
    return columnRangesAndStats[focusedColumn] || null;
  }, [focusedColumn, columnRangesAndStats]);

  return (
    <div className="flex flex-col h-full border border-slate-700 rounded-2xl overflow-hidden bg-slate-900/5 dark:bg-slate-950/20 shadow-md">
      {/* Top Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-3.5 border-b border-slate-700 bg-slate-800/40">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </span>
          <input
            type="text"
            placeholder="Search spreadsheet..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        {/* Color Grading Control */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <Layers className="h-4 w-4 text-blue-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Color Grade:
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 text-slate-200 rounded-xl px-3.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer min-w-[170px]"
            >
              <span>{colorGradeOptions.find(o => o.value === colorGradeMode)?.label}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${isDropdownOpen ? 'transform rotate-180' : ''}`} />
            </button>
            
            {isDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-xl py-1.5 z-50">
                  {colorGradeOptions.map((opt) => {
                    const isSelected = opt.value === colorGradeMode;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setColorGradeMode(opt.value);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2 text-xs text-left transition-colors font-medium ${
                          isSelected
                            ? 'bg-blue-600/15 text-blue-500 dark:text-blue-400 font-bold'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Table Grid Container */}
      <div className="flex-1 overflow-auto h-full min-h-0">
        <table className="w-full border-collapse table-fixed text-[11px] font-mono select-text min-w-max">
          <thead>
            {/* Excel Row 1: Column Letters */}
            <tr className="bg-slate-800 text-slate-400 select-none">
              <th className="w-12 text-center py-1 border-r border-b border-slate-700 bg-slate-800 font-bold sticky top-0 left-0 z-30 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                &nbsp;
              </th>
              {columns.map((col, idx) => (
                <th
                  key={`letter-${col}`}
                  className="px-3 py-1 text-center font-bold border-r border-b border-slate-700 sticky top-0 z-10 bg-slate-800"
                >
                  {getExcelColumnLabel(idx)}
                </th>
              ))}
            </tr>

            {/* Excel Row 2: Database Column Headers */}
            <tr className="bg-slate-900 text-slate-200 select-none">
              <th className="w-12 text-center py-2 border-r border-b border-slate-700 bg-slate-800 sticky top-[23px] left-0 z-30 shadow-[1px_0_0_0_rgba(0,0,0,0.05)] border-t border-t-slate-700">
                &nbsp;
              </th>
              {columns.map((col) => {
                const isSorted = sortConfig && sortConfig.key === col;
                const ranges = columnRangesAndStats[col];
                const typeLabel = ranges && ranges.isNumeric ? 'NUM' : 'TXT';

                return (
                  <th
                    key={`header-${col}`}
                    onClick={() => handleSort(col)}
                    className={`px-3 py-2 text-left border-r border-b border-slate-700 sticky top-[23px] z-10 cursor-pointer select-none bg-slate-900 hover:bg-slate-800 transition-colors ${
                      focusedColumn === col
                        ? 'bg-blue-500/10 text-blue-500 font-bold border-b-2 border-b-blue-500'
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate block font-bold text-xs" title={col}>
                        {col}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[8px] bg-slate-800 border border-slate-700 px-1 rounded text-slate-400 font-bold tracking-wider">
                          {typeLabel}
                        </span>
                        {isSorted ? (
                          sortConfig.direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-blue-500" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-blue-500" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-slate-500 hover:text-slate-300 transition-colors" />
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="py-12 text-center text-slate-500 font-semibold bg-slate-950/5"
                >
                  No data found matching current search filter.
                </td>
              </tr>
            ) : (
              sortedRows.map((row, rIdx) => (
                <tr
                  key={`row-${rIdx}`}
                  className="hover:bg-slate-800/10 dark:hover:bg-slate-800/20 border-b border-slate-700/60 transition-colors group"
                >
                  {/* Left Column Index */}
                  <td className="w-12 text-center py-1.5 border-r border-slate-700 bg-slate-800 text-slate-400 font-bold tracking-wider select-none sticky left-0 z-10 group-hover:bg-slate-700 shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                    {rIdx + 1}
                  </td>
                  {columns.map((col) => {
                    const cellVal = row[col];
                    const valStats = getCellStyles(cellVal, col);
                    const isNum =
                      columnRangesAndStats[col] &&
                      columnRangesAndStats[col].isNumeric;

                    return (
                      <td
                        key={`cell-${rIdx}-${col}`}
                        onClick={() => setFocusedColumn(col)}
                        style={valStats}
                        className={`px-3 py-1.5 border-r border-slate-700/60 text-slate-100 truncate ${
                          isNum ? 'text-right' : 'text-left'
                        } ${
                          focusedColumn === col
                            ? 'ring-1 ring-blue-500/30 bg-blue-500/5 font-semibold text-blue-600 dark:text-blue-400'
                            : ''
                        }`}
                      >
                        {cellVal === null || cellVal === undefined
                          ? '-'
                          : isNum && typeof cellVal === 'number'
                          ? cellVal.toLocaleString(undefined, {
                              maximumFractionDigits: 4,
                            })
                          : String(cellVal)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Status Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 py-2.5 border-t border-slate-700 bg-slate-800 text-[10px] text-slate-400 font-mono gap-2 select-none">
        <div className="flex gap-4">
          <span>
            Total Rows: <strong className="text-slate-100">{rows.length}</strong>
          </span>
          {filteredRows.length !== rows.length && (
            <span className="text-amber-500 font-bold">
              Filtered: {filteredRows.length} rows
            </span>
          )}
        </div>

        {/* Selected Column Stats */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 items-center justify-end">
          {focusedStats ? (
            <>
              <span className="text-blue-500 font-bold shrink-0">
                [{focusedColumn}]
              </span>
              <span>
                Count: <strong className="text-slate-100">{focusedStats.count}</strong>
              </span>
              {focusedStats.isNumeric && (
                <>
                  <span>
                    Sum:{' '}
                    <strong className="text-slate-100">
                      {focusedStats.sum.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </strong>
                  </span>
                  <span>
                    Avg:{' '}
                    <strong className="text-slate-100">
                      {focusedStats.avg.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </strong>
                  </span>
                  <span>
                    Min:{' '}
                    <strong className="text-slate-100">
                      {focusedStats.min.toLocaleString()}
                    </strong>
                  </span>
                  <span>
                    Max:{' '}
                    <strong className="text-slate-100">
                      {focusedStats.max.toLocaleString()}
                    </strong>
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="italic text-slate-500">
              Click any column/cell to calculate conditional statistics.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
