import { User } from "../models/user.model.js";
import { Question } from "../models/question.model.js";
import { MockTest } from "../models/mockTest.model.js";
import { EloHistory } from "../models/eloHistory.model.js";
import { ApiError } from "../utils/ApiError.js";
import { CORE_SKILLS } from "../constants.js";
import { calculateElo } from "../utils/eloCalculator.js";

const TECHNICAL_COUNT = 12;
const CORE_COUNT = 3;
const TOTAL = 15;

class MockTestService {
  /**
   * Returns per-skill Elo + readiness status for the user.
   * Used by the frontend skill-selection screen before test start.
   */
  async getTestConfig(userId) {
    const user = await User.findById(userId)
      .select("resumeProfile.skills skillElo")
      .lean();
    if (!user) throw new ApiError(404, "User not found");

    const skills = user.resumeProfile?.skills ?? [];

    return skills.map((skill) => {
      const elo = user.skillElo?.[skill] ?? 1000;
      const status = elo < 1050 ? "Weak" : elo <= 1450 ? "Average" : "Strong";
      return { skill, elo, status };
    });
  }

  /**
   * Creates a 15-question mock test.
   * Returns the existing IN_PROGRESS test if one is already open.
   *
   * Question composition (unsolved-first, recycled as fallback):
   *   12 × selectedSkills  +  3 × CORE_SKILLS
   */
  async createTest(userId, selectedSkills) {
    const existing = await MockTest.findOne({
      user: userId,
      status: "IN_PROGRESS",
    });
    if (existing) return existing;

    const user = await User.findById(userId).select("solvedQuestionIds").lean();
    const solvedIds = user?.solvedQuestionIds ?? [];

    // Pool 1 — technical questions from selected skills
    const technical = await Question.aggregate([
      { $match: { topics: { $in: selectedSkills }, _id: { $nin: solvedIds } } },
      { $sample: { size: TECHNICAL_COUNT } },
    ]);

    // Pool 2 — core CS questions (excluding already fetched)
    const usedAfterTechnical = technical.map((q) => q._id);
    const core = await Question.aggregate([
      {
        $match: {
          topics: { $in: CORE_SKILLS },
          _id: { $nin: [...solvedIds, ...usedAfterTechnical] },
        },
      },
      { $sample: { size: CORE_COUNT } },
    ]);

    // Fallback A — not enough core → fill from selected skills
    let coreFallback = [];
    const coreFallbackNeeded = CORE_COUNT - core.length;
    if (coreFallbackNeeded > 0) {
      const usedIds = [...usedAfterTechnical, ...core.map((q) => q._id)];
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

    let combined = [...technical, ...core, ...coreFallback];

    // Fallback B — still short → recycle solved questions
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

    const questions = combined.map((q) => ({
      questionId: q._id,
      text: q.text,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      topic: q.topics?.[0] ?? "",
      difficulty: q.difficulty,
    }));

    return MockTest.create({
      user: userId,
      questions,
      totalQuestions: questions.length,
    });
  }

  /**
   * Grades the test, updates Elo ratings for user and questions, and
   * marks the test COMPLETED. All DB writes are committed concurrently.
   *
   * @param {string}   testId      - MockTest _id
   * @param {ObjectId} userId      - Authenticated user's _id
   * @param {Object}   userAnswers - { [questionId]: selectedOptionIndex }
   */
  /**
   * Fetches a single MockTest by ID and returns a fully enriched response:
   *   - top-level metrics (score, percentage, status, duration)
   *   - skills breakdown (per-topic correct/total counts)
   *   - per-question detail (text, options, user answer, correct answer, explanation)
   *
   * @param {string}   testId  - MockTest _id
   * @param {ObjectId} userId  - Authenticated user's _id (ownership check)
   */
  async getTestById(testId, userId) {
    const test = await MockTest.findById(testId).lean();
    if (!test) throw new ApiError(404, "Test not found");
    if (test.user.toString() !== userId.toString())
      throw new ApiError(403, "Forbidden — this test belongs to another user");

    // Fetch live explanations + correctOptionIndex from Question collection
    const questionIds = test.questions.map((q) => q.questionId);
    const liveQuestions = await Question.find(
      { _id: { $in: questionIds } },
      { _id: 1, explanation: 1, correctOptionIndex: 1 },
    ).lean();

    const liveMap = new Map(liveQuestions.map((q) => [q._id.toString(), q]));

    // Answers map: questionId string → selected option index
    const answersMap =
      test.answers instanceof Map
        ? test.answers
        : new Map(Object.entries(test.answers ?? {}));

    // Build per-question detail and accumulate skills breakdown
    const skillsMap = {}; // { topic: { correct, total } }
    const questions = test.questions.map((q) => {
      const qIdStr = q.questionId.toString();
      const live = liveMap.get(qIdStr) ?? {};

      const correctIndex =
        q.correctOptionIndex ?? live.correctOptionIndex ?? null;
      const selectedIndex = answersMap.has(qIdStr)
        ? Number(answersMap.get(qIdStr))
        : null;
      const isCorrect =
        selectedIndex !== null && selectedIndex === correctIndex;
      const isAnswered = selectedIndex !== null;

      // Skills breakdown accumulation
      if (!skillsMap[q.topic]) skillsMap[q.topic] = { correct: 0, total: 0 };
      skillsMap[q.topic].total++;
      if (isCorrect) skillsMap[q.topic].correct++;

      return {
        questionId: q.questionId,
        text: q.text,
        topic: q.topic,
        difficulty: q.difficulty,
        options: q.options,
        correctOptionIndex: correctIndex,
        selectedOptionIndex: selectedIndex,
        isAnswered,
        isCorrect,
        explanation: live.explanation ?? "",
      };
    });

    const skillsCovered = Object.entries(skillsMap).map(([skill, counts]) => ({
      skill,
      correct: counts.correct,
      total: counts.total,
      accuracy:
        counts.total > 0
          ? parseFloat(((counts.correct / counts.total) * 100).toFixed(1))
          : 0,
    }));

    // Duration in seconds (null if test not yet completed)
    const durationSeconds =
      test.startedAt && test.completedAt
        ? Math.round(
            (new Date(test.completedAt) - new Date(test.startedAt)) / 1000,
          )
        : null;

    return {
      testId: test._id,
      status: test.status,
      startedAt: test.startedAt,
      completedAt: test.completedAt ?? null,
      durationSeconds,
      metrics: {
        score: test.score,
        totalQuestions: test.totalQuestions,
        percentage: test.percentage,
      },
      skillsCovered,
      questions,
    };
  }

  async submitTest(testId, userId, userAnswers) {
    const test = await MockTest.findById(testId);
    if (!test) throw new ApiError(404, "Test not found");
    if (test.user.toString() !== userId.toString())
      throw new ApiError(403, "Forbidden — this test belongs to another user");
    if (test.status === "COMPLETED")
      throw new ApiError(400, "Test already submitted");

    const user = await User.findById(userId).select(
      "skillElo solvedQuestionIds",
    );
    if (!user) throw new ApiError(404, "User not found");

    // Mutable in-memory Elo snapshot (carries updates across same-topic questions)
    const initialSkillEloSnapshot = Object.fromEntries(user.skillElo ?? new Map());
    const skillEloSnapshot = { ...initialSkillEloSnapshot };

    // Fetch all live question Elo ratings in a single query
    const questionIds = test.questions.map((q) => q.questionId);
    const liveQuestions = await Question.find(
      { _id: { $in: questionIds } },
      { _id: 1, eloRating: 1 },
    ).lean();
    const liveEloMap = new Map(
      liveQuestions.map((q) => [q._id.toString(), q.eloRating]),
    );

    // Grade each question and compute Elo deltas
    let score = 0;
    const correctQuestionIds = [];
    const bulkOps = [];

    for (const question of test.questions) {
      const qIdStr = question.questionId.toString();
      const selectedOption = userAnswers[qIdStr];
      const isCorrect =
        selectedOption !== undefined &&
        selectedOption === question.correctOptionIndex;

      if (isCorrect) {
        score++;
        correctQuestionIds.push(question.questionId);
      }

      const userElo = skillEloSnapshot[question.topic] ?? 1000;
      const questionElo = liveEloMap.get(qIdStr) ?? 1000;
      const { newUserElo, newQuestionElo } = calculateElo(
        userElo,
        questionElo,
        isCorrect,
      );

      skillEloSnapshot[question.topic] = newUserElo;

      bulkOps.push({
        updateOne: {
          filter: { _id: question.questionId },
          update: { $set: { eloRating: newQuestionElo } },
        },
      });
    }

    const percentage = parseFloat(
      ((score / test.totalQuestions) * 100).toFixed(2),
    );

    // Mutate MockTest document and build User $set payload
    test.answers = new Map(Object.entries(userAnswers));
    test.score = score;
    test.percentage = percentage;
    test.status = "COMPLETED";
    test.completedAt = new Date();

    const skillEloUpdates = Object.fromEntries(
      Object.entries(skillEloSnapshot).map(([skill, elo]) => [
        `skillElo.${skill}`,
        elo,
      ]),
    );

    const eloHistoryDocs = [];
    for (const [skill, newElo] of Object.entries(skillEloSnapshot)) {
      const oldElo = initialSkillEloSnapshot[skill] ?? 1000;
      if (oldElo !== newElo) {
        eloHistoryDocs.push({
          user: userId,
          skill,
          oldElo,
          newElo,
          eloChange: newElo - oldElo,
          sourceType: "MCQ_PRACTICE",
          sourceId: testId,
        });
      }
    }

    await Promise.all([
      test.save(),
      User.findByIdAndUpdate(userId, {
        $set: skillEloUpdates,
        $addToSet: { solvedQuestionIds: { $each: correctQuestionIds } },
      }),
      bulkOps.length > 0 ? Question.bulkWrite(bulkOps) : Promise.resolve(),
      eloHistoryDocs.length > 0 ? EloHistory.insertMany(eloHistoryDocs) : Promise.resolve(),
    ]);

    return {
      testId: test._id,
      score,
      totalQuestions: test.totalQuestions,
      percentage,
    };
  }

  async getMockTestStats(userId) {
    const user = await User.findById(userId).select("skillElo");
    if (!user) throw new ApiError(404, "User not found");

    const aggregation = await MockTest.aggregate([
      { $match: { user: userId, status: "COMPLETED" } },
      {
        $group: {
          _id: null,
          totalTests: { $sum: 1 },
          averageScore: { $avg: "$percentage" },
        },
      },
    ]);

    let totalTests = 0;
    let averageScore = 0;
    if (aggregation.length > 0) {
      totalTests = aggregation[0].totalTests;
      averageScore = Math.round(aggregation[0].averageScore);
    }

    let strongestSkill = "N/A";
    let maxElo = -1;
    if (user.skillElo) {
      for (const [skill, elo] of user.skillElo.entries()) {
        if (elo > maxElo) {
          maxElo = elo;
          strongestSkill = skill;
        }
      }
    }

    const recentTests = await MockTest.find({ user: userId, status: "COMPLETED" })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const formattedHistory = recentTests.map((t) => {
      const skillsInvolved = [
        ...new Set((t.questions || []).map((q) => q.topic).filter(Boolean)),
      ];
      return {
        id: t._id,
        date: t.createdAt,
        score: Math.round(t.percentage),
        skillsInvolved,
      };
    });

    return {
      totalTests,
      averageScore,
      strongestSkill,
      recentTests: formattedHistory,
    };
  }
}

export const mockTestService = new MockTestService();
