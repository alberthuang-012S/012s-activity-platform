import { Request, Response } from "express";
import { ApplicationError } from "../domain/order/order.errors";
import { sendError } from "./response";

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) &&
    allowedOrigins.some((allowed) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(allowed));
}

export function handleCors(
  request: Request,
  response: Response,
  allowedOrigins: string[]
): boolean {
  const origin = request.get("origin");
  if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
    sendError(
      response,
      new ApplicationError("CORS_ORIGIN_NOT_ALLOWED", "The request origin is not allowed.")
    );
    return false;
  }

  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
  }

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return false;
  }

  return true;
}
