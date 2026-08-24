# 即時協作同步服務遷移計畫

**狀態**: 程式碼已完成並本機測試通過,**尚未部署到 production**。
**目標**: 把 `/srv/atelier-sync`(獨立 Node + socket.io + Docker + nginx + cloudflared)換成掛在既有 `atelier` Cloudflare Worker 底下的 Durable Object,共用 `atelier.re95.org`,不用再自己維運一台 Node process。

## 現況

- 前端:`src/collabSync.js` 用 `socket.io-client` 連到 `VITE_SYNC_URL`(預設 `https://sync.re95.org`),送 `join` / `canvas-update` / `active-layer`,收 `presence` / `sync-state` / `canvas-update`。
- Room id(`syncRoomId`,見 `src/widgetContext.js`):要嘛是 Matrix widget 帶進來的 `matrix_room_id`(格式如 `!AbCdEfGh:matrix.org`,含 `!` `:` 等特殊字元),要嘛是 `/collab/<id>` 裡由「Start collaboration」按鈕產生的隨機字串。**目前完全沒有伺服器端驗證** — 任何字串都會在 `/srv/atelier-sync/server.js` 的 `getRoom()` 裡即時建立一個新 room。這個「來者不拒」的行為是既有設計。
- 後端:`/srv/atelier-sync/server.js` — 純記憶體 `rooms: Map<roomId, room>`,每個 room 有 `participants`、`layerOrder`、`layers`(含 `rev` 版本號防止過期覆蓋)。走 Docker → nginx(`127.0.0.1:80`)→ cloudflared tunnel → `sync.re95.org`。
- `atelier.re95.org` 本身**已經是 Cloudflare Worker**(不是純 Pages):`wrangler.toml` 設 `routes = atelier.re95.org/*` + `[assets]` 做靜態檔案,`cloudflare-worker/worker.js` 已有自訂邏輯處理 `/og`。
- Workers 帳號已確認是 **Paid 方案**(2026-08-24 確認)。

## 目標架構(已實作)

| 現在 | 之後 |
|---|---|
| Node process,`rooms = Map<roomId, room>` | 一個 Durable Object **實例**對應一個 room(`env.SYNC_ROOM.getByName(roomId)`),`rooms` 這層外層 Map 消失,因為每個 DO instance 本身就是一個 room |
| `room.participants` / `room.layers` (in-memory) | DO 的 in-memory class 欄位,**不用 `ctx.storage`** |
| `socket.join(roomId)` | client WebSocket 連到 `wss://atelier.re95.org/sync/<roomId>`(URL-encoded),由 `worker.js` 路由到對應 DO |
| `io.to(roomId).emit(...)` | DO 迴圈自己持有的 WebSocket 連線送出 |
| `socket.io-client`(自帶重連、心跳、封包格式) | 原生 `WebSocket` + 自製指數退避重連(1s → 15s) |
| nginx + cloudflared + Docker | Cloudflare Worker route,不用額外基礎設施 |

### 關鍵設計決定:不用 Hibernation API

一開始評估時預設會用 `ctx.acceptWebSocket()`(Hibernation API,閒置時可省計費),但查證文件後發現這條路對這個 app 不安全,已改用標準 `server.accept()`:

- Hibernation 觸發時,DO 的 **JS heap 會被整個清空**(constructor 重新跑一次),一般 in-memory 欄位(`this.layers`、`this.participants`)全部消失。
- 唯一能跨 hibernation 存活的是 `serializeAttachment()`,但上限只有 **16KB**——而畫布圖層 `dataURL` 動輒好幾 MB(這也是舊 server.js 要把 `maxHttpBufferSize` 拉到 15MB 的原因),完全塞不下。
- DO SQLite storage 單一 row/BLOB 上限也只有 **2MB**,一樣裝不下完整圖層資料,所以「落 storage 保留 hibernation 後的狀態」這條路也不通。
- 結論:用標準 `accept()`,狀態全部留在記憶體。代價是只要房間裡還有人連著,DO 就會持續計費(不會被 hibernate 省錢),但查證文件確認**入站 WebSocket 連線本身沒有強制斷線時間上限**(15 分鐘那個限制只適用於 DO 當「客戶端」的出站連線),所以長時間協作 session 不會被硬斷線。跟舊 Node process「只要沒重啟就一直活著」的行為特性一致,且這個 app 流量規模下的 duration 計費可忽略不計。

## 已解決的待決事項

- **路徑**:定案用 `/sync/<roomId>`(worker.js 判斷 path prefix `/sync/`,`decodeURIComponent` 還原 roomId 再丟給 `getByName`)。沒有沿用 `/socket.io/*`,因為協議本身已經不是 socket.io 了,沿用舊路徑只會誤導。
- **Room 合法性**:維持現況「任意字串即建立」,不做白名單/註冊機制——沒有這個需求範圍,且現有 Matrix widget room id 本來就是外部系統(Matrix)發的,無法預先註冊。防濫用完全交給下面的邊緣層 rate limiting,不動應用邏輯。
- **DO storage**:確認不落 `ctx.storage`,純 in-memory ephemeral,跟舊 Node 版行為一致(重啟/所有人離開後房間消失)。
- **Workers 帳號方案**:已確認 Paid。

## 已完成的程式碼變更

1. **`cloudflare-worker/syncRoom.js`(新檔)**— `SyncRoom` Durable Object 類別,把 `server.js` 的 `getRoom` / `roomHasState` / `snapshotState` / `broadcastPresence` / canvas-update 的 rev-guard 邏輯搬過來,操作 DO 自己持有的 WebSocket 連線集合。含 connect/join/disconnect 的時間戳 + `cf-connecting-ip` log(沿用先前 `/srv/atelier-sync` 那次修正的做法,這裡走 Cloudflare Worker 直接收流量,不需要再處理 tunnel 那層的 IP 遺失問題)。
2. **`cloudflare-worker/worker.js`**— 加 `/sync/<roomId>` 路由,`export { SyncRoom }`,其餘邏輯(`/og`、靜態資源)不變。
3. **`wrangler.toml`**— 加 `durable_objects.bindings`(`SYNC_ROOM` → `SyncRoom`)與 `migrations`(`new_sqlite_classes`,即使沒真的用 storage,這是目前官方建議的預設寫法)。
4. **`src/collabSync.js`**— 拿掉 `socket.io-client`,改原生 `WebSocket`。對外 export 的 API(`initCollabSync`、`pushCanvasUpdate`、`pushActiveLayer`、`myIdentity`、`participants`、`syncConnected`、`recentEdits`、`RECENT_EDIT_WINDOW_MS`)完全沒變,`App.vue` / `useLayers.js` 不用改。同源預設連線(`wss://<host>/sync/<roomId>`),不用另外設 `VITE_SYNC_URL`。
5. **`package.json`**— 移除 `socket.io-client` 依賴,`npm uninstall` 已跑過。

## 已完成的驗證

- `node --check` 三個變更檔語法通過。
- `npm run build` 產出成功,無錯誤。
- `wrangler dev` 本機起服務,寫了一支多客戶端模擬腳本測試:
  - join 後正確收到 presence 廣播。
  - 一個 client push 圖層更新,其他 client 正確收到 `canvas-update` broadcast。
  - 晚加入的 client 正確收到 `sync-state`(含目前圖層)。
  - 過期 rev 的更新正確被擋下、不廣播。
  - 離線後 presence 正確更新給剩下的人。
  - log 正確輸出時間戳(離線時走 `wrangler dev`,IP 顯示 `::1`;上 production 後會是真實 `cf-connecting-ip`)。

## 尚未執行(需要你確認才會動手)

- [x] **部署**:2026-08-24 透過 `git push origin main` 觸發 `deploy-pages.yml`(GitHub Actions)自動 `wrangler deploy`,run 成功(https://github.com/Restatw/Atelier/actions/runs/32693109230)。事後用腳本直接對 `wss://atelier.re95.org/sync/<roomId>` 做端對端測試(join/presence/broadcast/late-join sync-state/rev 衝突),全部通過。
- [ ] **邊緣層濫用防護**(Cloudflare dashboard 手動設定,不是程式碼):
  - [x] WAF Rate Limiting Rule——`atelier-sync-limit`(ruleset id `7949966dec384362aac7c14a2748b59a`),URI Path wildcard `/sync/*`,`characteristics: ip.src`,`period: 10s` / `requests_per_period: 5`,`action: block`,`mitigation_timeout: 10s`,Active(2026-08-24 確認)。合理性已檢查:`/sync/*` 只在 WebSocket handshake 那一刻打一次,連上後訊息都走既有連線不會再計入,所以這個門檻限的是「10 秒內開幾條新連線」不影響正常畫布同步;跟 client 端重連退避(1s→2s→4s→8s)對得上。已知取捨:同一 IP 後面多人共用(NAT/公司網路)短時間一起加入同一房間有機會誤觸,Free 方案只能設 1 條規則、無法再細分,先維持現狀,之後有觀察到誤擋再調整。
  - [x] Worker 的 CPU time limit——`wrangler.toml` 加了 `[limits] cpu_ms = 50`(2026-08-24),`wrangler deploy --dry-run` 驗證過語法無誤。只有實際 `wrangler deploy` 之後才會生效,`wrangler dev` 本地不套用。
  - [x] Billing/Usage Notifications——已有兩條 budget alert:Cloudflare 自動建立的 $10 門檻,以及使用者自訂的 $5 門檻「帳單預算警示」(2026-08-24 確認)。
- [ ] **下線舊服務**:確認新路徑穩定後,停用 `/srv/atelier-sync` 的 docker-compose、移除 `sync.re95.org` 的 nginx site(`/etc/nginx/sites-available/sync.re95.org.conf`)與 `/etc/cloudflared/config.yml` 裡的 `sync.re95.org` ingress 條目。

## 相關檔案

- 新/改動的檔案:`cloudflare-worker/syncRoom.js`(新)、`cloudflare-worker/worker.js`、`wrangler.toml`、`src/collabSync.js`、`package.json`
- 舊服務(下線前保留):`/srv/atelier-sync/server.js`、`docker-compose.yml`、`Dockerfile`
- nginx / tunnel(下線步驟要動的):`/etc/nginx/sites-available/sync.re95.org.conf`、`/etc/cloudflared/config.yml`
