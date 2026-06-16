import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { interviewService } from "../services/interview.service.js";

export const startSession = asyncHandler(async (req, res) => {
  const { interviewId, initialAudio, initialMessage } =
    await interviewService.initializeInterview(req.user._id);

  return sendSuccess(
    res,
    {
      interviewId,
      initialAudio: initialAudio.toString("base64"),
      initialMessage,
      encoding: "linear16",
      sampleRate: 16000,
    },
    "Interview session started successfully",
    201,
  );
});
