import { describe, expect, it, vi } from "vitest";
import { Request, Response } from "express";
import { createApiHandler } from "./api";
import { SessionService } from "../services/sessionService";
import { WalletService } from "../services/walletService";

function requestFor(path: string, authorization?: string): Request {
  return {
    method: "GET",
    path,
    url: path,
    get: (header: string) => (header.toLowerCase() === "authorization" ? authorization : undefined)
  } as unknown as Request;
}

function responseMock(): Response & {
  statusCode: number;
  body: unknown;
} {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
      return response;
    },
    send(_body: unknown) {
      return response;
    },
    setHeader: vi.fn()
  } as unknown as Response & { statusCode: number; body: unknown };
  return response;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    customerService: {} as never,
    orderProcessor: {} as never,
    mockCommerceAdapter: {} as never,
    orderRepository: {} as never,
    activityEngine: {} as never,
    activityQueryService: {} as never,
    campaignService: {} as never,
    sessionService: {} as SessionService,
    walletService: {} as WalletService,
    devAdminEnabled: false,
    devSessionEnabled: true,
    allowedOrigins: ["http://localhost:5000"],
    ...overrides
  };
}

describe("API Phase 2A routes", () => {
  it("resolves /api/me/wallet from the bearer actor rather than a client userId", async () => {
    const sessionService = {
      resolveActor: vi.fn().mockResolvedValue({ userId: "USR_001", sessionId: "SES_001" })
    } as unknown as SessionService;
    const walletService = {
      getWalletForUser: vi.fn().mockResolvedValue({
        userId: "USR_001",
        balances: { SLOT_SPIN: 3, INVOICE_DRAW: 1, POINTS: 0 },
        updatedAt: "2026-09-04T10:00:00.000Z"
      })
    } as unknown as WalletService;
    const handler = createApiHandler(
      dependencies({ sessionService, walletService, devSessionEnabled: true })
    );
    const response = responseMock();

    await handler(requestFor("/api/me/wallet", "Bearer SESSION_TOKEN"), response);

    expect(sessionService.resolveActor).toHaveBeenCalledWith("Bearer SESSION_TOKEN");
    expect(walletService.getWalletForUser).toHaveBeenCalledWith("USR_001");
    expect(response.body).toEqual({
      success: true,
      data: {
        userId: "USR_001",
        balances: { SLOT_SPIN: 3, INVOICE_DRAW: 1, POINTS: 0 },
        updatedAt: "2026-09-04T10:00:00.000Z"
      }
    });
  });

  it("blocks development routes when Development Admin is disabled", async () => {
    const handler = createApiHandler(dependencies({ devAdminEnabled: false }));
    const response = responseMock();

    await handler(requestFor("/api/dev/campaigns"), response);

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "DEV_ADMIN_DISABLED" }
    });
  });
});
