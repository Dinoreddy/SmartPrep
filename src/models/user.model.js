import mongoose, { Schema } from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    refreshToken: {
      type: String,
    },

    // ==========================================
    // Feature 1: Resume Profile (The "Context")
    // ==========================================
    resumeProfile: {
      hasUploaded: { type: Boolean, default: false },
      s3Key: String, // Cloudflare/S3 URL for the PDF

      // Extracted Metadata
      seniority: {
        type: String,
        enum: ["Junior", "Mid", "Senior"],
        default: "Junior",
      },
      yoe: { type: Number, default: 0 },
      skills: [String],

      // Detailed Project Context for the AI Interviewer
      projects: [
        {
          name: String,
          techStack: [String],
          description: String,
        },
      ],
    },

    // ==========================================
    // Feature 2: Adaptive Stats (The "Elo Ratings")
    // ==========================================
    // Tracks current skill level. New skills can be added dynamically.
    skillElo: {
      type: Map,
      of: Number,
      default: { General: 1000 },
    },

    // ==========================================
    // Feature 3: Question Repetition Handling
    // ==========================================
    // Tracks correctly answered questions to serve fresh ones first.
    solvedQuestionIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Question",
      },
    ],
  },
  { timestamps: true },
);

// 🔒 Encrypt password before saving
// In Mongoose 9, use async middleware *without* `next`.
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// 🔑 Check password
userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// 🎫 Generate Access Token (Short lived)
userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      username: this.username,
      fullName: this.fullName,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    },
  );
};

// 🔄 Generate Refresh Token (Long lived)
userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    },
  );
};

export const User = mongoose.model("User", userSchema);
