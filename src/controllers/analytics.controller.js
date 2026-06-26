import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { analyticsService } from "../services/analytics.service.js";

export const getChartData = asyncHandler(async (req, res) => {
  const { trajectoryTimeRange, voiceTimeRange } = req.query; 
  const chartData = await analyticsService.getChartData(
    req.user._id,
    trajectoryTimeRange,
    voiceTimeRange
  );
  return sendSuccess(res, chartData, "Analytics chart data fetched successfully");
});
