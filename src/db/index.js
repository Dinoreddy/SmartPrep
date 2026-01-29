import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

/**
 * Connect to MongoDB using Mongoose.
 * Expects MONGO_URI in environment variables.
 */
export async function connectDB() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error(
      "Missing MONGO_URI. Set it in your environment, e.g. MONGO_URI=mongodb://localhost:27017/smart_prep"
    );
  }

  // Avoid re-connecting if already connected (useful in tests / hot-reload).
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  mongoose.connection.on("connected", () => {
    // eslint-disable-next-line no-console
    console.log("MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("MongoDB connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    // eslint-disable-next-line no-console
    console.warn("MongoDB disconnected");
  });

  await mongoose.connect(mongoUri, {
    autoIndex: true,
    dbName: DB_NAME,
  });

  return mongoose.connection;
}

