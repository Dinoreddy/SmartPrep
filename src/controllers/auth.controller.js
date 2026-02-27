import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/ApiResponse.js";
import { authService } from "../services/auth.service.js";
import { ACCESS_COOKIE_OPTIONS, REFRESH_COOKIE_OPTIONS } from "../constants.js";

const register = asyncHandler(async (req, res) => {
  const { fullName, email, username, password } = req.body;

  const { user, accessToken, refreshToken } = await authService.registerUser({
    fullName,
    email,
    username,
    password,
  });

  res
    .cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS)
    .cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

  return sendSuccess(res, { user }, "User registered successfully", 201);
});

const login = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;

  const { user, accessToken, refreshToken } = await authService.loginUser({
    email,
    username,
    password,
  });

  res
    .cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS)
    .cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

  return sendSuccess(res, { user }, "User logged in successfully");
});

const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(req.user._id);

  res
    .clearCookie("accessToken", ACCESS_COOKIE_OPTIONS)
    .clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);

  return sendSuccess(res, {}, "User logged out successfully");
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingToken = req.cookies?.refreshToken || req.body?.refreshToken;

  const { user, accessToken, refreshToken } =
    await authService.refreshTokens(incomingToken);

  res
    .cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS)
    .cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

  return sendSuccess(res, { user }, "Tokens refreshed successfully");
});

export { register, login, logout, refreshAccessToken };
