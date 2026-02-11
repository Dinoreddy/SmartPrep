import Groq from "groq-sdk";
import { Question } from "../models/question.model.js";
import { generateQuestionsWithGroq } from "../utils/aiHelper.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class QuestionService {
  /**
   * Get practice questions (Adaptive Matchmaking)
   * 1. Check DB for questions matching user's Elo range
   * 2. If not enough, generate more via AI with appropriate difficulty
   * 3. Return combined list
   */
  async getQuestions(topic, limit = 5, userElo = 1000) {
    // 1. Define Elo Range (Review Strategy: +/- 200)
    const minElo = userElo - 200;
    const maxElo = userElo + 200;

    // 2. Fetch from DB
    const existingQuestions = await Question.aggregate([
      { 
        $match: { 
          topics: topic, 
          eloRating: { $gte: minElo, $lte: maxElo } 
        } 
      },
      { $sample: { size: Number(limit) } },
    ]);

    const existingCount = existingQuestions.length;
    const missingCount = Number(limit) - existingCount;

    // 3. If we have enough, return them
    if (missingCount <= 0) {
      return existingQuestions;
    }

    // 4. Generate missing questions - Adaptive Logic
    // If user is <= 1050, give them "Easy" (800) questions to build confidence
    let difficulty = "Medium";
    let baseElo = 1000;

    if (userElo <= 1050) {
      difficulty = "Easy";
      baseElo = 800;
    } else if (userElo > 1450) {
      difficulty = "Hard";
      baseElo = 1500;
    }

    console.log(`[Cache Miss] Generating ${missingCount} questions for ${topic} (Elo: ${userElo} -> ${difficulty})...`);
    
    // Use Helper Function
    const parsedQuestions = await generateQuestionsWithGroq(groq, topic, missingCount, difficulty);
      
    // Sanitize and Add Metadata
    const questionsToSave = parsedQuestions.map(q => ({
        ...q,
        difficulty,
        eloRating: baseElo, // Assign standard Elo for this difficulty tier
        source: "AI_Groq",
        isVerified: false
    }));

    // Bulk Insert to DB
    if (questionsToSave.length > 0) {
        await Question.insertMany(questionsToSave);
    }

    // 5. Return combined
    return [...existingQuestions, ...questionsToSave];
  }
}

export const questionService = new QuestionService();
