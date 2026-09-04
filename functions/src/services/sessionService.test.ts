import { describe, expect, it } from "vitest";
import {
  CreateUserWithIdentityResult,
  CustomerRepositoryPort
} from "../repositories/customerRepository";
import { ExternalIdentity, NormalizedCustomer, User } from "../domain/customer/customer.types";
import { DevSession } from "../domain/session/session.types";
import { SessionRepositoryPort } from "../repositories/sessionRepository";
import { SessionService, hashSessionToken } from "./sessionService";

class InMemoryCustomerRepository implements CustomerRepositoryPort {
  readonly user: User = {
    id: "USR_SESSION_001",
    displayName: "Session User",
    status: "active",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z"
  };

  async createUserWithExternalIdentity(
    _displayName: string,
    _customer: NormalizedCustomer
  ): Promise<CreateUserWithIdentityResult> {
    throw new Error("not used");
  }

  async findUserByExternalIdentity(_customer: NormalizedCustomer): Promise<User | null> {
    return null;
  }

  async getUser(userId: string): Promise<User | null> {
    return userId === this.user.id ? this.user : null;
  }

  async listExternalIdentitiesForUser(_userId: string): Promise<ExternalIdentity[]> {
    return [];
  }

  async listUsers(): Promise<User[]> {
    return [this.user];
  }
}

class InMemorySessionRepository implements SessionRepositoryPort {
  readonly sessions = new Map<string, DevSession>();

  async create(session: DevSession): Promise<DevSession> {
    this.sessions.set(session.id, session);
    return session;
  }

  async getByTokenHash(tokenHash: string): Promise<DevSession | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }
}

describe("Development Session", () => {
  it("stores only a SHA-256 token hash and resolves an actor", async () => {
    const sessions = new InMemorySessionRepository();
    const service = new SessionService(sessions, new InMemoryCustomerRepository());
    const created = await service.createSession("USR_SESSION_001");
    const stored = [...sessions.sessions.values()][0];

    expect(stored.tokenHash).toBe(hashSessionToken(created.token));
    expect(stored.tokenHash).not.toBe(created.token);
    expect(stored).not.toHaveProperty("token");
    await expect(service.resolveActor(`Bearer ${created.token}`)).resolves.toMatchObject({
      userId: "USR_SESSION_001",
      sessionId: stored.id
    });
  });

  it("rejects an expired session", async () => {
    const service = new SessionService(
      new InMemorySessionRepository(),
      new InMemoryCustomerRepository(),
      -1
    );
    const created = await service.createSession("USR_SESSION_001");

    await expect(service.resolveActor(`Bearer ${created.token}`)).rejects.toMatchObject({
      code: "SESSION_EXPIRED"
    });
  });

  it("rejects a missing bearer token", async () => {
    const service = new SessionService(
      new InMemorySessionRepository(),
      new InMemoryCustomerRepository()
    );

    await expect(service.resolveActor(undefined)).rejects.toMatchObject({
      code: "INVALID_SESSION"
    });
  });
});
