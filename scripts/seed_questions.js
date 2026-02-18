import mongoose from "mongoose";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { User } from "../src/models/user.model.js";
import { Question } from "../src/models/question.model.js";
import { generateQuestionsWithGroq } from "../src/utils/aiHelper.js";
import { DB_NAME } from "../src/constants.js";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MONGO_URI = process.env.MONGO_URI;

const BATCH_CONFIG = [
  { count: 5, difficulty: "Easy", elo: 800 },
  { count: 10, difficulty: "Medium", elo: 1000 },
  { count: 5, difficulty: "Hard", elo: 1500 },
];

// const BATCH_CONFIG = [
//   { count: 15, difficulty: "Easy", elo: 800 },
//   { count: 30, difficulty: "Medium", elo: 1000 },
//   { count: 15, difficulty: "Hard", elo: 1500 },
// ];

// Max retries per chunk when the AI returns an empty/invalid response
const MAX_CHUNK_RETRIES = 3;
const CHUNK_SIZE = 10;

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log(`✅ Connected to DB: ${DB_NAME}`);
  }
}

async function getUniqueSkills() {
  const uniqueSkills = await User.distinct("resumeProfile.topSkills");
  return uniqueSkills.filter((s) => s && s.trim().length > 0);
}

async function generateQuestionsForSkill(skill, count, difficulty, elo) {
  const parsed = await generateQuestionsWithGroq(
    groq,
    skill,
    count,
    difficulty,
  );
  return parsed.map((q) => ({
    ...q,
    difficulty,
    eloRating: elo,
    source: "AI_Groq_Seed",
    isVerified: false,
  }));
}

async function seed() {
  try {
    console.log("🌱 Starting Seed Script...");
    await connectDB();

    const skills = await getUniqueSkills();
    console.log(
      `\n🔍 Found ${skills.length} unique skill(s): ${skills.join(", ")}\n`,
    );

    for (const skill of skills) {
      console.log(`👉 Processing skill: "${skill}"`);

      for (const config of BATCH_CONFIG) {
        console.log(
          `   [${config.difficulty}] Generating ${config.count} questions...`,
        );

        let generatedCount = 0;

        while (generatedCount < config.count) {
          const batchSize = Math.min(CHUNK_SIZE, config.count - generatedCount);
          let questions = [];
          let attempt = 0;

          // Retry the chunk until we get results or exhaust retries
          while (attempt < MAX_CHUNK_RETRIES) {
            questions = await generateQuestionsForSkill(
              skill,
              batchSize,
              config.difficulty,
              config.elo,
            );

            if (questions.length > 0) break;

            attempt++;
            console.warn(
              `      ⚠️  Empty response for chunk. Retry ${attempt}/${MAX_CHUNK_RETRIES}...`,
            );
          }

          if (questions.length === 0) {
            console.error(
              `      ❌ Failed to generate chunk after ${MAX_CHUNK_RETRIES} retries. Skipping remaining questions for [${config.difficulty}].`,
            );
            break;
          }

          await Question.insertMany(questions);
          generatedCount += questions.length;
          console.log(
            `      ✅ Saved ${questions.length} questions. (${generatedCount}/${config.count})`,
          );
        }
      }

      console.log();
    }

    console.log("✅ Seeding Complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

seed();
