# 模組化與檔案拆分規範

本文件的目標不是追求大量小檔案，而是避免一個檔案同時承擔多種改動理由。任何開發者應能在不閱讀整個專案的情況下，找到一項功能的入口、公開介面、實作與測試。

## 1. 模組設計原則

### 高內聚、低耦合

- 同一模組中的程式應服務同一個玩家流程或領域責任。
- 模組間只交換 typed command、result、view model 或穩定 value object。
- 不共享可變全域狀態；`GameState` 只透過 rules engine 更新。
- 不因兩段程式「目前看起來相似」就過早共用；先確認它們會因相同原因一起改變。

### 以改動理由切分

良好拆分例子：

- 討伐 command validation、戰力 query、討伐 UI 各自在不同層；程式 enum 可保留 `combat`。
- `drawCards` 與 `revealTopCards` 是不同效果原語，因為洗牌邊界不同。
- save serialization、browser storage adapter、save/load UI 分開。

不良拆分例子：

- `gameEngine.ts` 同時處理開局、五個 phase、所有卡牌效果與計分。
- `Game.tsx` 同時讀 store、計算規則、渲染整張桌面並控制所有 modal。
- `utils.ts` 放進洗牌、計分、字串格式化與 localStorage。
- `types.ts` 累積所有領域、UI、API 與素材型別。

## 2. Feature 模組模板

每個玩家流程 feature 以自己的資料夾為邊界，例如：

```text
apps/web/src/features/game/combat/
├── components/
│   ├── CombatPanel.tsx
│   └── TargetPicker.tsx
├── hooks/
│   └── useCombatActions.ts
├── mappers/
│   └── toCombatViewModel.ts
├── CombatPanel.test.tsx
└── index.ts
```

只有實際需要時才建立子資料夾。`index.ts` 是公開介面；其他 feature 不應 import `components/TargetPicker.tsx` 等內部路徑。

feature 可使用 shared UI、web store 與 protocol view models，但不能直接 import rules engine 的 command handler、完整 `GameState` 或 effect implementation。

## 3. Domain 模組模板

### Commands

每類 command handler 分檔，例如 `playAdventurer.ts`、`attackTarget.ts`、`buyCard.ts`。共用驗證提煉成具名 policy，不放入通用 `helpers.ts`。

### Phases

每個 phase 負責自己的合法 transitions 與結束處理；共用 turn orchestration 只協調，不包含所有 phase 細節。

### Rules Modules

- module composition、setup hooks、end conditions、scoring、visibility 與 overflow policies 分屬明確模組；中央 registry 只排序、驗證與呼叫。
- 每個 module 的 state schema、migration、zones 與 event handlers 放在該 module 邊界內，並可單獨做 Snapshot／Replay contract test。
- 基礎版也走同一 extension contract，禁止 `if (vol1)` 或將未來擴充欄位塞進 UI store。

### Encounters 與 counters

- encounter orchestration、單一 target 狀態與多 target 聚合條件分開，不以單一魔王 component 承擔所有敵方模型。
- 隊伍上限使用 query + modifiers；超額處理是 Rules Module policy，不在陣列操作 helper 寫死 5。
- 權威 counter、visibility policy 與 PlayerView projection 分開，避免隱藏 HP 因共用 DTO 外洩。

### Effects

- primitives 依概念分檔，如 card movement、draw/reveal、resources、modifiers、choices。
- custom handler 依卡片或同一機制 family 分檔。
- handler registry 只建立 ID 到 handler 的 mapping，不包含 handler body。

### Content

卡牌資料依 `set/card-type` 切分。單一內容檔建議不超過約 20–30 個 definitions；index 只合併、驗證與 export。大量重複資料應由明確 factory 產生，但不犧牲可讀性。

### Model

按概念拆成 `gameState`、`card`、`player`、`command`、`event`、`choice` 等檔案。不要建立一個永久成長的 `types.ts`。

## 4. 檔案與複雜度警戒線

行數不是品質本身，但適合當作需要重新檢查責任的早期訊號。計算時忽略空白與純註解：

| 對象 | Warning | 必須處理 |
| --- | ---: | ---: |
| 一般 TypeScript／TSX 檔案 | 300 行 | 500 行 |
| React component 實作 | 200 行 | 350 行 |
| 單一函式／hook | 60 行 | 100 行 |
| Cyclomatic complexity | 10 | 15 |

超過 warning 時，PR reviewer 必須確認是否混合責任。超過「必須處理」門檻時，合併前需拆分或依例外流程記錄理由。

可排除自動生成檔、純卡牌 definitions、schema migration snapshot 與大型測試 fixture，但仍需依內容類型合理分檔。測試檔不自動豁免 God File：若難以定位失敗場景，也應拆分。

## 5. 何時應該拆檔

出現任一訊號就應拆分，不必等到行數門檻：

- 檔案有兩個以上互不相關的改動理由。
- 名稱只能叫 `manager`、`service`、`utils`、`helpers` 或 `misc` 才能涵蓋內容。
- 同一檔案同時處理 domain calculation、state mutation 與 rendering。
- 測試需要大量不相關 setup，或修改一項規則造成多個無關測試更新。
- 多人經常修改同一檔案而產生衝突。
- 需要用區段註解把一個檔案切成多個「小檔案」。
- import 數量持續增加，且來自多個不同層。

## 6. 如何拆而不造成碎片化

1. 先寫出目前檔案的所有責任。
2. 依改動理由分群，而不是每個函式一個檔案。
3. 定義最小 public contract。
4. 把純計算優先抽出，保留 orchestration 在原入口。
5. 移動對應測試並確保行為不變。
6. 禁止新模組反向 import 舊 implementation，避免產生 cycle。
7. 更新 module `index.ts`，讓外部 import 路徑不受內部重構影響。

## 7. Import 規則

- package 間使用 workspace package exports，例如 `@guildmaster/game-engine`、`@guildmaster/game-protocol`、`@guildmaster/content-base`。
- web app 內使用路徑 alias，例如 `@/ui`、`@/features/game/combat`。
- 跨 module 只能從其 `index.ts` import。
- 同一 module 內可以使用相對路徑；不得用多層 `../../../` 穿越 module 邊界。
- 禁止從 feature import 另一 feature 的內部 store、hook 或 component。
- 禁止 `packages/game-engine` import React、web features、store、browser adapter、server transport 或具體 content pack。
- 禁止 content pack import web/server；它只能依賴 engine 公開 extension contract 與 protocol 共用 schema。
- `apps/web` 不得 deep import package 的 `src/*`；只使用 package exports。
- `apps/server` 與 `apps/web` 不得彼此 import；共享內容必須位於 packages。
- 禁止 circular dependencies；types-only cycle 也應重構到共同 leaf module。
- 不建立全專案 mega barrel，以免隱藏依賴與拖慢 tree-shaking。

## 8. 自動化執行

M0 應建立 `check:architecture` 並在 CI 執行：

1. ESLint import restrictions 驗證 layer 與 public API。
2. dependency graph 檢查 circular dependency。
3. ESLint 檔案行數、函式行數與 complexity 規則。
4. 小型自訂 script 檢查 `index.ts` 僅 export，以及禁止 catch-all 檔名。

初期 warning 門檻可以只提示；在 M1 完成前應將「必須處理」門檻與循環依賴升為 CI error，避免技術債在內容大量輸入後才處理。

## 9. 例外流程

若檔案合理超過硬門檻：

- 在同一 PR 說明為何拆分會降低可讀性或破壞資料完整性。
- 在 architecture check allowlist 寫精確檔案路徑與原因，不使用整個目錄 wildcard。
- 指定 owner 與重新檢查條件；暫時例外需有 issue 或期限。
- 生成檔需在檔頭標明來源與禁止手改。

例外不是永久跳過規範的方式。

## 10. Review 快速檢查

- 新責任是否有明確 owner module？
- 是否只能透過 public API 使用？
- 是否把 domain logic 放進 React/store？
- 是否新增 catch-all 或大型 registry 實作？
- 是否能獨立測試而不啟動整個 app？
- 是否接近檔案／函式警戒線？
- 未來加入新卡片或新 phase 時，是新增模組，還是修改一個中央大 switch？
- 未來加入多部位敵人、不同終局或新排名資源時，是否只需新增 module／policy，而非改寫 GameState？

最後一題若答案總是「修改中央大檔案」，代表 extension point 尚未設計完成。
