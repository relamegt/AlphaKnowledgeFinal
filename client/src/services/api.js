import axios from 'axios';

// Production-ready environment variable
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://alphaknowledgefinal-1.onrender.com';

console.log('🌐 API Base URL:', API_BASE_URL);

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// FIXED: Enhanced request interceptor
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage
    const token = localStorage.getItem('authToken');
    
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
      console.log('🔐 Token added to request:', config.url);
    } else {
      console.log('⚠️ No token found for request:', config.url);
    }
    
    return config;
  },
  (error) => {
    console.error('❌ Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// FIXED: Auth API with proper token storage
export const authAPI = {
  getCurrentUser: async () => {
    try {
      const response = await api.get('/auth/user');
      return response.data;
    } catch (error) {
      // Suppress 401 errors for getCurrentUser (expected when not logged in)
      if (error.response?.status === 401 && error.config?.url?.includes('/auth/user')) {
        return null;
      }
      console.error('❌ Auth check error:', error.response?.status, error.message);
      return null;
    }
  },
  
  verifyGoogleToken: async (token) => {
    try {
      console.log('🔐 Verifying Google token...');
      const response = await api.post('/auth/google/verify', { token });
      
      // CRITICAL: Store the JWT token from backend response
      if (response.data.success && response.data.token) {
        localStorage.setItem('authToken', response.data.token);
        console.log('✅ JWT token stored in localStorage');
        
        // Store user data
        if (response.data.user) {
          localStorage.setItem('cachedUser', JSON.stringify(response.data.user));
          console.log('✅ User data cached');
        }
      } else {
        console.error('❌ No JWT token received from backend!');
        console.log('Response:', response.data);
      }
      
      return response.data;
    } catch (error) {
      console.error('❌ Token verification failed:', error.response?.data || error.message);
      throw error;
    }
  },
  
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Always clear tokens
      localStorage.removeItem('authToken');
      localStorage.removeItem('cachedUser');
      console.log('🔓 Tokens cleared from localStorage');
    }
  },
};

// Keep all your existing APIs (progressAPI, sheetAPI, etc.) unchanged...
export const progressAPI = {
  getUserProgress: (userId) => api.get(`/progress/${userId}`),
  toggleProblem: (problemData) => api.post('/progress/toggle', problemData),
  getStats: (userId) => api.get(`/progress/stats/${userId}`)
};

export const sheetAPI = {
  getAll: () => api.get('/sheets'),
  getById: (id) => api.get(`/sheets/${id}`),
  create: (data) => api.post('/sheets', data),
  update: (id, data) => api.put(`/sheets/${id}`, data),
  delete: (id) => api.delete(`/sheets/${id}`),
  addSection: (sheetId, data) => api.post(`/sheets/${sheetId}/sections`, data),
  updateSection: (sheetId, sectionId, data) => api.put(`/sheets/${sheetId}/sections/${sectionId}`, data),
  deleteSection: (sheetId, sectionId) => api.delete(`/sheets/${sheetId}/sections/${sectionId}`),
  addSubsection: (sheetId, sectionId, data) => api.post(`/sheets/${sheetId}/sections/${sectionId}/subsections`, data),
  updateSubsection: (sheetId, sectionId, subsectionId, data) => api.put(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}`, data),
  deleteSubsection: (sheetId, sectionId, subsectionId) => api.delete(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}`),
  addProblem: (sheetId, sectionId, subsectionId, data) => api.post(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems`, data),
  updateProblem: (sheetId, sectionId, subsectionId, problemId, data) => api.put(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems/${problemId}`, data),
  updateProblemField: (sheetId, sectionId, subsectionId, problemId, data) => api.patch(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems/${problemId}`, data),
  deleteProblem: (sheetId, sectionId, subsectionId, problemId) => api.delete(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems/${problemId}`),
};

export const announcementAPI = {
  getAll: () => api.get('/announcements'),
  create: (data) => api.post('/announcements', data),
  update: (id, data) => api.put(`/announcements/${id}`, data),
  delete: (id) => api.delete(`/announcements/${id}`),
  markAsRead: (id) => api.post(`/announcements/${id}/read`),
  getReadStatus: (id) => api.get(`/announcements/${id}/read-status`),
  getUnreadCount: () => api.get('/announcements/unread-count'),
};

// Include all your other APIs (adminAPI, contentAPI, etc.) unchanged...

// ENHANCED: Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url;
    
    // Don't log suppressed 401 errors for /auth/user
    if (!(status === 401 && url?.includes('/auth/user'))) {
      console.error(`❌ API Error: ${status} ${error.config?.method?.toUpperCase()} ${url}`, 
        error.response?.data || error.message);
    }
    
    // Handle authentication errors
    if (status === 401 && !url?.includes('/auth/user')) {
      console.log('🔒 Unauthorized - clearing tokens');
      localStorage.removeItem('authToken');
      localStorage.removeItem('cachedUser');
      
      if (window.location.pathname !== '/' && window.location.pathname !== '/login') {
        window.location.href = '/';
      }
    }
    
    return Promise.reject(error);
  }
);

// Debug functions
export const testAPI = {
  healthCheck: async () => {
    try {
      const response = await api.get('/health');
      console.log('✅ Backend is reachable:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Backend test failed:', error);
      throw error;
    }
  },
  
  checkToken: () => {
    const token = localStorage.getItem('authToken');
    console.log('🔐 Token in storage:', token ? 'Present' : 'Missing');
    if (token) console.log('Token preview:', token.substring(0, 20) + '...');
    return !!token;
  }
};

export default api;
