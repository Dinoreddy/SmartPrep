import { User } from "../models/user.model.js";
import { LiveInterview } from "../models/liveInterview.model.js";
import { ApiError } from "../utils/ApiError.js";

const initializeInterview = async (userId) => {
  // 1. Fetch User
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // 2. Format Projects
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

  // 4. Get first project name for the initial assistant message
  const firstProjectName =
    user.resumeProfile.projects[0]?.name ?? "your most recent project";

  // 5. Initialize Transcript
  const transcript = [
    { role: "system", content: systemPrompt },
    {
      role: "assistant",
      content: `Hello! It is great to meet you. I was looking over your resume and I am really impressed by your background. Let's dive right in. I see you built ${firstProjectName}. Can you walk me through the high-level architecture and the main technical challenges you faced?`,
    },
  ];

  // 6. Create Document
  const newInterview = await LiveInterview.create({
    user: userId,
    transcript,
  });

  // 7. Return
  return {
    interviewId: newInterview._id,
    initialMessage: transcript[1].content,
  };
};

export const interviewService = { initializeInterview };
