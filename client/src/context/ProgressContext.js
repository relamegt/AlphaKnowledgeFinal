import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { progressAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const ProgressContext = createContext();

export const useProgress = () => {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error('useProgress must be used within a ProgressProvider');
  }
  return context;
};

export const ProgressProvider = ({ children }) => {
  const { user } = useAuth();
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalCompleted: 0,
    sheetStats: {},
    sectionStats: {},
    subsectionStats: {},
    difficultyStats: {},
    recentActivity: []
  });

  // Load user progress from backend
  const loadProgress = useCallback(async () => {
    if (!user?._id) {
      setProgress({});
      setStats({
        totalCompleted: 0,
        sheetStats: {},
        sectionStats: {},
        subsectionStats: {},
        difficultyStats: {},
        recentActivity: []
      });
      return;
    }

    try {
      setLoading(true);
      const response = await progressAPI.getUserProgress(user._id);
      
      let progressData = [];
      if (response?.data?.progress) {
        progressData = response.data.progress;
      } else if (response?.data && Array.isArray(response.data)) {
        progressData = response.data;
      } else if (Array.isArray(response)) {
        progressData = response;
      }

      // Convert array to object for easier lookup
      const progressMap = {};
      const sheetStats = {};
      const sectionStats = {};
      const subsectionStats = {};
      const difficultyStats = { Easy: 0, Medium: 0, Hard: 0 };
      
      if (Array.isArray(progressData)) {
        progressData.forEach(item => {
          if (item.problemId && item.completed) {
            progressMap[item.problemId] = {
              completed: true,
              completedAt: item.completedAt,
              sheetId: item.sheetId,
              sectionId: item.sectionId,
              subsectionId: item.subsectionId,
              difficulty: item.difficulty
            };

            // Update sheet stats
            if (item.sheetId) {
              sheetStats[item.sheetId] = (sheetStats[item.sheetId] || 0) + 1;
            }

            // Update section stats
            if (item.sectionId) {
              sectionStats[item.sectionId] = (sectionStats[item.sectionId] || 0) + 1;
            }

            // Update subsection stats
            if (item.subsectionId) {
              subsectionStats[item.subsectionId] = (subsectionStats[item.subsectionId] || 0) + 1;
            }

            // Update difficulty stats
            if (item.difficulty && difficultyStats.hasOwnProperty(item.difficulty)) {
              difficultyStats[item.difficulty]++;
            }
          }
        });
      }

      setProgress(progressMap);
      setStats({
        totalCompleted: Object.keys(progressMap).length,
        sheetStats,
        sectionStats,
        subsectionStats,
        difficultyStats,
        recentActivity: progressData
          .filter(item => item.completed)
          .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
          .slice(0, 10)
      });

    } catch (error) {
      console.error('Error fetching progress:', error);
      setProgress({});
      setStats({
        totalCompleted: 0,
        sheetStats: {},
        sectionStats: {},
        subsectionStats: {},
        difficultyStats: { Easy: 0, Medium: 0, Hard: 0 },
        recentActivity: []
      });
    } finally {
      setLoading(false);
    }
  }, [user?._id]);

  // Toggle problem completion
  const toggleProblem = useCallback(async (problemData) => {
    if (!user?._id) return false;

    const { problemId, completed } = problemData;
    const isCurrentlyCompleted = isProblemCompleted(problemId);
    const newCompletedState = completed !== undefined ? completed : !isCurrentlyCompleted;
    
    // Optimistically update UI
    setProgress(prev => {
      const newProgress = { ...prev };
      if (newCompletedState) {
        newProgress[problemId] = {
          completed: true,
          completedAt: new Date().toISOString(),
          ...problemData
        };
      } else {
        delete newProgress[problemId];
      }
      return newProgress;
    });

    // Update stats optimistically
    setStats(prev => {
      const newStats = { ...prev };
      const change = newCompletedState ? 1 : -1;
      
      newStats.totalCompleted = Math.max(0, prev.totalCompleted + change);
      
      if (problemData.sheetId) {
        newStats.sheetStats = {
          ...prev.sheetStats,
          [problemData.sheetId]: Math.max(0, (prev.sheetStats[problemData.sheetId] || 0) + change)
        };
      }
      
      if (problemData.sectionId) {
        newStats.sectionStats = {
          ...prev.sectionStats,
          [problemData.sectionId]: Math.max(0, (prev.sectionStats[problemData.sectionId] || 0) + change)
        };
      }
      
      if (problemData.subsectionId) {
        newStats.subsectionStats = {
          ...prev.subsectionStats,
          [problemData.subsectionId]: Math.max(0, (prev.subsectionStats[problemData.subsectionId] || 0) + change)
        };
      }
      
      if (problemData.difficulty && newStats.difficultyStats.hasOwnProperty(problemData.difficulty)) {
        newStats.difficultyStats = {
          ...prev.difficultyStats,
          [problemData.difficulty]: Math.max(0, prev.difficultyStats[problemData.difficulty] + change)
        };
      }
      
      return newStats;
    });

    try {
      const response = await progressAPI.toggleProblem({
        userId: user._id,
        ...problemData,
        completed: newCompletedState
      });

      if (response?.data?.success) {
        return true;
      } else {
        // Revert optimistic update on failure
        loadProgress();
        return false;
      }
    } catch (error) {
      console.error('Error toggling problem:', error);
      // Revert optimistic update on error
      loadProgress();
      return false;
    }
  }, [user?._id, loadProgress]);

  // Check if problem is completed
  const isProblemCompleted = useCallback((problemId) => {
    return progress[problemId]?.completed || false;
  }, [progress]);

  // Get sheet stats
  const getSheetStats = useCallback((sheetId) => {
    return {
      completed: stats.sheetStats[sheetId] || 0
    };
  }, [stats.sheetStats]);

  // Get sheet difficulty progress
  const getSheetDifficultyProgress = useCallback((sheetId, difficulty) => {
    // This would ideally come from the backend with proper filtering
    // For now, return the global difficulty stats
    return stats.difficultyStats[difficulty] || 0;
  }, [stats.difficultyStats]);

  // Refresh stats function
  const refreshStats = useCallback(() => {
    loadProgress();
  }, [loadProgress]);

  // Load progress when user changes
  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  const value = {
    progress,
    stats,
    loading,
    loadProgress,
    toggleProblem,
    isProblemCompleted,
    getSheetStats,
    getSheetDifficultyProgress,
    refreshStats
  };

  return (
    <ProgressContext.Provider value={value}>
      {children}
    </ProgressContext.Provider>
  );
};
