# 基礎版 Provisional 效果能力矩陣

本文件是目前已盤點的 provisional 基礎版候選效果，對照現有純 TypeScript Rules Engine 的可稽核 gap analysis。機器可讀資料在 `packages/content-base/src/capabilities/base-provisional-effect-capability-matrix.ts`；它只引用中性 mechanics ID，不含玩家顯示名稱、官方圖片或 UI 素材。

這不是 production Content Pack，也不會讓任何 provisional 候選卡變成 runtimeLoadable。物資／魔物逐種類張數與基礎供應耗盡已由 2026-07-31 專案決策解除資料／規則阻擋，見 [例外清單](./26-基礎版Provisional例外清單.md)。機器可讀矩陣、Rules Module、engine、Snapshot／Replay 與 UI 已依該 policy 接線；目前沒有 supply `blocked-by-rule-exception`。

## 狀態定義

| 狀態 | 意義 |
| --- | --- |
| `supported` | 現有引擎已有可重播、可測試的泛用能力；不代表所有卡牌效果已載入。 |
| `missing-generic-capability` | 資料已可 provisional 判讀，但引擎沒有可重用、資料驅動的能力。 |
| `blocked-by-rule-exception` | 必須有官方裁定或資料才能繼續；不可自行推測。 |
| `not-in-MVP-yet` | 完整架構預留方向，但不屬於基礎版 MVP 的實作範圍。 |

## 摘要矩陣

| 類別 | supported | missing | blocked | not in MVP |
| --- | ---: | ---: | ---: | ---: |
| 卡片／遊戲區移動 | 3 | 0 | 0 | 0 |
| 供應 | 4 | 0 | 0 | 0 |
| 討伐 | 4 | 0 | 0 | 0 |
| 隊伍、裝備與道具 | 4 | 0 | 0 | 0 |
| 隨機與資訊 | 4 | 0 | 0 | 0 |
| 時序與效果 | 3 | 0 | 0 | 0 |
| 羈絆、終局與計分 | 2 | 0 | 0 | 1 |

詳細 capability ID、引擎證據、候選 mechanics ID、限制與下一步均由矩陣資料提供並受測試驗證。

## 已有 coverage

- 個人抽牌只在「仍需繼續抽」時重建牌庫；展示牌庫頂不洗牌。
- Rules Module JSON-only supply configuration/refill 與 refresh policy/effect 已 supported；未設定官方供應組成或 base 預設 refresh policy。
- Supply deck／公開列配對與 refill-to-target evaluation 已移至 Rules Module JSON-only configuration；基礎 continuity policy 是可序列化的 engine-internal Rules Module data，不推測官方實體配比。
- generic supply row refresh policy/evaluator/Effect AST 已實作；destination 與 ordering 必須由 JSON policy 明確提供，未設定官方或 base 預設 refresh policy。
- generic continuous evaluation/runtime 已實作；未載入正式或 provisional continuous 卡牌效果。逐種類張數不再是 blocker，供應核准 policy 已由 capability、engine 與 tests 完整接線。
- generic BondCondition evaluator 與 authoritative completion 已實作；只接受 Rules Module 的 JSON-only 條件，並與 query 共用相同判定。舊 `requiredBosses` fixture 維持明確相容，未載入任何正式或 provisional 羈絆卡條件。
- generic CombatRewardPolicy runtime 與 choice continuation 已實作；preview 與 authoritative defeat 共用 evaluation，reward transaction 可跨 Snapshot 從 policy cursor 恢復，且不重複 reducer、events 或 RNG。未載入任何正式或 provisional 獎勵 policy。
- 基礎討伐 target、前綴隊伍戰力、道具使用區／休息清理、單裝備欄位。
- JSON-only combat conditions、戰力 modifier、target restriction 與 defeat/remove-target replacement 已由 query／dispatch 共用的確定性 evaluator 支援；尚未載入卡牌 policy。
- generic multi-target encounter resolution 已 supported：JSON-only policy 可宣告 completion、target／attachment disposition 與 explicit registry ref；Effect AST、Snapshot、choice/lifecycle continuation 與 transaction rollback 均可重播。未載入正式或 provisional 多部位魔王內容，也不推導官方討伐獎勵、終局或下一階段。
- JSON-only equipment eligibility conditions、結構化 rejection reason 與 Rules Module priority 已由 legal query／`EQUIP_ITEM` dispatch 共用的確定性 evaluator 支援；尚未載入卡牌或裝備內容。
- reducer 已發出 command/event lifecycle boundaries；中性 `grant-combat-reward` primitive 可表達獎勵資料，未載入任何卡牌效果。
- 動態隊伍上限、可插拔終局與計分 hooks、確定性 shuffle、PlayerView 資訊裁切。
- 可序列化 Effect AST、pending choice、deterministic random、transactional lifecycle registry/dispatch、continuous runtime、supply refresh、multi-target encounter、Snapshot resume 與 versioned Command Replay diagnostic export 均已 supported；不代表任何正式或 provisional 卡牌內容已載入。
- generic dice roll runtime 已 supported：Rules Module 只註冊 JSON-only sides，Effect AST 以明確 face outcome 執行；DIE_ROLLED payload、Snapshot 與 choice resume 可重播且不重擲。未載入任何卡牌骰子內容。
- generic counter consent lifecycle 已 supported：Rules Module JSON-only policy、純 evaluator、Effect AST 與專用 Commands 管理 request／accept／decline／cancel／deterministic explicit expiration；PlayerView 只在全體接受後投影公開 counter。固定 JSON replay compatibility fixtures 鎖定 Snapshot 精確 cursor、structured events／reason codes、event IDs、RNG、revision／event cursor 與 registry／actor-list 防竄改；command transaction resume 不重跑 reducer、effects、events 或 RNG，未載入任何 Vol.1 HP／卡牌內容。
- lifecycle interaction dock 已 supported：UI-local model 只組合 PlayerView、完整 legal Commands 與目前 revision 的 structured consent reason code；choice／consent、actor progress、waiting、terminal result、safe diagnostic、二次確認與鍵盤焦點不寫回 GameState，也不推導 Effect AST 或 counter 私密值。
- command-before 與 post-command lifecycle choice continuation 均已實作；command transaction 可跨 Snapshot 從精確 fact/boundary cursor 恢復，且 reducer、facts、hooks、events 與 RNG 不重複，後段失敗回到 command 起點。
- continuation 能力不代表任何正式或 provisional 卡牌內容已載入。
- Snapshot、Command、Event／Reducer 與 stale revision 邊界均維持在純 TypeScript engine；本矩陣不新增 UI 或網路依賴。

## 缺口與建議優先順序

1. **已完成 P0：基礎供應連續性。** 冒險者／物資允許 partial／empty 且事件不重複；魔物循環在 reward、choice／consent、post-command、Snapshot／Replay 與 rollback 後恆為 3。
2. **已完成 P1：lifecycle interaction dock。** pending choice／counter consent 共用非 modal dock；stale／矛盾資料不猜測指令，explicit expiration 不使用 wall-clock timer。
3. **下一步 P2：responsive game table shell。** 重整資訊層級與手機／平板／桌面 layout regression，規則仍由 session authority 提供。
4. **P3：內容接線與 Vol.1。** 只有在個別卡牌資料與時序確認後才載入既有 runtime；HP、同分排名、協助者與究極魔神維持獨立 Rules Module。

## 已解除並完成程式接線的項目

- **供應組成：** 其他物資／魔物的逐種類張數仍未知，但已明確不作為數位版或 playtest blocker；Content Pack 只需對自身宣告組成負責，且不得標示為官方實體配比。骷髏戰士確認為 3 張。
- **供應耗盡後續：** 冒險者／物資公開列可縮減至空而不凍結遊戲並顯示對應訊息；骷髏戰士擊敗後回魔物牌庫底。Base supply 不設定 `pendingOfficialRuling`，魔物也不產生 depletion event。

泛用 team capacity／overflow evaluation boundary 已實作，automatic 與 player-choice policy 都可由 query／dispatch 共用判定，choice 可跨 Snapshot 恢復完整 command transaction；未設定任何官方容量，亦未載入卡牌內容。特定裝備效果與任何正式／provisional 卡牌 reward／continuous 內容仍未實作。供應的兩個 legacy 項目已改為 supported／project-policy，不得再要求逐種份數或官方耗盡裁定。

## 驗收條件

- `validateEffectCapabilityMatrix` 必須拒絕重複／非中性 ID、無引擎證據、或未註明限制的非 `supported` 能力。
- 任一 `supported` 項目均有 engine source/test evidence；任一 `blocked-by-rule-exception` 項目清楚說明不可自行推測。
- 新增 DSL 時，先讓此矩陣的 capability 狀態改變並補 contract tests，再將候選效果送入 provisional playtest 裝配流程。
- 在 effect DSL 支援且個別候選仍維持 disabled 的條件下，production Content Pack 不得載入 provisional catalog；逐種類張數不再是解除此限制的必要條件。
