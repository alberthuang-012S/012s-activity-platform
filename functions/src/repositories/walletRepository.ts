import { Firestore } from "firebase-admin/firestore";
import { Wallet } from "../domain/activity/wallet.types";

export interface WalletRepositoryPort {
  getWallet(userId: string): Promise<Wallet | null>;
}

export class WalletRepository implements WalletRepositoryPort {
  constructor(private readonly db: Firestore) {}

  async getWallet(userId: string): Promise<Wallet | null> {
    const snapshot = await this.db.collection("wallets").doc(userId).get();
    return snapshot.exists ? (snapshot.data() as Wallet) : null;
  }
}
