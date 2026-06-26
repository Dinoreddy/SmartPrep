import mongoose, { Schema } from "mongoose";

const eloHistorySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    skill: {
      type: String,
      required: true,
    },
    oldElo: {
      type: Number,
      required: true,
    },
    newElo: {
      type: Number,
      required: true,
    },
    eloChange: {
      type: Number,
      required: true,
    },
    sourceType: {
      type: String,
      enum: ["MCQ_PRACTICE", "VOICE_MOCK"],
      required: true,
    },
    sourceId: {
      type: Schema.Types.ObjectId,
      required: true,
      // Cannot enforce strict ref because it could point to MockTest or LiveInterview
    },
  },
  { timestamps: true },
);

// Index for efficiently querying trend over time per user per skill
eloHistorySchema.index({ user: 1, skill: 1, createdAt: -1 });

export const EloHistory = mongoose.model("EloHistory", eloHistorySchema);
