import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { mockTestService } from "../services/mockTest.service.js";

export const getConfig = asyncHandler(async (req, res) => {
  const config = await mockTestService.getTestConfig(req.user._id);
  return sendSuccess(res, config, "Test configuration fetched successfully");
});

export const startTest = asyncHandler(async (req, res) => {
  const { selectedSkills } = req.body;

  if (!Array.isArray(selectedSkills) || selectedSkills.length === 0) {
    throw new ApiError(400, "selectedSkills must be a non-empty array");
  }

  const test = await mockTestService.createTest(req.user._id, selectedSkills);

  // toObject() first — converts all subdocuments to plain JS objects,
  // eliminating Mongoose internals (__parentArray, $__, _doc, etc.)
  // Then strip correctOptionIndex from the plain questions array.
  const plain = test.toObject();
  plain.questions = plain.questions.map(
    ({ correctOptionIndex, ...safe }) => safe,
  );

  const sanitizedTest = plain;

  return sendSuccess(res, sanitizedTest, "Mock test started successfully", 201);
});
