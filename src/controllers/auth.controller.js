import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { authService } from "../services/auth.service.js";
import { COOKIE_OPTIONS } from "../constants.js";

const register = asyncHandler(async (req, res) => {
  const { fullName, email, username, password } = req.body;

  const createdUser = await authService.registerUser({
    fullName,
    email,
    username,
    password,
  });

  return sendSuccess(res, createdUser, "User registered successfully", 201);
});

const login = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;

  const { user, accessToken, refreshToken } = await authService.loginUser({
    email,
    username,
    password,
  });

  res
    .cookie("accessToken", accessToken, COOKIE_OPTIONS)
    .cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

  return sendSuccess(
    res,
    { user, accessToken, refreshToken },
    "User logged in successfully"
  );
});

const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(req.user._id);

  res
    .clearCookie("accessToken", COOKIE_OPTIONS)
    .clearCookie("refreshToken", COOKIE_OPTIONS);

  return sendSuccess(res, {}, "User logged out successfully");
});

export { register, login, logout };

