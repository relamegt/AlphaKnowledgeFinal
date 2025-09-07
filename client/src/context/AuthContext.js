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
  const currentPollingIntervalRef = useRef(5 * 60 * 1000);
  const lastKnownUnreadCountRef = useRef(0);

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

  // FIXED: Enhanced fetchUnreadCount with proper badge logic
  const fetchUnreadCount = useCallback(async (reason = 'unknown') => {
    if (!user || !user._id) {
      setUnreadCount(0);
      return 0;
    }

    const requestKey = `unread-count-${user._id}`;
    
    if (unreadCountTracker.isRequestOngoing(requestKey)) {
      return unreadCountTracker.getOngoingRequest(requestKey);
    }

    // REDUCED: Minimum time between calls to prevent excessive requests
    const now = Date.now();
    if (lastFetchTime && (now - lastFetchTime) < 10000) { // 10 seconds instead of 30
      console.log(`⚠️ fetchUnreadCount (${reason}): Too recent, returning cached count: ${unreadCount}`);
      return unreadCount;
    }

    try {
      console.log(`🔔 fetchUnreadCount (${reason}): Making API call at:`, new Date().toLocaleTimeString());
      
      const fetchPromise = axios.get('/api/announcements', { 
        withCredentials: true 
      }).then(response => {
        const announcements = response.data.announcements || [];
        console.log(`📊 Retrieved ${announcements.length} total announcements`);
        
        // FIXED: Use Set for better performance and deduplication
        const seenIdsRaw = localStorage.getItem('seenAnnouncements');
        let seenIds = [];
        try {
          seenIds = seenIdsRaw ? JSON.parse(seenIdsRaw) : [];
          seenIds = Array.isArray(seenIds) ? seenIds : [];
        } catch (e) {
          console.warn('Invalid seenAnnouncements in localStorage, resetting');
          seenIds = [];
          localStorage.setItem('seenAnnouncements', JSON.stringify([]));
        }
        
        const seenSet = new Set(seenIds);
        console.log(`👀 User has seen ${seenSet.size} announcements`);
        
        // IMPROVED: Better filtering logic for unread announcements
        const unreadAnnouncements = announcements.filter(ann => {
          const announcementId = ann._id || ann.id;
          if (!announcementId) {
            console.log('⚠️ Announcement without ID found');
            return false;
          }
          
          // Check if already marked as read on server
          if (ann.readBy && Array.isArray(ann.readBy) && ann.readBy.includes(user._id)) {
            console.log(`✅ Server-side read: ${announcementId}`);
            return false;
          }
          
          // Check if marked as seen in localStorage
          if (seenSet.has(announcementId)) {
            console.log(`👁️ LocalStorage seen: ${announcementId}`);
            return false;
          }
          
          // Check if announcement is older than user creation (optional)
          if (user.createdAt && ann.createdAt) {
            const announcementDate = new Date(ann.createdAt);
            const userJoinDate = new Date(user.createdAt);
            if (announcementDate < userJoinDate) {
              console.log(`⏰ Announcement predates user: ${announcementId}`);
              return false;
            }
          }
          
          console.log(`🆕 Unread announcement: ${ann.title || announcementId}`);
          return true;
        });
        
        const newUnreadCount = unreadAnnouncements.length;
        console.log(`🔔 Calculated unread count: ${newUnreadCount}`);
        
        // ALWAYS update the state, even if count is the same
        setUnreadCount(newUnreadCount);
        lastKnownUnreadCountRef.current = newUnreadCount;
        
        // Update announcement count tracking
        const currentCount = announcements.length;
        const previousCount = lastAnnouncementCountRef.current;
        
        if (currentCount !== previousCount) {
          console.log(`📈 Announcement count changed ${previousCount} → ${currentCount}`);
          lastAnnouncementCountRef.current = currentCount;
        }
        
        setLastFetchTime(now);
        return newUnreadCount;
      });
      
      return unreadCountTracker.startRequest(requestKey, fetchPromise);
      
    } catch (error) {
      console.error('❌ Error fetching unread count:', error);
      if (error.response?.status === 401) {
        setUser(null);
        setUnreadCount(0);
        localStorage.removeItem('cachedUser');
      }
      return unreadCount;
    }
  }, [user, unreadCount, lastFetchTime]);

  const refreshUnreadCount = useCallback((reason = 'manual') => {
    if (!user || !user._id) {
      return;
    }
    console.log(`🔄 refreshUnreadCount (${reason}): Triggering fetch`);
    fetchUnreadCount(reason);
  }, [fetchUnreadCount, user]);

  // FIXED: Enhanced localStorage event listener for cross-tab sync
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === 'seenAnnouncements' && user && user._id) {
        console.log('🔄 localStorage seenAnnouncements changed, updating unread count');
        setTimeout(() => {
          fetchUnreadCount('storage-change');
        }, 100); // Small delay to ensure localStorage is updated
      }
    };

    // CRITICAL: Custom storage event handler for same-tab updates
    const handleCustomStorage = () => {
      if (user && user._id) {
        console.log('🔄 Custom storage event triggered');
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

  // Adaptive polling system (keep existing logic)
  useEffect(() => {
    if (user && user._id) {
      console.log('🔔 Starting unread count monitoring for user:', user.email);
      
      const minPollingInterval = 2 * 60 * 1000;  // Reduced to 2 minutes for better responsiveness
      const maxPollingInterval = 30 * 60 * 1000; // Reduced to 30 minutes max
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
          
          // Adjust polling interval based on activity
          const currentInterval = currentPollingIntervalRef.current;
          if (hasNewActivity) {
            console.log('🔔 New activity detected - resetting polling interval');
            currentPollingIntervalRef.current = minPollingInterval;
          } else {
            const newInterval = Math.min(currentInterval * 1.2, maxPollingInterval);
            currentPollingIntervalRef.current = newInterval;
          }

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
          console.log('👀 Tab visible: Fetching unread count immediately');
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
        
        // Immediate unread count fetch after login
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
      localStorage.removeItem('announcementsBadgeCleared');
    }
  }, []);

  // FIXED: Enhanced markAllAsRead with proper localStorage sync
  const markAllAsRead = useCallback(async () => {
    if (!user || !user._id) {
      return;
    }
    
    try {
      console.log('🔔 markAllAsRead: Fetching announcements');
      const response = await axios.get('/api/announcements', { 
        withCredentials: true 
      });
      const announcements = response.data.announcements || [];
      const allIds = announcements.map(ann => ann._id || ann.id).filter(Boolean);
      
      // Update localStorage with all announcement IDs
      localStorage.setItem('seenAnnouncements', JSON.stringify(allIds));
      
      // Trigger custom storage event for same-tab updates
      window.dispatchEvent(new Event('localStorageUpdated'));
      
      // Mark as read on server
      const unreadAnnouncements = announcements.filter(ann => {
        const announcementId = ann._id || ann.id;
        return announcementId && (!ann.readBy || !ann.readBy.includes(user._id));
      });

      // Mark each unread announcement as read on server
      for (const ann of unreadAnnouncements) {
        try {
          await axios.post(`/api/announcements/${ann._id || ann.id}/read`, {}, {
            withCredentials: true
          });
        } catch (error) {
          console.warn('Failed to mark announcement as read on server:', error);
        }
      }
      
      // Immediately update state
      setUnreadCount(0);
      lastKnownUnreadCountRef.current = 0;
      console.log('✅ All announcements marked as read');
      
      // Dispatch events for other components
      window.dispatchEvent(new CustomEvent('markAllAnnouncementsRead'));
      window.dispatchEvent(new CustomEvent('announcementUpdated'));
      
    } catch (error) {
      console.error('Error marking announcements as read:', error);
    }
  }, [user]);

  // FIXED: Enhanced markAnnouncementAsRead with proper sync
  const markAnnouncementAsRead = useCallback((announcementId) => {
    if (!user || !user._id || !announcementId) {
      return;
    }
    
    try {
      const seenIdsRaw = localStorage.getItem('seenAnnouncements');
      let seenIds = seenIdsRaw ? JSON.parse(seenIdsRaw) : [];
      seenIds = Array.isArray(seenIds) ? seenIds : [];
      
      if (!seenIds.includes(announcementId)) {
        const updatedSeen = [...seenIds, announcementId];
        localStorage.setItem('seenAnnouncements', JSON.stringify(updatedSeen));
        
        // Trigger custom storage event
        window.dispatchEvent(new Event('localStorageUpdated'));
        
        // Update state immediately
        setUnreadCount(prev => {
          const newCount = Math.max(0, prev - 1);
          lastKnownUnreadCountRef.current = newCount;
          console.log(`🔔 Announcement ${announcementId} marked as read, new count: ${newCount}`);
          return newCount;
        });

        // Mark as read on server (async)
        axios.post(`/api/announcements/${announcementId}/read`, {}, {
          withCredentials: true
        }).catch(error => {
          console.warn('Failed to mark announcement as read on server:', error);
        });
        
        window.dispatchEvent(new CustomEvent('announcementUpdated'));
      }
    } catch (error) {
      console.error('Error marking announcement as read:', error);
    }
  }, [user]);

  const handleNewAnnouncement = useCallback((newAnnouncementId) => {
    if (!user || !user._id) {
      return;
    }
    
    const seenIds = JSON.parse(localStorage.getItem('seenAnnouncements') || '[]');
    if (!seenIds.includes(newAnnouncementId)) {
      setUnreadCount(prev => {
        const newCount = prev + 1;
        lastKnownUnreadCountRef.current = newCount;
        console.log(`🆕 New announcement detected, badge count: ${newCount}`);
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
