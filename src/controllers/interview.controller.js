import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { interviewService } from "../services/interview.service.js";

export const startSession = asyncHandler(async (req, res) => {
  const { interviewId, initialMessage } =
    await interviewService.initializeInterview(req.user._id);

  return sendSuccess(
    res,
    { interviewId, initialMessage },
    "Interview session started successfully",
    201,
  );
});
