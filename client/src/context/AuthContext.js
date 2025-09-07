import React, { createContext, useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react';
import { authAPI } from '../services/api';
import axios from 'axios';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Global unread count tracker to prevent duplicate requests
const unreadCountTracker = {
  ongoing: new Map(),
  
  isRequestOngoing(key) {
    return this.ongoing.has(key);
  },
  
  startRequest(key, promise) {
    this.ongoing.set(key, promise);
    promise.finally(() => {
      this.ongoing.delete(key);
    });
    return promise;
  },
  
  getOngoingRequest(key) {
    return this.ongoing.get(key);
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  
  // Refs for adaptive polling
  const lastAnnouncementCountRef = useRef(0);
  const pollingIntervalRef = useRef(null);
  const currentPollingIntervalRef = useRef(2 * 60 * 1000); // Reduced to 2 minutes
  const lastKnownUnreadCountRef = useRef(0);

  // FIXED: Create axios instance with token support for production
  const createAuthenticatedAxios = useCallback(() => {
    const token = localStorage.getItem('authToken');
    
    return axios.create({
      baseURL: process.env.REACT_APP_API_BASE_URL || 'https://alphaknowledgefinal-1.onrender.com',
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      },
      timeout: 30000
    });
  }, []);

  // Check auth status on mount
  useEffect(() => {
    let mounted = true;
    
    const checkAuthStatus = async () => {
      try {
        const cachedUser = localStorage.getItem('cachedUser');
        if (cachedUser && mounted) {
          const parsedUser = JSON.parse(cachedUser);
          setUser(parsedUser);
          setLoading(false);
        }

        const response = await authAPI.getCurrentUser();
        
        if (mounted && response) {
          const userData = response.user || response.data?.user || null;
          
          if (userData) {
            setUser(userData);
            localStorage.setItem('cachedUser', JSON.stringify(userData));
          } else {
            setUser(null);
            localStorage.removeItem('cachedUser');
          }
        }
      } catch (error) {
        if (mounted) {
          setUser(null);
          localStorage.removeItem('cachedUser');
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setInitialized(true);
        }
      }
    };

    checkAuthStatus();
    
    return () => { mounted = false; };
  }, []);

  // FIXED: Enhanced fetchUnreadCount with proper token authentication
  const fetchUnreadCount = useCallback(async (reason = 'unknown') => {
    if (!user || !user._id) {
      setUnreadCount(0);
      return 0;
    }

    const requestKey = `unread-count-${user._id}`;
    
    if (unreadCountTracker.isRequestOngoing(requestKey)) {
      return unreadCountTracker.getOngoingRequest(requestKey);
    }

    // Reduced throttling for better responsiveness
    const now = Date.now();
    if (lastFetchTime && (now - lastFetchTime) < 10000) { // 10 seconds
      console.log(`⚠️ fetchUnreadCount (${reason}): Too recent, returning cached: ${unreadCount}`);
      return unreadCount;
    }

    try {
      console.log(`🔔 fetchUnreadCount (${reason}): Making API call with token`);
      
      // CRITICAL: Use authenticated axios instance
      const authenticatedAxios = createAuthenticatedAxios();
      
      const fetchPromise = authenticatedAxios.get('/api/announcements').then(response => {
        const announcements = response.data.announcements || [];
        console.log(`📊 Retrieved ${announcements.length} total announcements`);
        
        // Better localStorage handling
        let seenIds = [];
        try {
          const seenIdsRaw = localStorage.getItem('seenAnnouncements');
          seenIds = seenIdsRaw ? JSON.parse(seenIdsRaw) : [];
          seenIds = Array.isArray(seenIds) ? seenIds : [];
        } catch (e) {
          console.warn('Invalid seenAnnouncements in localStorage, resetting');
          seenIds = [];
          localStorage.setItem('seenAnnouncements', JSON.stringify([]));
        }
        
        const seenSet = new Set(seenIds);
        console.log(`👀 User has seen ${seenSet.size} announcements`);
        
        // Enhanced filtering logic
        const unreadAnnouncements = announcements.filter(ann => {
          const announcementId = ann._id || ann.id;
          if (!announcementId) return false;
          
          // Check server-side readBy
          if (ann.readBy && Array.isArray(ann.readBy) && ann.readBy.includes(user._id)) {
            return false;
          }
          
          // Check localStorage seen
          if (seenSet.has(announcementId)) {
            return false;
          }
          
          // Check creation date vs user join date
          if (user.createdAt && ann.createdAt) {
            const announcementDate = new Date(ann.createdAt);
            const userJoinDate = new Date(user.createdAt);
            if (announcementDate < userJoinDate) return false;
          }
          
          return true;
        });
        
        const newUnreadCount = unreadAnnouncements.length;
        console.log(`🔔 Calculated unread count: ${newUnreadCount}`);
        
        // ALWAYS update state to trigger re-render
        setUnreadCount(newUnreadCount);
        lastKnownUnreadCountRef.current = newUnreadCount;
        
        // Update tracking
        lastAnnouncementCountRef.current = announcements.length;
        setLastFetchTime(now);
        
        return newUnreadCount;
      });
      
      return unreadCountTracker.startRequest(requestKey, fetchPromise);
      
    } catch (error) {
      console.error('❌ Error fetching unread count:', error);
      if (error.response?.status === 401) {
        console.log('🔒 Unauthorized - clearing tokens');
        setUser(null);
        setUnreadCount(0);
        localStorage.removeItem('cachedUser');
        localStorage.removeItem('authToken');
      }
      return unreadCount;
    }
  }, [user, unreadCount, lastFetchTime, createAuthenticatedAxios]);

  const refreshUnreadCount = useCallback((reason = 'manual') => {
    if (!user || !user._id) {
      return;
    }
    console.log(`🔄 refreshUnreadCount (${reason}): Triggering fetch`);
    fetchUnreadCount(reason);
  }, [fetchUnreadCount, user]);

  // ENHANCED: Storage event listener for cross-tab synchronization
  useEffect(() => {
    // Handle cross-tab localStorage changes
    const handleStorageChange = (event) => {
      if (event.key === 'seenAnnouncements' && user && user._id) {
        console.log('📡 Cross-tab seenAnnouncements change detected');
        setTimeout(() => fetchUnreadCount('storage-change'), 100);
      }
    };

    // Handle same-tab localStorage changes
    const handleCustomStorage = () => {
      if (user && user._id) {
        console.log('🔄 Same-tab storage update detected');
        fetchUnreadCount('custom-storage');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageUpdated', handleCustomStorage);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageUpdated', handleCustomStorage);
    };
  }, [user, fetchUnreadCount]);

  // Enhanced polling system with reduced intervals
  useEffect(() => {
    if (user && user._id) {
      console.log('🔔 Starting unread count monitoring for user:', user.email);
      
      const minPollingInterval = 2 * 60 * 1000;  // 2 minutes
      const maxPollingInterval = 15 * 60 * 1000; // 15 minutes max
      currentPollingIntervalRef.current = minPollingInterval;
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      const pollHandler = async () => {
        if (!user || !user._id) return;
        
        try {
          const currentUnreadCount = await fetchUnreadCount('polling');
          const lastKnownCount = lastKnownUnreadCountRef.current;
          
          const hasNewActivity = currentUnreadCount !== lastKnownCount;
          lastKnownUnreadCountRef.current = currentUnreadCount;
          
          // Adjust polling based on activity
          if (hasNewActivity) {
            console.log('🔔 Activity detected - resetting polling interval');
            currentPollingIntervalRef.current = minPollingInterval;
          } else {
            const newInterval = Math.min(currentPollingIntervalRef.current * 1.2, maxPollingInterval);
            currentPollingIntervalRef.current = newInterval;
          }

          // Restart with new interval
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
          }
          pollingIntervalRef.current = setInterval(pollHandler, currentPollingIntervalRef.current);
          
        } catch (error) {
          console.error('❌ Polling error:', error);
        }
      };

      // Initial fetch and start polling
      fetchUnreadCount('initial').then(initialCount => {
        lastKnownUnreadCountRef.current = initialCount;
        pollingIntervalRef.current = setInterval(pollHandler, currentPollingIntervalRef.current);
        console.log(`🔔 Started polling every ${currentPollingIntervalRef.current / (60 * 1000)} minutes`);
      });

      // Visibility change handler
      const handleVisibilityChange = () => {
        if (!document.hidden && user && user._id) {
          console.log('👀 Tab visible: Fetching immediately');
          currentPollingIntervalRef.current = minPollingInterval;
          fetchUnreadCount('tab-visible');
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    } else {
      setUnreadCount(0);
      lastAnnouncementCountRef.current = 0;
      lastKnownUnreadCountRef.current = 0;
    }
  }, [user, fetchUnreadCount]);

  // Login with Google JWT token
  const loginWithToken = useCallback(async (googleToken) => {
    try {
      const response = await authAPI.verifyGoogleToken(googleToken);
      const userData = response.user || response.data?.user || null;
      
      if (userData) {
        setUser(userData);
        localStorage.setItem('cachedUser', JSON.stringify(userData));
        
        // Immediate fetch after login
        setTimeout(() => {
          fetchUnreadCount('login');
        }, 500);
        
        return userData;
      } else {
        throw new Error('No user data received');
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      throw error;
    }
  }, [fetchUnreadCount]);

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setUnreadCount(0);
      setLastFetchTime(null);
      lastAnnouncementCountRef.current = 0;
      lastKnownUnreadCountRef.current = 0;
      localStorage.removeItem('cachedUser');
      localStorage.removeItem('seenAnnouncements');
      localStorage.removeItem('authToken'); // Clear auth token
    }
  }, []);

  // FIXED: Enhanced markAllAsRead with authenticated requests
  const markAllAsRead = useCallback(async () => {
    if (!user || !user._id) {
      return;
    }
    
    try {
      console.log('🔔 markAllAsRead: Fetching announcements with token');
      const authenticatedAxios = createAuthenticatedAxios();
      const response = await authenticatedAxios.get('/api/announcements');
      
      const announcements = response.data.announcements || [];
      const allIds = announcements.map(ann => ann._id || ann.id).filter(Boolean);
      
      // Update localStorage
      localStorage.setItem('seenAnnouncements', JSON.stringify(allIds));
      
      // Dispatch custom event for same-tab sync
      window.dispatchEvent(new Event('localStorageUpdated'));
      
      // Mark as read on server
      const unreadAnnouncements = announcements.filter(ann => {
        const announcementId = ann._id || ann.id;
        return announcementId && (!ann.readBy || !ann.readBy.includes(user._id));
      });

      for (const ann of unreadAnnouncements) {
        try {
          await authenticatedAxios.post(`/api/announcements/${ann._id || ann.id}/read`, {});
        } catch (error) {
          console.warn('Failed to mark announcement as read on server:', error);
        }
      }
      
      // Immediate state update
      setUnreadCount(0);
      lastKnownUnreadCountRef.current = 0;
      console.log('✅ All announcements marked as read');
      
      window.dispatchEvent(new CustomEvent('markAllAnnouncementsRead'));
      window.dispatchEvent(new CustomEvent('announcementUpdated'));
      
    } catch (error) {
      console.error('Error marking announcements as read:', error);
    }
  }, [user, createAuthenticatedAxios]);

  // FIXED: Enhanced markAnnouncementAsRead with authenticated requests
  const markAnnouncementAsRead = useCallback((announcementId) => {
    if (!user || !user._id || !announcementId) {
      return;
    }
    
    try {
      let seenIds = [];
      try {
        const seenIdsRaw = localStorage.getItem('seenAnnouncements');
        seenIds = seenIdsRaw ? JSON.parse(seenIdsRaw) : [];
        seenIds = Array.isArray(seenIds) ? seenIds : [];
      } catch (e) {
        seenIds = [];
      }
      
      if (!seenIds.includes(announcementId)) {
        const updatedSeen = [...new Set([...seenIds, announcementId])];
        localStorage.setItem('seenAnnouncements', JSON.stringify(updatedSeen));
        
        // Dispatch custom event for same-tab sync
        window.dispatchEvent(new Event('localStorageUpdated'));
        
        // Immediate state update
        setUnreadCount(prev => {
          const newCount = Math.max(0, prev - 1);
          lastKnownUnreadCountRef.current = newCount;
          console.log(`🔔 Marked as read: ${announcementId}, new count: ${newCount}`);
          return newCount;
        });

        // Server update with authentication
        const authenticatedAxios = createAuthenticatedAxios();
        authenticatedAxios.post(`/api/announcements/${announcementId}/read`, {}).catch(error => {
          console.warn('Failed to mark announcement as read on server:', error);
        });
        
        window.dispatchEvent(new CustomEvent('announcementUpdated'));
      }
    } catch (error) {
      console.error('Error marking announcement as read:', error);
    }
  }, [user, createAuthenticatedAxios]);

  const handleNewAnnouncement = useCallback((newAnnouncementId) => {
    if (!user || !user._id) {
      return;
    }
    
    const seenIds = JSON.parse(localStorage.getItem('seenAnnouncements') || '[]');
    if (!seenIds.includes(newAnnouncementId)) {
      setUnreadCount(prev => {
        const newCount = prev + 1;
        lastKnownUnreadCountRef.current = newCount;
        console.log(`🆕 New announcement: ${newAnnouncementId}, count: ${newCount}`);
        return newCount;
      });
      
      window.dispatchEvent(new CustomEvent('announcementUpdated'));
    }
  }, [user]);

  // Role-based permissions
  const isAdmin = user?.role === 'admin';
  const isMentor = user?.role === 'mentor';
  const isStudent = user?.role === 'student';
  const canManageAnnouncements = isAdmin;
  const canAddEditorials = isAdmin || isMentor;
  const canManageUsers = isAdmin;
  const canManageSheets = isAdmin;
  const canAddProblems = isAdmin;
  
  const value = useMemo(() => ({
    user,
    loginWithToken,
    logout,
    loading,
    initialized,
    unreadCount,
    markAllAsRead,
    refreshUnreadCount,
    handleNewAnnouncement,
    markAnnouncementAsRead,
    isAdmin,
    isMentor,
    isStudent,
    canManageAnnouncements,
    canAddEditorials,
    canManageUsers,
    canManageSheets,
    canAddProblems,
    lastFetchTime
  }), [
    user, 
    loginWithToken, 
    logout, 
    loading, 
    initialized, 
    unreadCount, 
    markAllAsRead, 
    refreshUnreadCount,
    handleNewAnnouncement,
    markAnnouncementAsRead,
    isAdmin,
    isMentor,
    isStudent,
    canManageAnnouncements,
    canAddEditorials,
    canManageUsers,
    canManageSheets,
    canAddProblems,
    lastFetchTime
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
