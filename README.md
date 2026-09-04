# 2050 × 012S 會員活動平台

這個 Repository 是 2050 × 012S 會員活動平台的 Phase 1 主專案。Phase 1 先建立獨立於任何電商平台的會員與訂單核心資料流；既有 `012s-slot-game` 是獨立 Repository，本專案不複製、不重製，也不修改它。

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

Phase 1 不包含 Wallet、POINTS 後端化、活動規則、Reward、拉霸串接、正式登入、正式 Admin 權限或電子發票正式 API。

## Project Structure

```text
functions/src/
├─ domain/
│  ├─ customer/
│  └─ order/
├─ services/
├─ integrations/commerce/
│  ├─ mock/
│  └─ shopline/
├─ repositories/
├─ api/dev/
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

Hosting 的 `/api/**` rewrite 會把請求送到 `api` 這個 2nd Gen HTTP Function。Admin 不會直接寫 Firestore；Firestore rules 也禁止 Browser 直接讀寫 Phase 1 collections。

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

目前統一錯誤 code 包含 `INVALID_ORDER`、`INVALID_CUSTOMER`、`CUSTOMER_NOT_FOUND`、`DUPLICATE_ORDER`、`EXTERNAL_CUSTOMER_ALREADY_EXISTS`、`DATABASE_ERROR`、`INTERNAL_ERROR` 與 `SHOPLINE_NOT_ENABLED`。

## Collections

Phase 1 只使用以下 Firestore collections：

- `users/{userId}`：平台自己的 `USR_...` 會員 ID
- `external_identities/{provider_externalId}`：外部 Customer 對應自己的 User
- `orders/{orderId}`：平台自己的 `ORD_...` 訂單與 Normalized Order 資料
- `order_external_keys/{source_externalOrderId}`：Server-side transaction 防重複索引
- `integration_events/{eventId}`：每次輸入的處理追蹤與錯誤 code

所有這些 collection 僅由 Cloud Functions Admin SDK 寫入。

## Testing

在 `functions/` 執行：

```bash
pnpm test
pnpm run build
```

測試涵蓋：建立會員與 External Identity、正常訂單、重複訂單、不存在會員、無效金額、paid 缺少 paidAt、重複 External Customer，以及 Integration Event 狀態。

## Future SHOPLINE Integration

SHOPLINE integration is intentionally not implemented in Phase 1.

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

既有 `012s-slot-game` Repository 與其 GitHub Pages 線上版本維持獨立。本 Phase 1 不修改拉霸 UI、動畫、素材、音效、POINTS、localStorage 或遊戲流程；會員訂單也尚未增加拉霸次數。Wallet / Activity Engine / Slot Game 串接留待後續階段。
