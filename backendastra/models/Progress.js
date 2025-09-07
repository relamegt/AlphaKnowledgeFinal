const { DataAPIClient } = require('@datastax/astra-db-ts');

class Progress {
  constructor() {
    this.client = new DataAPIClient(process.env.ASTRA_DB_APPLICATION_TOKEN);
    this.db = this.client.db(process.env.ASTRA_DB_API_ENDPOINT);
    this.collection = this.db.collection('progress');
  }

  async getUserProgress(userId) {
    try {
      const cursor = this.collection.find({ userId });
      const progress = await cursor.toArray();
      return progress;
    } catch (error) {
      console.error('Error fetching user progress:', error);
      throw new Error('Failed to fetch progress');
    }
  }

  async toggleProblem(userId, problemId, sheetId, sectionId, subsectionId, completed) {
    try {
      const progressId = `${userId}_${problemId}`;
      
      if (completed) {
        // Mark as completed
        const progressEntry = {
          _id: progressId,
          userId,
          problemId,
          sheetId,
          sectionId,
          subsectionId,
          completed: true,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        const result = await this.collection.replaceOne(
          { _id: progressId },
          progressEntry,
          { upsert: true }
        );

        return { success: true, progress: progressEntry };
      } else {
        // Mark as incomplete (remove entry)
        await this.collection.deleteOne({ _id: progressId });
        return { success: true, progress: null };
      }
    } catch (error) {
      console.error('Error toggling problem:', error);
      throw new Error('Failed to update progress');
    }
  }

  async getUserStats(userId) {
    try {
      const cursor = this.collection.find({ userId, completed: true });
      const completedProblems = await cursor.toArray();
      
      // Group by difficulty if available
      const stats = {
        totalCompleted: completedProblems.length,
        bySheet: {},
        bySection: {},
        recentActivity: completedProblems
          .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
          .slice(0, 10)
      };

      // Group by sheet
      completedProblems.forEach(problem => {
        if (!stats.bySheet[problem.sheetId]) {
          stats.bySheet[problem.sheetId] = 0;
        }
        stats.bySheet[problem.sheetId]++;
      });

      return stats;
    } catch (error) {
      console.error('Error fetching user stats:', error);
      throw new Error('Failed to fetch stats');
    }
  }

  async getAllProgress() {
    try {
      const cursor = this.collection.find({});
      const allProgress = await cursor.toArray();
      return allProgress;
    } catch (error) {
      console.error('Error fetching all progress:', error);
      throw new Error('Failed to fetch all progress');
    }
  }

  async deleteUserProgress(userId) {
    try {
      const result = await this.collection.deleteMany({ userId });
      return result;
    } catch (error) {
      console.error('Error deleting user progress:', error);
      throw new Error('Failed to delete progress');
    }
  }
   async deleteByProblemId(problemId) {
    try {
      const result = await this.collection.deleteMany({ problemId: problemId });
      // console.log(`Deleted ${result.deletedCount} progress records for problem ${problemId}`);
      return result;
    } catch (error) {
      console.error('Error deleting progress by problemId:', error);
      throw new Error('Failed to delete progress records');
    }
  }

  // Add this method to delete progress by sheet ID (useful for sheet deletion)
  async deleteBySheetId(sheetId) {
    try {
      const result = await this.collection.deleteMany({ sheetId: sheetId });
      // console.log(`Deleted ${result.deletedCount} progress records for sheet ${sheetId}`);
      return result;
    } catch (error) {
      console.error('Error deleting progress by sheetId:', error);
      throw new Error('Failed to delete progress records');
    }
  }

  // Add this method to delete progress by section ID
  async deleteBySectionId(sectionId) {
    try {
      const result = await this.collection.deleteMany({ sectionId: sectionId });
      // console.log(`Deleted ${result.deletedCount} progress records for section ${sectionId}`);
      return result;
    } catch (error) {
      console.error('Error deleting progress by sectionId:', error);
      throw new Error('Failed to delete progress records');
    }
  }

  // Add this method to delete progress by subsection ID
  async deleteBySubsectionId(subsectionId) {
    try {
      const result = await this.collection.deleteMany({ subsectionId: subsectionId });
      // console.log(`Deleted ${result.deletedCount} progress records for subsection ${subsectionId}`);
      return result;
    } catch (error) {
      console.error('Error deleting progress by subsectionId:', error);
      throw new Error('Failed to delete progress records');
    }
  }
}

module.exports = Progress;
