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

      return projectStr;
    })
    .join("\n\n");

  console.log(`[Interview] Step 2 OK — Projects formatted.`);

  // 3. Build System Prompt
  const systemPrompt = `You are a Senior Engineering Manager conducting a highly technical, rigorous voice interview. The candidate's seniority is ${user.resumeProfile.seniority}. 
Here are their skills: ${user.resumeProfile.skills.join(", ")}.
Here are their core projects and architectural implementations:
${formattedProjects}

RULES:
1. VOICE INTERVIEW FORMAT: Keep your responses short, conversational, and natural. Do not use markdown, code blocks, or bullet points.
2. PROGRESSIVE QUESTIONING: When discussing a project, start with standard/basic questions to understand their role and the general architecture. 
3. DRILL DOWN: As the candidate explains the project, ask progressively deeper, more complex questions based on their answers. Probe into trade-offs, edge cases, scalability bottlenecks, and specific technical decisions they made. 
4. STAY FOCUSED: Do not jump between projects quickly. Stay focused on a single project until you have comprehensively evaluated their technical depth on it.
5. SINGLE QUESTION: Always end your turn with a single, clear, focused question.`;

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

  const greetingPrompt = `Write a short, conversational, 1-2 sentence greeting for the candidate. Welcome them, briefly express interest in their background, and immediately ask them a high-level or fundamental question specifically about their project named "${firstProjectName}" to get them started talking about it. Do not use markdown, bullet points, or list formatting. Keep it strictly conversational and easy to speak out loud.`;

  let dynamicGreeting = `Hello! It is great to meet you. I was looking over your resume and I am really impressed by your background. Let's dive right in. I see you built ${firstProjectName}. Can you walk me through the high-level architecture and the main technical challenges you faced?`; // Fallback

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
You are an expert Senior Engineering Manager evaluating a candidate's voice interview transcript.
Review the conversation below and assign a score out of 100 based on their technical accuracy, problem-solving, and communication clarity.
Also provide a brief 2-3 sentence feedback summary directly addressing the candidate.

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
