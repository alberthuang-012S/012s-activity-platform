# 2050 × 012S 會員活動平台

這個 Repository 是 2050 × 012S 會員活動平台主專案，基於 Firebase Cloud Functions 2nd Gen、TypeScript 與 Cloud Firestore。Phase 1、Phase 2A 與 Phase 2B 的核心後端目前都在這裡；既有 `012s-slot-game` 維持為獨立 Repository，不複製進本專案。

## Architecture

```text
MockCommerceAdapter
  ↓
NormalizedOrder
  ↓
OrderProcessor
  ↓ paid order
Activity Engine
  ↓
Entitlement + Activity Ledger + Wallet
  ↓
Development Session → /api/me/wallet
  ↓
012s-slot-game（獨立 Repository）
  ↓ Authorization + Idempotency-Key
POST /api/games/slot/spin
  ↓
Server weighted random + reward calculation
  ↓ one Firestore transaction
SLOT_SPIN -1 + POINTS reward + optional daily bonus
  ↓
Game Result + Activity Ledger + Wallet
```

核心資料層只認識 `NormalizedOrder`、平台自己的 `User` 與 `Wallet`。SHOPLINE 仍未實作，也沒有加入 SHOPLINE Payload、SDK、API Key、Secret 或 Authentication。

## Phase 1 / Phase 2A

已完成並保留：

- Mock Customer → External Identity → Mock Order → `NormalizedOrder` → `OrderProcessor`
- Order external key 的 Firestore Transaction 防重複
- `campaigns`、`activity_rules`、`ActivityEngine`
- `entitlements`、append-only `activity_ledger`、`wallets`、`activity_processes`
- Development-only Session（Firestore 只保存 SHA-256 token hash）
- Development Admin：會員、Campaign、Mock Order、Wallet、Ledger 與 Order Activity Detail

同一筆 Mock Order 不會再次發放 Activity Entitlement；既有 Phase 1 / Phase 2A 流程沒有被 Slot Backend 取代。

## Phase 2B Slot Backend

Activity Platform 新增：

- `functions/src/domain/game/slot.types.ts`：Slot symbols、reward、Game Result、daily state 與 API response
- `functions/src/domain/game/slotGameConfig.ts`：Server authoritative symbols 權重與 reward points
- `functions/src/services/slotGameService.ts`：crypto weighted random、server reward calculation 與 ActorContext
- `functions/src/repositories/gameResultRepository.ts`：Game Result、Wallet、Daily State、Ledger 的單一 Firestore Transaction
- `POST /api/games/slot/spin`：要求 `Authorization: Bearer <token>` 與 UUID `Idempotency-Key`
- 同一 `userId + Idempotency-Key` 回傳同一個已保存結果，不會重新扣次數或重抽
- Concurrent spin 由 Wallet／Game Result Transaction 保護；最後一個 `SLOT_SPIN` 只能成功一次
- 每個 Asia/Taipei 日期的第一次成功遊玩由 Server 發放 `+5 POINTS`

Server 目前使用既有六個 symbol id 與權重：`nne 25`、`nap 25`、`ppa 25`、`012s 15`、`plus1 7`、`gift 3`。正式結果使用 Node `crypto.randomInt()`；前端的 `Math.random()` 僅用於中間軌道與 confetti 等純視覺動畫。

Reward points：

```text
normal 5    double 10    triple 30
brandTriple 50    plusTriple 100    jackpot 300
```

## Firebase Setup

需求：Node.js 20、Java runtime（Firestore Emulator 需要）、Firebase CLI，以及可使用的 npm-compatible package manager（本機可使用 `pnpm`）。

```bash
node --version
java -version
firebase --version
pnpm --version
pnpm --dir functions install
```

Firebase CLI 執行 Firestore Emulator 時需要 Java runtime；若 CLI 顯示額外的 Java 版本要求，請依目前 Firebase CLI 官方要求安裝。正式 Firebase Project ID 與憑證不寫死在 TypeScript，也不 commit private key。

依環境複製 `.env.development.example`、`.env.staging.example` 或 `.env.production.example` 為 `functions/.env`。只有 development 會開啟 Development Admin 與 Development Session；staging 與 production 預設都會關閉：

```text
APP_ENV=development
DEV_ADMIN_ENABLED=true
FUNCTIONS_REGION=asia-east1
DEV_SESSION_TTL_MINUTES=480
CORS_ALLOWED_ORIGINS=
FIREBASE_PROJECT_ID=
```

`.firebaserc` 的 `demo-012s-activity-platform` 只作為本機 Emulator 的隔離 project name，不代表正式 Firebase project；正式或測試 project 請透過 Firebase CLI alias 或 `--project` 設定。

`APP_ENV=staging` 會明確停用 Development API，即使誤設 `DEV_ADMIN_ENABLED=true` 也不會公開 Dev API。Staging 的 CORS 必須填入精確 origin 清單，不可使用 `*`。

## Emulator Setup

先編譯 Functions，再從 Repository 根目錄執行：

```bash
pnpm --dir functions run build
firebase emulators:start
```

預設服務：

- Hosting：<http://127.0.0.1:5000>
- Development Admin：<http://127.0.0.1:5000/admin/>
- Functions：<http://127.0.0.1:5001>
- Firestore：<http://127.0.0.1:8080>
- Emulator UI：<http://127.0.0.1:4000>

本機驗證環境已安裝並使用 Node.js 20、Java 21 與 Firebase CLI；Functions、Firestore、Hosting 與 Emulator UI 已實際啟動並驗證。若是新環境，仍需先依 [docs/STAGING.md](docs/STAGING.md) 安裝這些工具。Admin 與遊戲都透過 Cloud Function API，Browser 不直接寫入 Firestore。

## Phase 2 Integration Verification / Staging Preparation

本階段只驗證 Phase 1、Phase 2A 與 Phase 2B 的整合，不新增 Phase 3 業務功能。可重複執行的 smoke test 會透過 Hosting Emulator API 建立 deterministic Mock User、Campaign、Mock Order、Session 與 Slot Spin，並以連接 Firestore Emulator 的 Admin SDK 檢查 persistence、Idempotency、Concurrency、Daily Bonus、Duplicate Order 與 Ledger Integrity：

```bash
pnpm --dir functions run emulator:cleanup   # 明確指定 --all，只清除本機 Firestore Emulator
pnpm --dir functions run build
firebase emulators:start
pnpm --dir functions run verify:integration
```

預設 smoke test 連線 `http://127.0.0.1:5000`；可用 `INTEGRATION_BASE_URL`、`FIRESTORE_EMULATOR_URL`、`FIREBASE_PROJECT_ID` 與 `INTEGRATION_RUN_ID` 覆寫。Browser E2E 可用 `pnpm --dir functions run verify:browser` 執行，需提供 `PLAYWRIGHT_CORE_ROOT`、`BROWSER_E2E_SESSION_TOKEN` 與本機 Chrome 路徑。實際驗證結果記錄於 [docs/INTEGRATION_VERIFICATION.md](docs/INTEGRATION_VERIFICATION.md)。

Staging 只先整理為 Deployment Ready，不會在沒有明確 Firebase Staging Project 與部署授權時建立雲端資源或部署。完整設定、部署 checklist、rollback 與 secret handling 請見 [docs/STAGING.md](docs/STAGING.md)。

## Development Flow

1. 開啟 Development Admin。
2. 建立 Mock User。
3. 建立並啟用 purchase Campaign：每滿 NT$1,000 發 `SLOT_SPIN +1`，有效 Invoice 發 `INVOICE_DRAW +1`。
4. 建立 NT$3,380、有效發票的 Mock Order；Wallet 應得到 `SLOT_SPIN: 3`、`INVOICE_DRAW: 1`、`POINTS: 0`。
5. 以該 User 建立 Development Session，保存明文 token 供本次開發測試使用。
6. 呼叫 `GET /api/me/wallet` 或在 Admin 載入 Wallet。
7. 呼叫 Slot API；每次成功遊玩會扣 `SLOT_SPIN`、增加 Server reward，當日第一次另加 `+5 POINTS`。

## API

### Development Session

```http
POST /api/dev/sessions
Content-Type: application/json
```

```json
{ "userId": "USR_01ABC" }
```

Response 的明文 token 只在建立時回傳；Firestore `dev_sessions` 只保存 hash。

### Wallet

```http
GET /api/me/wallet
Authorization: Bearer <development-session-token>
```

```json
{
  "success": true,
  "data": {
    "userId": "USR_01ABC",
    "balances": {
      "SLOT_SPIN": 3,
      "INVOICE_DRAW": 1,
      "POINTS": 0
    }
  }
}
```

### Slot Spin

```http
POST /api/games/slot/spin
Authorization: Bearer <development-session-token>
Idempotency-Key: 11111111-1111-4111-8111-111111111111
Content-Type: application/json
```

Request body 必須為 `{}`；Client 不可傳 `userId`、`result`、`reward` 或 `points`。

```json
{
  "success": true,
  "data": {
    "spinId": "SPIN_...",
    "result": ["nne", "nne", "ppa"],
    "reward": { "type": "double", "points": 10 },
    "dailyMissionBonus": 5,
    "balances": { "SLOT_SPIN": 2, "POINTS": 15 }
  }
}
```

`Idempotency-Key` 重送會回傳相同 `Game Result`。若同一會員只剩一個 `SLOT_SPIN` 且同時送出兩個不同 key，只有一個 request 成功，另一個回傳 `SLOT_SPIN_EXHAUSTED`。

Phase 1 / 2A Development API 仍包括：

```text
POST /api/dev/customers
GET  /api/dev/customers/:userId
POST /api/dev/campaigns
GET  /api/dev/campaigns
POST /api/dev/campaigns/:campaignId/activate
POST /api/dev/orders
GET  /api/dev/orders
GET  /api/dev/orders/:orderId
POST /api/dev/orders/:orderId/reprocess-activity
```

## Collections

Phase 1：

- `users/{userId}`
- `external_identities/{provider_externalId}`
- `orders/{orderId}`
- `order_external_keys/{source_externalOrderId}`
- `integration_events/{eventId}`

Phase 2A：

- `campaigns/{campaignId}`
- `activity_rules/{ruleId}`
- `activity_processes/{orderId}_{campaignId}`
- `entitlements/{entitlementId}`
- `wallets/{userId}`
- `activity_ledger/{entryId}`
- `dev_sessions/{sessionId}`

Phase 2B：

- `game_results/{spinId}`：Server 結果、reward、daily bonus 與回傳時的 Wallet balance
- `game_daily_states/{userId_YYYY-MM-DD}`：Asia/Taipei 日期的第一次遊玩狀態

Slot Ledger 使用 append-only entries：`SLOT_SPIN -1`（`SLOT_PLAY`）、`POINTS +reward`（`SLOT_REWARD`），以及第一次遊玩的 `POINTS +5`（`DAILY_MISSION`）。

## Existing Slot Game Integration

`012s-slot-game` 保持獨立。Phase 2B 只修改其資料流，不重新製作 UI：

```text
GET /api/me/wallet
  ↓
顯示 Server SLOT_SPIN / POINTS
  ↓
POST /api/games/slot/spin
  ↓
原有三軸動畫停在 Server result
```

保留：`index.html`、`style.css`、三軸動畫、symbol assets、音效、Modal、Confetti、Tutorial、responsive layout。移除公開 Debug Controls；Frontend 不再決定最終結果、reward、POINTS、剩餘次數或每日 bonus。

Slot Game 的 localStorage key 為 `012s_slot_ui_v2`，只保存 `soundEnabled`、`tutorialSeen` 等 UI preference；POINTS、`SLOT_SPIN`、遊玩次數、結果與每日 bonus 不會寫入 localStorage。Development token 只可由設定的 global 或 sessionStorage 提供，不作為 Wallet authoritative data。

### Static Slot Game API 設定

若 Slot Game 與 Activity Platform 不同 origin（例如 GitHub Pages），請在載入 `script.js` 前設定 API base URL。設定值是 Activity Platform Function host（不要在結尾再加 `/api`），程式會自行呼叫 `/api/...`：

```html
<script>
  window.ACTIVITY_PLATFORM_API_BASE_URL = "https://YOUR_ACTIVITY_FUNCTION_HOST";
</script>
```

Development-only 測試可在 Slot Game 同 origin 的 DevTools Console 暫存 Session token，再重新整理：

```js
sessionStorage.setItem("012s_activity_session_v1", "YOUR_DEVELOPMENT_SESSION_TOKEN");
```

GitHub Pages origin 必須加入 Activity Platform 的 `CORS_ALLOWED_ORIGINS`；不要把正式 secret 或 private key 放入 Slot Game。

## Testing

Activity Platform Functions：

```bash
pnpm --dir functions test
pnpm --dir functions run build
pnpm --dir functions run typecheck
```

測試涵蓋 Phase 1／2A 與 Phase 2B：Campaign／Rule、Activity Engine、Entitlement／Ledger／Wallet、OrderProcessor、Session、Server reward、UUID Idempotency-Key、同 key 重送、Daily Bonus、Wallet exhaustion、Transaction-style concurrent spin 與 API input protection。

獨立 Slot Game（目前為 Vanilla JavaScript，沒有 TypeScript build）：

```bash
node --check script.js
node --test tests/frontend.test.js
```

Frontend static tests 確認公開 Debug Controls 移除、Wallet／Spin API 與 Authorization／Idempotency-Key 存在、authoritative data 不進 localStorage、Server result 交給既有動畫，以及 API failure 不產生假結果。

整合 smoke test（需要 Functions、Firestore、Hosting Emulator 正在執行）：

```bash
pnpm --dir functions run verify:integration
```

Browser E2E（需要本機 Chrome、Playwright Core、Functions／Firestore／Hosting Emulator，以及一個 Development Session token）：

```powershell
$env:PLAYWRIGHT_CORE_ROOT = "C:\\Users\\<you>\\AppData\\Local\\012s-tools\\playwright-e2e"
$env:BROWSER_E2E_SESSION_TOKEN = "<temporary-development-session-token>"
$env:BROWSER_E2E_BASE_URL = "http://127.0.0.1:8000/"
$env:BROWSER_E2E_API_BASE_URL = "http://127.0.0.1:5000"
pnpm --dir functions run verify:browser
```

Browser E2E 只把 Development Session token 放在目前 process environment；不要把 token、secret 或 private key 寫入 Repository。完整安裝、啟動、cleanup 與 staging checklist 請見 [docs/STAGING.md](docs/STAGING.md)。

## Scope Exclusions

本階段仍不實作：

- SHOPLINE API、Webhook、Authentication 或 Payload
- 正式會員 Login、正式 Admin RBAC
- 正式電子發票對獎、財政部 API
- 退款資格回收
- 優惠券、購物金、POINTS 兌換
- 其他遊戲、Slot Backend 以外的遊戲服務

## Future SHOPLINE Integration

SHOPLINE integration is intentionally not implemented in Phase 1, Phase 2A, or Phase 2B.

未來只需新增：

```text
SHOPLINE Webhook
  ↓ verifySignature()
ShoplineCommerceAdapter
  ↓
NormalizedOrder
  ↓
現有 OrderProcessor → ActivityEngine → Wallet → Slot API
```

既有 `functions/src/integrations/commerce/shopline/shoplineCommerceAdapter.ts` placeholder 保留，沒有猜測外部 Payload，也沒有加入任何 SHOPLINE secret。
