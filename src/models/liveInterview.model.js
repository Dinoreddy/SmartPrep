import mongoose, { Schema } from "mongoose";

const transcriptEntrySchema = new Schema(
  {
    role: {
      type: String,
      enum: ["system", "assistant", "user"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const liveInterviewSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "ABANDONED"],
      default: "ACTIVE",
    },
    transcript: [transcriptEntrySchema],
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    // New analytics fields
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null, // null until graded
    },
    feedback: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

export const LiveInterview = mongoose.model(
  "LiveInterview",
  liveInterviewSchema,
);
