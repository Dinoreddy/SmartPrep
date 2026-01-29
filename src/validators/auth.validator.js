import { body, validationResult } from "express-validator";
import { sendError } from "../utils/ApiResponse.js";

/**
 * Centralized handler to return validation errors, if any.
 */
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return next();
  }

  // Format errors as an array of { field, msg }
  const formatted = errors.array().map((err) => ({
    field: err.path,
    msg: err.msg,
  }));

  return sendError(res, { message: "Validation failed", errors: formatted }, 422);
};

/**
 * Validator middleware for registration
 */
export const registerValidator = [
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 3 })
    .withMessage("Full name must be at least 3 characters long"),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("username")
    .trim()
    .notEmpty()
    .withMessage("Username is required")
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must be between 3 and 30 characters")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username can only contain letters, numbers and underscores"),

  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),

  handleValidation,
];

/**
 * Validator middleware for login
 */
export const loginValidator = [
  body("password").notEmpty().withMessage("Password is required"),

  body("email")
    .if(body("username").not().exists())
    .notEmpty()
    .withMessage("Email or username is required")
    .bail()
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("username")
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage("Username must be at least 3 characters long"),

  handleValidation,
];

