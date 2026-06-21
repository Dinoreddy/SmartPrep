import Groq from "groq-sdk";
import retry from "async-retry";
import { z } from "zod";
import { SkillTaxonomy } from "../models/skillTaxonomy.model.js";
import { AI_MODELS } from "../constants.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const taxonomySchema = z.object({
  subTopics: z.array(z.string()).min(5).max(30),
});

class TaxonomyService {
  /**
   * Generates a list of sub-topics for a skill using LLM and saves it to the database.
   */
  async generateTaxonomyForSkill(skill) {
    // Check if it already exists
    const existing = await SkillTaxonomy.findOne({ skill });
    if (existing && existing.subTopics.length > 0) {
      return existing;
    }

    console.log(`[Taxonomy] Generating sub-topics for skill: "${skill}"...`);

    const prompt = `
      You are an expert technical interviewer.
      Generate a list of 20 distinct, highly technical sub-topics for the skill/technology: "${skill}".
      These sub-topics should cover different architectural patterns, core concepts, performance optimizations, and advanced features of the skill.

      OUTPUT FORMAT:
      Return a STRICT JSON object with a "subTopics" array of strings.
      Example structure:
      {
        "subTopics": ["Hooks", "Virtual DOM", "Context API", "Server Components", "Performance Optimization"]
      }
    `;

    try {
      const subTopicNames = await retry(
        async () => {
          const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: AI_MODELS.LLM_LIGHT,
            temperature: 0.2,
            response_format: { type: "json_object" },
          });

          const content = completion.choices[0]?.message?.content || '{"subTopics":[]}';
          const parsedJson = JSON.parse(content);

          const validation = taxonomySchema.safeParse(parsedJson);
          if (!validation.success) {
            throw new Error(`Zod validation failed: ${validation.error.message}`);
          }

          return validation.data.subTopics;
        },
        {
          retries: 3,
          minTimeout: 2000,
          onRetry: (err, attempt) => {
            console.warn(`[Taxonomy] Attempt ${attempt} failed: ${err.message}. Retrying...`);
          },
        }
      );

      const subTopics = subTopicNames.map((name) => ({ name, questionCount: 0 }));

      const taxonomy = await SkillTaxonomy.findOneAndUpdate(
        { skill },
        { subTopics },
        { upsert: true, new: true }
      );

      console.log(`[Taxonomy] ✅ Generated ${subTopicNames.length} sub-topics for "${skill}".`);
      return taxonomy;

    } catch (error) {
      console.error(`[Taxonomy] ❌ Failed to generate taxonomy for ${skill}:`, error.message);
      return null;
    }
  }

  /**
   * Finds the sub-topic with the fewest questions for a given skill.
   * If the taxonomy doesn't exist, it generates it first.
   */
  async getTargetedSubTopic(skill) {
    let taxonomy = await SkillTaxonomy.findOne({ skill });

    if (!taxonomy || taxonomy.subTopics.length === 0) {
      taxonomy = await this.generateTaxonomyForSkill(skill);
    }

    if (!taxonomy || taxonomy.subTopics.length === 0) {
      return null; // Failed to generate
    }

    // Sort by questionCount ascending and return the one with the least
    const sorted = [...taxonomy.subTopics].sort((a, b) => a.questionCount - b.questionCount);
    return sorted[0];
  }

  /**
   * Increments the question count for a specific sub-topic
   */
  async incrementSubTopicCount(skill, subTopicName, count = 1) {
    await SkillTaxonomy.updateOne(
      { skill, "subTopics.name": subTopicName },
      { $inc: { "subTopics.$.questionCount": count } }
    );
  }
}

export const taxonomyService = new TaxonomyService();
