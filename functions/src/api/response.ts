import { Response } from "express";
import { ApplicationError, toApplicationError } from "../domain/order/order.errors";

export function sendSuccess(response: Response, data: unknown, statusCode = 200): void {
  response.status(statusCode).json({ success: true, data });
}

export function sendError(
  response: Response,
  error: unknown,
  statusCode?: number
): void {
  const applicationError = toApplicationError(error);
  response.status(statusCode ?? applicationError.statusCode).json({
    success: false,
    error: {
      code: applicationError.code,
      message: applicationError.message
    }
  });
}

export function sendErrorDetails(
  response: Response,
  code: ApplicationError["code"],
  message: string,
  statusCode: number
): void {
  response.status(statusCode).json({
    success: false,
    error: { code, message }
  });
}
