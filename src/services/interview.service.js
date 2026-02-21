import { User } from "../models/user.model.js";
import { LiveInterview } from "../models/liveInterview.model.js";
import { ApiError } from "../utils/ApiError.js";

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
1. This is a VOICE interview. Keep your responses short, conversational, and natural. 
2. Do not use markdown, code blocks, or bullet points.
3. Start by welcoming the candidate and immediately asking a deep architectural question about one of their projects.
4. Always end your turn with a single, clear question.`;

  console.log(
    `[Interview] Step 3 OK — System prompt built (${systemPrompt.length} chars).`,
  );

  // 4. Get first project name for the initial assistant message
  const firstProjectName =
    user.resumeProfile.projects[0]?.name ?? "your most recent project";

  console.log(`[Interview] Step 4 OK — First project: "${firstProjectName}"`);

  // 5. Initialize Transcript
  console.log(
    `[Interview] Step 5 — Building initial transcript (system + assistant seed)…`,
  );
  const transcript = [
    { role: "system", content: systemPrompt },
    {
      role: "assistant",
      content: `Hello! It is great to meet you. I was looking over your resume and I am really impressed by your background. Let's dive right in. I see you built ${firstProjectName}. Can you walk me through the high-level architecture and the main technical challenges you faced?`,
    },
  ];

  console.log(
    `[Interview] Step 5 OK — Transcript initialised with ${transcript.length} messages.`,
  );

  // 6. Create Document
  console.log(
    `[Interview] Step 6 — Persisting LiveInterview document to MongoDB…`,
  );
  const newInterview = await LiveInterview.create({
    user: userId,
    transcript,
  });

  console.log(`[Interview] Step 6 OK — Document created: ${newInterview._id}`);

  // 7. Return
  console.log(
    `[Interview] ── DONE initializeInterview — interviewId: ${newInterview._id} ──`,
  );
  return {
    interviewId: newInterview._id,
    initialMessage: transcript[1].content,
  };
};

export const interviewService = { initializeInterview };
