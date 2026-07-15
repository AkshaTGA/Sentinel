import axios from 'axios';

export const API_BASE_URL = "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Automatically inject JWT token into requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sentinel_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export const authAPI = {
  login: async (email, password) => {
    const formData = new FormData();
    formData.append('username', email);
    formData.append('password', password);
    const res = await api.post('/api/auth/token', formData);
    if (res.data.access_token) {
      localStorage.setItem('sentinel_token', res.data.access_token);
    }
    return res.data;
  },
  register: async (email, password) => {
    const res = await api.post('/api/auth/register', { email, password });
    return res.data;
  },
  getMe: async () => {
    const res = await api.get('/api/auth/me');
    return res.data;
  },
  logout: () => {
    localStorage.removeItem('sentinel_token');
  }
};

export const devicesAPI = {
  list: async () => {
    const res = await api.get('/api/devices');
    return res.data;
  },
  get: async (id) => {
    const res = await api.get(`/api/devices/${id}`);
    return res.data;
  },
  register: async (id, name, os, hostname) => {
    const res = await api.post('/api/devices', { id, name, os, hostname });
    return res.data;
  },
  update: async (id, data) => {
    const res = await api.put(`/api/devices/${id}`, data);
    return res.data;
  },
  delete: async (id) => {
    const res = await api.delete(`/api/devices/${id}`);
    return res.data;
  },
  getTelemetry: async (id, limit = 50) => {
    const res = await api.get(`/api/devices/${id}/telemetry?limit=${limit}`);
    return res.data;
  },
  getCommands: async (id, limit = 50) => {
    const res = await api.get(`/api/devices/${id}/commands?limit=${limit}`);
    return res.data;
  },
  deleteTelemetry: async (deviceId, telemetryId) => {
    const res = await api.delete(`/api/devices/${deviceId}/telemetry/${telemetryId}`);
    return res.data;
  },
  clearTelemetry: async (deviceId) => {
    const res = await api.delete(`/api/devices/${deviceId}/telemetry`);
    return res.data;
  },
  downloadFile: async (deviceId, uniqueId, filename) => {
    const res = await api.get(`/api/devices/${deviceId}/download-file/${uniqueId}/${filename}`, {
      responseType: 'blob'
    });
    return res.data;
  }
};

export const commandsAPI = {
  dispatch: async (deviceId, commandType, payload = null) => {
    const res = await api.post('/api/commands', {
      device_id: deviceId,
      command_type: commandType,
      payload
    });
    return res.data;
  },
  deleteLog: async (commandId) => {
    const res = await api.delete(`/api/commands/${commandId}`);
    return res.data;
  }
};

export default api;
