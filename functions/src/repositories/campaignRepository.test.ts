import { describe, expect, it } from "vitest";
import { Firestore } from "firebase-admin/firestore";
import { CampaignRepository } from "./campaignRepository";

describe("independent campaign lifecycle", () => {
  it("activates overlapping campaigns and ends only the selected one", async () => {
    const records = new Map(["A","B","C","D"].map(id => [id, {
      id, name:id, type:"purchase", category:id < "C" ? "product" : "cumulative_spend",
      status:"draft", startsAt:"2026-09-01", endsAt:"2026-12-31"
    }]));
    const db = {
      collection: () => ({doc:(id:string) => ({id})}),
      runTransaction: async (operation: (transaction: unknown) => unknown) => operation({
        get: async (ref:{id:string}) => ({exists:records.has(ref.id),data:()=>records.get(ref.id)}),
        set: (ref:{id:string}, data:typeof records extends Map<string,infer T> ? T : never) => records.set(ref.id,data)
      })
    } as unknown as Firestore;
    const repository = new CampaignRepository(db);
    await Promise.all([...records.keys()].map(id => repository.activateCampaign(id)));
    expect([...records.values()].every(c => c.status === "active")).toBe(true);
    await repository.endCampaign("A");
    expect(records.get("A")?.status).toBe("ended");
    expect(["B","C","D"].every(id=>records.get(id)?.status === "active")).toBe(true);
    await expect(repository.activateCampaign("A")).rejects.toThrow("Only draft");
    await expect(repository.activateCampaign("B")).resolves.toMatchObject({status:"active"});
  });
});
