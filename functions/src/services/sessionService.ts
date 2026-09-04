import { createHash, randomBytes } from "node:crypto";
import { ApplicationError } from "../domain/order/order.errors";
import { ActorContext, DevSession } from "../domain/session/session.types";
import { CustomerRepositoryPort } from "../repositories/customerRepository";
import { SessionRepositoryPort } from "../repositories/sessionRepository";
import { nowIso } from "../utils/dates";
import { createPrefixedId } from "../utils/ids";

export interface CreateSessionResult {
  token: string;
  expiresAt: string;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class SessionService {
  constructor(
    private readonly sessionRepository: SessionRepositoryPort,
    private readonly customerRepository: CustomerRepositoryPort,
    private readonly ttlMinutes = 480
  ) {}

  async createSession(userId: string): Promise<CreateSessionResult> {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new ApplicationError("INVALID_SESSION", "userId is required.");
    }
    const user = await this.customerRepository.getUser(userId.trim());
    if (!user || user.status !== "active") {
      throw new ApplicationError("CUSTOMER_NOT_FOUND", "Customer could not be resolved.");
    }

    const token = randomBytes(32).toString("hex");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1000).toISOString();
    const session: DevSession = {
      id: createPrefixedId("SES"),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      createdAt
    };
    await this.sessionRepository.create(session);
    return { token, expiresAt };
  }

  async resolveActor(authorizationHeader: string | undefined): Promise<ActorContext> {
    const token = this.extractBearerToken(authorizationHeader);
    const session = await this.sessionRepository.getByTokenHash(hashSessionToken(token));
    if (!session) {
      throw new ApplicationError("INVALID_SESSION", "Development session is invalid.");
    }
    const expiration = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiration) || expiration <= Date.now()) {
      throw new ApplicationError("SESSION_EXPIRED", "Development session has expired.");
    }
    const user = await this.customerRepository.getUser(session.userId);
    if (!user || user.status !== "active") {
      throw new ApplicationError("INVALID_SESSION", "Development session is invalid.");
    }
    return { userId: session.userId, sessionId: session.id };
  }

  private extractBearerToken(authorizationHeader: string | undefined): string {
    if (typeof authorizationHeader !== "string") {
      throw new ApplicationError("INVALID_SESSION", "Bearer session token is required.");
    }
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1].trim().length === 0) {
      throw new ApplicationError("INVALID_SESSION", "Bearer session token is required.");
    }
    return match[1].trim();
  }
}
