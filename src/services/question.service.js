import Groq from "groq-sdk";
import { Question } from "../models/question.model.js";
import { User } from "../models/user.model.js";
import { generateQuestionsWithGroq } from "../utils/aiHelper.js";
import { taxonomyService } from "./taxonomy.service.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CLIENT_FIELDS = {
  _id: 1,
  text: 1,
  options: 1,
  correctOptionIndex: 1,
  explanation: 1,
  difficulty: 1,
  eloRating: 1,
  topics: 1,
};

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
      { $project: CLIENT_FIELDS },
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
        { $project: CLIENT_FIELDS },
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

    // Get targeted sub-topic
    const targetSubTopic = await taxonomyService.getTargetedSubTopic(topic);
    const subTopicName = targetSubTopic ? targetSubTopic.name : null;

    // Fetch anti-context
    const existing = await Question.find({ topics: topic })
      .sort({ createdAt: -1 })
      .select("text")
      .limit(10)
      .lean();
    const antiContextTexts = [...new Set(existing.map((q) => q.text))];

    const parsedQuestions = await generateQuestionsWithGroq(
      groq,
      topic,
      stillMissing,
      difficulty,
      subTopicName,
      antiContextTexts
    );

    const questionsToSave = parsedQuestions.map((q) => ({
      ...q,
      topics: [topic], // Force exact topic match to prevent AI hallucination (e.g. "ReactJS" instead of "React")
      difficulty,
      eloRating: baseElo,
      source: "AI_Groq",
      isVerified: false,
    }));

    let insertedQuestions = [];
    if (questionsToSave.length > 0) {
      insertedQuestions = await Question.insertMany(questionsToSave);
      if (subTopicName) {
        await taxonomyService.incrementSubTopicCount(topic, subTopicName, questionsToSave.length);
      }
    }

    // Strip server-only fields from freshly generated questions before returning
    const sanitizedNew = insertedQuestions.map(
      (doc) => ({
        _id: doc._id,
        text: doc.text,
        options: doc.options,
        correctOptionIndex: doc.correctOptionIndex,
        explanation: doc.explanation,
        difficulty: doc.difficulty,
        eloRating: doc.eloRating,
        topics: doc.topics,
      })
    );

    return [...combined, ...sanitizedNew];
  }

  /**
   * Get per-skill stats for the practice dashboard.
   * One $facet aggregation → total + solved counts per topic in a single DB call.
   */
  async getPracticeStats(userId) {
    const user = await User.findById(userId)
      .select("skillElo solvedQuestionIds resumeProfile.skills")
      .lean();

    const resumeSkills = user?.resumeProfile?.skills ?? [];
    const skillEloKeys = user?.skillElo ? Object.keys(user.skillElo) : [];
    
    // Create a union of resume skills and any skills they have an Elo rating for
    const skills = [...new Set([...resumeSkills, ...skillEloKeys])];
    const solvedIds = user?.solvedQuestionIds ?? [];

    if (skills.length === 0) return [];

    const [result] = await Question.aggregate([
      {
        $facet: {
          totalByTopic: [
            { $match: { topics: { $in: skills } } },
            { $unwind: "$topics" },
            { $match: { topics: { $in: skills } } },
            { $group: { _id: "$topics", total: { $sum: 1 } } },
          ],
          solvedByTopic: [
            { $match: { _id: { $in: solvedIds }, topics: { $in: skills } } },
            { $unwind: "$topics" },
            { $match: { topics: { $in: skills } } },
            { $group: { _id: "$topics", solved: { $sum: 1 } } },
          ],
        },
      },
    ]);

    const totalMap = Object.fromEntries(
      result.totalByTopic.map((r) => [r._id, r.total]),
    );
    const solvedMap = Object.fromEntries(
      result.solvedByTopic.map((r) => [r._id, r.solved]),
    );

    const skillElo = user?.skillElo ?? {};
    const getElo = (skill) =>
      typeof skillElo.get === "function"
        ? skillElo.get(skill)
        : skillElo[skill];

    return skills.map((skill) => ({
      name: skill,
      elo: getElo(skill) ?? 1000,
      total: totalMap[skill] ?? 0,
      solved: solvedMap[skill] ?? 0,
    }));
  }
}

export const questionService = new QuestionService();
