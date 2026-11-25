import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate, Link } from 'react-router-dom';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import QueryWorkspace from './pages/QueryWorkspace';
import Connections from './pages/Connections';
import SchemaExplorer from './pages/SchemaExplorer';
import DashboardBuilder from './pages/DashboardBuilder';
import Settings from './pages/Settings';
import { LayoutDashboard, Database, MessageSquare, Settings as SettingsIcon, ChartNoAxesCombined, Sun, Moon, Menu, X, LogOut, ArrowUpRight } from 'lucide-react';

function DataArea() {
  const location=useLocation();
  return <div className="space-y-6"><div className="section-tabs" aria-label="Data navigation">
    <NavLink to="/connections">Connections</NavLink><NavLink to="/schema">Schema explorer</NavLink>
  </div>{location.pathname==='/schema'?<SchemaExplorer/>:<Connections/>}</div>;
}
function AppLayout() {
  const {user,activeDatabase,theme,setTheme}=useStore();
  const location=useLocation();
  const [menu,setMenu]=React.useState(false);
  React.useEffect(()=>setMenu(false),[location.pathname]);
  React.useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
  const navigation=[
    {to:'/',label:'Overview',icon:LayoutDashboard},
    {to:'/builder',label:'Dashboards',icon:ChartNoAxesCombined},
    {to:'/workspace',label:'Ask your data',icon:MessageSquare},
    {to:'/connections',label:'Data',icon:Database},
    {to:'/settings',label:'Settings',icon:SettingsIcon},
  ];
  const title=location.pathname==='/schema'?'Data':navigation.find(n=>n.to===location.pathname)?.label || 'Queryloom';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {menu && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={()=>setMenu(false)}/>}
    <aside className={'app-sidebar '+(menu?'is-open':'')} aria-label="Main navigation">
      <Link to="/" className="app-brand"><ChartNoAxesCombined size={27}/><span>Queryloom<span className="brand-caption">YOUR DATA, EXPLAINED</span></span></Link>
      <button className="mobile-close icon-button" aria-label="Close navigation" onClick={()=>setMenu(false)}><X size={18}/></button>
      <nav className="app-nav">{navigation.map(({to,label,icon:Icon})=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>'nav-item '+(isActive || (to==='/connections' && location.pathname==='/schema')?'is-active':'')}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-help"><span className="text-slate-200 font-semibold">Start with a question</span><p>Turn your connected data into a dashboard.</p><Link to="/builder">Explore your data <ArrowUpRight size={14}/></Link></div>
      <div className="sidebar-profile"><div className="profile-avatar">{user?.name.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="text-xs font-semibold truncate">{user?.name}</div><div className="text-[11px] text-slate-400">Personal workspace</div></div><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={()=>useStore.getState().logout()}><LogOut size={16}/></button></div>
    </aside>
    <div className="app-body"><header className="app-header"><div className="flex items-center gap-3"><button className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={menu} onClick={()=>setMenu(true)}><Menu size={20}/></button><h1>{title}</h1></div><div className="flex items-center gap-3"><Link to="/connections" className="connection-pill"><span className={activeDatabase?'status-dot':'status-dot offline'}/><span>{activeDatabase?.name || 'Connect a database'}</span></Link><button className="icon-button" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button></div></header>
    <main id="main-content" className="app-content" tabIndex={-1}><Routes>
      <Route path="/" element={<Dashboard/>}/><Route path="/builder" element={<DashboardBuilder/>}/><Route path="/workspace" element={<QueryWorkspace/>}/><Route path="/connections" element={<DataArea/>}/><Route path="/schema" element={<DataArea/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes></main></div>
  </div>;
}
export default function App(){
  const token=useStore(s=>s.token);const theme=useStore(s=>s.theme);
  React.useEffect(()=>{document.documentElement.classList.toggle('light',theme==='light');document.documentElement.style.colorScheme=theme;},[theme]);
  return <BrowserRouter>{token && token!=='mock-guest-token-12345'?<AppLayout/>:<Login/>}</BrowserRouter>;
}
