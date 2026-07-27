# 基礎版起始內容候選盤點

## 狀態

這是 content audit 的候選層，不是正式 Content Pack。所有條目皆為 `needs-human-confirmation` 或 `todo`、`disabled`，且 `runtimeLoadable: false`；`base:demo` 不會讀取它們。沒有官方圖片、掃描、卡面或美術被加入 repository。

候選資料與驗證器位於 `packages/content-base/src/candidates/`。候選欄位不能轉換成 `verified`；必須先建立獨立的正式卡牌 definition、欄位級來源和 content audit，再依正式啟用門檻處理。

## 視覺證據定位

| Evidence ID | 提供檔案（不提交） | 頁碼／區域 | 用途 |
| --- | --- | --- | --- |
| `user-visual:base-rulebook-page-05-setup` | `page-05.jpg` | 印刷頁碼 3，〈玩家設置〉第 1、2、4 點 | 起始隊伍、4 張召喚石、1 張精靈結晶與候選名稱／份數。 |
| `user-visual:base-card-07-starter-sheet` | `card-07.jpg` | 上排第 1–4 張、下排左側、下排中央、下排右側 | 候選名稱與可辨識的戰力／購買力讀值。 |

## 候選項目與缺口

| 候選 | 可記錄的候選欄位 | 仍是 TODO |
| --- | --- | --- |
| 麥娜、慕莎、卡儂、修爾蒂、辛芙妮 | 冒險者、各 1 張；候選戰力依序為 1、2、1、1、1。 | 費用、榮譽、完整效果與獨立人工覆核。 |
| 召喚石 | 4 張；候選購買力 1。 | 完整效果與獨立人工覆核。 |
| 精靈結晶 | 1 張；候選購買力 1。 | 完整效果與獨立人工覆核。 |

候選值只供下一輪人工核對比對，不可據此新增遊戲效果、UI、runtime 載入或正式卡牌資料。

內容負責人的逐列確認請使用 [起始內容人工審核包](./19-starter-review-packet.md)；審核包不會提升候選為正式資料。
