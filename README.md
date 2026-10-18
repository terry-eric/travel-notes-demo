# 旅手帖 Travel Notes

以每日行程為中心的繁體中文旅行規劃工具：建立多個行程、安排景點與停留時間、調整順序、整理出發前筆記，並透過 Google Maps 查看地點與路線。雲端版支援 Google 帳號登入，以及每個行程各自的檢視者與編輯者權限。

[開啟旅手帖](https://demo.terry878.org/trip) · [GitHub 原始碼](https://github.com/terry-eric/travel-notes-demo) · [GitHub Pages 入口](https://terry-eric.github.io/travel-notes-demo/)

正式入口為 **https://demo.terry878.org/trip**，已啟用並驗證直接 Google 登入。使用自己的 Google 帳號登入後，以該帳號已驗證的 email 管理旅行；只有擁有者與該行程受邀的成員可以取得內容。資料儲存在雲端並支援跨裝置同步。GitHub Pages 會轉到同一個正式入口，不載入示範旅行或另一份資料庫。

公開的是網站入口與原始碼；旅行內容不會因為網站開放而變成公開資料。請將正式服務網址交給要使用的人，登入後從「我的旅行」開始。

正式服務直接使用 Google 登入，不依賴 Cloudflare Access，也不占用 Access 的使用者席次。Cloudflare Workers 與 D1 的運算、請求和儲存額度仍由所有使用者共用；相關限制見下方部署說明。

## 三種執行方式

| 方式 | 資料儲存 | 身分與分享 | 適合用途 |
| --- | --- | --- | --- |
| 正式服務／Cloudflare Workers | Cloudflare D1 | Google 帳號登入；伺服器檢查每個行程的權限 | 每人私人旅行、跨裝置、多人協作 |
| `npm run dev` | 本機 `.local/preview.sqlite` | 預覽程式代入測試 email，沒有真正的登入 | 開發 API 與資料操作 |
| `npm run dev:demo`（選配開發預覽） | 目前瀏覽器的 localStorage | 合成範例；沒有真正的登入、邀請信或多人同步 | 本機介面測試 |

GitHub Pages 只提供轉址入口，沒有登入表單、行程資料或跨來源 API 呼叫。本機開發預覽與正式服務資料彼此獨立；請勿把真實行程、私人 email 名單、D1 匯出、登入憑證或 API key 提交到公開儲存庫。`dev:demo` 的修改只在同一瀏覽器與網站來源保留；清除網站資料或使用無痕模式可能讓開發預覽資料消失。

## 本機快速開始

需要 Git 與 **Node.js 24 LTS**。本機資料庫使用 Node 內建的 `node:sqlite`，不需另外安裝 SQLite。npm lockfile 固定相依套件，包含 Wrangler **4.145.0**。

```powershell
git clone https://github.com/terry-eric/travel-notes-demo.git
cd travel-notes-demo
npm ci
npm run build
npm test
npm run dev
```

開啟終端機印出的 `Local:` 網址。`Ctrl+C` 停止伺服器。若只需要不啟動本機資料庫的合成介面預覽，可改用下列選配指令：

```powershell
npm run dev:demo -- --port=4173 --base=/travel-notes-demo
```

| 指令 | 用途／輸出 |
| --- | --- |
| `npm run build` | 產生雲端 Worker 使用的 `dist/server/index.js`，不需 `.openai` 設定 |
| `npm run build:entry` | 產生 GitHub Pages 的正式服務轉址入口 `_pages/` |
| `npm run build:demo` | 產生選配本機示範的 `_site/`，不會由 Pages workflow 發布 |
| `npm run dev:demo` | 建置並預覽瀏覽器本機示範 |
| `npm run dev` | 在 loopback 啟動 Node／SQLite 開發預覽；開啟印出的 `/trips` 網址 |
| `npm run dev:trip` | 同一個開發預覽，測試 `/trip` 子路徑 |
| `npm test` | 執行 Node 測試；初次測試前先執行 `npm run build` |
| `npm run deploy` | 建置並將雲端版部署至自己設定的 Cloudflare 帳號 |

開發預覽預設身分為 `owner@example.com`，只綁定 `127.0.0.1`。若要檢查另一個使用者建立自己的行程，可在 PowerShell 設定：

```powershell
$env:TRIP_PREVIEW_EMAIL = 'friend@example.com'
npm run dev
```

`TRIP_PREVIEW_DB` 可指定另一個本機 SQLite 檔案；預設為 `.local/preview.sqlite`。這些開發身分不代表已驗證的雲端登入。請使用自己部署的 HTTPS 網域測試真正的 Google 登入流程。

### 完整本機版：Node + SQLite

不需要 Cloudflare 帳號或網域，就能在自己的電腦開啟完整的行程 API 與 SQLite 資料庫：

```powershell
npm ci
npm run build
npm test
npm run dev
```

伺服器會選擇可用連接埠（port `0` 表示由系統分配），印出例如 `Local: http://127.0.0.1:12345/trips` 的網址；請複製實際輸出，不要把範例連接埠當成固定值。資料第一次使用時會建立 `.local/preview.sqlite`，依序套用本機遷移並初始化虛構台灣範例。停止伺服器後資料仍在，重新執行即可繼續。

想測試雲端預設的 `/trip` 子路徑時，停止原本預覽再執行：

```powershell
npm run dev:trip
```

macOS／Linux 也使用同一組 npm 指令。模擬其他帳號的寫法為：

```sh
TRIP_PREVIEW_EMAIL=friend@example.com npm run dev
```

本機版是單機開發預覽，以指定 email 測試資料權限；它沒有真正的登入，也沒有外部分享網址。共同編輯或跨裝置使用請採用下方的 Cloudflare 部署。

本機 `npm run dev`／`dev:trip` 只讀取程序環境變數，**不會自動載入 `.env` 或 `.dev.vars`**。若需選配的 Maps key，在執行 npm 前設定 `GOOGLE_MAPS_EMBED_KEY`，或將 `.env.example` 複製為 `.env`、填入 key，再使用 Node 的明確載入方式：

```powershell
node --env-file=.env scripts/dev.mjs
```

macOS／Linux 同樣可執行這條 Node 指令。`.dev.vars` 是 Wrangler 本機開發用的設定，不能取代此處 Node 程式的環境變數。Pages 入口與選配 `dev:demo` 不會讀取以上任何 key。

## GitHub Pages 正式服務入口

儲存庫的 Pages workflow 只上傳 `npm run build:entry` 產生的 **`_pages/`**，內容僅有 `index.html`、`404.html` 與 `.nojekyll`。入口自動前往正式網域，也提供可手動點選的按鈕。舊的 `index.html?page=…` 示範網址同樣會進入正式入口；它的示範參數不會帶到雲端或匯入成私人資料。

Pages 不會部署 Worker、D1、Access 設定或本機資料庫，也不會發布 `_site/` 的合成行程。GitHub Pages 和正式服務沒有各自一套使用者資料；登入與同步都在正式網域完成。

1. Fork 或建立自己的公開儲存庫，保留 `.github/workflows/pages.yml`。部署自己的雲端服務後，在 `scripts/build-entry.mjs` 把固定的 `liveAppUrl` 改成自己的 HTTPS 入口。
2. 在 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
3. 推送至預設的 `main` 分支，或從 Actions 頁面手動執行 Pages workflow。
4. 等待建置與部署成功，開啟 workflow 的 `github-pages` 環境網址。

[教學截圖：GitHub Pages 的 Source 選擇 GitHub Actions](docs/screenshots/04-github-pages.png)

此截圖為儲存庫的 Pages 設定頁；Fork 後請在自己的儲存庫完成相同設定。

專案型 Pages 網址通常為 `https://<帳號>.github.io/<儲存庫>/`。正式服務使用 `/trip/trips`、`/trip/daily` 等路徑；旅行連結應分享正式網域的網址。

workflow 使用 `actions/configure-pages@v5`、`actions/upload-pages-artifact@v4` 與 `actions/deploy-pages@v4`，部署工作需要 `pages: write`、`id-token: write` 和 `github-pages` 環境。設定方式見 [GitHub Pages 自訂 workflow 官方文件](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 在自己的 Cloudflare 架設服務

以下以 **`https://trip.example.com/trip`** 為範例。請全部換成自己的主機、網域、帳號與 email；`example.com` 和範本識別碼無法直接部署成可用服務。

### 1. 準備帳號、網域與設定檔

需要 Cloudflare 帳號、已加入 Cloudflare 的網域，以及該主機的 **Proxied（橘雲）DNS** 記錄。Worker 採用 Route 掛在既有主機的子路徑；此範本不使用完整主機的 Custom Domain 路由。

```powershell
npm ci
Copy-Item wrangler.example.jsonc wrangler.jsonc
npx wrangler login
```

macOS／Linux 將複製設定檔那一行改為 `cp wrangler.example.jsonc wrangler.jsonc`，其餘 npm／Wrangler 指令相同。

編輯本機 `wrangler.jsonc`：

| 欄位 | 範例 | 說明 |
| --- | --- | --- |
| `name` | `travel-notes` | 自己的 Worker 名稱 |
| `routes[0].pattern` | `trip.example.com/trip*` | 主機與子路徑的 Worker Route |
| `routes[0].zone_name` | `example.com` | 這個主機所在的 Cloudflare Zone |
| `vars.APP_HOST` | `trip.example.com` | 小寫的完整 hostname；不含協定、連接埠或路徑 |
| `vars.APP_BASE` | `/trip` | 子路徑；不加結尾 `/`，根目錄使用空字串 `""` |
| `vars.AUTH_MODE` | `google` | 正式服務使用直接 Google 登入；不設定此值會保留舊版 Access 驗證 |
| `vars.GOOGLE_CLIENT_ID` | 自己的 `…apps.googleusercontent.com` | Google Auth Platform 的 Web application client ID；不是 Maps API key |
| `vars.OWNER_EMAIL` | `owner@example.com` | 公開範例行程的初始擁有者；一般使用者仍可建立自己的行程 |
| `d1_databases[0].database_id` | 建立 D1 後取得的 UUID | 勿使用範本中的佔位文字 |

直接 Google 模式必須保留範本的三個 `ratelimits` 綁定；缺少綁定時伺服器不會放行登入或私人 API：

| Binding name | 範本 `namespace_id` | `simple.limit` / `period` | 計算對象 |
| --- | --- | --- | --- |
| `AUTH_LOGIN_LIMITER` | `531801` | 30 / 60 秒 | 公開登入請求依 IP 限速，先檢查再操作登入資料表 |
| `AUTH_API_LIMITER` | `531802` | 120 / 60 秒 | 已登入 API 請求依 Google 的固定帳號識別碼限速 |
| `AUTH_WRITE_LIMITER` | `531803` | 30 / 60 秒 | 已登入寫入請求依同一個固定帳號識別碼限速 |

`namespace_id` 是由你選擇的正整數字串，應在自己的 Cloudflare 帳號中分開使用；若 `531801`–`531803` 已被其他 Worker 使用，換成三個未使用的值。同一 namespace 會共用計數器。Cloudflare 原生限速依服務請求的機房計算，計數器採非同步更新，**不是全球精確總額或防止帳單超額的硬上限**；仍需監看 Workers 與 D1 的整體用量。[Workers Rate Limiting 官方文件](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

`APP_BASE` 可為 `/private/travel` 等由英數、底線、連字號組成的路徑。若改用根目錄，請同時改 Route 為 `trip.example.com/*`；若改用 `/travel`，Route 和 `APP_BASE` 要一起修改。Google 的 Authorized JavaScript origins 設主機來源，不填子路徑。

範本的 `/trip*` 會包含 `/trip`、`/trip?trip=…` 及其下的資源。Cloudflare Route 比對包含查詢字串，所以只設定精確 `/trip` 與 `/trip/*` 會漏掉帶查詢字串的父路徑。Worker 再以 `APP_HOST` 和 `/trip` 的路徑邊界檢查請求，對 `/tripper` 或其他主機回傳 404；缺少或格式錯誤的主機／子路徑設定回傳 503。[Workers Route 比對規則](https://developers.cloudflare.com/workers/configuration/routing/routes/)

保持 `workers_dev: false` 與 `preview_urls: false`，避免增加設定之外的網站入口。Worker 只接受符合 `APP_HOST` 和 `APP_BASE` 的網址。對應欄位見 [Wrangler 設定官方文件](https://developers.cloudflare.com/workers/wrangler/configuration/)。自己的 `wrangler.jsonc`、`.dev.vars`、`.env` 和本機資料庫不應提交到公開儲存庫。

### 2. 建立 D1 與套用完整資料表遷移

```powershell
npx wrangler d1 create travel-notes-db --config wrangler.jsonc
```

將輸出的 `database_id` 複製到 `wrangler.jsonc`，確認 `database_name` 是 `travel-notes-db`、binding 是 `DB`、`migrations_dir` 是 `drizzle`。接著查看並套用 **遠端** 遷移：

```powershell
npx wrangler d1 migrations list travel-notes-db --remote --config wrangler.jsonc
npx wrangler d1 migrations apply travel-notes-db --remote --config wrangler.jsonc
```

`--remote` 會操作雲端 D1；`--local` 操作 Wrangler 自己的本機資料庫，和 `npm run dev` 的 `.local/preview.sqlite` 不同。請確認名稱與 config 指向預期資料庫。[D1 Wrangler 指令](https://developers.cloudflare.com/d1/wrangler-commands/)

不要只建立最早的 `trips` 表。這個版本需要以下六個 SQL 檔案，Wrangler 會依序執行並記錄已套用的遷移：

| 檔案 | 用途 |
| --- | --- |
| `0000_tidy_sheva_callister.sql` | 舊版行程內容與 revision |
| `0001_flawless_texas_twister.sql` | 舊版邀請名單 |
| `0002_multi_trip.sql` | 多行程、每個行程的成員、遷移標記與舊表保護 |
| `0003_trip_archive.sql` | 刪除行程與恢復 |
| `0004_stop_creators.sql` | 景點建立者的歷史紀錄 |
| `0005_google_sessions.sql` | Google 固定帳號與 email 的唯一對應、一次性登入挑戰與可撤銷網站 session |

SQL 本身不會帶入私人旅行資料。這個公開儲存庫的部署範本會在第一次通過驗證的 API 請求，把**虛構台灣範例**初始化給 `OWNER_EMAIL`；預設為 `owner@example.com`。其他登入者的「我的旅行」從空白開始，無法取得這份範例，除非受邀。若不需要範例，可讓 `OWNER_EMAIL` 保持為不使用的範例地址；若需要自己的帳號擁有範例，請在**第一次 API 使用之前**設定。初始化後再改這個變數不會轉移既有行程的擁有者。正式網域的既有資料與部署範本無關；Pages 入口不含任何種子行程。

若從既有版本升級，先做下方的資料備份。`0002` 保留舊表作為恢復快照；首次 API 初始化後舊表被 trigger 鎖定。不要刪除遷移標記或解除保護來強迫重跑。[D1 migrations 官方說明](https://developers.cloudflare.com/d1/reference/migrations/)

### 3. 建立 Google 帳號登入

此模式不需要 Cloudflare Access application，也不需要 Google client secret 或 Maps API key。Google Identity Services 使用 Web application client ID；身份驗證用途只需要基本的 email／profile／openid，不要求 Gmail、Drive 等資料存取權限。[Google 登入設定](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

1. 在 Google Cloud 選擇自己的專案，開啟 **Google Auth Platform → Branding**，設定應用程式名稱、支援 email、正式網站網址及隱私政策；Authorized domains 填自己的主網域，例如 `example.com`。本版提供 `/trip/privacy` 隱私說明頁；若改動 `APP_BASE`，使用對應的路徑。
2. 在 **Audience** 選擇 **External**，讓組織以外的 Google 帳號可登入。本版只使用 Sign in with Google 的基本 `openid`、`email`、`profile` 身分資料：依 Google 官方例外，即使維持 Testing，使用者也不必加入測試名單，不受一般 Testing 的 100 位測試使用者名單限制，這類授權不會在 7 天後到期。網站本身的 24 小時 session 仍照常到期。若日後增加其他 OAuth scopes，就不能沿用此例外，必須重新檢查發布狀態、測試限制及敏感／受限權限的驗證要求。[Google Audience 與基本登入例外](https://support.google.com/cloud/answer/15549945)
3. 在 **Clients → Create client** 選擇 **Web application**。Authorized JavaScript origins 填 **`https://trip.example.com`**，不加 `/trip` 或其他路徑。這個版本使用 Google 彈出視窗的 JavaScript callback，無需另填登入 Redirect URI。
4. 把產生的 client ID 放入 `wrangler.jsonc` 的 `vars.GOOGLE_CLIENT_ID`，並明確設定 `vars.AUTH_MODE` 為 `google`。Client ID 是公開設定；不應把 client secret 或其他憑證貼進前端。
5. 套用上一步的 `0005_google_sessions.sql`，設定三個 `AUTH_*_LIMITER` 綁定，完成下方建置與部署。如果原本有 Cloudflare Access 保護同一個 `/trip` 網址，先保持原設定，等確認 Google 設定與 Worker 部署都正確後，再撤下該網址的 Access application 保護，避免使用者被導向舊的 email OTP 登入頁。

基本 Google 登入不需要先完成品牌驗證；尚未驗證品牌時，Google 登入同意畫面顯示應用程式網域。若要顯示自己的應用程式名稱及 logo，才需要依 Google 的流程驗證並發布品牌。品牌展示驗證與敏感資料權限驗證是分開的要求。[Google 品牌設定與驗證](https://support.google.com/cloud/answer/15549049)

部署後開啟 `https://trip.example.com/trip/login`，使用官方 **使用 Google 帳號登入** 按鈕。伺服器檢查 Google ID token 的 RS256 簽章、issuer、client ID、有效時間、已驗證 email 及一次性 nonce；不能只傳 email 或自行編寫身分 header 代替登入。為確保 email 身分由 Google 掌握，此版本接受 Gmail 及 Google Workspace 的已驗證帳號；不接受只把第三方 email 綁到 Google 的帳號。

登入挑戰有效 10 分鐘且只能使用一次。登入成功後使用 24 小時網站 session；cookie 為 Secure、HttpOnly、SameSite=Lax，只套用在 `APP_BASE` 內。D1 保存 session 的雜湊與到期時間，不保存 Google 密碼；每個 Google 帳號最多保留 10 個網站 session。登出會撤銷目前網站 session，登入 Google 的其他網站不受影響。

同一瀏覽器開啟多個登入頁時，每頁各自有 10 分鐘、一次性的驗證挑戰，共用已建立的 HttpOnly 瀏覽器 cookie；再開登入頁不會取消前一頁尚未完成的挑戰。任一頁登入成功或登出會清除挑戰 cookie，其他尚未完成的登入頁需重新整理，或使用已建立的網站登入 session。

行程權限仍以已驗證 email 判定。新帳號從自己的空白旅行清單開始，擁有者可邀請特定 email 作為 viewer 或 editor。邀請不會寄出 email，請另行交付正式網域的旅行連結。登入公開網站不會取得其他人的旅行。

第一次成功登入會將 Google 的固定 `sub` 與已驗證 email 原子地綁定在 `auth_identities`；Google 帳號 ID 與 email 都有唯一約束。之後若同一個 Google 帳號更換 email，或另一個 Google 帳號取得原 email，系統會要求人工處理身分移轉，不會自動把原旅行交給新帳號。這也保護 Google Workspace email 被重新分配的情況。移轉前需核對身分與既有行程權限；不要刪除對應資料來跳過保護。

#### 選配：保留舊版 Access 登入

已有 Access 部署且尚未切換 Google 時，可以不設定 `AUTH_MODE=google`，繼續使用 `ACCESS_ISSUER` 與 `ACCESS_AUD` 驗證。`ACCESS_ISSUER` 必須是自己的 `https://your-team.cloudflareaccess.com`，`ACCESS_AUD` 是同一個 Access application 的 Application Audience。

設定 One-time PIN 身分提供者與 Self-hosted application，在同一個 application 保護 `trip.example.com/trip` 和 `trip.example.com/trip/*`。Allow policy 可使用 **Include → Emails** 指定私人團體；若開放已驗證 email 則使用 **Include → Login Methods → One-time PIN**，不要使用 Bypass。Worker 仍驗證 `Cf-Access-Jwt-Assertion` 的簽章、issuer、AUD 與有效期。這是舊版選配模式，正式服務改用 Google 模式後不會信任 Access headers。[OTP 設定](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)、[Access 規則](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)、[JWT 驗證](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

Access Free 上限為整個 Zero Trust 組織共用的 **50 個使用者席次**，不是同時在線人數。帳號驗證登入後占用席次，登出不會釋放；額滿時新使用者會被擋下。此限制只適用此處的 Access 模式，直接 Google 登入不占用 Access 席次。[Cloudflare 方案](https://www.cloudflare.com/plans/)、[席次管理](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/)

### 4. 建置、檢查與部署

確認 hostname、Route、D1 UUID、遷移、三個限速綁定、`AUTH_MODE=google` 與 Google client ID 都已完成後執行：

```powershell
npm run build
npm test
npx wrangler deploy --dry-run --config wrangler.jsonc
npm run deploy
```

`--dry-run` 僅檢查／打包，不會上傳 Worker；它不能驗證 DNS、Google client 的網站來源設定或遠端 D1 遷移是否正確。`npm run deploy` 會實際上傳至登入的帳號。[Workers deploy 指令](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

部署後開啟 `https://trip.example.com/trip`，先完成 Google 登入，再檢查「我的旅行」。使用另一個帳號檢查：可建立自己的行程，未受邀的行程無法取得內容，viewer 只能看，editor 可以儲存修改，只有 owner 可以管理邀請與刪除／恢復。撤銷邀請後，該成員不應再讀取該行程；登出後 API 不應再接受先前的 session。

## 建立行程與共同編輯

### 每日名稱、路線地圖與機票

- **每天取名**：點擊總覽或每日行程的每日名稱，直接輸入，例如「東山散步日」。按 Enter 或離開欄位自動儲存，不需另外按儲存；按 Esc 或「取消」放棄草稿。地圖和每日內容使用同一個名稱。
- **外側時間軸**：卡片外顯示開始、停留與離開時間，點一下時間即可修改。交通平常只顯示交通方式圖示和分鐘數；點開後可輸入 0–1440 分鐘，按「完成」收起。Google Maps 按鈕用來查路線，再自行填入確認過的分鐘數。下一站抵達時間依「本站開始＋停留＋通勤」重新計算；固定預約保留原時間，來不及時提醒，缺少停留或交通時間時停止計算。路線或交通方式改變後須重新確認分鐘數。
- **編號地圖**：總覽顯示整趟旅行，每日行程也有當日路線圖；旅途地圖可切換當日／整趟旅行。不同日期使用不同顏色，依日期圖例辨識，點編號對應景點。連線表示當天行程順序，並非實際道路或自動導航，跨日期不硬接。地點需有座標，完整 Google Maps 地點網址的目的地座標可帶入，也可手動填「緯度, 經度」；僅有店名或短網址時不會猜測定位。地點更改後需重新定位。
- **新增機票**：按「＋ 新增行程」，將「行程類型」改成「機票／航班」。填機場、各機場當地的出發／抵達日期、時間與 IANA 時區（例如 `Asia/Taipei`、`Asia/Tokyo`），可另填航空公司、航班號、航廈、訂位代號和備註。選擇對應的安排日期後儲存。每日時間列換算到旅行時區，機票保留兩地原始時間，飛行分鐘數依時差計算；出發時間固定，不會被一般交通順延。每個航段最多 24 小時，轉機請分段新增。
- **卡片標籤**：直接點卡片上的標籤選擇分類，外框顏色會跟著更新並自動儲存，不必開啟編輯視窗。檢視者只能查看標籤，無法修改。

地圖使用本地打包的 Leaflet 1.9.4 與 OpenStreetMap 圖磚，不需要 Google API key；Leaflet 授權見 `public/vendor/leaflet/LICENSE.txt`。圖磚只供目前畫面正常互動使用，保留可見署名及瀏覽器快取，不預抓／離線下載；公開圖磚沒有可用性保證。見 [OpenStreetMap 圖磚政策](https://operations.osmfoundation.org/policies/tiles/)。排列互動參考 [Funliday 官方行程教學](https://www.funliday.com/posts/funliday-app-ios-guidance-search/)，沒有複製其品牌或資料。

[本機教學截圖：編號地圖](docs/screenshots/05-route-map.png) · [交通分鐘數](docs/screenshots/06-inline-transport.png) · [機票資料](docs/screenshots/07-flight-fields.png)

每個登入帳號都能從「我的旅行」建立自己的行程，設定名稱、起訖日期與時區。進入行程後，可編輯每日景點、停留時間、交通方式、地圖連結與筆記；編輯者的景點建立者紀錄由伺服器保存。

### 教學 1：從「我的旅行」開始

[本機教學截圖：我的旅行與建立表單](docs/screenshots/01-my-trips.png)

1. 開啟網站，選擇左側的 **我的旅行**。
2. 按 **＋ 建立新旅行**，填寫 **旅行名稱**、**出發日期**、**結束日期** 與 **旅行目的地時區**。
3. 按 **建立並開始規劃**。新旅行會按照選擇的日期建立空白每日行程。
4. 在清單點選旅行即可繼續編輯；可從 **已刪除** 區域恢復自己先前刪除的旅行。

本節截圖使用本機合成資料，只作教學參考，並非正式服務的使用者資料或 GitHub Pages 展示行程。正式服務登入後只顯示自己的或受邀的旅行；本機 SQLite 版可用相同的建立、編輯與匯入步驟，但沒有真正的 email 登入或跨裝置同步。

### 教學 2：新增／編輯每日行程

[本機教學截圖：名稱、安排日期與固定時間](docs/screenshots/02-edit-stop.png)

1. 進入一趟旅行，選擇 **每日行程** 與日期，按 **＋ 新增行程**。
2. 編輯框填寫名稱、安排日期、地點與備註；時間、停留時間、順序、標籤與交通方式的重複欄位已先收起，保留既有設定。
3. 展開 **地點與 Google Maps 分享連結**，填入具體店名／地址，或貼上 Google Maps 的分享連結。
4. 有已確認的航班、預約或演出，勾選 **固定時間（保留原定時間）**，再按 **儲存行程**。
5. 修改景點內容時先點開卡片，再按 **編輯**。時間和停留可直接點卡片外的時間軸；兩站之間的交通時間點開後填分鐘並按 **完成**。分類標籤可直接在卡片上選擇，外框顏色同步改變。
6. 總覽可把行程卡片拖到另一個日期；手機長按後拖動。也可在編輯框的 **安排日期** 選擇新日期。當日順序以拖曳調整；移動後需重新確認改變路段的交通分鐘數。機票的安排日期須與實際出發日期相符。

### 教學 3：匯入 GPT 規劃

[本機教學截圖：匯入 GPT 行程](docs/screenshots/03-gpt-import.png)

1. 開啟旅行中的 **匯入行程**，切換到 **匯入 GPT 行程**。
2. 在提示詞中的 **我的需求** 填寫目的地、想去的地方與偏好，按 **複製提示詞**，貼到 ChatGPT 或其他 AI。
3. 取得指定格式的 JSON 後，貼回匯入對話框，按 **預覽匯入行程**。
4. 檢查日期、時間、地點、停留時間與固定預約；確認後按 **匯入並儲存**。

匯入會把項目加入現有行程，不會替換整趟旅行。一次支援 1–100 筆；AI 回覆的營業時間、地址與交通安排仍需自己查核。網站不會自動呼叫 OpenAI API，也不需要 OpenAI API key。

| 身分 | 查看行程 | 編輯內容 | 管理邀請 | 刪除／恢復行程 |
| --- | --- | --- | --- | --- |
| Owner（擁有者） | ✓ | ✓ | ✓ | ✓ |
| Editor（編輯者） | ✓ | ✓ | — | — |
| Viewer（檢視者） | ✓ | — | — | — |
| 其他已登入帳號 | 只能查看自己的或被邀請的行程 | 依該行程權限 | — | 只能管理自己的行程 |

擁有者在行程邀請介面填寫對方登入使用的 email，選擇 viewer 或 editor，將同一個行程連結交給對方。權限以行程為單位，不會因為加入某一個行程就看到其他人的行程。

雲端儲存使用 revision 檢查更新；多人修改時，前端嘗試合併，遇到衝突會讓使用者選擇。頁面會定期讀取新的版本，並保留尚未送出的本機草稿。這是輪詢與衝突合併，沒有聊天室、即時游標或完整的無限版本歷史。顯示連線／儲存錯誤時，先保留草稿並重新登入或重試。

## Google Maps（選配）

未設定 key 時仍可使用地點／Google Maps 連結。若需要 Maps Embed API 的路線 iframe，在 Google Cloud 建立自己的專案、依官方要求完成帳單設定並啟用 **Maps Embed API**，建立專用 API key。[Maps Embed API 入門](https://developers.google.com/maps/documentation/embed/get-api-key)

對這把 key 設定：

- **Application restrictions：Websites / HTTP referrers**，允許自己的 HTTPS origin，例如 `https://trip.example.com/*`，必要時加上 `https://trip.example.com`。請勿允許所有網站。
- **API restrictions：Restrict key → Maps Embed API**，不要讓同一把 key 同時授權不需要的 API。

瀏覽器傳給 Google 的 referrer 常只有 origin，請勿只限制 `/trip/*` 而漏掉 origin。若加上 `no-referrer`／`same-origin` 政策，地圖可能因為無法驗證 referrer 而拒絕顯示。[Google API key 安全建議](https://developers.google.com/maps/api-security-best-practices)、[Embed iframe 的 referrer 設定](https://developers.google.com/maps/documentation/embed/embedding-map)

完成第一次 Worker 部署後，在終端機互動輸入 key：

```powershell
npx wrangler secret put GOOGLE_MAPS_EMBED_KEY --config wrangler.jsonc
```

key 會出現在使用者瀏覽器的 iframe URL，因而可被看到；Cloudflare secret 僅避免把它直接放進儲存庫，網站與 API 限制仍需設定。Pages 轉址入口與選配本機 `dev:demo` 不需要這把 key，也不會讀取你的 Cloudflare 設定。

地圖 iframe 顯示的交通估計不會自動寫入行程時間表。本程式沒有付費 Routes／Directions API 的自動 ETA 計算；請自行確認交通時間並填寫。刪改前後景點或交通方式後，也應重新確認原本輸入的交通時間。

## 備份、升級與回退

更新前先匯出遠端 D1，備份檔含旅行內容與 email，請存放在公開儲存庫之外。下面路徑是 PowerShell 範例，可自行改成私人備份資料夾：

```powershell
$tripBackupDir = Join-Path $env:USERPROFILE 'PrivateTravelBackups'
New-Item -ItemType Directory -Force -Path $tripBackupDir
$tripBackupFile = Join-Path $tripBackupDir ('travel-notes-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
npx wrangler d1 export travel-notes-db --remote --output $tripBackupFile --config wrangler.jsonc
npx wrangler d1 time-travel info travel-notes-db --config wrangler.jsonc
```

保存匯出檔、Time Travel bookmark 與更新前的 Worker version ID。備份檔不應放進 `_site/`、`_pages/` 或 GitHub Pages artifact。[D1 匯入／匯出說明](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

**只回退程式**時，先查看版本並選擇相容版本：

```powershell
npx wrangler versions list --config wrangler.jsonc
npx wrangler rollback YOUR_PREVIOUS_VERSION_ID --config wrangler.jsonc
```

Worker rollback 會實際切換線上程式，但不會還原 D1 資料表或資料。`0002` 遷移初始化後，最早的單一行程版本不能再寫入已鎖定的舊表；請選擇支援目前多行程 schema 的版本。[Workers 版本與 rollback](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)

**還原資料**時，先停止使用／避免新修改，另外備份目前資料，確認 bookmark 與時間後才執行：

```powershell
npx wrangler d1 time-travel restore travel-notes-db --bookmark YOUR_SAVED_BOOKMARK --config wrangler.jsonc
```

這會覆寫整個資料庫，bookmark 之後的修改會消失；Worker 程式也必須與還原後的 schema 相容。Time Travel 預設啟用，Free 可回復最近 7 天、Paid 最近 30 天。需要更長期保存時請另外保存 SQL 匯出。[D1 Time Travel 與備份](https://developers.cloudflare.com/d1/reference/time-travel/)

## 現有限制與容量

程式目前每個帳號最多建立 **100 個行程，包含已刪除但可恢復的行程**，每個行程 **1–60 天**，每天最多 **100 個項目**；邀請名單最多 **200 個 email 記錄**，包含撤銷後仍保留的記錄。行程寫入請求上限約 **1,000,000 bytes**。刪除是可恢復的封存，仍占資料庫空間；目前沒有 owner 轉移或一般使用者永久刪除功能。

| D1 容量 | Workers Free | Workers Paid |
| --- | --- | --- |
| 每個資料庫上限 | 500 MB | 10 GB |
| 帳號資料庫數量 | 10 | 50,000 |
| 帳號合計儲存上限 | 5 GB | 1 TB |

容量由所有使用者共用，不能把帳號的 5 GB 當成這一個 Free D1 的容量。實際可容納的行程數取決於內容長度、previous 快照、歷史紀錄和索引；應以 `npx wrangler d1 info travel-notes-db --config wrangler.jsonc` 與 Cloudflare 儀表板監看使用量。[D1 官方限制](https://developers.cloudflare.com/d1/platform/limits/)

Free 還有每日讀寫及 Workers 請求額度；Paid 的儲存包含量與硬上限是不同概念，超過包含量可能收費。方案會調整，請依官方即時資料評估，而不要把本文件當作價格承諾。[D1 價格](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers 價格](https://developers.cloudflare.com/workers/platform/pricing/)

## 專案結構與常見問題

```text
public/              共用前端、樣式與公開範例
demo/                選配本機合成預覽的 API 與入口
server/              API、行程權限、Google／舊版 Access 驗證與 Worker
drizzle/             0000–0005 SQL 遷移
scripts/             雲端／Pages 入口／本機預覽建置
tests/               API、同步、介面與路由驗證
wrangler.example.jsonc  不含真實識別碼的雲端設定範本
dist/server/index.js 建置產物；供 Cloudflare entry point 匯入
_pages/              GitHub Pages 的唯一發布目錄；只含正式服務入口
_site/               選配本機合成預覽產物；不發布至 Pages
```

- **Pages 部署 404：** 確認 Source 是 GitHub Actions，Actions 的 Pages 工作成功，網址包含自己的儲存庫子路徑；必須發布 `_pages/`，不可把 `dist/` 或 `_site/` 當作目前的 Pages 目錄。
- **Pages 還看到舊示範：** 等待最新的 Pages workflow 部署成功後重新整理；正式入口為 `https://demo.terry878.org/trip`。舊示範在瀏覽器中的修改不會自動轉到雲端。
- **503「部署網址尚未設定」：** 檢查 `APP_HOST`、`APP_BASE` 的格式；hostname 要小寫、不能帶 `https://`，base 不能有結尾 `/`。
- **Google 登入未啟用：** 確認 `AUTH_MODE=google`、`GOOGLE_CLIENT_ID` 是自己的 Web application ID、`0005_google_sessions.sql` 已套用，以及三個 `AUTH_*_LIMITER` 綁定都存在。不要把 Maps API key 當成登入 client ID。
- **無法確認 Google 帳號：** 本版已修正公鑰讀取在 workerd 拋出 `keys_fetch_TypeError` 的問題：使用 `redirect: 'manual'`，並在解析金鑰前拒絕所有重新導向。不要改成跟隨任意轉址或關閉簽章驗證。測試包含真正 workerd 的本機公鑰來源與拒絕轉址案例；初次執行前先安裝專案依賴。[Cloudflare 執行環境的轉址驗證](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B#L446)
- **API 回傳 429：** 暫停密集重試並稍後重試；檢查該限速 binding 的 namespace 是否與別的應用程式共用。限速不是帳務硬上限。
- **登入提示帳號 email 已變更或身分需移轉：** Google 固定帳號 ID 與原 email 的對應不一致，需由管理者核對後處理；不要改用 email header 或刪除 `auth_identities` 來繞過驗證。
- **Google 顯示 origin 不允許：** Authorized JavaScript origins 要填正式網站來源，例如 `https://trip.example.com`，不含 `/trip`；也要檢查 OAuth Audience 是否允許該登入帳號。
- **仍出現 Cloudflare email OTP：** 同一個網址仍受舊 Access application 保護；確認直接 Google 登入已設定、測試並部署後，撤下該網址的 Access 保護。
- **登入後 API 401：** Google 模式請重新登入並確認 session 未過期、cookie 沒被瀏覽器攔截；第三方 email 綁定的 Google 帳號不在本版支援範圍。舊 Access 模式則檢查父路徑及 wildcard 是否受同一個 application 保護，以及 issuer／AUD 是否相符。
- **某個行程 403：** 確認登入 email 與邀請名單相同、成員仍啟用，並開啟含正確 `trip` ID 的行程連結。
- **API 503 或無法建立行程：** 檢查 `DB` binding 與 UUID、遠端 migrations 是否完整；勿把已部署 Worker 誤綁到空資料庫。
- **地圖拒絕顯示：** 檢查 Google Cloud API 啟用、帳單、key 的 API／網站限制與瀏覽器錯誤訊息；不要把真實 key 放進 GitHub。

公開入口、Google 登入設定及舊版 Access 席次限制於 2026-10-18 查核；其餘部署指令與官方連結於 2026-10-04 查核。Cloudflare、Google 與 GitHub 的介面與方案可能更新。
