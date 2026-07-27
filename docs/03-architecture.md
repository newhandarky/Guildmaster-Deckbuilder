# 系統架構

本文件描述完整產品的目標架構，適用於基礎版、Vol.1、多部位究極魔神、後續擴充、AI 與線上對戰。MVP 只先啟用其中一部分 Content Pack／Rules Module 與 local runtime adapter，不建立另一套縮水架構。

## 技術選型

- Workspace：pnpm workspace
- 共用語言：TypeScript（strict mode）
- Web client：React + Vite
- UI state：React local state；跨畫面 application state 使用 Zustand
- 規則／通訊資料驗證：Zod
- 樣式：Tailwind CSS 與專案 design tokens
- 單元／整合測試：Vitest + React Testing Library
- 瀏覽器流程測試：Playwright
- MVP 儲存：localStorage，保留切換 IndexedDB 的 adapter
- 線上 transport：目標採 HTTP snapshot/recovery + WebSocket 即時事件；M10 才選 server framework 與資料庫

套件版本在建立工程時鎖入 lockfile。server framework、資料庫與部署平台在真正實作線上階段再以 ADR 選擇，避免現在猜測基礎設施；domain contract 不等待這些決定。

## Runtime 邊界

```text
                         ┌─────────────────────┐
                         │ packages/content-*  │
                         └──────────┬──────────┘
                                    ▼
┌──────────────┐ commands  ┌─────────────────────┐  snapshots/events
│ apps/web UI  │──────────▶│ GameSession contract│──────────────────┐
└──────────────┘◀──────────│ game-protocol DTOs  │◀─────────────────┘
                  views     └─────────┬───────────┘
                          local       │ remote
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
          LocalGameSession                    RemoteGameSession
                    │                                   │ HTTP/WS
                    ▼                                   ▼
        packages/game-engine            apps/server authoritative room
                                                        │
                                                        ▼
                                             packages/game-engine
```

`GameSession` 是 web feature 唯一可見的對局入口。local 與 remote adapter 必須回傳相同的 command result、player view、event 與 error DTO，因此線上化不需要重寫 UI。

UI 另經由 `PresentationResolver` 將 `CardDefinition.id` 解析為純顯示 view model；resolver 不參與 Command、Event、規則計算或 session authority。

## Repository 結構

```text
Guildmaster-Deckbuilder/
├── apps/
│   ├── web/                              # M0 起實作
│   │   └── src/
│   │       ├── app/                      # 啟動、routing、providers
│   │       ├── adapters/
│   │       │   ├── local-session/        # MVP：browser engine + storage
│   │       │   └── remote-session/       # M10：HTTP/WebSocket
│   │       ├── features/game/
│   │       │   ├── shell/
│   │       │   ├── setup/
│   │       │   ├── board/
│   │       │   ├── party/
│   │       │   ├── combat/
│   │       │   ├── market/
│   │       │   ├── scoring/
│   │       │   └── save-load/
│   │       ├── store/                    # 薄 application adapter
│   │       └── ui/components/            # 無規則知識的共用元件
│   └── server/                           # M10 才實作 runtime
│       └── src/
│           ├── rooms/                    # 權威 room lifecycle
│           ├── transport/                # HTTP/WS adapters
│           ├── persistence/              # repository adapters
│           └── identity/                 # guest/account boundary
├── packages/
│   ├── game-engine/                      # M0：確定性純規則
│   │   └── src/
│   │       ├── model/
│   │       ├── engine/commands/
│   │       ├── engine/phases/
│   │       ├── effects/primitives/
│   │       ├── effects/registry/
│   │       ├── rules-modules/            # module composition contracts
│   │       ├── zones/                    # base 與擴充區域抽象
│   │       ├── encounters/               # 多目標／多部位敵方模型
│   │       ├── scoring/                  # contributions、ranking、tie policies
│   │       ├── queries/
│   │       ├── projection/               # GameState → PlayerView
│   │       ├── snapshot-replay/          # serialization、migration、replay
│   │       └── ports/                    # RNG 等能力介面
│   ├── game-protocol/                    # commands/views/events/snapshot/replay schemas
│   ├── content-base/                     # M0–M3：基礎 ContentPack
│   ├── content-<pack-id>/                # M7+：每個擴充獨立 package
│   ├── presentation-<theme-id>/          # 未來：可替換名稱、文案、asset key
│   ├── game-ai/                          # M8：AI actor
│   └── test-kit/                         # builders、fixtures、contract suites
├── docs/
│   └── adr/
├── public-assets/                        # 原創素材工作流，build 時由 web 引用
├── tests/e2e/
├── pnpm-workspace.yaml
└── package.json
```

現在先建立所有邊界的目錄；只有 M0 所需 packages 建立可執行程式。空的 server/AI 目錄是責任標記，不代表現在要實作網路或 AI。

## Package 責任與依賴

```text
apps/web ─────────────▶ game-protocol
   │                         ▲
   ├──────────────▶ content-base
   │                         │
   └─ local adapter ─▶ game-engine ◀── content-* extensions

apps/server ──────────▶ game-protocol
   ├──────────────────▶ game-engine
   └──────────────────▶ approved content-*

game-ai ──────────────▶ game-protocol + game-engine public queries
game-engine ──────────▶ game-protocol types only
content-* ────────────▶ game-engine extension API + game-protocol schemas
```

- package 間只能使用 package exports，不得 import 另一 package 的 `src/*`。
- `game-engine` 不 import React、browser/server API 或具體 content pack。
- `apps/web` 與 `apps/server` 不互相 import。
- 共享程式不得放進 app 再由另一 app deep import；應提升至責任明確的 package。
- 禁止循環依賴。內部模組與檔案規範見 `11-modularity-guidelines.md`。

## 核心 contracts

### Engine

- `composeRuleset(contentPacks, moduleConfigs): RulesetRegistry`
- `createGame(config, registry, seed): GameState`
- `dispatch(state, commandEnvelope, context): EngineResult`
- `getLegalCommands(state, actorId): LegalCommand[]`
- `projectView(state, viewer): PlayerView`
- `serializeSnapshot(state): VersionedSnapshot`
- `restoreSnapshot(snapshot, registry): GameState`
- `replay(initialConfig, commandEnvelopes, registry): ReplayResult`

所有入口皆為確定性純邏輯。合法性由 engine 判斷，不信任 UI 或 client。

### GameSession

- `LocalGameSession`：MVP 在 browser 內持有 authoritative state，呼叫 engine，經 storage port 存檔。
- `RemoteGameSession`：只持有 player view，command 送往伺服器，由 server room 執行 engine。
- feature UI 只依賴 session facade，不以 `if (online)` 分叉規則流程。

### ContentPack

- 基礎遊戲與擴充使用相同 manifest、definitions、replacements、Rules Modules 與 effect extension contract。
- engine 只接收驗證完成的 `ContentRegistry`，不 hard-code pack ID。
- server 只允許預先安裝且 hash 相符的 packs，client 不能上傳任意 handler。

### PresentationPack

- Presentation Pack 只依 stable definition ID 產出 display name、asset key、短文案與 theme／locale variant；不能包含 effect、數值、Command handler 或 Rules Module。
- React component 只能消費 resolver 輸出的 presentation view model；不得寫死人物名稱、圖片路徑或以顯示文字判斷卡種。
- 線上權威狀態不傳遞圖片；不同 client 可選不同 Presentation Pack。缺少 pack 時 client 使用中性 placeholder，不影響連線相容性。

### RulesModule

Rules Module 可提供設置變更、擴充專屬 zones、module state schema、供應牌庫耗盡處理、動態隊伍上限、敵方 encounters、結束條件、計分與 visibility policies。所有 module state 必須可序列化；handler 以版本化 ID 註冊，不存進 Snapshot。

基礎版本身也是 Rules Module。Vol.1 疊加／替代基礎設置，將魔王數量改為玩家人數、註冊究極魔神 encounter、HP 隱藏資源與排名計分。engine 不包含 `if (vol1)`。

### Zone 與 Encounter

- 公共與玩家區域由 `ZoneId` + schema 表示，允許擴充新增區域。
- 供應牌庫成為空牌庫時產生正式 `SUPPLY_DECK_DEPLETED` Event；由 Rules Module 決定後續，不由 UI fallback。
- 敵方戰場是 `EnemyEncounterState` + 多個 `EnemyTargetState`，不是單一 `activeBossId`。
- 多部位究極魔神的每個部位可各自保存 HP、能力與擊敗狀態，整體完成條件由 module 聚合。

### Protocol

protocol schemas 包含 command envelope、player views、依 viewer 投影的 events、typed errors、content/rules manifests、Snapshot 與 Replay metadata。它不包含 React types、WebSocket client 或 database entity。

## 線上權威與隱藏資訊

- 線上房間的 `GameState` 只存在伺服器；client 不取得其他玩家手牌或牌序。
- 每個 command 包含唯一 `commandId` 與 `expectedRevision`；伺服器負責 actor 驗證、去重與 revision check。
- 成功後伺服器遞增 revision，依 viewer 產生裁切 view／events。
- 斷線重連先取得最新 snapshot/view，再接續更高 sequence 的 events。
- 網路重送不得造成重複購買、重複抽牌或重複結算。
- client animation 不決定規則結果；它只消費 server events。
- 隱藏 HP 等計數資源在伺服器投影時即移除／遮蔽，不把真實值傳給未授權 viewer。

MVP 雖無網路，local session 仍使用同一 command ID、revision 與 projection，提早測出線上化最昂貴的邊界。

## 擴充策略

- 新增擴充以新 `content-<pack-id>` package 為主，不修改 engine 中央 switch。
- 卡片替換在 registry composition 時依 stable ID／version 解析，不在遊戲中以同名搜尋。
- 通用新機制先加 declarative primitive；只有特殊例外使用 namespaced extension handler。
- setup、牌庫組合、擴充 zones、module state、可選規則與 content conflicts 由 pack manifest／Rules Modules 描述。
- 隊伍上限、結束條件與 scoring pipeline 都是可組合 policies，不寫死 5 人、兩個結束條件或單一計分公式。
- 對局開始後鎖定 ruleset、packs、versions 與 hashes。
- replay／save 若缺少相同內容版本，不允許靜默以新版載入；必須 migration 或明確標示不相容。

## AI 策略

- AI 是另一種 actor，透過 legal commands 送出相同 command envelope。
- AI 只讀對應玩家的 `PlayerView`，不得讀完整 GameState 作弊。
- 評估與搜尋可在 Web Worker 或 server worker 執行，不進 React render path。
- AI 難度與策略是 `game-ai` package 的責任，不在 rules engine 放啟發式判斷。

## 儲存與重播

存檔／server snapshot 至少包含：

- schema 與 ruleset version
- content pack manifests、versions 與 hashes
- seed 與可序列化 RNG state
- authoritative GameState（僅安全儲存端）
- revision 與必要 command/event 診斷紀錄
- 各 Rules Module 的版本化可序列化 state
- 所有 zones、encounters、targets、玩家計數資源與 visibility policy state

localStorage、IndexedDB 與 server database 都是 repository adapters。engine 不知道資料存在哪裡。

## 防止過度設計

完整架構不代表現在實作所有功能：

| 現在必須完成 | 延後到需要時 |
| --- | --- |
| workspace package boundaries | WebSocket server 與 room scaling |
| pure deterministic engine | database／cache 選型 |
| content pack contract | 實際擴充卡牌資料 |
| Rules Module、Zone、Encounter、Scoring contracts | Vol.1 規則的實際啟用 |
| player projection | 登入、邀請、觀戰產品流程 |
| command ID/revision | 跨節點鎖與分散式部署 |
| local GameSession adapter | remote adapter implementation |
| versioned save metadata | 長期 replay 儲存策略 |

原則是「現在建立穩定接縫，未來再補 adapter」，不是「現在模擬尚未存在的後端」。

## 架構驗證

M0 的 `check:architecture` 必須驗證 workspace dependency graph、禁止 deep import、循環依賴、檔案大小與複雜度。contract tests 必須涵蓋 Rules Module composition、Snapshot／Replay compatibility，並讓 local session 與日後 remote session 共用同一套行為規格。
