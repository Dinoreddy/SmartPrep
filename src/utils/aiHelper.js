/**
 * Helper function to generate questions using Groq AI.
 * 
 * @param {Object} groqInstance - Inherited Groq instance
 * @param {String} topic - The topic/skill to generate questions for
 * @param {Number} count - Number of questions to generate
 * @param {String} difficulty - Difficulty level (Easy, Medium, Hard)
 * @returns {Promise<Array>} - Array of parsed question objects
 */
// Helper to pause execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateQuestionsWithGroq(groqInstance, topic, count, difficulty, maxRetries = 5) {
  const prompt = `
    Create ${count} multiple-choice interview questions for the topic: "${topic}".
    Difficulty: ${difficulty}.
    
    OUTPUT FORMAT:
    Return a STRICT JSON ARRAY of objects. No markdown. No text outside JSON.
    [
      {
        "text": "Question text here?",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctOptionIndex": 0, (0-3)
        "explanation": "Why correct option is correct",
        "topics": ["${topic}"] 
      }
    ]
  `;

  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const completion = await groqInstance.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_completion_tokens: 6000, 
      });

      const result = completion.choices[0]?.message?.content || "[]";
      const cleanJson = result.replace(/```json/g, "").replace(/```/g, "").trim();
      
      return JSON.parse(cleanJson);

    } catch (error) {
      attempt++;
      
      // Handle Rate Limiting (429)
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
        const defaultWait = 60 * 1000; // 60 seconds default
        // Try to parse wait time from headers if available (Groq might send 'retry-after')
        // For now, use exponential backoff or strict wait
        const waitTime = defaultWait * attempt; 

        console.warn(`⚠️ Rate limit reached for ${topic}. Waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}...`);
        
        if (attempt > maxRetries) {
          console.error(`❌ Max retries reached for ${topic}. Giving up.`);
          return [];
        }

        await sleep(waitTime);
        continue; // Retry loop directly
      }

      console.error(`AI Helper Error (${topic}):`, error.message);
      return []; // Non-retryable error
    }
  }
  return [];
}
