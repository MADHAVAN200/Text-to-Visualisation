import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import Dashboard from './pages/Dashboard';
import QueryWorkspace from './pages/QueryWorkspace';
import Connections from './pages/Connections';
import SchemaExplorer from './pages/SchemaExplorer';
import DashboardBuilder from './pages/DashboardBuilder';
import Settings from './pages/Settings';

import { 
  LayoutDashboard, Database, Table, HelpCircle, 
  Settings as SettingsIcon, User, LayoutGrid,
  Sun, Moon
} from 'lucide-react';

interface SidebarLinkProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

function SidebarLink({ to, icon, label }: SidebarLinkProps) {
  const location = useLocation();
  const isActive = location.pathname === to;
  
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3.5 py-2.5 text-xs font-semibold rounded-lg transition-all duration-150 relative ${
        isActive 
          ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
      }`}
    >
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-1 bg-blue-500 rounded-r" />
      )}
      <span className={isActive ? 'text-blue-400' : 'text-slate-500'}>
        {icon}
      </span>
      <span className="tracking-wide">{label}</span>
    </Link>
  );
}

function AppLayout() {
  const { user, activeDatabase, theme, setTheme } = useStore();
  const location = useLocation();

  React.useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return 'Dashboard Home';
      case '/workspace': return 'Natural Language Workspace';
      case '/connections': return 'Database Connections';
      case '/schema': return 'Schema Catalog Explorer';
      case '/builder': return 'Dashboard Builder';
      case '/settings': return 'Configuration Settings';
      default: return 'text2Viz AI';
    }
  };

  return (
    <div className="h-screen bg-darkBg text-slate-100 flex overflow-hidden relative">
      {/* Background Glows */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Sidebar navigation */}
      <aside className="w-60 bg-darkSidebar border-r border-darkBorder flex flex-col shrink-0 h-full z-30">
        {/* Sidebar Header matching main header height and alignment */}
        <div className="h-16 border-b border-darkBorder/60 flex items-center px-4 gap-2.5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/10 shrink-0">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-bold text-slate-100 tracking-wide text-xs block">text2Viz AI</span>
            <span className="text-[8px] text-slate-500 font-semibold tracking-wider uppercase block leading-none">Analytics Platform</span>
          </div>
        </div>

        {/* Scrollable nav items section */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Nav links */}
          <nav className="space-y-1">
            <SidebarLink to="/" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" />
            <SidebarLink to="/workspace" icon={<HelpCircle className="w-4 h-4" />} label="Query Workspace" />
            <SidebarLink to="/connections" icon={<Database className="w-4 h-4" />} label="Connections" />
            <SidebarLink to="/schema" icon={<Table className="w-4 h-4" />} label="Schema Explorer" />
            <SidebarLink to="/builder" icon={<LayoutGrid className="w-4 h-4" />} label="Dashboard Builder" />
            <SidebarLink to="/settings" icon={<SettingsIcon className="w-4 h-4" />} label="Settings" />
          </nav>
        </div>

        {/* User Footer profile */}
        <div className="p-3 border-t border-darkBorder/60">
          {user && (
            <div className="flex items-center gap-2.5 px-1">
              <div className="w-7.5 h-7.5 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center font-bold text-blue-400 text-xs shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-slate-200 truncate">{user.name}</span>
                <span className="block text-[9px] text-slate-500 truncate">{user.role}</span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main scrolling workspace area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        
        {/* Top Header navbar */}
        <header className="h-16 border-b border-darkBorder/60 bg-darkBg/60 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <h2 className="font-bold text-slate-200 text-base">{getPageTitle()}</h2>
          </div>

          <div className="flex items-center gap-4">
            {activeDatabase ? (
              <div className="hidden sm:flex items-center gap-1.5 text-xs bg-slate-900 border border-darkBorder px-3 py-1 rounded-full text-slate-300">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="font-semibold text-slate-400">DB Connected:</span>
                <span className="font-mono text-blue-400">{activeDatabase.name}</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 text-xs bg-red-950/20 border border-red-500/10 px-3 py-1 rounded-full text-red-400">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <span>No Database Active</span>
              </div>
            )}
            
            <div className="w-px h-6 bg-darkBorder"></div>

            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl bg-darkSidebar border border-darkBorder hover:text-blue-500 hover:bg-slate-800/80 transition-all text-slate-300 flex items-center justify-center shrink-0"
              title="Toggle Light/Dark Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            <div className="w-px h-6 bg-darkBorder"></div>
            
            <div className="flex items-center gap-2 text-slate-300">
              <User className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold">{user?.name}</span>
            </div>
          </div>
        </header>

        {/* Content canvas */}
        <main className="flex-1 p-4 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/workspace" element={<QueryWorkspace />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/schema" element={<SchemaExplorer />} />
            <Route path="/builder" element={<DashboardBuilder />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </Router>
  );
}
