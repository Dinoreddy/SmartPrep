import { MockTest } from "../models/mockTest.model.js";
import { LiveInterview } from "../models/liveInterview.model.js";
import { EloHistory } from "../models/eloHistory.model.js";
import { User } from "../models/user.model.js";

class AnalyticsService {
  /**
   * Calculate overall practice accuracy based on all completed mock tests.
   */
  async getPracticeAccuracy(userId) {
    const result = await MockTest.aggregate([
      { $match: { user: userId, status: "COMPLETED" } },
      {
        $group: {
          _id: null,
          totalQuestions: { $sum: "$totalQuestions" },
          averagePercentage: { $avg: "$percentage" },
        },
      },
    ]);

    if (result.length === 0) {
      return { totalQuestions: 0, averagePercentage: 0 };
    }

    return {
      totalQuestions: result[0].totalQuestions,
      averagePercentage: Math.round(result[0].averagePercentage),
    };
  }

  /**
   * Calculate stats for voice mock interviews.
   */
  async getVoiceMockStats(userId) {
    const result = await LiveInterview.aggregate([
      { $match: { user: userId, status: "COMPLETED", score: { $ne: null } } },
      {
        $group: {
          _id: null,
          completedCount: { $sum: 1 },
          averageScore: { $avg: "$score" },
        },
      },
    ]);

    if (result.length === 0) {
      return { completedCount: 0, averageScore: 0 };
    }

    return {
      completedCount: result[0].completedCount,
      averageScore: Math.round(result[0].averageScore),
    };
  }

  /**
   * Fetch recent activity combining MockTests and LiveInterviews.
   */
  async getRecentActivity(userId, limit = 3) {
    const [mockTests, liveInterviews] = await Promise.all([
      MockTest.find({ user: userId, status: "COMPLETED" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      LiveInterview.find({ user: userId, status: "COMPLETED" })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const combined = [
      ...mockTests.map((t) => ({
        id: t._id,
        type: "MCQ Practice",
        title: t.questions?.[0]?.topic ? `${t.questions[0].topic} MCQ Practice` : "General MCQ Practice",
        createdAt: t.createdAt,
        score: Math.round(t.percentage),
      })),
      ...liveInterviews.map((i) => ({
        id: i._id,
        type: "Voice Session",
        title: "Voice Interview", // Generic for now, can be improved based on resume context
        createdAt: i.createdAt,
        score: i.score ? Math.round(i.score) : null,
      })),
    ];

    // Sort by createdAt descending and take top N
    combined.sort((a, b) => b.createdAt - a.createdAt);
    return combined.slice(0, limit);
  }

  /**
   * Get Elo trend for a specific skill (net change over X days).
   */
  async getEloTrend(userId, days = 7) {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    const history = await EloHistory.aggregate([
      { $match: { user: userId, createdAt: { $gte: dateLimit } } },
      {
        $group: {
          _id: "$skill",
          totalChange: { $sum: "$eloChange" },
        },
      },
    ]);

    // Format as a simple object map: { "React": +15, "NodeJS": -5 }
    return history.reduce((acc, curr) => {
      acc[curr._id] = curr.totalChange;
      return acc;
    }, {});
  }

  /**
   * Get formatted data for Recharts (Radar, Trajectory, Voice Performance).
   */
  async getChartData(userId, trajectoryTimeRange = "30d", voiceTimeRange = "30d") {
    // Helper to build date filter
    const buildDateFilter = (timeRange) => {
      if (timeRange === "all") return {};
      const days = timeRange === "7d" ? 7 : timeRange === "90d" ? 90 : 30;
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - days);
      return { createdAt: { $gte: dateLimit } };
    };

    const trajectoryFilter = buildDateFilter(trajectoryTimeRange);
    const voiceFilter = buildDateFilter(voiceTimeRange);

    // 2. Fetch all required data concurrently
    const [user, mockTests, liveInterviews] = await Promise.all([
      User.findById(userId).select("skillElo").lean(),
      MockTest.find({ user: userId, status: "COMPLETED", ...trajectoryFilter })
        .sort({ createdAt: 1 })
        .select("percentage createdAt")
        .lean(),
      LiveInterview.find({
        user: userId,
        status: "COMPLETED",
        score: { $ne: null },
        ...voiceFilter,
      })
        .sort({ createdAt: 1 })
        .select("score createdAt")
        .lean(),
    ]);

    // 3. Format Radar Data
    const radarData = [];
    if (user?.skillElo) {
      // Handle Mongoose Map when using .lean()
      const entries = Object.entries(user.skillElo);
      for (const [skill, elo] of entries) {
        radarData.push({
          subject: skill,
          score: elo,
          fullMark: 2000,
        });
      }
    }

    // Date formatting helper for Recharts X-axis ("Jun 20")
    const formatDate = (dateString) => {
      return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    };

    // 4. Format Trajectory Data
    const trajectoryData = mockTests.map((t) => ({
      date: formatDate(t.createdAt),
      score: Math.round(t.percentage),
    }));

    // 5. Format Voice Performance Data
    const voicePerformanceData = liveInterviews.map((i) => ({
      date: formatDate(i.createdAt),
      score: Math.round(i.score),
    }));

    return {
      radarData,
      trajectoryData,
      voicePerformanceData,
    };
  }

  /**
   * Get tailored preparation recommendation of the day based on lowest Elo.
   */
  async getDashboardFocus(userId) {
    const user = await User.findById(userId).select("skillElo").lean();
    if (!user || !user.skillElo) return null;

    let lowestSkill = null;
    let lowestElo = Infinity;

    for (const [skill, elo] of Object.entries(user.skillElo)) {
      if (elo < lowestElo) {
        lowestElo = elo;
        lowestSkill = skill;
      }
    }

    if (!lowestSkill) return null;

    return {
      skillName: lowestSkill,
      currentElo: lowestElo,
      recommendationDescription: `Your ${lowestSkill} Elo rating is currently at ${lowestElo}. Let's build it up with a quick practice session.`,
    };
  }

  /**
   * Fetch aggregated learning statistics for the dashboard.
   */
  async getDashboardStats(userId) {
    const user = await User.findById(userId).select("skillElo").lean();
    let averageElo = 1000;
    
    if (user && user.skillElo) {
      const elos = Object.values(user.skillElo);
      if (elos.length > 0) {
        averageElo = Math.round(elos.reduce((a, b) => a + b, 0) / elos.length);
      }
    }

    // Calculate overall 7-day Elo delta
    const eloTrendMap = await this.getEloTrend(userId, 7);
    const eloDelta = Object.values(eloTrendMap).reduce((a, b) => a + b, 0);

    const [practiceStats, voiceStats] = await Promise.all([
      this.getPracticeAccuracy(userId),
      this.getVoiceMockStats(userId),
    ]);

    return {
      averageElo,
      eloDelta,
      practiceAccuracy: practiceStats.averagePercentage,
      totalQuestionsAnswered: practiceStats.totalQuestions,
      voiceMocksCompleted: voiceStats.completedCount,
      averageVoiceScore: voiceStats.averageScore,
    };
  }

  /**
   * Fetch specific statistics for the Audio Interview Dashboard.
   */
  async getAudioDashboardData(userId) {
    const interviews = await LiveInterview.find({ user: userId, status: "COMPLETED" })
      .sort({ createdAt: -1 })
      .lean();

    let totalScore = 0;
    let scoredCount = 0;
    let totalDurationMs = 0;
    let totalUserWords = 0;

    const recentSessions = [];

    interviews.forEach((interview, index) => {
      // Average Score
      if (interview.score !== null && interview.score !== undefined) {
        totalScore += interview.score;
        scoredCount++;
      }

      // Duration
      if (interview.startedAt && interview.completedAt) {
        totalDurationMs += new Date(interview.completedAt) - new Date(interview.startedAt);
      }

      // Verbosity
      if (interview.transcript && Array.isArray(interview.transcript)) {
        interview.transcript.forEach((msg) => {
          if (msg.role === "user" && msg.content) {
            totalUserWords += msg.content.split(/\s+/).filter(Boolean).length;
          }
        });
      }

      // Populate recent sessions (top 3)
      if (index < 3) {
        recentSessions.push({
          id: interview._id,
          sessionType: "voice",
          title: "Voice Interview",
          completedAt: interview.completedAt || interview.createdAt,
          score: interview.score !== null ? Math.round(interview.score) : null,
          maxScore: 100,
        });
      }
    });

    const totalCompleted = interviews.length;
    const averageScore = scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0;
    
    // Average duration in minutes
    const avgDurationMs = totalCompleted > 0 ? totalDurationMs / totalCompleted : 0;
    const averageDurationMinutes = Math.round(avgDurationMs / 60000);

    // Average user word count per interview
    const averageVerbosity = totalCompleted > 0 ? Math.round(totalUserWords / totalCompleted) : 0;

    return {
      averageScore,
      totalCompleted,
      averageDurationMinutes,
      averageVerbosity,
      recentSessions,
    };
  }
}

export const analyticsService = new AnalyticsService();
