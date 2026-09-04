# 2050 × 012S 會員活動平台

這個 Repository 是 2050 × 012S 會員活動平台的主專案，已完成 Phase 1 核心資料層與 Phase 2A 活動資格流程。Phase 2A 仍獨立於任何電商平台；既有 `012s-slot-game` 是獨立 Repository，本專案不複製、不重製，也不修改它。

## Architecture

目前資料流如下：

```text
Development Admin
  ↓ HTTP API
MockCommerceAdapter
  ↓
NormalizedOrder
  ↓ validateNormalizedOrder
OrderProcessor
  ↓ resolve customer / transaction deduplication
Activity Engine（paid order；依 paidAt 找 Campaign）
  ↓ one Firestore transaction per order + campaign
Entitlement + Activity Ledger + Wallet + Activity Process
  ↓
Repositories
  ↓
Cloud Firestore
  ↓
Integration Event
```

所有來源的訂單都必須先成為 `NormalizedOrder`。核心 Processor、Domain、Repository 不依賴任何特定電商平台。未來接入 SHOPLINE 時，接點會是新的 Adapter 與 Webhook Endpoint；目前不包含 SHOPLINE Payload、SDK、API Key、Secret 或 Authentication。

## Phase 1

本階段包含：

- Firebase Cloud Functions 2nd Gen + TypeScript
- Cloud Firestore Repository
- Mock Customer 與 External Identity
- Mock Order → `MockCommerceAdapter` → `NormalizedOrder` → `OrderProcessor`
- Firestore Transaction 防止相同 `source + externalOrderId` 重複建立
- `integration_events` 的 received / processing / processed / ignored / failed 狀態
- 開發用 Admin：建立測試會員、建立 Mock Order、查看最近訂單
- Shopline Adapter Placeholder（刻意未啟用）

## Phase 2A

本階段在 Phase 1 上新增：

- `campaigns` 與 `activity_rules`：只支援 purchase、`ORDER_TOTAL_MULTIPLE`、`VALID_INVOICE`
- `ActivityEngine`：使用訂單 `paidAt` 判斷 active Campaign，不依賴重新處理時的現在時間
- `entitlements`、`activity_ledger`、`wallets`、`activity_processes`
- Activity Process deterministic idempotency：同一 `orderId + campaignId` 不會重複發資格
- Entitlement、Ledger、Wallet、Activity Process 在同一 Firestore Transaction 寫入
- Development-only Session（只保存 SHA-256 token hash）與 `GET /api/me/wallet`
- Development Admin：Campaign 建立/啟用、會員 Wallet/Ledger、訂單活動明細、Activity reprocess

Phase 2A 的預設驗收規則是每滿 NT$1,000 發 `SLOT_SPIN +1`，每張有效 Mock Invoice 發 `INVOICE_DRAW +1`。`POINTS` 目前只保留 Wallet 欄位，維持 0；Slot Backend、Slot Play API、Server Random 與遊戲積分計算屬於尚未開始的 Phase 2B。

## Project Structure

```text
functions/src/
├─ domain/
│  ├─ customer/
│  ├─ order/
│  ├─ activity/
│  └─ session/
├─ services/
│  ├─ activityEngine.ts
│  ├─ campaignService.ts
│  ├─ walletService.ts
│  ├─ sessionService.ts
│  └─ activityQueryService.ts
├─ integrations/commerce/
│  ├─ mock/
│  └─ shopline/
├─ repositories/
│  ├─ campaignRepository.ts
│  ├─ activityProcessRepository.ts
│  ├─ entitlementRepository.ts
│  ├─ activityLedgerRepository.ts
│  ├─ walletRepository.ts
│  └─ sessionRepository.ts
├─ api/
│  ├─ dev/
│  └─ me/
├─ config/
└─ utils/
admin/
firebase.json
firestore.rules
firestore.indexes.json
```

## Firebase Setup

需求：Node.js 20+、Java runtime（Firestore Emulator 需要）、Firebase CLI，以及可使用的 npm-compatible package manager（本機可使用 `pnpm`）。

安裝完成後可先確認：

```bash
node --version
java -version
firebase --version
pnpm --version
```

Firebase CLI 執行 Firestore Emulator 時需要 Java runtime；若 CLI 顯示額外的 Java 版本要求，請依目前 Firebase CLI 官方要求安裝。

1. 安裝 Functions dependencies：

   ```bash
   pnpm --dir functions install
   ```

   也可使用：

   ```bash
   npm --prefix functions install
   ```

2. 依環境複製 `.env.development.example` 或 `.env.production.example` 為 `functions/.env`（也可從 `.env.example` 開始）。本機 Emulator 不需要 Firebase private key；正式環境請由部署環境提供設定，不要把憑證 commit 到 Repository。Production 預設會關閉 Development Admin。

3. `.firebaserc` 的 `demo-012s-activity-platform` 只作為本機 Emulator 的隔離 project name，不代表正式 Firebase project。若要使用正式或測試 Firebase project，使用 Firebase CLI 的 project alias 或 `--project` 設定；TypeScript 不會寫死 project ID。

## Emulator Setup

先編譯 Functions，再從 Repository 根目錄執行：

```bash
pnpm --dir functions run build
firebase emulators:start
```

預設會啟動：

- Hosting：<http://127.0.0.1:5000>
- Development Admin：<http://127.0.0.1:5000/admin/>
- Functions：<http://127.0.0.1:5001>
- Firestore：<http://127.0.0.1:8080>
- Emulator UI：<http://127.0.0.1:4000>

Hosting 的 `/api/**` rewrite 會把請求送到 `api` 這個 2nd Gen HTTP Function。Admin 不會直接寫 Firestore；Firestore rules 也禁止 Browser 直接讀寫 Phase 1 與 Phase 2A collections。若本機尚未安裝 Firebase CLI 或 Java，Emulator Integration Test 仍屬待實機驗證事項。

## Mock Customer

```http
POST /api/dev/customers
Content-Type: application/json
```

```json
{
  "displayName": "測試會員 A",
  "externalCustomerId": "TEST-CUSTOMER-001"
}
```

成功會建立 `users/USR_...` 與 `external_identities/mock_TEST-CUSTOMER-001`。相同 Provider + External ID 會回傳 HTTP 409 `EXTERNAL_CUSTOMER_ALREADY_EXISTS`。

查詢會員：

```http
GET /api/dev/customers/:userId
```

## Mock Order

```http
POST /api/dev/orders
Content-Type: application/json
```

```json
{
  "externalOrderId": "TEST-ORDER-001",
  "externalCustomerId": "TEST-CUSTOMER-001",
  "status": "paid",
  "amount": 3380,
  "items": [
    {
      "productId": "PPA001",
      "sku": "PPA+1",
      "name": "PPA+1",
      "quantity": 1,
      "unitPrice": 3380
    }
  ],
  "invoiceNumber": "MOCK-INV-001"
}
```

這個 endpoint 只會依序呼叫 Mock Adapter、Normalized Order validation、Order Processor 與 Repository。不存在的 `externalCustomerId` 會回傳 `CUSTOMER_NOT_FOUND`，不會自動建立會員。

查詢最近訂單：

```http
GET /api/dev/orders
```

相同 `source = mock` 與 `externalOrderId` 的第二次提交不會建立第二筆 Order，也不會再次執行 Phase 2 活動流程；該次 Integration Event 會是 `ignored` / `DUPLICATE_ORDER`。

若有 active purchase Campaign，只有新建立且 `paid` 的 Order 會進入 Activity Engine。Engine 依 `paidAt` 對照 Campaign 時間，並將每一筆 Entitlement、Ledger、Wallet 與 Activity Process 在同一個 Firestore Transaction 中完成。以 NT$3,380、有效發票為例，Wallet 會得到 `SLOT_SPIN: 3`、`INVOICE_DRAW: 1`、`POINTS: 0`。

## Phase 2A API

建立 Campaign（先建立 draft）：

```http
POST /api/dev/campaigns
Content-Type: application/json
```

```json
{
  "name": "2026 測試消費活動",
  "startsAt": "2026-09-01T00:00:00+08:00",
  "endsAt": "2026-12-31T23:59:59+08:00",
  "thresholdAmount": 1000,
  "slotSpinGrantQuantity": 1,
  "invoiceDrawGrantQuantity": 1
}
```

```http
GET /api/dev/campaigns
POST /api/dev/campaigns/:campaignId/activate
```

同一時間重疊的 active purchase Campaign 會被拒絕；Campaign 啟用後不能修改既有 Rule。

Development Session：

```http
POST /api/dev/sessions
Content-Type: application/json
```

```json
{
  "userId": "USR_01ABC"
}
```

Response 只在建立時回傳明文 token；Firestore 的 `dev_sessions` 只保存 SHA-256 hash。使用 token 查詢目前會員 Wallet：

```http
GET /api/me/wallet
Authorization: Bearer <development-session-token>
```

Development Admin 也可使用以下驗收用 API：

```http
GET /api/dev/customers/:userId
GET /api/dev/orders/:orderId
POST /api/dev/orders/:orderId/reprocess-activity
```

Development-only API 與 Session 在 `APP_ENV=production` 或 `DEV_ADMIN_ENABLED=false` 時停用。CORS 不使用 `*`；Development 預設允許 localhost/127.0.0.1，其他來源透過 `CORS_ALLOWED_ORIGINS` 設定。

## API Response

成功：

```json
{
  "success": true,
  "data": {}
}
```

失敗：

```json
{
  "success": false,
  "error": {
    "code": "CUSTOMER_NOT_FOUND",
    "message": "Customer could not be resolved."
  }
}
```

目前統一錯誤 code 包含 `INVALID_ORDER`、`INVALID_CUSTOMER`、`CUSTOMER_NOT_FOUND`、`DUPLICATE_ORDER`、`EXTERNAL_CUSTOMER_ALREADY_EXISTS`、`INVALID_CAMPAIGN`、`INVALID_ACTIVITY_RULE`、`CAMPAIGN_NOT_FOUND`、`CAMPAIGN_OVERLAP`、`CAMPAIGN_IMMUTABLE`、`ACTIVITY_PROCESSING_FAILED`、`INVALID_WALLET_BALANCE`、`INVALID_SESSION`、`SESSION_EXPIRED`、`DATABASE_ERROR`、`INTERNAL_ERROR` 與 `SHOPLINE_NOT_ENABLED`。

## Collections

Phase 1 collections 保留：

- `users/{userId}`：平台自己的 `USR_...` 會員 ID
- `external_identities/{provider_externalId}`：外部 Customer 對應自己的 User
- `orders/{orderId}`：平台自己的 `ORD_...` 訂單與 Normalized Order 資料
- `order_external_keys/{source_externalOrderId}`：Server-side transaction 防重複索引
- `integration_events/{eventId}`：每次輸入的處理追蹤與錯誤 code

Phase 2A 新增：

- `campaigns/{campaignId}`：purchase Campaign、期間與 draft/active/ended 狀態
- `activity_rules/{ruleId}`：Campaign 的 `ORDER_TOTAL_MULTIPLE` / `VALID_INVOICE` 規則
- `activity_processes/{orderId}_{campaignId}`：Activity Process deterministic idempotency 狀態
- `entitlements/{entitlementId}`：資格來源、數量與狀態
- `wallets/{userId}`：目前 `SLOT_SPIN`、`INVOICE_DRAW`、`POINTS` balance
- `activity_ledger/{entryId}`：append-only Wallet 變動紀錄
- `dev_sessions/{sessionId}`：Development Session 的 token hash 與到期時間

所有 collection 僅由 Cloud Functions Admin SDK 寫入；Browser 與 Development Admin 不直接操作 Firestore。

## Testing

在 `functions/` 執行：

```bash
pnpm test
pnpm run build
pnpm run typecheck
```

測試涵蓋：建立會員與 External Identity、正常訂單、重複訂單、不存在會員、無效金額、paid 缺少 paidAt、重複 External Customer，以及 Integration Event 狀態；Phase 2A 另涵蓋 Campaign/Rule validation、訂單金額規則、有效發票規則、Campaign 日期判定、pending/no-invoice、Wallet 累加、Activity Process/Entitlement/Ledger idempotency、OrderProcessor 串接與 Development Session。

## Future SHOPLINE Integration

SHOPLINE integration is intentionally not implemented in Phase 1 or Phase 2A.

未來的預期資料流：

```text
SHOPLINE Webhook
  ↓ verifySignature()
ShoplineCommerceAdapter
  ↓
NormalizedOrder
  ↓
現有 processOrder()
```

本階段已保留 `functions/src/integrations/commerce/shopline/shoplineCommerceAdapter.ts` 作為 placeholder，沒有猜測外部 Payload，也沒有加入任何 SHOPLINE secret。接入時應只新增 Adapter 實作與 Webhook Endpoint，核心 User、Order、NormalizedOrder、Order Processor 與 Firestore schema 不需重寫。

## Existing Slot Game

既有 `012s-slot-game` Repository 與其 GitHub Pages 線上版本維持獨立。本 Phase 2A 不修改拉霸 UI、動畫、素材、音效、POINTS、localStorage 或遊戲流程，也沒有把 Slot Game 複製進本 Repository。Phase 2A 只建立 `SLOT_SPIN` / `INVOICE_DRAW` 資格與 Wallet；Slot Backend、Slot Play API、Server Random、POINTS 計算與前端 API integration 明確留待尚未開始的 Phase 2B。
