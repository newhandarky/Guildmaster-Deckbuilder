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
pnpm check:presentation-assets
pnpm check
```

## MVP 已完成

- 單機一位真人玩家對上簡單 AI。
- 五階段回合：行動一、討伐、行動二、購買、休息。
- 個人牌庫抽牌／棄牌重建、隊伍左側擠出、裝備、道具使用區、招募／購買與最小前綴討伐。
- 魔物、魔王、終局輪、榮譽計分與平手比較。
- Content Pack、Rules Module、可擴充敵方 Encounter、Snapshot、Command、Event、PlayerView 與 LocalGameSession 邊界。
- 簡單 AI 只透過相同的合法 Command 介面操作；沒有另一套 AI 規則。
- localStorage 自動保存版本化 Snapshot、近期事件與完整 Replay history；桌機頁首會以純文字標示新對局、已保存、已恢復或僅記憶體狀態，舊版 snapshot-only 存檔另明示 Replay history 不完整。
- 桌機遠征入口使用原生 HTML 呈現新對局或最近進度摘要；繼續不改動 authoritative state，覆蓋既有存檔前必須二次確認，storage unavailable 時則明示只保留在目前分頁。
- 遠征入口可明確選擇預設的原創 Demo，或內部限定的「基礎候選數值測試」模式；後者以 Content Pack 指紋保存／恢復，必須通過 engine `allowProvisionalPlaytest` 閘門，已接入首批十一種物資與十項卡牌效果，並持續警告其餘效果尚未啟用。
- Deterministic Playwright journey 會以原創示範內容走完真人討伐、招募、休息、AI 回合與 v3 local save reload；這是 runtime／測試穩定化能力，不是正式基礎卡表完成的宣告。
- e2e mode 的 typed、validated 原創示範 scenario registry 也會以正常 UI 操作觸發已註冊的全魔王／全羈絆終局，驗證 final round、AI 收尾、單次 scoreboard、排名／榮譽／討伐統計，以及「開啟新遠征」後 revision、事件與 replay history 歸零；它不修改 engine state，也不增加 production debug 捷徑。
- 規則核心 Vitest 回歸測試，涵蓋抽牌途中洗牌、展示不洗牌、隊伍滿員、過量派遣、道具休息棄置、供應牌庫耗盡與 Snapshot round-trip。
- 單頁 responsive game table shell 支援手機橫向、平板與桌面；Replay 診斷預設收合，所有指令仍只來自 LocalGameSession 提供的 legal Commands。
- 增量 Presentation asset pipeline 支援完整 demo 顯示資料搭配部分或零插畫覆蓋；只有 manifest 已核准的 `384×512`／`768×1024` WebP 會進入 runtime，缺圖安全回到 CSS placeholder。
- 卡牌 UI accessibility／usability baseline 包含 WCAG A/AA 自動稽核、skip link、全域 focus-visible、具體合法動作名稱、桌機鍵盤操作與 dispatch 後焦點交接、語意化結算排名、44px 操作目標、320px reflow、放大文字、reduced motion、forced colors 與重新開局二次確認。
- 桌機牌桌以五階段進度、由 legal Commands 純衍生的動作摘要、非純色卡片狀態圖例與單一最新 accepted event 回饋協助理解目前可做事項；討伐／購買詳情另顯示 engine 產生的 versioned action preview，UI 不自行重建規則或 optimistic state。

## 有意保留的限制

- 預設 runtime 仍是可玩的**原創示範內容包**；另有明確 opt-in 的 provisional foundation pack，接入 34 個中性名稱候選（含首批十一種道具／裝備），但不是完整、逐字對應的官方卡表，也不會自動升為 production 內容。候選物資 01／05 可依卡種從棄牌堆取回卡片，04 可棄魔王後抽牌，08「抽 2」、10「棄 1 後抽 2」、13「取回非同名法師卡」、15「從手牌／隊伍／棄牌堆移除 1 張」、17「抽 3 後棄 1」、18「配戴者仍在隊伍時，每個裝備實例於擊敗目標後抽 1」與 27「依隊伍職業種類抽牌」亦已透過資料驅動效果啟用；選牌效果使用可跨 Snapshot／Replay 恢復的版本化 card-use continuation，其餘卡面效果維持停用。
- 個別卡牌的複雜效果、協助者、羈絆輪抽與 Vol.1 尚未啟用。
- 基礎版供應採已核准的 project policy：冒險者／物資可縮減至空而不凍結遊戲；三張循環錨點使魔物區的 committed state 始終正好三張。逐種類張數不是 playtest blocker。
- 終局 E2E 只覆蓋目前 base Rules Module 已實際註冊、且可由原創示範 scenario 合法觸發的全魔王／全羈絆條件；完整正式基礎卡表與其他未確認終局資料仍待覆核。
- 沒有連線、帳號、伺服器、房間或遠端 Session；這些只保留了 protocol／adapter 邊界。
- AI 為可完整走完基本回合的簡單策略，尚未做難度、評估或長期規劃。

## 架構

```text
apps/web                 React/Vite 介面與 LocalGameSession adapter
packages/game-protocol   可序列化 state、command、event、snapshot 型別
packages/game-engine     純 TypeScript 規則引擎、查詢與計分
packages/content-base    可替換的原創 MVP Content Pack
packages/presentation-core  純呈現 schema、resolver 與 asset manifest contract
packages/presentation-demo  原創 demo 顯示資料與已核准素材 manifest
packages/game-ai         可替換 AI Strategy
docs/                    規則、架構、未決事項與 Roadmap
```

規則實作前請先閱讀 `docs/README.md`。未確認規則不得寫死為官方規則。
