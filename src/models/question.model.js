import mongoose, { Schema } from "mongoose";

const questionSchema = new Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
    options: {
      type: [String], // Array of 4 strings
      required: true,
      validate: [arrayLimit, "{PATH} exceeds the limit of 4"],
    },
    correctOptionIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 3,
    },
    explanation: {
      type: String,
      default: "",
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },
    eloRating: { 
      type: Number, 
      default: 1000, 
      index: true // Critical for range queries ($gte, $lte)
    },
    topics: {
      type: [String],
      index: true, // Important for performance
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      default: "AI_Groq",
    },
  },
  { timestamps: true }
);

function arrayLimit(val) {
  return val.length === 4;
}

export const Question = mongoose.model("Question", questionSchema);