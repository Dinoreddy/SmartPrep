import fs from "fs";
import { PDFParse } from "pdf-parse";
import Groq from "groq-sdk";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { normalizeSkillList } from "../utils/skillNormalizer.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

class ResumeService {
  /**
   * Main function to handle the resume upload (Create)
   * Throws 409 if resume already exists.
   */
  async processResume(userId, filePath) {
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    if (user.resumeProfile?.hasUploaded) {
      // 409 Conflict: Resource already exists
      throw new ApiError(
        409,
        "Resume already uploaded. Please use the update endpoint to overwrite.",
      );
    }

    return await this._processResumeInternal(user, filePath);
  }

  /**
   * Main function to handle the resume update (Overwrite)
   * Doesn't care if resume exists or not.
   */
  async updateResume(userId, filePath) {
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return await this._processResumeInternal(user, filePath);
  }

  /**
   * Internal Helper: Core logic for parsing and AI analysis
   * @param {Object} user - The mongoose user document
   * @param {String} filePath - Path to the temp PDF file
   */
  async _processResumeInternal(user, filePath) {
    try {
      // 1. Extract Text from PDF (Non-blocking)
      const dataBuffer = await fs.promises.readFile(filePath);
      const parser = new PDFParse({ data: dataBuffer });
      const pdfData = await parser.getText();
      const rawText = pdfData.text;

      if (!rawText || rawText.length < 50) {
        throw new ApiError(
          400,
          "Resume PDF appears to be empty or unreadable.",
        );
      }

      // 2. Analyze with AI
      const analysis = await this.analyzeWithAI(rawText);

      // 3. Normalize skills before persisting
      const normalizedSkills = normalizeSkillList(analysis.topSkills);

      // 4. Update User Profile in DB
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            "resumeProfile.hasUploaded": true,
            "resumeProfile.seniority": analysis.seniority,
            "resumeProfile.yoe": analysis.yoe,
            "resumeProfile.topSkills": normalizedSkills,
            "resumeProfile.projects": analysis.projects,
            "resumeProfile.rawAnalysis": analysis,
            ...this.initializeSkillElo(normalizedSkills),
          },
        },
        { new: true },
      ).select("-password -refreshToken");

      return updatedUser;
    } catch (error) {
      throw error;
    } finally {
      // 4. Cleanup: Delete local file (Always run, even on error)
      try {
        if (filePath && fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (cleanupError) {
        console.error("Failed to delete temp resume file:", cleanupError);
      }
    }
  }

  /**
   * Helper: Send text to Groq/Llama 3
   */
  async analyzeWithAI(resumeText) {
    const prompt = `
You are an expert technical recruiter. Analyze the following resume text and extract structured data in strict JSON format.

RESUME TEXT:
${resumeText.substring(0, 10000)}

OUTPUT REQUIREMENTS:
Return ONLY a valid JSON object with this exact structure. No markdown, no code fences, no extra text.
{
  "seniority": "Junior" | "Mid" | "Senior",
  "yoe": <number>,
  "topSkills": [<string>, ...],
  "projects": [
    {
      "name": "<project name>",
      "techStack": ["<Tech1>", "<Tech2>"],
      "description": "<one sentence summary>"
    }
  ]
}

RULES FOR topSkills:
- List at most 10 technical skills.
- Use clean, canonical names with NO dots (e.g. "React", "NodeJS", "TypeScript", "ExpressJS").
- Do NOT include soft skills (e.g. communication, teamwork).
    `;

    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile", // Fast and cheap
        temperature: 0.1, // Low temperature = more consistent JSON
      });

      const result = completion.choices[0]?.message?.content || "{}";

      // Sanitize response (sometimes AI adds markdown anyway)
      const cleanJson = result
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("AI Analysis Failed:", error);
      throw new ApiError(500, "Failed to analyze resume with AI");
    }
  }

  /**
   * Helper: Build initial Elo map for a user's skills.
   * Dot-notation is safe here because normalizeSkillList() guarantees no dots in skill names.
   */
  initializeSkillElo(skills) {
    const updates = {};
    skills.forEach((skill) => {
      updates[`skillElo.${skill}`] = 1000;
    });
    return updates;
  }
}

export const resumeService = new ResumeService();
