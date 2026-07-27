# ADR 0004：Workspace 與線上權威架構

- 狀態：Accepted
- 日期：2026-07-26
- Supersedes：ADR 0003 中「暫不採 multi-package workspace」的部分；ADR 0003 的內部模組規則仍有效

## 背景

產品完整目標已確認包含擴充內容、AI 與線上對戰。若 MVP 先將 web UI、規則、基礎卡與本機儲存放在單一 `src`，日後要將 engine 移到 server、裁切玩家隱藏資訊或拆出擴充時，會產生高風險搬移與重寫。

## 決策

從 M0 採用 pnpm workspace：

- `apps/web`：React/Vite client
- `apps/server`：未來權威線上 runtime
- `packages/game-engine`：確定性規則引擎
- `packages/game-protocol`：command/view/event/error schemas
- `packages/content-base` 與個別 expansion packages
- `packages/game-ai`：未來 AI actor
- `packages/test-kit`：跨 package fixtures 與 contract tests

Web UI 只依賴 `GameSession` 與 `PlayerView`。MVP 實作 local adapter；線上版實作 remote adapter。伺服器持有唯一權威 GameState，驗證所有 commands，依 viewer 投影資訊。

## 現在實作的邊界

- workspace 與 package dependency rules
- pure engine
- ContentPack contract
- RulesModule、Zone、EnemyEncounter 與 Scoring contracts
- replacement resolver、動態隊伍上限與可見性 policy
- GameSession contract 與 local adapter
- CommandEnvelope、DomainEvent、revision 與 PlayerView
- versioned Snapshot／Replay metadata 與 migration contract

## 延後的實作

- WebSocket／HTTP server
- database、cache 與部署平台
- identity、matchmaking、invites、spectating
- AI strategy
- 實際啟用擴充內容與擴充 UI

延後的是 adapters 與產品功能，不是核心 boundaries。

## 影響

- M0 會比單一 Vite `src` 多出 workspace 設定與 package build/test 配置。
- engine、protocol 與 content 的編譯邊界可由 CI 強制，降低日後抽離成本。
- server、AI 與擴充能重用正式 API，不需要 import web internals。
- local 與 online 可用同一套 session contract tests。

## 安全決策

- client 永遠不被視為規則權威。
- server 不執行 client 上傳的 custom effect code，只載入部署時核准的 content packs。
- 每個 viewer 只收到投影後資料。
- command ID、revision 與 content hash 是 protocol 的第一版欄位，不等網路功能開始才補。
