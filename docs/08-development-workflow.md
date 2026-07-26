# 開發工作流程

## 開發原則

- 先以測試描述規則，再修改引擎。
- UI 只送 command 與顯示 view model，不直接搬動卡片。
- 卡牌資料先通過 schema validation 才能進入遊戲。
- 一次 PR 聚焦一個規則或垂直功能，避免同時大量改引擎、內容與版面。
- 新功能優先放入自己的 feature／domain module，不因「已有相似檔案」就繼續堆入。
- 達到 `11-modularity-guidelines.md` 警戒線時，先拆責任再繼續增加功能。
- MVP 功能不得繞過 `GameSession`、`PlayerView`、`ContentPack`、`RulesModule` 或 workspace package boundary。

## 建議 scripts

正式建立 `package.json` 時提供：

- `dev`：本機開發伺服器
- `build`：typecheck 後建立 production build
- `typecheck`：TypeScript 檢查
- `lint`：靜態檢查
- `format` / `format:check`
- `test` / `test:watch`
- `test:e2e`
- `validate:content`：卡牌 schema、份數、引用與素材 key
- `check:architecture`：依賴方向、循環依賴、deep import 與檔案大小
- `check`：串聯 typecheck、lint、architecture、tests、build

## 測試與程式碼導覽工具採用時機

### Playwright（現在導入）

MVP 開始導入 Playwright，作為瀏覽器端的端對端測試工具；規則細節仍以 `game-engine` 的 Vitest 單元／場景測試為主。E2E 只保護少量真人玩家的關鍵路徑，避免測試慢、脆弱，或以 UI 測試重複驗證規則引擎。

- 初始目標：開局至完成一回合、討伐或購買至休息、AI 接手並返回玩家、終局與結果畫面。
- 使用 stable `data-testid`，不可依賴顯示文案、卡片圖片或易變動 CSS selector。
- 需要瀏覽器執行檔時，安裝 Playwright 的 Chromium；CI 再依執行環境補齊系統相依套件。
- E2E 失敗須保留 trace／screenshot 作為 CI artifact，但不得提交錄影與暫存結果。

### GitNexus 與 CodeGraph（專案成長後再評估）

兩者都是「理解與分析程式碼關係」的輔助工具，不是遊戲執行、建置或測試的必要依賴，也不應成為 CI 或產品 runtime 的前置條件。MVP 初期保持不安裝；以 package boundary、architecture check、focused tests 與小型模組作為主要防線。

- **導入門檻**：跨 package／內容包的依賴、call path 或重構影響已難以靠既有檔案結構與一般搜尋快速掌握時；通常在功能與模組明顯增加後再評估。
- **CodeGraph**：若建立 `.codegraph/` 索引，後續程式理解、定位 symbol 與影響分析時優先使用它。索引是本機輔助資料，不提交為產品內容，也不讓程式 runtime 依賴它。
- **GitNexus**：適合較大型重構、除錯、PR review 與跨檔案影響分析。若它與 CodeGraph 的使用情境重疊，先選一個團隊實際會使用的工具即可，避免維護兩套索引。
- **導入前檢查**：確認索引資料與快取已寫入 `.gitignore`（除非團隊刻意決定共享）、不含機密、可從原始碼重建，並在本文件記錄選擇理由與日常指令。

## 分支與提交

- 分支名稱：`feat/...`、`fix/...`、`docs/...`、`content/...`
- commit 描述「改了什麼規則／行為」，不要只寫檔名。
- 引擎與內容資料若必須同步，放在同一 PR 並清楚列出規則來源。
- 不提交 `.env`、本機存檔、測試錄影、官方下載素材或生成過程的暫存檔。

## 功能開發順序

1. 在規則文件確認行為與邊界。
2. 新增 failing test 或場景 fixture。
3. 修改 model／engine／effects。
4. 更新 selector 與 UI adapter。
5. 實作畫面與可用性。
6. 執行完整品質門檻。
7. 若決策會影響長期架構，新增 ADR。

## 一般功能 PR checklist

- [ ] 新程式放在擁有此責任的 module，不放入 catch-all 檔案
- [ ] 只透過其他 module 的 public API import，沒有跨層 deep import
- [ ] 沒有新增 circular dependency
- [ ] React component 不包含規則公式；store 不重複 engine 邏輯
- [ ] web app 未取得完整 GameState；所有操作都經 CommandEnvelope／GameSession
- [ ] 新卡或新規則放入正確 content pack，沒有把 pack ID 寫死在 engine
- [ ] 新增規則模式時，module state、zones、end/scoring/visibility policies 都有 schema 與版本
- [ ] 沒有把隊伍上限 5 或單一敵方目標寫成 engine 結構限制
- [ ] Snapshot、Command、Event、Replay 與 migration 的相容性影響已覆蓋
- [ ] 檔案、函式與複雜度未超過警戒線，或已有核准且具期限的例外
- [ ] 新增責任時同步新增 focused test，而非擴張單一大型測試檔
- [ ] `check:architecture` 通過

## 卡牌內容 PR checklist

- [ ] 穩定 ID 與 set 正確
- [ ] copies、費用、戰力、榮譽已雙重核對
- [ ] effect schema 可通過 validation
- [ ] 時點與 duration 明確
- [ ] target selector 不會選到非法區域
- [ ] 正常與邊界測試齊全
- [ ] 顯示文案不被規則引擎解析
- [ ] 素材使用 placeholder 或有來源紀錄的原創資源

## 規則問題處理

遇到規則不明時：

1. 建立最小可重現盤面。
2. 查基礎規則、卡片文字、官方勘誤與 Q&A。
3. 把仍不確定的解讀加入 `09-open-questions.md`。
4. 標示「不可自行推測」，不要把慣例、UI fallback 或其他模式的結果當成官方規則。
5. 若未決問題會阻擋功能，保持該功能未啟用或回傳具名 `RULE_CLARIFICATION_REQUIRED`；只有產品負責人明確核准的 house rule 才能使用獨立、可關閉且非官方的 policy。
6. 取得官方答案後同步更新文件、測試、ruleset version 與 changelog。

## Definition of Done

功能完成代表：

- 規則與驗收條件已落成自動測試
- TypeScript、lint、tests、build 全部通過
- 架構邊界、循環依賴與檔案大小檢查通過
- 非法 command 有明確錯誤代碼
- 操作可由鍵盤完成或有既定補強 issue
- 存檔 schema 影響已評估
- Snapshot／Command／Event／Replay／content／Rules Module version 的相容性影響已評估
- 文件與 ADR 已同步
- 沒有引入未授權素材
