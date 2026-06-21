import "dotenv/config";
import mongoose from "mongoose";
import Groq from "groq-sdk";
import { User } from "../src/models/user.model.js";
import { Question } from "../src/models/question.model.js";
import { generateQuestionsWithGroq } from "../src/utils/aiHelper.js";
import { DB_NAME } from "../src/constants.js";
import { taxonomyService } from "../src/services/taxonomy.service.js";


const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MONGO_URI = process.env.MONGO_URI;

// Target counts per skill per difficulty tier
const BATCH_CONFIG = [
  { count: 5, difficulty: "Easy", elo: 800 },
  { count: 10, difficulty: "Medium", elo: 1000 },
  { count: 5, difficulty: "Hard", elo: 1500 },
];

const CHUNK_SIZE = 5;

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log(`✅ Connected to DB: ${DB_NAME}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getUniqueSkills() {
  const uniqueSkills = await User.distinct("resumeProfile.skills");
  return uniqueSkills.filter((s) => s && s.trim().length > 0);
}

async function countExisting(skill, difficulty) {
  return Question.countDocuments({ topics: skill, difficulty });
}

async function fetchAntiContextTexts(skill, subTopicName, limit = 10) {
  // Fetch recent questions for this skill to avoid duplicates.
  const existing = await Question.find({ topics: skill })
    .sort({ createdAt: -1 })
    .select("text")
    .limit(limit)
    .lean();

  // Ensure unique texts
  return [...new Set(existing.map((q) => q.text))];
}

async function seed() {
  try {
    console.log("🌱 Starting Seed Script...");
    await connectDB();

    const skills = await getUniqueSkills();
    console.log(`\n🔍 Found ${skills.length} unique skill(s): ${skills.join(", ")}\n`);

    for (const skill of skills) {
      console.log(`\n👉 Processing skill: "${skill}"`);

      for (const config of BATCH_CONFIG) {
        const existingCount = await countExisting(skill, config.difficulty);
        const needed = config.count - existingCount;

        if (needed <= 0) {
          console.log(`   [${config.difficulty}] ✅ Already has ${existingCount}/${config.count} — skipping.`);
          continue;
        }

        console.log(`   [${config.difficulty}] Has ${existingCount}/${config.count} — generating ${needed} more...`);

        let generatedCount = 0;

        while (generatedCount < needed) {
          const batchSize = Math.min(CHUNK_SIZE, needed - generatedCount);
          
          // 1. Get targeted sub-topic
          const targetSubTopic = await taxonomyService.getTargetedSubTopic(skill);
          const subTopicName = targetSubTopic ? targetSubTopic.name : null;
          
          console.log(`      🎯 Targeted Sub-Topic: ${subTopicName || "General"}`);

          // 2. Fetch anti-context
          const antiContextTexts = await fetchAntiContextTexts(skill, subTopicName || skill);

          // 3. Generate
          const parsedQuestions = await generateQuestionsWithGroq(
            groq,
            skill,
            batchSize,
            config.difficulty,
            subTopicName,
            antiContextTexts
          );

          if (!parsedQuestions || parsedQuestions.length === 0) {
            console.error(`      ❌ Failed to generate chunk. Skipping remaining [${config.difficulty}] questions.`);
            break;
          }

          const questionsToSave = parsedQuestions.map((q) => ({
            ...q,
            difficulty: config.difficulty,
            eloRating: config.elo,
            source: "AI_Groq_Seed",
            isVerified: false,
            // Ensure topic array is set to the main skill
            topics: [skill],
          }));

          await Question.insertMany(questionsToSave);
          
          // 4. Update taxonomy counts
          if (subTopicName) {
            await taxonomyService.incrementSubTopicCount(skill, subTopicName, questionsToSave.length);
          }

          generatedCount += questionsToSave.length;
          console.log(`      ✅ Saved ${questionsToSave.length} questions. (${existingCount + generatedCount}/${config.count})`);
          
          // Artificial delay to respect free tier rate limits (8 seconds)
          console.log(`      ⏳ Sleeping for 8 seconds to respect Groq rate limits...`);
          await sleep(8000);
        }
      }
    }

    console.log("\n✅ Seeding Complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
}

seed();
