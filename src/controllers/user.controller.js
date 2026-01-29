import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";

/**
 * Fetch current authenticated user profile
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  return sendSuccess(res, req.user, "Current user fetched successfully");
});

/**
 * Admin: get all users
 */
const getAllUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().select("-password -refreshToken");
  return sendSuccess(res, users, "Users fetched successfully");
});

export { getCurrentUser, getAllUsers }; 