import "dotenv/config";
import mongoose from "mongoose";
import { DB_NAME } from "../src/constants.js";
import { seedService } from "../src/services/seed.service.js";

const MONGO_URI = process.env.MONGO_URI;

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log(`✅ Connected to DB: ${DB_NAME}`);
  }
}

async function start() {
  try {
    await connectDB();
    await seedService.run();
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error in script:", error);
    process.exit(1);
  }
}

start();
