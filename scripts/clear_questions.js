import mongoose from "mongoose";
import dotenv from "dotenv";
import { Question } from "../src/models/question.model.js";
import { DB_NAME } from "../src/constants.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

async function clearQuestions() {
  try {
    console.log("🗑️  Connecting to MongoDB...");
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    }
    console.log(`✅ Connected to DB: ${DB_NAME}`);

    const result = await Question.deleteMany({});
    console.log(`✅ Deleted ${result.deletedCount} questions.`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error clearing questions:", error);
    process.exit(1);
  }
}

clearQuestions();
