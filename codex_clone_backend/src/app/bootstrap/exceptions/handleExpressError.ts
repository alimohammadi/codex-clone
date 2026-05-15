import { NextFunction, Response, Request } from "express";

export function handleExpressError(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Log the error for debugging
  console.error("Express Error:", err);

  // Default error status and message
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  const message = err.message || "Internal Server Error";

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      status: statusCode,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    },
  });
}
