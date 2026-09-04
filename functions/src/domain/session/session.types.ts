export interface DevSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface ActorContext {
  userId: string;
  sessionId: string;
}
