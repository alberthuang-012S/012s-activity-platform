# Phase 3A — Invoice Bonus Draw System

本文件描述以既有 `INVOICE_DRAW` Wallet balance 為入口的電子發票額外兌獎系統。Phase 3A 只處理活動、獎池、抽獎交易、結果與 manual prize claim；不實作正式電子發票 API、財政部對獎、SHOPLINE、退款資格回收或 Phase 3B。

## Data flow

```text
Development Session
  ↓ actor userId
GET /api/me/invoice-draw/status
  ↓
POST /api/games/invoice-draw/draw
  ↓
available active campaign + immutable prize snapshot
  ↓ one Firestore transaction
INVOICE_DRAW -1
POINTS + reward (POINTS prize only)
limited inventory -1 (if applicable)
optional pending PrizeClaim (MANUAL_PRIZE only)
InvoiceDrawResult
```

核心抽獎服務只接收 server-resolved actor 與 UUID `Idempotency-Key`。Client 不能指定 `userId`、campaign、prize、points、weight、stock 或 result。正式抽獎 entropy 由 Node `crypto.randomBytes(32)` 產生；Firestore 只保存 entropy hash，不保存 raw seed。

## Campaign lifecycle

- `draft`：可以編輯 campaign 與 prize configuration。
- `active`：使用 immutable prize pool snapshot；只有抽獎日期內可抽。
- `paused`：暫停抽獎，可 resume 或 end。
- `ended`：終止且不可恢復。

啟用時會檢查日期、Asia/Taipei timezone、最多 20 個獎項、唯一 code、enabled prize、positive weight、reward configuration 與 limited stock，並拒絕與其他 active／paused campaign 重疊。啟用後不能修改獎項、權重、reward 或獎池；limited inventory 只由 server transaction 遞減。

## Reward kinds

| Kind | Wallet effect | Claim |
| --- | --- | --- |
| `NONE` | `INVOICE_DRAW -1`，不增加 POINTS | none |
| `POINTS` | `INVOICE_DRAW -1`、`POINTS + points` | none |
| `MANUAL_PRIZE` | `INVOICE_DRAW -1`，不增加 POINTS | 建立 pending `prize_claims` |

`POST /api/dev/prize-claims/:claimId/fulfill` 只把 pending claim 標記為 fulfilled，且具 idempotent 行為；不會再次扣 Wallet 或庫存，也不保存個資。

## Collections

- `invoice_draw_campaigns`
- `invoice_draw_prizes`
- `invoice_draw_prize_inventory`
- `invoice_draw_results`
- `prize_claims`

Browser 不直接讀寫上述 collections；Firestore rules 維持拒絕 client access，所有異動經 Cloud Functions / Admin SDK。

## Development limitations

目前 `/api/me/**` 與 `/api/games/**` 使用 Development Session 解析 actor；Production Member Authentication 尚未實作。Development Admin 只供本機或受控環境，staging / production environment guard 仍會關閉 Development API。未來正式身份系統只需替換 actor resolution boundary，不應讓 Client 成為 Wallet 或抽獎結果的權威來源。

本階段沒有修改 `012s-slot-game`、沒有開始 Phase 3B、沒有部署 staging，也沒有加入 SHOPLINE credentials。
