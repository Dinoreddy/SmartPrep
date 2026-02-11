import mongoose from "mongoose";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { User } from "../src/models/user.model.js";
import { Question } from "../src/models/question.model.js";
import { generateQuestionsWithGroq } from "../src/utils/aiHelper.js";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Configuration
const BATCH_CONFIG = [
  { count: 15, difficulty: "Easy", elo: 800 },
  { count: 30, difficulty: "Medium", elo: 1000 },
  { count: 15, difficulty: "Hard", elo: 1500 }
];

import { DB_NAME } from "../src/constants.js";

const MONGO_URI = process.env.MONGO_URI;

async function getUniqueSkills() {
  console.log("🔍 Finding unique skills from users...");
  
  // DEBUG SECTION
  try {
     // Connect with DB_NAME to ensure we hit the right DB
     if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
        console.log(`✅ Connected to DB: ${DB_NAME}`);
     }

     const count = await User.countDocuments();
     console.log(`📊 Total Users in DB: ${count}`);
     
     if (count > 0) {
        const firstUser = await User.findOne();
        console.log("👤 First User Found ID:", firstUser._id);
        console.log("👤 First User Resume Profile:", JSON.stringify(firstUser.resumeProfile, null, 2));

        // Check if topSkills field exists specifically
        const withSkills = await User.countDocuments({ "resumeProfile.topSkills": { $exists: true, $not: { $size: 0 } } });
        console.log(`� Users with topSkills > 0: ${withSkills}`);
     } else {
        console.error("❌ DB appears empty! Check MONGO_URI and collection name.");
        // List collections to verify
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log("� Available Collections:", collections.map(c => c.name));
     }

  } catch (err) {
     console.error("❌ Error during debug inspection:", err);
  }

  // Aggregate all skills from all users
  const uniqueSkills = await User.distinct("resumeProfile.topSkills");
  
  // Filter out empty or null skills
  return uniqueSkills.filter(s => s && s.trim().length > 0);
}

async function generateQuestionsForSkill(skill, count, difficulty, elo) {
  // Use Helper Function
  const parsed = await generateQuestionsWithGroq(groq, skill, count, difficulty);

  return parsed.map(q => ({
      ...q,
      difficulty,
      eloRating: elo,
      source: "AI_Groq_Seed",
      isVerified: false
  }));
}

async function seed() {
  try {
    // Connection is handled inside getUniqueSkills or we can do it here globally
    console.log("🌱 Starting Seed Script...");
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
        console.log(`✅ Connected to DB: ${DB_NAME}`);
    }

    const skills = await getUniqueSkills();
    console.log(`Found ${skills.length} unique skills:`, skills);

    for (const skill of skills) {
      console.log(`\n👉 Processing Skill: ${skill}`);
      
      for (const config of BATCH_CONFIG) {
        console.log(`   Generating ${config.count} ${config.difficulty} questions...`);
        
        // Split into chunks if count is large (Groq might truncate large responses)
        // Llama 3.3 70b has good output window, but 30 questions might be tight.
        // Let's do batches of 10 to be safe.
        const CHUNK_SIZE = 10;
        let generatedCount = 0;
        
        while (generatedCount < config.count) {
          const currentBatchSize = Math.min(CHUNK_SIZE, config.count - generatedCount);
          
          const questions = await generateQuestionsForSkill(
            skill, 
            currentBatchSize, 
            config.difficulty, 
            config.elo
          );

          if (questions.length > 0) {
            await Question.insertMany(questions);
            generatedCount += questions.length;
            console.log(`      Saved ${questions.length} questions. (Total: ${generatedCount}/${config.count})`);
          } else {
            console.warn(`      Skipping batch due to error.`);
            break; // Stop trying this config if error persists
          }
        }
      }
    }

    console.log("\n✅ Seeding Complete!");
    process.exit(0);

  } catch (error) {
    console.error("FATAL ERROR:", error);
    process.exit(1);
  }
}

seed();
