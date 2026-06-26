import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { questionService } from "../services/question.service.js";
import { calculateElo } from "../utils/eloCalculator.js";
import { Question } from "../models/question.model.js";
import { User } from "../models/user.model.js";
import { EloHistory } from "../models/eloHistory.model.js";

export const getQuestions = asyncHandler(async (req, res) => {
  const { topic, limit = 5 } = req.query;

  if (!topic) throw new ApiError(400, "Topic is required");

  const userElo = req.user.skillElo?.get(topic) ?? 1000;
  const questions = await questionService.getQuestions(
    topic,
    Number(limit),
    userElo,
    req.user._id,
  );

  return sendSuccess(
    res,
    questions,
    `Fetched ${questions.length} questions for topic: ${topic}`,
  );
});

export const getPracticeStats = asyncHandler(async (req, res) => {
  const stats = await questionService.getPracticeStats(req.user._id);
  return sendSuccess(res, stats, "Practice stats fetched successfully.");
});

export const submitAnswer = asyncHandler(async (req, res) => {
  const { questionId, selectedOptionIndex } = req.body;

  if (questionId === undefined || selectedOptionIndex === undefined) {
    throw new ApiError(400, "questionId and selectedOptionIndex are required");
  }

  const question = await Question.findById(questionId);
  if (!question) throw new ApiError(404, "Question not found");
  console.log(
    `[submit] question: ${question._id} | topic: ${question.topics?.[0]} | correctIndex: ${question.correctOptionIndex} | eloRating: ${question.eloRating}`,
  );

  const topic = question.topics?.[0];
  if (!topic) throw new ApiError(500, "Question has no associated topic");

  const isCorrect = Number(selectedOptionIndex) === question.correctOptionIndex;
  console.log(
    `[submit] selectedIndex: ${selectedOptionIndex} | isCorrect: ${isCorrect}`,
  );

  // Fetch fresh from DB — req.user is a stale snapshot from login time
  const user = await User.findById(req.user._id).select("skillElo");
  console.log(`[submit] skillElo map:`, user?.skillElo);
  const userElo = user?.skillElo?.get(topic) ?? 1000;
  console.log(`[submit] userElo for "${topic}": ${userElo}`);

  const { newUserElo, newQuestionElo, eloChange } = calculateElo(
    userElo,
    question.eloRating,
    isCorrect,
  );
  console.log(
    `[submit] elo calc → ${userElo} → ${newUserElo} (${eloChange >= 0 ? "+" : ""}${eloChange}) | question: ${question.eloRating} → ${newQuestionElo}`,
  );

  // Build parallel DB updates
  const dbUpdates = [
    Question.findByIdAndUpdate(questionId, {
      $set: { eloRating: newQuestionElo },
    }),
    User.findByIdAndUpdate(req.user._id, {
      $set: { [`skillElo.${topic}`]: newUserElo },
    }),
  ];

  // Track solved question only on correct answers
  if (isCorrect) {
    dbUpdates.push(
      User.findByIdAndUpdate(req.user._id, {
        $addToSet: { solvedQuestionIds: questionId },
      }),
    );
  }

  // Log Elo History if changed
  if (userElo !== newUserElo) {
    dbUpdates.push(
      EloHistory.create({
        user: req.user._id,
        skill: topic,
        oldElo: userElo,
        newElo: newUserElo,
        eloChange: newUserElo - userElo,
        sourceType: "MCQ_PRACTICE",
        sourceId: questionId,
      })
    );
  }

  await Promise.all(dbUpdates);
  console.log(
    `[submit] DB write done — skillElo.${topic} = ${newUserElo}${isCorrect ? ` | added ${questionId} to solvedQuestionIds` : ""}`,
  );

  return sendSuccess(
    res,
    {
      isCorrect,
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation,
      topic,
      newElo: newUserElo,
      eloChange,
    },
    isCorrect ? "Correct! Well done." : "Incorrect. Keep practicing!",
  );
});
