import Groq from "groq-sdk";
import { Question } from "../models/question.model.js";
import { User } from "../models/user.model.js";
import { generateQuestionsWithGroq } from "../utils/aiHelper.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class QuestionService {
  /**
   * Get practice questions with adaptive Elo matchmaking and repetition handling.
   *
   * Strategy:
   *   A. Fresh first  — questions the user has NOT solved yet (within Elo ±200)
   *   B. Recycle      — if not enough fresh, fill remaining slots with already-solved
   *                     questions (still within Elo ±200)
   *   C. AI generate  — if still not enough, generate new ones via Groq
   */
  async getQuestions(topic, limit = 5, userElo = 1000, userId) {
    const minElo = userElo - 200;
    const maxElo = userElo + 200;
    const eloFilter = {
      topics: topic,
      eloRating: { $gte: minElo, $lte: maxElo },
    };

    // Fetch the user's solved question IDs (lean for efficiency)
    const userDoc = userId
      ? await User.findById(userId).select("solvedQuestionIds").lean()
      : null;
    const solvedIds = userDoc?.solvedQuestionIds ?? [];

    // Step A: Fresh questions — exclude already-solved ones
    const freshQuestions = await Question.aggregate([
      { $match: { ...eloFilter, _id: { $nin: solvedIds } } },
      { $sample: { size: Number(limit) } },
    ]);

    const freshCount = freshQuestions.length;
    const recycleNeeded = Number(limit) - freshCount;

    // Step B: Recycle solved questions to fill remaining slots
    let recycledQuestions = [];
    if (recycleNeeded > 0 && solvedIds.length > 0) {
      const freshIds = freshQuestions.map((q) => q._id);
      recycledQuestions = await Question.aggregate([
        { $match: { ...eloFilter, _id: { $nin: freshIds } } },
        { $sample: { size: recycleNeeded } },
      ]);
    }

    const combined = [...freshQuestions, ...recycledQuestions];
    const stillMissing = Number(limit) - combined.length;

    // Step C: AI generation if DB doesn't have enough questions at all
    if (stillMissing <= 0) return combined;

    let difficulty = "Medium";
    let baseElo = 1000;
    if (userElo <= 1050) {
      difficulty = "Easy";
      baseElo = 800;
    } else if (userElo > 1450) {
      difficulty = "Hard";
      baseElo = 1500;
    }

    console.log(
      `[Cache Miss] Generating ${stillMissing} ${difficulty} questions for "${topic}" (userElo: ${userElo})...`,
    );

    const parsedQuestions = await generateQuestionsWithGroq(
      groq,
      topic,
      stillMissing,
      difficulty,
    );

    const questionsToSave = parsedQuestions.map((q) => ({
      ...q,
      difficulty,
      eloRating: baseElo,
      source: "AI_Groq",
      isVerified: false,
    }));

    if (questionsToSave.length > 0) {
      await Question.insertMany(questionsToSave);
    }

    return [...combined, ...questionsToSave];
  }
}

export const questionService = new QuestionService();
