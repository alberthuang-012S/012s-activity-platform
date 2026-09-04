import { Firestore } from "firebase-admin/firestore";
import { DevSession } from "../domain/session/session.types";

export interface SessionRepositoryPort {
  create(session: DevSession): Promise<DevSession>;
  getByTokenHash(tokenHash: string): Promise<DevSession | null>;
}

export class SessionRepository implements SessionRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async create(session: DevSession): Promise<DevSession> {
    await this.db.collection("dev_sessions").doc(session.id).set(session);
    return session;
  }

  async getByTokenHash(tokenHash: string): Promise<DevSession | null> {
    const snapshot = await this.db
      .collection("dev_sessions")
      .where("tokenHash", "==", tokenHash)
      .limit(1)
      .get();
    return snapshot.empty ? null : (snapshot.docs[0].data() as DevSession);
  }
}
