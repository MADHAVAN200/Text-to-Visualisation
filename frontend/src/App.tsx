import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import Dashboard from './pages/Dashboard';
import QueryWorkspace from './pages/QueryWorkspace';
import Connections from './pages/Connections';
import SchemaExplorer from './pages/SchemaExplorer';
import DashboardBuilder from './pages/DashboardBuilder';
import Settings from './pages/Settings';
import Login from './pages/Login';

import { 
  LayoutDashboard, Database, Table, HelpCircle, 
  Settings as SettingsIcon, LogOut, ChevronRight, User, LayoutGrid
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
      className={`flex items-center justify-between px-4 py-3 text-sm font-semibold rounded-xl transition-all duration-200 group ${
        isActive 
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/10' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}>
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${isActive ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0'}`} />
    </Link>
  );
}

function AppLayout() {
  const { user, logout, activeDatabase } = useStore();
  const location = useLocation();

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return 'Dashboard Home';
      case '/workspace': return 'Natural Language Workspace';
      case '/connections': return 'Database Connections';
      case '/schema': return 'Schema Catalog Explorer';
      case '/builder': return 'Dashboard Builder';
      case '/settings': return 'Configuration Settings';
      default: return 'Voice2Viz AI';
    }
  };

  return (
    <div className="min-h-screen bg-darkBg text-slate-100 flex">
      {/* Background Glows */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-600/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-600/5 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Sidebar navigation */}
      <aside className="w-64 bg-darkSidebar border-r border-darkBorder flex flex-col justify-between shrink-0 h-screen sticky top-0 z-30">
        <div className="p-6 space-y-8">
          {/* Logo brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/10">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-white tracking-wide text-base block">Voice2Viz AI</span>
              <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase block">Analytics Platform</span>
            </div>
          </div>

          {/* Nav links */}
          <nav className="space-y-1.5">
            <SidebarLink to="/" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" />
            <SidebarLink to="/workspace" icon={<HelpCircle className="w-4 h-4" />} label="Query Workspace" />
            <SidebarLink to="/connections" icon={<Database className="w-4 h-4" />} label="Connections" />
            <SidebarLink to="/schema" icon={<Table className="w-4 h-4" />} label="Schema Explorer" />
            <SidebarLink to="/builder" icon={<LayoutGrid className="w-4 h-4" />} label="Dashboard Builder" />
            <SidebarLink to="/settings" icon={<SettingsIcon className="w-4 h-4" />} label="Settings" />
          </nav>
        </div>

        {/* User Footer profile */}
        <div className="p-4 border-t border-darkBorder/60 space-y-3">
          {user && (
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center font-bold text-blue-400 text-xs shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-slate-200 truncate">{user.name}</span>
                <span className="block text-[10px] text-slate-500 truncate">{user.role}</span>
              </div>
            </div>
          )}

          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main scrolling workspace area */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Header navbar */}
        <header className="h-16 border-b border-darkBorder/60 bg-darkBg/60 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between px-8">
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
            
            <div className="flex items-center gap-2 text-slate-300">
              <User className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold">{user?.name}</span>
            </div>
          </div>
        </header>

        {/* Content canvas */}
        <main className="flex-1 p-8 overflow-y-auto">
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

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useStore((state) => state.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  const token = useStore((state) => state.token);
  
  return (
    <Router>
      <Routes>
        <Route path="/login" element={!token ? <Login /> : <Navigate to="/" replace />} />
        <Route 
          path="/*" 
          element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          } 
        />
      </Routes>
    </Router>
  );
}
