import jwt from "jsonwebtoken";

import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Verify Access Token and attach user to `req.user`
 *
 * - Supports tokens from HTTP-only cookie: `accessToken`
 * - Also supports `Authorization: Bearer <token>` header
 */
 const verifyJWT = asyncHandler(async (req, _res, next) => {
  // Prefer HTTP-only cookie, but fall back to Authorization header
  const cookieToken = req.cookies?.accessToken;
  const authHeader = req.header("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "").trim()
    : undefined;

  const token = cookieToken || headerToken;

  if (!token) {
    throw new ApiError(401, "Unauthorized request: token missing");
  }

  try {
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // Load fresh user from DB to ensure account still exists
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      throw new ApiError(401, "Unauthorized request: user not found");
    }

    req.user = user;
    next();
  } catch (error) {
    // Token invalid or expired
    throw new ApiError(401, "Invalid or expired access token", [], error.stack);
  }
});

 const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
      if (!req.user || !req.user.role) {
        return res.status(403).json({
          success: false,
          message: "Access denied: no role found on user",
        });
      }
  
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: "Access denied: insufficient permissions",
        });
      }
  
      next();
    };
  };
  
  export { verifyJWT, authorizeRoles };
