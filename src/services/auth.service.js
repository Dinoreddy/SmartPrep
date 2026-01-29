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
      "-password -refreshToken"
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
      "-password -refreshToken"
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
      { new: true }
    );
    return true;
  }
}

// Export a singleton instance
export const authService = new AuthService();

