import mongoose, { Schema } from "mongoose";

const mockTestSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Snapshot of questions at test creation time — prevents
    // historical data mutation if question data changes later
    questions: [
      {
        _id: false,
        questionId: {
          type: Schema.Types.ObjectId,
          ref: "Question",
          required: true,
        },
        text: String,
        options: [String],
        correctOptionIndex: Number,
        topic: String,
        difficulty: String,
      },
    ],

    // Map<questionId (string) → selectedOptionIndex (number)>
    answers: {
      type: Map,
      of: Number,
      default: {},
    },

    score: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    totalQuestions: { type: Number, required: true },

    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED", "ABANDONED"],
      default: "IN_PROGRESS",
    },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

// Optimizes queries like "find latest tests for a user"
mockTestSchema.index({ user: 1, createdAt: -1 });

export const MockTest = mongoose.model("MockTest", mockTestSchema);
