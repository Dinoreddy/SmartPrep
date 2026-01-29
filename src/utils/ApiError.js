class ApiError extends Error {
    constructor(
      statusCode,
      message = "Something went wrong",
      errors = [],
      stack = ""
    ) {
      super(message);
      this.statusCode = statusCode;
      this.data = null;
      this.message = message;
      this.success = false;
      this.errors = errors;
  
      if (stack) {
        this.stack = stack;
      } else {
        Error.captureStackTrace(this, this.constructor);
      }
    }
  }

  const errorHandler = (err, req, res, next) => {
    const statusCode = err?.statusCode || 500;
    const message = err.message || "Internal Server Error";
  
    const response = {
      status: "error",
      success: false,
      message,
    };
  
    if ("code" in err && err.code) {
      response.code = err.code;
    }
  
    if (err.errors?.length) {
      response.errors = err.errors;
    }
  
    if (process.env.NODE_ENV === "development" && err.stack) {
      response.stack = err.stack;
    }
  
    res.status(statusCode).json(response);
  };
  
  export { ApiError, errorHandler };