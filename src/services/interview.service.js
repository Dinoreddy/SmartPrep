import { User } from "../models/user.model.js";
import { LiveInterview } from "../models/liveInterview.model.js";
import { ApiError } from "../utils/ApiError.js";
import { voiceService } from "./voice.service.js";
import Groq from "groq-sdk";
import { AI_MODELS } from "../constants.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const initializeInterview = async (userId) => {
  console.log(`[Interview] ── START initializeInterview ── userId: ${userId}`);
  // 1. Fetch User
  console.log(`[Interview] Step 1 — Fetching user from DB…`);
  const user = await User.findById(userId);
  if (!user) {
    console.error(`[Interview] Step 1 FAILED — User not found: ${userId}`);
    throw new ApiError(404, "User not found");
  }
  console.log(
    `[Interview] Step 1 OK — User: ${user.email}, seniority: ${user.resumeProfile?.seniority}, skills: ${user.resumeProfile?.skills?.length ?? 0}, projects: ${user.resumeProfile?.projects?.length ?? 0}`,
  );

  // 2. Format Projects
  console.log(
    `[Interview] Step 2 — Formatting ${user.resumeProfile.projects.length} project(s) for system prompt…`,
  );
  const formattedProjects = user.resumeProfile.projects
    .map((project) => {
      let projectStr = `Project: ${project.name}\n  Tech Stack: ${project.techStack.join(", ")}`;

      if (project.context?.architecture) {
        projectStr += `\n  Architecture: ${project.context.architecture}`;
      }

      if (project.context?.keyFeatures?.length > 0) {
        projectStr += `\n  Key Features: ${project.context.keyFeatures.join(", ")}`;
      }

      // Include metrics so the AI can challenge specific claims
      if (project.context?.metrics) {
        projectStr += `\n  Claimed Impact/Metrics: ${project.context.metrics}`;
      }

      return projectStr;
    })
    .join("\n\n");

  console.log(`[Interview] Step 2 OK — Projects formatted.`);

  // 3. Build System Prompt
  const systemPrompt = `You are Alex, a Senior Engineering Manager at a top-tier tech company with 15 years of software engineering experience. You are direct, thoughtful, and deeply technical. You do not accept surface-level answers. When a candidate gives a vague answer, you always probe deeper with a specific follow-up. For example, if they say "I used Redis for caching", you immediately ask "What cache invalidation strategy did you choose and why?". You are not hostile, but you are not easily satisfied.

The candidate's seniority level is: ${user.resumeProfile.seniority}.
The candidate's listed skills are: ${user.resumeProfile.skills.join(", ")}.

Here are their core projects and architectural implementations:
${formattedProjects}

INTERVIEW STRUCTURE (follow this arc strictly):
- WARM-UP (turns 1-2): Ask a high-level "walk me through" question about the project's overall purpose and your role in it.
- TECHNICAL DEEP-DIVE (turns 3-6): Ask about specific architectural decisions, technology choices, and trade-offs. Frame questions as "Why did you choose X over Y?" or "How did you handle Z?".
- EDGE CASES & FAILURES (turns 7-9): Ask what went wrong during development, what they would do differently, and how the system handles failure modes or race conditions.
- HYPOTHETICAL SCALING (turns 10+): Present a concrete hypothetical scenario. For example: "How would you redesign this system to handle 100x the current users?".

RULES:
1. VOICE FORMAT: Keep your responses short, conversational, and natural. Do not use markdown, code blocks, numbered lists, or bullet points. Speak as if you are face-to-face.
2. STAY FOCUSED: Do not jump between projects quickly. Comprehensively evaluate one project before moving on.
3. SINGLE QUESTION: Always end your turn with exactly one clear, focused question. Never ask two questions at once.
4. CHALLENGE CLAIMS: If the candidate mentioned a specific metric or impact (e.g. "reduced latency by 40%"), challenge it. Ask them to explain exactly how they measured it and what specific engineering change caused that improvement.
5. PROBE VAGUENESS: If the candidate uses a buzzword without explaining it (e.g. "it was scalable" or "we used microservices"), immediately ask them to be more specific.`;

  console.log(
    `[Interview] Step 3 OK — System prompt built (${systemPrompt.length} chars).`,
  );

  // 4. Get first project name for the initial assistant message
  const firstProjectName =
    user.resumeProfile.projects[0]?.name ?? "your most recent project";

  console.log(`[Interview] Step 4 OK — First project: "${firstProjectName}"`);

  // 5. Generate Dynamic Greeting
  console.log(
    `[Interview] Step 5 — Generating dynamic greeting using LLM for project: "${firstProjectName}"…`,
  );

  const greetingPrompt = `Write a short spoken greeting for a technical interview. Follow these rules strictly:
- Use exactly 2-3 short sentences. Each sentence MUST end with a period or question mark.
- Sentence 1: A brief, warm welcome (e.g. "Hi, great to meet you.").
- Sentence 2: One sentence acknowledging you looked at their resume or mentioning the project "${firstProjectName}" by name.
- Sentence 3: ONE single open-ended warm-up question about the project "${firstProjectName}". Ask them to walk you through what it does or the problem it solves. Do NOT ask two questions.
- Do not use commas to chain clauses. Do not use markdown, dashes, or bullet points. Write as you would speak face-to-face.`;

  let dynamicGreeting = `Hi, great to meet you. I had a chance to look over your resume and I'm really interested in ${firstProjectName}. Can you walk me through what the project does and what problem it was built to solve?`; // Fallback

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: greetingPrompt }],
      model: AI_MODELS.LLM_LIGHT,
      temperature: 0.7,
    });
    if (completion.choices[0]?.message?.content) {
      dynamicGreeting = completion.choices[0].message.content.trim();
    }
    console.log(
      `[Interview] Step 5 OK — Dynamic greeting generated: "${dynamicGreeting.slice(0, 80)}…"`,
    );
  } catch (error) {
    console.error(
      `[Interview] Step 5 WARN — Failed to generate dynamic greeting, using fallback.`,
      error,
    );
  }

  // 6. Initialize Transcript
  console.log(
    `[Interview] Step 6 — Building initial transcript (system + assistant seed)…`,
  );
  const transcript = [
    { role: "system", content: systemPrompt },
    {
      role: "assistant",
      content: dynamicGreeting,
    },
  ];

  console.log(
    `[Interview] Step 6 OK — Transcript initialised with ${transcript.length} messages.`,
  );

  // 7. Create Document
  console.log(
    `[Interview] Step 7 — Persisting LiveInterview document to MongoDB…`,
  );
  const newInterview = await LiveInterview.create({
    user: userId,
    transcript,
  });

  console.log(`[Interview] Step 7 OK — Document created: ${newInterview._id}`);

  // 8. Synthesize Initial Message Audio
  console.log(
    `[Interview] Step 8 — Synthesizing initial message audio via Deepgram TTS…`,
  );
  const initialAudioBuffer = await voiceService.synthesizeAndEmit(
    transcript[1].content,
    null,
  );

  if (!initialAudioBuffer) {
    console.error(
      `[Interview] Step 8 FAILED — Could not synthesize initial audio.`,
    );
    throw new ApiError(500, "Failed to generate initial audio greeting");
  }

  // 9. Return
  console.log(
    `[Interview] ── DONE initializeInterview — interviewId: ${newInterview._id} ──`,
  );
  return {
    interviewId: newInterview._id,
    initialAudio: initialAudioBuffer,
    initialMessage: transcript[1].content,
  };
};

const gradeInterview = async (interviewId) => {
  console.log(`[Interview Grading] ── START ── interviewId: ${interviewId}`);
  const interview = await LiveInterview.findById(interviewId);
  
  if (!interview || interview.score !== null) {
    console.log(`[Interview Grading] Skipped. Not found or already graded.`);
    return;
  }

  // Filter out the system prompt, keep only user and assistant
  const conversation = interview.transcript
    .filter((t) => t.role !== "system")
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n\n");

  if (conversation.length < 50) {
    console.log(`[Interview Grading] Transcript too short to grade.`);
    interview.score = 0;
    interview.feedback = "Interview was too short to evaluate.";
    await interview.save();
    return;
  }

  const prompt = `
You are an expert Senior Engineering Manager evaluating a candidate's voice technical interview transcript.
Score the candidate from 0-100 using the following weighted rubric:

- Technical Accuracy (40 points): Were their explanations factually correct? Did they demonstrate a real understanding of the technologies they mentioned, or just buzzwords?
- Problem-Solving Depth (30 points): Did they go beyond surface-level basics into trade-offs, edge cases, and engineering decisions? Did they explain the "why" behind their choices?
- Communication Clarity (20 points): Were their answers concise, structured, and easy to follow? Did they get to the point or ramble?
- Self-Awareness (10 points): Did they honestly acknowledge limitations, mistakes, or things they would do differently? Did they show intellectual humility?

Also provide a 2-3 sentence feedback summary written directly to the candidate in second person ("You demonstrated...", "Your answers on X were..."). Be honest and specific, referencing actual moments from the transcript.

TRANSCRIPT:
${conversation}

Respond strictly in JSON format:
{
  "score": <number 0-100>,
  "feedback": "<string>"
}
`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: AI_MODELS.LLM_HEAVY,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    interview.score = parsed.score;
    interview.feedback = parsed.feedback;
    await interview.save();
    console.log(`[Interview Grading] ── DONE ── Score: ${parsed.score}`);
  } catch (error) {
    console.error(`[Interview Grading] Error grading interview:`, error);
  }
};

export const interviewService = { initializeInterview, gradeInterview };
