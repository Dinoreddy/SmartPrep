import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";

class AuthService {
  /**
   * Internal Helper: Generate Access & Refresh Tokens
   */
  async generateTokens(userId) {
    try {
      const user = await User.findById(userId);
      const accessToken = user.generateAccessToken();
      const refreshToken = user.generateRefreshToken();

      // Save Refresh Token in DB
      user.refreshToken = refreshToken;
      await user.save({ validateBeforeSave: false });

      return { accessToken, refreshToken };
    } catch (error) {
      throw new ApiError(500, "Something went wrong while generating tokens");
    }
  }

  /**
   * Register a new user
   */
  async registerUser({ fullName, email, username, password }) {
    // 1. Check for duplicates
    const existedUser = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (existedUser) {
      throw new ApiError(409, "User with email or username already exists");
    }

    // 2. Create User (default role: "user")
    const user = await User.create({
      fullName,
      email,
      password,
      username: username.toLowerCase(),
      role: "user",
      resumeProfile: { hasUploaded: false },
    });

    // 3. Return only safe data
    const createdUser = await User.findById(user._id).select(
      "-password -refreshToken",
    );

    if (!createdUser) {
      throw new ApiError(500, "Failed to create user record");
    }

    return createdUser;
  }

  /**
   * Authenticate user and return tokens
   */
  async loginUser({ email, username, password }) {
    // 1. Find User
    if (!username && !email) {
      throw new ApiError(400, "Username or email is required");
    }

    const user = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (!user) {
      throw new ApiError(404, "User does not exist");
    }

    // 2. Check Password
    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
      throw new ApiError(401, "Invalid user credentials");
    }

    // 3. Generate Tokens
    const { accessToken, refreshToken } = await this.generateTokens(user._id);

    const loggedInUser = await User.findById(user._id).select(
      "-password -refreshToken",
    );

    return { user: loggedInUser, accessToken, refreshToken };
  }

  /**
   * Logout user (Clear refresh token)
   */
  async logoutUser(userId) {
    await User.findByIdAndUpdate(
      userId,
      {
        $unset: { refreshToken: 1 },
      },
      { new: true },
    );
    return true;
  }
  /**
   * Refresh Access + Refresh tokens (Token Rotation)
   * Security: incoming token must match the one stored in DB to prevent replay attacks.
   */
  async refreshTokens(incomingRefreshToken) {
    if (!incomingRefreshToken) {
      throw new ApiError(401, "Refresh token is required");
    }

    let decoded;
    try {
      decoded = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET,
      );
    } catch {
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const user = await User.findById(decoded._id);
    if (!user) {
      throw new ApiError(401, "User not found");
    }

    // Replay attack guard — token must match what's stored in DB
    if (incomingRefreshToken !== user.refreshToken) {
      throw new ApiError(401, "Refresh token has already been used or revoked");
    }

    // generateTokens saves the new refresh token to DB automatically
    const { accessToken, refreshToken } = await this.generateTokens(user._id);

    const safeUser = await User.findById(user._id).select(
      "-password -refreshToken",
    );

    return { user: safeUser, accessToken, refreshToken };
  }
}

// Export a singleton instance
export const authService = new AuthService();
