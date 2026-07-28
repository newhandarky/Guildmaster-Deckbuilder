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
| 供應 | 0 | 2 | 2 | 0 |
| 討伐 | 1 | 2 | 0 | 0 |
| 隊伍、裝備與道具 | 2 | 1 | 0 | 0 |
| 隨機與資訊 | 2 | 1 | 0 | 1 |
| 時序與效果 | 2 | 1 | 0 | 0 |
| 羈絆、終局與計分 | 1 | 1 | 0 | 1 |

詳細 capability ID、引擎證據、候選 mechanics ID、限制與下一步均由矩陣資料提供並受測試驗證。

## 已有 coverage

- 個人抽牌只在「仍需繼續抽」時重建牌庫；展示牌庫頂不洗牌。
- 基礎版固定公共供應列補牌與 `SUPPLY_DECK_DEPLETED` 正式事件；供應列本身尚未泛用化。
- 基礎討伐 target、前綴隊伍戰力、道具使用區／休息清理、單裝備欄位。
- 動態隊伍上限、可插拔終局與計分 hooks、確定性 shuffle、PlayerView 資訊裁切。
- Snapshot、Command、Event／Reducer 與 stale revision 邊界均維持在純 TypeScript engine；本矩陣不新增 UI 或網路依賴。

## 缺口與建議優先順序

1. **P0：解除資料阻擋前不可開完整對局。** 取得物資與魔物「逐種」份數的可稽核官方資料。這不是引擎工作；不得反推或建立非官方供應組成 policy。
2. **P1：Effect AST 與原子卡片移動。** 先做 `moveCard`、`discardCard`、`removeCard`、selector、`sequence`、`conditional` 與 effect queue；所有資料與 continuation 必須可序列化。
3. **P1：討伐／供應／裝備的泛用 extensions。** 接上獎勵、戰力修正、公開列刷新、裝備資格與隊伍溢出 policy；不可在 reducer 以單一卡名分支。
4. **P2：trigger、replacement、選擇與骰子。** 等前述 AST 可驗證後，加入 lifecycle hook、pending choice、注入式亂數與替代效果。
5. **P3：Vol.1 專屬能力。** HP、同分排名、協助者、究極魔神多部位，全部保持獨立 Rules Module，不滲入基礎 MVP。

## 被官方例外阻擋的項目

- **供應組成：** 28 種物資與 14 種魔物的逐種份數未知；因此無法合法建立正確 public supply decks。
- **供應耗盡後續：** 現行 `pendingOfficialRuling` 是凍結 command 的保守安全行為，不是官方基礎版規則。收到官方裁定前，不能改為自動結束、補牌或繼續。

## 驗收條件

- `validateEffectCapabilityMatrix` 必須拒絕重複／非中性 ID、無引擎證據、或未註明限制的非 `supported` 能力。
- 任一 `supported` 項目均有 engine source/test evidence；任一 `blocked-by-rule-exception` 項目清楚說明不可自行推測。
- 新增 DSL 時，先讓此矩陣的 capability 狀態改變並補 contract tests，再將候選效果送入 provisional playtest 裝配流程。
- 在逐種份數確認、effect DSL 支援與個別候選仍維持 disabled 的條件下，production Content Pack 不得載入 provisional catalog。
