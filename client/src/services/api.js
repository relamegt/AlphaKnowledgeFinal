import axios from 'axios';

// FIXED: Production-ready environment variable
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://alphaknowledgefinal-1.onrender.com';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // Increased timeout for production
});

// FIXED: Enhanced request interceptor with better token handling
api.interceptors.request.use(
  (config) => {
    // Try multiple token storage locations
    const token = localStorage.getItem('authToken') || 
                  localStorage.getItem('token') || 
                  sessionStorage.getItem('authToken');
    
    if (token) {
      // Use proper Bearer format (capital 'B')
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

// UPDATED: Auth API with proper token storage
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
      console.error('❌ Unexpected auth check error:', error.response?.status, error.message);
      return null;
    }
  },
  
  logout: async () => {
    try {
      const response = await api.post('/auth/logout');
      
      // Clear all tokens on logout
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
      sessionStorage.removeItem('authToken');
      localStorage.removeItem('cachedUser');
      
      return response.data;
    } catch (error) {
      // Clear tokens even if logout fails
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
      sessionStorage.removeItem('authToken');
      localStorage.removeItem('cachedUser');
      
      console.error('❌ Logout failed:', error);
      throw error;
    }
  },
  
  verifyGoogleToken: async (token) => {
    try {
      console.log('🔐 Verifying Google token...');
      const response = await api.post('/auth/google/verify', { token });
      
      // CRITICAL: Store the JWT token returned from backend
      if (response.data.success) {
        // Backend should return a JWT token in response
        if (response.data.token) {
          localStorage.setItem('authToken', response.data.token);
          console.log('✅ JWT token stored successfully');
        } else {
          console.warn('⚠️ No JWT token received from backend');
        }
        
        // Store user data
        if (response.data.user) {
          localStorage.setItem('cachedUser', JSON.stringify(response.data.user));
          console.log('✅ User data cached');
        }
      }
      
      return response.data;
    } catch (error) {
      console.error('❌ Token verification failed:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
  },
};

export const progressAPI = {
  getUserProgress: (userId) => api.get(`/progress/${userId}`),
  toggleProblem: (problemData) => api.post('/progress/toggle', problemData),
  getStats: (userId) => api.get(`/progress/stats/${userId}`)
};

export const sheetAPI = {
  // Sheets
  getAll: () => api.get('/sheets'),
  getById: (id) => api.get(`/sheets/${id}`),
  create: (data) => api.post('/sheets', data),
  update: (id, data) => api.put(`/sheets/${id}`, data),
  delete: (id) => api.delete(`/sheets/${id}`),

  // Sections
  addSection: (sheetId, data) => api.post(`/sheets/${sheetId}/sections`, data),
  updateSection: (sheetId, sectionId, data) => api.put(`/sheets/${sheetId}/sections/${sectionId}`, data),
  deleteSection: (sheetId, sectionId) => api.delete(`/sheets/${sheetId}/sections/${sectionId}`),

  // Subsections
  addSubsection: (sheetId, sectionId, data) => api.post(`/sheets/${sheetId}/sections/${sectionId}/subsections`, data),
  updateSubsection: (sheetId, sectionId, subsectionId, data) => api.put(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}`, data),
  deleteSubsection: (sheetId, sectionId, subsectionId) => api.delete(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}`),

  // Problems
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

export const adminAPI = {
  // User management
  getUsers: () => api.get('/admin/users'),
  updateUserRole: (userId, role) => api.put(`/admin/users/${userId}/role`, { role }),
  deleteUser: (userId) => api.delete(`/admin/users/${userId}`),
  createUser: (userData) => api.post('/admin/users', userData),
  getUserDetails: (userId) => api.get(`/admin/users/${userId}`),
  
  // System management
  getSystemStats: () => api.get('/admin/stats'),
  getAuditLogs: (page = 1, limit = 50) => api.get(`/admin/audit-logs?page=${page}&limit=${limit}`),
  
  // Bulk operations
  bulkUpdateUsers: (userUpdates) => api.put('/admin/users/bulk', { updates: userUpdates }),
  bulkDeleteUsers: (userIds) => api.delete('/admin/users/bulk', { data: { userIds } }),
  
  // Settings management
  getSettings: () => api.get('/admin/settings'),
  updateSettings: (settings) => api.put('/admin/settings', settings)
};

export const contentAPI = {
  // Editorial management
  getEditorials: () => api.get('/editorials'),
  getEditorial: (problemId) => api.get(`/editorials/${problemId}`),
  createEditorial: (problemId, data) => api.post(`/editorials/${problemId}`, data),
  updateEditorial: (problemId, data) => api.put(`/editorials/${problemId}`, data),
  deleteEditorial: (problemId) => api.delete(`/editorials/${problemId}`),
  
  // File uploads
  uploadFile: (file, type = 'general') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    return api.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  
  // Template management
  getTemplates: () => api.get('/templates'),
  createTemplate: (data) => api.post('/templates', data),
  updateTemplate: (id, data) => api.put(`/templates/${id}`, data),
  deleteTemplate: (id) => api.delete(`/templates/${id}`)
};

export const analyticsAPI = {
  getUserProgress: (userId, dateRange) => api.get(`/analytics/users/${userId}/progress?${dateRange}`),
  getSheetAnalytics: (sheetId, dateRange) => api.get(`/analytics/sheets/${sheetId}?${dateRange}`),
  getOverallStats: (dateRange) => api.get(`/analytics/overview?${dateRange}`),
  getProblemStats: (problemId) => api.get(`/analytics/problems/${problemId}`),
  getLeaderboard: (type = 'all', limit = 100) => api.get(`/analytics/leaderboard?type=${type}&limit=${limit}`),
  exportAnalytics: (type, filters) => api.post(`/analytics/export`, { type, filters })
};

export const notificationAPI = {
  getNotifications: (userId) => api.get(`/notifications/${userId}`),
  markAsRead: (notificationId) => api.put(`/notifications/${notificationId}/read`),
  markAllAsRead: (userId) => api.put(`/notifications/${userId}/read-all`),
  deleteNotification: (notificationId) => api.delete(`/notifications/${notificationId}`),
  
  // Admin notifications
  createNotification: (data) => api.post('/notifications', data),
  broadcastNotification: (data) => api.post('/notifications/broadcast', data)
};

export const searchAPI = {
  searchProblems: (query, filters = {}) => api.get(`/search/problems?q=${encodeURIComponent(query)}&${new URLSearchParams(filters)}`),
  searchSheets: (query, filters = {}) => api.get(`/search/sheets?q=${encodeURIComponent(query)}&${new URLSearchParams(filters)}`),
  searchUsers: (query, filters = {}) => api.get(`/search/users?q=${encodeURIComponent(query)}&${new URLSearchParams(filters)}`),
  globalSearch: (query) => api.get(`/search/global?q=${encodeURIComponent(query)}`)
};

// ENHANCED: Response interceptor with better error handling
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url;
    const method = error.config?.method?.toUpperCase();
    
    // Don't log suppressed 401 errors for /auth/user
    if (!(status === 401 && url?.includes('/auth/user'))) {
      console.error(`❌ API Error: ${status} ${method} ${url}`, error.response?.data || error.message);
    }
    
    // Handle authentication errors
    if (status === 401 && !url?.includes('/auth/user')) {
      console.log('🔒 Unauthorized access - clearing tokens');
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
      localStorage.removeItem('cachedUser');
      
      // Redirect to home page
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
      console.log('🩺 Testing backend connectivity...');
      console.log('🔗 Backend URL:', API_BASE_URL);
      const response = await api.get('/health');
      console.log('✅ Backend is reachable:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Backend connectivity test failed:', error);
      throw error;
    }
  },
  
  testAuthHealth: async () => {
    try {
      console.log('🩺 Testing auth routes...');
      const response = await api.get('/auth/health');
      console.log('✅ Auth routes are working:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Auth routes test failed:', error);
      throw error;
    }
  },

  // NEW: Check if token is being sent
  checkToken: () => {
    const token = localStorage.getItem('authToken');
    console.log('🔐 Current token in storage:', token ? 'Present' : 'Missing');
    return token;
  }
};

export default api;
