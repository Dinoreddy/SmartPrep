import mongoose, { Schema } from "mongoose";

const questionSchema = new Schema(
  {
    text: {
      type: String,
      required: true,
    },
    // Optional code block for technical questions
    codeSnippet: {
      type: String, 
      default: "",
    },
    options: {
      type: [String], // ["A", "B", "C", "D"]
      required: true,
      validate: [(val) => val.length === 4, '{PATH} must have exactly 4 options'],
    },
    correctOptionIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 3,
    },
    explanation: {
      type: String,
      default: "No explanation provided."
    },

    // ==========================================
    // Adaptive Engine Data
    // ==========================================
    topics: [{ type: String, index: true }], // ["React", "Hooks"]
    
    // "Static" label for humans
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      required: true,
    },
    
    // "Dynamic" rating for the Algorithm (IRT)
    eloRating: { 
      type: Number, 
      default: 1000, 
      index: true 
    },

    // ==========================================
    // Admin / Quality Control
    // ==========================================
    source: {
      type: String,
      enum: ["Human", "AI_Groq", "AI_Gemini"],
      default: "AI_Groq"
    },
    // AI questions start as false, Human as true
    isVerified: {
      type: Boolean,
      default: false 
    }
  },
  { timestamps: true }
);

export const Question = mongoose.model("Question", questionSchema);