import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { analyticsService } from "../services/analytics.service.js";

export const getDashboardFocus = asyncHandler(async (req, res) => {
  const focusData = await analyticsService.getDashboardFocus(req.user._id);
  
  if (!focusData) {
    return sendSuccess(res, null, "No focus recommendation available right now.");
  }

  return sendSuccess(res, focusData, "Focus recommendation fetched successfully");
});

export const getDashboardStats = asyncHandler(async (req, res) => {
  const stats = await analyticsService.getDashboardStats(req.user._id);
  return sendSuccess(res, stats, "Dashboard stats fetched successfully");
});

export const getRecentSessions = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 3;
  const recentActivity = await analyticsService.getRecentActivity(req.user._id, limit);

  // Map to the requested frontend schema
  const mappedSessions = recentActivity.map((session) => ({
    id: session.id,
    sessionType: session.type === "Voice Session" ? "voice" : "practice",
    title: session.title,
    completedAt: session.createdAt,
    score: session.score,
    maxScore: 100, // Hardcoded to 100 for percentage-based scoring
  }));

  return sendSuccess(res, mappedSessions, "Recent sessions fetched successfully");
});

export const getAudioDashboardStats = asyncHandler(async (req, res) => {
  const stats = await analyticsService.getAudioDashboardData(req.user._id);
  return sendSuccess(res, stats, "Audio dashboard stats fetched successfully");
});
