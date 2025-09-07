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
  
  // ADDED: Refs for adaptive polling
  const lastAnnouncementCountRef = useRef(0);
  const pollingIntervalRef = useRef(null);
  const currentPollingIntervalRef = useRef(5 * 60 * 1000); // Start with 5 minutes
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

  // UPDATED: Smart fetch with return value for adaptive polling
  const fetchUnreadCount = useCallback(async (reason = 'unknown') => {
    if (!user || !user._id) {
      // console.log('🔔 fetchUnreadCount: No user logged in, skipping API call');
      setUnreadCount(0);
      return 0;
    }

    const requestKey = `unread-count-${user._id}`;
    
    if (unreadCountTracker.isRequestOngoing(requestKey)) {
      // console.log(`🔔 fetchUnreadCount (${reason}): Request already in progress, reusing`);
      return unreadCountTracker.getOngoingRequest(requestKey);
    }

    // Check timing to prevent excessive calls (minimum 30 seconds between calls)
    const now = Date.now();
    if (lastFetchTime && (now - lastFetchTime) < 30000) {
      // console.log(`🔔 fetchUnreadCount (${reason}): Too recent (${Math.floor((now - lastFetchTime) / 1000)}s ago), skipping`);
      return unreadCount; // Return current count
    }

    try {
      // console.log(`🔔 fetchUnreadCount (${reason}): Making API call at:`, new Date().toLocaleTimeString());
      
      const fetchPromise = axios.get('/api/announcements', { 
        withCredentials: true 
      }).then(response => {
        const announcements = response.data.announcements || [];
        // console.log(`🔔 fetchUnreadCount (${reason}): Retrieved ${announcements.length} announcements`);
        
        // Check if announcement count changed
        const currentCount = announcements.length;
        const previousCount = lastAnnouncementCountRef.current;
        
        if (currentCount !== previousCount) {
          // console.log(`🔔 fetchUnreadCount: Announcement count changed ${previousCount} → ${currentCount}, processing unread count`);
          lastAnnouncementCountRef.current = currentCount;
        } else if (reason === 'adaptive-polling') {
          // console.log(`🔔 fetchUnreadCount (${reason}): No new announcements, keeping current unread count: ${unreadCount}`);
          setLastFetchTime(now);
          return unreadCount; // Return current count without processing
        }
        
        // Process unread count
        const seenIds = JSON.parse(localStorage.getItem('seenAnnouncements') || '[]');
        
        const unread = announcements.filter(ann => {
          const announcementId = ann._id || ann.id;
          if (!announcementId) return false;
          
          if (ann.readBy && ann.readBy.includes(user._id)) return false;
          if (seenIds.includes(announcementId)) return false;
          
          if (user.createdAt && ann.createdAt) {
            const announcementDate = new Date(ann.createdAt);
            const userJoinDate = new Date(user.createdAt);
            if (announcementDate < userJoinDate) return false;
          }
          
          return true;
        });
        
        const newUnreadCount = unread.length;
        
        if (newUnreadCount !== unreadCount) {
          setUnreadCount(newUnreadCount);
          // console.log(`🔔 Badge count updated: ${newUnreadCount}/${announcements.length} unread announcements`);
        } else {
          // console.log(`🔔 Badge count unchanged: ${newUnreadCount}/${announcements.length} unread announcements`);
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
      return unreadCount; // Return current count on error
    }
  }, [user, unreadCount, lastFetchTime]);

  const refreshUnreadCount = useCallback((reason = 'manual') => {
    if (!user || !user._id) {
      // console.log('🔔 refreshUnreadCount: No user logged in, skipping refresh');
      return;
    }

    // console.log(`🔔 refreshUnreadCount (${reason}): Triggering smart fetch`);
    fetchUnreadCount(reason);
  }, [fetchUnreadCount, user]);

  // UPDATED: Adaptive polling system that reduces frequency when no new announcements
  useEffect(() => {
    if (user && user._id) {
      // console.log('🔔 Starting adaptive unread count monitoring for user:', user.email);
      
      // Reset polling state
      const minPollingInterval = 5 * 60 * 1000;  // 5 minutes
      const maxPollingInterval = 60 * 60 * 1000; // 60 minutes
      currentPollingIntervalRef.current = document.hidden ? 10 * 60 * 1000 : minPollingInterval;
      lastKnownUnreadCountRef.current = 0;
      
      // Clear any existing polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      // ADAPTIVE: Polling handler that adjusts interval based on activity
      const pollHandler = async () => {
        if (!user || !user._id) return;
        
        try {
          // console.log('🔔 Adaptive polling: Checking for changes');
          const currentUnreadCount = await fetchUnreadCount('adaptive-polling');
          const lastKnownCount = lastKnownUnreadCountRef.current;
          
          // Check if there are new announcements (unread count increased or total count changed)
          const hasNewActivity = currentUnreadCount > lastKnownCount || 
                                lastAnnouncementCountRef.current !== lastKnownUnreadCountRef.current;
          
          lastKnownUnreadCountRef.current = currentUnreadCount;
          
          adjustPollingInterval(hasNewActivity);
          
        } catch (error) {
          console.error('❌ Adaptive polling error:', error);
          // On error, don't change interval - keep current frequency
        }
      };

      // ADAPTIVE: Adjust polling interval based on activity
      const adjustPollingInterval = (hasNewActivity) => {
        const currentInterval = currentPollingIntervalRef.current;
        
        if (hasNewActivity) {
          // Reset to minimum interval when new activity detected
          // console.log('🔔 New activity detected - resetting to minimum polling interval');
          currentPollingIntervalRef.current = minPollingInterval;
        } else {
          // Increase interval exponentially when no activity (max 60 minutes)
          const newInterval = Math.min(currentInterval * 1.5, maxPollingInterval);
          currentPollingIntervalRef.current = newInterval;
          // console.log(`🔔 No new activity - increasing polling interval to ${newInterval / (60 * 1000)} minutes`);
        }

        // Restart polling with new interval
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
        
        pollingIntervalRef.current = setInterval(pollHandler, currentPollingIntervalRef.current);
        // console.log(`🔔 Adaptive polling restarted: ${currentPollingIntervalRef.current / (60 * 1000)} minute intervals`);
      };

      // Initial fetch
      fetchUnreadCount('initial').then(initialCount => {
        lastKnownUnreadCountRef.current = initialCount;
        
        // Start adaptive polling
        pollingIntervalRef.current = setInterval(pollHandler, currentPollingIntervalRef.current);
        // console.log(`🔔 Started adaptive polling every ${currentPollingIntervalRef.current / (60 * 1000)} minutes`);
      });

      // ENHANCED: Event-driven updates
      const handleVisibilityChange = () => {
        if (!document.hidden && user && user._id) {
          // console.log('🔔 Tab visible: Resetting polling and fetching immediately');
          
          // Reset to minimum interval when tab becomes visible
          currentPollingIntervalRef.current = minPollingInterval;
          
          fetchUnreadCount('tab-visible').then(count => {
            lastKnownUnreadCountRef.current = count;
            
            // Restart polling with minimum interval
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
            }
            pollingIntervalRef.current = setInterval(pollHandler, currentPollingIntervalRef.current);
            // console.log(`🔔 Tab visible: Polling reset to ${currentPollingIntervalRef.current / (60 * 1000)} minute intervals`);
          });
        } else if (document.hidden) {
          // console.log('🔔 Tab hidden: Will use longer intervals on next adjustment');
        }
      };

      const handleAnnouncementUpdate = (event) => {
        // console.log('🔔 Announcement update event detected - resetting polling interval');
        currentPollingIntervalRef.current = minPollingInterval;
        fetchUnreadCount('announcement-update');
      };

      const handleStorageChange = (event) => {
        if (event.key === 'seenAnnouncements') {
          // console.log('🔔 Seen announcements changed in another tab');
          fetchUnreadCount('cross-tab-update');
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('announcementUpdated', handleAnnouncementUpdate);
      window.addEventListener('storage', handleStorageChange);
      
      return () => {
        // console.log('🔔 Stopping adaptive unread count monitoring');
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('announcementUpdated', handleAnnouncementUpdate);
        window.removeEventListener('storage', handleStorageChange);
      };
    } else {
      // console.log('🔔 No user logged in, clearing unread count');
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
        
        // console.log('🔔 User logged in, scheduling unread count fetch');
        setTimeout(() => {
          fetchUnreadCount('login');
        }, 1000);
        
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
      // console.log('🔔 User logged out, clearing all announcement data');
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

  const markAllAsRead = useCallback(async () => {
    if (!user || !user._id) {
      // console.log('🔔 markAllAsRead: No user logged in');
      return;
    }
    
    try {
      // console.log('🔔 markAllAsRead: Making API call');
      const response = await axios.get('/api/announcements', { 
        withCredentials: true 
      });
      const announcements = response.data.announcements || [];
      const allIds = announcements.map(ann => ann._id || ann.id).filter(Boolean);
      
      localStorage.setItem('seenAnnouncements', JSON.stringify(allIds));
      
      const unreadAnnouncements = announcements.filter(ann => {
        const announcementId = ann._id || ann.id;
        return announcementId && (!ann.readBy || !ann.readBy.includes(user._id));
      });

      unreadAnnouncements.forEach(async (ann) => {
        try {
          await axios.post(`/api/announcements/${ann._id || ann.id}/read`, {}, {
            withCredentials: true
          });
        } catch (error) {
          console.warn('Failed to mark announcement as read on server:', error);
        }
      });
      
      setUnreadCount(0);
      lastKnownUnreadCountRef.current = 0;
      // console.log('🔔 All announcements marked as read - badge cleared');
      
      window.dispatchEvent(new CustomEvent('markAllAnnouncementsRead'));
      window.dispatchEvent(new CustomEvent('announcementUpdated'));
      
    } catch (error) {
      console.error('Error marking announcements as read:', error);
    }
  }, [user]);

  const handleNewAnnouncement = useCallback((newAnnouncementId) => {
    if (!user || !user._id) {
      // console.log('🔔 handleNewAnnouncement: No user logged in');
      return;
    }
    
    const seenIds = JSON.parse(localStorage.getItem('seenAnnouncements') || '[]');
    if (!seenIds.includes(newAnnouncementId)) {
      setUnreadCount(prev => {
        const newCount = prev + 1;
        lastKnownUnreadCountRef.current = newCount;
        // console.log(`🔔 New announcement detected, badge count: ${newCount}`);
        return newCount;
      });
      
      window.dispatchEvent(new CustomEvent('announcementUpdated'));
    }
  }, [user]);

  const markAnnouncementAsRead = useCallback((announcementId) => {
    if (!user || !user._id || !announcementId) {
      // console.log('🔔 markAnnouncementAsRead: Missing user or announcementId');
      return;
    }
    
    const seenIds = JSON.parse(localStorage.getItem('seenAnnouncements') || '[]');
    if (!seenIds.includes(announcementId)) {
      const updatedSeen = [...seenIds, announcementId];
      localStorage.setItem('seenAnnouncements', JSON.stringify(updatedSeen));
      
      setUnreadCount(prev => {
        const newCount = Math.max(0, prev - 1);
        lastKnownUnreadCountRef.current = newCount;
        // console.log(`🔔 Announcement ${announcementId} marked as read, badge count: ${newCount}`);
        return newCount;
      });

      axios.post(`/api/announcements/${announcementId}/read`, {}, {
        withCredentials: true
      }).catch(error => {
        console.warn('Failed to mark announcement as read on server:', error);
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
