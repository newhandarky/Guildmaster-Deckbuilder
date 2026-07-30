# 基礎版 Provisional 效果能力矩陣

本文件是目前已盤點的 provisional 基礎版候選效果，對照現有純 TypeScript Rules Engine 的可稽核 gap analysis。機器可讀資料在 `packages/content-base/src/capabilities/base-provisional-effect-capability-matrix.ts`；它只引用中性 mechanics ID，不含玩家顯示名稱、官方圖片或 UI 素材。

這不是 production Content Pack，也不會讓任何 provisional 候選卡變成 runtimeLoadable。物資與魔物逐種份數仍是唯一 P0 exception，見 [例外清單](./26-基礎版Provisional例外清單.md)。

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
| 供應 | 2 | 0 | 2 | 0 |
| 討伐 | 4 | 0 | 0 | 0 |
| 隊伍、裝備與道具 | 4 | 0 | 0 | 0 |
| 隨機與資訊 | 4 | 0 | 0 | 0 |
| 時序與效果 | 3 | 0 | 0 | 0 |
| 羈絆、終局與計分 | 2 | 0 | 0 | 1 |

詳細 capability ID、引擎證據、候選 mechanics ID、限制與下一步均由矩陣資料提供並受測試驗證。

## 已有 coverage

- 個人抽牌只在「仍需繼續抽」時重建牌庫；展示牌庫頂不洗牌。
- Rules Module JSON-only supply configuration/refill 與 refresh policy/effect 已 supported；未設定官方供應組成或 base 預設 refresh policy。
- Supply deck／公開列配對與 refill-to-target evaluation 已移至 Rules Module JSON-only configuration；未推測官方組成或耗盡後續。
- generic supply row refresh policy/evaluator/Effect AST 已實作；destination 與 ordering 必須由 JSON policy 明確提供，未設定官方或 base 預設 refresh policy。
- generic continuous evaluation/runtime 已實作；未載入正式或 provisional continuous 卡牌效果，官方物資／魔物份數與供應耗盡裁定持續為 blocked-by-rule-exception。
- generic BondCondition evaluator 與 authoritative completion 已實作；只接受 Rules Module 的 JSON-only 條件，並與 query 共用相同判定。舊 `requiredBosses` fixture 維持明確相容，未載入任何正式或 provisional 羈絆卡條件。
- generic CombatRewardPolicy runtime 與 choice continuation 已實作；preview 與 authoritative defeat 共用 evaluation，reward transaction 可跨 Snapshot 從 policy cursor 恢復，且不重複 reducer、events 或 RNG。未載入任何正式或 provisional 獎勵 policy。
- 基礎討伐 target、前綴隊伍戰力、道具使用區／休息清理、單裝備欄位。
- JSON-only combat conditions、戰力 modifier、target restriction 與 defeat/remove-target replacement 已由 query／dispatch 共用的確定性 evaluator 支援；尚未載入卡牌 policy。
- generic multi-target encounter resolution 已 supported：JSON-only policy 可宣告 completion、target／attachment disposition 與 explicit registry ref；Effect AST、Snapshot、choice/lifecycle continuation 與 transaction rollback 均可重播。未載入正式或 provisional 多部位魔王內容，也不推導官方討伐獎勵、終局、下一階段或供應耗盡裁定。
- JSON-only equipment eligibility conditions、結構化 rejection reason 與 Rules Module priority 已由 legal query／`EQUIP_ITEM` dispatch 共用的確定性 evaluator 支援；尚未載入卡牌或裝備內容。
- reducer 已發出 command/event lifecycle boundaries；中性 `grant-combat-reward` primitive 可表達獎勵資料，未載入任何卡牌效果。
- 動態隊伍上限、可插拔終局與計分 hooks、確定性 shuffle、PlayerView 資訊裁切。
- 可序列化 Effect AST、pending choice、deterministic random、transactional lifecycle registry/dispatch、continuous runtime、supply refresh、multi-target encounter、Snapshot resume 與 versioned Command Replay diagnostic export 均已 supported；不代表任何正式或 provisional 卡牌內容已載入。
- generic dice roll runtime 已 supported：Rules Module 只註冊 JSON-only sides，Effect AST 以明確 face outcome 執行；DIE_ROLLED payload、Snapshot 與 choice resume 可重播且不重擲。未載入任何卡牌骰子內容。
- generic counter consent lifecycle 已 supported：Rules Module JSON-only policy、純 evaluator、Effect AST 與專用 Commands 管理 request／accept／decline／cancel／deterministic explicit expiration；PlayerView 只在全體接受後投影公開 counter。固定 JSON replay compatibility fixtures 鎖定 Snapshot 精確 cursor、structured events／reason codes、event IDs、RNG、revision／event cursor 與 registry／actor-list 防竄改；command transaction resume 不重跑 reducer、effects、events 或 RNG，未載入任何 Vol.1 HP／卡牌內容。
- command-before 與 post-command lifecycle choice continuation 均已實作；command transaction 可跨 Snapshot 從精確 fact/boundary cursor 恢復，且 reducer、facts、hooks、events 與 RNG 不重複，後段失敗回到 command 起點。
- continuation 能力不代表任何正式或 provisional 卡牌內容已載入。
- Snapshot、Command、Event／Reducer 與 stale revision 邊界均維持在純 TypeScript engine；本矩陣不新增 UI 或網路依賴。

## 缺口與建議優先順序

1. **P0：解除資料阻擋前不可開完整對局。** 取得物資與魔物「逐種」份數的可稽核官方資料。這不是引擎工作；不得反推或建立非官方供應組成 policy。
2. **已完成基礎：Effect AST 與 lifecycle dispatch。** 原子 card movement、choice、deterministic random、Rules Module lifecycle registry、pending queue、command-before/post-command 精確 cursor resume 與 command 起點 transaction rollback 已有 contract tests；不代表任何 provisional 卡牌已載入。
3. **P1：供應／裝備的泛用 extensions。** generic combat、equipment eligibility、team overflow 與公開列刷新已完成；不可在 reducer 以單一卡名分支。
4. **P2：continuous 與內容接線。** continuous runtime 與 generic counter consent 已完成；在官方資料與個別時序確認後，才把卡牌內容接到既有 lifecycle boundary；不得把 provisional catalog 當 production content 載入。Vol.1、正式卡牌 reward／continuous／counter policy 仍未啟用。
5. **P3：Vol.1 專屬能力。** HP、同分排名、協助者、究極魔神多部位，全部保持獨立 Rules Module，不滲入基礎 MVP。

## 被官方例外阻擋的項目

- **供應組成：** 28 種物資與 14 種魔物的逐種份數未知；因此無法合法建立正確 public supply decks。
- **供應耗盡後續：** 現行 `pendingOfficialRuling` 是凍結 command 的保守安全行為，不是官方基礎版規則。收到官方裁定前，不能改為自動結束、補牌或繼續。

泛用 team capacity／overflow evaluation boundary 已實作，automatic 與 player-choice policy 都可由 query／dispatch 共用判定，choice 可跨 Snapshot 恢復完整 command transaction；未設定任何官方容量或官方預設處理，亦未載入卡牌內容。特定裝備效果與任何正式／provisional卡牌 reward／continuous內容仍未實作；物資／魔物逐種份數與供應耗盡 official ruling 持續為 `blocked-by-rule-exception`。

## 驗收條件

- `validateEffectCapabilityMatrix` 必須拒絕重複／非中性 ID、無引擎證據、或未註明限制的非 `supported` 能力。
- 任一 `supported` 項目均有 engine source/test evidence；任一 `blocked-by-rule-exception` 項目清楚說明不可自行推測。
- 新增 DSL 時，先讓此矩陣的 capability 狀態改變並補 contract tests，再將候選效果送入 provisional playtest 裝配流程。
- 在逐種份數確認、effect DSL 支援與個別候選仍維持 disabled 的條件下，production Content Pack 不得載入 provisional catalog。
