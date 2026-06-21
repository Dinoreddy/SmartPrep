import { z } from "zod";
import retry from "async-retry";
import { AI_MODELS } from "../constants.js";

// Define the Zod schema for a single question
const questionSchema = z.object({
  text: z.string(),
  options: z.array(z.string()).length(4),
  correctOptionIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  topics: z.array(z.string())
});

// The output from JSON mode should be an object containing an array of questions
const responseSchema = z.object({
  questions: z.array(questionSchema)
});

/**
 * Helper function to generate questions using Groq AI.
 * 
 * @param {Object} groqInstance - Inherited Groq instance
 * @param {String} topic - The main skill/topic (e.g., "React")
 * @param {Number} count - Number of questions to generate
 * @param {String} difficulty - Difficulty level (Easy, Medium, Hard)
 * @param {String} subTopic - The specific sub-topic (e.g., "Virtual DOM"). Optional.
 * @param {Array<String>} antiContextTexts - Array of existing question texts to avoid duplicating
 * @returns {Promise<Array>} - Array of parsed question objects
 */
export async function generateQuestionsWithGroq(groqInstance, topic, count, difficulty, subTopic = null, antiContextTexts = []) {
  let antiContextPrompt = "";
  if (antiContextTexts && antiContextTexts.length > 0) {
    antiContextPrompt = `
    CRITICAL: DO NOT generate questions that are similar to the following existing questions:
    ${antiContextTexts.map((q, i) => `${i + 1}. ${q}`).join("\n")}
    `;
  }

  const topicContext = subTopic 
    ? `strictly about the sub-topic "${subTopic}" within the context of "${topic}"`
    : `for the topic: "${topic}"`;

  const prompt = `
    Create ${count} multiple-choice interview questions ${topicContext}.
    Difficulty: ${difficulty}.
    ${antiContextPrompt}
    
    OUTPUT FORMAT:
    Return a STRICT JSON object with a "questions" array containing the question objects.
    Example structure:
    {
      "questions": [
        {
          "text": "Question text here?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctOptionIndex": 0,
          "explanation": "Why correct option is correct",
          "topics": ["${topic}"] 
        }
      ]
    }
  `;

  try {
    const result = await retry(
      async (bail, attempt) => {
        const completion = await groqInstance.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: AI_MODELS.LLM_LIGHT,
          temperature: 0.3,
          max_completion_tokens: 2500,
          response_format: { type: "json_object" }, // Forces strict JSON output
        });

        const content = completion.choices[0]?.message?.content || '{"questions":[]}';
        let parsedJson;

        try {
          parsedJson = JSON.parse(content);
        } catch (err) {
          throw new Error("Failed to parse JSON response from LLM");
        }

        // Validate the structure with Zod
        const validation = responseSchema.safeParse(parsedJson);
        if (!validation.success) {
          throw new Error(`Zod validation failed: ${validation.error.message}`);
        }

        return validation.data.questions;
      },
      {
        retries: 5,
        factor: 2,
        minTimeout: 5000,
        maxTimeout: 30000,
        onRetry: (err, attempt) => {
          console.warn(`[AI Helper] Attempt ${attempt} failed: ${err.message}. Retrying...`);
        },
      }
    );

    return result || [];
  } catch (error) {
    console.error(`[AI Helper] Final failure generating questions for ${topic} (Sub: ${subTopic}):`, error.message);
    return [];
  }
}
