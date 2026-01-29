import { User } from "../models/user.model.js";

class UserService {
  /**
   * Example: fetch user by id without sensitive fields
   */
  async getById(userId) {
    return User.findById(userId).select("-password -refreshToken");
  }
}

// Export a singleton instance for future user-related operations
export const userService = new UserService();