# MVP 路線圖

本路線圖嚴格區分「架構能力已建立」與「產品功能已啟用」。MVP 先提供基礎版離線的一位真人玩家 + 一位 AI 對手，但底層資料格式、模組邊界與純規則核心必須符合 `12-完整目標架構與演進策略.md`。

## 1. 三層範圍

### 1.1 最終架構能力：M0 起即建立

- pnpm workspace 與 app/package 邊界
- 純、確定性 game engine
- Content Pack／Rules Module composition
- 卡片 replacement declarations
- 可擴充 Zone 與多目標 Enemy Encounter
- 動態隊伍上限 selector／modifier／overflow policy
- 可見或隱藏的玩家計數資源
- Rules Module 自有、可序列化 state
- 可註冊的結束條件與 Scoring Pipeline
- GameSession、CommandEnvelope、DomainEvent、PlayerView
- Versioned Snapshot、Replay、module migration
- local／AI／remote 共用的合法 Command 與 viewer projection

建立能力是指 contract、schema、最小通用實作與自動測試存在；不是提前完成所有擴充或伺服器功能。

### 1.2 MVP 實際啟用

- `content-base` 與基礎 Rules Module
- 一位真人玩家與一位 AI 對手的離線單機操作
- 基礎版五階段：行動一、討伐、行動二、購買、休息
- 基礎版隊伍上限值 5，但透過動態 selector 取得
- 基礎版魔王／魔物 encounters
- 基礎版結束條件、榮譽計分與平手判定
- LocalGameSession、本機 Snapshot 與 Replay 診斷能力
- PlayerView 與 hot-seat 私人資訊交接

### 1.3 後續啟用

- 基礎進階協助者與羈絆輪抽
- Vol.1 Content Pack／Rules Module、卡片替換與究極魔神
- AI actor
- RemoteGameSession 與權威伺服器
- 身分、房間、斷線重連、觀戰與營運功能

## 2. 能力啟用矩陣

| 能力 | MVP 底層 | MVP 啟用內容 | 後續啟用 |
| --- | --- | --- | --- |
| Content Pack | manifest、hash、registry | `content-base` | Vol.1 與更多 packs |
| Rules Module | state、events、zones、policies | 基礎 Rules Module | Vol.1／可選規則 modules |
| 卡片替換 | replacement resolver | 無啟用替換 | Vol.1 首刷替換卡 |
| 隊伍上限 | 動態 selector／overflow hook | 基礎值 5 | 卡片／Vol.1 動態修改 |
| 敵方目標 | Encounter + `EnemyTarget[]` | 魔王與三張魔物 | 多部位究極魔神 |
| 玩家 counters | amount + visibility policy | 通用能力，不建立假資料 | Vol.1 隱藏 HP 標記 |
| 結束條件 | registry + finish policy | 魔王全滅／五羈絆 | 究極魔神等條件 |
| 計分 | contribution pipeline + ranking policy | 基礎榮譽／tie-break | HP 排名與後續擴充 |
| Session | 共用 interface／contract tests | LocalGameSession + simple AI | RemoteGameSession 與進階 AI |
| 相容性 | Snapshot/Command/Event/Replay versions | 基礎存檔與重播 | module migration／連線同步 |

## 3. MVP 里程碑

### M0 — 完整架構工程基礎

- 建立 workspace：`apps/web`、`packages/game-engine`、`packages/game-protocol`、`packages/content-base`、`packages/test-kit`
- 建立 React + Vite + strict TypeScript web app
- 定義 ContentPack、RulesModule、GameSession、CommandEnvelope、PlayerView、Snapshot 與 Replay contracts
- 建立 Zone、EnemyEncounter、ScoreContribution 與 module state schema
- 建立 seedable RNG、LocalGameSession skeleton 與可替換 AI Strategy interface
- CI 執行 typecheck、lint、architecture、unit tests 與 build

驗收：所有 packages 可獨立檢查；engine 不 import web 或具體 pack；反向／循環依賴會使 CI 失敗；所有 state／protocol schemas 可序列化。

### M1 — 基礎 Rules Module 核心循環

- 建立 GameState、玩家區域、公共 zones、卡片 instances
- 五階段 state machine
- 個人牌庫「抽牌途中」重建與展示不洗牌
- 冒險者／物資 `SUPPLY_DECK_DEPLETED` 正式事件；魔物以循環 policy 維持公開列正好 3 張
- 動態隊伍上限 selector，以基礎值 5 啟用
- 一般魔王／魔物 encounters 與基礎討伐
- 購買力明細、購買、休息與回合切換
- revision、Command 去重、PlayerView 與簡單 AI 回合執行

驗收：固定 seed 與 Commands 可重播；UI 只看到 PlayerView；相同 Command ID 不重複執行；公共牌庫耗盡不由 UI 自行決定結果。

### M2 — 效果引擎垂直切片

- effect primitives、events、pending choice 與可序列化 continuation
- 裝備、道具、職業／位置修正
- 一張一般魔物、一張特殊魔王、一張羈絆的端到端案例
- 基礎版 FAQ／勘誤時序測試
- Rules Module end-condition／scoring registry 最小實作

驗收：代表性卡片不需要 UI 特例；討伐與效果 log 可讀；加入新 end condition 不需修改中央 switch。

### M3 — 完整基礎內容

- 逐張建立結構化基礎卡牌定義與數位 Content Pack 組成
- 內容 schema validation
- 個別例外 handler 與測試
- 核對官方說明書、卡表、勘誤與 FAQ

驗收：Content Pack 組成通過一致性驗證；未知的官方逐種類張數不標示為官方配比，也不阻擋數位 playtest；所有基礎 effect 類型有測試；未實作效果數為零；engine 不含基礎卡 ID。

### M4 — 可玩的單機人機 UI

- 對局設定、羈絆選擇、酒館與玩家公會
- 合法操作高亮、選擇視窗、討伐預覽
- AI 行動後的事件紀錄與人類玩家可見資訊
- 操作紀錄、規則提示與 placeholder 卡面
- 響應式平板／桌面版面

驗收：不開 debug panel 也能完整遊玩；AI 只透過合法 Commands 行動，UI 不持有完整 GameState。

### M5 — 終局、計分、Snapshot 與 Replay

- 完成當前輪次的終局流程
- 基礎榮譽與平手判定
- 自動存檔、讀檔、schema migration
- 保存 engine/ruleset/protocol、content manifests/hash、module versions、revision 與 RNG state
- Versioned deterministic Command Replay、錯誤 diagnostic 與 LocalGameSession JSON export 已完成；這是 runtime 能力，並不代表正式或 provisional 卡牌內容已載入。

物資／魔物逐種份數已降為非阻擋的來源 metadata 缺口；基礎供應耗盡已採用 2026-07-31 核准的專案 policy，不再是 `blocked-by-rule-exception`。M3 是否載入正式內容仍取決於各卡名稱、數值、效果與時序的內容稽核，不能把 provisional catalog 直接標為 production verified。

驗收：所有起始座位終局邊界有測試；重新整理可繼續；相同 registry/seed/Commands 重播結果一致；不相容內容明確拒絕。

### M6 — MVP 穩定化

- 基礎版官方規則／FAQ／勘誤回歸矩陣
- 已建立 deterministic Playwright full-game journey：真人合法討伐、招募、休息、AI 回合、v3 local save reload 與恢復後繼續合法操作；它只覆蓋原創示範內容與既有 runtime contracts。
- 已建立 e2e-mode 的 typed、validated 原創示範 scenario registry；它透過一般 `LocalGameSession`、合法 Commands 與 Rules Module 觸發「全魔王擊敗」及「全羈絆完成」兩種已註冊終局，覆蓋 final round、單次結算、scoreboard 與重新開局的空白 replay history。這是 runtime／測試能力，不表示正式基礎卡表或其全部終局觸發資料已完成。
- 無障礙鍵盤操作、色彩與文字替代
- 效能與手機橫向基本檢查
- 內容與素材授權清單

驗收：MVP 成功標準全部達成，沒有已知 P0/P1 缺陷；沒有為基礎版繞過最終架構 contracts。

## 4. 後續里程碑

### M7 — 基礎進階規則

- 協助者
- 羈絆輪抽
- 驗證 optional Rules Module composition

### M8 — 第一擴充 Vol.1

- `content-vol1` 與 Vol.1 Rules Module
- 轉職冒險者、追加物資／魔物／魔王
- 首刷替換卡
- 究極魔神出現、討伐、多部位、HP 隱藏資訊與排名計分
- 隊伍上限下降 overflow policy
- Vol.1 FAQ／勘誤與相容性 fixtures

### M9 — AI 強化

- AI 只使用 PlayerView、legal Commands 與 GameSession
- 不讀取對手隱藏資訊
- worker 執行、策略難度與更佳評估

### M10 — 線上權威遊戲

- `apps/server` room service
- RemoteGameSession
- HTTP Snapshot/resync + WebSocket Events
- actor authorization、expected revision、冪等 Command 與 viewer projection

### M11 — 線上產品化

- 訪客／帳號身分、邀請房間
- 斷線重連、持久化、觀戰
- 監控、部署與擴縮

線上驗收不是「兩個分頁可以互連」。伺服器必須重新驗證所有 Commands、拒絕過期 revision、對重送保持冪等，並且不把其他玩家的隱藏手牌、牌序或 HP 標記傳給 client。
