# Phase 2 Integration Verification

**Status: PASS**

本文件記錄 Phase 1、Phase 2A 與 Phase 2B 的本機 Integration Verification / Staging Preparation。這一輪沒有新增 Phase 3 業務功能、沒有部署 Firebase 雲端資源，也沒有 commit 或 push。

## Environment

| Item | Actual result |
| --- | --- |
| Node | `v20.20.2`（使用使用者本機 Node 20 runtime） |
| Java | Temurin `21.0.12.1` |
| Firebase CLI | `15.29.0` |
| pnpm | `11.19.0` |
| OS | Windows PowerShell |
| Emulator | Functions、Firestore、Hosting、Emulator UI 均已實際啟動並驗證 |

本機 Emulator 使用 project `demo-012s-activity-platform`，不是正式 Firebase project。驗證期間服務如下：

- Functions：`127.0.0.1:5001`
- Firestore：`127.0.0.1:8080`
- Hosting：`127.0.0.1:5000`
- Emulator UI：`127.0.0.1:4000`

## Base commits

### Activity Platform

- Repository: `alberthuang-012S/012s-activity-platform`
- Branch: `main`
- Base commit: `fedc7770873ab841035af59ac79ccc194ef196aa`
- Remote: `https://github.com/alberthuang-012S/012s-activity-platform.git`
- Working tree: 有本次 staging / integration verification 未提交變更；沒有 commit 或 push。

### Slot Game

- Repository: `alberthuang-012S/012s-slot-game`
- Branch: `phase-2b-api-integration`
- Commit: `6e3bc04b0914259d00a7d0ad63a1302e32857e1b`
- Remote: `https://github.com/alberthuang-012S/012s-slot-game.git`
- `main`: `6c73e23324623c2061d0881ae578e3d6fe32f0d6`，未修改、未 merge。
- Working tree: clean。

## Baseline verification

Activity Platform：

- `pnpm --dir functions run build`: PASS
- `pnpm --dir functions test`: PASS，11 files / 43 tests
- `pnpm --dir functions run typecheck`: PASS
- `node --check admin/admin.js`: PASS
- `node --check scripts/integration-smoke-test.mjs`: PASS
- `node --check scripts/emulator-cleanup.mjs`: PASS
- `node --check scripts/frontend-browser-e2e.mjs`: PASS

Slot Game：

- `node --check script.js`: PASS
- `node --test tests/frontend.test.js`: PASS，5/5 tests

## Real integration smoke test

在清理本機 Emulator 資料後，以 `INTEGRATION_RUN_ID=002` 執行 `scripts/integration-smoke-test.mjs`，結果為 PASS。測試經由 Hosting Emulator 呼叫 Functions，並使用 Firebase Admin SDK 連接 Firestore Emulator 驗證 persistence；沒有直接繞過產品流程寫入訂單或 Wallet。

實際結果：

```text
initialWalletA: SLOT_SPIN=3, INVOICE_DRAW=1, POINTS=0
firstSpin: dailyMissionBonus=5, SLOT_SPIN=2, POINTS=10
secondSpin: dailyMissionBonus=0, SLOT_SPIN=1, POINTS=15
concurrency: successful=1, exhausted=1, finalSlotSpin=0
```

Smoke test 同時驗證：

1. Mock User、External Identity、Campaign 與兩筆 Mock Order 建立。
2. `OrderProcessor → ActivityEngine → Entitlement → Ledger → Wallet` 真實 HTTP / Firestore 流程。
3. `GET /api/me/wallet` 的 Bearer Development Session。
4. `POST /api/games/slot/spin` 的 server-side result、reward、daily bonus 與 balance。
5. 同一 `userId + Idempotency-Key` 重送回傳相同 Game Result，沒有重複扣除或新增 `game_results`。
6. `SLOT_SPIN=1` 的兩個不同 request 只有一個成功，另一個為 `SLOT_SPIN_EXHAUSTED`。
7. Duplicate Order 不會再次建立 Order、Entitlement、Order Ledger 或增加 Wallet。
8. User B token 不能讀取 User A Wallet；missing / invalid / expired session 都被拒絕。
9. `Asia/Taipei` 每日第一次遊玩只發放一次 `+5 POINTS`。
10. Firestore collection、Ledger delta sums、Entitlement、Activity Process、Integration Event 與 Game Result 數量一致。

## Real browser E2E

使用本機 Chrome 透過 Hosting Emulator 載入既有 Slot Game UI，沒有重做或替換拉霸視覺。Browser E2E 結果為 PASS：

- 初始 Wallet：`SLOT_SPIN=3`、`POINTS=0`。
- 點擊既有開始按鈕後，瀏覽器實際送出 `GET /api/me/wallet` 與 `POST /api/games/slot/spin`。
- Server 回傳結果交給既有三軸動畫；實測第一次結果為三個 server symbols，Wallet 變為 `SLOT_SPIN=2`、`POINTS=10`。
- Reload 後仍由 Server API 讀到 `SLOT_SPIN=2`、`POINTS=10`。
- localStorage 僅有 `012s_slot_ui_v2` UI preference；沒有保存 POINTS、SLOT_SPIN、spinsUsed、daily mission 或中獎結果。
- API 不可用時，畫面顯示連線異常、Spin button disabled、沒有產生 local random result。

同一個 Browser E2E 也實際載入 Development Admin：

- Admin title：`Development Admin`
- Campaign rows：1
- Recent Order rows：4

## Actual E2E result

| Area | Result |
| --- | --- |
| Mock User / External Identity | PASS |
| Campaign / Activity Rules | PASS |
| Mock Order / NormalizedOrder | PASS |
| OrderProcessor / Activity Engine | PASS |
| Entitlement / Activity Ledger / Wallet | PASS |
| Development Session | PASS |
| `GET /api/me/wallet` | PASS |
| Slot Spin / server reward | PASS |
| Development Admin UI | PASS |
| Firestore persistence | PASS |

## Idempotency

**PASS。** Smoke test 對同一 `userId + Idempotency-Key` 連續送出兩次 request，第二次回傳第一次相同的 Game Result、reward、balances 與 `spinId`；`game_results`、Wallet 與 Ledger 沒有重複增加。

## Concurrency

**PASS。** 實際 Emulator Firestore transaction contention 測試中，同一會員只有 `SLOT_SPIN=1`，兩個不同 idempotency keys 同時 request 的結果為一個成功、一個 `SLOT_SPIN_EXHAUSTED`，最後 balance 為 0。

## Daily Bonus

**PASS。** 同一會員同一個 `Asia/Taipei` 日期的第一次成功 Spin 發放 `+5 POINTS`，第二次為 `dailyMissionBonus=0`，Firestore 只保留一個 daily state。

## Duplicate Order

**PASS。** 同一 source + external order 重送回傳 duplicate / ignored 結果；只有一筆 Order，原始 Activity Entitlement、Order Ledger 與 Wallet 沒有再次增加，並留下可追蹤的 processed / ignored Integration Events。

## Session isolation

**PASS。** Wallet 以 Bearer token 解析 actor，不採信 query string 的 `userId`。User B token 即使附帶 User A 的 query parameter，仍只會取得 User B；missing、invalid 與過期 Session 也都被拒絕。

## Ledger integrity

**PASS。** Smoke test 以 Admin SDK 從 Firestore Emulator 讀取資料，驗證 `activity_ledger`、`game_results`、`game_daily_states`、`activity_processes`、`entitlements`、`integration_events` 與 `orders`。`SLOT_SPIN` / `POINTS` ledger delta sums 與 Wallet balances 相符。

Firestore rules 仍拒絕 Browser / REST 直接讀取受保護 collections；驗證 harness 因此使用 Admin SDK 連接 Emulator，這是測試工具的正確權限邊界，不是放寬規則。

## Firebase Emulator status

| Emulator | Result |
| --- | --- |
| Functions `127.0.0.1:5001` | PASS，Functions loaded，使用 Node 20 |
| Firestore `127.0.0.1:8080` | PASS |
| Hosting `127.0.0.1:5000` | PASS，Slot UI、Admin 與 API rewrite 已驗證 |
| Emulator UI `127.0.0.1:4000` | PASS，HTTP 可開啟 |

## Staging readiness

- `.env.staging.example`: READY，僅包含非敏感設定，`APP_ENV=staging` 強制停用 Dev API。
- Firebase config: READY for alias / `--project` configuration；沒有把 staging project ID 寫死在 TypeScript。
- API base URL: READY；Slot Game 使用 `window.ACTIVITY_PLATFORM_API_BASE_URL`，不把正式 endpoint 或 localhost 寫死在核心 script。
- CORS: READY；使用精確 allowlist，不使用 `*`。
- `docs/STAGING.md`: READY。
- `scripts/integration-smoke-test.mjs`: READY and real Emulator PASS。
- `scripts/frontend-browser-e2e.mjs`: READY and real Chrome PASS。
- Deployment: NO；本次沒有 Firebase Staging Project、部署授權或雲端部署。

## Security

- Secret scan: PASS；沒有 tracked `.env`、private key、service-account JSON、Development Session token 或常見 secret pattern。
- Development Session：Firestore 只保存 SHA-256 token hash，明文 token 只在建立 response 暫時回傳。
- Logs：使用 structured fields 與 error code，不輸出完整 order、session 或 authorization payload。
- Production / staging Dev API：disabled by environment guard。
- CORS wildcard：not used。
- Browser localStorage：只保存 UI preference；authoritative Wallet、結果與 idempotency state 不由前端自行持有。

## Issues found and fixes

1. Smoke harness 最初將 Slot API 的 partial balances 與完整 Wallet 直接比較。已改為分別驗證 Slot response 的欄位並以 Wallet API 驗證完整 balance；clean Emulator smoke rerun PASS。
2. Firestore rules 正確拒絕直接 REST 讀取受保護 collection，原本 smoke harness 因此收到 403。已改用連到同一 Emulator 的 Firebase Admin SDK 做 server-side persistence assertions；clean Emulator smoke rerun PASS。
3. 在既有 active campaign 尚未清除時重跑固定期間 smoke test 會得到 `CAMPAIGN_OVERLAP`。這是測試資料生命週期，不是產品 bug；使用明確的 local Emulator cleanup 後，以 run id `002` 重跑 PASS。
4. Browser harness 初版以 `textContent` 判斷圖案，既有 UI 使用 `data-symbol` / ARIA 呈現；已改為檢查三個 server symbol DOM，並等待 POINTS animation 完成後驗證 reload persistence。Chrome E2E PASS。
5. Phase 2B environment parser 已加入明確 `staging` 分支；regression test 確認 staging 不會開啟 Dev API 或套用 development CORS fallback。

## Known limitations

- SHOPLINE not implemented。
- Production Member Authentication / Identity Integration not implemented。
- Electronic Invoice Production API not implemented。
- Refund Revocation not implemented。
- POINTS Redemption not implemented。
- 沒有部署 Firebase Staging Project，也沒有 merge Slot Game feature branch 到 `main`。
- 沒有開始 Phase 3。

## Verification conclusion

Phase 2 Integration Verification / Staging Preparation 已完成並通過：Activity Platform build、43/43 tests、typecheck、Admin syntax、Slot frontend 5/5 tests、真實 Emulator HTTP / Firestore flow、Idempotency、Concurrency、Daily Bonus、Duplicate Order、Session Isolation、Ledger Integrity、Development Admin 與 Chrome Browser E2E 均 PASS。

本次只更新未提交的 staging / verification 文件與測試 harness；沒有 commit、push、deploy，也沒有修改 `012s-slot-game`。完成後停在本階段，不開始 Phase 3。
