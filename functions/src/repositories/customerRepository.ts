import { Firestore } from "firebase-admin/firestore";
import { ApplicationError } from "../domain/order/order.errors";
import {
  ExternalIdentity,
  NormalizedCustomer,
  User
} from "../domain/customer/customer.types";
import { createExternalDocumentKey, createPrefixedId } from "../utils/ids";
import { nowIso } from "../utils/dates";

export interface CreateUserWithIdentityResult {
  user: User;
  externalIdentity: ExternalIdentity;
}

export interface CustomerRepositoryPort {
  createUserWithExternalIdentity(
    displayName: string,
    customer: NormalizedCustomer
  ): Promise<CreateUserWithIdentityResult>;
  findUserByExternalIdentity(customer: NormalizedCustomer): Promise<User | null>;
  getUser(userId: string): Promise<User | null>;
  listExternalIdentitiesForUser(userId: string): Promise<ExternalIdentity[]>;
  listUsers(limit?: number): Promise<User[]>;
}

export class CustomerRepository implements CustomerRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async createUserWithExternalIdentity(
    displayName: string,
    customer: NormalizedCustomer
  ): Promise<CreateUserWithIdentityResult> {
    const userId = createPrefixedId("USR");
    const identityId = createExternalDocumentKey(customer.provider, customer.externalCustomerId);
    const userReference = this.db.collection("users").doc(userId);
    const identityReference = this.db.collection("external_identities").doc(identityId);
    const createdAt = nowIso();

    return this.db.runTransaction(async (transaction) => {
      const existingIdentity = await transaction.get(identityReference);
      if (existingIdentity.exists) {
        throw new ApplicationError(
          "EXTERNAL_CUSTOMER_ALREADY_EXISTS",
          "The external customer is already linked to a member."
        );
      }

      const user: User = {
        id: userId,
        displayName: displayName.trim(),
        status: "active",
        createdAt,
        updatedAt: createdAt
      };
      const externalIdentity: ExternalIdentity = {
        id: identityId,
        userId,
        provider: customer.provider,
        externalId: customer.externalCustomerId,
        createdAt,
        updatedAt: createdAt
      };

      transaction.set(userReference, user);
      transaction.set(identityReference, externalIdentity);
      return { user, externalIdentity };
    });
  }

  async findUserByExternalIdentity(customer: NormalizedCustomer): Promise<User | null> {
    const identityId = createExternalDocumentKey(customer.provider, customer.externalCustomerId);
    const identitySnapshot = await this.db
      .collection("external_identities")
      .doc(identityId)
      .get();

    if (!identitySnapshot.exists) {
      return null;
    }

    const identity = identitySnapshot.data() as ExternalIdentity;
    return this.getUser(identity.userId);
  }

  async getUser(userId: string): Promise<User | null> {
    const snapshot = await this.db.collection("users").doc(userId).get();
    return snapshot.exists ? (snapshot.data() as User) : null;
  }

  async listExternalIdentitiesForUser(userId: string): Promise<ExternalIdentity[]> {
    const snapshot = await this.db
      .collection("external_identities")
      .where("userId", "==", userId)
      .get();
    return snapshot.docs.map((document) => document.data() as ExternalIdentity);
  }

  async listUsers(limit = 100): Promise<User[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const snapshot = await this.db
      .collection("users")
      .orderBy("createdAt", "desc")
      .limit(safeLimit)
      .get();
    return snapshot.docs.map((document) => document.data() as User);
  }
}
