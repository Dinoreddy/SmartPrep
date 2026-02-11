import fs from "fs";
import { PDFParse } from "pdf-parse";
import Groq from "groq-sdk";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";

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
      throw new ApiError(409, "Resume already uploaded. Please use the update endpoint to overwrite.");
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
        throw new ApiError(400, "Resume PDF appears to be empty or unreadable.");
      }

      // 2. Analyze with AI
      const analysis = await this.analyzeWithAI(rawText);

      // 3. Update User Profile in DB
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            "resumeProfile.hasUploaded": true,
            "resumeProfile.seniority": analysis.seniority,
            "resumeProfile.yoe": analysis.yoe,
            "resumeProfile.topSkills": analysis.topSkills,
            "resumeProfile.projects": analysis.projects,
            "resumeProfile.rawAnalysis": analysis, // Backup full data
            
            // Initialize their Elo ratings based on skills found
            // If they know React, we add "React": 1000 to their stats
            ...this.initializeSkillElo(analysis.topSkills)
          }
        },
        { new: true }
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
      ${resumeText.substring(0, 10000)} // Truncate to avoid token limits

      OUTPUT REQUIREMENTS:
      Return ONLY a valid JSON object with this exact structure:
      {
        "seniority": "Junior" | "Mid" | "Senior",
        "yoe": Number (Total Years of Experience),
        "topSkills": ["Skill1", "Skill2", ...], (Max 10 technical skills)
        "projects": [
          {
            "name": "Project Name",
            "techStack": ["Tech1", "Tech2"],
            "description": "Brief summary (max 1 sentence)"
          }
        ]
      }
      
      Do not include any markdown formatting (like \`\`\`json). Just the raw JSON string.
    `;

    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile", // Fast and cheap
        temperature: 0.1, // Low temperature = more consistent JSON
      });

      const result = completion.choices[0]?.message?.content || "{}";
      
      // Sanitize response (sometimes AI adds markdown anyway)
      const cleanJson = result.replace(/```json/g, "").replace(/```/g, "").trim();
      
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("AI Analysis Failed:", error);
      throw new ApiError(500, "Failed to analyze resume with AI");
    }
  }

  /**
   * Helper: Create initial Elo map
   */
  initializeSkillElo(skills) {
    const skillEloUpdates = {};
    skills.forEach(skill => {
      // MongoDB Syntax for updating Map fields: "skillElo.React": 1000
      skillEloUpdates[`skillElo.${skill}`] = 1000;
    });
    return skillEloUpdates;
  }
}

export const resumeService = new ResumeService();