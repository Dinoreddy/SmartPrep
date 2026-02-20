import fs from "fs";
import { PDFParse } from "pdf-parse";
import Groq from "groq-sdk";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { normalizeSkillList } from "../utils/skillNormalizer.js";
import { CORE_SKILLS } from "../constants.js";

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

      // 3. Normalize resume skills and merge with CORE_SKILLS (deduplicated)
      const resumeSkills = normalizeSkillList(analysis.skills);
      const allSkills = [...new Set([...resumeSkills, ...CORE_SKILLS])];

      // 4. Build a smart Elo map:
      //    - New skills get the default 1000.
      //    - Skills the user already has retain their EARNED rating.
      //    - Skills absent from the new resume are DROPPED (map is fully replaced).
      const currentElo = user.skillElo || {};
      const newSkillElo = this.mergeSkillElo(allSkills, currentElo);

      // 5. Update User Profile in DB
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            "resumeProfile.hasUploaded": true,
            "resumeProfile.seniority": analysis.seniority,
            "resumeProfile.yoe": analysis.yoe,
            "resumeProfile.skills": allSkills,
            "resumeProfile.projects": analysis.projects,
            "resumeProfile.rawAnalysis": analysis,
            // Replace the entire map atomically — no stale skills survive
            skillElo: newSkillElo,
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
You are an expert technical recruiter and Senior Staff Engineer. Analyze the following resume text and extract structured data in strict JSON format. 

You MUST extract data from ALL of these sections if they exist: "Experience", "Projects", "Activities", "Hackathons", and "Positions of Responsibility". Treat items from all these sections as "projects".

RESUME TEXT:
${resumeText.substring(0, 10000)}

OUTPUT REQUIREMENTS:
Return ONLY a valid JSON object. Do not include markdown formatting or backticks.
{
  "seniority": "Junior" | "Mid" | "Senior",
  "yoe": <number>,
  "skills": ["<string>", ...],
  "projects": [
    {
      "name": "<project name or hackathon name>",
      "techStack": ["<Tech1>", "<Tech2>", "...extract EVERY technology, database, or tool mentioned in the description"],
      "description": "<A brief 1-2 sentence summary>",
      "context": {
        "architecture": "<Extract system design details e.g., 'Multi-tenant backend', 'RESTful APIs', 'Redis caching', 'Cloudinary CDN'. If none, leave empty.>",
        "keyFeatures": ["<Feature 1 e.g. Atomic Sequelize transactions>", "<Feature 2 e.g. Granular RBAC>", "<Feature 3>"],
        "metrics": "<Extract numbers e.g. 'Optimized API performance'. If none, leave empty.>"
      }
    }
  ]
}

CRITICAL RULES:
1. DO NOT summarize heavily. If the resume mentions "Sequelize transactions", "Redis caching", or "Cloudinary CDN", they MUST be in the context or techStack.
2. You must return the 'context' object for every single project.
3. SKILL NAME NORMALIZATION — This is mandatory. You must map every technology to its single canonical name using the rules below. The goal is that two resumes describing the same skill must always produce the IDENTICAL string.

   CANONICAL NAME RULES:
   - Databases: "MySQL", "PostgreSQL", "MariaDB", "SQL", "Relational DB", "RDBMS" → always output "SQL"
   - NoSQL: "MongoDB", "Mongo" → "MongoDB" | "Firebase Realtime DB", "Firestore" → "Firebase"
   - JavaScript variants: "Javascript", "JS", "ES6", "ES2015" → "JavaScript"
   - TypeScript variants: "Typescript", "TS" → "TypeScript"
   - Node variants: "Node", "Node.js", "NodeJS", "Node JS" → "NodeJS"
   - React variants: "ReactJS", "React.js", "React JS" → "React"
   - Python variants: "python3", "Python 3", "py" → "Python"
   - Express variants: "Express", "Express.js", "ExpressJS" → "ExpressJS"
   - CSS variants: "CSS3", "CSS 3" → "CSS" | "SCSS", "Sass" → "SCSS"
   - Cloud: "Amazon Web Services", "AWS Services" → "AWS" | "Google Cloud Platform", "GCP" → "GCP" | "Microsoft Azure" → "Azure"
   - C++ variants: "C/C++", "CPP" → "C++"
   - General rule: strip version numbers and suffixes. No dots in any name (e.g. "Vue.js" → "VueJS").
    `;

    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        response_format: { type: "json_object" }, // FORCES STRICT JSON
      });

      const result = completion.choices[0]?.message?.content || "{}";
      return JSON.parse(result);
    } catch (error) {
      console.error("AI Analysis Failed:", error);
      throw new ApiError(500, "Failed to analyze resume with AI");
    }
  }

  /**
   * Helper: Build a merged Elo map for the new skill list.
   *
   * Logic:
   *  - If the skill already exists in the current map → keep its earned rating.
   *  - If it's a brand-new skill → initialize to 1000.
   *  - Skills NOT in the new list are simply omitted → entire map is replaced in DB,
   *    so stale skills are purged automatically.
   *
   * @param {string[]} newSkills - Deduplicated list from the new resume + CORE_SKILLS.
   * @param {Map|Object} currentElo - The user's existing skillElo map from MongoDB.
   * @returns {Object} - Plain object suitable for a $set: { skillElo: ... } operation.
   */
  mergeSkillElo(newSkills, currentElo) {
    const merged = {};
    // currentElo is a Mongoose Map — use .get() if available, otherwise bracket access.
    const getElo = (skill) =>
      typeof currentElo.get === "function"
        ? currentElo.get(skill)
        : currentElo[skill];

    newSkills.forEach((skill) => {
      const existing = getElo(skill);
      merged[skill] = existing !== undefined ? existing : 1000;
    });
    return merged;
  }
}

export const resumeService = new ResumeService();
