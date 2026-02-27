import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { resumeService } from "../services/resume.service.js";

export const uploadResume = asyncHandler(async (req, res) => {
  // 1. Check file existence
  if (!req.file) {
    throw new ApiError(400, "Resume file is required");
  }

  // 2. Process
  const updatedUser = await resumeService.processResume(
    req.user._id,
    req.file.path,
  );

  // 3. Response
  return sendSuccess(
    res,
    updatedUser,
    "Resume analyzed successfully. Profile updated.",
    201,
  );
});

export const updateResume = asyncHandler(async (req, res) => {
  // 1. Check file existence
  if (!req.file) {
    throw new ApiError(400, "Resume file is required");
  }

  // 2. Process
  const updatedUser = await resumeService.updateResume(
    req.user._id,
    req.file.path,
  );

  // 3. Response
  return sendSuccess(res, updatedUser, "Resume updated successfully.", 200);
});

export const getResume = asyncHandler(async (req, res) => {
  const resumeData = await resumeService.getResume(req.user._id);
  return sendSuccess(res, resumeData, "Resume data fetched successfully.");
});
