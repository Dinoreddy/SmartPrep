import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { mockTestService } from "../services/mockTest.service.js";

export const getConfig = asyncHandler(async (req, res) => {
  const config = await mockTestService.getTestConfig(req.user._id);
  return sendSuccess(res, config, "Test configuration fetched successfully");
});

export const getMockTestStats = asyncHandler(async (req, res) => {
  const stats = await mockTestService.getMockTestStats(req.user._id);
  return sendSuccess(res, stats, "Mock test stats fetched successfully");
});

export const startTest = asyncHandler(async (req, res) => {
  const { selectedSkills } = req.body;

  if (!Array.isArray(selectedSkills) || selectedSkills.length === 0)
    throw new ApiError(400, "selectedSkills must be a non-empty array");

  const test = await mockTestService.createTest(req.user._id, selectedSkills);

  // toObject() converts all Mongoose subdocuments to plain objects before
  // we strip correctOptionIndex — prevents leaking internal Mongoose fields.
  const plain = test.toObject();
  plain.questions = plain.questions.map(
    ({ correctOptionIndex, ...safe }) => safe,
  );

  return sendSuccess(res, plain, "Mock test started successfully", 201);
});

export const getTestById = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const result = await mockTestService.getTestById(testId, req.user._id);
  return sendSuccess(res, result, "Test fetched successfully");
});

export const submitTest = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const { answers } = req.body;

  if (!answers || typeof answers !== "object" || Array.isArray(answers))
    throw new ApiError(
      400,
      "answers must be an object mapping questionId to selected option index",
    );

  const result = await mockTestService.submitTest(
    testId,
    req.user._id,
    answers,
  );
  return sendSuccess(res, result, "Test submitted successfully");
});
