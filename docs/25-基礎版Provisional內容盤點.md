# 基礎版 Provisional 內容盤點

本盤點實作於 `packages/content-base/src/provisional/base-provisional-catalog.ts`，僅是可稽核候選資料，不是正式 runtime Content Pack。來源均為使用者合法提供的本機視覺資料及官方網站文字；圖片未提交至 repository。

## 覆蓋範圍

| 類別 | 候選數 | 來源 | 狀態 |
| --- | ---: | --- | --- |
| 起始內容 | 7 | 規則書印刷頁 3、`card-07.jpg` | 起始區域與基本數值 provisional；未印出的欄位不推測 |
| 冒險者 | 30 種／總數 60 | `card-01.jpg`、規則書印刷頁 2、4 | 名稱、費用、戰力、榮譽、職業與效果 provisional |
| 物資 | 28 種／總數 59 | `card-03.jpg`、規則書印刷頁 2、4 | 種類、費用、卡面效果 provisional；逐種類張數未知但不再 blocking |
| 魔物 | 14 種／總數 32 | `card-05.jpg`、規則書印刷頁 2、5 | 戰力、購買力、榮譽與結算效果 provisional；骷髏戰士確認 3 張，其他逐種類張數未知但不再 blocking |
| 魔王 | 11 | `card-04.jpg`、規則書印刷頁 2、5、官方 FAQ | 數值與效果 provisional；巴風特／奇美拉 FAQ 補充欄位 verified |
| 羈絆 | 30 | `card-02.jpg`、規則書印刷頁 2、5 | roster、條件與榮譽 provisional |
| 協助者 | 12 | `card-06.jpg`、規則書印刷頁 2、11 | roster、各一張與效果 provisional |

## 對局規則交叉結果

- 個人牌庫只在抽牌過程中空且仍要繼續抽時重洗；查看／展示牌庫頂不重洗。
- 道具結算後留在使用區，休息時才棄至棄牌堆（FAQ 勘誤）。
- 神樂的「查看」修為「展示」；巴風特與奇美拉採官方 FAQ 補充；修爾蒂自身不吃自身的第一位加成。
- 基礎版冒險者／物資供應耗盡後允許公開列縮減至空並繼續遊戲；骷髏戰士 3 張在擊敗後回到魔物牌庫底，使魔物區 committed state 始終正好 3 張。這是 2026-07-31 核准並以 `project-policy` evidence 記錄的專案 policy。
- 以上規則會保留在規則文件／Rules Module，並不因候選 catalog 而自動寫進 UI 或 production runtime。

完整欄位、來源定位、confidence 與 exception reason 由 TypeScript catalog 驗證；請見 [例外清單](./26-基礎版Provisional例外清單.md)。

## Playtest 裝配狀態

逐種類張數已降為非阻擋的來源 metadata 缺口；不得把未知數位組成宣稱為官方實體配比。

目前已建立 `base:provisional-foundation` 內部垂直切片：7 個起始定義、8 種冒險者、8 種物資、4 種魔物與 4 張魔王，共 31 個中性名稱定義。此切片的數值來自候選 catalog；物資逐種類張數仍缺乏來源證據，因此目前各採 2 張作為 pack 自有的數位 playtest 組成，不宣稱等同官方實體配比。它必須由遠征入口明確選擇，並由 engine `allowProvisionalPlaytest` 閘門授權；存檔／Replay 使用 `0.5.0` 的獨立 manifest 指紋，不能與 Demo 或舊 foundation 存檔混用。

這仍不是完整基礎版 playtest Content Pack。候選物資 01、04、05、08、10、15、17 標記為 `playtest:effect-enabled`：01／05 依卡種從棄牌堆取回冒險者／裝備，04 棄 1 張手牌中的魔王後抽 3 張，08 執行「抽 2 張牌」，10 執行「棄 1 張手牌後抽 2 張」，15 從手牌／隊伍／棄牌堆選擇並移除 1 張牌，17 執行「抽 3 張後棄 1 張手牌」。動態選牌由 authoritative visible sources 與 versioned predicate 產生合法選項，並把選中卡片的 canonical source location 寫入 Effect context；版本化 card-use continuation 保存 root Command、回滾點、事件與 context，可跨 Snapshot／Replay 恢復，完成時只提交一次 revision。移除有配戴裝備的隊員時，裝備依明確 policy 置入棄牌堆；沒有候選時 legal Commands 不會列出該道具。候選物資 02 已接入購買／配戴流程；引擎也已支援 JSON-only 的「裝備＋配戴者職業／tag → 隊伍前綴戰力修正」，但現有欄位證據未建立此卡的確切加成數值，因此 catalog 將其效果記為 exception，runtime 仍標記 `playtest:effects-disabled`，不得猜值啟用。UI 會持續顯示其餘效果未啟用；完整裝配仍需協助者 adapter、個別時序與第二人覆核。production 預設仍是原創 Demo，provisional 不得自動載入。
