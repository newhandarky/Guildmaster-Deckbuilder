# 領域模型

本模型以完整遊戲為目標：基礎版、第一擴充、後續 Content Pack、AI 與線上對戰共用同一套純規則核心。MVP 只啟用基礎 Rules Module，不使用另一套簡化 state。

## 1. 設計目標

- 規則狀態與 React／網路／儲存完全分離。
- 所有隨機結果可用 seed 與 RNG state 重現。
- 每張卡牌實例有唯一 instance ID；同名卡仍可分別追蹤。
- 卡片定義唯讀；所在區域、配戴關係、血量與暫時效果屬於對局狀態。
- 所有合法變更都經由 Command，輸出新 state、Events 與 Pending Choice。
- 完整 `GameState` 是權威狀態；UI 與 AI 只取得依 viewer 裁切的 `PlayerView`。
- 基礎版與擴充都以 `ContentPack` + `RulesModule` 組合；engine 不 hard-code pack 名稱。
- Snapshot、Command、Event 與 Replay 都帶版本與內容 manifest。

## 2. `GameState`

| 欄位 | 用途 |
| --- | --- |
| `schemaVersion` | Snapshot schema migration 版本 |
| `engineVersion` / `rulesetVersion` | 引擎與規則相容版本 |
| `contentPacks` | pack ID、版本與內容 hash |
| `rulesModules` | 啟用的 module ID、版本與設定 |
| `gameId` / `seed` / `rngState` | 對局識別與可重現亂數 |
| `revision` | 每個成功 Command 後遞增 |
| `status` | setup、playing、finalRound、finished 等 lifecycle |
| `players` | 依座位順序排列的玩家狀態 |
| `activePlayerId` / `startingPlayerId` | 目前行動者與輪次邊界 |
| `round` / `turn` / `phase` | 回合狀態；中文顯示「討伐階段」，enum 可保留 `combat` |
| `sharedZones` | 酒館與 Rules Module 建立的公共區域 |
| `enemyEncounters` | 同時存在的魔王、魔物、究極魔神與部位 |
| `removedCards` | 本局移除區 |
| `moduleState` | 各 Rules Module 自己的可序列化狀態 |
| `pendingChoice` / `effectQueue` | 尚待玩家或效果引擎完成的工作 |
| `endState` | 已觸發的結束條件、觸發 revision 與輪次邊界 |
| `eventLogCursor` | Replay／同步用事件位置；不把函式存入 state |

`GameState` 不應新增 `vol1Something` 之類的頂層欄位。擴充專屬狀態放在 namespaced `moduleState[moduleId]`，由對應 schema 驗證。

## 3. `PlayerState`

| 欄位 | 用途 |
| --- | --- |
| `id` / `seat` / `displayName` | 玩家識別 |
| `drawPile` / `hand` / `discardPile` | 個人牌庫、手牌、棄牌堆 |
| `party` | 有順序的 `PartySlot[]`；不寫死長度 5 |
| `playArea` | 已使用、等待休息棄置的道具等卡片 |
| `bonds` | 羈絆與完成狀態 |
| `turnResources` | 購買力來源、費用修正、已花費等暫時資源 |
| `counters` | HP 標記等可見／隱藏計數資源 |
| `moduleState` | 玩家層級、由 Rules Module 擁有的可序列化 state |
| `historyStats` | 擊敗魔王／魔物等不適合只靠目前區域回推的紀錄 |

### 3.1 `PartySlot`

- `adventurerInstanceId`
- `equipmentInstanceId?`
- 不另存位置；以陣列 index + 1 計算。
- 隊伍人數上限由 `getPartyLimit(state, playerId)` selector 根據 base 值、卡片效果與 Rules Module modifiers 計算。
- 基礎版 base 值為 5；這不是 engine constant。
- 上限下降時的超額處理由 Rules Module policy 決定。Vol.1 官方規則為從最右側開始，將冒險者與配戴裝備置入棄牌堆，直到符合上限。

### 3.2 `PlayerCounterState`

至少包含：

- `resourceId`：namespaced，例如 `vol1:ultimate-demon-hp`
- `amount`
- `visibility`：public、ownerOnly、allPlayersByConsent 等 policy ID
- `sourceRefs`：可選的究極魔神／部位／事件來源

權威 state 保存真實數值；`PlayerView` 依 visibility policy 顯示數值、只顯示存在與否，或完全隱藏。

## 4. 區域模型

### 4.1 `ZoneState`

不要為每個擴充直接新增固定欄位。所有區域以穩定 `ZoneId` 與 discriminated union 建模：

- `orderedDeck`：有順序的牌庫
- `faceUpRow`：招募區、商店、魔物區
- `singleSlot`：只允許一張的公開位置
- `attachmentArea`：配戴／附屬關係
- `moduleArea`：經 Rules Module schema 定義的擴充專屬區域

基礎版酒館由冒險者牌庫／招募區、物資牌庫／商店、魔物牌庫／魔物區、魔王牌庫等 zones 組成。第一擴充可加入究極魔神戰場、HP 備用區等專屬 zone，而不修改 engine 頂層型別。

### 4.2 公共供應牌庫

- 供應牌庫的抽取、展示與耗盡行為與玩家個人牌庫分開建模。
- 牌庫因抽取變空時產生 `SUPPLY_DECK_DEPLETED`，包含 `zoneId`、card category、cause 與 timing。
- 哪些事件會造成結束、登場或沒有額外結果，由啟用的 Rules Module 決定；UI 不自行補救。

## 5. 敵方目標與 Encounter

不得只用單一 `activeBossId` 表示所有敵方目標。

### 5.1 `EnemyEncounterState`

- `encounterId`
- `kind`：魔王列、魔物列、究極魔神等
- `targetIds: EnemyTargetId[]`
- `status`
- `rulesModuleId?`
- `state`：由對應 schema 驗證的可序列化 encounter state

### 5.2 `EnemyTargetState`

- `targetId`
- `cardInstanceId`
- `parentEncounterId?`
- `partKey?`：究極魔神部位等穩定 key
- `status`：available、engaged、defeated、removed 等
- `health?`：current/max 或 token pool reference
- `attachments`
- `modifiers` / `activeAbilityIds`
- `moduleState`

一般魔王可以是一個 encounter 中的一個 target；公開魔物列可以同時有三個 targets；多部位究極魔神可以是一個 encounter 中同時存在四個獨立 targets。整體擊敗條件由 Rules Module 判定，不由 `targetIds.length === 0` 猜測。

## 6. 卡牌定義、替換與實例

### 6.1 `CardDefinition`

- `id`：namespaced 穩定 ID，例如 `base:adventurer/example`
- `packId` / `definitionVersion`
- `type`：adventurer、material、boss、monster、bond、helper、starter、ultimateDemonPart 等可擴充 enum
- `nameKey` / `rulesTextKey`
- `copies`
- `honor`、`cost`、`purchasePower?`、`tags`
- `effects`
- `artAssetKey?`

玩家顯示使用「物資、魔物、協助者、討伐階段」等官方中文；內部 enum 可保留英文。

### 6.2 卡片替換

`ContentPack` 可提供 replacement declarations：

- `replacementDefinitionId`
- `replacesDefinitionId`
- 適用 pack/version 範圍
- replacement priority 或衝突錯誤

建立 `ContentRegistry` 時先解析替換，再建立實例。被替換定義不與新版同時進入同一內容集合；Snapshot／Replay 保存實際 registry hash。

### 6.3 `CardInstance`

- `instanceId`
- `definitionId`
- `ownerId?`
- `state`：卡牌自身可序列化 state

配戴與附屬關係由 zone／target／party state 關聯，不寫回唯讀 definition。

## 7. Content Pack 與 Rules Module

### 7.1 `ContentPack`

每個基礎／擴充包提供：

- `manifest`：pack ID、semantic version、相容 ruleset、相依／衝突 pack
- `definitions`
- `replacements`
- `localization` 與 asset manifest references
- `rulesModules`
- `effectExtensions`

組合時驗證 ID 唯一、版本相容、dependencies、conflicts、replacement graph 與內容 hash，再建立唯讀 `ContentRegistry`。

### 7.2 `RulesModule`

Rules Module 以具名 extension points 組合，不用散落的 `if (vol1Enabled)`：

- `moduleId` / `version`
- `stateSchema` / `createInitialState`
- `setupContributions`
- `zoneDefinitions`
- `commandHandlers` / `eventHandlers`
- `effectExtensions`
- `partyLimitModifiers` / overflow policy
- `endConditions`
- `scoringRules` / ranking rules
- `visibilityPolicies`
- `snapshotMigrations`

module state 必須是 JSON 可序列化資料；實作函式透過版本化 registry ID 查找，不得存進 Snapshot。

## 8. Command、Event 與 Choice

### 8.1 `CommandEnvelope`

- `protocolVersion`
- `gameId`
- `commandId`：唯一 ID，用於重送去重
- `actorId`
- `expectedRevision`
- `type` / `payload`

伺服器與 LocalGameSession 都重新驗證 actor、revision、phase、目標、費用與 Rules Module 限制。

玩家意圖可包含 `PLAY_ADVENTURER`、`EQUIP_ITEM`、`USE_ITEM`、`ATTACK_TARGET`、`ASSAULT_ENCOUNTER`、`BUY_CARD`、`REFRESH_MARKET`、`END_PHASE`、`RESOLVE_CHOICE` 等。英文名稱是內部 protocol，玩家畫面顯示官方中文。

### 8.2 `DomainEvent`

事件是已發生的事，至少包含：

- `eventId` / `gameId` / `revision` / `sequence`
- `type` / versioned payload
- `causedByCommandId?`
- `rulesModuleId?`
- viewer visibility metadata

核心事件包含卡片移動、抽牌、供應牌庫耗盡、目標擊敗、隊伍上限變動、結束條件觸發與計分；Rules Module 可以註冊 namespaced 事件。

### 8.3 `PendingChoice`

同一時間可有一個阻塞型 choice；它需保存來源、合法選項／selector、選取範圍、可否取消、viewer visibility 與可序列化 continuation ID。不得把 JavaScript closure 存入 state。

## 9. 可擴充的結束與計分

### 9.1 結束條件

`EndConditionRegistry` 收集所有啟用 Rules Modules 的條件。每個結果包含：

- `conditionId`
- `triggeredByEventId`
- `finishPolicyId`：例如完成當前輪次
- `priority` / simultaneous-resolution policy

基礎版註冊「所有本局魔王被擊敗」與「任一玩家完成五張羈絆」；Vol.1 註冊「究極魔神被擊敗」。engine 不用中央 boolean switch 寫死所有未來條件。

### 9.2 計分

`ScoringPipeline` 依序合併：

- 基礎公會內卡牌與已完成羈絆榮譽值
- Rules Module 額外分數
- 排名獎勵，例如 Vol.1 HP 第一／二／三名
- 平手與無資格 policy
- 最終勝負 tie-breakers

每一筆 `ScoreContribution` 保留 rule ID、來源、原始值與結果，方便 UI 解釋、Replay 與規則稽核。

## 10. 權威狀態與玩家投影

完整 `GameState` 只存在於 LocalGameSession、測試 host 或線上伺服器。`projectView(state, viewer)` 依 zone、card、event、counter 與 Rules Module visibility policy 產生 `PlayerView`。

hot-seat 也必須走投影流程。Vol.1 HP 標記預設只對 owner 顯示；若全體同意公開，透過正式 Command 更新 visibility policy，而不是 UI local toggle。

## 11. Snapshot、Replay 與相容性

### 11.1 `VersionedSnapshot`

保存：

- schema、engine、ruleset、protocol versions
- content pack／Rules Module manifests 與 hashes
- 完整可序列化 GameState
- RNG state、revision、最後 event sequence

### 11.2 Replay

Replay 由初始設定、精確 registry manifest、seed 與有序 Command envelopes 重建；Events 可作快取與稽核，但不可取代相容版本資訊。

### 11.3 相容性

- Snapshot migration 與 module-state migration 為具名、具版本、可測試的純函式。
- content hash 不符時不得靜默改用新卡片。
- 缺少 pack、Rules Module 或 handler 時明確回傳 incompatible error。
- Command／Event payload breaking change 必須升版本並保留 fixture。

## 12. 不變條件

1. 任一卡片 instance 同一時間只能位於一個主要 zone；配戴／附屬以明確關係表示。
2. 玩家取得的卡片 owner 不因洗牌、進隊或棄置而改變。
3. 移除遊戲的卡片不能再被抽取、購買或計分。
4. 隊伍長度不得超過當下 selector 計算出的上限；上限不是固定 5。
5. 每格最多一件裝備，除非 Rules Module／卡片明確替代此規則。
6. 每個 enemy target 只能屬於一個 encounter；部位與整體狀態不得互相矛盾。
7. `pendingChoice` 存在時，只接受對應 choice command 或規則允許的取消。
8. Snapshot 不含函式、DOM、React state、連線物件或不可序列化 RNG。
9. 所有啟用 packs/modules/handlers 存在且 hash 相符。
10. 非冪等重送的 Command，其 `expectedRevision` 必須等於權威 revision。

## 13. 衍生資料

以 selectors 計算，不重複保存：

- 當前隊伍人數上限、戰力與一般討伐的最小派遣前綴
- 各敵方 target／encounter 可否討伐
- 購買力明細、可購買卡與剩餘金錢
- 可執行 Commands
- viewer 可見資訊
- 基礎榮譽、Rules Module 分數與排名明細
- 結束條件是否滿足

衍生資料不落盤，避免卡片或 Rules Module 更新後留下過期快取。
