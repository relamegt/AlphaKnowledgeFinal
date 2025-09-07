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
  
  // Refs for stable references
  const pollingIntervalRef = useRef(null);
  const broadcastChannelRef = useRef(null);
  const lastFetchTimeRef = useRef(null);
  const isFetchingRef = useRef(false);

  // Create authenticated axios instance
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

  // FIXED: Stable fetchUnreadCount without dependencies that cause loops
  const fetchUnreadCount = useCallback(async (reason = 'unknown', skipThrottle = false) => {
    // Get current user from state
    const currentUser = user;
    if (!currentUser || !currentUser._id) {
      setUnreadCount(0);
      return 0;
    }

    // Prevent overlapping requests
    if (isFetchingRef.current) {
      console.log(`⚠️ fetchUnreadCount (${reason}): Already fetching, skipping`);
      return;
    }

    const requestKey = `unread-count-${currentUser._id}`;
    
    if (unreadCountTracker.isRequestOngoing(requestKey)) {
      return unreadCountTracker.getOngoingRequest(requestKey);
    }

    // Throttling only for polling, not for events
    const now = Date.now();
    if (!skipThrottle && lastFetchTimeRef.current && (now - lastFetchTimeRef.current) < 30000) {
      console.log(`⚠️ fetchUnreadCount (${reason}): Throttled`);
      return;
    }

    try {
      console.log(`🔔 fetchUnreadCount (${reason}): Making API call`);
      isFetchingRef.current = true;
      
      const authenticatedAxios = createAuthenticatedAxios();
      
      const fetchPromise = authenticatedAxios.get('/api/announcements').then(response => {
        const announcements = response.data.announcements || [];
        console.log(`📊 Retrieved ${announcements.length} total announcements`);
        
        // Get seen announcements from localStorage
        let seenIds = [];
        try {
          const seenIdsRaw = localStorage.getItem('seenAnnouncements');
          seenIds = seenIdsRaw ? JSON.parse(seenIdsRaw) : [];
          seenIds = Array.isArray(seenIds) ? seenIds : [];
        } catch (e) {
          seenIds = [];
          localStorage.setItem('seenAnnouncements', JSON.stringify([]));
        }
        
        const seenSet = new Set(seenIds);
        
        // Calculate unread announcements
        const unreadAnnouncements = announcements.filter(ann => {
          const announcementId = ann._id || ann.id;
          if (!announcementId) return false;
          
          // Check server-side readBy
          if (ann.readBy && Array.isArray(ann.readBy) && ann.readBy.includes(currentUser._id)) {
            return false;
          }
          
          // Check localStorage seen
          if (seenSet.has(announcementId)) {
            return false;
          }
          
          // Check creation date vs user join date
          if (currentUser.createdAt && ann.createdAt) {
            const announcementDate = new Date(ann.createdAt);
            const userJoinDate = new Date(currentUser.createdAt);
            if (announcementDate < userJoinDate) return false;
          }
          
          return true;
        });
        
        const newUnreadCount = unreadAnnouncements.length;
        console.log(`🔔 Calculated unread count: ${newUnreadCount}`);
        
        // Update state
        setUnreadCount(newUnreadCount);
        lastFetchTimeRef.current = now;
        
        return newUnreadCount;
      }).finally(() => {
        isFetchingRef.current = false;
      });
      
      return unreadCountTracker.startRequest(requestKey, fetchPromise);
      
    } catch (error) {
      console.error('❌ Error fetching unread count:', error);
      isFetchingRef.current = false;
      if (error.response?.status === 401) {
        setUser(null);
        setUnreadCount(0);
        localStorage.removeItem('cachedUser');
        localStorage.removeItem('authToken');
      }
      return 0;
    }
  }, [user, createAuthenticatedAxios]);

  // FIXED: Single useEffect with stable dependencies
  useEffect(() => {
    if (!user || !user._id) {
      setUnreadCount(0);
      return;
    }

    console.log('🔔 Setting up badge system for user:', user.email);
    
    // Setup BroadcastChannel for cross-tab communication
    broadcastChannelRef.current = new BroadcastChannel('announcements');
    
    const handleBroadcast = (event) => {
      console.log('📡 BroadcastChannel message:', event.data);
      
      if (event.data.type === 'new-announcement') {
        console.log('🆕 New announcement broadcast - updating badge');
        fetchUnreadCount('broadcast-new', true);
      } else if (event.data.type === 'mark-read') {
        console.log('✅ Mark read broadcast - updating badge');
        fetchUnreadCount('broadcast-read', true);
      }
    };
    
    broadcastChannelRef.current.addEventListener('message', handleBroadcast);
    
    // Initial fetch
    fetchUnreadCount('user-login', true);
    
    // Setup polling with longer intervals - ONLY as fallback
    const startPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      pollingIntervalRef.current = setInterval(() => {
        if (!document.hidden && user && user._id) {
          console.log('🕰️ Fallback polling check');
          fetchUnreadCount('fallback-polling');
        }
      }, 5 * 60 * 1000); // 5 minutes instead of 10
      
      console.log('🔔 Started fallback polling every 5 minutes');
    };
    
    startPolling();
    
    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (!document.hidden && user && user._id) {
        console.log('👀 Tab visible: Fetching immediately');
        fetchUnreadCount('tab-visible', true);
      }
    };
    
    // Handle storage changes (cross-tab sync)
    const handleStorageChange = (event) => {
      if (event.key === 'seenAnnouncements') {
        console.log('📡 localStorage changed in another tab');
        fetchUnreadCount('storage-change', true);
      }
    };

    // Handle custom storage events (same-tab sync)
    const handleCustomStorage = () => {
      console.log('🔄 Same-tab localStorage update');
      fetchUnreadCount('custom-storage', true);
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('localStorageUpdated', handleCustomStorage);
    
    return () => {
      console.log('🔔 Cleaning up badge system');
      
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.removeEventListener('message', handleBroadcast);
        broadcastChannelRef.current.close();
      }
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('localStorageUpdated', handleCustomStorage);
    };
  }, [user?.email]); // ONLY depend on user.email, not the entire user object or fetchUnreadCount

  // Utility function to broadcast announcement events
  const broadcastAnnouncementEvent = useCallback((type, data = {}) => {
    if (broadcastChannelRef.current) {
      console.log(`📡 Broadcasting ${type} event`);
      broadcastChannelRef.current.postMessage({ 
        type, 
        data,
        timestamp: Date.now() 
      });
    }
    
    window.dispatchEvent(new CustomEvent('announcementUpdated', { 
      detail: { type, data } 
    }));
  }, []);

  const refreshUnreadCount = useCallback((reason = 'manual') => {
    if (!user || !user._id) return;
    console.log(`🔄 refreshUnreadCount (${reason}): Triggering immediate fetch`);
    fetchUnreadCount(reason, true);
  }, [user, fetchUnreadCount]);

  // Login with Google JWT token
  const loginWithToken = useCallback(async (googleToken) => {
    try {
      const response = await authAPI.verifyGoogleToken(googleToken);
      const userData = response.user || response.data?.user || null;
      
      if (userData) {
        setUser(userData);
        localStorage.setItem('cachedUser', JSON.stringify(userData));
        return userData;
      } else {
        throw new Error('No user data received');
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setUnreadCount(0);
      lastFetchTimeRef.current = null;
      localStorage.removeItem('cachedUser');
      localStorage.removeItem('seenAnnouncements');
      localStorage.removeItem('authToken');
    }
  }, []);

  // markAllAsRead with immediate broadcast
  const markAllAsRead = useCallback(async () => {
    if (!user || !user._id) return;
    
    try {
      console.log('🔔 markAllAsRead: Processing');
      const authenticatedAxios = createAuthenticatedAxios();
      const response = await authenticatedAxios.get('/api/announcements');
      
      const announcements = response.data.announcements || [];
      const allIds = announcements.map(ann => ann._id || ann.id).filter(Boolean);
      
      // Update localStorage
      localStorage.setItem('seenAnnouncements', JSON.stringify(allIds));
      
      // Immediate local update
      setUnreadCount(0);
      
      // Broadcast to other tabs
      broadcastAnnouncementEvent('mark-read', { 
        action: 'mark-all', 
        announcementIds: allIds 
      });
      
      // Dispatch custom storage event
      window.dispatchEvent(new Event('localStorageUpdated'));
      
      // Server updates (async)
      const unreadAnnouncements = announcements.filter(ann => {
        const announcementId = ann._id || ann.id;
        return announcementId && (!ann.readBy || !ann.readBy.includes(user._id));
      });

      Promise.all(
        unreadAnnouncements.map(ann => 
          authenticatedAxios.post(`/api/announcements/${ann._id || ann.id}/read`, {})
            .catch(error => console.warn('Failed to mark as read on server:', error))
        )
      );
      
      console.log('✅ All announcements marked as read');
      
    } catch (error) {
      console.error('Error marking announcements as read:', error);
    }
  }, [user, createAuthenticatedAxios, broadcastAnnouncementEvent]);

  // markAnnouncementAsRead with immediate broadcast
  const markAnnouncementAsRead = useCallback((announcementId) => {
    if (!user || !user._id || !announcementId) return;
    
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
        
        // Immediate local update
        setUnreadCount(prev => {
          const newCount = Math.max(0, prev - 1);
          console.log(`🔔 Immediate update: ${announcementId} read, count: ${newCount}`);
          return newCount;
        });
        
        // Broadcast to other tabs
        broadcastAnnouncementEvent('mark-read', { 
          action: 'mark-single', 
          announcementId 
        });
        
        // Dispatch custom storage event
        window.dispatchEvent(new Event('localStorageUpdated'));

        // Server update (async)
        const authenticatedAxios = createAuthenticatedAxios();
        authenticatedAxios.post(`/api/announcements/${announcementId}/read`, {})
          .catch(error => console.warn('Failed to mark as read on server:', error));
      }
    } catch (error) {
      console.error('Error marking announcement as read:', error);
    }
  }, [user, createAuthenticatedAxios, broadcastAnnouncementEvent]);

  // handleNewAnnouncement with immediate broadcast
  const handleNewAnnouncement = useCallback((newAnnouncementId) => {
    if (!user || !user._id) return;
    
    console.log(`🆕 New announcement: ${newAnnouncementId} - updating badge immediately`);
    
    const seenIds = JSON.parse(localStorage.getItem('seenAnnouncements') || '[]');
    if (!seenIds.includes(newAnnouncementId)) {
      // Immediate local update
      setUnreadCount(prev => {
        const newCount = prev + 1;
        console.log(`🔔 Immediate badge update: count ${newCount}`);
        return newCount;
      });
      
      // Broadcast to other tabs
      broadcastAnnouncementEvent('new-announcement', { 
        announcementId: newAnnouncementId 
      });
    }
  }, [user, broadcastAnnouncementEvent]);

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
    broadcastAnnouncementEvent,
    isAdmin,
    isMentor,
    isStudent,
    canManageAnnouncements,
    canAddEditorials,
    canManageUsers,
    canManageSheets,
    canAddProblems
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
    broadcastAnnouncementEvent,
    isAdmin,
    isMentor,
    isStudent,
    canManageAnnouncements,
    canAddEditorials,
    canManageUsers,
    canManageSheets,
    canAddProblems
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
