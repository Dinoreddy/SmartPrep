import Groq from "groq-sdk";
import { User } from "../models/user.model.js";
import { Question } from "../models/question.model.js";
import { generateQuestionsWithGroq } from "../utils/aiHelper.js";
import { taxonomyService } from "./taxonomy.service.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const BATCH_CONFIG = [
  { count: 5, difficulty: "Easy", elo: 800 },
  { count: 10, difficulty: "Medium", elo: 1000 },
  { count: 5, difficulty: "Hard", elo: 1500 },
];

const CHUNK_SIZE = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class SeedService {
  async getUniqueSkills() {
    const uniqueSkills = await User.distinct("resumeProfile.skills");
    const skillEloKeysRaw = await User.find().select("skillElo").lean();
    
    // Extract keys from skillElo maps
    const skillEloKeys = [];
    for (const doc of skillEloKeysRaw) {
      if (doc.skillElo) {
        skillEloKeys.push(...Object.keys(doc.skillElo));
      }
    }

    // Merge both sources and clean up
    const allSkills = [...new Set([...uniqueSkills, ...skillEloKeys])];
    return allSkills.filter((s) => s && s.trim().length > 0);
  }

  async countExisting(skill, difficulty) {
    return Question.countDocuments({ topics: skill, difficulty });
  }

  async fetchAntiContextTexts(skill, subTopicName, limit = 10) {
    const existing = await Question.find({ topics: skill })
      .sort({ createdAt: -1 })
      .select("text")
      .limit(limit)
      .lean();

    return [...new Set(existing.map((q) => q.text))];
  }

  async run() {
    try {
      console.log("🌱 Starting Seed Service...");

      const skills = await this.getUniqueSkills();
      console.log(`\n🔍 Found ${skills.length} unique skill(s): ${skills.join(", ")}\n`);

      for (const skill of skills) {
        console.log(`\n👉 Processing skill: "${skill}"`);

        for (const config of BATCH_CONFIG) {
          const existingCount = await this.countExisting(skill, config.difficulty);
          const needed = config.count - existingCount;

          if (needed <= 0) {
            console.log(`   [${config.difficulty}] ✅ Already has ${existingCount}/${config.count} — skipping.`);
            continue;
          }

          console.log(`   [${config.difficulty}] Has ${existingCount}/${config.count} — generating ${needed} more...`);

          let generatedCount = 0;

          while (generatedCount < needed) {
            const batchSize = Math.min(CHUNK_SIZE, needed - generatedCount);
            
            const targetSubTopic = await taxonomyService.getTargetedSubTopic(skill);
            const subTopicName = targetSubTopic ? targetSubTopic.name : null;
            
            console.log(`      🎯 Targeted Sub-Topic: ${subTopicName || "General"}`);

            const antiContextTexts = await this.fetchAntiContextTexts(skill, subTopicName || skill);

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
              topics: [skill], // Force exact topic
            }));

            await Question.insertMany(questionsToSave);
            
            if (subTopicName) {
              await taxonomyService.incrementSubTopicCount(skill, subTopicName, questionsToSave.length);
            }

            generatedCount += questionsToSave.length;
            console.log(`      ✅ Saved ${questionsToSave.length} questions. (${existingCount + generatedCount}/${config.count})`);
            
            console.log(`      ⏳ Sleeping for 8 seconds to respect Groq rate limits...`);
            await sleep(8000);
          }
        }
      }

      console.log("\n✅ Seeding Complete!");
    } catch (error) {
      console.error("❌ Fatal error in Seed Service:", error);
    }
  }
}

export const seedService = new SeedService();
