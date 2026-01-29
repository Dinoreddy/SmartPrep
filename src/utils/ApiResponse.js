/* ======================
   src/utils/ApiResponse.js
   Centralized response handling
====================== */

/**
 * Default code-to-message map
 */
const DEFAULT_MESSAGES = {
  // ✅ Success codes
  200: "Success",
  201: "Created",
  202: "Accepted",
  204: "No Content",

  // ⚠️ Client Errors
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",

  // 🛑 Server Errors
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",

  // 🧾 Custom Business Logic Codes
  1001: "Invalid Credentials",
  1002: "User does not exist",
  1003: "Duplicate entry not allowed",
  1004: "Invalid or expired token",
  1005: "Invalid input data",
  1006: "Permission denied",
  1007: "Failed to send email",
  1008: "File too large",
  1009: "Unsupported file type",
};

/**
 * Standard API Response structure
 */
class ApiResponse {
  constructor({ message, data = null, success, meta }) {
    this.success = success ?? true;
    this.message = message || "Response";
    this.data = data;
    if (meta) this.meta = meta;
  }
}

/**
 * Send a success response
 */
const sendSuccess = (
  res,
  data = null,
  message = "Success",
  statusCode = 200,
  meta = undefined
) => {
  const response = new ApiResponse({ 
    success: true,
    data, 
    message, 
    meta 
  });
  return res.status(statusCode).json(response);
};

/**
 * Send an error response
 */
const sendError = (res, error, statusCode = 500) => {
  const response = {
    success: false,
    code: error.code || statusCode,
    message:
      error?.message ||
      (error.code
        ? DEFAULT_MESSAGES[error.code]
        : DEFAULT_MESSAGES[statusCode]) ||
      "An error occurred",
  };

  if (error.errors) {
    response.errors = error.errors;
  }

  return res.status(statusCode).json(response);
};

// Export using ES Modules syntax
export {
  sendSuccess,
  sendError,
  ApiResponse,
  DEFAULT_MESSAGES,
};