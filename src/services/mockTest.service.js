import { User } from "../models/user.model.js";
import { Question } from "../models/question.model.js";
import { MockTest } from "../models/mockTest.model.js";
import { ApiError } from "../utils/ApiError.js";
import { CORE_SKILLS } from "../constants.js";

class MockTestService {
  /**
   * Returns per-skill Elo status for the user's skills.
   * Used by the frontend to show the skill selection screen.
   */
  async getTestConfig(userId) {
    const user = await User.findById(userId)
      .select("resumeProfile.skills skillElo")
      .lean();
    if (!user) throw new ApiError(404, "User not found");

    const skills = user.resumeProfile?.skills ?? [];

    return skills.map((skill) => {
      const elo = user.skillElo?.[skill] ?? 1000;
      let status;
      if (elo < 1050) status = "Weak";
      else if (elo <= 1450) status = "Average";
      else status = "Strong";

      return { skill, elo, status };
    });
  }

  /**
   * Creates a 15-question mock test for the given user and selected skills.
   * Resumes an existing IN_PROGRESS test if one already exists.
   *
   * Composition:
   *   - 12 questions from selectedSkills  (unsolved first)
   *   - 3 questions from CORE_SKILLS      (unsolved first)
   *   - Fallback: recycle solved questions to reach 15
   */
  async createTest(userId, selectedSkills) {
    if (!selectedSkills || selectedSkills.length === 0) {
      throw new ApiError(400, "Please select at least one skill for the test");
    }

    // Resume existing session if any
    const existing = await MockTest.findOne({
      user: userId,
      status: "IN_PROGRESS",
    });
    if (existing) return existing;

    // Fetch user's solved IDs
    const user = await User.findById(userId).select("solvedQuestionIds").lean();
    const solvedIds = user?.solvedQuestionIds ?? [];

    const TECHNICAL_COUNT = 12;
    const CORE_COUNT = 3;
    const TOTAL = 15;

    // ── Pool 1: Technical questions from selected skills ──────────────────
    const technicalQuestions = await Question.aggregate([
      { $match: { topics: { $in: selectedSkills }, _id: { $nin: solvedIds } } },
      { $sample: { size: TECHNICAL_COUNT } },
    ]);

    // ── Pool 2: Core CS questions ─────────────────────────────────────────
    const alreadyFetchedIds = technicalQuestions.map((q) => q._id);
    const coreQuestions = await Question.aggregate([
      {
        $match: {
          topics: { $in: CORE_SKILLS },
          _id: { $nin: [...solvedIds, ...alreadyFetchedIds] },
        },
      },
      { $sample: { size: CORE_COUNT } },
    ]);

    // ── Fallback A: Not enough core → fill from selectedSkills ───────────
    const coreFallbackNeeded = CORE_COUNT - coreQuestions.length;
    let coreFallback = [];
    if (coreFallbackNeeded > 0) {
      const usedIds = [
        ...alreadyFetchedIds,
        ...coreQuestions.map((q) => q._id),
      ];
      coreFallback = await Question.aggregate([
        {
          $match: {
            topics: { $in: selectedSkills },
            _id: { $nin: [...solvedIds, ...usedIds] },
          },
        },
        { $sample: { size: coreFallbackNeeded } },
      ]);
    }

    let combined = [...technicalQuestions, ...coreQuestions, ...coreFallback];

    // ── Fallback B: Still short → recycle solved questions ────────────────
    const stillNeeded = TOTAL - combined.length;
    if (stillNeeded > 0) {
      const usedIds = combined.map((q) => q._id);
      const recycled = await Question.aggregate([
        {
          $match: {
            topics: { $in: [...selectedSkills, ...CORE_SKILLS] },
            _id: { $nin: usedIds },
          },
        },
        { $sample: { size: stillNeeded } },
      ]);
      combined = [...combined, ...recycled];
    }

    // ── Snapshot questions (strip _id added by aggregate) ────────────────
    const questionSnapshots = combined.map((q) => ({
      questionId: q._id,
      text: q.text,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      topic: q.topics?.[0] ?? "",
      difficulty: q.difficulty,
    }));

    const mockTest = await MockTest.create({
      user: userId,
      questions: questionSnapshots,
      totalQuestions: questionSnapshots.length,
    });

    return mockTest;
  }
}

export const mockTestService = new MockTestService();
