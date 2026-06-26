import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { interviewService } from "../services/interview.service.js";
import { LiveInterview } from "../models/liveInterview.model.js";

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

export const getSessionReport = asyncHandler(async (req, res) => {
  const { interviewId } = req.params;

  const interview = await LiveInterview.findById(interviewId).lean();

  if (!interview) {
    throw new ApiError(404, "Interview session not found.");
  }

  // Ownership check: users can only view their own interviews
  if (interview.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You are not authorized to view this session.");
  }

  // Calculate duration in minutes
  let durationMinutes = null;
  if (interview.startedAt && interview.completedAt) {
    durationMinutes = Math.round(
      (new Date(interview.completedAt) - new Date(interview.startedAt)) / 60000
    );
  }

  // Calculate user verbosity (total words spoken by the candidate)
  let totalUserWords = 0;
  const conversationTranscript = interview.transcript
    .filter((t) => t.role !== "system") // Strip internal system prompt
    .map((t) => {
      if (t.role === "user" && t.content) {
        totalUserWords += t.content.split(/\s+/).filter(Boolean).length;
      }
      return { role: t.role, content: t.content };
    });

  return sendSuccess(
    res,
    {
      id: interview._id,
      status: interview.status,
      score: interview.score,
      feedback: interview.feedback,
      startedAt: interview.startedAt,
      completedAt: interview.completedAt,
      durationMinutes,
      totalUserWords,
      transcript: conversationTranscript,
    },
    "Session report fetched successfully."
  );
});
