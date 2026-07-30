# 晨星公會 MVP

這是一個以 TypeScript、React 與 Vite 建立的單機牌庫構築遊戲 MVP。它使用原創文字示範牌與 placeholder 介面，不包含官方圖片、卡面、美術、Logo 或未經核對的完整卡表。

## 啟動

需要 Node.js 20+ 與 pnpm。

```bash
pnpm install
pnpm dev
```

開發伺服器啟動後，依終端機顯示的網址開啟即可遊玩。

## 常用指令

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm check
```

## MVP 已完成

- 單機一位真人玩家對上簡單 AI。
- 五階段回合：行動一、討伐、行動二、購買、休息。
- 個人牌庫抽牌／棄牌重建、隊伍左側擠出、裝備、道具使用區、招募／購買與最小前綴討伐。
- 魔物、魔王、終局輪、榮譽計分與平手比較。
- Content Pack、Rules Module、可擴充敵方 Encounter、Snapshot、Command、Event、PlayerView 與 LocalGameSession 邊界。
- 簡單 AI 只透過相同的合法 Command 介面操作；沒有另一套 AI 規則。
- localStorage 自動保存版本化 Snapshot 與近期事件紀錄。
- Deterministic Playwright journey 會以原創示範內容走完真人討伐、招募、休息、AI 回合與 v3 local save reload；這是 runtime／測試穩定化能力，不是正式基礎卡表完成的宣告。
- e2e mode 的 typed、validated 原創示範 scenario registry 也會以正常 UI 操作觸發已註冊的全魔王／全羈絆終局，驗證 final round、AI 收尾、單次 scoreboard、排名／榮譽／討伐統計，以及「開啟新遠征」後 revision、事件與 replay history 歸零；它不修改 engine state，也不增加 production debug 捷徑。
- 核心 UI 已硬化 keyboard Tab/Enter/Space path、操作後焦點交接、卡牌動作 accessible name、status／alert announcements 與明顯 `:focus-visible`；Playwright 會驗證 1280×800、1024×768、667×375 與 320px（150% 文字）沒有整頁水平溢位，並在平板與手機橫向走合法操作。這是 MVP 核心流程的可近用性基線，並非完整 WCAG 認證。
- 規則核心 Vitest 回歸測試，涵蓋抽牌途中洗牌、展示不洗牌、隊伍滿員、過量派遣、道具休息棄置、供應牌庫耗盡與 Snapshot round-trip。

## 有意保留的限制

- `packages/content-base` 目前是可玩的**原創示範內容包**；不是完整、逐字對應的官方卡表。待卡表完成雙人覆核後，可替換資料而不修改引擎。
- 個別卡牌的複雜效果、協助者、羈絆輪抽與 Vol.1 尚未啟用。
- 基礎版公共供應牌庫耗盡時，依 `docs/09-待確認事項.md` 進入 `pendingOfficialRuling`，不自行杜撰後續結果。
- 終局 E2E 只覆蓋目前 base Rules Module 已實際註冊、且可由原創示範 scenario 合法觸發的全魔王／全羈絆條件；完整正式基礎卡表與其他未確認終局資料仍待覆核。
- M6 尚待 release gate／regression matrix、正式內容資料覆核、跨瀏覽器與手動 assistive-technology audit；請勿將目前自動化範圍解讀為完整可近用性保證。
- 沒有連線、帳號、伺服器、房間或遠端 Session；這些只保留了 protocol／adapter 邊界。
- AI 為可完整走完基本回合的簡單策略，尚未做難度、評估或長期規劃。

## 架構

```text
apps/web                 React/Vite 介面與 LocalGameSession adapter
packages/game-protocol   可序列化 state、command、event、snapshot 型別
packages/game-engine     純 TypeScript 規則引擎、查詢與計分
packages/content-base    可替換的原創 MVP Content Pack
packages/game-ai         可替換 AI Strategy
docs/                    規則、架構、未決事項與 Roadmap
```

規則實作前請先閱讀 `docs/README.md`。未確認規則不得寫死為官方規則。
