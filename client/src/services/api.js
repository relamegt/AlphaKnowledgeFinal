import axios from 'axios';


// FIXED: Use consistent environment variable name
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';


const api = axios.create({
  baseURL: `${API_BASE_URL}/api`, // This creates the /api prefix
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // Add timeout
});


// FIXED: Auth API with better error handling
export const authAPI = {
  getCurrentUser: async () => {
    try {
      // console.log('🔍 API: Getting current user from /api/auth/user');
      const response = await api.get('/auth/user');
      return response.data;
    } catch (error) {
      // console.log('❌ Auth check failed:', error.response?.status, error.message);
      return null;
    }
  },
  logout: async () => {
    try {
      // console.log('🔍 API: Logging out via /api/auth/logout');
      const response = await api.post('/auth/logout');
      return response.data;
    } catch (error) {
      // console.error('❌ Logout failed:', error);
      throw error;
    }
  },
  verifyGoogleToken: async (token) => {
    try {
      // console.log('🔍 API: Verifying Google token via /api/auth/google/verify');
      // console.log('🔗 Full URL:', `${API_BASE_URL}/api/auth/google/verify`);
      const response = await api.post('/auth/google/verify', { token });
      // console.log('✅ API: Token verification successful');
      return response.data;
    } catch (error) {
      // console.error('❌ API: Token verification failed:', error.response?.status, error.response?.data || error.message);
      throw error;
    }
  },
};


// FIXED: Progress API
export const progressAPI = {
  getUserProgress: (userId) => {
    // console.log('🔍 API: Getting user progress for', userId);
    return api.get(`/progress/${userId}`);
  },
  toggleProblem: (problemData) => {
    // console.log('🔍 API: Toggling problem:', problemData);
    return api.post('/progress/toggle', problemData);
  },
  getStats: (userId) => {
    // console.log('🔍 API: Getting stats for user', userId);
    return api.get(`/progress/stats/${userId}`);
  }
};


// FIXED: Remove duplicate and conflicting interceptors
// Request interceptor for auth token
api.interceptors.request.use(
  (config) => {
    // console.log(`📤 API Request: ${config.method?.toUpperCase()} ${config.url}`);
    
    // Add auth token if available
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    // console.error('❌ Request interceptor error:', error);
    return Promise.reject(error);
  }
);


export const sheetAPI = {
  // Sheets
  getAll: () => api.get('/sheets'),
  getById: (id) => api.get(`/sheets/${id}`),
  create: (data) => api.post('/sheets', data),
  update: (id, data) => api.put(`/sheets/${id}`, data),
  delete: (id) => api.delete(`/sheets/${id}`),


  // Sections
  addSection: (sheetId, data) => {
    // console.log('🔍 API: Adding section to sheet', sheetId, 'with data:', data);
    return api.post(`/sheets/${sheetId}/sections`, data);
  },
  updateSection: (sheetId, sectionId, data) => {
    // console.log('🔍 API: Updating section', sectionId, 'with data:', data);
    return api.put(`/sheets/${sheetId}/sections/${sectionId}`, data);
  },
  deleteSection: (sheetId, sectionId) => {
    // console.log('🔍 API: Deleting section', sectionId, 'from sheet', sheetId);
    return api.delete(`/sheets/${sheetId}/sections/${sectionId}`);
  },


  // Subsections
  addSubsection: (sheetId, sectionId, data) => {
    // console.log('🔍 API: Adding subsection to sheet', sheetId, 'section', sectionId, 'with data:', data);
    return api.post(`/sheets/${sheetId}/sections/${sectionId}/subsections`, data);
  },
  updateSubsection: (sheetId, sectionId, subsectionId, data) => {
    // console.log('🔍 API: Updating subsection', subsectionId, 'with data:', data);
    return api.put(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}`, data);
  },
  deleteSubsection: (sheetId, sectionId, subsectionId) => {
    // console.log('🔍 API: Deleting subsection', subsectionId);
    return api.delete(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}`);
  },


  // Problems
  addProblem: (sheetId, sectionId, subsectionId, data) => {
    // console.log('🔍 API: Adding problem to sheet', sheetId, 'section', sectionId, 'subsection', subsectionId, 'with data:', data);
    return api.post(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems`, data);
  },
  updateProblem: (sheetId, sectionId, subsectionId, problemId, data) => {
    return api.put(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems/${problemId}`, data);
  },
  updateProblemField: (sheetId, sectionId, subsectionId, problemId, data) => {
    // console.log('🔍 API: Updating problem field', problemId, 'with data:', data);
    return api.patch(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems/${problemId}`, data);
  },
  deleteProblem: (sheetId, sectionId, subsectionId, problemId) => {
    return api.delete(`/sheets/${sheetId}/sections/${sectionId}/subsections/${subsectionId}/problems/${problemId}`);
  },
};


// FIXED: Announcement API with better logging
export const announcementAPI = {
  getAll: () => {
    // console.log('🔍 API: Fetching all announcements with read status from /api/announcements');
    return api.get('/announcements');
  },
  create: (data) => {
    // console.log('🔍 API: Creating announcement with data:', data);
    return api.post('/announcements', data);
  },
  update: (id, data) => {
    // console.log('🔍 API: Updating announcement', id, 'with data:', data);
    return api.put(`/announcements/${id}`, data);
  },
  delete: (id) => {
    // console.log('🔍 API: Deleting announcement', id, 'via DELETE /api/announcements/' + id);
    return api.delete(`/announcements/${id}`);
  },
  markAsRead: (id) => {
    // console.log('🔍 API: Marking announcement as read:', id);
    return api.post(`/announcements/${id}/read`);
  },
  getReadStatus: (id) => {
    // console.log('🔍 API: Getting read status for announcement:', id);
    return api.get(`/announcements/${id}/read-status`);
  },
  getUnreadCount: () => {
    // console.log('🔍 API: Getting unread count');
    return api.get('/announcements/unread-count');
  },
};


// FIXED: Admin APIs
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


// Content management APIs
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


// Analytics and reporting APIs
export const analyticsAPI = {
  getUserProgress: (userId, dateRange) => api.get(`/analytics/users/${userId}/progress?${dateRange}`),
  getSheetAnalytics: (sheetId, dateRange) => api.get(`/analytics/sheets/${sheetId}?${dateRange}`),
  getOverallStats: (dateRange) => api.get(`/analytics/overview?${dateRange}`),
  getProblemStats: (problemId) => api.get(`/analytics/problems/${problemId}`),
  getLeaderboard: (type = 'all', limit = 100) => api.get(`/analytics/leaderboard?type=${type}&limit=${limit}`),
  exportAnalytics: (type, filters) => api.post(`/analytics/export`, { type, filters })
};


// Notification APIs
export const notificationAPI = {
  getNotifications: (userId) => api.get(`/notifications/${userId}`),
  markAsRead: (notificationId) => api.put(`/notifications/${notificationId}/read`),
  markAllAsRead: (userId) => api.put(`/notifications/${userId}/read-all`),
  deleteNotification: (notificationId) => api.delete(`/notifications/${notificationId}`),
  
  // Admin notifications
  createNotification: (data) => api.post('/notifications', data),
  broadcastNotification: (data) => api.post('/notifications/broadcast', data)
};


// Search APIs
export const searchAPI = {
  searchProblems: (query, filters = {}) => api.get(`/search/problems?q=${encodeURIComponent(query)}&${new URLSearchParams(filters)}`),
  searchSheets: (query, filters = {}) => api.get(`/search/sheets?q=${encodeURIComponent(query)}&${new URLSearchParams(filters)}`),
  searchUsers: (query, filters = {}) => api.get(`/search/users?q=${encodeURIComponent(query)}&${new URLSearchParams(filters)}`),
  globalSearch: (query) => api.get(`/search/global?q=${encodeURIComponent(query)}`)
};


// FIXED: Response interceptor - single instance only
api.interceptors.response.use(
  (response) => {
    // console.log(`✅ API Response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
    return response;
  },
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url;
    const method = error.config?.method?.toUpperCase();
    
    // console.error(`❌ API Error: ${status} ${method} ${url}`, error.response?.data || error.message);
    
    // Handle common errors
    if (status === 401) {
      // console.log('🔒 Unauthorized access - clearing tokens');
      localStorage.removeItem('authToken');
      localStorage.removeItem('token');
      // Only redirect if not already on login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (status === 404) {
      // console.error(`🔍 Route not found: ${method} ${url}`);
    } else if (status >= 500) {
      // console.error('🚨 Server error:', error.response?.data);
    }
    
    return Promise.reject(error);
  }
);


// DEBUGGING: Add a test function to check if backend is reachable
export const testAPI = {
  healthCheck: async () => {
    try {
      // console.log('🩺 API: Testing backend connectivity');
      // console.log('🔗 Testing URL:', `${API_BASE_URL}/api/health`);
      const response = await api.get('/health');
      // console.log('✅ Backend is reachable:', response.data);
      return response.data;
    } catch (error) {
      // console.error('❌ Backend connectivity test failed:', error);
      throw error;
    }
  },
  testAuthHealth: async () => {
    try {
      // console.log('🩺 API: Testing auth routes');
      // console.log('🔗 Testing URL:', `${API_BASE_URL}/api/auth/health`);
      const response = await api.get('/auth/health');
      // console.log('✅ Auth routes are working:', response.data);
      return response.data;
    } catch (error) {
      // console.error('❌ Auth routes test failed:', error);
      throw error;
    }
  }
};


export default api;
