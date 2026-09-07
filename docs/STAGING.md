# Staging Preparation

本文件整理 2050 × 012S Activity Platform 的 staging deployment preparation。這個階段只建立可部署的設定、檢查清單與 smoke test，不會在沒有明確 project 與部署授權時建立 Firebase 雲端資源，也不會部署 production。

目前的 `012s-activity-platform` Firebase CLI default project `demo-012s-activity-platform` 只供本機 Emulator 隔離使用。不要把它當成 staging 或 production project。

## 1. Required tools

請在 Windows 本機安裝並確認：

```powershell
node --version       # 專案 Functions engine 為 Node 20
pnpm --version
java -version        # Firestore Emulator 需要 JDK/runtime
firebase --version   # Firebase CLI
```

若尚未安裝：

1. 安裝 Node.js 20 LTS（會一併提供 npm），再重新開啟 PowerShell。
2. 安裝 Eclipse Temurin JDK 21 或 Firebase CLI 所要求的 Java runtime，確認 `java` 已加入 PATH。
3. 使用 npm 安裝 Firebase CLI：

   ```powershell
   npm install -g firebase-tools
   firebase --version
   ```

若公司環境不允許 global install，可依內部工具政策使用等效的 user-scoped 安裝方式；不要把 Firebase CLI 或 Java 的系統檔案放進 Repository。

## 2. Firebase project preparation

準備一個已獲授權、與 development 和 production 分開的 Firebase project。完成登入後，以 CLI alias 管理 project；不要把未知或不存在的 project ID 寫進 TypeScript：

```powershell
firebase login
firebase use --add
# 選擇已核准的 project，alias 請輸入 staging
firebase use staging
firebase projects:list
```

實際 project ID 可由 CI 的 `--project`、Firebase CLI alias 或部署環境提供。不要把 service-account JSON、private key 或 session token 放進 Repository。

## 3. Firestore

部署前確認 staging project 的 Firestore database、rules 與 indexes 已準備完成。Repository 的 `firestore.rules` 預設拒絕 browser 直接讀寫；資料異動由 Cloud Functions / Admin SDK 執行。

```powershell
firebase deploy --project staging --only firestore:rules,firestore:indexes
```

上述命令只能在已選定且已授權的 staging alias 上執行。

## 4. Functions

Functions 使用 Firebase Cloud Functions 2nd Gen，region 預設為 `asia-east1`。部署前在 `functions` 目錄安裝依賴並建置：

```powershell
pnpm --dir functions install --frozen-lockfile
pnpm --dir functions run build
```

## 5. Hosting

Hosting public root 是 Repository 根目錄，`/api/**` 透過 `firebase.json` rewrite 至 `api` Function。部署前確認 `admin/` 與既有靜態檔案都在預期 branch 上；Slot Game GitHub Pages 是獨立 Repository，不由本專案 Hosting 取代。

## 6. Environment variables

以 [.env.staging.example](../.env.staging.example) 為非敏感設定範本。staging 至少應設定：

```text
APP_ENV=staging
DEV_ADMIN_ENABLED=false
FUNCTIONS_REGION=asia-east1
CORS_ALLOWED_ORIGINS=https://<approved-staging-origin>
FIREBASE_PROJECT_ID=<provided-by-deployment-environment>
```

`APP_ENV=staging` 會強制關閉 Development Admin 與 Development Session。`DEV_ADMIN_ENABLED=true` 不會覆蓋這項安全門檻。空白的 `CORS_ALLOWED_ORIGINS` 在 staging 不會套用 development defaults；請明確列出實際前端 origin。

## 7. CORS

CORS 只允許精確 origin，不是 Authentication。不得使用：

```text
Access-Control-Allow-Origin: *
```

若沒有正式會員 Authentication / Identity Integration，不應把未受保護的 `/api/dev/**` 公開部署到 Internet。staging 可以保持 Deployment Ready，但不能以 CORS 限制取代身份驗證。

## 8. Build

從 Repository 根目錄執行：

```powershell
pnpm --dir functions run build
```

目前 Functions package 宣告 Node 20；CI 與部署環境應使用 Node 20，避免只在不同 Node major 版本上驗證。

## 9. Tests

執行 baseline tests、typecheck、Admin syntax check 與 Slot Game 的獨立 frontend checks：

```powershell
pnpm --dir functions test
pnpm --dir functions run typecheck
node --check admin/admin.js
node --check ..\012s-slot-game\script.js
node --test ..\012s-slot-game\tests\frontend.test.js
```

Emulator 可用後，再執行：

```powershell
pnpm --dir functions run verify:integration
```

## 10. Deploy

只有在 project、權限、環境變數與 review 都完成後，才可由已授權操作者執行：

```powershell
firebase deploy --project staging --only functions,firestore:rules,firestore:indexes,hosting
```

本次沒有執行上述部署；目前狀態是 Deployment Ready preparation，而非 Publicly Deployed。

## 11. Smoke test

本機 Emulator 啟動後，預設服務為 Hosting `http://127.0.0.1:5000`、Functions `http://127.0.0.1:5001`、Firestore `http://127.0.0.1:8080`、Emulator UI `http://127.0.0.1:4000`。從根目錄執行：

```powershell
pnpm --dir functions run build
firebase emulators:start
pnpm --dir functions run verify:integration
```

Smoke test 會建立 deterministic integration data，驗證 User、Campaign、Order、Activity Engine、Entitlement、Ledger、Wallet、Development Session、Slot Spin、Idempotency、Concurrency、Daily Bonus、Duplicate Order、Session Isolation 與 Firestore ledger sums。可用 `INTEGRATION_RUN_ID` 換一組測試 ID；若要清除整個本機 Firestore Emulator，必須明確執行：

```powershell
pnpm --dir functions run emulator:cleanup
```

cleanup 只應對本機 Emulator 使用，不可指向 staging 或 production。

## 12. Rollback

部署前記錄目前 commit、Firebase release 與 hosting version。若 staging 驗證失敗，先停止對外流量，再由已審核的上一個 commit 重新 build/deploy；Hosting 可依 Firebase CLI 支援的 release rollback 流程復原。不要以 `git reset --hard` 或 force push 取代雲端 rollback。

## 13. Secret handling

禁止 commit：

- Firebase private key 或 service-account JSON
- Development Session 明文 token
- SHOPLINE API key / secret
- API password 或其他部署 secret

Development Session 只有建立回應暫時回傳明文 token；Firestore 僅保存 SHA-256 token hash。CI secret 應由 CI secret store 或 Firebase 部署環境提供。

## 14. Production differences

Production 與 staging 都必須關閉 Development Admin / Development Session，使用精確 CORS allowlist，並透過正式會員身份系統提供 `Authorization: Bearer <token>`。Slot Game 的 API base URL 可透過 `window.ACTIVITY_PLATFORM_API_BASE_URL` 切換；不要把 localhost 或尚不存在的 production endpoint 寫死在 `script.js`。

## 15. Authentication gap

目前的 Development Session 只供本機／受控測試。正式部署前仍缺少 Production Member Authentication / Identity Integration。未完成前，Development Admin 與 `/api/dev/**` 不得直接公開在 Internet；SHOPLINE、正式會員登入、電子發票正式 API、退款資格回收與 POINTS 兌換也不在本階段範圍。
