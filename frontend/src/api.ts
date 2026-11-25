import axios from 'axios';
import { useStore } from './store/useStore';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to automatically attach authorization header
api.interceptors.request.use(
  (config) => {
    const token = useStore.getState().token;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/') && useStore.getState().token) {
    useStore.getState().logout();
    window.location.reload();
  }
  return Promise.reject(error);
});
export default api;
