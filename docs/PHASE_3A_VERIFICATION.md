# Phase 3A Verification

**Status: PASS — Phase 3A Emulator HTTP / Firestore / Browser E2E verification completed.**

本文件只記錄 Phase 3A Invoice Bonus Draw 的實際驗證結果；既有 [Phase 2 Integration Verification](./INTEGRATION_VERIFICATION.md) 保持不變。

## Environment

- Node: `v24.19.0`（Functions `engines` 仍宣告 Node 20；本機 Emulator 以目前 Node 執行，只有 engine warning）
- Java: Temurin `21.0.12.1`，僅以暫時 process environment 使用
- Firebase CLI: `15.29.0`，以暫時 `pnpm dlx` invocation 使用
- pnpm: `11.19.0`
- Project: `demo-012s-activity-platform`
- Firebase config: 沿用既有 `firebase.json`、`.firebaserc`、`firestore.rules` 與 `firestore.indexes.json`，未重新初始化

## Baseline

| Check | Result |
| --- | --- |
| `pnpm --dir functions run build` | PASS |
| `pnpm --dir functions test` | PASS — 14 files / 59 tests |
| `pnpm --dir functions run typecheck` | PASS |
| `node --check admin/admin.js` | PASS |
| `node --check scripts/invoice-draw-integration-test.mjs` | PASS |
| `node --check scripts/phase3a-admin-browser-e2e.mjs` | PASS |
| Secret scan | PASS |

## Emulator

實際啟動並連線成功：

| Emulator | Address | Result |
| --- | --- | --- |
| Functions | `127.0.0.1:5001` | PASS — `asia-east1/api` loaded |
| Firestore | `127.0.0.1:8080` | PASS |
| Hosting | `127.0.0.1:5000` | PASS — Admin page HTTP 200 |
| Emulator UI | `127.0.0.1:4000` | PASS — HTTP 200 |

## Phase 2 regression

`pnpm --dir functions run verify:integration` PASS。

實際回歸包含 Mock Order、Activity Engine、Wallet、Ledger、Slot、Idempotency、Concurrency、Daily Bonus 與 Session Isolation；回歸結果確認 Phase 3A 沒有破壞 Phase 2。

## Invoice Draw HTTP / Firestore E2E

最後一次完整 run：`phase3a-ledger-final2-20260907`；完成後已清除本機 Emulator 測試資料。

### Core flow

```text
Mock User
→ active Purchase Campaign + paid Mock Order + valid invoice
→ Activity Engine
→ Wallet: INVOICE_DRAW = 1, POINTS = 0
→ POINTS_TEST (25 POINTS)
→ draw
→ Wallet: INVOICE_DRAW = 0, POINTS = 25
```

上述初始與抽獎後餘額由 HTTP response 及 Firebase Admin SDK 讀取的 Emulator Firestore persistence 同時驗證。

| Scenario | Result |
| --- | --- |
| `POINTS_TEST`, `points=25`, `UNLIMITED` | PASS |
| Same `userId + Idempotency-Key` replay | PASS — same draw/result/balances; no duplicate result, claim or Ledger |
| Concurrent draw with `INVOICE_DRAW=1` | PASS — one success, one `INVOICE_DRAW_EXHAUSTED`, final balance 0 |
| Limited Stock A + eligible fallback B | PASS — A at most one winner, inventory `1 → 0`, retry uses the remaining eligible pool |
| `NONE` prize | PASS — `won=false`, no claim, no POINTS reward Ledger |
| `MANUAL_PRIZE` | PASS — result and pending Claim persisted |
| Claim fulfillment | PASS — `pending → fulfilled`; repeated fulfill is idempotent |
| Invalid client-selected prize payload | PASS — rejected without server-side selection bypass |
| Result / Inventory / Claim persistence | PASS — verified through Admin SDK and reloaded Admin queries |

最新 run 的 Firestore assertions 確認：6 筆 results、7 筆 Invoice Draw 相關 Ledger（其中 6 筆 play entries）、2 筆 claims 與 limited inventory 均已持久化；NONE 沒有 reward Ledger、POINTS 有 `+25` reward Ledger，且兩位測試會員的 Wallet balances 與完整 `activity_ledger` delta sum 相等。

## Campaign lifecycle and time boundaries

實際 API 驗證通過：

```text
draft → active → paused → active → ended
```

- active / paused 後 Prize config immutable：PASS
- paused 不可 draw，且 Wallet 不變：PASS
- 未到 `startsAt` 不可 draw，且 Wallet 不變：PASS
- 超過 `endsAt` 不可 draw：PASS
- ended 不可 resume：PASS

## Session isolation

- Missing token：PASS — rejected
- Invalid token：PASS — rejected
- Expired token：PASS — rejected
- A token 只能讀取 A 的 status / results / claims：PASS
- `userId` query parameter 不可切換成 B：PASS
- 失敗驗證不建立 Result、不扣 Wallet、不扣 Inventory：PASS

## Development Admin Browser E2E

使用本機 Google Chrome executable，通過 `scripts/phase3a-admin-browser-e2e.mjs` 實際操作 Hosting Admin：

- Create Invoice Draw Campaign：PASS
- Add / view Prize、Weight、Stock：PASS
- Activate → Pause → Resume → End：PASS
- Create Development Session：PASS
- Test Draw：PASS
- View Draw Result：PASS
- View Pending Claim：PASS
- Fulfill Claim：PASS
- Reload 後 Campaign、Prize、Result 與 Claim 狀態仍由 API / Firestore 還原：PASS

既有 Consumer Slot browser E2E 也以本機 Chrome 通過；確認 Wallet 由 Server API 提供、API failure 不 fallback 到 local random，且 localStorage 只保留 `012s_slot_ui_v2` UI preference。

## Firestore Rules

對以下新增 collections 以未授權 REST read / PATCH 實測均回 `403`：

- `invoice_draw_campaigns`
- `invoice_draw_prizes`
- `invoice_draw_prize_inventory`
- `invoice_draw_results`
- `prize_claims`

正式流程仍只能透過 Cloud Functions / Admin SDK。

## Security and scope

- Secret scan：PASS
- 未發現 `.env`、Firebase private key、service-account JSON、Development Session token、SHOPLINE credential 或 hardcoded credential
- `012s-slot-game`：UNCHANGED
- SHOPLINE：NOT IMPLEMENTED
- Production Member Authentication：NOT IMPLEMENTED
- Official Invoice API：NOT IMPLEMENTED
- Deployment：NO
- Commit / Push：NO
- Phase 3B：NOT STARTED

本次只補充驗證 fixture 與 Browser Admin 驗證腳本／文件；沒有新增 Phase 3A 產品功能，也沒有修改 Firebase project config 或任何正式憑證。
