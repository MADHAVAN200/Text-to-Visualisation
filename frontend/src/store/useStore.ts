import { create } from 'zustand';

interface Database {
  id: number;
  name: string;
  db_type: string;
  host?: string;
  port?: number;
  username?: string;
  database_name: string;
  created_at: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface StoreState {
  user: User | null;
  token: string | null;
  connectedDatabases: Database[];
  activeDatabase: Database | null;
  queryHistory: any[];
  dashboards: any[];
  groqApiKey: string;
  
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setConnectedDatabases: (databases: Database[]) => void;
  setActiveDatabase: (database: Database | null) => void;
  setQueryHistory: (history: any[]) => void;
  setDashboards: (dashboards: any[]) => void;
  setGroqApiKey: (key: string) => void;
  logout: () => void;
}

export const useStore = create<StoreState>((set) => ({
  user: JSON.parse(localStorage.getItem('v2v_user') || 'null'),
  token: localStorage.getItem('v2v_token') || null,
  connectedDatabases: [],
  activeDatabase: JSON.parse(localStorage.getItem('v2v_active_db') || 'null'),
  queryHistory: [],
  dashboards: [],
  groqApiKey: localStorage.getItem('v2v_groq_api_key') || '',

  setUser: (user) => {
    localStorage.setItem('v2v_user', JSON.stringify(user));
    set({ user });
  },
  
  setToken: (token) => {
    if (token) {
      localStorage.setItem('v2v_token', token);
    } else {
      localStorage.removeItem('v2v_token');
    }
    set({ token });
  },

  setConnectedDatabases: (connectedDatabases) => set({ connectedDatabases }),
  
  setActiveDatabase: (activeDatabase) => {
    if (activeDatabase) {
      localStorage.setItem('v2v_active_db', JSON.stringify(activeDatabase));
    } else {
      localStorage.removeItem('v2v_active_db');
    }
    set({ activeDatabase });
  },

  setQueryHistory: (queryHistory) => set({ queryHistory }),
  
  setDashboards: (dashboards) => set({ dashboards }),

  setGroqApiKey: (groqApiKey) => {
    localStorage.setItem('v2v_groq_api_key', groqApiKey);
    set({ groqApiKey });
  },

  logout: () => {
    localStorage.removeItem('v2v_token');
    localStorage.removeItem('v2v_user');
    localStorage.removeItem('v2v_active_db');
    set({ user: null, token: null, activeDatabase: null });
  }
}));
