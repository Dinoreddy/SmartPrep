import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { questionService } from "../services/question.service.js"; // Import the service instance directly

export const getQuestions = asyncHandler(async (req, res) => {
  const { topic, limit = 5 } = req.query;

  if (!topic) {
    throw new ApiError(400, "Topic is required");
  }

  // Adaptive Matchmaking: Get User's Elo for this topic
  // req.user.skillElo is a Map (from User model)
  const userElo = req.user.skillElo.get(topic) || 1000;

  // Delegate business logic to service
  const questions = await questionService.getQuestions(topic, Number(limit), userElo);

  return sendSuccess(
    res,
    questions,
    `Fetched ${questions.length} questions for topic: ${topic} (Elo: ${userElo})`,
    200
  );
});
